/**
 * M2 renderer goldens (ADR 0010): strokes, blends, effects, image/gradient paints, icons, the
 * core-schema `styling-m2.kimo` fixture through the real Yoga layout, and the board 10
 * overlays. Each overlay golden is backed by measured pixel assertions against the design
 * node values (positions/sizes from desing.pen nzfXx), not only the image comparison.
 */
import { beforeAll, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { openDocument } from "@kimo/core-schema"
import { createLayoutEngine, createResolver, nodeSourceFromDocument } from "@kimo/layout"
import type { CanvasKit } from "canvaskit-wasm"
import { CanvasKitRenderer, type Overlay, type RenderScene } from "../src"
import { loadCanvasKit } from "../src/ck"
import { blendDoc, effectsM2Doc, iconsDoc, paintsM2Doc, strokesM2Doc } from "./fixtures/m2"
import { VIGNETTES } from "./fixtures/overlays"
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
  r.setLayout(simpleLayout(scene, r.textMeasurer()))
  return scene
}

function golden(name: string, bytes: Uint8Array) {
  const res = compareGolden(ck, name, bytes)
  expect(res.message && res.ok).toBe(true)
}

/** Decoded RGBA rows of a PNG. */
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

const near = (a: readonly number[], hex: string, tol = 24) => {
  const n = Number.parseInt(hex.slice(1, 7), 16)
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  return c.every((v, i) => Math.abs(v - (a[i] ?? 0)) <= tol)
}

/** Bounding box of pixels matching `pred` inside `[x0, y0, x1, y1)`. */
function bbox(
  p: ReturnType<typeof pixels>,
  pred: (c: [number, number, number, number]) => boolean,
  [x0, y0, x1, y1]: [number, number, number, number],
) {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = -1
  let maxY = -1
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++)
      if (pred(p.at(x, y))) {
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

describe("M2 paint goldens (exportRaster, scale 2)", () => {
  for (const [name, doc, root] of [
    ["m2-strokes", strokesM2Doc, "boardS001"],
    ["m2-blend", blendDoc, "boardB001"],
    ["m2-effects", effectsM2Doc, "boardE001"],
    ["m2-paints", paintsM2Doc, "boardP001"],
    ["m2-icons", iconsDoc, "boardI001"],
  ] as const) {
    test(name, async () => {
      load(doc)
      golden(name, await r.exportRaster(root, { scale: 2 }))
    })
  }

  test("dashed per-side stroke: only t/b, real gaps (board 08 Hero Image, dash 4/2)", async () => {
    load(strokesM2Doc)
    const p = pixels(await r.exportRaster("hero00001", { scale: 4 }))
    // Top edge row (inside, 1px → 4 device px): dark dashes and light gaps alternate.
    let dark = 0
    let light = 0
    for (let x = 80; x < 320; x++) {
      const c = p.at(x, 1)
      if (c[3] > 200 && c[0] < 80) dark++
      else light++
    }
    expect(dark).toBeGreaterThan(60)
    expect(light).toBeGreaterThan(30)
    // No left/right side: the middle of the left edge is the fill.
    expect(near(p.at(1, 112), "#F4A261")).toBe(true)
  })

  test("miter limit 1 bevels the apex; 10 keeps the miter", async () => {
    load(strokesM2Doc)
    const bevel = pixels(await r.exportRaster("miter0001", { scale: 4 }))
    const miter = pixels(await r.exportRaster("miter0002", { scale: 4 }))
    void bevel
    void miter
    // Apex (54, 172) in the board: the miter tip reaches ~5px above it (6px stroke, 73.7°
    // corner → 1.67 × 3), the bevel only ~1.8px. Probe 3.5px above the apex (scale 2).
    const board = pixels(await r.exportRaster("boardS001", { scale: 2 }))
    expect(near(board.at(2 * 130, 2 * 168), "#1A1A1A", 40)).toBe(true) // miter0002 apex (130,172)
    expect(near(board.at(2 * 54, 2 * 168), "#FFFFFF", 40)).toBe(true) // miter0001 apex (54,172)
  })

  test("linear-burn (Plus darker) is max(0, a + b − 1), not multiply", async () => {
    const doc: TestDoc = {
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
    }
    load(doc)
    const c = pixelAt(ck, await r.exportRaster("lbboard01"), 2, 2)
    // 0.8 + 0.502 − 1 = 0.302 → 77; 0.4 + 0.502 − 1 < 0 → 0 (multiply would give 102, 51, 26).
    expect(Math.abs(c[0] - 77)).toBeLessThanOrEqual(2)
    expect(c[1]).toBeLessThanOrEqual(2)
    expect(c[2]).toBeLessThanOrEqual(2)
  })

  test("pass-through lets a child blend with the backdrop; a normal frame isolates it", async () => {
    load(blendDoc)
    const p = pixels(await r.exportRaster("boardB001"))
    // Ellipse centers: pass-through (56, 160) multiplies orange over blue; isolated (234, 160) stays orange.
    const pass = p.at(56, 160)
    const iso = p.at(234, 160)
    expect(near(iso, "#F5A623")).toBe(true)
    expect(pass[0]).toBeLessThan(80) // multiply(F5, 2F) red ≈ 45
  })

  test("hidden effects are not drawn; visible ones are", async () => {
    load(effectsM2Doc)
    const p = pixels(await r.exportRaster("boardE001"))
    // Hidden blur off: the rect's center is the solid fill; the hard 6/6 shadow is drawn.
    expect(near(p.at(56, 128), "#7B61FF", 4)).toBe(true)
    expect(near(p.at(91, 156), "#1A1A1A", 8)).toBe(true)
  })

  test("background blur works under an opacity < 1 node (backdrop read before the layer)", async () => {
    load(effectsM2Doc)
    const p = pixels(await r.exportRaster("boardE001"))
    // Inside the glass at a stripe edge, colors are mixed (blurred), not the hard stripe.
    const c = p.at(140, 236)
    expect(c[0] + c[1] + c[2]).toBeGreaterThan(150)
  })

  test("image crop shows the cropped region (top-left quadrant = red)", async () => {
    load(paintsM2Doc)
    const p = pixels(await r.exportRaster("imgcrp001"))
    expect(near(p.at(36, 28), "#FF3333", 30)).toBe(true)
    expect(near(p.at(60, 44), "#FF3333", 30)).toBe(true)
  })
})

describe("styling-m2.kimo through the Yoga layout", () => {
  test("renders the board 08 styling fixture", async () => {
    const text = readFileSync(
      join(import.meta.dir, "../../core-schema/fixtures/valid/styling-m2.kimo"),
      "utf8",
    )
    const doc = openDocument(text).doc
    const nodes = nodeSourceFromDocument(doc)
    const scene: RenderScene = {
      nodes,
      header: doc,
      resolve: createResolver(doc, nodes),
      assets: { load: async () => null },
    }
    const engine = createLayoutEngine()
    await engine.init()
    r.setDocument(scene)
    r.setLayout(engine.compute({ nodes, resolve: scene.resolve, measureText: r.textMeasurer() }))
    golden("m2-styling-fixture", await r.exportRaster("Board00002", { scale: 1 }))
    engine.dispose()
  })
})

describe("board 10 overlays (attachRaster, dpr 1)", () => {
  const shots = new Map<string, ReturnType<typeof pixels>>()
  const shot = (name: keyof typeof VIGNETTES, patch?: Partial<Overlay>) => {
    const vg = VIGNETTES[name]
    load(vg.doc)
    r.attachRaster(vg.width, vg.height, vg.dpr ?? 1)
    r.setViewport(vg.viewport)
    r.setOverlay({ ...vg.overlay, ...patch })
    const bytes = r.snapshot()
    r.detach()
    return bytes
  }
  for (const name of Object.keys(VIGNETTES) as (keyof typeof VIGNETTES)[]) {
    test(name, () => {
      const bytes = shot(name)
      golden(name, bytes)
      shots.set(name, pixels(bytes))
    })
  }

  const MEASURE = "#E5177E"
  const isMeasure = (c: number[]) => near(c, MEASURE, 40) && (c[3] ?? 0) > 200

  test("#1 snap guide: 1px measure line spanning the objects + 8px, × markers 7px", () => {
    const p = pixels(shot("overlay-snapping"))
    // Guide for y = 128 from x 80−8 to 560+8 (design k4EEW: x 72, w 496, h 1), crisp 1 row.
    const g = bbox(p, isMeasure, [0, 126, 640, 131])
    expect(g).not.toBeNull()
    expect(g?.x).toBe(72)
    expect((g?.x ?? 0) + (g?.w ?? 0)).toBe(568)
    const midRow = bbox(p, isMeasure, [200, 200, 300, 216]) // the y = 208 guide over the image
    expect(midRow?.h).toBe(1)
    // Marker on (80, 208) (design u3o3JX: 76.5…83.5): upper half of the ×, off the guide row.
    const m = bbox(p, (c) => near(c, MEASURE, 40) && c[3] > 60, [70, 200, 90, 208])
    expect(m?.w).toBeGreaterThanOrEqual(6)
    expect(m?.w).toBeLessThanOrEqual(8)
    expect(Math.abs((m?.x ?? 0) + (m?.w ?? 0) / 2 - 80.5)).toBeLessThanOrEqual(1)
  })

  test("#2 equal spacing: tinted gap, ticks 1×10 inside the gap, pill 30×19 for '48'", () => {
    const p = pixels(shot("overlay-spacing"))
    // Pill column at its center: 19 tall from y 201 (design VG8Eq: y 201, h 19).
    const pill = bbox(p, isMeasure, [222, 190, 223, 230])
    expect(pill?.y).toBe(201)
    expect(pill?.h).toBe(19)
    // Left tick at x 200 (design Q9RyVV: x 200, y 205, 1×10).
    const tick = bbox(p, isMeasure, [199, 200, 201, 220])
    expect(tick).toEqual({ x: 200, y: 205, w: 1, h: 10 })
    // Gap tint (measure-soft over #FFF7EE) between 200 and 248 away from the line.
    const soft = p.at(224, 160)
    expect(soft[1]).toBeLessThan(235)
    expect(soft[0]).toBeGreaterThan(240)
  })

  test("#3a sibling hovered: measure outline replaces the hover outline; pill 30 wide", () => {
    const p = pixels(shot("overlay-measure-sibling"))
    expect(isMeasure(p.at(470, 178))).toBe(true) // top edge of the hovered link, inside 1px
    expect(near(p.at(470, 178), "#2F6BFF", 60)).toBe(false)
    const pill = bbox(p, isMeasure, [390, 180, 391, 210])
    expect(pill?.h).toBe(19)
  })

  test("#3b parent outline at opacity 0.5; '120' pill is 36 wide", () => {
    const p = pixels(shot("overlay-measure-parent"))
    // "90" sits on a vertical line, so its center row shows the full pill: 30 wide
    // (design IXKbh: x 265, w 30; ±1 for the line's pixel snap).
    const p90 = bbox(p, isMeasure, [250, 125, 310, 126])
    expect(p90?.w).toBe(30)
    expect(Math.abs((p90?.x ?? 0) - 265)).toBeLessThanOrEqual(1)
    // "122" → 36 wide (design kehPD: x 262, w 36).
    const p122 = bbox(p, isMeasure, [250, 279, 310, 280])
    expect(p122?.w).toBe(36)
    const edge = p.at(320, 80) // parent outline top edge (white card below 50% measure)
    expect(edge[1]).toBeGreaterThan(100)
    expect(edge[0]).toBeGreaterThan(200)
  })

  test("#4 pixel grid above 400%: 1 device px lines every world unit; off at 400%", () => {
    const on = pixels(shot("overlay-pixel-grid"))
    // Paper area (white) left of the shape: grid line at x = 8 (world 1), none at x = 12;
    // #0A0A0A14 over white = #ECECEC, exactly one device pixel wide.
    const line = on.at(8, 44)
    const cell = on.at(12, 44)
    expect(near(line, "#ECECEC", 2)).toBe(true)
    expect(near(cell, "#FFFFFF", 0)).toBe(true)
    expect(on.at(9, 44)).toEqual(cell)
    expect(on.at(7, 44)).toEqual(cell)
    const off = pixels(shot("overlay-pixel-grid", { pixelGrid: false }))
    expect(off.at(8, 44)).toEqual(cell)
    const half = pixels(shot("overlay-pixel-grid", { pixelGrid: 0.5 }))
    expect(half.at(8, 44)[0]).toBeGreaterThan(line[0])
    const vg = VIGNETTES["overlay-pixel-grid"]
    load(vg.doc)
    r.attachRaster(200, 100, 1)
    r.setViewport({ x: 0, y: 0, zoom: 4 })
    r.setOverlay({ ...vg.overlay, cursorBadge: null, selection: [] })
    const at4 = pixels(r.snapshot())
    r.detach()
    expect(at4.at(8, 20)).toEqual(at4.at(10, 20))
  })

  test("#5 pen: anchors 7×7, active filled, close ring 14 on the first anchor", () => {
    const p = pixels(shot("overlay-pen"))
    const sel = (c: number[]) => near(c, "#2F6BFF", 70) && (c[3] ?? 0) > 100
    // Active anchor (design fl5UN: 376.5…383.5 × 246.5…253.5): column / top row probes avoid
    // the handle line through its center.
    expect(bbox(p, sel, [380, 240, 381, 260])?.h).toBe(7)
    expect(bbox(p, sel, [370, 247, 390, 248])?.w).toBe(7)
    expect(near(p.at(380, 250), "#2F6BFF", 30)).toBe(true) // filled
    expect(near(p.at(240, 140), "#FFFFFF", 30)).toBe(true) // regular anchor: white center
    const ring = bbox(p, sel, [108, 280, 133, 301])
    expect(ring?.w).toBe(14)
  })

  test("#6 path edit: vertex badge at anchor + (16, −14); selection chrome hidden", () => {
    const p = pixels(shot("overlay-path-edit"))
    const badge = bbox(p, (c) => near(c, "#2F6BFF", 20) && c[3] > 250, [470, 160, 560, 190])
    expect(badge?.x).toBe(476)
    expect(badge?.y).toBe(166)
    expect(badge?.h).toBe(19)
  })

  test("#8 resize: sizing badges 7px above the selection, delta badge at (564, 222)", () => {
    const p = pixels(shot("overlay-resize"))
    // "Fixed 48" (design OqbiC: x 101.5, y 144, 69 × 19) centered on the avatar (x 136).
    // selection-soft (#2F6BFF1A) over #FFF7EE = #EAE9F0.
    const fixed = bbox(p, (c) => near(c, "#EAE9F0", 3), [90, 140, 185, 166])
    expect(fixed?.y).toBe(144)
    expect((fixed?.y ?? 0) + (fixed?.h ?? 0)).toBe(163)
    const cx = (fixed?.x ?? 0) + (fixed?.w ?? 0) / 2
    expect(Math.abs(cx - 136)).toBeLessThanOrEqual(1)
    const delta = bbox(
      p,
      (c) => c[0] < 20 && c[1] < 20 && c[2] < 20 && c[3] > 250,
      [560, 215, 620, 245],
    )
    expect(delta?.x).toBe(564)
    expect(delta?.y).toBe(222)
    // Ghost edge: dashed 1px at x 500 from 162 to 258 (design GV63U).
    const ghost = bbox(p, (c) => near(c, "#2F6BFF", 60) && c[3] > 100, [498, 150, 503, 168])
    expect(ghost?.y).toBe(162)
    expect(ghost?.w).toBe(1)
  })
})
