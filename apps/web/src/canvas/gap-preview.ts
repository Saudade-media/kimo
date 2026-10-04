/**
 * Board 27 §6 (b) gap hover (lQ9JF › mk4Ci, rule YRDTq): while the pointer is over the Auto
 * layout Gap / Row gap field, the canvas labels that gap of the selected layout frame in
 * `measure` ("Gap mark" 1 px line between items, "Row gap mark" between wrapped rows, with a
 * MeasurePill). The panel writes the hovered field here; the controller reads it into the
 * overlay's measurements. One store per UI store (one per editor session).
 */
import type { LayoutResult, Rect } from "@kimo/layout"
import type { Measurement } from "@kimo/renderer"
import type { UiStore } from "./contract"
import { fmtUnits } from "./snapping"

export interface GapPreview {
  /** The auto-layout frame. */
  id: string
  /** `main`: Gap (between items along the direction); `cross`: Row gap (between wrapped lines). */
  kind: "main" | "cross"
}

export interface GapPreviewStore {
  get(): GapPreview | null
  set(next: GapPreview | null): void
  subscribe(listener: () => void): () => void
}

const stores = new WeakMap<UiStore, GapPreviewStore>()

export function gapPreviewStore(ui: UiStore): GapPreviewStore {
  let s = stores.get(ui)
  if (s) return s
  let state: GapPreview | null = null
  const listeners = new Set<() => void>()
  s = {
    get: () => state,
    set(next) {
      if (next?.id === state?.id && next?.kind === state?.kind) return
      state = next
      for (const l of listeners) l()
    },
    subscribe(l) {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  }
  stores.set(ui, s)
  return s
}

/**
 * Measurements for a layout frame's gaps from its laid-out children (world boxes, flow order).
 * Lines (`dir` row): items wrap to a new line when one starts left of the previous one. Main
 * gap = a horizontal line between neighbours of a line, on the vertical centre of their overlap;
 * cross gap = a vertical line between consecutive lines, at the centre of the upper line's first
 * item (design: Row gap mark x 34 = item 10…58). Column layouts swap the axes. Labels are the
 * measured distances (world units, `fmtUnits`); zero / negative gaps are skipped.
 */
export function gapMeasurements(
  boxes: readonly Rect[],
  dir: "row" | "column",
  kind: "main" | "cross",
): Measurement[] {
  const row = dir === "row"
  // Main-axis start/end and cross-axis start/end accessors.
  const ms = (b: Rect) => (row ? b.x : b.y)
  const me = (b: Rect) => (row ? b.x + b.w : b.y + b.h)
  const cs = (b: Rect) => (row ? b.y : b.x)
  const ce = (b: Rect) => (row ? b.y + b.h : b.x + b.w)
  const lines: Rect[][] = []
  for (const b of boxes) {
    const line = lines.at(-1)
    const prev = line?.at(-1)
    if (!line || !prev || ms(b) < me(prev) - 1e-6) lines.push([b])
    else line.push(b)
  }
  const out: Measurement[] = []
  if (kind === "main") {
    for (const line of lines)
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1] as Rect
        const b = line[i] as Rect
        const d = ms(b) - me(a)
        if (d <= 1e-6) continue
        const lo = Math.max(cs(a), cs(b))
        const hi = Math.min(ce(a), ce(b))
        const at = hi > lo ? (lo + hi) / 2 : (cs(a) + ce(a)) / 2
        out.push({ axis: row ? "x" : "y", at, from: me(a), to: ms(b), label: fmtUnits(d) })
      }
    return out
  }
  for (let i = 1; i < lines.length; i++) {
    const upper = lines[i - 1] as Rect[]
    const lower = lines[i] as Rect[]
    const from = Math.max(...upper.map(ce))
    const to = Math.min(...lower.map(cs))
    if (to - from <= 1e-6) continue
    const first = upper[0] as Rect
    out.push({
      axis: row ? "y" : "x",
      at: (ms(first) + me(first)) / 2,
      from,
      to,
      label: fmtUnits(to - from),
    })
  }
  return out
}

/** The preview's measurements in `layout` (children of `id` in `childIds` order). */
export function gapPreviewMeasurements(
  layout: LayoutResult,
  preview: GapPreview,
  dir: "row" | "column",
  childIds: readonly string[],
): Measurement[] {
  const boxes = childIds
    .map((c) => layout.nodes.get(c))
    .filter((l) => !!l?.visible)
    .map((l) => l?.world as Rect)
  return gapMeasurements(boxes, dir, preview.kind)
}
