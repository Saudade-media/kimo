/**
 * M2 perf regressions (apps/web/e2e/perf `KIMO_PERF_M2=1`):
 *  - a background blur records an unbounded Skia picture cull rect: roots must still cull and
 *    fit the zoomed-out raster cache (bounded by the painter's ink bounds);
 *  - while the viewport moves, roots with filtered layers draw from a raster at any zoom and
 *    replay crisp once it rests;
 *  - an arriving icon glyph re-records only the pictures that skipped it.
 */
import { describe, expect, test } from "bun:test"
import { CanvasKitRenderer, type IconGlyph, type IconProvider } from "../src"
import { sceneOf, simpleLayout, type TestDoc } from "./helpers/scene"

/** Four 400×400 screens 600 px apart; screen `i` holds one child built by `child(i)`. */
function doc(child: (i: number) => Record<string, unknown>): TestDoc {
  const nodes: TestDoc["nodes"] = {}
  for (let i = 0; i < 4; i++) {
    const fid = `screen${i}00`
    nodes[fid] = {
      type: "frame",
      parent: null,
      order: `a${i}`,
      x: i * 600,
      y: 0,
      w: 400,
      h: 400,
      fill: "#F4F2EE",
    }
    nodes[`child${i}00`] = { parent: fid, order: "a0", x: 20, y: 20, ...child(i) }
  }
  return { nodes }
}

async function make(d: TestDoc, cache: boolean | "always", icons?: IconProvider) {
  const r = new CanvasKitRenderer()
  await r.init({ offlineFonts: true, icons })
  r.rasterCache = cache
  // Every root rasterizes in its first frame, however slow the machine (no per-frame budget).
  r.rasterFrameMs = Number.POSITIVE_INFINITY
  const scene = sceneOf(d)
  r.setDocument(scene)
  r.setLayout(simpleLayout(scene, r.textMeasurer()))
  r.attachRaster(600, 400)
  return r
}

const glass = () => ({
  type: "rect",
  w: 200,
  h: 80,
  fill: "#FFFFFF80",
  effects: [{ kind: "backdrop-blur", radius: 16 }],
})

describe("M2 perf", () => {
  test("a background-blur root still culls (bounded picture)", async () => {
    const r = await make(
      doc(() => glass()),
      false,
    )
    r.setViewport({ x: -100, y: 0, zoom: 1 })
    r.render()
    // Only screen 0 (and its child) intersects the viewport (world x -100…500).
    expect(r.stats()).toMatchObject({ nodesDrawn: 2, nodesCulled: 6 })
    r.dispose()
  })

  test("zoomed out, background-blur roots are drawn from rasters", async () => {
    const r = await make(
      doc(() => glass()),
      "always",
    )
    r.setViewport({ x: 0, y: 0, zoom: 0.25 })
    r.render()
    expect(r.stats()).toMatchObject({ drawCalls: 4, nodesDrawn: 8 })
    r.dispose()
  })

  test("moving viewport: filtered roots draw from a raster, crisp replay at rest", async () => {
    const blurred = (i: number) => ({
      type: "rect",
      w: 120,
      h: 120,
      fill: "#2F6BFF",
      effects: [{ kind: "blur", radius: 6 }],
      ...(i === 1 && { effects: [] }),
    })
    const r = await make(doc(blurred), "always")
    // Screens 0 and 1 visible at zoom 1 (above RASTER_MAX_SCALE).
    r.setViewport({ x: 100, y: 0, zoom: 1 })
    r.setViewport({ x: 120, y: 0, zoom: 1 })
    r.render()
    r.setViewport({ x: 140, y: 0, zoom: 1 })
    r.render()
    const moving = r.stats()
    // Screen 0 (blur layer) = 1 image draw; screen 1 (no filters) replays its 2 nodes.
    expect(moving.nodesDrawn).toBe(4)
    expect(moving.drawCalls).toBe(1 + 2)
    await new Promise((res) => setTimeout(res, 220))
    r.render()
    expect(r.stats().drawCalls).toBeGreaterThan(3)
    r.dispose()
  })

  test("an arriving glyph re-records only pictures that skipped it", async () => {
    const listeners = new Set<(set: string, name: string) => void>()
    let ready = false
    let release: () => void = () => {}
    const glyph: IconGlyph = {
      set: "lucide",
      name: "star",
      weight: null,
      viewBox: [0, 0, 24, 24],
      paths: [{ d: "M2 2 L22 2 L22 22 Z", paint: "fill" }],
    }
    const icons: IconProvider = {
      load: () =>
        new Promise((res) => {
          release = () => {
            ready = true
            res(glyph)
            for (const l of listeners) l("lucide", "star")
          }
        }),
      get: () => (ready ? glyph : null),
      catalog: async () => [],
      onIconLoaded(l) {
        listeners.add(l)
        return () => listeners.delete(l)
      },
    }
    const child = (i: number) =>
      i === 0
        ? { type: "icon", w: 24, h: 24, set: "lucide", icon: "star", color: "#1A1A1A" }
        : { type: "rect", w: 24, h: 24, fill: "#2F6BFF" }
    const r = await make(doc(child), false, icons)
    r.setViewport({ x: 0, y: 0, zoom: 0.25 })
    r.render()
    type Entry = { picture: unknown }
    const roots = (r as unknown as { roots: Map<string, Entry> }).roots
    const before = new Map([...roots].map(([id, e]) => [id, e.picture]))
    expect([...before.values()].every(Boolean)).toBe(true)
    release()
    await Promise.resolve()
    expect(roots.get("screen000")?.picture).toBeNull()
    for (const id of ["screen100", "screen200", "screen300"])
      expect(roots.get(id)?.picture).toBe(before.get(id))
    r.dispose()
  })
})
