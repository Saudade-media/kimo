/**
 * pen.dev-compatible `mesh` paints (spec §7.1, §20 row 33): a `cols × rows` grid of vertices,
 * row-major, in the normalized node box. Each cell is a Coons patch bounded by cubic Béziers
 * whose handles are the vertex's `left/right/top/bottomHandle` offsets (normalized, relative to
 * the vertex) or, when omitted, smooth Catmull-Rom handles along the grid line. Colors blend
 * the patch corners with smoothstep weights, in sRGB. Pure math: the paint factory draws the
 * triangles with CanvasKit.
 */
import type { RGBA } from "./color"

type Vec = [number, number]

/** A grid vertex: position and its four Bézier handles (offsets from the position). */
export interface MeshVertex {
  p: Vec
  left: Vec
  right: Vec
  top: Vec
  bottom: Vec
}

const vec = (v: unknown): Vec | null =>
  Array.isArray(v) &&
  v.length >= 2 &&
  typeof v[0] === "number" &&
  typeof v[1] === "number" &&
  Number.isFinite(v[0]) &&
  Number.isFinite(v[1])
    ? [v[0], v[1]]
    : null

/**
 * The vertices of a `cols × rows` mesh from its `points` (`[x, y]` or `{ position, leftHandle?,
 * rightHandle?, topHandle?, bottomHandle? }`). A missing or malformed position falls back to the
 * regular grid; a missing handle mirrors its opposite one when that is given, else is automatic.
 */
export function meshVertices(cols: number, rows: number, points: readonly unknown[]): MeshVertex[] {
  const at = (i: number): { p: Vec; h: Record<string, Vec | null> } => {
    const c = i % cols
    const r = Math.floor(i / cols)
    const grid: Vec = [cols > 1 ? c / (cols - 1) : 0.5, rows > 1 ? r / (rows - 1) : 0.5]
    const raw = points[i]
    const direct = vec(raw)
    if (direct) return { p: direct, h: {} }
    if (raw && typeof raw === "object") {
      const o = raw as Record<string, unknown>
      return {
        p: vec(o.position) ?? grid,
        h: {
          left: vec(o.leftHandle),
          right: vec(o.rightHandle),
          top: vec(o.topHandle),
          bottom: vec(o.bottomHandle),
        },
      }
    }
    return { p: grid, h: {} }
  }
  const raw = Array.from({ length: cols * rows }, (_, i) => at(i))
  const P = (r: number, c: number) => (raw[r * cols + c] as { p: Vec }).p
  const sub = (a: Vec, b: Vec, k: number): Vec => [(a[0] - b[0]) * k, (a[1] - b[1]) * k]
  const neg = (a: Vec): Vec => [-a[0], -a[1]]
  /** Automatic handles toward the previous / next vertex on a grid line (Catmull-Rom / 3). */
  const auto = (prev: Vec | null, cur: Vec, next: Vec | null): [Vec, Vec] => {
    if (prev && next) {
      const t = sub(next, prev, 1 / 6)
      return [neg(t), t]
    }
    if (next) {
      const t = sub(next, cur, 1 / 3)
      return [neg(t), t]
    }
    if (prev) {
      const t = sub(cur, prev, 1 / 3)
      return [neg(t), t]
    }
    return [
      [0, 0],
      [0, 0],
    ]
  }
  const pair = (a: Vec | null | undefined, b: Vec | null | undefined, fallback: [Vec, Vec]) =>
    [a ?? (b ? neg(b) : fallback[0]), b ?? (a ? neg(a) : fallback[1])] as [Vec, Vec]
  return raw.map(({ p, h }, i) => {
    const c = i % cols
    const r = Math.floor(i / cols)
    const [left, right] = pair(
      h.left,
      h.right,
      auto(c > 0 ? P(r, c - 1) : null, p, c < cols - 1 ? P(r, c + 1) : null),
    )
    const [top, bottom] = pair(
      h.top,
      h.bottom,
      auto(r > 0 ? P(r - 1, c) : null, p, r < rows - 1 ? P(r + 1, c) : null),
    )
    return { p, left, right, top, bottom }
  })
}

const bezier = (a: Vec, b: Vec, c: Vec, d: Vec, t: number): Vec => {
  const s = 1 - t
  const k0 = s * s * s
  const k1 = 3 * s * s * t
  const k2 = 3 * s * t * t
  const k3 = t * t * t
  return [
    k0 * a[0] + k1 * b[0] + k2 * c[0] + k3 * d[0],
    k0 * a[1] + k1 * b[1] + k2 * c[1] + k3 * d[1],
  ]
}
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1]]

/**
 * Color at grid coordinates (`u ∈ [0, cols−1]`, `v ∈ [0, rows−1]`): the patch's four corner
 * colors blended with smoothstep weights (a cubic Hermite with zero tangents at the vertices),
 * in sRGB. Fitted to pen.dev's `mesh_gradient` output (mean error ≈ 1.5/255 on a regular grid).
 */
export function meshColorAt(
  cols: number,
  rows: number,
  colors: readonly RGBA[],
  u: number,
  v: number,
): RGBA {
  const c = Math.max(0, Math.min(cols - 2, Math.floor(u)))
  const r = Math.max(0, Math.min(rows - 2, Math.floor(v)))
  const smooth = (t: number) => {
    const x = Math.max(0, Math.min(1, t))
    return x * x * (3 - 2 * x)
  }
  const su = cols > 1 ? smooth(u - c) : 0
  const sv = rows > 1 ? smooth(v - r) : 0
  const at = (rr: number, cc: number) =>
    colors[Math.min(rr, rows - 1) * cols + Math.min(cc, cols - 1)] as RGBA
  const c00 = at(r, c)
  const c10 = at(r, c + 1)
  const c01 = at(r + 1, c)
  const c11 = at(r + 1, c + 1)
  const out: number[] = [0, 0, 0, 0]
  for (let ch = 0; ch < 4; ch++)
    out[ch] =
      (1 - su) * (1 - sv) * (c00[ch] as number) +
      su * (1 - sv) * (c10[ch] as number) +
      (1 - su) * sv * (c01[ch] as number) +
      su * sv * (c11[ch] as number)
  return out as unknown as RGBA
}

export interface MeshTriangles {
  /** x, y per vertex, normalized to the node box. */
  positions: Float32Array
  /** r, g, b, a per vertex (unpremultiplied sRGB 0..1). */
  colors: Float32Array
  indices: Uint16Array
}

/**
 * Tessellates a mesh into triangles: up to `maxSub × maxSub` quads per Coons patch. A single row or column
 * is stretched over the whole box (one patch between two copies of it).
 */
export function tessellateMesh(
  cols: number,
  rows: number,
  points: readonly unknown[],
  colors: readonly RGBA[],
  maxSub = 12,
): MeshTriangles {
  let C = cols
  let R = rows
  let pts: readonly unknown[] = points
  let cs: readonly RGBA[] = colors
  if (C === 1 || R === 1) {
    // Degenerate grid: duplicate the line across the box (each copy on an opposite edge).
    const P2: unknown[] = []
    const C2: RGBA[] = []
    const C1 = C === 1 ? 2 : C
    const R1 = R === 1 ? 2 : R
    for (let r = 0; r < R1; r++)
      for (let c = 0; c < C1; c++) {
        const i = Math.min(r, R - 1) * C + Math.min(c, C - 1)
        P2.push([C1 > 1 ? c / (C1 - 1) : 0, R1 > 1 ? r / (R1 - 1) : 0])
        C2.push(colors[i] as RGBA)
      }
    C = C1
    R = R1
    pts = P2
    cs = C2
  }
  const V = meshVertices(C, R, pts)
  const at = (r: number, c: number) => V[r * C + c] as MeshVertex
  const patches = (C - 1) * (R - 1)
  // Skia vertices index with 16 bits: big grids get fewer subdivisions per patch.
  const sub = Math.max(1, Math.min(maxSub, Math.floor(Math.sqrt(65535 / patches)) - 1))
  const n = sub + 1
  const count = patches * n * n
  const positions = new Float32Array(count * 2)
  const vcolors = new Float32Array(count * 4)
  const indices = new Uint16Array(patches * sub * sub * 6)
  let vi = 0
  let ii = 0
  for (let r = 0; r < R - 1; r++)
    for (let c = 0; c < C - 1; c++) {
      const p00 = at(r, c)
      const p10 = at(r, c + 1)
      const p01 = at(r + 1, c)
      const p11 = at(r + 1, c + 1)
      const base = vi
      for (let j = 0; j <= sub; j++) {
        const v = j / sub
        const left = bezier(p00.p, add(p00.p, p00.bottom), add(p01.p, p01.top), p01.p, v)
        const right = bezier(p10.p, add(p10.p, p10.bottom), add(p11.p, p11.top), p11.p, v)
        for (let i = 0; i <= sub; i++) {
          const u = i / sub
          const top = bezier(p00.p, add(p00.p, p00.right), add(p10.p, p10.left), p10.p, u)
          const bottom = bezier(p01.p, add(p01.p, p01.right), add(p11.p, p11.left), p11.p, u)
          // Coons patch: ruled surfaces in u and v minus the bilinear corner surface.
          for (let k = 0; k < 2; k++) {
            const bil =
              (1 - u) * (1 - v) * (p00.p[k] as number) +
              u * (1 - v) * (p10.p[k] as number) +
              (1 - u) * v * (p01.p[k] as number) +
              u * v * (p11.p[k] as number)
            positions[vi * 2 + k] =
              (1 - v) * (top[k] as number) +
              v * (bottom[k] as number) +
              (1 - u) * (left[k] as number) +
              u * (right[k] as number) -
              bil
          }
          const col = meshColorAt(C, R, cs, c + u, r + v)
          vcolors.set(col, vi * 4)
          vi++
        }
      }
      for (let j = 0; j < sub; j++)
        for (let i = 0; i < sub; i++) {
          const a = base + j * n + i
          indices[ii++] = a
          indices[ii++] = a + 1
          indices[ii++] = a + n
          indices[ii++] = a + 1
          indices[ii++] = a + n + 1
          indices[ii++] = a + n
        }
    }
  return { positions, colors: vcolors, indices }
}
