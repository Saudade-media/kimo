/**
 * Pure snapping (board 10 #1 "Snapping while moving" O68JG1, #2 "Equal spacing" V6rSVv;
 * contract `SnapFn` / `CollectSnapCandidates` in `./contract`, ADR 0010).
 *
 * Per axis, the moving box's lines (left/center/right, or only the dragged edges when
 * resizing) snap to the same lines of every candidate (siblings + parent) within
 * `thresholdPx / zoom` world units. When moving, equal-spacing slots among siblings in the
 * same row/column compete with the edge lines; the nearest wins (edges on ties). After
 * snapping, every line of the moving box that coincides with a candidate line is drawn
 * spanning all boxes on it, with × markers at each box's extremes on the line.
 */
import type { LayoutResult, Rect } from "@kimo/layout"
import type { Point, SnapLine, SpacingIndicator } from "@kimo/renderer"
import {
  type CollectSnapCandidates,
  SNAP_THRESHOLD_PX,
  type SnapBox,
  type SnapQuery,
  type SnapResult,
} from "./contract"

/** Number label for overlays: world units, 2 decimals, trailing zeros dropped. */
export const fmtUnits = (v: number): string => {
  const r = Math.round(v * 100) / 100
  return String(Object.is(r, -0) ? 0 : r)
}

const EMPTY: SnapResult = { dx: 0, dy: 0, snap: { lines: [], markers: [] }, spacing: [] }

type Axis = "x" | "y"
/** Accessors for one axis: position, size, and the cross axis's. */
const A = {
  x: { p: (r: Rect) => r.x, s: (r: Rect) => r.w, cp: (r: Rect) => r.y, cs: (r: Rect) => r.h },
  y: { p: (r: Rect) => r.y, s: (r: Rect) => r.h, cp: (r: Rect) => r.x, cs: (r: Rect) => r.w },
} as const

const lines3 = (p: number, s: number) => [p, p + s / 2, p + s]
/** Coincidence tolerance for values that were snapped exactly (float noise only). */
const near = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a))

const crossOverlap = (axis: Axis, a: Rect, b: Rect): [number, number] | null => {
  const g = A[axis]
  const lo = Math.max(g.cp(a), g.cp(b))
  const hi = Math.min(g.cp(a) + g.cs(a), g.cp(b) + g.cs(b))
  return hi > lo || (hi === lo && g.cs(a) === 0) ? [lo, hi] : null
}

interface Slot {
  /** Main-axis delta that puts the moving box in the slot. */
  delta: number
  gap: number
}

/**
 * Equal-spacing slots for the moving box on `axis`: centered between two neighbours, or one
 * gap after/before a pair of siblings that already have that gap.
 */
function spacingSlots(axis: Axis, m: Rect, sibs: readonly Rect[]): Slot[] {
  const g = A[axis]
  const row = sibs
    .filter((r) => crossOverlap(axis, r, m))
    .sort((a, b) => g.p(a) - g.p(b) || g.s(a) - g.s(b))
  const slots: Slot[] = []
  const ms = g.s(m)
  const free = (p: number) =>
    row.every((r) => g.p(r) + g.s(r) <= p + 1e-9 || g.p(r) >= p + ms - 1e-9)
  // Between two neighbours.
  const mc = g.p(m) + ms / 2
  let left: Rect | null = null
  let right: Rect | null = null
  for (const r of row) {
    const end = g.p(r) + g.s(r)
    if (end <= mc && (!left || end > g.p(left) + g.s(left))) left = r
    if (g.p(r) >= mc && (!right || g.p(r) < g.p(right))) right = r
  }
  if (left && right) {
    const room = g.p(right) - (g.p(left) + g.s(left)) - ms
    if (room >= 0) {
      const p = g.p(left) + g.s(left) + room / 2
      if (free(p)) slots.push({ delta: p - g.p(m), gap: room / 2 })
    }
  }
  // Extending a pair's gap.
  for (let i = 0; i + 1 < row.length; i++) {
    const a = row[i] as Rect
    for (let j = i + 1; j < row.length; j++) {
      const b = row[j] as Rect
      const gap = g.p(b) - (g.p(a) + g.s(a))
      if (gap < 0 || !crossOverlap(axis, a, b)) continue
      // b must be a's direct neighbour (nothing in between).
      if (
        row.some(
          (r) => r !== a && r !== b && g.p(r) >= g.p(a) + g.s(a) && g.p(r) + g.s(r) <= g.p(b),
        )
      )
        continue
      const after = g.p(b) + g.s(b) + gap
      if (free(after)) slots.push({ delta: after - g.p(m), gap })
      const before = g.p(a) - gap - ms
      if (free(before)) slots.push({ delta: before - g.p(m), gap })
    }
  }
  return slots
}

/** Indicators for every consecutive pair (moving box included) whose gap equals `gap`. */
function spacingIndicators(
  axis: Axis,
  m: Rect,
  sibs: readonly Rect[],
  gap: number,
): SpacingIndicator[] {
  const g = A[axis]
  const row = [...sibs.filter((r) => crossOverlap(axis, r, m)), m].sort((a, b) => g.p(a) - g.p(b))
  const out: SpacingIndicator[] = []
  for (let i = 0; i + 1 < row.length; i++) {
    const a = row[i] as Rect
    const b = row[i + 1] as Rect
    const from = g.p(a) + g.s(a)
    const to = g.p(b)
    if (Math.abs(to - from - gap) > 1e-3) continue
    const ov = crossOverlap(axis, a, b)
    if (!ov) continue
    // Only the chain touching the moving box (directly or through equal gaps) is shown.
    out.push({ axis, from, to, crossFrom: ov[0], crossTo: ov[1], label: fmtUnits(gap) })
  }
  return out.some((s) => near(s.from, g.p(m) + g.s(m)) || near(s.to, g.p(m))) ? out : []
}

interface AxisResult {
  delta: number
  spacing: SpacingIndicator[]
  /** The delta came from an equal-spacing slot (not from an edge/center line). */
  slot: boolean
}

function snapAxis(
  axis: Axis,
  q: SnapQuery,
  thr: number,
  sibs: readonly Rect[],
  boxes: readonly Rect[],
): AxisResult {
  const g = A[axis]
  const m = q.moving
  const lo = axis === "x" ? q.edges.left : q.edges.top
  const hi = axis === "x" ? q.edges.right : q.edges.bottom
  const moving: number[] = []
  if (lo && hi) moving.push(...lines3(g.p(m), g.s(m)))
  else if (lo) moving.push(g.p(m))
  else if (hi) moving.push(g.p(m) + g.s(m))
  if (!moving.length) return { delta: 0, spacing: [], slot: false }
  let best: number | null = null
  for (const b of boxes) {
    for (const c of lines3(g.p(b), g.s(b))) {
      for (const v of moving) {
        const d = c - v
        if (Math.abs(d) <= thr && (best === null || Math.abs(d) < Math.abs(best))) best = d
      }
    }
  }
  let slot: Slot | null = null
  if (lo && hi) {
    for (const s of spacingSlots(axis, m, sibs)) {
      if (Math.abs(s.delta) > thr) continue
      if (!slot || Math.abs(s.delta) < Math.abs(slot.delta)) slot = s
    }
  }
  if (slot && (best === null || Math.abs(slot.delta) < Math.abs(best) - 1e-9)) {
    const moved = axis === "x" ? { ...m, x: m.x + slot.delta } : { ...m, y: m.y + slot.delta }
    return {
      delta: slot.delta,
      spacing: spacingIndicators(axis, moved, sibs, slot.gap),
      slot: true,
    }
  }
  return { delta: best ?? 0, spacing: [], slot: false }
}

/** Applies per-axis deltas to the moving box (move: shift; resize: move the dragged edges). */
function shifted(q: SnapQuery, dx: number, dy: number): Rect {
  const r = { ...q.moving }
  const one = (lo: boolean, hi: boolean, d: number, p: "x" | "y", s: "w" | "h") => {
    if (lo && hi) r[p] += d
    else if (lo) {
      r[p] += d
      r[s] -= d
    } else if (hi) r[s] += d
  }
  one(q.edges.left, q.edges.right, dx, "x", "w")
  one(q.edges.top, q.edges.bottom, dy, "y", "h")
  return r
}

/** Guide lines + markers for every coincident line of the final box. */
function guides(
  q: SnapQuery,
  r: Rect,
  boxes: readonly Rect[],
  skip: ReadonlySet<Axis> = new Set(),
): { lines: SnapLine[]; markers: Point[] } {
  const lines: SnapLine[] = []
  const markers: Point[] = []
  const seen = new Set<string>()
  const mark = (p: Point) => {
    const k = `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`
    if (seen.has(k)) return
    seen.add(k)
    markers.push(p)
  }
  for (const axis of ["x", "y"] as const) {
    if (skip.has(axis)) continue
    const g = A[axis]
    const lo = axis === "x" ? q.edges.left : q.edges.top
    const hi = axis === "x" ? q.edges.right : q.edges.bottom
    const moving: number[] = []
    if (lo && hi) moving.push(...lines3(g.p(r), g.s(r)))
    else if (lo) moving.push(g.p(r))
    else if (hi) moving.push(g.p(r) + g.s(r))
    const done = new Set<number>()
    for (const v of moving) {
      const hits = boxes.filter((b) => lines3(g.p(b), g.s(b)).some((c) => near(c, v)))
      if (!hits.length) continue
      const key = Math.round(v * 1000)
      if (done.has(key)) continue
      done.add(key)
      const all = [r, ...hits]
      const from = Math.min(...all.map((b) => g.cp(b)))
      const to = Math.max(...all.map((b) => g.cp(b) + g.cs(b)))
      lines.push({ axis, at: v, from, to })
      for (const b of all) {
        const a0 = g.cp(b)
        const a1 = g.cp(b) + g.cs(b)
        if (axis === "x") {
          mark({ x: v, y: a0 })
          mark({ x: v, y: a1 })
        } else {
          mark({ x: a0, y: v })
          mark({ x: a1, y: v })
        }
      }
    }
  }
  return { lines, markers }
}

/** Snaps a moving/resizing box (see module doc). */
export function snap(q: SnapQuery): SnapResult {
  if (q.disabled || !q.candidates.length || !(q.zoom > 0)) return EMPTY
  const thr = (q.thresholdPx ?? SNAP_THRESHOLD_PX) / q.zoom
  const boxes = q.candidates.map((c) => c.rect)
  const sibs = q.candidates.filter((c) => c.id !== q.parent?.id).map((c) => c.rect)
  const x = snapAxis("x", q, thr, sibs, boxes)
  const y = snapAxis("y", q, thr, sibs, boxes)
  const r = shifted(q, x.delta, y.delta)
  // Board 10 #2 (V6rSVv): while an equal-spacing slot applies, only the gaps, ticks and pills
  // are drawn. No guides on the spacing axis (its position came from the slot), and none on
  // the cross axis unless that axis snapped to a line itself (#1 O68JG1 draws guides only
  // for the axis that snapped). Boxes that merely stay aligned show nothing extra.
  const skip = new Set<Axis>()
  if (x.slot) {
    skip.add("x")
    if (Math.abs(y.delta) <= 1e-9) skip.add("y")
  }
  if (y.slot) {
    skip.add("y")
    if (Math.abs(x.delta) <= 1e-9) skip.add("x")
  }
  const g = guides(q, r, boxes, skip)
  // Recompute spacing on the final box so both axes' indicators match what is drawn.
  return {
    dx: x.delta,
    dy: y.delta,
    snap: { lines: g.lines, markers: g.markers },
    spacing: [...x.spacing.map((s) => ({ ...s })), ...y.spacing.map((s) => ({ ...s }))],
  }
}

/** Snaps one point (pen anchors, draw corners): a zero-size box moving on both axes. */
export function snapPoint(
  p: Point,
  candidates: readonly SnapBox[],
  parent: SnapBox | null,
  zoom: number,
  disabled = false,
  thresholdPx?: number,
): SnapResult {
  const q: SnapQuery = {
    moving: { x: p.x, y: p.y, w: 0, h: 0 },
    edges: { left: true, right: true, top: true, bottom: true },
    candidates,
    parent,
    zoom,
    disabled,
  }
  if (thresholdPx !== undefined) q.thresholdPx = thresholdPx
  const r = snap(q)
  // A point has no spacing slot of its own.
  return { ...r, spacing: [] }
}

/** {@link CollectSnapCandidates}: siblings of the first selected node + its parent box. */
export const collectSnapCandidates: CollectSnapCandidates = (
  layout,
  selection,
  parentOf,
  childrenOf,
) => {
  const first = selection[0]
  if (first === undefined) return { candidates: [], parent: null }
  const parentId = parentOf(first)
  return candidatesIn(layout, parentId, selection, childrenOf)
}

/** Candidates inside a given parent (pen / draw tools: the drop parent). */
export function candidatesIn(
  layout: LayoutResult,
  parentId: string | null,
  exclude: readonly string[],
  childrenOf: (id: string | null) => readonly string[],
): { candidates: SnapBox[]; parent: SnapBox | null } {
  const skip = new Set(exclude)
  const candidates: SnapBox[] = []
  for (const id of childrenOf(parentId)) {
    if (skip.has(id)) continue
    const l = layout.nodes.get(id)
    if (l?.visible) candidates.push({ id, rect: l.world })
  }
  let parent: SnapBox | null = null
  if (parentId) {
    const l = layout.nodes.get(parentId)
    if (l?.visible) {
      parent = { id: parentId, rect: l.world }
      candidates.push(parent)
    }
  }
  return { candidates, parent }
}
