/**
 * Renderer contracts: M1 (ADR 0004, ADR 0009), M2 overlays and icons (ADR 0010). One CanvasKit implementation serves the
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

/**
 * A snapping/measurement guide in world space.
 * @deprecated M1 placeholder; M2 hosts use {@link Overlay.snap}, {@link Overlay.spacing} and
 * {@link Overlay.measurements}. Still drawn (1px selection line + optional label) when set.
 */
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

// --- M2 overlays (desing.pen board 10 "Canvas Overlays (M2)", nzfXx) ------------------------
//
// Every coordinate below is WORLD space unless the name says `screen`; the renderer maps it
// with the viewport and draws every stroke/label at constant screen size (1px lines, 11px mono
// labels at any zoom). Lines are pixel-snapped: a 1px line sits on a half pixel (board 10 puts
// a guide for edge y=128 at y=127.5, h=1).

/**
 * One snap line (board 10 #1 "Snapping while moving", O68JG1: "Guide" k4EEW). Drawn 1px
 * `measure`, spanning [`from`, `to`] plus {@link OVERLAY_SPEC_M2}.snap.overhang screen px at
 * both ends ("guides span both objects plus 8px").
 */
export interface SnapLine {
  /** `x`: a vertical line at world x = `at`; `y`: a horizontal line at world y = `at`. */
  axis: "x" | "y"
  at: number
  /** World extent along the other axis (union of the snapped objects). */
  from: number
  to: number
}

/** Snap state while moving/resizing: lines plus × markers on every snapped point. */
export interface SnapOverlay {
  lines: readonly SnapLine[]
  /** World points where an edge/center coincides (SnapMarker L1uJy, 7×7 ×, centered). */
  markers: readonly Point[]
}

/**
 * Equal-spacing indicator (board 10 #2, V6rSVv): the gap area tinted `measure-soft`, a 1px
 * `measure` line across it at the cross-axis midpoint with 1×10 end ticks inside the gap, and
 * a MeasurePill (lSZXU) centered on the line.
 */
export interface SpacingIndicator {
  /** Main axis of the gap: `x` = horizontal gap between siblings side by side. */
  axis: "x" | "y"
  /** Gap start/end on `axis` (world). */
  from: number
  to: number
  /** Cross-axis extent of the tinted area (world; the overlap of the two neighbors). */
  crossFrom: number
  crossTo: number
  /** Pill text, e.g. `"48"` (the host formats world units). */
  label: string
}

/**
 * A distance (board 10 #3a C7xrZ / #3b): a 1px `measure` line with a MeasurePill centered on
 * its midpoint (pill drawn above content).
 */
export interface Measurement {
  /** `x`: horizontal line from x=`from` to x=`to` at world y=`at`; `y`: vertical line. */
  axis: "x" | "y"
  at: number
  from: number
  to: number
  label: string
}

/**
 * A node outlined in `measure` while ⌥-measuring (board 10 #3a "Hover outline" rmL0x: 1px,
 * follows the node's corner radius; #3b "Parent outline" DglSx: same at opacity 0.5).
 */
export interface MeasureOutline {
  id: string
  role: "target" | "parent"
}

/**
 * A vertex of a path being drawn or edited, absolute world coordinates. `in`/`out` are the
 * bezier control points (absent = sharp corner on that side).
 */
export interface PathAnchorPoint {
  x: number
  y: number
  in?: Point | null
  out?: Point | null
}

/** One contour of a path overlay: anchors in order; `closed` joins the last to the first. */
export interface PathContour {
  anchors: readonly PathAnchorPoint[]
  closed: boolean
}

/** Address of one anchor: contour index + anchor index. */
export interface AnchorRef {
  contour: number
  index: number
}

/**
 * Pen tool while drawing (board 10 #5 "Pen tool — drawing", cXWyk). Draws the contour with its
 * own `stroke` ("User path" ZiOBk), then the contour outline 1px `selection`, every anchor as PathAnchor (iqdgN), the active anchor as PathAnchor/Active
 * (V9wRl), the handles of `handlesFor` (1px lines + BezierHandle B65mjM), the preview segment
 * ("Rubber band" BjnR2: 1px `selection` at opacity 0.7) and, when `closeHint`, a 14×14 ring
 * (z6CuY5, stroke 1.5 `selection`) centered on the first anchor. The pen cursor and the
 * "Close path" Tooltip/Hint are DOM (host), not canvas.
 */
export interface PenOverlay {
  contour: PathContour
  /**
   * The contour's own stroke as it will be written ("User path" ZiOBk, drawn under the outline):
   * hex color and width in world units (scaled by zoom). Null/absent: outline only.
   */
  stroke?: { color: string; width: number } | null
  /** Index of the last-placed anchor (filled), or null. */
  active: number | null
  /** Anchors whose handles are shown (cXWyk: every anchor that has a handle). */
  handlesFor: readonly number[]
  /**
   * Segment from the last anchor to the cursor: cubic when the last anchor has an `out`
   * handle (`c1` = that handle, `c2` = `to`), straight otherwise. Null hides it.
   */
  preview: { from: Point; c1?: Point; c2?: Point; to: Point } | null
  /** Cursor is within the close threshold of the first anchor. */
  closeHint: boolean
}

/**
 * Path edit mode (board 10 #6 "Path edit mode", B9dJsH): all segments outlined 1px
 * `selection`, every vertex an anchor, selected vertices filled; only selected vertices show
 * their handles. `badge` is a SizeBadge (JlrHC) next to the (first) selected vertex, e.g.
 * `"460, 180"`, offset by {@link OVERLAY_SPEC_M2}.pathEdit.vertexBadgeOffset. The mode pill
 * ("Editing path · Esc or Enter to exit") is a DOM Tooltip/Hint (host).
 */
export interface PathEditOverlay {
  nodeId: string
  /** Contours in world space (host converts the node's `d` through its transform). */
  contours: readonly PathContour[]
  selected: readonly AnchorRef[]
  /** Hovered segment for insertion feedback (drawn 1.5px), or null. */
  hoveredSegment?: AnchorRef | null
  badge?: string | null
}

/**
 * Resize of a frame with layout children (board 10 #8, ect1B): each flowing child outlined
 * 1px `selection` at opacity 0.35 with a SizingBadge (xPekI) centered on it, above the
 * selection's top edge; the pre-drag edge as a dashed "Ghost edge" (GV63U); the live
 * SizeBadge under the selection (existing `sizeLabel`).
 */
export interface ResizeOverlay {
  children: readonly { id: string; label: string }[]
  /** Pre-drag position of the dragged edge (world), drawn 4/4 dashed 1px `selection`. */
  ghostEdge?: SnapLine | null
}

/**
 * A badge that follows the pointer (SizeBadge/Delta PIz6o: `accent` fill, `on-accent` mono
 * 11/500, e.g. `"+60"` while resizing or the pixel readout `"x 22 · y 14 · E76F51 66%"`).
 * `screen` is the badge's top-left in CSS px; the host places it per
 * {@link OVERLAY_SPEC_M2}.deltaBadge.
 */
export interface CursorBadge {
  text: string
  screen: Point
}

/** Editor overlays drawn on top of the document in screen space (not exported). */
export interface Overlay {
  /** Selected node ids: outline + corner handles + size badge (single or union box). */
  selection: readonly string[]
  /** Hovered node id: outline only. */
  hovered: string | null
  /** Marquee rectangle in world space. */
  marquee: Rect | null
  /** @deprecated M1 guides; see {@link SnapGuide}. */
  guides?: readonly SnapGuide[]
  /** Size badge text under the selection (`"720 × Hug 366"`); null hides it. */
  sizeLabel?: string | null
  /** Hide handles while dragging/transforming. Default true. */
  handles?: boolean

  // M2 (board 10). All optional: absent = not drawn.
  /** Snap lines + markers while moving/resizing (#1). */
  snap?: SnapOverlay | null
  /** Equal-spacing indicators (#2). */
  spacing?: readonly SpacingIndicator[]
  /** ⌥ distances (#3a/#3b). */
  measurements?: readonly Measurement[]
  /** Nodes outlined in `measure` while ⌥-measuring (#3a target, #3b parent). */
  measureOutlines?: readonly MeasureOutline[]
  /**
   * Pixel grid (#4): drawn when `zoom > OVERLAY_SPEC_M2.pixelGrid.minZoom` and this is not
   * false/0. A number is the grid's opacity multiplier (0–1) so the host can fade it in.
   */
  pixelGrid?: boolean | number
  /** Pen tool state (#5). */
  pen?: PenOverlay | null
  /** Path edit mode (#6). Selection handles are hidden while set. */
  pathEdit?: PathEditOverlay | null
  /** Resize with layout children (#8). */
  resize?: ResizeOverlay | null
  /** Pointer-following delta badge (#8 "Delta", #4 "Pixel readout"). */
  cursorBadge?: CursorBadge | null
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
  // M2 (optional so M1 hosts keep compiling; the renderer falls back to the light values).
  /** `measure` (#E5177E light / #FF5CAB dark): guides, markers, distances, pills. */
  measure?: string
  /** `measure-soft` (#E5177E1F / #FF5CAB2E): equal-spacing gap tint. */
  measureSoft?: string
  /** `on-accent` (#FFFFFF / #0A0A0A): pill and badge text. */
  onAccent?: string
  /** `selection-soft` (#2F6BFF1A / #4C8DFF26): SizingBadge fill. */
  selectionSoft?: string
  /** `accent-text` (#0A0A0A / #F5F5F4): SizingBadge text. */
  accentText?: string
  /** `accent` (#0A0A0A / #F5F5F4): SizeBadge/Delta fill. */
  accent?: string
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

/**
 * M2 overlay geometry from `desing.pen` board 10 (nzfXx) and the 02b components it uses.
 * Screen-space CSS px. Colors are token names resolved through {@link OverlayTheme}, except
 * `pixelGrid.color`, which is fixed in both themes (it sits on document pixels).
 */
export const OVERLAY_SPEC_M2 = {
  /** #1 O68JG1: "Guide" k4EEW (w 496 = objects 80…560 + 8 each side, h 1, fill measure). */
  snap: {
    lineWidth: 1,
    color: "measure",
    overhang: 8,
    /** SnapMarker L1uJy: 7×7 frame, path "M0.5 0.5l6 6m0-6l-6 6", stroke 1.25 round cap. */
    marker: { size: 7, path: "M0.5 0.5l6 6m0-6l-6 6", strokeWidth: 1.25, cap: "round" },
  },
  /** #2 V6rSVv: Gap F8D1s (measure-soft), Guide M4nMBy (1px), ticks Q9RyVV/QT3OF (1×10, inside the gap). */
  spacing: { fill: "measure-soft", lineWidth: 1, tickLength: 10, tickWidth: 1, color: "measure" },
  /**
   * MeasurePill lSZXU: fill measure, radius-pill 999, padding [2, 8], mono 11/500 on-accent.
   * Rendered 19 tall in the .pen (width = text + 16: "48" → 30, "120" → 36); centered on the
   * line's midpoint.
   */
  pill: {
    fill: "measure",
    radius: 999,
    padding: [2, 8] as const,
    fontSize: 11,
    fontWeight: 500,
    text: "on-accent",
    height: 19,
  },
  /** #3a/#3b: lines 1px measure; "Hover outline" rmL0x 1px; "Parent outline" DglSx 1px @ 0.5. */
  measure: { lineWidth: 1, outlineWidth: 1, parentOutlineOpacity: 0.5 },
  /** #4 hD0aS: "Pixel grid" j2MBuX, 1px #0A0A0A14, one cell per world unit, "Above 400%". */
  pixelGrid: { minZoom: 4, lineWidth: 1, color: "#0A0A0A14" },
  /** #5 cXWyk / #6 B9dJsH. */
  path: {
    /** PathAnchor iqdgN: 7×7 rect, fill #FFFFFF (handleFill), stroke 1.5 selection. Active V9wRl: fill selection. */
    anchor: { size: 7, strokeWidth: 1.5 },
    /** BezierHandle B65mjM: 6×6 ellipse, fill #FFFFFF, stroke 1.25 selection. */
    handle: { size: 6, strokeWidth: 1.25 },
    /** "Handle line" R5Haai: 1px selection. */
    handleLineWidth: 1,
    /** "Path outline" Q7syMW: 1px selection. */
    outlineWidth: 1,
    /** "Rubber band" BjnR2: 1px selection at opacity 0.7. */
    preview: { width: 1, opacity: 0.7 },
    /** "Close ring" z6CuY5: 14×14 ellipse, stroke 1.5 selection, centered on the first anchor. */
    closeRing: { size: 14, strokeWidth: 1.5 },
  },
  /** #6: "Vertex badge" PzxaD (SizeBadge) top-left = selected anchor center + (16, −14). */
  pathEdit: { vertexBadgeOffset: { x: 16, y: -14 } },
  /** #8 ect1B. */
  resize: {
    /** "Child outline" c4Meq: 1px selection at opacity 0.35. */
    childOutline: { width: 1, opacity: 0.35 },
    /**
     * SizingBadge xPekI: fill selection-soft, radius 999, padding [2, 8], mono 11/500
     * accent-text; centered on the child's x center, bottom edge 7px above the selection's
     * top edge (vignette: badge y 144 + h 19 = 163, selection top 170).
     */
    sizingBadge: {
      fill: "selection-soft",
      text: "accent-text",
      radius: 999,
      padding: [2, 8] as const,
      fontSize: 11,
      fontWeight: 500,
      offset: 7,
    },
    /** "Ghost edge" GV63U: 1px selection, dash 4/4, extends 8px beyond the selection. */
    ghostEdge: { width: 1, dash: [4, 4] as const, overhang: 8 },
  },
  /**
   * SizeBadge/Delta PIz6o: SizeBadge with fill accent. In #8 its top-left is
   * (dragged edge x + 4, pointer y + 12) (edge 560 → badge x 564; pointer 210 → badge y 222).
   */
  deltaBadge: { fill: "accent", text: "on-accent", edgeOffsetX: 4, pointerOffsetY: 12 },
} as const

// --- Icons ---------------------------------------------------------------------------------

/** Icon libraries the editor offers (board 09 icon picker: Lucide · Phosphor · Material · Feather). */
export type IconLibrary = "lucide" | "phosphor" | "material" | "feather"

/** A path of an icon glyph, in the glyph's `viewBox` units. */
export interface IconPath {
  d: string
  /** `stroke` paths (lucide, feather) are drawn with the node's stroke width, round caps/joins. */
  paint: "fill" | "stroke"
  fillRule?: "nonzero" | "evenodd"
  /** Phosphor duotone back layer is 0.2. Default 1. */
  opacity?: number
}

/**
 * Normalized glyph: every SVG element (circle, rect, line, polyline, polygon, path) converted
 * to path data. The renderer scales `viewBox` to the node's `w`×`h` and paints with the node's
 * `color` (default: the text default color rule does not apply; absent = #000000).
 */
export interface IconGlyph {
  set: string
  name: string
  /** Resolved weight (Material wght 100–700; phosphor 100/300/400/700), or null. */
  weight: number | null
  viewBox: readonly [number, number, number, number]
  paths: readonly IconPath[]
  /** Native stroke width for stroke sets (2 for lucide/feather), in `viewBox` units. */
  strokeWidth?: number
}

/** One searchable entry of a library (icon picker). */
export interface IconCatalogEntry {
  name: string
  tags?: readonly string[]
}

/**
 * Icon data source (ADR 0010). Lazy per icon: never bundles a whole set into the main chunk.
 * `set` is the `.kimo` icon node `set` (`lucide`, `feather`, `phosphor`,
 * `material-outlined`, `material-rounded`, `material-sharp`).
 */
export interface IconProvider {
  /** Loads (once) one glyph. Resolves null for an unknown set/name (drawn as missing glyph). */
  load(set: string, name: string, weight?: number): Promise<IconGlyph | null>
  /** Synchronous cache read (draw path). */
  get(set: string, name: string, weight?: number): IconGlyph | null
  /** Names (and tags) of a set for the picker; loaded lazily, cached. */
  catalog(set: string): Promise<readonly IconCatalogEntry[]>
  /** Fires after a glyph finishes loading. Returns an unsubscribe function. */
  onIconLoaded(listener: (set: string, name: string) => void): () => void
  /**
   * Optional: `missing` = not in the set (final); `failed` = the last load failed (network)
   * and is retried with backoff; `unknown` = never requested. Without it, a null load counts
   * as missing.
   */
  status?(
    set: string,
    name: string,
    weight?: number,
  ): "loading" | "ready" | "missing" | "failed" | "unknown"
}

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
  /** Icon glyph source (M2). Default: the renderer's lazy static-package provider. */
  icons?: IconProvider
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
  /**
   * M2 diagnostics of the last frame (perf harness): CPU ms spent recording pictures and
   * creating raster-cache images, and how many roots were recorded / rasterized.
   */
  recordMs?: number
  rasterMs?: number
  recorded?: number
  rasterized?: number
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
  /** Icon glyph source (M2; optional so M1 fakes keep compiling). */
  readonly icons?: IconProvider

  /**
   * PNG bytes of one node's subtree at `scale`, rendered on a CPU raster surface (works
   * headless). Waits for its fonts and image assets. Overlays are never included.
   */
  exportRaster(nodeId: string, options?: RasterExportOptions): Promise<Uint8Array>
  /**
   * M2 (#4 "Pixel readout"): the document's own color of the one document pixel containing
   * world point `world` (no canvas background, no overlays), as unpremultiplied RGBA 0–255;
   * null when nothing is laid out. Optional so M1 fakes keep compiling.
   */
  samplePixel?(world: Point): [number, number, number, number] | null

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
