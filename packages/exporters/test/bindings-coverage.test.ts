/**
 * Every bindable field reaches the IR resolved — `number`, `dimension` ({value, unit}) and
 * library (`alias:name`) variables — and the emitters use it: code exports keep `var(--x)`,
 * literal paths (SVG geometry) get the px number.
 */
import { describe, expect, test } from "bun:test"
import type { KimoDocument } from "@kimo/core-schema"
import { buildIR, exportDocument, findNode, type IRNode } from "../src"
import { fakeMeasurer } from "./helpers"

const ref = (name: string) => ({ $ref: name })

const lib = {
  $schema: "https://kimo.design/schema/kimo-1.0.json",
  format: "1.0.0",
  variables: {
    pad: { type: "dimension", value: { value: 10, unit: "px" } },
    big: { type: "number", value: 20 },
  },
  nodes: {},
} as unknown as KimoDocument
const libraries = { ui: lib }

const nodes: Record<string, Record<string, unknown>> = {
  Root000001: {
    type: "frame",
    parent: null,
    w: ref("w120"),
    h: 100,
    fill: "#FFFFFF",
    radius: [ref("d20"), 0, 0, 0],
    opacity: ref("half"),
    clip: ref("yes"),
    layout: {
      dir: "row",
      gap: ref("n8"),
      crossGap: ref("d4"),
      pad: [ref("d4"), ref("ui:pad"), 0, ref("n8")],
      includeStroke: true,
      wrap: true,
    },
    stroke: { paint: "#000000", width: { t: ref("d4"), r: 0, b: 0, l: ref("n8") } },
    effects: [
      {
        kind: "shadow",
        color: "#000000",
        x: ref("d4"),
        y: ref("n8"),
        blur: ref("ui:big"),
        spread: ref("d4"),
      },
      { kind: "blur", radius: ref("d4") },
      { kind: "backdrop-blur", radius: ref("ui:big") },
    ],
  },
  Label00001: {
    type: "text",
    parent: "Root000001",
    content: ref("label"),
    style: {
      size: ref("fs"),
      weight: ref("bold"),
      letterSpacing: ref("d4"),
      lineHeight: ref("lh"),
    },
  },
  Icon000001: {
    type: "icon",
    parent: "Root000001",
    set: "lucide",
    icon: ref("glyph"),
    weight: ref("bold"),
    strokeWidth: ref("d4"),
    w: 24,
    h: 24,
  },
  Hidden0001: { type: "rect", parent: "Root000001", w: 10, h: 10, visible: ref("no") },
}

const doc = {
  $schema: "https://kimo.design/schema/kimo-1.0.json",
  format: "1.0.0",
  imports: { ui: "./ui.kimo" },
  variables: {
    n8: { type: "number", value: 8 },
    d4: { type: "dimension", value: { value: 4, unit: "px" } },
    d20: { type: "dimension", value: { value: 20, unit: "px" } },
    w120: { type: "dimension", value: { value: 120, unit: "px" } },
    half: { type: "number", value: 0.5 },
    yes: { type: "boolean", value: true },
    no: { type: "boolean", value: false },
    fs: { type: "dimension", value: { value: 18, unit: "px" } },
    bold: { type: "number", value: 700 },
    lh: { type: "number", value: 1.5 },
    label: { type: "string", value: "Hello" },
    glyph: { type: "string", value: "star" },
  },
  nodes: Object.fromEntries(
    Object.entries(nodes).map(([id, n], i) => [id, { order: `a${i}`, ...n }]),
  ),
} as unknown as KimoDocument

const at = (ir: ReturnType<typeof buildIR>, id: string): IRNode | null => {
  for (const r of ir.roots) {
    const n = findNode(r, id)
    if (n) return n
  }
  return null
}

describe("IR resolves every bindable field", () => {
  const ir = buildIR(doc, { libraries })
  const root = at(ir, "Root000001") as IRNode

  test("no unresolved bindings", () => {
    expect(ir.issues.filter((i) => i.code === "VARIABLE_UNRESOLVED")).toEqual([])
  })
  test("size, radius tuple item, opacity, clip, visible", () => {
    expect(root.w).toEqual({ kind: "fixed", px: { v: 120, ref: "w120" } })
    expect(root.visual.radius?.map((r) => r.v)).toEqual([20, 0, 0, 0])
    expect(root.visual.radius?.[0]?.ref).toBe("d20")
    expect(root.visual.opacity).toEqual({ v: 0.5, ref: "half" })
    expect(root.visual.clip).toBe(true)
    expect(at(ir, "Hidden0001")).toBeNull()
  })
  test("gap, crossGap, pad items, per-side stroke (incl. includeStroke extra)", () => {
    const f = root.flex
    if (!f) throw new Error("no flex")
    expect(f.gap).toEqual({ v: 8, ref: "n8" })
    expect(f.crossGap).toEqual({ v: 4, ref: "d4" })
    expect(f.pad.map((p) => p.v)).toEqual([4, 10, 0, 8])
    expect(f.pad[1]?.ref).toBe("ui:pad")
    expect(f.padExtra).toEqual([4, 0, 0, 8])
    const w = root.visual.stroke?.width
    if (!w || !("t" in w)) throw new Error("no per-side stroke")
    expect([w.t.v, w.r.v, w.b.v, w.l.v]).toEqual([4, 0, 0, 8])
  })
  test("shadow x/y/blur/spread, blur and backdrop-blur radius", () => {
    const s = root.visual.shadows[0]
    expect([s?.x.v, s?.y.v, s?.blur.v, s?.spread.v]).toEqual([4, 8, 20, 4])
    expect(s?.blur.ref).toBe("ui:big")
    expect(root.visual.blur).toEqual({ v: 4, ref: "d4" })
    expect(root.visual.backdropBlur).toEqual({ v: 20, ref: "ui:big" })
  })
  test("text content and style; icon name / weight / strokeWidth", () => {
    const t = at(ir, "Label00001")?.text
    expect(t?.runs[0]?.text).toBe("Hello")
    const st = t?.runs[0]?.style
    expect([st?.size.v, st?.weight.v, st?.letterSpacing.v]).toEqual([18, 700, 4])
    expect(st?.lineHeight).toEqual({ kind: "multiplier", v: { v: 1.5, ref: "lh" } })
    const icon = at(ir, "Icon000001")?.icon
    expect([icon?.name, icon?.weight, icon?.strokeWidth]).toEqual(["star", 700, 4])
  })
})

const text = (files: { contents: string | Uint8Array }[]) =>
  files.map((f) => (typeof f.contents === "string" ? f.contents : "")).join("\n")

describe("emitters", () => {
  test("HTML/CSS keeps var() for bindings, literals without variables", async () => {
    const withVars = text((await exportDocument(doc, "html-css", { libraries })).files)
    expect(withVars).toContain("border-radius: calc(var(--d20) * 1px) 0px 0px 0px")
    expect(withVars).toContain("opacity: var(--half)")
    expect(withVars).toContain("column-gap: calc(var(--n8) * 1px)")
    // Padding with the includeStroke extra: the left side adds the bound 8 px stroke.
    expect(withVars).toContain("padding-left: calc(var(--n8) * 1px + 8px)")
    const plain = text(
      (await exportDocument(doc, "html-css", { libraries, variables: false })).files,
    )
    expect(plain).toContain("border-radius: 20px 0px 0px 0px")
    expect(plain).toContain("opacity: 0.5")
    expect(plain).toContain("padding-left: 16px")
    expect(plain).toContain("padding-top: 8px")
    expect(plain).not.toContain("var(--")
  })
  test("SVG geometry gets px numbers (dimension / library variables)", async () => {
    const svg = text(
      (await exportDocument(doc, "svg", { libraries, measureText: fakeMeasurer })).files,
    )
    expect(svg).toContain('width="120"')
    expect(svg).toContain('opacity="0.5"')
    // Top-left corner arc of radius 20, other corners square.
    expect(svg).toMatch(/M\s?20[ ,]0/)
    expect(svg).not.toContain("$ref")
    expect(svg).not.toContain("var(--")
  })
})
