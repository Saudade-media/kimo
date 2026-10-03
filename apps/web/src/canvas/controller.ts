/**
 * The canvas pipeline and input controller behind `<CanvasHost>` (framework-agnostic DOM code).
 *
 * Pipeline: `DocStore.onChange` → dirty ids (coalesced per animation frame) →
 * `LayoutEngine.update` → `Renderer.invalidate + setLayout` → overlay → `requestFrame`.
 * Input: pointer gestures for the active tool (select / move / resize / marquee / draw / text),
 * pan (space-drag, middle mouse, wheel), zoom (⌘/ctrl-wheel, pinch, keys) and canvas commands.
 * Every document edit goes through `store.apply` with the host origin; one gesture = one undo step.
 */
import { declaredProps, isLocated, type Libraries, locate, splitQualified } from "@kimo/core-schema"
import type { DocStore, LocalOrigin, NodeData, Op, Tool, UiState } from "@kimo/editor-state"
import { generateId } from "@kimo/editor-state"
import {
  createInstanceView,
  createResolver,
  type InstanceView,
  type LayoutEngine,
  type LayoutInput,
  type LayoutNodeData,
  type LayoutResult,
  type NodeSource,
  type Rect,
  type ResolvedTextStyle,
  type ResolveHeader,
  type Resolver,
  resolveText,
  TEXT_STYLE_DEFAULTS,
} from "@kimo/layout"
import {
  type AnchorRef,
  type AssetSource,
  type ComponentOutline,
  type CursorBadge,
  type InstanceDropOverlay,
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
import { manifestOps } from "../lib/asset-manifest"
import {
  canMove,
  createIconOp,
  createImageFrameOp,
  createPathOp,
  createShapeOp,
  createTextOp,
  type DocReader,
  deleteOps,
  dropParent,
  duplicateOps,
  groupOps,
  isFlowChild,
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
  toLocal,
  topLevel,
} from "./commands"
import type {
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
import { type Gesture, startGesture } from "./gesture"
import {
  clampZoom,
  containsRect,
  fitViewport,
  HANDLE_CURSOR,
  type Handle,
  handleAt,
  handleDir,
  IDENTITY,
  rectFromPoints,
  resizeBox,
  sizeLabel,
  sizeMode,
  unionRects,
  wheelZoomFactor,
} from "./math"
import { measure } from "./measure"
import {
  constrain45,
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
import { enterTarget, pickTarget } from "./selection"
import { candidatesIn, fmtUnits, snap, snapPoint } from "./snapping"
import type { CanvasToolStore } from "./tool-state"

/** Pointer travel (screen px) before a press becomes a drag. */
const DRAG_THRESHOLD = 3
/** Default size of a shape created by a click (no drag). */
const CLICK_SIZE = 100
/** Hit slop (screen px) for thin shapes and text. */
const HIT_TOLERANCE = 2
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

const NO_SNAP: { snap: SnapOverlay; spacing: readonly SpacingIndicator[] } | null = null

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
}

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
  onHint?: (hint: CanvasHint | null) => void
  /** Pixel grid visibility/zoom changed (host shows the zoom badge). */
  onPixelGrid?: (visible: boolean) => void
  onPlacementChange?: (placement: ImagePlacement | null) => void
  onIconPicker?: (request: IconPickerRequest) => void
  /** Image tool without a placement yet: the host opens the file picker. */
  onPickImage?: () => void
  toolStore?: CanvasToolStore
  // --- M3 ---
  /** Loaded libraries by alias (read on every view rebuild; see {@link CanvasController.setLibraries}). */
  libraries?: () => Libraries
  /**
   * Rewrites an op group before it is applied (edits on composite instance ids become
   * overrides; the shell's `session.route`). Null refuses the edit (the router reports why).
   */
  route?: (ops: readonly Op[]) => readonly Op[] | null
  /** The overlay (selection, hover, layout) was recomputed: the host re-reads its DOM overlays. */
  onOverlayChange?: () => void
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

const isShapeTool = (t: Tool): t is "frame" | "rect" | "ellipse" =>
  t === "frame" || t === "rect" || t === "ellipse"

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

  private el: HTMLElement | null = null
  private size = { w: 0, h: 0, dpr: 1 }
  private drag: Drag | null = null
  private spaceHeld = false
  private editing: TextEditState | null = null
  private editingNode: { id: string; data: LayoutNodeData } | null = null
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
      getNode: (id) => (this.editingNode?.id === id ? this.editingNode.data : this.src.getNode(id)),
      children: (parent, at) => this.src.children(parent, at),
    }
  }

  private makeView(): InstanceView {
    return createInstanceView(this.store, {
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
    })
    this.computeFull()
    r.setViewport(this.ui.getState().viewport)
    this.measure()
    r.attach(canvas, { dpr: this.size.dpr })
    r.resize(this.size.w, this.size.h, this.size.dpr)
    this.updateOverlay()
    r.render()

    this.cleanups.push(
      this.store.onChange((c) => {
        for (const id of c.nodes) this.dirty.add(id)
        if (c.header || c.cause === "load") this.dirtyHeader = true
        this.schedule()
      }),
      this.ui.subscribe((s, prev) => this.onUi(s, prev)),
      r.fonts.onFontLoaded(() => {
        this.fullPending = true
        this.schedule()
      }),
    )
    this.bindDom(el)
    if (this.opts.onStats) {
      const t = setInterval(() => this.opts.onStats?.(r.stats()), 250)
      this.cleanups.push(() => clearInterval(t))
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.raf) cancelAnimationFrame(this.raf)
    for (const c of this.cleanups.splice(0)) c()
    this.renderer.dispose()
    this.engine.dispose()
  }

  get layout(): LayoutResult | null {
    return this.layoutResult
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
    this.src.invalidate()
    this.resolver.invalidate()
    try {
      this.layoutResult = this.engine.compute(this.input())
    } catch (e) {
      this.report({ kind: "layout", error: e instanceof Error ? e : new Error(String(e)) })
      return
    }
    this.renderer.invalidate()
    this.renderer.setLayout(this.layoutResult)
    this.opts.onLayout?.(this.layoutResult)
  }

  private relayout(): void {
    const ids = [...this.dirty]
    const header = this.dirtyHeader
    const full = this.fullPending || !this.layoutResult
    this.dirty.clear()
    this.dirtyHeader = false
    this.fullPending = false
    if (header) this.header = this.readHeader()
    if (full || header) {
      this.computeFull()
    } else {
      // The engine re-expands only the instances the edit affects (its dependency index).
      this.resolver.invalidate()
      try {
        this.layoutResult = this.engine.update(this.input(), { nodes: ids })
      } catch {
        this.computeFull()
        this.updateOverlay()
        return
      }
      this.renderer.invalidate(ids)
      this.renderer.setLayout(this.layoutResult)
      this.opts.onLayout?.(this.layoutResult)
    }
    if (this.editing?.id && !this.src.getNode(this.editing.id)) this.cancelText()
    this.syncPathEdit()
    this.updateOverlay()
  }

  private onUi(s: UiState, prev: UiState): void {
    if (s.viewport !== prev.viewport) {
      this.renderer.setViewport(s.viewport)
      this.updateGrid()
      // Screen-anchored hints (close path) follow pans and zooms.
      if (this.pen?.closeHint) this.updateOverlay()
    }
    if (s.selection !== prev.selection) {
      const pe = this.pathEdit
      if (pe && (s.selection.length !== 1 || s.selection[0] !== pe.id)) this.exitPathEdit()
    }
    if (s.selection !== prev.selection || s.hovered !== prev.hovered) this.updateOverlay()
    if (s.tool !== prev.tool) {
      if (this.editing && s.tool !== "text") this.commitText(null)
      if (prev.tool === "path" && this.pen) this.finishPen()
      if (s.tool !== "select") {
        this.exitPathEdit()
        if (this.armed) this.armPlacement(null)
      }
      this.updateOverlay()
      this.updateCursor()
    }
  }

  private updateOverlay(): void {
    const { selection, hovered } = this.ui.getState()
    const layout = this.layoutResult
    const sel = selection.filter((id) => layout?.nodes.has(id))
    const d = this.drag
    const busy =
      d?.kind === "move" ||
      d?.kind === "resize" ||
      d?.kind === "draw" ||
      d?.kind === "pan" ||
      d?.kind === "place" ||
      d?.kind === "path-anchor" ||
      d?.kind === "path-handle"
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
    const overlay: Overlay = {
      selection: this.editing || this.pen ? [] : sel,
      hovered:
        hovered && !selection.includes(hovered) && !busy && !this.editing && !m && !this.pathEdit
          ? hovered
          : null,
      marquee: this.marquee,
      sizeLabel: label,
      // O68JG1 keeps the corner handles while the card is dragged.
      handles: !busy || moving,
      snap: this.snapView?.snap ?? null,
      spacing: this.snapView?.spacing ?? [],
      measurements: m?.measurements ?? [],
      measureOutlines: m?.outline ? [m.outline] : [],
      pixelGrid: this.pixelGridEnabled() ? this.grid.alpha : false,
      pen: this.penOverlay(),
      pathEdit: this.pathEditOverlay(),
      resize: this.resizeView,
      cursorBadge: this.cursorBadge ?? (!busy && this.gridVisible() ? this.pixelBadge : null),
    }
    // M3 (boards 02c / 11 / 12 / 13): violet identity for mains and instances.
    const comp = this.componentOverlay(overlay.selection, overlay.hovered)
    overlay.selectionTone = comp.tone
    overlay.componentOutlines = comp.outlines
    overlay.instanceDrop = this.dropPreview
    this.renderer.setOverlay(overlay)
    this.updateHint(m !== null)
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
        const pad = this.resolver.value(slotId, lay.pad)
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
    if (pen?.closeHint && pen.anchors[0]) {
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

  /** Pixel grid visible (board 10 #4: above 400%) → edits snap to whole pixels. */
  gridVisible(): boolean {
    return (
      this.pixelGridEnabled() &&
      this.ui.getState().viewport.zoom > OVERLAY_SPEC_M2.pixelGrid.minZoom
    )
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

  /** Rounds a world coordinate to the pixel grid while it is visible. */
  private px(v: number): number {
    return this.gridVisible() ? Math.round(v) : v
  }

  private pxPoint(p: Point): Point {
    return { x: this.px(p.x), y: this.px(p.y) }
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
  ): Point {
    if (!this.snapEnabled(e)) {
      this.setSnapView(null)
      return this.pxPoint(p)
    }
    const r = snapPoint(
      p,
      extra.length ? [...c.candidates, ...extra] : c.candidates,
      c.parent,
      this.ui.getState().viewport.zoom,
    )
    this.setSnapView(r)
    return this.pxPoint({ x: p.x + r.dx, y: p.y + r.dy })
  }

  private report(error: CanvasError): void {
    if (this.opts.onError) this.opts.onError(error)
    else console.warn("Kimo canvas:", error)
  }

  /** Applies one op group as one undo step. */
  apply(ops: readonly Op[], label: string): boolean {
    if (!ops.length) return false
    const routed = this.opts.route ? this.opts.route(ops) : ops
    if (!routed) return false
    if (!routed.length) return true
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
    const route = this.opts.route
    if (!route) return g
    // Gesture steps on instance content go through the M3 router too (overrides, not ops).
    return {
      get applied() {
        return g.applied
      },
      get done() {
        return g.done
      },
      set: (ops, stepLabel) => {
        const routed = route(ops)
        return routed ? g.set(routed, stepLabel) : false
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

  private hits(p: Point): string[] {
    const out: string[] = []
    for (const id of this.renderer.hitTest(p, { tolerance: HIT_TOLERANCE })) {
      const r = this.real(id)
      if (!out.includes(r)) out.push(r)
    }
    return out
  }

  /** View ids under `p` (composite ids inside instances), top-most first. */
  private viewHits(p: Point): string[] {
    const out: string[] = []
    for (const id of this.renderer.hitTest(p, { tolerance: HIT_TOLERANCE }))
      if (!out.includes(id)) out.push(id)
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
    if (d?.kind === "move") return d.allowed ? "default" : "not-allowed"
    const tool = this.ui.getState().tool
    if (this.spaceHeld || tool === "hand") return "grab"
    if (isShapeTool(tool) || this.armed) return "crosshair"
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
    on(el, "dblclick", (e) => this.onDoubleClick(e))
    on(el, "wheel", (e) => this.onWheel(e), { passive: false })
    on(el, "contextmenu", (e) => {
      if (this.isOverlayTarget(e.target)) return
      e.preventDefault()
      const p = this.local(e)
      this.opts.onContextMenu?.({ screen: p, world: this.toWorld(p), hit: this.hits(p)[0] ?? null })
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
    return t instanceof HTMLElement && !!t.closest("[data-canvas-overlay]")
  }

  private artboardOf(t: EventTarget | null): string | null {
    if (!(t instanceof HTMLElement)) return null
    const el = t.closest<HTMLElement>("[data-artboard]")
    return el?.dataset.artboard ?? null
  }

  private onDown(e: PointerEvent): void {
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
      else this.beginTextEdit(null, this.toWorld(p), dropParent(this.store, hit))
      return
    }
    if (ui.tool !== "select") return

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
    if (!deepest) {
      if (!e.shiftKey) ui.clearSelection()
      this.drag = {
        kind: "press",
        start: p,
        startWorld: this.toWorld(p),
        target: null,
        before: e.shiftKey ? before : [],
        scope: null,
        collapse: false,
        toggle: false,
      }
      return
    }
    const target = artboard ?? this.pick(deepest, before, e.metaKey || e.ctrlKey)
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
    if (e.shiftKey) {
      if (before.includes(target)) toggle = true
      else ui.toggleSelection(target)
    } else if (!before.includes(target)) ui.select([target])
    else collapse = before.length > 1
    this.drag = {
      kind: "press",
      start: p,
      startWorld: this.toWorld(p),
      target,
      before: e.shiftKey ? before : [],
      scope,
      collapse,
      toggle,
    }
  }

  private onMove(e: PointerEvent): void {
    const p = this.local(e)
    this.pointer = p
    if (e.altKey !== this.altHeld && !this.drag) this.setAlt(e.altKey)
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
        d.gesture.set(moveOps(this.store, layout, d.items, { x: dx, y: dy }))
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
          for (const root of this.store.children(null)) {
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
          createShapeOp(this.store, layout, d.shape, d.parent, r, d.id, d.name),
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
    this.drag = null
    this.clearGestureFeedback()
    switch (final.kind) {
      case "press":
        if (final.target && final.toggle) ui.toggleSelection(final.target)
        else if (final.target && final.collapse) ui.select([final.target])
        break
      case "move":
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
            ),
          ])
        }
        final.gesture.end()
        if (final.gesture.applied) ui.select([final.id])
        ui.setTool("select")
        break
      }
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
      k === "path-handle"
    )
  }

  /** Snap guides, resize badges and the delta badge end with the gesture. */
  private clearGestureFeedback(): void {
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
      d.kind === "path-handle"
    )
      d.gesture.cancel()
    if (d.kind === "path-anchor" || d.kind === "path-handle") this.syncPathEdit(true)
    if (d.kind === "marquee") {
      this.marquee = null
      this.ui.getState().select(d.before)
    }
    this.updateOverlay()
    this.updateCursor()
    return true
  }

  private onDoubleClick(e: MouseEvent): void {
    if (this.isOverlayTarget(e.target) || this.ui.getState().tool !== "select") return
    if (this.pathEdit || this.armed) return
    const p = this.local(e)
    const hits = this.viewHits(p)
    const hit = hits[0]
    if (!hit) return
    const ui = this.ui.getState()
    const sel = ui.selection.length === 1 ? ui.selection[0] : undefined
    const selType = sel ? this.src.getNode(sel)?.type : undefined
    if (sel && (selType === "text" || selType === "path") && hits.includes(sel)) {
      if (selType === "text") this.beginTextEdit(sel)
      else if (!this.src.isVirtual(sel)) this.editPath(sel)
      return
    }
    // Board 11: double-click enters an instance one level at a time (composite ids), like groups.
    const next = enterTarget(this.vdoc, hit, sel)
    ui.select([next])
    const t = next === hit ? this.src.getNode(hit)?.type : undefined
    if (t === "text") this.beginTextEdit(hit)
    // Board 10 #6: double-click a vector to edit it (not inside an instance: detach first).
    else if (t === "path" && !this.src.isVirtual(hit)) this.editPath(hit)
  }

  private onWheel(e: WheelEvent): void {
    if (this.isOverlayTarget(e.target)) return
    e.preventDefault()
    const ui = this.ui.getState()
    const p = this.local(e)
    if (e.ctrlKey || e.metaKey) {
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
    if (e.code === "Space" && !mod) {
      if (!this.spaceHeld) {
        this.spaceHeld = true
        this.updateCursor()
      }
      e.preventDefault()
      return true
    }
    if (e.key === "Escape" && this.cancelDrag()) {
      e.preventDefault()
      return true
    }
    // Mid-gesture, commands would interleave undo entries with the gesture's steps: swallow
    // them (Escape cancels the gesture; modifiers still reach the pointer events).
    if (this.isGesturing()) {
      e.preventDefault()
      return true
    }
    const run = (fn: () => unknown): true => {
      e.preventDefault()
      this.flush()
      fn()
      return true
    }
    const key = e.key.toLowerCase()
    // --- M2 modes: pen, image placement, path edit, icon insertion.
    if (ui.tool === "path" && !mod) {
      if (key === "enter" || key === "escape") {
        return run(() => {
          if (this.pen?.anchors.length) this.finishPen()
          else ui.setTool("select")
        })
      }
      if ((key === "backspace" || key === "delete") && this.pen?.anchors.length) {
        return run(() => this.penUndo(false))
      }
    }
    if (this.armed && key === "escape") return run(() => this.armPlacement(null))
    if (this.pathEdit && !mod) {
      if (key === "enter" || key === "escape") return run(() => this.exitPathEdit())
      if ((key === "backspace" || key === "delete") && this.pathEdit.selected.length)
        return run(() => this.deleteSelectedAnchors())
    }
    if (key === "i" && !mod && !e.altKey && !e.shiftKey && this.opts.onIconPicker) {
      return run(() => this.requestIcon())
    }
    if (mod && !e.shiftKey && !e.altKey && key === "d") return run(() => this.duplicate())
    if (mod && !e.shiftKey && !e.altKey && key === "g") return run(() => this.group())
    if (mod && (key === "=" || key === "+")) return run(() => this.zoomTo(ui.viewport.zoom * 2))
    if (mod && key === "-") return run(() => this.zoomTo(ui.viewport.zoom / 2))
    if (mod || e.altKey) return false
    if (e.shiftKey && e.code === "Digit1") return run(() => this.zoomToFit())
    if (e.shiftKey && e.code === "Digit2")
      return run(() => this.zoomToFit(this.ui.getState().selection))
    if (e.shiftKey && e.code === "Digit0") return run(() => this.zoomTo(1))
    if (key === "=" || key === "+") return run(() => this.zoomTo(ui.viewport.zoom * 2))
    if (key === "-" || key === "_") return run(() => this.zoomTo(ui.viewport.zoom / 2))
    if (key === "delete" || key === "backspace") {
      if (!ui.selection.length) return false
      // Composite ids delete through the router (hidden instead, board 15).
      return run(() => this.apply(deleteOps(this.vdoc, ui.selection), "Delete"))
    }
    if (key === "enter" && ui.selection.length === 1) {
      const id = ui.selection[0] as string
      const t = this.src.getNode(id)?.type
      if (t === "text") return run(() => this.beginTextEdit(id))
      if (t === "path" && !this.src.isVirtual(id)) return run(() => this.editPath(id))
      const first = this.src.children(id)[0]
      if (first) return run(() => ui.select([first]))
      return false
    }
    if (key === "escape" && ui.selection.length) {
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
    if (a && ui.selection.length && this.layoutResult) {
      const k = e.shiftKey ? 10 : 1
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
    if (this.gridVisible()) {
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
    if (e.shiftKey && last) return this.pxPoint(constrain45(last, w))
    w = this.snapPt(w, cands, e, this.penAnchorBoxes())
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
    h = this.pxPoint(h)
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
    this.pathEdit = { id, contours, selected: [], hoveredSegment: null }
    this.updateOverlay()
    this.updateCursor()
  }

  get editingPath(): string | null {
    return this.pathEdit?.id ?? null
  }

  exitPathEdit(): void {
    if (!this.pathEdit) return
    const d = this.drag
    if (d?.kind === "path-anchor" || d?.kind === "path-handle") {
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
    if (!force && (d?.kind === "path-anchor" || d?.kind === "path-handle")) return
    const contours = this.store.getNode(pe.id)?.type === "path" ? this.readContours(pe.id) : null
    if (!contours?.length) {
      this.exitPathEdit()
      return
    }
    pe.contours = contours
    pe.selected = pe.selected.filter((r) => r.index < (contours[r.contour]?.anchors.length ?? 0))
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
    if (seg) {
      // Click on a segment adds an anchor there (one undo step with the drag that may follow).
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
        )
        dx = to.x - a.x
        dy = to.y - a.y
      } else if (a) {
        dx = this.px(a.x + dx) - a.x
        dy = this.px(a.y + dy) - a.y
      }
      contours = moveAnchors(d.base, d.refs, { x: dx, y: dy })
    } else {
      const a = d.base[d.ref.contour]?.anchors[d.ref.index]
      if (!a) return
      let h = this.toWorld(p)
      if (e.shiftKey) h = constrain45(a, h)
      h = this.pxPoint(h)
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

  // --- text editing -------------------------------------------------------------------------

  /** Opens the text overlay for node `id`, or for a new text node at world point `at`. */
  beginTextEdit(id: string | null, at?: Point, parent: string | null = null): void {
    this.flush()
    if (this.editing) this.commitText(null)
    let state: TextEditState
    if (id) {
      const n = this.src.getNode(id) as LayoutNodeData | undefined
      const l = this.layoutResult?.nodes.get(id)
      if (!n || !l || n.type !== "text" || n.locked === true) return
      const input = resolveText(id, n, this.resolver)
      const fill = this.resolver.value(id, n.fill)
      state = {
        id,
        at: { x: l.world.x, y: l.world.y },
        box: l.world,
        value: input.runs.map((r) => r.text).join(""),
        style: input.style,
        color: typeof fill === "string" ? fill : "#000000",
        parent: typeof n.parent === "string" ? n.parent : null,
      }
      this.editingNode = { id, data: { ...n, content: "" } }
      this.renderer.invalidate([id])
      this.ui.getState().select([id])
    } else {
      if (!at) return
      state = {
        id: null,
        at,
        box: null,
        value: "",
        style: {
          ...TEXT_STYLE_DEFAULTS,
          fontFamily: NEW_TEXT_STYLE.font,
          fontSize: NEW_TEXT_STYLE.size,
        },
        color: "",
        parent,
      }
      this.ui.getState().clearSelection()
    }
    this.editing = state
    this.updateOverlay()
    this.opts.onTextEdit?.(state)
  }

  /** Commits the overlay text (`value` null = keep the overlay's last reported value). */
  commitText(value: string | null): void {
    const s = this.editing
    if (!s) return
    const text = value ?? this.lastText ?? s.value
    this.closeText()
    const layout = this.layoutResult
    if (s.id) {
      if (!this.src.getNode(s.id)) return
      if (!text.trim()) this.apply([{ op: "delete", id: s.id }], "Delete text")
      else if (text !== s.value)
        this.apply([{ op: "update", id: s.id, set: { content: text } }], "Edit text")
    } else {
      if (text.trim() && layout) {
        const id = generateId()
        if (this.apply([createTextOp(this.store, layout, s.parent, s.at, text, id)], "Add text"))
          this.ui.getState().select([id])
      }
      // A new text (typed or abandoned) ends the text tool, unless another tool was picked.
      if (this.ui.getState().tool === "text") this.ui.getState().setTool("select")
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

  private closeText(): void {
    const id = this.editingNode?.id
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
