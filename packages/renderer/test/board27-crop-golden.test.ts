/**
 * Board 27 §6 (d) image crop (VCSml): fit "crop" paints (the `crop` region stretched to the box;
 * absent crop = the whole image) and the crop-mode overlay (whole source, dim #14141499 outside
 * the box, white box + thirds, 3 px brackets / edge bars, MeasurePill 10 under the box). Golden
 * images plus measured pixels against the node values of stage ud74f.
 */
import { beforeAll, describe, expect, test } from "bun:test"
import type { CanvasKit } from "canvaskit-wasm"
import { CanvasKitRenderer, OVERLAY_SPEC_CROP } from "../src"
import { loadCanvasKit } from "../src/ck"
import { compareGolden } from "./helpers/golden"
import { quadrantPng } from "./helpers/png"
import { sceneOf, simpleLayout, type TestDoc } from "./helpers/scene"

const IMG = "./assets/0123456789abcdef.png"
let ck: CanvasKit
let png: Uint8Array
const r = new CanvasKitRenderer()

beforeAll(async () => {
  await r.init({ offlineFonts: true })
  ck = await loadCanvasKit()
  png = quadrantPng(ck) // 40 × 20: red TL, green TR, blue BL, yellow BR
})

async function load(doc: TestDoc) {
  const scene = sceneOf(doc, { [IMG]: png })
  r.setDocument(scene)
  r.setLayout(simpleLayout(scene, r.textMeasurer()))
  expect(await r.imageSize(IMG)).toEqual({ width: 40, height: 20 })
}

function pixels(bytes: Uint8Array) {
  const img = ck.MakeImageFromEncoded(bytes)
  if (!img) throw new Error("png")
  const w = img.width()
  const px = img.readPixels(0, 0, {
    width: w,
    height: img.height(),
    colorType: ck.ColorType.RGBA_8888,
    alphaType: ck.AlphaType.Unpremul,
    colorSpace: ck.ColorSpace.SRGB,
  }) as Uint8Array
  img.delete()
  return (x: number, y: number) => {
    const i = (y * w + x) * 4
    return [px[i] ?? 0, px[i + 1] ?? 0, px[i + 2] ?? 0, px[i + 3] ?? 0]
  }
}

const near = (a: readonly number[], b: readonly number[], tol = 6) =>
  b.every((v, i) => Math.abs(v - (a[i] ?? 0)) <= tol)

const RED = [255, 51, 51]
const GREEN = [51, 179, 77]
const BLUE = [51, 102, 255]
const YELLOW = [255, 204, 26]
/** `c` under the #14141499 dim (alpha 0x99). */
const dimmed = (c: number[]) => c.map((v) => Math.round(v * (1 - 0x99 / 255) + 0x14 * (0x99 / 255)))

const doc = (fill: unknown): TestDoc => ({
  nodes: {
    bg: { type: "rect", parent: null, x: 0, y: 0, w: 320, h: 220, fill: "#FFFFFF" },
    img: { type: "rect", parent: null, x: 40, y: 30, w: 240, h: 120, fill },
  },
})

function shot(overlay?: Parameters<CanvasKitRenderer["setOverlay"]>[0]) {
  r.attachRaster(320, 220, 1)
  r.setViewport({ x: 0, y: 0, zoom: 1 })
  r.setOverlay(overlay ?? { selection: [], hovered: null, marquee: null })
  const bytes = r.snapshot()
  r.detach()
  return bytes
}

describe("board 27 crop: fit crop paint", () => {
  test("crop region stretched to the box; absent crop = the whole image", async () => {
    await load(doc({ kind: "image", src: IMG, fit: "crop", crop: [0.5, 0, 0, 1, 0.5, 0] }))
    const right = pixels(shot())
    // Right half: green over yellow, each filling half the box height.
    expect(near(right(160, 60), GREEN)).toBe(true)
    expect(near(right(160, 120), YELLOW)).toBe(true)
    expect(near(right(50, 40), GREEN)).toBe(true)
    await load(doc({ kind: "image", src: IMG, fit: "crop" }))
    const whole = pixels(shot())
    expect(near(whole(60, 40), RED)).toBe(true)
    expect(near(whole(260, 40), GREEN)).toBe(true)
    expect(near(whole(60, 140), BLUE)).toBe(true)
    expect(near(whole(260, 140), YELLOW)).toBe(true)
  })
})

describe("board 27 crop: crop-mode overlay", () => {
  test("whole source, dim, box, thirds, brackets, MeasurePill", async () => {
    // Paint hidden on the layer (the host does this); the overlay draws the source.
    await load(doc({ kind: "image", src: IMG, visible: false }))
    // Image px → screen: ×6 at (40, 30): 240 × 120. Crop (10, 5, 20, 10) → box (100, 60)–(220, 120).
    const bytes = shot({
      selection: [],
      hovered: null,
      marquee: null,
      crop: {
        src: IMG,
        imageWidth: 40,
        imageHeight: 20,
        imageToScreen: [6, 0, 0, 6, 40, 30],
        box: [
          { x: 100, y: 60 },
          { x: 220, y: 60 },
          { x: 220, y: 120 },
          { x: 100, y: 120 },
        ],
        label: "20 × 10",
      },
    })
    const ok = compareGolden(ck, "board27-crop-overlay", bytes)
    expect(ok.message && ok.ok).toBe(true)
    const at = pixels(bytes)
    // Dim outside the box (#14141499 over the source).
    expect(near(at(50, 35), dimmed(RED), 8)).toBe(true)
    expect(near(at(270, 145), dimmed(YELLOW), 8)).toBe(true)
    // Inside the box: the source, undimmed (away from thirds).
    expect(near(at(110, 70), RED)).toBe(true)
    expect(near(at(210, 110), YELLOW)).toBe(true)
    // Crop Box: white 1 px inside the box edge.
    expect(near(at(150, 60), [255, 255, 255], 2)).toBe(true)
    expect(near(at(100, 85), [255, 255, 255], 2)).toBe(true)
    // Thirds (#FFFFFF59) at x = 100 + 120/3 = 140.
    const third = at(140, 75)
    expect(third[0]).toBeGreaterThan((RED[0] as number) - 1)
    expect(third[1]).toBeGreaterThan(110) // 51 → ~117 under 35% white
    // Bracket TL h: (97, 57) 16 × 3 white, outside the box.
    expect(near(at(97, 57), [255, 255, 255], 2)).toBe(true)
    expect(near(at(112, 59), [255, 255, 255], 2)).toBe(true)
    expect(near(at(113, 57), dimmed(RED), 8)).toBe(true)
    // Bracket BR v: (220, 107) 3 × 16; edge bar T at (152, 57) 16 × 3.
    expect(near(at(222, 122), [255, 255, 255], 2)).toBe(true)
    expect(near(at(160, 58), [255, 255, 255], 2)).toBe(true)
    // MeasurePill: selection (#2F6BFF) fill, top 10 under the box (y 130 … 149), centered at 160.
    expect(
      near(at(160, 132), [0x2f, 0x6b, 0xff], 4) || near(at(150, 132), [0x2f, 0x6b, 0xff], 4),
    ).toBe(true)
    // Gap above the pill: still the dimmed source (yellow half).
    expect(near(at(200, 128), dimmed(YELLOW), 8)).toBe(true)
    expect(OVERLAY_SPEC_CROP.pill.offset).toBe(10)
  })
})
