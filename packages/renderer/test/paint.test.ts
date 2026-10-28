/**
 * Pixel-level paint behavior that the golden images do not pin down: blend modes, effects,
 * image crop, polygon / star geometry and flips.
 */
import { beforeAll, describe, expect, test } from "bun:test"
import { createLayoutEngine } from "@kimo/layout"
import type { CanvasKit } from "canvaskit-wasm"
import { CanvasKitRenderer } from "../src"
import { loadCanvasKit } from "../src/ck"
import { polygonPoints } from "../src/draw"
import { effectsDoc } from "./fixtures/effects-icons"
import { near, pixelAt, pixelsOf } from "./helpers/golden"
import { quadrantPng } from "./helpers/png"
import { sceneOf, simpleLayout, type TestDoc } from "./helpers/scene"

let ck: CanvasKit
let png: Uint8Array
const r = new CanvasKitRenderer()

beforeAll(async () => {
  await r.init({ offlineFonts: true })
  ck = await loadCanvasKit()
  png = quadrantPng(ck) // 40 × 20: red TL, green TR, blue BL, yellow BR
})

const IMG = "./assets/0123456789abcdef.png"

function load(doc: TestDoc) {
  const scene = sceneOf(doc, { [IMG]: png })
  r.setDocument(scene)
  r.setLayout(simpleLayout(scene, r.textMeasurer()))
  return scene
}

describe("blend modes", () => {
  test("linear-burn (Plus darker) is max(0, a + b − 1), not multiply", async () => {
    load({
      nodes: {
        lbboard01: {
          type: "frame",
          parent: null,
          order: "a",
          x: 0,
          y: 0,
          w: 4,
          h: 4,
          fill: "#808080",
        },
        lbrect001: {
          type: "rect",
          parent: "lbboard01",
          order: "a",
          x: 0,
          y: 0,
          w: 4,
          h: 4,
          blend: "linear-burn",
          fill: "#CC6633",
        },
      },
    })
    const c = pixelAt(ck, await r.exportRaster("lbboard01"), 2, 2)
    // 0.8 + 0.502 − 1 = 0.302 → 77; 0.4 + 0.502 − 1 < 0 → 0 (multiply would give 102, 51, 26).
    expect(Math.abs(c[0] - 77)).toBeLessThanOrEqual(2)
    expect(c[1]).toBeLessThanOrEqual(2)
    expect(c[2]).toBeLessThanOrEqual(2)
  })

  test("pass-through lets a child blend with the backdrop; a normal frame isolates it", async () => {
    const group = (id: string, x: number, blend?: string) => ({
      [id]: {
        type: "frame",
        parent: "passboard",
        order: id,
        x,
        y: 10,
        w: 80,
        h: 40,
        ...(blend ? { blend } : {}),
      },
      [`${id}child`]: {
        type: "ellipse",
        parent: id,
        order: "a",
        x: 8,
        y: 4,
        w: 64,
        h: 32,
        fill: { kind: "solid", color: "#F5A623", blend: "multiply" },
      },
    })
    load({
      nodes: {
        passboard: {
          type: "frame",
          parent: null,
          order: "a",
          x: 0,
          y: 0,
          w: 200,
          h: 60,
          fill: "#FFFFFF",
        },
        under0001: {
          type: "rect",
          parent: "passboard",
          order: "0",
          x: 0,
          y: 0,
          w: 200,
          h: 60,
          fill: "#2F6BFF",
        },
        ...group("passgrp01", 10, "pass-through"),
        ...group("isolgrp01", 110),
      },
    })
    const p = pixelsOf(ck, await r.exportRaster("passboard"))
    // Pass-through multiplies orange over the blue backdrop; the isolated frame keeps it orange.
    expect(p.at(50, 30)[0]).toBeLessThan(80)
    expect(near(p.at(150, 30), "#F5A623")).toBe(true)
  })
})

describe("effects", () => {
  test("hidden effects are not drawn; visible ones are", async () => {
    load(effectsDoc)
    const p = pixelsOf(ck, await r.exportRaster("boardE001"))
    // Hidden blur off: the rect's center is the solid fill; the hard 6/6 shadow is drawn.
    expect(near(p.at(56, 128), "#7B61FF", 4)).toBe(true)
    expect(near(p.at(91, 156), "#1A1A1A", 8)).toBe(true)
  })

  test("background blur works under an opacity < 1 node (backdrop read before the layer)", async () => {
    load(effectsDoc)
    const p = pixelsOf(ck, await r.exportRaster("boardE001"))
    // Inside the glass at a stripe edge, colors are mixed (blurred), not the hard stripe.
    const c = p.at(140, 236)
    expect(c[0] + c[1] + c[2]).toBeGreaterThan(150)
  })
})

describe("image crop", () => {
  const RED = "#FF3333"
  const GREEN = "#33B34D"
  const BLUE = "#3366FF"
  const YELLOW = "#FFCC1A"

  async function shot(fill: unknown) {
    load({
      nodes: {
        bg: { type: "rect", parent: null, x: 0, y: 0, w: 320, h: 220, fill: "#FFFFFF" },
        img: { type: "rect", parent: null, x: 40, y: 30, w: 240, h: 120, fill },
      },
    })
    expect(await r.imageSize(IMG)).toEqual({ width: 40, height: 20 })
    r.attachRaster(320, 220, 1)
    r.setViewport({ x: 0, y: 0, zoom: 1 })
    r.setOverlay({ selection: [], hovered: null, marquee: null })
    const p = pixelsOf(ck, r.snapshot())
    r.detach()
    return p
  }

  test("crop region is stretched to the box; absent crop shows the whole image", async () => {
    const right = await shot({ kind: "image", src: IMG, fit: "crop", crop: [0.5, 0, 0, 1, 0.5, 0] })
    // Right half: green over yellow, each filling half the box height.
    expect(near(right.at(160, 60), GREEN, 6)).toBe(true)
    expect(near(right.at(160, 120), YELLOW, 6)).toBe(true)
    const whole = await shot({ kind: "image", src: IMG, fit: "crop" })
    expect(near(whole.at(60, 40), RED, 6)).toBe(true)
    expect(near(whole.at(260, 40), GREEN, 6)).toBe(true)
    expect(near(whole.at(60, 140), BLUE, 6)).toBe(true)
    expect(near(whole.at(260, 140), YELLOW, 6)).toBe(true)
  })
})

describe("polygon and star", () => {
  const BG = "#F4F2EE"
  const canvas = (id: string, poly: Record<string, unknown>, star: Record<string, unknown>) => ({
    nodes: {
      [id]: { type: "frame", parent: null, order: "a", x: 0, y: 0, w: 360, h: 250, fill: BG },
      poly00001: {
        type: "polygon",
        parent: id,
        order: "b",
        x: 30,
        y: 50,
        w: 130,
        h: 130,
        sides: 6,
        fill: "#D9DEE6",
        ...poly,
      },
      star00001: {
        type: "polygon",
        parent: id,
        order: "c",
        x: 200,
        y: 50,
        w: 130,
        h: 130,
        sides: 5,
        fill: "#C9D7FF",
        ...star,
      },
    },
  })

  test("polygonPoints: a star has 2n vertices, inner ones on the ratio ellipse", () => {
    const p = polygonPoints(130, 130, 5, 0.38)
    expect(p.length).toBe(10)
    expect(p[0]).toEqual([65, 0])
    const i = p[1] as [number, number]
    expect(Math.hypot(i[0] - 65, i[1] - 65)).toBeCloseTo(24.7, 5)
    expect(polygonPoints(130, 130, 6).length).toBe(6)
  })

  test("hexagon and star fill their shape; radius rounds every vertex", async () => {
    load(canvas("canvas001", {}, { star: {} }))
    let at = pixelsOf(ck, await r.exportRaster("canvas001", { scale: 1 })).at
    // Hexagon: vertex up at (95, 50); the centre is filled, the box corner is not.
    expect(near(at(95, 115), "#D9DEE6")).toBe(true)
    expect(near(at(95, 52), "#D9DEE6", 40)).toBe(true)
    expect(near(at(33, 53), BG)).toBe(true)
    // Star: the top point and the centre are filled; between two points is background.
    expect(near(at(265, 53), "#C9D7FF", 40)).toBe(true)
    expect(near(at(265, 115), "#C9D7FF")).toBe(true)
    const a = -Math.PI / 2 + Math.PI / 5
    const out = [265 + Math.cos(a) * 40, 115 + Math.sin(a) * 40].map(Math.round) as [number, number]
    expect(near(at(...out), BG)).toBe(true)

    load(canvas("canvas002", { radius: 12 }, { radius: 4, star: { ratio: 0.5 } }))
    at = pixelsOf(ck, await r.exportRaster("canvas002", { scale: 1 })).at
    // The rounded hexagon's top vertex (95, 50) is cut off by the 12 px arc.
    expect(near(at(95, 51), BG)).toBe(true)
    expect(near(at(95, 115), "#D9DEE6")).toBe(true)
  })
})

describe("flip H / V", () => {
  test("mirrors the paint around the node centre; size stays positive", async () => {
    const tri = (id: string, x: number, flip: Record<string, boolean>, i: number) => [
      id,
      {
        type: "path",
        parent: "boardF001",
        order: `a${i}`,
        x: x + 5,
        y: 5,
        w: 40,
        h: 40,
        d: "M0 0L40 0L0 40Z",
        viewBox: [0, 0, 40, 40],
        fill: "#E5177E",
        ...flip,
      },
    ]
    const scene = sceneOf({
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
        ...Object.fromEntries([
          tri("triF0001", 0, {}, 0),
          tri("triF0002", 50, { flipX: true }, 1),
          tri("triF0003", 100, { flipY: true }, 2),
          tri("triF0004", 150, { flipX: true, flipY: true }, 3),
        ]),
      },
    })
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
    const p = pixelsOf(ck, await r.exportRaster("boardF001", { scale: 1 }))
    const ink = (x: number, y: number) => near(p.at(x, y), "#E5177E", 30)
    // The filled corner is top-left, top-right, bottom-left, bottom-right.
    expect(ink(10, 10) && !ink(40, 40)).toBe(true)
    expect(ink(90, 10) && !ink(60, 10)).toBe(true)
    expect(ink(110, 40) && !ink(110, 10)).toBe(true)
    expect(ink(190, 40) && !ink(160, 10)).toBe(true)
    engine.dispose()
  })
})
