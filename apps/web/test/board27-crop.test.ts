/**
 * Board 27 §6 (d) image crop mode (VCSml, rules R6uRRw): crop math and the canvas crop mode
 * behind a fake host (enter, drag edges / corners with ⇧, pan, panel rect, reset, apply, Esc).
 */
import { describe, expect, test } from "bun:test"
import type { NodeData, Op } from "@kimo/editor-state"
import type { LayoutResult, Matrix } from "@kimo/layout"
import type { UiStore } from "../src/canvas/contract"
import {
  affineToCrop,
  type CropSession,
  clampRect,
  coverRect,
  cropHandleAt,
  cropSizeLabel,
  cropStore,
  cropToAffine,
  initialCrop,
  panCrop,
  resizeCrop,
} from "../src/canvas/crop"
import {
  CropMode,
  croppedPaint,
  imagePaints,
  topImagePaint,
  writePaintOps,
} from "../src/canvas/crop-mode"

const IMG = "./assets/0123456789abcdef.png"

describe("crop math", () => {
  test("affine round trip ([w, 0, 0, h, x, y] normalized)", () => {
    const r = { x: 480, y: 210, w: 1440, h: 960 }
    const m = cropToAffine(r, 2400, 1600)
    expect(m).toEqual([0.6, 0, 0, 0.6, 0.2, 0.13125])
    expect(affineToCrop(m, 2400, 1600)).toEqual(r)
    expect(affineToCrop([1, 0.2, 0, 1, 0, 0], 10, 10)).toBeNull()
    expect(affineToCrop("nope", 10, 10)).toBeNull()
  })

  test("cover region and the starting rect per fit", () => {
    // 2400 × 1600 into 240 × 240: centered square.
    expect(coverRect(2400, 1600, 240, 240)).toEqual({ x: 400, y: 0, w: 1600, h: 1600 })
    const paint = { kind: "image", src: IMG }
    expect(initialCrop(paint, 2400, 1600, 240, 240)).toEqual({ x: 400, y: 0, w: 1600, h: 1600 })
    expect(initialCrop({ ...paint, fit: "stretch" }, 2400, 1600, 240, 240)).toEqual({
      x: 0,
      y: 0,
      w: 2400,
      h: 1600,
    })
    expect(
      initialCrop({ ...paint, fit: "crop", crop: [0.5, 0, 0, 0.5, 0.25, 0.25] }, 200, 100, 9, 9),
    ).toEqual({ x: 50, y: 25, w: 100, h: 50 })
  })

  test("clamp keeps the rect inside the image", () => {
    expect(clampRect({ x: -10, y: 90, w: 50, h: 50 }, 100, 100)).toEqual({
      x: 0,
      y: 50,
      w: 50,
      h: 50,
    })
    expect(clampRect({ x: 0, y: 0, w: 500, h: 0 }, 100, 100)).toEqual({ x: 0, y: 0, w: 100, h: 1 })
  })

  test("edge / corner drags keep the opposite edge; ⇧ keeps the ratio", () => {
    const s = { x: 100, y: 100, w: 200, h: 100 }
    expect(resizeCrop(s, "e", 50, 0, 1000, 1000)).toEqual({ x: 100, y: 100, w: 250, h: 100 })
    expect(resizeCrop(s, "nw", -50, -20, 1000, 1000)).toEqual({ x: 50, y: 80, w: 250, h: 120 })
    // Clamped to the image and never inverted.
    expect(resizeCrop(s, "w", -500, 0, 1000, 1000).x).toBe(0)
    expect(resizeCrop(s, "w", 500, 0, 1000, 1000).w).toBe(1)
    const k = resizeCrop(s, "se", 100, 0, 1000, 1000, true)
    expect(k).toEqual({ x: 100, y: 100, w: 300, h: 150 })
    const e = resizeCrop(s, "e", 100, 0, 1000, 1000, true)
    expect(e.w / e.h).toBeCloseTo(2)
    expect(e.y + e.h / 2).toBeCloseTo(150) // grows around the vertical center
    // Ratio kept even when the image edge stops it.
    const c = resizeCrop(s, "se", 5000, 5000, 1000, 400, true)
    expect(c.w / c.h).toBeCloseTo(2)
    expect(c.y + c.h).toBeLessThanOrEqual(400 + 1e-9)
  })

  test("pan stays inside the image", () => {
    expect(panCrop({ x: 10, y: 10, w: 50, h: 50 }, -100, 20, 100, 100)).toEqual({
      x: 0,
      y: 30,
      w: 50,
      h: 50,
    })
  })

  test("handles: corners, edges, inside, outside", () => {
    expect(cropHandleAt({ x: -2, y: 1 }, 100, 50, 6)).toBe("nw")
    expect(cropHandleAt({ x: 50, y: 52 }, 100, 50, 6)).toBe("s")
    expect(cropHandleAt({ x: 103, y: 25 }, 100, 50, 6)).toBe("e")
    expect(cropHandleAt({ x: 50, y: 25 }, 100, 50, 6)).toBe("inside")
    expect(cropHandleAt({ x: 120, y: 25 }, 100, 50, 6)).toBeNull()
    expect(cropSizeLabel({ x: 0, y: 0, w: 1439.6, h: 960.2 })).toBe("1440 × 960")
  })

  test("paint helpers: top image paint, write keeps single / list shape", () => {
    const solid = "#FF0000"
    const img = { kind: "image", src: IMG }
    expect(topImagePaint({ type: "rect", fill: [img, solid, img] } as never)).toBe(2)
    expect(topImagePaint({ type: "rect", fill: solid } as never)).toBeNull()
    expect(imagePaints(img).map((p) => p.index)).toEqual([0])
    const next = croppedPaint(img, { x: 0, y: 0, w: 50, h: 100 }, 100, 100)
    expect(next).toEqual({ kind: "image", src: IMG, fit: "crop", crop: [0.5, 0, 0, 1, 0, 0] })
    expect(writePaintOps("a", { type: "rect", fill: img } as never, 0, next)).toEqual([
      { op: "update", id: "a", set: { fill: next } },
    ] as Op[])
    expect(writePaintOps("a", { type: "rect", fill: [solid, img] } as never, 1, next)).toEqual([
      { op: "update", id: "a", set: { fill: [solid, next] } },
    ] as Op[])
  })
})

// --- CropMode with a fake host -----------------------------------------------------------------

function harness(fill: unknown = { kind: "image", src: IMG }) {
  const node = { type: "rect", parent: null, w: 240, h: 160, fill } as unknown as NodeData
  const nodes = new Map<string, NodeData>([["img", node]])
  // Node at world (100, 50), 240 × 160, zoom 1 at origin.
  const transform: Matrix = [1, 0, 0, 1, 100, 50]
  const layout = {
    nodes: new Map([
      [
        "img",
        {
          local: { x: 100, y: 50, w: 240, h: 160 },
          world: { x: 100, y: 50, w: 240, h: 160 },
          transform,
          visible: true,
        },
      ],
    ]),
  } as unknown as LayoutResult
  const applied: { ops: readonly Op[]; label: string }[] = []
  const overrides: (NodeData | null)[] = []
  const ui = {} as UiStore
  const store = cropStore(ui)
  const mode = new CropMode({
    getNode: (id) => nodes.get(id),
    isReal: (id) => nodes.has(id),
    layout: () => layout,
    viewport: () => ({ x: 0, y: 0, zoom: 1 }),
    imageSize: async () => ({ width: 2400, height: 1600 }),
    apply: (ops, label) => {
      applied.push({ ops, label })
      return true
    },
    override: (_id, data) => overrides.push(data),
    changed: () => {},
    store,
  })
  return { mode, store, applied, overrides }
}

describe("crop mode", () => {
  test("double-click entry shows the cover region filling the layer; hides the paint", async () => {
    const h = harness()
    expect(await h.mode.start("img")).toBe(true)
    const s = h.store.get() as CropSession
    // 2400 × 1600 cover into 240 × 160 (same ratio) = the whole image.
    expect(s.rect).toEqual({ x: 0, y: 0, w: 2400, h: 1600 })
    expect(s.imageWidth).toBe(2400)
    const o = h.mode.overlay()
    expect(o?.box[0]).toEqual({ x: 100, y: 50 })
    expect(o?.box[2]).toEqual({ x: 340, y: 210 })
    expect(o?.label).toBe("2400 × 1600")
    expect((h.overrides[0] as unknown as { fill: { visible: boolean } }).fill.visible).toBe(false)
  })

  test("drag the east edge in, pan inside, Apply = one undo step with fit crop", async () => {
    const h = harness()
    await h.mode.start("img")
    // 1 screen px = 10 image px. Drag the right edge 60 px left → w 1800.
    expect(h.mode.handleAt({ x: 340, y: 130 })).toBe("e")
    h.mode.down({ x: 340, y: 130 })
    h.mode.move({ x: 280, y: 130 }, false)
    h.mode.up()
    expect(h.store.get()?.rect).toEqual({ x: 0, y: 0, w: 1800, h: 1600 })
    // Pan: drag inside 30 px left → the image moves left, the crop moves right by 300 px.
    expect(h.mode.handleAt({ x: 200, y: 130 })).toBe("inside")
    h.mode.down({ x: 200, y: 130 })
    h.mode.move({ x: 170, y: 130 }, false)
    h.mode.up()
    expect(h.store.get()?.rect).toEqual({ x: 300, y: 0, w: 1800, h: 1600 })
    // The box stays where it was on screen while panning.
    expect(h.mode.overlay()?.box[0]).toEqual({ x: 100, y: 50 })
    h.mode.apply()
    expect(h.store.get()).toBeNull()
    expect(h.applied).toHaveLength(1)
    expect(h.applied[0]?.label).toBe("Crop image")
    expect(h.applied[0]?.ops).toEqual([
      {
        op: "update",
        id: "img",
        set: {
          fill: { kind: "image", src: IMG, fit: "crop", crop: [0.75, 0, 0, 1, 0.125, 0] },
        },
      },
    ] as Op[])
    expect(h.overrides.at(-1)).toBeNull()
  })

  test("panel rect, Reset, Esc writes nothing", async () => {
    const h = harness({
      kind: "image",
      src: IMG,
      fit: "crop",
      crop: [0.6, 0, 0, 0.6, 0.2, 0.13125],
    })
    await h.mode.start("img")
    expect(h.store.get()?.rect).toEqual({ x: 480, y: 210, w: 1440, h: 960 })
    h.mode.setRect({ x: 0, y: 0, w: 99999, h: 10 })
    expect(h.store.get()?.rect).toEqual({ x: 0, y: 0, w: 2400, h: 10 })
    h.mode.reset()
    expect(h.store.get()?.rect).toEqual({ x: 0, y: 0, w: 2400, h: 1600 })
    h.mode.cancel()
    expect(h.store.get()).toBeNull()
    expect(h.applied).toHaveLength(0)
  })

  test("⇧ corner drag keeps the ratio; a press outside the image applies", async () => {
    const h = harness()
    await h.mode.start("img")
    h.mode.down({ x: 340, y: 210 })
    h.mode.move({ x: 280, y: 210 }, true)
    h.mode.up()
    const r = h.store.get()?.rect
    expect((r?.w ?? 0) / (r?.h ?? 1)).toBeCloseTo(1.5)
    h.mode.down({ x: 900, y: 900 })
    expect(h.store.get()).toBeNull()
    expect(h.applied).toHaveLength(1)
  })

  test("a node without an image fill does not enter", async () => {
    const h = harness("#FF0000")
    expect(await h.mode.start("img")).toBe(false)
    expect(h.store.get()).toBeNull()
  })
})
