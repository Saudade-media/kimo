import { describe, expect, test } from "bun:test"
import { createDocStore, exportDocument } from "@kimo/editor-state"
import { buildSampleDocument, newDocument } from "../../src/lib/sample"

describe("sample document", () => {
  test("a new web file starts as a valid document with no undo history", () => {
    const store = createDocStore(newDocument("Marketing site"))
    buildSampleDocument(store)
    expect(store.children(null).length).toBeGreaterThan(0)
    expect(() => exportDocument(store)).not.toThrow()
    expect(store.canUndo("user")).toBe(false)
  })
})
