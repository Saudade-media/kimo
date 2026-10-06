/**
 * Contract between the editor shell and the canvas (M1, ADR 0009; M2 tools, snapping and
 * measurement, ADR 0010; M3 components, instances, slots and libraries, ADR 0011). The shell mounts
 * `<CanvasHost {...CanvasHostProps} ref={handle} />`; CanvasHost owns the pipeline
 * `DocStore.onChange → LayoutEngine.update → Renderer.setLayout/invalidate → requestFrame`,
 * pointer/keyboard input for the active tool, and overlays. Everything document-related goes
 * through `store.apply(ops, { origin })`, never directly through the renderer.
 */
import type { ExpandedView, Libraries, PlanError, PlanNote } from "@kimo/core-schema"
import type {
  CommandResult,
  createUiStore,
  DocStore,
  LocalOrigin,
  M3Command,
  Op,
  OpError,
  Tool,
} from "@kimo/editor-state"
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
  "line",
  "arrow",
  "polygon",
  "star",
  "text",
  "pen",
  "image",
  "component",
  "note",
  "prompt",
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
  /**
   * M3: a one-shot action instead of a mode. `createComponent` runs Create component on the
   * selection (⌥⌘K; board 12 note "Create component (⌥⌘K or toolbar ◇)").
   */
  action?: "createComponent" | "insertNote" | "insertPrompt"
  /**
   * M6: icon color token (board 22 cf2sC "Insert hint": sticky-note `note-text`, sparkles
   * `agent`). Absent = the ToolButton's own color.
   */
  iconColor?: string
  /** False = rendered disabled. */
  enabled: boolean
  /**
   * Board 27 §5 (rkFut): Rectangle, Ellipse, Line, Arrow, Polygon and Star share ONE toolbar
   * slot that shows the last-used shape and a caret opening the Shape flyout (MBxVC).
   */
  slot?: "shape"
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
  // Board 27 §5 shape slot (flyout MBxVC, in item order): exact lucide names from the design.
  {
    id: "rectangle",
    label: "Rectangle",
    icon: "square",
    shortcut: "R",
    tool: "rect",
    enabled: true,
    slot: "shape",
  },
  {
    id: "ellipse",
    label: "Ellipse",
    icon: "circle",
    shortcut: "O",
    tool: "ellipse",
    enabled: true,
    slot: "shape",
  },
  {
    id: "line",
    label: "Line",
    icon: "minus",
    shortcut: "L",
    tool: "line",
    enabled: true,
    slot: "shape",
  },
  {
    id: "arrow",
    label: "Arrow",
    icon: "move-up-right",
    shortcut: "⇧L",
    tool: "arrow",
    enabled: true,
    slot: "shape",
  },
  {
    id: "polygon",
    label: "Polygon",
    icon: "pentagon",
    // The design's ⇧P stays Prompt's (board 22): Polygon is reached from the shape slot only.
    shortcut: "",
    tool: "polygon",
    enabled: true,
    slot: "shape",
  },
  {
    id: "star",
    label: "Star",
    icon: "star",
    shortcut: "⇧S",
    tool: "star",
    enabled: true,
    slot: "shape",
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
    // M3: a one-shot action (the shell runs Create component on the selection).
    action: "createComponent",
    enabled: true,
  },
  // M6 (board 22 cf2sC `FTOjQ` "Insert hint": Tool · Note `AJpaL`, Tool · Prompt `eSlHx`):
  // one-shot inserts at the viewport center, then the body opens for typing.
  {
    id: "note",
    label: "Note",
    icon: "sticky-note",
    iconColor: "note-text",
    shortcut: "N",
    tool: null,
    action: "insertNote",
    enabled: true,
  },
  {
    id: "prompt",
    label: "Prompt",
    icon: "sparkles",
    iconColor: "agent",
    shortcut: "⇧P",
    tool: null,
    action: "insertPrompt",
    enabled: true,
  },
]

/** Board 27 §5: the tools sharing the shape slot, in flyout order. */
export const SHAPE_SLOT_TOOLS: readonly CanvasToolSpec[] = CANVAS_TOOLS.filter(
  (t) => t.slot === "shape",
)

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
 * Snap threshold in SCREEN px (board 27 rule i6rbIi "threshold 6 screen px"). World threshold =
 * `SNAP_THRESHOLD_PX / zoom`.
 */
export const SNAP_THRESHOLD_PX = 6

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
  /**
   * M3: a command the planner refused (`refused`, keyed by `PlanError.code`) or the store
   * rejected (`rejected`). The shell shows Toast/Danger (board 15 `FVd5q`) with the copy of
   * {@link M3_TOAST_COPY}; nothing changed. `error.message` is a developer message (logs).
   */
  | {
      kind: "command"
      label: string
      error: Error
      refused?: PlanError
      rejected?: readonly OpError[]
    }

/**
 * M3 (board 15 `qJRq1`): a non-error notice after an applied command, e.g. "Can't delete
 * Features inside an instance. It was hidden instead" (Toast/Danger with Undo), or "1 override no
 * longer resolves — Marketing kit changed" (Toast/Warning `qINpv` with Review). Toasts stack
 * bottom-center 12 px above the floating toolbar, newest at the bottom, at most 3; danger 6 s,
 * warning 4 s, hover pauses.
 */
export interface CanvasNotice {
  tone: "danger" | "warning"
  text: string
  action?: { label: string; run: () => void }
  /** The plan notes behind it (for tests / logs). */
  notes?: readonly PlanNote[]
}

/** Board 15 toast copy for refusals, by plan error code (`{name}` = the layer / item name). */
export const M3_TOAST_COPY = {
  HIDDEN_INSTEAD: "Can't delete {name} inside an instance. It was hidden instead",
  LIBRARY_READ_ONLY: "{name} is from a linked library. Edit it in its source file",
  CYCLE: "Can't nest a main component inside its own instance",
  ALIAS_CYCLE: "Can't alias {name} to itself. That would create a cycle",
  OVERRIDE_UNRESOLVED: "{count} override no longer resolves because {library} changed",
} as const

// --- M3: instances on the canvas (boards 11, 12, 13) ------------------------------------------

/**
 * Where an edit of a selected view id lands. Selection MAY hold composite ids
 * (`<instance>/<IdPath>`, `@kimo/core-schema` §9.8): property edits on them become
 * `setOverride` commands on the top instance, deletes become `hideInInstance`, moves are
 * refused unless the node is real slot content. Pure: `routeEdit(view, id)`.
 */
export type EditTarget =
  /** A real node: edit it directly (update/move/delete ops). */
  | { kind: "node"; id: string }
  /** A descendant inside an instance: `setOverride(instance, path, …)`. */
  | { kind: "override"; instance: string; path: string }
  /** The root of an instance: `setOverride(instance, "", { kind: "set" })` (writes `props`). */
  | { kind: "instance-root"; instance: string }

/** Pure edit routing (implemented in `apps/web/src/canvas/instances.ts`, canvas builder). */
export type RouteEdit = (view: ExpandedView, id: string) => EditTarget | null

/**
 * Click policy on instances (board 11): a click selects the top-level instance (its view id is
 * its real id); double-click or ⌘-click enters it and selects the deepest composite id under
 * the pointer, like groups. Layers rows of an instance's expanded children select composite ids.
 */
export type InstanceHitPolicy = (
  view: ExpandedView,
  hits: readonly string[],
  deep: boolean,
) => string | null

/** A component being dragged from Assets (board 13) or chosen in the quick insert. */
export interface ComponentDrag {
  /** `of`: a local component id or `alias:id`. */
  of: string
  /** Name shown in the drag chip (`a0Jl0`: `component` glyph + name). */
  name: string
}

/**
 * Where a dragged component would land (board 13 drop rules). `alt` (⌥) drops beside the
 * instance instead of into it.
 */
export type ComponentDropTarget =
  /** Into a regular frame (drop hint `A3eub`, `selection` fill: "Insert into Cards · 2 of 4"). */
  | { kind: "frame"; parent: string | null; index: number; label: string }
  /** Into an instance's slot (`CTfcw`, `component` fill: "Insert into actions · slot · 2 of 2"). */
  | { kind: "slot"; instance: string; path: string; index: number; label: string }
  /** Replace an instance descendant (`orZ62`: "Replace Title in Card · Pro", icon `replace`). */
  | { kind: "replace"; instance: string; path: string; label: string }

/** Pure drop-target resolution (canvas builder; tested headless). */
export type ResolveComponentDrop = (query: {
  view: ExpandedView
  layout: LayoutResult
  /** View ids under the pointer, top-most first. */
  hits: readonly string[]
  world: Point
  drag: ComponentDrag
  alt: boolean
}) => ComponentDropTarget | null

/**
 * DOM overlays the CanvasHost renders on top of the canvas for M3 (like artboard labels):
 * CanvasLabel/Component (`tl5O8`) above every root main and the selected/hovered main,
 * CanvasLabel/Instance (`J3FKSK`) above the selected/hovered instance, SlotBadge (`kMGG0`,
 * "Slot · <name>") under each slot outline of the selected main/instance, and SlotQuickInsert
 * chips (`AJSok`: the slot's `suggested` components, then "+N") under a selected main.
 * Positions: `OVERLAY_SPEC_M3.dom` in `@kimo/renderer`.
 */
export interface ComponentDomOverlay {
  labels: readonly {
    id: string
    kind: "component" | "instance"
    /** "Card/Pricing", or "Card/Pricing/Featured · from Card/Pricing" for derived (board 12 `GtzU7`). */
    text: string
    /** Screen top-left of the label (CSS px). */
    screen: Point
    /**
     * Root frame whose label this one would overlap (same top edge), so the host hides that
     * root label while this one shows (board 11 annex note `icB1k`). `null` when no overlap.
     */
    covers: string | null
  }[]
  slots: readonly { id: string; name: string; screen: Point }[]
  quickInsert: {
    /** The slot view id the chips insert into (main: default children; instance: `at` nodes). */
    slot: string
    items: readonly ComponentDrag[]
    more: number
    screen: Point
  } | null
}

/** What is under a pointer, for context menus and the shell's status UI. */
export interface CanvasPointerInfo {
  screen: Point
  world: Point
  /** Top-most hit node id, or null for empty canvas. */
  hit: string | null
  /** The node a click at this point selects (click policy), or null for empty canvas. */
  target?: string | null
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
  /**
   * Show the pixel grid at ≥ `OVERLAY_SPEC_M2.pixelGrid.minZoom` (800 %, board 27 rule zyQtF;
   * View menu / Settings › Canvas). Default true.
   */
  pixelGrid?: boolean
  /**
   * Board 27 rule iZUZg "Snap to pixel grid": x/y/w/h rounded to whole px on
   * move/resize/draw/nudge at any zoom (rotation exempt; path anchors snap to 0.5 px). Default true.
   */
  snapToPixelGrid?: boolean
  /** Board 27 rule YwZyP: 20 px top/left rulers (⇧R). Default false. */
  rulers?: boolean
  /** View › Show layer names on canvas (root frame labels). Default true. */
  layerNames?: boolean
  /** Board 27 rule bFozp: arrow-key nudge step / ⇧ big step in px. Default 1 / 10. */
  nudge?: { step: number; big: number }
  /** Settings › General › Canvas zoom: "mouse" zooms on a plain scroll. Default "trackpad". */
  wheelZoom?: "trackpad" | "mouse"
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
  /**
   * Board 27 §7 (uu8Qa): starting to edit a text whose content is bound to a string variable
   * asks first ("Detach copy/cta?"). Resolves true to detach (the content becomes the resolved
   * string, one undo step) and edit; false cancels. Absent: the text edits directly.
   */
  confirmBoundText?: (id: string, ref: string) => Promise<boolean>
  /**
   * Board 27 §8 (d) rule WYOjQ: ⌥-drag of a main component follows ⌘D — Settings › General
   * "Duplicating a main component" ("ask" | "instance" | "component"). Absent: "instance".
   */
  duplicateMainPref?: () => "ask" | "instance" | "component"
  /** With "ask": the duplicate-main dialog on release (null = cancelled, nothing changes). */
  askDuplicateMain?: (
    main: string,
    ids: readonly string[],
  ) => Promise<"instance" | "component" | null>

  // --- M3 -----------------------------------------------------------------------------------
  /**
   * Loaded libraries by alias (re-read from disk on open; the shell owns loading and the
   * "changed since last open" snapshot). Passed to the expanded view, layout and commands.
   */
  libraries?: Libraries
  /** A notice after an applied command (hidden instead of deleted, unresolved overrides…). */
  onNotice?: (notice: CanvasNotice) => void
  /**
   * Rewrites canvas op groups before they are applied (the shell's `session.route`, M3
   * `routeOps`): edits on composite ids become overrides, deletes inside instances hide.
   * Null refuses the edit (the router reports why).
   */
  route?: (ops: readonly Op[]) => readonly Op[] | null
  /** The selection is (inside) an instance / main: the shell scrolls the layers row into view. */
  onComponentContext?: (context: { instance: string | null; main: string | null }) => void
  /**
   * A SlotQuickInsert chip was clicked: insert an instance of `of` into slot view id `slot`
   * (a main's slot frame: default children; `<instance>/<path>`: `at` content).
   */
  onQuickInsert?: (insert: { slot: string; of: string; name: string }) => void

  // --- M6 -----------------------------------------------------------------------------------
  /**
   * Built-in agent surfaces on the canvas (board 22 D0zDSY, board 36 XDVdg): one cursor and
   * a section outline per agent, a ring per landed edit on its section, rejected-op pills,
   * prompt connectors, prompt footers with Run, the Iterate pass chip. Absent = no agent: notes
   * and prompts still draw. Placeholder frames draw nothing of their own.
   */
  agentCanvas?: AgentCanvasProps
  /** Author display name written on new notes / prompts (`note.author`, the OS user name). */
  noteAuthor?: string
}

// --- M6: built-in agent on the canvas (ADR 0014; board 22 D0zDSY, board 24 iLW1l) -------------

/** Persona hue (board 24 "Persona hue tokens"): lead `agent` (teal), then Iris → Moss. */
export type CanvasAgentPersona = "agent" | "iris" | "violet" | "rose" | "ember" | "moss"

/** AgentMark face state (board 24 component sheet). */
export type CanvasAgentMarkState = "idle" | "listening" | "thinking" | "working" | "done" | "error"

/** What the canvas knows about a running agent origin (`agent:kimo.<session>.<n>`). */
export interface CanvasAgentInfo {
  /** "Kimo", "Agent 2". */
  label: string
  persona: CanvasAgentPersona
  /** Ops applied so far this turn ("Kimo · building Features · 14 ops"). */
  ops?: number
  paused?: boolean
}

/** One enforced scope (modes ZFOQf). */
export interface CanvasAgentScope {
  origin: string
  /** Scope root node ids. */
  roots: readonly string[]
  /** The mode that set the scope (board 36: no scope outline or ScopeTag on the canvas). */
  mode: "single" | "side-by-side" | "split" | "iterate"
  /** Iterate: the Pass Chip under the outline (h6oHb `NCElh` "Iterate · pass 2 of 3 · review"). */
  iterate?: { pass: number; of: number; reviewing: boolean }
}

/** Where an agent is working (board 36: one cursor + an outline on the section it works in). */
export interface CanvasAgentCursor {
  origin: string
  /** Node the current op targets. */
  nodeId: string
  /**
   * The whole area the agent works on (the layers the current step reads or edits, else the
   * ones its last landed edit created / changed). Board 36: their section (the direct child of
   * the top-level frame that holds them) is outlined and the cursor sits on its center; absent =
   * `[nodeId]`.
   */
  nodeIds?: readonly string[]
  /**
   * Board 31 "Agent cursor": the last layer the agent's latest landed edit added, else the last
   * one it changed. Board 36: its section wins when it lies in the work area's sections.
   */
  pointerId?: string
  /** "setting Headline font…" (the pill reads "<label> · <text>"). */
  text: string
  state: CanvasAgentMarkState
}

/** A rejected op (OUT_OF_SCOPE / PERMISSION_DENIED): danger pill + target flash. */
export interface CanvasAgentRejection {
  /** Unique per rejection (re-flashes when a new key arrives). */
  key: string
  origin: string
  nodeId: string
  /** "update Navbar → OUT_OF_SCOPE" (the pill reads "<label> · <text>"). */
  text: string
}

/**
 * Board 31 "Landing flash": the top-most layers one successful agent edit changed. Board 36:
 * each new key rings their section once (3 px persona-soft, 1.2 s); the viewport never moves.
 */
export interface CanvasAgentLanded {
  key: string
  origin: string
  ids: readonly string[]
}

/** Prompt-node run state as the footer shows it (ADR 0014 §9, `@kimo/ai-agent` PromptRunState). */
export type CanvasPromptRun = import("@kimo/ai-agent").PromptRunState

export interface AgentCanvasProps {
  /** Origins that are running. */
  liveOrigins: ReadonlySet<string>
  agent(origin: string): CanvasAgentInfo | null
  scopes?: readonly CanvasAgentScope[]
  cursors?: readonly CanvasAgentCursor[]
  rejections?: readonly CanvasAgentRejection[]
  /** Board 31 / 36: edits that just landed (ring their section once per key). */
  landed?: readonly CanvasAgentLanded[]
  /** Run state of a prompt node (app data keyed by `<fileId>/<nodeId>`); absent = never run. */
  promptRun?(nodeId: string): CanvasPromptRun | undefined
  /** Model pill text for a prompt's `model` ("Opus 5.5"); absent = the model id. */
  modelLabel?(model: unknown): string
  /** Footer formatters (defaults: "4m ago", "$0.06"). */
  ago?(t: number): string
  usd?(v: number | null): string
  onRunPrompt?(nodeId: string): void
  onStopPrompt?(nodeId: string): void
  /** Reduced motion: the cursor jumps between sections. Default: the media query. */
  reducedMotion?: boolean
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
  /** Board 27 §6 (d) ud74f: image crop mode (Hint u0dQ1, icon crop). */
  | { kind: "crop"; icon: "crop"; text: "Drag edges to crop · drag inside to pan · Enter to apply" }

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
  /** Ancestor chain of a view id (composite ids included), root first. For tests and tooling. */
  viewPath(id: string): string[]
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

  // --- M3 (optional until the canvas builder lands them) ------------------------------------
  /**
   * The shared expanded view (layers panel mirrors instance children through it; panels read
   * provenance: override dots, slot / replaced kinds). Null before `onReady`.
   */
  expanded?(): ExpandedView | null
  /**
   * Runs an M3 command with the host origin and libraries (one undo step), reports refusals
   * through `onError` (`kind: "command"`) and notes through `onNotice`, and selects
   * `result.select` when present.
   */
  runCommand?(command: M3Command, label: string): CommandResult
  /** Arms a component drag (Assets tile / list row / swap): pointer moves show the drop target. */
  armComponentDrag?(drag: ComponentDrag | null): void
  /** ⌥⏎ "Go to main component": selects and zooms to the main of an instance (local only). */
  goToMain?(instanceId: string): void
  /**
   * Board 13 drop feedback while a component is dragged over the canvas: the slot insertion bar
   * (`GMebs`) or the replace target box (`d8kP2n`). Null hides it.
   */
  previewComponentDrop?(target: ComponentDropTarget | null): void
  /**
   * Board 27 §2 (c2o3u): a drop over an auto-layout frame at canvas point `screen` shows the
   * InsertionBar; returns the frame and the sibling index the dropped node takes (null: not over
   * a layout frame). Null clears the bar.
   */
  previewFlowInsert?(screen: Point | null): { parent: string; index: number } | null

  // --- M6 (board 22) -------------------------------------------------------------------------
  /**
   * Inserts a note / prompt (one undo step) with its top-left at world `at` (default: centered
   * in the viewport), selects it and opens its body for typing. Returns the new id.
   */
  insertAgentNode?(type: "note" | "prompt", at?: Point): string | null
  /** Sets (or with null clears) a prompt's `target` frame ("Set as target"). */
  setPromptTarget?(promptId: string, frameId: string | null): boolean
  /** Note context menu "Convert to prompt": `replace` keeping id, position and body. */
  convertNoteToPrompt?(noteId: string): boolean
  /** Orphan context menu "Clear flag": unsets `placeholder` (one undo step). */
  clearPlaceholder?(frameId: string): boolean
  /**
   * Imperative agent state for harnesses / shells: wins over the `agentCanvas` prop while set;
   * null clears it (back to the prop).
   */
  setAgentCanvas?(props: AgentCanvasProps | null): void

  // --- Board 27 §2 / §3 (clipboard, structure, raster import) -----------------------------------
  /** Last pointer position over the canvas (canvas-local screen px), or null when outside. */
  pointer?(): Point | null
  /** The canvas size in CSS px. */
  size?(): { w: number; h: number }
  /** Paste feedback: a 1 px $selection outline on node `id` for 600 ms. */
  flash?(id: string): void
}
