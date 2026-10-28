/**
 * The Text section's edits: typed values to stored units, the ops they produce, OpenType feature
 * toggles and Reset text style.
 */
import { describe, expect, test } from "bun:test"
import type { NodeData } from "@kimo/editor-state"
import { featureOn, resetStyleOps, toggledFeature } from "../../src/editor/sections/TextSection"
import { growOps, parseLetterSpacing, parseLineHeight, styleOps } from "../../src/editor/text"

const text = (style?: Record<string, unknown>, extra: Record<string, unknown> = {}): NodeData =>
  ({
    type: "text",
    parent: null,
    order: "a0",
    content: "Plan less.",
    ...(style ? { style } : {}),
    ...extra,
  }) as NodeData

describe("Text section", () => {
  test("line height is stored as a ratio (% / 100), letter spacing as px (% × size / 100)", () => {
    expect(parseLineHeight("110%")).toBe(1.1)
    expect(parseLineHeight("140")).toBe(1.4)
    expect(parseLineHeight("auto")).toBeUndefined()
    expect(parseLineHeight("24px")).toEqual({ px: 24 })
    expect(parseLineHeight("abc")).toBeNull()
    expect(parseLetterSpacing("-2%", 48)).toBe(-0.96)
    expect(parseLetterSpacing("1.5px", 48)).toBe(1.5)
    expect(parseLetterSpacing("x", 48)).toBeNull()
  })

  test("styleOps makes one update per node, and an emptied style is removed", () => {
    const sel = [
      { id: "T1", node: text({ case: "upper" }) },
      { id: "T2", node: text({ size: 20, case: "upper" }) },
    ]
    expect(styleOps(sel, "case", () => undefined)).toEqual([
      { op: "update", id: "T1", unset: ["style"] },
      { op: "update", id: "T2", set: { style: { size: 20 } } },
    ])
    expect(styleOps(sel.slice(0, 1), "align", () => "center")).toEqual([
      { op: "update", id: "T1", set: { style: { case: "upper", align: "center" } } },
    ])
  })

  test("Resizing between auto, fixed width and fixed size keeps the laid-out box", () => {
    const sel = [{ id: "T1", node: text(undefined, { grow: "fixed-width", w: 272 }) }]
    const laid = () => ({ w: 272, h: 61.6 })
    expect(growOps(sel, "auto", laid)).toEqual([
      { op: "update", id: "T1", unset: ["grow", "w", "h"] },
    ])
    expect(growOps(sel, "fixed", laid)).toEqual([
      { op: "update", id: "T1", set: { grow: "fixed", w: 272, h: 61.6 } },
    ])
    expect(growOps([{ id: "T2", node: text() }], "fixed-width", laid)).toEqual([
      { op: "update", id: "T2", set: { grow: "fixed-width", w: 272 }, unset: ["h"] },
    ])
  })
})

describe("font features", () => {
  test("liga and calt default on: toggling writes false, toggling back removes the key", () => {
    expect(featureOn({}, "liga")).toBe(true)
    expect(featureOn({}, "tnum")).toBe(false)
    expect(toggledFeature({}, "liga")).toBe(false)
    expect(toggledFeature({ liga: false }, "liga")).toBeUndefined()
    expect(toggledFeature({}, "tnum")).toBe(true)
    expect(toggledFeature({ tnum: true }, "tnum")).toBeUndefined()
  })
})

describe("Reset text style", () => {
  test("keeps font, size, weight and align and drops the rest", () => {
    const node = {
      type: "text",
      style: {
        font: "Inter",
        size: 32,
        weight: 600,
        align: "center",
        italic: true,
        href: "https://x",
        features: { tnum: true },
        decoration: ["underline"],
        case: "upper",
      },
    }
    const [op] = resetStyleOps([{ id: "T1", node } as never])
    expect(op).toEqual({
      op: "update",
      id: "T1",
      set: { style: { font: "Inter", size: 32, weight: 600, align: "center" } },
    })
    expect(
      resetStyleOps([{ id: "T2", node: { type: "text", style: { italic: true } } } as never])[0],
    ).toEqual({
      op: "update",
      id: "T2",
      unset: ["style"],
    })
  })
})
