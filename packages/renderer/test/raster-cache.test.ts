/**
 * Zoomed-out raster cache (perf gate, ADR 0009 §4): below `RASTER_MAX_SCALE` each root is drawn
 * as one cached image. Exercised on a CPU surface through `rasterCache = "always"`.
 */
import { describe, expect, test } from "bun:test"
import { CanvasKitRenderer, RASTER_MAX_SCALE } from "../src"
import { loadCanvasKit } from "../src/ck"
import { pixelAt } from "./helpers/golden"
import { sceneOf, simpleLayout } from "./helpers/scene"

function doc() {
  const nodes: Record<string, Record<string, unknown>> = {}
  for (let f = 0; f < 4; f++) {
    const fid = `frame${String(f).padStart(4, "0")}`
    nodes[fid] = {
      type: "frame",
      parent: null,
      order: `a${f}`,
      x: f * 600,
      y: 0,
      w: 500,
      h: 500,
      fill: "#F4F2EE",
    }
    for (let i = 0; i < 20; i++)
      nodes[`n${f}x${String(i).padStart(4, "0")}`] = {
        type: i % 2 ? "ellipse" : "rect",
        parent: fid,
        order: `b${String(i).padStart(3, "0")}`,
        x: (i % 5) * 100 + 10,
        y: Math.floor(i / 5) * 100 + 10,
        w: 80,
        h: 80,
        fill: i % 3 ? "#2F6BFF" : "#1A1A1A",
      }
  }
  return { nodes }
}

async function make(cache: boolean | "always") {
  const r = new CanvasKitRenderer()
  await r.init({ offlineFonts: true })
  r.rasterCache = cache
  const scene = sceneOf(doc())
  r.setDocument(scene)
  r.setLayout(simpleLayout(scene, r.textMeasurer()))
  r.attachRaster(600, 300)
  return { r, scene }
}

describe("raster cache", () => {
  test("zoomed out, every root is one image draw and matches the replayed pictures", async () => {
    const ck = await loadCanvasKit()
    const a = await make("always")
    const b = await make(false)
    const v = { x: -20, y: -20, zoom: 0.25 }
    a.r.setViewport(v)
    b.r.setViewport(v)
    const pa = a.r.snapshot()
    const pb = b.r.snapshot()
    expect(a.r.stats()).toMatchObject({ drawCalls: 4, nodesDrawn: 84 })
    expect(b.r.stats().drawCalls).toBeGreaterThan(40)
    // Solid interiors agree exactly; edges may differ by filtering.
    for (const [x, y] of [
      [20, 20], // frame 0 rect 0 interior (world 30,30)
      [30, 30],
      [170, 110], // frame 1 background
      [5, 5], // canvas background
    ] as const) {
      const ca = pixelAt(ck, pa, x, y)
      const cb = pixelAt(ck, pb, x, y)
      for (let i = 0; i < 4; i++)
        expect(Math.abs((ca[i] as number) - (cb[i] as number))).toBeLessThanOrEqual(2)
    }
    a.r.dispose()
    b.r.dispose()
  })

  test("above RASTER_MAX_SCALE pictures replay (crisp)", async () => {
    const { r } = await make("always")
    r.setViewport({ x: 0, y: 0, zoom: RASTER_MAX_SCALE * 2 })
    r.render()
    expect(r.stats().drawCalls).toBeGreaterThan(20)
    r.dispose()
  })

  test("CPU surfaces skip the cache by default", async () => {
    const { r } = await make(true)
    r.setViewport({ x: 0, y: 0, zoom: 0.25 })
    r.render()
    expect(r.stats().drawCalls).toBeGreaterThan(40)
    r.dispose()
  })

  test("zooming back across a scale step reuses the rasters made there (same pixels)", async () => {
    const { r } = await make("always")
    const at = (zoom: number) => {
      r.setViewport({ x: -20, y: -20, zoom })
      const png = r.snapshot()
      return { png, rasterized: (r.stats() as { rasterized?: number }).rasterized ?? 0 }
    }
    const a = at(0.25)
    expect(a.rasterized).toBe(4)
    expect(at(0.125).rasterized).toBe(4)
    // Back at 0.25 (and 0.125 again): every raster is still there, nothing is redrawn.
    const b = at(0.25)
    expect(b.rasterized).toBe(0)
    expect(at(0.125).rasterized).toBe(0)
    expect(Buffer.from(b.png).equals(Buffer.from(a.png))).toBe(true)
    // A third scale keeps three levels; a fourth drops the oldest.
    expect(at(0.0625).rasterized).toBe(4)
    expect(at(0.25).rasterized).toBe(0)
    expect(at(0.03125).rasterized).toBe(4)
    expect(at(0.125).rasterized).toBe(4)
    r.dispose()
  })

  test("an edit re-rasterizes only its root; the image follows the change", async () => {
    const ck = await loadCanvasKit()
    const { r, scene } = await make("always")
    r.setViewport({ x: -20, y: -20, zoom: 0.25 })
    r.render()
    const n = scene.nodes as unknown as { getNode(id: string): Record<string, unknown> }
    // Recolor frame 0's first rect through invalidate (paint-only change).
    const node = n.getNode("n0x0000") as Record<string, unknown>
    ;(node as { fill: string }).fill = "#E0457B"
    r.invalidate(["n0x0000"])
    const png = r.snapshot()
    expect(r.stats().drawCalls).toBe(4)
    const [red, green, blue] = pixelAt(ck, png, 20, 20)
    expect([red, green, blue]).toEqual([0xe0, 0x45, 0x7b])
    r.dispose()
  })
})
