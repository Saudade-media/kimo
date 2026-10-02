/**
 * The canvas pipeline and input controller behind `<CanvasHost>` (framework-agnostic DOM code).
 *
 * Pipeline: `DocStore.onChange` → dirty ids (coalesced per animation frame) →
 * `LayoutEngine.update` → `Renderer.invalidate + setLayout` → overlay → `requestFrame`.
 * Input: pointer gestures for the active tool (select / move / resize / marquee / draw / text),
 * pan (space-drag, middle mouse, wheel), zoom (⌘/ctrl-wheel, pinch, keys) and canvas commands.
 * Every document edit goes through `store.apply` with the host origin; one gesture = one undo step.
 */
import type { DocStore, LocalOrigin, Op, Tool, UiState } from "@kimo/editor-state"
import { generateId } from "@kimo/editor-state"
import {
  createResolver,
  type ExpandedNodeSource,
  expandInstances,
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
import type { AssetSource, Overlay, Point, Renderer, RenderStats } from "@kimo/renderer"
import {
  canMove,
  createShapeOp,
  createTextOp,
  deleteOps,
  dropParent,
  duplicateOps,
  groupOps,
  type MoveStart,
  moveOps,
  moveStart,
  NEW_TEXT_STYLE,
  nextName,
  nudgeOps,
  type ResizeStart,
  resizeOps,
  resizeStart,
  type ShapeKind,
  topLevel,
} from "./commands"
import type { CanvasError, CanvasPointerInfo, UiStore } from "./contract"
import { type Gesture, startGesture } from "./gesture"
import {
  clampZoom,
  containsRect,
  fitViewport,
  HANDLE_CURSOR,
  type Handle,
  handleAt,
  rectFromPoints,
  resizeBox,
  sizeLabel,
  unionRects,
  wheelZoomFactor,
} from "./math"
import { enterTarget, pickTarget } from "./selection"

/** Pointer travel (screen px) before a press becomes a drag. */
const DRAG_THRESHOLD = 3
/** Default size of a shape created by a click (no drag). */
const CLICK_SIZE = 100
/** Hit slop (screen px) for thin shapes and text. */
const HIT_TOLERANCE = 2

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
  | { kind: "move"; start: Point; items: MoveStart[]; gesture: Gesture; allowed: boolean }
  | {
      kind: "resize"
      start: Point
      handle: Handle
      snap: ResizeStart
      gesture: Gesture
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
    }

const isShapeTool = (t: Tool): t is "frame" | "rect" | "ellipse" =>
  t === "frame" || t === "rect" || t === "ellipse"

export class CanvasController {
  readonly store: DocStore
  readonly ui: UiStore
  readonly renderer: Renderer
  readonly engine: LayoutEngine
  private readonly opts: ControllerOptions

  private src: ExpandedNodeSource
  private viewSrc: NodeSource
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

  constructor(opts: ControllerOptions) {
    this.opts = opts
    this.store = opts.store
    this.ui = opts.ui
    this.renderer = opts.renderer
    this.engine = opts.engine
    this.header = this.readHeader()
    this.src = expandInstances(this.store, {})
    this.resolver = createResolver(() => this.header, this.src)
    // The renderer reads through this view so the node being text-edited draws empty (the
    // overlay textarea shows its text) while layout keeps measuring the real content.
    this.viewSrc = {
      getNode: (id) => (this.editingNode?.id === id ? this.editingNode.data : this.src.getNode(id)),
      children: (parent, at) => this.src.children(parent, at),
    }
  }

  private readHeader(): ResolveHeader {
    const d = this.store.toDocument()
    const h: ResolveHeader = {}
    if (d.variables) h.variables = d.variables
    if (d.themes) h.themes = d.themes
    if (d.imports) h.imports = d.imports
    return h
  }

  private input(): LayoutInput {
    return { nodes: this.src, resolve: this.resolver, measureText: this.renderer.textMeasurer() }
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
      this.src.invalidate()
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
    if (this.editing?.id && !this.store.hasNode(this.editing.id)) this.cancelText()
    this.updateOverlay()
  }

  private onUi(s: UiState, prev: UiState): void {
    if (s.viewport !== prev.viewport) this.renderer.setViewport(s.viewport)
    if (s.selection !== prev.selection || s.hovered !== prev.hovered) this.updateOverlay()
    if (s.tool !== prev.tool) {
      if (this.editing && s.tool !== "text") this.commitText(null)
      this.updateCursor()
    }
  }

  private updateOverlay(): void {
    const { selection, hovered } = this.ui.getState()
    const layout = this.layoutResult
    const sel = selection.filter((id) => layout?.nodes.has(id))
    const busy =
      this.drag?.kind === "move" ||
      this.drag?.kind === "resize" ||
      this.drag?.kind === "draw" ||
      this.drag?.kind === "pan"
    let label: string | null = null
    if (layout && sel.length && !this.editing) {
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
    const overlay: Overlay = {
      selection: this.editing ? [] : sel,
      hovered: hovered && !selection.includes(hovered) && !busy && !this.editing ? hovered : null,
      marquee: this.marquee,
      sizeLabel: label,
      handles: !busy,
    }
    this.renderer.setOverlay(overlay)
  }

  private report(error: CanvasError): void {
    if (this.opts.onError) this.opts.onError(error)
    else console.warn("Kimo canvas:", error)
  }

  /** Applies one op group as one undo step. */
  apply(ops: readonly Op[], label: string): boolean {
    if (!ops.length) return false
    const r = this.store.apply(ops, { origin: this.opts.origin, label })
    if (!r.ok) {
      this.report({ kind: "op", message: r.errors.map((e) => e.message).join("; ") })
      return false
    }
    return true
  }

  private gesture(label: string): Gesture {
    return startGesture(this.store, this.opts.origin, label, (message) =>
      this.report({ kind: "op", message }),
    )
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
    while (this.src.isSynthetic(cur)) {
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
    if (isShapeTool(tool)) return "crosshair"
    if (tool === "text") return "text"
    const h = p ? this.handleAt(p) : null
    return h ? HANDLE_CURSOR[h] : "default"
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
      if (!this.drag && this.ui.getState().hovered) this.ui.getState().setHovered(null)
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
    })
    on(window, "blur", () => {
      this.spaceHeld = false
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

    if (isShapeTool(ui.tool)) {
      const startWorld = this.toWorld(p)
      const shape: ShapeKind = ui.tool
      const parent = dropParent(this.store, this.hits(p))
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
      }
      return
    }
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
        this.drag = { kind: "resize", start: p, handle, snap, gesture: this.gesture("Resize") }
        this.updateOverlay()
        this.updateCursor()
        return
      }
    }

    const artboard = this.artboardOf(e.target)
    const hit = artboard ? [artboard] : this.hits(p)
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
    const target = artboard ?? pickTarget(this.store, deepest, before, e.metaKey || e.ctrlKey)
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
    const d = this.drag
    if (!d) {
      if (this.isOverlayTarget(e.target) || e.buttons) return
      this.hover(p, e.target)
      this.updateCursor(p)
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
      const hit = this.hits(p)[0]
      id = hit ? pickTarget(this.store, hit, ui.selection, false) : null
      if (ui.tool === "text" && id && this.store.getNode(id)?.type !== "text") id = null
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
        this.drag = {
          kind: "move",
          start: d.start,
          items: allowed ? items : [],
          gesture: this.gesture("Move"),
          allowed,
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
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0
          else dx = 0
        }
        d.gesture.set(moveOps(this.store, layout, d.items, { x: dx, y: dy }))
        return
      }
      case "resize": {
        const box = resizeBox(
          d.snap.box,
          d.handle,
          (p.x - d.start.x) / v.zoom,
          (p.y - d.start.y) / v.zoom,
          { aspect: e.shiftKey, center: e.altKey },
        )
        d.gesture.set(resizeOps(this.store, layout, d.snap, box))
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
      case "draw": {
        if (!d.dragged && Math.hypot(p.x - d.start.x, p.y - d.start.y) < DRAG_THRESHOLD) return
        d.dragged = true
        let end = this.toWorld(p)
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
      case "pan":
        break
    }
    this.updateOverlay()
    this.updateCursor(p ?? undefined)
  }

  /** True while a pointer gesture that edits the document (move, resize, draw) is running. */
  isGesturing(): boolean {
    const k = this.drag?.kind
    return k === "move" || k === "resize" || k === "draw"
  }

  /** Escape / blur during a gesture: reverts it. */
  cancelDrag(): boolean {
    const d = this.drag
    if (!d) return false
    this.drag = null
    this.pendingPointer = null
    if (d.kind === "move" || d.kind === "resize" || d.kind === "draw") d.gesture.cancel()
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
    const p = this.local(e)
    const hit = this.hits(p)[0]
    if (!hit) return
    const ui = this.ui.getState()
    const sel = ui.selection.length === 1 ? ui.selection[0] : undefined
    if (sel && this.store.getNode(sel)?.type === "text" && this.hits(p).includes(sel)) {
      this.beginTextEdit(sel)
      return
    }
    const next = enterTarget(this.store, hit, sel)
    ui.select([next])
    if (next === hit && this.store.getNode(hit)?.type === "text") this.beginTextEdit(hit)
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
      return run(() => this.apply(deleteOps(this.store, ui.selection), "Delete"))
    }
    if (key === "enter" && ui.selection.length === 1) {
      const id = ui.selection[0] as string
      if (this.store.getNode(id)?.type === "text") return run(() => this.beginTextEdit(id))
      const first = this.store.children(id)[0]
      if (first) return run(() => ui.select([first]))
      return false
    }
    if (key === "escape" && ui.selection.length) {
      // Escape selects the parent (Figma); at the top level it clears the selection.
      const parents = [...new Set(ui.selection.map((id) => this.store.getNode(id)?.parent ?? null))]
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
      const n = this.store.getNode(id)
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
      if (!this.store.hasNode(s.id)) return
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
