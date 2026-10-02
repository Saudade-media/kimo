/**
 * M1 renderer contracts (ADR 0004, ADR 0009). One CanvasKit implementation serves the
 * interactive WebGL canvas and the headless raster path (Bun/Node, MCP renders, PNG export).
 *
 * No React here, and no CanvasKit types in the public surface (ADR 0004 §5). DOM types appear
 * only as type references (`HTMLCanvasElement | OffscreenCanvas`) for `attach`, which the
 * headless path never calls.
 */
import type {
  LayoutResult,
  NodeSource,
  Rect,
  ResolveHeader,
  Resolver,
  TextMeasurer,
} from "@kimo/layout"

export type { Rect } from "@kimo/layout"

/** A point. Screen points are CSS pixels relative to the canvas's top-left corner. */
export interface Point {
  x: number
  y: number
}

/**
 * The visible region; structurally identical to `@kimo/editor-state`'s `Viewport`:
 * `screen = (world - {x, y}) * zoom`.
 */
export interface Viewport {
  x: number
  y: number
  zoom: number
}

// --- Document ------------------------------------------------------------------------------

/** Loads asset bytes for `./assets/<hash>.<ext>` references (image fills, document fonts). */
export interface AssetSource {
  /** Resolves the bytes, or null when the asset is missing (drawn as a checkerboard). */
  load(src: string): Promise<Uint8Array | null>
}

/**
 * What the renderer paints. The renderer never subscribes to a store itself: the host (the
 * web app's CanvasHost, the CLI, the MCP server) owns the pipeline
 * `DocStore.onChange → LayoutEngine.update → setLayout + invalidate → requestFrame`.
 * `nodes` is read lazily at draw time, so a live `DocStore` can be passed directly.
 */
export interface RenderScene {
  nodes: NodeSource
  header: ResolveHeader | (() => ResolveHeader)
  resolve: Resolver
  assets: AssetSource
  /** Canvas background (world space, behind every root). Default: transparent. */
  background?: string
}

// --- Overlays ------------------------------------------------------------------------------

/** A snapping/measurement guide in world space. */
export interface SnapGuide {
  axis: "x" | "y"
  /** World coordinate of the line on `axis`. */
  at: number
  /** World extent along the other axis. */
  from: number
  to: number
  /** Optional distance label (measurement), drawn at the segment's midpoint. */
  label?: string
}

/** Editor overlays drawn on top of the document in screen space (not exported). */
export interface Overlay {
  /** Selected node ids: outline + corner handles + size badge (single or union box). */
  selection: readonly string[]
  /** Hovered node id: outline only. */
  hovered: string | null
  /** Marquee rectangle in world space. */
  marquee: Rect | null
  /** Snapping guides (M2; ignored in M1 if empty). */
  guides?: readonly SnapGuide[]
  /** Size badge text under the selection (`"720 × Hug 366"`); null hides it. */
  sizeLabel?: string | null
  /** Hide handles while dragging/transforming. Default true. */
  handles?: boolean
}

/** Colors for overlays, supplied by the host from design tokens (`--kimo-selection`, …). */
export interface OverlayTheme {
  selection: string
  /** Handle fill (#FFFFFF in board 03). */
  handleFill: string
  /** Size-badge text color (`on-accent`). */
  onSelection: string
  /** Font family for the size badge (`font-mono`, JetBrains Mono). */
  monoFamily: string
}

/**
 * Overlay geometry, copied from `desing.pen` board 03 (Canvas: "Selection Outline",
 * "Handle", "Size Badge"). Screen-space px, independent of zoom.
 */
export const OVERLAY_SPEC = {
  outlineWidth: 1.5,
  hoverWidth: 1.5,
  handleSize: 8,
  handleRadius: 2,
  handleStrokeWidth: 1.5,
  /** Badge: pill, padding [2, 8], 8px below the selection, centered. */
  badgePadding: [2, 8] as const,
  badgeOffset: 8,
  badgeFontSize: 11,
  badgeFontWeight: 500,
} as const

// --- Fonts ---------------------------------------------------------------------------------

export type FontStyle = "normal" | "italic"

/** A concrete font face. Weight is the requested CSS weight (1–1000). */
export interface FontFaceKey {
  family: string
  weight: number
  style: FontStyle
}

/** Where font bytes come from; tried in order by the {@link FontProvider}. */
export interface FontSource {
  readonly name: string
  /** TTF/OTF/WOFF/WOFF2 bytes for the nearest available face, or null if this source has none. */
  fetch(key: FontFaceKey): Promise<{ bytes: Uint8Array; weight: number; style: FontStyle } | null>
}

/** Result of {@link FontProvider.ensureFont}. */
export interface FontLoadResult {
  key: FontFaceKey
  /** False when no source had the family and the fallback is used. */
  loaded: boolean
  /** The face actually used (nearest weight/style, or the fallback family). */
  resolved: FontFaceKey
  source?: string
}

/**
 * Font registry backing Paragraph (CanvasKit `TypefaceFontProvider`). Text measured before its
 * font arrives uses the fallback; when the font loads, `onFontLoaded` fires and the host must
 * re-run layout for text nodes using that family (ADR 0009 "fonts").
 */
export interface FontProvider {
  /** Loads (once) and registers a face. Never rejects for a missing font. */
  ensureFont(family: string, weight: number, style: FontStyle): Promise<FontLoadResult>
  /** Synchronous check: is this face (or its nearest registered weight) available? */
  has(family: string, weight: number, style: FontStyle): boolean
  /** Registers bytes directly (document font assets, tests). */
  register(bytes: Uint8Array, key: FontFaceKey): void
  /** Fires after a face finishes loading. Returns an unsubscribe function. */
  onFontLoaded(listener: (key: FontFaceKey) => void): () => void
  /** Deterministic last-resort family (bundled Inter). */
  readonly fallbackFamily: string
}

// --- Renderer ------------------------------------------------------------------------------

/** Options for {@link Renderer.init}. */
export interface RendererInitOptions {
  /**
   * URL of `canvaskit.wasm` (browser: a Vite `?url` import of
   * `canvaskit-wasm/bin/canvaskit.wasm`). Headless: omitted → resolved from node_modules.
   */
  canvaskitWasmUrl?: string
  /** Font sources, tried in order after the bundled faces (e.g. cache, Google Fonts). */
  fontSources?: readonly FontSource[]
  /** Disallow network font fetches ("no third-party fetch" setting). Default false. */
  offlineFonts?: boolean
  overlayTheme?: OverlayTheme
}

/** Options for {@link Renderer.attach}. */
export interface AttachOptions {
  /** Device pixel ratio. Default `globalThis.devicePixelRatio ?? 1`. */
  dpr?: number
  /** Force the CPU (software) surface: WebGL unavailable or broken (ADR 0004 consequences). */
  software?: boolean
}

/** Options for {@link Renderer.hitTest}. */
export interface HitTestOptions {
  /** Extra screen-px slop around thin shapes and text. Default 0. */
  tolerance?: number
  /** Include locked nodes. Default false. */
  includeLocked?: boolean
  /** Include invisible nodes. Default false. */
  includeHidden?: boolean
  /**
   * Restrict results to these candidates (e.g. the children of the entered group). The
   * selection policy (top-level frame vs deepest child, ⌘-click deep select) is the host's.
   */
  within?: ReadonlySet<string>
}

/** Options for {@link Renderer.hitTestRect}. */
export interface HitTestRectOptions extends Omit<HitTestOptions, "tolerance"> {
  /** `intersect` (default): any overlap. `contain`: fully inside. */
  mode?: "intersect" | "contain"
}

/** Options for {@link Renderer.exportRaster}. */
export interface RasterExportOptions {
  /** Pixel scale (1 = 1 world unit per pixel). Default 1. */
  scale?: number
  /** Background behind the node; default transparent. */
  background?: string
}

/** Rolling frame statistics for the perf gate (M1: 5k nodes at 60 fps). */
export interface RenderStats {
  /** Frames rendered since attach. */
  frames: number
  /** Frames per second over the last second of activity. */
  fps: number
  /** Last frame's CPU time in ms (scene traversal + command recording + flush). */
  frameMs: number
  /** Mean / 95th percentile CPU frame time over the last 120 frames. */
  frameMsAvg: number
  frameMsP95: number
  /** CanvasKit draw calls issued in the last frame. */
  drawCalls: number
  /** Nodes painted / skipped by viewport culling in the last frame. */
  nodesDrawn: number
  nodesCulled: number
  backend: "webgl" | "software" | "raster"
}

/** Error thrown/reported by the renderer. */
export class RendererError extends Error {
  override readonly name = "RendererError"
  constructor(
    readonly code:
      | "NOT_INITIALIZED"
      | "WASM_LOAD_FAILED"
      | "WEBGL_UNAVAILABLE"
      | "CONTEXT_LOST"
      | "NODE_NOT_FOUND"
      | "NOT_IMPLEMENTED",
    message: string,
  ) {
    super(message)
  }
}

/**
 * The renderer. Lifecycle: `init` → (`attach`)? → `setDocument` → `setLayout` → frames →
 * `dispose`. All `set*` calls are cheap and only mark state; drawing happens in `render()`
 * (synchronous) or on the next animation frame after `requestFrame()` (coalesced).
 */
export interface Renderer {
  /** Loads CanvasKit and the bundled fonts. Idempotent. */
  init(options?: RendererInitOptions): Promise<void>
  /** Binds an on-screen surface (WebGL, falls back to software). Browser only. */
  attach(canvas: HTMLCanvasElement | OffscreenCanvas, options?: AttachOptions): void
  /** Resizes the attached surface (CSS px + dpr). */
  resize(width: number, height: number, dpr?: number): void
  /** Releases the surface (the renderer stays usable headlessly). */
  detach(): void

  setDocument(scene: RenderScene): void
  /** Paint-only changes (fill, opacity, effects…): drop cached paints/pictures for these ids (all when omitted). */
  invalidate(nodeIds?: Iterable<string>): void
  setLayout(layout: LayoutResult): void
  setViewport(viewport: Viewport): void
  setOverlay(overlay: Overlay): void

  /** Draws now (no-op when not attached). */
  render(): void
  /** Schedules one coalesced draw on the next animation frame. */
  requestFrame(): void

  /** Node ids under a screen point, top-most (last painted) first. */
  hitTest(screen: Point, options?: HitTestOptions): string[]
  /** Node ids whose world boxes meet a screen-space rectangle, top-most first. */
  hitTestRect(screen: Rect, options?: HitTestRectOptions): string[]
  screenToWorld(p: Point): Point
  worldToScreen(p: Point): Point

  /** Paragraph-backed measurer for the layout engine (same engine draws the text). */
  textMeasurer(): TextMeasurer
  readonly fonts: FontProvider

  /**
   * PNG bytes of one node's subtree at `scale`, rendered on a CPU raster surface (works
   * headless). Waits for its fonts and image assets. Overlays are never included.
   */
  exportRaster(nodeId: string, options?: RasterExportOptions): Promise<Uint8Array>

  stats(): RenderStats
  /** Frees every CanvasKit object and the surface. */
  dispose(): void
}

/** Options for {@link createRenderer}. */
export interface CreateRendererOptions {
  /** Called on unrecoverable GPU errors (context lost twice, …). */
  onError?: (error: RendererError) => void
}

/** Factory signature the web app's CanvasHost receives (so tests can inject a fake). */
export type RendererFactory = (options?: CreateRendererOptions) => Renderer
