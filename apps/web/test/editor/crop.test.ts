/** Image crop mode: the crop math and the canvas crop mode behind a fake host. */
import { describe, expect, test } from "bun:test"
import type { NodeData, Op } from "@kimo/editor-state"
import type { LayoutResult, Matrix } from "@kimo/layout"
import type { UiStore } from "../../src/canvas/contract"
import {
  affineToCrop,
  type CropSession,
  cropStore,
  cropToAffine,
  initialCrop,
  resizeCrop,
} from "../../src/canvas/crop"
import { CropMode, croppedPaint, topImagePaint, writePaintOps } from "../../src/canvas/crop-mode"

const IMG = "./assets/0123456789abcdef.png"

describe("crop math", () => {
  test("the stored affine round trips; a stored crop is the starting rect", () => {
    const r = { x: 480, y: 210, w: 1440, h: 960 }
    const m = cropToAffine(r, 2400, 1600)
    expect(m).toEqual([0.6, 0, 0, 0.6, 0.2, 0.13125])
    expect(affineToCrop(m, 2400, 1600)).toEqual(r)
    expect(affineToCrop([1, 0.2, 0, 1, 0, 0], 10, 10)).toBeNull()
    expect(affineToCrop("nope", 10, 10)).toBeNull()
    const paint = { kind: "image", src: IMG }
    expect(
      initialCrop({ ...paint, fit: "crop", crop: [0.5, 0, 0, 0.5, 0.25, 0.25] }, 200, 100, 9, 9),
    ).toEqual({ x: 50, y: 25, w: 100, h: 50 })
  })

  test("edge and corner drags keep the opposite edge, stay inside the image and never invert; shift keeps the ratio", () => {
    const s = { x: 100, y: 100, w: 200, h: 100 }
    expect(resizeCrop(s, "e", 50, 0, 1000, 1000)).toEqual({ x: 100, y: 100, w: 250, h: 100 })
    expect(resizeCrop(s, "nw", -50, -20, 1000, 1000)).toEqual({ x: 50, y: 80, w: 250, h: 120 })
    expect(resizeCrop(s, "w", -500, 0, 1000, 1000).x).toBe(0)
    expect(resizeCrop(s, "w", 500, 0, 1000, 1000).w).toBe(1)
    expect(resizeCrop(s, "se", 100, 0, 1000, 1000, true)).toEqual({
      x: 100,
      y: 100,
      w: 300,
      h: 150,
    })
    // Ratio kept even when the image edge stops it.
    const c = resizeCrop(s, "se", 5000, 5000, 1000, 400, true)
    expect(c.w / c.h).toBeCloseTo(2)
    expect(c.y + c.h).toBeLessThanOrEqual(400 + 1e-9)
  })

  test("the top image paint is written back in the shape it was read (single or list)", () => {
    const solid = "#FF0000"
    const img = { kind: "image", src: IMG }
    expect(topImagePaint({ type: "rect", fill: [img, solid, img] } as never)).toBe(2)
    expect(topImagePaint({ type: "rect", fill: solid } as never)).toBeNull()
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

function harness(fill: unknown = { kind: "image", src: IMG }) {
  const node = { type: "rect", parent: null, w: 240, h: 160, fill } as unknown as NodeData
  const nodes = new Map<string, NodeData>([["img", node]])
  // Node at world (100, 50), 240 x 160, zoom 1 at origin.
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
  test("drag an edge in, pan inside, Apply writes one fit-crop update", async () => {
    const h = harness()
    expect(await h.mode.start("img")).toBe(true)
    // 1 screen px = 10 image px. Drag the right edge 60 px left: w 1800.
    expect(h.mode.handleAt({ x: 340, y: 130 })).toBe("e")
    h.mode.down({ x: 340, y: 130 })
    h.mode.move({ x: 280, y: 130 }, false)
    h.mode.up()
    expect(h.store.get()?.rect).toEqual({ x: 0, y: 0, w: 1800, h: 1600 })
    // Pan: drag inside 30 px left: the image moves left, the crop moves right by 300 px.
    expect(h.mode.handleAt({ x: 200, y: 130 })).toBe("inside")
    h.mode.down({ x: 200, y: 130 })
    h.mode.move({ x: 170, y: 130 }, false)
    h.mode.up()
    expect(h.store.get()?.rect).toEqual({ x: 300, y: 0, w: 1800, h: 1600 })
    h.mode.apply()
    expect(h.store.get()).toBeNull()
    expect(h.applied).toHaveLength(1)
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

  test("Esc writes nothing; a node without an image fill does not enter", async () => {
    const h = harness({
      kind: "image",
      src: IMG,
      fit: "crop",
      crop: [0.6, 0, 0, 0.6, 0.2, 0.13125],
    })
    await h.mode.start("img")
    expect((h.store.get() as CropSession).rect).toEqual({ x: 480, y: 210, w: 1440, h: 960 })
    h.mode.setRect({ x: 0, y: 0, w: 99999, h: 10 })
    h.mode.cancel()
    expect(h.store.get()).toBeNull()
    expect(h.applied).toHaveLength(0)
    const plain = harness("#FF0000")
    expect(await plain.mode.start("img")).toBe(false)
  })
})
