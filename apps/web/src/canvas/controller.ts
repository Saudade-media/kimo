/**
 * The canvas pipeline and input controller behind `<CanvasHost>` (framework-agnostic DOM code).
 *
 * Pipeline: `DocStore.onChange` → dirty ids (coalesced per animation frame) →
 * `LayoutEngine.update` → `Renderer.invalidate + setLayout` → overlay → `requestFrame`.
 * Input: pointer gestures for the active tool (select / move / resize / marquee / draw / text),
 * pan (space-drag, middle mouse, wheel), zoom (⌘/ctrl-wheel, pinch, keys) and canvas commands.
 * Every document edit goes through `store.apply` with the host origin; one gesture = one undo step.
 */
import {
  declaredProps,
  defaultTextFill,
  isLocated,
  isRef,
  jsonEqual,
  type Libraries,
  locate,
  splitQualified,
} from "@kimo/core-schema"
import type { DocStore, LocalOrigin, NodeData, Op, Tool, UiState } from "@kimo/editor-state"
import { generateId } from "@kimo/editor-state"
import {
  agentNodeBodyBox,
  agentNodeChrome,
  createInstanceView,
  createResolver,
  type InstanceView,
  type LayoutEngine,
  type LayoutInput,
  type LayoutNodeData,
  type LayoutResult,
  type NodeSource,
  paintOnlyHeaderChange,
  type Rect,
  type ResolvedTextStyle,
  type ResolveHeader,
  type Resolver,
  resolveText,
  resolveTextStyle,
  TEXT_STYLE_DEFAULTS,
} from "@kimo/layout"
import {
  type AnchorRef,
  type AssetSource,
  type ComponentOutline,
  type CursorBadge,
  type InstanceDropOverlay,
  type Measurement,
  OVERLAY_SPEC_M2,
  OVERLAY_SPEC_M3,
  type Overlay,
  type PathAnchorPoint,
  type PathContour,
  type Point,
  type Renderer,
  type RenderStats,
  type ResizeOverlay,
  type SnapOverlay,
  type SpacingIndicator,
} from "@kimo/renderer"
import { modKeyHint } from "../editor/kbd"
import { altDragCloneOps, type DuplicateMainPref } from "../editor/m3/component-actions"
import { pageScopedSource, withActivePage } from "../editor/pages/model"
import { manifestOps } from "../lib/asset-manifest"
import { type Combo, matchCombo, matches, pointerHeld, shortcut } from "../shortcuts/shortcuts"
import { AgentCanvasModel, type AgentDomState } from "./agent-canvas"
import { BuildMotion } from "./agent-motion"
import {
  canMove,
  cloneOps,
  createIconOp,
  createImageFrameOp,
  createPathOp,
  createShapeOp,
  createTextOp,
  type DocReader,
  deleteOps,
  dropParent,
  duplicateOps,
  flipOps,
  groupOps,
  isFlowChild,
  lineContours,
  type MoveStart,
  moveOps,
  moveStart,
  NEW_TEXT_STYLE,
  nextName,
  nudgeOps,
  pathOf,
  type ResizeStart,
  resizeOps,
  resizeStart,
  type ShapeKind,
  STAR_RATIO,
  toLocal,
  toParentDelta,
  topLevel,
} from "./commands"
import type {
  AgentCanvasProps,
  CanvasError,
  CanvasHint,
  CanvasPointerInfo,
  ComponentDomOverlay,
  ComponentDropTarget,
  IconPickerRequest,
  IconSpec,
  ImagePlacement,
  SnapBox,
  SnapResult,
  UiStore,
} from "./contract"
import { CROP_CURSOR, cropStore } from "./crop"
import { CropMode, topImagePaint } from "./crop-mode"
import { gapPreviewMeasurements, gapPreviewStore } from "./gap-preview"
import { type Gesture, startGesture } from "./gesture"
import {
  contentBox,
  type FlowFrame,
  flowSiblingIndex,
  insideRect,
  padOf,
  type SlotBar,
  type StructureDom,
  sequentialIndices,
  slotAnchor,
  slotBar,
  slotIndex,
} from "./insertion"
import {
  clampZoom,
  containsRect,
  fitViewport,
  HANDLE_CURSOR,
  type Handle,
  handleAt,
  handleDir,
  IDENTITY,
  invert,
  rectFromPoints,
  resizeBox,
  round2,
  sizeLabel,
  sizeMode,
  unionRects,
  wheelZoomFactor,
} from "./math"
import { measure } from "./measure"
import {
  constrain45,
  contoursBounds,
  mirror,
  moveAnchors,
  nearestOnCubic,
  pathGeometry,
  removeAnchors,
  segmentCount,
  segmentOf,
  setHandle,
  splitSegment,
} from "./path-geometry"
import {
  bendSegment,
  cutAtAnchors,
  deleteSegment,
  radiusFromLocal,
  ratioFromLocal,
  selectedAnchorKind,
  setAnchorKind,
  starHandles,
  toggleAnchorKind,
} from "./path-tools"
import { cssColor, runCss } from "./rich-text/css"
import { createLiveText } from "./rich-text/live"
import { type Attrs, runsOf, virtualNode } from "./rich-text/model"
import type { RichEditGeometry, RunCss } from "./rich-text/RichTextEditor"
import { publishTextSession, RichTextSession } from "./rich-text/session"
import { drillStep, enterTarget, pickTarget } from "./selection"
import { candidatesIn, fmtUnits, snap, snapPoint } from "./snapping"
import type { CanvasToolStore } from "./tool-state"

/** ⇧0 — the canvas's combo of "Zoom to 100 %" (⌘0 is Editor.tsx's). */
const ZOOM_100_SHIFT = shortcut("zoom100").combos[1] as Combo

/** Pointer travel (screen px) before a press becomes a drag. */
const DRAG_THRESHOLD = 3
/** Default size of a shape created by a click (no drag). */
const CLICK_SIZE = 100
/** Hit slop (screen px) for thin shapes and text. */
const HIT_TOLERANCE = 2
/** Drop "into" a container (board 27 §2): fit ratio, edge bands (px / fraction) and dwell. */
const INTO_FIT = 0.8
const INTO_BAND_PX = 12
const INTO_EDGE = 0.25
const INTO_DWELL_MS = 450
/**
 * Pixel readout badge top-left relative to the pointer (P36BbY: pointer 176,200 → lxk8M at
 * 184,224).
 */
const PIXEL_READOUT_OFFSET = { x: 8, y: 24 } as const

/** Pen: a click within this many screen px of the first anchor closes the path (ring 14 / 2). */
const CLOSE_RADIUS = OVERLAY_SPEC_M2.path.closeRing.size / 2
/** Path edit: pick radius (screen px) for anchors/handles and for segments. */
const ANCHOR_PICK = 6
const SEGMENT_PICK = 5
/** Pixel grid fade-in/out (house value; the design gives none). */
const GRID_FADE_MS = 150
/** Board 10 #5: "Close path" hint top-left relative to the first anchor (Dl8Vz − anchor center). */
const CLOSE_HINT_OFFSET = { x: 38, y: 28 }
/** ⌥ "Measuring" tooltip offset from the pointer (house value). */
export const MEASURING_OFFSET = { x: 16, y: 16 }

/** A finite number, else undefined. */
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined
/** No exclusions (container / flow lookups). */
const NO_TARGETS: ReadonlySet<string> = new Set()
const NO_SNAP: { snap: SnapOverlay; spacing: readonly SpacingIndicator[] } | null = null

/** ⌥ arrow resize directions (Δw, Δh). */
const NUDGE_RESIZE: Record<string, [number, number]> = {
  arrowright: [1, 0],
  arrowleft: [-1, 0],
  arrowdown: [0, 1],
  arrowup: [0, -1],
}

/** Pen tool state while a contour is being drawn (board 10 #5). */
interface PenState {
  parent: string | null
  anchors: PathAnchorPoint[]
  /** Pointer (world, constrained/snapped) for the preview segment; null hides it. */
  cursor: Point | null
  closeHint: boolean
}

/** Path edit mode state (board 10 #6). Contours are world space and the source of truth while editing. */
interface PathEditState {
  id: string
  contours: PathContour[]
  selected: AnchorRef[]
  hoveredSegment: AnchorRef | null
  /** Board 27 §5 (J5Vng): the clicked segment (3 px `selection`; ⌫ deletes it). */
  selectedSegment: AnchorRef | null
  /** Toolbar mode: Select anchors · Add / pen · Bend. */
  mode: "select" | "add" | "bend"
}

/** Cands for snapping during a gesture. */
interface Cands {
  candidates: SnapBox[]
  parent: SnapBox | null
}

/** What the shell's text-editing overlay needs (world space; the host projects it). */
export interface TextEditState {
  /** Edited node, or null for a new text node. */
  id: string | null
  /** Top-left in world space. */
  at: Point
  /** Laid-out box (existing text) for the min width/height. */
  box: Rect | null
  value: string
  style: ResolvedTextStyle
  color: string
  /** Parent of a new text node. */
  parent: string | null
  /** M6: editing a note / prompt body (wraps at `box.w`; absent = a text node). */
  kind?: "note" | "prompt"
  /** Board 30: the live rich-text edit (runs, selection, local undo). */
  session: RichTextSession
  /** Board 30: where and how the overlay lays out (growth, alignment). */
  geometry: RichEditGeometry
  /** Board 30: a run's attributes as CSS (bindings resolved like the renderer's). */
  css: (attrs: Attrs) => RunCss
}

/** Text-editable node types: text, and the bodies of notes and prompts (M6). */
const isTextual = (t: unknown): boolean => t === "text" || t === "note" || t === "prompt"

export interface ControllerOptions {
  store: DocStore
  ui: UiStore
  renderer: Renderer
  engine: LayoutEngine
  assets: AssetSource
  origin: LocalOrigin
  onLayout?: (layout: LayoutResult) => void
  onStats?: (stats: RenderStats) => void
  onError?: (error: CanvasError) => void
  onContextMenu?: (info: CanvasPointerInfo) => void
  onTextEdit?: (state: TextEditState | null) => void
  // --- M2 ---
  /** Live "snapping" setting (default on). */
  snapping?: () => boolean
  /** Live "pixel grid" setting (default on). */
  pixelGrid?: () => boolean
  /** Board 27: live "snap to pixel grid" setting (default on): whole-px edits at any zoom. */
  snapToPixelGrid?: () => boolean
  /** Board 27: live "rulers" setting (default off). */
  rulers?: () => boolean
  /** Board 27: arrow-key nudge step / ⇧ big step (default 1 / 10). */
  nudge?: () => { step: number; big: number }
  /**
   * Settings › General › Canvas zoom: "trackpad" (default) scrolls to pan and zooms on pinch or
   * ⌘ + scroll; "mouse" zooms on a plain scroll and pans on ⇧ + scroll.
   */
  wheelZoom?: () => "trackpad" | "mouse"
  onHint?: (hint: CanvasHint | null) => void
  /** Pixel grid visibility/zoom changed (host shows the zoom badge). */
  onPixelGrid?: (visible: boolean) => void
  onPlacementChange?: (placement: ImagePlacement | null) => void
  onIconPicker?: (request: IconPickerRequest) => void
  /**
   * Board 27 §7 (uu8Qa): starting to edit a text whose content is bound to a string variable
   * asks first ("Detach copy/cta?"). Resolves true to detach (the content becomes the resolved
   * string, one undo step) and edit; false cancels. Absent: the text edits directly.
   */
  confirmBoundText?: (id: string, ref: string) => Promise<boolean>
  /** Image tool without a placement yet: the host opens the file picker. */
  onPickImage?: () => void
  toolStore?: CanvasToolStore
  // --- M3 ---
  /** Loaded libraries by alias (read on every view rebuild; see {@link CanvasController.setLibraries}). */
  libraries?: () => Libraries
  /** M6: author display name written on new notes / prompts (`note.author`). */
  author?: () => string | undefined
  /**
   * Rewrites an op group before it is applied (edits on composite instance ids become
   * overrides; the shell's `session.route`). Null refuses the edit (the router reports why).
   */
  route?: (ops: readonly Op[]) => readonly Op[] | null
  /** The overlay (selection, hover, layout) was recomputed: the host re-reads its DOM overlays. */
  onOverlayChange?: () => void
  /** Board 27 §2: InsertionBar, vacated slots, drag ghosts and the layout hint (screen px). */
  onStructure?: (dom: StructureDom | null) => void
  /**
   * Board 27 §8 (d) rule WYOjQ: Settings › General "Duplicating a main component" (⌥-drag of a
   * main follows ⌘D). Absent: "instance" (no dialog to ask with).
   */
  duplicateMainPref?: () => DuplicateMainPref
  /** The ⌘D duplicate-main dialog for an ⌥-drag on release (null = cancelled). */
  askDuplicateMain?: (
    main: string,
    ids: readonly string[],
  ) => Promise<"instance" | "component" | null>
}

/** Board 27 §2 (c2o3u): a draw / line / place gesture over an auto-layout frame. */
interface FlowInsert {
  parent: string
  flow: FlowFrame
  /** Slot the pointer picks (0…n). */
  slot: number
  /** ⌘ held: an absolute child drawn live instead of a flow child inserted on release. */
  absolute: boolean
  /** The gesture's latest ops while the insertion waits for the release. */
  pending: readonly Op[] | null
}

/** Board 27 §2 (Y4vVe) and ⌥-drag: a move that may reorder, reparent or duplicate. */
interface Reloc {
  parent: string | null
  /** World box of the original parent (null = the page root). */
  parentBox: Rect | null
  /** Every moved node started as a flow child of an auto-layout parent. */
  flowStart: boolean
  /** ⌥-drag: the ops move copies of the originals. */
  alt: boolean
  originals: string[]
  ids: string[]
  clone: Op[]
  /** ⌥-drag of a main with "ask": the dialog decides on release (§8 d). */
  ask: { main: string; component: Op[] } | null
  /** The latest ops handed to the gesture (an "ask" release re-applies them after the dialog). */
  lastOps: Op[]
  starts: {
    world: Rect
    local: Rect
    x: number
    y: number
    w: unknown
    h: unknown
    position: unknown
  }[]
  /** Not drop targets: the dragged subtrees (and, with ⌥, the originals'). */
  noTarget: Set<string>
  /** Left out of slot math (the nodes being moved). */
  moving: Set<string>
  /** The original parent and its ancestors: leaving or staying in them never needs intent. */
  ancestors: Set<string>
  /** World size of the dragged selection (the fit rule of {@link ControllerImpl.relocTarget}). */
  size: { w: number; h: number }
  /** Hover dwell over a container that is otherwise "not clearly intended" (screen px point). */
  dwell: { id: string; at: Point; since: number } | null
  /** Latest pointer event, replayed by the dwell timer. */
  pointer: { e: PointerEvent; p: Point } | null
  dwellTimer: ReturnType<typeof setTimeout> | null
  /** The dwell start the pending timer was armed for. */
  dwellSince: number | null
  /** Containers entered by dwell: kept while the pointer stays inside them. */
  entered: Set<string>
  /** The original parent's children in the order the ops apply to (copies after originals). */
  base: string[]
  last: {
    mode: "free" | "absolute" | "reparent" | "flow"
    target: string | null
    slot: number
    flow: FlowFrame | null
    delta: Point
  } | null
}

type Drag =
  | { kind: "pan"; last: Point }
  | {
      kind: "press"
      start: Point
      startWorld: Point
      /** Click target (already selected on press). */
      target: string | null
      /** Selection before the press (shift-marquee adds to it). */
      before: readonly string[]
      /** Scope of a marquee started on a root frame's background. */
      scope: string | null | undefined
      /** Re-select `target` alone on click-up (pressed inside an existing multi-selection). */
      collapse: boolean
      /**
       * Shift-press on an already-selected target: toggle it out on click-up only, so a
       * shift-drag moves the selection (axis-locked) instead of deselecting it.
       */
      toggle: boolean
    }
  | {
      kind: "move"
      start: Point
      items: MoveStart[]
      gesture: Gesture
      allowed: boolean
      /** World union box of the moved nodes at start (snapping), or null. */
      box: Rect | null
      cands: Cands
      /** Board 27 §2: reorder / reparent / ⌥-duplicate state (null = a plain move). */
      reloc?: Reloc | null
    }
  | {
      kind: "resize"
      start: Point
      handle: Handle
      snap: ResizeStart
      gesture: Gesture
      cands: Cands
      /** Flowing children of a single resized layout frame (board 10 #8), else null. */
      flow: { parent: string; ids: string[]; axis: "w" | "h" } | null
    }
  | {
      kind: "marquee"
      startWorld: Point
      before: readonly string[]
      scope: string | null
      rect: Rect | null
    }
  | {
      kind: "draw"
      shape: ShapeKind
      start: Point
      startWorld: Point
      parent: string | null
      id: string
      name: string
      gesture: Gesture
      dragged: boolean
      cands: Cands
    }
  | {
      /** Board 27 §5: Line / Arrow tools (a `path` node from start to end). */
      kind: "line"
      shape: "line" | "arrow"
      start: Point
      startWorld: Point
      parent: string | null
      id: string
      name: string
      gesture: Gesture
      dragged: boolean
      cands: Cands
    }
  | {
      /** Board 27 §5 (ICb89): dragging a star's ratio or radius handle. */
      kind: "shape-handle"
      id: string
      handle: "ratio" | "radius"
      gesture: Gesture
    }
  | {
      /** Board 27 §5 (J5Vng): Bend — dragging a segment through the pointer. */
      kind: "path-bend"
      ref: AnchorRef
      t: number
      base: PathContour[]
      gesture: Gesture
    }
  | {
      kind: "pen"
      start: Point
      /** Anchor whose handles the drag pulls. */
      index: number
      /** Pressed on the first anchor to close the contour. */
      closing: boolean
      dragged: boolean
    }
  | {
      kind: "path-anchor"
      startScreen: Point
      startWorld: Point
      refs: AnchorRef[]
      base: PathContour[]
      gesture: Gesture
      dragged: boolean
      /** Click on an already-selected anchor without drag: collapse to it on up. */
      collapse: AnchorRef | null
    }
  | {
      kind: "path-handle"
      ref: AnchorRef
      side: "in" | "out"
      base: PathContour[]
      gesture: Gesture
    }
  | {
      kind: "place"
      start: Point
      startWorld: Point
      parent: string | null
      placement: ImagePlacement
      id: string
      gesture: Gesture
      dragged: boolean
      cands: Cands
    }

const isShapeTool = (t: Tool): t is "frame" | "rect" | "ellipse" | "polygon" | "star" =>
  t === "frame" || t === "rect" || t === "ellipse" || t === "polygon" || t === "star"

/** Board 27 §5: tools that draw a one-segment path. */
const isLineTool = (t: Tool): t is "line" | "arrow" => t === "line" || t === "arrow"

export class CanvasController {
  readonly store: DocStore
  readonly ui: UiStore
  readonly renderer: Renderer
  readonly engine: LayoutEngine
  private readonly opts: ControllerOptions

  private src: InstanceView
  private viewSrc: NodeSource
  /** Read access through the expanded view (composite ids resolve; selection/hit policy). */
  readonly vdoc: DocReader
  private resolver: Resolver
  private header: ResolveHeader
  private layoutResult: LayoutResult | null = null

  private dirty = new Set<string>()
  private dirtyHeader = false
  private fullPending = false
  private raf = 0
  private pendingPointer: { e: PointerEvent; p: Point } | null = null
  /** The plain press being handled (set by `onDown`, read by the `mousedown` that follows it). */
  private downInfo: { path: string[] } | null = null
  /**
   * Multi-click drilling: the path to the leaf under the FIRST click of a rapid sequence, fixed
   * for the whole sequence (later clicks never re-hit-test), and the depth selected so far.
   */
  private drillSeq: { path: string[]; level: number; enter: boolean; skipDbl: boolean } | null =
    null

  private el: HTMLElement | null = null
  private size = { w: 0, h: 0, dpr: 1 }
  private drag: Drag | null = null
  private spaceHeld = false
  private editing: TextEditState | null = null
  private editingNode: { id: string; data: LayoutNodeData } | null = null
  /** Board 27 §6 (d): the node being cropped draws without its image paint (the overlay shows it). */
  private cropNode: { id: string; data: LayoutNodeData } | null = null
  /** Board 27 §6 (d) image crop mode. */
  readonly cropMode: CropMode
  private marquee: Rect | null = null
  private cleanups: (() => void)[] = []
  private disposed = false

  // M2 tool state.
  private snapView = NO_SNAP
  private resizeView: ResizeOverlay | null = null
  private cursorBadge: CursorBadge | null = null
  /** Board 10 #4 "Pixel readout" (lxk8M) for the hovered document pixel while the grid shows. */
  private pixelBadge: CursorBadge | null = null
  private altHeld = false
  /** Last pointer position over the canvas (screen), for the I key and the ⌥ tooltip. */
  private pointer: Point | null = null
  private pen: PenState | null = null
  private pathEdit: PathEditState | null = null
  private armed: ImagePlacement | null = null
  private iconRequest: IconPickerRequest | null = null
  private hint: CanvasHint | null = null
  private grid = { alpha: 0, visible: false, raf: 0, from: 0, t0: 0 }

  constructor(opts: ControllerOptions) {
    this.opts = opts
    this.store = opts.store
    this.ui = opts.ui
    this.renderer = opts.renderer
    this.engine = opts.engine
    this.header = this.readHeader()
    this.paged = pageScopedSource(this.store, this.ui)
    this.src = this.makeView()
    this.resolver = this.makeResolver()
    this.vdoc = {
      getNode: (id: string) => this.src.getNode(id) as NodeData | undefined,
      children: (parent: string | null) => this.src.children(parent) as string[],
      hasNode: (id: string) => this.src.getNode(id) !== undefined,
      nodeIds: () => this.store.nodeIds(),
    } as DocReader
    // The renderer reads through this view so the node being text-edited draws empty (the
    // overlay textarea shows its text) while layout keeps measuring the real content.
    this.viewSrc = {
      getNode: (id) =>
        this.editingNode?.id === id
          ? this.editingNode.data
          : this.cropNode?.id === id
            ? this.cropNode.data
            : this.ghosted.has(id)
              ? this.ghostNode(id)
              : this.src.getNode(id),
      children: (parent, at) => this.src.children(parent, at),
    }
    this.cropMode = new CropMode({
      getNode: (id) => this.src.getNode(id) as NodeData | undefined,
      isReal: (id) => !this.src.isVirtual(id) && this.store.getNode(id) !== undefined,
      layout: () => this.layoutResult,
      viewport: () => this.ui.getState().viewport,
      imageSize: (src) => this.renderer.imageSize?.(src) ?? Promise.resolve(null),
      apply: (ops, label) => this.apply(ops, label),
      override: (id, data) => {
        const prev = this.cropNode?.id
        this.cropNode = data ? { id, data: data as LayoutNodeData } : null
        this.renderer.invalidate([id, ...(prev && prev !== id ? [prev] : [])])
        this.renderer.requestFrame()
      },
      changed: () => {
        this.updateOverlay()
        this.updateCursor()
        this.renderer.requestFrame()
      },
      store: cropStore(this.ui),
    })
  }

  /** Board 27 §1: roots of the active page only (other pages are not laid out or drawn). */
  private readonly paged: ReturnType<typeof pageScopedSource>
  /** Roots laid out by the last full pass (a root leaving the page needs a full pass). */
  private shownRoots: ReadonlySet<string> = new Set()
  /** The `pages` header the last full pass was laid out under. */
  private pagesKey = ""

  private pagesKeyNow(): string {
    return JSON.stringify(this.store.toHeader().pages ?? null)
  }

  /** True when a change to `id` cannot touch the active page (its root is on another page). */
  private offPage(id: string): boolean {
    let n = this.store.getNode(id)
    let root = id
    for (let guard = 0; n && typeof n.parent === "string" && guard < 4096; guard++) {
      root = n.parent
      n = this.store.getNode(root)
    }
    if (!n) return false
    return !this.shownRoots.has(root) && !this.paged.children(null).includes(root)
  }

  private makeView(): InstanceView {
    return createInstanceView(this.paged, {
      libraries: this.opts.libraries?.() ?? {},
      header: () => this.header as never,
    })
  }

  private makeResolver(): Resolver {
    return createResolver(() => this.header, this.src, {
      libraries: this.opts.libraries?.() ?? {},
    })
  }

  /** The shared expanded view (composite ids `<instance>/<IdPath>`), current after a flush. */
  get expanded(): InstanceView {
    return this.src
  }

  /** Linked libraries changed (loaded, re-read, unlinked): rebuild the view and re-lay out. */
  setLibraries(): void {
    this.src = this.makeView()
    this.resolver = this.makeResolver()
    if (this.el) {
      this.renderer.setDocument({
        nodes: this.viewSrc,
        header: () => this.header,
        resolve: this.resolver,
        assets: this.opts.assets,
        labels: this.sceneLabels,
      })
      this.fullPending = true
      this.schedule()
    }
  }

  /** The document's asset manifest (spec §12), when it has one. */
  private manifest: unknown = undefined

  /** The image frame op plus its manifest entry when the document keeps a manifest. */
  private withManifest(op: Op, placement: ImagePlacement): Op[] {
    const entry = placement.entry
    return [...manifestOps(this.manifest, op, () => entry ?? null), op]
  }

  private readHeader(): ResolveHeader {
    const d = this.store.toHeader()
    this.manifest = d.assets
    const h: ResolveHeader = {}
    if (d.variables) h.variables = d.variables
    if (d.themes) h.themes = d.themes
    if (d.imports) h.imports = d.imports
    this.lastImports = d.imports as Record<string, string> | undefined
    return h
  }

  private input(): LayoutInput {
    return {
      nodes: this.src,
      expanded: this.src,
      resolve: this.resolver,
      measureText: this.renderer.textMeasurer(),
    }
  }

  // --- lifecycle ----------------------------------------------------------------------------

  /** Computes the first layout and binds the canvas (renderer + engine already initialized). */
  start(el: HTMLElement, canvas: HTMLCanvasElement): void {
    this.el = el
    const r = this.renderer
    r.setDocument({
      nodes: this.viewSrc,
      header: () => this.header,
      resolve: this.resolver,
      assets: this.opts.assets,
      labels: this.sceneLabels,
    })
    this.agent.scanAll()
    this.computeFull()
    r.setViewport(this.ui.getState().viewport)
    this.measure()
    r.attach(canvas, { dpr: this.size.dpr })
    r.resize(this.size.w, this.size.h, this.size.dpr)
    this.updateOverlay()
    r.render()

    this.cleanups.push(
      this.store.onChange((c) => {
        // Board 27 §1: edits on other pages don't reach the canvas; a root that leaves the
        // active page (moved to another page) or a `pages` change needs a full pass.
        const shown = c.nodes.size > 0 ? this.paged.children(null) : null
        for (const id of c.nodes) {
          if (this.shownRoots.has(id) && shown && !shown.includes(id)) this.fullPending = true
          else if (!this.offPage(id)) this.dirty.add(id)
        }
        if (c.header && this.pagesKeyNow() !== this.pagesKey) this.fullPending = true
        // Board 35: layers agents add on this page grow in (render only).
        const lr = this.layoutResult
        this.buildMotion.noteChange(
          c,
          (id) => !!lr?.nodes.has(id) || this.offPage(id) || c.cause === "load",
        )
        // M6: placeholder frames and prompt nodes are tracked incrementally.
        if (c.cause === "load") this.agent.scanAll()
        else this.agent.scan(c.nodes)
        if (c.header || c.cause === "load") this.dirtyHeader = true
        // A load replaces everything: re-read it all (expansions included).
        if (c.cause === "load") this.fullPending = true
        this.schedule()
      }),
      this.ui.subscribe((s, prev) => this.onUi(s, prev)),
      r.fonts.onFontLoaded(() => {
        this.fullPending = true
        this.schedule()
      }),
    )
    this.bindDom(el)
    // Board 27 §6 (b): the Auto layout Gap / Row gap field hovered in the panel.
    this.cleanups.push(gapPreviewStore(this.ui).subscribe(() => this.updateOverlay()))
    // Board 27 §6 (d): the properties panel drives crop mode through the shared crop store.
    const crops = cropStore(this.ui)
    const crop = this.cropMode
    const actions: NonNullable<typeof crops.actions> = {
      start: (id, paint) => {
        this.ui.getState().select([id])
        void crop.start(id, paint)
      },
      setRect: (r) => crop.setRect(r),
      apply: () => crop.apply(),
      cancel: () => crop.cancel(),
      reset: () => crop.reset(),
    }
    crops.actions = actions
    this.cleanups.push(() => {
      crop.cancel()
      if (crops.actions === actions) crops.actions = null
    })
    if (this.opts.onStats) {
      const t = setInterval(() => this.opts.onStats?.(r.stats()), 250)
      this.cleanups.push(() => clearInterval(t))
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    // A live text edit writes what is pending and closes its undo step.
    this.editing?.session.dispose()
    if (this.raf) cancelAnimationFrame(this.raf)
    if (this.agentRaf) cancelAnimationFrame(this.agentRaf)
    if (this.motionRaf) cancelAnimationFrame(this.motionRaf)
    for (const c of this.cleanups.splice(0)) c()
    this.renderer.dispose()
    this.engine.dispose()
  }

  get layout(): LayoutResult | null {
    return this.layoutResult
  }

  /** Board 27 §2: the last pointer position over the canvas (screen px), or null. */
  pointerPosition(): Point | null {
    return this.pointer
  }

  get canvasSize(): { w: number; h: number } {
    return { w: this.size.w, h: this.size.h }
  }

  // --- pipeline -----------------------------------------------------------------------------

  private schedule(): void {
    if (this.raf || this.disposed) return
    this.raf = requestAnimationFrame(() => {
      this.raf = 0
      this.flush()
      // Draw what the flush changed in this frame, not one vsync later (the renderer would
      // otherwise schedule its draw from inside this callback, for the next frame).
      if (!this.disposed) this.renderer.renderPending()
    })
  }

  /** Applies pending pointer moves and document changes now (layout is current afterwards). */
  flush(): void {
    if (this.disposed) return
    const p = this.pendingPointer
    this.pendingPointer = null
    if (p) this.dragMove(p.e, p.p)
    if (this.fullPending || this.dirtyHeader || this.dirty.size) this.relayout()
  }

  private computeFull(): void {
    this.shownRoots = new Set(this.paged.children(null))
    this.pagesKey = this.pagesKeyNow()
    this.src.invalidate()
    this.resolver.invalidate()
    const before = this.layoutResult
    try {
      this.layoutResult = this.engine.compute(this.input())
    } catch (e) {
      this.report({ kind: "layout", error: e instanceof Error ? e : new Error(String(e)) })
      return
    }
    this.renderer.invalidate()
    this.renderer.setLayout(this.layoutResult)
    // Board 35: an agent insert can land in a full pass too (a font load in the same frame).
    this.buildMotion.afterLayout(before, this.layoutResult)
    if (before) this.scheduleMotionFrame()
    this.opts.onLayout?.(this.layoutResult)
  }

  private relayout(): void {
    const ids = [...this.dirty]
    const header = this.dirtyHeader
    const full = this.fullPending || !this.layoutResult
    this.dirty.clear()
    this.dirtyHeader = false
    this.fullPending = false
    let paintOnly = false
    let valuesOnly = false
    if (header) {
      const prev = this.header
      this.header = this.readHeader()
      // A color variable's value edited (variables dialog): no layout reads it, so the layout
      // stays; only pictures that read a binding re-record (perf: no whole-document refresh).
      paintOnly = !full && paintOnlyHeaderChange(prev, this.header)
      // Other variable / theme changes alone (a mode switch): expansions read no variables or
      // themes, only `imports`, so they all stay and the engine re-resolves bound nodes only.
      valuesOnly =
        !full &&
        !paintOnly &&
        ids.length === 0 &&
        jsonEqual(prev.imports ?? null, this.header.imports ?? null)
    }
    if (full || (header && !paintOnly && !valuesOnly)) {
      this.computeFull()
    } else if (valuesOnly) {
      this.resolver.invalidate()
      try {
        this.layoutResult = this.engine.update(this.input(), {
          nodes: [],
          header: true,
          valuesOnly: true,
        })
      } catch {
        this.computeFull()
        this.updateOverlay()
        return
      }
      this.renderer.invalidate()
      this.renderer.setLayout(this.layoutResult)
      this.opts.onLayout?.(this.layoutResult)
    } else {
      this.resolver.invalidate()
      if (paintOnly) this.renderer.invalidate()
      if (ids.length > 0) {
        // The engine re-expands only the instances the edit affects (its dependency index).
        const before = this.layoutResult
        try {
          this.layoutResult = this.engine.update(this.input(), { nodes: ids })
        } catch {
          this.computeFull()
          this.updateOverlay()
          return
        }
        this.renderer.invalidate(ids)
        this.renderer.setLayout(this.layoutResult)
        this.buildMotion.afterLayout(before, this.layoutResult)
        this.scheduleMotionFrame()
        this.opts.onLayout?.(this.layoutResult)
      }
    }
    if (this.editing?.id && !this.src.getNode(this.editing.id)) this.cancelText()
    else if (this.editing?.id) this.refreshTextEdit()
    this.syncPathEdit()
    this.updateOverlay()
  }

  private onUi(s: UiState, prev: UiState): void {
    if (s.page !== prev.page) {
      // Board 27 §1: another page — lay out and draw its roots only.
      if (this.editing) this.commitText(null)
      this.exitPathEdit()
      this.fullPending = true
      this.schedule()
    }
    if (s.viewport !== prev.viewport) {
      this.renderer.setViewport(s.viewport)
      this.updateGrid()
      // Screen-anchored hints (close path) follow pans and zooms.
      if (this.pen?.closeHint || this.cropMode.active) this.updateOverlay()
      // Board 27 §5: the path-edit toolbar and the star handles' inset follow pans and zooms.
      else if (this.pathEdit) this.publishPathEdit()
      else if (this.drag === null && this.starHandleWorld()) this.updateOverlay()
    }
    if (s.selection !== prev.selection) {
      // Board 30: selecting something else (layers panel, ⌘A outside) commits the text edit.
      const ed = this.editing?.id
      if (ed && (s.selection.length !== 1 || s.selection[0] !== ed)) this.commitText(null)
      // Board 27: selecting something else commits the crop.
      const cid = this.cropMode.nodeId
      if (cid && (s.selection.length !== 1 || s.selection[0] !== cid)) this.cropMode.apply()
      const pe = this.pathEdit
      if (pe && (s.selection.length !== 1 || s.selection[0] !== pe.id)) this.exitPathEdit()
    }
    if (s.selection !== prev.selection || s.hovered !== prev.hovered) this.updateOverlay()
    if (s.tool !== prev.tool) {
      if (this.editing && s.tool !== "text") this.commitText(null)
      if (prev.tool === "path" && this.pen) this.finishPen()
      if (s.tool !== "select") {
        this.exitPathEdit()
        this.cropMode.apply()
        if (this.armed) this.armPlacement(null)
      }
      this.updateOverlay()
      this.updateCursor()
    }
  }

  private updateOverlay(): void {
    const { selection, hovered } = this.ui.getState()
    const layout = this.layoutResult
    // Board 27 §2: a node whose ghost follows the pointer has no selection chrome at its slot.
    const sel = selection.filter((id) => layout?.nodes.has(id) && !this.ghosted.has(id))
    const d = this.drag
    const busy =
      d?.kind === "move" ||
      d?.kind === "resize" ||
      d?.kind === "draw" ||
      d?.kind === "pan" ||
      d?.kind === "place" ||
      d?.kind === "path-anchor" ||
      d?.kind === "path-handle" ||
      d?.kind === "line" ||
      d?.kind === "shape-handle" ||
      d?.kind === "path-bend"
    let label: string | null = null
    const moving = d?.kind === "move"
    if (layout && sel.length && !this.editing && !this.pathEdit && moving) {
      // Board 10 #1 (O68JG1 "Size Badge" W2Lrl): while moving, the badge reads the position
      // (`X 360  Y 128`, the Position fields' values: parent-relative), not the size.
      const p =
        sel.length === 1
          ? layout.nodes.get(sel[0] as string)?.local
          : unionRects(sel.map((id) => layout.nodes.get(id)?.world as Rect))
      if (p) label = `X ${fmtUnits(p.x)}  Y ${fmtUnits(p.y)}`
    } else if (layout && sel.length && !this.editing && !this.pathEdit) {
      if (sel.length === 1) {
        const id = sel[0] as string
        const l = layout.nodes.get(id)
        const n = this.src.getNode(id)
        if (l && n) label = sizeLabel(n as never, { x: 0, y: 0, w: l.local.w, h: l.local.h })
      } else {
        const u = unionRects(sel.map((id) => layout.nodes.get(id)?.world as Rect))
        if (u) label = sizeLabel(null, u)
      }
    }
    const m = this.measuring()
    const cropping = this.cropMode.active
    const overlay: Overlay = {
      selection: this.editing || this.pen || cropping ? [] : sel,
      hovered:
        hovered &&
        !selection.includes(hovered) &&
        !busy &&
        !this.editing &&
        !m &&
        !this.pathEdit &&
        !cropping
          ? hovered
          : null,
      marquee: this.marquee,
      sizeLabel: label,
      // O68JG1 keeps the corner handles while the card is dragged.
      handles: !busy || moving,
      snap: this.snapView?.snap ?? null,
      spacing: this.snapView?.spacing ?? [],
      measurements: m?.measurements ?? (busy ? [] : this.gapPreviewMeasurements()),
      measureOutlines: m?.outline ? [m.outline] : [],
      pixelGrid: this.pixelGridEnabled() ? this.grid.alpha : false,
      // Board 27 §4 rulers (⇧R): the selection's world extent is highlighted.
      rulers: this.opts.rulers?.()
        ? {
            selection:
              layout && sel.length
                ? unionRects(sel.map((id) => layout.nodes.get(id)?.world as Rect))
                : null,
          }
        : null,
      pen: this.penOverlay(),
      pathEdit: this.pathEditOverlay(),
      shapeHandles: this.shapeHandlesOverlay(),
      resize: this.resizeView,
      cursorBadge: this.cursorBadge ?? (!busy && this.gridVisible() ? this.pixelBadge : null),
    }
    // M3 (boards 02c / 11 / 12 / 13): violet identity for mains and instances.
    const comp = this.componentOverlay(overlay.selection, overlay.hovered)
    overlay.selectionTone = comp.tone
    overlay.componentOutlines = comp.outlines
    overlay.instanceDrop = this.dropPreview
    // M6 (board 22 / 24): placeholders, flashes, scopes, persona selections, connectors.
    if (layout) Object.assign(overlay, this.agent.overlay(layout))
    // Board 27 §6 (d): crop chrome over everything.
    if (cropping) overlay.crop = this.cropMode.overlay()
    this.renderer.setOverlay(overlay)
    this.publishPathEdit()
    this.scheduleAgentFrame()
    this.updateHint(m !== null)
    this.syncStructure()
    this.opts.onOverlayChange?.()
  }

  /** `imports` of the last header read (kept by {@link readHeader}). */
  private headerImports(): Record<string, string> | undefined {
    return this.lastImports
  }
  private lastImports: Record<string, string> | undefined = undefined

  /** Display name of a component QId (local id or `alias:id`). */
  private componentName(qid: string): string {
    const { alias, name } = splitQualified(qid)
    const n =
      alias === null
        ? this.store.getNode(name)
        : (this.opts.libraries?.()[alias]?.nodes as Record<string, NodeData> | undefined)?.[name]
    return typeof n?.name === "string" && n.name ? n.name : qid
  }

  /**
   * M3 DOM overlays (contract {@link ComponentDomOverlay}, positions `OVERLAY_SPEC_M3.dom`):
   * CanvasLabel above the selected / hovered nested main or instance (root ones carry the
   * artboard label), SlotBadges under the slot outlines of a single selected main or instance,
   * and the SlotQuickInsert chips of the first slot with suggestions under a selected main.
   * Screen CSS px for the current viewport.
   */
  componentDom(): ComponentDomOverlay {
    const out: {
      labels: ComponentDomOverlay["labels"][number][]
      slots: ComponentDomOverlay["slots"][number][]
      quickInsert: ComponentDomOverlay["quickInsert"]
    } = { labels: [], slots: [], quickInsert: null }
    const layout = this.layoutResult
    if (!layout || this.editing || this.pen) return out
    const { selection, hovered, viewport: v } = this.ui.getState()
    if (selection.length > 50) return out
    const dom = OVERLAY_SPEC_M3.dom
    const sx = (x: number) => (x - v.x) * v.zoom
    const sy = (y: number) => (y - v.y) * v.zoom
    const ids = hovered && !selection.includes(hovered) ? [...selection, hovered] : selection
    for (const id of ids) {
      const role = this.componentRole(id)
      const n = role ? this.src.getNode(id) : undefined
      const box = layout.nodes.get(id)
      if (!role || !n || !box?.visible || n.parent === null || n.parent === undefined) continue
      let text: string
      if (role === "main") {
        const real = this.store.getNode(id)
        text = typeof real?.name === "string" && real.name ? real.name : "Component"
        if (real?.type === "instance" && typeof real.of === "string")
          text = `${text} · from ${this.componentName(real.of)}`
      } else text = this.componentName(this.src.origin(id)?.instance?.of ?? "")
      let root = id
      for (let p = this.src.getNode(root)?.parent; typeof p === "string"; ) {
        root = p
        p = this.src.getNode(p)?.parent
      }
      const rootBox = layout.nodes.get(root)
      // Root labels sit 22 px above the root (CanvasHost LABEL_OFFSET); a nested label within
      // that band of the root's top edge would collide with it.
      const covers =
        rootBox && Math.abs((box.world.y - rootBox.world.y) * v.zoom) < 22 ? root : null
      out.labels.push({
        id,
        kind: role === "main" ? "component" : "instance",
        text,
        screen: { x: sx(box.world.x), y: sy(box.world.y) - dom.nestedLabelOffset },
        covers,
      })
    }
    const sel = selection.length === 1 ? (selection[0] as string) : null
    const role = sel ? this.componentRole(sel) : null
    if (!sel || !role) return out
    // Slot prop names of the selected component name their badges ("Slot · actions").
    const store = this.store
    const docScope = {
      doc: {
        nodes: lookupRecord((id) => store.getNode(id)),
        imports: this.headerImports() ?? {},
      },
      libraries: this.opts.libraries?.() ?? {},
    } as unknown as Parameters<typeof declaredProps>[0]
    let slotProps: { path: string; name: string }[] = []
    const real = this.store.getNode(sel)
    const qid = role === "main" ? sel : String(this.src.origin(sel)?.instance?.of ?? real?.of ?? "")
    const comp = role === "main" && real ? { alias: null, id: sel, node: real } : null
    const located = comp ?? (qid ? locate(docScope, qid) : null)
    if (located && isLocated(located))
      slotProps = declaredProps(docScope, located)
        .filter((p) => p.def.type === "slot")
        .map((p) => ({ path: p.path, name: p.name }))
    const prefix = role === "main" ? "" : `${sel}/`
    const spec = OVERLAY_SPEC_M3.slot
    const comp2 = this.componentOverlay(selection, null)
    for (const o of comp2.outlines) {
      if (o.role !== "slot") continue
      const b = layout.nodes.get(o.id)
      const n = this.src.getNode(o.id)
      if (!b?.visible || !n) continue
      const key = prefix && o.id.startsWith(prefix) ? o.id.slice(prefix.length) : o.id
      const name =
        slotProps.find((p) => p.path === key)?.name ??
        (typeof n.name === "string" && n.name ? n.name : "slot")
      const left = sx(b.world.x + spec.dx)
      const bottom = sy(b.world.y + spec.dy + b.world.h)
      out.slots.push({
        id: o.id,
        name,
        screen: { x: left, y: bottom + dom.slotBadge.gapBelowOutline },
      })
      if (role === "main" && !out.quickInsert && typeof n.slot === "object" && n.slot !== null) {
        const suggested = (n.slot as { suggested?: unknown }).suggested
        const list = Array.isArray(suggested)
          ? suggested.filter((q): q is string => typeof q === "string")
          : []
        const mb = layout.nodes.get(sel)
        if (list.length && mb) {
          out.quickInsert = {
            slot: o.id,
            items: list.slice(0, 2).map((q) => ({ of: q, name: this.componentName(q) })),
            more: Math.max(0, list.length - 2),
            screen: {
              x: sx(mb.world.x) + dom.quickInsert.dx,
              y: sy(mb.world.y + mb.world.h) + dom.quickInsert.dy,
            },
          }
        }
      }
    }
    return out
  }

  // --- M3: component identity overlay -------------------------------------------------------

  private compCache: {
    selection: readonly string[]
    layout: LayoutResult | null
    tone: "selection" | "component"
    base: ComponentOutline[]
  } | null = null

  private dropPreview: InstanceDropOverlay | null = null

  /** Board 13 drop feedback (insertion bar in a slot / replace target box). */
  previewComponentDrop(target: ComponentDropTarget | null): void {
    let next: InstanceDropOverlay | null = null
    const layout = this.layoutResult
    if (target?.kind === "replace")
      next = { kind: "replace", targetId: `${target.instance}/${target.path}` }
    else if (target?.kind === "slot" && layout) {
      const slotId = `${target.instance}/${target.path}`
      const box = layout.nodes.get(slotId)?.world
      const n = this.src.getNode(slotId)
      if (box && n) {
        const lay = (typeof n.layout === "object" && n.layout !== null ? n.layout : {}) as {
          pad?: unknown
          gap?: unknown
        }
        const padRaw = this.resolver.value(slotId, lay.pad)
        // Each pad array entry may itself be a binding.
        const pad = Array.isArray(padRaw)
          ? padRaw.map((v) => this.resolver.value(slotId, v))
          : padRaw
        const [pt, pr, , pl] = Array.isArray(pad)
          ? pad.length === 2
            ? [pad[0], pad[1], pad[0], pad[1]]
            : [pad[0], pad[1], pad[2], pad[3]]
          : [pad, pad, pad, pad]
        const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0)
        const gap = num(this.resolver.value(slotId, lay.gap))
        const kids = this.src.children(slotId)
        const last = kids.length ? layout.nodes.get(kids[kids.length - 1] as string)?.world : null
        const y = last ? last.y + last.h + gap / 2 : box.y + num(pt)
        next = {
          kind: "slot",
          slotId,
          bar: { x: box.x + num(pl), y, w: Math.max(0, box.w - num(pl) - num(pr)) },
        }
      }
    }
    const prev = this.dropPreview
    if (JSON.stringify(prev) === JSON.stringify(next)) return
    this.dropPreview = next
    this.updateOverlay()
    this.renderer.requestFrame()
  }

  /** A main (local component root, also derived) or an instance, by view id. */
  componentRole(id: string): "main" | "instance" | null {
    // The view emits an expanded instance as its component's root shape: ask its origin.
    const real = this.src.isVirtual(id) ? undefined : this.store.getNode(id)
    if (real && real.component !== undefined && real.component !== false) return "main"
    return this.src.origin(id)?.instance ? "instance" : null
  }

  /**
   * Selection tone + identity outlines (renderer `ComponentOutline`): the hovered main/instance,
   * the instance that holds a selected expanded child, and the slot frames of a selected
   * main/instance (dashed; soft fill when empty).
   */
  private componentOverlay(
    selection: readonly string[],
    hovered: string | null,
  ): { tone: "selection" | "component"; outlines: ComponentOutline[] } {
    const layout = this.layoutResult
    let c = this.compCache
    if (!c || c.selection !== selection || c.layout !== layout) {
      const base: ComponentOutline[] = []
      const roles = selection.map((id) => this.componentRole(id))
      const tone =
        selection.length > 0 && roles.every((r) => r !== null) ? "component" : "selection"
      const seen = new Set<string>()
      for (const id of selection) {
        // Inside an instance: its outline stays visible (board 11).
        const path = pathOf(this.vdoc, id)
        const o = this.ownerOf(path)
        if (o >= 0 && o < path.length - 1 && !seen.has(path[o] as string)) {
          seen.add(path[o] as string)
          base.push({ id: path[o] as string, role: "instance" })
        }
      }
      if (selection.length === 1 && roles[0]) {
        let budget = 2000
        const walk = (id: string) => {
          for (const k of this.src.children(id)) {
            if (--budget < 0) return
            const n = this.src.getNode(k)
            if (!n || n.visible === false) continue
            if (n.type === "frame" && typeof n.slot === "object" && n.slot !== null)
              base.push({ id: k, role: "slot", empty: this.src.children(k).length === 0 })
            walk(k)
          }
        }
        walk(selection[0] as string)
      }
      c = { selection, layout, tone, base }
      this.compCache = c
    }
    const outlines = c.base
    if (hovered) {
      const r = this.componentRole(hovered)
      if (r) return { tone: c.tone, outlines: [...outlines, { id: hovered, role: r }] }
    }
    return { tone: c.tone, outlines }
  }

  // --- M2: hints, grid, measuring -----------------------------------------------------------

  private updateHint(measuring: boolean): void {
    let hint: CanvasHint | null = null
    const pen = this.pen
    if (this.cropMode.active) {
      // Board 27 §6 (d) ud74f "Hint" (u0dQ1, icon crop).
      hint = {
        kind: "crop",
        icon: "crop",
        text: "Drag edges to crop · drag inside to pan · Enter to apply",
      }
    } else if (pen?.closeHint && pen.anchors[0]) {
      const a = this.toScreen(pen.anchors[0])
      hint = {
        kind: "pen-close",
        icon: "circle-dot",
        text: "Close path",
        screen: { x: a.x + CLOSE_HINT_OFFSET.x, y: a.y + CLOSE_HINT_OFFSET.y },
      }
    } else if (this.pathEdit) {
      hint = { kind: "path-edit", icon: "spline", text: "Editing path · Esc or Enter to exit" }
    } else if (measuring) {
      hint = { kind: "measuring", text: "Measuring", keys: "⌥" }
    } else if (this.ui.getState().tool === "path" && !pen?.anchors.length) {
      hint = {
        kind: "pen",
        icon: "pen-tool",
        text: "Click to add points · Drag to curve · Enter to finish",
      }
    }
    this.opts.toolStore?.set({ penHint: hint?.kind === "pen" })
    const prev = this.hint
    const same =
      prev === hint ||
      (prev !== null &&
        hint !== null &&
        prev.kind === hint.kind &&
        (hint.kind !== "pen-close" ||
          (prev.kind === "pen-close" &&
            prev.screen.x === hint.screen.x &&
            prev.screen.y === hint.screen.y)))
    if (same) return
    this.hint = hint
    this.opts.onHint?.(hint)
  }

  /** Recomposes the overlay (host settings changed). */
  requestOverlay(): void {
    this.updateOverlay()
    this.renderer.requestFrame()
  }

  /** The current hint (CanvasHost renders it when the shell does not). */
  get currentHint(): CanvasHint | null {
    return this.hint
  }

  /** Last pointer position over the canvas (screen px), or null. */
  get lastPointer(): Point | null {
    return this.pointer
  }

  private pixelGridEnabled(): boolean {
    return this.opts.pixelGrid?.() ?? true
  }

  /** Pixel grid visible (board 27 rule zyQtF: at ≥ 800 % zoom while the setting is on). */
  gridVisible(): boolean {
    return (
      this.pixelGridEnabled() &&
      this.ui.getState().viewport.zoom >= OVERLAY_SPEC_M2.pixelGrid.minZoom
    )
  }

  /** Board 27 rule iZUZg: edits round to whole px (independent of the grid's visibility). */
  private pixelSnap(): boolean {
    return this.opts.snapToPixelGrid?.() ?? true
  }

  /**
   * Board 10 #4 "Pixel readout" (P36BbY › lxk8M, SizeBadge/Delta): above the pixel-grid zoom,
   * the hovered document pixel as `x 22 · y 14 · E76F51 66%` (document coordinates, the
   * document's own color and alpha). Placed at the pointer + {@link PIXEL_READOUT_OFFSET}.
   * Returns true when the badge changed.
   */
  private updatePixelReadout(p: Point): boolean {
    const prev = this.pixelBadge
    this.pixelBadge = null
    if (this.gridVisible() && this.renderer.samplePixel) {
      const w = this.toWorld(p)
      const rgba = this.renderer.samplePixel(w)
      if (rgba) {
        const hex = rgba
          .slice(0, 3)
          .map((c) => c.toString(16).padStart(2, "0"))
          .join("")
          .toUpperCase()
        const alpha = Math.round((rgba[3] / 255) * 100)
        this.pixelBadge = {
          text: `x ${Math.floor(w.x)} · y ${Math.floor(w.y)} · ${hex} ${alpha}%`,
          screen: { x: p.x + PIXEL_READOUT_OFFSET.x, y: p.y + PIXEL_READOUT_OFFSET.y },
        }
      }
    }
    return (
      prev?.text !== this.pixelBadge?.text ||
      prev?.screen.x !== this.pixelBadge?.screen.x ||
      prev?.screen.y !== this.pixelBadge?.screen.y
    )
  }

  /** Rounds a world coordinate to whole px while Snap to pixel grid is on. */
  private px(v: number): number {
    return this.pixelSnap() ? Math.round(v) : v
  }

  private pxPoint(p: Point): Point {
    return { x: this.px(p.x), y: this.px(p.y) }
  }

  /** Path anchors are exempt from whole-px rounding: they snap to 0.5 px (rule iZUZg). */
  private pxAnchor(p: Point): Point {
    if (!this.pixelSnap()) return p
    return { x: Math.round(p.x * 2) / 2, y: Math.round(p.y * 2) / 2 }
  }

  /** Fades the pixel grid in/out when its visibility changes (also on setting changes). */
  updateGrid(): void {
    const visible = this.gridVisible()
    const g = this.grid
    if (visible === g.visible) return
    g.visible = visible
    this.opts.onPixelGrid?.(visible)
    if (g.raf) cancelAnimationFrame(g.raf)
    g.from = g.alpha
    g.t0 = performance.now()
    const target = visible ? 1 : 0
    const step = () => {
      const t = Math.min(1, (performance.now() - g.t0) / GRID_FADE_MS)
      g.alpha = g.from + (target - g.from) * t
      g.raf = t < 1 && !this.disposed ? requestAnimationFrame(step) : 0
      this.updateOverlay()
      this.renderer.requestFrame()
    }
    step()
  }

  private snapEnabled(e: { metaKey: boolean; ctrlKey: boolean }): boolean {
    return (this.opts.snapping?.() ?? true) && !(e.metaKey || e.ctrlKey)
  }

  /** ⌥ measurement (board 10 #3a/#3b) while ⌥ is held over a selection with the move tool. */
  private measuring(): ReturnType<typeof measure> | null {
    if (!this.altHeld || this.drag || this.editing || this.pen || this.pathEdit) return null
    const ui = this.ui.getState()
    const layout = this.layoutResult
    if (ui.tool !== "select" || !layout || !ui.selection.length) return null
    const sel = unionRects(
      ui.selection.map((id) => layout.nodes.get(id)?.world).filter((b): b is Rect => !!b),
    )
    if (!sel) return null
    const first = ui.selection[0] as string
    const p = this.store.getNode(first)?.parent
    const parentId = typeof p === "string" ? p : null
    const path = pathOf(this.store, first)
    let target: SnapBox | null = null
    let parent: SnapBox | null = null
    const h = ui.hovered
    if (h && !ui.selection.includes(h)) {
      const hb = layout.nodes.get(h)?.world
      // A hovered ancestor measures like "nothing hovered" against that ancestor.
      if (hb && path.includes(h)) parent = { id: h, rect: hb }
      else if (hb) target = { id: h, rect: hb }
    }
    if (!target && !parent && parentId) {
      const pb = layout.nodes.get(parentId)?.world
      if (pb) parent = { id: parentId, rect: pb }
    }
    const r = measure({ selection: sel, target, parent })
    return r.measurements.length || r.outline ? r : null
  }

  private setAlt(v: boolean): void {
    if (v === this.altHeld) return
    this.altHeld = v
    this.updateOverlay()
  }

  private toScreen(p: Point): Point {
    const v = this.ui.getState().viewport
    return { x: (p.x - v.x) * v.zoom, y: (p.y - v.y) * v.zoom }
  }

  /** Snap candidates inside `parent` (siblings + parent box), excluding `exclude`. */
  private cands(parent: string | null, exclude: readonly string[]): Cands {
    const layout = this.layoutResult
    if (!layout) return { candidates: [], parent: null }
    return candidatesIn(layout, parent, exclude, (id) => this.store.children(id))
  }

  private setSnapView(r: SnapResult | null): void {
    this.snapView = r && (r.snap.lines.length || r.spacing.length) ? r : NO_SNAP
  }

  /** Snaps a world point (draw corners, pen anchors, placements) and records the guides. */
  private snapPt(
    p: Point,
    c: Cands,
    e: { metaKey: boolean; ctrlKey: boolean },
    extra: SnapBox[] = [],
    /** Pixel rounding: whole px (default) or {@link pxAnchor} for path anchors. */
    round: (q: Point) => Point = (q) => this.pxPoint(q),
  ): Point {
    if (!this.snapEnabled(e)) {
      this.setSnapView(null)
      return round(p)
    }
    const r = snapPoint(
      p,
      extra.length ? [...c.candidates, ...extra] : c.candidates,
      c.parent,
      this.ui.getState().viewport.zoom,
    )
    this.setSnapView(r)
    return round({ x: p.x + r.dx, y: p.y + r.dy })
  }

  private report(error: CanvasError): void {
    if (this.opts.onError) this.opts.onError(error)
    else console.warn("Kimo canvas:", error)
  }

  /** Applies one op group as one undo step. */
  apply(ops: readonly Op[], label: string): boolean {
    if (!ops.length) return false
    const r0 = this.opts.route ? this.opts.route(ops) : ops
    if (!r0) return false
    if (!r0.length) return true
    // Board 27 §1: new roots (and moves to the root) land on the active page.
    const routed = withActivePage(this.store, this.ui, r0)
    const r = this.store.apply(routed, { origin: this.opts.origin, label })
    if (!r.ok) {
      this.report({ kind: "op", message: r.errors.map((e) => e.message).join("; ") })
      return false
    }
    return true
  }

  private gesture(label: string): Gesture {
    const g = startGesture(this.store, this.opts.origin, label, (message) =>
      this.report({ kind: "op", message }),
    )
    const route = this.opts.route ?? ((ops: readonly Op[]) => ops)
    // Gesture steps on instance content go through the M3 router too (overrides, not ops), and
    // new roots land on the active page (board 27 §1).
    return {
      get applied() {
        return g.applied
      },
      get done() {
        return g.done
      },
      set: (ops, stepLabel) => {
        const routed = route(ops)
        return routed ? g.set(withActivePage(this.store, this.ui, routed), stepLabel) : false
      },
      cancel: () => g.cancel(),
      end: () => g.end(),
    }
  }

  // --- size ---------------------------------------------------------------------------------

  private measure(): void {
    const el = this.el
    if (!el) return
    const r = el.getBoundingClientRect()
    this.size = {
      w: Math.max(1, Math.round(r.width)),
      h: Math.max(1, Math.round(r.height)),
      dpr: globalThis.devicePixelRatio || 1,
    }
  }

  private resize(w: number, h: number): void {
    const dpr = globalThis.devicePixelRatio || 1
    if (w === this.size.w && h === this.size.h && dpr === this.size.dpr) return
    this.size = { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)), dpr }
    this.renderer.resize(this.size.w, this.size.h, dpr)
    this.renderer.render()
  }

  // --- viewport -----------------------------------------------------------------------------

  zoomTo(zoom: number, anchor?: Point): void {
    const a = anchor ?? { x: this.size.w / 2, y: this.size.h / 2 }
    this.ui.getState().zoomAt(a.x, a.y, clampZoom(zoom))
  }

  zoomToFit(ids?: readonly string[], padding = 64): void {
    this.flush()
    const layout = this.layoutResult
    if (!layout) return
    const bounds = ids?.length
      ? unionRects(ids.map((id) => layout.nodes.get(id)?.world).filter((b): b is Rect => !!b))
      : layout.bounds
    if (!bounds) return
    this.ui
      .getState()
      .setViewport(fitViewport(bounds, this.size.w, this.size.h, padding, ids?.length ? 256 : 1))
  }

  // --- hit testing --------------------------------------------------------------------------

  /** Real (stored) node for an expanded id: synthetic ids map to their top-level instance. */
  private real(id: string): string {
    let cur = id
    while (this.src.isVirtual(cur)) {
      const p = this.src.getNode(cur)?.parent
      if (typeof p !== "string") break
      cur = p
    }
    return cur
  }

  /**
   * Hit-test with slop: ids under `p` exactly come first (top-most first); a node reached only
   * through the tolerance band ranks ahead of them only when it is thin (a line, a hairline
   * frame), otherwise a neighbour within a few pixels would win over the layer under the pointer
   * (small nested layers, zoomed out) and drilling would jump into the wrong branch.
   */
  private slopHits(p: Point): string[] {
    const near = this.renderer.hitTest(p, { tolerance: HIT_TOLERANCE })
    if (near.length < 2) return near
    const exact = new Set(this.renderer.hitTest(p, { tolerance: 0 }))
    if (exact.size === 0 || near.every((id) => exact.has(id))) return near
    const zoom = this.ui.getState().viewport.zoom
    const thin = (id: string) => {
      const w = this.layoutResult?.nodes.get(id)?.world
      return !!w && Math.min(w.w, w.h) * zoom <= HIT_TOLERANCE * 2
    }
    const lead = near.filter((id) => !exact.has(id) && thin(id))
    return [...lead, ...near.filter((id) => exact.has(id))]
  }

  private hits(p: Point): string[] {
    const out: string[] = []
    for (const id of this.slopHits(p)) {
      const r = this.real(id)
      if (!out.includes(r)) out.push(r)
    }
    return out
  }

  /** View ids under `p` (composite ids inside instances), top-most first. */
  private viewHits(p: Point): string[] {
    const out: string[] = []
    for (const id of this.slopHits(p)) if (!out.includes(id)) out.push(id)
    return out
  }

  /**
   * The real top-level instance that owns view id `id` (composite ids and slot content), or
   * null when `id` is outside every instance expansion. Its index in `path` is returned too.
   */
  private ownerOf(path: readonly string[]): number {
    const j = path.findIndex((id) => this.src.isVirtual(id))
    return j > 0 ? j - 1 : -1
  }

  /**
   * Click policy (board 11, contract `InstanceHitPolicy`): like groups, a click selects the
   * top-level instance; once something inside it is selected (double-click / ⌘-click entered
   * it), clicks keep that depth among its expanded children (composite ids).
   */
  private pick(hit: string, selection: readonly string[], deep: boolean): string {
    const target = pickTarget(this.vdoc, hit, selection, deep)
    if (deep) return target
    const path = pathOf(this.vdoc, target)
    const o = this.ownerOf(path)
    if (o < 0 || o === path.length - 1) return target
    const owner = path[o] as string
    const entered = selection.some((s) => s !== owner && pathOf(this.vdoc, s).includes(owner))
    return entered ? target : owner
  }

  private selectionScreenBox(): Rect | null {
    const layout = this.layoutResult
    const sel = this.ui.getState().selection
    if (!layout || !sel.length) return null
    const u = unionRects(sel.map((id) => layout.nodes.get(id)?.world).filter((b): b is Rect => !!b))
    if (!u) return null
    const v = this.ui.getState().viewport
    return { x: (u.x - v.x) * v.zoom, y: (u.y - v.y) * v.zoom, w: u.w * v.zoom, h: u.h * v.zoom }
  }

  private handleAt(p: Point): Handle | null {
    if (this.ui.getState().tool !== "select" || this.editing) return null
    const box = this.selectionScreenBox()
    return box ? handleAt(box, p) : null
  }

  private local(e: { clientX: number; clientY: number }): Point {
    const r = (this.el as HTMLElement).getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  private toWorld(p: Point): Point {
    const v = this.ui.getState().viewport
    return { x: p.x / v.zoom + v.x, y: p.y / v.zoom + v.y }
  }

  // --- cursor -------------------------------------------------------------------------------

  private cursor = ""
  private setCursor(c: string): void {
    if (c === this.cursor || !this.el) return
    this.cursor = c
    this.el.style.cursor = c
  }

  private cursorFor(p?: Point): string {
    const d = this.drag
    if (d?.kind === "pan") return "grabbing"
    if (d?.kind === "resize") return HANDLE_CURSOR[d.handle]
    if (d?.kind === "move") return d.allowed ? (d.reloc?.alt ? "copy" : "default") : "not-allowed"
    if (this.cropMode.active) {
      const h = this.cropMode.dragging ?? (p ? this.cropMode.handleAt(p) : null)
      return h ? CROP_CURSOR[h] : "default"
    }
    const tool = this.ui.getState().tool
    if (this.spaceHeld || tool === "hand") return "grab"
    if (isShapeTool(tool) || isLineTool(tool) || this.armed) return "crosshair"
    if (tool === "text") return "text"
    if (tool === "path") return this.penCursor(!!this.pen?.closeHint)
    if (this.pathEdit) return "default"
    const h = p ? this.handleAt(p) : null
    return h ? HANDLE_CURSOR[h] : "default"
  }

  private penCursors: Record<string, string> = {}
  /**
   * Board 10 #5/#7 "Pen cursor": lucide `pen-tool` 18 in text-primary (hotspot on the nib);
   * near the first anchor it gains the "Close glyph" (7×7 ring, stroke 1.25) at (16, 14).
   */
  private penCursor(close: boolean): string {
    const color =
      (this.el && getComputedStyle(this.el).getPropertyValue("--kimo-text-primary").trim()) ||
      "#0A0A0A"
    const key = `${color}|${close}`
    const hit = this.penCursors[key]
    if (hit) return hit
    const icon =
      '<g transform="scale(0.75)" fill="none" stroke="C" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M15.707 21.293a1 1 0 0 1-1.414 0l-1.586-1.586a1 1 0 0 1 0-1.414l5.586-5.586a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414z"/>' +
      '<path d="m18 13-1.375-6.874a1 1 0 0 0-.746-.776L3.235 2.028a1 1 0 0 0-1.207 1.207L5.35 15.879a1 1 0 0 0 .776.746L13 18"/>' +
      '<path d="m2.3 2.3 7.286 7.286"/><circle cx="11" cy="11" r="2"/></g>'
    const ring = close
      ? '<circle cx="19.5" cy="17.5" r="2.875" fill="none" stroke="C" stroke-width="1.25"/>'
      : ""
    const size = close ? 24 : 18
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${icon}${ring}</svg>`.replaceAll(
        '"C"',
        `"${color}"`,
      )
    const css = `url("data:image/svg+xml,${encodeURIComponent(svg)}") 2 2, crosshair`
    this.penCursors[key] = css
    return css
  }

  private updateCursor(p?: Point): void {
    this.setCursor(this.cursorFor(p))
  }

  // --- DOM events ---------------------------------------------------------------------------

  private bindDom(el: HTMLElement): void {
    const on = <K extends keyof HTMLElementEventMap>(
      target: HTMLElement | Window,
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ) => {
      target.addEventListener(type, fn as EventListener, opts)
      this.cleanups.push(() => target.removeEventListener(type, fn as EventListener, opts))
    }
    on(el, "pointerdown", (e) => this.onDown(e))
    on(el, "pointermove", (e) => this.onMove(e))
    on(el, "pointerup", (e) => this.onUp(e))
    on(el, "pointercancel", () => this.cancelDrag())
    on(el, "lostpointercapture", () => {
      if (this.drag) this.onUpAt(null)
    })
    on(el, "pointerleave", () => {
      this.pointer = null
      if (this.pixelBadge) {
        this.pixelBadge = null
        this.updateOverlay()
      }
      if (!this.drag && this.ui.getState().hovered) this.ui.getState().setHovered(null)
      if (this.pen && !this.drag) {
        this.pen.cursor = null
        this.pen.closeHint = false
        this.setSnapView(null)
        this.updateOverlay()
      }
    })
    on(el, "mousedown", (e) => this.onMultiDown(e))
    on(el, "click", (e) => this.onMultiClick(e))
    on(el, "dblclick", (e) => this.onDoubleClick(e))
    on(el, "wheel", (e) => this.onWheel(e), { passive: false })
    on(el, "contextmenu", (e) => {
      if (this.isOverlayTarget(e.target)) return
      e.preventDefault()
      const p = this.local(e)
      const hit = this.hits(p)[0] ?? null
      this.opts.onContextMenu?.({
        screen: p,
        world: this.toWorld(p),
        hit,
        // What a click here selects (board 25 §3: the menu acts on the selection).
        target: hit ? this.pick(hit, this.ui.getState().selection, e.metaKey || e.ctrlKey) : null,
      })
    })
    on(window, "keydown", (e) => this.onKey(e))
    on(window, "keyup", (e) => {
      if (e.code === "Space") {
        this.spaceHeld = false
        this.updateCursor()
      }
      if (e.key === "Alt") this.setAlt(false)
    })
    on(window, "blur", () => {
      this.spaceHeld = false
      this.setAlt(false)
      this.cancelDrag()
    })
    // Safari trackpad pinch.
    let gestureZoom = 1
    on(el, "gesturestart" as keyof HTMLElementEventMap, (e) => {
      e.preventDefault()
      gestureZoom = this.ui.getState().viewport.zoom
    })
    on(el, "gesturechange" as keyof HTMLElementEventMap, (e) => {
      e.preventDefault()
      const g = e as unknown as { scale: number; clientX: number; clientY: number }
      const p = this.local(g)
      this.ui.getState().zoomAt(p.x, p.y, gestureZoom * g.scale)
    })
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect
      if (r) this.resize(r.width, r.height)
    })
    ro.observe(el)
    this.cleanups.push(() => ro.disconnect())
    // devicePixelRatio changes (moving between displays, browser zoom).
    let mq: MediaQueryList | null = null
    const watchDpr = () => {
      mq?.removeEventListener("change", onDpr)
      mq = matchMedia(`(resolution: ${globalThis.devicePixelRatio || 1}dppx)`)
      mq.addEventListener("change", onDpr)
    }
    const onDpr = () => {
      this.resize(this.size.w, this.size.h)
      watchDpr()
    }
    watchDpr()
    this.cleanups.push(() => mq?.removeEventListener("change", onDpr))
  }

  /** Events from the text editor / DOM labels that the canvas must not treat as canvas input. */
  private isOverlayTarget(t: EventTarget | null): boolean {
    // Element, not HTMLElement: a press on a button's SVG icon is inside the overlay too.
    return t instanceof Element && !!t.closest("[data-canvas-overlay]")
  }

  private artboardOf(t: EventTarget | null): string | null {
    if (!(t instanceof HTMLElement)) return null
    const el = t.closest<HTMLElement>("[data-artboard]")
    return el?.dataset.artboard ?? null
  }

  private onDown(e: PointerEvent): void {
    this.downInfo = null
    if (this.isOverlayTarget(e.target)) return
    const el = this.el as HTMLElement
    if (this.editing) this.commitText(null)
    el.focus({ preventScroll: true })
    const p = this.local(e)
    const ui = this.ui.getState()
    if (e.button === 2) return
    if (e.button === 1 || (e.button === 0 && (this.spaceHeld || ui.tool === "hand"))) {
      e.preventDefault()
      this.drag = { kind: "pan", last: p }
      el.setPointerCapture(e.pointerId)
      this.updateCursor()
      return
    }
    if (e.button !== 0) return
    this.flush()
    el.setPointerCapture(e.pointerId)
    // Board 27 §6 (d): crop mode owns every press.
    if (this.cropMode.active) {
      this.cropMode.down(p)
      this.updateCursor(p)
      return
    }

    if (this.armed) {
      const parent = dropParent(this.store, this.hits(p))
      const cands = this.cands(parent, [])
      this.drag = {
        kind: "place",
        start: p,
        startWorld: this.snapPt(this.toWorld(p), cands, e),
        parent,
        placement: this.armed,
        id: generateId(),
        gesture: this.gesture("Place image"),
        dragged: false,
        cands,
      }
      return
    }
    if (isShapeTool(ui.tool)) {
      const shape: ShapeKind = ui.tool
      const parent = dropParent(this.store, this.hits(p))
      const cands = this.cands(parent, [])
      const startWorld = this.snapPt(this.toWorld(p), cands, e)
      this.drag = {
        kind: "draw",
        shape,
        start: p,
        startWorld,
        parent,
        id: generateId(),
        name: nextName(this.store, shape),
        gesture: this.gesture(`Create ${shape}`),
        dragged: false,
        cands,
      }
      return
    }
    if (isLineTool(ui.tool)) {
      const shape = ui.tool
      const parent = dropParent(this.store, this.hits(p))
      const cands = this.cands(parent, [])
      this.drag = {
        kind: "line",
        shape,
        start: p,
        startWorld: this.snapPt(this.toWorld(p), cands, e, [], (q) => this.pxAnchor(q)),
        parent,
        id: generateId(),
        name: nextName(this.store, shape),
        gesture: this.gesture(`Create ${shape}`),
        dragged: false,
        cands,
      }
      return
    }
    if (ui.tool === "path") {
      e.preventDefault()
      this.penDown(p, e)
      return
    }
    if (ui.tool === "select" && this.pathEdit && this.pathEditDown(p, e)) return
    if (ui.tool === "text") {
      e.preventDefault()
      const hit = this.hits(p)
      const target = hit[0] ? this.store.getNode(hit[0]) : undefined
      if (hit[0] && target?.type === "text") this.beginTextEdit(hit[0])
      else {
        // Board 27 §2 (c2o3u): a text clicked into an auto-layout frame takes the clicked slot.
        const w = this.toWorld(p)
        const into = this.containerAt(w, NO_TARGETS)
        const flow = into ? this.flowFrame(into, NO_TARGETS) : null
        this.textFlow = into && flow ? { parent: into, flow, slot: slotIndex(flow, w) } : null
        this.beginTextEdit(null, w, this.textFlow?.parent ?? dropParent(this.store, hit))
      }
      return
    }
    if (ui.tool !== "select") return

    // Board 27 §5 (ICb89): a selected star's ratio / radius handles win over the resize handles.
    const starHandle = this.starHandleAt(p)
    if (starHandle) {
      this.drag = {
        kind: "shape-handle",
        id: starHandle.id,
        handle: starHandle.handle,
        gesture: this.gesture(starHandle.handle === "ratio" ? "Star ratio" : "Corner radius"),
      }
      this.updateOverlay()
      return
    }
    const handle = this.handleAt(p)
    if (handle && this.layoutResult) {
      const snap = resizeStart(this.store, this.layoutResult, ui.selection)
      if (snap) {
        const first = snap.items[0]?.id
        const pp = first ? this.store.getNode(first)?.parent : null
        this.drag = {
          kind: "resize",
          start: p,
          handle,
          snap,
          gesture: this.gesture("Resize"),
          cands: this.cands(typeof pp === "string" ? pp : null, ui.selection),
          flow: this.flowChildren(snap),
        }
        this.updateOverlay()
        this.updateCursor()
        return
      }
    }

    const artboard = this.artboardOf(e.target)
    const hit = artboard ? [artboard] : this.viewHits(p)
    const deepest = hit[0]
    const before = ui.selection
    // SHORTCUTS "Add to selection" (⇧ click) / "Select inside group" (⌘ click).
    const add = pointerHeld("addToSelection", e)
    if (!deepest) {
      if (!add) ui.clearSelection()
      this.drag = {
        kind: "press",
        start: p,
        startWorld: this.toWorld(p),
        target: null,
        before: add ? before : [],
        scope: null,
        collapse: false,
        toggle: false,
      }
      return
    }
    const target = artboard ?? this.pick(deepest, before, pointerHeld("selectInside", e))
    if (!artboard && !add && !e.metaKey && !e.ctrlKey && !e.altKey)
      this.downInfo = { path: pathOf(this.vdoc, deepest) }
    const isRoot = this.store.getNode(target)?.parent === null
    // Dragging on an unselected root frame's background draws a marquee over its children.
    const scope =
      !artboard &&
      isRoot &&
      target === deepest &&
      !before.includes(target) &&
      this.store.getNode(target)?.type === "frame" &&
      this.store.children(target).length > 0
        ? target
        : undefined
    let collapse = false
    let toggle = false
    if (add) {
      if (before.includes(target)) toggle = true
      else ui.toggleSelection(target)
    } else if (!before.includes(target)) ui.select([target])
    else collapse = before.length > 1
    this.drag = {
      kind: "press",
      start: p,
      startWorld: this.toWorld(p),
      target,
      before: add ? before : [],
      scope,
      collapse,
      toggle,
    }
  }

  private onMove(e: PointerEvent): void {
    const p = this.local(e)
    this.pointer = p
    if (e.altKey !== this.altHeld && !this.drag) this.setAlt(e.altKey)
    if (this.cropMode.active && this.drag?.kind !== "pan") {
      if (!this.cropMode.move(p, e.shiftKey)) this.updateCursor(p)
      return
    }
    const d = this.drag
    if (!d) {
      if (this.isOverlayTarget(e.target) || e.buttons) return
      if (this.ui.getState().tool === "path") {
        this.penHover(p, e)
        this.updateCursor(p)
        return
      }
      if (this.pathEdit) this.pathEditHover(p)
      this.hover(p, e.target)
      this.updateCursor(p)
      if (this.updatePixelReadout(p) || this.altHeld) this.updateOverlay()
      return
    }
    if (d.kind === "pan") {
      this.ui.getState().panBy(p.x - d.last.x, p.y - d.last.y)
      d.last = p
      return
    }
    // Coalesce document edits to one per frame.
    this.pendingPointer = { e, p }
    this.schedule()
  }

  private hover(p: Point, target: EventTarget | null): void {
    const ui = this.ui.getState()
    if (ui.tool !== "select" && ui.tool !== "text") {
      if (ui.hovered) ui.setHovered(null)
      return
    }
    const artboard = this.artboardOf(target)
    let id: string | null = artboard
    if (!id) {
      const hit = this.viewHits(p)[0]
      id = hit ? this.pick(hit, ui.selection, false) : null
      if (ui.tool === "text" && id && this.src.getNode(id)?.type !== "text") id = null
    }
    if (id !== ui.hovered) ui.setHovered(id)
  }

  private dragMove(e: PointerEvent, p: Point): void {
    const d = this.drag
    const layout = this.layoutResult
    if (!d || !layout) return
    const ui = this.ui.getState()
    const v = ui.viewport
    // Board 27 §2 (c2o3u): drawing over an auto-layout frame picks a slot.
    if (d.kind === "draw" || d.kind === "line" || d.kind === "place") this.trackFlowInsert(p, e)
    switch (d.kind) {
      case "press": {
        if (Math.hypot(p.x - d.start.x, p.y - d.start.y) < DRAG_THRESHOLD) return
        if (d.target === null || d.scope) {
          this.drag = {
            kind: "marquee",
            startWorld: d.startWorld,
            before: d.before,
            scope: d.scope ?? null,
            rect: null,
          }
          if (d.scope && !d.before.length) ui.clearSelection()
          this.dragMove(e, p)
          return
        }
        const items = moveStart(this.store, ui.selection)
        const allowed =
          items.length > 0 &&
          topLevel(this.store, ui.selection).every((id) => canMove(this.store, id))
        const box = unionRects(
          items.map((i) => layout.nodes.get(i.id)?.world).filter((b): b is Rect => !!b),
        )
        const pp = items[0] ? this.store.getNode(items[0].id)?.parent : null
        this.drag = {
          kind: "move",
          start: d.start,
          items: allowed ? items : [],
          gesture: this.gesture("Move"),
          allowed,
          box,
          cands: this.cands(typeof pp === "string" ? pp : null, ui.selection),
        }
        this.beginReloc(this.drag, e.altKey)
        if (ui.hovered) ui.setHovered(null)
        this.updateOverlay()
        this.updateCursor()
        this.dragMove(e, p)
        return
      }
      case "move": {
        if (!d.allowed) return
        let dx = (p.x - d.start.x) / v.zoom
        let dy = (p.y - d.start.y) / v.zoom
        let lockX = false
        let lockY = false
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) {
            dy = 0
            lockY = true
          } else {
            dx = 0
            lockX = true
          }
        }
        if (d.box) {
          const moving = { ...d.box, x: d.box.x + dx, y: d.box.y + dy }
          const on = this.snapEnabled(e)
          const r = on
            ? snap({
                moving,
                edges: { left: !lockX, right: !lockX, top: !lockY, bottom: !lockY },
                candidates: d.cands.candidates,
                parent: d.cands.parent,
                zoom: v.zoom,
              })
            : null
          this.setSnapView(r)
          if (r) {
            dx += r.dx
            dy += r.dy
          }
          // Pixel grid: whole-pixel positions.
          if (!lockX) dx = this.px(d.box.x + dx) - d.box.x
          if (!lockY) dy = this.px(d.box.y + dy) - d.box.y
        }
        if (d.reloc) {
          d.reloc.pointer = { e, p }
          this.relocStep(d, d.reloc, { x: dx, y: dy }, p, e)
        } else d.gesture.set(moveOps(this.store, layout, d.items, { x: dx, y: dy }))
        this.updateOverlay()
        return
      }
      case "resize": {
        let box = resizeBox(
          d.snap.box,
          d.handle,
          (p.x - d.start.x) / v.zoom,
          (p.y - d.start.y) / v.zoom,
          { aspect: e.shiftKey, center: e.altKey },
        )
        box = this.snapResize(d.handle, box, d.cands, e)
        d.gesture.set(resizeOps(this.store, layout, d.snap, box))
        this.resizeFeedback(d, box, p)
        this.updateOverlay()
        return
      }
      case "marquee": {
        const w = this.toWorld(p)
        const rect = rectFromPoints(d.startWorld, w)
        d.rect = rect
        this.marquee = rect
        const screen = {
          x: (rect.x - v.x) * v.zoom,
          y: (rect.y - v.y) * v.zoom,
          w: rect.w * v.zoom,
          h: rect.h * v.zoom,
        }
        let scope = d.scope
        if (scope === null) {
          // A marquee fully inside one root frame selects that frame's children.
          for (const root of this.paged.children(null)) {
            const b = layout.nodes.get(root)?.world
            if (b && containsRect(b, rect) && this.store.children(root).length) scope = root
          }
        }
        const picked: string[] = []
        for (const id of this.renderer.hitTestRect(screen, { mode: "intersect" })) {
          const r = this.real(id)
          if ((this.store.getNode(r)?.parent ?? null) === scope && !picked.includes(r))
            picked.push(r)
        }
        picked.reverse() // paint order (bottom first) reads naturally in the layer panel
        ui.select([...d.before, ...picked])
        this.updateOverlay()
        return
      }
      case "place": {
        if (!d.dragged && Math.hypot(p.x - d.start.x, p.y - d.start.y) < DRAG_THRESHOLD) return
        d.dragged = true
        // Drawn keeping the image's aspect ratio (width follows the pointer).
        const end = this.snapPt(this.toWorld(p), d.cands, e)
        const ratio = d.placement.height / Math.max(1, d.placement.width)
        const w = Math.abs(end.x - d.startWorld.x)
        const h = w * ratio
        const r = {
          x: end.x < d.startWorld.x ? d.startWorld.x - w : d.startWorld.x,
          y: end.y < d.startWorld.y ? d.startWorld.y - h : d.startWorld.y,
          w,
          h,
        }
        const ok = d.gesture.set(
          this.withManifest(
            createImageFrameOp(this.store, layout, d.parent, r, d.placement.src, d.id),
            d.placement,
          ),
        )
        if (ok && ui.selection[0] !== d.id) ui.select([d.id])
        this.updateOverlay()
        return
      }
      case "pen":
        this.penDrag(p, e, d)
        return
      case "path-anchor":
      case "path-handle":
        this.pathEditDrag(p, e, d)
        return
      case "line": {
        if (!d.dragged && Math.hypot(p.x - d.start.x, p.y - d.start.y) < DRAG_THRESHOLD) return
        d.dragged = true
        // ⇧ constrains to 45° (rule g7wdz); else the end snaps like a pen anchor.
        const end = e.shiftKey
          ? this.pxAnchor(constrain45(d.startWorld, this.toWorld(p)))
          : this.snapPt(this.toWorld(p), d.cands, e, [], (q) => this.pxAnchor(q))
        const op = this.lineOp(d, end)
        const ok = op ? d.gesture.set([op]) : false
        if (ok && ui.selection[0] !== d.id) ui.select([d.id])
        this.updateOverlay()
        return
      }
      case "shape-handle":
        this.starHandleDrag(d, p)
        return
      case "path-bend": {
        const contours = bendSegment(d.base, d.ref, d.t, this.pxAnchor(this.toWorld(p)))
        if (this.pathEdit && this.writePath(contours, d.gesture)) this.pathEdit.contours = contours
        this.updateOverlay()
        return
      }
      case "draw": {
        if (!d.dragged && Math.hypot(p.x - d.start.x, p.y - d.start.y) < DRAG_THRESHOLD) return
        d.dragged = true
        let end = this.snapPt(this.toWorld(p), d.cands, e)
        if (e.shiftKey) {
          const s = Math.max(Math.abs(end.x - d.startWorld.x), Math.abs(end.y - d.startWorld.y))
          end = {
            x: d.startWorld.x + Math.sign(end.x - d.startWorld.x || 1) * s,
            y: d.startWorld.y + Math.sign(end.y - d.startWorld.y || 1) * s,
          }
        }
        const r = rectFromPoints(d.startWorld, end)
        const ok = d.gesture.set([
          createShapeOp(
            this.store,
            layout,
            d.shape,
            d.parent,
            r,
            d.id,
            d.name,
            this.toolSides(d.shape),
          ),
        ])
        if (ok && ui.selection[0] !== d.id) ui.select([d.id])
        this.updateOverlay()
        return
      }
    }
  }

  private onUp(e: PointerEvent): void {
    const el = this.el as HTMLElement
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    if (this.cropMode.up()) return
    this.onUpAt(this.local(e))
  }

  private onUpAt(p: Point | null): void {
    const d = this.drag
    if (!d) return
    // Apply the last coalesced move first so the gesture ends where the pointer did.
    const pending = this.pendingPointer
    this.pendingPointer = null
    if (pending) this.dragMove(pending.e, pending.p)
    const ui = this.ui.getState()
    const final = this.drag ?? d
    // Board 27 §2: a click (no drag) over an auto-layout frame inserts at the clicked slot.
    if (p && (final.kind === "draw" || final.kind === "line" || final.kind === "place"))
      this.trackFlowInsert(p)
    this.drag = null
    this.clearGestureFeedback()
    switch (final.kind) {
      case "press":
        if (final.target && final.toggle) ui.toggleSelection(final.target)
        else if (final.target && final.collapse) ui.select([final.target])
        break
      case "move":
        if (final.reloc) this.finishReloc(final.reloc, final.gesture)
        if (final.reloc?.ask && final.gesture.applied) {
          this.askAltDuplicate(final.reloc, final.gesture)
          break
        }
        final.gesture.end()
        break
      case "resize":
        final.gesture.end()
        break
      case "marquee":
        this.marquee = null
        break
      case "draw": {
        if (!final.dragged && this.layoutResult) {
          const c = final.startWorld
          final.gesture.set([
            createShapeOp(
              this.store,
              this.layoutResult,
              final.shape,
              final.parent,
              { x: c.x, y: c.y, w: CLICK_SIZE, h: CLICK_SIZE },
              final.id,
              final.name,
              this.toolSides(final.shape),
            ),
          ])
        }
        final.gesture.end()
        if (final.gesture.applied) ui.select([final.id])
        ui.setTool("select")
        break
      }
      case "line": {
        if (!final.dragged && this.layoutResult) {
          // Click: a 100 px horizontal line / arrow from the click (CLICK_SIZE, like shapes).
          const c = final.startWorld
          const op = this.lineOp(final, { x: c.x + CLICK_SIZE, y: c.y })
          if (op) final.gesture.set([op])
        }
        final.gesture.end()
        if (final.gesture.applied) ui.select([final.id])
        ui.setTool("select")
        break
      }
      case "shape-handle":
      case "path-bend":
        final.gesture.end()
        break
      case "place": {
        const pl = final.placement
        if (!final.dragged && this.layoutResult) {
          // Click: natural size, centered on the click.
          const c = final.startWorld
          const r = {
            x: this.px(c.x - pl.width / 2),
            y: this.px(c.y - pl.height / 2),
            w: pl.width,
            h: pl.height,
          }
          final.gesture.set(
            this.withManifest(
              createImageFrameOp(this.store, this.layoutResult, final.parent, r, pl.src, final.id),
              pl,
            ),
          )
        }
        final.gesture.end()
        if (final.gesture.applied) ui.select([final.id])
        this.armPlacement(null)
        break
      }
      case "pen":
        this.penUp(final)
        break
      case "path-anchor":
        final.gesture.end()
        if (!final.dragged && final.collapse && this.pathEdit) {
          this.pathEdit.selected = [final.collapse]
        }
        break
      case "path-handle":
        final.gesture.end()
        break
      case "pan":
        break
    }
    this.updateOverlay()
    this.updateCursor(p ?? undefined)
  }

  /** True while a pointer gesture that edits the document (move, resize, draw) is running. */
  isGesturing(): boolean {
    const k = this.drag?.kind
    return (
      k === "move" ||
      k === "resize" ||
      k === "draw" ||
      k === "place" ||
      k === "path-anchor" ||
      k === "path-handle" ||
      k === "line" ||
      k === "shape-handle" ||
      k === "path-bend"
    )
  }

  /** Snap guides, resize badges and the delta badge end with the gesture. */
  private clearGestureFeedback(): void {
    this.endStructure()
    this.snapView = NO_SNAP
    this.resizeView = null
    this.cursorBadge = null
  }

  /** Escape / blur during a gesture: reverts it. */
  cancelDrag(): boolean {
    const d = this.drag
    if (!d) return false
    this.drag = null
    this.pendingPointer = null
    this.clearGestureFeedback()
    if (
      d.kind === "move" ||
      d.kind === "resize" ||
      d.kind === "draw" ||
      d.kind === "place" ||
      d.kind === "path-anchor" ||
      d.kind === "path-handle" ||
      d.kind === "line" ||
      d.kind === "shape-handle" ||
      d.kind === "path-bend"
    )
      d.gesture.cancel()
    if (d.kind === "path-anchor" || d.kind === "path-handle" || d.kind === "path-bend")
      this.syncPathEdit(true)
    if (d.kind === "marquee") {
      this.marquee = null
      this.ui.getState().select(d.before)
    }
    this.updateOverlay()
    this.updateCursor()
    return true
  }

  /**
   * Multi-click drilling: in a rapid click sequence (the browser's `detail`, which follows the
   * OS double-click interval and slop) every click after the first selects one level deeper on
   * the path fixed by the first click. Runs on `mousedown`, right after the `pointerdown` that
   * handled the press, so each level shows at once.
   */
  private onMultiDown(e: MouseEvent): void {
    const info = this.downInfo
    this.downInfo = null
    if (e.button !== 0 || this.isOverlayTarget(e.target)) return
    if (e.detail <= 1) {
      // A new sequence: the press just selected a layer on the path to the pointer's deepest hit.
      this.drillSeq = null
      const sel = this.ui.getState().selection
      if (!info || sel.length !== 1 || this.pathEdit || this.armed) return
      const level = info.path.indexOf(sel[0] as string)
      if (level >= 0) this.drillSeq = { path: info.path, level, enter: false, skipDbl: false }
      return
    }
    const q = this.drillSeq
    if (!q || this.ui.getState().tool !== "select" || this.pathEdit || this.armed || this.editing)
      return
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      this.drillSeq = null
      return
    }
    const ui = this.ui.getState()
    if (ui.selection.length !== 1 || ui.selection[0] !== q.path[q.level]) {
      this.drillSeq = null
      return
    }
    const step = drillStep(q.path, q.level)
    if (!step.atLeaf) {
      q.level = step.level
      ui.select([step.id])
      q.skipDbl = true
      return
    }
    // At the leaf: a text enters edit on this click (after the press settles, see onMultiClick).
    if (isTextual(this.src.getNode(step.id)?.type)) {
      q.enter = true
      q.skipDbl = true
    }
  }

  private onMultiClick(e: MouseEvent): void {
    const q = this.drillSeq
    if (!q?.enter || e.detail < 2) return
    q.enter = false
    if (this.ui.getState().tool !== "select" || this.editing) return
    const id = q.path[q.path.length - 1] as string
    if (this.ui.getState().selection[0] === id) this.beginTextEdit(id)
  }

  private onDoubleClick(e: MouseEvent): void {
    if (this.drillSeq?.skipDbl) {
      // The sequence already stepped (or entered text) for this click.
      this.drillSeq.skipDbl = false
      return
    }
    if (this.isOverlayTarget(e.target) || this.ui.getState().tool !== "select") return
    if (this.pathEdit) {
      // Board 27 §5 (J5Vng): double-click an anchor toggles Sharp ⇄ Smooth.
      const pe = this.pathEdit
      const a = this.anchorAt(this.local(e))
      if (a) {
        const contours = toggleAnchorKind(pe.contours, a)
        if (this.writePath(contours)) pe.contours = contours
        pe.selected = [a]
        this.updateOverlay()
      }
      return
    }
    if (this.armed) return
    const p = this.local(e)
    const hits = this.viewHits(p)
    const hit = hits[0]
    if (!hit) return
    const ui = this.ui.getState()
    const sel = ui.selection.length === 1 ? ui.selection[0] : undefined
    const selType = sel ? this.src.getNode(sel)?.type : undefined
    if (sel && (isTextual(selType) || selType === "path") && hits.includes(sel)) {
      if (isTextual(selType)) this.beginTextEdit(sel)
      else if (!this.src.isVirtual(sel)) this.editPath(sel)
      return
    }
    // Board 27 §6 (d): double-click an image fill (a leaf: frames with children are entered).
    if (sel && hits.includes(sel) && this.croppable(sel)) {
      void this.cropMode.start(sel)
      return
    }
    // Board 11: double-click enters an instance one level at a time (composite ids), like groups.
    const next = enterTarget(this.vdoc, hit, sel)
    ui.select([next])
    const t = next === hit ? this.src.getNode(hit)?.type : undefined
    if (isTextual(t)) this.beginTextEdit(hit)
    // Board 10 #6: double-click a vector to edit it (not inside an instance: detach first).
    else if (t === "path" && !this.src.isVirtual(hit)) this.editPath(hit)
  }

  /** A real node with a visible image fill whose double-click enters crop mode. */
  private croppable(id: string): boolean {
    const n = this.src.getNode(id) as NodeData | undefined
    if (!n || this.src.isVirtual(id) || isTextual(n.type) || n.type === "path") return false
    if (n.type === "frame" && this.src.children(id).length > 0) return false
    return topImagePaint(n) !== null
  }

  private onWheel(e: WheelEvent): void {
    if (this.isOverlayTarget(e.target)) return
    e.preventDefault()
    const ui = this.ui.getState()
    const p = this.local(e)
    // Pinch arrives as ctrl + wheel, so it zooms in both modes. A mouse wheel has no pan axis
    // of its own: in "mouse" mode a plain scroll zooms and ⇧ + scroll pans (a tilt wheel's
    // horizontal delta still pans).
    const mouse = this.opts.wheelZoom?.() === "mouse"
    const zoom = e.ctrlKey || e.metaKey || (mouse && !e.shiftKey && !e.deltaX && e.deltaY !== 0)
    if (zoom) {
      ui.zoomAt(p.x, p.y, ui.viewport.zoom * wheelZoomFactor(e.deltaY, e.deltaMode))
      return
    }
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.size.h : 1
    let dx = e.deltaX * k
    let dy = e.deltaY * k
    if (e.shiftKey && !dx) {
      dx = dy
      dy = 0
    }
    ui.panBy(-dx, -dy)
  }

  // --- keyboard -----------------------------------------------------------------------------

  private onKey(e: KeyboardEvent): boolean {
    if (e.defaultPrevented || this.editing) return false
    const t = e.target
    if (
      t instanceof HTMLElement &&
      (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
    )
      return false
    const mod = e.metaKey || e.ctrlKey
    const ui = this.ui.getState()
    if (e.key === "Alt") {
      this.setAlt(true)
      // Keep ⌥ from focusing the browser menu bar (Windows) while measuring.
      if (ui.selection.length) e.preventDefault()
      return false
    }
    if (matches("pan", e)) {
      if (!this.spaceHeld) {
        this.spaceHeld = true
        this.updateCursor()
      }
      e.preventDefault()
      return true
    }
    if (matches("gesture.cancel", e) && this.cancelDrag()) {
      e.preventDefault()
      return true
    }
    // Mid-gesture, commands would interleave undo entries with the gesture's steps: swallow
    // them (Escape cancels the gesture; modifiers still reach the pointer events).
    if (this.isGesturing()) {
      e.preventDefault()
      return true
    }
    // Board 27 §6 (d): Enter applies, Esc reverts; arrows don't nudge the layer meanwhile.
    if (this.cropMode.active) {
      if (matches("crop.apply", e)) {
        e.preventDefault()
        this.cropMode.apply()
        return true
      }
      if (matches("crop.cancel", e)) {
        e.preventDefault()
        this.cropMode.cancel()
        return true
      }
      if (/^Arrow/.test(e.key) || e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault()
        return true
      }
    }
    const run = (fn: () => unknown): true => {
      e.preventDefault()
      this.flush()
      fn()
      return true
    }
    const key = e.key.toLowerCase()
    // --- M2 modes: pen, image placement, path edit, icon insertion.
    if (ui.tool === "path") {
      if (matches("pen.finish", e)) {
        return run(() => {
          if (this.pen?.anchors.length) this.finishPen()
          else ui.setTool("select")
        })
      }
      if (matches("pen.removePoint", e) && this.pen?.anchors.length) {
        return run(() => this.penUndo(false))
      }
    }
    if (this.armed && matches("placement.cancel", e)) return run(() => this.armPlacement(null))
    if (this.pathEdit) {
      if (matches("pathEdit.exit", e)) return run(() => this.exitPathEdit())
      if (matches("pathEdit.deletePoints", e) && this.pathEdit.selectedSegment)
        return run(() => this.deleteSelectedSegment())
      if (matches("pathEdit.deletePoints", e) && this.pathEdit.selected.length)
        return run(() => this.deleteSelectedAnchors())
    }
    if (matches("iconPicker", e) && this.opts.onIconPicker) {
      return run(() => this.requestIcon())
    }
    if (matches("duplicate", e)) return run(() => this.duplicate())
    if (matches("group", e)) return run(() => this.group())
    if (matches("zoomIn", e)) return run(() => this.zoomTo(ui.viewport.zoom * 2))
    if (matches("zoomOut", e)) return run(() => this.zoomTo(ui.viewport.zoom / 2))
    // Board 27 rule bFozp: ⌥ arrows resize by the nudge step (⇧ = big step).
    if (matches("nudgeResize", e) && ui.selection.length && this.layoutResult) {
      const d = NUDGE_RESIZE[e.key.toLowerCase()]
      if (d) return run(() => this.nudgeResize(d[0], d[1], e.shiftKey))
    }
    if (mod || e.altKey) return false
    if (matches("flipHorizontal", e) && ui.selection.length)
      return run(() => this.apply(flipOps(this.vdoc, ui.selection, "x"), "Flip horizontal"))
    if (matches("flipVertical", e) && ui.selection.length)
      return run(() => this.apply(flipOps(this.vdoc, ui.selection, "y"), "Flip vertical"))
    if (matches("zoomToFit", e)) return run(() => this.zoomToFit())
    if (matches("zoomToSelection", e))
      return run(() => this.zoomToFit(this.ui.getState().selection))
    // ⇧0 (⌘0 is Editor.tsx's).
    if (matchCombo(ZOOM_100_SHIFT, e)) return run(() => this.zoomTo(1))
    if (matches("delete", e)) {
      if (!ui.selection.length) return false
      // Composite ids delete through the router (hidden instead, board 15).
      return run(() => this.apply(deleteOps(this.vdoc, ui.selection), "Delete"))
    }
    if (matches("selectChildren", e) && ui.selection.length === 1) {
      const id = ui.selection[0] as string
      const t = this.src.getNode(id)?.type
      if (isTextual(t)) return run(() => this.beginTextEdit(id))
      if (t === "path" && !this.src.isVirtual(id)) return run(() => this.editPath(id))
      const first = this.src.children(id)[0]
      if (first) return run(() => ui.select([first]))
      return false
    }
    // ⇧↵ selects the parent too (Figma); not listed as a second key in the shortcuts table.
    const shiftEnter = e.key === "Enter" && e.shiftKey && !mod && !e.altKey
    if ((shiftEnter || matches("selectParent", e)) && ui.selection.length) {
      // Escape selects the parent (Figma); at the top level it clears the selection.
      const parents = [...new Set(ui.selection.map((id) => this.src.getNode(id)?.parent ?? null))]
      e.preventDefault()
      if (parents.length === 1 && typeof parents[0] === "string") ui.select([parents[0]])
      else ui.clearSelection()
      return false
    }
    const arrows: Record<string, [number, number]> = {
      arrowleft: [-1, 0],
      arrowright: [1, 0],
      arrowup: [0, -1],
      arrowdown: [0, 1],
    }
    const a = arrows[key]
    if (a && matches("nudge", e) && ui.selection.length && this.layoutResult) {
      const n = this.nudgeStep()
      const k = e.shiftKey ? n.big : n.step
      return run(() => {
        if (this.layoutResult)
          this.apply(
            nudgeOps(this.store, this.layoutResult, ui.selection, a[0] * k, a[1] * k),
            "Nudge",
          )
      })
    }
    return false
  }

  /** Board 27 §6 (b): the hovered gap field's marks on the selected auto-layout frame. */
  private gapPreviewMeasurements(): Measurement[] {
    const g = gapPreviewStore(this.ui).get()
    const layout = this.layoutResult
    if (!g || !layout) return []
    const lay = this.src.getNode(g.id)?.layout as { dir?: unknown } | undefined
    if (!lay || typeof lay !== "object") return []
    const kids = (this.src.children(g.id) as string[]).filter((c) => isFlowChild(this.vdoc, c))
    return gapPreviewMeasurements(layout, g, lay.dir === "column" ? "column" : "row", kids)
  }

  /** Board 27 Settings › Canvas › Nudge (default 1 / ⇧ 10 px). */
  private nudgeStep(): { step: number; big: number } {
    return this.opts.nudge?.() ?? { step: 1, big: 10 }
  }

  /** ⌥ arrow: grows (→ ↓) or shrinks (← ↑) the selection's right / bottom edge by the step. */
  private nudgeResize(dw: number, dh: number, big: boolean): void {
    const layout = this.layoutResult
    if (!layout) return
    const start = resizeStart(this.store, layout, this.ui.getState().selection)
    if (!start) return
    const n = this.nudgeStep()
    const k = big ? n.big : n.step
    const b = start.box
    const to = { ...b, w: Math.max(1, b.w + dw * k), h: Math.max(1, b.h + dh * k) }
    this.apply(resizeOps(this.store, layout, start, to), "Resize")
  }

  // --- Board 27 §2 (c2o3u, Y4vVe): insert into / drag in and out of auto layout -------------------

  /** The running draw / line / place gesture's layout insertion (undefined = not resolved yet). */
  private flowInsert: FlowInsert | null | undefined = undefined
  /** A component dragged from Assets over an auto-layout frame (`previewFlowInsert`). */
  private dropFlow: { parent: string; flow: FlowFrame; slot: number } | null = null
  /** A text clicked into an auto-layout frame: the slot it takes when committed. */
  private textFlow: { parent: string; flow: FlowFrame; slot: number } | null = null
  /** Nodes drawn invisible while their ghost follows the pointer (their slot stays laid out). */
  private ghosted: ReadonlySet<string> = new Set()
  private ghostNodes = new Map<string, { base: unknown; data: LayoutNodeData }>()
  /** Ghost rasters by original id (object URLs, revoked when the drag ends). */
  private ghostSrc = new Map<string, string>()
  private ghostRequested = new Set<string>()
  private structureKey = ""

  /** The view node of a ghosted node with opacity 0 (identity-stable per source object). */
  private ghostNode(id: string): LayoutNodeData | undefined {
    const n = this.src.getNode(id)
    if (!n) return n
    const hit = this.ghostNodes.get(id)
    if (hit && hit.base === n) return hit.data
    const data = { ...n, opacity: 0 } as LayoutNodeData
    this.ghostNodes.set(id, { base: n, data })
    return data
  }

  private setGhosted(ids: readonly string[]): void {
    const next = new Set(ids)
    const prev = this.ghosted
    if (next.size === prev.size && [...next].every((id) => prev.has(id))) return
    this.ghosted = next
    this.ghostNodes.clear()
    this.renderer.invalidate([...new Set([...prev, ...next])])
    this.renderer.requestFrame()
  }

  /**
   * The deepest frame under world point `w` that may take children: visible, unlocked, not
   * excluded, never entering an instance. Null = the active page's root.
   */
  private containerAt(w: Point, exclude: ReadonlySet<string>): string | null {
    const layout = this.layoutResult
    if (!layout) return null
    let found: string | null = null
    let ids: readonly string[] = this.paged.children(null)
    for (let depth = 0; depth < 256; depth++) {
      let next: string | null = null
      for (let i = ids.length - 1; i >= 0; i--) {
        const id = ids[i] as string
        if (exclude.has(id)) continue
        const n = this.store.getNode(id)
        const l = layout.nodes.get(id)
        if (!n || !l?.visible || n.type !== "frame" || n.locked === true) continue
        if (!insideRect(l.world, w)) continue
        next = id
        break
      }
      if (next === null) break
      found = next
      ids = this.store.children(next)
    }
    return found
  }

  /**
   * Where a moved selection drops (board 27 §2 Y4vVe, "between vs into"). The default is where it
   * is: reordering among its siblings. The walk from the page down enters a container that is
   * not an ancestor of the original parent only when that is clearly intended:
   *  - the dragged selection fits it (at most {@link INTO_FIT} of its width and height), so a
   *    full-width section never nests into another section, AND
   *  - the pointer is well inside it: off an edge band (25 % of an auto-layout frame's main
   *    axis, at least {@link INTO_BAND_PX} screen px on every side), so the gaps and margins
   *    between sections stay "between";
   *  - or, for what does not fit or sits near an edge, the pointer rests {@link INTO_DWELL_MS}
   *    ms inside it (at least {@link INTO_BAND_PX} px from every edge).
   * A container that is not entered ends the walk: the drop stays in its parent.
   */
  private relocTarget(w: Point, p: Point, r: Reloc): string | null {
    const layout = this.layoutResult
    if (!layout) return null
    const zoom = this.ui.getState().viewport.zoom
    const band = INTO_BAND_PX / zoom
    let found: string | null = null
    let ids: readonly string[] = this.paged.children(null)
    let waiting = false
    for (let depth = 0; depth < 256; depth++) {
      let next: string | null = null
      for (let i = ids.length - 1; i >= 0; i--) {
        const id = ids[i] as string
        if (r.noTarget.has(id)) continue
        const n = this.store.getNode(id)
        const l = layout.nodes.get(id)
        if (!n || !l?.visible || n.type !== "frame" || n.locked === true) continue
        if (!insideRect(l.world, w)) continue
        next = id
        break
      }
      if (next === null) break
      if (!r.ancestors.has(next) && !r.entered.has(next)) {
        const b = (layout.nodes.get(next) as { world: Rect }).world
        const lay = this.store.getNode(next)?.layout as { dir?: unknown } | undefined
        const flow = typeof lay === "object" && lay !== null
        const col = flow && lay.dir === "column"
        const mainBand = flow ? Math.max(band, (col ? b.h : b.w) * INTO_EDGE) : band
        const bx = flow && !col ? mainBand : band
        const by = flow && col ? mainBand : band
        const inner = (bx2: number, by2: number) =>
          w.x >= b.x + bx2 && w.x <= b.x + b.w - bx2 && w.y >= b.y + by2 && w.y <= b.y + b.h - by2
        const fits = r.size.w <= b.w * INTO_FIT && r.size.h <= b.h * INTO_FIT
        if (!(fits && inner(bx, by))) {
          if (inner(band, band)) {
            // Rests here: enters after the dwell.
            const d = r.dwell
            const now = Date.now()
            if (!d || d.id !== next || Math.hypot(p.x - d.at.x, p.y - d.at.y) > 6)
              r.dwell = { id: next, at: p, since: now }
            else if (now - d.since >= INTO_DWELL_MS) {
              r.entered.add(next)
              found = next
              ids = this.store.children(next)
              continue
            }
            waiting = true
          }
          break
        }
      }
      found = next
      ids = this.store.children(next)
    }
    for (const id of [...r.entered])
      if (!found || !pathOf(this.store, found).includes(id)) r.entered.delete(id)
    if (!waiting) r.dwell = null
    else this.armDwell(r)
    return found
  }

  /**
   * Re-runs the move step once the dwell time has passed with the pointer at rest. The timer
   * counts from the current dwell's start: a timer armed for an earlier dwell (the pointer moved
   * on since) would fire too soon, find the dwell short and wait a whole period more.
   */
  private armDwell(r: Reloc): void {
    const since = r.dwell?.since ?? Date.now()
    if (r.dwellTimer !== null) {
      if (r.dwellSince === since) return
      clearTimeout(r.dwellTimer)
    }
    r.dwellSince = since
    r.dwellTimer = setTimeout(
      () => {
        r.dwellTimer = null
        const d = this.drag
        if (d?.kind !== "move" || d.reloc !== r || !r.pointer) return
        this.pendingPointer = r.pointer
        this.schedule()
      },
      Math.max(0, since + INTO_DWELL_MS - Date.now()) + 20,
    )
  }

  /** True when `id` is a strict descendant of `ancestor` (null = the root: always). */
  private isWithin(id: string, ancestor: string | null): boolean {
    if (ancestor === null) return true
    let cur = this.store.getNode(id)?.parent
    for (let guard = 0; typeof cur === "string" && guard < 4096; guard++) {
      if (cur === ancestor) return true
      cur = this.store.getNode(cur)?.parent
    }
    return false
  }

  /** Flow geometry of auto-layout frame `id` (children in `exclude` left out), else null. */
  private flowFrame(id: string, exclude: ReadonlySet<string>): FlowFrame | null {
    const n = this.store.getNode(id)
    const layout = this.layoutResult
    const box = layout?.nodes.get(id)?.world
    const lay = n?.layout
    if (!n || !layout || !box || typeof lay !== "object" || lay === null) return null
    if (this.src.isVirtual(id)) return null
    const L = lay as { dir?: unknown; gap?: unknown; pad?: unknown; wrap?: unknown }
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0)
    const pad = this.resolver.value(id, L.pad)
    const children = this.store
      .children(id)
      .filter((c) => !exclude.has(c) && layout.nodes.get(c)?.inFlow === true)
      .map((c) => ({ id: c, box: (layout.nodes.get(c) as { world: Rect }).world }))
    return {
      dir: L.dir === "column" ? "column" : "row",
      content: contentBox(
        box,
        padOf(Array.isArray(pad) ? pad.map((v) => this.resolver.value(id, v)) : pad),
      ),
      gap: num(this.resolver.value(id, L.gap)),
      wrap: L.wrap === true,
      children,
    }
  }

  /** A parent-local point → world (null parent = world). */
  private localToWorld(parent: string | null, x: number, y: number): Point {
    const t = parent ? this.layoutResult?.nodes.get(parent)?.transform : undefined
    if (!t) return { x, y }
    return { x: t[0] * x + t[2] * y + t[4], y: t[1] * x + t[3] * y + t[5] }
  }

  /** Resolves (on the first call) and updates the layout insertion of a draw / line / place. */
  private trackFlowInsert(p: Point, e?: { metaKey: boolean; ctrlKey: boolean }): void {
    const d = this.drag
    if (!d || (d.kind !== "draw" && d.kind !== "line" && d.kind !== "place")) return
    if (this.flowInsert === undefined) {
      this.flowInsert = null
      const start = this.toWorld(d.start)
      const parent = this.containerAt(start, NO_TARGETS)
      const flow = parent ? this.flowFrame(parent, NO_TARGETS) : null
      if (!parent || !flow) return
      const f: FlowInsert = { parent, flow, slot: 0, absolute: false, pending: null }
      this.flowInsert = f
      d.gesture = this.flowGesture(d.gesture, f)
    }
    const f = this.flowInsert
    if (!f) return
    if (e) f.absolute = e.metaKey || e.ctrlKey
    f.slot = slotIndex(f.flow, this.toWorld(p))
  }

  /**
   * Wraps a draw gesture over an auto-layout frame: nothing is written while dragging (the bar
   * and the draw ghost show the result); the release inserts the node at the slot with its
   * drawn size. With ⌘ the node is drawn live as an absolute child of the frame.
   */
  private flowGesture(inner: Gesture, f: FlowInsert): Gesture {
    return {
      get applied() {
        return inner.applied
      },
      get done() {
        return inner.done
      },
      set: (ops, label) => {
        if (f.absolute) {
          f.pending = null
          return inner.set(this.flowOps(ops, f, true), label)
        }
        f.pending = ops
        inner.set([], label)
        return true
      },
      cancel: () => {
        f.pending = null
        inner.cancel()
      },
      end: () => {
        if (f.pending && !f.absolute) inner.set(this.flowOps(f.pending, f, false))
        f.pending = null
        inner.end()
      },
    }
  }

  /** Retargets insert ops into a layout frame: flow child at the slot, or absolute (⌘). */
  private flowOps(
    ops: readonly Op[],
    f: { parent: string; flow: FlowFrame; slot: number },
    absolute: boolean,
  ): Op[] {
    const layout = this.layoutResult
    return ops.map((op) => {
      if (op.op !== "insert" || !layout) return op
      const node = { ...(op.node as Record<string, unknown>) }
      const from = op.parent ?? null
      if (absolute) {
        const world = this.localToWorld(from, num(node.x) ?? 0, num(node.y) ?? 0)
        const tl = toLocal(layout, f.parent, world)
        node.x = round2(tl.x)
        node.y = round2(tl.y)
        node.position = "absolute"
        const { index: _index, ...rest } = op
        return { ...rest, parent: f.parent, node }
      }
      delete node.x
      delete node.y
      const siblings = this.store.children(f.parent)
      const flowIds = f.flow.children.map((c) => c.id)
      return {
        ...op,
        parent: f.parent,
        index: flowSiblingIndex(siblings, flowIds, f.slot),
        node,
      }
    })
  }

  /** World box of the first insert op (the draw ghost). */
  private opWorldRect(ops: readonly Op[]): Rect | null {
    const op = ops.find((o) => o.op === "insert")
    if (op?.op !== "insert") return null
    const n = op.node as Record<string, unknown>
    const tl = this.localToWorld(op.parent ?? null, num(n.x) ?? 0, num(n.y) ?? 0)
    return { x: tl.x, y: tl.y, w: num(n.w) ?? 0, h: num(n.h) ?? 0 }
  }

  /**
   * Board 13 / 27: a component dragged from Assets over an auto-layout frame shows the bar;
   * returns the frame and the sibling index the instance takes (null: not over a layout frame,
   * or `screen` null to clear).
   */
  previewFlowInsert(screen: Point | null): { parent: string; index: number } | null {
    let next: typeof this.dropFlow = null
    if (screen) {
      this.flush()
      const w = this.toWorld(screen)
      const parent = this.containerAt(w, NO_TARGETS)
      const flow = parent ? this.flowFrame(parent, NO_TARGETS) : null
      if (parent && flow) next = { parent, flow, slot: slotIndex(flow, w) }
    }
    this.dropFlow = next
    this.syncStructure()
    if (!next) return null
    const flowIds = next.flow.children.map((c) => c.id)
    return {
      parent: next.parent,
      index: flowSiblingIndex(this.store.children(next.parent), flowIds, next.slot),
    }
  }

  /**
   * Starts the reorder / reparent / ⌥-duplicate state of a move (non-root selections, or any
   * selection with ⌥). Roots without ⌥ keep the plain move (they stay on the page root).
   */
  private beginReloc(d: Drag, alt: boolean): void {
    if (d.kind !== "move") return
    const layout = this.layoutResult
    if (!layout) return
    const ui = this.ui.getState()
    const sel = topLevel(this.store, ui.selection)
    const first = sel[0] ? this.store.getNode(sel[0]) : undefined
    if (!first) return
    const parent = typeof first.parent === "string" ? first.parent : null
    const ok = sel.every((id) => {
      const n = this.store.getNode(id)
      return (
        !!n &&
        n.locked !== true &&
        !this.src.isVirtual(id) &&
        typeof n.at !== "string" &&
        (n.parent ?? null) === parent &&
        !!layout.nodes.get(id)
      )
    })
    if (!ok || (parent !== null && this.store.getNode(parent)?.type === "instance")) return
    if (parent === null && !alt) return
    const originals = this.store.children(parent).filter((id) => sel.includes(id))
    const flowStart =
      parent !== null && originals.every((id) => layout.nodes.get(id)?.inFlow === true)
    let ids = originals
    let clone: Op[] = []
    let ask: Reloc["ask"] = null
    let base = this.store.children(parent)
    if (alt) {
      // Board 27 §8 (d): a main follows the ⌘D rule (instance · new component · ask).
      const ask0 = this.opts.askDuplicateMain
      const pref = this.opts.duplicateMainPref?.() ?? "instance"
      const store = this.store
      const m = altDragCloneOps(
        store,
        originals,
        pref === "ask" && !ask0 ? "instance" : pref,
        () => new Set(store.nodeIds().map((id) => String(store.getNode(id)?.name ?? ""))),
        () => generateId(),
      )
      if (m?.component) ask = { main: m.main, component: m.component }
      const c = m ?? cloneOps(this.store, originals)
      clone = c.ops
      ids = originals.map((id) => c.pairs.get(id) as string)
      base = base.flatMap((id) => (c.pairs.has(id) ? [id, c.pairs.get(id) as string] : [id]))
    }
    const noTarget = new Set<string>()
    const walk = (id: string) => {
      noTarget.add(id)
      for (const k of this.store.children(id)) walk(k)
    }
    for (const id of originals) walk(id)
    const starts = originals.map((id) => {
      const n = this.store.getNode(id) as NodeData
      const l = layout.nodes.get(id) as { world: Rect; local: Rect }
      return {
        world: l.world,
        local: l.local,
        x: num(n.x) ?? 0,
        y: num(n.y) ?? 0,
        w: n.w,
        h: n.h,
        position: n.position,
      }
    })
    const startBox = unionRects(starts.map((s) => s.world))
    d.reloc = {
      parent,
      parentBox: parent ? (layout.nodes.get(parent)?.world ?? null) : null,
      flowStart,
      alt,
      originals,
      ids,
      clone,
      ask,
      lastOps: [],
      starts,
      noTarget,
      moving: new Set(ids),
      ancestors: new Set(parent ? pathOf(this.store, parent) : []),
      size: { w: startBox?.w ?? 0, h: startBox?.h ?? 0 },
      dwell: null,
      pointer: null,
      dwellTimer: null,
      dwellSince: null,
      entered: new Set(),
      base,
      last: null,
    }
    d.allowed = true
    d.box = startBox
  }

  /** Sizes an auto-layout parent gave (`fill`) frozen to px when a node leaves the flow. */
  private frozenSize(s: Reloc["starts"][number]): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    const fill = (v: unknown) =>
      typeof v === "object" && v !== null && (v as { mode?: unknown }).mode === "fill"
    if (fill(s.w)) out.w = round2(s.local.w)
    if (fill(s.h)) out.h = round2(s.local.h)
    return out
  }

  /** One pointer step of a reloc move (world delta already snapped). */
  private relocStep(
    d: Extract<Drag, { kind: "move" }>,
    r: Reloc,
    delta: Point,
    p: Point,
    e: { metaKey: boolean; ctrlKey: boolean },
  ): void {
    const layout = this.layoutResult
    if (!layout) return
    const w = this.toWorld(p)
    const meta = e.metaKey || e.ctrlKey
    let mode: NonNullable<Reloc["last"]>["mode"] = "free"
    let target: string | null = r.parent
    if (r.parent !== null && meta) mode = r.flowStart ? "absolute" : "free"
    else if (r.parent !== null) {
      const t = this.relocTarget(w, p, r)
      const inside = !r.parentBox || insideRect(r.parentBox, w)
      const deeper = t !== null && t !== r.parent && this.isWithin(t, r.parent)
      if (!inside || deeper) {
        mode = "reparent"
        target = t
      }
    }
    let flow: FlowFrame | null = null
    let slot = 0
    if (mode === "reparent" && target !== null) flow = this.flowFrame(target, r.moving)
    else if (mode === "free" && r.flowStart && r.parent !== null)
      flow = this.flowFrame(r.parent, r.moving)
    if (flow) {
      mode = "flow"
      slot = slotIndex(flow, w)
    }
    r.last = { mode, target, slot, flow, delta }
    const ops: Op[] = mode !== "flow" && r.alt ? [...r.clone] : []
    const l = toParentDelta(layout, r.parent, delta)
    r.starts.forEach((s, i) => {
      const id = r.ids[i] as string
      if (mode === "free") {
        ops.push({ op: "update", id, set: { x: round2(s.x + l.x), y: round2(s.y + l.y) } })
      } else if (mode === "absolute") {
        ops.push({
          op: "update",
          id,
          set: {
            position: "absolute",
            x: round2(s.local.x + l.x),
            y: round2(s.local.y + l.y),
            ...this.frozenSize(s),
          },
        })
      } else if (mode === "reparent") {
        const tl = toLocal(layout, target, { x: s.world.x + delta.x, y: s.world.y + delta.y })
        ops.push({ op: "move", id, parent: target })
        ops.push({
          op: "update",
          id,
          set: { x: round2(tl.x), y: round2(tl.y), ...this.frozenSize(s) },
          unset: s.position !== undefined ? ["position"] : [],
        })
      }
    })
    d.gesture.set(ops)
    r.lastOps = ops
    const ui = this.ui.getState()
    if (r.alt && mode !== "flow" && d.gesture.applied) {
      if (ui.selection.join() !== r.ids.join()) ui.select(r.ids)
    } else if (r.alt && ui.selection.join() !== r.originals.join()) ui.select(r.originals)
    if (mode === "flow") {
      // The slot, not the pointer position, decides a flow drop: no snap guides.
      this.setSnapView(null)
      this.requestGhosts(r)
    }
    this.applyGhosting(r)
  }

  /** The release of a reloc move: a flow preview becomes the reorder / insertion. */
  private finishReloc(r: Reloc, gesture: Gesture): void {
    const last = r.last
    if (last?.mode !== "flow" || !last.flow || last.target === null) return
    const target = last.target
    const base =
      target === r.parent ? r.base : this.store.children(target).filter((id) => !r.moving.has(id))
    const flowIds = last.flow.children.map((c) => c.id)
    const anchor = slotAnchor(base, flowIds, last.slot, r.moving)
    const idx = sequentialIndices(base, r.ids, anchor)
    const ops: Op[] = r.alt ? [...r.clone] : []
    r.ids.forEach((id, i) => {
      ops.push({ op: "move", id, parent: target, index: idx[i] as number })
      if ((r.starts[i] as { position: unknown }).position !== undefined)
        ops.push({ op: "update", id, unset: ["position"] })
    })
    gesture.set(ops)
    r.lastOps = ops
    if (r.alt && gesture.applied) this.ui.getState().select(r.ids)
  }

  /**
   * Board 27 §8 (d): the release of an ⌥-drag of a main with "ask". The previewed copy is
   * reverted, the duplicate-main dialog asks, and the answer applies the same drop as one undo
   * step (instances as previewed, or new components at the same place).
   */
  private askAltDuplicate(r: Reloc, gesture: Gesture): void {
    const ask = r.ask
    const prompt = this.opts.askDuplicateMain
    const ops = r.lastOps
    gesture.cancel()
    this.ui.getState().select(r.originals)
    if (!ask || !prompt || !ops.length) return
    void prompt(ask.main, r.originals).then((mode) => {
      if (!mode) return
      const final = mode === "instance" ? ops : [...ask.component, ...ops.slice(r.clone.length)]
      if (this.apply(final, "Duplicate")) this.ui.getState().select(r.ids)
    })
  }

  /** Renders the originals' ghost rasters (once per drag). */
  private requestGhosts(r: Reloc): void {
    const v = this.ui.getState().viewport
    const scale = Math.min(4, Math.max(0.25, v.zoom * this.size.dpr))
    for (const id of r.originals) {
      if (this.ghostRequested.has(id)) continue
      this.ghostRequested.add(id)
      void this.renderer
        .exportRaster(id, { scale })
        .then((bytes) => {
          if (!this.ghostRequested.has(id)) return
          const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/png" }))
          this.ghostSrc.set(id, url)
          const d = this.drag
          if (d?.kind === "move" && d.reloc) this.applyGhosting(d.reloc)
          this.updateOverlay()
        })
        .catch(() => undefined)
    }
  }

  /** In a flow preview the originals hide once their ghost is ready (not with ⌥: they stay). */
  private applyGhosting(r: Reloc): void {
    this.setGhosted(
      r.last?.mode === "flow" && !r.alt ? r.originals.filter((id) => this.ghostSrc.has(id)) : [],
    )
  }

  /** Ends every structure feedback (gesture end / cancel). */
  private endStructure(): void {
    this.flowInsert = undefined
    this.setGhosted([])
    for (const url of this.ghostSrc.values()) URL.revokeObjectURL(url)
    this.ghostSrc.clear()
    this.ghostRequested.clear()
    this.syncStructure()
  }

  /** Publishes the screen-space structure feedback when it changed. */
  private syncStructure(): void {
    const v = this.ui.getState().viewport
    const layout = this.layoutResult
    const sx = (x: number) => (x - v.x) * v.zoom
    const sy = (y: number) => (y - v.y) * v.zoom
    let bar: SlotBar | null = null
    const gaps: StructureDom["gaps"] = []
    const ghosts: StructureDom["ghosts"] = []
    let draw: StructureDom["draw"] = null
    let hint: StructureDom["hint"] = null
    const d = this.drag
    const f = this.flowInsert
    if (f && d && (d.kind === "draw" || d.kind === "line" || d.kind === "place")) {
      hint = {
        icon: "square",
        text: `Release → inserts at ${f.slot + 1} · ${modKeyHint()} draws on top`,
      }
      if (!f.absolute) {
        bar = slotBar(f.flow, f.slot)
        const r = f.pending ? this.opWorldRect(f.pending) : null
        if (r)
          draw = {
            x: sx(r.x),
            y: sy(r.y),
            w: r.w * v.zoom,
            h: r.h * v.zoom,
            label: `${fmtUnits(r.w)} × ${fmtUnits(r.h)}`,
          }
      }
    } else if (d?.kind === "move" && d.reloc) {
      const r = d.reloc
      if (r.flowStart)
        hint = { icon: "move", text: `Outside → to Canvas · ${modKeyHint()} keeps it absolute` }
      const last = r.last
      if (last?.mode === "flow" && last.flow) {
        bar = slotBar(last.flow, last.slot)
        r.originals.forEach((id, i) => {
          const s = r.starts[i] as { world: Rect }
          const radius = this.radiusOf(id) * v.zoom
          ghosts.push({
            key: id,
            x: sx(s.world.x + last.delta.x),
            y: sy(s.world.y + last.delta.y),
            w: s.world.w * v.zoom,
            h: s.world.h * v.zoom,
            radius,
            src: this.ghostSrc.get(id) ?? null,
          })
          const box = layout?.nodes.get(id)?.world
          if (!r.alt && box && this.ghosted.has(id))
            gaps.push({
              x: sx(box.x),
              y: sy(box.y),
              w: box.w * v.zoom,
              h: box.h * v.zoom,
              radius,
            })
        })
      }
    } else if (this.dropFlow) {
      bar = slotBar(this.dropFlow.flow, this.dropFlow.slot)
    }
    const dom: StructureDom | null =
      bar || gaps.length || ghosts.length || draw || hint
        ? {
            bar: bar
              ? bar.axis === "v"
                ? { x: sx(bar.x), y: sy(bar.y), length: bar.length * v.zoom, axis: "v" }
                : { x: sx(bar.x), y: sy(bar.y), length: bar.length * v.zoom, axis: "h" }
              : null,
            gaps,
            ghosts,
            draw,
            hint,
          }
        : null
    const key = dom ? JSON.stringify(dom) : ""
    if (key === this.structureKey) return
    this.structureKey = key
    this.opts.onStructure?.(dom)
  }

  /** The first corner radius of a node (resolved; 0 when none). */
  private radiusOf(id: string): number {
    const n = this.src.getNode(id)
    const raw = n ? this.resolver.value(id, (n as { radius?: unknown }).radius) : 0
    const v = Array.isArray(raw) ? this.resolver.value(id, raw[0]) : raw
    return typeof v === "number" && Number.isFinite(v) ? v : 0
  }

  // --- M2: resize feedback (board 10 #8) ------------------------------------------------------

  /** Flowing children of a single resized auto-layout frame, with its main axis. */
  private flowChildren(
    start: ResizeStart,
  ): { parent: string; ids: string[]; axis: "w" | "h" } | null {
    if (start.items.length !== 1) return null
    const id = (start.items[0] as { id: string }).id
    const n = this.store.getNode(id)
    const lay = n?.layout
    if (!n || typeof lay !== "object" || lay === null) return null
    const ids = this.store
      .children(id)
      .filter((c) => isFlowChild(this.store, c) && this.layoutResult?.nodes.get(c)?.visible)
    if (!ids.length) return null
    return { parent: id, ids, axis: (lay as { dir?: unknown }).dir === "column" ? "h" : "w" }
  }

  /** Snaps the dragged edges of a resize box (off with ⌘, ⇧ aspect or ⌥ center) + pixel grid. */
  private snapResize(
    handle: Handle,
    box: Rect,
    c: Cands,
    e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean },
  ): Rect {
    const start = (this.drag as { snap: ResizeStart }).snap.box
    const { fx, fy } = handleDir(handle)
    // The moving edge is the one that is not the fixed (anchor) edge (handles may flip).
    const ax = fx > 0 ? start.x : start.x + start.w
    const ay = fy > 0 ? start.y : start.y + start.h
    const moveL = fx !== 0 && Math.abs(box.x - ax) > 1e-9
    const moveR = fx !== 0 && !moveL
    const moveT = fy !== 0 && Math.abs(box.y - ay) > 1e-9
    const moveB = fy !== 0 && !moveT
    const r = { ...box }
    if (this.snapEnabled(e) && !e.shiftKey && !e.altKey) {
      const s = snap({
        moving: box,
        edges: { left: moveL, right: moveR, top: moveT, bottom: moveB },
        candidates: c.candidates,
        parent: c.parent,
        zoom: this.ui.getState().viewport.zoom,
      })
      this.setSnapView(s)
      if (moveL) {
        r.x += s.dx
        r.w -= s.dx
      } else if (moveR) r.w += s.dx
      if (moveT) {
        r.y += s.dy
        r.h -= s.dy
      } else if (moveB) r.h += s.dy
    } else this.setSnapView(null)
    if (this.pixelSnap()) {
      if (moveL) {
        const nx = Math.round(r.x)
        r.w += r.x - nx
        r.x = nx
      } else if (moveR) r.w = Math.round(r.x + r.w) - r.x
      if (moveT) {
        const ny = Math.round(r.y)
        r.h += r.y - ny
        r.y = ny
      } else if (moveB) r.h = Math.round(r.y + r.h) - r.y
    }
    r.w = Math.max(1, r.w)
    r.h = Math.max(1, r.h)
    return r
  }

  /** Delta badge (all resizes) + child sizing badges and ghost edge (layout frames). */
  private resizeFeedback(d: Extract<Drag, { kind: "resize" }>, box: Rect, p: Point): void {
    const start = d.snap.box
    const { fx, fy } = handleDir(d.handle)
    const sgn = (v: number) => (v > 0 ? `+${fmtUnits(v)}` : v < 0 ? `-${fmtUnits(-v)}` : "0")
    const dw = box.w - start.w
    const dh = box.h - start.h
    const text = fx && fy ? `${sgn(dw)} × ${sgn(dh)}` : fx ? sgn(dw) : sgn(dh)
    const spec = OVERLAY_SPEC_M2.deltaBadge
    if (fx) {
      const edge = this.toScreen({ x: fx > 0 ? box.x + box.w : box.x, y: 0 }).x
      this.cursorBadge = {
        text,
        screen: { x: edge + spec.edgeOffsetX, y: p.y + spec.pointerOffsetY },
      }
    } else {
      const edge = this.toScreen({ x: 0, y: fy > 0 ? box.y + box.h : box.y }).y
      this.cursorBadge = {
        text,
        screen: { x: p.x + spec.pointerOffsetY, y: edge + spec.edgeOffsetX },
      }
    }
    const flow = d.flow
    const layout = this.layoutResult
    if (!flow || !layout) {
      this.resizeView = null
      return
    }
    const children = flow.ids.map((id) => {
      const l = layout.nodes.get(id)
      const n = this.src.getNode(id)
      const applied =
        l?.sizing?.[flow.axis] ??
        (n
          ? ({ "": "fixed", Hug: "fit", Fill: "fill" } as const)[sizeMode(n as never, flow.axis)]
          : "fixed")
      const size = l ? (flow.axis === "w" ? l.local.w : l.local.h) : 0
      const label =
        applied === "fill"
          ? `Fill ${flow.axis === "w" ? "↔" : "↕"}`
          : applied === "fit"
            ? "Hug"
            : `Fixed ${fmtUnits(size)}`
      return { id, label }
    })
    const ghostEdge = fx
      ? {
          axis: "x" as const,
          at: fx > 0 ? start.x + start.w : start.x,
          from: start.y,
          to: start.y + start.h,
        }
      : {
          axis: "y" as const,
          at: fy > 0 ? start.y + start.h : start.y,
          from: start.x,
          to: start.x + start.w,
        }
    this.resizeView = { children, ghostEdge }
  }

  // --- M2: pen tool (board 10 #5, #7) ------------------------------------------------------------

  private penOverlay(): Overlay["pen"] {
    const pen = this.pen
    if (!pen?.anchors.length) return null
    const n = pen.anchors.length
    const last = pen.anchors[n - 1] as PathAnchorPoint
    const d = this.drag
    // cXWyk shows the handles of every curve anchor, not only the active one.
    const handlesFor: number[] = []
    pen.anchors.forEach((a, i) => {
      if (a.in || a.out) handlesFor.push(i)
    })
    let preview: NonNullable<Overlay["pen"]>["preview"] = null
    if (pen.cursor && d?.kind !== "pen") {
      // The segment the next click writes: cubic from the last anchor's out handle; when
      // closing, into the first anchor's in handle (contourPath's seg(n-1, 0)).
      const first = pen.anchors[0] as PathAnchorPoint
      const c2 = pen.closeHint && first.in ? first.in : pen.cursor
      preview =
        last.out || c2 !== pen.cursor
          ? { from: { x: last.x, y: last.y }, c1: last.out ?? last, c2, to: pen.cursor }
          : { from: { x: last.x, y: last.y }, to: pen.cursor }
    }
    return {
      contour: { anchors: pen.anchors, closed: false },
      stroke: this.penStroke(pen.parent),
      active: n - 1,
      handlesFor,
      preview,
      closeHint: pen.closeHint,
    }
  }

  /** The stroke `finishPen` writes (`createPathOp`: 1px text/default or #000000), resolved. */
  private penStroke(parent: string | null): { color: string; width: number } {
    let color = "#000000"
    if (this.header.variables?.["text/default"] !== undefined) {
      const v = this.resolver.value(parent ?? "", { $ref: "text/default" })
      if (typeof v === "string") color = v
    }
    return { color, width: 1 }
  }

  /** Own anchors as zero-size snap candidates (align new points with earlier ones). */
  private penAnchorBoxes(): SnapBox[] {
    return (this.pen?.anchors ?? []).map((a, i) => ({
      id: `anchor:${i}`,
      rect: { x: a.x, y: a.y, w: 0, h: 0 },
    }))
  }

  private penCands: Cands | null = null

  private nearFirstAnchor(p: Point): boolean {
    const pen = this.pen
    if (!pen || pen.anchors.length < 2) return false
    const a = this.toScreen(pen.anchors[0] as Point)
    return Math.hypot(a.x - p.x, a.y - p.y) <= CLOSE_RADIUS
  }

  /** Pointer position for the next anchor: ⇧ 45° from the last anchor, snapped, pixel grid. */
  private penPoint(p: Point, e: PointerEvent, cands: Cands): Point {
    let w = this.toWorld(p)
    const last = this.pen?.anchors.at(-1)
    if (e.shiftKey && last) return this.pxAnchor(constrain45(last, w))
    w = this.snapPt(w, cands, e, this.penAnchorBoxes(), (q) => this.pxAnchor(q))
    return w
  }

  private penDown(p: Point, e: PointerEvent): void {
    if (this.nearFirstAnchor(p)) {
      this.drag = { kind: "pen", start: p, index: 0, closing: true, dragged: false }
      return
    }
    if (!this.pen) {
      const parent = dropParent(this.store, this.hits(p))
      this.pen = { parent, anchors: [], cursor: null, closeHint: false }
      this.penCands = this.cands(parent, [])
    }
    const pt = this.penPoint(p, e, this.penCands ?? { candidates: [], parent: null })
    const prev = this.pen.anchors.at(-1)
    if (prev && Math.hypot(prev.x - pt.x, prev.y - pt.y) < 1) {
      // A click on the previous anchor adds no point (no zero-length segment); dragging from
      // it still pulls that anchor's handles.
      this.drag = {
        kind: "pen",
        start: p,
        index: this.pen.anchors.length - 1,
        closing: false,
        dragged: false,
      }
      return
    }
    this.pen.anchors.push({ x: pt.x, y: pt.y })
    this.pen.cursor = null
    this.drag = {
      kind: "pen",
      start: p,
      index: this.pen.anchors.length - 1,
      closing: false,
      dragged: false,
    }
    this.updateOverlay()
    this.updateCursor(p)
  }

  /**
   * ⌘Z / ⇧⌘Z while the pen has anchors (Figma): undo removes the last anchor instead of
   * undoing an earlier document edit (the contour is not in the document yet); redo does
   * nothing. Returns false when the pen is not drawing (the shell then undoes normally).
   */
  penUndo(redo: boolean): boolean {
    const pen = this.pen
    if (!pen?.anchors.length) return false
    if (this.drag?.kind === "pen") return true
    if (redo) return true
    pen.anchors.pop()
    pen.closeHint = false
    if (!pen.anchors.length) {
      this.pen = null
      this.penCands = null
    }
    this.updateOverlay()
    return true
  }

  /** Dragging after a click pulls symmetric handles (⌥: only the out handle moves). */
  private penDrag(p: Point, e: PointerEvent, d: Extract<Drag, { kind: "pen" }>): void {
    const pen = this.pen
    if (!pen) return
    if (!d.dragged && Math.hypot(p.x - d.start.x, p.y - d.start.y) < DRAG_THRESHOLD) return
    d.dragged = true
    const a = pen.anchors[d.index]
    if (!a) return
    let h = this.toWorld(p)
    if (e.shiftKey) h = constrain45(a, h)
    h = this.pxAnchor(h)
    const degenerate = Math.hypot(h.x - a.x, h.y - a.y) < 1e-9
    if (degenerate) {
      delete a.out
      if (!e.altKey) delete a.in
    } else {
      a.out = h
      if (!e.altKey) a.in = mirror(a, h)
    }
    pen.closeHint = d.closing
    this.setSnapView(null)
    this.updateOverlay()
  }

  private penUp(d: Extract<Drag, { kind: "pen" }>): void {
    if (d.closing) this.finishPen(true)
  }

  private penHover(p: Point, e: PointerEvent): void {
    const pen = this.pen
    if (!pen) {
      // Before the first anchor: show where it would snap.
      this.penPoint(p, e, this.cands(dropParent(this.store, this.hits(p)), []))
      this.updateOverlay()
      return
    }
    pen.closeHint = this.nearFirstAnchor(p)
    if (pen.closeHint) {
      const f = pen.anchors[0] as PathAnchorPoint
      pen.cursor = { x: f.x, y: f.y }
      this.setSnapView(null)
    } else pen.cursor = this.penPoint(p, e, this.penCands ?? { candidates: [], parent: null })
    this.updateOverlay()
  }

  /**
   * Ends the pen contour: ≥ 2 anchors write ONE `path` node in ONE undo step (ADR 0010 commit
   * rule) and select it; the tool returns to Move.
   */
  finishPen(closed = false): void {
    const pen = this.pen
    this.pen = null
    this.penCands = null
    this.setSnapView(null)
    const layout = this.layoutResult
    if (pen && pen.anchors.length >= 2 && layout) {
      const parent = pen.parent && this.store.hasNode(pen.parent) ? pen.parent : null
      const t = parent ? layout.nodes.get(parent)?.transform : undefined
      const fields = pathGeometry.toNode([{ anchors: pen.anchors, closed }], t ?? IDENTITY)
      // A 0×0 contour (every point on one spot) is invisible and cannot be grabbed: write
      // nothing. A flat line (one side 0) is a valid path.
      if (fields.w === 0 && fields.h === 0) {
        if (this.ui.getState().tool === "path") this.ui.getState().setTool("select")
        this.updateOverlay()
        this.updateCursor()
        return
      }
      const id = generateId()
      const hasTextDefault = this.header.variables?.["text/default"] !== undefined
      if (
        this.apply(
          [createPathOp(this.store, parent, fields, closed, hasTextDefault, id)],
          "Draw path",
        )
      )
        this.ui.getState().select([id])
    }
    if (this.ui.getState().tool === "path") this.ui.getState().setTool("select")
    this.updateOverlay()
    this.updateCursor()
  }

  // --- M2: path edit mode (board 10 #6) ---------------------------------------------------------

  /** Enters path edit mode for a `path` node (double-click, Enter, `CanvasHandle.editPath`). */
  editPath(id: string): void {
    this.flush()
    const n = this.store.getNode(id)
    const l = this.layoutResult?.nodes.get(id)
    if (!n || !l || n.type !== "path" || n.locked === true || typeof n.d !== "string") return
    const contours = this.readContours(id)
    if (!contours?.length) return
    if (this.editing) this.commitText(null)
    const ui = this.ui.getState()
    if (ui.tool !== "select") ui.setTool("select")
    if (ui.selection.length !== 1 || ui.selection[0] !== id) ui.select([id])
    this.pathEdit = {
      id,
      contours,
      selected: [],
      hoveredSegment: null,
      selectedSegment: null,
      mode: "select",
    }
    this.updateOverlay()
    this.updateCursor()
  }

  get editingPath(): string | null {
    return this.pathEdit?.id ?? null
  }

  exitPathEdit(): void {
    if (!this.pathEdit) return
    const d = this.drag
    if (d?.kind === "path-anchor" || d?.kind === "path-handle" || d?.kind === "path-bend") {
      d.gesture.end()
      this.drag = null
    }
    this.pathEdit = null
    this.updateOverlay()
    this.updateCursor()
  }

  private readContours(id: string): PathContour[] | null {
    const n = this.store.getNode(id)
    const l = this.layoutResult?.nodes.get(id)
    if (!n || !l || typeof n.d !== "string") return null
    const vb = Array.isArray(n.viewBox) ? (n.viewBox as number[]) : undefined
    return pathGeometry.fromNode(
      vb
        ? { d: n.d, viewBox: vb, w: l.local.w, h: l.local.h }
        : { d: n.d, w: l.local.w, h: l.local.h },
      l.transform,
    )
  }

  /** Re-reads the edited path after document changes (undo, remote edits); exits if it is gone. */
  private syncPathEdit(force = false): void {
    const pe = this.pathEdit
    if (!pe) return
    const d = this.drag
    if (
      !force &&
      (d?.kind === "path-anchor" || d?.kind === "path-handle" || d?.kind === "path-bend")
    )
      return
    const contours = this.store.getNode(pe.id)?.type === "path" ? this.readContours(pe.id) : null
    if (!contours?.length) {
      this.exitPathEdit()
      return
    }
    pe.contours = contours
    pe.selected = pe.selected.filter((r) => r.index < (contours[r.contour]?.anchors.length ?? 0))
    const seg = pe.selectedSegment
    if (
      seg &&
      !(contours[seg.contour] && seg.index < segmentCount(contours[seg.contour] as PathContour))
    )
      pe.selectedSegment = null
  }

  private pathEditOverlay(): Overlay["pathEdit"] {
    const pe = this.pathEdit
    if (!pe) return null
    let badge: string | null = null
    const first = pe.selected[0]
    const a = first ? pe.contours[first.contour]?.anchors[first.index] : undefined
    if (a && this.layoutResult) {
      const parent = this.store.getNode(pe.id)?.parent
      const l = toLocal(this.layoutResult, typeof parent === "string" ? parent : null, a)
      badge = `${fmtUnits(l.x)}, ${fmtUnits(l.y)}`
    }
    return {
      nodeId: pe.id,
      contours: pe.contours,
      selected: pe.selected,
      hoveredSegment: pe.hoveredSegment,
      selectedSegment: pe.selectedSegment,
      badge,
    }
  }

  /** Nearest anchor within the pick radius (screen px). */
  private anchorAt(p: Point): AnchorRef | null {
    const pe = this.pathEdit
    if (!pe) return null
    let best: AnchorRef | null = null
    let bd = ANCHOR_PICK
    pe.contours.forEach((c, ci) => {
      c.anchors.forEach((a, i) => {
        const s = this.toScreen(a)
        const d = Math.hypot(s.x - p.x, s.y - p.y)
        if (d <= bd) {
          bd = d
          best = { contour: ci, index: i }
        }
      })
    })
    return best
  }

  /** A handle of a selected anchor within the pick radius. */
  private handleOf(p: Point): { ref: AnchorRef; side: "in" | "out" } | null {
    const pe = this.pathEdit
    if (!pe) return null
    for (const ref of pe.selected) {
      const a = pe.contours[ref.contour]?.anchors[ref.index]
      if (!a) continue
      for (const side of ["out", "in"] as const) {
        const h = a[side]
        if (!h) continue
        const s = this.toScreen(h)
        if (Math.hypot(s.x - p.x, s.y - p.y) <= ANCHOR_PICK) return { ref, side }
      }
    }
    return null
  }

  /** Segment under the pointer (screen px), with the curve parameter. */
  private segmentAt(p: Point): { ref: AnchorRef; t: number } | null {
    const pe = this.pathEdit
    if (!pe) return null
    const w = this.toWorld(p)
    const z = this.ui.getState().viewport.zoom
    let best: { ref: AnchorRef; t: number } | null = null
    let bd = SEGMENT_PICK
    pe.contours.forEach((c, ci) => {
      for (let i = 0; i < segmentCount(c); i++) {
        const r = nearestOnCubic(segmentOf(c, i), w)
        const d = r.dist * z
        if (d <= bd && r.t > 0.001 && r.t < 0.999) {
          bd = d
          best = { ref: { contour: ci, index: i }, t: r.t }
        }
      }
    })
    return best
  }

  private pathEditHover(p: Point): void {
    const pe = this.pathEdit
    if (!pe) return
    const seg = this.anchorAt(p) || this.handleOf(p) ? null : (this.segmentAt(p)?.ref ?? null)
    const prev = pe.hoveredSegment
    if (prev?.contour === seg?.contour && prev?.index === seg?.index) return
    pe.hoveredSegment = seg
    this.updateOverlay()
  }

  /** Pointer down in path edit mode. False = the press is outside the path (mode exits). */
  private pathEditDown(p: Point, e: PointerEvent): boolean {
    const pe = this.pathEdit
    if (!pe) return false
    const h = this.handleOf(p)
    if (h) {
      this.drag = {
        kind: "path-handle",
        ref: h.ref,
        side: h.side,
        base: pe.contours,
        gesture: this.gesture("Edit path"),
      }
      return true
    }
    const a = this.anchorAt(p)
    const has = (r: AnchorRef) =>
      pe.selected.some((s) => s.contour === r.contour && s.index === r.index)
    if (a) {
      pe.selectedSegment = null
      let collapse: AnchorRef | null = null
      if (e.shiftKey) {
        pe.selected = has(a)
          ? pe.selected.filter((s) => s.contour !== a.contour || s.index !== a.index)
          : [...pe.selected, a]
      } else if (!has(a)) pe.selected = [a]
      else if (pe.selected.length > 1) collapse = a
      this.drag = {
        kind: "path-anchor",
        startScreen: p,
        startWorld: this.toWorld(p),
        refs: pe.selected,
        base: pe.contours,
        gesture: this.gesture("Edit path"),
        dragged: false,
        collapse,
      }
      this.updateOverlay()
      return true
    }
    const seg = this.segmentAt(p)
    if (seg && pe.mode === "select") {
      // Board 27 §5 (J5Vng): a clicked segment highlights (3 px selection); ⌫ deletes it.
      pe.selected = []
      pe.selectedSegment = seg.ref
      this.updateOverlay()
      return true
    }
    if (seg && pe.mode === "bend") {
      pe.selected = []
      pe.selectedSegment = null
      this.drag = {
        kind: "path-bend",
        ref: seg.ref,
        t: seg.t,
        base: pe.contours,
        gesture: this.gesture("Bend path"),
      }
      this.updateOverlay()
      return true
    }
    if (seg) {
      // Add / pen: a click on a segment adds an anchor there (one undo step with the drag).
      const { contours, anchor } = splitSegment(pe.contours, seg.ref.contour, seg.ref.index, seg.t)
      const gesture = this.gesture("Add anchor")
      if (!this.writePath(contours, gesture)) return true
      pe.contours = contours
      pe.selected = [anchor]
      pe.hoveredSegment = null
      this.drag = {
        kind: "path-anchor",
        startScreen: p,
        startWorld: this.toWorld(p),
        refs: [anchor],
        base: contours,
        gesture,
        dragged: false,
        collapse: null,
      }
      this.updateOverlay()
      return true
    }
    this.exitPathEdit()
    return false
  }

  private pathEditDrag(
    p: Point,
    e: PointerEvent,
    d: Extract<Drag, { kind: "path-anchor" | "path-handle" }>,
  ): void {
    const pe = this.pathEdit
    if (!pe) return
    let contours: PathContour[]
    if (d.kind === "path-anchor") {
      if (!d.dragged && Math.hypot(p.x - d.startScreen.x, p.y - d.startScreen.y) < DRAG_THRESHOLD)
        return
      d.dragged = true
      const z = this.ui.getState().viewport.zoom
      let dx = (p.x - d.startScreen.x) / z
      let dy = (p.y - d.startScreen.y) / z
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0
        else dx = 0
      }
      const lead = d.refs[0]
      const a = lead ? d.base[lead.contour]?.anchors[lead.index] : undefined
      if (a && !e.shiftKey) {
        // Snap the lead anchor to siblings/parent and to the path's other anchors.
        const parent = this.store.getNode(pe.id)?.parent
        const others: SnapBox[] = []
        d.base.forEach((c, ci) => {
          c.anchors.forEach((o, i) => {
            if (!d.refs.some((r) => r.contour === ci && r.index === i))
              others.push({ id: `anchor:${ci}:${i}`, rect: { x: o.x, y: o.y, w: 0, h: 0 } })
          })
        })
        const to = this.snapPt(
          { x: a.x + dx, y: a.y + dy },
          this.cands(typeof parent === "string" ? parent : null, [pe.id]),
          e,
          others,
          (q) => this.pxAnchor(q),
        )
        dx = to.x - a.x
        dy = to.y - a.y
      } else if (a) {
        const to = this.pxAnchor({ x: a.x + dx, y: a.y + dy })
        dx = to.x - a.x
        dy = to.y - a.y
      }
      contours = moveAnchors(d.base, d.refs, { x: dx, y: dy })
    } else {
      const a = d.base[d.ref.contour]?.anchors[d.ref.index]
      if (!a) return
      let h = this.toWorld(p)
      if (e.shiftKey) h = constrain45(a, h)
      h = this.pxAnchor(h)
      // ⌥ breaks the handles' symmetry.
      contours = setHandle(d.base, d.ref, d.side, h, e.altKey)
    }
    if (this.writePath(contours, d.gesture)) pe.contours = contours
    this.updateOverlay()
  }

  /** Writes world contours into the edited node (bounds, `d`, viewBox); rotation is baked. */
  private writePath(contours: readonly PathContour[], gesture?: Gesture): boolean {
    const pe = this.pathEdit
    const layout = this.layoutResult
    if (!pe || !layout) return false
    const n = this.store.getNode(pe.id)
    if (!n) return false
    const parent = typeof n.parent === "string" ? n.parent : null
    const t = parent ? layout.nodes.get(parent)?.transform : undefined
    const f = pathGeometry.toNode(contours, t ?? IDENTITY)
    const set: Record<string, unknown> = {
      x: f.x,
      y: f.y,
      w: f.w,
      h: f.h,
      d: f.d,
      viewBox: f.viewBox,
    }
    if (typeof n.rotation === "number" && n.rotation !== 0) set.rotation = 0
    if (n.flipX === true) set.flipX = false
    if (n.flipY === true) set.flipY = false
    const ops: Op[] = [{ op: "update", id: pe.id, set }]
    return gesture ? gesture.set(ops) : this.apply(ops, "Edit path")
  }

  private deleteSelectedAnchors(): void {
    const pe = this.pathEdit
    if (!pe) return
    const contours = removeAnchors(pe.contours, pe.selected)
    if (!contours.length) {
      const id = pe.id
      this.exitPathEdit()
      if (this.apply([{ op: "delete", id }], "Delete path")) this.ui.getState().clearSelection()
      return
    }
    if (this.writePath(contours)) {
      pe.contours = contours
      pe.selected = []
      this.updateOverlay()
    }
  }

  // --- Board 27 §5: shape slot tools, star handles, path-edit toolbar ---------------------------

  /** Sides for a new polygon / star: the session's remembered counts (rule g7wdz). */
  private toolSides(shape: ShapeKind): number | undefined {
    const t = this.opts.toolStore?.get()
    if (shape === "polygon") return t?.polygonSides
    if (shape === "star") return t?.starPoints
    return undefined
  }

  /** Insert op for a Line / Arrow drag ending at world `end` (null: zero length). */
  private lineOp(d: Extract<Drag, { kind: "line" }>, end: Point): Op | null {
    const layout = this.layoutResult
    if (!layout) return null
    if (Math.hypot(end.x - d.startWorld.x, end.y - d.startWorld.y) < 1e-9) return null
    const parent = d.parent && this.store.hasNode(d.parent) ? d.parent : null
    const t = parent ? layout.nodes.get(parent)?.transform : undefined
    const fields = pathGeometry.toNode(lineContours(d.shape, d.startWorld, end), t ?? IDENTITY)
    const hasTextDefault = this.header.variables?.["text/default"] !== undefined
    return createPathOp(this.store, parent, fields, false, hasTextDefault, d.id, d.name)
  }

  /** The single selected star (a polygon with `star`), with its layout, or null. */
  private selectedStar(): {
    id: string
    w: number
    h: number
    ratio: number
    radius: number
    transform: readonly number[]
  } | null {
    const sel = this.ui.getState().selection
    if (sel.length !== 1 || this.pathEdit || this.editing) return null
    const id = sel[0] as string
    const n = this.src.getNode(id)
    const l = this.layoutResult?.nodes.get(id)
    if (!n || !l || n.type !== "polygon" || this.src.isVirtual(id)) return null
    const star = n.star as { ratio?: unknown } | undefined
    if (!star || typeof star !== "object") return null
    const ratio = typeof star.ratio === "number" ? star.ratio : STAR_RATIO.default
    const rv = this.resolver.value(id, n.radius)
    const radius = typeof rv === "number" && Number.isFinite(rv) ? rv : 0
    return { id, w: l.local.w, h: l.local.h, ratio, radius, transform: l.transform }
  }

  /** World points of the selected star's handles. */
  private starHandleWorld(): { id: string; ratio: Point; radius: Point } | null {
    const s = this.selectedStar()
    if (!s) return null
    const zoom = this.ui.getState().viewport.zoom
    const h = starHandles(s.w, s.h, s.ratio, s.radius, zoom)
    const m = s.transform
    const map = (q: Point): Point => ({
      x: (m[0] as number) * q.x + (m[2] as number) * q.y + (m[4] as number),
      y: (m[1] as number) * q.x + (m[3] as number) * q.y + (m[5] as number),
    })
    return { id: s.id, ratio: map(h.ratio), radius: map(h.radius) }
  }

  /** A star handle under screen point `p` (8 px handles, picked within ANCHOR_PICK). */
  private starHandleAt(p: Point): { id: string; handle: "ratio" | "radius" } | null {
    const w = this.starHandleWorld()
    if (!w) return null
    for (const handle of ["ratio", "radius"] as const) {
      const s = this.toScreen(w[handle])
      if (Math.hypot(s.x - p.x, s.y - p.y) <= ANCHOR_PICK) return { id: w.id, handle }
    }
    return null
  }

  private starHandleDrag(d: Extract<Drag, { kind: "shape-handle" }>, p: Point): void {
    const s = this.selectedStar()
    if (!s || s.id !== d.id) return
    const m = s.transform
    const inv = invert(m as never) as readonly number[]
    const w = this.toWorld(p)
    const local = {
      x: (inv[0] as number) * w.x + (inv[2] as number) * w.y + (inv[4] as number),
      y: (inv[1] as number) * w.x + (inv[3] as number) * w.y + (inv[5] as number),
    }
    const zoom = this.ui.getState().viewport.zoom
    if (d.handle === "ratio") {
      const ratio = ratioFromLocal(s.h, local)
      d.gesture.set([
        {
          op: "update",
          id: d.id,
          set: { star: ratio === STAR_RATIO.default ? {} : { ratio } },
        },
      ])
      this.starPill = `${Math.round(ratio * 100)} %`
    } else {
      const radius = radiusFromLocal(s.h, local, zoom)
      d.gesture.set([
        { op: "update", id: d.id, set: { radius: radius === 0 ? undefined : radius } },
      ])
      this.starPill = String(radius)
    }
    this.updateOverlay()
  }

  /** MeasurePill text while a star handle is dragged. */
  private starPill: string | null = null

  private shapeHandlesOverlay(): Overlay["shapeHandles"] {
    const w = this.starHandleWorld()
    if (!w) return null
    const d = this.drag
    const dragging = d?.kind === "shape-handle" ? d.handle : null
    if (!dragging) this.starPill = null
    return {
      handles: [
        { at: w.ratio, kind: "hollow" },
        { at: w.radius, kind: "filled" },
      ],
      pill: dragging && this.starPill ? { text: this.starPill, at: w[dragging] } : null,
    }
  }

  /** Publishes the path-edit toolbar state (board 27 §5 J5Vng) to the tool store. */
  private publishPathEdit(): void {
    const store = this.opts.toolStore
    if (!store) return
    const pe = this.pathEdit
    const layout = this.layoutResult
    if (!pe || !layout) {
      if (store.get().pathEdit) store.set({ pathEdit: null })
      return
    }
    const b = contoursBounds(pe.contours) ?? layout.nodes.get(pe.id)?.world
    if (!b) return
    const tl = this.toScreen({ x: b.x, y: b.y })
    const z = this.ui.getState().viewport.zoom
    let cue: Point | null = null
    const seg = pe.selectedSegment
    const a = seg ? pe.contours[seg.contour]?.anchors[seg.index] : undefined
    if (a) {
      // NsORT: top-left = the segment's start anchor + (−12, +6) (anchor 380, 90 → cue 368, 96).
      const s = this.toScreen(a)
      cue = { x: s.x - 12, y: s.y + 6 }
    }
    store.set({
      pathEdit: {
        id: pe.id,
        mode: pe.mode,
        anchorKind: selectedAnchorKind(pe.contours, pe.selected),
        canCut: pe.selected.length > 0,
        segmentSelected: pe.selectedSegment !== null,
        box: { x: tl.x, y: tl.y, w: b.w * z, h: b.h * z },
        cue,
      },
    })
  }

  /** Board 27 §5 (J5Vng): a path-edit toolbar button. */
  pathEditCommand(
    c: "select" | "add" | "bend" | "sharp" | "smooth" | "cut" | "deleteSegment" | "done",
  ): void {
    if (!this.pathEdit) return
    this.flush()
    if (c === "select" || c === "add" || c === "bend") this.setPathEditMode(c)
    else if (c === "sharp" || c === "smooth") this.setAnchorKind(c)
    else if (c === "cut") this.cutAtAnchors()
    else if (c === "deleteSegment") this.deleteSelectedSegment()
    else this.exitPathEdit()
    this.el?.focus({ preventScroll: true })
  }

  /** Toolbar: Select anchors · Add / pen · Bend. */
  setPathEditMode(mode: "select" | "add" | "bend"): void {
    const pe = this.pathEdit
    if (!pe || pe.mode === mode) return
    pe.mode = mode
    pe.hoveredSegment = null
    this.updateOverlay()
    this.updateCursor()
  }

  /** Toolbar Sharp / Smooth for the selected anchors (one undo step). */
  setAnchorKind(kind: "sharp" | "smooth"): void {
    const pe = this.pathEdit
    if (!pe?.selected.length) return
    const contours = setAnchorKind(pe.contours, pe.selected, kind)
    if (this.writePath(contours)) pe.contours = contours
    this.updateOverlay()
  }

  /**
   * Scissors (rule g7wdz "Cut"): splits at the selected anchor(s) in ONE undo step; an open
   * path becomes two paths (the new one named "<name> 2"), a closed one opens.
   */
  cutAtAnchors(): void {
    const pe = this.pathEdit
    const layout = this.layoutResult
    if (!pe?.selected.length || !layout) return
    const r = cutAtAnchors(pe.contours, pe.selected)
    if (!r) return
    const n = this.store.getNode(pe.id)
    if (!n) return
    const parent = typeof n.parent === "string" ? n.parent : null
    const t = parent ? layout.nodes.get(parent)?.transform : undefined
    const f = pathGeometry.toNode(r.keep, t ?? IDENTITY)
    const set: Record<string, unknown> = {
      x: f.x,
      y: f.y,
      w: f.w,
      h: f.h,
      d: f.d,
      viewBox: f.viewBox,
    }
    if (typeof n.rotation === "number" && n.rotation !== 0) set.rotation = 0
    if (n.flipX === true) set.flipX = false
    if (n.flipY === true) set.flipY = false
    const ops: Op[] = [{ op: "update", id: pe.id, set }]
    const base = typeof n.name === "string" && n.name ? n.name : "Path"
    const siblings = this.store.children(parent)
    const index = siblings.indexOf(pe.id)
    r.extra.forEach((c, i) => {
      const g = pathGeometry.toNode([c], t ?? IDENTITY)
      const node: Record<string, unknown> = {
        ...n,
        ...g,
        viewBox: g.viewBox,
        name: `${base} ${i + 2}`,
      }
      for (const k of ["id", "parent", "order", "at", "rotation", "flipX", "flipY"]) delete node[k]
      delete node.fill
      if (n.fill !== undefined && c.closed) node.fill = n.fill
      ops.push({
        op: "insert",
        id: generateId(),
        parent,
        ...(index >= 0 ? { index: index + 1 + i } : {}),
        node,
      } as Op)
    })
    if (this.apply(ops, "Cut path")) {
      pe.contours = r.keep
      pe.selected = []
      pe.selectedSegment = null
    }
    this.updateOverlay()
  }

  /** Eraser / ⌫ on a selected segment: removes just that segment (rule g7wdz). */
  deleteSelectedSegment(): void {
    const pe = this.pathEdit
    const seg = pe?.selectedSegment
    if (!pe || !seg) return
    const contours = deleteSegment(pe.contours, seg)
    if (!contours.length) {
      const id = pe.id
      this.exitPathEdit()
      if (this.apply([{ op: "delete", id }], "Delete path")) this.ui.getState().clearSelection()
      return
    }
    if (this.writePath(contours)) {
      pe.contours = contours
      pe.selected = []
      pe.selectedSegment = null
    }
    this.updateOverlay()
  }

  // --- M2: image placement and icons ------------------------------------------------------------

  /** Arms (or cancels with null) an image placement; the toolbar shows Image active meanwhile. */
  armPlacement(placement: ImagePlacement | null): void {
    if (placement === this.armed) return
    this.armed = placement
    if (placement) {
      if (this.pen) this.finishPen()
      this.exitPathEdit()
      const ui = this.ui.getState()
      if (ui.tool !== "select") ui.setTool("select")
      // setTool("select") from another tool cancels placements; re-arm.
      this.armed = placement
    }
    this.opts.toolStore?.set({ placement })
    this.opts.onPlacementChange?.(placement)
    this.updateCursor()
  }

  get placement(): ImagePlacement | null {
    return this.armed
  }

  /** I key: asks the shell for an icon at the pointer (or the canvas center). */
  requestIcon(): void {
    const screen = this.pointer ?? { x: this.size.w / 2, y: this.size.h / 2 }
    const req: IconPickerRequest = {
      screen,
      world: this.toWorld(screen),
      parent: dropParent(this.store, this.hits(screen)),
    }
    this.iconRequest = req
    this.opts.onIconPicker?.(req)
  }

  /** Inserts an icon node (one undo step) and selects it. */
  insertIcon(icon: IconSpec, at?: Point, parent?: string | null): string | null {
    this.flush()
    const layout = this.layoutResult
    if (!layout) return null
    const req = this.iconRequest
    const c = at ?? req?.world ?? this.toWorld({ x: this.size.w / 2, y: this.size.h / 2 })
    const par =
      parent !== undefined
        ? parent
        : at
          ? dropParent(this.store, this.hits(this.toScreen(at)))
          : (req?.parent ?? null)
    const id = generateId()
    const center = this.pxPoint(c)
    if (!this.apply([createIconOp(layout, par, center, icon, id)], "Insert icon")) return null
    this.iconRequest = null
    this.ui.getState().select([id])
    return id
  }

  // --- commands -----------------------------------------------------------------------------

  duplicate(): void {
    this.flush()
    const layout = this.layoutResult
    const sel = this.ui.getState().selection
    if (!layout || !sel.length) return
    const { ops, created } = duplicateOps(this.store, layout, sel)
    if (this.apply(ops, "Duplicate")) this.ui.getState().select(created)
  }

  group(): void {
    this.flush()
    const layout = this.layoutResult
    const sel = this.ui.getState().selection
    if (!layout || !sel.length) return
    const id = generateId()
    const ops = groupOps(this.store, layout, sel, id)
    if (!ops) {
      this.report({ kind: "op", message: "Select layers that share a parent to frame them" })
      return
    }
    if (this.apply(ops, "Frame selection")) this.ui.getState().select([id])
  }

  // --- M6: built-in agent on the canvas (board 22 / 24) ---------------------------------------

  /** Placeholder frames, prompt nodes and the host's agent state (scopes, cursors, runs). */
  readonly agent = new AgentCanvasModel({
    getNode: (id) => this.store.getNode(id) as Record<string, unknown> | undefined,
    children: (p) => this.store.children(p),
    nodeIds: () => this.store.nodeIds(),
  })
  private agentRaf = 0
  /** Board 35: entrance / reflow motion of layers agents add (render only). */
  readonly buildMotion = new BuildMotion(
    { getNode: (id) => this.store.getNode(id) as Record<string, unknown> | undefined },
    () => this.agent.reducedMotion,
  )
  private motionRaf = 0
  /** Scene labels read the live props (no setDocument per prop change). */
  private readonly sceneLabels = {
    promptModel: (m: unknown): string => {
      const f = this.agent.props?.modelLabel
      if (f) return f(m)
      if (typeof m === "string") return m
      return m && typeof m === "object" && typeof (m as { model?: unknown }).model === "string"
        ? ((m as { model: string }).model as string)
        : ""
    },
  }

  /** The host's agent state changed (CanvasHost prop). */
  setAgentCanvas(props: AgentCanvasProps | null): void {
    const prev = this.agent.props
    this.agent.setProps(props)
    // A new model formatter re-labels prompt pills.
    if (prev?.modelLabel !== props?.modelLabel && this.agent.prompts.size)
      this.renderer.invalidate([...this.agent.prompts.keys()])
    this.updateOverlay()
  }

  /**
   * Board 36 cursor glide / rejected flash: one overlay pass per display frame, only while
   * something animates — nothing runs (and no picture is re-recorded) otherwise.
   */
  private scheduleAgentFrame(): void {
    if (this.agentRaf || this.disposed || !this.agent.animating()) return
    this.agentRaf = requestAnimationFrame(() => {
      this.agentRaf = 0
      if (this.disposed) return
      this.updateOverlay()
    })
  }

  /**
   * Board 35: one motion frame per display frame while agent-added layers grow in; the frame
   * after the last one clears the motion (the renderer draws the final state again).
   */
  private scheduleMotionFrame(): void {
    if (this.motionRaf || this.disposed) return
    const tick = () => {
      this.motionRaf = 0
      if (this.disposed) return
      const m = this.buildMotion.frame(this.layoutResult)
      this.renderer.setMotion?.(m)
      this.renderer.renderPending()
      if (m) this.motionRaf = requestAnimationFrame(tick)
    }
    tick()
  }

  /** DOM pieces of the agent surfaces (CanvasHost renders them). */
  agentDom(): AgentDomState {
    const v = this.ui.getState().viewport
    return this.agent.dom(this.layoutResult, v, { w: this.size.w, h: this.size.h })
  }

  /** Inserts a note / prompt and opens its body for typing (one undo step for the insert). */
  insertAgentNode(type: "note" | "prompt", at?: Point): string | null {
    this.flush()
    const chrome = agentNodeChrome(type)
    if (!chrome) return null
    const w = chrome.defaultWidth
    const c = at ?? this.toWorld({ x: this.size.w / 2, y: this.size.h / 2 })
    const x = Math.round(at ? c.x : c.x - w / 2)
    const y = Math.round(at ? c.y : c.y - 40)
    const id = generateId()
    const author = this.opts.author?.()
    const node: Record<string, unknown> = { type, x, y, content: "" }
    if (author) node.author = author
    const ops: Op[] = [{ op: "insert", id, parent: null, node } as unknown as Op]
    if (!this.apply(ops, type === "note" ? "Add note" : "Add prompt")) return null
    this.flush()
    this.ui.getState().select([id])
    this.beginTextEdit(id)
    return id
  }

  setPromptTarget(promptId: string, frameId: string | null): boolean {
    const p = this.store.getNode(promptId)
    if (p?.type !== "prompt") return false
    if (frameId === null)
      return this.apply([{ op: "update", id: promptId, unset: ["target"] }], "Clear prompt target")
    if (this.store.getNode(frameId)?.type !== "frame") return false
    return this.apply(
      [{ op: "update", id: promptId, set: { target: frameId } }],
      "Set prompt target",
    )
  }

  /** "Convert to prompt" (ADR 0014 §9): a replace keeping id, parent, order, position and body. */
  convertNoteToPrompt(noteId: string): boolean {
    const n = this.store.getNode(noteId)
    if (n?.type !== "note") return false
    const { type: _type, parent, order, at, ...body } = n as Record<string, unknown>
    void _type
    const place: Record<string, unknown> = { parent: parent ?? null, order }
    if (typeof at === "string") place.at = at
    return this.apply(
      [
        { op: "delete", id: noteId },
        { op: "insert", id: noteId, ...place, node: { ...body, type: "prompt" } } as unknown as Op,
      ],
      "Convert to prompt",
    )
  }

  clearPlaceholder(frameId: string): boolean {
    const n = this.store.getNode(frameId)
    if (!n || n.placeholder === undefined) return false
    return this.apply([{ op: "update", id: frameId, unset: ["placeholder"] }], "Clear flag")
  }

  // --- text editing -------------------------------------------------------------------------

  /** Opens the text overlay for node `id`, or for a new text node at world point `at`. */
  beginTextEdit(id: string | null, at?: Point, parent: string | null = null): void {
    this.flush()
    if (this.editing) this.commitText(null)
    let state: TextEditState
    if (id) {
      const n = this.src.getNode(id) as LayoutNodeData | undefined
      const l = this.layoutResult?.nodes.get(id)
      if (!n || !l || !isTextual(n.type) || n.locked === true) return
      // Board 27 §7 (uu8Qa): bound content asks "Detach <variable>?" before editing.
      if (n.type === "text" && isRef(n.content) && this.opts.confirmBoundText) {
        const ref = n.content.$ref
        const value = this.resolver.value(id, n.content)
        void this.opts.confirmBoundText(id, ref).then((ok) => {
          if (!ok || typeof value !== "string") return
          const cur = this.store.getNode(id)
          if (!cur || !isRef(cur.content) || cur.content.$ref !== ref) return
          if (this.apply([{ op: "update", id, set: { content: value } }], "Detach text"))
            this.beginTextEdit(id)
        })
        return
      }
      const input = resolveText(id, n, this.resolver)
      const fill = this.resolver.value(id, n.fill)
      // M6: a note / prompt edits its body box (board 22 afq5v `utO8L`, poE5B `ITEfa`).
      const card = n.type === "note" || n.type === "prompt" ? n.type : null
      const body = card ? agentNodeBodyBox(card, l.local.w, l.local.h) : null
      const color =
        card === "note"
          ? "var(--kimo-note-text, #3D3205)"
          : card === "prompt"
            ? "var(--kimo-text-primary, #0A0A0A)"
            : (cssColor(fill) ?? "#000000")
      const runs = runsOf(n, input.runs.map((r) => r.text).join(""))
      const session = new RichTextSession(id, n, runs, !card)
      // ADR 0016 item 17: a text layer of the document is edited live (typing reaches others
      // as it happens and merges with theirs). Text the router rewrites (instance content) and
      // note / prompt bodies keep the commit when editing ends.
      if (!card && this.liveTextFor(id)) {
        const link = createLiveText(this.store, id, this.opts.origin, "Edit text")
        if (link) session.attach(link)
      }
      state = {
        id,
        at: body
          ? { x: l.world.x + body.x, y: l.world.y + body.y }
          : { x: l.world.x, y: l.world.y },
        box: body
          ? { x: l.world.x + body.x, y: l.world.y + body.y, w: body.w, h: body.h }
          : l.world,
        value: input.runs.map((r) => r.text).join(""),
        style: input.style,
        color,
        parent: typeof n.parent === "string" ? n.parent : null,
        session,
        geometry: this.editGeometry(n, input.style, body, l.world),
        css: this.runCssFor(id, n, card ? color : null),
      }
      if (card) {
        state.kind = card
        state.geometry.kind = card
      }
      this.editingNode = { id, data: { ...n, content: "" } }
      this.renderer.invalidate([id])
      this.ui.getState().select([id])
    } else {
      if (!at) return
      const node = { type: "text", style: { ...NEW_TEXT_STYLE } } as unknown as LayoutNodeData
      const style = {
        ...TEXT_STYLE_DEFAULTS,
        fontFamily: NEW_TEXT_STYLE.font,
        fontSize: NEW_TEXT_STYLE.size,
      }
      const session = new RichTextSession(null, node, runsOf(node, ""), true)
      state = {
        id: null,
        at,
        box: null,
        value: "",
        style,
        color: "",
        parent,
        session,
        geometry: { at, box: null, grow: "auto", valign: "top", align: style.align },
        css: this.runCssFor(null, node, null),
      }
      this.ui.getState().clearSelection()
    }
    publishTextSession(this.ui, state.session)
    this.editing = state
    this.updateOverlay()
    this.opts.onTextEdit?.(state)
  }

  /** True when text node `id` is edited live: a real node the router passes through as is. */
  private liveTextFor(id: string): boolean {
    const n = this.store.getNode(id)
    if (n?.type !== "text") return false
    const probe: Op[] = [{ op: "update", id, set: { content: n.content } } as Op]
    const routed = this.opts.route ? this.opts.route(probe) : probe
    const op = routed?.[0] as { op?: string; id?: string } | undefined
    return routed?.length === 1 && op?.op === "update" && op.id === id
  }

  /** Commits the overlay text (`value` null = keep the overlay's last reported value). */
  commitText(value: string | null): void {
    const s = this.editing
    if (!s) return
    const legacy = value ?? this.lastText
    if (s.id && s.session.live) {
      // Live: the text is in the document already; the edit closes as one undo step, with the
      // deletion of an emptied text in it (⌘Z restores the text in one step).
      s.session.flush()
      this.closeText(false)
      const what = s.kind ?? "text"
      const text = legacy ?? s.session.text
      if (!text.trim()) this.apply([{ op: "delete", id: s.id }], `Delete ${what}`)
      else if (legacy !== null && legacy !== s.session.text)
        this.apply([{ op: "update", id: s.id, set: { content: legacy } }], `Edit ${what}`)
      s.session.dispose()
      return
    }
    this.closeText()
    const layout = this.layoutResult
    const what = s.kind ?? "text"
    if (s.id) {
      const cur = this.src.getNode(s.id) as LayoutNodeData | undefined
      if (!cur) return
      if (legacy !== null) {
        // A plain value from a caller (tests, legacy overlay): replaces the text as typed.
        if (!legacy.trim()) this.apply([{ op: "delete", id: s.id }], `Delete ${what}`)
        else if (legacy !== s.value)
          this.apply([{ op: "update", id: s.id, set: { content: legacy } }], `Edit ${what}`)
        return
      }
      if (!s.session.text.trim()) {
        this.apply([{ op: "delete", id: s.id }], `Delete ${what}`)
        return
      }
      if (!s.session.rich) {
        if (s.session.text !== s.value)
          this.apply([{ op: "update", id: s.id, set: { content: s.session.text } }], `Edit ${what}`)
        return
      }
      const p = s.session.result(cur)
      const set: Record<string, unknown> = {}
      const unset: string[] = []
      if (!jsonEqual(p.content as never, cur.content as never)) set.content = p.content
      if (!jsonEqual((p.style ?? null) as never, (cur.style ?? null) as never)) {
        if (p.style) set.style = p.style
        else unset.push("style")
      }
      if (!jsonEqual((p.fill ?? null) as never, (cur.fill ?? null) as never)) {
        if (p.fill !== undefined) set.fill = p.fill
        else unset.push("fill")
      }
      if (!Object.keys(set).length && !unset.length) return
      const op = {
        op: "update",
        id: s.id,
        ...(Object.keys(set).length ? { set } : {}),
        ...(unset.length ? { unset } : {}),
      } as Op
      this.apply([...this.runsFeatureOps(p.runs), op], `Edit ${what}`)
    } else {
      const text = legacy ?? s.session.text
      if (text.trim() && layout) {
        const id = generateId()
        const op = createTextOp(this.store, layout, s.parent, s.at, text, id)
        const extra: Op[] = []
        if (legacy === null) {
          const p = s.session.result()
          const node = (op as unknown as { node: Record<string, unknown> }).node
          node.content = p.content
          if (p.style) node.style = p.style
          else delete node.style
          if (p.fill !== undefined) node.fill = p.fill
          extra.push(...this.runsFeatureOps(p.runs))
        }
        const tf = this.textFlow
        this.textFlow = null
        const ops = tf && tf.parent === s.parent ? this.flowOps([op], tf, false) : [op]
        if (this.apply([...extra, ...ops], "Add text")) this.ui.getState().select([id])
      }
      // A new text (typed or abandoned) ends the text tool, unless another tool was picked.
      if (this.ui.getState().tool === "text") this.ui.getState().setTool("select")
    }
  }

  /**
   * Board 30: the edited node changed underneath the overlay (Resizing, align, a remote edit):
   * re-publish its box and paragraph style; the typed runs stay the overlay's.
   */
  private refreshTextEdit(): void {
    const e = this.editing
    if (!e?.id) return
    const n = this.src.getNode(e.id) as LayoutNodeData | undefined
    const l = this.layoutResult?.nodes.get(e.id)
    if (!n || !l || e.kind) return
    const style = resolveText(e.id, n, this.resolver).style
    const geometry = this.editGeometry(n, style, null, l.world)
    if (jsonEqual(geometry as never, e.geometry as never)) return
    this.editingNode = { id: e.id, data: { ...n, content: "" } }
    this.editing = { ...e, geometry, at: geometry.at, box: geometry.box, style }
    this.opts.onTextEdit?.(this.editing)
  }

  /** Spec §13: span content and its feature go in the same edit. */
  private runsFeatureOps(runs: boolean): Op[] {
    if (!runs) return []
    const have = (this.store.toHeader().features ?? []) as readonly string[]
    if (have.includes("text/runs")) return []
    return [{ op: "setHeader", set: { features: [...have, "text/runs"].sort() } } as Op]
  }

  /** Board 30: the overlay's layout for a text node (growth, alignment, the laid-out box). */
  private editGeometry(
    n: LayoutNodeData,
    style: ResolvedTextStyle,
    body: Rect | null,
    world: Rect,
  ): RichEditGeometry {
    const grow = n.grow === "fixed-width" || n.grow === "fixed" ? n.grow : "auto"
    return {
      at: body ? { x: world.x + body.x, y: world.y + body.y } : { x: world.x, y: world.y },
      box: body ? { x: world.x + body.x, y: world.y + body.y, w: body.w, h: body.h } : world,
      grow,
      valign: style.valign,
      align: style.align,
    }
  }

  /** Board 30: CSS of a run (its attributes over the node, resolved like the renderer). */
  private runCssFor(
    id: string | null,
    node: LayoutNodeData,
    fixedColor: string | null,
  ): (attrs: Attrs) => RunCss {
    const key = id ?? "__new_text__"
    const base = agentNodeChrome(node.type)?.text ?? TEXT_STYLE_DEFAULTS
    const deep = (v: unknown): unknown => {
      if (isRef(v)) return this.resolver.value(key, v)
      if (Array.isArray(v)) return v.map(deep)
      if (typeof v === "object" && v !== null) {
        const o = v as Record<string, unknown>
        const out: Record<string, unknown> = { ...o }
        if (o.color !== undefined) out.color = deep(o.color)
        if (Array.isArray(o.stops)) out.stops = o.stops.map(deep)
        return out
      }
      return v
    }
    return (attrs) => {
      const v = virtualNode(node, attrs)
      const style = resolveTextStyle(key, v.style, this.resolver, base)
      const fill =
        attrs.fill !== undefined
          ? attrs.fill
          : defaultTextFill({ ...(this.header as object), nodes: {} } as never)
      return runCss(style, fixedColor ?? cssColor(deep(fill)) ?? "#000000")
    }
  }

  private lastText: string | null = null
  /** The overlay reports its value as the user types (used when focus leaves by a click). */
  setDraftText(value: string): void {
    this.lastText = value
  }

  cancelText(): void {
    if (!this.editing) return
    this.closeText()
  }

  /** Closes the overlay; `end` also ends a live edit (cancel, a node removed underneath). */
  private closeText(end = true): void {
    const id = this.editingNode?.id
    if (end) this.editing?.session.dispose()
    publishTextSession(this.ui, null)
    this.editing = null
    this.editingNode = null
    this.lastText = null
    if (id) this.renderer.invalidate([id])
    this.opts.onTextEdit?.(null)
    this.updateOverlay()
    this.el?.focus({ preventScroll: true })
  }

  // --- export -------------------------------------------------------------------------------

  async exportPng(nodeId: string, scale = 1): Promise<Uint8Array> {
    this.flush()
    return this.renderer.exportRaster(nodeId, { scale })
  }
}

/** A read-only record over a node getter (the component helpers read `doc.nodes[id]`). */
function lookupRecord(get: (id: string) => unknown): Record<string, unknown> {
  return new Proxy(
    {},
    {
      get: (_t, k) => (typeof k === "string" ? get(k) : undefined),
      has: (_t, k) => typeof k === "string" && get(k) !== undefined,
      getOwnPropertyDescriptor: (_t, k) => {
        const v = typeof k === "string" ? get(k) : undefined
        return v === undefined
          ? undefined
          : { value: v, enumerable: true, configurable: true, writable: false }
      },
    },
  )
}
