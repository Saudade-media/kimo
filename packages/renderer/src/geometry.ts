/**
 * Pure geometry helpers shared by the painter and the hit tester (no CanvasKit).
 */
import type { LayoutNodeData, Matrix, Resolver } from "@kimo/layout"
import type { Point, Rect } from "./types"

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

/** Inverse of an affine matrix, or null when singular. */
export function invert(m: Matrix): Matrix | null {
  const det = m[0] * m[3] - m[1] * m[2]
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null
  const a = m[3] / det
  const b = -m[1] / det
  const c = -m[2] / det
  const d = m[0] / det
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])]
}

export function apply(m: Matrix, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] }
}

/** CanvasKit 3×3 row-major form. */
export function toCk(m: Matrix): number[] {
  return [m[0], m[2], m[4], m[1], m[3], m[5], 0, 0, 1]
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

export function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  )
}

export function intersection(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const r = Math.min(a.x + a.w, b.x + b.w)
  const btm = Math.min(a.y + a.h, b.y + b.h)
  return r > x && btm > y ? { x, y, w: r - x, h: btm - y } : null
}

export function union(a: Rect | null, b: Rect): Rect {
  if (!a) return { ...b }
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined

/** Resolves a Num (literal or binding) to a finite number, or `fallback`. */
export function resolveNum(
  resolve: Resolver,
  nodeId: string,
  value: unknown,
  fallback: number,
): number {
  if (value === undefined) return fallback
  return num(resolve.value(nodeId, value)) ?? fallback
}

/** Corner radii `[tl, tr, br, bl]`, clamped so opposite corners fit the box (CSS rule). */
export function resolveRadii(
  resolve: Resolver,
  nodeId: string,
  node: LayoutNodeData,
  w: number,
  h: number,
): [number, number, number, number] {
  const r = node.radius
  let radii: [number, number, number, number]
  if (Array.isArray(r) && r.length === 4) {
    const v = r.map((x) => Math.max(0, resolveNum(resolve, nodeId, x, 0)))
    radii = [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, v[3] ?? 0]
  } else {
    const v = Math.max(0, resolveNum(resolve, nodeId, r, 0))
    radii = [v, v, v, v]
  }
  // Scale all radii down uniformly when adjacent radii exceed a side (CSS backgrounds §5.5).
  const f = Math.min(
    1,
    w / (radii[0] + radii[1] || Number.POSITIVE_INFINITY),
    w / (radii[3] + radii[2] || Number.POSITIVE_INFINITY),
    h / (radii[0] + radii[3] || Number.POSITIVE_INFINITY),
    h / (radii[1] + radii[2] || Number.POSITIVE_INFINITY),
  )
  return f < 1 ? (radii.map((x) => x * f) as [number, number, number, number]) : radii
}

/** True when the local point lies in the rounded rectangle `[0, 0, w, h]`. */
export function inRoundedRect(
  p: Point,
  w: number,
  h: number,
  radii: readonly [number, number, number, number],
  tol = 0,
): boolean {
  if (p.x < -tol || p.y < -tol || p.x > w + tol || p.y > h + tol) return false
  const corners: [number, number, number][] = [
    [radii[0], radii[0], radii[0]],
    [radii[1], w - radii[1], radii[1]],
    [radii[2], w - radii[2], h - radii[2]],
    [radii[3], radii[3], h - radii[3]],
  ]
  for (let i = 0; i < 4; i++) {
    const [r, cx, cy] = corners[i] as [number, number, number]
    if (r <= 0) continue
    const inCornerX = i === 0 || i === 3 ? p.x < cx : p.x > cx
    const inCornerY = i === 0 || i === 1 ? p.y < cy : p.y > cy
    if (inCornerX && inCornerY && Math.hypot(p.x - cx, p.y - cy) > r + tol) return false
  }
  return true
}

/** True when the local point lies in the ellipse/arc/ring inscribed in `[0, 0, w, h]`. */
export function inEllipse(
  p: Point,
  w: number,
  h: number,
  innerRadius = 0,
  startAngle = 0,
  sweepAngle = 360,
  tol = 0,
): boolean {
  const rx = w / 2 + tol
  const ry = h / 2 + tol
  if (rx <= 0 || ry <= 0) return false
  const dx = (p.x - w / 2) / rx
  const dy = (p.y - h / 2) / ry
  const d = Math.hypot(dx, dy)
  if (d > 1) return false
  if (innerRadius > 0 && d < innerRadius * (w / 2 / rx)) return false
  if (Math.abs(sweepAngle) >= 360) return true
  // Angle CCW from +x with y up (spec: degrees CCW from the positive x axis).
  let a = (Math.atan2(-dy, dx) * 180) / Math.PI
  const s = sweepAngle >= 0 ? startAngle : startAngle + sweepAngle
  a = (((a - s) % 360) + 360) % 360
  return a <= Math.abs(sweepAngle)
}
