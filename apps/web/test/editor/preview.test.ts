import { describe, expect, test } from "bun:test"
import { createDocStore, type DocStore, type Op } from "@kimo/editor-state"
import { createInstanceView, createResolver } from "@kimo/layout"
import { pickPreviewFrame, topLevelFrames } from "../../src/preview/model"
import { previewSource } from "../../src/preview/render"

function doc(): DocStore {
  const store = createDocStore()
  const ops: Op[] = [
    { op: "setThemes", set: { mode: ["light", "dark"], brand: ["Kimo", "Acme"] } },
    {
      op: "setVariables",
      set: {
        bg: {
          type: "color",
          value: [
            { value: "#FFFFFF", when: { mode: "light" } },
            { value: "#000000", when: { mode: "dark" } },
          ],
        },
      },
    },
    {
      op: "insert",
      id: "homepage",
      parent: null,
      node: { type: "frame", name: "Home", x: 0, y: 0, w: 400, h: 300 },
    },
    {
      op: "insert",
      id: "looserect",
      parent: null,
      node: { type: "rect", name: "Loose rect", x: 500, y: 0, w: 10, h: 10 },
    },
    {
      op: "insert",
      id: "pricing",
      parent: null,
      node: {
        type: "frame",
        name: "Pricing Desktop",
        x: 600,
        y: 0,
        w: 1440,
        h: 960,
        theme: { brand: "Acme" },
      },
    },
    {
      op: "insert",
      id: "cardnode",
      parent: "pricing",
      node: { type: "rect", name: "Card", x: 10, y: 10, w: 10, h: 10 },
    },
    {
      op: "insert",
      id: "docspage",
      parent: null,
      node: { type: "frame", name: "Docs", x: 2200, y: 0, w: 400, h: 300 },
    },
  ]
  const res = store.apply(ops, { origin: "user" })
  if (!res.ok) throw new Error(JSON.stringify(res))
  return store
}

describe("preview", () => {
  test("opens the selected top-level frame, else the frame holding the selection, else the first", () => {
    const s = doc()
    expect(topLevelFrames(s)).toEqual(["homepage", "pricing", "docspage"])
    expect(pickPreviewFrame(s, ["docspage"])).toBe("docspage")
    expect(pickPreviewFrame(s, ["cardnode"])).toBe("pricing")
    expect(pickPreviewFrame(s, ["looserect"])).toBe("homepage")
    expect(pickPreviewFrame(s, [])).toBe("homepage")
    expect(pickPreviewFrame(createDocStore(), [])).toBeNull()
  })

  test("theme overrides apply in the render source only; the store never changes", () => {
    const s = doc()
    const before = JSON.stringify(s.toDocument())
    const src = previewSource(
      s,
      () => "pricing",
      () => ({ mode: "dark" }),
    )
    // One root: the previewed frame.
    expect(src.children(null)).toEqual(["pricing"])
    expect(src.children("pricing")).toEqual(["cardnode"])
    const node = src.getNode("pricing") as { theme?: Record<string, string> }
    expect(node.theme).toEqual({ brand: "Acme", mode: "dark" })
    // The resolver over the source sees the override (variables resolve dark).
    const header = s.toHeader()
    const view = createInstanceView(src, { header: () => header as never })
    const resolver = createResolver(header as never, view)
    expect(resolver.theme("cardnode").mode).toBe("dark")
    expect(resolver.theme("cardnode").brand).toBe("Acme")
    expect(JSON.stringify(s.toDocument())).toBe(before)
    expect((s.getNode("pricing") as { theme?: unknown }).theme).toEqual({ brand: "Acme" })
  })
})
