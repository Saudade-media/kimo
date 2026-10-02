/**
 * Node painter: draws one node subtree onto a CanvasKit canvas in world space
 * (ADR 0009 §4). Each node concatenates its `NodeLayout.transform` (absolute local → world)
 * and draws in `[0, 0, w, h]`. Children are drawn back in world space (inverse transform), so
 * a clipping frame's clip stays in effect for them.
 */
import { defaultTextFill, isObject, isRef, type KimoDocument } from "@kimo/core-schema"
import {
  type LayoutNodeData,
  type LayoutResult,
  type NodeLayout,
  type NodeSource,
  type ResolveHeader,
  type Resolver,
  resolveText,
} from "@kimo/layout"
import type { Canvas, CanvasKit, ImageFilter, Paint, Path } from "canvaskit-wasm"
import type { RGBA } from "./color"
import { invert, resolveNum, resolveRadii, toCk } from "./geometry"
import { blendMode, imageSources, type PaintFactory, paintList } from "./paint"
import type { TextEngine, TextFill } from "./text"

type Radii = [number, number, number, number]

interface ShadowFx {
  kind: "shadow"
  inner: boolean
  x: number
  y: number
  blur: number
  spread: number
  color: unknown
  blend: unknown
}
interface BlurFx {
  kind: "blur" | "backdrop-blur"
  radius: number
}
type Fx = ShadowFx | BlurFx

/** A node's fill geometry in local space. */
type Geo =
  | { kind: "rrect"; w: number; h: number; radii: Radii }
  | { kind: "oval"; w: number; h: number }
  | { kind: "path"; path: Path }

export interface PaintContext {
  nodes: NodeSource
  header: () => ResolveHeader
  resolve: Resolver
  layout: LayoutResult
}

export interface DrawCounters {
  nodes: number
  draws: number
}

const PLACEHOLDER_FILL: RGBA = [0, 0, 0, 0.04]
const PLACEHOLDER_STROKE: RGBA = [0, 0, 0, 0.3]
/** Sticky note / prompt card colors (M1 placeholders; not in desing.pen). */
const NOTE_FILL: RGBA = [1, 0.953, 0.722, 1]
const PROMPT_FILL: RGBA = [0.918, 0.965, 0.957, 1]

export class Painter {
  constructor(
    private readonly ck: CanvasKit,
    private readonly paints: PaintFactory,
    private readonly text: TextEngine,
  ) {}

  /** Children of `id` that the layout laid out, in sibling order. */
  children(ctx: PaintContext, id: string): string[] {
    return ctx.nodes.children(id).filter((c) => ctx.layout.nodes.has(c))
  }

  /** Draws `id` and its subtree. The canvas matrix must be the world → device matrix. */
  drawNode(canvas: Canvas, ctx: PaintContext, id: string, counters: DrawCounters): void {
    const l = ctx.layout.nodes.get(id)
    const node = ctx.nodes.getNode(id)
    if (!l || !node || !l.visible) return
    counters.nodes++
    const ck = this.ck
    const { resolve } = ctx
    const { w, h } = l.local
    const T = l.transform
    const geo = this.geometry(ctx, id, node, l)
    const opacity = Math.max(0, Math.min(1, resolveNum(resolve, id, node.opacity, 1)))
    const effects = this.effects(resolve, id, node.effects)
    const blur = effects.find((e): e is BlurFx => e.kind === "blur")
    const backdrop = effects.find((e): e is BlurFx => e.kind === "backdrop-blur")
    const shadows = effects.filter((e): e is ShadowFx => e.kind === "shadow")
    const isText = node.type === "text" || node.type === "note" || node.type === "prompt"
    const fills =
      node.type === "group" || isText || node.type === "icon"
        ? []
        : this.paints.paints(resolve, id, node.fill, w, h)
    // Shapes with fills cast geometric shadows; text/groups/unfilled frames use layer shadows.
    const geoShadows = fills.length > 0 && geo !== null
    const children = node.type === "frame" || node.type === "group" ? this.children(ctx, id) : []

    canvas.save()
    canvas.concat(toCk(T))
    let layers = 0
    if (opacity < 1 || blur || (!geoShadows && shadows.some((s) => !s.inner))) {
      const p = new ck.Paint()
      p.setAlphaf(opacity)
      let filter = blur
        ? ck.ImageFilter.MakeBlur(blur.radius / 2, blur.radius / 2, ck.TileMode.Decal, null)
        : null
      if (!geoShadows)
        for (const s of shadows) {
          if (s.inner) continue
          const c = this.paints.resolveColor(resolve, id, s.color)
          if (!c) continue
          // Skia keeps its own reference to the input filter: free the JS handle of each
          // intermediate link (only the chain's head is deleted below).
          const next: ImageFilter = ck.ImageFilter.MakeDropShadow(
            s.x,
            s.y,
            s.blur / 2,
            s.blur / 2,
            this.paints.color(c),
            filter,
          )
          filter?.delete()
          filter = next
        }
      if (filter) p.setImageFilter(filter)
      canvas.saveLayer(p)
      p.delete()
      filter?.delete()
      layers++
      counters.draws++
    }

    if (backdrop && geo && backdrop.radius > 0) {
      canvas.save()
      this.clip(canvas, geo)
      const f = ck.ImageFilter.MakeBlur(
        backdrop.radius / 2,
        backdrop.radius / 2,
        ck.TileMode.Clamp,
        null,
      )
      canvas.saveLayer(undefined, null, f)
      canvas.restore()
      canvas.restore()
      f.delete()
      counters.draws++
    }

    if (geoShadows && geo)
      for (const s of shadows) if (!s.inner) this.dropShadow(canvas, ctx, id, geo, s, counters)

    if (geo) for (const p of fills) this.fill(canvas, geo, p, counters)
    for (const p of fills) p.delete()

    if (geo)
      for (const s of shadows) if (s.inner) this.innerShadow(canvas, ctx, id, geo, s, counters)

    switch (node.type) {
      case "text":
      case "note":
      case "prompt":
        this.drawText(canvas, ctx, id, node, l, counters)
        break
      case "icon":
        this.drawIcon(canvas, ctx, id, node, w, h, counters)
        break
      case "instance":
      case "script":
      case "browser":
        if (node.type !== "browser" || !node.fill) this.placeholder(canvas, w, h, counters)
        break
    }

    if (children.length) {
      const inv = invert(T)
      if (inv) {
        canvas.save()
        if (geo && node.type === "frame" && resolve.value(id, node.clip) === true)
          this.clip(canvas, geo)
        canvas.concat(toCk(inv))
        for (const c of children) this.drawNode(canvas, ctx, c, counters)
        canvas.restore()
      }
    }

    if (geo && node.stroke && !isText && node.type !== "icon")
      this.stroke(canvas, ctx, id, node, geo, w, h, counters)

    while (layers-- > 0) canvas.restore()
    canvas.restore()
    if (geo?.kind === "path") geo.path.delete()
  }

  // --- geometry -----------------------------------------------------------------------------

  private geometry(ctx: PaintContext, id: string, node: LayoutNodeData, l: NodeLayout): Geo | null {
    const { w, h } = l.local
    const r = ctx.resolve
    switch (node.type) {
      case "frame":
      case "rect":
      case "browser":
      case "instance":
      case "script":
        return { kind: "rrect", w, h, radii: resolveRadii(r, id, node, w, h) }
      case "ellipse": {
        const inner = Math.max(0, Math.min(0.9999, resolveNum(r, id, node.innerRadius, 0)))
        const start = resolveNum(r, id, node.startAngle, 0)
        const sweep = Math.max(-360, Math.min(360, resolveNum(r, id, node.sweepAngle, 360)))
        if (inner === 0 && Math.abs(sweep) >= 360) return { kind: "oval", w, h }
        return { kind: "path", path: this.arcPath(w, h, inner, start, sweep) }
      }
      case "polygon": {
        const sides = Math.max(3, Math.floor(resolveNum(r, id, node.sides, 3)))
        const radius = Math.max(0, resolveNum(r, id, node.radius, 0))
        return { kind: "path", path: this.polygonPath(w, h, sides, radius) }
      }
      case "path": {
        const path = this.svgPath(node, w, h)
        return path ? { kind: "path", path } : null
      }
      default:
        return null
    }
  }

  private arcPath(w: number, h: number, inner: number, start: number, sweep: number): Path {
    const ck = this.ck
    const pb = new ck.PathBuilder()
    const outer = ck.LTRBRect(0, 0, w, h)
    const iw = w * inner
    const ih = h * inner
    const innerRect = ck.LTRBRect((w - iw) / 2, (h - ih) / 2, (w + iw) / 2, (h + ih) / 2)
    if (Math.abs(sweep) >= 360) {
      pb.addOval(outer)
      pb.addOval(innerRect, true)
      pb.setFillType(ck.FillType.EvenOdd)
    } else {
      // Spec angles are CCW from +x (y up); Skia's are clockwise in y-down space.
      pb.arcToOval(outer, -start, -sweep, true)
      if (inner > 0) pb.arcToOval(innerRect, -(start + sweep), sweep, false)
      else pb.lineTo(w / 2, h / 2)
      pb.close()
    }
    return pb.detachAndDelete()
  }

  private polygonPath(w: number, h: number, sides: number, radius: number): Path {
    const ck = this.ck
    const pts: [number, number][] = []
    for (let i = 0; i < sides; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / sides
      pts.push([w / 2 + (w / 2) * Math.cos(a), h / 2 + (h / 2) * Math.sin(a)])
    }
    const pb = new ck.PathBuilder()
    if (radius <= 0) {
      pb.addPolygon(pts.flat(), true)
      return pb.detachAndDelete()
    }
    // Rounded corners: start mid-edge, then arc tangentially through every vertex.
    const at = (i: number) => pts[((i % sides) + sides) % sides] as [number, number]
    const mid = (i: number): [number, number] => {
      const p = at(i)
      const q = at(i + 1)
      return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
    }
    const m0 = mid(sides - 1)
    pb.moveTo(m0[0], m0[1])
    for (let i = 0; i < sides; i++) {
      const v = at(i)
      const m = mid(i)
      pb.arcToTangent(v[0], v[1], m[0], m[1], radius)
    }
    pb.close()
    return pb.detachAndDelete()
  }

  private svgPath(node: LayoutNodeData, w: number, h: number): Path | null {
    const ck = this.ck
    if (typeof node.d !== "string") return null
    const raw = ck.Path.MakeFromSVGString(node.d)
    if (!raw) return null
    const vb =
      Array.isArray(node.viewBox) && node.viewBox.length === 4 ? (node.viewBox as number[]) : null
    const b = raw.getBounds()
    const [vx = 0, vy = 0, vw = 0, vh = 0] = vb ?? [
      b[0] ?? 0,
      b[1] ?? 0,
      (b[2] ?? 0) - (b[0] ?? 0),
      (b[3] ?? 0) - (b[1] ?? 0),
    ]
    const sx = vw ? w / vw : 1
    const sy = vh ? h / vh : 1
    const pb = new ck.PathBuilder(raw)
    pb.transform([sx, 0, -vx * sx, 0, sy, -vy * sy, 0, 0, 1])
    pb.setFillType(node.fillRule === "evenodd" ? ck.FillType.EvenOdd : ck.FillType.Winding)
    raw.delete()
    return pb.detachAndDelete()
  }

  private rrect(
    x: number,
    y: number,
    w: number,
    h: number,
    radii: Radii,
    rx: Radii = radii,
  ): Float32Array {
    // [l, t, r, b, tlx, tly, trx, try, brx, bry, blx, bly]
    return Float32Array.of(
      x,
      y,
      x + w,
      y + h,
      rx[0],
      radii[0],
      rx[1],
      radii[1],
      rx[2],
      radii[2],
      rx[3],
      radii[3],
    )
  }

  private geoPath(geo: Geo): Path {
    const ck = this.ck
    if (geo.kind === "path") return geo.path.copy()
    const pb = new ck.PathBuilder()
    if (geo.kind === "oval") pb.addOval(ck.LTRBRect(0, 0, geo.w, geo.h))
    else pb.addRRect(this.rrect(0, 0, geo.w, geo.h, geo.radii))
    return pb.detachAndDelete()
  }

  private fill(canvas: Canvas, geo: Geo, p: Paint, counters: DrawCounters): void {
    counters.draws++
    if (geo.kind === "path") canvas.drawPath(geo.path, p)
    else if (geo.kind === "oval") canvas.drawOval(this.ck.LTRBRect(0, 0, geo.w, geo.h), p)
    else if (geo.radii.every((r) => r === 0))
      canvas.drawRect(this.ck.LTRBRect(0, 0, geo.w, geo.h), p)
    else canvas.drawRRect(this.rrect(0, 0, geo.w, geo.h, geo.radii), p)
  }

  private clip(canvas: Canvas, geo: Geo, op = this.ck.ClipOp.Intersect): void {
    if (geo.kind === "path") canvas.clipPath(geo.path, op, true)
    else if (geo.kind === "oval") {
      const p = this.geoPath(geo)
      canvas.clipPath(p, op, true)
      p.delete()
    } else canvas.clipRRect(this.rrect(0, 0, geo.w, geo.h, geo.radii), op, true)
  }

  // --- effects ------------------------------------------------------------------------------

  private effects(resolve: Resolver, id: string, value: unknown): Fx[] {
    let v = isRef(value) ? resolve.value(id, value) : value
    if (isObject(v)) v = [v]
    if (!Array.isArray(v)) return []
    const out: Fx[] = []
    for (const e of v) {
      if (!isObject(e)) continue
      if (e.kind === "shadow" || (e.kind === undefined && "blur" in e && "color" in e)) {
        out.push({
          kind: "shadow",
          inner: e.inner === true,
          x: resolveNum(resolve, id, e.x, 0),
          y: resolveNum(resolve, id, e.y, 0),
          blur: Math.max(0, resolveNum(resolve, id, e.blur, 0)),
          spread: resolveNum(resolve, id, e.spread, 0),
          color: e.color,
          blend: e.blend,
        })
      } else if (e.kind === "blur" || e.kind === "backdrop-blur") {
        out.push({ kind: e.kind, radius: Math.max(0, resolveNum(resolve, id, e.radius, 0)) })
      }
    }
    return out
  }

  private shadowPaint(
    ctx: PaintContext,
    id: string,
    color: unknown,
    blend: unknown,
    blur: number,
  ): Paint | null {
    const c = this.paints.resolveColor(ctx.resolve, id, color)
    if (!c) return null
    const ck = this.ck
    const p = new ck.Paint()
    p.setAntiAlias(true)
    p.setColor(this.paints.color(c))
    if (blend && blend !== "normal") p.setBlendMode(blendMode(ck, blend))
    if (blur > 0) {
      const mf = ck.MaskFilter.MakeBlur(ck.BlurStyle.Normal, blur / 2, true)
      p.setMaskFilter(mf)
      mf.delete()
    }
    return p
  }

  /** Geometry of `geo` grown by `spread` (rrect/oval exactly; paths ignore spread). */
  private spreadGeo(
    geo: Geo,
    spread: number,
  ): { draw: (c: Canvas, p: Paint) => void; path: () => Path } {
    const ck = this.ck
    if (geo.kind === "path")
      return { draw: (c, p) => c.drawPath(geo.path, p), path: () => geo.path.copy() }
    const s = spread
    const w = Math.max(0, geo.w + 2 * s)
    const h = Math.max(0, geo.h + 2 * s)
    if (geo.kind === "oval") {
      const r = ck.LTRBRect(-s, -s, -s + w, -s + h)
      return {
        draw: (c, p) => c.drawOval(r, p),
        path: () => {
          const pb = new ck.PathBuilder()
          pb.addOval(r)
          return pb.detachAndDelete()
        },
      }
    }
    const radii = geo.radii.map((r) => (r > 0 ? Math.max(0, r + s) : 0)) as Radii
    const rr = this.rrect(-s, -s, w, h, radii)
    return {
      draw: (c, p) => c.drawRRect(rr, p),
      path: () => {
        const pb = new ck.PathBuilder()
        pb.addRRect(rr)
        return pb.detachAndDelete()
      },
    }
  }

  private dropShadow(
    canvas: Canvas,
    ctx: PaintContext,
    id: string,
    geo: Geo,
    s: ShadowFx,
    counters: DrawCounters,
  ): void {
    const p = this.shadowPaint(ctx, id, s.color, s.blend, s.blur)
    if (!p) return
    canvas.save()
    canvas.translate(s.x, s.y)
    this.spreadGeo(geo, s.spread).draw(canvas, p)
    canvas.restore()
    p.delete()
    counters.draws++
  }

  private innerShadow(
    canvas: Canvas,
    ctx: PaintContext,
    id: string,
    geo: Geo,
    s: ShadowFx,
    counters: DrawCounters,
  ): void {
    const ck = this.ck
    const p = this.shadowPaint(ctx, id, s.color, s.blend, s.blur)
    if (!p) return
    const hole = this.spreadGeo(geo, -s.spread).path()
    const pad = Math.abs(s.x) + Math.abs(s.y) + s.blur * 2 + Math.abs(s.spread) + 10
    const b = hole.getBounds()
    const pb = new ck.PathBuilder()
    pb.addRect(
      ck.LTRBRect((b[0] ?? 0) - pad, (b[1] ?? 0) - pad, (b[2] ?? 0) + pad, (b[3] ?? 0) + pad),
    )
    pb.addPath(hole)
    pb.setFillType(ck.FillType.EvenOdd)
    const ring = pb.detachAndDelete()
    canvas.save()
    this.clip(canvas, geo)
    canvas.translate(s.x, s.y)
    canvas.drawPath(ring, p)
    canvas.restore()
    ring.delete()
    hole.delete()
    p.delete()
    counters.draws++
  }

  // --- stroke -------------------------------------------------------------------------------

  private stroke(
    canvas: Canvas,
    ctx: PaintContext,
    id: string,
    node: LayoutNodeData,
    geo: Geo,
    w: number,
    h: number,
    counters: DrawCounters,
  ): void {
    const ck = this.ck
    const s = node.stroke
    if (!isObject(s)) return
    const resolve = ctx.resolve
    const paints = this.paints.paints(resolve, id, s.paint, w, h)
    if (!paints.length) return
    const align = s.align === "center" || s.align === "outside" ? s.align : "inside"
    let sides: [number, number, number, number] // t r b l
    if (isObject(s.width) && !isRef(s.width)) {
      const sw = s.width
      sides = [sw.t, sw.r, sw.b, sw.l].map((v) => Math.max(0, resolveNum(resolve, id, v, 0))) as [
        number,
        number,
        number,
        number,
      ]
    } else {
      const v = Math.max(0, resolveNum(resolve, id, s.width, 1))
      sides = [v, v, v, v]
    }
    const dash = Array.isArray(s.dash)
      ? s.dash.filter((d): d is number => typeof d === "number" && d >= 0)
      : []
    const uniform = sides.every((v) => v === sides[0])
    if (geo.kind === "rrect" && (!dash.length || !uniform)) {
      // Exact inside/center/outside via a double rounded rect.
      const f = align === "inside" ? 0 : align === "center" ? 0.5 : 1
      const [t, r, b, l] = sides
      const o = { t: t * f, r: r * f, b: b * f, l: l * f }
      const i = { t: t - o.t, r: r - o.r, b: b - o.b, l: l - o.l }
      const R = geo.radii
      const grow = (rad: number, a: number) => (rad > 0 ? Math.max(0, rad + a) : 0)
      const outer = this.rrect(
        -o.l,
        -o.t,
        w + o.l + o.r,
        h + o.t + o.b,
        [grow(R[0], o.t), grow(R[1], o.t), grow(R[2], o.b), grow(R[3], o.b)],
        [grow(R[0], o.l), grow(R[1], o.r), grow(R[2], o.r), grow(R[3], o.l)],
      )
      const iw = w - i.l - i.r
      const ih = h - i.t - i.b
      for (const p of paints) {
        counters.draws++
        if (iw <= 0 || ih <= 0) canvas.drawRRect(outer, p)
        else
          canvas.drawDRRect(
            outer,
            this.rrect(
              i.l,
              i.t,
              iw,
              ih,
              [grow(R[0], -i.t), grow(R[1], -i.t), grow(R[2], -i.b), grow(R[3], -i.b)],
              [grow(R[0], -i.l), grow(R[1], -i.r), grow(R[2], -i.r), grow(R[3], -i.l)],
            ),
            p,
          )
        p.delete()
      }
      return
    }
    const width = sides[0]
    if (width <= 0) {
      for (const p of paints) p.delete()
      return
    }
    const path = this.geoPath(geo)
    canvas.save()
    if (align === "inside") this.clip(canvas, geo)
    else if (align === "outside") this.clip(canvas, geo, ck.ClipOp.Difference)
    const effect = dash.length
      ? ck.PathEffect.MakeDash(dash.length % 2 ? [...dash, ...dash] : dash, 0)
      : null
    for (const p of paints) {
      p.setStyle(ck.PaintStyle.Stroke)
      p.setStrokeWidth(align === "center" ? width : width * 2)
      p.setStrokeCap(
        s.cap === "round"
          ? ck.StrokeCap.Round
          : s.cap === "square"
            ? ck.StrokeCap.Square
            : ck.StrokeCap.Butt,
      )
      p.setStrokeJoin(
        s.join === "round"
          ? ck.StrokeJoin.Round
          : s.join === "bevel"
            ? ck.StrokeJoin.Bevel
            : ck.StrokeJoin.Miter,
      )
      if (effect) p.setPathEffect(effect)
      canvas.drawPath(path, p)
      counters.draws++
      p.delete()
    }
    effect?.delete()
    canvas.restore()
    path.delete()
  }

  // --- text / icon / placeholder ------------------------------------------------------------

  /** The paint used for glyphs: one solid color, or the top-most paint as a shader paint. */
  textFill(
    ctx: PaintContext,
    id: string,
    node: LayoutNodeData,
    w: number,
    h: number,
  ): TextFill | null {
    let fill = node.fill
    if (fill === undefined) {
      if (node.type !== "text") return { color: this.paints.color([0.1, 0.1, 0.1, 1]) }
      fill = defaultTextFill({ ...ctx.header(), nodes: {} } as KimoDocument)
    }
    const list = paintList(fill) ?? []
    if (list.length === 1) {
      const only = list[0]
      const v = isRef(only) ? ctx.resolve.value(id, only) : only
      const solid =
        isObject(v) && v.kind === "solid" && (v.blend ?? "normal") === "normal" ? v.color : v
      if (!(isObject(solid) && "kind" in solid)) {
        if (isObject(v) && v.visible === false) return null
        const c = this.paints.resolveColor(ctx.resolve, id, solid)
        if (c) return { color: this.paints.color(c) }
      }
    }
    for (let i = list.length - 1; i >= 0; i--) {
      const p = this.paints.one(ctx.resolve, id, list[i], w, h)
      if (p) return { paint: p, key: `${JSON.stringify(list[i])}|${w}|${h}` }
    }
    return null
  }

  private drawText(
    canvas: Canvas,
    ctx: PaintContext,
    id: string,
    node: LayoutNodeData,
    l: NodeLayout,
    counters: DrawCounters,
  ): void {
    const { w, h } = l.local
    if (node.type !== "text") {
      const p = new this.ck.Paint()
      p.setAntiAlias(true)
      p.setColor(this.paints.color(node.type === "note" ? NOTE_FILL : PROMPT_FILL))
      canvas.drawRRect(this.rrect(0, 0, w, h, [4, 4, 4, 4]), p)
      p.delete()
      counters.draws++
    }
    const fill = this.textFill(ctx, id, node, w, h)
    if (!fill) return
    const input = resolveText(id, node, ctx.resolve)
    const auto = node.type === "text" && (node.grow === undefined || node.grow === "auto")
    const width = auto ? Math.max(w, l.text?.w ?? 0) + 0.01 : w
    const para = this.text.paragraph(input, fill, width)
    if ("paint" in fill) fill.paint.delete()
    const ph = para.getHeight()
    const valign = input.style.valign
    const dy = h > ph ? (valign === "middle" ? (h - ph) / 2 : valign === "bottom" ? h - ph : 0) : 0
    canvas.drawParagraph(para, 0, dy)
    counters.draws++
  }

  private drawIcon(
    canvas: Canvas,
    ctx: PaintContext,
    id: string,
    node: LayoutNodeData,
    w: number,
    h: number,
    counters: DrawCounters,
  ): void {
    // M1: icon glyph paths are not bundled in the renderer (no React/lucide dependency);
    // draw a placeholder in the icon color.
    const ck = this.ck
    const c = this.paints.resolveColor(ctx.resolve, id, node.color) ?? [0, 0, 0, 1]
    const p = new ck.Paint()
    p.setAntiAlias(true)
    p.setStyle(ck.PaintStyle.Stroke)
    p.setStrokeWidth(Math.max(1, Math.min(w, h) / 12))
    p.setColor(this.paints.color([c[0], c[1], c[2], c[3] * 0.6]))
    const inset = Math.min(w, h) * 0.15
    canvas.drawRRect(this.rrect(inset, inset, w - 2 * inset, h - 2 * inset, [2, 2, 2, 2]), p)
    p.delete()
    counters.draws++
  }

  private placeholder(canvas: Canvas, w: number, h: number, counters: DrawCounters): void {
    const ck = this.ck
    const p = new ck.Paint()
    p.setAntiAlias(true)
    p.setColor(this.paints.color(PLACEHOLDER_FILL))
    canvas.drawRect(ck.LTRBRect(0, 0, w, h), p)
    p.setStyle(ck.PaintStyle.Stroke)
    p.setStrokeWidth(1)
    p.setColor(this.paints.color(PLACEHOLDER_STROKE))
    const dash = ck.PathEffect.MakeDash([4, 4], 0)
    p.setPathEffect(dash)
    canvas.drawRect(ck.LTRBRect(0.5, 0.5, w - 0.5, h - 0.5), p)
    dash.delete()
    p.delete()
    counters.draws += 2
  }

  /** Image srcs used by a subtree (export waits for them). */
  imagesOf(ctx: PaintContext, id: string, out: Set<string> = new Set()): Set<string> {
    const n = ctx.nodes.getNode(id)
    if (!n) return out
    for (const s of imageSources(n.fill)) out.add(s)
    if (isObject(n.stroke)) for (const s of imageSources(n.stroke.paint)) out.add(s)
    for (const c of this.children(ctx, id)) this.imagesOf(ctx, c, out)
    return out
  }
}
