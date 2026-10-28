import { beforeEach, describe, expect, test } from "bun:test"
import type { KimoDocument } from "@kimo/core-schema"
import {
  clearResolvedCache,
  detachAllFields,
  nodeHasBinding,
  padSidesRaw,
  padValueRaw,
  resolveRef,
} from "../../src/editor/bindings"
import { exportDtcg, importDtcg } from "../../src/editor/m3/variables"
import { withSide } from "../../src/editor/style"
import type { DocHeader } from "../../src/lib/header"

const header = (extra: Record<string, unknown> = {}) =>
  ({
    format: "1.0.0",
    themes: { mode: ["light", "dark"] },
    imports: { brand: "./brand.kimo" },
    variables: {
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
    },
    nodes: {},
    ...extra,
  }) as unknown as DocHeader

const libraries = {
  brand: {
    format: "1.0.0",
    variables: { "space/md": { type: "number", value: 20 } },
    nodes: {},
  } as unknown as KimoDocument,
}

beforeEach(() => clearResolvedCache())

describe("variable resolution", () => {
  test("dimension becomes a px number; alias follows; themed value per theme; library values resolve", () => {
    const h = header()
    expect(resolveRef(h, libraries, "space/6", "number", {}).value).toBe(24)
    const a = resolveRef(h, libraries, "space/gutter", "number", {})
    expect([a.value, a.aliasOf]).toEqual([24, "space/6"])
    expect(resolveRef(h, libraries, "opacity/muted", "number", { mode: "dark" }).value).toBe(0.5)
    expect(resolveRef(h, libraries, "brand:space/md", "number", {}).value).toBe(20)
  })

  test("a missing variable keeps its last resolved value; a library still loading is not missing", () => {
    const h = header()
    expect(resolveRef(h, libraries, "space/4", "number", {}).value).toBe(16)
    const gone = header({ variables: {} })
    const r = resolveRef(gone, libraries, "space/4", "number", {})
    expect([r.ok, r.missing, r.value]).toEqual([false, true, 16])
    const lib = resolveRef(h, libraries, "brand:space/legacy", "number", {})
    expect([lib.missing, lib.value]).toEqual([true, null])
    expect(resolveRef(h, {}, "brand:space/md", "number", {}).missing).toBe(false)
  })
})

describe("bindings survive edits to a sibling field", () => {
  test("padding sides keep their bound sides; the shortest stored form compares bindings structurally", () => {
    const r = { $ref: "space/4" }
    expect(padSidesRaw(r)).toEqual([r, r, r, r])
    expect(padSidesRaw([8, r])).toEqual([8, r, 8, r])
    expect(padSidesRaw(undefined)).toEqual([0, 0, 0, 0])
    expect(padValueRaw([r, r, r, r], false)).toEqual(r)
    expect(padValueRaw([8, r, 8, r], false)).toEqual([8, r])
    expect(padValueRaw([0, 0, 0, 0], false)).toBeUndefined()
  })

  test("editing one stroke side keeps a bound side", () => {
    const stroke = { paint: "#000", width: { t: { $ref: "border/w" }, b: 1 } }
    expect(withSide(stroke, "b", 2).width).toEqual({ t: { $ref: "border/w" }, b: 2 })
  })
})

describe("detach all variables", () => {
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

describe("DTCG token files", () => {
  test("export groups by name path with aliases as {refs}; import restores variables", () => {
    const out = exportDtcg({
      "surface/page": { type: "color", group: "color", value: "#FFF7EE" },
      "text/default": { type: "color", value: { $ref: "ink-900" } },
    })
    expect(out).toEqual({
      color: { surface: { page: { $type: "color", $value: "#FFF7EE" } } },
      text: { default: { $type: "color", $value: "{ink-900}" } },
    })
    expect(
      importDtcg({
        color: {
          $type: "color",
          accent: { $value: "#E2683A" },
          link: { $value: "{color.accent}" },
        },
      }),
    ).toEqual({
      "color/accent": { type: "color", value: "#E2683A" },
      "color/link": { type: "color", value: { $ref: "color/accent" } },
    })
  })
})
