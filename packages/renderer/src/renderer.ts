/**
 * The CanvasKit `Renderer` (ADR 0004, ADR 0009). Per-root SkPicture caching: each top-level
 * node's subtree is recorded once (in world space) and replayed every frame, so pan/zoom only
 * re-plays pictures; roots outside the viewport are culled. Pictures are dropped when a node
 * of the subtree changes identity (frozen `NodeData`), moves (`LayoutResult.changed`), or is
 * invalidated, and when fonts or images arrive.
 *
 * Perf gate (M1, 5k nodes at 60 fps; apps/web/e2e/perf): zoomed out on WebGL, each root is drawn
 * from a cached raster of its picture (one textured quad instead of thousands of replayed ops),
 * and once something is on screen, picture recording and rasterizing are time-budgeted per
 * frame so never-drawn roots fill in over a few frames instead of blocking one.
 */
import type { LayoutResult, ResolveHeader, TextMeasurer } from "@kimo/layout"
import { resolveText } from "@kimo/layout"
import type { Canvas, CanvasKit, Image, SkPicture, Surface } from "canvaskit-wasm"
import { isBrowser, loadCanvasKit } from "./ck"
import { parseColor } from "./color"
import { type DrawCounters, type PaintContext, Painter } from "./draw"
import { CkFontProvider } from "./fonts"
import { intersects, union } from "./geometry"
import { HitIndex } from "./hit-test"
import { DEFAULT_OVERLAY_THEME, OverlayPainter } from "./overlay"
import { ImageCache, PaintFactory } from "./paint"
import { TextEngine } from "./text"
import {
  type AttachOptions,
  type CreateRendererOptions,
  type FontProvider,
  type HitTestOptions,
  type HitTestRectOptions,
  type Overlay,
  type OverlayTheme,
  type Point,
  type RasterExportOptions,
  type Rect,
  type Renderer,
  RendererError,
  type RendererInitOptions,
  type RenderScene,
  type RenderStats,
  type Viewport,
} from "./types"

interface RootEntry {
  ids: string[]
  /** NodeData identities at record time (frozen store objects change identity on edit). */
  data: unknown[]
  picture: SkPicture | null
  bounds: Rect | null
  nodes: number
  draws: number
  /** Zoomed-out raster of `picture` (see {@link RASTER_MAX_SCALE}); dropped with it. */
  raster: RootRaster | null
  /** Frame number this root was last drawn (raster cache eviction). */
  used: number
}

/** A root picture rasterized at `scale` device px per world px, covering world `x,y,w,h`. */
interface RootRaster {
  image: Image
  scale: number
  x: number
  y: number
  w: number
  h: number
  /** Pixel count (memory budget). */
  px: number
}

/**
 * Zoomed-out raster cache. Below this device scale (zoom × dpr) every root is drawn from a
 * cached image (one textured quad) instead of replaying its picture: replaying thousands of
 * small draw ops costs more CPU than the frame budget allows once a 5k-node document is fully
 * visible. Above it, pictures stay crisp and culling keeps the op count low.
 */
export const RASTER_MAX_SCALE = 0.5
/** Roots whose raster would exceed this many px per side are replayed instead. */
const RASTER_MAX_SIDE = 4096
/** Total cached raster pixels (≈ 4 bytes each) before rasters unused this frame are evicted. */
const RASTER_BUDGET_PX = 32 * 1024 * 1024
/** CPU ms per frame spent creating rasters; the rest of the roots replay and fill in later. */
const RASTER_FRAME_MS = 6
/**
 * CPU ms per frame spent recording root pictures on WebGL once some are on screen. Once spent,
 * further unrecorded roots wait for the next frame, so zooming out over never-drawn parts of a
 * 5k-node document fills in over a few frames instead of blocking one for ~100 ms. Headless/CPU
 * surfaces record everything (one `render()` must produce the full image for snapshots).
 */
const RECORD_FRAME_MS = 10
/** Raster scales are powers of two ≥ the device scale, so a raster is downsampled ≤ 2×. */
const rasterBucket = (s: number) => 2 ** Math.max(-8, Math.ceil(Math.log2(s)))

type Backend = RenderStats["backend"]

const EMPTY_OVERLAY: Overlay = { selection: [], hovered: null, marquee: null }

/** CanvasKit renderer. Exported as a class for headless hosts (`attachRaster`, `snapshot`). */
export class CanvasKitRenderer implements Renderer {
  private ck: CanvasKit | null = null
  private initPromise: Promise<void> | null = null
  /** Bumped by `dispose()`: an `init` still in flight from before must not adopt its results. */
  private generation = 0
  private fontProvider: CkFontProvider | null = null
  private textEngine: TextEngine | null = null
  private images: ImageCache | null = null
  private painter: Painter | null = null
  private overlayPainter: OverlayPainter | null = null
  private theme: OverlayTheme = DEFAULT_OVERLAY_THEME

  private scene: RenderScene | null = null
  private layout: LayoutResult | null = null
  private viewport: Viewport = { x: 0, y: 0, zoom: 1 }
  private overlay: Overlay = EMPTY_OVERLAY
  private roots = new Map<string, RootEntry>()
  private rootOrder: string[] = []
  private hitIndex: HitIndex | null = null

  private surface: Surface | null = null
  private canvasEl: HTMLCanvasElement | OffscreenCanvas | null = null
  private backend: Backend = "raster"
  private cssW = 0
  private cssH = 0
  private dpr = 1
  private contextLosses = 0
  private removeListeners: (() => void) | null = null
  private framePending = false

  /**
   * Zoomed-out raster cache: `true` (default) on WebGL only, `false` off, `"always"` on every
   * surface (tests: CPU surfaces otherwise never use it).
   */
  rasterCache: boolean | "always" = true
  private rasterPx = 0

  private frameTimes: number[] = []
  private frameStamps: number[] = []
  private frames = 0
  private last = { frameMs: 0, drawCalls: 0, nodesDrawn: 0, nodesCulled: 0 }

  constructor(
    private readonly options: CreateRendererOptions = {},
    private readonly defaultWasmUrl?: string,
  ) {}

  // --- lifecycle ----------------------------------------------------------------------------

  init(options: RendererInitOptions = {}): Promise<void> {
    if (options.overlayTheme) this.theme = options.overlayTheme
    if (this.fontProvider) {
      if (options.fontSources) this.fontProvider.sources = options.fontSources
      if (options.offlineFonts !== undefined) this.fontProvider.offline = options.offlineFonts
    }
    if (this.initPromise) return this.initPromise
    const p: Promise<void> = (async () => {
      // `dispose()` during init bumps the generation: late results are freed, never adopted.
      const gen = this.generation
      const disposed = () =>
        new RendererError("NOT_INITIALIZED", "Renderer was disposed while initializing")
      const ck = await loadCanvasKit(options.canvaskitWasmUrl ?? this.defaultWasmUrl)
      if (gen !== this.generation) throw disposed()
      const fonts = new CkFontProvider(ck)
      fonts.sources = options.fontSources ?? []
      fonts.offline = options.offlineFonts ?? false
      try {
        await fonts.loadBundled()
      } catch (e) {
        fonts.dispose()
        throw new RendererError("WASM_LOAD_FAILED", `bundled fonts failed to load: ${String(e)}`)
      }
      if (gen !== this.generation) {
        fonts.dispose()
        throw disposed()
      }
      const text = new TextEngine(ck, fonts)
      const images = new ImageCache(ck, () => this.dropAll(false))
      if (this.scene) images.assets = this.scene.assets
      this.ck = ck
      this.fontProvider = fonts
      this.textEngine = text
      this.images = images
      this.painter = new Painter(ck, new PaintFactory(ck, images), text)
      this.overlayPainter = new OverlayPainter(ck, text)
      fonts.onFontLoaded(() => {
        text.invalidate()
        this.dropAll(false)
      })
    })().catch((e) => {
      // Only forget this attempt (a dispose + new init may have started another).
      if (this.initPromise === p) this.initPromise = null
      throw e
    })
    this.initPromise = p
    return p
  }

  private need(): {
    ck: CanvasKit
    painter: Painter
    text: TextEngine
    fonts: CkFontProvider
    images: ImageCache
  } {
    if (!this.ck || !this.painter || !this.textEngine || !this.fontProvider || !this.images)
      throw new RendererError("NOT_INITIALIZED", "Renderer.init() has not completed")
    return {
      ck: this.ck,
      painter: this.painter,
      text: this.textEngine,
      fonts: this.fontProvider,
      images: this.images,
    }
  }

  get fonts(): FontProvider {
    return this.need().fonts
  }

  attach(canvas: HTMLCanvasElement | OffscreenCanvas, options: AttachOptions = {}): void {
    this.need()
    this.detach()
    this.canvasEl = canvas
    this.dpr = options.dpr ?? (globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1
    this.cssW = canvas.width / this.dpr
    this.cssH = canvas.height / this.dpr
    this.contextLosses = 0
    this.makeSurface(options.software === true)
    if (typeof (canvas as HTMLCanvasElement).addEventListener === "function") {
      const lost = (e: Event) => {
        e.preventDefault()
        this.contextLosses++
        // Free the dead context's surface (and the rasters tied to it) now: `makeSurface`
        // only sees `this.surface`, so nulling it without deleting leaked it in wasm memory.
        this.dropRasters()
        try {
          this.surface?.delete()
        } catch {
          // The GL context is gone; the wasm-side objects are still released.
        }
        this.surface = null
        if (this.contextLosses >= 2) {
          this.options.onError?.(
            new RendererError("CONTEXT_LOST", "WebGL context lost twice; using software"),
          )
          this.makeSurface(true)
          this.requestFrame()
        }
      }
      const restored = () => {
        if (this.backend === "webgl" || !this.surface) {
          this.makeSurface(false)
          this.requestFrame()
        }
      }
      canvas.addEventListener("webglcontextlost", lost as EventListener)
      canvas.addEventListener("webglcontextrestored", restored)
      this.removeListeners = () => {
        canvas.removeEventListener("webglcontextlost", lost as EventListener)
        canvas.removeEventListener("webglcontextrestored", restored)
      }
    }
    this.requestFrame()
  }

  private makeSurface(software: boolean): void {
    const { ck } = this.need()
    const canvas = this.canvasEl
    if (!canvas) return
    this.dropRasters()
    this.surface?.delete()
    this.surface = null
    if (!software) {
      try {
        this.surface = ck.MakeWebGLCanvasSurface(canvas)
      } catch {
        this.surface = null
      }
      if (this.surface) {
        this.backend = "webgl"
        return
      }
      this.options.onError?.(
        new RendererError("WEBGL_UNAVAILABLE", "WebGL surface unavailable; using software"),
      )
    }
    this.surface = ck.MakeSWCanvasSurface(canvas)
    this.backend = "software"
  }

  /** Headless: draws frames into an offscreen CPU raster surface (`width × height` CSS px). */
  attachRaster(width: number, height: number, dpr = 1): void {
    const { ck } = this.need()
    this.detach()
    this.cssW = width
    this.cssH = height
    this.dpr = dpr
    this.surface = ck.MakeSurface(
      Math.max(1, Math.round(width * dpr)),
      Math.max(1, Math.round(height * dpr)),
    )
    this.backend = "raster"
  }

  resize(width: number, height: number, dpr: number = this.dpr): void {
    this.cssW = width
    this.cssH = height
    this.dpr = dpr
    if (this.canvasEl) {
      this.canvasEl.width = Math.max(1, Math.round(width * dpr))
      this.canvasEl.height = Math.max(1, Math.round(height * dpr))
      this.makeSurface(this.backend === "software")
    } else if (this.surface) this.attachRaster(width, height, dpr)
    this.requestFrame()
  }

  detach(): void {
    this.removeListeners?.()
    this.removeListeners = null
    this.dropRasters()
    this.surface?.delete()
    this.surface = null
    this.canvasEl = null
  }

  dispose(): void {
    this.generation++
    this.detach()
    this.dropAll(false)
    this.textEngine?.dispose()
    this.images?.clear()
    this.fontProvider?.dispose()
    this.ck = null
    this.painter = null
    this.textEngine = null
    this.images = null
    this.fontProvider = null
    this.overlayPainter = null
    this.initPromise = null
  }

  // --- state --------------------------------------------------------------------------------

  setDocument(scene: RenderScene): void {
    this.scene = scene
    if (this.images) this.images.assets = scene.assets
    this.textEngine?.invalidate()
    this.dropAll(false)
    this.hitIndex = null
  }

  invalidate(nodeIds?: Iterable<string>): void {
    this.hitIndex = null
    if (!nodeIds) {
      this.textEngine?.invalidate()
      this.dropAll(true)
      return
    }
    const ids = [...nodeIds]
    this.textEngine?.invalidate(ids)
    const set = new Set(ids)
    for (const e of this.roots.values())
      if (e.picture && e.ids.some((id) => set.has(id))) this.drop(e)
    this.requestFrame()
  }

  setLayout(layout: LayoutResult): void {
    if (this.layout === layout) return
    this.layout = layout
    this.hitIndex = null
    const nodes = this.scene?.nodes
    // Group paint order into root subtrees (order is depth-first, parents first).
    const rootOf = new Map<string, string>()
    const next = new Map<string, string[]>()
    const order: string[] = []
    for (const id of layout.order) {
      const parent = nodes?.getNode(id)?.parent
      const root = (typeof parent === "string" && rootOf.get(parent)) || id
      rootOf.set(id, root)
      let list = next.get(root)
      if (!list) {
        list = []
        next.set(root, list)
        order.push(root)
      }
      list.push(id)
    }
    for (const [root, e] of this.roots)
      if (!next.has(root)) {
        this.drop(e)
        this.roots.delete(root)
      }
    for (const [root, ids] of next) {
      const prev = this.roots.get(root)
      if (prev?.picture) {
        const same =
          prev.ids.length === ids.length &&
          prev.ids.every(
            (id, i) =>
              id === ids[i] && nodes?.getNode(id) === prev.data[i] && !layout.changed.has(id),
          )
        if (!same) this.drop(prev)
        prev.ids = ids
      } else
        this.roots.set(root, {
          ids,
          data: [],
          picture: null,
          bounds: null,
          nodes: ids.length,
          draws: 0,
          raster: null,
          used: 0,
        })
    }
    this.rootOrder = order
    this.requestFrame()
  }

  setViewport(viewport: Viewport): void {
    this.viewport = { ...viewport }
    this.requestFrame()
  }

  setOverlay(overlay: Overlay): void {
    this.overlay = overlay
    this.requestFrame()
  }

  private drop(e: RootEntry): void {
    e.picture?.delete()
    e.picture = null
    e.bounds = null
    this.dropRaster(e)
  }

  private dropRaster(e: RootEntry): void {
    if (!e.raster) return
    e.raster.image.delete()
    this.rasterPx -= e.raster.px
    e.raster = null
  }

  /** Rasters belong to the surface's GPU context: dropped when the surface changes. */
  private dropRasters(): void {
    for (const e of this.roots.values()) this.dropRaster(e)
    this.rasterPx = 0
  }

  /** Rasterizes `pic` at device scale `scale` into an image compatible with the surface. */
  private rasterize(e: RootEntry, pic: SkPicture, bounds: Rect, scale: number): RootRaster | null {
    const { ck } = this.need()
    const surface = this.surface
    if (!surface) return null
    // One device pixel of margin around the picture bounds keeps edges anti-aliased.
    const pad = 1 / scale
    const x = bounds.x - pad
    const y = bounds.y - pad
    const W = Math.ceil((bounds.w + 2 * pad) * scale)
    const H = Math.ceil((bounds.h + 2 * pad) * scale)
    if (W < 1 || H < 1 || W > RASTER_MAX_SIDE || H > RASTER_MAX_SIDE) return null
    let off: Surface | null = null
    try {
      off = surface.makeSurface({ ...surface.imageInfo(), width: W, height: H })
    } catch {
      off = null
    }
    if (!off) return null
    let image: Image
    try {
      const c = off.getCanvas()
      c.clear(ck.TRANSPARENT)
      c.scale(scale, scale)
      c.translate(-x, -y)
      c.drawPicture(pic)
      // Flush so the GPU work is paid (and timed against the frame budget) now, not at present.
      off.flush()
      image = off.makeImageSnapshot()
    } finally {
      off.delete()
    }
    this.dropRaster(e)
    e.raster = { image, scale, x, y, w: W / scale, h: H / scale, px: W * H }
    this.rasterPx += W * H
    return e.raster
  }

  /** Evicts least recently drawn rasters (never this frame's) above the pixel budget. */
  private evictRasters(): void {
    if (this.rasterPx <= RASTER_BUDGET_PX) return
    const old = [...this.roots.values()]
      .filter((e) => e.raster && e.used !== this.frames)
      .sort((a, b) => a.used - b.used)
    for (const e of old) {
      if (this.rasterPx <= RASTER_BUDGET_PX) break
      this.dropRaster(e)
    }
  }

  private dropAll(frame: boolean): void {
    for (const e of this.roots.values()) this.drop(e)
    if (frame || this.surface) this.requestFrame()
  }

  // --- drawing ------------------------------------------------------------------------------

  private context(): PaintContext | null {
    const s = this.scene
    const layout = this.layout
    if (!s || !layout) return null
    const header = typeof s.header === "function" ? s.header : () => s.header as ResolveHeader
    return { nodes: s.nodes, header, resolve: s.resolve, layout }
  }

  private picture(ctx: PaintContext, root: string, e: RootEntry): SkPicture | null {
    if (e.picture) return e.picture
    const { ck, painter } = this.need()
    const rec = new ck.PictureRecorder()
    const counters: DrawCounters = { nodes: 0, draws: 0 }
    try {
      const c = rec.beginRecording(ck.LTRBRect(-1e7, -1e7, 1e7, 1e7), true)
      painter.drawNode(c, ctx, root, counters)
      e.picture = rec.finishRecordingAsPicture()
    } finally {
      rec.delete()
    }
    e.nodes = counters.nodes
    e.draws = counters.draws
    e.data = e.ids.map((id) => ctx.nodes.getNode(id))
    const cull = e.picture.cullRect()
    let bounds: Rect | null = null
    if (cull && (cull[2] ?? 0) > (cull[0] ?? 0)) {
      bounds = {
        x: cull[0] ?? 0,
        y: cull[1] ?? 0,
        w: (cull[2] ?? 0) - (cull[0] ?? 0),
        h: (cull[3] ?? 0) - (cull[1] ?? 0),
      }
    } else
      for (const id of e.ids) {
        const l = ctx.layout.nodes.get(id)
        if (l) bounds = union(bounds, l.world)
      }
    e.bounds = bounds
    return e.picture
  }

  /** Draws document + overlays into `canvas` (device space = CSS px × dpr). */
  private drawFrame(canvas: Canvas): void {
    const { ck } = this.need()
    const bg = this.scene?.background ? parseColor(this.scene.background) : null
    canvas.clear(bg ? ck.Color4f(bg[0], bg[1], bg[2], bg[3]) : ck.TRANSPARENT)
    const v = this.viewport
    const ctx = this.context()
    let drawn = 0
    let culled = 0
    let draws = 0
    if (ctx) {
      canvas.save()
      canvas.scale(this.dpr, this.dpr)
      canvas.scale(v.zoom, v.zoom)
      canvas.translate(-v.x, -v.y)
      const visible: Rect = { x: v.x, y: v.y, w: this.cssW / v.zoom, h: this.cssH / v.zoom }
      const scale = v.zoom * this.dpr
      // GPU only: on CPU surfaces blitting a filtered image costs more than replaying the ops.
      const bucket =
        (this.rasterCache === "always" || (this.rasterCache && this.backend === "webgl")) &&
        scale <= RASTER_MAX_SCALE
          ? rasterBucket(scale)
          : 0
      const now = () => (globalThis.performance ?? Date).now()
      let rasterMs = 0
      let recordMs = 0
      // Progressive only once something is on screen: an opening document draws completely
      // in its first frame (the fastest path to a full canvas).
      let progressive = false
      if (this.backend === "webgl")
        for (const e of this.roots.values())
          if (e.picture) {
            progressive = true
            break
          }
      let behind = false
      for (const root of this.rootOrder) {
        const e = this.roots.get(root)
        if (!e) continue
        const l = ctx.layout.nodes.get(root)
        if (l && !l.visible) continue
        if (!e.picture) {
          // Not recorded yet: cull by layout boxes (+ a margin for shadows/strokes) first.
          let lb: Rect | null = null
          for (const id of e.ids) {
            const nl = ctx.layout.nodes.get(id)
            if (nl) lb = union(lb, nl.world)
          }
          const m = 256
          if (
            lb &&
            !intersects({ x: lb.x - m, y: lb.y - m, w: lb.w + 2 * m, h: lb.h + 2 * m }, visible)
          ) {
            culled += e.ids.length
            continue
          }
        } else if (e.bounds && !intersects(e.bounds, visible)) {
          culled += e.nodes
          continue
        }
        let pic = e.picture
        if (!pic) {
          if (progressive && recordMs >= RECORD_FRAME_MS) {
            behind = true
            continue
          }
          const t = now()
          pic = this.picture(ctx, root, e)
          recordMs += now() - t
        }
        if (!pic) continue
        if (e.bounds && !intersects(e.bounds, visible)) {
          culled += e.nodes
          continue
        }
        e.used = this.frames + 1
        drawn += e.nodes
        if (bucket && e.bounds) {
          let r = e.raster
          if (r?.scale !== bucket) {
            if (rasterMs < RASTER_FRAME_MS) {
              const t = now()
              r = this.rasterize(e, pic, e.bounds, bucket) ?? null
              rasterMs += now() - t
            } else {
              // Over this frame's budget: a sharper stale raster is fine; otherwise replay.
              if (!r || r.scale < bucket) r = null
              behind = true
            }
          }
          if (r) {
            canvas.drawImageRectOptions(
              r.image,
              ck.XYWHRect(0, 0, r.image.width(), r.image.height()),
              ck.XYWHRect(r.x, r.y, r.w, r.h),
              ck.FilterMode.Linear,
              ck.MipmapMode.None,
              null,
            )
            draws += 1
            continue
          }
        }
        canvas.drawPicture(pic)
        draws += e.draws
      }
      canvas.restore()
      if (behind) this.requestFrame()
    }
    if (this.overlayPainter) {
      canvas.save()
      canvas.scale(this.dpr, this.dpr)
      const oc = { draws: 0 }
      this.overlayPainter.draw(canvas, this.overlay, this.layout, v, this.theme, oc)
      draws += oc.draws
      canvas.restore()
    }
    this.last.nodesDrawn = drawn
    this.last.nodesCulled = culled
    this.last.drawCalls = draws
  }

  render(): void {
    const surface = this.surface
    if (!surface || !this.ck) return
    const now = () => (globalThis.performance ?? Date).now()
    const t0 = now()
    this.drawFrame(surface.getCanvas())
    surface.flush()
    const t1 = now()
    this.frames++
    this.evictRasters()
    this.last.frameMs = t1 - t0
    this.frameTimes.push(t1 - t0)
    if (this.frameTimes.length > 120) this.frameTimes.shift()
    this.frameStamps.push(t1)
    while (this.frameStamps.length && (this.frameStamps[0] as number) < t1 - 1000)
      this.frameStamps.shift()
  }

  requestFrame(): void {
    if (this.framePending || !this.surface) return
    this.framePending = true
    const raf =
      isBrowser() && typeof globalThis.requestAnimationFrame === "function"
        ? globalThis.requestAnimationFrame.bind(globalThis)
        : (cb: () => void) => setTimeout(cb, 0)
    raf(() => {
      this.framePending = false
      this.render()
    })
  }

  /** PNG of the current raster/software surface (headless snapshots, debugging). */
  snapshot(): Uint8Array {
    const { ck } = this.need()
    if (!this.surface) throw new RendererError("NOT_INITIALIZED", "no surface attached")
    this.render()
    const img = this.surface.makeImageSnapshot()
    const bytes = img.encodeToBytes(ck.ImageFormat.PNG, 100)
    img.delete()
    if (!bytes) throw new RendererError("NOT_IMPLEMENTED", "PNG encoding failed")
    return bytes
  }

  // --- queries ------------------------------------------------------------------------------

  private index(): HitIndex | null {
    if (!this.layout || !this.scene) return null
    if (!this.hitIndex || this.hitIndex.source !== this.layout)
      this.hitIndex = new HitIndex(this.layout, this.scene.nodes, this.scene.resolve)
    return this.hitIndex
  }

  hitTest(screen: Point, options: HitTestOptions = {}): string[] {
    const idx = this.index()
    if (!idx) return []
    return idx.point(
      this.screenToWorld(screen),
      (options.tolerance ?? 0) / this.viewport.zoom,
      options,
    )
  }

  hitTestRect(screen: Rect, options: HitTestRectOptions = {}): string[] {
    const idx = this.index()
    if (!idx) return []
    const v = this.viewport
    const r = {
      x: screen.x / v.zoom + v.x,
      y: screen.y / v.zoom + v.y,
      w: screen.w / v.zoom,
      h: screen.h / v.zoom,
    }
    return idx.rect(r, options)
  }

  screenToWorld(p: Point): Point {
    const v = this.viewport
    return { x: p.x / v.zoom + v.x, y: p.y / v.zoom + v.y }
  }

  worldToScreen(p: Point): Point {
    const v = this.viewport
    return { x: (p.x - v.x) * v.zoom, y: (p.y - v.y) * v.zoom }
  }

  textMeasurer(): TextMeasurer {
    return this.need().text.measurer()
  }

  // --- export -------------------------------------------------------------------------------

  /** Loads every font face the subtree's text uses (export, MCP renders). */
  async ensureFonts(nodeId: string): Promise<void> {
    const { fonts } = this.need()
    const ctx = this.context()
    if (!ctx) return
    const jobs: Promise<unknown>[] = []
    const visit = (id: string) => {
      const n = ctx.nodes.getNode(id)
      if (!n) return
      if (n.type === "text" || n.type === "note" || n.type === "prompt") {
        for (const r of resolveText(id, n, ctx.resolve).runs)
          jobs.push(
            fonts.ensureFont(
              r.style.fontFamily,
              r.style.fontWeight,
              r.style.italic ? "italic" : "normal",
            ),
          )
      }
      for (const c of ctx.nodes.children(id)) visit(c)
    }
    visit(nodeId)
    await Promise.all(jobs)
  }

  async exportRaster(nodeId: string, options: RasterExportOptions = {}): Promise<Uint8Array> {
    const { ck, painter, images } = this.need()
    const ctx0 = this.context()
    const l = ctx0?.layout.nodes.get(nodeId)
    if (!ctx0 || !l) throw new RendererError("NODE_NOT_FOUND", `node ${nodeId} is not laid out`)
    await this.ensureFonts(nodeId)
    await Promise.all([...painter.imagesOf(ctx0, nodeId)].map((src) => images.load(src)))
    const ctx = this.context() ?? ctx0
    const box = ctx.layout.nodes.get(nodeId)?.world ?? l.world
    const scale = options.scale ?? 1
    const w = Math.max(1, Math.ceil(box.w * scale))
    const h = Math.max(1, Math.ceil(box.h * scale))
    const surface = ck.MakeSurface(w, h)
    if (!surface)
      throw new RendererError("NOT_IMPLEMENTED", `cannot allocate a ${w}×${h} raster surface`)
    try {
      const c = surface.getCanvas()
      const bg = options.background ? parseColor(options.background) : null
      c.clear(bg ? ck.Color4f(bg[0], bg[1], bg[2], bg[3]) : ck.TRANSPARENT)
      c.scale(scale, scale)
      c.translate(-box.x, -box.y)
      painter.drawNode(c, ctx, nodeId, { nodes: 0, draws: 0 })
      surface.flush()
      const img = surface.makeImageSnapshot()
      const bytes = img.encodeToBytes(ck.ImageFormat.PNG, 100)
      img.delete()
      if (!bytes) throw new RendererError("NOT_IMPLEMENTED", "PNG encoding failed")
      return bytes
    } finally {
      surface.delete()
    }
  }

  stats(): RenderStats {
    const sorted = [...this.frameTimes].sort((a, b) => a - b)
    const avg = sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0
    const p95 = sorted.length
      ? (sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] as number)
      : 0
    return {
      frames: this.frames,
      fps: this.frameStamps.length,
      frameMs: this.last.frameMs,
      frameMsAvg: avg,
      frameMsP95: p95,
      drawCalls: this.last.drawCalls,
      nodesDrawn: this.last.nodesDrawn,
      nodesCulled: this.last.nodesCulled,
      backend: this.backend,
    }
  }
}
