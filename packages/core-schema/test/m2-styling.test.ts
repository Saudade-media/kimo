/**
 * M2 styling additions to format 0.1, now part of 1.0 (ADR 0010): layer `blend` (incl. "pass-through"),
 * stroke `miterLimit`, effect `visible`, icon `strokeWidth` (+ phosphor `weight`).
 */
import { describe, expect, test } from "bun:test"
import {
  applyNodeDefaults,
  DEFAULTS,
  LAYER_BLEND_MODES,
  parse,
  serialize,
  stripNodeDefaults,
  validate,
} from "../src/index"
import { codes, readFixture } from "./helpers"

const HEADER = `"$schema": "https://kimo.design/schema/kimo-1.0.json",\n"format": "1.0.0",`
const docWith = (node: Record<string, unknown>) =>
  parse(
    `{${HEADER} "nodes": {"Node000001": ${JSON.stringify({ parent: null, order: "a0", ...node })}}}`,
  )

describe("M2 styling fields", () => {
  test("defaults table rows", () => {
    expect(DEFAULTS.node.blend).toBe("normal")
    expect(DEFAULTS.stroke.miterLimit).toBe(4)
    expect(DEFAULTS.shadow.visible).toBe(true)
    expect(DEFAULTS.blur.visible).toBe(true)
    expect(LAYER_BLEND_MODES).toContain("pass-through")
    expect(LAYER_BLEND_MODES).toContain("linear-burn")
  })

  test("defaults are stripped and applied", () => {
    const n = {
      type: "rect",
      parent: null,
      order: "a0",
      w: 10,
      h: 10,
      blend: "normal",
      stroke: { paint: "#000", miterLimit: 4 },
      effects: [
        { kind: "shadow", x: 0, y: 1, blur: 2, color: "#000", visible: true },
        { kind: "blur", radius: 2, visible: true },
        { kind: "backdrop-blur", radius: 2, visible: false },
      ],
    }
    expect(stripNodeDefaults(n) as unknown).toEqual({
      type: "rect",
      parent: null,
      order: "a0",
      w: 10,
      h: 10,
      stroke: { paint: "#000" },
      effects: [
        { kind: "shadow", x: 0, y: 1, blur: 2, color: "#000" },
        { kind: "blur", radius: 2 },
        { kind: "backdrop-blur", radius: 2, visible: false },
      ],
    })
    const applied = applyNodeDefaults(stripNodeDefaults(n)) as Record<string, unknown>
    expect(applied.blend).toBe("normal")
    expect((applied.stroke as Record<string, unknown>).miterLimit).toBe(4)
    expect((applied.effects as Record<string, unknown>[])[1]?.visible).toBe(true)
  })

  test("instances have no layer blend at the top level (it is a visual field)", () => {
    const r = validate(
      parse(`{${HEADER} "nodes": {
"Comp000001": {"type":"frame","parent":null,"order":"a0","component":true},
"Inst000001": {"type":"instance","parent":null,"order":"a1","of":"Comp000001","blend":"multiply"}}}`),
    )
    expect(codes(r.errors)).toEqual(["INSTANCE_VISUAL_FIELD"])
  })

  test("pass-through is a layer mode, not a paint mode", () => {
    expect(validate(docWith({ type: "group", blend: "pass-through" })).ok).toBe(true)
    const bad = validate(
      docWith({
        type: "rect",
        w: 1,
        h: 1,
        fill: { kind: "solid", color: "#000", blend: "pass-through" },
      }),
    )
    expect(codes(bad.errors)).toContain("SCHEMA")
  })

  test("range checks", () => {
    const miter = validate(
      docWith({ type: "rect", w: 1, h: 1, stroke: { paint: "#000", miterLimit: 0.5 } }),
    )
    expect(codes(miter.errors)).toContain("SCHEMA")
    const sw = validate(
      docWith({ type: "icon", w: 24, h: 24, set: "lucide", icon: "x", strokeWidth: 0 }),
    )
    expect(codes(sw.errors)).toContain("SCHEMA")
    const ok = validate(
      docWith({ type: "icon", w: 24, h: 24, set: "lucide", icon: "x", strokeWidth: 1.5 }),
    )
    expect(ok.errors).toEqual([])
  })

  test("canonical key order: miterLimit after join, strokeWidth after weight", () => {
    const text = readFixture("valid/styling-m2.kimo")
    expect(serialize(parse(text))).toBe(text)
    expect(text).toContain(`"width":2,"miterLimit":10`)
    expect(text).toContain(`"strokeWidth":2,"set":"lucide"`)
  })
})
