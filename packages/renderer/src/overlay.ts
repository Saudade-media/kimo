/**
 * Editor overlays (ADR 0009 §5, ADR 0010), drawn last in screen space (CSS px): hover
 * outline, selection outline + corner handles + size badge, marquee, guides (M1,
 * `OVERLAY_SPEC`, desing.pen board 03), and the M2 overlays of board 10 (`OVERLAY_SPEC_M2`):
 * snap lines + × markers, equal spacing, ⌥ distances, pixel grid, pen, path edit, resize
 * children, delta badge.
 *
 * Paint order follows board 10's layer order: pixel grid, measuring/snapping marks, resize
 * child outlines + sizing badges + ghost edge, hover, selection (outline, handles, size
 * badge), pen, path edit, cursor badge, marquee. 1px lines are snapped to the device pixel
 * grid so they stay crisp at any zoom and dpr.
 */
import type { LayoutResult, Matrix } from "@kimo/layout"
import type { Canvas, CanvasKit, Paint, Path } from "canvaskit-wasm"
import { parseHex } from "./color"
import { apply, multiply, resolveRadii, toCk, union } from "./geometry"
import type { TextEngine } from "./text"
import {
  type CursorBadge,
  type Measurement,
  type MeasureOutline,
  OVERLAY_SPEC,
  OVERLAY_SPEC_M2,
  type Overlay,
  type OverlayTheme,
  type PathContour,
  type PathEditOverlay,
  type PenOverlay,
  type Point,
  type Rect,
  type RenderScene,
  type ResizeOverlay,
  type SnapLine,
  type SnapOverlay,
  type SpacingIndicator,
  type Viewport,
} from "./types"

/**
 * Defaults copied from `@kimo/design-tokens` (light theme: `selection` #2F6BFF, `on-accent`
 * #FFFFFF, handle fill #FFFFFF, `font-mono` JetBrains Mono). Hosts pass the live theme.
 */
export const DEFAULT_OVERLAY_THEME: OverlayTheme = {
  selection: "#2F6BFF",
  handleFill: "#FFFFFF",
  onSelection: "#FFFFFF",
  monoFamily: "JetBrains Mono",
  measure: "#E5177E",
  measureSoft: "#E5177E1F",
  onAccent: "#FFFFFF",
  selectionSoft: "#2F6BFF1A",
  accentText: "#0A0A0A",
  accent: "#0A0A0A",
}

/** Theme color of an `OVERLAY_SPEC_M2` token name (light fallbacks for M1 hosts). */
function themeColor(theme: OverlayTheme, token: string): string {
  const d = DEFAULT_OVERLAY_THEME
  switch (token) {
    case "measure":
      return theme.measure ?? (d.measure as string)
    case "measure-soft":
      return theme.measureSoft ?? (d.measureSoft as string)
    case "on-accent":
      return theme.onAccent ?? (d.onAccent as string)
    case "selection-soft":
      return theme.selectionSoft ?? (d.selectionSoft as string)
    case "accent-text":
      return theme.accentText ?? (d.accentText as string)
    case "accent":
      return theme.accent ?? (d.accent as string)
    case "selection":
      return theme.selection
    default:
      return token
  }
}

/** Frame-level drawing context (device pixel ratio, canvas size, scene for node shapes). */
export interface OverlayEnv {
  dpr: number
  /** Canvas size in CSS px. */
  width: number
  height: number
  scene?: RenderScene | null
}

/** Marquee fill alpha: `selection-soft` is `selection` at 0x1A (light) in desing.pen. */
const MARQUEE_FILL_ALPHA = 0x1a / 255

export interface OverlayCounters {
  draws: number
}

export class OverlayPainter {
  constructor(
    private readonly ck: CanvasKit,
    private readonly text: TextEngine,
  ) {}

  private color(hex: string, alpha = 1): Float32Array {
    const c = parseHex(hex) ?? [0.184, 0.42, 1, 1]
    return this.ck.Color4f(c[0], c[1], c[2], c[3] * alpha)
  }

  private paint(color: Float32Array, stroke?: number): Paint {
    const p = new this.ck.Paint()
    p.setAntiAlias(true)
    p.setColor(color)
    if (stroke !== undefined) {
      p.setStyle(this.ck.PaintStyle.Stroke)
      p.setStrokeWidth(stroke)
    }
    return p
  }

  /** The four screen-space corners of a node's transformed box (tl, tr, br, bl). */
  quad(layout: LayoutResult, id: string, v: Viewport): Point[] | null {
    const l = layout.nodes.get(id)
    if (!l) return null
    const toScreen = multiply([v.zoom, 0, 0, v.zoom, -v.x * v.zoom, -v.y * v.zoom], l.transform)
    const { w, h } = l.local
    return [
      apply(toScreen, { x: 0, y: 0 }),
      apply(toScreen, { x: w, y: 0 }),
      apply(toScreen, { x: w, y: h }),
      apply(toScreen, { x: 0, y: h }),
    ]
  }

  private rectQuad(r: Rect, v: Viewport): Point[] {
    const x = (r.x - v.x) * v.zoom
    const y = (r.y - v.y) * v.zoom
    const w = r.w * v.zoom
    const h = r.h * v.zoom
    return [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ]
  }

  /** Outline drawn inside the quad edge (Pencil strokes are inside-aligned). */
  private outline(
    canvas: Canvas,
    q: Point[],
    width: number,
    color: Float32Array,
    c: OverlayCounters,
  ): void {
    const ck = this.ck
    const pb = new ck.PathBuilder()
    const axisAligned = Math.abs((q[0] as Point).y - (q[1] as Point).y) < 1e-6
    if (axisAligned) {
      const a = q[0] as Point
      const b = q[2] as Point
      const half = width / 2
      pb.addRect(
        ck.LTRBRect(
          Math.min(a.x, b.x) + half,
          Math.min(a.y, b.y) + half,
          Math.max(a.x, b.x) - half,
          Math.max(a.y, b.y) - half,
        ),
      )
    } else
      pb.addPolygon(
        q.flatMap((p) => [p.x, p.y]),
        true,
      )
    const path = pb.detachAndDelete()
    const p = this.paint(color, width)
    canvas.drawPath(path, p)
    p.delete()
    path.delete()
    c.draws++
  }

  private handle(canvas: Canvas, at: Point, theme: OverlayTheme, c: OverlayCounters): void {
    const ck = this.ck
    const s = OVERLAY_SPEC.handleSize
    const sw = OVERLAY_SPEC.handleStrokeWidth
    const r = OVERLAY_SPEC.handleRadius
    const x = at.x - s / 2
    const y = at.y - s / 2
    const fill = this.paint(this.color(theme.handleFill))
    canvas.drawRRect(ck.RRectXY(ck.LTRBRect(x, y, x + s, y + s), r, r), fill)
    fill.delete()
    const stroke = this.paint(this.color(theme.selection), sw)
    const i = sw / 2
    canvas.drawRRect(
      ck.RRectXY(ck.LTRBRect(x + i, y + i, x + s - i, y + s - i), r - i, r - i),
      stroke,
    )
    stroke.delete()
    c.draws += 2
  }

  private badge(
    canvas: Canvas,
    label: string,
    q: Point[],
    theme: OverlayTheme,
    c: OverlayCounters,
  ): void {
    const ck = this.ck
    const style = {
      fontFamily: theme.monoFamily,
      fontSize: OVERLAY_SPEC.badgeFontSize,
      fontWeight: OVERLAY_SPEC.badgeFontWeight,
      italic: false,
      lineHeight: null,
      letterSpacing: 0,
      align: "left" as const,
      valign: "top" as const,
      decoration: [],
      case: null,
      features: {},
    }
    const para = this.text.paragraph(
      { nodeId: "\u0000overlay-badge", runs: [{ text: label, style }], style },
      { color: this.color(theme.onSelection) },
      undefined,
    )
    const tw = para.getMaxIntrinsicWidth()
    const th = para.getHeight()
    const [py, px] = OVERLAY_SPEC.badgePadding
    const bw = tw + px * 2
    const bh = th + py * 2
    const xs = q.map((p) => p.x)
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2
    const bottom = Math.max(...q.map((p) => p.y))
    const x = Math.round(cx - bw / 2)
    const y = Math.round(bottom + OVERLAY_SPEC.badgeOffset)
    const p = this.paint(this.color(theme.selection))
    canvas.drawRRect(ck.RRectXY(ck.XYWHRect(x, y, bw, bh), bh / 2, bh / 2), p)
    p.delete()
    // Re-lay-out at the measured width (no-wrap layout uses a huge width).
    para.layout(tw + 0.01)
    canvas.drawParagraph(para, x + px, y + py)
    c.draws += 2
  }

  // --- M2 helpers ---------------------------------------------------------------------------

  private env: OverlayEnv = { dpr: 1, width: 0, height: 0 }
  private slot = 0

  /** Center of a `lw`-wide line near CSS coordinate `c` whose edges sit on device pixels. */
  private snap(c: number, lw = 1): number {
    const d = this.env.dpr
    const w = lw * d
    return (Math.round(c * d - w / 2) + w / 2) / d
  }

  /** World → screen (CSS px). */
  private ws(v: Viewport, p: Point): Point {
    return { x: (p.x - v.x) * v.zoom, y: (p.y - v.y) * v.zoom }
  }

  /** A 1px axis-aligned line from `a` to `b` along `axis` at screen coordinate `at`. */
  private hairline(
    canvas: Canvas,
    axis: "x" | "y",
    at: number,
    a: number,
    b: number,
    p: Paint,
    width = 1,
  ): void {
    const c = this.snap(at, width)
    const lo = Math.min(a, b)
    const hi = Math.max(a, b)
    const ck = this.ck
    if (axis === "x") canvas.drawRect(ck.LTRBRect(c - width / 2, lo, c + width / 2, hi), p)
    else canvas.drawRect(ck.LTRBRect(lo, c - width / 2, hi, c + width / 2), p)
  }

  private monoStyle(theme: OverlayTheme) {
    return {
      fontFamily: theme.monoFamily,
      fontSize: OVERLAY_SPEC_M2.pill.fontSize,
      fontWeight: OVERLAY_SPEC_M2.pill.fontWeight,
      italic: false,
      lineHeight: null,
      letterSpacing: 0,
      align: "left" as const,
      valign: "top" as const,
      decoration: [],
      case: null,
      features: {},
    }
  }

  /**
   * A pill label (MeasurePill / SizeBadge / SizingBadge): radius 999, padding [2, 8], mono
   * 11/500, 19 tall. `anchor` = "center" centers it on (x, y); "top-left" places it.
   */
  private pill(
    canvas: Canvas,
    label: string,
    x: number,
    y: number,
    anchor: "center" | "top-left",
    fill: string,
    text: string,
    theme: OverlayTheme,
    c: OverlayCounters,
  ): Rect {
    const ck = this.ck
    const style = this.monoStyle(theme)
    const para = this.text.paragraph(
      { nodeId: `\u0000overlay-pill-${this.slot++}`, runs: [{ text: label, style }], style },
      { color: this.color(text) },
      undefined,
    )
    const tw = para.getMaxIntrinsicWidth()
    const th = para.getHeight()
    const [, px] = OVERLAY_SPEC_M2.pill.padding
    const bw = Math.ceil(tw) + px * 2
    const bh = OVERLAY_SPEC_M2.pill.height
    const bx = Math.round(anchor === "center" ? x - bw / 2 : x)
    const by = Math.round(anchor === "center" ? y - bh / 2 : y)
    const p = this.paint(this.color(fill))
    canvas.drawRRect(ck.RRectXY(ck.XYWHRect(bx, by, bw, bh), bh / 2, bh / 2), p)
    p.delete()
    para.layout(tw + 0.01)
    canvas.drawParagraph(para, bx + (bw - tw) / 2, by + (bh - th) / 2)
    c.draws += 2
    return { x: bx, y: by, w: bw, h: bh }
  }

  private pixelGrid(canvas: Canvas, v: Viewport, alpha: number, c: OverlayCounters): void {
    const ck = this.ck
    const spec = OVERLAY_SPEC_M2.pixelGrid
    const d = this.env.dpr
    const { width, height } = this.env
    const pb = new ck.PathBuilder()
    const lw = 1 / d // one device pixel
    for (let k = Math.ceil(v.x); (k - v.x) * v.zoom <= width; k++) {
      const x = Math.round((k - v.x) * v.zoom * d) / d
      pb.addRect(ck.LTRBRect(x, 0, x + lw, height))
    }
    for (let k = Math.ceil(v.y); (k - v.y) * v.zoom <= height; k++) {
      const y = Math.round((k - v.y) * v.zoom * d) / d
      pb.addRect(ck.LTRBRect(0, y, width, y + lw))
    }
    const path = pb.detachAndDelete()
    const p = this.paint(this.color(spec.color, alpha))
    p.setAntiAlias(false)
    canvas.drawPath(path, p)
    p.delete()
    path.delete()
    c.draws++
  }

  /** Screen-space path of a node's shape (rect/rrect/oval), inset by `inset` CSS px. */
  private nodeShape(layout: LayoutResult, id: string, v: Viewport, inset: number): Path | null {
    const l = layout.nodes.get(id)
    if (!l) return null
    const ck = this.ck
    const scene = this.env.scene
    const node = scene?.nodes.getNode(id)
    const { w, h } = l.local
    const i = inset / v.zoom
    const r = ck.LTRBRect(i, i, Math.max(i, w - i), Math.max(i, h - i))
    const pb = new ck.PathBuilder()
    if (node?.type === "ellipse") pb.addOval(r)
    else {
      const radii =
        scene && node && (node.type === "frame" || node.type === "rect" || node.type === "browser")
          ? resolveRadii(scene.resolve, id, node, w, h).map((x) => Math.max(0, x - i))
          : [0, 0, 0, 0]
      pb.addRRect(
        Float32Array.of(
          r[0] as number,
          r[1] as number,
          r[2] as number,
          r[3] as number,
          ...radii.flatMap((x) => [x, x]),
        ),
      )
    }
    const toScreen: Matrix = multiply(
      [v.zoom, 0, 0, v.zoom, -v.x * v.zoom, -v.y * v.zoom],
      l.transform,
    )
    pb.transform(toCk(toScreen))
    return pb.detachAndDelete()
  }

  private measureOutlines(
    canvas: Canvas,
    list: readonly MeasureOutline[],
    layout: LayoutResult,
    v: Viewport,
    theme: OverlayTheme,
    c: OverlayCounters,
  ): void {
    const spec = OVERLAY_SPEC_M2.measure
    for (const o of list) {
      const path = this.nodeShape(layout, o.id, v, spec.outlineWidth / 2)
      if (!path) continue
      const alpha = o.role === "parent" ? spec.parentOutlineOpacity : 1
      const p = this.paint(this.color(themeColor(theme, "measure"), alpha), spec.outlineWidth)
      canvas.drawPath(path, p)
      p.delete()
      path.delete()
      c.draws++
    }
  }

  private spacing(
    canvas: Canvas,
    list: readonly SpacingIndicator[],
    v: Viewport,
    theme: OverlayTheme,
    c: OverlayCounters,
  ): void {
    const ck = this.ck
    const spec = OVERLAY_SPEC_M2.spacing
    const soft = this.paint(this.color(themeColor(theme, spec.fill)))
    const line = this.paint(this.color(themeColor(theme, spec.color)))
    for (const s of list) {
      const a = this.ws(
        v,
        s.axis === "x" ? { x: s.from, y: s.crossFrom } : { x: s.crossFrom, y: s.from },
      )
      const b = this.ws(v, s.axis === "x" ? { x: s.to, y: s.crossTo } : { x: s.crossTo, y: s.to })
      canvas.drawRect(ck.LTRBRect(a.x, a.y, b.x, b.y), soft)
      const half = spec.tickLength / 2
      if (s.axis === "x") {
        const mid = (a.y + b.y) / 2
        this.hairline(canvas, "y", mid, a.x, b.x, line)
        const cy = this.snap(mid)
        // End ticks sit inside the gap (board 10: x 200 and 247 for a 200…248 gap, y 205…215
        // around the line), on whole pixels.
        const t0 = Math.floor(cy - half)
        canvas.drawRect(ck.LTRBRect(a.x, t0, a.x + spec.tickWidth, t0 + spec.tickLength), line)
        canvas.drawRect(ck.LTRBRect(b.x - spec.tickWidth, t0, b.x, t0 + spec.tickLength), line)
        this.pill(
          canvas,
          s.label,
          (a.x + b.x) / 2,
          cy,
          "center",
          themeColor(theme, "measure"),
          themeColor(theme, "on-accent"),
          theme,
          c,
        )
      } else {
        const mid = (a.x + b.x) / 2
        this.hairline(canvas, "x", mid, a.y, b.y, line)
        const cx = this.snap(mid)
        const t0 = Math.floor(cx - half)
        canvas.drawRect(ck.LTRBRect(t0, a.y, t0 + spec.tickLength, a.y + spec.tickWidth), line)
        canvas.drawRect(ck.LTRBRect(t0, b.y - spec.tickWidth, t0 + spec.tickLength, b.y), line)
        this.pill(
          canvas,
          s.label,
          cx,
          (a.y + b.y) / 2,
          "center",
          themeColor(theme, "measure"),
          themeColor(theme, "on-accent"),
          theme,
          c,
        )
      }
      c.draws += 4
    }
    soft.delete()
    line.delete()
  }

  private snapMarks(
    canvas: Canvas,
    snap: SnapOverlay,
    v: Viewport,
    theme: OverlayTheme,
    c: OverlayCounters,
  ): void {
    const ck = this.ck
    const spec = OVERLAY_SPEC_M2.snap
    const color = this.color(themeColor(theme, spec.color))
    const line = this.paint(color)
    for (const g of snap.lines) this.snapLine(canvas, g, v, line, spec.overhang, c)
    line.delete()
    const m = spec.marker
    const p = this.paint(color, m.strokeWidth)
    p.setStrokeCap(ck.StrokeCap.Round)
    for (const pt of snap.markers) {
      const s = this.ws(v, pt)
      const x = this.snap(s.x, m.size) - m.size / 2
      const y = this.snap(s.y, m.size) - m.size / 2
      // SnapMarker path "M0.5 0.5l6 6m0-6l-6 6".
      canvas.drawLine(x + 0.5, y + 0.5, x + 6.5, y + 6.5, p)
      canvas.drawLine(x + 6.5, y + 0.5, x + 0.5, y + 6.5, p)
      c.draws += 2
    }
    p.delete()
  }

  private snapLine(
    canvas: Canvas,
    g: SnapLine,
    v: Viewport,
    p: Paint,
    overhang: number,
    c: OverlayCounters,
  ): void {
    if (g.axis === "x") {
      const sx = (g.at - v.x) * v.zoom
      const a = (Math.min(g.from, g.to) - v.y) * v.zoom - overhang
      const b = (Math.max(g.from, g.to) - v.y) * v.zoom + overhang
      this.hairline(canvas, "x", sx, a, b, p)
    } else {
      const sy = (g.at - v.y) * v.zoom
      const a = (Math.min(g.from, g.to) - v.x) * v.zoom - overhang
      const b = (Math.max(g.from, g.to) - v.x) * v.zoom + overhang
      this.hairline(canvas, "y", sy, a, b, p)
    }
    c.draws++
  }

  private measurements(
    canvas: Canvas,
    list: readonly Measurement[],
    v: Viewport,
    theme: OverlayTheme,
    c: OverlayCounters,
  ): void {
    const measure = themeColor(theme, "measure")
    const p = this.paint(this.color(measure))
    for (const m of list) {
      if (m.axis === "x") {
        const sy = (m.at - v.y) * v.zoom
        const a = (m.from - v.x) * v.zoom
        const b = (m.to - v.x) * v.zoom
        this.hairline(canvas, "y", sy, a, b, p)
        this.pill(
          canvas,
          m.label,
          (a + b) / 2,
          this.snap(sy),
          "center",
          measure,
          themeColor(theme, "on-accent"),
          theme,
          c,
        )
      } else {
        const sx = (m.at - v.x) * v.zoom
        const a = (m.from - v.y) * v.zoom
        const b = (m.to - v.y) * v.zoom
        this.hairline(canvas, "x", sx, a, b, p)
        this.pill(
          canvas,
          m.label,
          this.snap(sx),
          (a + b) / 2,
          "center",
          measure,
          themeColor(theme, "on-accent"),
          theme,
          c,
        )
      }
      c.draws++
    }
    p.delete()
  }

  private resize(
    canvas: Canvas,
    r: ResizeOverlay,
    layout: LayoutResult | null,
    selection: Point[] | null,
    v: Viewport,
    theme: OverlayTheme,
    c: OverlayCounters,
  ): void {
    const spec = OVERLAY_SPEC_M2.resize
    const sel = theme.selection
    if (layout) {
      const top = selection ? Math.min(...selection.map((p) => p.y)) : null
      for (const ch of r.children) {
        const q = this.quad(layout, ch.id, v)
        if (!q) continue
        this.outline(
          canvas,
          q,
          spec.childOutline.width,
          this.color(sel, spec.childOutline.opacity),
          c,
        )
        if (top === null || !ch.label) continue
        const xs = q.map((p) => p.x)
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2
        const b = spec.sizingBadge
        this.pill(
          canvas,
          ch.label,
          cx,
          top - b.offset - OVERLAY_SPEC_M2.pill.height / 2,
          "center",
          themeColor(theme, b.fill),
          themeColor(theme, b.text),
          theme,
          c,
        )
      }
    }
    if (r.ghostEdge) {
      const ck = this.ck
      const g = spec.ghostEdge
      const p = this.paint(this.color(sel), g.width)
      const dash = ck.PathEffect.MakeDash([...g.dash], 0)
      p.setPathEffect(dash)
      const e = r.ghostEdge
      if (e.axis === "x") {
        const x = this.snap((e.at - v.x) * v.zoom, g.width)
        const a = (Math.min(e.from, e.to) - v.y) * v.zoom - g.overhang
        const b = (Math.max(e.from, e.to) - v.y) * v.zoom + g.overhang
        canvas.drawLine(x, a, x, b, p)
      } else {
        const y = this.snap((e.at - v.y) * v.zoom, g.width)
        const a = (Math.min(e.from, e.to) - v.x) * v.zoom - g.overhang
        const b = (Math.max(e.from, e.to) - v.x) * v.zoom + g.overhang
        canvas.drawLine(a, y, b, y, p)
      }
      dash.delete()
      p.delete()
      c.draws++
    }
  }

  /** Screen-space path of contours (cubic where a side has a handle). */
  private contourPath(contours: readonly PathContour[], v: Viewport): Path {
    const pb = new this.ck.PathBuilder()
    for (const k of contours) {
      const n = k.anchors.length
      if (!n) continue
      const s = (p: Point) => this.ws(v, p)
      const first = s(k.anchors[0] as Point)
      pb.moveTo(first.x, first.y)
      const seg = (i: number, j: number) => {
        const a = k.anchors[i] as PathContour["anchors"][number]
        const b = k.anchors[j] as PathContour["anchors"][number]
        const pb2 = s(b)
        if (a.out || b.in) {
          const c1 = s(a.out ?? a)
          const c2 = s(b.in ?? b)
          pb.cubicTo(c1.x, c1.y, c2.x, c2.y, pb2.x, pb2.y)
        } else pb.lineTo(pb2.x, pb2.y)
      }
      for (let i = 0; i + 1 < n; i++) seg(i, i + 1)
      if (k.closed && n > 1) {
        seg(n - 1, 0)
        pb.close()
      }
    }
    return pb.detachAndDelete()
  }

  private anchor(
    canvas: Canvas,
    at: Point,
    active: boolean,
    theme: OverlayTheme,
    c: OverlayCounters,
  ): void {
    const ck = this.ck
    const a = OVERLAY_SPEC_M2.path.anchor
    const x = this.snap(at.x, a.size) - a.size / 2
    const y = this.snap(at.y, a.size) - a.size / 2
    const fill = this.paint(this.color(active ? theme.selection : theme.handleFill))
    canvas.drawRect(ck.XYWHRect(x, y, a.size, a.size), fill)
    fill.delete()
    const i = a.strokeWidth / 2
    const st = this.paint(this.color(theme.selection), a.strokeWidth)
    st.setStrokeJoin(ck.StrokeJoin.Miter)
    canvas.drawRect(ck.LTRBRect(x + i, y + i, x + a.size - i, y + a.size - i), st)
    st.delete()
    c.draws += 2
  }

  private bezierHandles(
    canvas: Canvas,
    k: PathContour,
    indices: Iterable<number>,
    v: Viewport,
    theme: OverlayTheme,
    c: OverlayCounters,
  ): void {
    const ck = this.ck
    const spec = OVERLAY_SPEC_M2.path
    const line = this.paint(this.color(theme.selection), spec.handleLineWidth)
    const fill = this.paint(this.color(theme.handleFill))
    const ring = this.paint(this.color(theme.selection), spec.handle.strokeWidth)
    for (const i of indices) {
      const a = k.anchors[i]
      if (!a) continue
      const at = this.ws(v, a)
      for (const h of [a.in, a.out]) {
        if (!h) continue
        const hp = this.ws(v, h)
        canvas.drawLine(at.x, at.y, hp.x, hp.y, line)
        const r = spec.handle.size / 2
        canvas.drawOval(ck.LTRBRect(hp.x - r, hp.y - r, hp.x + r, hp.y + r), fill)
        const ri = r - spec.handle.strokeWidth / 2
        canvas.drawOval(ck.LTRBRect(hp.x - ri, hp.y - ri, hp.x + ri, hp.y + ri), ring)
        c.draws += 3
      }
    }
    line.delete()
    fill.delete()
    ring.delete()
  }

  private pen(
    canvas: Canvas,
    pen: PenOverlay,
    v: Viewport,
    theme: OverlayTheme,
    c: OverlayCounters,
  ): void {
    const ck = this.ck
    const spec = OVERLAY_SPEC_M2.path
    const k = pen.contour
    const outline = this.contourPath([k], v)
    if (pen.stroke && pen.stroke.width > 0) {
      const sp = this.paint(this.color(pen.stroke.color), pen.stroke.width * v.zoom)
      sp.setStrokeCap(ck.StrokeCap.Butt)
      sp.setStrokeJoin(ck.StrokeJoin.Miter)
      canvas.drawPath(outline, sp)
      sp.delete()
      c.draws++
    }
    const op = this.paint(this.color(theme.selection), spec.outlineWidth)
    canvas.drawPath(outline, op)
    op.delete()
    outline.delete()
    c.draws++
    if (pen.preview) {
      const pv = pen.preview
      const a = this.ws(v, pv.from)
      const b = this.ws(v, pv.to)
      const pb = new ck.PathBuilder()
      pb.moveTo(a.x, a.y)
      if (pv.c1) {
        const c1 = this.ws(v, pv.c1)
        const c2 = this.ws(v, pv.c2 ?? pv.to)
        pb.cubicTo(c1.x, c1.y, c2.x, c2.y, b.x, b.y)
      } else pb.lineTo(b.x, b.y)
      const path = pb.detachAndDelete()
      const p = this.paint(this.color(theme.selection, spec.preview.opacity), spec.preview.width)
      canvas.drawPath(path, p)
      p.delete()
      path.delete()
      c.draws++
    }
    this.bezierHandles(canvas, k, pen.handlesFor, v, theme, c)
    k.anchors.forEach((a, i) => {
      this.anchor(canvas, this.ws(v, a), i === pen.active, theme, c)
    })
    if (pen.closeHint && k.anchors.length) {
      const f = this.ws(v, k.anchors[0] as Point)
      const r = spec.closeRing.size / 2 - spec.closeRing.strokeWidth / 2
      const cx = this.snap(f.x, spec.closeRing.size)
      const cy = this.snap(f.y, spec.closeRing.size)
      const p = this.paint(this.color(theme.selection), spec.closeRing.strokeWidth)
      canvas.drawOval(ck.LTRBRect(cx - r, cy - r, cx + r, cy + r), p)
      p.delete()
      c.draws++
    }
  }

  private pathEdit(
    canvas: Canvas,
    pe: PathEditOverlay,
    v: Viewport,
    theme: OverlayTheme,
    c: OverlayCounters,
  ): void {
    const spec = OVERLAY_SPEC_M2.path
    const outline = this.contourPath(pe.contours, v)
    const op = this.paint(this.color(theme.selection), spec.outlineWidth)
    canvas.drawPath(outline, op)
    op.delete()
    outline.delete()
    c.draws++
    const hs = pe.hoveredSegment
    if (hs) {
      const k = pe.contours[hs.contour]
      if (k && k.anchors.length > 1) {
        const j = (hs.index + 1) % k.anchors.length
        if (j !== 0 || k.closed) {
          const seg = this.contourPath(
            [
              {
                anchors: [k.anchors[hs.index], k.anchors[j]].filter(
                  Boolean,
                ) as PathContour["anchors"][number][],
                closed: false,
              },
            ],
            v,
          )
          const p = this.paint(this.color(theme.selection), 1.5)
          canvas.drawPath(seg, p)
          p.delete()
          seg.delete()
          c.draws++
        }
      }
    }
    const selected = new Set(pe.selected.map((r) => `${r.contour}:${r.index}`))
    pe.contours.forEach((k, ci) => {
      const idx: number[] = []
      k.anchors.forEach((_, i) => {
        if (selected.has(`${ci}:${i}`)) idx.push(i)
      })
      this.bezierHandles(canvas, k, idx, v, theme, c)
    })
    pe.contours.forEach((k, ci) => {
      k.anchors.forEach((a, i) => {
        this.anchor(canvas, this.ws(v, a), selected.has(`${ci}:${i}`), theme, c)
      })
    })
    const first = pe.selected[0]
    const fa = first ? pe.contours[first.contour]?.anchors[first.index] : undefined
    if (pe.badge && fa) {
      const at = this.ws(v, fa)
      const o = OVERLAY_SPEC_M2.pathEdit.vertexBadgeOffset
      this.pill(
        canvas,
        pe.badge,
        at.x + o.x,
        at.y + o.y,
        "top-left",
        theme.selection,
        theme.onSelection,
        theme,
        c,
      )
    }
  }

  private cursorBadge(
    canvas: Canvas,
    b: CursorBadge,
    theme: OverlayTheme,
    c: OverlayCounters,
  ): void {
    const spec = OVERLAY_SPEC_M2.deltaBadge
    this.pill(
      canvas,
      b.text,
      b.screen.x,
      b.screen.y,
      "top-left",
      themeColor(theme, spec.fill),
      themeColor(theme, spec.text),
      theme,
      c,
    )
  }

  /** Screen quad of the selection (single node, or the union box). */
  private selectionQuad(
    overlay: Overlay,
    layout: LayoutResult | null,
    v: Viewport,
  ): Point[] | null {
    if (!layout || !overlay.selection.length) return null
    if (overlay.selection.length === 1) return this.quad(layout, overlay.selection[0] as string, v)
    let box: Rect | null = null
    for (const id of overlay.selection) {
      const l = layout.nodes.get(id)
      if (l) box = union(box, l.world)
    }
    return box ? this.rectQuad(box, v) : null
  }

  draw(
    canvas: Canvas,
    overlay: Overlay,
    layout: LayoutResult | null,
    v: Viewport,
    theme: OverlayTheme,
    c: OverlayCounters,
    env: OverlayEnv = { dpr: 1, width: 0, height: 0 },
  ): void {
    const ck = this.ck
    this.env = env
    this.slot = 0
    const sel = this.color(theme.selection)

    // M2 marks under the selection (board 10 layer order).
    const grid = overlay.pixelGrid
    const gridAlpha = typeof grid === "number" ? Math.max(0, Math.min(1, grid)) : grid ? 1 : 0
    if (gridAlpha > 0 && v.zoom > OVERLAY_SPEC_M2.pixelGrid.minZoom && env.width > 0)
      this.pixelGrid(canvas, v, gridAlpha, c)
    if (layout && overlay.measureOutlines?.length)
      this.measureOutlines(canvas, overlay.measureOutlines, layout, v, theme, c)
    if (overlay.spacing?.length) this.spacing(canvas, overlay.spacing, v, theme, c)
    if (overlay.snap) this.snapMarks(canvas, overlay.snap, v, theme, c)
    if (overlay.measurements?.length) this.measurements(canvas, overlay.measurements, v, theme, c)
    const selQuad = this.selectionQuad(overlay, layout, v)
    if (overlay.resize) this.resize(canvas, overlay.resize, layout, selQuad, v, theme, c)

    const measured = new Set(overlay.measureOutlines?.map((o) => o.id))
    if (
      layout &&
      overlay.hovered &&
      !overlay.selection.includes(overlay.hovered) &&
      !measured.has(overlay.hovered)
    ) {
      const q = this.quad(layout, overlay.hovered, v)
      if (q) this.outline(canvas, q, OVERLAY_SPEC.hoverWidth, sel, c)
    }

    // Path edit mode replaces the selection chrome with the path's own anchors.
    if (selQuad && !overlay.pathEdit) {
      const q = selQuad
      this.outline(canvas, q, OVERLAY_SPEC.outlineWidth, sel, c)
      if (overlay.handles !== false) for (const p of q) this.handle(canvas, p, theme, c)
      if (overlay.sizeLabel) this.badge(canvas, overlay.sizeLabel, q, theme, c)
    }

    if (overlay.pen) this.pen(canvas, overlay.pen, v, theme, c)
    if (overlay.pathEdit) this.pathEdit(canvas, overlay.pathEdit, v, theme, c)
    if (overlay.cursorBadge) this.cursorBadge(canvas, overlay.cursorBadge, theme, c)

    if (overlay.marquee) {
      const m = overlay.marquee
      const r = ck.XYWHRect((m.x - v.x) * v.zoom, (m.y - v.y) * v.zoom, m.w * v.zoom, m.h * v.zoom)
      const f = this.paint(this.color(theme.selection, MARQUEE_FILL_ALPHA))
      canvas.drawRect(r, f)
      f.delete()
      const s = this.paint(sel, 1)
      canvas.drawRect(
        ck.XYWHRect(
          (m.x - v.x) * v.zoom + 0.5,
          (m.y - v.y) * v.zoom + 0.5,
          m.w * v.zoom - 1,
          m.h * v.zoom - 1,
        ),
        s,
      )
      s.delete()
      c.draws += 2
    }

    if (overlay.guides?.length) {
      const p = this.paint(sel, 1)
      for (const g of overlay.guides) {
        const a = g.axis === "x" ? { x: g.at, y: g.from } : { x: g.from, y: g.at }
        const b = g.axis === "x" ? { x: g.at, y: g.to } : { x: g.to, y: g.at }
        canvas.drawLine(
          (a.x - v.x) * v.zoom,
          (a.y - v.y) * v.zoom,
          (b.x - v.x) * v.zoom,
          (b.y - v.y) * v.zoom,
          p,
        )
        c.draws++
      }
      p.delete()
    }
  }
}
