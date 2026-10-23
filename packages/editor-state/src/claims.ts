/**
 * Soft agent area claims (ADR 0016 item 16, docs/spec/multiplayer.md §15.11).
 *
 * Before an agent edits, it claims the subtrees it will touch: claiming a node claims its
 * descendants. Another agent's op group that touches a node inside a live claim (the node, an
 * ancestor or a descendant of a claimed id) is refused with `AREA_BUSY`. People are never
 * blocked: an edit by `user` inside an agent's claim is recorded as a human edit, and the agent's
 * next write is refused once (`REVISION_CONFLICT`, detail `human-edit`) so it re-reads first.
 *
 * One {@link ClaimRegistry} per `DocStore` ({@link claimsFor}). It holds the claims of agents in
 * this process (`local`) and the claims other clients publish in their presence (`remote`, keyed
 * by peer id; fed by `@kimo/sync`'s `bindClaimsToPresence`). The relay is blind, so claims are
 * cooperative: every client enforces them for its own agents.
 *
 * Claims end at turn end ({@link releaseClaims}), when the holder's connection or peer goes, and
 * after {@link CLAIM_TTL_MS} without renewal (every write of the holder renews).
 */
import type { DocStore, StoreChange } from "./types"

/** A claim is dropped after this long without activity of its holder. */
export const CLAIM_TTL_MS = 10 * 60_000
/** The last part of the TTL in which a claim reads as `expiring`. */
export const CLAIM_EXPIRING_MS = 60_000
/** Most ids one holder publishes in presence (the awareness envelope is capped at 16 KiB). */
export const MAX_PUBLISHED_CLAIM_IDS = 256
/** Most records one holder keeps (later claims merge into the newest one past this). */
const MAX_RECORDS_PER_HOLDER = 16
/** Ancestor walks stop here (a cycle or a pathological tree never loops). */
const MAX_DEPTH = 512

/**
 * One claim record, as published in presence (`PresenceState.claims`). A holder can have
 * several: each claim that adds ids the holder did not cover yet is a new record with its own
 * `since`, so tie-breaks compare when each area was taken.
 */
export interface ClaimRecord {
  /** The agent origin holding the area (`agent:<id>`). */
  holder: string
  /** Claimed node ids (each claims its whole subtree). */
  ids: readonly string[]
  /** When this record was taken (ms since the epoch, the holder's clock). */
  since: number
  /** Last activity of the holder (ms since the epoch, the holder's clock). */
  renewed: number
  /** The holder's turn, when it runs in turns (the built-in agent). */
  turn?: string
  /** Display name of the holder ("Kimo", "Claude Code"). */
  label?: string
}

/** A claim as the UI sees it ({@link ClaimRegistry.list}). */
export interface ClaimView extends ClaimRecord {
  /** Held by an agent of this client (false: published by peer `peer`). */
  local: boolean
  peer?: number
  /** When it lapses without renewal (local clock). */
  expiresAt: number
  /** `expiring` during the last {@link CLAIM_EXPIRING_MS} before `expiresAt`. */
  state: "live" | "expiring"
}

/** Why a claim was refused: the live claim it overlaps. */
export interface ClaimConflict {
  holder: string
  holderLabel?: string
  /** The holder's claimed ids that overlap the request. */
  ids: string[]
  /** The requested ids that overlap. */
  touched: string[]
  since: number
  /** Set when the holder is on another client. */
  peer?: number
}

/** A person edited inside an agent's claim since its last write. */
export interface HumanEdit {
  /** Changed node ids inside the claim (capped at 50). */
  ids: string[]
  /** `local`: a person on this client; `remote`: a change from another client. */
  by: "local" | "remote"
  /** When it was seen (local clock). */
  at: number
}

/** Parent links (a `DocStore` is one). */
export interface ClaimTree {
  getNode(id: string): { parent?: string | null } | undefined
}

export interface ClaimRegistryOptions {
  now?: () => number
  ttlMs?: number
  expiringMs?: number
  /** Schedule a timer that prunes and notifies at the next expiry. Default true. */
  timers?: boolean
}

interface Remote {
  records: ClaimRecord[]
  /** Local receipt time of each record's latest `renewed` (skew-free expiry). */
  seen: number[]
}

/**
 * Registries that hold local claims, so {@link releaseClaims} reaches every document. Weak: a
 * closed document's store and registry are collected even when a claim was never released.
 */
const ACTIVE = new WeakMap<ClaimRegistry, WeakRef<ClaimRegistry>>()
const ACTIVE_REFS = new Set<WeakRef<ClaimRegistry>>()

function activate(r: ClaimRegistry): void {
  if (ACTIVE.has(r)) return
  const ref = new WeakRef(r)
  ACTIVE.set(r, ref)
  ACTIVE_REFS.add(ref)
}

function deactivate(r: ClaimRegistry): void {
  const ref = ACTIVE.get(r)
  if (!ref) return
  ACTIVE.delete(r)
  ACTIVE_REFS.delete(ref)
}

export class ClaimRegistry {
  private readonly now: () => number
  private readonly ttl: number
  private readonly expiring: number
  private readonly timers: boolean
  private readonly local = new Map<string, ClaimRecord[]>()
  private readonly remote = new Map<number, Remote>()
  private readonly human = new Map<string, HumanEdit>()
  private readonly listeners = new Set<() => void>()
  private snapshot: readonly ClaimView[] | null = null
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly tree: ClaimTree,
    options: ClaimRegistryOptions = {},
  ) {
    this.now = options.now ?? Date.now
    this.ttl = options.ttlMs ?? CLAIM_TTL_MS
    this.expiring = Math.min(options.expiringMs ?? CLAIM_EXPIRING_MS, this.ttl)
    this.timers = options.timers ?? true
  }

  // --- Agents of this client ------------------------------------------------------------------

  /**
   * The live claim of another holder that `ids` overlap (ancestor or descendant), or null. Pure
   * apart from dropping expired claims. Free when nobody else holds anything.
   */
  check(holder: string, ids: readonly string[]): ClaimConflict | null {
    if (ids.length === 0) return null
    this.prune()
    let best: ClaimConflict | null = null
    const consider = (r: ClaimRecord, peer?: number) => {
      // Another client's agent is another holder, even under the same origin string.
      if (peer === undefined && sameTeam(r.holder, holder)) return
      const hit = this.overlap(r.ids, ids)
      if (!hit) return
      if (!best || r.since < best.since)
        best = {
          holder: r.holder,
          ...(r.label ? { holderLabel: r.label } : {}),
          ids: hit.claimed,
          touched: hit.touched,
          since: r.since,
          ...(peer !== undefined ? { peer } : {}),
        }
    }
    for (const [h, records] of this.local)
      if (!sameTeam(h, holder)) for (const r of records) consider(r)
    for (const [peer, rem] of this.remote) for (const r of rem.records) consider(r, peer)
    return best
  }

  /**
   * Claims `ids` for `holder` unless another live claim overlaps them (then nothing changes and
   * the conflict comes back). Ids the holder already covers are not claimed again. Renews.
   */
  claim(
    holder: string,
    ids: readonly string[],
    meta: { label?: string; turn?: string } = {},
  ): ClaimConflict | null {
    const conflict = this.check(holder, ids)
    if (conflict) return conflict
    this.add(holder, ids, meta)
    return null
  }

  /** Adds `ids` to `holder`'s claim without a check (nodes its own edit just created). Renews. */
  add(holder: string, ids: readonly string[], meta: { label?: string; turn?: string } = {}): void {
    const records = this.local.get(holder) ?? []
    const fresh = [...new Set(ids)].filter((id) => id && !this.coveredBy(records, id))
    const t = this.now()
    let changed = false
    if (fresh.length) {
      const last = records.at(-1)
      if (records.length >= MAX_RECORDS_PER_HOLDER && last) {
        records[records.length - 1] = { ...last, ids: [...last.ids, ...fresh] }
      } else
        records.push({
          holder,
          ids: fresh,
          since: t,
          renewed: t,
          ...(meta.turn ? { turn: meta.turn } : {}),
          ...(meta.label ? { label: meta.label } : {}),
        })
      this.local.set(holder, records)
      activate(this)
      changed = true
    }
    if (this.renewRecords(records, t, meta.turn) || changed) this.changed()
  }

  /** True when `holder`'s local claim covers `id` (the node or an ancestor). */
  covers(holder: string, id: string): boolean {
    return this.coveredBy(this.local.get(holder) ?? [], id)
  }

  /** Marks activity of `holder`: its claims live another TTL. */
  renew(holder: string): void {
    const records = this.local.get(holder)
    if (records && this.renewRecords(records, this.now())) this.changed()
  }

  /**
   * Drops `holder`'s claims (all, or only those of `turn`) and any pending human-edit notice.
   * Returns true when something was released.
   */
  release(holder: string, turn?: string): boolean {
    const records = this.local.get(holder)
    const hadNotice = this.human.delete(holder)
    if (!records) {
      if (hadNotice) this.changed()
      return hadNotice
    }
    const keep = turn === undefined ? [] : records.filter((r) => r.turn !== turn)
    if (keep.length === records.length) {
      if (hadNotice) this.changed()
      return hadNotice
    }
    if (keep.length) this.local.set(holder, keep)
    else this.local.delete(holder)
    if (this.local.size === 0) deactivate(this)
    this.changed()
    return true
  }

  /** The pending human edit inside `holder`'s claim, if any (not consumed). */
  humanEdit(holder: string): HumanEdit | undefined {
    return this.human.get(holder)
  }

  /** Returns and clears the pending human edit of `holder` (the agent was told). */
  takeHumanEdit(holder: string): HumanEdit | undefined {
    const h = this.human.get(holder)
    if (h) {
      this.human.delete(holder)
      this.changed()
    }
    return h
  }

  /** The records this client publishes in presence (capped at {@link MAX_PUBLISHED_CLAIM_IDS} ids per holder). */
  localRecords(): ClaimRecord[] {
    this.prune()
    const out: ClaimRecord[] = []
    for (const records of this.local.values()) {
      let budget = MAX_PUBLISHED_CLAIM_IDS
      for (const r of records) {
        if (budget <= 0) break
        const ids = r.ids.slice(0, budget)
        budget -= ids.length
        out.push({ ...r, ids })
      }
    }
    return out
  }

  // --- Other clients (presence) ---------------------------------------------------------------

  /**
   * Replaces the claims peer `peer` publishes. Then resolves simultaneous claims: where a local
   * record overlaps a remote one taken earlier (`since`, then the lower holder id), the local
   * holder lets go of the overlapping ids; its next write there gets `AREA_BUSY`.
   */
  setRemote(peer: number, records: readonly ClaimRecord[]): void {
    const t = this.now()
    const before = this.remote.get(peer)
    if (records.length === 0) {
      if (before) {
        this.remote.delete(peer)
        this.changed()
      }
      return
    }
    const seen = records.map((r) => {
      const i = before?.records.findIndex(
        (o) => o.holder === r.holder && o.since === r.since && o.renewed === r.renewed,
      )
      return i !== undefined && i >= 0 ? (before?.seen[i] ?? t) : t
    })
    const next: Remote = { records: records.map((r) => ({ ...r, ids: [...r.ids] })), seen }
    if (before && sameRecords(before.records, next.records)) {
      before.seen = seen
      return
    }
    this.remote.set(peer, next)
    this.resolveTies(next.records)
    this.changed()
  }

  /** Peer `peer` left (or withdrew its presence): its claims go. */
  removePeer(peer: number): void {
    if (this.remote.delete(peer)) this.changed()
  }

  /** Disconnected: every remote claim goes; local ones stay (offline, local registry only). */
  clearRemote(): void {
    if (this.remote.size === 0) return
    this.remote.clear()
    this.changed()
  }

  // --- UI ---------------------------------------------------------------------------------------

  /** Every live claim (local and remote), oldest first. Stable until something changes. */
  list(): readonly ClaimView[] {
    this.prune()
    if (this.snapshot) return this.snapshot
    const t = this.now()
    const views: ClaimView[] = []
    const view = (r: ClaimRecord, base: number, local: boolean, peer?: number): ClaimView => {
      const expiresAt = base + this.ttl
      return {
        ...r,
        local,
        ...(peer !== undefined ? { peer } : {}),
        expiresAt,
        state: expiresAt - t <= this.expiring ? "expiring" : "live",
      }
    }
    for (const records of this.local.values())
      for (const r of records) views.push(view(r, r.renewed, true))
    for (const [peer, rem] of this.remote)
      rem.records.forEach((r, i) => {
        views.push(view(r, rem.seen[i] ?? t, false, peer))
      })
    views.sort((a, b) => a.since - b.since || (a.holder < b.holder ? -1 : 1))
    this.snapshot = views
    return views
  }

  /** The claim covering `id` (the node or an ancestor), for canvas outlines and tags. */
  claimAt(id: string): ClaimView | undefined {
    const chain = new Set(this.chain(id))
    return this.list().find((v) => v.ids.some((c) => chain.has(c)))
  }

  /** Subscribes to any change (claims, notices, expiry). `useSyncExternalStore`-friendly with {@link list}. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // --- Changes ----------------------------------------------------------------------------------

  /**
   * A committed change of the document. An edit by a person inside a local agent's claim is
   * recorded for that agent. `user` (here or relayed by a window, `remote:user`) is a person;
   * agent and MCP origins, file loads and repairs are not; a change from the network (`remote`,
   * `remote:mp:<room>`) counts as a person unless a remote claim covers the node (the relay
   * cannot tell who on the other client made it).
   */
  noteChange(change: StoreChange): void {
    if (this.local.size === 0 || change.nodes.size === 0) return
    if (change.cause === "load" || change.cause === "repair") return
    const o = change.origin.startsWith("remote:") ? change.origin.slice(7) : change.origin
    if (o.startsWith("agent:") || o.startsWith("mcp:") || o === "file" || o === "system") return
    const by: HumanEdit["by"] = o === "user" ? "local" : "remote"
    let nodes = [...change.nodes]
    if (by === "remote") {
      const remoteIds = [...this.remote.values()].flatMap((r) => r.records.flatMap((x) => x.ids))
      if (remoteIds.length) {
        const covered = new Set(remoteIds)
        nodes = nodes.filter((n) => !this.chain(n).some((c) => covered.has(c)))
      }
    }
    if (!nodes.length) return
    const t = this.now()
    let changed = false
    for (const [holder, records] of this.local) {
      const inside = nodes.filter((n) => this.coveredBy(records, n))
      if (!inside.length) continue
      const prev = this.human.get(holder)
      const ids = [...new Set([...(prev?.ids ?? []), ...inside])].slice(0, 50)
      this.human.set(holder, { ids, by: prev?.by === "local" ? "local" : by, at: t })
      changed = true
    }
    if (changed) this.changed()
  }

  /** Drops expired claims now (also runs on every read). */
  prune(): void {
    const t = this.now()
    let changed = false
    for (const [holder, records] of this.local) {
      const keep = records.filter((r) => t - r.renewed < this.ttl)
      if (keep.length === records.length) continue
      changed = true
      if (keep.length) this.local.set(holder, keep)
      else {
        this.local.delete(holder)
        this.human.delete(holder)
      }
    }
    if (this.local.size === 0) deactivate(this)
    for (const [peer, rem] of this.remote) {
      const idx = rem.records.map((_, i) => i).filter((i) => t - (rem.seen[i] ?? t) < this.ttl)
      if (idx.length === rem.records.length) continue
      changed = true
      if (idx.length)
        this.remote.set(peer, {
          records: idx.map((i) => rem.records[i] as ClaimRecord),
          seen: idx.map((i) => rem.seen[i] as number),
        })
      else this.remote.delete(peer)
    }
    if (changed) this.changed()
  }

  /** Stops the expiry timer and forgets everything. */
  destroy(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.local.clear()
    this.remote.clear()
    this.human.clear()
    this.listeners.clear()
    deactivate(this)
  }

  // --- Internals --------------------------------------------------------------------------------

  /** `id` and its ancestors, nearest first. */
  private chain(id: string): string[] {
    const out: string[] = []
    let cur: string | null | undefined = id
    while (cur && out.length < MAX_DEPTH && !out.includes(cur)) {
      out.push(cur)
      cur = this.tree.getNode(cur)?.parent ?? null
    }
    return out
  }

  private coveredBy(records: readonly ClaimRecord[], id: string): boolean {
    if (!records.length) return false
    const chain = this.chain(id)
    return records.some((r) => r.ids.some((c) => chain.includes(c)))
  }

  /** Ancestor/descendant overlap of claimed ids and touched ids, or null. */
  private overlap(
    claimed: readonly string[],
    touched: readonly string[],
  ): { claimed: string[]; touched: string[] } | null {
    const claimedSet = new Set(claimed)
    const touchedSet = new Set(touched)
    const hitClaimed = new Set<string>()
    const hitTouched = new Set<string>()
    // A touched node inside a claimed subtree.
    for (const t of touchedSet)
      for (const c of this.chain(t))
        if (claimedSet.has(c)) {
          hitClaimed.add(c)
          hitTouched.add(t)
          break
        }
    // A claimed node inside a touched subtree.
    for (const c of claimedSet)
      for (const a of this.chain(c))
        if (touchedSet.has(a)) {
          hitClaimed.add(c)
          hitTouched.add(a)
          break
        }
    return hitClaimed.size ? { claimed: [...hitClaimed], touched: [...hitTouched] } : null
  }

  private renewRecords(records: ClaimRecord[], t: number, turn?: string): boolean {
    let changed = false
    records.forEach((r, i) => {
      if (r.renewed !== t || (turn && r.turn !== turn)) {
        records[i] = { ...r, renewed: t, ...(turn ? { turn } : {}) }
        changed = true
      }
    })
    return changed
  }

  private resolveTies(remote: readonly ClaimRecord[]): void {
    for (const [holder, records] of [...this.local]) {
      let changed = false
      const next: ClaimRecord[] = []
      for (const r of records) {
        let ids = [...r.ids]
        for (const o of remote) {
          if (!beats(o, r)) continue
          const hit = this.overlap(ids, o.ids)
          if (hit) {
            ids = ids.filter((id) => !hit.claimed.includes(id))
            changed = true
          }
        }
        if (ids.length) next.push(ids.length === r.ids.length ? r : { ...r, ids })
      }
      if (!changed) continue
      if (next.length) this.local.set(holder, next)
      else this.local.delete(holder)
    }
    if (this.local.size === 0) deactivate(this)
  }

  private changed(): void {
    this.snapshot = null
    this.schedule()
    for (const l of [...this.listeners]) l()
  }

  /** @internal The expiry timer fired. */
  tick(): void {
    this.timer = null
    this.snapshot = null
    this.prune()
    for (const l of [...this.listeners]) l()
    this.schedule()
  }

  /** One timer at the next expiry or `expiring` transition (unreferenced: never keeps a process alive). */
  private schedule(): void {
    if (!this.timers) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const t = this.now()
    let next = Number.POSITIVE_INFINITY
    const consider = (base: number) => {
      const end = base + this.ttl
      for (const at of [end - this.expiring, end]) if (at > t && at < next) next = at
    }
    for (const records of this.local.values()) for (const r of records) consider(r.renewed)
    for (const rem of this.remote.values()) for (const s of rem.seen) consider(s)
    if (!Number.isFinite(next)) return
    // The timer holds the registry weakly: a dropped document is not kept until the TTL.
    const ref = new WeakRef(this)
    this.timer = setTimeout(() => ref.deref()?.tick(), Math.max(0, next - t) + 1)
    ;(this.timer as { unref?: () => void }).unref?.()
  }
}

/**
 * The team of a holder: the agents of one session (`agent:kimo.<session>.<n>`, a lead and the
 * children it spawned) share one; any other origin is its own team. A team never blocks itself:
 * its members' areas are split by node scopes (`OUT_OF_SCOPE`) instead.
 */
export function claimTeam(holder: string): string {
  return /^(agent:[^.\s]+\.[^.\s]+)\.\d+$/.exec(holder)?.[1] ?? holder
}

function sameTeam(a: string, b: string): boolean {
  return a === b || claimTeam(a) === claimTeam(b)
}

/**
 * Tie-break for simultaneous claims: does remote record `o` win over local record
 * `r`? Earlier `since` wins, then the lower holder id. Same on every client, so exactly one side
 * lets go (both do only when holder and time are identical).
 */
function beats(o: ClaimRecord, r: ClaimRecord): boolean {
  if (o.since !== r.since) return o.since < r.since
  if (o.holder !== r.holder) return o.holder < r.holder
  return true
}

function sameRecords(a: readonly ClaimRecord[], b: readonly ClaimRecord[]): boolean {
  return (
    a.length === b.length &&
    a.every((r, i) => {
      const o = b[i] as ClaimRecord
      return (
        r.holder === o.holder &&
        r.since === o.since &&
        r.renewed === o.renewed &&
        r.turn === o.turn &&
        r.label === o.label &&
        r.ids.length === o.ids.length &&
        r.ids.every((id, k) => id === o.ids[k])
      )
    })
  )
}

const REGISTRIES = new WeakMap<DocStore, ClaimRegistry>()

/**
 * The claim registry of a document store (created on first use; it follows the store's changes
 * to notice human edits). `options` only apply on creation.
 */
export function claimsFor(store: DocStore, options?: ClaimRegistryOptions): ClaimRegistry {
  let r = REGISTRIES.get(store)
  if (!r) {
    const registry = new ClaimRegistry(store, options)
    store.onChange((c) => registry.noteChange(c))
    REGISTRIES.set(store, registry)
    r = registry
  }
  return r
}

/**
 * Releases `holder`'s claims on every document (turn end, connection closed). With `turn`, only
 * the claims taken during that turn. Returns true when something was released.
 */
export function releaseClaims(holder: string, turn?: string): boolean {
  let any = false
  for (const ref of [...ACTIVE_REFS]) {
    const r = ref.deref()
    if (!r) ACTIVE_REFS.delete(ref)
    else if (r.release(holder, turn)) any = true
  }
  return any
}

/**
 * True for origins that take claims: agents (`agent:<id>`), which run in turns. MCP clients have
 * no turn to end a claim, so they respect claims ({@link isClaimRespectingOrigin}) but hold none;
 * people neither hold nor respect them.
 */
export function isClaimingOrigin(origin: string): boolean {
  return origin.startsWith("agent:")
}

/** True for origins whose op groups are refused inside another holder's claim. */
export function isClaimRespectingOrigin(origin: string): boolean {
  return origin.startsWith("agent:") || origin.startsWith("mcp:")
}
