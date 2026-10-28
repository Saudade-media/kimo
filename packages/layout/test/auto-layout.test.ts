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
  test("column: gap, fit = content, [v, h] and [t, r, b, l] padding", async () => {
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

  test("justify distributes the free main-axis space", async () => {
    const justify = async (j: string, n = 2) => {
      const spec: Record<string, Record<string, unknown>> = {
        f: { type: "frame", ...root, w: 200, h: 20, layout: row({ justify: j }) },
      }
      for (let i = 0; i < n; i++) spec[`c${i}`] = rect("f", 20, 10)
      const l = await lay(spec as never)
      return Array.from({ length: n }, (_, i) => l.box(`c${i}`)[0])
    }
    expect(await justify("center")).toEqual([80, 100])
    expect(await justify("end")).toEqual([160, 180])
    expect(await justify("between")).toEqual([0, 180])
    expect(await justify("between", 1)).toEqual([0])
    expect(await justify("around")).toEqual([40, 140])
    const ev = await justify("evenly")
    expect(ev[0]).toBeCloseTo(160 / 3, 3)
    expect(ev[1]).toBeCloseTo(20 + (2 * 160) / 3, 3)
  })

  test("align places children on the cross axis; stretch only grows fit children", async () => {
    const at = async (a: string) =>
      (
        await lay({
          f: { type: "frame", ...root, w: 100, h: 100, layout: row({ align: a }) },
          c: rect("f", 10, 20),
        })
      ).box("c")[1]
    expect(await at("center")).toBe(40)
    expect(await at("end")).toBe(80)
    const l = await lay({
      f: { type: "frame", ...root, w: 100, h: 100, layout: row({ align: "stretch" }) },
      a: { type: "frame", parent: "f", w: 10, layout: col() },
      b: rect("f", 10, 20),
    })
    expect(l.box("a")).toEqual([0, 0, 10, 100])
    expect(l.box("b")).toEqual([10, 0, 10, 20])
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

  test("a fit row whose children all fill sizes them as fit; a fixed sibling breaks the cycle", async () => {
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
    expect(l.get("a").sizing).toEqual({ w: "fit", h: "fill" })
    expect(l.get("b").sizing).toEqual({ w: "fit", h: "fit" })
    expect(l.result.issues).toEqual([])
    const m = await lay({
      f: { type: "frame", ...root, w: 200, layout: row() },
      a: rect("f", fill, 10),
      b: rect("f", fill, 10),
    })
    expect(m.get("a").sizing?.w).toBe("fill")
    expect(m.box("b")).toEqual([100, 0, 100, 10])
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
    expect(l.get("abs").inFlow).toBe(false)
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

  test("wrap: fit height grows with the rows (crossGap, padding); content box excludes padding", async () => {
    const l = await lay({
      f: {
        type: "frame",
        ...root,
        w: 120,
        layout: row({ wrap: true, gap: 10, crossGap: 4, pad: 10 }),
      },
      a: rect("f", 40, 10),
      b: rect("f", 40, 10),
      c: rect("f", 60, 20),
    })
    expect(l.box("c")).toEqual([10, 24, 60, 20])
    expect(l.box("f")).toEqual([0, 0, 120, 54])
    expect(l.get("f").content).toEqual({ x: 10, y: 10, w: 100, h: 34 })
  })

  test("min/max clamp fit sizes", async () => {
    const l = await lay({
      b: {
        type: "frame",
        ...root,
        w: { mode: "fit", min: 50 },
        h: { mode: "fit", max: 5 },
        layout: row(),
      },
      bc: rect("b", 10, 20),
    })
    expect(l.box("b")).toEqual([0, 0, 50, 5])
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

describe("NodeLayout.sizing / inFlow / content", () => {
  test("fixed, fit (Hug) and fill per axis; inFlow for flowing children only", async () => {
    const l = await lay({
      f: { type: "frame", ...root, w: 300, layout: row({ pad: [10, 20], gap: 8 }) },
      a: rect("f", 48, 48),
      b: rect("f", fill, fill),
      c: { type: "frame", parent: "f", layout: col({ pad: 4 }) },
      cc: rect("c", 20, 30),
      abs: rect("f", fill, 10, { position: "absolute", x: 5, y: 5 }),
      absF: rect("f", { mode: "fill", fallback: 40 }, 10, { position: "absolute" }),
      hid: rect("f", 10, 10, { visible: false }),
    })
    expect(l.get("f").sizing).toEqual({ w: "fixed", h: "fit" })
    expect(l.get("a").sizing).toEqual({ w: "fixed", h: "fixed" })
    expect(l.get("b").sizing).toEqual({ w: "fill", h: "fill" })
    expect(l.get("c").sizing).toEqual({ w: "fit", h: "fit" })
    // fill outside the flow: fallback gives fixed, none gives content (fit)
    expect(l.get("abs").sizing).toEqual({ w: "fit", h: "fixed" })
    expect(l.get("absF").sizing).toEqual({ w: "fixed", h: "fixed" })
    expect(l.get("f").inFlow).toBe(false)
    expect(l.get("a").inFlow).toBe(true)
    expect(l.get("c").inFlow).toBe(true)
    expect(l.get("cc").inFlow).toBe(true)
    expect(l.get("abs").inFlow).toBe(false)
    expect(l.get("hid").inFlow).toBe(false)
    // content = inside the padding [10, 20, 10, 20] of the 300 x 68 frame
    expect(l.box("f")).toEqual([0, 0, 300, 68])
    expect(l.get("f").content).toEqual({ x: 20, y: 10, w: 260, h: 48 })
    expect(l.get("c").content).toEqual({ x: 4, y: 4, w: 20, h: 30 })
    expect(l.get("a").content).toBeUndefined()
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
    // (10, 0) in f, rotated CCW 90 degrees: (0, -10) + (100, 100)
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
})
