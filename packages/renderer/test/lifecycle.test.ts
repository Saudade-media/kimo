/**
 * Wasm-handle hygiene and lifecycle races: chained layer filters are all freed, dispose during
 * init adopts nothing, image loads that finish after `clear()` are dropped.
 */
import { describe, expect, test } from "bun:test"
import { createResolver, type LayoutNodeData, type NodeSource } from "@kimo/layout"
import type { ImageFilter } from "canvaskit-wasm"
import { CanvasKitRenderer, RendererError, type RenderScene } from "../src"
import { loadCanvasKit } from "../src/ck"
import { ImageCache } from "../src/paint"
import { simpleLayout } from "./helpers/scene"

function scene(init: Record<string, Record<string, unknown>>): RenderScene {
  const nodes = new Map<string, LayoutNodeData>()
  for (const [id, n] of Object.entries(init))
    nodes.set(id, Object.freeze({ ...n }) as LayoutNodeData)
  const source: NodeSource = {
    getNode: (id) => nodes.get(id),
    children: (p) => [...nodes.entries()].filter(([, n]) => n.parent === p).map(([id]) => id),
  }
  return {
    nodes: source,
    header: {},
    resolve: createResolver({}, source),
    assets: { load: async () => null },
  }
}

describe("lifecycle", () => {
  test("chained layer filters (blur + two layer shadows) free every JS handle", async () => {
    const ck = await loadCanvasKit()
    const F = ck.ImageFilter
    const live = new Set<ImageFilter>()
    const origShadow = F.MakeDropShadow
    const origBlur = F.MakeBlur
    const track = (f: ImageFilter) => {
      live.add(f)
      const del = f.delete.bind(f)
      f.delete = () => {
        live.delete(f)
        del()
      }
      return f
    }
    F.MakeDropShadow = ((...a: Parameters<typeof origShadow>) =>
      track(origShadow(...a))) as typeof origShadow
    F.MakeBlur = ((...a: Parameters<typeof origBlur>) => track(origBlur(...a))) as typeof origBlur
    try {
      const r = new CanvasKitRenderer()
      await r.init({ offlineFonts: true })
      const s = scene({
        // An unfilled frame: layer (not geometric) shadows on a blurred layer.
        root000001: {
          type: "frame",
          parent: null,
          order: "a",
          w: 40,
          h: 40,
          effects: [
            { kind: "blur", radius: 4 },
            { kind: "shadow", x: 0, y: 2, blur: 4, color: "#00000040" },
            { kind: "shadow", x: 0, y: 8, blur: 16, color: "#00000020" },
          ],
        },
        child00001: { type: "rect", parent: "root000001", order: "a", w: 10, h: 10, fill: "#000" },
      })
      r.setDocument(s)
      r.setLayout(simpleLayout(s, r.textMeasurer(), 1))
      r.attachRaster(60, 60)
      r.render()
      r.invalidate()
      r.render()
      expect(live.size).toBe(0)
      r.dispose()
    } finally {
      F.MakeDropShadow = origShadow
      F.MakeBlur = origBlur
    }
  })

  test("dispose() while init is pending: init rejects and nothing is adopted", async () => {
    const r = new CanvasKitRenderer()
    const p = r.init({ offlineFonts: true })
    r.dispose()
    await expect(p).rejects.toBeInstanceOf(RendererError)
    expect(() => r.textMeasurer()).toThrow(RendererError)
    // A fresh init after that works.
    await r.init({ offlineFonts: true })
    expect(r.textMeasurer()).toBeDefined()
    r.dispose()
  })

  test("an image load that finishes after clear() is dropped, not cached", async () => {
    const ck = await loadCanvasKit()
    let release: (b: Uint8Array | null) => void = () => {}
    const cache = new ImageCache(ck, () => {})
    cache.assets = { load: () => new Promise((res) => (release = res)) }
    const pending = cache.load("./assets/0123456789abcdef.png")
    cache.clear()
    release(null)
    await pending
    // A new `get` starts a fresh load instead of returning a stale entry.
    expect(cache.get("./assets/0123456789abcdef.png").status).toBe("loading")
  })
})
