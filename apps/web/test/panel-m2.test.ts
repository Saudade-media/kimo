import { describe, expect, test } from "bun:test"
import { validate } from "@kimo/core-schema"
import { createDocStore, type NodeData } from "@kimo/editor-state"
import {
  editColor,
  formatColor,
  hslToRgb,
  hsvToRgb,
  oklchToRgb,
  parseColor,
  parseHex,
  parsePercent,
  rgbToHsl,
  rgbToHsv,
  rgbToOklch,
  toHex,
} from "@kimo/ui"
import fc from "fast-check"
import {
  blendOf,
  blendValue,
  colorAt,
  dashOf,
  effectKind,
  fillValue,
  flipGradient,
  iconLibrary,
  iconSet,
  mergeStops,
  moveItem,
  NEW_EFFECT,
  padSides,
  padValue,
  paintAlpha,
  paintCss,
  paintRowLabel,
  paintVisible,
  rotateGradient,
  rowsTopFirst,
  sizeModeFields,
  sizeModeOf,
  sizeModes,
  strokeSides,
  withDash,
  withEffectKind,
  withEffectVisible,
  withPaintAlpha,
  withPaintVisible,
  withSide,
  withSidesMode,
  withSolid,
  withStrokeField,
} from "../src/editor/style"
import { newDocument } from "../src/lib/sample"

const node = (o: Record<string, unknown>): NodeData =>
  ({ parent: "p00001", order: "a", ...o }) as unknown as NodeData

const byte = fc.integer({ min: 0, max: 255 })
const rgba = fc.record({ r: byte, g: byte, b: byte, a: fc.constant(1) })

describe("color", () => {
  test("hex parse / format", () => {
    expect(parseHex("#f4a261")).toEqual({ r: 244, g: 162, b: 97, a: 1 })
    expect(parseHex("abc")).toEqual({ r: 170, g: 187, b: 204, a: 1 })
    expect(parseHex("#0A0A0A1F")?.a).toBeCloseTo(31 / 255)
    expect(parseHex("#12")).toBeNull()
    expect(toHex({ r: 244, g: 162, b: 97, a: 1 })).toBe("#F4A261")
    expect(toHex({ r: 10, g: 10, b: 10, a: 0.12 })).toBe("#0A0A0A1F")
  })
  test("HSV round trip (property)", () => {
    fc.assert(
      fc.property(rgba, (c) => {
        expect(toHex(hsvToRgb(rgbToHsv(c)))).toBe(toHex(c))
      }),
    )
  })
  test("HSL round trip (property)", () => {
    fc.assert(
      fc.property(rgba, (c) => {
        expect(toHex(hslToRgb(rgbToHsl(c)))).toBe(toHex(c))
      }),
    )
  })
  test("OKLCH round trip within 1 unit (property)", () => {
    fc.assert(
      fc.property(rgba, (c) => {
        const o = rgbToOklch(c)
        const back = oklchToRgb(o)
        expect(Math.abs(back.r - c.r)).toBeLessThan(1)
        expect(Math.abs(back.g - c.g)).toBeLessThan(1)
        expect(Math.abs(back.b - c.b)).toBeLessThan(1)
      }),
    )
  })
  test("format menu meta values (board 09 GbOS1 for #F4A261)", () => {
    const c = { r: 244, g: 162, b: 97, a: 1 }
    expect(formatColor(c, "hex")).toBe("F4A261")
    expect(formatColor(c, "rgb")).toBe("244 162 97")
    expect(formatColor(c, "hsl")).toBe("27 87 67")
    // The design's sample meta says "0.78 0.13 55"; the exact OKLab hue of #F4A261 is 57.9°.
    expect(formatColor(c, "oklch")).toBe("0.78 0.13 58")
  })
  test("parse values per format, keeping alpha", () => {
    expect(toHex(parseColor("244 162 97", "rgb", 0.5) as never)).toBe("#F4A26180")
    expect(toHex(parseColor("#f4a261", "hex", 1) as never)).toBe("#F4A261")
    expect(parseColor("1 2", "rgb")).toBeNull()
    expect(parsePercent("80%")).toBe(0.8)
    expect(parsePercent("150")).toBe(1)
    expect(parsePercent("x")).toBeNull()
    expect(parsePercent("")).toBeNull()
    expect(parseColor("#F008", "hex", 1)?.a).toBeCloseTo(0.53, 2)
  })
  test("editing one channel keeps the others exact (property)", () => {
    fc.assert(
      fc.property(rgba, (c) => {
        for (const f of ["rgb", "hsl", "oklch"] as const) {
          // Re-committing the shown (rounded) text changes nothing.
          expect(toHex(editColor(c, f, formatColor(c, f)) as never)).toBe(toHex(c))
        }
      }),
    )
  })
  test("out-of-gamut OKLCH reduces chroma (hue kept) instead of clipping channels", () => {
    const c = parseColor("0.7 0.4 30", "oklch") as NonNullable<ReturnType<typeof parseColor>>
    const back = rgbToOklch(c)
    expect(Math.abs(back.h - 30)).toBeLessThan(2)
    expect(Math.abs(back.l - 0.7)).toBeLessThan(0.01)
  })
})

describe("paints", () => {
  test("rows list the top paint first", () => {
    expect(rowsTopFirst(["a", "b", "c"]).map((r) => r.index)).toEqual([2, 1, 0])
  })
  test("moveItem keeps every paint (property)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer(), { minLength: 1, maxLength: 8 }),
        fc.nat(),
        fc.nat(),
        (list, a, b) => {
          const from = a % list.length
          const to = b % list.length
          const out = moveItem(list, from, to)
          expect([...out].sort()).toEqual([...list].sort())
          expect(out[to]).toBe(list[from] as number)
        },
      ),
    )
  })
  test("visibility wraps a bare color and collapses back", () => {
    const hidden = withPaintVisible("#F4A261", false)
    expect(hidden).toEqual({ kind: "solid", color: "#F4A261", visible: false })
    expect(paintVisible(hidden)).toBe(false)
    expect(withPaintVisible(hidden, true)).toBe("#F4A261")
    expect(withPaintVisible({ kind: "linear", stops: [], visible: false }, true)).toEqual({
      kind: "linear",
      stops: [],
    })
  })
  test("labels and fonts (board 08 Fill rows)", () => {
    expect(paintRowLabel("#F4A261")).toEqual({ label: "F4A261", font: "mono" })
    expect(paintRowLabel({ $ref: "brand/sand" })).toEqual({ label: "brand/sand", font: "sans" })
    expect(paintRowLabel({ kind: "linear", stops: [] }).label).toBe("Linear")
    expect(paintRowLabel({ kind: "image", src: "./assets/0123456789abcdef.png" }).label).toBe(
      "Image · Cover",
    )
    expect(
      paintRowLabel({ kind: "image", src: "./assets/0123456789abcdef.png", fit: "contain" }).label,
    ).toBe("Image · Contain")
  })
  test("opacity", () => {
    expect(paintAlpha("#0A0A0A1F")).toBeCloseTo(0.12, 2)
    expect(withPaintAlpha("#0A0A0A", 0.5)).toBe("#0A0A0A80")
    expect(withPaintAlpha({ kind: "linear", stops: [], opacity: 0.5 }, 1)).toEqual({
      kind: "linear",
      stops: [],
    })
    expect(withSolid({ kind: "solid", color: "#000000", visible: false }, { $ref: "a" })).toEqual({
      kind: "solid",
      color: { $ref: "a" },
      visible: false,
    })
  })
  test("swatch CSS", () => {
    expect(paintCss({ $ref: "x" }, () => "#123456")).toBe("#123456")
    expect(
      paintCss({
        kind: "linear",
        rotation: -90,
        stops: [
          { color: "#F4A261", at: 0 },
          { color: "#6D2E46", at: 1 },
        ],
      }),
    ).toBe("linear-gradient(90deg, #F4A261 0%, #6D2E46 100%)")
    expect(paintCss({ kind: "image", src: "s" }, undefined, () => "blob:x")).toContain("blob:x")
  })
  test("fill value keeps single paints single", () => {
    expect(fillValue([], false)).toBeUndefined()
    expect(fillValue(["#000000"], false)).toBe("#000000")
    expect(fillValue(["#000000"], true)).toEqual(["#000000"])
  })
  test("gradients", () => {
    const g = {
      kind: "linear",
      stops: [
        { color: "#000000", at: 0 },
        { color: "#FFFFFF", at: 1 },
      ],
    }
    expect(colorAt(g, 0.5)).toBe("#808080")
    expect((flipGradient(g) as typeof g).stops.map((s) => s.at)).toEqual([1, 0])
    expect(rotateGradient(g, -90)).toEqual({ ...g, rotation: -90 })
    expect(rotateGradient({ ...g, rotation: 90 }, -90)).toEqual(g)
  })
})

describe("strokes", () => {
  test("sides toggle and per-side edits", () => {
    const s = { paint: "#000000", width: 2 }
    const on = withSidesMode(s, true)
    expect(on.width).toEqual({ t: 2, r: 2, b: 2, l: 2 })
    const one = withSide(on, "r", 0)
    expect(one.width).toEqual({ t: 2, b: 2, l: 2 })
    expect(strokeSides(one)).toEqual({ t: 2, r: 0, b: 2, l: 2 })
    expect(withSidesMode(one, false).width).toBe(2)
  })
  test("defaults are removed; board 08 dashed stroke", () => {
    expect(withStrokeField({ paint: "#000", width: 1 }, "align", "inside")).toEqual({
      paint: "#000",
    })
    const dashed = withDash({ paint: "#0A0A0A" }, [4, 2])
    expect(dashed.dash).toEqual([4, 2])
    expect(dashOf(dashed)).toEqual([4, 2])
    expect(withDash(dashed, null).dash).toBeUndefined()
    // An all-zero dash draws solid: stored as no dash.
    expect(withDash(dashed, [0, 0]).dash).toBeUndefined()
  })
  test("per-side widths seed from the uniform width; all sides 0 is width 0", () => {
    expect(withSide({ paint: "#000", width: 3 }, "t", 1).width).toEqual({ t: 1, r: 3, b: 3, l: 3 })
    expect(withSide({ paint: "#000", width: { t: 1 } }, "t", 0).width).toBe(0)
  })
})

describe("effects", () => {
  test("kind switches keep values", () => {
    const s = { kind: "shadow", x: 0, y: 8, blur: 24, color: "#0A0A0A1F" }
    expect(effectKind(s)).toBe("drop-shadow")
    const inner = withEffectKind(s, "inner-shadow")
    expect(inner.inner).toBe(true)
    expect(effectKind(inner)).toBe("inner-shadow")
    const blur = withEffectKind(s, "layer-blur")
    expect(blur).toEqual({ kind: "blur", radius: 24 })
    expect(withEffectKind(blur, "drop-shadow")).toEqual({ ...NEW_EFFECT, blur: 24 })
    expect(withEffectKind(withEffectVisible(s, false), "background-blur")).toEqual({
      kind: "backdrop-blur",
      radius: 24,
      visible: false,
    })
  })
})

describe("layer, sizing, layout", () => {
  test("blend: normal is the default (removed), others stored", () => {
    expect(blendValue("normal")).toBeUndefined()
    expect(blendValue("pass-through")).toBe("pass-through")
    expect(blendOf(node({ type: "rect" }))).toBe("normal")
    expect(blendOf(node({ type: "rect", blend: "multiply" }))).toBe("multiply")
  })
  test("size modes", () => {
    expect(sizeModeOf(node({ type: "frame" }), "w")).toBe("fit")
    expect(sizeModeOf(node({ type: "rect", w: 10 }), "w")).toBe("fixed")
    expect(sizeModeOf(node({ type: "rect", w: { mode: "fill" } }), "w")).toBe("fill")
    expect(sizeModeOf(node({ type: "text" }), "w")).toBe("fit")
    expect(sizeModeOf(node({ type: "text", grow: "fixed-width", w: 100 }), "w")).toBe("fixed")
    expect(sizeModes(node({ type: "rect" }), false)).toEqual(["fixed"])
    expect(sizeModes(node({ type: "frame" }), true)).toEqual(["fixed", "fit", "fill"])
    expect(sizeModeFields(node({ type: "frame", w: 100 }), "w", "fit", 100, 50)).toEqual({
      set: {},
      unset: ["w"],
    })
    expect(sizeModeFields(node({ type: "text" }), "w", "fixed", 120.5, 20)).toEqual({
      set: { w: 120.5, grow: "fixed-width" },
      unset: ["h"],
    })
  })
  test("padding sides round trip", () => {
    expect(padSides([64, 96])).toEqual([64, 96, 64, 96])
    expect(padValue([16, 16, 16, 16], false)).toBe(16)
    expect(padValue([0, 0, 0, 0], false)).toBeUndefined()
    expect(padValue([8, 12, 8, 12], false)).toEqual([8, 12])
    expect(padValue([1, 2, 3, 4], true)).toEqual([1, 2, 3, 4])
  })
  test("icon sets", () => {
    expect(iconLibrary("material-rounded")).toBe("material")
    expect(iconSet("material", "sharp")).toBe("material-sharp")
    expect(iconSet("lucide")).toBe("lucide")
  })
})

describe("panel edits validate against the schema", () => {
  test("every M2 style the panel writes is a valid document", () => {
    const store = createDocStore()
    store.loadDocument({ ...newDocument("Test"), features: ["layout/wrap"] })
    const r1 = store.apply(
      [
        {
          op: "insert",
          id: "F1aaaaaaaa",
          node: { type: "frame", parent: null, order: "a0", w: 200, h: 100 },
        } as never,
      ],
      { origin: "user" },
    )
    expect(r1.ok).toBe(true)
    const stroke = withDash(withSide(withSidesMode({ paint: "#0A0A0A" }, true), "l", 0), [4, 2])
    const r2 = store.apply(
      [
        {
          op: "update",
          id: "F1aaaaaaaa",
          set: {
            blend: "pass-through",
            opacity: 0.5,
            fill: [
              withPaintVisible("#F4A261", false),
              {
                kind: "linear",
                stops: [
                  { color: "#F4A261", at: 0 },
                  { color: "#6D2E46", at: 1 },
                ],
              },
            ],
            stroke: withStrokeField(stroke, "cap", "round"),
            effects: [
              withEffectVisible(NEW_EFFECT, false),
              withEffectKind(NEW_EFFECT, "inner-shadow"),
              withEffectKind(NEW_EFFECT, "background-blur"),
            ],
            layout: { dir: "row", wrap: true, pad: [8, 12, 8, 12] },
          },
        },
      ],
      { origin: "user" },
    )
    expect(r2.ok).toBe(true)
    const doc = store.toDocument()
    const v = validate(doc)
    expect(v.errors).toEqual([])
    expect(v.ok).toBe(true)
  })
})

describe("gradient stops", () => {
  test("mergeStops by source index: removing a same-hex stop keeps the right binding", () => {
    const stored = [
      { color: { $ref: "brand/sand" }, at: 0 },
      { color: "#F4A261", at: 0.5 },
      { color: "#000000", at: 1 },
    ]
    const shown = [{ color: "#F4A261" }, { color: "#F4A261" }, { color: "#000000" }]
    // Remove stop 0 (the bound one): the literal stop 1 must stay literal.
    expect(
      mergeStops(
        stored,
        shown,
        [
          { color: "#F4A261", at: 0.5 },
          { color: "#000000", at: 1 },
        ],
        [1, 2],
      ),
    ).toEqual([
      { color: "#F4A261", at: 0.5 },
      { color: "#000000", at: 1 },
    ])
    // Add: the new stop is literal, the others keep theirs.
    expect(
      mergeStops(
        stored,
        shown,
        [
          ...stored.map((s, i) => ({ color: shown[i]?.color as string, at: s.at })),
          { color: "#888888", at: 0.7 },
        ],
        [0, 1, 2, null],
      )[0],
    ).toEqual({ color: { $ref: "brand/sand" }, at: 0 })
  })
  test("mergeStops keeps bindings of unchanged stops", () => {
    const stored = [
      { color: { $ref: "brand/sand" }, at: 0 },
      { color: "#000000", at: 1 },
    ]
    const shown = [{ color: "#F4A261" }, { color: "#000000" }]
    // Move: same count, colors unchanged → the binding stays.
    expect(
      mergeStops(stored, shown, [
        { color: "#F4A261", at: 0.2 },
        { color: "#000000", at: 1 },
      ]),
    ).toEqual([
      { color: { $ref: "brand/sand" }, at: 0.2 },
      { color: "#000000", at: 1 },
    ])
    // Recolor of the bound stop unbinds it.
    expect(mergeStops(stored, shown, [{ color: "#FF0000", at: 0 }, shown[1] as never])[0]).toEqual({
      color: "#FF0000",
      at: 0,
    })
    // Remove the first stop (count changes): matched by color.
    expect(mergeStops(stored, shown, [{ color: "#000000", at: 1 }])).toEqual([
      { color: "#000000", at: 1 },
    ])
  })
})
