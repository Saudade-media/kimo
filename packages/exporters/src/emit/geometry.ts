/**
 * Shape geometry as SVG path data, in a node's local box `[0, 0, w, h]` — the same geometry
 * the renderer builds with CanvasKit (`draw.ts` arcPath / polygonPath / svgPath / rrect).
 */
import { pathBounds } from "@kimo/layout"
import { fmt } from "../ir/color"
import type { IRShape } from "../ir/types"

const n = (v: number) => fmt(v, 3)

/** Rounded rectangle; radii `[tl, tr, br, bl]` scaled down like CSS when they overlap. */
export function rrectPath(w: number, h: number, radii: readonly number[] | null): string {
  let [tl, tr, br, bl] = (radii ?? [0, 0, 0, 0]).map((r) => Math.max(0, r)) as [
    number,
    number,
    number,
    number,
  ]
  const f = Math.min(
    1,
    w / (tl + tr || 1),
    w / (bl + br || 1),
    h / (tl + bl || 1),
    h / (tr + br || 1),
  )
  if (f < 1) {
    tl *= f
    tr *= f
    br *= f
    bl *= f
  }
  if (tl + tr + br + bl === 0) return `M0 0H${n(w)}V${n(h)}H0Z`
  const arc = (r: number, x: number, y: number) =>
    r > 0 ? `A${n(r)} ${n(r)} 0 0 1 ${n(x)} ${n(y)}` : ""
  return [
    `M${n(tl)} 0`,
    `H${n(w - tr)}`,
    arc(tr, w, tr),
    `V${n(h - br)}`,
    arc(br, w - br, h),
    `H${n(bl)}`,
    arc(bl, 0, h - bl),
    `V${n(tl)}`,
    arc(tl, tl, 0),
    "Z",
  ].join("")
}

/** Ellipse, arc or ring (spec: angles CCW from +x, y up). */
export function ellipsePath(
  w: number,
  h: number,
  inner: number,
  start: number,
  sweep: number,
): { d: string; fillRule: "nonzero" | "evenodd" } {
  const cx = w / 2
  const cy = h / 2
  const rx = w / 2
  const ry = h / 2
  inner = Math.max(0, Math.min(0.9999, inner))
  sweep = Math.max(-360, Math.min(360, sweep))
  const oval = (sx: number, sy: number) =>
    `M${n(cx - sx)} ${n(cy)}A${n(sx)} ${n(sy)} 0 1 0 ${n(cx + sx)} ${n(cy)}A${n(sx)} ${n(sy)} 0 1 0 ${n(cx - sx)} ${n(cy)}Z`
  if (Math.abs(sweep) >= 360) {
    if (inner === 0) return { d: oval(rx, ry), fillRule: "nonzero" }
    return { d: oval(rx, ry) + oval(rx * inner, ry * inner), fillRule: "evenodd" }
  }
  const pt = (a: number, sx: number, sy: number) => {
    const r = (a * Math.PI) / 180
    return [cx + sx * Math.cos(r), cy - sy * Math.sin(r)] as const
  }
  const large = Math.abs(sweep) > 180 ? 1 : 0
  const flag = sweep > 0 ? 0 : 1
  const s0 = pt(start, rx, ry)
  const s1 = pt(start + sweep, rx, ry)
  let d = `M${n(s0[0])} ${n(s0[1])}A${n(rx)} ${n(ry)} 0 ${large} ${flag} ${n(s1[0])} ${n(s1[1])}`
  if (inner > 0) {
    const i1 = pt(start + sweep, rx * inner, ry * inner)
    const i0 = pt(start, rx * inner, ry * inner)
    d += `L${n(i1[0])} ${n(i1[1])}A${n(rx * inner)} ${n(ry * inner)} 0 ${large} ${1 - flag} ${n(i0[0])} ${n(i0[1])}`
  } else d += `L${n(cx)} ${n(cy)}`
  return { d: `${d}Z`, fillRule: "nonzero" }
}

/** Regular polygon inscribed in the box, first vertex up; `radius` rounds every corner. */
export function polygonPath(w: number, h: number, sides: number, radius: number): string {
  const pts: [number, number][] = []
  for (let i = 0; i < sides; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / sides
    pts.push([w / 2 + (w / 2) * Math.cos(a), h / 2 + (h / 2) * Math.sin(a)])
  }
  if (radius <= 0) return `M${pts.map((p) => `${n(p[0])} ${n(p[1])}`).join("L")}Z`
  const at = (i: number) => pts[((i % sides) + sides) % sides] as [number, number]
  const mid = (i: number): [number, number] => {
    const p = at(i)
    const q = at(i + 1)
    return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
  }
  let cur = mid(sides - 1)
  let d = `M${n(cur[0])} ${n(cur[1])}`
  for (let i = 0; i < sides; i++) {
    const v = at(i)
    const m = mid(i)
    // arcToTangent(v, m, r): an arc tangent to cur→v and v→m.
    const u1 = unit(cur[0] - v[0], cur[1] - v[1])
    const u2 = unit(m[0] - v[0], m[1] - v[1])
    const cos = u1[0] * u2[0] + u1[1] * u2[1]
    const theta = Math.acos(Math.max(-1, Math.min(1, cos)))
    const t = radius / Math.tan(theta / 2)
    const t1 = [v[0] + u1[0] * t, v[1] + u1[1] * t]
    const t2 = [v[0] + u2[0] * t, v[1] + u2[1] * t]
    const cross = (v[0] - cur[0]) * (m[1] - v[1]) - (v[1] - cur[1]) * (m[0] - v[0])
    d += `L${n(t1[0] as number)} ${n(t1[1] as number)}A${n(radius)} ${n(radius)} 0 0 ${cross > 0 ? 1 : 0} ${n(t2[0] as number)} ${n(t2[1] as number)}`
    cur = m
  }
  return `${d}Z`
}

function unit(x: number, y: number): [number, number] {
  const l = Math.hypot(x, y) || 1
  return [x / l, y / l]
}

/** A path node's `d` mapped from its viewBox to the box (an SVG transform). */
export function pathTransform(
  viewBox: readonly [number, number, number, number] | null,
  w: number,
  h: number,
): string | null {
  if (!viewBox) return null
  const [vx, vy, vw, vh] = viewBox
  if (!(vw > 0 && vh > 0)) return null
  const sx = w / vw
  const sy = h / vh
  if (sx === 1 && sy === 1 && vx === 0 && vy === 0) return null
  return `matrix(${n(sx)} 0 0 ${n(sy)} ${n(-vx * sx)} ${n(-vy * sy)})`
}

/** Geometry of an IR shape in its box (rects use {@link rrectPath}). */
export function shapePath(
  shape: IRShape,
  w: number,
  h: number,
  radii: readonly number[] | null,
): { d: string; fillRule: "nonzero" | "evenodd"; transform: string | null } {
  switch (shape.kind) {
    case "rect":
      return { d: rrectPath(w, h, radii), fillRule: "nonzero", transform: null }
    case "ellipse": {
      const e = ellipsePath(w, h, shape.innerRadius, shape.startAngle, shape.sweepAngle)
      return { ...e, transform: null }
    }
    case "polygon":
      return {
        d: polygonPath(w, h, shape.sides, shape.cornerRadius),
        fillRule: "nonzero",
        transform: null,
      }
    case "path": {
      // Absent viewBox = the geometry's bounds (renderer svgPath).
      const b = shape.viewBox ? null : pathBounds(shape.d)
      const vb = shape.viewBox ?? (b ? ([b.x, b.y, b.w, b.h] as const) : null)
      return { d: shape.d, fillRule: shape.fillRule, transform: pathTransform(vb, w, h) }
    }
  }
}
