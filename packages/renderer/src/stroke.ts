/**
 * Stroke geometry (spec §7.2; ADR 0010): stroke paint setup (width, cap, join, miter limit,
 * dash) and the per-side segments of a rounded rectangle.
 *
 * Per-side widths draw each side as its own open segment along its centerline (inside:
 * inset by half its width; center: on the edge; outside: outset by half). A sharp corner
 * where the neighbor side is non-zero extends the segment over the neighbor's band, so
 * the two bands meet ("joined"); with a zero neighbor the segment stops at the corner. A
 * rounded corner gives each adjacent side half of the corner arc (to 45°), on the arc of
 * radius `R − inset`.
 */
import type { CanvasKit, Paint, Path, PathEffect } from "canvaskit-wasm"

export type StrokeAlign = "inside" | "center" | "outside"
export type Sides = [number, number, number, number] // t r b l
export type Radii = [number, number, number, number] // tl tr br bl

export interface StrokeStyle {
  cap: "butt" | "round" | "square"
  join: "miter" | "bevel" | "round"
  miterLimit: number
  /** Normalized dash list (even length, > 0 total), or null = solid. */
  dash: number[] | null
}

/** `dash` as written → an even-length SVG dasharray, or null for solid (spec §7.2). */
export function normalizeDash(dash: unknown): number[] | null {
  if (!Array.isArray(dash)) return null
  const d = dash.filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0)
  if (d.length === 0 || d.length !== dash.length) return null
  if (d.reduce((a, b) => a + b, 0) <= 0) return null
  return d.length % 2 ? [...d, ...d] : d
}

/** How far a side's band reaches outside the edge, as a fraction of its width. */
export const outerFraction = (align: StrokeAlign): number =>
  align === "inside" ? 0 : align === "center" ? 0.5 : 1

const SIDE = [
  // [direction, inward normal, base angle (deg, y-down clockwise)]
  { d: [1, 0], n: [0, 1], a: 270 },
  { d: [0, 1], n: [-1, 0], a: 0 },
  { d: [-1, 0], n: [0, -1], a: 90 },
  { d: [0, -1], n: [1, 0], a: 180 },
] as const

export class StrokeGeometry {
  constructor(private readonly ck: CanvasKit) {}

  /** Configures `p` as a stroke paint of `width` with `style`. Caller owns `effect`. */
  configure(p: Paint, width: number, style: StrokeStyle, effect: PathEffect | null): void {
    const ck = this.ck
    p.setStyle(ck.PaintStyle.Stroke)
    p.setStrokeWidth(width)
    p.setStrokeCap(
      style.cap === "round"
        ? ck.StrokeCap.Round
        : style.cap === "square"
          ? ck.StrokeCap.Square
          : ck.StrokeCap.Butt,
    )
    p.setStrokeJoin(
      style.join === "round"
        ? ck.StrokeJoin.Round
        : style.join === "bevel"
          ? ck.StrokeJoin.Bevel
          : ck.StrokeJoin.Miter,
    )
    p.setStrokeMiter(Math.max(1, style.miterLimit))
    if (effect) p.setPathEffect(effect)
  }

  dashEffect(style: StrokeStyle): PathEffect | null {
    return style.dash ? this.ck.PathEffect.MakeDash(style.dash, 0) : null
  }

  /**
   * One open centerline segment per non-zero side of the rounded rect `[0, 0, w, h]`, with
   * the width to stroke it at. Caller deletes the paths.
   */
  sideSegments(
    w: number,
    h: number,
    radii: Radii,
    sides: Sides,
    align: StrokeAlign,
  ): { path: Path; width: number }[] {
    const ck = this.ck
    const fo = outerFraction(align)
    const corners: [number, number][] = [
      [radii[0], radii[0]],
      [w - radii[1], radii[1]],
      [w - radii[2], h - radii[2]],
      [radii[3], h - radii[3]],
    ]
    const edge: [number, number][] = [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ]
    const out: { path: Path; width: number }[] = []
    for (let i = 0; i < 4; i++) {
      const sw = sides[i] as number
      if (!(sw > 0)) continue
      const s = SIDE[i] as (typeof SIDE)[number]
      const inset = sw * (0.5 - fo)
      const a = i
      const b = (i + 1) % 4
      const prevW = sides[(i + 3) % 4] as number
      const nextW = sides[b] as number
      const pb = new ck.PathBuilder()
      const ra = (radii[a] as number) - inset
      const rb = (radii[b] as number) - inset
      const deg = (x: number) => (x * Math.PI) / 180
      // Start.
      if ((radii[a] as number) > 0 && ra > 0) {
        const [cx, cy] = corners[a] as [number, number]
        const oval = ck.LTRBRect(cx - ra, cy - ra, cx + ra, cy + ra)
        const t0 = s.a - 45
        pb.moveTo(cx + ra * Math.cos(deg(t0)), cy + ra * Math.sin(deg(t0)))
        pb.arcToOval(oval, t0, 45, false)
      } else {
        const [ex, ey] = edge[a] as [number, number]
        const ext = prevW > 0 ? prevW * fo : 0
        pb.moveTo(ex + s.n[0] * inset - s.d[0] * ext, ey + s.n[1] * inset - s.d[1] * ext)
      }
      // Straight part + end.
      if ((radii[b] as number) > 0 && rb > 0) {
        const [cx, cy] = corners[b] as [number, number]
        pb.lineTo(cx + rb * Math.cos(deg(s.a)), cy + rb * Math.sin(deg(s.a)))
        pb.arcToOval(ck.LTRBRect(cx - rb, cy - rb, cx + rb, cy + rb), s.a, 45, false)
      } else {
        const [ex, ey] = edge[b] as [number, number]
        const ext = nextW > 0 ? nextW * fo : 0
        pb.lineTo(ex + s.n[0] * inset + s.d[0] * ext, ey + s.n[1] * inset + s.d[1] * ext)
      }
      out.push({ path: pb.detachAndDelete(), width: sw })
    }
    return out
  }

  /** True when every contour of `path` is closed (inside/outside need a closed shape). */
  isClosed(path: Path): boolean {
    const it = new this.ck.ContourMeasureIter(path, false, 1)
    let closed = true
    let any = false
    for (let c = it.next(); c; c = it.next()) {
      any = true
      if (!c.isClosed()) closed = false
      c.delete()
      if (!closed) break
    }
    it.delete()
    return any && closed
  }

  /**
   * `path` grown (d > 0) or shrunk (d < 0) by `|d|` (Minkowski sum/difference with a disk:
   * shadow spread, Material weight approximation). Returns a new path; caller deletes.
   */
  offset(path: Path, d: number, join: "round" | "miter" = "round"): Path {
    const ck = this.ck
    if (d === 0) return path.copy()
    const ring = path.makeStroked({
      width: Math.abs(d) * 2,
      join: join === "round" ? ck.StrokeJoin.Round : ck.StrokeJoin.Miter,
      // Butt: zero-length contours (Material's trailing "m320-353Z") must not become dots.
      cap: ck.StrokeCap.Butt,
      miter_limit: 4,
    })
    if (!ring) return path.copy()
    const r = ck.Path.MakeFromOp(path, ring, d > 0 ? ck.PathOp.Union : ck.PathOp.Difference)
    ring.delete()
    return r ?? path.copy()
  }
}
