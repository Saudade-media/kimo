import { describe, expect, test } from "bun:test"
import { engine, inputFor, lay, nodes } from "./helpers"

const root = { parent: null }
const fill = { mode: "fill" }
const text = (content: unknown, extra: Record<string, unknown> = {}) => ({
  type: "text",
  content,
  style: { size: 10 },
  ...extra,
})

// The fake measurer: 5 px per glyph at size 10, 12.5 px lines.
describe("text layout", () => {
  test("grow auto: both sizes from the content, single line; w/h ignored", async () => {
    const l = await lay({ t: { ...text("Hello", { w: 999, h: 999 }), ...root } })
    expect(l.box("t")).toEqual([0, 0, 25, 12.5])
    expect(l.get("t").text).toMatchObject({ w: 25, h: 12.5, lines: 1, baseline: 8 })
  })

  test("fixed-width wraps at w and takes its height from the content", async () => {
    const l = await lay({
      t: { ...text("aa bb cc", { grow: "fixed-width", w: 30, h: 1 }), ...root },
    })
    expect(l.box("t")).toEqual([0, 0, 30, 25])
    expect(l.get("t").text?.lines).toBe(2)
  })

  test("fixed-width text that fills a row wraps at the remaining width", async () => {
    const l = await lay({
      f: { type: "frame", ...root, w: 70, layout: { dir: "row" } },
      a: { type: "rect", parent: "f", w: 30, h: 10 },
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

  test("a note wraps its body inside its width and grows taller; an explicit h wins", async () => {
    const l = await lay({
      wide: { type: "note", ...root, content: "aa bb" },
      narrow: { type: "note", ...root, content: "aa bb", w: 20 },
      fit: { type: "note", ...root, content: "aa bb", w: { mode: "fit" } },
      p: { type: "prompt", ...root, content: "aa bb" },
      fixed: { type: "prompt", ...root, content: "aa bb", w: 200, h: 90 },
    })
    expect(l.box("narrow")[3]).toBeGreaterThan(l.box("wide")[3])
    expect(l.box("fit")[2]).toBeLessThan(l.box("wide")[2])
    expect(l.box("p")[3]).toBeGreaterThan(0)
    expect(l.box("fixed")).toEqual([0, 0, 200, 90])
  })

  test("a measurer that throws is reported, the box falls back to 0", async () => {
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
