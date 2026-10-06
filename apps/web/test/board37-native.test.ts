/**
 * Board 37 audit, native scope: Edit menu items act on a focused text field first (A6 / E5),
 * the Home composer's file creation reports a refused folder instead of reading it as free (A4).
 */
import { describe, expect, test } from "bun:test"
import { PlatformError } from "@kimo/platform"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { createDiskFile, homeDocument } from "../src/home/submit"
import { runTextEdit } from "../src/lib/native-menu"

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

describe("Edit menu items (A6 / E5)", () => {
  const g = globalThis as { HTMLElement?: unknown }
  const had = g.HTMLElement
  g.HTMLElement = FakeElement

  test("a focused text field runs the item with execCommand", () => {
    const input = fakeDocument(new FakeElement("INPUT"))
    expect(runTextEdit("undo", input.doc)).toBe(true)
    expect(runTextEdit("redo", input.doc)).toBe(true)
    expect(runTextEdit("select-all", input.doc)).toBe(true)
    expect(input.commands).toEqual(["undo", "redo", "selectAll"])
    const area = fakeDocument(new FakeElement("TEXTAREA"))
    expect(runTextEdit("undo", area.doc)).toBe(true)
  })

  test("the document runs it otherwise, and other items never go to the field", () => {
    const canvas = fakeDocument(new FakeElement("DIV"))
    expect(runTextEdit("undo", canvas.doc)).toBe(false)
    const checkbox = fakeDocument(new FakeElement("INPUT", "checkbox"))
    expect(runTextEdit("select-all", checkbox.doc)).toBe(false)
    const none = fakeDocument(null)
    expect(runTextEdit("redo", none.doc)).toBe(false)
    const input = fakeDocument(new FakeElement("INPUT"))
    expect(runTextEdit("new-file", input.doc)).toBe(false)
    expect(runTextEdit("go-home", input.doc)).toBe(false)
    expect(input.commands).toEqual([])
    g.HTMLElement = had
  })
})

describe("Home composer file creation (A4)", () => {
  test("a refused stat is the error, never a free name", async () => {
    const p = createMemoryPlatform({
      settings: { "files.newFilesDir": "/Users/me/Documents/Kimo" },
    })
    await p.settings.ready
    const files = p.files as { stat: typeof p.files.stat }
    files.stat = async (ref) => {
      throw new PlatformError("PERMISSION", `${ref} is outside the files Kimo was given access to`)
    }
    const e = await createDiskFile(p, "Pricing", (n) =>
      homeDocument({ title: n, owner: null }),
    ).catch((x: unknown) => x)
    expect(e instanceof PlatformError && e.code).toBe("PERMISSION")
    expect(p.control.readFile("/Users/me/Documents/Kimo/Pricing.kimo")).toBeNull()
  })
})
