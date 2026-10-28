/** Agent canvas cards: notes and prompts follow the export rules, and the prompt connector. */
import { beforeAll, describe, expect, test } from "bun:test"
import { createLayoutEngine, createResolver, nodeSourceFromDocument } from "@kimo/layout"
import type { CanvasKit } from "canvaskit-wasm"
import {
  CanvasKitRenderer,
  connectorPoints,
  DEFAULT_AGENT_CANVAS_THEME,
  type RenderScene,
} from "../src"
import { loadCanvasKit } from "../src/ck"
import { near, pixelsOf } from "./helpers/golden"

let ck: CanvasKit
const r = new CanvasKitRenderer()

beforeAll(async () => {
  await r.init({ offlineFonts: true })
  ck = await loadCanvasKit()
})

describe("notes and prompts", () => {
  test("a parent export skips notes and prompts; the note itself exports as a root", async () => {
    const nodes = {
      board0001: {
        type: "frame",
        parent: null,
        order: "a",
        x: 0,
        y: 0,
        w: 260,
        h: 140,
        fill: "#FFFFFF",
      },
      inner0001: {
        type: "note",
        parent: "board0001",
        order: "a",
        x: 10,
        y: 10,
        content: "A note inside the board",
      },
    }
    const src = nodeSourceFromDocument({ nodes } as never)
    const resolve = createResolver({}, src)
    const scene: RenderScene = {
      nodes: src,
      header: {},
      resolve,
      assets: { load: async () => null },
    }
    const engine = createLayoutEngine()
    await engine.init()
    r.setDocument(scene)
    r.setLayout(engine.compute({ nodes: src, resolve, measureText: r.textMeasurer() }))
    const board = pixelsOf(ck, await r.exportRaster("board0001"))
    expect(board.at(100, 40)).toEqual([255, 255, 255, 255])
    const note = pixelsOf(ck, await r.exportRaster("inner0001"))
    expect(near(note.at(110, 40), DEFAULT_AGENT_CANVAS_THEME.note, 3)).toBe(true)
    engine.dispose()
  })

  test("connector points: horizontal at the overlap middle, vertical when stacked, none inside", () => {
    expect(
      connectorPoints({ x: 32, y: 220, w: 300, h: 156 }, { x: 360, y: 52, w: 340, h: 230 }),
    ).toEqual({ from: { x: 332, y: 251 }, to: { x: 360, y: 251 } })
    expect(
      connectorPoints({ x: 0, y: 0, w: 100, h: 50 }, { x: 20, y: 100, w: 100, h: 50 }),
    ).toEqual({ from: { x: 60, y: 50 }, to: { x: 60, y: 100 } })
    expect(
      connectorPoints({ x: 0, y: 0, w: 100, h: 100 }, { x: 50, y: 50, w: 10, h: 10 }),
    ).toBeNull()
  })
})
