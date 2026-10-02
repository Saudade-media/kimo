import { describe, expect, test } from "bun:test"
import { createDocStore, exportDocument } from "@kimo/editor-state"
import { buildSampleDocument, newDocument } from "../src/lib/sample"

describe("sample document (board 03 canvas)", () => {
  const store = createDocStore(newDocument("Marketing site"))
  buildSampleDocument(store)
  const byName = (name: string, parent: string | null = null) =>
    store.children(parent).find((id) => store.getNode(id)?.name === name)

  test("has the desktop and mobile frames as roots, in order", () => {
    expect(store.children(null).map((id) => store.getNode(id)?.name)).toEqual([
      "Home — Desktop",
      "Home — Mobile",
    ])
  })

  test("desktop frame children follow the node tree", () => {
    const desktop = byName("Home — Desktop") as string
    expect(store.getNode(desktop)).toMatchObject({ x: 56, y: 62, w: 720, fill: "#FFF7EE" })
    expect(store.children(desktop).map((id) => store.getNode(id)?.name)).toEqual([
      "Navbar",
      "Hero",
      "Hero Image Wrap",
    ])
    const hero = byName("Hero", desktop) as string
    expect(store.children(hero).map((id) => store.getNode(id)?.name)).toEqual([
      "Eyebrow",
      "Headline",
      "Subhead",
      "CTA Row",
    ])
    const headline = byName("Headline", hero) as string
    expect(store.getNode(headline)).toMatchObject({
      type: "text",
      content: "Plan less.\nShip more together.",
      style: { font: "Fraunces", size: 52, weight: 600, lineHeight: 1.02, letterSpacing: -1.5 },
    })
  })

  test("is a valid document and leaves no undo history", () => {
    expect(() => exportDocument(store)).not.toThrow()
    expect(store.canUndo("user")).toBe(false)
    expect(store.size).toBe(24)
  })
})
