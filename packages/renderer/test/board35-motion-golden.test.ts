/**
 * Board 35 "Agent build motion" (IASl0): the renderer draws per-node motion on top of the final
 * layout (keyframes mvNij: opacity, scale about the center, rise; reflow V2Bfh0: offsets and an
 * in-between frame size), while snapshots and exports always show the final state.
 */
import { beforeAll, describe, expect, test } from "bun:test"
import type { CanvasKit, Surface } from "canvaskit-wasm"
import { CanvasKitRenderer, type NodeMotion } from "../src"
import { loadCanvasKit } from "../src/ck"
import { compareGolden, pixelAt } from "./helpers/golden"
import { sceneOf, simpleLayout, type TestDoc } from "./helpers/scene"

let ck: CanvasKit
const r = new CanvasKitRenderer()

beforeAll(async () => {
  await r.init({ offlineFonts: true })
  ck = await loadCanvasKit()
})

/** Stage 232 × 168 with the 160 × 96 card at 36, 36 (keyframe stage BeniN). */
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

describe("board 35 renderer motion", () => {
  test("golden at the final frame; motion cleared draws the same pixels", () => {
    setup()
    const final = r.snapshot()
    expect(compareGolden(ck, "board35-final", final).ok).toBe(true)
    r.setMotion(motion({ opacity: 0.5, scale: 0.98, dy: 3 }))
    frame()
    r.setMotion(null)
    expect(compareGolden(ck, "board35-final", frame()).ok).toBe(true)
    r.detach()
  })

  test("t = 0 ms: opacity 0 draws nothing of the layer", () => {
    setup()
    r.setMotion(motion({ opacity: 0, scale: 0.96, dy: 6 }))
    const px = pixelAt(ck, frame(), 116, 84)
    expect(px.slice(0, 3)).toEqual([255, 255, 255])
    r.setMotion(null)
    r.detach()
  })

  test("t = 40 ms: opacity 0.5 blends, scale 0.98 about the center, rise 3", () => {
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
    expect(pixelAt(ck, png, 116, 133)[0]).toBeLessThan(200)
    expect(pixelAt(ck, png, 116, 135)[0]).toBeGreaterThan(200)
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
    expect(compareGolden(ck, "board35-final", r.snapshot(), { channelTolerance: 0 }).ok).toBe(true)
    const during = await r.exportRaster("stage0001")
    expect(Buffer.from(during).equals(Buffer.from(exported))).toBe(true)
    expect(final.length).toBeGreaterThan(0)
    r.setMotion(null)
    r.detach()
  })
})
