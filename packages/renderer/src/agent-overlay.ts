/**
 * M6 canvas overlays (desing.pen board 22 "Built-in Agent (M6)" D0zDSY, board 24 iLW1l,
 * ADR 0014): placeholder frames (EKCy7: 1.5 outline, diagonal shimmer, skeleton while empty),
 * the 1.2 s clear flash, agent scope outlines (modes ZFOQf), persona-tinted agent selections
 * (GmEAl), rejected-op flashes (z6D2MM) and prompt → target connectors (cf2sC).
 *
 * Drawn in screen space (CSS px) by the overlay pass, so nothing here touches the cached scene
 * pictures: an animated shimmer costs one overlay pass per frame while a building placeholder
 * is visible, and nothing otherwise. Tags, chips, cursors and buttons are DOM (host).
 */
import type { LayoutResult, Matrix } from "@kimo/layout"
import type { Canvas, CanvasKit, Paint, Path } from "canvaskit-wasm"
import { parseHex } from "./color"
import { multiply, resolveRadii, toCk } from "./geometry"
import {
  type AgentCanvasTheme,
  type AgentPersona,
  DEFAULT_AGENT_CANVAS_THEME,
  OVERLAY_SPEC_M6,
  type Overlay,
  type OverlayTheme,
  type Point,
  personaColors,
  type Rect,
  type RenderScene,
  type Viewport,
} from "./types"

export interface AgentOverlayCounters {
  draws: number
}

/** True when the overlay carries any M6 surface. */
export function hasAgentOverlays(o: Overlay): boolean {
  return !!(
    o.placeholders?.length ||
    o.placeholderFlashes?.length ||
    o.scopes?.length ||
    o.agentSelections?.length ||
    o.rejected?.length ||
    o.promptConnectors?.length
  )
}

/** The live agent canvas theme (host values over the light defaults). */
export function agentCanvasTheme(theme: OverlayTheme | null | undefined): AgentCanvasTheme {
  const a = theme?.agentCanvas
  return a ? { ...DEFAULT_AGENT_CANVAS_THEME, ...a } : DEFAULT_AGENT_CANVAS_THEME
}

/**
 * Unit direction of the shimmer gradient in screen space: rotation is degrees CCW from "up"
 * (format §7.1), −60 → 60° clockwise from up (toward the upper right).
 */
export function shimmerDirection(rotationDeg: number): Point {
  const r = (rotationDeg * Math.PI) / 180
  return { x: -Math.sin(r), y: -Math.cos(r) }
}

/**
 * Gradient end points of the shimmer band for a box at `phase` (0–1, null = centered, as in
 * the design). The band spans the box's extent along the direction (like the design's
 * `size.height: 1`) and sweeps from fully before the box to fully past it.
 */
export function shimmerSpan(
  box: Rect,
  phase: number | null | undefined,
  dir: Point = shimmerDirection(OVERLAY_SPEC_M6.placeholder.shimmerRotation),
): { from: Point; to: Point } {
  const half = (Math.abs(box.w * dir.x) + Math.abs(box.h * dir.y)) / 2
  const shift = phase === null || phase === undefined ? 0 : (phase * 2 - 1) * 2 * half
  const cx = box.x + box.w / 2 + dir.x * shift
  const cy = box.y + box.h / 2 + dir.y * shift
  return {
    from: { x: cx - dir.x * half, y: cy - dir.y * half },
    to: { x: cx + dir.x * half, y: cy + dir.y * half },
  }
}

/**
 * Skeleton bars of `Wun0d` in frame-local world units (frame `w`×`h`): Bar · title 140×14,
 * Bar · line 1 full×8, Bar · line 2 180×8, then three equal Blocks filling the rest.
 */
export function skeletonBars(
  w: number,
  h: number,
): { x: number; y: number; w: number; h: number; r: number }[] {
  const s = OVERLAY_SPEC_M6.placeholder.skeleton
  const x = s.padding
  const cw = Math.max(0, w - 2 * s.padding)
  const bottom = h - s.padding
  const out: { x: number; y: number; w: number; h: number; r: number }[] = []
  if (cw <= 0) return out
  let y = s.top
  const push = (bw: number, bh: number, r: number) => {
    if (y + bh <= bottom) out.push({ x, y, w: Math.min(bw, cw), h: bh, r })
    y += bh + s.gap
  }
  push(s.title.w, s.title.h, s.title.r)
  push(cw, s.line1.h, s.line1.r)
  push(s.line2.w, s.line2.h, s.line2.r)
  const top = y + s.blocks.paddingTop
  const bh = bottom - top
  if (bh > 0) {
    const n = s.blocks.count
    const bw = (cw - s.blocks.gap * (n - 1)) / n
    if (bw > 0)
      for (let i = 0; i < n; i++)
        out.push({ x: x + i * (bw + s.blocks.gap), y: top, w: bw, h: bh, r: s.blocks.r })
  }
  return out
}

/**
 * Connector from a prompt box to its target (screen rects): a horizontal segment between the
 * facing edges at the middle of their vertical overlap (cf2sC: prompt right edge → frame left
 * edge, dot centered on the frame edge), else a straight segment between the facing edge
 * midpoints. Null when the boxes overlap.
 */
export function connectorPoints(prompt: Rect, target: Rect): { from: Point; to: Point } | null {
  const pr = prompt.x + prompt.w
  const tr = target.x + target.w
  const pb = prompt.y + prompt.h
  const tb = target.y + target.h
  const top = Math.max(prompt.y, target.y)
  const bot = Math.min(pb, tb)
  if (bot > top) {
    const y = (top + bot) / 2
    if (pr <= target.x) return { from: { x: pr, y }, to: { x: target.x, y } }
    if (tr <= prompt.x) return { from: { x: prompt.x, y }, to: { x: tr, y } }
    return null
  }
  const left = Math.max(prompt.x, target.x)
  const right = Math.min(pr, tr)
  if (right > left) {
    const x = (left + right) / 2
    if (pb <= target.y) return { from: { x, y: pb }, to: { x, y: target.y } }
    return { from: { x, y: prompt.y }, to: { x, y: tb } }
  }
  const pc = { x: prompt.x + prompt.w / 2, y: prompt.y + prompt.h / 2 }
  const tc = { x: target.x + target.w / 2, y: target.y + target.h / 2 }
  const horizontal = Math.abs(tc.x - pc.x) >= Math.abs(tc.y - pc.y)
  if (horizontal) {
    const right = tc.x > pc.x
    return {
      from: { x: right ? pr : prompt.x, y: pc.y },
      to: { x: right ? target.x : tr, y: tc.y },
    }
  }
  const down = tc.y > pc.y
  return {
    from: { x: pc.x, y: down ? pb : prompt.y },
    to: { x: tc.x, y: down ? target.y : tb },
  }
}

export class AgentOverlayPainter {
  constructor(private readonly ck: CanvasKit) {}

  private color(hex: string, alpha = 1): Float32Array {
    const c = parseHex(hex) ?? [0, 0.576, 0.639, 1]
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

  private toScreen(v: Viewport, T: Matrix): Matrix {
    return multiply([v.zoom, 0, 0, v.zoom, -v.x * v.zoom, -v.y * v.zoom], T)
  }

  /** Node radii (frames, rects) in world units. */
  private radii(scene: RenderScene | null | undefined, id: string, w: number, h: number) {
    const node = scene?.nodes.getNode(id)
    return scene && node && (node.type === "frame" || node.type === "rect")
      ? resolveRadii(scene.resolve, id, node, w, h)
      : [0, 0, 0, 0]
  }

  /**
   * Screen path of a node's box moved by `d` CSS px (negative = outward) with radius
   * `radius + extra` (CSS px) per corner, following the node's transform.
   */
  private box(
    layout: LayoutResult,
    scene: RenderScene | null | undefined,
    id: string,
    v: Viewport,
    d: number,
    radius: "node" | "none",
  ): Path | null {
    const l = layout.nodes.get(id)
    if (!l) return null
    const ck = this.ck
    const { w, h } = l.local
    const i = d / v.zoom
    const r = ck.LTRBRect(i, i, Math.max(i, w - i), Math.max(i, h - i))
    const base = radius === "node" ? this.radii(scene, id, w, h) : [0, 0, 0, 0]
    const radii = base.map((x) => Math.max(0, x - i))
    const pb = new ck.PathBuilder()
    pb.addRRect(
      Float32Array.of(
        r[0] as number,
        r[1] as number,
        r[2] as number,
        r[3] as number,
        ...radii.flatMap((x) => [x, x]),
      ),
    )
    pb.transform(toCk(this.toScreen(v, l.transform)))
    return pb.detachAndDelete()
  }

  private stroke(
    canvas: Canvas,
    path: Path | null,
    color: Float32Array,
    width: number,
    c: AgentOverlayCounters,
  ) {
    if (!path) return
    const p = this.paint(color, width)
    canvas.drawPath(path, p)
    p.delete()
    path.delete()
    c.draws++
  }

  private screenRect(layout: LayoutResult, id: string, v: Viewport): Rect | null {
    const l = layout.nodes.get(id)
    if (!l) return null
    return {
      x: (l.world.x - v.x) * v.zoom,
      y: (l.world.y - v.y) * v.zoom,
      w: l.world.w * v.zoom,
      h: l.world.h * v.zoom,
    }
  }

  draw(
    canvas: Canvas,
    overlay: Overlay,
    layout: LayoutResult,
    v: Viewport,
    theme: OverlayTheme,
    c: AgentOverlayCounters,
    scene: RenderScene | null | undefined,
  ): void {
    const t = agentCanvasTheme(theme)
    for (const ph of overlay.placeholders ?? [])
      this.placeholder(canvas, ph, overlay, layout, v, t, c, scene)
    for (const f of overlay.placeholderFlashes ?? []) {
      const p = Math.max(0, Math.min(1, f.progress))
      if (p >= 1) continue
      const { hue, soft } = personaColors(t, f.persona)
      const ring = OVERLAY_SPEC_M6.flash.ringWidth
      this.stroke(
        canvas,
        this.box(layout, scene, f.id, v, ring / 2, "node"),
        this.color(soft, 1 - p),
        ring,
        c,
      )
      const fade = Math.max(0, 1 - 2 * p)
      if (fade > 0) {
        const w = OVERLAY_SPEC_M6.placeholder.outlineWidth
        this.stroke(
          canvas,
          this.box(layout, scene, f.id, v, w / 2, "node"),
          this.color(hue, fade),
          w,
          c,
        )
      }
    }
    for (const s of overlay.scopes ?? []) {
      const spec = OVERLAY_SPEC_M6.scope
      const d = s.fit === "outset" ? -spec.outset + spec.width / 2 : spec.width / 2
      // Outset: the outline's outer edge 3 px out, its radius the node's + 3 (TvhRj radius 3 on a
      // square frame, cCMHZ 23 on a 20 card).
      const path =
        s.fit === "outset"
          ? this.outsetBox(layout, scene, s.id, v, spec.outset, spec.width)
          : this.box(layout, scene, s.id, v, d, "node")
      this.stroke(canvas, path, this.color(personaColors(t, s.persona).hue), spec.width, c)
    }
    for (const s of overlay.agentSelections ?? []) {
      const spec = OVERLAY_SPEC_M6.agentSelection
      this.stroke(
        canvas,
        this.box(layout, scene, s.id, v, -spec.outset + spec.width / 2, "none"),
        this.color(personaColors(t, s.persona).hue),
        spec.width,
        c,
      )
    }
    for (const id of overlay.rejected ?? []) {
      const w = OVERLAY_SPEC_M6.rejected.width
      this.stroke(canvas, this.box(layout, scene, id, v, w / 2, "node"), this.color(t.danger), w, c)
    }
    for (const k of overlay.promptConnectors ?? [])
      this.connector(canvas, k.prompt, k.target, k.persona, layout, v, t, c)
  }

  /** Outset outline: outer edge `outset` px out, corner radius = node radius + outset (screen). */
  private outsetBox(
    layout: LayoutResult,
    scene: RenderScene | null | undefined,
    id: string,
    v: Viewport,
    outset: number,
    width: number,
  ): Path | null {
    const l = layout.nodes.get(id)
    if (!l) return null
    const ck = this.ck
    const { w, h } = l.local
    const d = (outset - width / 2) / v.zoom
    const r = ck.LTRBRect(-d, -d, w + d, h + d)
    const radii = this.radii(scene, id, w, h).map((x) => (x * v.zoom + outset - width / 2) / v.zoom)
    const pb = new ck.PathBuilder()
    pb.addRRect(
      Float32Array.of(
        r[0] as number,
        r[1] as number,
        r[2] as number,
        r[3] as number,
        ...radii.flatMap((x) => [x, x]),
      ),
    )
    pb.transform(toCk(this.toScreen(v, l.transform)))
    return pb.detachAndDelete()
  }

  private placeholder(
    canvas: Canvas,
    ph: NonNullable<Overlay["placeholders"]>[number],
    overlay: Overlay,
    layout: LayoutResult,
    v: Viewport,
    t: AgentCanvasTheme,
    c: AgentOverlayCounters,
    scene: RenderScene | null | undefined,
  ): void {
    const l = layout.nodes.get(ph.id)
    if (!l?.visible) return
    const ck = this.ck
    const spec = OVERLAY_SPEC_M6.placeholder
    const { hue, soft } = personaColors(t, ph.persona)
    const shape = this.box(layout, scene, ph.id, v, 0, "node")
    if (!shape) return
    canvas.save()
    canvas.clipPath(shape, ck.ClipOp.Intersect, true)
    if (ph.skeleton) {
      // Skeleton bars (world units, frame-local), under the node's transform.
      canvas.save()
      canvas.concat(toCk(this.toScreen(v, l.transform)))
      const p = this.paint(this.color(soft))
      for (const b of skeletonBars(l.local.w, l.local.h)) {
        canvas.drawRRect(ck.RRectXY(ck.XYWHRect(b.x, b.y, b.w, b.h), b.r, b.r), p)
        c.draws++
      }
      p.delete()
      canvas.restore()
    }
    if (ph.state === "building") {
      const box = this.screenRect(layout, ph.id, v)
      if (box) {
        const { from, to } = shimmerSpan(box, overlay.shimmerPhase)
        const shader = ck.Shader.MakeLinearGradient(
          [from.x, from.y],
          [to.x, to.y],
          [this.color(hue, 0), this.color(hue, spec.shimmerAlpha), this.color(hue, 0)],
          [0, 0.5, 1],
          ck.TileMode.Clamp,
        )
        const p = new ck.Paint()
        p.setAntiAlias(true)
        p.setShader(shader)
        canvas.drawRect(ck.XYWHRect(box.x, box.y, box.w, box.h), p)
        p.delete()
        shader.delete()
        c.draws++
      }
    }
    canvas.restore()
    shape.delete()
    this.stroke(
      canvas,
      this.box(layout, scene, ph.id, v, spec.outlineWidth / 2, "node"),
      this.color(hue),
      spec.outlineWidth,
      c,
    )
  }

  private connector(
    canvas: Canvas,
    promptId: string,
    targetId: string,
    persona: AgentPersona | undefined,
    layout: LayoutResult,
    v: Viewport,
    t: AgentCanvasTheme,
    c: AgentOverlayCounters,
  ): void {
    const a = this.screenRect(layout, promptId, v)
    const b = this.screenRect(layout, targetId, v)
    if (!a || !b) return
    const pts = connectorPoints(a, b)
    if (!pts) return
    const spec = OVERLAY_SPEC_M6.connector
    const color = this.color(personaColors(t, persona).hue)
    const line = this.paint(color, spec.width)
    canvas.drawLine(pts.from.x, pts.from.y, pts.to.x, pts.to.y, line)
    line.delete()
    const dot = this.paint(color)
    canvas.drawCircle(pts.to.x, pts.to.y, spec.dot / 2, dot)
    dot.delete()
    c.draws += 2
  }
}
