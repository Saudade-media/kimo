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
import { invert, resolveNum, resolveRadii, toCk, union } from "./geometry"
import type { IconRegistry } from "./icons/registry"
import { applyBlend, imageSources, isNonNormalBlend, type PaintFactory, paintList } from "./paint"
import {
  normalizeDash,
  outerFraction,
  type Sides,
  type StrokeAlign,
  StrokeGeometry,
  type StrokeStyle,
} from "./stroke"
import type { TextEngine, TextFill } from "./text"
import type { Rect } from "./types"

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
  /**
   * Filtered / blended layers recorded (background blur, layer blur, layer shadows, blend
   * layers): GPU work paid on every replay, so the renderer caches such roots as rasters while
   * the viewport moves.
   */
  layers?: number
  /** Icon glyphs still loading when recorded (the picture must be redrawn when they land). */
  pendingIcons?: number
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
    private readonly icons: IconRegistry | null = null,
  ) {
    this.strokes = new StrokeGeometry(ck)
  }

  private readonly strokes: StrokeGeometry

  /** Children of `id` that the layout laid out, in sibling order. */
  children(ctx: PaintContext, id: string): string[] {
    return ctx.nodes.children(id).filter((c) => ctx.layout.nodes.has(c))
  }

  /** Nesting depth of `drawNode` (memos below live for one top-level call). */
  private depth = 0
  /** Per top-level draw: does a subtree contain a non-normal blend (needs an isolated group)? */
  private readonly blendMemo = new Map<string, boolean>()

  /** Draws `id` and its subtree. The canvas matrix must be the world → device matrix. */
  drawNode(canvas: Canvas, ctx: PaintContext, id: string, counters: DrawCounters): void {
    if (this.depth === 0) this.blendMemo.clear()
    this.depth++
    try {
      this.drawOne(canvas, ctx, id, counters)
    } finally {
      this.depth--
    }
  }

  private drawOne(canvas: Canvas, ctx: PaintContext, id: string, counters: DrawCounters): void {
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

    // Layer blend (spec §5.3): frames/groups composite their subtree as an isolated group,
    // except `pass-through`; on other nodes `pass-through` is `normal`.
    const blendName = typeof node.blend === "string" ? node.blend : "normal"
    const container = node.type === "frame" || node.type === "group"
    const layerBlend = isNonNormalBlend(blendName) ? blendName : null
    const isolate =
      container && blendName === "normal" && children.length > 0 && this.needsIsolation(ctx, id)

    canvas.save()
    canvas.concat(toCk(T))

    // Background blur reads what is already drawn, so it goes before any layer of this node
    // (inside an opacity/blend layer the backdrop would be the empty layer).
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
      counters.layers = (counters.layers ?? 0) + 1
    }

    let layers = 0
    const layerShadows = !geoShadows && shadows.some((s) => !s.inner)
    if (opacity < 1 || blur || layerShadows || layerBlend || isolate) {
      const p = new ck.Paint()
      p.setAlphaf(opacity)
      if (layerBlend) applyBlend(ck, p, layerBlend)
      const filter = this.layerFilter(ctx, id, blur ?? null, layerShadows ? shadows : [])
      if (filter) p.setImageFilter(filter)
      canvas.saveLayer(p)
      p.delete()
      filter?.delete()
      layers++
      counters.draws++
      if (filter || layerBlend) counters.layers = (counters.layers ?? 0) + 1
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

  /** True when a descendant of `id` blends non-normally (node, paint or shadow blend). */
  private needsIsolation(ctx: PaintContext, id: string): boolean {
    for (const c of this.children(ctx, id)) if (this.blendsInside(ctx, c)) return true
    return false
  }

  private blendsInside(ctx: PaintContext, id: string): boolean {
    const memo = this.blendMemo.get(id)
    if (memo !== undefined) return memo
    const n = ctx.nodes.getNode(id)
    let r = false
    if (n && n.visible !== false) {
      const paintBlends = (v: unknown) =>
        (paintList(v) ?? []).some((p) => isObject(p) && isNonNormalBlend(p.blend))
      r =
        isNonNormalBlend(n.blend) ||
        paintBlends(n.fill) ||
        (isObject(n.stroke) && paintBlends(n.stroke.paint)) ||
        (Array.isArray(n.effects) &&
          n.effects.some((e) => isObject(e) && e.visible !== false && isNonNormalBlend(e.blend)))
      // A pass-through child's descendants blend into this group too; an isolated child
      // (any other blend) still blends itself, counted above.
      if (!r && (n.type === "frame" || n.type === "group"))
        r = this.children(ctx, id).some((c) => this.blendsInside(ctx, c))
    }
    this.blendMemo.set(id, r)
    return r
  }

  /**
   * Image filter of a node layer: layer blur, then (for shapes without a fill geometry: text,
   * groups, unfilled frames, icons) outer shadows cast by the layer's alpha, `spread` applied
   * with a morphology dilate/erode. Shadows are drawn under the content in list order.
   */
  private layerFilter(
    ctx: PaintContext,
    id: string,
    blur: BlurFx | null,
    shadows: readonly ShadowFx[],
  ): ImageFilter | null {
    const ck = this.ck
    const src = (): ImageFilter | null =>
      blur && blur.radius > 0
        ? ck.ImageFilter.MakeBlur(blur.radius / 2, blur.radius / 2, ck.TileMode.Decal, null)
        : null
    let under: ImageFilter | null = null
    for (const s of shadows) {
      if (s.inner) continue
      const c = this.paints.resolveColor(ctx.resolve, id, s.color)
      if (!c) continue
      let input = src()
      if (s.spread !== 0) {
        const r = Math.abs(s.spread)
        const m: ImageFilter =
          s.spread > 0
            ? ck.ImageFilter.MakeDilate(r, r, input)
            : ck.ImageFilter.MakeErode(r, r, input)
        input?.delete()
        input = m
      }
      // Skia keeps its own reference to an input filter: free each JS handle after use.
      const shadow: ImageFilter = ck.ImageFilter.MakeDropShadowOnly(
        s.x,
        s.y,
        s.blur / 2,
        s.blur / 2,
        this.paints.color(c),
        input,
      )
      input?.delete()
      if (under) {
        const both: ImageFilter = ck.ImageFilter.MakeBlend(ck.BlendMode.SrcOver, under, shadow)
        under.delete()
        shadow.delete()
        under = both
      } else under = shadow
    }
    const content = src()
    if (!under) return content
    const out: ImageFilter = ck.ImageFilter.MakeBlend(ck.BlendMode.SrcOver, under, content)
    under.delete()
    content?.delete()
    return out
  }

  /**
   * Conservative world-space ink bounds of `ids` (a recorded root's nodes): each laid-out box
   * (text: its measured paragraph too) grown by what draws outside it — outer shadows (offset +
   * 3σ blur + spread), layer blur (3σ), strokes (outside / centered part, miter-extended on
   * paths). Used to bound pictures whose Skia cull rect is unbounded (a background-blur layer
   * records as infinite), so they still cull and fit the zoomed-out raster cache.
   */
  inkBounds(ctx: PaintContext, ids: readonly string[]): Rect | null {
    let out: Rect | null = null
    for (const id of ids) {
      const l = ctx.layout.nodes.get(id)
      const node = ctx.nodes.getNode(id)
      if (!l || !node || !l.visible) continue
      let o = 1
      for (const e of this.effects(ctx.resolve, id, node.effects)) {
        if (e.kind === "shadow") {
          if (!e.inner)
            o = Math.max(o, Math.abs(e.x) + Math.abs(e.y) + 1.5 * e.blur + Math.max(0, e.spread))
        } else if (e.kind === "blur") o += 1.5 * e.radius
      }
      const s = node.stroke
      if (isObject(s)) {
        const wv = s.width
        const width =
          isObject(wv) && !isRef(wv)
            ? Math.max(0, ...[wv.t, wv.r, wv.b, wv.l].map((v) => resolveNum(ctx.resolve, id, v, 0)))
            : Math.max(0, resolveNum(ctx.resolve, id, wv, 1))
        const f = s.align === "outside" ? 1 : s.align === "center" ? 0.5 : 0
        const miter = Math.max(1, resolveNum(ctx.resolve, id, s.miterLimit, 4))
        // Open paths are stroked centered whatever the align; joins can reach miterLimit × w/2.
        o +=
          node.type === "path" || node.type === "polygon"
            ? width * Math.max(f, 0.5) * miter
            : width * f
      }
      // Text can overflow its box (fixed sizes; glyph overhang): grow by the overflow + 2 px.
      if (l.text) o += 2 + Math.max(0, l.text.w - l.local.w, l.text.h - l.local.h)
      const b = l.world
      out = union(out, { x: b.x - o, y: b.y - o, w: b.w + 2 * o, h: b.h + 2 * o })
    }
    return out
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
      if (!isObject(e) || e.visible === false) continue
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
    applyBlend(ck, p, blend)
    if (blur > 0) {
      const mf = ck.MaskFilter.MakeBlur(ck.BlurStyle.Normal, blur / 2, true)
      p.setMaskFilter(mf)
      mf.delete()
    }
    return p
  }

  /** Geometry of `geo` grown by `spread` (rrect/oval exactly; paths by a disk offset). */
  private spreadGeo(
    geo: Geo,
    spread: number,
  ): { draw: (c: Canvas, p: Paint) => void; path: () => Path } {
    const ck = this.ck
    if (geo.kind === "path") {
      if (spread === 0)
        return { draw: (c, p) => c.drawPath(geo.path, p), path: () => geo.path.copy() }
      return {
        draw: (c, p) => {
          const grown = this.strokes.offset(geo.path, spread)
          c.drawPath(grown, p)
          grown.delete()
        },
        path: () => this.strokes.offset(geo.path, spread),
      }
    }
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
    let align: StrokeAlign = s.align === "center" || s.align === "outside" ? s.align : "inside"
    let sides: Sides
    const perSide = isObject(s.width) && !isRef(s.width)
    if (perSide) {
      const sw = s.width as Record<string, unknown>
      sides = [sw.t, sw.r, sw.b, sw.l].map((v) =>
        Math.max(0, resolveNum(resolve, id, v, 0)),
      ) as Sides
    } else {
      const v = Math.max(0, resolveNum(resolve, id, s.width, 1))
      sides = [v, v, v, v]
    }
    const style: StrokeStyle = {
      cap: s.cap === "round" || s.cap === "square" ? s.cap : "butt",
      join: s.join === "round" || s.join === "bevel" ? s.join : "miter",
      miterLimit: Math.max(1, resolveNum(resolve, id, s.miterLimit, 4)),
      dash: normalizeDash(s.dash),
    }
    const done = () => {
      for (const p of paints) p.delete()
    }
    const uniform = sides.every((v) => v === sides[0])

    if (geo.kind === "rrect" && !style.dash) {
      // Exact inside/center/outside (uniform or per side) via a double rounded rect.
      this.doubleRRect(canvas, geo, sides, align, paints, counters)
      done()
      return
    }

    if (geo.kind === "rrect" && !uniform) {
      // Dashed per-side: each side its own open segment (spec §7.2).
      const effect = this.strokes.dashEffect(style)
      for (const seg of this.strokes.sideSegments(w, h, geo.radii, sides, align)) {
        for (const p of paints) {
          this.strokes.configure(p, seg.width, style, effect)
          canvas.drawPath(seg.path, p)
          counters.draws++
        }
        seg.path.delete()
      }
      effect?.delete()
      done()
      return
    }

    // Uniform width on any shape (per-side widths on non-rect shapes use the widest side).
    const width = Math.max(...sides)
    if (width <= 0) {
      done()
      return
    }
    let path = this.geoPath(geo)
    // Open contours have no inside: they are stroked centered.
    if (geo.kind === "path" && align !== "center" && !this.strokes.isClosed(path)) align = "center"
    if (style.dash && align !== "center") {
      // Dashed inside/outside: stroke the centerline (the shape moved by half the width) so
      // dash lengths and caps keep their size; a doubled, clipped stroke would double caps.
      const d = (align === "inside" ? 1 : -1) * (width / 2)
      const center = this.insetGeoPath(geo, path, d)
      path.delete()
      path = center
      align = "center"
    }
    canvas.save()
    if (align === "inside") this.clip(canvas, geo)
    else if (align === "outside") this.clip(canvas, geo, ck.ClipOp.Difference)
    const effect = this.strokes.dashEffect(style)
    for (const p of paints) {
      this.strokes.configure(p, align === "center" ? width : width * 2, style, effect)
      canvas.drawPath(path, p)
      counters.draws++
    }
    effect?.delete()
    canvas.restore()
    path.delete()
    done()
  }

  /** `geo`'s outline moved inward by `d` (outward when negative). */
  private insetGeoPath(geo: Geo, path: Path, d: number): Path {
    const ck = this.ck
    if (geo.kind === "path") return this.strokes.offset(path, -d, "miter")
    const pb = new ck.PathBuilder()
    const w = Math.max(0, geo.w - 2 * d)
    const h = Math.max(0, geo.h - 2 * d)
    if (geo.kind === "oval") pb.addOval(ck.LTRBRect(d, d, d + w, d + h))
    else
      pb.addRRect(
        this.rrect(d, d, w, h, geo.radii.map((r) => (r > 0 ? Math.max(0, r - d) : 0)) as Radii),
      )
    return pb.detachAndDelete()
  }

  private doubleRRect(
    canvas: Canvas,
    geo: Extract<Geo, { kind: "rrect" }>,
    sides: Sides,
    align: StrokeAlign,
    paints: Paint[],
    counters: DrawCounters,
  ): void {
    const { w, h } = geo
    const f = outerFraction(align)
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
    const inner =
      iw > 0 && ih > 0
        ? this.rrect(
            i.l,
            i.t,
            iw,
            ih,
            [grow(R[0], -i.t), grow(R[1], -i.t), grow(R[2], -i.b), grow(R[3], -i.b)],
            [grow(R[0], -i.l), grow(R[1], -i.r), grow(R[2], -i.r), grow(R[3], -i.l)],
          )
        : null
    if (t + r + b + l <= 0) return
    for (const p of paints) {
      counters.draws++
      if (inner) canvas.drawDRRect(outer, inner, p)
      else canvas.drawRRect(outer, p)
    }
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

  /** `[set, name, weight]` of an icon node, or null when unresolvable. */
  iconRef(
    ctx: PaintContext,
    id: string,
    node: LayoutNodeData,
  ): [string, string, number | undefined] | null {
    const name = isRef(node.icon) ? ctx.resolve.value(id, node.icon) : node.icon
    if (typeof node.set !== "string" || typeof name !== "string") return null
    const wv = node.weight === undefined ? undefined : resolveNum(ctx.resolve, id, node.weight, 400)
    return [node.set, name, wv]
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
    const ck = this.ck
    const c = this.paints.resolveColor(ctx.resolve, id, node.color) ?? [0, 0, 0, 1]
    const ref = this.iconRef(ctx, id, node)
    const found = ref && this.icons ? this.icons.lookup(ref[0], ref[1], ref[2]) : null
    if (found?.status === "loading") {
      counters.pendingIcons = (counters.pendingIcons ?? 0) + 1
      return
    }
    if (!found || found.status === "missing") {
      // Missing glyph (unknown set/name): an outlined box in the icon color.
      const p = new ck.Paint()
      p.setAntiAlias(true)
      p.setStyle(ck.PaintStyle.Stroke)
      p.setStrokeWidth(Math.max(1, Math.min(w, h) / 12))
      p.setColor(this.paints.color([c[0], c[1], c[2], c[3] * 0.6]))
      const inset = Math.min(w, h) * 0.15
      canvas.drawRRect(this.rrect(inset, inset, w - 2 * inset, h - 2 * inset, [2, 2, 2, 2]), p)
      p.delete()
      counters.draws++
      return
    }
    const { glyph, paths } = found
    const [vx, vy, vw, vh] = glyph.viewBox
    if (!(vw > 0 && vh > 0)) return
    const sw = Math.max(
      0,
      node.strokeWidth === undefined
        ? (glyph.strokeWidth ?? 2)
        : resolveNum(ctx.resolve, id, node.strokeWidth, glyph.strokeWidth ?? 2),
    )
    canvas.save()
    canvas.scale(w / vw, h / vh)
    canvas.translate(-vx, -vy)
    const p = new ck.Paint()
    p.setAntiAlias(true)
    glyph.paths.forEach((gp, i) => {
      const path = paths[i]
      if (!path) return
      p.setColor(this.paints.color([c[0], c[1], c[2], c[3] * (gp.opacity ?? 1)]))
      if (gp.paint === "stroke") {
        if (sw <= 0) return
        p.setStyle(ck.PaintStyle.Stroke)
        p.setStrokeWidth(sw)
        p.setStrokeCap(ck.StrokeCap.Round)
        p.setStrokeJoin(ck.StrokeJoin.Round)
      } else p.setStyle(ck.PaintStyle.Fill)
      canvas.drawPath(path, p)
      counters.draws++
    })
    p.delete()
    canvas.restore()
  }

  /** Icon glyphs used by a subtree (export waits for them). */
  iconsOf(
    ctx: PaintContext,
    id: string,
    out: [string, string, number | undefined][] = [],
  ): [string, string, number | undefined][] {
    const n = ctx.nodes.getNode(id)
    if (!n) return out
    if (n.type === "icon") {
      const r = this.iconRef(ctx, id, n)
      if (r) out.push(r)
    }
    for (const c of this.children(ctx, id)) this.iconsOf(ctx, c, out)
    return out
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
