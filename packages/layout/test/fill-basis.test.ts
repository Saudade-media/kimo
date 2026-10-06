/**
 * §6.1: flowing `fill` items share their parent's main-axis space by weight from a zero basis
 * (content size ignored, CSS `flex: <weight> 1 0`) when that space is definite and the parent
 * does not wrap; inside a hug (`fit`) or wrapping parent their content size is the basis.
 */
import { describe, expect, test } from "bun:test"
import { createLayoutEngine } from "../src/index"
import { inputFor, lay, nodes, wrap } from "./helpers"

const FILL = { mode: "fill" }
// The fake measurer: 5px per glyph at size 10, 12.5px lines.
const text = (parent: string, content: string, extra: Record<string, unknown> = {}) => ({
  type: "text",
  parent,
  content,
  grow: "fixed-width",
  w: FILL,
  style: { size: 10 },
  ...extra,
})
const row = (w: unknown, extra: Record<string, unknown> = {}) => ({
  type: "frame",
  parent: null,
  w,
  h: 100,
  layout: { dir: "row" },
  ...extra,
})
const box = (parent: string, w: unknown, extra: Record<string, unknown> = {}) => ({
  type: "frame",
  parent,
  w,
  h: 10,
  ...extra,
})

describe("fill items share the main axis from a zero basis", () => {
  test("equal split with unequal content (pen.dev 20 M4 Gaps row)", async () => {
    const l = await lay({
      r: row(480, { h: { mode: "fit" }, layout: { dir: "row", gap: 12 } }),
      a: box("r", 130),
      b: text("r", "short"),
      c: text("r", "a much longer label that would grow wider from its content"),
    })
    // (480 - 130 - 2 × 12) / 2 = 163 each, whatever the text length.
    expect(l.box("b")).toEqual([142, 0, 163, 12.5])
    expect(l.box("c")[0]).toBe(317)
    expect(l.box("c")[2]).toBe(163)
    // 59 glyphs × 5 = 295 wraps at 163 into 2 lines.
    expect(l.box("c")[3]).toBe(25)
    expect(l.box("r")[3]).toBe(25)
  })

  test("weights 1:2 split the space 1:2, not the free space after content", async () => {
    const l = await lay({
      r: row(300),
      a: text("r", "aaaaaaaaaaaaaaaaaaaa"), // 100 of content
      b: text("r", "b", { w: { mode: "fill", weight: 2 } }),
    })
    expect(l.box("a")[2]).toBe(100)
    expect(l.box("b")).toEqual([100, 0, 200, 12.5])
  })

  test("frames with content fill equally too; padding and gap come off first", async () => {
    const l = await lay({
      r: row(400, { layout: { dir: "row", gap: 10, pad: 20 } }),
      a: { type: "frame", parent: "r", w: FILL, h: 10, layout: { dir: "row" } },
      a1: box("a", 150),
      b: box("r", FILL),
    })
    // (400 - 40 - 10) / 2 = 175; a's 150px child does not enlarge it.
    expect(l.box("a")).toEqual([20, 20, 175, 10])
    expect(l.box("b")).toEqual([205, 20, 175, 10])
  })

  test("padded and unpadded siblings end with equal outer sizes (pen.dev 25 v1 Polish)", async () => {
    const col = (pad: unknown) => ({
      type: "frame",
      parent: "r",
      w: FILL,
      h: 20,
      layout: { dir: "column", pad },
    })
    const l = await lay({
      r: row(1312, { layout: { dir: "row", gap: 24 } }),
      a: col(20),
      b: col([0, 20]),
      c: col(0),
    })
    // (1312 - 48) / 3 each, whatever the padding (Yoga alone floors the basis at 40).
    for (const id of ["a", "b", "c"]) expect(l.box(id)[2]).toBeCloseTo(421.333, 3)
    expect(l.box("c")[0]).toBeCloseTo(890.667, 3)
  })

  test("padding with weights, stroke insets and a max keep the weighted split", async () => {
    const l = await lay({
      r: row(672, { layout: { dir: "row", gap: 8 } }),
      a: {
        type: "frame",
        parent: "r",
        w: { mode: "fill", weight: 2 },
        h: 10,
        stroke: { paint: "#000000", width: 4 },
        layout: { dir: "row", pad: [0, 30], includeStroke: true },
      },
      b: box("r", FILL, { layout: { dir: "row" } }),
      c: box("r", { mode: "fill", max: 120 }, { layout: { dir: "row", pad: [0, 40] } }),
    })
    // 656 shared 2:1:1 = 328 / 164 / 164; c freezes at 120, a and b share 536 2:1.
    expect(l.box("c")[2]).toBe(120)
    expect(l.box("a")[2]).toBeCloseTo(357.333, 3)
    expect(l.box("b")[2]).toBeCloseTo(178.667, 3)
  })

  test("padding larger than the share stays a floor", async () => {
    const l = await lay({
      r: row(100),
      a: box("r", FILL, { layout: { dir: "row", pad: [0, 40] } }),
      b: box("r", FILL),
    })
    expect(l.box("a")[2]).toBe(80)
    expect(l.box("b")[2]).toBe(20)
  })

  test("a column shares its height the same way", async () => {
    const l = await lay({
      c: { type: "frame", parent: null, w: 100, h: 300, layout: { dir: "column" } },
      a: { type: "frame", parent: "c", w: 100, h: FILL, layout: { dir: "column" } },
      a1: { type: "frame", parent: "a", w: 10, h: 200 },
      b: { type: "frame", parent: "c", w: 100, h: FILL },
    })
    expect(l.box("a")[3]).toBe(150)
    expect(l.box("b")).toEqual([0, 150, 100, 150])
  })

  test("fill inside fill: the inner row's definite share is split equally again", async () => {
    const l = await lay({
      r: row(400),
      f: { type: "frame", parent: "r", w: FILL, h: 50, layout: { dir: "row" } },
      x: box("r", 100),
      a: text("f", "a"),
      b: text("f", "bbbbbbbbb bbbbbbbbb bbbbbbbbb bbbbbbbbb"),
    })
    expect(l.box("f")[2]).toBe(300)
    expect(l.box("a")[2]).toBe(150)
    expect(l.box("b")).toEqual([150, 0, 150, 25])
  })

  test("cross-axis fill is unchanged (stretch)", async () => {
    const l = await lay({
      c: { type: "frame", parent: null, w: 200, h: 100, layout: { dir: "column" } },
      a: box("c", FILL),
    })
    expect(l.box("a")).toEqual([0, 0, 200, 10])
  })
})

describe("content stays the basis where a zero basis would collapse or stop wrapping", () => {
  test("hug parent: fill children keep their content size (FIT_ALL_FILL)", async () => {
    const l = await lay({
      r: row({ mode: "fit" }),
      a: text("r", "aaaa"),
      b: text("r", "bbbbbbbbbb"),
    })
    expect(l.box("a")[2]).toBe(20)
    expect(l.box("b")).toEqual([20, 0, 50, 12.5])
    expect(l.box("r")[2]).toBe(70)
  })

  test("hug parent inside a fill parent: its fill children are content-sized", async () => {
    const l = await lay({
      r: row(400),
      h: { type: "frame", parent: "r", w: { mode: "fit" }, h: 20, layout: { dir: "row" } },
      a: text("h", "aaaa"),
      b: text("h", "bbbbbbbbbb"),
    })
    expect(l.box("h")[2]).toBe(70)
    expect(l.box("a")[2]).toBe(20)
    expect(l.box("b")[2]).toBe(50)
  })

  test("a fill row inside a hug row is not definite: its children use content", async () => {
    const l = await lay({
      r: row({ mode: "fit" }),
      f: { type: "frame", parent: "r", w: FILL, h: 20, layout: { dir: "row" } },
      a: text("f", "aaaa"),
      b: text("f", "bbbbbbbbbb"),
    })
    expect(l.box("f")[2]).toBe(70)
    expect(l.box("b")).toEqual([20, 0, 50, 12.5])
  })

  test("wrapping parent: free space is shared after the content (lines still break)", async () => {
    const l = await lay({
      r: row(200, { layout: { dir: "row", wrap: true } }),
      a: box("r", FILL, { layout: { dir: "row" } }),
      a1: box("a", 50),
      b: box("r", FILL, { layout: { dir: "row" } }),
      b1: box("b", 30),
    })
    // free 120 split 60 / 60 on top of the content: 110 / 90.
    expect(l.box("a")[2]).toBe(110)
    expect(l.box("b")).toEqual([110, 0, 90, 10])
  })
})

describe("min/max of fill items from a zero basis", () => {
  test("max freezes, the rest share what is left equally", async () => {
    const l = await lay({
      r: row(300),
      a: box("r", { mode: "fill", max: 50 }),
      b: text("r", "bbbbbbbbbbbbbbbb"), // 80 of content, ignored
      c: box("r", FILL),
    })
    expect(l.box("a")[2]).toBe(50)
    expect(l.box("b")).toEqual([50, 0, 125, 12.5])
    expect(l.box("c")).toEqual([175, 0, 125, 10])
  })

  test("min freezes, the rest share what is left equally", async () => {
    const l = await lay({
      r: row(300),
      a: box("r", { mode: "fill", min: 200 }),
      b: text("r", "bbbbbbbbbbbbbbbb"),
      c: box("r", FILL),
    })
    expect(l.box("a")[2]).toBe(200)
    expect(l.box("b")[2]).toBe(50)
    expect(l.box("c")).toEqual([250, 0, 50, 10])
  })

  test("an unviolated min does not move the equal split", async () => {
    const l = await lay({
      r: row(300),
      a: box("r", { mode: "fill", min: 20 }),
      b: text("r", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
    })
    expect(l.box("a")[2]).toBe(150)
    expect(l.box("b")[2]).toBe(150)
  })
})

describe("incremental re-layout follows the parent's size mode and wrap", () => {
  const table = (w: unknown, wrap = false) =>
    nodes({
      r: row(w, { layout: { dir: "row", wrap } }),
      a: text("r", "aaaa"),
      b: text("r", "bbbbbbbbbb"),
    })

  test("fit → fixed → fit switches the children's basis", async () => {
    const e = createLayoutEngine()
    await e.init()
    const hug = wrap(e.compute(inputFor(table({ mode: "fit" }))))
    expect(hug.box("b")[2]).toBe(50)
    const fixed = wrap(e.update(inputFor(table(300)), { nodes: ["r"] }))
    expect(fixed.box("a")[2]).toBe(150)
    expect(fixed.box("b")).toEqual([150, 0, 150, 12.5])
    const back = wrap(e.update(inputFor(table({ mode: "fit" })), { nodes: ["r"] }))
    expect(back.box("a")[2]).toBe(20)
    expect(back.box("b")).toEqual([20, 0, 50, 12.5])
  })

  test("a sibling's padding change re-balances the others", async () => {
    const t = (pad: number) =>
      nodes({
        r: row(300),
        a: box("r", FILL, { layout: { dir: "row", pad: [0, pad] } }),
        b: box("r", FILL),
      })
    const e = createLayoutEngine()
    await e.init()
    expect(wrap(e.compute(inputFor(t(0)))).box("b")[2]).toBe(150)
    const p = wrap(e.update(inputFor(t(60)), { nodes: ["a"] }))
    expect(p.box("a")[2]).toBe(150)
    expect(p.box("b")).toEqual([150, 0, 150, 10])
  })

  test("toggling wrap switches the children's basis", async () => {
    const e = createLayoutEngine()
    await e.init()
    expect(wrap(e.compute(inputFor(table(300)))).box("b")[2]).toBe(150)
    // wrap: content + half of the free 230 each.
    const w = wrap(e.update(inputFor(table(300, true)), { nodes: ["r"] }))
    expect(w.box("a")[2]).toBe(135)
    expect(w.box("b")[2]).toBe(165)
    expect(wrap(e.update(inputFor(table(300)), { nodes: ["r"] })).box("b")[2]).toBe(150)
  })

  test("a grandparent switching to fit re-styles the grandchildren", async () => {
    const t = (w: unknown) =>
      nodes({
        r: row(w),
        f: { type: "frame", parent: "r", w: FILL, h: 20, layout: { dir: "row" } },
        a: text("f", "aaaa"),
        b: text("f", "bbbbbbbbbb"),
      })
    const e = createLayoutEngine()
    await e.init()
    expect(wrap(e.compute(inputFor(t(300)))).box("b")[2]).toBe(150)
    const hug = wrap(e.update(inputFor(t({ mode: "fit" })), { nodes: ["r"] }))
    expect(hug.box("f")[2]).toBe(70)
    expect(hug.box("b")[2]).toBe(50)
    const fresh = await lay({
      r: row({ mode: "fit" }),
      f: { type: "frame", parent: "r", w: FILL, h: 20, layout: { dir: "row" } },
      a: text("f", "aaaa"),
      b: text("f", "bbbbbbbbbb"),
    })
    expect(hug.box("b")).toEqual(fresh.box("b"))
  })
})
