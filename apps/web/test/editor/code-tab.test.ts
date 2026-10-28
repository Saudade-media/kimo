import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "@kimo/core-schema"
import { generateCode, usedVariables } from "../../src/code-tab/generate"
import {
  highlightedLines,
  insideBy,
  nodeAtLine,
  resolveTarget,
  sourceMapOf,
} from "../../src/code-tab/model"
import { DEFAULT_TOGGLES } from "../../src/export/model"

const doc = parse(
  readFileSync(
    join(import.meta.dir, "../../../../packages/exporters/test/fixtures/layout-matrix.kimo"),
    "utf8",
  ),
)

describe("code tab target", () => {
  const parents: Record<string, string | null> = {
    hero: null,
    headline: "hero",
    button: "hero",
    label: "button",
    other: null,
  }
  const inside = insideBy((id) => parents[id] ?? null)

  test("top-most selected nodes are the roots; selecting a child keeps the root and highlights it", () => {
    expect(resolveTarget(["hero"], [], inside)).toEqual({ roots: ["hero"], highlight: [] })
    expect(resolveTarget(["hero", "headline"], [], inside)).toEqual({
      roots: ["hero"],
      highlight: ["headline"],
    })
    expect(resolveTarget(["headline"], ["hero"], inside)).toEqual({
      roots: ["hero"],
      highlight: ["headline"],
    })
    expect(resolveTarget(["label"], ["hero"], inside).roots).toEqual(["hero"])
    // Leaving the subtree retargets.
    expect(resolveTarget(["other"], ["hero"], inside)).toEqual({ roots: ["other"], highlight: [] })
    expect(resolveTarget([], ["hero"], inside)).toEqual({ roots: [], highlight: [] })
  })

  test("instance-owned ids nest by their IdPath", () => {
    const by = insideBy(() => null)
    expect(by("inst/a/b", "inst")).toBe(true)
    expect(by("inst/a/b", "inst/a")).toBe(true)
    expect(by("inst", "inst/a")).toBe(false)
  })
})

describe("code tab source map", () => {
  test("React: the root spans its markup, children their lines; clicking a line selects the innermost node", async () => {
    const g = await generateCode({ document: () => doc }, ["Matrix0001"], "react", DEFAULT_TOGGLES)
    expect(g.errors).toEqual([])
    const root = g.files[0]
    expect(root?.path).toBe("Matrix.tsx")
    const map = root?.map ?? null
    expect(map?.get("Matrix0001")).toEqual({ start: 4, end: 40 })
    expect(map?.get("RowFrame01")).toEqual({ start: 5, end: 11 })
    expect(map?.get("RowKid0001")).toEqual({ start: 6, end: 6 })
    // The shown file carries no ids (same output as Export).
    expect(root?.contents).not.toContain("data-kimo-id")
    expect([...highlightedLines(map, ["RowFrame01"])]).toEqual([5, 6, 7, 8, 9, 10, 11])
    expect(nodeAtLine(map, 6)).toBe("RowKid0001")
    expect(nodeAtLine(map, 5)).toBe("RowFrame01")
    expect(nodeAtLine(map, 1)).toBe(null)
    // A line count that does not match the markup gives no map.
    expect(sourceMapOf("a\nb", "a")).toBe(null)
  })

  test("the tokens view keeps alias targets of the variables the selection uses", () => {
    const v = (name: string, value: unknown, used: boolean) =>
      ({
        name,
        type: "color",
        css: name,
        value,
        entries: null,
        resolved: null,
        usage: used ? ["fill"] : [],
      }) as never
    const out = usedVariables([
      v("a", { $ref: "b" }, true),
      v("b", "#fff", false),
      v("c", "#000", false),
    ])
    expect(out.map((x: { name: string }) => x.name)).toEqual(["a", "b"])
  })
})
