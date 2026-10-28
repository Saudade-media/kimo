/**
 * Agent build motion: the renderer draws per-node motion on top of the final layout (opacity,
 * scale about the center, rise, offsets and an in-between frame size), while snapshots and
 * exports always show the final state.
 */
import { beforeAll, describe, expect, test } from "bun:test"
import {
  createInstanceView,
  createLayoutEngine,
  createResolver,
  nodeSourceFromDocument,
} from "@kimo/layout"
import type { CanvasKit, Surface } from "canvaskit-wasm"
import { CanvasKitRenderer, type NodeMotion } from "../src"
import { loadCanvasKit } from "../src/ck"
import { pixelAt } from "./helpers/golden"
import { sceneOf, simpleLayout, type TestDoc } from "./helpers/scene"

let ck: CanvasKit
const r = new CanvasKitRenderer()

beforeAll(async () => {
  await r.init({ offlineFonts: true })
  ck = await loadCanvasKit()
})

/** Stage 232 × 168 with a 160 × 96 card at 36, 36. */
const doc: TestDoc = {
  nodes: {
    stage0001: {
      type: "frame",
      parent: null,
      order: "a",
      x: 0,
      y: 0,
      w: 232,
      h: 168,
      fill: "#FFFFFF",
    },
    card00001: {
      type: "rect",
      parent: "stage0001",
      order: "a",
      x: 36,
      y: 36,
      w: 160,
      h: 96,
      fill: "#2563EB",
    },
  },
}

function setup() {
  const scene = sceneOf(doc)
  r.setDocument(scene)
  r.setLayout(simpleLayout(scene, r.textMeasurer()))
  r.attachRaster(232, 168, 1)
  r.setViewport({ x: 0, y: 0, zoom: 1 })
  r.setOverlay({ selection: [], hovered: null, marquee: null })
}

/** PNG of what `render()` drew (a motion frame, unlike `snapshot()`). */
function frame(): Uint8Array {
  r.render()
  const s = (r as unknown as { surface: Surface }).surface
  const img = s.makeImageSnapshot()
  const bytes = img.encodeToBytes(ck.ImageFormat.PNG, 100)
  img.delete()
  if (!bytes) throw new Error("png")
  return bytes
}

const motion = (m: NodeMotion) => new Map([["card00001", m]])

describe("renderer motion", () => {
  test("opacity blends, scale is about the center, rise offsets", () => {
    setup()
    r.setMotion(motion({ opacity: 0.5, scale: 0.98, dy: 3 }))
    const png = frame()
    // Center: half-blended blue over white (#2563EB at 50 %).
    const c = pixelAt(ck, png, 116, 84)
    expect(Math.abs((c[0] ?? 0) - Math.round((0x25 + 255) / 2))).toBeLessThanOrEqual(3)
    expect(Math.abs((c[2] ?? 0) - Math.round((0xeb + 255) / 2))).toBeLessThanOrEqual(3)
    // Scaled box: x 36 + 160 × 0.01 = 37.6 … 194.4; y 36 + 96 × 0.01 + 3 = 39.96 … 134.04.
    expect(pixelAt(ck, png, 37, 84)[0]).toBeGreaterThan(200)
    expect(pixelAt(ck, png, 38, 84)[0]).toBeLessThan(200)
    expect(pixelAt(ck, png, 116, 39)[0]).toBeGreaterThan(200)
    expect(pixelAt(ck, png, 116, 41)[0]).toBeLessThan(200)
    r.setMotion(null)
    r.detach()
  })

  test("reflow: offsets move the subtree; w / h draw a frame at its in-between size", () => {
    setup()
    r.setMotion(
      new Map<string, NodeMotion>([
        ["stage0001", { w: 232, h: 100 }],
        ["card00001", { dy: -20 }],
      ]),
    )
    const png = frame()
    // Stage drawn 100 tall: below it is the transparent canvas.
    expect(pixelAt(ck, png, 4, 98)[3]).toBe(255)
    expect(pixelAt(ck, png, 4, 104)[3]).toBe(0)
    // Card drawn 20 higher: top edge at 16.
    expect(pixelAt(ck, png, 116, 17)[0]).toBeLessThan(100)
    expect(pixelAt(ck, png, 116, 14)[0]).toBeGreaterThan(200)
    r.setMotion(null)
    r.detach()
  })

  test("snapshot and exportRaster ignore motion (final state)", async () => {
    setup()
    const final = r.snapshot()
    const exported = await r.exportRaster("stage0001")
    r.setMotion(motion({ opacity: 0.2, scale: 0.96, dy: 6 }))
    expect(Buffer.from(r.snapshot()).equals(Buffer.from(final))).toBe(true)
    expect(Buffer.from(await r.exportRaster("stage0001")).equals(Buffer.from(exported))).toBe(true)
    // Motion cleared: the next frame draws the card at its final size again.
    r.setMotion(null)
    expect(pixelAt(ck, frame(), 37, 84).slice(0, 3)).toEqual([0x25, 0x63, 0xeb])
    r.detach()
  })

  test("an instance first drawn during its entrance draws in full once it ends", async () => {
    // A white pill instance on a black stage; its component sits off-screen.
    const nodes: TestDoc["nodes"] = {
      stage0001: { type: "frame", parent: null, order: "a", w: 120, h: 60, fill: "#000000" },
      pill00001: {
        type: "instance",
        parent: "stage0001",
        order: "a",
        x: 20,
        y: 12,
        of: "comp00001",
      },
      comp00001: {
        type: "frame",
        parent: null,
        order: "b",
        x: 200,
        w: 80,
        h: 36,
        fill: "#FFFFFF",
        component: {},
      },
      dot000001: { type: "rect", parent: "comp00001", order: "a", x: 30, y: 8, w: 20, h: 20 },
    }
    const engine = createLayoutEngine()
    await engine.init()
    const src = nodeSourceFromDocument({ nodes } as never)
    const header = {}
    const view = createInstanceView(src, { header: () => header as never })
    const resolve = createResolver(header, view)
    r.setDocument({ nodes: view, header, resolve, assets: { load: async () => null } })
    r.setLayout(
      engine.compute({ nodes: src, expanded: view, resolve, measureText: r.textMeasurer() }),
    )
    r.attachRaster(120, 60, 1)
    r.setViewport({ x: 0, y: 0, zoom: 1 })
    r.setOverlay({ selection: [], hovered: null, marquee: null })
    // The entrance's first visible frame is the first time the instance is drawn.
    r.setMotion(new Map([["pill00001", { opacity: 0.1 }]]))
    frame()
    r.setMotion(null)
    // Its cached picture holds the pill itself, not that 10 % frame.
    expect(pixelAt(ck, frame(), 30, 30).slice(0, 3)).toEqual([255, 255, 255])
    r.detach()
  })
})
