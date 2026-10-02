/**
 * Contract between the editor shell and the canvas (M1, ADR 0009). The shell mounts
 * `<CanvasHost {...CanvasHostProps} ref={handle} />`; CanvasHost owns the pipeline
 * `DocStore.onChange → LayoutEngine.update → Renderer.setLayout/invalidate → requestFrame`,
 * pointer/keyboard input for the active tool, and overlays. Everything document-related goes
 * through `store.apply(ops, { origin })`, never directly through the renderer.
 */
import type { createUiStore, DocStore, LocalOrigin, Tool } from "@kimo/editor-state"
import type { LayoutEngine, LayoutEngineOptions, LayoutResult } from "@kimo/layout"
import type {
  AssetSource,
  FontSource,
  OverlayTheme,
  Point,
  Renderer,
  RendererError,
  RendererFactory,
  RenderStats,
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
   * The `@kimo/editor-state` `Tool` this button selects, or null when the button is an action
   * rather than a mode (image: opens the file picker and places an image-filled rect).
   */
  tool: Tool | null
  /** False = rendered disabled in M1. */
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
  { id: "pen", label: "Pen", icon: "pen-tool", shortcut: "P", tool: "path", enabled: false },
  { id: "image", label: "Image", icon: "image", shortcut: "⇧⌘K", tool: null, enabled: true },
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
  onImportImage?: (file: File) => Promise<{ src: string; width: number; height: number } | null>
}

/** Imperative handle exposed through `ref`. */
export interface CanvasHandle {
  /** Null until `onReady`. */
  readonly renderer: Renderer | null
  /**
   * True while a canvas gesture (move, resize, draw) is editing the document: the shell must
   * not run undo/redo or other edits until it ends.
   */
  isGesturing(): boolean
  layout(): LayoutResult | null
  /** Activates a toolbar tool (image opens the picker; disabled tools are ignored). */
  activateTool(id: CanvasToolId): void
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
