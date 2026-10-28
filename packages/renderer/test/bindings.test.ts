/**
 * The painter resolves every bindable visual field (`number`, `dimension` and library
 * `alias:name` variables) in opacity, per-corner radius items, clip, per-side stroke widths,
 * shadow x/y/blur/spread and layer blur radius.
 */
import { describe, expect, test } from "bun:test"
import type { KimoDocument } from "@kimo/core-schema"
import { createResolver, nodeSourceFromDocument } from "@kimo/layout"
import { CanvasKitRenderer, type RenderScene } from "../src"
import { loadCanvasKit } from "../src/ck"
import { resolveNum, resolveRadii } from "../src/geometry"
import { pixelAt } from "./helpers/golden"
import { simpleLayout } from "./helpers/scene"

const ref = (name: string) => ({ $ref: name })

const lib = {
  format: "1.0.0",
  variables: {
    big: { type: "number", value: 20 },
    edge: { type: "dimension", value: { value: 6, unit: "px" } },
  },
  nodes: {},
} as unknown as KimoDocument
const libraries = { ui: lib }

const header = {
  imports: { ui: "./ui.kimo" },
  variables: {
    half: { type: "number", value: 0.5 },
    d20: { type: "dimension", value: { value: 20, unit: "px" } },
    d4: { type: "dimension", value: { value: 4, unit: "px" } },
    yes: { type: "boolean", value: true },
  },
} as unknown as KimoDocument

function scene(nodes: Record<string, Record<string, unknown>>): RenderScene {
  const table = Object.fromEntries(
    Object.entries(nodes).map(([id, n], i) => [id, { order: `a${i}`, parent: null, ...n }]),
  )
  const src = nodeSourceFromDocument({ nodes: table } as never)
  return {
    nodes: src,
    header,
    resolve: createResolver(header, src, { libraries }),
    assets: { load: async () => null },
  }
}

async function paint(nodes: Record<string, Record<string, unknown>>, w: number, h: number) {
  const r = new CanvasKitRenderer()
  await r.init({ offlineFonts: true })
  const s = scene(nodes)
  r.setDocument(s)
  r.setLayout(simpleLayout(s, r.textMeasurer()))
  r.attachRaster(w, h)
  const png = r.snapshot()
  const ck = await loadCanvasKit()
  r.dispose()
  return (x: number, y: number) => pixelAt(ck, png, x, y)
}

describe("renderer resolves bindings", () => {
  test("resolveNum / resolveRadii: dimension, number and library items", () => {
    const s = scene({
      R: { type: "rect", w: 100, h: 100, radius: [ref("d20"), 0, ref("ui:edge"), ref("ui:big")] },
    })
    const n = s.nodes.getNode("R")
    if (!n) throw new Error("no node")
    expect(resolveRadii(s.resolve, "R", n, 100, 100)).toEqual([20, 0, 6, 20])
    // One bound corner, the rest 0: sides with two zero radii must not flatten the corner.
    const one = { ...n, radius: [ref("d20"), 0, 0, 0] } as typeof n
    expect(resolveRadii(s.resolve, "R", one, 100, 100)).toEqual([20, 0, 0, 0])
    expect(resolveNum(s.resolve, "R", ref("d4"), 0)).toBe(4)
    expect(resolveNum(s.resolve, "R", ref("ui:edge"), 0)).toBe(6)
    expect(resolveNum(s.resolve, "R", ref("missing"), 7)).toBe(7)
  })

  test("radius tuple item, opacity, per-side stroke width", async () => {
    const px = await paint(
      {
        // Top-left corner bound to a 20 px dimension: the corner pixel stays empty.
        Corner: {
          type: "rect",
          x: 0,
          y: 0,
          w: 40,
          h: 40,
          fill: "#FF0000",
          radius: [ref("d20"), 0, 0, 0],
        },
        Faded: { type: "rect", x: 50, y: 0, w: 40, h: 40, fill: "#0000FF", opacity: ref("half") },
        Stroked: {
          type: "frame",
          x: 150,
          y: 0,
          w: 40,
          h: 40,
          fill: "#FFFFFF",
          stroke: { paint: "#000000", align: "inside", width: { t: ref("d4"), r: 0, b: 0, l: 0 } },
        },
      },
      200,
      50,
    )
    expect(px(1, 1)[3]).toBe(0)
    expect(px(38, 2)).toEqual([255, 0, 0, 255])
    const faded = px(70, 20)
    expect(faded[3]).toBeGreaterThan(110)
    expect(faded[3]).toBeLessThan(145)
    expect(px(170, 2)).toEqual([0, 0, 0, 255])
    expect(px(170, 6)).toEqual([255, 255, 255, 255])
  })

  test("clip binding hides the overflowing child", async () => {
    const nodes = {
      Clipper: { type: "frame", x: 0, y: 0, w: 20, h: 20, clip: ref("yes") },
      Child: { type: "rect", parent: "Clipper", x: 0, y: 0, w: 40, h: 40, fill: "#00FF00" },
    }
    const px = await paint(nodes, 50, 50)
    expect(px(10, 10)).toEqual([0, 255, 0, 255])
    expect(px(30, 30)[3]).toBe(0)
  })

  test("shadow x/blur/spread and layer blur radius", async () => {
    const px = await paint(
      {
        Shadowed: {
          type: "rect",
          x: 0,
          y: 0,
          w: 20,
          h: 20,
          fill: "#000000",
          effects: [
            {
              kind: "shadow",
              color: "#FF0000",
              x: ref("d20"),
              y: 0,
              blur: 0,
              spread: ref("d4"),
            },
          ],
        },
        Blurred: {
          type: "rect",
          x: 80,
          y: 10,
          w: 20,
          h: 20,
          fill: "#000000",
          effects: [{ kind: "blur", radius: ref("ui:big") }],
        },
      },
      140,
      50,
    )
    // Shadow offset 20 and spread 4: covers x 16..44 on the right of the 20px box.
    expect(px(30, 10)).toEqual([255, 0, 0, 255])
    expect(px(42, 10)).toEqual([255, 0, 0, 255])
    expect(px(48, 10)[3]).toBe(0)
    // Blur 20 bleeds well outside the box.
    expect(px(76, 20)[3]).toBeGreaterThan(0)
  })
})
