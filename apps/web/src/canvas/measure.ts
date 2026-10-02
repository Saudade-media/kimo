/**
 * Pure ⌥ measurement (board 10 #3a "sibling hovered" C7xrZ, #3b "nothing hovered" HOGOH;
 * contract `MeasureFn` in `./contract`).
 *
 * #3a: with a hovered `target`, per axis where the two boxes are disjoint, ONE line spans the
 * gap, placed at the center of the boxes' overlap on the other axis (or the selection's center
 * axis when they do not overlap). When one box contains the other, the four edge distances
 * inside it are drawn instead (Figma behaviour; the design shows only the disjoint case).
 * Outline = target.
 * #3b: no target: four distances from the selection's edges to the parent's edges on the
 * selection's center axes; outline = parent (drawn at opacity 0.5 by the renderer).
 * Zero-length distances are omitted. Labels: world units, 2 decimals, trailing zeros dropped.
 */
import type { Rect } from "@kimo/layout"
import type { Measurement } from "@kimo/renderer"
import type { MeasureFn, MeasureQuery, MeasureResult } from "./contract"
import { fmtUnits } from "./snapping"

const r2 = (r: Rect) => ({ x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h })

function line(axis: "x" | "y", at: number, a: number, b: number): Measurement | null {
  const from = Math.min(a, b)
  const to = Math.max(a, b)
  if (to - from < 1e-9) return null
  return { axis, at, from, to, label: fmtUnits(to - from) }
}

/** Four distances from `inner`'s edges to `outer`'s edges, on `inner`'s center axes. */
function inside(inner: Rect, outer: Rect): Measurement[] {
  const s = r2(inner)
  const o = r2(outer)
  const cx = inner.x + inner.w / 2
  const cy = inner.y + inner.h / 2
  return [
    line("x", cy, o.x0, s.x0),
    line("x", cy, s.x1, o.x1),
    line("y", cx, o.y0, s.y0),
    line("y", cx, s.y1, o.y1),
  ].filter((m): m is Measurement => m !== null)
}

const contains = (o: Rect, i: Rect) =>
  i.x >= o.x && i.y >= o.y && i.x + i.w <= o.x + o.w && i.y + i.h <= o.y + o.h

export const measure: MeasureFn = (q: MeasureQuery): MeasureResult => {
  const sel = q.selection
  if (q.target) {
    const t = q.target.rect
    const outline = { id: q.target.id, role: "target" as const }
    if (contains(t, sel)) return { measurements: inside(sel, t), outline }
    if (contains(sel, t)) return { measurements: inside(t, sel), outline }
    const s = r2(sel)
    const o = r2(t)
    const out: Measurement[] = []
    // Horizontal gap.
    const yLo = Math.max(s.y0, o.y0)
    const yHi = Math.min(s.y1, o.y1)
    const atY = yHi >= yLo ? (yLo + yHi) / 2 : sel.y + sel.h / 2
    if (o.x0 >= s.x1) out.push(line("x", atY, s.x1, o.x0) as Measurement)
    else if (o.x1 <= s.x0) out.push(line("x", atY, o.x1, s.x0) as Measurement)
    // Vertical gap.
    const xLo = Math.max(s.x0, o.x0)
    const xHi = Math.min(s.x1, o.x1)
    const atX = xHi >= xLo ? (xLo + xHi) / 2 : sel.x + sel.w / 2
    if (o.y0 >= s.y1) out.push(line("y", atX, s.y1, o.y0) as Measurement)
    else if (o.y1 <= s.y0) out.push(line("y", atX, o.y1, s.y0) as Measurement)
    return { measurements: out.filter(Boolean), outline }
  }
  if (q.parent) {
    return {
      measurements: inside(sel, q.parent.rect),
      outline: { id: q.parent.id, role: "parent" },
    }
  }
  return { measurements: [], outline: null }
}
