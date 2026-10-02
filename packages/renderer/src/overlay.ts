/**
 * Editor overlays (ADR 0009 §5), drawn last in screen space (CSS px): hover outline,
 * selection outline + corner handles + size badge, marquee, guides. Geometry from
 * `OVERLAY_SPEC` (desing.pen board 03: "Selection Outline", "Handle", "Size Badge").
 */
import type { LayoutResult } from "@kimo/layout"
import type { Canvas, CanvasKit, Paint } from "canvaskit-wasm"
import { parseHex } from "./color"
import { apply, multiply, union } from "./geometry"
import type { TextEngine } from "./text"
import {
  OVERLAY_SPEC,
  type Overlay,
  type OverlayTheme,
  type Point,
  type Rect,
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

  draw(
    canvas: Canvas,
    overlay: Overlay,
    layout: LayoutResult | null,
    v: Viewport,
    theme: OverlayTheme,
    c: OverlayCounters,
  ): void {
    const ck = this.ck
    const sel = this.color(theme.selection)
    if (layout && overlay.hovered && !overlay.selection.includes(overlay.hovered)) {
      const q = this.quad(layout, overlay.hovered, v)
      if (q) this.outline(canvas, q, OVERLAY_SPEC.hoverWidth, sel, c)
    }

    if (layout && overlay.selection.length) {
      let q: Point[] | null = null
      if (overlay.selection.length === 1) q = this.quad(layout, overlay.selection[0] as string, v)
      else {
        let box: Rect | null = null
        for (const id of overlay.selection) {
          const l = layout.nodes.get(id)
          if (l) box = union(box, l.world)
        }
        if (box) q = this.rectQuad(box, v)
      }
      if (q) {
        this.outline(canvas, q, OVERLAY_SPEC.outlineWidth, sel, c)
        if (overlay.handles !== false) for (const p of q) this.handle(canvas, p, theme, c)
        if (overlay.sizeLabel) this.badge(canvas, overlay.sizeLabel, q, theme, c)
      }
    }

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
