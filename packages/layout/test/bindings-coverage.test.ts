/**
 * Every bindable layout field resolves through the Resolver: `number`, `dimension` ({value, unit})
 * and library (`alias:name`) variables in sizes, gap, crossGap, pad (single and array items),
 * per-side stroke widths with `includeStroke`, visibility and text style/content.
 */
import { describe, expect, test } from "bun:test"
import type { KimoDocument } from "@kimo/core-schema"
import {
  createLayoutEngine,
  createResolver,
  nodeSourceFromDocument,
  type ResolveHeader,
} from "../src"
import { fakeMeasurer, nodes, wrap } from "./helpers"

const lib = {
  format: "1.0.0",
  variables: {
    pad: { type: "dimension", value: { value: 10, unit: "px" } },
    big: { type: "number", value: 50 },
  },
  nodes: {},
} as unknown as KimoDocument

const header: ResolveHeader = {
  imports: { ui: "./ui.kimo" },
  variables: {
    n8: { type: "number", value: 8 },
    d4: { type: "dimension", value: { value: 4, unit: "px" } },
    w120: { type: "dimension", value: { value: 120, unit: "px" } },
    hide: { type: "boolean", value: false },
    fs: { type: "dimension", value: { value: 20, unit: "px" } },
    lh: { type: "number", value: 2 },
    label: { type: "string", value: "Hello" },
  },
} as unknown as ResolveHeader

const ref = (name: string) => ({ $ref: name })

async function layout() {
  const table = nodes({
    F: {
      type: "frame",
      parent: null,
      w: ref("w120"),
      h: ref("ui:big"),
      layout: {
        dir: "row",
        gap: ref("n8"),
        pad: [ref("d4"), ref("ui:pad"), 0, ref("n8")],
        includeStroke: true,
      },
      stroke: { paint: "#000000", width: { t: ref("d4"), r: 0, b: 0, l: ref("n8") } },
    },
    A: { type: "rect", parent: "F", w: 10, h: 10 },
    B: { type: "rect", parent: "F", w: 10, h: 10 },
    C: { type: "rect", parent: "F", w: 10, h: 10, visible: ref("hide") },
    W: {
      type: "frame",
      parent: null,
      x: 200,
      w: 30,
      layout: { dir: "row", wrap: true, gap: ref("n8"), crossGap: ref("d4"), pad: ref("ui:pad") },
    },
    W1: { type: "rect", parent: "W", w: 10, h: 10 },
    W2: { type: "rect", parent: "W", w: 10, h: 10 },
    T: {
      type: "text",
      parent: null,
      y: 300,
      content: ref("label"),
      style: { size: ref("fs"), lineHeight: ref("lh") },
    },
  } as never)
  const src = nodeSourceFromDocument({ nodes: table as never })
  const libraries = { ui: lib }
  const e = createLayoutEngine({ libraries })
  await e.init()
  const r = e.compute({
    nodes: src,
    resolve: createResolver(header, src, { libraries }),
    measureText: fakeMeasurer,
  })
  e.dispose()
  return wrap(r)
}

describe("layout resolves every bindable field", () => {
  test("w/h (dimension + library number), gap, pad items, per-side stroke with includeStroke", async () => {
    const l = await layout()
    expect(l.box("F").slice(2)).toEqual([120, 50])
    // pad t = 4 (d4) + 4 (stroke t d4); l = 8 (n8) + 8 (stroke l n8).
    expect(l.box("A")).toEqual([16, 8, 10, 10])
    expect(l.box("B")[0]).toBe(16 + 10 + 8)
    expect(l.get("C").visible).toBe(false)
    expect(l.result.issues).toEqual([])
  })
  test("crossGap (dimension) and single pad (library dimension)", async () => {
    const l = await layout()
    // 30 wide, pad 10 each side: one 10px child per line; second line at 10 + 10 + 4.
    expect(l.box("W1")).toEqual([10, 10, 10, 10])
    expect(l.box("W2")).toEqual([10, 24, 10, 10])
  })
  test("text content and style size / lineHeight", async () => {
    const l = await layout()
    // "Hello": 5 glyphs × 0.5 × 20; line height 2 × 20.
    expect(l.box("T").slice(2)).toEqual([50, 40])
  })
})
