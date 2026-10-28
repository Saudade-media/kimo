import { describe, expect, test } from "bun:test"
import {
  applyDefaults,
  applyNodeDefaults,
  parse,
  serialize,
  stripDefaults,
  stripNodeDefaults,
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

  test("strip and apply round-trip node, stroke and effect defaults", () => {
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
    const stripped = stripNodeDefaults(n) as Loose
    expect(stripped).toEqual({
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
    const applied = applyNodeDefaults(stripped) as Loose
    expect(applied.blend).toBe("normal")
    expect(applied.stroke.miterLimit).toBe(4)
    expect(applied.effects[1].visible).toBe(true)
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
})
