/** IR semantics: sizing/placement (the Yoga model in CSS terms), bindings, themes, components. */
import { describe, expect, test } from "bun:test"
import type { KimoDocument } from "@kimo/core-schema"
import { buildIR, findNode, type IRNode } from "../src"
import { FIXTURES, loadFixture } from "./helpers"

const doc = (nodes: Record<string, Record<string, unknown>>, extra: Record<string, unknown> = {}) =>
  ({
    $schema: "https://getkimo.design/schema/kimo-1.0.json",
    format: "1.0.0",
    ...extra,
    nodes: Object.fromEntries(
      Object.entries(nodes).map(([id, n], i) => [id, { order: `a${i}`, ...n }]),
    ),
  }) as unknown as KimoDocument

const node = (ir: ReturnType<typeof buildIR>, id: string): IRNode => {
  for (const r of ir.roots) {
    const n = findNode(r, id)
    if (n) return n
  }
  throw new Error(`no ${id}`)
}

describe("sizing and placement", () => {
  const d = doc({
    Root000001: {
      type: "frame",
      parent: null,
      w: 400,
      layout: { dir: "row", gap: -6, pad: [1, 2] },
    },
    FillMain01: {
      type: "rect",
      parent: "Root000001",
      w: { mode: "fill", weight: 2 },
      h: { mode: "fill" },
    },
    Fixed00001: { type: "rect", parent: "Root000001", w: 10, h: 10 },
    Absolute01: {
      type: "rect",
      parent: "Root000001",
      position: "absolute",
      x: 5,
      y: 6,
      w: { mode: "fill", fallback: 40 },
      h: 3,
    },
    Empty00001: {
      type: "frame",
      parent: "Root000001",
      w: { mode: "fit", fallback: 64 },
      layout: { dir: "column" },
    },
    Box0000001: { type: "frame", parent: null, x: 0, y: 500 },
    BoxKid0001: { type: "rect", parent: "Box0000001", x: 3, y: 4, w: 5, h: 6 },
    Group00001: { type: "group", parent: "Box0000001", x: 100, y: 100 },
    GroupKid01: { type: "rect", parent: "Group00001", x: 10, y: 20, w: 30, h: 40 },
    Note000001: { type: "note", parent: null, content: "skip me" },
  })
  const ir = buildIR(d)
  test("notes and prompts are not exported", () => {
    expect(ir.roots.map((r) => r.id)).toEqual(["Root000001", "Box0000001"])
  })
  test("fill → main-axis grow / cross-axis stretch", () => {
    const n = node(ir, "FillMain01")
    // A fixed-width row: the main axis is shared from a zero basis (§6.1).
    expect(n.w).toEqual({ kind: "fill", axis: "main", weight: 2, zero: true })
    expect(n.h).toEqual({ kind: "fill", axis: "cross", weight: 1 })
    expect(n.placement).toEqual({ mode: "flow", dir: "row", index: 0, lead: 0 })
  })
  test("negative gaps become lead margins after the first flowing child", () => {
    expect(node(ir, "Root000001").flex?.gap.v).toBe(0)
    expect(node(ir, "Fixed00001").placement).toEqual({
      mode: "flow",
      dir: "row",
      index: 1,
      lead: -6,
    })
  })
  test("absolute fill uses its fallback", () => {
    const n = node(ir, "Absolute01")
    expect(n.placement).toEqual({ mode: "absolute", x: 5, y: 6 })
    expect(n.w).toEqual({ kind: "fixed", px: { v: 40 } })
  })
  test("fit with fallback and nothing to fit is the fallback", () => {
    expect(node(ir, "Empty00001").w).toEqual({ kind: "fixed", px: { v: 64 } })
  })
  test("a fitting frame without layout stacks its children", () => {
    expect(node(ir, "Box0000001").childMode).toBe("stack")
    expect(node(ir, "BoxKid0001").placement).toEqual({ mode: "stack", x: 3, y: 4 })
  })
  test("groups take their children's bounds", () => {
    const g = node(ir, "Group00001")
    expect(g.placement).toEqual({ mode: "stack", x: 110, y: 120 })
    expect([g.w, g.h]).toEqual([
      { kind: "fixed", px: { v: 30 } },
      { kind: "fixed", px: { v: 40 } },
    ])
    expect(node(ir, "GroupKid01").placement).toEqual({ mode: "absolute", x: 0, y: 0 })
  })
})

describe("fill basis (§6.1)", () => {
  const fill = { mode: "fill" }
  const row = (parent: string | null, w: unknown, extra: Record<string, unknown> = {}) => ({
    type: "frame",
    parent,
    w,
    h: 40,
    layout: { dir: "row", ...extra },
  })
  const kid = (parent: string) => ({ type: "rect", parent, w: fill, h: 10 })
  const ir = buildIR(
    doc({
      Fixed00001: row(null, 400),
      FixedKid01: kid("Fixed00001"),
      Nested0001: row("Fixed00001", fill),
      NestedKid1: kid("Nested0001"),
      Hug0000001: row(null, { mode: "fit" }),
      HugKid0001: kid("Hug0000001"),
      HugFill001: row("Hug0000001", fill),
      HugFillKid: kid("HugFill001"),
      Wrap000001: row(null, 400, { wrap: true }),
      WrapKid001: kid("Wrap000001"),
    }),
  )
  const zero = (id: string) => (node(ir, id).w as { zero?: boolean }).zero
  test("a definite, non-wrapping parent shares its main axis from a zero basis", () => {
    expect(zero("FixedKid01")).toBe(true)
    expect(zero("Nested0001")).toBe(true)
    expect(zero("NestedKid1")).toBe(true)
  })
  test("hug and wrapping parents keep the content as the basis", () => {
    expect(zero("HugKid0001")).toBe(false)
    expect(zero("HugFill001")).toBe(false)
    expect(zero("HugFillKid")).toBe(false)
    expect(zero("WrapKid001")).toBe(false)
  })
})

describe("bindings and themes", () => {
  const f = FIXTURES.find((x) => x.name === "components-m3")
  if (!f) throw new Error("fixture")
  const { doc: d, libraries } = loadFixture(f)
  const ir = buildIR(d, { libraries })
  test("bound values keep their variable and resolve under the node's theme", () => {
    const card = node(ir, "InstPro001")
    // Theme pin: density compact under a dark page.
    expect(card.themeAttrs).toEqual({ density: "compact", mode: "dark" })
    const title = node(ir, "InstPro001/CardBadge1")
    const fill = title.text?.fills[0]
    expect(fill?.kind === "solid" && fill.color.ref).toBe("text/default")
    expect(fill?.kind === "solid" && fill.color.css).toBe("#F5EEE6")
  })
  test("variables list usage for Tailwind namespaces", () => {
    // Only variables the exported nodes read get a usage (the card main is not exported).
    expect(ir.variables.find((v) => v.name === "space/card-pad")?.usage).toEqual([])
    expect(ir.variables.find((v) => v.name === "text/default")?.usage).toEqual(["color"])
    expect(ir.axes.map((a) => [a.key, a.attr, a.default])).toEqual([
      ["density", "data-density", "comfortable"],
      ["mode", "data-mode", "light"],
    ])
  })
})

describe("components", () => {
  const f = FIXTURES.find((x) => x.name === "example-10-5")
  if (!f) throw new Error("fixture")
  const { doc: d, libraries } = loadFixture(f)
  const ir = buildIR(d, { libraries, components: true })
  test("a set override equal to a declared text prop becomes an arg", () => {
    const cta = node(ir, "D4cta00001")
    expect(cta.instance?.of).toBe("ui:BtnPrimary")
    expect(cta.instance?.args).toEqual({ label: { type: "text", value: "Get Kimo — $49/mo" } })
    expect(cta.instance?.needsInline).toBe(false)
  })
  test("slot content is passed to the slot prop; w/h props are placement", () => {
    const card = node(ir, "E5card0001")
    expect(Object.keys(card.instance?.slots ?? {})).toEqual(["actions"])
    expect(card.instance?.needsInline).toBe(false)
  })
  test("components are built from synthetic instances with their declared props", () => {
    const names = ir.components.map((c) => [
      c.qid,
      c.ident,
      c.props.map((p) => `${p.name}:${p.type}`),
    ])
    expect(names).toEqual([
      ["ui:BtnPrimary", "ButtonPrimary", ["label:text"]],
      ["ui:BtnGhost01", "ButtonGhost", ["label:text"]],
      ["ui:CardBase01", "Card", ["actions:slot"]],
    ])
  })
  test("overrides no declared prop expresses force inlining", () => {
    const m3 = FIXTURES.find((x) => x.name === "components-m3")
    if (!m3) throw new Error("fixture")
    const { doc: d3 } = loadFixture(m3)
    const ir3 = buildIR(d3, { components: true })
    expect(node(ir3, "InstPro001").instance?.inlineReasons).toEqual([
      "props:fill",
      "replace:CardTitle1",
    ])
  })
})
