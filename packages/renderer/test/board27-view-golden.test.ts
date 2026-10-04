/**
 * Board 27 renderer goldens for the parent B2 surfaces: §4 (b) rulers + pixel grid (Iaqcg ›
 * Ko6aO, 1600 %) and §6 (a) flip H / V (rule K0t6s). Each golden is backed by measured pixel
 * assertions against the node values (strip 20, ticks 1 × 8 border-strong, numbers at tick + 3,
 * selection range selection-soft with Sel Start / Sel End, numbers under the range hidden).
 */
import { beforeAll, describe, expect, test } from "bun:test"
import { createLayoutEngine } from "@kimo/layout"
import type { CanvasKit } from "canvaskit-wasm"
import { CanvasKitRenderer, OVERLAY_SPEC_RULERS, rulerStep } from "../src"
import { loadCanvasKit } from "../src/ck"
import { compareGolden } from "./helpers/golden"
import { sceneOf, simpleLayout, type TestDoc } from "./helpers/scene"

let ck: CanvasKit
const r = new CanvasKitRenderer()

beforeAll(async () => {
  await r.init({ offlineFonts: true })
  ck = await loadCanvasKit()
})

function pixels(bytes: Uint8Array) {
  const img = ck.MakeImageFromEncoded(bytes)
  if (!img) throw new Error("png")
  const w = img.width()
  const h = img.height()
  const px = img.readPixels(0, 0, {
    width: w,
    height: h,
    colorType: ck.ColorType.RGBA_8888,
    alphaType: ck.AlphaType.Unpremul,
    colorSpace: ck.ColorSpace.SRGB,
  }) as Uint8Array
  img.delete()
  const at = (x: number, y: number): [number, number, number, number] => {
    const i = (y * w + x) * 4
    return [px[i] ?? 0, px[i + 1] ?? 0, px[i + 2] ?? 0, px[i + 3] ?? 0]
  }
  return { w, h, at }
}

const hex = (h: string) => {
  const n = Number.parseInt(h.slice(1, 7), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const near = (a: readonly number[], h: string, tol = 6) =>
  hex(h).every((v, i) => Math.abs(v - (a[i] ?? 0)) <= tol)

function golden(name: string, bytes: Uint8Array) {
  const res = compareGolden(ck, name, bytes)
  expect(res.message && res.ok).toBe(true)
}

/**
 * Ko6aO at 1600 %: world 0 at the ruler's tick 0 (screen 20); Shape A (screen 68, 84, 128 × 96)
 * = world (3, 4, 8 × 6); Shape B (260, 116, 112 × 112) = world (15, 6, 7 × 7), selected.
 */
const rulersDoc: TestDoc = {
  nodes: {
    paper0001: {
      type: "rect",
      parent: null,
      order: "a",
      x: -2,
      y: -2,
      w: 40,
      h: 30,
      fill: "#FFFFFF",
    },
    shapeA001: { type: "rect", parent: null, order: "b", x: 3, y: 4, w: 8, h: 6, fill: "#E4E7EC" },
    shapeB001: { type: "rect", parent: null, order: "c", x: 15, y: 6, w: 7, h: 7, fill: "#C9D7FF" },
  },
}

function rulersShot(selection: string[]) {
  const scene = sceneOf(rulersDoc)
  r.setDocument(scene)
  const layout = simpleLayout(scene, r.textMeasurer())
  r.setLayout(layout)
  r.attachRaster(468, 330, 1)
  r.setViewport({ x: -20 / 16, y: -20 / 16, zoom: 16 })
  const sel = selection.length ? layout.nodes.get(selection[0] as string)?.world : null
  r.setOverlay({
    selection,
    hovered: null,
    marquee: null,
    pixelGrid: true,
    rulers: { selection: sel ?? null },
  })
  const bytes = r.snapshot()
  r.detach()
  return bytes
}

describe("board 27 §4 rulers (Ko6aO)", () => {
  test("nice tick step: 1600 % → 4 (64 px), 100 % → 50, 800 % → 10", () => {
    expect(rulerStep(16)).toBe(4)
    expect(rulerStep(1)).toBe(50)
    expect(rulerStep(8)).toBe(10)
    expect(rulerStep(0.5)).toBe(100)
    expect(OVERLAY_SPEC_RULERS.size).toBe(20)
  })

  test("golden + measured strips, ticks, range, labels", () => {
    const bytes = rulersShot(["shapeB001"])
    golden("board27-rulers", bytes)
    const p = pixels(bytes)
    const D = OVERLAY_SPEC_RULERS.defaults
    // Strips: bg-app fill, the inner edge row/column is the border stroke.
    expect(near(p.at(150, 6), D.bg)).toBe(true)
    expect(near(p.at(150, 19), D.border)).toBe(true)
    expect(near(p.at(6, 300), D.bg)).toBe(true)
    expect(near(p.at(19, 300), D.border)).toBe(true)
    // Corner O90uvJ: bg with right + bottom stroke.
    expect(near(p.at(8, 8), D.bg)).toBe(true)
    expect(near(p.at(19, 8), D.border)).toBe(true)
    // Top ticks 1 × 8 at x 20 + 64k (Tick 1 Q5kcX x 64 → screen 84), y 12…19.
    expect(near(p.at(84, 14), D.tick)).toBe(true)
    expect(near(p.at(85, 14), D.bg)).toBe(true)
    expect(near(p.at(84, 10), D.bg)).toBe(true)
    // Left ticks 8 × 1 at y 84.
    expect(near(p.at(14, 84), D.tick)).toBe(true)
    expect(near(p.at(14, 85), D.bg)).toBe(true)
    // Selection Range zxrLO (x 240…352 → screen 260…372): selection-soft over bg-app.
    const soft = p.at(300, 14)
    expect(soft[2]).toBeGreaterThan(soft[0] + 10)
    // Left range TaeVj (y 96…208 → screen 116…228).
    expect(p.at(6, 120)[2]).toBeGreaterThan(p.at(6, 120)[0] + 10)
    // N4 "16" (tick 4 at screen 276) is under the range: no text pixels between the labels.
    for (let x = 279; x < 300; x++)
      for (let y = 3; y < 12; y++) expect(p.at(x, y)).toEqual(p.at(300, 6))
    // Sel Start "15" at 263 is drawn in selection blue.
    let blue = 0
    for (let x = 263; x < 276; x++)
      for (let y = 3; y < 13; y++) {
        const c = p.at(x, y)
        if (c[2] > 180 && c[0] < 150) blue++
      }
    expect(blue).toBeGreaterThan(3)
    // N1 "4" at 87 is drawn in text-tertiary (darker than bg).
    let ink = 0
    for (let x = 87; x < 95; x++)
      for (let y = 3; y < 13; y++) if ((p.at(x, y)[0] ?? 255) < 220) ink++
    expect(ink).toBeGreaterThan(3)
    // Pixel grid inside the canvas (rule zyQtF): #0000000F over white = #F0F0F0 at 20 + 16k.
    expect(near(p.at(36, 300), "#F0F0F0", 2)).toBe(true)
    expect(near(p.at(44, 300), "#FFFFFF", 0)).toBe(true)
  })

  test("no selection: no range; rulers absent draw nothing", () => {
    const p = pixels(rulersShot([]))
    expect(near(p.at(300, 6), OVERLAY_SPEC_RULERS.defaults.bg)).toBe(true)
    const scene = sceneOf(rulersDoc)
    r.setDocument(scene)
    r.setLayout(simpleLayout(scene, r.textMeasurer()))
    r.attachRaster(468, 330, 1)
    r.setViewport({ x: -20 / 16, y: -20 / 16, zoom: 16 })
    r.setOverlay({ selection: [], hovered: null, marquee: null, rulers: null })
    const off = pixels(r.snapshot())
    r.detach()
    expect(near(off.at(150, 19), "#FFFFFF", 0)).toBe(true)
  })
})

/** A right triangle (filled corner top-left) unflipped, flipX, flipY, both — through Yoga. */
const flipDoc: TestDoc = {
  nodes: {
    boardF001: {
      type: "frame",
      parent: null,
      order: "a",
      x: 0,
      y: 0,
      w: 200,
      h: 50,
      fill: "#FFFFFF",
    },
    ...Object.fromEntries(
      [
        ["triF0001", 0, false, false],
        ["triF0002", 50, true, false],
        ["triF0003", 100, false, true],
        ["triF0004", 150, true, true],
      ].map(([id, x, fx, fy], i) => [
        id,
        {
          type: "path",
          parent: "boardF001",
          order: `a${i}`,
          x: (x as number) + 5,
          y: 5,
          w: 40,
          h: 40,
          d: "M0 0L40 0L0 40Z",
          viewBox: [0, 0, 40, 40],
          fill: "#E5177E",
          ...(fx ? { flipX: true } : {}),
          ...(fy ? { flipY: true } : {}),
        },
      ]),
    ),
  },
}

describe("board 27 §6 flip H / V (rule K0t6s)", () => {
  test("golden + mirrored around the node centre, size positive", async () => {
    const scene = sceneOf(flipDoc)
    const engine = createLayoutEngine()
    await engine.init()
    r.setDocument(scene)
    const layout = engine.compute({
      nodes: scene.nodes,
      resolve: scene.resolve,
      measureText: r.textMeasurer(),
    })
    r.setLayout(layout)
    // The box stays where it was (W/H positive, world AABB unchanged).
    expect(layout.nodes.get("triF0002")?.world).toEqual({ x: 55, y: 5, w: 40, h: 40 })
    const bytes = await r.exportRaster("boardF001", { scale: 1 })
    golden("board27-flip", bytes)
    const p = pixels(bytes)
    const ink = (x: number, y: number) => near(p.at(x, y), "#E5177E", 30)
    // Unflipped: filled top-left corner.
    expect(ink(10, 10) && !ink(40, 40)).toBe(true)
    // flipX: top-right.
    expect(ink(90, 10) && !ink(60, 10)).toBe(true)
    // flipY: bottom-left.
    expect(ink(110, 40) && !ink(110, 10) === true).toBe(true)
    // Both: bottom-right.
    expect(ink(190, 40) && !ink(160, 10)).toBe(true)
    engine.dispose()
  })
})
