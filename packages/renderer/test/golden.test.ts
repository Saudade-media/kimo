import { beforeAll, describe, expect, test } from "bun:test"
import type { CanvasKit } from "canvaskit-wasm"
import { CanvasKitRenderer } from "../src"
import { loadCanvasKit } from "../src/ck"
import { paintsDoc, shapesDoc, textDoc } from "./fixtures/docs"
import { compareGolden, pixelAt } from "./helpers/golden"
import { quadrantPng } from "./helpers/png"
import { sceneOf, simpleLayout, type TestDoc } from "./helpers/scene"

let ck: CanvasKit
let png: Uint8Array
const r = new CanvasKitRenderer()

beforeAll(async () => {
  await r.init({ offlineFonts: true })
  ck = await loadCanvasKit()
  png = quadrantPng(ck)
})

function load(doc: TestDoc) {
  const scene = sceneOf(doc, { "./assets/0123456789abcdef.png": png })
  r.setDocument(scene)
  const layout = simpleLayout(scene, r.textMeasurer())
  r.setLayout(layout)
  return { scene, layout }
}

describe("golden exports (exportRaster, scale 2)", () => {
  for (const [name, doc, root] of [
    ["shapes", shapesDoc, "board0001"],
    ["paints", paintsDoc, "board0002"],
    ["text", textDoc, "board0003"],
  ] as const) {
    test(name, async () => {
      load(doc)
      const bytes = await r.exportRaster(root, { scale: 2 })
      const res = compareGolden(ck, name, bytes)
      expect(res.message && res.ok).toBe(true)
    })
  }

  test("export honors background and scale", async () => {
    load(shapesDoc)
    const bytes = await r.exportRaster("rect00001", { scale: 3, background: "#FF0000" })
    // rect00001 is 60×40 → 180×120 at scale 3, solid #1A1A1A.
    expect(pixelAt(ck, bytes, 90, 60)).toEqual([0x1a, 0x1a, 0x1a, 255])
    const img = ck.MakeImageFromEncoded(bytes)
    expect([img?.width(), img?.height()]).toEqual([180, 120])
    img?.delete()
  })

  test("unknown node rejects with NODE_NOT_FOUND", async () => {
    load(shapesDoc)
    await expect(r.exportRaster("nope00000")).rejects.toMatchObject({ code: "NODE_NOT_FOUND" })
  })
})

describe("frame rendering with overlays (attachRaster)", () => {
  test("viewport, hover, selection handles, size badge, marquee", () => {
    load(shapesDoc)
    r.attachRaster(360, 260, 2)
    r.setViewport({ x: -20, y: -20, zoom: 1 })
    r.setOverlay({
      selection: ["rect00002"],
      hovered: "ellip0001",
      marquee: { x: 160, y: 130, w: 80, h: 70 },
      sizeLabel: "60 × 40",
    })
    const bytes = r.snapshot()
    const res = compareGolden(ck, "overlay", bytes)
    expect(res.message && res.ok).toBe(true)
    // Handle at rect00002's top-left corner (92,16) → screen (112,36) → device (224,72): white fill.
    expect(pixelAt(ck, bytes, 224, 72)).toEqual([255, 255, 255, 255])
    // Selection outline (inside, 1.5px) on the top edge just right of the handle: selection blue.
    const [rr, gg, bb] = pixelAt(ck, bytes, 240, 73)
    expect(Math.abs(rr - 0x2f) + Math.abs(gg - 0x6b) + Math.abs(bb - 0xff)).toBeLessThan(40)
    r.detach()
  })

  test("zoom 2 + pan renders the scene magnified", () => {
    load(paintsDoc)
    r.attachRaster(200, 150, 1)
    r.setViewport({ x: 10, y: 10, zoom: 2 })
    r.setOverlay({ selection: [], hovered: null, marquee: null })
    const bytes = r.snapshot()
    const res = compareGolden(ck, "zoomed", bytes)
    expect(res.message && res.ok).toBe(true)
    r.detach()
  })
})
