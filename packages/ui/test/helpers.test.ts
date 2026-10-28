/** Pure logic behind the pickers, lists and popovers. */
import { describe, expect, test } from "bun:test"
import fc from "fast-check"
import { createElement as h } from "react"
import { renderToString } from "react-dom/server"
import {
  alignmentCell,
  anchoredPosition,
  cellAlignment,
  colorAt,
  FontRow,
  filterIcons,
  middleTruncate,
  moveItem,
  visibleRows,
} from "../src/index"

describe("anchoredPosition", () => {
  const vp = { x: 0, y: 0, width: 1000, height: 800 }
  const box = { width: 248, height: 300 }

  test("flips above when it does not fit below", () => {
    const p = anchoredPosition({ x: 100, y: 600, width: 200, height: 28 }, box, vp)
    expect(p).toEqual({ x: 100, y: 296, side: "top" })
  })

  test("shifts inside the viewport on the cross axis", () => {
    const p = anchoredPosition({ x: 900, y: 100, width: 80, height: 28 }, box, vp)
    expect(p.x).toBe(1000 - 8 - 248)
  })

  test("never leaves the padded viewport horizontally (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -50, max: 1050 }),
        fc.integer({ min: 0, max: 780 }),
        fc.integer({ min: 10, max: 300 }),
        (x, y, w) => {
          const p = anchoredPosition({ x, y, width: w, height: 20 }, box, vp)
          expect(p.x).toBeGreaterThanOrEqual(8)
          expect(p.x + box.width).toBeLessThanOrEqual(992)
        },
      ),
    )
  })
})

describe("list and picker helpers", () => {
  test("alignment cells map to justify/align and back for both directions", () => {
    expect(alignmentCell("row", "end", "start")).toEqual({ row: 0, col: 2 })
    expect(alignmentCell("column", "end", "start")).toEqual({ row: 2, col: 0 })
    expect(alignmentCell("row", "between", "center")).toBeNull()
    for (const dir of ["row", "column"] as const)
      for (let row = 0; row < 3; row++)
        for (let col = 0; col < 3; col++) {
          const a = cellAlignment(dir, row, col)
          expect(alignmentCell(dir, a.justify, a.align)).toEqual({ row, col })
        }
  })

  test("gradient colorAt interpolates between stops and clamps outside them", () => {
    const stops = [
      { color: "#000000", at: 0 },
      { color: "#FFFFFF", at: 1 },
    ]
    expect(colorAt(stops, 0.5).toUpperCase()).toMatch(/^#(7F|80){3}$/)
    expect(colorAt(stops, -1).toUpperCase()).toBe("#000000")
  })

  test("filterIcons ranks prefix matches first and matches tags", () => {
    const list = [
      { name: "arrow-up" },
      { name: "map" },
      { name: "camera", tags: ["photo"] },
      { name: "cam" },
    ]
    expect(filterIcons(list, "cam").map((e) => e.name)).toEqual(["camera", "cam"])
    expect(filterIcons(list, "photo").map((e) => e.name)).toEqual(["camera"])
    expect(filterIcons(list, "").length).toBe(4)
  })

  test("visibleRows covers the viewport plus overscan and never exceeds the list", () => {
    expect(visibleRows(0, 140, 100)).toEqual({ first: 0, last: 6 })
    expect(visibleRows(360, 140, 100)).toEqual({ first: 8, last: 16 })
    expect(visibleRows(0, 140, 2)).toEqual({ first: 0, last: 1 })
  })

  test("moveItem reorders both ways", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"])
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"])
  })

  test("middleTruncate keeps both ends", () => {
    const measure = (s: string) => s.length
    expect(middleTruncate("~/Work/kimo-site/design", 100, measure)).toBe("~/Work/kimo-site/design")
    const cut = middleTruncate("~/Work/kimo-site/design/shared", 12, measure)
    expect(cut.length).toBeLessThanOrEqual(12)
    expect(cut.startsWith("~/W")).toBe(true)
    expect(cut.endsWith("ed")).toBe(true)
    expect(cut).toContain("…")
  })
})

describe("FontRow", () => {
  test("a hostile family name cannot break out of the specimen style", () => {
    const html = renderToString(
      h(FontRow, {
        family: 'X"; background:url(evil)',
        meta: "",
        source: "Document",
        status: "installed",
      }),
    )
    expect(html).not.toContain('X";')
  })
})
