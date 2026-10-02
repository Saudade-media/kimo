import { describe, expect, test } from "bun:test"
import {
  applyDefaults,
  buildJsonSchema,
  DEFAULTS,
  parse,
  serialize,
  stripDefaults,
  validate,
} from "../src/index"
import { doc, fixtureFiles, type Loose } from "./helpers"

describe("normative defaults", () => {
  test("strip(apply(doc)) == strip(doc) for every valid fixture, and stays valid", () => {
    for (const [, text] of fixtureFiles("valid")) {
      const d = parse(text)
      const full = applyDefaults(d)
      expect(validate(full, { lints: false }).errors).toEqual([])
      expect(stripDefaults(full)).toEqual(stripDefaults(d))
      expect(serialize(full)).toBe(text)
    }
  })

  test("applyDefaults fills node, layout, paint, stroke, effect and color defaults", () => {
    const d = applyDefaults(
      doc({
        Frame00001: {
          type: "frame",
          parent: null,
          order: "a0",
          layout: { dir: "row" },
          w: { mode: "fill" },
          fill: [
            {
              kind: "linear",
              stops: [
                { color: { space: "oklch", l: 0.5, c: 0.1, h: 10 }, at: 0 },
                { color: "#000", at: 1 },
              ],
            },
          ],
          stroke: { paint: "#000" },
          effects: [{ kind: "shadow", x: 0, y: 0, blur: 1, color: "#000" }],
        },
      }),
    ) as unknown as { nodes: Record<string, Record<string, unknown>> }
    const f = d.nodes.Frame00001 as Loose
    expect(f.visible).toBe(true)
    expect(f.h).toEqual({ mode: "fit" })
    expect(f.w).toEqual({ mode: "fill", weight: 1 })
    expect(f.layout).toEqual({ dir: "row", ...DEFAULTS.layout })
    expect(f.fill[0].interpolation).toBe("srgb")
    expect(f.fill[0].stops[0].color.alpha).toBe(1)
    expect(f.stroke).toEqual({ paint: "#000", ...DEFAULTS.stroke })
    expect(f.effects[0]).toMatchObject({ inner: false, spread: 0, blend: "normal" })
  })

  test("instance props and set keys are never stripped or added (they override)", () => {
    const d = doc({
      Inst000001: {
        type: "instance",
        parent: null,
        order: "a0",
        of: "Comp000001",
        props: { opacity: 1, visible: true, layout: { dir: "row", gap: 0 } },
        overrides: { Text000001: { set: { visible: true, grow: "auto" } } },
      },
    })
    const s = stripDefaults(d) as Loose
    expect(s.nodes.Inst000001.props).toEqual({ opacity: 1, visible: true, layout: { dir: "row" } })
    expect(s.nodes.Inst000001.overrides.Text000001.set).toEqual({ visible: true, grow: "auto" })
    const a = applyDefaults(
      doc({
        Inst000001: { type: "instance", parent: null, order: "a0", of: "Comp000001", props: {} },
      }),
    ) as Loose
    expect(a.nodes.Inst000001.props).toEqual({})
    expect(a.nodes.Inst000001.position).toBe("auto")
    expect(a.nodes.Inst000001.visible).toBeUndefined()
  })

  test("set.props on a nested instance is normalized like an instance's own props", () => {
    const props = {
      opacity: 1,
      fill: { kind: "solid", color: "#fff", blend: "normal" },
      layout: { dir: "row", gap: 0 },
    }
    const d = doc({
      Inst000001: {
        type: "instance",
        parent: null,
        order: "a0",
        of: "Comp000001",
        props,
        overrides: { Nested0001: { set: { props } } },
      },
    })
    const s = stripDefaults(d) as Loose
    const expected = { opacity: 1, fill: { kind: "solid", color: "#fff" }, layout: { dir: "row" } }
    expect(s.nodes.Inst000001.props).toEqual(expected)
    expect(s.nodes.Inst000001.overrides.Nested0001.set.props).toEqual(expected)
    const a = applyDefaults(s) as Loose
    expect(a.nodes.Inst000001.overrides.Nested0001.set.props).toEqual(a.nodes.Inst000001.props)
    expect(a.nodes.Inst000001.props.visible).toBeUndefined()
  })

  test("x and y are not defaulted (explicit 0 is kept)", () => {
    expect(
      serialize(doc({ Frame00001: { type: "frame", parent: null, order: "a0", x: 0, y: 0 } })),
    ).toContain(`"x":0,"y":0`)
  })

  test("unknown node types and fields are untouched", () => {
    const d = doc({
      Future0001: { type: "sticker", parent: null, order: "a0", visible: true, opacity: 1 },
    })
    expect(stripDefaults(d)).toEqual(d)
  })

  test("every DEFAULTS entry appears as a JSON Schema default keyword", () => {
    const schemaText = JSON.stringify(buildJsonSchema())
    const defs = (buildJsonSchema() as Loose).$defs
    const prop = (def: string, ...path: string[]) => {
      let s = defs[def]
      for (const p of path) s = s.properties[p]
      return s.default
    }
    for (const [k, v] of Object.entries(DEFAULTS.node)) expect(prop("FrameNode", k)).toEqual(v)
    for (const [k, v] of Object.entries(DEFAULTS.frame)) expect(prop("FrameNode", k)).toEqual(v)
    for (const [k, v] of Object.entries(DEFAULTS.ellipse)) expect(prop("EllipseNode", k)).toEqual(v)
    for (const [k, v] of Object.entries(DEFAULTS.browser)) expect(prop("BrowserNode", k)).toEqual(v)
    for (const [k, v] of Object.entries(DEFAULTS.layout)) expect(prop("Layout", k)).toEqual(v)
    for (const [k, v] of Object.entries(DEFAULTS.stroke)) expect(prop("Stroke", k)).toEqual(v)
    for (const [k, v] of Object.entries(DEFAULTS.gradient))
      expect(prop("GradientPaint", k)).toEqual(v)
    for (const [k, v] of Object.entries(DEFAULTS.image)) expect(prop("ImagePaint", k)).toEqual(v)
    for (const [k, v] of Object.entries(DEFAULTS.solid)) expect(prop("SolidPaint", k)).toEqual(v)
    for (const [k, v] of Object.entries(DEFAULTS.shadow)) expect(prop("ShadowEffect", k)).toEqual(v)
    expect(prop("SizeFill", "weight")).toBe(DEFAULTS.sizeFill.weight)
    expect(prop("OklchColor", "alpha")).toBe(DEFAULTS.color.alpha)
    expect(prop("TextNode", "grow")).toBe(DEFAULTS.text.grow)
    expect(prop("PathNode", "fillRule")).toBe(DEFAULTS.path.fillRule)
    expect(prop("InstanceNode", "position")).toBe(DEFAULTS.node.position)
    expect(schemaText.length).toBeGreaterThan(0)
  })
})
