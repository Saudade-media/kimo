/**
 * Preview render pipeline (board 27 §9 rule "What": "renders the real document (fonts, images,
 * variables)"): its own renderer + layout engine over the live store, limited to ONE top-level
 * frame, with the preview-only theme overrides merged into that frame's `theme` pins in the
 * read path. Nothing is written to the store: the overrides exist only in this source.
 *
 * Same pipeline as the canvas (CanvasController): instance view → resolver → engine.compute →
 * renderer.setDocument/setLayout; the store's changes (an agent run continuing in the
 * background) re-lay out on the next animation frame. No overlay is ever set: selection,
 * placeholders' dashed chrome, cursors and comments are canvas overlays, so none draw here.
 */
import type { Libraries, Theme } from "@kimo/core-schema"
import type { DocStore } from "@kimo/editor-state"
import {
  createInstanceView,
  createResolver,
  type LayoutEngine,
  type LayoutEngineOptions,
  type LayoutNodeData,
  type LayoutResult,
  type NodeSource,
  type ResolveHeader,
} from "@kimo/layout"
import type {
  AssetSource,
  FontSource,
  IconProvider,
  Renderer,
  RendererFactory,
} from "@kimo/renderer"
import type { Box, View } from "./model"

/** Stage color (decision Co3jD: #0E0E10, fixed in both app themes). */
export const PREVIEW_STAGE = "#0E0E10"

export interface PreviewRenderDeps {
  store: DocStore
  libraries: () => Libraries
  createRenderer: RendererFactory
  createLayoutEngine: (options?: LayoutEngineOptions) => LayoutEngine
  assets: AssetSource
  icons?: IconProvider
  fontSources?: readonly FontSource[]
  offlineFonts?: boolean
  canvaskitWasmUrl?: string
}

/** The read path: one root (the previewed frame), its theme pins overridden. */
export function previewSource(
  base: Pick<DocStore, "getNode" | "children">,
  frameId: () => string | null,
  themes: () => Theme | null,
): NodeSource {
  return {
    getNode(id) {
      const n = base.getNode(id) as LayoutNodeData | undefined
      const t = themes()
      if (!n || id !== frameId() || !t || Object.keys(t).length === 0) return n
      const pins = (n as { theme?: Record<string, unknown> }).theme
      return { ...n, theme: { ...(pins ?? {}), ...t } } as LayoutNodeData
    },
    children(parent, at) {
      if (parent === null) {
        const f = frameId()
        return f && base.getNode(f) ? [f] : []
      }
      return base.children(parent, at)
    },
  }
}

export class PreviewRender {
  private renderer: Renderer | null = null
  private engine: LayoutEngine | null = null
  private header: ResolveHeader = {}
  private layout: LayoutResult | null = null
  private frame: string | null = null
  private themes: Theme | null = null
  private raf = 0
  private disposed = false
  private offs: (() => void)[] = []
  private readonly source: NodeSource

  constructor(
    private readonly deps: PreviewRenderDeps,
    private readonly onLayout: (box: Box | null) => void,
  ) {
    this.source = previewSource(
      deps.store,
      () => this.frame,
      () => this.themes,
    )
  }

  /** Initializes CanvasKit + Yoga and binds `canvas`. Rejects on renderer / engine failure. */
  async start(canvas: HTMLCanvasElement, w: number, h: number, dpr: number): Promise<void> {
    const d = this.deps
    const renderer = d.createRenderer()
    const engine = d.createLayoutEngine({ libraries: d.libraries() })
    const init: Parameters<Renderer["init"]>[0] = {}
    if (d.icons) init.icons = d.icons
    if (d.canvaskitWasmUrl) init.canvaskitWasmUrl = d.canvaskitWasmUrl
    if (d.fontSources) init.fontSources = d.fontSources
    if (d.offlineFonts) init.offlineFonts = true
    try {
      await Promise.all([renderer.init(init), engine.init()])
    } catch (e) {
      renderer.dispose()
      engine.dispose()
      throw e
    }
    if (this.disposed) {
      renderer.dispose()
      engine.dispose()
      return
    }
    this.renderer = renderer
    this.engine = engine
    this.rebuild()
    renderer.attach(canvas, { dpr })
    renderer.resize(w, h, dpr)
    renderer.render()
    this.offs.push(
      d.store.onChange(() => this.schedule()),
      renderer.fonts.onFontLoaded(() => this.schedule()),
    )
  }

  /** Shows `frameId` with `themes` merged into its pins (null = its own pins). */
  set(frameId: string | null, themes: Theme | null): void {
    if (frameId === this.frame && themes === this.themes) return
    this.frame = frameId
    this.themes = themes
    if (this.renderer) {
      this.rebuild()
      void this.renderer.ensureFonts?.(frameId ?? "").catch(() => undefined)
    }
  }

  resize(w: number, h: number, dpr: number): void {
    this.renderer?.resize(w, h, dpr)
    this.renderer?.requestFrame()
  }

  setView(v: View): void {
    if (!this.renderer) return
    this.renderer.setViewport(v)
    this.renderer.requestFrame()
  }

  /** The previewed frame's world box (null before the first layout / frame gone). */
  box(): Box | null {
    const f = this.frame
    const n = f ? this.layout?.nodes.get(f) : undefined
    return n ? { x: n.world.x, y: n.world.y, w: n.world.w, h: n.world.h } : null
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.raf) cancelAnimationFrame(this.raf)
    for (const off of this.offs.splice(0)) off()
    this.renderer?.dispose()
    this.engine?.dispose()
    this.renderer = null
    this.engine = null
  }

  private schedule(): void {
    if (this.raf || this.disposed) return
    this.raf = requestAnimationFrame(() => {
      this.raf = 0
      if (!this.disposed) this.rebuild()
    })
  }

  /** Full rebuild: one frame is small, and theme overrides re-resolve every binding anyway. */
  private rebuild(): void {
    const r = this.renderer
    const engine = this.engine
    if (!r || !engine) return
    const h = this.deps.store.toHeader()
    const header: ResolveHeader = {}
    if (h.variables) header.variables = h.variables
    if (h.themes) header.themes = h.themes
    if (h.imports) header.imports = h.imports
    this.header = header
    const libraries = this.deps.libraries()
    const view = createInstanceView(this.source, { libraries, header: () => this.header as never })
    const resolver = createResolver(() => this.header, view, { libraries })
    r.setDocument({
      nodes: view,
      header: () => this.header,
      resolve: resolver,
      // Transparent: the stage (#0E0E10) and the frame's shadow are CSS under the canvas.
      assets: this.deps.assets,
    })
    try {
      this.layout = engine.compute({
        nodes: view,
        expanded: view,
        resolve: resolver,
        measureText: r.textMeasurer(),
      })
    } catch (e) {
      console.warn("Kimo preview: layout failed", e)
      return
    }
    r.invalidate()
    r.setLayout(this.layout)
    r.requestFrame()
    this.onLayout(this.box())
  }
}
