/**
 * Layout + headless raster for the tool layer (ADR 0013 §2 `kimo_render`, `kimo_query`
 * include bounds/problems): the same wiring as the canvas host (store → shared instance view →
 * resolver → Yoga layout → CanvasKit renderer), over the committed store state. Renders call
 * `Renderer.exportRaster` (CPU raster surface; works in a hidden webview, Bun and Node).
 *
 * The renderer and layout engine load lazily on first use (CanvasKit + Yoga wasm). Hosts pass
 * `createRenderer` in a browser (`@kimo/renderer/browser` resolves the bundled wasm URL).
 */
import type { DocStore } from "@kimo/editor-state"
import type {
  LayoutEngine,
  LayoutResult,
  NodeSource,
  Rect,
  ResolvedTextStyle,
  TextMeasurer,
} from "@kimo/layout"
import type { Renderer } from "@kimo/renderer"
import type { ToolImage } from "../envelope"
import type { HostResult } from "../runtime"
import { err, errorMessage, ok, toBase64 } from "./util"

export interface RenderOptions {
  scale: number
  maxSize: number
  background?: string
  theme?: Record<string, string>
}

export interface RenderedImage extends ToolImage {
  nodeId: string
  width: number
  height: number
}

/** Loads an asset referenced by a document (`./assets/<hash>.png`), or null. */
export type AssetLoader = (src: string) => Promise<Uint8Array | null>

export interface SceneService {
  /** Layout of the committed state (cached per store revision). Null when unavailable. */
  layout(store: DocStore): Promise<LayoutResult | null>
  /** PNG per node, post-commit. */
  render(
    store: DocStore,
    ids: readonly string[],
    options: RenderOptions,
    assets: AssetLoader,
  ): Promise<HostResult<RenderedImage[]>>
  /** Whether a font face loads (null when the renderer is unavailable). */
  checkFont(family: string, weight: number, italic: boolean): Promise<boolean | null>
  dispose(): void
}

export interface SceneServiceOptions {
  /** Creates and initializes a renderer. Default: `@kimo/renderer` headless, offline fonts. */
  createRenderer?: () => Promise<Renderer>
  /** Creates and initializes a layout engine. Default: `@kimo/layout` `createLayoutEngine`. */
  createLayoutEngine?: () => Promise<LayoutEngine>
  /** Disallow network font fetches (default true headless). */
  offlineFonts?: boolean
}

/** Approximate measurer used when CanvasKit cannot load (bounds stay usable). */
export const approximateMeasurer: TextMeasurer = {
  measure(t, maxWidth) {
    const style: ResolvedTextStyle = t.style
    const size = style.fontSize
    const lh = style.lineHeight
    const lineH = lh === null ? size * 1.25 : "px" in lh ? lh.px : lh.multiplier * size
    const glyph = size * 0.55
    const text = t.runs.map((r) => r.text).join("")
    let lines = 0
    let w = 0
    for (const para of text.split("\n")) {
      const pw = para.length * glyph
      if (maxWidth === undefined || pw <= maxWidth) {
        lines += 1
        w = Math.max(w, pw)
      } else {
        lines += Math.ceil(pw / Math.max(1, maxWidth))
        w = Math.max(w, maxWidth)
      }
    }
    return { w, h: lines * lineH, lines, baseline: size * 0.8 }
  },
}

/** Injects a theme into every top-level node (render with a theme). */
function themedSource(store: DocStore, theme: Record<string, string>): NodeSource {
  return {
    getNode: (id) => {
      const n = store.getNode(id)
      if (!n || n.parent !== null) return n
      const own = (n.theme as Record<string, string> | undefined) ?? {}
      return { ...n, theme: { ...own, ...theme } }
    },
    children: (p, at) => store.children(p, at),
  }
}

export function createSceneService(options: SceneServiceOptions = {}): SceneService {
  let rendererP: Promise<Renderer | null> | null = null
  let engineP: Promise<LayoutEngine> | null = null
  const cache = new WeakMap<DocStore, { key: string; layout: LayoutResult }>()
  let queue: Promise<unknown> = Promise.resolve()

  const renderer = () => {
    rendererP ??= (async () => {
      try {
        if (options.createRenderer) return await options.createRenderer()
        const { createRenderer } = await import("@kimo/renderer")
        const r = createRenderer()
        await r.init({ offlineFonts: options.offlineFonts ?? true })
        return r
      } catch {
        return null
      }
    })()
    return rendererP
  }
  const engine = () => {
    engineP ??= (async () => {
      if (options.createLayoutEngine) return options.createLayoutEngine()
      const { createLayoutEngine } = await import("@kimo/layout")
      const e = createLayoutEngine()
      await e.init()
      return e
    })()
    return engineP
  }

  /** Builds the scene pipeline for `store` (optionally themed). */
  async function pipeline(store: DocStore, theme?: Record<string, string>, assets?: AssetLoader) {
    const layoutMod = await import("@kimo/layout")
    const r = await renderer()
    const e = await engine()
    const base: NodeSource = theme ? themedSource(store, theme) : store
    const header = () => store.toHeader() as never
    const view = layoutMod.createInstanceView(base, { header })
    const resolve = layoutMod.createResolver(header, view)
    const layout = e.compute({
      nodes: base,
      expanded: view,
      resolve,
      measureText: r ? r.textMeasurer() : approximateMeasurer,
    })
    const scene = {
      nodes: view,
      header,
      resolve,
      assets: { load: async (src: string) => (assets ? assets(src) : null) },
    }
    return { r, layout, scene }
  }

  /** Serializes work on the shared renderer/engine (setDocument + async export). */
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn, fn)
    queue = next.catch(() => {})
    return next
  }

  return {
    layout(store) {
      const rev = store.revision
      const key = `${rev.epoch}:${rev.seq}`
      const hit = cache.get(store)
      if (hit && hit.key === key) return Promise.resolve(hit.layout)
      return serial(async () => {
        try {
          const { layout } = await pipeline(store)
          cache.set(store, { key, layout })
          return layout
        } catch {
          return null
        }
      })
    },
    render(store, ids, opts, assets) {
      return serial(async (): Promise<HostResult<RenderedImage[]>> => {
        let p: Awaited<ReturnType<typeof pipeline>>
        try {
          p = await pipeline(store, opts.theme, assets)
        } catch (e) {
          return err("INTERNAL", `Layout failed: ${errorMessage(e)}`)
        }
        const r = p.r
        if (!r)
          return err("UNSUPPORTED", "The CanvasKit raster is not available in this host.", {
            suggestion: "Use kimo_query include=bounds to check layout instead.",
          })
        r.setDocument(p.scene as never)
        r.setLayout(p.layout)
        const out: RenderedImage[] = []
        for (const id of ids) {
          const box: Rect | undefined = p.layout.nodes.get(id)?.world
          if (!box)
            return err("NODE_NOT_FOUND", `Node ${id} is not on the canvas (or not laid out).`, {
              nodeId: id,
            })
          const longest = Math.max(box.w, box.h, 1)
          const scale = Math.max(0.01, Math.min(opts.scale, opts.maxSize / longest))
          try {
            const bytes = await r.exportRaster(id, {
              scale,
              ...(opts.background ? { background: opts.background } : {}),
            })
            out.push({
              mimeType: "image/png",
              data: toBase64(bytes),
              nodeId: id,
              width: Math.max(1, Math.ceil(box.w * scale)),
              height: Math.max(1, Math.ceil(box.h * scale)),
            })
          } catch (e) {
            const code = (e as { code?: string }).code
            return err(code === "NODE_NOT_FOUND" ? "NODE_NOT_FOUND" : "INTERNAL", errorMessage(e), {
              nodeId: id,
            })
          }
        }
        return ok(out)
      })
    },
    async checkFont(family, weight, italic) {
      const r = await renderer()
      if (!r) return null
      const style = italic ? "italic" : "normal"
      await r.fonts.ensureFont(family, weight, style as never)
      return r.fonts.has(family, weight, style as never)
    },
    dispose() {
      void rendererP?.then((r) => r?.dispose())
      void engineP?.then((e) => e.dispose())
    },
  }
}
