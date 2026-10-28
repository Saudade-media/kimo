/**
 * SVG geometry for import: path data parsing and normalization (absolute M / L / C / Q / Z,
 * arcs as cubics), basic shapes as paths, transform lists as affine matrices, bounds and
 * serialization. Pure; inputs are attacker-controlled, so parsing is bounded and never throws
 * on bad data (it stops at the first error, like browsers).
 */

/** Affine `[a, b, c, d, e, f]`: x' = a x + c y + e, y' = b x + d y + f. */
export type Matrix = [number, number, number, number, number, number]
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

export type Seg =
  | { c: "M"; x: number; y: number }
  | { c: "L"; x: number; y: number }
  | { c: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { c: "Q"; x1: number; y1: number; x: number; y: number }
  | { c: "Z" }

const MAX_PATH_SEGMENTS = 200_000

export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ]
}

const num = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y

/** Parses a `transform` attribute; unknown or malformed parts are ignored. */
export function parseTransform(s: string | undefined): Matrix {
  let m: Matrix = IDENTITY
  if (!s) return m
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g
  for (let t = re.exec(s); t; t = re.exec(s)) {
    const a = (t[2] ?? "")
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number)
    if (a.some((x) => !Number.isFinite(x))) continue
    let n: Matrix = IDENTITY
    switch (t[1]) {
      case "matrix":
        if (a.length === 6) n = a as Matrix
        break
      case "translate":
        n = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0]
        break
      case "scale":
        n = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]
        break
      case "rotate": {
        const r = ((a[0] ?? 0) * Math.PI) / 180
        const cos = Math.cos(r)
        const sin = Math.sin(r)
        const rot: Matrix = [cos, sin, -sin, cos, 0, 0]
        if (a.length >= 3) {
          const cx = a[1] ?? 0
          const cy = a[2] ?? 0
          n = multiply(multiply([1, 0, 0, 1, cx, cy], rot), [1, 0, 0, 1, -cx, -cy])
        } else n = rot
        break
      }
      case "skewX":
        n = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0]
        break
      case "skewY":
        n = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0]
        break
    }
    m = multiply(m, n)
  }
  return m
}

/** Tokenizes path data into commands and numbers (arc flags may be packed: `a1 1 0 01.5.5`). */
function tokens(d: string): (string | number)[] {
  const out: (string | number)[] = []
  let i = 0
  let lastCmd = ""
  let argIndex = 0
  while (i < d.length) {
    const ch = d[i] as string
    if (/[\s,]/.test(ch)) {
      i++
      continue
    }
    if (/[MmLlHhVvCcSsQqTtAaZz]/.test(ch)) {
      out.push(ch)
      lastCmd = ch
      argIndex = 0
      i++
      continue
    }
    // Arc flags (4th and 5th argument of each 7-tuple) are single digits.
    if ((lastCmd === "a" || lastCmd === "A") && (argIndex % 7 === 3 || argIndex % 7 === 4)) {
      if (ch === "0" || ch === "1") {
        out.push(Number(ch))
        argIndex++
        i++
        continue
      }
      return out
    }
    num.lastIndex = i
    const m = num.exec(d)
    if (!m) return out
    out.push(Number(m[0]))
    argIndex++
    i += m[0].length
    if (out.length > MAX_PATH_SEGMENTS * 8) return out
  }
  return out
}

const ARITY: Record<string, number> = {
  M: 2,
  L: 2,
  H: 1,
  V: 1,
  C: 6,
  S: 4,
  Q: 4,
  T: 2,
  A: 7,
  Z: 0,
}

/** Arc (endpoint parameterization) → cubic segments (SVG 1.1 F.6). */
function arcToCubics(
  x1: number,
  y1: number,
  rxIn: number,
  ryIn: number,
  angle: number,
  large: number,
  sweep: number,
  x2: number,
  y2: number,
): Seg[] {
  if (x1 === x2 && y1 === y2) return []
  let rx = Math.abs(rxIn)
  let ry = Math.abs(ryIn)
  if (rx === 0 || ry === 0) return [{ c: "L", x: x2, y: y2 }]
  const phi = (angle * Math.PI) / 180
  const cos = Math.cos(phi)
  const sin = Math.sin(phi)
  const dx = (x1 - x2) / 2
  const dy = (y1 - y2) / 2
  const x1p = cos * dx + sin * dy
  const y1p = -sin * dx + cos * dy
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
  if (lambda > 1) {
    rx *= Math.sqrt(lambda)
    ry *= Math.sqrt(lambda)
  }
  const sign = large === sweep ? -1 : 1
  const num2 = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
  const co = sign * Math.sqrt(Math.max(0, num2 / den))
  const cxp = (co * rx * y1p) / ry
  const cyp = (-co * ry * x1p) / rx
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
    return a
  }
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
  if (!sweep && dt > 0) dt -= 2 * Math.PI
  else if (sweep && dt < 0) dt += 2 * Math.PI
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2)))
  const step = dt / n
  const k = (4 / 3) * Math.tan(step / 4)
  const out: Seg[] = []
  const pt = (t: number) => {
    const ex = rx * Math.cos(t)
    const ey = ry * Math.sin(t)
    return { x: cos * ex - sin * ey + cx, y: sin * ex + cos * ey + cy }
  }
  const dpt = (t: number) => {
    const ex = -rx * Math.sin(t)
    const ey = ry * Math.cos(t)
    return { x: cos * ex - sin * ey, y: sin * ex + cos * ey }
  }
  for (let i = 0; i < n; i++) {
    const a = t1 + i * step
    const b = a + step
    const p0 = pt(a)
    const p3 = i === n - 1 ? { x: x2, y: y2 } : pt(b)
    const d0 = dpt(a)
    const d3 = dpt(b)
    out.push({
      c: "C",
      x1: p0.x + k * d0.x,
      y1: p0.y + k * d0.y,
      x2: p3.x - k * d3.x,
      y2: p3.y - k * d3.y,
      x: p3.x,
      y: p3.y,
    })
  }
  return out
}

/** Parses path data into absolute M / L / C / Q / Z segments. */
export function parsePath(d: string): Seg[] {
  const t = tokens(d)
  const out: Seg[] = []
  let i = 0
  let cmd = ""
  let x = 0
  let y = 0
  let sx = 0
  let sy = 0
  let lastC: { x: number; y: number } | null = null
  let lastQ: { x: number; y: number } | null = null
  while (i < t.length && out.length < MAX_PATH_SEGMENTS) {
    const tok = t[i]
    if (typeof tok === "string") {
      cmd = tok
      i++
      if (cmd === "Z" || cmd === "z") {
        out.push({ c: "Z" })
        x = sx
        y = sy
        lastC = lastQ = null
        continue
      }
    } else if (!cmd || cmd === "Z" || cmd === "z") return out
    const up = cmd.toUpperCase()
    const n = ARITY[up] ?? 0
    const a: number[] = []
    for (let k = 0; k < n; k++) {
      const v = t[i + k]
      if (typeof v !== "number") return out
      a.push(v)
    }
    i += n
    const rel = cmd !== up
    const ox = rel ? x : 0
    const oy = rel ? y : 0
    const v = (k: number) => a[k] as number
    switch (up) {
      case "M":
        x = ox + v(0)
        y = oy + v(1)
        sx = x
        sy = y
        out.push({ c: "M", x, y })
        cmd = rel ? "l" : "L" // implicit lineto after the first pair
        lastC = lastQ = null
        break
      case "L":
        x = ox + v(0)
        y = oy + v(1)
        out.push({ c: "L", x, y })
        lastC = lastQ = null
        break
      case "H":
        x = (rel ? x : 0) + v(0)
        out.push({ c: "L", x, y })
        lastC = lastQ = null
        break
      case "V":
        y = (rel ? y : 0) + v(0)
        out.push({ c: "L", x, y })
        lastC = lastQ = null
        break
      case "C": {
        const s: Seg = {
          c: "C",
          x1: ox + v(0),
          y1: oy + v(1),
          x2: ox + v(2),
          y2: oy + v(3),
          x: ox + v(4),
          y: oy + v(5),
        }
        out.push(s)
        lastC = { x: s.x2, y: s.y2 }
        lastQ = null
        x = s.x
        y = s.y
        break
      }
      case "S": {
        const x1: number = lastC ? 2 * x - lastC.x : x
        const y1: number = lastC ? 2 * y - lastC.y : y
        const s: Seg = { c: "C", x1, y1, x2: ox + v(0), y2: oy + v(1), x: ox + v(2), y: oy + v(3) }
        out.push(s)
        lastC = { x: s.x2, y: s.y2 }
        lastQ = null
        x = s.x
        y = s.y
        break
      }
      case "Q": {
        const s: Seg = { c: "Q", x1: ox + v(0), y1: oy + v(1), x: ox + v(2), y: oy + v(3) }
        out.push(s)
        lastQ = { x: s.x1, y: s.y1 }
        lastC = null
        x = s.x
        y = s.y
        break
      }
      case "T": {
        const x1: number = lastQ ? 2 * x - lastQ.x : x
        const y1: number = lastQ ? 2 * y - lastQ.y : y
        const s: Seg = { c: "Q", x1, y1, x: ox + v(0), y: oy + v(1) }
        out.push(s)
        lastQ = { x: x1, y: y1 }
        lastC = null
        x = s.x
        y = s.y
        break
      }
      case "A": {
        const ex = ox + v(5)
        const ey = oy + v(6)
        out.push(...arcToCubics(x, y, v(0), v(1), v(2), v(3), v(4), ex, ey))
        x = ex
        y = ey
        lastC = lastQ = null
        break
      }
      default:
        return out
    }
  }
  return out
}

const n = (v: string | undefined, d = 0) => {
  const x = Number.parseFloat(v ?? "")
  return Number.isFinite(x) ? x : d
}

/** Basic shapes as segments (SVG 2 shape → path equivalents). Null for empty geometry. */
export function shapeToSegments(name: string, a: Record<string, string>): Seg[] | null {
  switch (name) {
    case "path":
      return a.d ? parsePath(a.d) : null
    case "rect": {
      const x = n(a.x)
      const y = n(a.y)
      const w = n(a.width)
      const h = n(a.height)
      if (w <= 0 || h <= 0) return null
      let rx = a.rx !== undefined ? n(a.rx) : a.ry !== undefined ? n(a.ry) : 0
      let ry = a.ry !== undefined ? n(a.ry) : rx
      rx = Math.min(Math.max(rx, 0), w / 2)
      ry = Math.min(Math.max(ry, 0), h / 2)
      if (!rx || !ry)
        return [
          { c: "M", x, y },
          { c: "L", x: x + w, y },
          { c: "L", x: x + w, y: y + h },
          { c: "L", x, y: y + h },
          { c: "Z" },
        ]
      const d = `M${x + rx},${y}H${x + w - rx}A${rx},${ry} 0 0 1 ${x + w},${y + ry}V${y + h - ry}A${rx},${ry} 0 0 1 ${x + w - rx},${y + h}H${x + rx}A${rx},${ry} 0 0 1 ${x},${y + h - ry}V${y + ry}A${rx},${ry} 0 0 1 ${x + rx},${y}Z`
      return parsePath(d)
    }
    case "circle":
    case "ellipse": {
      const cx = n(a.cx)
      const cy = n(a.cy)
      const rx = name === "circle" ? n(a.r) : n(a.rx)
      const ry = name === "circle" ? n(a.r) : n(a.ry)
      if (rx <= 0 || ry <= 0) return null
      return parsePath(
        `M${cx + rx},${cy}A${rx},${ry} 0 0 1 ${cx},${cy + ry}A${rx},${ry} 0 0 1 ${cx - rx},${cy}A${rx},${ry} 0 0 1 ${cx},${cy - ry}A${rx},${ry} 0 0 1 ${cx + rx},${cy}Z`,
      )
    }
    case "line":
      return [
        { c: "M", x: n(a.x1), y: n(a.y1) },
        { c: "L", x: n(a.x2), y: n(a.y2) },
      ]
    case "polyline":
    case "polygon": {
      const p = (a.points ?? "")
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(Number)
      if (p.length < 4 || p.some((v) => !Number.isFinite(v))) return null
      const out: Seg[] = [{ c: "M", x: p[0] as number, y: p[1] as number }]
      for (let i = 2; i + 1 < p.length; i += 2)
        out.push({ c: "L", x: p[i] as number, y: p[i + 1] as number })
      if (name === "polygon") out.push({ c: "Z" })
      return out
    }
    default:
      return null
  }
}

const ap = (m: Matrix, x: number, y: number) => ({
  x: m[0] * x + m[2] * y + m[4],
  y: m[1] * x + m[3] * y + m[5],
})

/** Applies `m` to every point (affine maps keep Béziers exact). */
export function transformSegments(segs: readonly Seg[], m: Matrix): Seg[] {
  return segs.map((s): Seg => {
    if (s.c === "Z") return s
    if (s.c === "M" || s.c === "L") return { c: s.c, ...ap(m, s.x, s.y) }
    const p = ap(m, s.x, s.y)
    const p1 = ap(m, s.x1, s.y1)
    if (s.c === "Q") return { c: "Q", x1: p1.x, y1: p1.y, x: p.x, y: p.y }
    const p2 = ap(m, s.x2, s.y2)
    return { c: "C", x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, x: p.x, y: p.y }
  })
}

export interface Bounds {
  x: number
  y: number
  w: number
  h: number
}

/** Control-point bounds (a conservative box: contains the curve). */
export function segmentBounds(segs: readonly Seg[]): Bounds | null {
  let x0 = Number.POSITIVE_INFINITY
  let y0 = Number.POSITIVE_INFINITY
  let x1 = Number.NEGATIVE_INFINITY
  let y1 = Number.NEGATIVE_INFINITY
  const add = (x: number, y: number) => {
    if (x < x0) x0 = x
    if (y < y0) y0 = y
    if (x > x1) x1 = x
    if (y > y1) y1 = y
  }
  for (const s of segs) {
    if (s.c === "Z") continue
    add(s.x, s.y)
    if (s.c === "C") {
      add(s.x1, s.y1)
      add(s.x2, s.y2)
    } else if (s.c === "Q") add(s.x1, s.y1)
  }
  if (!Number.isFinite(x0)) return null
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

export function unionBounds(a: Bounds | null, b: Bounds | null): Bounds | null {
  if (!a) return b
  if (!b) return a
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}

const fmt = (v: number) => {
  const r = Math.round(v * 1000) / 1000
  return Object.is(r, -0) ? "0" : String(r)
}

/** Absolute path data, 3 decimals. */
export function serializeSegments(segs: readonly Seg[]): string {
  return segs
    .map((s) => {
      if (s.c === "Z") return "Z"
      if (s.c === "M" || s.c === "L") return `${s.c}${fmt(s.x)} ${fmt(s.y)}`
      if (s.c === "Q") return `Q${fmt(s.x1)} ${fmt(s.y1)} ${fmt(s.x)} ${fmt(s.y)}`
      return `C${fmt(s.x1)} ${fmt(s.y1)} ${fmt(s.x2)} ${fmt(s.y2)} ${fmt(s.x)} ${fmt(s.y)}`
    })
    .join("")
}

/** Uniform scale of a matrix (stroke width scaling). */
export function matrixScale(m: Matrix): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]))
}
