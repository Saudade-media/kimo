import { describe, expect, test } from "bun:test"
import type { LayoutNodeData, NodeSource } from "@kimo/layout"
import { createResolver } from "@kimo/layout"
import type { ImageFilter } from "canvaskit-wasm"
import { CanvasKitRenderer, createRenderer, RendererError, type RenderScene } from "../src"
import { loadCanvasKit } from "../src/ck"
import { ImageCache } from "../src/paint"
import { pixelAt } from "./helpers/golden"
import { quadrantPng } from "./helpers/png"
import { simpleLayout } from "./helpers/scene"

/** A mutable node table with frozen node objects (like DocStore). */
function mutableSource(init: Record<string, Record<string, unknown>>) {
  const nodes = new Map<string, LayoutNodeData>()
  for (const [id, n] of Object.entries(init))
    nodes.set(id, Object.freeze({ ...n }) as LayoutNodeData)
  const source: NodeSource = {
    getNode: (id) => nodes.get(id),
    children: (p) =>
      [...nodes.entries()]
        .filter(([, n]) => n.parent === p)
        .sort((a, b) => (a[1].order < b[1].order ? -1 : 1))
        .map(([id]) => id),
  }
  const set = (id: string, patch: Record<string, unknown>) =>
    nodes.set(id, Object.freeze({ ...(nodes.get(id) as object), ...patch }) as LayoutNodeData)
  return { source, set }
}

const tick = () => new Promise((r) => setTimeout(r, 5))

function setup(
  r: CanvasKitRenderer,
  init: Record<string, Record<string, unknown>>,
  assets: Record<string, Uint8Array> = {},
) {
  const m = mutableSource(init)
  const scene: RenderScene = {
    nodes: m.source,
    header: {},
    resolve: createResolver({}, m.source),
    assets: { load: async (s) => assets[s] ?? null },
  }
  r.setDocument(scene)
  const relayout = () => r.setLayout(simpleLayout(scene, r.textMeasurer(), Math.random()))
  relayout()
  return { ...m, scene, relayout }
}

describe("lifecycle", () => {
  test("NOT_INITIALIZED before init; init is idempotent", async () => {
    const r = createRenderer()
    expect(() => r.textMeasurer()).toThrow(RendererError)
    try {
      r.fonts
    } catch (e) {
      expect((e as RendererError).code).toBe("NOT_INITIALIZED")
    }
    r.render() // no surface: no-op
    await Promise.all([r.init(), r.init()])
    expect(r.textMeasurer()).toBeDefined()
    r.dispose()
  })

  test("headless browser-less load reports WASM_LOAD_FAILED for a bad URL", async () => {
    const r = createRenderer()
    await expect(
      r.init({ canvaskitWasmUrl: "/definitely/missing/canvaskit.wasm" }),
    ).rejects.toMatchObject({
      code: "WASM_LOAD_FAILED",
    })
  })
})

describe("frames, caching, culling", () => {
  test("node data identity change re-records the root picture (layout and paint-only)", async () => {
    const r = new CanvasKitRenderer()
    await r.init({ offlineFonts: true })
    const s = setup(r, {
      root000001: {
        type: "frame",
        parent: null,
        order: "a",
        x: 0,
        y: 0,
        w: 40,
        h: 40,
        fill: "#FF0000",
      },
    })
    r.attachRaster(40, 40)
    expect(pixelAt(await loadCanvasKit(), r.snapshot(), 20, 20)).toEqual([255, 0, 0, 255])
    // paint-only: host calls invalidate(ids)
    s.set("root000001", { fill: "#0000FF" })
    r.invalidate(["root000001"])
    expect(pixelAt(await loadCanvasKit(), r.snapshot(), 20, 20)).toEqual([0, 0, 255, 255])
    // layout pass with unchanged boxes: identity check still catches the edit
    s.set("root000001", { fill: "#00FF00" })
    s.relayout()
    expect(pixelAt(await loadCanvasKit(), r.snapshot(), 20, 20)).toEqual([0, 255, 0, 255])
    expect(r.stats().backend).toBe("raster")
    r.dispose()
  })

  test("roots outside the viewport are culled", async () => {
    const r = new CanvasKitRenderer()
    await r.init({ offlineFonts: true })
    const nodes: Record<string, Record<string, unknown>> = {}
    for (let i = 0; i < 10; i++)
      nodes[`node${String(i).padStart(6, "0")}`] = {
        type: "rect",
        parent: null,
        order: `a${i}`,
        x: i * 1000,
        y: 0,
        w: 50,
        h: 50,
        fill: "#000",
      }
    setup(r, nodes)
    r.attachRaster(200, 200)
    r.setViewport({ x: 0, y: 0, zoom: 1 })
    r.render()
    expect(r.stats()).toMatchObject({ nodesDrawn: 1, nodesCulled: 9 })
    r.setViewport({ x: 2900, y: 0, zoom: 0.1 }) // 2000 world px wide: roots 3..4
    r.render()
    expect(r.stats().nodesDrawn).toBe(2)
    r.dispose()
  })

  test("a root holding a background blur still culls (its picture stays bounded)", async () => {
    const r = new CanvasKitRenderer()
    await r.init({ offlineFonts: true })
    const nodes: Record<string, Record<string, unknown>> = {}
    for (let i = 0; i < 4; i++) {
      nodes[`screen${i}00`] = {
        type: "frame",
        parent: null,
        order: `a${i}`,
        x: i * 600,
        y: 0,
        w: 400,
        h: 400,
        fill: "#F4F2EE",
      }
      nodes[`glass${i}00`] = {
        type: "rect",
        parent: `screen${i}00`,
        order: "a",
        x: 20,
        y: 20,
        w: 200,
        h: 80,
        fill: "#FFFFFF80",
        effects: [{ kind: "backdrop-blur", radius: 16 }],
      }
    }
    setup(r, nodes)
    r.attachRaster(600, 400)
    r.setViewport({ x: -100, y: 0, zoom: 1 })
    r.render()
    // Only screen 0 (and its child) intersects the viewport.
    expect(r.stats()).toMatchObject({ nodesDrawn: 2, nodesCulled: 6 })
    r.dispose()
  })

  test("requestFrame coalesces into one frame", async () => {
    const r = new CanvasKitRenderer()
    await r.init({ offlineFonts: true })
    setup(r, { root000001: { type: "rect", parent: null, order: "a", w: 10, h: 10, fill: "#000" } })
    r.attachRaster(10, 10)
    await tick()
    const before = r.stats().frames
    r.requestFrame()
    r.requestFrame()
    r.setViewport({ x: 1, y: 1, zoom: 1 })
    await tick()
    expect(r.stats().frames).toBe(before + 1)
    r.dispose()
  })

  test("renderPending draws a pending frame now, once (the scheduled callback skips)", async () => {
    const r = new CanvasKitRenderer()
    await r.init({ offlineFonts: true })
    setup(r, { root000001: { type: "rect", parent: null, order: "a", w: 10, h: 10, fill: "#000" } })
    r.attachRaster(10, 10)
    await tick()
    const before = r.stats().frames
    expect(r.renderPending()).toBe(false)
    r.requestFrame()
    expect(r.renderPending()).toBe(true)
    expect(r.stats().frames).toBe(before + 1)
    expect(r.renderPending()).toBe(false)
    await tick()
    expect(r.stats().frames).toBe(before + 1)
    // A frame requested after the early draw is scheduled normally.
    r.requestFrame()
    await tick()
    expect(r.stats().frames).toBe(before + 2)
    r.dispose()
  })

  test("image fills appear once the asset decodes", async () => {
    const ck = await loadCanvasKit()
    const r = new CanvasKitRenderer()
    await r.init({ offlineFonts: true })
    setup(
      r,
      {
        img0000001: {
          type: "rect",
          parent: null,
          order: "a",
          w: 40,
          h: 20,
          fill: { kind: "image", src: "./assets/0123456789abcdef.png", fit: "stretch" },
        },
      },
      { "./assets/0123456789abcdef.png": quadrantPng(ck) },
    )
    r.attachRaster(40, 20)
    expect(pixelAt(ck, r.snapshot(), 5, 5)[3]).toBe(0) // still loading
    await tick()
    const [red, , , a] = pixelAt(ck, r.snapshot(), 5, 5)
    expect(a).toBe(255)
    expect(red).toBeGreaterThan(200)
    r.dispose()
  })

  test("an image missing at first draw appears after retryAssets once its bytes arrive", async () => {
    // A guest opening a share link: the canvas draws before the relay fetch stores the image.
    const ck = await loadCanvasKit()
    const r = new CanvasKitRenderer()
    await r.init({ offlineFonts: true })
    const src = "./assets/0123456789abcdef.png"
    const assets: Record<string, Uint8Array> = {}
    setup(
      r,
      {
        img0000001: {
          type: "rect",
          parent: null,
          order: "a",
          w: 40,
          h: 20,
          fill: { kind: "image", src, fit: "stretch" },
        },
      },
      assets,
    )
    r.attachRaster(40, 20)
    r.snapshot()
    await tick()
    expect(pixelAt(ck, r.snapshot(), 5, 5)[1]).toBeGreaterThan(150) // gray checkerboard
    assets[src] = quadrantPng(ck)
    r.retryAssets()
    await tick()
    const [red, green] = pixelAt(ck, r.snapshot(), 5, 5)
    expect(red).toBeGreaterThan(200)
    expect(green).toBeLessThan(100)
    r.dispose()
  })
})

describe("wasm handles and lifecycle races", () => {
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
      setup(r, {
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
