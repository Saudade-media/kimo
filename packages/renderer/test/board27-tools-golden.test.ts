/**
 * Board 27 §5 "Tools" renderer goldens (desing.pen ICb89 / J5Vng): polygon (6 sides) and star
 * (5 points, ratio 0.38) geometry with and without corner radius, the star's ratio / radius
 * handles + MeasurePill, and the path-edit "Selected Segment" (3 px selection). Each golden is
 * backed by measured pixel assertions against the node values.
 */
import { beforeAll, describe, expect, test } from "bun:test"
import type { CanvasKit } from "canvaskit-wasm"
import { CanvasKitRenderer, type Overlay } from "../src"
import { loadCanvasKit } from "../src/ck"
import { polygonPoints } from "../src/draw"
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
  return (x: number, y: number) => {
    const i = (y * w + x) * 4
    return [px[i] ?? 0, px[i + 1] ?? 0, px[i + 2] ?? 0, px[i + 3] ?? 0]
  }
}

const near = (c: readonly number[], hex: string, tol = 24) => {
  const n = Number.parseInt(hex.slice(1, 7), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].every(
    (v, i) => Math.abs(v - (c[i] ?? 0)) <= tol,
  )
}

const BG = "#F4F2EE"
/** ICb89 › Canvas nX9fE (360 × 250): Polygon XNJfY (30, 50, 130², #D9DEE6), Star kMmn5 (200, 50). */
const doc: TestDoc = {
  nodes: {
    canvas001: { type: "frame", parent: null, order: "a", x: 0, y: 0, w: 360, h: 250, fill: BG },
    poly00001: {
      type: "polygon",
      parent: "canvas001",
      order: "b",
      x: 30,
      y: 50,
      w: 130,
      h: 130,
      sides: 6,
      fill: "#D9DEE6",
    },
    star00001: {
      type: "polygon",
      parent: "canvas001",
      order: "c",
      x: 200,
      y: 50,
      w: 130,
      h: 130,
      sides: 5,
      star: {},
      fill: "#C9D7FF",
    },
  },
}
const rounded: TestDoc = {
  nodes: {
    canvas002: { type: "frame", parent: null, order: "a", x: 0, y: 0, w: 360, h: 250, fill: BG },
    poly00002: {
      type: "polygon",
      parent: "canvas002",
      order: "b",
      x: 30,
      y: 50,
      w: 130,
      h: 130,
      sides: 6,
      radius: 12,
      fill: "#D9DEE6",
    },
    star00002: {
      type: "polygon",
      parent: "canvas002",
      order: "c",
      x: 200,
      y: 50,
      w: 130,
      h: 130,
      sides: 5,
      radius: 4,
      star: { ratio: 0.5 },
      fill: "#C9D7FF",
    },
  },
}

function load(d: TestDoc) {
  const scene = sceneOf(d)
  r.setDocument(scene)
  r.setLayout(simpleLayout(scene, r.textMeasurer()))
}

describe("board 27 §5 polygon & star geometry", () => {
  test("polygonPoints: star = 2n vertices, inner midway on the ratio ellipse", () => {
    const p = polygonPoints(130, 130, 5, 0.38)
    expect(p.length).toBe(10)
    expect(p[0]).toEqual([65, 0])
    const i = p[1] as [number, number]
    expect(Math.hypot(i[0] - 65, i[1] - 65)).toBeCloseTo(24.7, 5)
    expect(polygonPoints(130, 130, 6).length).toBe(6)
  })

  test("b27-polygon-star golden + measured: hexagon and 5-point star, ratio 38 %", async () => {
    load(doc)
    const bytes = await r.exportRaster("canvas001", { scale: 1 })
    expect(compareGolden(ck, "b27-polygon-star", bytes).ok).toBe(true)
    const at = pixels(bytes)
    // Hexagon: vertex up at (95, 50); the centre is filled, the box corner is not.
    expect(near(at(95, 115), "#D9DEE6")).toBe(true)
    expect(near(at(95, 52), "#D9DEE6", 40)).toBe(true)
    expect(near(at(33, 53), BG)).toBe(true)
    // Star: the top point (265, 50) and the centre are filled; between two points (inner
    // vertex at r 24.7 from the centre, 36° off the top) outside the star is background.
    expect(near(at(265, 53), "#C9D7FF", 40)).toBe(true)
    expect(near(at(265, 115), "#C9D7FF")).toBe(true)
    const a = -Math.PI / 2 + Math.PI / 5
    const out = [265 + Math.cos(a) * 40, 115 + Math.sin(a) * 40].map(Math.round) as [number, number]
    expect(near(at(...out), BG)).toBe(true)
  })

  test("b27-polygon-star-rounded golden: radius rounds every vertex", async () => {
    load(rounded)
    const bytes = await r.exportRaster("canvas002", { scale: 1 })
    expect(compareGolden(ck, "b27-polygon-star-rounded", bytes).ok).toBe(true)
    const at = pixels(bytes)
    // The rounded hexagon's top vertex (95, 50) is cut off by the 12 px arc.
    expect(near(at(95, 51), BG)).toBe(true)
    expect(near(at(95, 115), "#D9DEE6")).toBe(true)
  })
})

describe("board 27 §5 overlays", () => {
  test("b27-star-handles golden: hollow ratio + filled radius handle, MeasurePill 38 %", () => {
    load(doc)
    r.attachRaster(360, 250, 1)
    r.setViewport({ x: 0, y: 0, zoom: 1 })
    const overlay: Overlay = {
      selection: ["star00001"],
      hovered: null,
      marquee: null,
      shapeHandles: {
        handles: [
          { at: { x: 265, y: 90 }, kind: "hollow" },
          { at: { x: 265, y: 63 }, kind: "filled" },
        ],
        pill: { text: "38 %", at: { x: 265, y: 90 } },
      },
    }
    r.setOverlay(overlay)
    const bytes = r.snapshot()
    r.detach()
    expect(compareGolden(ck, "b27-star-handles", bytes).ok).toBe(true)
    const at = pixels(bytes)
    const SEL = "#2F6BFF"
    // Ratio handle M2IQJ (261, 86, 8 × 8): white centre, selection ring.
    expect(near(at(265, 90), "#FFFFFF", 30)).toBe(true)
    expect(near(at(261, 90), SEL, 60)).toBe(true)
    // Radius handle gAuNj (261, 59): selection centre.
    expect(near(at(265, 63), SEL, 30)).toBe(true)
    // MeasurePill xP9Lo at (275, 80), 19 tall, selection fill.
    expect(near(at(277, 89), SEL, 30)).toBe(true)
    expect(near(at(277, 78), SEL, 30)).toBe(false)
  })

  test("b27-selected-segment golden: the clicked segment is 3 px selection", () => {
    const empty: TestDoc = {
      nodes: {
        canvas003: { type: "rect", parent: null, order: "a", x: 0, y: 0, w: 200, h: 100, fill: BG },
      },
    }
    load(empty)
    r.attachRaster(200, 100, 1)
    r.setViewport({ x: 0, y: 0, zoom: 1 })
    r.setOverlay({
      selection: [],
      hovered: null,
      marquee: null,
      pathEdit: {
        nodeId: "x",
        contours: [
          {
            closed: false,
            anchors: [
              { x: 20, y: 80 },
              { x: 100, y: 50 },
              { x: 180, y: 50 },
            ],
          },
        ],
        selected: [],
        selectedSegment: { contour: 0, index: 1 },
      },
    })
    const bytes = r.snapshot()
    r.detach()
    expect(compareGolden(ck, "b27-selected-segment", bytes).ok).toBe(true)
    const at = pixels(bytes)
    const SEL = "#2F6BFF"
    // Selected segment y = 50 from x 100 to 180: 3 px of coverage (48.5…51.5 at x 140; the
    // bg is opaque, so coverage = how far each row moved from the background to selection).
    const bg = at(140, 30)
    let cover = 0
    for (let y = 44; y < 56; y++) {
      const c = at(140, y)
      cover += Math.abs((c[0] ?? 0) - (bg[0] ?? 0)) / Math.abs(0x2f - (bg[0] ?? 0))
    }
    expect(cover).toBeGreaterThan(2.7)
    expect(cover).toBeLessThan(3.3)
    // The other segment keeps the 1 px outline.
    let thin = 0
    for (let x = 55; x < 65; x++)
      for (let y = 55; y < 75; y++) if (near(at(x, y), SEL, 60) && (at(x, y)[3] ?? 0) > 200) thin++
    expect(thin).toBeLessThan(25)
  })
})
