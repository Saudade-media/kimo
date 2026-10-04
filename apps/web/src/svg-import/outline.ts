/**
 * "Outline strokes" for SVG import (board 27 §6 (e) r6nLx, rule P71ftE): each stroke becomes a
 * filled outline path at import, via CanvasKit's stroker (`Path.makeStroked`), so joins, caps and the
 * miter limit match what the renderer draws. Dashes are applied first (SVG semantics: an odd
 * list repeats, `stroke-dashoffset` is the phase), so "Dashes are kept as segments".
 *
 * Pure given a CanvasKit instance: the app passes the renderer's shared instance (same wasm
 * URL, so it is already loaded), tests the headless one.
 */
import type { CanvasKit, CkPath as Path } from "@kimo/renderer"
import type { StrokeOutliner } from "./convert"

/** SVG dash list → even-length on/off intervals; null when it does not dash (none, all 0, bad). */
export function dashIntervals(dash: readonly number[] | undefined): number[] | null {
  if (!dash?.length) return null
  if (dash.some((v) => !Number.isFinite(v) || v < 0)) return null
  const list = dash.length % 2 ? [...dash, ...dash] : [...dash]
  return list.reduce((a, b) => a + b, 0) > 0 ? list : null
}

/** Splits every contour of `src` into dash segments (a new path; `src` is untouched). */
function dashed(ck: CanvasKit, src: Path, intervals: readonly number[], offset: number): Path {
  const out = new ck.PathBuilder()
  const period = intervals.reduce((a, b) => a + b, 0)
  const iter = new ck.ContourMeasureIter(src, false, 1)
  // Bounded work: attacker-controlled dash lists on long paths could explode the segment count.
  let budget = 100_000
  for (let cm = iter.next(); cm; cm = iter.next()) {
    const len = cm.length()
    // Phase into the pattern (offset may be negative or larger than the period).
    let phase = ((offset % period) + period) % period
    let i = 0
    while (phase >= (intervals[i] as number)) {
      phase -= intervals[i] as number
      i = (i + 1) % intervals.length
    }
    let d = -phase
    while (d < len && budget-- > 0) {
      const end = d + (intervals[i] as number)
      if (i % 2 === 0 && end > 0) {
        const seg = cm.getSegment(Math.max(0, d), Math.min(len, end), true)
        out.addPath(seg)
        seg.delete()
      }
      d = end
      i = (i + 1) % intervals.length
    }
    cm.delete()
  }
  iter.delete()
  return out.detachAndDelete()
}

/**
 * A {@link StrokeOutliner} over CanvasKit: `d` (path data) stroked with the SVG stroke
 * parameters, returned as path data in the same coordinate space (null when nothing remains).
 */
export function createStrokeOutliner(ck: CanvasKit): StrokeOutliner {
  const CAP = { butt: ck.StrokeCap.Butt, round: ck.StrokeCap.Round, square: ck.StrokeCap.Square }
  const JOIN = {
    miter: ck.StrokeJoin.Miter,
    round: ck.StrokeJoin.Round,
    bevel: ck.StrokeJoin.Bevel,
  }
  return (d, stroke) => {
    if (!(stroke.width > 0)) return null
    const src = ck.Path.MakeFromSVGString(d)
    if (!src) return null
    const intervals = dashIntervals(stroke.dash)
    const path = intervals ? dashed(ck, src, intervals, stroke.dashOffset ?? 0) : src
    if (path !== src) src.delete()
    let outline: Path | null = null
    try {
      outline = path.makeStroked({
        width: stroke.width,
        cap: CAP[stroke.cap as keyof typeof CAP] ?? ck.StrokeCap.Butt,
        // SVG "miter-clip" / "arcs" fall back to miter (as browsers without support do).
        join: JOIN[stroke.join as keyof typeof JOIN] ?? ck.StrokeJoin.Miter,
        miter_limit: Math.max(1, stroke.miterLimit),
      })
      if (!outline || outline.isEmpty()) return null
      return outline.toSVGString() || null
    } finally {
      outline?.delete()
      path.delete()
    }
  }
}
