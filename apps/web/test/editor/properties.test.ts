/** Property panel models: value parsing, mixed selections, paint / stroke / effect edits. */
import { describe, expect, test } from "bun:test"
import { validate } from "@kimo/core-schema"
import { createDocStore, type NodeData } from "@kimo/editor-state"
import { editColor, formatColor, toHex } from "@kimo/ui"
import fc from "fast-check"
import { MIXED, parseNumber, parseSize, shared } from "../../src/editor/props"
import {
  dashOf,
  effectKind,
  mergeStops,
  NEW_EFFECT,
  padSides,
  paintBlend,
  paintBlendable,
  sizeModeFields,
  sizeModeOf,
  sizeModes,
  strokeSides,
  withDash,
  withEffectKind,
  withEffectVisible,
  withPaintBlend,
  withPaintVisible,
  withSide,
  withSidesMode,
  withSolid,
  withStrokeField,
} from "../../src/editor/style"
import { newDocument } from "../../src/lib/sample"

const node = (o: Record<string, unknown>): NodeData =>
  ({ parent: "p00001", order: "a", ...o }) as unknown as NodeData

describe("value fields", () => {
  test("sizes take Hug / Fill keywords and arithmetic; unsafe or negative input is refused", () => {
    expect(parseSize("hug")).toEqual({ mode: "fit" })
    expect(parseSize(" Fill ")).toEqual({ mode: "fill" })
    expect(parseSize("120+24")).toBe(144)
    expect(parseSize("-4")).toBeNull()
    expect(parseSize("abc")).toBeNull()
    expect(parseNumber("(10+2)/3")).toBe(4)
    expect(parseNumber("2*-3")).toBe(-6)
    expect(parseNumber("1,5")).toBe(1.5)
    expect(parseNumber("2+")).toBeNull()
    expect(parseNumber("alert(1)")).toBeNull()
  })

  test("a multi-selection shows the shared value, or Mixed", () => {
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

  test("editing one color channel by its shown text changes nothing (property)", () => {
    const byte = fc.integer({ min: 0, max: 255 })
    const rgba = fc.record({ r: byte, g: byte, b: byte, a: fc.constant(1) })
    fc.assert(
      fc.property(rgba, (c) => {
        for (const f of ["rgb", "hsl", "oklch"] as const)
          expect(toHex(editColor(c, f, formatColor(c, f)) as never)).toBe(toHex(c))
      }),
    )
  })
})

describe("paint edits", () => {
  test("visibility, opacity and blend wrap a bare color and collapse back to it", () => {
    const hidden = withPaintVisible("#F4A261", false)
    expect(hidden).toEqual({ kind: "solid", color: "#F4A261", visible: false })
    expect(withPaintVisible(hidden, true)).toBe("#F4A261")
    expect(withPaintVisible({ kind: "linear", stops: [], visible: false }, true)).toEqual({
      kind: "linear",
      stops: [],
    })
    expect(withSolid({ kind: "solid", color: "#000000", visible: false }, { $ref: "a" })).toEqual({
      kind: "solid",
      color: { $ref: "a" },
      visible: false,
    })
    const on = withPaintBlend("#F4F1EC", "multiply")
    expect(on).toEqual({ kind: "solid", color: "#F4F1EC", blend: "multiply" })
    expect(paintBlend(on)).toBe("multiply")
    expect(withPaintBlend(on, "normal")).toBe("#F4F1EC")
    // Mesh and shader paints can't blend.
    expect(paintBlendable({ kind: "mesh", cols: 1, rows: 1, colors: [], points: [] })).toBe(false)
  })

  test("gradient stops keep their variable bindings through add, move, recolor and remove", () => {
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
    const two = [
      { color: { $ref: "brand/sand" }, at: 0 },
      { color: "#000000", at: 1 },
    ]
    const twoShown = [{ color: "#F4A261" }, { color: "#000000" }]
    // Move: same count, colors unchanged, the binding stays.
    expect(
      mergeStops(two, twoShown, [
        { color: "#F4A261", at: 0.2 },
        { color: "#000000", at: 1 },
      ]),
    ).toEqual([
      { color: { $ref: "brand/sand" }, at: 0.2 },
      { color: "#000000", at: 1 },
    ])
    // Recolor of the bound stop unbinds it.
    expect(
      mergeStops(two, twoShown, [{ color: "#FF0000", at: 0 }, twoShown[1] as never])[0],
    ).toEqual({ color: "#FF0000", at: 0 })
  })
})

describe("stroke, effect and layout edits", () => {
  test("per-side stroke widths seed from the uniform width; a zero side is dropped; all zero is width 0", () => {
    const s = { paint: "#000000", width: 2 }
    const on = withSidesMode(s, true)
    expect(on.width).toEqual({ t: 2, r: 2, b: 2, l: 2 })
    const one = withSide(on, "r", 0)
    expect(one.width).toEqual({ t: 2, b: 2, l: 2 })
    expect(strokeSides(one)).toEqual({ t: 2, r: 0, b: 2, l: 2 })
    expect(withSidesMode(one, false).width).toBe(2)
    expect(withSide({ paint: "#000", width: 3 }, "t", 1).width).toEqual({ t: 1, r: 3, b: 3, l: 3 })
    expect(withSide({ paint: "#000", width: { t: 1 } }, "t", 0).width).toBe(0)
  })

  test("stroke defaults are removed from the file; an all-zero dash is stored as no dash", () => {
    expect(withStrokeField({ paint: "#000", width: 1 }, "align", "inside")).toEqual({
      paint: "#000",
    })
    const dashed = withDash({ paint: "#0A0A0A" }, [4, 2])
    expect(dashed.dash).toEqual([4, 2])
    expect(dashOf(dashed)).toEqual([4, 2])
    expect(withDash(dashed, null).dash).toBeUndefined()
    expect(withDash(dashed, [0, 0]).dash).toBeUndefined()
  })

  test("switching an effect's kind keeps its values", () => {
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

  test("size modes map to the fields that store them; padding reads as four sides", () => {
    expect(sizeModeOf(node({ type: "frame" }), "w")).toBe("fit")
    expect(sizeModeOf(node({ type: "rect", w: 10 }), "w")).toBe("fixed")
    expect(sizeModeOf(node({ type: "rect", w: { mode: "fill" } }), "w")).toBe("fill")
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
    expect(padSides([64, 96])).toEqual([64, 96, 64, 96])
  })

  test("every style the panel writes is a valid document", () => {
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
    const v = validate(store.toDocument())
    expect(v.errors).toEqual([])
    expect(v.ok).toBe(true)
  })
})
