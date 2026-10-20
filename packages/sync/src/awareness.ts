/**
 * Encrypted presence for the network provider (docs/spec/multiplayer.md §15.9). States are keyed
 * by the relay-assigned peer id; each one travels as an awareness envelope sealed with the
 * room's awareness key and bound to the sender's peer id. A collaborator's `origin` comes from
 * the relay-stamped peers table, never from the payload.
 */
import type { ClaimRecord, LocalOrigin } from "@kimo/editor-state"
import {
  fromUtf8,
  MAX_AWARENESS_BYTES,
  type MpOrigin,
  openAwareness,
  type RoomKeys,
  sealAwareness,
  utf8,
} from "./mp/index"
import type { Awareness, PresenceState } from "./network"

type Change = { added: number[]; updated: number[]; removed: number[] }

/** What {@link KimoAwareness} needs from its provider. */
export interface AwarenessHost {
  /** Room keys, once derived. */
  keys(): RoomKeys | null
  /** True while the socket is open and caught up (presence is only sent then). */
  canSend(): boolean
  /** Sends one `awareness` frame on the current connection when it is still `peer`'s. */
  send(peer: number, clock: number, env: Uint8Array): void
  /** Relay-stamped origin of a peer, or undefined for an unknown peer. */
  originOf(peer: number): MpOrigin | undefined
  /** Most awareness frames per second (the relay's `awarenessHz`). */
  hz(): number
  now(): number
}

const EMPTY = new Uint8Array(0)

/** {@link Awareness} over sealed `kimo-mp/1` awareness frames. Constructed by the provider. */
export class KimoAwareness implements Awareness {
  private peer = 0
  private selfOrigin: LocalOrigin = "user"
  private local: PresenceState | null = null
  private readonly remote = new Map<number, PresenceState>()
  private readonly listeners = new Set<(change: Change) => void>()
  private clock = 0
  private lastSentAt = Number.NEGATIVE_INFINITY
  private timer: ReturnType<typeof setTimeout> | null = null
  private chain: Promise<void> = Promise.resolve()

  constructor(private readonly host: AwarenessHost) {}

  get clientId(): number {
    return this.peer
  }

  getLocalState(): PresenceState | null {
    return this.local
  }

  setLocalState(state: Omit<PresenceState, "origin"> | null): void {
    const had = this.local !== null
    this.local = state ? { ...state, origin: this.selfOrigin } : null
    if (this.local) this.emit(had ? { updated: [this.peer] } : { added: [this.peer] })
    else if (had) this.emit({ removed: [this.peer] })
    this.schedule()
  }

  getStates(): ReadonlyMap<number, PresenceState> {
    const states = new Map(this.remote)
    if (this.local) states.set(this.peer, this.local)
    return states
  }

  onChange(listener: (change: Change) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // --- Provider hooks ---------------------------------------------------------------------

  /** @internal A `welcome` assigned this replica `peer` with token `origin`. */
  setSelf(peer: number, origin: MpOrigin): void {
    const previous = this.peer
    this.peer = peer
    this.selfOrigin = origin
    if (!this.local) return
    this.local = { ...this.local, origin }
    if (previous !== peer) this.emit({ added: [peer], removed: [previous] })
  }

  /** @internal Sends the local state now (after a catch-up), bypassing the throttle. */
  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.local) this.sendNow()
  }

  /** @internal Withdraws presence on the open connection (synchronous: an empty envelope). */
  withdraw(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.host.canSend()) this.host.send(this.peer, ++this.clock, EMPTY)
  }

  /** @internal An incoming `awareness` frame. A frame that does not open is dropped. */
  async receive(peer: number, env: Uint8Array): Promise<void> {
    if (peer === this.peer) return
    if (env.length === 0) {
      this.removePeer(peer)
      return
    }
    const keys = this.host.keys()
    const origin = this.host.originOf(peer)
    if (!keys || origin === undefined) return
    let state: PresenceState | null
    try {
      state = parsePresence(fromUtf8(await openAwareness(keys, peer, env)), origin)
    } catch {
      return
    }
    // The peer may have left while the envelope was opening.
    if (!state || this.host.originOf(peer) === undefined) return
    const had = this.remote.has(peer)
    this.remote.set(peer, state)
    this.emit(had ? { updated: [peer] } : { added: [peer] })
  }

  /** @internal A peer left (or withdrew its presence). */
  removePeer(peer: number): void {
    if (this.remote.delete(peer)) this.emit({ removed: [peer] })
  }

  /** @internal The connection closed: every remote state goes; the local one is kept. */
  clearRemote(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const removed = [...this.remote.keys()]
    this.remote.clear()
    if (removed.length > 0) this.emit({ removed })
  }

  /** @internal Detach: forgets everything. */
  reset(): void {
    this.clearRemote()
    const had = this.local !== null
    this.local = null
    if (had) this.emit({ removed: [this.peer] })
    this.peer = 0
  }

  // --- Sending ----------------------------------------------------------------------------

  // At most `hz` frames per second; a trailing send carries the latest state.
  private schedule(): void {
    if (!this.host.canSend() || this.timer) return
    const interval = 1000 / Math.max(1, this.host.hz())
    const wait = this.lastSentAt + interval - this.host.now()
    if (wait <= 0) this.sendNow()
    else
      this.timer = setTimeout(() => {
        this.timer = null
        if (this.host.canSend()) this.sendNow()
      }, wait)
  }

  private sendNow(): void {
    this.lastSentAt = this.host.now()
    const peer = this.peer
    const state = this.local
    const keys = this.host.keys()
    if (!keys) return
    // Sealing is async; the chain keeps frames (and their clocks) in call order.
    this.chain = this.chain.then(async () => {
      let env: Uint8Array = EMPTY
      if (state) {
        const { origin: _ignored, ...payload } = state
        env = await sealAwareness(keys, peer, utf8(JSON.stringify(payload)))
        if (env.length > MAX_AWARENESS_BYTES) return
      }
      if (this.peer === peer && this.host.canSend()) this.host.send(peer, ++this.clock, env)
    })
    this.chain = this.chain.catch(() => {})
  }

  private emit(change: Partial<Change>): void {
    const full: Change = {
      added: change.added ?? [],
      updated: change.updated ?? [],
      removed: change.removed ?? [],
    }
    for (const l of [...this.listeners]) l(full)
  }
}

const isString = (v: unknown): v is string => typeof v === "string"
const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isString)

/** Validates a decrypted presence payload; unknown fields are dropped. */
function parsePresence(json: string, origin: MpOrigin): PresenceState | null {
  const value = JSON.parse(json) as Record<string, unknown> | null
  if (typeof value !== "object" || value === null) return null
  const user = value.user as Record<string, unknown> | null | undefined
  if (typeof user !== "object" || user === null) return null
  if (!isString(user.id) || !isString(user.name) || !isString(user.color)) return null
  const state: PresenceState = { user: { id: user.id, name: user.name, color: user.color }, origin }
  const cursor = value.cursor as Record<string, unknown> | null | undefined
  if (
    typeof cursor === "object" &&
    cursor !== null &&
    Number.isFinite(cursor.x) &&
    Number.isFinite(cursor.y)
  )
    state.cursor = { x: cursor.x as number, y: cursor.y as number }
  if (isStringList(value.selection)) state.selection = value.selection
  if (isStringList(value.working)) state.working = value.working
  const claims = parseClaims(value.claims)
  if (claims.length) state.claims = claims
  if (isString(value.page)) state.page = value.page
  if (value.owner === true) state.owner = true
  const text = value.text as Record<string, unknown> | null | undefined
  const short = (v: unknown, max: number): v is string =>
    isString(v) && v.length > 0 && v.length <= max
  if (
    typeof text === "object" &&
    text !== null &&
    short(text.node, 64) &&
    short(text.anchor, MAX_TEXT_POSITION) &&
    short(text.focus, MAX_TEXT_POSITION)
  )
    state.text = { node: text.node, anchor: text.anchor, focus: text.focus }
  const viewport = value.viewport as Record<string, unknown> | null | undefined
  if (
    typeof viewport === "object" &&
    viewport !== null &&
    ["x", "y", "w", "h", "zoom"].every((k) => Number.isFinite(viewport[k])) &&
    (viewport.w as number) >= 0 &&
    (viewport.h as number) >= 0 &&
    (viewport.zoom as number) > 0
  )
    state.viewport = {
      x: viewport.x as number,
      y: viewport.y as number,
      w: viewport.w as number,
      h: viewport.h as number,
      zoom: viewport.zoom as number,
    }
  return state
}

/** Longest encoded text position accepted (a Yjs relative position is a few dozen bytes). */
const MAX_TEXT_POSITION = 256

/** Most claim records and ids per record accepted from one peer. */
const MAX_CLAIM_RECORDS = 64
const MAX_CLAIM_IDS = 256
const HOLDER = /^(?:agent|mcp):\S+$/

/** Validates published claim records; malformed ones are dropped. */
export function parseClaims(value: unknown): ClaimRecord[] {
  if (!Array.isArray(value)) return []
  const out: ClaimRecord[] = []
  for (const raw of value.slice(0, MAX_CLAIM_RECORDS)) {
    if (typeof raw !== "object" || raw === null) continue
    const r = raw as Record<string, unknown>
    if (!isString(r.holder) || !HOLDER.test(r.holder)) continue
    if (!isStringList(r.ids) || r.ids.length === 0 || r.ids.length > MAX_CLAIM_IDS) continue
    if (!Number.isFinite(r.since) || !Number.isFinite(r.renewed)) continue
    out.push({
      holder: r.holder,
      ids: r.ids,
      since: r.since as number,
      renewed: r.renewed as number,
      ...(isString(r.turn) ? { turn: r.turn } : {}),
      ...(isString(r.label) ? { label: r.label.slice(0, 80) } : {}),
    })
  }
  return out
}
