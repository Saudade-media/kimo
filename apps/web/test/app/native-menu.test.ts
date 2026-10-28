/** Edit menu items act on a focused text field first, so ⌘Z in a field never undoes the canvas. */
import { describe, expect, test } from "bun:test"
import { runTextEdit } from "../../src/lib/native-menu"

class FakeElement {
  isContentEditable = false
  constructor(
    public tagName: string,
    public type = "text",
  ) {}
}

function fakeDocument(active: FakeElement | null) {
  const commands: string[] = []
  const doc = {
    activeElement: active,
    execCommand: (c: string) => {
      commands.push(c)
      return true
    },
  }
  return { doc: doc as unknown as Document, commands }
}

describe("Edit menu items", () => {
  test("a focused text field runs the item itself; otherwise the document does", () => {
    const g = globalThis as { HTMLElement?: unknown }
    const had = g.HTMLElement
    g.HTMLElement = FakeElement
    try {
      const input = fakeDocument(new FakeElement("INPUT"))
      expect(runTextEdit("undo", input.doc)).toBe(true)
      expect(runTextEdit("redo", input.doc)).toBe(true)
      expect(runTextEdit("select-all", input.doc)).toBe(true)
      expect(input.commands).toEqual(["undo", "redo", "selectAll"])
      expect(runTextEdit("undo", fakeDocument(new FakeElement("TEXTAREA")).doc)).toBe(true)

      expect(runTextEdit("undo", fakeDocument(new FakeElement("DIV")).doc)).toBe(false)
      expect(
        runTextEdit("select-all", fakeDocument(new FakeElement("INPUT", "checkbox")).doc),
      ).toBe(false)
      expect(runTextEdit("redo", fakeDocument(null).doc)).toBe(false)
      // Other items never go to the field.
      const other = fakeDocument(new FakeElement("INPUT"))
      expect(runTextEdit("new-file", other.doc)).toBe(false)
      expect(runTextEdit("go-home", other.doc)).toBe(false)
      expect(other.commands).toEqual([])
    } finally {
      g.HTMLElement = had
    }
  })
})
