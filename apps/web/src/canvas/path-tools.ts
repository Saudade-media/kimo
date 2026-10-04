/**
 * Board 27 §5 (c) path-edit toolbar operations (J5Vng, rules g7wdz), pure over world-space
 * contours: anchor kind (Sharp ⇄ Smooth), cut at anchor(s), delete one segment, bend a segment.
 * Board 27 §5 (b) star / polygon canvas handles (ICb89) are here too.
 */
import type { AnchorRef, PathAnchorPoint, PathContour, Point } from "@kimo/renderer"
import { cubicAt, segmentCount, segmentOf } from "./path-geometry"

export type AnchorKind = "sharp" | "smooth"

const EPS = 1e-9
const same = (a: Point, b: Point) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS
const hasHandle = (a: PathAnchorPoint, side: "in" | "out") => {
  const h = a[side]
  return !!h && !same(h, a)
}

/** Sharp = no handles; Smooth = at least one handle. */
export function anchorKindOf(a: PathAnchorPoint): AnchorKind {
  return hasHandle(a, "in") || hasHandle(a, "out") ? "smooth" : "sharp"
}

/** Kind of the selected anchors; null when none is selected or they are mixed (rule J5Vng). */
export function selectedAnchorKind(
  contours: readonly PathContour[],
  refs: readonly AnchorRef[],
): AnchorKind | null {
  let kind: AnchorKind | null = null
  for (const r of refs) {
    const a = contours[r.contour]?.anchors[r.index]
    if (!a) continue
    const k = anchorKindOf(a)
    if (kind && k !== kind) return null
    kind = k
  }
  return kind
}

/**
 * Sets the anchors' kind. Sharp drops both handles; Smooth gives mirrored handles along the
 * neighbours' direction (each one third of the distance to its neighbour, Figma's default).
 */
export function setAnchorKind(
  contours: readonly PathContour[],
  refs: readonly AnchorRef[],
  kind: AnchorKind,
): PathContour[] {
  return contours.map((c, ci) => {
    const sel = new Set(refs.filter((r) => r.contour === ci).map((r) => r.index))
    if (!sel.size) return c
    const n = c.anchors.length
    return {
      closed: c.closed,
      anchors: c.anchors.map((a, i) => {
        if (!sel.has(i)) return a
        if (kind === "sharp") return { x: a.x, y: a.y }
        if (anchorKindOf(a) === "smooth") return a
        const prev = i > 0 || c.closed ? c.anchors[(i - 1 + n) % n] : undefined
        const next = i < n - 1 || c.closed ? c.anchors[(i + 1) % n] : undefined
        const from = prev ?? a
        const to = next ?? a
        const dx = to.x - from.x
        const dy = to.y - from.y
        const len = Math.hypot(dx, dy)
        if (len < EPS) return a
        const ux = dx / len
        const uy = dy / len
        const m: PathAnchorPoint = { x: a.x, y: a.y }
        if (prev) {
          const l = Math.hypot(a.x - prev.x, a.y - prev.y) / 3
          m.in = { x: a.x - ux * l, y: a.y - uy * l }
        }
        if (next) {
          const l = Math.hypot(next.x - a.x, next.y - a.y) / 3
          m.out = { x: a.x + ux * l, y: a.y + uy * l }
        }
        return m
      }),
    }
  })
}

/** Double-click on an anchor toggles its kind. */
export function toggleAnchorKind(contours: readonly PathContour[], ref: AnchorRef): PathContour[] {
  const a = contours[ref.contour]?.anchors[ref.index]
  if (!a) return [...contours]
  return setAnchorKind(contours, [ref], anchorKindOf(a) === "smooth" ? "sharp" : "smooth")
}

/** An open piece: the first anchor drops its `in` handle, the last its `out`. */
function piece(anchors: readonly PathAnchorPoint[]): PathContour {
  const out = anchors.map((a) => ({ ...a }))
  const first = out[0]
  const last = out[out.length - 1]
  if (first) delete first.in
  if (last) delete last.out
  return { closed: false, anchors: out }
}

/** A closed contour opened at anchor `k` (the anchor appears at both ends). */
function openAt(c: PathContour, k: number): PathAnchorPoint[] {
  const n = c.anchors.length
  const out: PathAnchorPoint[] = []
  for (let j = 0; j <= n; j++) out.push({ ...(c.anchors[(k + j) % n] as PathAnchorPoint) })
  return out
}

/** Splits an open anchor list at interior indices (endpoints are not cut points). */
function splitOpen(anchors: readonly PathAnchorPoint[], at: readonly number[]): PathContour[] {
  const cuts = [...new Set(at)].filter((k) => k > 0 && k < anchors.length - 1).sort((a, b) => a - b)
  const out: PathContour[] = []
  let from = 0
  for (const k of cuts) {
    out.push(piece(anchors.slice(from, k + 1)))
    from = k
  }
  out.push(piece(anchors.slice(from)))
  return out
}

/**
 * Scissors (rule g7wdz "Cut"): splits at the selected anchor(s). A closed contour opens at its
 * first cut anchor (one path); an open contour splits at interior anchors into pieces. `keep`
 * stays in the edited node (untouched contours + the first piece of each cut contour); every
 * other piece becomes a new path node (`extra`, in order). Null = nothing to cut.
 */
export function cutAtAnchors(
  contours: readonly PathContour[],
  refs: readonly AnchorRef[],
): { keep: PathContour[]; extra: PathContour[] } | null {
  const keep: PathContour[] = []
  const extra: PathContour[] = []
  let changed = false
  contours.forEach((c, ci) => {
    const at = refs.filter((r) => r.contour === ci).map((r) => r.index)
    const n = c.anchors.length
    if (!at.length || n < 2) {
      keep.push(c)
      return
    }
    let pieces: PathContour[]
    if (c.closed) {
      const k0 = Math.min(...at)
      const opened = openAt(c, k0)
      pieces = splitOpen(
        opened,
        at.map((k) => (k - k0 + n) % n),
      )
    } else pieces = splitOpen(c.anchors, at)
    if (c.closed || pieces.length > 1) changed = true
    const [first, ...rest] = pieces
    if (first) keep.push(first)
    extra.push(...rest)
  })
  return changed ? { keep, extra } : null
}

/**
 * Deletes one segment (rule g7wdz "Delete segment"): a closed contour opens there; an open one
 * splits in two (pieces with fewer than two anchors are dropped). Contours stay in the node.
 */
export function deleteSegment(contours: readonly PathContour[], ref: AnchorRef): PathContour[] {
  const out: PathContour[] = []
  contours.forEach((c, ci) => {
    if (ci !== ref.contour || ref.index >= segmentCount(c)) {
      out.push(c)
      return
    }
    const n = c.anchors.length
    if (c.closed) {
      const anchors: PathAnchorPoint[] = []
      for (let j = 1; j <= n; j++) anchors.push(c.anchors[(ref.index + j) % n] as PathAnchorPoint)
      out.push(piece(anchors))
      return
    }
    const a = c.anchors.slice(0, ref.index + 1)
    const b = c.anchors.slice(ref.index + 1)
    if (a.length >= 2) out.push(piece(a))
    if (b.length >= 2) out.push(piece(b))
  })
  return out
}

/**
 * Bend: moves segment `ref`'s control points so the curve passes through `to` at parameter
 * `t` (both controls shift by the same vector: B(t) moves by 3t(1−t)·v).
 */
export function bendSegment(
  base: readonly PathContour[],
  ref: AnchorRef,
  t: number,
  to: Point,
): PathContour[] {
  const c = base[ref.contour]
  if (!c) return [...base]
  const s = segmentOf(c, ref.index)
  const at = cubicAt(s, t)
  const k = 3 * t * (1 - t)
  if (k < 1e-3) return [...base]
  const v = { x: (to.x - at.x) / k, y: (to.y - at.y) / k }
  const n = c.anchors.length
  const j = (ref.index + 1) % n
  return base.map((x, ci) => {
    if (ci !== ref.contour) return x
    return {
      closed: x.closed,
      anchors: x.anchors.map((a, i) => {
        if (i === ref.index) return { ...a, out: { x: s[1].x + v.x, y: s[1].y + v.y } }
        if (i === j) return { ...a, in: { x: s[2].x + v.x, y: s[2].y + v.y } }
        return a
      }),
    }
  })
}

// --- Board 27 §5 (b): star / polygon handles ------------------------------------------------

/** Star point → radius handle distance at radius 0 (ICb89: top point y 50, handle center 63). */
export const RADIUS_HANDLE_INSET = 13

/** The two star handles in the node's LOCAL box (`w` × `h`): ratio (hollow) and radius (filled). */
export function starHandles(
  w: number,
  h: number,
  ratio: number,
  radius: number,
  zoom: number,
): { ratio: Point; radius: Point } {
  return {
    // On the top axis at the inner radius: the inner vertices' ellipse at the top.
    ratio: { x: w / 2, y: h / 2 - (h / 2) * ratio },
    // On the top point, moved inwards by the inset (screen px) + the corner radius.
    radius: { x: w / 2, y: Math.min(h / 2, RADIUS_HANDLE_INSET / zoom + radius) },
  }
}

/** Ratio from a local pointer: distance above the centre over the outer radius (1–99 %). */
export function ratioFromLocal(h: number, p: Point): number {
  const r = h / 2 > EPS ? (h / 2 - p.y) / (h / 2) : 0.38
  return Math.min(0.99, Math.max(0.01, Math.round(r * 100) / 100))
}

/** Corner radius from a local pointer on the radius handle (≥ 0, whole px). */
export function radiusFromLocal(h: number, p: Point, zoom: number): number {
  return Math.max(0, Math.round(Math.min(h / 2, p.y) - RADIUS_HANDLE_INSET / zoom))
}
