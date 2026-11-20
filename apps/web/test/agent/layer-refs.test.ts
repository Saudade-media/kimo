import { describe, expect, test } from "bun:test"
import { composerSegments, insertLayerRefs, layerRefs } from "../../src/agent-panel/layer-refs"

describe("inline layer references", () => {
  test("chips keep their position in the sent text and survive odd names", () => {
    const a = insertLayerRefs("", null, [{ id: "a1", name: 'Hero "A" ]]' }])
    const b = insertLayerRefs(`${a.text} make it blue, like `, null, [{ id: "b2", name: "B" }])
    expect(layerRefs(b.text)).toEqual([
      { id: "a1", name: 'Hero "A" ]]' },
      { id: "b2", name: "B" },
    ])
    expect(composerSegments(b.text).map((s) => s.kind)).toEqual(["layer", "text", "layer"])
    expect(b.text).toBe(`[[layer:a1 "Hero \\"A\\" ]]"]] make it blue, like [[layer:b2 "B"]]`)
  })

  test("inserts several layers at the cursor in order", () => {
    const r = insertLayerRefs("ab", 1, [
      { id: "x", name: "X" },
      { id: "y", name: "Y" },
    ])
    expect(r.text).toBe('a[[layer:x "X"]][[layer:y "Y"]]b')
    expect(r.text.slice(r.caret)).toBe("b")
  })
})
