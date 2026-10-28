/**
 * Flowing `fill` items share their parent's main-axis space by weight from a zero basis (content
 * size ignored, CSS `flex: <weight> 1 0`) when that space is definite and the parent does not
 * wrap; inside a hug (`fit`) or wrapping parent their content size is the basis. Min/max follow
 * CSS "resolving flexible lengths" (the exported HTML is box-diffed against this engine).
 */
import { describe, expect, test } from "bun:test"
import { lay } from "./helpers"

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
  test("equal split with unequal content", async () => {
    const l = await lay({
      r: row(480, { h: { mode: "fit" }, layout: { dir: "row", gap: 12 } }),
      a: box("r", 130),
      b: text("r", "short"),
      c: text("r", "a much longer label that would grow wider from its content"),
    })
    // (480 - 130 - 2 x 12) / 2 = 163 each, whatever the text length.
    expect(l.box("b")).toEqual([142, 0, 163, 12.5])
    expect(l.box("c")[0]).toBe(317)
    expect(l.box("c")[2]).toBe(163)
    // 59 glyphs x 5 = 295 wraps at 163 into 2 lines.
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

  test("padded and unpadded siblings end with equal outer sizes", async () => {
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
})

describe("content stays the basis where a zero basis would collapse or stop wrapping", () => {
  test("hug parent: fill children keep their content size", async () => {
    const l = await lay({
      r: row({ mode: "fit" }),
      a: text("r", "aaaa"),
      b: text("r", "bbbbbbbbbb"),
    })
    expect(l.box("a")[2]).toBe(20)
    expect(l.box("b")).toEqual([20, 0, 50, 12.5])
    expect(l.box("r")[2]).toBe(70)
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

describe("min/max of fill items", () => {
  test("max freezes, the rest share what is left equally (content ignored)", async () => {
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

  test("a weighted min violator is frozen; the rest of the free space goes to the others", async () => {
    // Free space 320 - 200 - 16 = 104, giving 69.3 / 34.7; `a` clamps to 100, `b` gets 4.
    const l = await lay({
      g: { type: "frame", parent: null, w: 320, layout: { dir: "row", gap: 8 } },
      a: box("g", { mode: "fill", weight: 2, min: 100 }, { h: 100 }),
      b: box("g", FILL, { h: 100 }),
      c: box("g", 200, { h: 100 }),
    })
    expect(l.box("a")).toEqual([0, 0, 100, 100])
    expect(l.box("b")).toEqual([108, 0, 4, 100])
    expect(l.box("c")).toEqual([120, 0, 200, 100])
  })

  test("column axis and shrinking below the content: min holds, overflow like CSS", async () => {
    const l = await lay({
      g: { type: "frame", parent: null, w: 10, h: 100, layout: { dir: "column" } },
      a: box("g", 10, { h: { mode: "fill", min: 80 } }),
      b: box("g", 10, { h: FILL }),
      c: box("g", 10, { h: 50 }),
    })
    // Free space 50 gives 25 / 25; `a` clamps to 80, so `b` shrinks to 0.
    expect(l.box("a")).toEqual([0, 0, 10, 80])
    expect(l.box("b")).toEqual([0, 80, 10, 0])
    expect(l.box("c")).toEqual([0, 80, 10, 50])
  })

  test("wrapping container: lines break on the clamped sizes", async () => {
    // 248 wide: 100 + 8 + 100 fit, a third 100 wraps; each line shares its own free space.
    const l = await lay({
      g: { type: "frame", parent: null, w: 248, layout: { dir: "row", wrap: true, gap: 8 } },
      a: box("g", { mode: "fill", min: 100 }, { h: 28 }),
      b: box("g", { mode: "fill", min: 100 }, { h: 28 }),
      c: box("g", { mode: "fill", min: 100, max: 120 }, { h: 28 }),
    })
    expect(l.box("a")).toEqual([0, 0, 120, 28])
    expect(l.box("b")).toEqual([128, 0, 120, 28])
    expect(l.box("c")).toEqual([0, 28, 120, 28])
  })
})
