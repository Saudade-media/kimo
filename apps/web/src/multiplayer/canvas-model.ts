/**
 * Board 41 "Multiplayer" (desing.pen kCAYr) on the canvas, framework-free: the rules the presence,
 * claim and asset layers (`./canvas/*`) draw from. Everything here is pure (unit-tested):
 *
 * - {@link createThrottle}: the local cursor, selection, page and viewport go out at most every
 *   {@link PRESENCE_THROTTLE_MS}, the last value always (trailing).
 * - {@link followViewport}: the viewport that shows a followed person's visible rectangle.
 * - {@link dockOffscreen}: where a person working outside the viewport docks (section 6 E).
 * - {@link claimOutlines}: one outline and one tab per agent (section 7: the claim outline
 *   replaces board 36's section outline), in the persona hue, warning while paused.
 * - {@link selectionOutlines}: remote selections (section 6 C), one outline per layer in the
 *   first person's color, tags side by side.
 */
import type { ClaimView } from "@kimo/editor-state"
import { workAreaIds } from "../canvas/agent-area"
import type { AgentPauseView } from "./agent-pause"
import type { AgentView, PersonView } from "./model"
import type { PresenceColor } from "./presence"

/** Local presence goes out at most this often (ms). */
export const PRESENCE_THROTTLE_MS = 50

/** Board 41 › 6 E: an off-screen pill sits this far inside the canvas edge (px). */
export const OFFSCREEN_INSET = 8

/** Board 41 › 7 A: the paused note docks this far right of the claim outline, 136 wide. */
export const PAUSED_NOTE_GAP = 6
export const PAUSED_NOTE_W = 136

export interface ThrottleTimers {
  now(): number
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

const realTimers: ThrottleTimers = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}

export interface Throttle<T> {
  /** Sends at once when the last send is `ms` old, else once the window ends (latest value). */
  push(value: T): void
  /** Sends a pending value now. */
  flush(): void
  /** Drops a pending value. */
  cancel(): void
}

/** Leading and trailing throttle: the first value goes at once, the last one always goes. */
export function createThrottle<T>(
  send: (value: T) => void,
  ms = PRESENCE_THROTTLE_MS,
  timers: ThrottleTimers = realTimers,
): Throttle<T> {
  let last = Number.NEGATIVE_INFINITY
  let pending: { value: T } | null = null
  let timer: unknown = null
  const fire = () => {
    timer = null
    if (!pending) return
    const { value } = pending
    pending = null
    last = timers.now()
    send(value)
  }
  return {
    push(value) {
      pending = { value }
      if (timer !== null) return
      const wait = last + ms - timers.now()
      if (wait <= 0) fire()
      else timer = timers.setTimeout(fire, wait)
    },
    flush() {
      if (timer !== null) timers.clearTimeout(timer)
      fire()
    },
    cancel() {
      if (timer !== null) timers.clearTimeout(timer)
      timer = null
      pending = null
    },
  }
}

type Rect = { x: number; y: number; w: number; h: number }

/**
 * The viewport (world top-left and zoom) that shows `theirs` (a world rectangle) inside a canvas
 * of `size` screen px: fitted, centered. Null when either size is empty.
 */
export function followViewport(
  theirs: Rect,
  size: { w: number; h: number },
): { x: number; y: number; zoom: number } | null {
  if (theirs.w <= 0 || theirs.h <= 0 || size.w <= 0 || size.h <= 0) return null
  const zoom = Math.min(size.w / theirs.w, size.h / theirs.h)
  const cx = theirs.x + theirs.w / 2
  const cy = theirs.y + theirs.h / 2
  return { x: cx - size.w / (2 * zoom), y: cy - size.h / (2 * zoom), zoom }
}

/** Lucide arrows for the eight docking directions (section 6 E: `arrow-down-right`). */
export type DockArrow =
  | "arrow-up"
  | "arrow-down"
  | "arrow-left"
  | "arrow-right"
  | "arrow-up-left"
  | "arrow-up-right"
  | "arrow-down-left"
  | "arrow-down-right"

export interface Dock {
  /** The pill's top-left corner (screen px, canvas layer). */
  x: number
  y: number
  arrow: DockArrow
}

/**
 * Where a point outside the canvas docks: clamped inside the nearest edge(s) by
 * {@link OFFSCREEN_INSET}, with the arrow pointing at it. Null while the point is on screen.
 * `pill` is the pill's size (its box stays inside the canvas).
 */
export function dockOffscreen(
  p: { x: number; y: number },
  view: { w: number; h: number },
  pill: { w: number; h: number },
): Dock | null {
  const left = p.x < 0
  const right = p.x > view.w
  const up = p.y < 0
  const down = p.y > view.h
  if (!left && !right && !up && !down) return null
  const maxX = Math.max(OFFSCREEN_INSET, view.w - pill.w - OFFSCREEN_INSET)
  const maxY = Math.max(OFFSCREEN_INSET, view.h - pill.h - OFFSCREEN_INSET)
  const x = left ? OFFSCREEN_INSET : right ? maxX : Math.min(maxX, Math.max(OFFSCREEN_INSET, p.x))
  const y = up ? OFFSCREEN_INSET : down ? maxY : Math.min(maxY, Math.max(OFFSCREEN_INSET, p.y))
  const v = up ? "up" : down ? "down" : ""
  const h = left ? "left" : right ? "right" : ""
  const arrow = (v && h ? `arrow-${v}-${h}` : `arrow-${v || h}`) as DockArrow
  return { x, y, arrow }
}

// --- Claims (section 7) -----------------------------------------------------------------------

/** The agent hues of the canvas (board 24 GmEAl; `agent` is teal). */
export type ClaimPersona = "agent" | "iris" | "violet" | "rose" | "ember" | "moss"

const PERSONAS: readonly ClaimPersona[] = ["iris", "violet", "rose", "ember", "moss"]

/**
 * The persona hue of a claim holder without a local agent record: built-in agents are
 * `agent:kimo.<session>.<n>`, the lead (0) teal, children Iris → Moss (board 24 GmEAl), as the
 * owner's own canvas draws them. Everything else (MCP clients, other agents) is teal.
 */
export function personaOfHolder(holder: string): ClaimPersona {
  const m = /^agent:kimo\.[^.]+\.(\d+)$/.exec(holder)
  const n = m ? Number(m[1]) : 0
  return n <= 0 ? "agent" : (PERSONAS[(n - 1) % PERSONAS.length] as ClaimPersona)
}

export interface ClaimOutlineView {
  holder: string
  /** Agent name ("Kimo", "Sol", "Claude Code"). */
  label: string
  /** The person running it, for other people's agents ("Maya"); null for yours. */
  owner: string | null
  local: boolean
  persona: ClaimPersona
  /** Claimed ids that are laid out (each claims its subtree). */
  ids: string[]
  /** The name of the first claimed layer ("Hero"). */
  frame: string
  /** Union box of the claimed layers (world). */
  box: Rect
  /** The tab text: "Kimo is editing Hero", "Sol · Maya's agent is editing Pricing", "Agent 2 paused". */
  tag: string
  /** Paused (local agents only): warning outline and tab, the cursor hidden, the docked note. */
  paused: AgentPauseView | null
  state: ClaimView["state"]
}

/** "Sol · Maya's agent" for other people's agents; the name alone for yours. */
export function agentTitle(label: string, owner: string | null): string {
  return owner ? `${label} · ${owner}'s agent` : label
}

/**
 * One outline per agent (holder): the union of its claimed layers that are laid out, the tag
 * text and hue. Holders whose claimed layers are all off this page give nothing.
 */
export function claimOutlines(
  claims: readonly ClaimView[],
  o: {
    box(id: string): Rect | null
    name(id: string): string | undefined
    agents?: readonly AgentView[]
    people?: readonly PersonView[]
    paused?: readonly AgentPauseView[]
    /** Local agents' hues (the agent panel's persona per origin). */
    persona?(holder: string): ClaimPersona | undefined
    /**
     * A node's parent: the drawn area follows board 31's work-area rule (a top-level page frame
     * the agent also resized gives way to the layers inside it it works on), so the outline sits
     * on the section, never on the whole page. The claim itself still covers every id.
     */
    parentOf?(id: string): string | null | undefined
  },
): ClaimOutlineView[] {
  const byHolder = new Map<string, ClaimView[]>()
  for (const c of claims) {
    const list = byHolder.get(c.holder)
    if (list) list.push(c)
    else byHolder.set(c.holder, [c])
  }
  const out: ClaimOutlineView[] = []
  for (const [holder, list] of byHolder) {
    const ordered = [...list].sort((a, b) => a.since - b.since)
    const claimed = [...new Set(ordered.flatMap((c) => c.ids))]
    const ids = o.parentOf ? workAreaIds(claimed, o.parentOf) : claimed
    const boxes = ids.map((id) => [id, o.box(id)] as const).filter(([, b]) => b !== null)
    if (!boxes.length) continue
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const [, b] of boxes) {
      const r = b as Rect
      x0 = Math.min(x0, r.x)
      y0 = Math.min(y0, r.y)
      x1 = Math.max(x1, r.x + r.w)
      y1 = Math.max(y1, r.y + r.h)
    }
    const first = ordered[0] as ClaimView
    const local = ordered.some((c) => c.local)
    const agent = o.agents?.find((a) => a.holder === holder)
    const label = ordered.find((c) => c.label)?.label ?? agent?.label ?? "Agent"
    const peer = ordered.find((c) => c.peer !== undefined)?.peer
    const owner = local
      ? null
      : ((agent && !agent.isYours ? agent.ownerLabel : null) ??
        (peer !== undefined ? (o.people?.find((p) => p.peer === peer)?.label ?? null) : null))
    const firstId = (boxes[0] as readonly [string, Rect | null])[0]
    const frame = o.name(firstId) ?? "this area"
    const paused = (local && o.paused?.find((p) => p.holder === holder)) || null
    out.push({
      holder,
      label,
      owner,
      local,
      persona: (local ? o.persona?.(holder) : undefined) ?? personaOfHolder(holder),
      ids: boxes.map(([id]) => id),
      frame,
      box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
      tag: paused ? `${label} paused` : `${agentTitle(label, owner)} is editing ${frame}`,
      paused,
      state: ordered.some((c) => c.state === "live") ? "live" : first.state,
    })
  }
  return out
}

/** The docked note's copy (section 7 A `ncMl2`). */
export function pausedNoteText(paused: AgentPauseView, frame: string): string {
  const who = paused.by === "local" ? "You edited" : "Someone on another client edited"
  return `${who} inside ${frame}. Resumes on its own after 10 s with no edits from people in this area.`
}

// --- Remote selections (section 6 C) ------------------------------------------------------------

export interface SelectionOutlineView {
  id: string
  box: Rect
  /** The first person's color (outline). */
  color: PresenceColor
  /** Name tags, side by side, in join order. */
  tags: { peer: number; label: string; color: PresenceColor }[]
}

/**
 * Remote selections on this page: one outline per layer in the color of the first person (join
 * order) who selected it, every selecting person's tag side by side. You are left out.
 */
export function selectionOutlines(
  people: readonly PersonView[],
  o: { page: string | null; box(id: string): Rect | null },
): SelectionOutlineView[] {
  const byId = new Map<string, SelectionOutlineView>()
  for (const p of people) {
    if (p.isYou) continue
    if (p.page !== null && o.page !== null && p.page !== o.page) continue
    for (const id of p.selection) {
      const known = byId.get(id)
      if (known) {
        known.tags.push({ peer: p.peer, label: p.label, color: p.color })
        continue
      }
      const box = o.box(id)
      if (!box) continue
      byId.set(id, {
        id,
        box,
        color: p.color,
        tags: [{ peer: p.peer, label: p.label, color: p.color }],
      })
    }
  }
  return [...byId.values()]
}

/** The cursor's name pill: "Jonas", "Jonas · idle". */
export const cursorLabel = (p: Pick<PersonView, "label" | "idle">) =>
  p.idle ? `${p.label} · idle` : p.label

/** The image asset keys a node references (`./assets/<key>` in its fields). */
export function nodeAssetKeys(node: Readonly<Record<string, unknown>> | undefined): string[] {
  if (!node) return []
  const out = new Set<string>()
  const text = JSON.stringify(node)
  if (!text.includes("assets/")) return []
  for (const m of text.matchAll(/\.\/assets\/([0-9a-f]{16}\.[a-z0-9]{1,8})/g))
    out.add(m[1] as string)
  return [...out]
}

/** The placeholder state of an image key (section 8). */
export type AssetPlaceholderState = "fetching" | "unavailable" | "uploading" | "missing" | null

export function assetState(
  key: string,
  t: {
    local: ReadonlySet<string>
    uploading: readonly string[]
    fetching: readonly { key: string }[]
    unavailable: readonly string[]
    failed: readonly string[]
  },
): AssetPlaceholderState {
  if (t.uploading.includes(key)) return "uploading"
  if (t.local.has(key)) return null
  if (t.fetching.some((f) => f.key === key)) return "fetching"
  if (t.unavailable.includes(key) || t.failed.includes(key)) return "unavailable"
  return "missing"
}

/** "3.4 MB" (one decimal), "820 KB". */
export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1000))} KB`
}

/**
 * Board 41 › 8 E: the topbar sync status while assets move (edits first: only when no edit is
 * pending). For the topbar owner: `null` leaves the edit status as it is.
 */
export function assetSyncStatus(t: {
  uploading: readonly string[]
  fetching: readonly unknown[]
}): { icon: "arrow-up" | "arrow-down"; text: string } | null {
  const n = t.uploading.length
  if (n > 0) return { icon: "arrow-up", text: `Sharing ${n} ${n === 1 ? "image" : "images"}` }
  const f = t.fetching.length
  if (f > 0) return { icon: "arrow-down", text: `Fetching ${f} ${f === 1 ? "image" : "images"}` }
  return null
}
