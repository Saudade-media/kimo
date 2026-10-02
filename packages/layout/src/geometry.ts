/**
 * Small 2D helpers for the layout engine: affine matrices, transformed bounds, float32 cleanup
 * and SVG path bounds (for `path` nodes without `w`/`h`/`viewBox`).
 */
import type { Matrix, Rect } from "./types"

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

/** `m · n` (apply `n` first, then `m`). */
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

/** Removes trig noise (cos 90° = 6e-17) so axis-aligned rotations stay exact. */
const snap = (v: number): number => (Math.abs(v) < 1e-12 ? 0 : v)

/**
 * The node-local part of a transform: translate(x, y) · rotate(CCW `deg` about the top-left) ·
 * flip about the box center (spec §5.3).
 */
export function localMatrix(
  x: number,
  y: number,
  w: number,
  h: number,
  deg: number,
  flipX: boolean,
  flipY: boolean,
): Matrix {
  let m: Matrix = [1, 0, 0, 1, x, y]
  if (deg !== 0) {
    // y points down, so a visually counter-clockwise rotation is x' = x·cos + y·sin,
    // y' = -x·sin + y·cos.
    const r = (deg * Math.PI) / 180
    const c = snap(Math.cos(r))
    const s = snap(Math.sin(r))
    m = multiply(m, [c, -s, s, c, 0, 0])
  }
  if (flipX || flipY) {
    const sx = flipX ? -1 : 1
    const sy = flipY ? -1 : 1
    m = multiply(m, [sx, 0, 0, sy, flipX ? w : 0, flipY ? h : 0])
  }
  return m
}

/** Axis-aligned bounds of the box `[0, 0, w, h]` under `m`. */
export function transformedBounds(m: Matrix, w: number, h: number): Rect {
  if (m[1] === 0 && m[2] === 0) {
    const x0 = m[4]
    const x1 = m[4] + m[0] * w
    const y0 = m[5]
    const y1 = m[5] + m[3] * h
    return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) }
  }
  const xs = [m[4], m[0] * w + m[4], m[2] * h + m[4], m[0] * w + m[2] * h + m[4]]
  const ys = [m[5], m[1] * w + m[5], m[3] * h + m[5], m[1] * w + m[3] * h + m[5]]
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY }
}

/**
 * Yoga stores layout in float32; this returns the shortest double that rounds to the same
 * float32 (50.29999923706055 → 50.3), so boxes read back the values the document wrote.
 */
export function fromF32(v: number): number {
  if (!Number.isFinite(v)) return 0
  if (Number.isInteger(v)) return v
  return Number(v.toPrecision(7))
}

export const rectEquals = (a: Rect, b: Rect): boolean =>
  a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h

export const matrixEquals = (a: Matrix, b: Matrix): boolean =>
  a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3] && a[4] === b[4] && a[5] === b[5]

// --- SVG path bounds ----------------------------------------------------------------------

const ARGS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 }

/**
 * Bounds of SVG path data from its end and control points (a conservative hull for curves; arcs
 * use their end points). Returns null for unparsable or empty data.
 */
export function pathBounds(d: string): Rect | null {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)
  if (!tokens) return null
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  const add = (x: number, y: number) => {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  let cx = 0
  let cy = 0
  let sx = 0
  let sy = 0
  let cmd = ""
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i] as string
    if (/[a-zA-Z]/.test(t)) {
      cmd = t
      i++
      if (cmd === "z" || cmd === "Z") {
        cx = sx
        cy = sy
      }
      continue
    }
    const lower = cmd.toLowerCase()
    const n = ARGS[lower]
    if (n === undefined || n === 0) return null
    const a: number[] = []
    for (let k = 0; k < n; k++) {
      const v = Number(tokens[i + k])
      if (!Number.isFinite(v)) return null
      a.push(v)
    }
    i += n
    const rel = cmd !== cmd.toUpperCase()
    const ox = rel ? cx : 0
    const oy = rel ? cy : 0
    const p = (k: number) => [(a[k] as number) + ox, (a[k + 1] as number) + oy] as const
    switch (lower) {
      case "h":
        cx = (a[0] as number) + ox
        break
      case "v":
        cy = (a[0] as number) + oy
        break
      case "a":
        ;[cx, cy] = p(5)
        break
      default:
        for (let k = 0; k < n - 2; k += 2) add(...p(k))
        ;[cx, cy] = p(n - 2)
    }
    add(cx, cy)
    if (lower === "m") {
      sx = cx
      sy = cy
      cmd = rel ? "l" : "L" // implicit lineto after a moveto
    }
  }
  if (minX > maxX) return null
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}
