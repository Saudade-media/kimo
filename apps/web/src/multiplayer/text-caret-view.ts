/**
 * Board 41 › 11 "Live text" (desing.pen ExORz, rules pCwkf), framework-free: where other
 * people's (and agents') carets, ranges and name flags go in a text layer, and when the flags
 * show. Everything here is pure or takes its timers (unit-tested); `TextCaretLayer` draws it.
 *
 * - {@link caretSpot}: a caret offset to its line box and x, upstream affinity at a soft wrap
 *   (the end of the upper line, as the local caret), the start of the next line after a newline.
 * - {@link rangeRows}: a range as one full-line-height box per line.
 * - {@link caretBar}, {@link flagTop}: the 2 px bar (1.2 × the font size, centered on the line)
 *   and the flags above it, flipped below on the layer's first line, stacked 2 apart.
 * - {@link caretGroups}: carets at one spot share one bar position, most recent typer first.
 * - {@link flagState}: shown for 3 s after the person's last keystroke, then faded; hover
 *   shows it, below 50 % zoom it hides (Tooltip on hover), hidden while you drag a selection.
 * - {@link CaretActivity}, {@link typists}: when each person last typed or moved their caret.
 * - {@link createAgentTextCarets}: agents write whole contents (no live caret): a caret at the
 *   end of what their latest write changed, for {@link AGENT_CARET_MS}.
 */
import type { DocStore, Origin, TextDelta } from "@kimo/editor-state"
import type { TextCharBox, TextGeometry } from "@kimo/renderer"
import { caretAfter } from "../canvas/rich-text/live"

/** `EwnNo` Remote caret: 2 px wide in screen px at any zoom. */
export const REMOTE_CARET_W = 2
/** `qs7mU` Bar: 24 tall on a 28 line at 20 px type (10 at 8 px): 1.2 × the font size, centered. */
export const CARET_BAR_EM = 1.2
/** `BkOUb` Flag: padding 1 5 around a 13 px line of text-xs. */
export const FLAG_H = 15
/** `t2btnL`: stacked flags sit 2 apart (y -13, -30). */
export const FLAG_STACK_GAP = 2
/** Flags fade this long after the person's last keystroke... */
export const FLAG_FADE_AFTER_MS = 3000
/** ...over this long. */
export const FLAG_FADE_MS = 150
/** `G52454`: below 50 % zoom flags hide (the caret and range stay). */
export const FLAG_MIN_ZOOM = 0.5
/** An agent's caret stays this long after its write. */
export const AGENT_CARET_MS = 3000
/** `d7UsO` Remote Range: the presence color at 0.24. */
export const REMOTE_RANGE_OPACITY = 0.24

/** A caret's place in a text (world units). */
export interface CaretSpot {
  x: number
  /** The line box. */
  top: number
  height: number
  fontSize: number
  /** On the layer's first line: the flag flips below. */
  firstLine: boolean
}

/** Where offset `offset` of the text draws its caret, or null when nothing is laid out. */
export function caretSpot(g: TextGeometry, offset: number): CaretSpot | null {
  const t = g.text
  const k = Math.max(0, Math.min(t.length, Math.round(offset)))
  let box: TextCharBox | null = null
  let x = 0
  // Upstream affinity: after the character before (end of the upper line at a soft wrap).
  if (k > 0 && t[k - 1] !== "\n") {
    box = g.char(k - 1)
    if (box) x = box.x1
  }
  if (!box && k < t.length && t[k] !== "\n") {
    box = g.char(k)
    if (box) x = box.x0
  }
  if (!box) {
    // An empty line (after a newline, or an empty text): the line below the last character.
    let j = k - 1
    let breaks = 0
    while (j >= 0 && t[j] === "\n") {
      breaks++
      j--
    }
    const before = j >= 0 ? g.char(j) : null
    box = g.lineStart(before ? before.line + breaks : breaks)
    if (!box) return null
    x = box.x0
  }
  return { x, top: box.top, height: box.height, fontSize: box.fontSize, firstLine: box.line === 0 }
}

export interface Row {
  x: number
  y: number
  w: number
  h: number
}

/** A range as one full-line-height box per line (world units), top to bottom. */
export function rangeRows(g: TextGeometry, anchor: number, focus: number): Row[] {
  const from = Math.max(0, Math.min(anchor, focus))
  const to = Math.min(g.text.length, Math.max(anchor, focus))
  const rows = new Map<number, Row>()
  for (let i = from; i < to; i++) {
    const c = g.char(i)
    if (!c) continue
    const r = rows.get(c.line)
    if (!r) rows.set(c.line, { x: c.x0, y: c.top, w: c.x1 - c.x0, h: c.height })
    else {
      const x1 = Math.max(r.x + r.w, c.x1)
      r.x = Math.min(r.x, c.x0)
      r.w = x1 - r.x
    }
  }
  return [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => r)
}

/** The bar inside its line box (screen px from the line top): 1.2 × the font size, centered. */
export function caretBar(spot: Pick<CaretSpot, "height" | "fontSize">, zoom: number) {
  const height = Math.min(spot.height, spot.fontSize * CARET_BAR_EM) * zoom
  return { top: (spot.height * zoom - height) / 2, height }
}

/**
 * The top of flag `index` (0: closest to the caret) in screen px from the line top: its bottom
 * edge on the bar's top, or (first line) its top edge on the bar's bottom; stacked 2 apart.
 */
export function flagTop(bar: { top: number; height: number }, below: boolean, index: number) {
  const step = index * (FLAG_H + FLAG_STACK_GAP)
  return below ? bar.top + bar.height + step : bar.top - FLAG_H - step
}

/** `BkOUb` radius 3 3 3 0 above the caret, `0 3 3 3` flipped below. */
export const flagRadius = (below: boolean) => (below ? "0 3px 3px 3px" : "3px 3px 3px 0")

/** The flag's text: "Maya", "Maya · idle". */
export const flagLabel = (label: string, idle: boolean) => (idle ? `${label} · idle` : label)

export interface GroupInput {
  key: string
  node: string
  focus: number
  /** When the caret last moved (ms): the most recent is closest to the caret. */
  activeAt: number
}

/** Carets at one spot (same node and offset): one bar position, most recent typer first. */
export function caretGroups<T extends GroupInput>(carets: readonly T[]): T[][] {
  const by = new Map<string, T[]>()
  for (const c of carets) {
    const id = `${c.node}\n${c.focus}`
    const list = by.get(id)
    if (list) list.push(c)
    else by.set(id, [c])
  }
  return [...by.values()].map((g) =>
    [...g].sort((a, b) => b.activeAt - a.activeAt || a.key.localeCompare(b.key)),
  )
}

export type FlagState = "shown" | "faded" | "hidden" | "tooltip"

/**
 * A flag's state: below 50 % zoom hidden (a Tooltip while its caret is hovered); hidden while
 * you drag a selection; shown while hovered or for 3 s after the last keystroke, then faded.
 */
export function flagState(o: {
  now: number
  activeAt: number
  zoom: number
  hovered: boolean
  dragging: boolean
}): FlagState {
  if (o.zoom < FLAG_MIN_ZOOM) return o.hovered && !o.dragging ? "tooltip" : "hidden"
  if (o.dragging) return "hidden"
  if (o.hovered) return "shown"
  return o.now - o.activeAt < FLAG_FADE_AFTER_MS ? "shown" : "faded"
}

/** Ms until a shown flag fades (null: it does not change by itself). */
export function nextFade(now: number, activeAt: number): number | null {
  const left = activeAt + FLAG_FADE_AFTER_MS - now
  return left > 0 ? left : null
}

/** When each caret last moved: its signature (encoded positions) changed, or it appeared. */
export class CaretActivity {
  private readonly seen = new Map<string, { sig: string; at: number }>()

  /** Records `sig` for `key` at `now`; returns when the caret last moved. */
  touch(key: string, sig: string, now: number): number {
    const prev = this.seen.get(key)
    if (prev && prev.sig === sig) return prev.at
    this.seen.set(key, { sig, at: now })
    return now
  }

  /** The person typed now (their caret stays put relative to the text after it). */
  bump(key: string, now: number): void {
    const prev = this.seen.get(key)
    this.seen.set(key, { sig: prev?.sig ?? "", at: now })
  }

  at(key: string): number {
    return this.seen.get(key)?.at ?? 0
  }

  /** Forgets carets that are gone. */
  keep(keys: Iterable<string>): void {
    const live = new Set(keys)
    for (const k of [...this.seen.keys()]) if (!live.has(k)) this.seen.delete(k)
  }
}

/**
 * Who typed a change of node `node`: the people whose caret now sits at the end of what it
 * wrote. A typing person's encoded caret does not change (it keeps to the character after it),
 * so their keystrokes are found here.
 */
export function typists(
  node: string,
  delta: TextDelta,
  carets: readonly { key: string; node: string; focus: number; kind: string }[],
): string[] {
  const end = deltaEnd(delta)
  if (end === null) return []
  return carets
    .filter((c) => c.kind === "person" && c.node === node && c.focus === end)
    .map((c) => c.key)
}

// --- Agents (no live caret) ---------------------------------------------------------------------

/** An agent's caret after a write: an encoded position in its text that follows edits. */
export interface AgentTextCaret {
  holder: string
  node: string
  position: string
  /** When it wrote (ms). */
  at: number
}

export interface AgentCaretTimers {
  now(): number
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

const realTimers: AgentCaretTimers = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}

export interface AgentTextCarets {
  list(): readonly AgentTextCaret[]
  subscribe(listener: () => void): () => void
  dispose(): void
}

/** The end of what one change wrote (offset in the new text), or null when it wrote nothing. */
export function deltaEnd(delta: TextDelta): number | null {
  const at = caretAfter([delta], -1)
  return at < 0 ? null : at
}

/**
 * Agent carets from their writes: for every text change `attribute` gives a holder (an agent
 * writing inside its claim), a caret at the end of the changed region, shown for
 * {@link AGENT_CARET_MS} after the agent's latest write. A whole replacement puts it at the end.
 */
export function createAgentTextCarets(
  store: Pick<DocStore, "onTextChange" | "encodeTextPosition" | "textRuns">,
  attribute: (origin: Origin, node: string) => string | null,
  timers: AgentCaretTimers = realTimers,
): AgentTextCarets {
  let carets: readonly AgentTextCaret[] = []
  const expiry = new Map<string, unknown>()
  const listeners = new Set<() => void>()
  const emit = () => {
    for (const l of [...listeners]) l()
  }
  const drop = (holder: string) => {
    expiry.delete(holder)
    carets = carets.filter((c) => c.holder !== holder)
    emit()
  }
  const off = store.onTextChange((e) => {
    const holder = attribute(e.origin, e.id)
    if (!holder) return
    let end: number | null
    if (e.delta) end = deltaEnd(e.delta)
    else end = (store.textRuns(e.id) ?? []).reduce((n, r) => n + r.text.length, 0)
    if (end === null) return
    const position = store.encodeTextPosition(e.id, end, -1)
    if (!position) return
    const prev = expiry.get(holder)
    if (prev !== undefined) timers.clearTimeout(prev)
    expiry.set(
      holder,
      timers.setTimeout(() => drop(holder), AGENT_CARET_MS),
    )
    carets = [
      ...carets.filter((c) => c.holder !== holder),
      { holder, node: e.id, position, at: timers.now() },
    ]
    emit()
  })
  return {
    list: () => carets,
    subscribe(l) {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    dispose() {
      off()
      for (const h of expiry.values()) timers.clearTimeout(h)
      expiry.clear()
      listeners.clear()
      carets = []
    },
  }
}
