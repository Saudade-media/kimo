import { beforeAll, describe, expect, test } from "bun:test"
import type { TextMeasurer } from "@kimo/layout"
import { CanvasKitRenderer } from "../src"
import { HitIndex } from "../src/hit-test"
import { sceneOf, simpleLayout, type TestDoc } from "./helpers/scene"

const n = (o: Record<string, unknown>) => o
const doc: TestDoc = {
  nodes: {
    frameF0001: n({
      type: "frame",
      parent: null,
      order: "a",
      x: 0,
      y: 0,
      w: 200,
      h: 200,
      clip: true,
      fill: "#fff",
    }),
    rectA0001: n({
      type: "rect",
      parent: "frameF0001",
      order: "a",
      x: 10,
      y: 10,
      w: 50,
      h: 50,
      radius: 25,
    }),
    ellipE0001: n({
      type: "ellipse",
      parent: "frameF0001",
      order: "b",
      x: 100,
      y: 10,
      w: 60,
      h: 40,
    }),
    rectO0001: n({
      type: "rect",
      parent: "frameF0001",
      order: "c",
      x: 150,
      y: 150,
      w: 100,
      h: 100,
    }),
    rectL0001: n({
      type: "rect",
      parent: "frameF0001",
      order: "d",
      x: 10,
      y: 100,
      w: 40,
      h: 40,
      locked: true,
    }),
    rectH0001: n({
      type: "rect",
      parent: "frameF0001",
      order: "e",
      x: 60,
      y: 100,
      w: 40,
      h: 40,
      visible: false,
    }),
    ringR0001: n({
      type: "ellipse",
      parent: "frameF0001",
      order: "f",
      x: 100,
      y: 100,
      w: 40,
      h: 40,
      innerRadius: 0.5,
    }),
    arcC00001: n({
      type: "ellipse",
      parent: "frameF0001",
      order: "g",
      x: 150,
      y: 60,
      w: 40,
      h: 40,
      startAngle: 0,
      sweepAngle: 90,
    }),
    rectT0001: n({
      type: "rect",
      parent: null,
      order: "b",
      x: 300,
      y: 0,
      w: 100,
      h: 20,
      rotation: 90,
    }),
    frameK0001: n({
      type: "frame",
      parent: null,
      order: "c",
      x: 500,
      y: 0,
      w: 100,
      h: 100,
      locked: true,
    }),
    rectK0001: n({ type: "rect", parent: "frameK0001", order: "a", x: 10, y: 10, w: 20, h: 20 }),
  },
}

const fakeMeasure: TextMeasurer = { measure: () => ({ w: 10, h: 10 }) }
const scene = sceneOf(doc)
const layout = simpleLayout(scene, fakeMeasure)
const idx = new HitIndex(layout, scene.nodes, scene.resolve)
const at = (x: number, y: number, o = {}) => idx.point({ x, y }, 0, o)

describe("HitIndex.point", () => {
  test("rounded rect: center hits, outside-the-radius corner falls through to the frame", () => {
    expect(at(35, 35)).toEqual(["rectA0001", "frameF0001"])
    expect(at(11, 11)).toEqual(["frameF0001"])
  })
  test("ellipse is exact", () => {
    expect(at(130, 30)).toEqual(["ellipE0001", "frameF0001"])
    expect(at(101, 11)).toEqual(["frameF0001"])
  })
  test("ring hole and arc sweep", () => {
    expect(at(120, 120)).toEqual(["frameF0001"])
    expect(at(103, 120)).toEqual(["ringR0001", "frameF0001"])
    // arc 0→90° CCW = top-right quadrant only
    expect(at(180, 70)).toEqual(["arcC00001", "frameF0001"])
    expect(at(160, 90)).toEqual(["frameF0001"])
  })
  test("ancestor clip hides overflow", () => {
    expect(at(175, 175)).toEqual(["rectO0001", "frameF0001"])
    expect(at(225, 225)).toEqual([])
  })
  test("locked (own and inherited) and hidden are skipped unless included", () => {
    expect(at(30, 120)).toEqual(["frameF0001"])
    expect(at(30, 120, { includeLocked: true })).toEqual(["rectL0001", "frameF0001"])
    expect(at(80, 120)).toEqual(["frameF0001"])
    expect(at(80, 120, { includeHidden: true })).toEqual(["rectH0001", "frameF0001"])
    expect(at(520, 20)).toEqual([])
    expect(at(520, 20, { includeLocked: true })).toEqual(["rectK0001", "frameK0001"])
  })
  test("rotation (CCW about the top-left)", () => {
    expect(at(310, -50)).toEqual(["rectT0001"])
    expect(at(350, 10)).toEqual([])
  })
  test("within restricts candidates", () => {
    expect(at(35, 35, { within: new Set(["rectA0001"]) })).toEqual(["rectA0001"])
  })
  test("tolerance", () => {
    expect(idx.point({ x: 61, y: 35 }, 0)).toEqual(["frameF0001"])
    expect(idx.point({ x: 61, y: 35 }, 2)).toEqual(["rectA0001", "frameF0001"])
  })
})

describe("HitIndex.rect", () => {
  test("intersect vs contain", () => {
    expect(idx.rect({ x: 0, y: 0, w: 70, h: 70 })).toEqual(["rectA0001", "frameF0001"])
    expect(idx.rect({ x: 0, y: 0, w: 70, h: 70 }, { mode: "contain" })).toEqual(["rectA0001"])
  })
  test("clipped-away parts don't intersect", () => {
    expect(idx.rect({ x: 210, y: 210, w: 20, h: 20 })).toEqual([])
  })
})

describe("Renderer.hitTest maps screen through the viewport", () => {
  const r = new CanvasKitRenderer()
  beforeAll(async () => {
    await r.init({ offlineFonts: true })
    r.setDocument(scene)
    r.setLayout(layout)
  })
  test("zoom 2 + pan", () => {
    r.setViewport({ x: -10, y: -10, zoom: 2 })
    // world (35,35) → screen ((35+10)*2, …) = (90, 90)
    expect(r.hitTest({ x: 90, y: 90 })).toEqual(["rectA0001", "frameF0001"])
    expect(r.screenToWorld({ x: 90, y: 90 })).toEqual({ x: 35, y: 35 })
    expect(r.worldToScreen({ x: 35, y: 35 })).toEqual({ x: 90, y: 90 })
    // tolerance is in screen px: 2 px at zoom 2 = 1 world unit
    expect(r.hitTest({ x: (60.8 + 10) * 2, y: 90 }, { tolerance: 2 })).toEqual([
      "rectA0001",
      "frameF0001",
    ])
    expect(r.hitTest({ x: (61.5 + 10) * 2, y: 90 }, { tolerance: 2 })).toEqual(["frameF0001"])
    expect(r.hitTestRect({ x: 0, y: 0, w: 160, h: 160 }, { mode: "contain" })).toEqual([
      "rectA0001",
    ])
  })
})
