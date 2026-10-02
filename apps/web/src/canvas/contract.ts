/**
 * Contract between the editor shell and the canvas (M1, ADR 0009; M2 tools, snapping and
 * measurement, ADR 0010). The shell mounts
 * `<CanvasHost {...CanvasHostProps} ref={handle} />`; CanvasHost owns the pipeline
 * `DocStore.onChange → LayoutEngine.update → Renderer.setLayout/invalidate → requestFrame`,
 * pointer/keyboard input for the active tool, and overlays. Everything document-related goes
 * through `store.apply(ops, { origin })`, never directly through the renderer.
 */
import type { createUiStore, DocStore, LocalOrigin, Tool } from "@kimo/editor-state"
import type { LayoutEngine, LayoutEngineOptions, LayoutResult, Rect } from "@kimo/layout"
import type {
  AssetSource,
  FontSource,
  IconProvider,
  Measurement,
  OverlayTheme,
  PathContour,
  Point,
  Renderer,
  RendererError,
  RendererFactory,
  RenderStats,
  SnapOverlay,
  SpacingIndicator,
} from "@kimo/renderer"

/** The vanilla Zustand UI store from `@kimo/editor-state`. */
export type UiStore = ReturnType<typeof createUiStore>

// --- Tools (board 03 "Floating Toolbar", left to right) -----------------------------------

/** Toolbar tool ids, in toolbar order. */
export const CANVAS_TOOL_IDS = [
  "move",
  "frame",
  "rectangle",
  "ellipse",
  "text",
  "pen",
  "image",
  "component",
] as const
export type CanvasToolId = (typeof CANVAS_TOOL_IDS)[number]

/** One toolbar button. `icon` is the exact lucide name from the design node. */
export interface CanvasToolSpec {
  id: CanvasToolId
  /** Layer name in `desing.pen` (tooltip label). */
  label: string
  icon: string
  /** Single-key shortcut (`⇧⌘K` style for chords). */
  shortcut: string
  /**
   * The `@kimo/editor-state` `Tool` this button selects, or null when the button is not a
   * `Tool` mode (image: see `placement`).
   */
  tool: Tool | null
  /**
   * M2: a placement mode held by the canvas host instead of the UI store (editor-state's
   * `Tool` has no `image`). Image: the button opens the file picker; after a file is chosen
   * the host arms an {@link ImagePlacement} and the button shows active until it is placed
   * (click = natural size, drag = draw keeping the aspect ratio) or cancelled (Esc, another
   * tool).
   */
  placement?: "image"
  /** False = rendered disabled. */
  enabled: boolean
}

/** Board 03 floating toolbar: ToolButton refs `Wv5cB nnBhQ uhk56 SMjtG b2kOu h45yX7 H5COB9 vzjNQ`. */
export const CANVAS_TOOLS: readonly CanvasToolSpec[] = [
  {
    id: "move",
    label: "Move",
    icon: "mouse-pointer-2",
    shortcut: "V",
    tool: "select",
    enabled: true,
  },
  { id: "frame", label: "Frame", icon: "frame", shortcut: "F", tool: "frame", enabled: true },
  {
    id: "rectangle",
    label: "Rectangle",
    icon: "square",
    shortcut: "R",
    tool: "rect",
    enabled: true,
  },
  {
    id: "ellipse",
    label: "Ellipse",
    icon: "circle",
    shortcut: "O",
    tool: "ellipse",
    enabled: true,
  },
  { id: "text", label: "Text", icon: "type", shortcut: "T", tool: "text", enabled: true },
  // M2: Pen is a real mode (board 10 #7 "Pen tool active": ToolButton/Active I0D9n4).
  { id: "pen", label: "Pen", icon: "pen-tool", shortcut: "P", tool: "path", enabled: true },
  {
    id: "image",
    label: "Image",
    icon: "image",
    shortcut: "⇧⌘K",
    tool: null,
    placement: "image",
    enabled: true,
  },
  {
    id: "component",
    label: "Component",
    icon: "component",
    shortcut: "⌥⌘K",
    tool: null,
    enabled: false,
  },
]

/** Toolbar id for the current UI-store tool (`hand` and unmapped tools → null: none active). */
export function toolIdFor(tool: Tool): CanvasToolId | null {
  return CANVAS_TOOLS.find((t) => t.tool === tool)?.id ?? null
}

/**
 * M2: the active toolbar id, taking an armed placement into account (an armed image wins
 * over the UI-store tool, which stays `select` meanwhile).
 */
export function activeToolId(tool: Tool, placement: ImagePlacement | null): CanvasToolId | null {
  if (placement) return "image"
  return toolIdFor(tool)
}

/** M2: an image chosen with the Image tool, waiting to be placed on the canvas. */
export interface ImagePlacement {
  kind: "image"
  /** `./assets/<hash>.<ext>` returned by `onImportImage`. */
  src: string
  /** Natural size in px (a click places it at this size). */
  width: number
  height: number
  /**
   * Spec §12 manifest entry of `src`: added in the same edit when the document keeps an
   * `assets` manifest (every reference must be listed).
   */
  entry?: { mime: string; bytes?: number; width?: number; height?: number; name?: string }
}

// --- Pen / path geometry (M2) ---------------------------------------------------------------

/**
 * Conversion between a `path` node and editable contours (pen tool, path edit mode). Pure;
 * implemented in `apps/web/src/canvas/path-geometry.ts` (canvas builder).
 *
 * Commit rule (pen tool): Enter, Esc or closing on the first anchor ends the contour and
 * writes ONE `path` node in one undo step (`store.apply` with the host origin): `x`/`y` = the
 * contours' bounds in the parent's space, `w`/`h` = bounds size, `viewBox` = `[0, 0, w, h]`,
 * `d` relative to that box (absolute commands, numbers rounded to 2 decimals), a 1px stroke
 * in `text/default` (else #000000) and no fill for open contours. A contour with fewer than
 * two anchors writes nothing.
 */
export interface PathGeometry {
  /** Contours of a path node in world space (through its layout transform). */
  fromNode(
    node: { d: string; viewBox?: readonly number[]; w: number; h: number },
    transform: readonly number[],
  ): PathContour[]
  /** Node fields for world-space contours placed in a parent whose world transform is given. */
  toNode(
    contours: readonly PathContour[],
    parentTransform: readonly number[],
  ): {
    x: number
    y: number
    w: number
    h: number
    d: string
    viewBox: [number, number, number, number]
  }
}

// --- Snapping and measurement (M2, pure) ------------------------------------------------------

/**
 * Snap threshold in SCREEN px (house value; not in the design). World threshold =
 * `SNAP_THRESHOLD_PX / zoom`.
 */
export const SNAP_THRESHOLD_PX = 5

/** A snap candidate: a sibling's or the parent's world AABB (`id` for debugging/tests). */
export interface SnapBox {
  id: string
  rect: Rect
}

/** Which edges of the moving box follow the pointer: all (move) or the dragged ones (resize). */
export interface SnapEdges {
  left: boolean
  right: boolean
  top: boolean
  bottom: boolean
}

/**
 * Input of one snap query. Candidates are the selection's siblings (same parent, visible, not
 * selected) plus the parent box itself; the host collects them from `LayoutResult`
 * ({@link collectSnapCandidates}). Snapping considers left/center/right and top/middle/bottom
 * of the moving box against the same lines of every candidate, and equal spacing between
 * siblings in a row/column.
 */
export interface SnapQuery {
  /** World AABB of the moving selection at the raw (unsnapped) pointer position. */
  moving: Rect
  edges: SnapEdges
  candidates: readonly SnapBox[]
  /** The parent box (for the parent's edges/center); also present in `candidates`. */
  parent: SnapBox | null
  zoom: number
  /** Screen px; default {@link SNAP_THRESHOLD_PX}. */
  thresholdPx?: number
  /** ⌘ held: return a zero delta and no guides (board 10 #1 caption). */
  disabled?: boolean
}

/** Output: the delta to add to the raw position, and what to draw (renderer overlay types). */
export interface SnapResult {
  dx: number
  dy: number
  /** Lines + × markers on every snapped point (`Overlay.snap`). Empty when nothing snapped. */
  snap: SnapOverlay
  /** Equal-spacing indicators when the moving box lands on an equal-spacing slot. */
  spacing: readonly SpacingIndicator[]
}

/** Pure snapping function (implemented in `apps/web/src/canvas/snapping.ts`; fast-check tested). */
export type SnapFn = (query: SnapQuery) => SnapResult

/** Collects snap candidates for a selection from a layout (siblings + parent; excludes the selection and hidden nodes). */
export type CollectSnapCandidates = (
  layout: LayoutResult,
  selection: readonly string[],
  parentOf: (id: string) => string | null,
  childrenOf: (id: string | null) => readonly string[],
) => { candidates: SnapBox[]; parent: SnapBox | null }

/**
 * ⌥ measurement query (board 10 #3a/#3b). With a hovered sibling `target`: only the gap(s)
 * between `selection` and `target`, lines on the overlap's center (or the selection's center
 * axis when they do not overlap), `measureOutlines` = target. Without: four distances from the
 * selection's edges to the parent's edges, on the selection's center axes, outline = parent
 * (opacity 0.5). Labels are world units, rounded to 2 decimals, trailing zeros dropped.
 */
export interface MeasureQuery {
  selection: Rect
  target: SnapBox | null
  parent: SnapBox | null
}

export interface MeasureResult {
  measurements: Measurement[]
  outline: { id: string; role: "target" | "parent" } | null
}

/** Pure measurement function (implemented in `apps/web/src/canvas/measure.ts`). */
export type MeasureFn = (query: MeasureQuery) => MeasureResult

// --- Host ---------------------------------------------------------------------------------

/** Factory for the layout engine (injected so tests can fake it). */
export type LayoutEngineFactory = (options?: LayoutEngineOptions) => LayoutEngine

/** Errors surfaced to the shell (it shows a Toast / the WebGL fallback banner). */
export type CanvasError =
  | { kind: "renderer"; error: RendererError }
  | { kind: "layout"; error: Error }
  | { kind: "op"; message: string }

/** What is under a pointer, for context menus and the shell's status UI. */
export interface CanvasPointerInfo {
  screen: Point
  world: Point
  /** Top-most hit node id, or null for empty canvas. */
  hit: string | null
}

/** Props of `<CanvasHost>`. */
export interface CanvasHostProps {
  store: DocStore
  uiStore: UiStore
  createRenderer: RendererFactory
  createLayoutEngine: LayoutEngineFactory
  /** Resolves `./assets/<hash>.<ext>` (IndexedDB on web, the file's folder on desktop). */
  assets: AssetSource
  /** Vite `?url` import of `canvaskit-wasm/bin/canvaskit.wasm`. */
  canvaskitWasmUrl?: string
  /** Extra font sources (persistent cache before Google Fonts). */
  fontSources?: readonly FontSource[]
  /** No network font fetches (the "web fonts" privacy setting off). Default false. */
  offlineFonts?: boolean
  /** Overlay colors from `@kimo/design-tokens` for the current mode. */
  overlayTheme: OverlayTheme
  /** Origin for canvas edits. Default `"user"`. */
  origin?: LocalOrigin
  className?: string

  /** Renderer initialized and first frame drawn. */
  onReady?: (handle: CanvasHandle) => void
  onError?: (error: CanvasError) => void
  /** After each layout pass (properties panel reads boxes; "Hug"/"Fill" labels). */
  onLayout?: (layout: LayoutResult) => void
  /** Throttled to ≤ 4 Hz (perf HUD, e2e perf gate). */
  onStats?: (stats: RenderStats) => void
  onContextMenu?: (info: CanvasPointerInfo) => void
  /** Image tool / dropped files: the shell stores the asset and returns its `./assets/…` ref. */
  onImportImage?: (file: File) => Promise<Omit<ImagePlacement, "kind"> | null>

  // --- M2 -----------------------------------------------------------------------------------
  /** Snap while moving/resizing (View menu). Default true; ⌘ suspends it per gesture. */
  snapping?: boolean
  /** Show the pixel grid above `OVERLAY_SPEC_M2.pixelGrid.minZoom` (View menu). Default true. */
  pixelGrid?: boolean
  /** Icon glyph source passed to the renderer (default: the renderer's lazy provider). */
  icons?: IconProvider
  /** An armed placement changed (toolbar shows Image active while armed). */
  onPlacementChange?: (placement: ImagePlacement | null) => void
  /**
   * Canvas hints for the shell's DOM overlays (Tooltip/Hint u0dQ1 above the toolbar, the
   * path-edit mode pill, the ⌥ "Measuring" Tooltip, the zoom badge at > 400%); null hides.
   */
  onHint?: (hint: CanvasHint | null) => void
  /**
   * M2 (additive): the I key asks the shell to open the IconPicker (board 09 `jKClR`) at the
   * pointer. The shell calls {@link CanvasHandle.insertIcon} with the picked icon (no `at`: the
   * icon lands centered on the request's `world` point, inside `parent`). Without this prop
   * the I key does nothing.
   */
  onIconPicker?: (request: IconPickerRequest) => void
}

/** M2: where the I key asked for an icon. */
export interface IconPickerRequest {
  /** Pointer (or canvas center) in canvas CSS px: anchor for the popover. */
  screen: Point
  world: Point
  /** Drop parent at that point (null = page). */
  parent: string | null
}

/** M2: an icon to insert (`.kimo` icon node fields). */
export interface IconSpec {
  set: string
  name: string
  weight?: number
  strokeWidth?: number
  /** Default 24 (the lucide/feather/material grid). */
  size?: number
}

/** DOM hints the shell renders (board 10). Text and icon are the design's exact copy. */
export type CanvasHint =
  | { kind: "pen"; icon: "pen-tool"; text: "Click to add points · Drag to curve · Enter to finish" }
  | { kind: "pen-close"; icon: "circle-dot"; text: "Close path"; screen: Point }
  | { kind: "path-edit"; icon: "spline"; text: "Editing path · Esc or Enter to exit" }
  | { kind: "measuring"; text: "Measuring"; keys: "⌥" }

/** Imperative handle exposed through `ref`. */
export interface CanvasHandle {
  /** Null until `onReady`. */
  readonly renderer: Renderer | null
  /**
   * True while a canvas gesture (move, resize, draw) is editing the document: the shell must
   * not run undo/redo or other edits until it ends.
   */
  isGesturing(): boolean
  /**
   * M2: ⌘Z (`redo` false) / ⇧⌘Z (`redo` true) while the pen is drawing: undo removes the last
   * anchor, redo does nothing. Returns true when consumed; false when the pen is not drawing
   * (the shell then runs the document undo/redo).
   */
  penUndo(redo: boolean): boolean
  layout(): LayoutResult | null
  /** Activates a toolbar tool (image opens the picker; disabled tools are ignored). */
  activateTool(id: CanvasToolId): void
  /** M2: arms an image placement directly (drag-and-drop, paste); null cancels. */
  armPlacement(placement: ImagePlacement | null): void
  /** M2: the armed placement, or null. */
  placement(): ImagePlacement | null
  /** M2: enters path edit mode for a `path` node (double-click / Enter does the same). */
  editPath(nodeId: string): void
  /** M2 (additive): the node in path edit mode, or null. */
  editingPath(): string | null
  /**
   * M2 (additive): inserts an icon node (one undo step) centered on world point `at` (default:
   * the last {@link IconPickerRequest}'s point, else the viewport center) and selects it.
   * Returns the new id, or null when rejected.
   */
  insertIcon(icon: IconSpec, at?: Point, parent?: string | null): string | null
  /** Fits the given nodes (default: everything) with `padding` screen px (default 64). */
  zoomToFit(ids?: readonly string[], padding?: number): void
  /** Zooms keeping `anchor` (screen px; default canvas center) fixed. */
  zoomTo(zoom: number, anchor?: Point): void
  screenToWorld(p: Point): Point
  worldToScreen(p: Point): Point
  /** PNG of a node at `scale` (export dialog, board 07). */
  exportPng(nodeId: string, scale?: number): Promise<Uint8Array>
  stats(): RenderStats | null
  focus(): void
}
