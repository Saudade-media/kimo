/** Shared document fixture for the clipboard and structure-command tests. */
import type { KimoDocument } from "@kimo/core-schema"
import { createDocStore, type DocStore } from "@kimo/editor-state"
import type { LayoutResult } from "@kimo/layout"

export const SCHEMA = "https://getkimo.design/schema/kimo-1.0.json"

/** A frame "Hero" (0,0 336x180) with two cards and a free text; a component "Btn" with an instance. */
export function fixture(): KimoDocument {
  return {
    $schema: SCHEMA,
    format: "1.0.0",
    variables: { brand: { type: "color", value: "#2F6BFF" } },
    nodes: {
      HeroFrame1: {
        type: "frame",
        parent: null,
        order: "a0",
        name: "Hero",
        x: 0,
        y: 0,
        w: 336,
        h: 180,
      },
      CardOne001: {
        type: "frame",
        parent: "HeroFrame1",
        order: "a0",
        name: "Card",
        x: 20,
        y: 24,
        w: 136,
        h: 132,
        fill: { $ref: "brand" },
      },
      CardTitle1: { type: "text", parent: "CardOne001", order: "a0", content: "Starter" },
      BtnMain001: {
        type: "frame",
        parent: null,
        order: "a1",
        name: "Btn",
        x: 500,
        y: 0,
        w: 80,
        h: 32,
        component: true,
      },
      BtnLabel01: { type: "text", parent: "BtnMain001", order: "a0", content: "Buy" },
      BtnInst001: {
        type: "instance",
        parent: "HeroFrame1",
        order: "a1",
        of: "BtnMain001",
        x: 200,
        y: 40,
      },
      Row0000001: {
        type: "frame",
        parent: null,
        order: "a2",
        name: "Row",
        x: 0,
        y: 300,
        w: 196,
        h: 112,
        layout: { dir: "row", gap: 12, pad: 12 },
      },
      RowA000001: { type: "rect", parent: "Row0000001", order: "a0", w: 80, h: 88 },
      RowB000001: { type: "rect", parent: "Row0000001", order: "a1", w: 80, h: { mode: "fill" } },
    },
  }
}

/** A hand-made layout of the fixture (world boxes; frames have no rotation). */
export function layoutOf(store: DocStore): LayoutResult {
  const boxes: Record<string, [number, number, number, number]> = {
    HeroFrame1: [0, 0, 336, 180],
    CardOne001: [20, 24, 136, 132],
    CardTitle1: [20, 24, 60, 20],
    BtnMain001: [500, 0, 80, 32],
    BtnLabel01: [500, 0, 30, 20],
    BtnInst001: [200, 40, 80, 32],
    Row0000001: [0, 300, 196, 112],
    RowA000001: [12, 312, 80, 88],
    RowB000001: [104, 312, 80, 88],
  }
  const nodes = new Map<string, unknown>()
  for (const [id, [x, y, w, h]] of Object.entries(boxes)) {
    if (!store.hasNode(id)) continue
    const p = store.getNode(id)?.parent
    const pb = typeof p === "string" ? boxes[p] : undefined
    const px = pb ? pb[0] : 0
    const py = pb ? pb[1] : 0
    nodes.set(id, {
      world: { x, y, w, h },
      local: { x: x - px, y: y - py, w, h },
      transform: [1, 0, 0, 1, x, y],
      visible: true,
    })
  }
  return { nodes } as unknown as LayoutResult
}

export function setup(doc = fixture()) {
  const store = createDocStore(doc)
  return { store, layout: layoutOf(store) }
}

let n = 0
export const ids = () => `New${String(++n).padStart(7, "0")}`
