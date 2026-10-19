/**
 * AREA_BUSY in the agent thread (board 41 › 7 C `WfdMv`, how it resolves `gRvEC`). An agent's
 * edit touched another agent's live claim: the tool answered `AREA_BUSY` with detail
 * `{kind: "area", holder, holderLabel?, ids, touched, since}` (packages/mcp-server `claims.ts`).
 * The thread shows "Waiting: <agent> is editing <frame>" with Work elsewhere and Wait:
 *
 * - Work elsewhere: the card collapses to one line; the agent goes on with another frame.
 * - Wait: the card stays (Wait turns into Stop waiting) and the agent's next write waits until
 *   the area is free ({@link AreaWaits.gate}); no timeout, the person decides.
 * - The area is free (released, stopped, its owner left): the card is replaced by "<frame> is
 *   free · continuing".
 *
 * {@link AreaWaits} is one per document store ({@link areaWaitsFor}); the claims it reads are the
 * store's registry, or what the share backend reports (desktop windows: the host's claims), set
 * with {@link AreaWaits.setClaims}.
 */
import { type ClaimView, claimsFor, type DocStore } from "@kimo/editor-state"

export interface AreaBusyDetail {
  holder: string
  holderLabel?: string
  /** The holder's claimed ids that overlap the call. */
  ids: string[]
  /** The call's ids that overlap. */
  touched: string[]
  /** When the holder took the area (ms). */
  since: number
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []

/** The AREA_BUSY detail of a tool error envelope (or its `detail`), else null. */
export function parseAreaBusy(input: unknown): AreaBusyDetail | null {
  if (!input || typeof input !== "object") return null
  const o = input as Record<string, unknown>
  // A whole envelope: `{ok: false, errors: [{code, detail}]}`, or one error.
  if (Array.isArray(o.errors)) {
    const e = o.errors.find(
      (x) => x && typeof x === "object" && (x as { code?: unknown }).code === "AREA_BUSY",
    ) as { detail?: unknown } | undefined
    return e ? parseAreaBusy(e.detail) : null
  }
  if (o.code === "AREA_BUSY" && "detail" in o) return parseAreaBusy(o.detail)
  if (typeof o.holder !== "string" || (o.kind !== undefined && o.kind !== "area")) return null
  const since =
    typeof o.since === "number"
      ? o.since
      : typeof o.since === "string"
        ? Date.parse(o.since)
        : Number.NaN
  return {
    holder: o.holder,
    ...(typeof o.holderLabel === "string" && o.holderLabel ? { holderLabel: o.holderLabel } : {}),
    ids: strings(o.ids),
    touched: strings(o.touched),
    since: Number.isFinite(since) ? since : 0,
  }
}

/** "just now", "2 min ago", "3 h ago" (the card's "claimed Hero 2 min ago"). */
export function agoText(since: number, now: number): string {
  const s = Math.max(0, Math.round((now - since) / 1000))
  if (s < 60) return "just now"
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  return `${d} ${d === 1 ? "day" : "days"} ago`
}

export interface AreaBusyCopy {
  title: string
  desc: string
}

/** Board 41 › 7 C copy: title and description. */
export function areaBusyCopy(o: {
  holderLabel: string
  owner: string | null
  frame: string
  agent: string
  since: number
  now: number
}): AreaBusyCopy {
  const who = o.owner
    ? `${o.holderLabel} is ${o.owner}'s agent and claimed`
    : `${o.holderLabel} claimed`
  return {
    title: `Waiting: ${o.holderLabel} is editing ${o.frame}`,
    desc: `${who} ${o.frame} ${agoText(o.since, o.now)}. ${o.agent} can work on another frame now, or wait until ${o.frame} is free.`,
  }
}

export type AreaChoice = "elsewhere" | "wait"

/** Most AREA_BUSY answers kept per document. */
const MAX_BUSY = 100

/** What the card of one AREA_BUSY call shows. */
export type AreaBusyResolution =
  /** Work elsewhere / Wait. */
  | { kind: "open" }
  /** Wait chosen: the card stays with Stop waiting. */
  | { kind: "waiting" }
  /** Work elsewhere chosen: one line. */
  | { kind: "elsewhere" }
  /** The holder let go of the area: one line, the agent continues. */
  | { kind: "free" }

interface Wait {
  origin: string
  holder: string
  ids: readonly string[]
  waiters: (() => void)[]
}

/** True when `holder` still claims one of `ids` in `claims`. */
export function stillClaimed(
  claims: readonly ClaimView[],
  holder: string,
  ids: readonly string[],
): boolean {
  const set = new Set(ids)
  return claims.some((c) => c.holder === holder && c.ids.some((id) => set.has(id)))
}

export class AreaWaits {
  private readonly choices = new Map<string, AreaChoice>()
  private readonly waits = new Map<string, Wait>()
  /** Calls whose busy area this window saw claimed. */
  private readonly seen = new Set<string>()
  /** AREA_BUSY answers by tool call id (most recent {@link MAX_BUSY}). */
  private readonly busyCalls = new Map<string, { origin: string; detail: AreaBusyDetail }>()
  private readonly listeners = new Set<() => void>()
  private claims: readonly ClaimView[] = []
  /** Claims from the share backend (desktop windows); null reads the store's registry. */
  private reported: readonly ClaimView[] | null = null
  private version = 0
  private readonly off: () => void

  constructor(
    private readonly registry: {
      list(): readonly ClaimView[]
      subscribe(l: () => void): () => void
    },
  ) {
    this.claims = registry.list()
    this.off = registry.subscribe(() => {
      if (this.reported === null) this.update(registry.list())
    })
  }

  /** Claims as the share backend reports them; null returns to the store's registry. */
  setClaims(claims: readonly ClaimView[] | null): void {
    this.reported = claims
    this.update(claims ?? this.registry.list())
  }

  /** Bumps on every change (`useSyncExternalStore`). */
  getVersion(): number {
    return this.version
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Records an AREA_BUSY answer to `origin`'s call `callId` (the tool host wrapper). */
  noteBusy(callId: string, origin: string, detail: AreaBusyDetail): void {
    this.busyCalls.set(callId, { origin, detail })
    if (stillClaimed(this.claims, detail.holder, detail.ids)) this.seen.add(callId)
    while (this.busyCalls.size > MAX_BUSY) {
      const oldest = this.busyCalls.keys().next().value as string
      this.busyCalls.delete(oldest)
      this.choices.delete(oldest)
      this.seen.delete(oldest)
    }
    this.changed()
  }

  /** The AREA_BUSY answer of call `callId`, if this window saw it. */
  busy(callId: string): { origin: string; detail: AreaBusyDetail } | undefined {
    return this.busyCalls.get(callId)
  }

  /** The card of call `callId` (busy on `detail`). */
  resolution(callId: string, detail: Pick<AreaBusyDetail, "holder" | "ids">): AreaBusyResolution {
    // Free only once this window saw the claim and then saw it go (a window that never sees the
    // holder's claims keeps the card open).
    if (detail.ids.length && stillClaimed(this.claims, detail.holder, detail.ids))
      this.seen.add(callId)
    else if (this.seen.has(callId)) return { kind: "free" }
    const c = this.choices.get(callId)
    if (c === "elsewhere") return { kind: "elsewhere" }
    if (c === "wait" && this.waits.has(callId)) return { kind: "waiting" }
    return { kind: "open" }
  }

  /** Work elsewhere: the card collapses (and a wait of this call ends). */
  workElsewhere(callId: string): void {
    this.choices.set(callId, "elsewhere")
    this.release(callId)
    this.changed()
  }

  /** Wait: `origin`'s next write waits until `holder` lets go of `ids`. */
  wait(callId: string, origin: string, detail: Pick<AreaBusyDetail, "holder" | "ids">): void {
    this.choices.set(callId, "wait")
    if (stillClaimed(this.claims, detail.holder, detail.ids)) this.seen.add(callId)
    if (!this.waits.has(callId))
      this.waits.set(callId, { origin, holder: detail.holder, ids: detail.ids, waiters: [] })
    this.settle()
    this.changed()
  }

  /** Stop waiting: back to the open card; the agent's writes go on. */
  stopWaiting(callId: string): void {
    this.choices.delete(callId)
    this.release(callId)
    this.changed()
  }

  /** True while `origin` waits for an area. */
  isWaiting(origin: string): boolean {
    for (const w of this.waits.values()) if (w.origin === origin) return true
    return false
  }

  /** Resolves once `origin` waits for no area (at once when it does not), or on `signal`. */
  gate(origin: string, signal?: AbortSignal): Promise<void> {
    const mine = [...this.waits.values()].filter((w) => w.origin === origin)
    if (!mine.length || signal?.aborted) return Promise.resolve()
    return new Promise((resolve) => {
      let left = mine.length
      const done = () => {
        left -= 1
        if (left <= 0) {
          signal?.removeEventListener("abort", abort)
          resolve()
        }
      }
      const abort = () => {
        left = 0
        resolve()
      }
      signal?.addEventListener("abort", abort, { once: true })
      for (const w of mine) w.waiters.push(done)
    })
  }

  /** Ends every wait of `origin` (its turn stopped or ended). */
  endTurn(origin: string): void {
    let any = false
    for (const [id, w] of [...this.waits]) if (w.origin === origin && this.release(id)) any = true
    if (any) this.changed()
  }

  destroy(): void {
    this.off()
    for (const id of [...this.waits.keys()]) this.release(id)
    this.listeners.clear()
  }

  private update(claims: readonly ClaimView[]): void {
    this.claims = claims
    this.settle()
    this.changed()
  }

  /** Waits whose area is free resolve. */
  private settle(): void {
    for (const [id, w] of [...this.waits])
      if (!w.ids.length || !stillClaimed(this.claims, w.holder, w.ids)) this.release(id)
  }

  private release(callId: string): boolean {
    const w = this.waits.get(callId)
    if (!w) return false
    this.waits.delete(callId)
    for (const fn of w.waiters) fn()
    return true
  }

  private changed(): void {
    this.version += 1
    for (const l of [...this.listeners]) l()
  }
}

const WAITS = new WeakMap<DocStore, AreaWaits>()

/** The AREA_BUSY waits of a document (created on first use). */
export function areaWaitsFor(store: DocStore): AreaWaits {
  let w = WAITS.get(store)
  if (!w) {
    w = new AreaWaits(claimsFor(store))
    WAITS.set(store, w)
  }
  return w
}
