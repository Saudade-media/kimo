import { describe, expect, test } from "bun:test"
import { type KimoDocument, SCHEMA_URL } from "@kimo/core-schema"
import { rebaseRelativeRefs, relativeRefBetween } from "@kimo/platform"
import { diffLibraries, parseLibrary } from "../../src/editor/m3/libraries"

const doc = (nodes: Record<string, Record<string, unknown>>, extra: Record<string, unknown> = {}) =>
  ({ $schema: SCHEMA_URL, format: "1.0.0", nodes, ...extra }) as unknown as KimoDocument

describe("libraries", () => {
  test("untrusted library text: invalid or newer documents are refused", () => {
    expect(() =>
      parseLibrary(
        JSON.stringify({
          $schema: SCHEMA_URL,
          format: "9.0.0",
          nodes: { x: { type: "bogus", parent: "y", order: 5 } },
        }),
      ),
    ).toThrow()
    expect(() =>
      parseLibrary(
        JSON.stringify({ $schema: SCHEMA_URL, format: "1.0.0", nodes: { x: { type: "bogus" } } }),
      ),
    ).toThrow()
    expect(
      parseLibrary(JSON.stringify({ $schema: SCHEMA_URL, format: "1.0.0", nodes: {} })).nodes,
    ).toEqual({})
  })

  test("changed since last open: components and variables", () => {
    const before = doc(
      {
        btn0000001: {
          type: "frame",
          name: "Button",
          parent: null,
          order: "a0",
          component: true,
          fill: "#000000",
        },
        old0000001: { type: "frame", name: "Old", parent: null, order: "a1", component: true },
      },
      { variables: { ink: { type: "color", value: "#000000" } } },
    )
    const after = doc(
      {
        btn0000001: {
          type: "frame",
          name: "Button",
          parent: null,
          order: "a0",
          component: true,
          fill: "#111111",
        },
        new0000001: { type: "frame", name: "New", parent: null, order: "a1", component: true },
      },
      {
        variables: {
          ink: { type: "color", value: "#111111" },
          paper: { type: "color", value: "#FFFFFF" },
        },
      },
    )
    const d = diffLibraries(before, after)
    expect(d.map((c) => `${c.kind}:${c.name}:${c.change}`).sort()).toEqual([
      "component:Button:modified",
      "component:New:added",
      "component:Old:removed",
      "variable:ink:modified",
      "variable:paper:added",
    ])
  })

  test("import paths are stored relative to the current file; Save as rebases every import", () => {
    expect(relativeRefBetween("/w/app/doc.kimo", "/w/icons/icons.kimo")).toBe("../icons/icons.kimo")
    expect(relativeRefBetween("/w/app/doc.kimo", "/w/app/ui.kimo")).toBe("./ui.kimo")
    expect(relativeRefBetween("/w/app/doc.kimo", "/w/app/lib/My UI.kimo")).toBe(
      "./lib/My%20UI.kimo",
    )
    expect(
      rebaseRelativeRefs({ ui: "./ui.kimo" }, "/w/app/doc.kimo", "/w/app/v2/doc.kimo"),
    ).toEqual({ ui: "../ui.kimo" })
    expect(rebaseRelativeRefs({ ui: "./ui.kimo" }, "/w/a.kimo", "/w/b.kimo")).toBeNull()
  })
})
