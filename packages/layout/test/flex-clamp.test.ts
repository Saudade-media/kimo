/**
 * M7 findings (ADR 0015): `dimension`-bound lengths and min/max of fill items, both as CSS
 * computes them (the exported HTML is box-diffed against this engine).
 */
import { describe, expect, test } from "bun:test"
import { createLayoutEngine } from "../src/index"
import { inputFor, lay, nodes } from "./helpers"

const box = (
  parent: string,
  w: unknown,
  h: unknown = 100,
  extra: Record<string, unknown> = {},
) => ({
  type: "frame",
  parent,
  w,
  h,
  ...extra,
})
const dim = (value: number) => ({ type: "dimension", value: { value, unit: "px" } })

describe("dimension-bound lengths", () => {
  test("gap, padding, sizes and crossGap read a dimension variable as px", async () => {
    const l = await lay(
      {
        f: {
          type: "frame",
          parent: null,
          w: 200,
          layout: {
            dir: "row",
            gap: { $ref: "s" },
            pad: { $ref: "p" },
            wrap: true,
            crossGap: { $ref: "s" },
          },
        },
        a: box("f", { $ref: "w" }, 10),
        b: box("f", 10, { $ref: "w" }),
        c: box("f", 150, 10),
      },
      { variables: { s: dim(8), p: dim(4), w: dim(30) } as never },
    )
    expect(l.box("a")).toEqual([4, 4, 30, 10])
    expect(l.box("b")).toEqual([42, 4, 10, 30])
    // Wraps to a second line 8 below the first (crossGap).
    expect(l.box("c")).toEqual([4, 42, 150, 10])
  })
  test("bindings inside a padding array resolve (2- and 4-value forms)", async () => {
    const l = await lay(
      {
        two: {
          type: "frame",
          parent: null,
          layout: { dir: "row", pad: [{ $ref: "v" }, { $ref: "h" }] },
        },
        a: box("two", 10, 10),
        four: {
          type: "frame",
          parent: null,
          x: 100,
          layout: { dir: "row", pad: [{ $ref: "v" }, 3, { $ref: "h" }, 5] },
        },
        b: box("four", 10, 10),
      },
      { variables: { v: dim(6), h: { type: "number", value: 9 } } as never },
    )
    expect(l.box("a")).toEqual([9, 6, 10, 10])
    expect(l.box("b")).toEqual([5, 6, 10, 10])
  })
  test("a themed dimension and an alias of one resolve too", async () => {
    const l = await lay(
      {
        f: { type: "frame", parent: null, layout: { dir: "row", gap: { $ref: "alias" } } },
        a: box("f", 10, 10),
        b: box("f", 10, 10),
      },
      {
        themes: { density: ["compact", "loose"] },
        variables: {
          g: {
            type: "dimension",
            value: [
              { value: { value: 4, unit: "px" }, when: { density: "compact" } },
              { value: { value: 12, unit: "px" }, when: { density: "loose" } },
            ],
          },
          alias: { type: "dimension", value: { $ref: "g" } },
        } as never,
      },
    )
    expect(l.box("b")[0]).toBe(14)
  })
})

describe("min/max of fill items (CSS resolving flexible lengths)", () => {
  test("a min violator is frozen; the rest of the free space goes to the others", async () => {
    // Free space 320 − 200 − 16 = 104 → 69.3 / 34.7; `a` clamps to 100, `b` gets 4.
    const l = await lay({
      g: { type: "frame", parent: null, w: 320, layout: { dir: "row", gap: 8 } },
      a: box("g", { mode: "fill", weight: 2, min: 100 }),
      b: box("g", { mode: "fill" }),
      c: box("g", 200),
    })
    expect(l.box("a")).toEqual([0, 0, 100, 100])
    expect(l.box("b")).toEqual([108, 0, 4, 100])
    expect(l.box("c")).toEqual([120, 0, 200, 100])
  })
  test("features-all: fit + min container, wrap, gap bound to a dimension", async () => {
    const l = await lay(
      {
        g: {
          type: "frame",
          parent: null,
          w: { mode: "fit", min: 320, max: 1200 },
          layout: {
            dir: "row",
            gap: { $ref: "space-s" },
            crossGap: 16,
            align: "stretch",
            wrap: true,
          },
        },
        a: box("g", { mode: "fill", weight: 2, min: 100 }),
        b: box("g", { mode: "fill" }),
        c: box("g", 200),
      },
      { variables: { "space-s": dim(8) } as never },
    )
    expect(l.box("g")[2]).toBe(320)
    expect(l.box("a")).toEqual([0, 0, 100, 100])
    expect(l.box("b")).toEqual([108, 0, 4, 100])
  })
  test("a max violator is frozen; the others grow past their share", async () => {
    // 300 / 3 = 100 each; `a` caps at 40 → `b` and `c` share 260.
    const l = await lay({
      g: { type: "frame", parent: null, w: 300, h: 10, layout: { dir: "row" } },
      a: box("g", { mode: "fill", max: 40 }, 10),
      b: box("g", { mode: "fill" }, 10),
      c: box("g", { mode: "fill" }, 10),
    })
    expect(l.box("a")[2]).toBe(40)
    expect(l.box("b")).toEqual([40, 0, 130, 10])
    expect(l.box("c")).toEqual([170, 0, 130, 10])
  })
  test("column axis and shrinking below the content: min holds", async () => {
    const l = await lay({
      g: { type: "frame", parent: null, w: 10, h: 100, layout: { dir: "column" } },
      a: box("g", 10, { mode: "fill", min: 80 }),
      b: box("g", 10, { mode: "fill" }),
      c: box("g", 10, 50),
    })
    // Free space 50: 25 / 25; `a` clamps to 80 → `b` shrinks to 0 (overflow like CSS).
    expect(l.box("a")).toEqual([0, 0, 10, 80])
    expect(l.box("b")).toEqual([0, 80, 10, 0])
    expect(l.box("c")).toEqual([0, 80, 10, 50])
  })
  test("no violation: the plain distribution is kept", async () => {
    const l = await lay({
      g: { type: "frame", parent: null, w: 300, h: 10, layout: { dir: "row" } },
      a: box("g", { mode: "fill", min: 50, max: 200 }, 10),
      b: box("g", { mode: "fill" }, 10),
    })
    expect(l.box("a")).toEqual([0, 0, 150, 10])
    expect(l.box("b")).toEqual([150, 0, 150, 10])
  })
  test("incremental: resizing the container re-resolves (frozen items thaw)", async () => {
    const e = createLayoutEngine()
    await e.init()
    const table = (w: number) =>
      nodes({
        g: { type: "frame", parent: null, w, layout: { dir: "row", gap: 8 } },
        a: box("g", { mode: "fill", weight: 2, min: 100 }),
        b: box("g", { mode: "fill" }),
        c: box("g", 200),
      } as never)
    const first = e.compute(inputFor(table(320)))
    expect(first.nodes.get("a")?.local.w).toBe(100)
    // 616 − 216 = 400 → 266.7 / 133.3: no violation any more.
    const wide = e.update(inputFor(table(616)), { nodes: ["g"] })
    expect(wide.nodes.get("a")?.local.w).toBeCloseTo(266.6667, 3)
    expect(wide.nodes.get("b")?.local.w).toBeCloseTo(133.3333, 3)
    const narrow = e.update(inputFor(table(320)), { nodes: ["g"] })
    expect(narrow.nodes.get("a")?.local.w).toBe(100)
    expect(narrow.nodes.get("b")?.local.w).toBe(4)
    // An unrelated edit keeps the resolved sizes.
    const t = table(320)
    ;(t.c as { name?: string }).name = "renamed"
    const same = e.update(inputFor(t), { nodes: ["c"] })
    expect(same.nodes.get("a")?.local.w).toBe(100)
    expect(same.nodes.get("b")?.local.w).toBe(4)
  })
})

describe("min/max in wrapping containers", () => {
  test("lines break on the clamped sizes (CSS hypothetical main size)", async () => {
    // 248 wide: 100 + 8 + 100 fit, a third 100 wraps; each line shares its own free space.
    const l = await lay({
      g: { type: "frame", parent: null, w: 248, layout: { dir: "row", wrap: true, gap: 8 } },
      a: box("g", { mode: "fill", min: 100 }, 28),
      b: box("g", { mode: "fill", min: 100 }, 28),
      c: box("g", { mode: "fill", min: 100, max: 120 }, 28),
    })
    expect(l.box("a")).toEqual([0, 0, 120, 28])
    expect(l.box("b")).toEqual([128, 0, 120, 28])
    expect(l.box("c")).toEqual([0, 28, 120, 28])
  })
})
