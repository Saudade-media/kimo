/**
 * Board 30 "Rich text": text runs (feature "text/runs", spec §8.1) export as styled spans in
 * HTML / React, as tspans in SVG, with each span's own `fill` (a color or a color binding).
 */
import { describe, expect, test } from "bun:test"
import type { KimoDocument } from "@kimo/core-schema"
import { buildIR, exportDocument } from "../src"
import { fakeMeasurer } from "./helpers"

const doc = {
  format: "1.0.0",
  features: ["text/runs"],
  variables: { accent: { type: "color", value: "#2F6BFF" } },
  nodes: {
    board00001: {
      type: "frame",
      parent: null,
      order: "a0",
      name: "Board",
      x: 0,
      y: 0,
      w: 320,
      h: 120,
      fill: "#FFFFFF",
    },
    rich000001: {
      type: "text",
      parent: "board00001",
      order: "a0",
      name: "Rich",
      x: 10,
      y: 10,
      content: [
        { text: "Save " },
        { text: "40%", style: { weight: 700, size: 24 }, fill: "#E5484D" },
        { text: " on ", style: { italic: true } },
        { text: "Pro", fill: { $ref: "accent" }, href: "https://getkimo.design" },
      ],
      style: { font: "Inter", size: 16 },
      fill: "#111111",
    },
  },
} as unknown as KimoDocument

const textOf = (files: { path: string; contents: string | Uint8Array }[], ext: string) =>
  files.find((f) => f.path.endsWith(ext))?.contents as string

describe("rich text export", () => {
  test("IR: runs keep their style, link and own color", () => {
    const ir = buildIR(doc, {})
    const t = ir.roots[0]?.children.find((c) => c.id === "rich000001")?.text
    expect(t?.runs.map((r) => r.text)).toEqual(["Save ", "40%", " on ", "Pro"])
    expect(t?.runs[1]?.style.weight.v).toBe(700)
    expect(t?.runs[1]?.style.size.v).toBe(24)
    expect(t?.runs[1]?.color?.css).toBe("#E5484D")
    expect(t?.runs[2]?.style.italic).toBe(true)
    expect(t?.runs[3]?.color?.ref).toBe("accent")
    expect(t?.runs[3]?.href).toBe("https://getkimo.design")
    expect(t?.runs[0]?.color).toBeUndefined()
  })

  test("HTML: one span per run, own color, link as <a>", async () => {
    const { files } = await exportDocument(doc, "html-css", {})
    const all = files.map((f) => String(f.contents)).join("\n")
    expect(all).toContain(">Save </span>")
    expect(all).toContain(">40%</span>")
    expect(all).toContain('href="https://getkimo.design"')
    expect(all).toMatch(/color:\s*(#E5484D|var\(--accent\)|#2F6BFF)/)
    expect(all).toContain("font-weight: 700")
    expect(all).toContain("font-style: italic")
  })

  test("React: spans per run", async () => {
    const { files } = await exportDocument(doc, "react-tailwind", {})
    const all = files.map((f) => String(f.contents)).join("\n")
    expect(all).toContain("40%")
    expect(all).toContain("Pro")
    expect(all).toContain("https://getkimo.design")
    expect(all).toMatch(/E5484D/i)
  })

  test("SVG: tspans carry the run's fill and style", async () => {
    const { files } = await exportDocument(doc, "svg", { measureText: fakeMeasurer })
    const svg = textOf(files, ".svg")
    expect(svg).toContain('fill="#E5484D"')
    expect(svg).toContain('font-weight="700"')
    expect(svg).toContain('fill="#2F6BFF"')
    expect(svg).toContain('font-style="italic"')
  })

  test("a single plain run exports as plain text", async () => {
    const plain = structuredClone(doc) as unknown as { nodes: Record<string, { content: unknown }> }
    ;(plain.nodes.rich000001 as { content: unknown }).content = [{ text: "Just text" }]
    const { files } = await exportDocument(plain as unknown as KimoDocument, "html-css", {})
    const all = files.map((f) => String(f.contents)).join("\n")
    expect(all).toContain("Just text")
    expect(all).not.toContain("<span>Just text</span>")
  })
})
