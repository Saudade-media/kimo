/** Board 27 §8 Components (desing.pen d7gkR): editor-side models. */
import { describe, expect, test } from "bun:test"
import { type KimoDocument, validate } from "@kimo/core-schema"
import { createDocStore } from "@kimo/editor-state"
import { rebaseRelativeRefs, relativeRefBetween } from "@kimo/platform"
import { overrideText, reasonText } from "../src/editor/m3/ComponentDialogs"
import { duplicateMainOps, selectedMain } from "../src/editor/m3/component-actions"
import {
  defaultOptionLabel,
  parseValue,
  propertiesFor,
  rowsOf,
  storedOf,
  targetsByOption,
  valueText,
  withOptionRenamed,
  withOptionTargets,
} from "../src/editor/m3/enum-targets"

const SCHEMA = "https://kimo.design/schema/kimo-1.0.json"

describe("enum targets (a, FZirR)", () => {
  const types: Record<string, string> = { Btn: "frame", Lbl: "text", Ico: "icon" }
  const typeOf = (id: string) => types[id] ?? ""

  test("properties are filtered by the layer's type", () => {
    const keys = (t: string) => propertiesFor(t).map((p) => p.key)
    expect(keys("frame")).toContain("pad")
    expect(keys("frame")).not.toContain("fontSize")
    expect(keys("text")).toEqual(expect.arrayContaining(["fontSize", "fontWeight", "content"]))
    expect(keys("icon")).toEqual(expect.arrayContaining(["size", "icon", "color"]))
    expect(keys("instance")).toEqual(["w", "h", "radius", "opacity", "fill", "visible"])
  })

  test("a legacy opacity enum reads as one opacity target per option", () => {
    const legacy = {
      type: "enum",
      target: "Btn",
      field: "opacity",
      options: { full: 1, half: 0.5 },
    }
    expect(targetsByOption(legacy)).toEqual({
      full: [{ target: "Btn", field: "opacity", value: 1 }],
      half: [{ target: "Btn", field: "opacity", value: 0.5 }],
    })
    // The first edit rewrites it in targets form.
    const next = withOptionTargets(legacy, "half", [
      { target: "Btn", field: "opacity", value: 0.5 },
      { target: "Lbl", field: "style/size", value: 12 },
    ])
    expect(next.target).toBeUndefined()
    expect(next.options).toEqual({ full: null, half: null })
    expect((next.targets as Record<string, unknown[]>).full).toEqual([
      { target: "Btn", field: "opacity", value: 1 },
    ])
  })

  test("Size groups w + h into one row and writes both back", () => {
    const stored = [
      { target: "Ico", field: "w", value: 16 },
      { target: "Ico", field: "h", value: 16 },
      { target: "Btn", field: "layout/pad", value: [8, 14] },
    ]
    const rows = rowsOf(stored, typeOf)
    expect(rows.map((r) => r.property)).toEqual(["size", "pad"])
    expect(storedOf(rows, typeOf)).toEqual(stored)
    expect(valueText([8, 14])).toBe("8 · 14")
  })

  test("values parse per kind; $name binds", () => {
    expect(parseValue("8 · 14", "pad")).toEqual([8, 14])
    expect(parseValue("14", "number")).toBe(14)
    expect(parseValue("abc", "number")).toBeNull()
    expect(parseValue("ff5500", "color")).toBe("#FF5500")
    expect(parseValue("$space/md", "number")).toEqual({ $ref: "space/md" })
    expect(parseValue("hidden", "boolean")).toBe(false)
  })

  test("default: the option the main is authored as; rename / remove keeps ≥ 1 option", () => {
    const def = {
      type: "enum",
      options: { sm: null, md: null },
      targets: {
        sm: [{ target: "Lbl", field: "style/size", value: 12 }],
        md: [{ target: "Lbl", field: "style/size", value: 14 }],
      },
    }
    const nodes: Record<string, Record<string, unknown>> = { Lbl: { style: { size: 14 } } }
    expect(defaultOptionLabel(def, (id) => nodes[id])).toBe("default: md")
    expect(Object.keys(withOptionRenamed(def, "sm", "xs")?.options as object)).toEqual(["xs", "md"])
    const one = withOptionRenamed(def, "sm", null)
    expect(Object.keys(one?.options as object)).toEqual(["md"])
    expect(withOptionRenamed(one as never, "md", null)).toBeNull()
  })
})

describe("⌘D on a main (d, WYOjQ)", () => {
  const doc = (): KimoDocument =>
    ({
      $schema: SCHEMA,
      format: "1.0.0",
      nodes: {
        Button0001: {
          type: "frame",
          parent: null,
          order: "a0",
          name: "Button",
          x: 10,
          y: 20,
          component: { props: { label: { type: "text", target: "BtnLabel01", field: "content" } } },
        },
        BtnLabel01: { type: "text", parent: "Button0001", order: "a0", content: "Go" },
      },
    }) as unknown as KimoDocument
  let n = 0
  const ids = () => `Dup${String(++n).padStart(7, "0")}`

  test("as an instance: +16/+16, linked to the main", () => {
    const store = createDocStore(doc())
    expect(selectedMain(store, ["Button0001"])).toBe("Button0001")
    const r = duplicateMainOps(store, ["Button0001"], "instance", new Set(), ids)
    store.apply(r.ops, { origin: "user" })
    const copy = store.getNode(r.created[0] as string)
    expect([copy?.type, copy?.of, copy?.x, copy?.y]).toEqual(["instance", "Button0001", 26, 36])
    expect(validate(store.toDocument()).errors).toEqual([])
  })

  test("as a new component: “Button 2”, props re-pointed at its own layers", () => {
    const store = createDocStore(doc())
    const r = duplicateMainOps(store, ["Button0001"], "component", new Set(["Button"]), ids)
    store.apply(r.ops, { origin: "user" })
    const copy = store.getNode(r.created[0] as string) as Record<string, unknown>
    expect(copy.name).toBe("Button 2")
    const target = (copy.component as { props: { label: { target: string } } }).props.label.target
    expect(target).not.toBe("BtnLabel01")
    expect(store.getNode(target)?.parent).toBe(r.created[0])
    expect(validate(store.toDocument()).errors).toEqual([])
  })
})

describe("library paths (gPEqc)", () => {
  test("stored relative to the current file, never always ./file", () => {
    expect(relativeRefBetween("/w/app/doc.kimo", "/w/icons/icons.kimo")).toBe("../icons/icons.kimo")
    expect(relativeRefBetween("/w/app/doc.kimo", "/w/app/ui.kimo")).toBe("./ui.kimo")
    expect(relativeRefBetween("/w/app/doc.kimo", "/w/app/lib/My UI.kimo")).toBe(
      "./lib/My%20UI.kimo",
    )
  })

  test("moving the file (Save as) rebases every import", () => {
    expect(
      rebaseRelativeRefs({ ui: "./ui.kimo" }, "/w/app/doc.kimo", "/w/app/v2/doc.kimo"),
    ).toEqual({ ui: "../ui.kimo" })
    expect(rebaseRelativeRefs({ ui: "./ui.kimo" }, "/w/a.kimo", "/w/b.kimo")).toBeNull()
  })
})

describe("broken override rows (c)", () => {
  test("override and reason copy", () => {
    const base = { instance: "I", key: "K", source: "stash" as const }
    expect(overrideText({ ...base, kind: "layer", override: { set: { content: "New" } } })).toBe(
      "content: “New”",
    )
    expect(
      overrideText({
        ...base,
        kind: "variable",
        field: "fill",
        variable: "brand:cta",
        override: {},
      }),
    ).toBe("fill: $brand:cta")
    expect(reasonText({ ...base, kind: "layer", override: {} })).toBe("Layer removed")
    expect(reasonText({ ...base, kind: "variable", variable: "brand:cta", override: {} })).toBe(
      "Library variable renamed",
    )
  })
})
