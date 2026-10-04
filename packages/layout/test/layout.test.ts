import { describe, expect, test } from "bun:test"
import { lay } from "./helpers"

const root = { parent: null }
const rect = (parent: string, w: unknown, h: unknown, extra: Record<string, unknown> = {}) => ({
  type: "rect",
  parent,
  w,
  h,
  ...extra,
})
const fill = { mode: "fill" }
const row = (extra: Record<string, unknown> = {}) => ({ dir: "row", ...extra })
const col = (extra: Record<string, unknown> = {}) => ({ dir: "column", ...extra })

describe("free placement (no layout)", () => {
  test("x/y relative to the parent; world composes", async () => {
    const l = await lay({
      page: { type: "frame", ...root, x: 10, y: 20, w: 100, h: 50 },
      r: rect("page", 10, 10, { x: 5, y: 5 }),
    })
    expect(l.box("page")).toEqual([10, 20, 100, 50])
    expect(l.box("r")).toEqual([5, 5, 10, 10])
    expect(l.world("r")).toEqual([15, 25, 10, 10])
    expect(l.get("r").transform).toEqual([1, 0, 0, 1, 15, 25])
  })
  test("absent x/y is 0; fractional values survive Yoga's float32", async () => {
    const l = await lay({ r: rect("", 50.3, 0.1, { parent: null }) })
    expect(l.box("r")).toEqual([0, 0, 50.3, 0.1])
  })
  test("fit frame without layout = extent of its children (hidden ignored)", async () => {
    const l = await lay({
      f: { type: "frame", ...root },
      a: rect("f", 10, 10, { x: 5, y: 5 }),
      b: rect("f", 20, 5, { x: 30, y: 40 }),
      h: rect("f", 500, 500, { visible: false }),
    })
    expect(l.box("f")).toEqual([0, 0, 50, 45])
  })
  test("fill outside a flex parent uses fallback, else the content size", async () => {
    const l = await lay({
      f: { type: "frame", ...root, w: 200, h: 200 },
      a: rect("f", { mode: "fill", fallback: 40 }, { mode: "fill", fallback: 30 }),
      b: rect("f", fill, 10),
      c: { type: "frame", parent: "f", w: fill, h: fill },
      ca: rect("c", 12, 7),
    })
    expect(l.box("a")).toEqual([0, 0, 40, 30])
    expect(l.box("b")).toEqual([0, 0, 0, 10])
    expect(l.box("c")).toEqual([0, 0, 12, 7])
  })
})

describe("flex layout", () => {
  test("row: gap and uniform padding; fit = content", async () => {
    const l = await lay({
      f: { type: "frame", ...root, layout: row({ gap: 10, pad: 8 }) },
      a: rect("f", 20, 10),
      b: rect("f", 30, 20),
    })
    expect(l.box("f")).toEqual([0, 0, 76, 36])
    expect(l.box("a")).toEqual([8, 8, 20, 10])
    expect(l.box("b")).toEqual([38, 8, 30, 20])
  })
  test("column with [v, h] and [t, r, b, l] padding", async () => {
    const l = await lay({
      f: { type: "frame", ...root, layout: col({ gap: 4, pad: [4, 12] }) },
      a: rect("f", 20, 10),
      b: rect("f", 30, 20),
      g: { type: "frame", ...root, x: 100, layout: col({ pad: [1, 2, 3, 4] }) },
      c: rect("g", 10, 10),
    })
    expect(l.box("f")).toEqual([0, 0, 54, 42])
    expect(l.box("a")).toEqual([12, 4, 20, 10])
    expect(l.box("b")).toEqual([12, 18, 30, 20])
    expect(l.box("g")).toEqual([100, 0, 16, 14])
    expect(l.box("c")).toEqual([4, 1, 10, 10])
  })
  test("x/y of flowing children are ignored", async () => {
    const l = await lay({
      f: { type: "frame", ...root, layout: row() },
      a: rect("f", 20, 10, { x: 99, y: 99 }),
    })
    expect(l.box("a")).toEqual([0, 0, 20, 10])
  })
  const justify = async (j: string, n = 2) => {
    const spec: Record<string, Record<string, unknown>> = {
      f: { type: "frame", ...root, w: 200, h: 20, layout: row({ justify: j }) },
    }
    for (let i = 0; i < n; i++) spec[`c${i}`] = rect("f", 20, 10)
    const l = await lay(spec as never)
    return Array.from({ length: n }, (_, i) => l.box(`c${i}`)[0])
  }
  test("justify start/center/end", async () => {
    expect(await justify("start")).toEqual([0, 20])
    expect(await justify("center")).toEqual([80, 100])
    expect(await justify("end")).toEqual([160, 180])
  })
  test("justify between/around/evenly", async () => {
    expect(await justify("between")).toEqual([0, 180])
    expect(await justify("around")).toEqual([40, 140])
    const ev = await justify("evenly")
    expect(ev[0]).toBeCloseTo(160 / 3, 3)
    expect(ev[1]).toBeCloseTo(20 + (2 * 160) / 3, 3)
  })
  test("justify between with a single child packs at the start", async () => {
    expect(await justify("between", 1)).toEqual([0])
  })
  test("align start/center/end on the cross axis", async () => {
    const at = async (a: string) =>
      (
        await lay({
          f: { type: "frame", ...root, w: 100, h: 100, layout: row({ align: a }) },
          c: rect("f", 10, 20),
        })
      ).box("c")[1]
    expect(await at("start")).toBe(0)
    expect(await at("center")).toBe(40)
    expect(await at("end")).toBe(80)
  })
  test("align stretch stretches fit children, not fixed ones", async () => {
    const l = await lay({
      f: { type: "frame", ...root, w: 100, h: 100, layout: row({ align: "stretch" }) },
      a: { type: "frame", parent: "f", w: 10, layout: col() },
      b: rect("f", 10, 20),
    })
    expect(l.box("a")).toEqual([0, 0, 10, 100])
    expect(l.box("b")).toEqual([10, 0, 10, 20])
  })
  test("fill on the main axis shares free space by weight (after gaps)", async () => {
    const l = await lay({
      f: { type: "frame", ...root, w: 300, h: 10, layout: row({ gap: 10 }) },
      a: rect("f", 60, 10),
      b: rect("f", fill, 10),
      c: rect("f", { mode: "fill", weight: 2 }, 10),
    })
    expect(l.box("a")).toEqual([0, 0, 60, 10])
    expect(l.box("b")[2]).toBeCloseTo(220 / 3, 3)
    expect(l.box("c")[2]).toBeCloseTo(440 / 3, 3)
    expect(l.box("c")[0] + l.box("c")[2]).toBeCloseTo(300, 3)
  })
  test("fill on the cross axis stretches within the padding box", async () => {
    const l = await lay({
      f: { type: "frame", ...root, w: 200, layout: col({ pad: 10, align: "center" }) },
      a: rect("f", fill, 10),
      b: rect("f", 50, 10),
    })
    expect(l.box("a")).toEqual([10, 10, 180, 10])
    expect(l.box("b")).toEqual([75, 20, 50, 10])
    expect(l.box("f")).toEqual([0, 0, 200, 40])
  })
  test("nested fill: fill inside fill inside a fixed frame", async () => {
    const l = await lay({
      page: { type: "frame", ...root, w: 400, h: 300, layout: col({ pad: 20 }) },
      bar: { type: "frame", parent: "page", w: fill, h: 40, layout: row({ gap: 10 }) },
      logo: rect("bar", 40, 40),
      spacer: { type: "frame", parent: "bar", w: fill, h: fill, layout: row() },
      inner: rect("spacer", fill, fill),
      body: { type: "frame", parent: "page", w: fill, h: fill },
    })
    expect(l.box("bar")).toEqual([20, 20, 360, 40])
    expect(l.box("spacer")).toEqual([50, 0, 310, 40])
    expect(l.box("inner")).toEqual([0, 0, 310, 40])
    expect(l.box("body")).toEqual([20, 60, 360, 220])
    expect(l.world("inner")).toEqual([70, 20, 310, 40])
  })
  test("circular fit/fill: a fit row whose children all fill sizes them as fit", async () => {
    const l = await lay({
      f: { type: "frame", ...root, layout: row({ gap: 5 }) },
      a: { type: "frame", parent: "f", w: fill, h: fill, layout: row() },
      ar: rect("a", 30, 10),
      b: { type: "frame", parent: "f", w: { mode: "fill", fallback: 999 }, layout: row() },
      br: rect("b", 20, 25),
    })
    expect(l.box("f")).toEqual([0, 0, 55, 25])
    expect(l.box("a")).toEqual([0, 0, 30, 25])
    expect(l.box("b")).toEqual([35, 0, 20, 25])
    expect(l.result.issues).toEqual([])
  })
  test("empty fit frame: fallback, else padding (layout) or 0 (no layout)", async () => {
    const l = await lay({
      a: { type: "frame", ...root },
      b: {
        type: "frame",
        ...root,
        w: { mode: "fit", fallback: 50 },
        h: { mode: "fit", fallback: 30 },
      },
      c: { type: "frame", ...root, layout: row({ pad: 10 }) },
      d: { type: "frame", ...root, w: { mode: "fit", fallback: 70 }, layout: row({ pad: 10 }) },
      e: { type: "frame", ...root, w: { mode: "fit", fallback: 70 }, layout: row() },
      ec: rect("e", 5, 5),
    })
    expect(l.box("a")).toEqual([0, 0, 0, 0])
    expect(l.box("b")).toEqual([0, 0, 50, 30])
    expect(l.box("c")).toEqual([0, 0, 20, 20])
    expect(l.box("d")).toEqual([0, 0, 70, 20])
    expect(l.box("e")).toEqual([0, 0, 5, 5]) // has content: fallback unused
  })
  test("hidden children take no space but are still laid out (invisible)", async () => {
    const l = await lay({
      f: { type: "frame", ...root, layout: row({ gap: 10 }) },
      a: rect("f", 20, 10),
      h: rect("f", 100, 100, { visible: false, x: 3, y: 4 }),
      b: rect("f", 20, 10),
    })
    expect(l.box("f")).toEqual([0, 0, 50, 10])
    expect(l.box("b")).toEqual([30, 0, 20, 10])
    expect(l.get("h").visible).toBe(false)
    expect(l.box("h")).toEqual([3, 4, 100, 100])
  })
  test("absolute children are placed by x/y, take no space and use fill fallback", async () => {
    const l = await lay({
      f: { type: "frame", ...root, layout: row({ pad: 5 }) },
      a: rect("f", 20, 10),
      abs: rect("f", { mode: "fill", fallback: 300 }, 40, { position: "absolute", x: -10, y: 2 }),
    })
    expect(l.box("f")).toEqual([0, 0, 30, 20])
    expect(l.box("abs")).toEqual([-10, 2, 300, 40])
  })
  test("negative gap overlaps children and shrinks the fit size", async () => {
    const l = await lay({
      f: { type: "frame", ...root, layout: row({ gap: -5 }) },
      a: rect("f", 20, 10),
      b: rect("f", 20, 10),
      c: rect("f", 20, 10),
    })
    expect([l.box("a")[0], l.box("b")[0], l.box("c")[0]]).toEqual([0, 15, 30])
    expect(l.box("f")[2]).toBe(50)
  })
  test("wrap with crossGap", async () => {
    const l = await lay({
      f: { type: "frame", ...root, w: 100, layout: row({ wrap: true, gap: 10, crossGap: 5 }) },
      a: rect("f", 40, 10),
      b: rect("f", 40, 10),
      c: rect("f", 40, 10),
      d: rect("f", 40, 10),
    })
    expect(l.box("c")).toEqual([0, 15, 40, 10])
    expect(l.box("d")).toEqual([50, 15, 40, 10])
    expect(l.box("f")).toEqual([0, 0, 100, 25])
  })
  test("min/max clamp fit and fill sizes", async () => {
    const l = await lay({
      f: { type: "frame", ...root, w: 300, h: 10, layout: row() },
      a: rect("f", { mode: "fill", max: 100 }, 10),
      b: {
        type: "frame",
        ...root,
        w: { mode: "fit", min: 50 },
        h: { mode: "fit", max: 5 },
        layout: row(),
      },
      bc: rect("b", 10, 20),
    })
    expect(l.box("a")[2]).toBe(100)
    expect(l.box("b")).toEqual([0, 0, 50, 5])
  })
  test("includeStroke adds the stroke width to the padding", async () => {
    const l = await lay({
      f: {
        type: "frame",
        ...root,
        layout: row({ pad: 4, includeStroke: true }),
        stroke: { paint: "#000", width: 2 },
      },
      a: rect("f", 10, 10),
    })
    expect(l.box("a")).toEqual([6, 6, 10, 10])
    expect(l.box("f")).toEqual([0, 0, 22, 22])
  })
  test("a frame without layout and a group sit in a flex row at their content size", async () => {
    const l = await lay({
      f: { type: "frame", ...root, layout: row({ gap: 2 }) },
      box: { type: "frame", parent: "f" },
      bx: rect("box", 10, 10, { x: 5, y: 5 }),
      g: { type: "group", parent: "f", x: 100, y: 100 },
      g1: rect("g", 10, 10, { x: 5, y: 5 }),
      g2: rect("g", 5, 30, { x: 20, y: 0 }),
    })
    expect(l.box("box")).toEqual([0, 0, 15, 15])
    expect(l.box("g")).toEqual([17, 0, 20, 30])
    expect(l.box("g1")).toEqual([0, 5, 10, 10])
    expect(l.world("g2")).toEqual([32, 0, 5, 30])
    expect(l.box("f")).toEqual([0, 0, 37, 30])
  })
})

describe("groups", () => {
  test("bounds are the union of the children; children are relative to that box", async () => {
    const l = await lay({
      g: { type: "group", ...root, x: 10, y: 10 },
      a: rect("g", 10, 10, { x: 5, y: 5 }),
      b: rect("g", 5, 30, { x: 20, y: 0 }),
    })
    expect(l.box("g")).toEqual([15, 10, 20, 30])
    expect(l.box("a")).toEqual([0, 5, 10, 10])
    expect(l.world("a")).toEqual([15, 15, 10, 10])
    expect(l.world("b")).toEqual([30, 10, 5, 30])
  })
  test("an empty group is a zero box at its position", async () => {
    const l = await lay({ g: { type: "group", ...root, x: 7, y: 8 } })
    expect(l.box("g")).toEqual([7, 8, 0, 0])
  })
})

describe("text", () => {
  const text = (content: unknown, extra: Record<string, unknown> = {}) => ({
    type: "text",
    content,
    style: { size: 10 },
    ...extra,
  })
  test("grow auto: both sizes from the content, single line; w/h ignored", async () => {
    const l = await lay({ t: { ...text("Hello", { w: 999, h: 999 }), ...root } })
    expect(l.box("t")).toEqual([0, 0, 25, 12.5])
    expect(l.get("t").text).toMatchObject({ w: 25, h: 12.5, lines: 1, baseline: 8 })
  })
  test("grow auto keeps explicit line breaks", async () => {
    const l = await lay({ t: { ...text("ab\nabcd"), ...root } })
    expect(l.box("t")).toEqual([0, 0, 20, 25])
  })
  test("fixed-width wraps at w and takes its height from the content", async () => {
    const l = await lay({
      t: { ...text("aa bb cc", { grow: "fixed-width", w: 30, h: 1 }), ...root },
    })
    expect(l.box("t")).toEqual([0, 0, 30, 25])
    expect(l.get("t").text?.lines).toBe(2)
  })
  test("fixed uses both sizes", async () => {
    const l = await lay({ t: { ...text("aa bb cc", { grow: "fixed", w: 30, h: 100 }), ...root } })
    expect(l.box("t")).toEqual([0, 0, 30, 100])
  })
  test("fixed-width text that fills a row wraps at the remaining width", async () => {
    const l = await lay({
      f: { type: "frame", ...root, w: 70, layout: row() },
      a: rect("f", 30, 10),
      t: { ...text("aaaa bbbb cccc", { grow: "fixed-width", w: fill }), parent: "f" },
    })
    expect(l.box("t")).toEqual([30, 0, 40, 37.5])
    expect(l.box("f")).toEqual([0, 0, 70, 37.5])
  })
  test("line height: multiplier and px; runs resolve per span", async () => {
    const l = await lay({
      a: { ...text("ab", { style: { size: 10, lineHeight: 2 } }), ...root },
      b: { ...text("ab", { style: { size: 10, lineHeight: { px: 14 } } }), ...root },
      c: {
        type: "text",
        ...root,
        content: [{ text: "ab" }, { text: "cd", style: { size: 40 } }],
        style: { size: 10 },
      },
    })
    expect(l.box("a")[3]).toBe(20)
    expect(l.box("b")[3]).toBe(14)
    expect(l.box("c")[2]).toBe(20) // the fake measurer uses the paragraph style
  })
  test("bound content and size resolve through variables", async () => {
    const l = await lay(
      { t: { type: "text", ...root, content: { $ref: "label" }, style: { size: { $ref: "fs" } } } },
      {
        variables: {
          label: { type: "string", value: "abcd" },
          fs: { type: "number", value: 20 },
        } as never,
      },
    )
    expect(l.box("t")).toEqual([0, 0, 40, 25])
  })
  test("notes and prompts: design width, chrome + wrapped body height (board 22)", async () => {
    const l = await lay({
      n: { type: "note", ...root, content: "abcd" },
      m: { type: "note", ...root, content: "aa bb", w: 20 },
      f: { type: "note", ...root, content: "abcd", w: { mode: "fit" } },
      p: { type: "prompt", ...root, content: "abcd" },
      h: { type: "prompt", ...root, content: "abcd", w: 200, h: 90 },
    })
    // Note: 220 wide (afq5v); body at y 33 = 12 + 13 + 8, 14 below; 12 px × 1.45 lines.
    expect(l.box("n")[2]).toBe(220)
    expect(l.box("n")[3]).toBeCloseTo(33 + 17.4 + 14, 5)
    expect(l.get("n").text?.w).toBe(24)
    // Body width = w - 28 → the words wrap one per line.
    expect(l.box("m")[3]).toBeCloseTo(33 + 2 * 17.4 + 14, 5)
    // fit: unwrapped body + 14 + 14.
    expect(l.box("f")[2]).toBe(52)
    // Prompt: 300 wide (poE5B); head 38 + body padding 10 + 12 × 1.5 + 10 + footer 42.
    expect(l.box("p")).toEqual([0, 0, 300, 38 + 10 + 18 + 10 + 42])
    expect(l.box("h")).toEqual([0, 0, 200, 90])
  })
  test("a note's style applies on top of the card's body style", async () => {
    const l = await lay({ n: { type: "note", ...root, content: "ab", style: { size: 20 } } })
    expect(l.get("n").text?.w).toBe(20)
    expect(l.box("n")[3]).toBeCloseTo(33 + 20 * 1.45 + 14, 5)
  })
  test("a measurer that throws is reported, the box falls back to 0", async () => {
    const { engine, inputFor, nodes } = await import("./helpers")
    const e = await engine()
    const r = e.compute(
      inputFor(
        nodes({ t: { ...text("x"), ...root } }),
        {},
        {
          measure() {
            throw new Error("boom")
          },
        },
      ),
    )
    expect(r.nodes.get("t")?.local).toEqual({ x: 0, y: 0, w: 0, h: 0 })
    expect(r.issues.map((i) => i.code)).toContain("TEXT_MEASURE_FAILED")
  })
})

describe("transforms", () => {
  test("rotation is CCW about the top-left; world is the rotated AABB", async () => {
    const l = await lay({ r: rect("", 20, 10, { parent: null, x: 100, y: 100, rotation: 90 }) })
    expect(l.box("r")).toEqual([100, 100, 20, 10])
    expect(l.get("r").transform).toEqual([0, -1, 1, 0, 100, 100])
    expect(l.world("r")).toEqual([100, 80, 10, 20])
  })
  test("rotation does not change a flowing child's slot", async () => {
    const l = await lay({
      f: { type: "frame", ...root, layout: row() },
      a: rect("f", 20, 10, { rotation: 45 }),
      b: rect("f", 20, 10),
    })
    expect(l.box("b")[0]).toBe(20)
  })
  test("flips mirror around the box center", async () => {
    const l = await lay({ r: rect("", 20, 10, { parent: null, x: 5, y: 5, flipX: true }) })
    expect(l.get("r").transform).toEqual([-1, 0, 0, 1, 25, 5])
    expect(l.world("r")).toEqual([5, 5, 20, 10])
  })
  test("children inherit the parent transform", async () => {
    const l = await lay({
      f: { type: "frame", ...root, x: 100, y: 100, w: 50, h: 50, rotation: 90 },
      c: rect("f", 10, 10, { x: 10, y: 0 }),
    })
    // (10, 0) in f → rotated CCW 90°: (0, -10) + (100, 100)
    expect(l.world("c")).toEqual([100, 80, 10, 10])
  })
})

describe("visibility, order, bounds, issues", () => {
  test("visibility is inherited; bindings resolve", async () => {
    const l = await lay(
      {
        f: { type: "frame", ...root, w: 10, h: 10, visible: { $ref: "show" } },
        c: rect("f", 1, 1),
      },
      { variables: { show: { type: "boolean", value: false } } as never },
    )
    expect(l.get("f").visible).toBe(false)
    expect(l.get("c").visible).toBe(false)
  })
  test("paint order is depth-first in sibling order; bounds unite visible roots", async () => {
    const l = await lay({
      b: { type: "frame", ...root, x: 100, y: 0, w: 10, h: 10, order: "b" },
      a: { type: "frame", ...root, x: -5, y: 20, w: 10, h: 10, order: "a" },
      a1: rect("a", 1, 1, { order: "b" }),
      a0: rect("a", 1, 1, { order: "a" }),
      hidden: { type: "frame", ...root, x: 1000, w: 1, h: 1, visible: false, order: "c" },
    })
    expect(l.result.order).toEqual(["a", "a0", "a1", "b", "hidden"])
    expect(l.result.bounds).toEqual({ x: -5, y: 0, w: 115, h: 30 })
  })
  test("empty document: no bounds", async () => {
    const l = await lay({})
    expect(l.result.bounds).toBeNull()
    expect(l.result.order).toEqual([])
  })
  test("unresolved bindings, missing sizes and unknown types are reported, not thrown", async () => {
    const l = await lay({
      a: rect("", { $ref: "nope" }, 10, { parent: null }),
      b: { type: "rect", ...root, h: 5 },
      c: { type: "sparkle", ...root, w: 4, h: 4 },
    })
    const codes = l.result.issues.map((i) => `${i.nodeId}:${i.code}`)
    expect(codes).toContain("a:VARIABLE_UNRESOLVED")
    expect(codes).toContain("b:INVALID_SIZE")
    expect(codes).toContain("c:UNSUPPORTED_NODE")
    expect(l.box("a")).toEqual([0, 0, 0, 10])
    expect(l.box("b")).toEqual([0, 0, 0, 5])
    expect(l.box("c")).toEqual([0, 0, 4, 4])
  })
  test("path size defaults to viewBox, then geometry bounds", async () => {
    const l = await lay({
      p: { type: "path", ...root, d: "M0 0L10 10", viewBox: [0, 0, 24, 24] },
      q: { type: "path", ...root, d: "M2 3 l 10 0 v 20 z" },
    })
    expect(l.box("p")).toEqual([0, 0, 24, 24])
    expect(l.box("q")).toEqual([0, 0, 10, 20])
  })
  test("changed lists every node on the first pass", async () => {
    const { createLayoutEngine } = await import("../src/index")
    const { inputFor, nodes } = await import("./helpers")
    const e = createLayoutEngine()
    await e.init()
    const r = e.compute(inputFor(nodes({ a: rect("", 1, 1, { parent: null }) })))
    expect([...r.changed]).toEqual(["a"])
    expect(r.version).toBe(1)
    e.dispose()
  })
})
