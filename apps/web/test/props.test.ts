import { describe, expect, test } from "bun:test"
import type { NodeData } from "@kimo/editor-state"
import {
  effectValue,
  formatPad,
  formatSize,
  joinHex,
  kindLabel,
  MIXED,
  normalizeHex,
  paintLabel,
  paintOpacity,
  parseEffectValue,
  parseNumber,
  parsePad,
  parseRadius,
  parseSize,
  setOps,
  shared,
  splitHex,
  strokeWithWidth,
  typeIcon,
  withLayoutField,
} from "../src/editor/props"

const node = (o: Record<string, unknown>): NodeData =>
  ({ parent: "p00001", order: "a", ...o }) as unknown as NodeData

describe("sizes", () => {
  test("format", () => {
    expect(formatSize(720)).toBe("720")
    expect(formatSize(12.345)).toBe("12.35")
    expect(formatSize({ mode: "fit" })).toBe("Hug")
    expect(formatSize({ mode: "fill" })).toBe("Fill")
    expect(formatSize({ $ref: "size/lg" })).toBe("$size/lg")
    expect(formatSize(undefined)).toBe("Hug")
  })
  test("parse", () => {
    expect(parseSize("hug")).toEqual({ mode: "fit" })
    expect(parseSize(" Fill ")).toEqual({ mode: "fill" })
    expect(parseSize("120+24")).toBe(144)
    expect(parseSize("-4")).toBeNull()
    expect(parseSize("abc")).toBeNull()
  })
  test("arithmetic", () => {
    expect(parseNumber("(10+2)/3")).toBe(4)
    expect(parseNumber("2*-3")).toBe(-6)
    expect(parseNumber("1,5")).toBe(1.5)
    expect(parseNumber("2+")).toBeNull()
    expect(parseNumber("alert(1)")).toBeNull()
  })
})

describe("padding and radius", () => {
  test("format", () => {
    expect(formatPad([64, 96])).toBe("64 · 96")
    expect(formatPad([48, 40, 40, 40])).toBe("48 40 40 40")
    expect(formatPad([48, 40, 48, 40])).toBe("48 · 40")
    expect(formatPad([8, 8])).toBe("8")
    expect(formatPad(undefined)).toBe("0")
  })
  test("parse", () => {
    expect(parsePad("64 · 96")).toEqual([64, 96])
    expect(parsePad("1, 2, 3, 4")).toEqual([1, 2, 3, 4])
    expect(parsePad("8")).toBe(8)
    expect(parsePad("1 2 3")).toBeNull()
    expect(parseRadius("4 4 0 0")).toEqual([4, 4, 0, 0])
    expect(parseRadius("4 4")).toBeNull()
  })
})

describe("mixed values", () => {
  test("shared value or MIXED", () => {
    const a = node({ type: "rect", w: 10 })
    const b = node({ type: "rect", w: 10 })
    const c = node({ type: "rect", w: 20 })
    expect(shared([a, b], (n) => n.w)).toBe(10)
    expect(shared([a, c], (n) => n.w)).toBe(MIXED)
    expect(
      shared(
        [
          node({ type: "frame", layout: { dir: "row", gap: 2 } }),
          node({ type: "frame", layout: { gap: 2, dir: "row" } }),
        ],
        (n) => n.layout,
      ),
    ).toEqual({ dir: "row", gap: 2 })
  })
})

describe("paints", () => {
  test("hex helpers", () => {
    expect(normalizeHex("abc")).toBe("#AABBCC")
    expect(normalizeHex("#zzz")).toBeNull()
    expect(splitHex("#1B1A1826")).toEqual({ rgb: "#1B1A18", alpha: 0x26 / 255 })
    expect(joinHex("#ff0000", 1)).toBe("#FF0000")
    expect(joinHex("#ff0000", 0.5)).toBe("#FF000080")
  })
  test("labels", () => {
    expect(paintLabel("#fff7ee")).toBe("#FFF7EE")
    expect(paintLabel({ kind: "solid", color: "#000000" })).toBe("#000000")
    expect(paintLabel({ $ref: "brand/sand" })).toBe("$brand/sand")
    expect(paintLabel({ kind: "linear", stops: [] })).toBe("Linear")
    expect(paintOpacity("#00000080")).toBe("50%")
    expect(paintOpacity("#000")).toBe("100%")
  })
})

describe("strokes and effects", () => {
  test("stroke width edits", () => {
    expect(strokeWithWidth(undefined, 2)).toEqual({ paint: "#0A0A0A", width: 2 })
    expect(strokeWithWidth({ paint: "#111111", width: 1 }, 3)).toEqual({
      paint: "#111111",
      width: 3,
    })
    expect(strokeWithWidth({ paint: "#111111" }, 0)).toBeUndefined()
  })
  test("shadow value", () => {
    const s = { kind: "shadow", x: 0, y: 8, blur: 24, color: "#1B1A1826" }
    expect(effectValue(s)).toBe("0 8 24")
    expect(parseEffectValue(s, "1 2 3")).toEqual({ ...s, x: 1, y: 2, blur: 3 })
    expect(parseEffectValue(s, "1 2")).toBeNull()
  })
})

describe("kinds, icons and ops", () => {
  test("icons follow board 03", () => {
    expect(typeIcon(node({ type: "frame" }))).toBe("frame")
    expect(typeIcon(node({ type: "frame", parent: null, w: 280, h: 560 }))).toBe("smartphone")
    expect(typeIcon(node({ type: "text" }))).toBe("type")
    expect(
      typeIcon(
        node({ type: "rect", fill: { kind: "image", src: "./assets/0123456789abcdef.png" } }),
      ),
    ).toBe("image")
    expect(typeIcon(node({ type: "frame", component: true }))).toBe("component")
    expect(typeIcon(node({ type: "instance" }))).toBe("diamond")
    expect(kindLabel(node({ type: "rect" }))).toBe("Rectangle")
  })
  test("set ops: one update per id, undefined unsets", () => {
    expect(setOps(["a", "b"], "w", 10)).toEqual([
      { op: "update", id: "a", set: { w: 10 } },
      { op: "update", id: "b", set: { w: 10 } },
    ])
    expect(setOps(["a"], "radius", undefined)).toEqual([
      { op: "update", id: "a", unset: ["radius"] },
    ])
  })
  test("layout field edits keep other fields", () => {
    expect(
      withLayoutField(node({ type: "frame", layout: { dir: "column", gap: 4 } }), "pad", [1, 2]),
    ).toEqual({
      dir: "column",
      gap: 4,
      pad: [1, 2],
    })
    expect(withLayoutField(node({ type: "frame" }), "gap", 8)).toEqual({ dir: "row", gap: 8 })
  })
})
