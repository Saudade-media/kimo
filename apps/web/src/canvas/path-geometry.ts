/**
 * Pure path geometry for the pen tool and path edit mode (board 10 #5/#6, ADR 0010): SVG path
 * data ⇄ editable contours, tight cubic bounds, segment hit testing and splitting, 45°
 * constraints. No DOM; unit-tested in Bun (fast-check).
 *
 * A contour is a list of anchors; segment `i` runs from anchor `i` to anchor `i + 1` (the last
 * one back to anchor 0 when `closed`). Its control points are the start anchor's `out` and the
 * end anchor's `in`; a side without a handle is a sharp corner (the control point coincides
 * with the anchor), so a segment without handles is a straight line.
 */
import type { Rect } from "@kimo/layout"
import type { AnchorRef, PathAnchorPoint, PathContour, Point } from "@kimo/renderer"
import type { PathGeometry } from "./contract"
import { IDENTITY, invert, round2 } from "./math"

type Mat = readonly number[]
/** A cubic segment: start, control 1, control 2, end. */
export type Cubic = readonly [Point, Point, Point, Point]

const EPS = 1e-9
const same = (a: Point, b: Point, eps = 1e-6) =>
  Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps

const apply = (m: Mat, p: Point): Point => ({
  x: (m[0] as number) * p.x + (m[2] as number) * p.y + (m[4] as number),
  y: (m[1] as number) * p.x + (m[3] as number) * p.y + (m[5] as number),
})

// --- Parsing ---------------------------------------------------------------------------------

const ARGS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 }

/** Tokenizes path data; arc flags may be packed without separators (`a1 1 0 011 1`). */
function tokenize(d: string): (string | number)[] | null {
  const out: (string | number)[] = []
  const re = /\s*([MmLlHhVvCcSsQqTtAaZz])|\s*,?\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/y
  let i = 0
  let cmd = ""
  let argIndex = 0
  while (i < d.length) {
    if (/^[\s,]*$/.test(d.slice(i))) break
    // Arc flags (args 3 and 4 of `a`) are single digits that may be packed.
    if (cmd === "a" && (argIndex % 7 === 3 || argIndex % 7 === 4)) {
      const m = /^[\s,]*([01])/.exec(d.slice(i))
      if (m) {
        out.push(Number(m[1]))
        i += m[0].length
        argIndex++
        continue
      }
    }
    re.lastIndex = i
    const m = re.exec(d)
    if (!m) return null
    i = re.lastIndex
    if (m[1]) {
      out.push(m[1])
      cmd = m[1].toLowerCase()
      argIndex = 0
    } else {
      out.push(Number(m[2]))
      argIndex++
    }
  }
  return out
}

/** Arc (endpoint parameterization) → cubic segments (SVG implementation notes F.6). */
function arcToCubics(
  p0: Point,
  rx: number,
  ry: number,
  angle: number,
  large: boolean,
  sweep: boolean,
  p1: Point,
): Cubic[] {
  if (same(p0, p1)) return []
  rx = Math.abs(rx)
  ry = Math.abs(ry)
  if (rx < EPS || ry < EPS) return [[p0, p0, p1, p1]]
  const phi = (angle * Math.PI) / 180
  const cos = Math.cos(phi)
  const sin = Math.sin(phi)
  const dx = (p0.x - p1.x) / 2
  const dy = (p0.y - p1.y) / 2
  const x1 = cos * dx + sin * dy
  const y1 = -sin * dx + cos * dy
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
  if (lambda > 1) {
    rx *= Math.sqrt(lambda)
    ry *= Math.sqrt(lambda)
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1
  let k = Math.sqrt(Math.max(0, num / den))
  if (large === sweep) k = -k
  const cxp = (k * rx * y1) / ry
  const cyp = (-k * ry * x1) / rx
  const cx = cos * cxp - sin * cyp + (p0.x + p1.x) / 2
  const cy = sin * cxp + cos * cyp + (p0.y + p1.y) / 2
  const ang = (ux: number, uy: number, vx: number, vy: number) =>
    Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
  const t1 = ang(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry)
  let dt = ang((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry)
  if (!sweep && dt > 0) dt -= 2 * Math.PI
  if (sweep && dt < 0) dt += 2 * Math.PI
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9))
  const step = dt / n
  const alpha = (4 / 3) * Math.tan(step / 4)
  const at = (t: number) => ({
    x: cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin,
    y: cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos,
  })
  const deriv = (t: number) => ({
    x: -rx * Math.sin(t) * cos - ry * Math.cos(t) * sin,
    y: -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos,
  })
  const out: Cubic[] = []
  let ta = t1
  let pa = p0
  for (let i = 0; i < n; i++) {
    const tb = ta + step
    const pb = i === n - 1 ? p1 : at(tb)
    const da = deriv(ta)
    const db = deriv(tb)
    out.push([
      pa,
      { x: pa.x + alpha * da.x, y: pa.y + alpha * da.y },
      { x: pb.x - alpha * db.x, y: pb.y - alpha * db.y },
      pb,
    ])
    ta = tb
    pa = pb
  }
  return out
}

/**
 * Parses SVG path data (every command, absolute or relative) into contours in the data's own
 * coordinates. Quadratics and arcs become cubics. Returns [] for invalid data.
 */
export function parsePath(d: string): PathContour[] {
  const tokens = tokenize(d)
  if (!tokens) return []
  const contours: { anchors: PathAnchorPoint[]; closed: boolean }[] = []
  let cur: { anchors: PathAnchorPoint[]; closed: boolean } | null = null
  let pos: Point = { x: 0, y: 0 }
  let start: Point = { x: 0, y: 0 }
  /** Last cubic / quadratic control point (for S / T reflection). */
  let lastC: Point | null = null
  let lastQ: Point | null = null
  let i = 0
  let cmd = ""
  const begin = (p: Point) => {
    cur = { anchors: [{ x: p.x, y: p.y }], closed: false }
    contours.push(cur)
    start = p
  }
  const ensure = () => {
    if (!cur || cur.closed) begin(pos)
    return cur as unknown as { anchors: PathAnchorPoint[]; closed: boolean }
  }
  const cubicTo = (c1: Point, c2: Point, p: Point) => {
    const c = ensure()
    const last = c.anchors[c.anchors.length - 1] as PathAnchorPoint
    if (!same(c1, last)) last.out = { x: c1.x, y: c1.y }
    const a: PathAnchorPoint = { x: p.x, y: p.y }
    if (!same(c2, p)) a.in = { x: c2.x, y: c2.y }
    c.anchors.push(a)
    pos = p
  }
  const lineTo = (p: Point) => {
    const c = ensure()
    c.anchors.push({ x: p.x, y: p.y })
    pos = p
  }
  while (i < tokens.length) {
    const t = tokens[i]
    if (typeof t === "string") {
      cmd = t
      i++
      if (cmd === "z" || cmd === "Z") {
        const c = cur as { anchors: PathAnchorPoint[]; closed: boolean } | null
        if (c && !c.closed) {
          // A final anchor on top of the first one is the same vertex: merge them.
          const first = c.anchors[0] as PathAnchorPoint
          const last = c.anchors[c.anchors.length - 1] as PathAnchorPoint
          if (c.anchors.length > 1 && same(first, last)) {
            if (last.in) first.in = last.in
            c.anchors.pop()
          }
          c.closed = true
        }
        pos = start
        lastC = null
        lastQ = null
      }
      continue
    }
    const lower = cmd.toLowerCase()
    const n = ARGS[lower]
    if (!n) return []
    const a: number[] = []
    for (let k = 0; k < n; k++) {
      const v = tokens[i + k]
      if (typeof v !== "number" || !Number.isFinite(v)) return []
      a.push(v)
    }
    i += n
    const rel = cmd !== cmd.toUpperCase()
    const o = rel ? pos : { x: 0, y: 0 }
    const pt = (k: number): Point => ({ x: (a[k] as number) + o.x, y: (a[k + 1] as number) + o.y })
    let nextC: Point | null = null
    let nextQ: Point | null = null
    switch (lower) {
      case "m": {
        const p = pt(0)
        pos = p
        begin(p)
        // Subsequent pairs are implicit line-tos.
        cmd = rel ? "l" : "L"
        break
      }
      case "l":
        lineTo(pt(0))
        break
      case "h":
        lineTo({ x: (a[0] as number) + (rel ? pos.x : 0), y: pos.y })
        break
      case "v":
        lineTo({ x: pos.x, y: (a[0] as number) + (rel ? pos.y : 0) })
        break
      case "c": {
        const c2 = pt(2)
        cubicTo(pt(0), c2, pt(4))
        nextC = c2
        break
      }
      case "s": {
        const c1 = lastC ? { x: 2 * pos.x - lastC.x, y: 2 * pos.y - lastC.y } : pos
        const c2 = pt(0)
        cubicTo(c1, c2, pt(2))
        nextC = c2
        break
      }
      case "q":
      case "t": {
        const q: Point =
          lower === "q" ? pt(0) : lastQ ? { x: 2 * pos.x - lastQ.x, y: 2 * pos.y - lastQ.y } : pos
        const p = lower === "q" ? pt(2) : pt(0)
        const p0 = pos
        cubicTo(
          { x: p0.x + (2 / 3) * (q.x - p0.x), y: p0.y + (2 / 3) * (q.y - p0.y) },
          { x: p.x + (2 / 3) * (q.x - p.x), y: p.y + (2 / 3) * (q.y - p.y) },
          p,
        )
        nextQ = q
        break
      }
      case "a": {
        const p = pt(5)
        const segs = arcToCubics(
          pos,
          a[0] as number,
          a[1] as number,
          a[2] as number,
          a[3] !== 0,
          a[4] !== 0,
          p,
        )
        for (const s of segs) cubicTo(s[1], s[2], s[3])
        pos = p
        break
      }
    }
    lastC = nextC
    lastQ = nextQ
  }
  return contours
}

// --- Serialization ---------------------------------------------------------------------------

const f = (v: number) => {
  const r = round2(v)
  return String(Object.is(r, -0) ? 0 : r)
}

/** Path data for contours (absolute M/L/C/Z, numbers rounded to 2 decimals), offset by `-o`. */
export function contoursToD(contours: readonly PathContour[], o: Point = { x: 0, y: 0 }): string {
  const parts: string[] = []
  const P = (p: Point) => `${f(p.x - o.x)} ${f(p.y - o.y)}`
  for (const c of contours) {
    const n = c.anchors.length
    if (!n) continue
    parts.push(`M${P(c.anchors[0] as Point)}`)
    const segs = c.closed ? n : n - 1
    for (let i = 0; i < segs; i++) {
      const a = c.anchors[i] as PathAnchorPoint
      const b = c.anchors[(i + 1) % n] as PathAnchorPoint
      const closing = c.closed && i === n - 1
      if (!a.out && !b.in) {
        if (!closing) parts.push(`L${P(b)}`)
      } else parts.push(`C${P(a.out ?? a)} ${P(b.in ?? b)} ${P(b)}`)
    }
    if (c.closed) parts.push("Z")
  }
  return parts.join("")
}

// --- Transforms and bounds -------------------------------------------------------------------

/** Maps every anchor and handle through `m`. */
export function transformContours(contours: readonly PathContour[], m: Mat): PathContour[] {
  return contours.map((c) => ({
    closed: c.closed,
    anchors: c.anchors.map((a) => {
      const p = apply(m, a)
      const out: PathAnchorPoint = { x: p.x, y: p.y }
      if (a.in) out.in = apply(m, a.in)
      if (a.out) out.out = apply(m, a.out)
      return out
    }),
  }))
}

/** Segment `i` of a contour as a cubic (straight segments have controls on the anchors). */
export function segmentOf(c: PathContour, i: number): Cubic {
  const n = c.anchors.length
  const a = c.anchors[i] as PathAnchorPoint
  const b = c.anchors[(i + 1) % n] as PathAnchorPoint
  return [
    { x: a.x, y: a.y },
    a.out ?? { x: a.x, y: a.y },
    b.in ?? { x: b.x, y: b.y },
    { x: b.x, y: b.y },
  ]
}

export const segmentCount = (c: PathContour) =>
  c.anchors.length < 2 ? 0 : c.closed ? c.anchors.length : c.anchors.length - 1

/** Point on a cubic at `t`. */
export function cubicAt(s: Cubic, t: number): Point {
  const u = 1 - t
  const [p0, p1, p2, p3] = s
  const a = u * u * u
  const b = 3 * u * u * t
  const c = 3 * u * t * t
  const d = t * t * t
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  }
}

/** Parameter values in (0, 1) where one coordinate of a cubic has an extremum. */
function extremaT(a: number, b: number, c: number, d: number): number[] {
  // Derivative / 3: (b - a)(1-t)^2 + 2(c - b)(1-t)t + (d - c)t^2 = A t^2 + B t + C.
  const A = -a + 3 * b - 3 * c + d
  const B = 2 * (a - 2 * b + c)
  const C = b - a
  const out: number[] = []
  if (Math.abs(A) < 1e-12) {
    if (Math.abs(B) > 1e-12) out.push(-C / B)
  } else {
    const disc = B * B - 4 * A * C
    if (disc >= 0) {
      const s = Math.sqrt(disc)
      out.push((-B + s) / (2 * A), (-B - s) / (2 * A))
    }
  }
  return out.filter((t) => t > 0 && t < 1)
}

/** Tight bounds of contours (curve extrema, not control points); null when empty. */
export function contoursBounds(contours: readonly PathContour[]): Rect | null {
  let x0 = Number.POSITIVE_INFINITY
  let y0 = Number.POSITIVE_INFINITY
  let x1 = Number.NEGATIVE_INFINITY
  let y1 = Number.NEGATIVE_INFINITY
  const add = (p: Point) => {
    x0 = Math.min(x0, p.x)
    y0 = Math.min(y0, p.y)
    x1 = Math.max(x1, p.x)
    y1 = Math.max(y1, p.y)
  }
  for (const c of contours) {
    for (const a of c.anchors) add(a)
    for (let i = 0; i < segmentCount(c); i++) {
      const s = segmentOf(c, i)
      for (const t of extremaT(s[0].x, s[1].x, s[2].x, s[3].x)) add(cubicAt(s, t))
      for (const t of extremaT(s[0].y, s[1].y, s[2].y, s[3].y)) add(cubicAt(s, t))
    }
  }
  return x0 > x1 ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d)

/** {@link PathGeometry} implementation (contract in `./contract`). */
export const pathGeometry: PathGeometry = {
  fromNode(node, transform) {
    const raw = parsePath(node.d)
    const vb = node.viewBox && node.viewBox.length === 4 ? node.viewBox : null
    const [vx, vy, vw, vh] = vb ?? [0, 0, 0, 0]
    // viewBox → [0, 0, w, h] (same rule as the renderer: a zero extent keeps scale 1).
    const sx = vb && vw ? node.w / num(vw, 1) : 1
    const sy = vb && vh ? node.h / num(vh, 1) : 1
    const toBox: Mat = [sx, 0, 0, sy, -num(vx) * sx, -num(vy) * sy]
    return transformContours(transformContours(raw, toBox), transform)
  },
  toNode(contours, parentTransform) {
    const local = transformContours(contours, invert((parentTransform as never) ?? IDENTITY))
    const b = contoursBounds(local) ?? { x: 0, y: 0, w: 0, h: 0 }
    const x = round2(b.x)
    const y = round2(b.y)
    const w = round2(Math.max(0, b.w))
    const h = round2(Math.max(0, b.h))
    return { x, y, w, h, d: contoursToD(local, { x, y }), viewBox: [0, 0, w, h] }
  },
}

// --- Editing helpers -------------------------------------------------------------------------

/** Constrains `p` to the nearest 45° ray from `from` (shift while drawing). */
export function constrain45(from: Point, p: Point): Point {
  const dx = p.x - from.x
  const dy = p.y - from.y
  const len = Math.hypot(dx, dy)
  if (len < EPS) return { x: from.x, y: from.y }
  const step = Math.PI / 4
  const ang = Math.round(Math.atan2(dy, dx) / step) * step
  // Project onto the ray (keeps the pointer's distance along it).
  const ux = Math.cos(ang)
  const uy = Math.sin(ang)
  const d = dx * ux + dy * uy
  const clean = (v: number) => (Math.abs(v) < 1e-9 ? 0 : v)
  return { x: from.x + clean(ux * d), y: from.y + clean(uy * d) }
}

/** Mirror of `p` through `about` (symmetric handle). */
export const mirror = (about: Point, p: Point): Point => ({
  x: 2 * about.x - p.x,
  y: 2 * about.y - p.y,
})

/** Nearest point of a cubic to `p`: parameter and distance (sampling + local refinement). */
export function nearestOnCubic(s: Cubic, p: Point): { t: number; dist: number; point: Point } {
  const N = 48
  let bestT = 0
  let best = Number.POSITIVE_INFINITY
  for (let i = 0; i <= N; i++) {
    const t = i / N
    const q = cubicAt(s, t)
    const d = Math.hypot(q.x - p.x, q.y - p.y)
    if (d < best) {
      best = d
      bestT = t
    }
  }
  let lo = Math.max(0, bestT - 1 / N)
  let hi = Math.min(1, bestT + 1 / N)
  for (let k = 0; k < 30; k++) {
    const m1 = lo + (hi - lo) / 3
    const m2 = hi - (hi - lo) / 3
    const d1 = Math.hypot(cubicAt(s, m1).x - p.x, cubicAt(s, m1).y - p.y)
    const d2 = Math.hypot(cubicAt(s, m2).x - p.x, cubicAt(s, m2).y - p.y)
    if (d1 < d2) hi = m2
    else lo = m1
  }
  const t = (lo + hi) / 2
  const point = cubicAt(s, t)
  return { t, dist: Math.hypot(point.x - p.x, point.y - p.y), point }
}

const lerp = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
})

/**
 * Inserts an anchor on segment `seg` of contour `ci` at parameter `t` (de Casteljau: the
 * curve's shape is unchanged). Returns new contours and the new anchor's ref.
 */
export function splitSegment(
  contours: readonly PathContour[],
  ci: number,
  seg: number,
  t: number,
): { contours: PathContour[]; anchor: AnchorRef } {
  const c = contours[ci] as PathContour
  const n = c.anchors.length
  const anchors = c.anchors.map((a) => ({ ...a }))
  const a = anchors[seg] as PathAnchorPoint
  const bi = (seg + 1) % n
  const b = anchors[bi] as PathAnchorPoint
  const straight = !a.out && !b.in
  const s = segmentOf(c, seg)
  const p01 = lerp(s[0], s[1], t)
  const p12 = lerp(s[1], s[2], t)
  const p23 = lerp(s[2], s[3], t)
  const p012 = lerp(p01, p12, t)
  const p123 = lerp(p12, p23, t)
  const mid = lerp(p012, p123, t)
  const inserted: PathAnchorPoint = { x: mid.x, y: mid.y }
  if (!straight) {
    if (a.out) a.out = p01
    inserted.in = p012
    inserted.out = p123
    if (b.in) b.in = p23
    // A side that had no handle keeps none (its control point stays on the anchor).
    if (!a.out && !same(p01, a)) a.out = p01
    if (!b.in && !same(p23, b)) b.in = p23
  }
  anchors.splice(seg + 1, 0, inserted)
  const next = contours.map((x, i) => (i === ci ? { closed: c.closed, anchors } : x))
  return { contours: next, anchor: { contour: ci, index: seg + 1 } }
}

/**
 * Removes anchors; a contour left with fewer than two anchors is dropped (a closed one with
 * two stays closed only when it still has curvature, else it opens).
 */
export function removeAnchors(
  contours: readonly PathContour[],
  refs: readonly AnchorRef[],
): PathContour[] {
  const out: PathContour[] = []
  contours.forEach((c, ci) => {
    const drop = new Set(refs.filter((r) => r.contour === ci).map((r) => r.index))
    const anchors = c.anchors.filter((_, i) => !drop.has(i))
    if (anchors.length < 2) return
    out.push({ closed: c.closed && anchors.length > 2, anchors })
  })
  return out
}

/** Moves anchors (with their handles) by `d`. */
export function moveAnchors(
  contours: readonly PathContour[],
  refs: readonly AnchorRef[],
  d: Point,
): PathContour[] {
  const add = (p: Point) => ({ x: p.x + d.x, y: p.y + d.y })
  return contours.map((c, ci) => {
    const sel = new Set(refs.filter((r) => r.contour === ci).map((r) => r.index))
    if (!sel.size) return c
    return {
      closed: c.closed,
      anchors: c.anchors.map((a, i) => {
        if (!sel.has(i)) return a
        const m: PathAnchorPoint = add(a)
        if (a.in) m.in = add(a.in)
        if (a.out) m.out = add(a.out)
        return m
      }),
    }
  })
}

/**
 * Sets one handle of an anchor to `p`. Unless `breakSymmetry` (⌥), the opposite handle
 * mirrors it (same angle, opposite side; it keeps its own length when it had one).
 */
export function setHandle(
  contours: readonly PathContour[],
  ref: AnchorRef,
  side: "in" | "out",
  p: Point,
  breakSymmetry = false,
): PathContour[] {
  return contours.map((c, ci) => {
    if (ci !== ref.contour) return c
    return {
      closed: c.closed,
      anchors: c.anchors.map((a, i) => {
        if (i !== ref.index) return a
        const m: PathAnchorPoint = { ...a, [side]: { x: p.x, y: p.y } }
        if (same(p, a)) m[side] = null
        if (!breakSymmetry) {
          const other = side === "in" ? "out" : "in"
          const o = a[other]
          const len = o ? Math.hypot(o.x - a.x, o.y - a.y) : Math.hypot(p.x - a.x, p.y - a.y)
          const dl = Math.hypot(p.x - a.x, p.y - a.y)
          if (dl > EPS) {
            m[other] = {
              x: a.x - ((p.x - a.x) / dl) * len,
              y: a.y - ((p.y - a.y) / dl) * len,
            }
          }
        }
        if (!m.in) delete m.in
        if (!m.out) delete m.out
        return m
      }),
    }
  })
}
