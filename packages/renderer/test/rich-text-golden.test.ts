/**
 * Board 30 "Rich text" goldens: one text node with mixed per-span styles (feature "text/runs",
 * spec §8.1) — family, weight, size, italic, underline / strike, letter spacing, line height and
 * a span's own `fill` (literal and bound) — measured and drawn from the same runs (ADR 0009),
 * wrapping across runs in a fixed-width box.
 */
import { beforeAll, describe, expect, test } from "bun:test"
import { resolveText } from "@kimo/layout"
import type { CanvasKit } from "canvaskit-wasm"
import { CanvasKitRenderer } from "../src"
import { loadCanvasKit } from "../src/ck"
import { compareGolden, pixelAt } from "./helpers/golden"
import { sceneOf, simpleLayout, type TestDoc } from "./helpers/scene"

let ck: CanvasKit
const r = new CanvasKitRenderer()

beforeAll(async () => {
  await r.init({ offlineFonts: true })
  ck = await loadCanvasKit()
})

const RED = "#E5484D"

export const richDoc: TestDoc = {
  variables: { accent: { type: "color", value: "#2F6BFF" } } as never,
  nodes: {
    board0030: {
      type: "frame",
      parent: null,
      order: "a",
      x: 0,
      y: 0,
      w: 360,
      h: 220,
      fill: "#FFFFFF",
    },
    rich00001: {
      type: "text",
      parent: "board0030",
      order: "a",
      x: 16,
      y: 12,
      content: [
        { text: "Save " },
        { text: "40%", style: { weight: 700, size: 28 }, fill: RED },
        { text: " on ", style: { italic: true } },
        { text: "Pro", fill: { $ref: "accent" }, style: { decoration: ["underline"] } },
      ],
      style: { size: 16 },
      fill: "#111111",
    },
    rich00002: {
      type: "text",
      parent: "board0030",
      order: "b",
      x: 16,
      y: 60,
      w: 200,
      grow: "fixed-width",
      content: [
        { text: "A wrapped paragraph where " },
        {
          text: "one phrase is mono and wide",
          style: { font: "JetBrains Mono", letterSpacing: 1 },
        },
        { text: " and the rest is struck", style: { decoration: ["strike"] } },
        { text: " with a taller line.", style: { lineHeight: 2 } },
      ],
      style: { size: 13, lineHeight: 1.4 },
      fill: "#1A1A1A",
    },
    rich00003: {
      type: "text",
      parent: "board0030",
      order: "c",
      x: 240,
      y: 60,
      w: 100,
      h: 120,
      grow: "fixed",
      content: [{ text: "Fixed " }, { text: "middle", style: { weight: 600 }, fill: RED }],
      style: { size: 14, align: "center", valign: "middle" },
    },
  },
}

function load(doc: TestDoc) {
  const scene = sceneOf(doc)
  r.setDocument(scene)
  const layout = simpleLayout(scene, r.textMeasurer())
  r.setLayout(layout)
  return { scene, layout }
}

describe("rich text (text/runs)", () => {
  test("golden: mixed spans, wrapping across runs, fixed box", async () => {
    load(richDoc)
    const bytes = await r.exportRaster("board0030", { scale: 2 })
    const res = compareGolden(ck, "b30-rich-text", bytes)
    expect(res.message && res.ok).toBe(true)
  })

  test("measure and draw read the same runs: span size grows the line", () => {
    const { scene, layout } = load(richDoc)
    const one = layout.nodes.get("rich00001")
    // The 28px span makes the auto box taller than a 16px line.
    expect(one?.local.h ?? 0).toBeGreaterThan(28)
    const input = resolveText("rich00001", scene.nodes.getNode("rich00001") as never, scene.resolve)
    expect(input.runs.map((x) => x.style.fontSize)).toEqual([16, 28, 16, 16])
    expect(input.runs[1]?.fill).toBe(RED)
    expect(input.runs[3]?.fill).toBe("#2F6BFF")
    const wrapped = layout.nodes.get("rich00002")
    expect(wrapped?.text?.lines ?? 0).toBeGreaterThan(3)
  })

  test("a span's own fill paints its glyphs", async () => {
    load(richDoc)
    const bytes = await r.exportRaster("rich00001", { scale: 2 })
    const img = ck.MakeImageFromEncoded(bytes)
    const w = img?.width() ?? 0
    const h = img?.height() ?? 0
    img?.delete()
    let red = 0
    let blue = 0
    for (let y = 0; y < h; y += 1)
      for (let x = 0; x < w; x += 1) {
        const [pr, pg, pb, pa] = pixelAt(ck, bytes, x, y)
        if (pa < 200) continue
        if (pr > 200 && pg < 110 && pb < 120) red++
        if (pb > 200 && pr < 90 && pg < 150) blue++
      }
    expect(red).toBeGreaterThan(30)
    expect(blue).toBeGreaterThan(10)
  })
})
