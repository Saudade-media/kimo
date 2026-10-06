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
import { isRef } from "@kimo/core-schema"
import type {
  LayoutNodeData,
  LayoutResult,
  Matrix,
  NodeLayout,
  ResolveHeader,
  Resolver,
  TextMeasurer,
} from "@kimo/layout"
import { resolveText } from "@kimo/layout"
import type { Canvas, CanvasKit, Image, SkPicture, Surface } from "canvaskit-wasm"
import { agentCanvasTheme } from "./agent-overlay"
import { isBrowser, loadCanvasKit } from "./ck"
import { parseColor } from "./color"
import { type DrawCounters, type PaintContext, Painter } from "./draw"
import { CkFontProvider } from "./fonts"
import { apply, intersection, intersects, invert, toCk, union } from "./geometry"
import { HitIndex } from "./hit-test"
import { packageIconSource, packIconSource, SourceIconProvider } from "./icons/provider"
import { IconRegistry } from "./icons/registry"
import { DEFAULT_OVERLAY_THEME, OverlayPainter } from "./overlay"
import { ImageCache, PaintFactory, releaseBlenders, retainBlenders } from "./paint"
import { ShaderCache } from "./shader"
import { StrokeGeometry } from "./stroke"
import { TextEngine } from "./text"
import {
  type AttachOptions,
  type CreateRendererOptions,
  type FontProvider,
  type HitTestOptions,
  type HitTestRectOptions,
  type IconProvider,
  type MotionFrame,
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
  type ThumbnailExportOptions,
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
  /** Filtered / blended layers in the picture ({@link DrawCounters.layers}). */
  layers: number
  /** The picture skipped icon glyphs that were still loading. */
  pendingIcons: boolean
  /** The subtree paints a shader reading `@time`: drawn live (see {@link SHADER_FRAME_MS}). */
  timed: boolean
  /** What the recording read from the header (stale on a header change, see HeaderUse). */
  header: HeaderUse
  /**
   * The root is a top-level instance drawn from a shared picture (its own picture is only
   * `concat(T) + drawPicture`): zoomed out it is drawn from the shared picture's raster.
   */
  wrap: { sp: SharedPicture; key: string; T: Matrix } | null
  /** Zoomed-out raster of `picture` (see {@link RASTER_MAX_SCALE}); dropped with it. */
  raster: RootRaster | null
  /** Rasters of `picture` at other scales made before (see {@link RASTER_LEVELS}). */
  levels?: RootRaster[]
  /** Frame number this root was last drawn (raster cache eviction). */
  used: number
}

/**
 * One recording of an expanded instance's subtree in the instance's local space (M3 perf),
 * shared by every top-level instance whose expanded content, local layout and theme are the
 * same: a main-component edit with 1k instances records one picture per distinct variant and
 * re-records the roots as cheap wrappers (`concat(transform) + drawPicture`).
 */
interface SharedPicture {
  picture: SkPicture
  nodes: number
  draws: number
  layers: number
  pendingIcons: boolean
  timed: boolean
  /** What the recording read from the header (see {@link CanvasKitRenderer.invalidate}). */
  header: HeaderUse
  /** The subtree blends non-normally (answers the painter's isolation check). */
  blends: boolean
  /** Frame number of the last recording that used it (eviction). */
  used: number
  /** Cull rect of the picture in the instance's local space. */
  bounds: Rect | null
  /** Zoomed-out raster in local space, shared by every root drawing this picture. */
  raster: RootRaster | null
  /** Rasters at other scales made before (see {@link RASTER_LEVELS}). */
  levels?: RootRaster[]
  /** Frame number this raster was last drawn (raster eviction). */
  rasterUsed: number
}

/** Something holding rasters of one picture: the current one and earlier scales. */
type Rasters = { raster: RootRaster | null; levels?: RootRaster[] }

/** The content key of one top-level instance and what it was computed from. */
interface InstanceKey {
  /** Paint order array of the layout the ids were walked in (same array: same tree). */
  order: readonly string[]
  ids: string[]
  data: unknown[]
  layouts: unknown[]
  theme: string
  key: string
}

/**
 * Header reads of a recording: `refs` — it resolved a `{ $ref }` binding (stale whenever the
 * variables, themes or imports change); `textDefault` — the default text fill it saw (whether
 * `text/default` is a color variable; stale only when that answer changes).
 */
interface HeaderUse {
  refs: boolean
  textDefault: boolean | null
}
const NO_HEADER: HeaderUse = Object.freeze({ refs: false, textDefault: null }) as HeaderUse
const hasTextDefault = (h: ResolveHeader): boolean => {
  const v = (h.variables as Record<string, unknown> | undefined)?.["text/default"]
  return typeof v === "object" && v !== null && (v as { type?: unknown }).type === "color"
}

/**
 * `canvas` × `T`: a translation (the common instance placement) as two scalars, else the
 * full matrix (perf: `concat` marshals a 9-float array into wasm on every call).
 */
function placeAt(canvas: Canvas, T: Matrix): void {
  if (T[0] === 1 && T[1] === 0 && T[2] === 0 && T[3] === 1) canvas.translate(T[4], T[5])
  else canvas.concat(toCk(T))
}

/** Shared instance pictures kept before the least recently used half is evicted. */
const SHARED_MAX = 2048
/** Data keys never painted (or factored out of a shared picture's local space). */
const UNPAINTED = new Set(["parent", "order", "name", "meta", "locked"])
/**
 * Placement keys of an instance top: its transform carries them (local-space recording); its
 * `theme` pins are part of the resolved theme in the key.
 */
const PLACEMENT = new Set([
  ...UNPAINTED,
  "x",
  "y",
  "rotation",
  "flipX",
  "flipY",
  "position",
  "theme",
])

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
/**
 * Motion raster cache: while the viewport is moving (pan/zoom within the last `MOTION_MS`),
 * roots whose pictures hold filtered layers (background / layer blur, layer shadows, blend
 * layers) are drawn from a raster at any zoom — replaying them costs GPU time every frame
 * (and a shader compile per new blur sigma while zooming). Once the viewport rests they are
 * replayed crisp again.
 */
const MOTION_MS = 160
/** A picture cull rect this wide (world px) is Skia's "unbounded" (recorded at ±1e7). */
const UNBOUNDED_CULL = 1e6
/**
 * Rasters kept per picture, at distinct scales (the current one included). Zooming back across
 * a scale step already visited reuses that raster instead of replaying every root while the
 * per-frame raster budget fills them in again (perf: zoom spikes); the pixel budget still
 * bounds them (older levels go first).
 */
const RASTER_LEVELS = 3
/**
 * Animated shader paints (spec §7.1, `@time`): a runtime effect's uniforms are baked into a
 * recording, so while shaders animate, roots holding a `@time` shader are drawn live from the
 * painter instead of replaying their picture (zoomed out they draw from their t = 0 raster).
 * While one is visible, frames keep coming at most every this many ms (more when drawing them
 * live costs more), and stop once none is visible; never under `prefers-reduced-motion`.
 */
const SHADER_FRAME_MS = 33
/** Raster scales are powers of two ≥ the device scale, so a raster is downsampled ≤ 2×. */
const rasterBucket = (s: number) => 2 ** Math.max(-8, Math.ceil(Math.log2(s)))

let motionQuery: { matches: boolean } | null | undefined
/** `prefers-reduced-motion: reduce` (browsers; false elsewhere). */
function reducedMotion(): boolean {
  if (motionQuery === undefined) {
    const mm = (globalThis as { matchMedia?: (q: string) => { matches: boolean } }).matchMedia
    motionQuery = typeof mm === "function" ? mm("(prefers-reduced-motion: reduce)") : null
  }
  return motionQuery?.matches ?? false
}

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
  private shaderCache: ShaderCache | null = null
  private paintFactory: PaintFactory | null = null
  private painter: Painter | null = null
  private overlayPainter: OverlayPainter | null = null
  private theme: OverlayTheme = DEFAULT_OVERLAY_THEME

  private scene: RenderScene | null = null
  private layout: LayoutResult | null = null
  private viewport: Viewport = { x: 0, y: 0, zoom: 1 }
  private overlay: Overlay = EMPTY_OVERLAY
  /** Board 35: this frame's node motion and the roots that hold it (see {@link setMotion}). */
  private motion: MotionFrame | null = null
  private readonly motionRoots = new Set<string>()
  private roots = new Map<string, RootEntry>()
  private rootOrder: string[] = []
  /** Root grouping of the last `setLayout` (reused while the paint order array is the same). */
  private grouping: {
    order: readonly string[]
    nodes: unknown
    next: Map<string, string[]>
    roots: string[]
  } | null = null
  /**
   * M3: draw top-level instances from {@link SharedPicture}s (default on; `false` records every
   * instance into its root picture as before — A/B in the perf harness).
   */
  sharedInstances = true
  private shared = new Map<string, SharedPicture>()
  private instanceKeys = new Map<string, InstanceKey>()
  /** Per data object: its paint token (see {@link token}). */
  private readonly tokens = new WeakMap<object, string>()
  private readonly topTokens = new WeakMap<object, string>()
  /** JSON of nested values, per object (data is immutable). */
  private readonly jsons = new WeakMap<object, string>()
  /** Sorted `axis=value` string of each resolved theme object (see {@link instanceKey}). */
  private readonly themeKeys = new WeakMap<object, string>()
  /** Paint token of each layout object (see {@link layoutToken}). */
  private readonly layoutTokens = new WeakMap<object, string>()
  /** Header use of the recording in progress (see {@link tracked}). */
  private recFlags: HeaderUse | null = null
  /** Variables / themes / imports as of the last soft invalidation (what changed since). */
  private headerKey: string | null = null
  /** Root being recorded, and the shared picture it turned out to wrap (see RootEntry.wrap). */
  private recRoot: string | null = null
  private recWrap: RootEntry["wrap"] = null
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
  /** Bumps when a pending frame is drawn early ({@link renderPending}): stale callbacks skip. */
  private frameToken = 0

  /**
   * Zoomed-out raster cache: `true` (default) on WebGL only, `false` off, `"always"` on every
   * surface (tests: CPU surfaces otherwise never use it).
   */
  rasterCache: boolean | "always" = true
  /** Motion raster cache (see {@link MOTION_MS}); only where `rasterCache` applies. */
  motionRasterCache = true
  private rasterPx = 0
  /** Timestamp until which the viewport counts as moving (motion raster cache). */
  private motionUntil = 0
  /** Zoom of the previous frame (a zooming viewport reuses rasters instead of making them). */
  private prevZoom = 0
  private settleTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * Animate `@time` shader paints on screen (default: in browsers). Off, or under
   * `prefers-reduced-motion`, they draw at t = 0.
   */
  shaderAnimation = isBrowser()
  /** Set while drawing roots live: shared instance pictures with `@time` shaders are bypassed. */
  private live = false
  /** Origin of the shader clock (ms, `performance.now()`). */
  private clockStart = -1
  private shaderTimer: ReturnType<typeof setTimeout> | null = null

  private frameTimes: number[] = []
  private frameStamps: number[] = []
  private frames = 0
  private last = {
    frameMs: 0,
    drawCalls: 0,
    nodesDrawn: 0,
    nodesCulled: 0,
    /** Diagnostics (perf harness): CPU ms recording pictures / creating rasters, counts. */
    recordMs: 0,
    rasterMs: 0,
    rasterized: 0,
    recorded: 0,
    sharedRecorded: 0,
    wrapped: 0,
  }

  private iconProvider: IconProvider | null = null
  private iconRegistry: IconRegistry | null = null
  private unsubscribeIcons: (() => void) | null = null

  constructor(
    private readonly options: CreateRendererOptions = {},
    private readonly defaultWasmUrl?: string,
    /** Default icon source when `init({ icons })` passes none (the browser entry's packs). */
    private readonly defaultIcons?: () => IconProvider,
  ) {}

  /** Icon glyph source (available after `init()`). */
  get icons(): IconProvider | undefined {
    return this.iconProvider ?? undefined
  }

  // --- lifecycle ----------------------------------------------------------------------------

  init(options: RendererInitOptions = {}): Promise<void> {
    if (options.overlayTheme) {
      this.theme = options.overlayTheme
      this.applyAgentTheme()
    }
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
      const shaders = new ShaderCache(ck, () => this.dropAll(false))
      if (this.scene) shaders.assets = this.scene.assets
      this.ck = ck
      retainBlenders(ck)
      this.fontProvider = fonts
      this.textEngine = text
      this.images = images
      this.shaderCache = shaders
      const provider =
        options.icons ??
        this.defaultIcons?.() ??
        new SourceIconProvider(isBrowser() ? packIconSource({}) : packageIconSource())
      const registry = new IconRegistry(ck, provider, new StrokeGeometry(ck))
      this.iconProvider = provider
      this.iconRegistry = registry
      // Only pictures that skipped a still-loading glyph need re-recording (dropping every
      // root per arriving glyph re-recorded a whole 5k-node document several times on open).
      this.unsubscribeIcons = provider.onIconLoaded(() => this.dropPendingIcons())
      const factory = new PaintFactory(ck, images, shaders)
      this.paintFactory = factory
      this.painter = new Painter(ck, factory, text, registry)
      this.painter.subtree = (c, ctx, id, counters) => this.drawShared(c, ctx, id, counters)
      this.painter.knownBlends = (ctx, id) => this.sharedFor(ctx, id)?.sp.blends
      this.applyAgentTheme()
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

  /**
   * M6: note / prompt chrome colors follow `OverlayTheme.agentCanvas`; recorded pictures are
   * dropped only when a value actually changed (hosts re-pass equal themes freely).
   */
  private applyAgentTheme(): void {
    const painter = this.painter
    if (!painter) return
    const next = agentCanvasTheme(this.theme)
    const prev = painter.agentTheme
    if (prev === next) return
    let same = true
    for (const k of Object.keys(next) as (keyof typeof next)[])
      if (prev[k] !== next[k]) {
        same = false
        break
      }
    if (same) return
    painter.agentTheme = next
    this.dropAll(false)
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
    if (this.settleTimer) clearTimeout(this.settleTimer)
    this.settleTimer = null
    if (this.shaderTimer) clearTimeout(this.shaderTimer)
    this.shaderTimer = null
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
    this.shaderCache?.clear()
    this.paintFactory?.clear()
    this.fontProvider?.dispose()
    this.unsubscribeIcons?.()
    this.unsubscribeIcons = null
    this.iconRegistry?.clear()
    this.iconRegistry = null
    this.iconProvider = null
    if (this.ck) releaseBlenders(this.ck)
    this.ck = null
    this.painter = null
    this.textEngine = null
    this.images = null
    this.shaderCache = null
    this.paintFactory = null
    this.fontProvider = null
    this.overlayPainter = null
    this.initPromise = null
  }

  // --- state --------------------------------------------------------------------------------

  setDocument(scene: RenderScene): void {
    // Shader srcs are relative paths: another source may resolve them to other files.
    if (this.scene && this.scene.assets !== scene.assets) this.shaderCache?.forgetSources()
    if (this.shaderCache) this.shaderCache.assets = scene.assets
    this.scene = scene
    this.grouping = null
    this.headerKey = null
    this.instanceKeys.clear()
    this.sharedMemo.byId.clear()
    if (this.images) this.images.assets = scene.assets
    this.textEngine?.invalidate()
    this.dropAll(false)
    this.hitIndex = null
  }

  invalidate(nodeIds?: Iterable<string>): void {
    this.hitIndex = null
    this.sharedMemo.byId.clear()
    if (!nodeIds) {
      // Everything may have changed, but node data and layout are compared on `setLayout`
      // (identity / `changed`), so only what read a changed header is dropped here: pictures
      // with bindings, or whose default text fill changed (a variable mode switch over 1k
      // instances re-records one shared picture per variant, not the whole document). Text
      // caches are content-keyed (runs, width, fill, font generation) and stay valid.
      const ctx = this.context()
      const h = ctx?.header() ?? {}
      const key = JSON.stringify([h.variables ?? null, h.themes ?? null, h.imports ?? null])
      const changed = key !== this.headerKey
      this.headerKey = key
      const td = hasTextDefault(h)
      const stale = (u: HeaderUse) =>
        changed && (u.refs || (u.textDefault !== null && u.textDefault !== td))
      for (const e of this.roots.values()) if (e.picture && stale(e.header)) this.drop(e)
      for (const [k, sp] of this.shared)
        if (stale(sp.header)) {
          this.deleteShared(sp)
          this.shared.delete(k)
        }
      this.requestFrame()
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
    this.sharedMemo.byId.clear()
    this.hitIndex = null
    const nodes = this.scene?.nodes
    // Group paint order into root subtrees (order is depth-first, parents first). The engine
    // hands back the same order array when no child list changed: reuse the grouping.
    let next: Map<string, string[]>
    let order: string[]
    const g = this.grouping
    if (g && g.order === layout.order && g.nodes === nodes) {
      next = g.next
      order = g.roots
    } else {
      const rootOf = new Map<string, string>()
      next = new Map()
      order = []
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
      this.grouping = { order: layout.order, nodes, next, roots: order }
    }
    for (const [root, e] of this.roots)
      if (!next.has(root)) {
        this.drop(e)
        this.roots.delete(root)
      }
    for (const [root, ids] of next) {
      const prev = this.roots.get(root)
      if (prev?.picture || prev?.wrap) {
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
          layers: 0,
          pendingIcons: false,
          timed: false,
          header: NO_HEADER,
          wrap: null,
          raster: null,
          used: 0,
        })
    }
    for (const id of this.instanceKeys.keys())
      if (!layout.nodes.has(id)) this.instanceKeys.delete(id)
    this.rootOrder = order
    this.requestFrame()
  }

  setViewport(viewport: Viewport): void {
    const v = this.viewport
    if (v.x !== viewport.x || v.y !== viewport.y || v.zoom !== viewport.zoom) this.moved()
    this.viewport = { ...viewport }
    this.requestFrame()
  }

  /** Viewport moved: rasters may stand in for filtered roots until it rests for `MOTION_MS`. */
  private moved(): void {
    const t = (globalThis.performance ?? Date).now()
    this.motionUntil = t + MOTION_MS
    if (this.settleTimer) return
    const settle = () => {
      const left = this.motionUntil - (globalThis.performance ?? Date).now()
      if (left > 0) {
        this.settleTimer = setTimeout(settle, left + 1)
        return
      }
      this.settleTimer = null
      // Redraw crisp (pictures) at rest.
      this.requestFrame()
    }
    this.settleTimer = setTimeout(settle, MOTION_MS + 1)
  }

  setOverlay(overlay: Overlay): void {
    this.overlay = overlay
    this.requestFrame()
  }

  /**
   * Board 35 "Agent build motion": the roots holding a node with motion draw straight from the
   * painter with `motion` (no picture recorded or reused) until it is cleared; their cached
   * final-state pictures stay for afterwards. Hit testing, overlays and exports ignore it.
   */
  setMotion(motion: MotionFrame | null): void {
    if (!motion?.size) {
      if (!this.motion) return
      this.motion = null
      this.motionRoots.clear()
      this.requestFrame()
      return
    }
    this.motion = motion
    this.motionRoots.clear()
    const nodes = this.scene?.nodes
    const laid = this.layout?.nodes
    if (nodes && laid)
      for (const id of motion.keys()) {
        let root = id
        for (let i = 0; i < 4096; i++) {
          const p = nodes.getNode(root)?.parent
          if (typeof p !== "string" || !laid.has(p)) break
          root = p
        }
        this.motionRoots.add(root)
      }
    this.requestFrame()
  }

  private drop(e: RootEntry): void {
    e.picture?.delete()
    e.picture = null
    e.bounds = null
    e.wrap = null
    this.dropRaster(e)
  }

  private dropRaster(e: Rasters): void {
    this.dropLevels(e)
    if (!e.raster) return
    e.raster.image.delete()
    this.rasterPx -= e.raster.px
    e.raster = null
  }

  /** Frees the rasters of `e` at other scales than the current one. */
  private dropLevels(e: Rasters): void {
    const levels = e.levels
    if (!levels) return
    for (const l of levels) {
      l.image.delete()
      this.rasterPx -= l.px
    }
    e.levels = undefined
  }

  /**
   * The raster of `e` at exactly `scale`, made current when it was kept as an earlier level;
   * null when there is none (same pixels as making it again: same picture, same scale).
   */
  private levelAt(e: Rasters, scale: number): RootRaster | null {
    if (e.raster?.scale === scale) return e.raster
    const levels = e.levels
    const i = levels ? levels.findIndex((l) => l.scale === scale) : -1
    if (!levels || i < 0) return null
    // Levels stay in least-recently-drawn order (the oldest goes first, see `rasterize`).
    const [found] = levels.splice(i, 1) as [RootRaster]
    if (e.raster) levels.push(e.raster)
    e.raster = found
    return found
  }

  /** Rasters belong to the surface's GPU context: dropped when the surface changes. */
  private dropRasters(): void {
    for (const e of this.roots.values()) this.dropRaster(e)
    for (const sp of this.shared.values()) this.dropRaster(sp)
    this.rasterPx = 0
  }

  /** Rasterizes `pic` at device scale `scale` into an image compatible with the surface. */
  private rasterize(e: Rasters, pic: SkPicture, bounds: Rect, scale: number): RootRaster | null {
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
    // The previous raster stays as a level (another scale; see RASTER_LEVELS).
    const prev = e.raster
    if (prev) {
      if (!e.levels) e.levels = []
      const levels = e.levels
      const same = levels.findIndex((l) => l.scale === prev.scale)
      if (same >= 0) {
        const [old] = levels.splice(same, 1)
        if (old) {
          old.image.delete()
          this.rasterPx -= old.px
        }
      }
      levels.push(prev)
      while (levels.length > RASTER_LEVELS - 1) {
        const old = levels.shift() as RootRaster
        old.image.delete()
        this.rasterPx -= old.px
      }
    }
    e.raster = { image, scale, x, y, w: W / scale, h: H / scale, px: W * H }
    this.rasterPx += W * H
    return e.raster
  }

  /** Evicts least recently drawn rasters (never this frame's) above the pixel budget. */
  private evictRasters(): void {
    if (this.rasterPx <= RASTER_BUDGET_PX) return
    // Earlier scales go first (least recently drawn first), then whole rasters.
    const kept: { e: Rasters; used: number }[] = []
    for (const e of this.roots.values()) if (e.levels) kept.push({ e, used: e.used })
    for (const sp of this.shared.values()) if (sp.levels) kept.push({ e: sp, used: sp.rasterUsed })
    kept.sort((a, b) => a.used - b.used)
    for (const { e } of kept) {
      if (this.rasterPx <= RASTER_BUDGET_PX) return
      this.dropLevels(e)
    }
    const old: { e: Rasters; used: number }[] = []
    for (const e of this.roots.values())
      if (e.raster && e.used !== this.frames) old.push({ e, used: e.used })
    for (const sp of this.shared.values())
      if (sp.raster && sp.rasterUsed !== this.frames) old.push({ e: sp, used: sp.rasterUsed })
    old.sort((a, b) => a.used - b.used)
    for (const { e } of old) {
      if (this.rasterPx <= RASTER_BUDGET_PX) break
      this.dropRaster(e)
    }
  }

  private dropPendingIcons(): void {
    let any = false
    for (const [k, sp] of this.shared)
      if (sp.pendingIcons) {
        this.deleteShared(sp)
        this.shared.delete(k)
      }
    for (const e of this.roots.values())
      if (e.picture && e.pendingIcons) {
        this.drop(e)
        any = true
      }
    if (any && this.surface) this.requestFrame()
  }

  private dropAll(frame: boolean): void {
    for (const e of this.roots.values()) this.drop(e)
    this.dropShared()
    if (frame || this.surface) this.requestFrame()
  }

  // --- drawing ------------------------------------------------------------------------------

  private context(): PaintContext | null {
    const s = this.scene
    const layout = this.layout
    if (!s || !layout) return null
    const header = typeof s.header === "function" ? s.header : () => s.header as ResolveHeader
    return s.labels
      ? { nodes: s.nodes, header, resolve: s.resolve, layout, labels: s.labels }
      : { nodes: s.nodes, header, resolve: s.resolve, layout }
  }

  private picture(ctx: PaintContext, root: string, e: RootEntry): SkPicture | null {
    if (e.picture) return e.picture
    const { ck, painter } = this.need()
    const rec = new ck.PictureRecorder()
    const counters: DrawCounters = { nodes: 0, draws: 0 }
    const outer = this.recFlags
    const flags: HeaderUse = { refs: false, textDefault: null }
    const usage = { ...this.paintFactory?.usage }
    this.recFlags = flags
    this.recRoot = root
    this.recWrap = null
    try {
      const c = rec.beginRecording(ck.LTRBRect(-1e7, -1e7, 1e7, 1e7), true)
      painter.drawNode(c, this.tracked(ctx), root, counters)
      e.picture = rec.finishRecordingAsPicture()
    } finally {
      rec.delete()
      this.recFlags = outer
      this.recRoot = null
    }
    e.header = flags
    e.wrap = this.recWrap
    this.recWrap = null
    e.nodes = counters.nodes
    e.draws = counters.draws
    e.layers = counters.layers ?? 0
    e.pendingIcons = (counters.pendingIcons ?? 0) > 0
    const used = this.paintFactory?.usage
    e.timed = (used?.timed ?? 0) > (usage.timed ?? 0) || (counters.timed ?? 0) > 0
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
      // Skia records some layers (background blur: a backdrop-filtered saveLayer) as
      // unbounded, which would disable culling and the raster cache for the whole root.
      if (bounds.w >= UNBOUNDED_CULL || bounds.h >= UNBOUNDED_CULL) {
        const ink = painter.inkBounds(ctx, e.ids)
        bounds = ink ? intersection(bounds, ink) : bounds
      }
    } else
      for (const id of e.ids) {
        const l = ctx.layout.nodes.get(id)
        if (l) bounds = union(bounds, l.world)
      }
    e.bounds = bounds
    return e.picture
  }

  // --- shared instance pictures (M3) ----------------------------------------------------------

  /** `ctx` reporting header reads (bindings, `header()`) to the recording in progress. */
  private tracked(ctx: PaintContext): PaintContext {
    const r = ctx.resolve
    const resolve: Resolver = {
      theme: (id) => r.theme(id),
      value: (id, v) => {
        if (this.recFlags && isRef(v)) this.recFlags.refs = true
        return r.value(id, v)
      },
      invalidate: (ids) => r.invalidate(ids),
    }
    return {
      ...ctx,
      resolve,
      // The painter reads the header for the default text fill only.
      header: () => {
        const h = ctx.header()
        if (this.recFlags) this.recFlags.textDefault = hasTextDefault(h)
        return h
      },
    }
  }

  private dropShared(): void {
    for (const sp of this.shared.values()) this.deleteShared(sp)
    this.shared.clear()
  }

  /** Frees a shared picture and its raster (roots that recorded it keep their own reference). */
  private deleteShared(sp: SharedPicture): void {
    this.sharedMemo.byId.clear()
    sp.picture.delete()
    this.dropRaster(sp)
  }

  /**
   * The shared picture of top-level expanded instance `id` (recorded on first use), or null
   * when `id` is not one. `ctx` should be {@link tracked} so header reads are attributed.
   */
  private sharedFor(ctx: PaintContext, id: string): NonNullable<RootEntry["wrap"]> | null {
    if (!this.sharedInstances || id.includes("/")) return null
    // One answer per frame and layout (perf: recording a parent of 500 instances asks once
    // for its isolation check and once to draw each of them).
    const memo = this.sharedMemo
    if (memo.frame !== this.frames || memo.layout !== ctx.layout || memo.nodes !== ctx.nodes) {
      memo.frame = this.frames
      memo.layout = ctx.layout
      memo.nodes = ctx.nodes
      memo.byId.clear()
    }
    const hit = memo.byId.get(id)
    if (hit !== undefined) {
      if (hit) hit.sp.used = this.frames
      return hit
    }
    const w = this.sharedForUncached(ctx, id)
    memo.byId.set(id, w)
    return w
  }

  /** Per-frame answers of {@link sharedFor} (cleared when shared pictures are dropped). */
  private sharedMemo: {
    frame: number
    layout: LayoutResult | null
    nodes: unknown
    byId: Map<string, NonNullable<RootEntry["wrap"]> | null>
  } = { frame: -1, layout: null, nodes: null, byId: new Map() }

  private sharedForUncached(ctx: PaintContext, id: string): NonNullable<RootEntry["wrap"]> | null {
    const l = ctx.layout.nodes.get(id)
    if (!l?.visible) return null
    // An expanded top-level instance: its children are composite ids `<id>/<IdPath>`.
    const kids = ctx.nodes.children(id)
    const first = kids[0]
    if (first === undefined || !first.startsWith(`${id}/`)) return null
    const T = l.transform
    const inv = invert(T)
    if (!inv) return null
    const key = this.instanceKey(ctx, id)
    let sp = this.shared.get(key)
    if (!sp) {
      const { ck, painter } = this.need()
      const rec = new ck.PictureRecorder()
      const c2: DrawCounters = { nodes: 0, draws: 0 }
      const outer = this.recFlags
      const flags: HeaderUse = { refs: false, textDefault: null }
      this.recFlags = flags
      const hook = painter.subtree
      const known = painter.knownBlends
      const usage = { ...this.paintFactory?.usage }
      painter.subtree = null
      painter.knownBlends = null
      let picture: SkPicture
      // A shared picture may be recorded while a root draws live: it holds the t = 0 frame.
      const f = this.paintFactory
      const time = f?.time ?? 0
      if (f) f.time = 0
      try {
        const c = rec.beginRecording(ck.LTRBRect(-1e7, -1e7, 1e7, 1e7), true)
        // Local space: the instance's own transform is applied where the picture is drawn.
        c.concat(toCk(inv))
        painter.drawNode(c, ctx, id, c2)
        picture = rec.finishRecordingAsPicture()
      } finally {
        rec.delete()
        painter.subtree = hook
        painter.knownBlends = known
        this.recFlags = outer
        if (f) f.time = time
      }
      painter.knownBlends = null
      const blends = painter.subtreeBlends(ctx, id)
      painter.knownBlends = known
      this.last.recorded++
      this.last.sharedRecorded++
      const cull = picture.cullRect()
      const cw = (cull?.[2] ?? 0) - (cull?.[0] ?? 0)
      const chh = (cull?.[3] ?? 0) - (cull?.[1] ?? 0)
      sp = {
        picture,
        nodes: c2.nodes,
        draws: c2.draws,
        layers: c2.layers ?? 0,
        pendingIcons: (c2.pendingIcons ?? 0) > 0,
        timed: (this.paintFactory?.usage.timed ?? 0) > (usage.timed ?? 0),
        header: flags,
        blends,
        used: this.frames,
        // Unbounded (a background blur) or empty: no shared raster, roots raster themselves.
        bounds:
          cw > 0 && chh > 0 && cw < UNBOUNDED_CULL && chh < UNBOUNDED_CULL
            ? { x: cull?.[0] ?? 0, y: cull?.[1] ?? 0, w: cw, h: chh }
            : null,
        raster: null,
        rasterUsed: 0,
      }
      if (this.shared.size >= SHARED_MAX) this.evictShared()
      this.shared.set(key, sp)
    }
    sp.used = this.frames
    return { sp, key, T }
  }

  /** Painter hook: draws a top-level expanded instance from its shared picture. */
  private drawShared(canvas: Canvas, ctx: PaintContext, id: string, counters: DrawCounters) {
    const w = this.sharedFor(ctx, id)
    if (!w) return false
    const { sp, T } = w
    // Live roots draw animated shader instances from the painter (current clock).
    if (this.live && sp.timed) return false
    if (id === this.recRoot) this.recWrap = w
    canvas.save()
    placeAt(canvas, T)
    canvas.drawPicture(sp.picture)
    canvas.restore()
    counters.nodes += sp.nodes
    counters.draws += sp.draws
    if (sp.layers) counters.layers = (counters.layers ?? 0) + sp.layers
    if (sp.pendingIcons) counters.pendingIcons = (counters.pendingIcons ?? 0) + 1
    if (sp.timed) counters.timed = (counters.timed ?? 0) + 1
    const f = this.recFlags
    if (f) {
      if (sp.header.refs) f.refs = true
      if (sp.header.textDefault !== null) f.textDefault = sp.header.textDefault
    }
    return true
  }

  /**
   * Makes root `e` (a top-level instance) draw straight from its shared picture, without a
   * root picture of its own (perf: re-acquiring 1k wrappers after an edit costs a key check
   * each, not a recording each). Null when the root is not a shareable instance.
   */
  private acquireWrap(ctx: PaintContext, root: string, e: RootEntry): RootEntry["wrap"] {
    const flags: HeaderUse = { refs: false, textDefault: null }
    const outer = this.recFlags
    this.recFlags = flags
    let w: RootEntry["wrap"]
    try {
      w = this.sharedFor(this.tracked(ctx), root)
    } finally {
      this.recFlags = outer
    }
    if (!w) return null
    const { sp, T } = w
    e.wrap = w
    e.data = e.ids.map((id) => ctx.nodes.getNode(id))
    e.nodes = sp.nodes
    e.draws = sp.draws
    e.layers = sp.layers
    e.pendingIcons = sp.pendingIcons
    e.timed = sp.timed
    e.header = sp.header
    if (sp.bounds) {
      const b = sp.bounds
      let out: Rect | null = null
      for (const p of [
        { x: b.x, y: b.y },
        { x: b.x + b.w, y: b.y },
        { x: b.x, y: b.y + b.h },
        { x: b.x + b.w, y: b.y + b.h },
      ]) {
        const q = apply(T, p)
        out = union(out, { x: q.x, y: q.y, w: 0, h: 0 })
      }
      e.bounds = out
    } else e.bounds = null
    return w
  }

  /** Drops the least recently used half of the shared pictures (roots keep their own refs). */
  private evictShared(): void {
    const byUse = [...this.shared].sort((a, b) => a[1].used - b[1].used)
    for (const [k, sp] of byUse.slice(0, byUse.length >> 1)) {
      this.deleteShared(sp)
      this.shared.delete(k)
    }
  }

  private jsonOf(o: object): string {
    let j = this.jsons.get(o)
    if (j === undefined) {
      j = JSON.stringify(o)
      this.jsons.set(o, j)
    }
    return j
  }

  /**
   * What a node paints, as a string of its values (nested objects as JSON, cached per object:
   * node data is immutable). `top`: the instance root, whose placement is carried by its
   * transform and whose pins by the resolved theme.
   */
  private token(n: LayoutNodeData, top: boolean): string {
    const cache = top ? this.topTokens : this.tokens
    let t = cache.get(n)
    if (t !== undefined) return t
    const skip = top ? PLACEMENT : UNPAINTED
    const parts: string[] = []
    for (const k in n) {
      if (!Object.hasOwn(n, k) || skip.has(k)) continue
      const v = (n as Record<string, unknown>)[k]
      if (v === undefined) continue
      parts.push(
        typeof v === "object" && v !== null
          ? `${k}:${this.jsonOf(v)}`
          : `${k}=${typeof v === "string" ? JSON.stringify(v) : String(v)}`,
      )
    }
    t = parts.join(",")
    cache.set(n, t)
    return t
  }

  /**
   * What a node's layout paints, given its data: its box in its parent (`local`; a transform
   * relative to the instance root is the product of these along the path, with rotation and
   * flips from the data), visibility and text metrics. `top`: only the root's size (its
   * position is the shared picture's placement). Cached per layout object.
   */
  private layoutToken(l: NodeLayout, top: boolean): string {
    if (top) return `${l.local.w},${l.local.h},${l.visible ? 1 : 0}`
    let t = this.layoutTokens.get(l)
    if (t === undefined) {
      const b = l.local
      t = `${b.x},${b.y},${b.w},${b.h},${l.visible ? 1 : 0}`
      const m = l.text
      if (m) t += `;${m.w},${m.h},${m.lines ?? ""},${m.baseline ?? ""}`
      this.layoutTokens.set(l, t)
    }
    return t
  }

  /** Content key of top-level instance `id` (see {@link SharedPicture}). */
  private instanceKey(ctx: PaintContext, id: string): string {
    const prev = this.instanceKeys.get(id)
    // The engine hands back the same paint-order array while no child list changed: the
    // subtree's ids are the ones walked last time.
    let ids: string[]
    if (prev && prev.order === ctx.layout.order) ids = prev.ids
    else {
      ids = []
      const walk = (x: string) => {
        ids.push(x)
        for (const c of ctx.nodes.children(x)) if (ctx.layout.nodes.has(c)) walk(c)
      }
      walk(id)
    }
    const th = ctx.resolve.theme(id)
    let theme = this.themeKeys.get(th)
    if (theme === undefined) {
      theme = Object.keys(th)
        .sort()
        .map((k) => `${k}=${th[k]}`)
        .join(",")
      // Resolved themes are not mutated once handed out (the resolver memoizes them).
      this.themeKeys.set(th, theme)
    }
    const data: unknown[] = new Array(ids.length)
    const layouts: unknown[] = new Array(ids.length)
    let same = !!prev && prev.theme === theme && prev.ids.length === ids.length
    for (let i = 0; i < ids.length; i++) {
      const x = ids[i] as string
      data[i] = ctx.nodes.getNode(x)
      layouts[i] = ctx.layout.nodes.get(x)
      if (
        same &&
        (prev?.ids[i] !== x || prev.data[i] !== data[i] || prev.layouts[i] !== layouts[i])
      )
        same = false
    }
    if (same && prev) {
      prev.order = ctx.layout.order
      return prev.key
    }
    const parts: string[] = [theme]
    for (let i = 0; i < ids.length; i++)
      parts.push(
        `${this.token(data[i] as LayoutNodeData, i === 0)}@${this.layoutToken(layouts[i] as NodeLayout, i === 0)}`,
      )
    const key = parts.join("\n")
    this.instanceKeys.set(id, { order: ctx.layout.order, ids, data, layouts, theme, key })
    return key
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
      const rasters =
        this.rasterCache === "always" || (this.rasterCache && this.backend === "webgl")
      const bucket = rasters && scale <= RASTER_MAX_SCALE ? rasterBucket(scale) : 0
      const now = () => (globalThis.performance ?? Date).now()
      const inMotion = rasters && this.motionRasterCache && now() < this.motionUntil
      const moving = inMotion && !bucket
      const zooming = v.zoom !== this.prevZoom
      this.prevZoom = v.zoom
      let rasterMs = 0
      let recordMs = 0
      this.last.recorded = 0
      this.last.rasterized = 0
      this.last.sharedRecorded = 0
      this.last.wrapped = 0
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
      // Animated shaders: live roots get the current clock (see SHADER_FRAME_MS).
      const animate = this.shaderAnimation && !reducedMotion()
      if (animate && this.clockStart < 0) this.clockStart = now()
      const shaderTime = animate ? (now() - this.clockStart) / 1000 : 0
      let liveMs = 0
      let timedVisible = false
      const drawLive = (root: string, e: RootEntry) => {
        e.used = this.frames + 1
        const t = now()
        const f = this.paintFactory
        if (f) f.time = shaderTime
        this.live = true
        const counters: DrawCounters = { nodes: 0, draws: 0 }
        try {
          this.need().painter.drawNode(canvas, ctx, root, counters)
        } finally {
          this.live = false
          if (f) f.time = 0
        }
        drawn += counters.nodes
        draws += counters.draws
        liveMs += now() - t
        timedVisible = true
      }
      /** Draws a wrapper root: its variant's raster when zoomed out (one per variant), else
       * the shared picture under the root's transform. */
      const drawWrapped = (e: RootEntry, w: NonNullable<RootEntry["wrap"]>) => {
        e.used = this.frames + 1
        drawn += e.nodes
        const sp = w.sp
        // Rasters: zoomed out; and, while the viewport moves, at any zoom (one raster per
        // variant is cheap, replaying hundreds of instance pictures per frame is not). The
        // frame after the viewport rests replays the pictures crisp.
        let target = bucket
        let sr: RootRaster | null = null
        if (!bucket && moving && sp.bounds) {
          const want = rasterBucket(scale)
          const cap =
            2 **
            Math.floor(Math.log2((RASTER_MAX_SIDE - 2) / Math.max(sp.bounds.w, sp.bounds.h, 1)))
          const cur = sp.raster
          // Zooming: any raster within 4× stands in until the zoom rests.
          if (zooming && cur && cur.scale >= want / 4 && cur.scale <= want * 4) sr = cur
          else if (Math.min(want, cap) >= want / 2) target = Math.min(want, cap)
        }
        if (!sr && target && sp.bounds) {
          sr = this.levelAt(sp, target) ?? sp.raster
          if (sr?.scale !== target) {
            if (rasterMs < RASTER_FRAME_MS || !sr) {
              const t = now()
              sr = this.rasterize(sp, sp.picture, sp.bounds, target) ?? sr
              rasterMs += now() - t
              this.last.rasterized++
            } else behind = true
          }
        }
        if (sr) {
          sp.rasterUsed = this.frames + 1
          canvas.save()
          placeAt(canvas, w.T)
          canvas.drawImageRectOptions(
            sr.image,
            ck.XYWHRect(0, 0, sr.image.width(), sr.image.height()),
            ck.XYWHRect(sr.x, sr.y, sr.w, sr.h),
            ck.FilterMode.Linear,
            ck.MipmapMode.None,
            null,
          )
          canvas.restore()
          draws += 1
          return
        }
        canvas.save()
        placeAt(canvas, w.T)
        canvas.drawPicture(sp.picture)
        canvas.restore()
        draws += e.draws
      }
      for (const root of this.rootOrder) {
        const e = this.roots.get(root)
        if (!e) continue
        const l = ctx.layout.nodes.get(root)
        if (l && !l.visible) continue
        // Board 35: a root with moving layers draws live from the painter this frame.
        if (this.motion && this.motionRoots.has(root)) {
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
          const counters: DrawCounters = { nodes: 0, draws: 0 }
          this.need().painter.drawNode(canvas, { ...ctx, motion: this.motion }, root, counters)
          drawn += counters.nodes
          draws += counters.draws
          continue
        }
        // A top-level instance root draws from its shared picture (no root picture).
        if (!e.picture && e.wrap) {
          if (this.sharedInstances && this.shared.get(e.wrap.key) === e.wrap.sp) {
            if (e.bounds && !intersects(e.bounds, visible)) {
              culled += e.nodes
              continue
            }
            if (e.timed && animate && !bucket) drawLive(root, e)
            else drawWrapped(e, e.wrap)
            continue
          }
          e.wrap = null
        }
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
        if (!pic && this.sharedInstances) {
          const t = now()
          const w = this.acquireWrap(ctx, root, e)
          recordMs += now() - t
          if (w) {
            this.last.wrapped++
            if (e.timed && animate && !bucket) drawLive(root, e)
            else drawWrapped(e, w)
            continue
          }
        }
        if (!pic) {
          if (progressive && recordMs >= RECORD_FRAME_MS) {
            behind = true
            continue
          }
          const t = now()
          pic = this.picture(ctx, root, e)
          recordMs += now() - t
          this.last.recorded++
        }
        if (!pic) continue
        if (e.bounds && !intersects(e.bounds, visible)) {
          culled += e.nodes
          continue
        }
        if (e.timed && animate && !bucket) {
          drawLive(root, e)
          continue
        }
        e.used = this.frames + 1
        drawn += e.nodes
        // Zoomed out: every root from its raster. Moving above that: filtered roots only, at
        // the bucket scale capped to the largest raster that fits (upsampled ≤ 2× in motion).
        // Raster to draw this root from: zoomed out, every root at the bucket scale; in motion
        // above that, filtered roots only (see MOTION_MS).
        let target = bucket
        /** Lowest stale raster scale acceptable when this frame's raster budget is spent. */
        let staleMin = bucket
        let r: RootRaster | null = null
        // Zooming out/in below RASTER_MAX_SCALE: a filtered root keeps its current raster while
        // within 2× of the bucket (re-rasterizing one costs a full GPU replay of its filters);
        // the frame after the viewport rests re-rasterizes at the exact bucket.
        if (bucket && inMotion && zooming && e.layers > 0) {
          const cur = e.raster
          if (cur && cur.scale >= bucket / 2 && cur.scale <= bucket * 2) r = cur
        }
        if (!bucket && moving && e.layers > 0 && e.bounds) {
          const want = rasterBucket(scale)
          // Largest power-of-two scale whose raster fits RASTER_MAX_SIDE.
          const cap =
            2 ** Math.floor(Math.log2((RASTER_MAX_SIDE - 2) / Math.max(e.bounds.w, e.bounds.h, 1)))
          const cur = e.raster
          if (zooming) {
            // Zooming crosses scale buckets every few frames: reuse any raster within 4×
            // (soft or aliased only while the zoom moves) and make missing ones at half
            // resolution (a quarter of the GPU work).
            if (cur && cur.scale >= want / 4 && cur.scale <= want * 4) r = cur
            else if (Math.min(want / 2, cap) >= want / 8) target = Math.min(want / 2, cap)
            staleMin = Number.POSITIVE_INFINITY
          } else if (Math.min(want, cap) >= want / 2) {
            // Panning: a raster at the bucket scale, reused frame to frame.
            target = Math.min(want, cap)
            staleMin = target / 2
          }
        }
        // A root wrapping a shared instance picture: one raster per variant, drawn under the
        // root's transform (a 1k-instance grid zoomed out rasterizes a handful of images).
        const wrap = e.wrap
        if (!r && target && wrap?.sp.bounds && this.shared.get(wrap.key) === wrap.sp) {
          const sp = wrap.sp
          let sr = this.levelAt(sp, target) ?? sp.raster
          if (sr?.scale !== target) {
            if (rasterMs < RASTER_FRAME_MS) {
              const t = now()
              sr = this.rasterize(sp, sp.picture, sp.bounds as Rect, target) ?? null
              rasterMs += now() - t
              this.last.rasterized++
            } else {
              if (!sr || sr.scale < staleMin) sr = null
              behind = true
            }
          }
          if (sr) {
            sp.rasterUsed = this.frames + 1
            canvas.save()
            placeAt(canvas, wrap.T)
            canvas.drawImageRectOptions(
              sr.image,
              ck.XYWHRect(0, 0, sr.image.width(), sr.image.height()),
              ck.XYWHRect(sr.x, sr.y, sr.w, sr.h),
              ck.FilterMode.Linear,
              ck.MipmapMode.None,
              null,
            )
            canvas.restore()
            draws += 1
            continue
          }
        }
        if (!r && target && e.bounds) {
          r = this.levelAt(e, target) ?? e.raster
          if (r?.scale !== target) {
            if (rasterMs < RASTER_FRAME_MS) {
              const t = now()
              r = this.rasterize(e, pic, e.bounds, target) ?? null
              rasterMs += now() - t
              this.last.rasterized++
            } else {
              // Over this frame's budget: an acceptable stale raster (zoomed out: a sharper
              // one); otherwise replay.
              if (!r || r.scale < staleMin) r = null
              behind = true
            }
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
        canvas.drawPicture(pic)
        draws += e.draws
      }
      canvas.restore()
      this.last.recordMs = recordMs
      this.last.rasterMs = rasterMs
      if (behind) this.requestFrame()
      if (animate && timedVisible && !this.shaderTimer)
        this.shaderTimer = setTimeout(
          () => {
            this.shaderTimer = null
            this.requestFrame()
          },
          Math.max(SHADER_FRAME_MS, liveMs * 3),
        )
    }
    if (this.overlayPainter) {
      canvas.save()
      canvas.scale(this.dpr, this.dpr)
      const oc = { draws: 0 }
      this.overlayPainter.draw(canvas, this.overlay, this.layout, v, this.theme, oc, {
        dpr: this.dpr,
        width: this.cssW,
        height: this.cssH,
        scene: this.scene,
        image: (src) => {
          const st = this.images?.get(src)
          return st?.status === "ready" ? st.image : null
        },
      })
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
    const token = this.frameToken
    raf(() => {
      if (token !== this.frameToken) return
      this.framePending = false
      this.render()
    })
  }

  renderPending(): boolean {
    if (!this.framePending) return false
    this.frameToken++
    this.framePending = false
    this.render()
    return true
  }

  /** PNG of the current raster/software surface (headless snapshots, debugging). */
  snapshot(): Uint8Array {
    const { ck } = this.need()
    if (!this.surface) throw new RendererError("NOT_INITIALIZED", "no surface attached")
    // Board 35: snapshots show the final state, never an in-between motion frame.
    const motion = this.motion
    this.motion = null
    try {
      this.render()
    } finally {
      this.motion = motion
    }
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
  retryFonts(): void {
    if (!this.fontProvider) return
    this.fontProvider.retryMissing()
    this.textEngine?.invalidate()
    this.dropAll(false)
    this.requestFrame()
  }

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

  /** Board 27 crop mode: natural size of an image asset (loads it when needed). */
  async imageSize(src: string): Promise<{ width: number; height: number } | null> {
    const images = this.images
    if (!images) return null
    await images.load(src)
    const st = images.get(src)
    return st.status === "ready" ? { width: st.image.width(), height: st.image.height() } : null
  }

  samplePixel(world: Point): [number, number, number, number] | null {
    const ctx = this.context()
    if (!ctx || !this.ck) return null
    const { ck } = this.need()
    const px = Math.floor(world.x)
    const py = Math.floor(world.y)
    const cell: Rect = { x: px, y: py, w: 1, h: 1 }
    const surface = ck.MakeSurface(1, 1)
    if (!surface) return null
    try {
      const c = surface.getCanvas()
      c.clear(ck.TRANSPARENT)
      c.translate(-px, -py)
      for (const root of this.rootOrder) {
        const e = this.roots.get(root)
        const l = ctx.layout.nodes.get(root)
        if (!e || (l && !l.visible)) continue
        const pic = this.picture(ctx, root, e)
        if (!pic || (e.bounds && !intersects(e.bounds, cell))) continue
        c.drawPicture(pic)
      }
      surface.flush()
      const px4 = c.readPixels(0, 0, {
        width: 1,
        height: 1,
        colorType: ck.ColorType.RGBA_8888,
        alphaType: ck.AlphaType.Unpremul,
        colorSpace: ck.ColorSpace.SRGB,
      })
      if (!px4 || px4.length < 4) return null
      return [px4[0] as number, px4[1] as number, px4[2] as number, px4[3] as number]
    } finally {
      surface.delete()
    }
  }

  async exportRaster(nodeId: string, options: RasterExportOptions = {}): Promise<Uint8Array> {
    const scale = options.scale ?? 1
    return this.encodeRaster([nodeId], options.background, (box) => ({
      w: Math.max(1, Math.ceil(box.w * scale)),
      h: Math.max(1, Math.ceil(box.h * scale)),
      scale,
      dx: 0,
      dy: 0,
    }))
  }

  async exportThumbnail(
    nodeIds: readonly string[],
    options: ThumbnailExportOptions,
  ): Promise<Uint8Array> {
    const w = Math.max(1, Math.round(options.width))
    const h = Math.max(1, Math.round(options.height))
    return this.encodeRaster(nodeIds, options.background, (box) => {
      // object-fit: cover, centered.
      const scale = Math.max(w / Math.max(box.w, 1e-6), h / Math.max(box.h, 1e-6))
      return { w, h, scale, dx: (w - box.w * scale) / 2, dy: (h - box.h * scale) / 2 }
    })
  }

  /**
   * Draws `nodeIds` (their world boxes' union) onto a CPU raster surface sized by `fit` and
   * encodes it as PNG. Waits for the nodes' fonts, images and icons first.
   */
  private async encodeRaster(
    nodeIds: readonly string[],
    background: string | undefined,
    fit: (box: Rect) => { w: number; h: number; scale: number; dx: number; dy: number },
  ): Promise<Uint8Array> {
    const { ck, painter, images } = this.need()
    const shaders = this.shaderCache
    const ctx0 = this.context()
    const ids = nodeIds.filter((id) => ctx0?.layout.nodes.get(id))
    if (!ctx0 || !ids.length || ids.length !== nodeIds.length)
      throw new RendererError(
        "NODE_NOT_FOUND",
        `node ${nodeIds.find((id) => !ctx0?.layout.nodes.get(id)) ?? nodeIds[0]} is not laid out`,
      )
    for (const id of ids) await this.ensureFonts(id)
    await Promise.all(
      ids.flatMap((id) => [
        ...[...painter.imagesOf(ctx0, id)].map((src) => images.load(src)),
        ...[...painter.shadersOf(ctx0, id)].map((src) => shaders?.load(src)),
        this.iconRegistry?.ensure(painter.iconsOf(ctx0, id)),
      ]),
    )
    const ctx = this.context() ?? ctx0
    let box: Rect | null = null
    for (const id of ids) {
      const b = (ctx.layout.nodes.get(id) ?? ctx0.layout.nodes.get(id))?.world
      if (b) box = union(box, b)
    }
    if (!box) throw new RendererError("NODE_NOT_FOUND", `node ${ids[0]} is not laid out`)
    const f = fit(box)
    const surface = ck.MakeSurface(f.w, f.h)
    if (!surface)
      throw new RendererError("NOT_IMPLEMENTED", `cannot allocate a ${f.w}×${f.h} raster surface`)
    try {
      const c = surface.getCanvas()
      const bg = background ? parseColor(background) : null
      c.clear(bg ? ck.Color4f(bg[0], bg[1], bg[2], bg[3]) : ck.TRANSPARENT)
      c.translate(f.dx, f.dy)
      c.scale(f.scale, f.scale)
      c.translate(-box.x, -box.y)
      painter.skipAgentNodes = true
      try {
        for (const id of ids) painter.drawNode(c, ctx, id, { nodes: 0, draws: 0 })
      } finally {
        painter.skipAgentNodes = false
      }
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
      recordMs: this.last.recordMs,
      rasterMs: this.last.rasterMs,
      recorded: this.last.recorded,
      rasterized: this.last.rasterized,
      sharedRecorded: this.last.sharedRecorded,
      wrapped: this.last.wrapped,
    }
  }
}
