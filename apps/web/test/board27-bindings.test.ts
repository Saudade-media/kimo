/**
 * Board 27 §7 "Variable binding everywhere" (H7PYY): the pure model behind bindable fields —
 * type-filtered picker groups (local + libraries), resolution (dimension, alias, missing → last
 * value), raw padding sides, Detach all, and the layer-menu variable items.
 */
import { beforeEach, describe, expect, test } from "bun:test"
import type { KimoDocument } from "@kimo/core-schema"
import {
  clearResolvedCache,
  detachAllFields,
  fieldState,
  literalOf,
  newVariableName,
  nodeHasBinding,
  padSidesRaw,
  padValueRaw,
  pickerGroups,
  refName,
  resolveRef,
  sharedRef,
} from "../src/editor/bindings"
import { canvasMenuModel } from "../src/editor/context-menu"
import { MIXED } from "../src/editor/props"
import { withSide } from "../src/editor/style"
import type { DocHeader } from "../src/lib/header"

const header = (extra: Record<string, unknown> = {}) =>
  ({
    format: "1.0.0",
    themes: { mode: ["light", "dark"] },
    imports: { brand: "./brand.kimo", icons: "../icons/icons.kimo" },
    variables: {
      "space/2": { type: "number", value: 8 },
      "space/4": { type: "number", value: 16 },
      "space/6": { type: "dimension", value: { value: 24, unit: "px" } },
      "space/gutter": { type: "number", value: { $ref: "space/6" } },
      "opacity/muted": {
        type: "number",
        value: [
          { value: 0.64, when: { mode: "light" } },
          { value: 0.5, when: { mode: "dark" } },
        ],
      },
      "copy/cta": { type: "string", value: "Start free" },
      "show/badge": { type: "boolean", value: true },
      "brand/ink": { type: "color", value: "#111111" },
    },
    nodes: {},
    ...extra,
  }) as unknown as DocHeader

const lib = (variables: Record<string, unknown>) =>
  ({ format: "1.0.0", variables, nodes: {} }) as unknown as KimoDocument

const libraries = {
  brand: lib({
    "space/sm": { type: "number", value: 12 },
    "space/md": { type: "number", value: 20 },
    "radius/md": { type: "number", value: 8 },
    ink: { type: "color", value: "#000000" },
  }),
  icons: lib({ "size/default": { type: "number", value: 20 } }),
}

beforeEach(() => clearResolvedCache())

describe("picker (rule wDOBf)", () => {
  test("number fields: 'This file' first (count), then each import alias with its path", () => {
    const g = pickerGroups(header(), libraries, "number", { mode: "light" })
    expect(g.map((x) => [x.title, x.meta, x.library ?? false])).toEqual([
      ["This file", "5", false],
      ["brand", "./brand.kimo", true],
      ["icons", "../icons/icons.kimo", true],
    ])
    const local = g[0]?.items ?? []
    expect(local.map((i) => [i.ref, i.value])).toEqual([
      ["opacity/muted", "0.64"],
      ["space/2", "8"],
      ["space/4", "16"],
      ["space/6", "24"],
      ["space/gutter", "→ space/6"],
    ])
    expect(local.find((i) => i.ref === "space/gutter")?.alias).toBe(true)
    // Library rows bind as alias:name and display alias/name.
    expect(g[1]?.items.map((i) => [i.ref, i.name, i.value])).toEqual([
      ["brand:radius/md", "brand/radius/md", "8"],
      ["brand:space/md", "brand/space/md", "20"],
      ["brand:space/sm", "brand/space/sm", "12"],
    ])
  })

  test("type-filtered: string / boolean fields list only their type; colours never", () => {
    expect(pickerGroups(header(), libraries, "string", {}).flatMap((g) => g.items)).toEqual([
      { ref: "copy/cta", name: "copy/cta", value: "Start free" },
    ])
    expect(
      pickerGroups(header(), libraries, "boolean", {}).flatMap((g) => g.items.map((i) => i.ref)),
    ).toEqual(["show/badge"])
  })

  test("a library that is not loaded yet contributes no group", () => {
    const g = pickerGroups(header(), { brand: libraries.brand }, "number", {})
    expect(g.map((x) => x.title)).toEqual(["This file", "brand"])
  })
})

describe("resolution (rules HC0Yq, h4bLV, qKGyA)", () => {
  test("dimension → px number; alias follows; themed value per theme", () => {
    const h = header()
    expect(resolveRef(h, libraries, "space/6", "number", {}).value).toBe(24)
    const a = resolveRef(h, libraries, "space/gutter", "number", {})
    expect([a.value, a.aliasOf]).toEqual([24, "space/6"])
    expect(resolveRef(h, libraries, "opacity/muted", "number", { mode: "dark" }).value).toBe(0.5)
    expect(resolveRef(h, libraries, "brand:space/md", "number", {}).value).toBe(20)
  })

  test("missing variable: $danger state, last resolved value kept", () => {
    const h = header()
    expect(resolveRef(h, libraries, "space/4", "number", {}).value).toBe(16)
    const gone = header({ variables: {} })
    const r = resolveRef(gone, libraries, "space/4", "number", {})
    expect([r.ok, r.missing, r.value]).toEqual([false, true, 16])
    const lib = resolveRef(h, libraries, "brand:space/legacy", "number", {})
    expect([lib.missing, lib.value]).toEqual([true, null])
  })

  test("a library that is still loading is not 'missing'", () => {
    const r = resolveRef(header(), {}, "brand:space/md", "number", {})
    expect(r.missing).toBe(false)
  })

  test("literalOf coerces to the field type", () => {
    expect(literalOf("number", { value: 4, unit: "px" })).toBe(4)
    expect(literalOf("number", "4")).toBeNull()
    expect(literalOf("string", "x")).toBe("x")
    expect(literalOf("boolean", false)).toBe(false)
  })
})

describe("field state (mixed selections)", () => {
  test("bound only when every node binds the same variable", () => {
    expect(sharedRef([{ $ref: "a" }, { $ref: "a" }])).toBe("a")
    expect(sharedRef([{ $ref: "a" }, { $ref: "b" }])).toBeNull()
    expect(sharedRef([{ $ref: "a" }, 4])).toBeNull()
    expect(fieldState([{ $ref: "a" }, { $ref: "a" }])).toEqual({ kind: "bound", ref: "a" })
    expect(fieldState([4, 4])).toEqual({ kind: "value", value: 4 })
    expect(fieldState([4, { $ref: "a" }])).toEqual({ kind: "value", value: MIXED })
    expect(refName("brand:space/md")).toBe("brand/space/md")
  })

  test("'Create variable from <value>' names are unique", () => {
    const h = header({ variables: { "gap/16": { type: "number", value: 16 } } })
    expect(newVariableName(h, "Gap", 16)).toBe("gap/16-2")
    expect(newVariableName(h, "Opacity", 0.64)).toBe("opacity/0_64")
    expect(newVariableName(h, "copy", "Start")).toBe("copy/value")
  })
})

describe("padding sides keep their bindings (QsU0r)", () => {
  test("raw sides from every padding form", () => {
    const r = { $ref: "space/4" }
    expect(padSidesRaw(r)).toEqual([r, r, r, r])
    expect(padSidesRaw([8, r])).toEqual([8, r, 8, r])
    expect(padSidesRaw([1, r, 3, 4])).toEqual([1, r, 3, 4])
    expect(padSidesRaw(undefined)).toEqual([0, 0, 0, 0])
  })

  test("shortest stored form compares bindings structurally", () => {
    const r = { $ref: "space/4" }
    expect(padValueRaw([r, r, r, r], false)).toEqual(r)
    expect(padValueRaw([8, r, 8, r], false)).toEqual([8, r])
    expect(padValueRaw([0, 0, 0, 0], false)).toBeUndefined()
    expect(padValueRaw([1, r, 3, 4], false)).toEqual([1, r, 3, 4])
    expect(padValueRaw([8, r, 8, r], true)).toEqual([8, r, 8, r])
  })

  test("editing one stroke side keeps a bound side", () => {
    const stroke = { paint: "#000", width: { t: { $ref: "border/w" }, b: 1 } }
    expect(withSide(stroke, "b", 2).width).toEqual({ t: { $ref: "border/w" }, b: 2 })
  })
})

describe("Detach all variables (rule RAez2)", () => {
  const resolve = (ref: string): unknown =>
    ({
      "space/4": 16,
      "space/6": { value: 24, unit: "px" },
      "brand/ink": "#111111",
      "copy/cta": "Start free",
      "type/body": { font: "Inter", size: 15 },
    })[ref]

  test("every binding becomes its resolved literal; dimensions become px numbers", () => {
    const node = {
      type: "text",
      parent: "p",
      order: "a0",
      content: { $ref: "copy/cta" },
      fill: { $ref: "brand/ink" },
      opacity: 1,
      style: { typography: { $ref: "type/body" }, size: 18, lineHeight: { $ref: "space/x" } },
    }
    const set = detachAllFields(node, resolve)
    expect(set).toEqual({
      content: "Start free",
      fill: "#111111",
      // Typography fields apply first; inline fields win; an unresolved binding is kept.
      style: { font: "Inter", size: 18, lineHeight: { $ref: "space/x" } },
    })
    expect(nodeHasBinding(node)).toBe(true)
    const frame = {
      type: "frame",
      layout: { dir: "row", gap: { $ref: "space/6" }, pad: [8, { $ref: "space/4" }] },
    }
    expect(detachAllFields(frame, resolve)).toEqual({
      layout: { dir: "row", gap: 24, pad: [8, 16] },
    })
    expect(nodeHasBinding({ type: "rect", w: 4 })).toBe(false)
  })
})

describe("layer menu variable items", () => {
  const doc = {
    getNode: (id: string) =>
      ({ a: { type: "text", name: "A", content: { $ref: "copy/cta" } } })[id] as
        | Record<string, unknown>
        | undefined,
  }
  test("a group before Delete: Bind visibility… · Bind text… · Detach all variables", () => {
    const m = canvasMenuModel({
      doc,
      selection: ["a"],
      live: new Set(),
      agent: false,
      variables: { bound: true, bindVisible: true, bindText: true },
    })
    expect(m?.structure.at(-1)?.map((r) => r.label)).toEqual([
      "Bind visibility to variable…",
      "Bind text to variable…",
      "Detach all variables",
    ])
    expect(m?.danger.map((r) => r.label)).toEqual(["Delete"])
  })

  test("hidden when nothing applies (the designed list stays as is)", () => {
    const m = canvasMenuModel({
      doc,
      selection: ["a"],
      live: new Set(),
      agent: false,
      variables: { bound: false, bindVisible: false, bindText: false },
    })
    expect(m?.structure).toEqual([])
  })
})
