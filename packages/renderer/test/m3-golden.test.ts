/**
 * M3 renderer goldens and measured checks (ADR 0011): expanded instances drawn through the
 * shared view (slot content, nested instances, theme pins, OKLCH / Display-P3 bound colors,
 * unresolved placeholder), the component overlays of desing.pen 02c `SD9TU` / board 11 / 12 /
 * 13 measured against the node values, hit testing with composite ids, and picture reuse when
 * an edit does not touch an instance.
 */
import { beforeAll, describe, expect, test } from "bun:test"
import {
  createInstanceView,
  createLayoutEngine,
  createResolver,
  type InstanceView,
  type LayoutEngine,
  type LayoutResult,
  type NodeSource,
  nodeSourceFromDocument,
} from "@kimo/layout"
import type { CanvasKit } from "canvaskit-wasm"
import { CanvasKitRenderer, type Overlay, parseColor, type RenderScene, toHex } from "../src"
import { loadCanvasKit } from "../src/ck"
import { M3_COLORS, m3Doc } from "./fixtures/m3"
import { compareGolden } from "./helpers/golden"
import type { TestDoc } from "./helpers/scene"

let ck: CanvasKit
const r = new CanvasKitRenderer()
let engine: LayoutEngine

beforeAll(async () => {
  await r.init({ offlineFonts: true })
  ck = await loadCanvasKit()
  engine = createLayoutEngine()
  await engine.init()
})

interface Live {
  view: InstanceView
  scene: RenderScene
  layout: LayoutResult
  set(id: string, patch: Record<string, unknown> | null): LayoutResult
}

/** The web host's wiring: store → shared view → resolver/layout/renderer. */
function live(doc: TestDoc): Live {
  let table = { ...doc.nodes }
  let src: NodeSource = nodeSourceFromDocument({ nodes: table } as never)
  const store: NodeSource = {
    getNode: (id) => src.getNode(id),
    children: (p, at) => src.children(p, at),
  }
  const header = { variables: doc.variables, themes: doc.themes, imports: doc.imports }
  const view = createInstanceView(store, { header: () => header as never })
  const resolve = createResolver(header, view)
  const scene: RenderScene = { nodes: view, header, resolve, assets: { load: async () => null } }
  const input = () => ({ nodes: store, expanded: view, resolve, measureText: r.textMeasurer() })
  r.setDocument(scene)
  const l: Live = {
    view,
    scene,
    layout: engine.compute(input()),
    set(id, patch) {
      table = { ...table }
      if (patch === null) delete table[id]
      else table[id] = { ...(table[id] ?? {}), ...patch }
      src = nodeSourceFromDocument({ nodes: table } as never)
      resolve.invalidate()
      l.layout = engine.update(input(), { nodes: [id] })
      r.invalidate([id])
      r.setLayout(l.layout)
      return l.layout
    },
  }
  r.setLayout(l.layout)
  return l
}

function pixels(bytes: Uint8Array) {
  const img = ck.MakeImageFromEncoded(bytes)
  if (!img) throw new Error("png")
  const w = img.width()
  const h = img.height()
  const px = img.readPixels(0, 0, {
    width: w,
    height: h,
    colorType: ck.ColorType.RGBA_8888,
    alphaType: ck.AlphaType.Unpremul,
    colorSpace: ck.ColorSpace.SRGB,
  }) as Uint8Array
  img.delete()
  const at = (x: number, y: number): [number, number, number, number] => {
    const i = (y * w + x) * 4
    return [px[i] ?? 0, px[i + 1] ?? 0, px[i + 2] ?? 0, px[i + 3] ?? 0]
  }
  return { w, h, at }
}

const rgb = (hex: string) => {
  const n = Number.parseInt(hex.slice(1, 7), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const near = (a: readonly number[], hex: string, tol = 12) =>
  rgb(hex).every((v, i) => Math.abs(v - (a[i] ?? 0)) <= tol)

const VIOLET = "#7C3AED"

function shot(l: Live, overlay: Partial<Overlay>): Uint8Array {
  r.setLayout(l.layout)
  r.attachRaster(760, 420, 1)
  r.setViewport({ x: 0, y: 0, zoom: 1 })
  r.setOverlay({ selection: [], hovered: null, marquee: null, ...overlay })
  const bytes = r.snapshot()
  r.detach()
  return bytes
}

function golden(name: string, bytes: Uint8Array) {
  const res = compareGolden(ck, name, bytes)
  expect(res.message && res.ok).toBe(true)
}

describe("expanded instances render through the shared view", () => {
  test("mains, instances, slot content, theme pin, placeholder (golden + measured)", () => {
    const l = live(m3Doc)
    expect(l.layout.issues.map((i) => `${i.nodeId}:${i.code}`)).toEqual([
      "missing01:INSTANCE_UNRESOLVED",
    ])
    const bytes = shot(l, {})
    golden("m3-instances", bytes)
    const p = pixels(bytes)
    const box = (id: string) => l.layout.nodes.get(id)?.world as { x: number; y: number }
    // Light instance: white surface; dark-pinned instance: `ink` OKLCH surface.
    const i1 = box("inst00001")
    expect(near(p.at(i1.x + 4, i1.y + 60), "#FFFFFF", 2)).toBe(true)
    const i2 = box("inst00002")
    const ink = toHex(parseColor(M3_COLORS.ink) as never)
    expect(near(p.at(i2.x + 4, i2.y + 60), ink, 2)).toBe(true)
    // Its text-ish title bar flips with the pin (ink-text dark = #F5EEE6).
    const t2 = box("inst00002/cardTitl1")
    expect(near(p.at(t2.x + 5, t2.y + 5), "#F5EEE6", 2)).toBe(true)
    // Slot content (real owned nodes) replaces the placeholder child.
    const s = box("slotA0001")
    expect(near(p.at(s.x + 5, s.y + 5), "#A78BFA", 2)).toBe(true)
    expect(l.layout.nodes.has("inst00002/cardPh001")).toBe(false)
    // Display-P3 accent and out-of-gamut OKLCH are gamut-mapped to sRGB.
    const btn = box("inst00001/cardCta01")
    expect(near(p.at(btn.x + 3, btn.y + 14), toHex(parseColor(M3_COLORS.accent) as never), 2)).toBe(
      true,
    )
    const bar = box("inst00001/cardCta01/btnBar001")
    expect(near(p.at(bar.x + 20, bar.y + 3), toHex(parseColor(M3_COLORS.hot) as never), 2)).toBe(
      true,
    )
    // Nested override `cardCta01/btnBar001` widens the bar inside instance 2 only.
    expect(l.layout.nodes.get("inst00002/cardCta01/btnBar001")?.local.w).toBe(80)
    expect(l.layout.nodes.get("inst00001/cardCta01/btnBar001")?.local.w).toBe(40)
    // Placeholder sized by props (120 × 60).
    expect(l.layout.nodes.get("missing01")?.local).toMatchObject({ w: 120, h: 60 })
  })

  test("shared instance pictures draw exactly what per-root recording draws", () => {
    // Instances draw from one picture per distinct expanded content (perf); slot content,
    // nested instances, overrides, theme pins and bound colors must match recording every
    // instance into its own root picture — also after edits and at 2×. The shared picture is
    // recorded in the instance's local space, so an anti-aliased edge may differ by a
    // rounding step (≤ 2 / 255 per channel).
    const l = live(m3Doc)
    const both = () => {
      const out: Uint8Array[] = []
      for (const shared of [true, false]) {
        r.sharedInstances = shared
        // Hard reset: no picture recorded under the other mode survives.
        r.setDocument(l.scene)
        r.setLayout(l.layout)
        r.attachRaster(760, 420, 1)
        for (const zoom of [1, 2]) {
          r.setViewport({ x: zoom === 1 ? 0 : 200, y: zoom === 1 ? 0 : 60, zoom })
          r.setOverlay({ selection: [], hovered: null, marquee: null })
          out.push(r.snapshot())
        }
        r.detach()
      }
      r.sharedInstances = true
      return out
    }
    const same = () => {
      const [a1, a2, b1, b2] = both().map(pixels)
      for (const [a, b] of [
        [a1, b1],
        [a2, b2],
      ] as const)
        for (let y = 0; y < (a?.h ?? 0); y += 1)
          for (let x = 0; x < (a?.w ?? 0); x += 1) {
            const pa = a?.at(x, y)
            const pb = b?.at(x, y)
            for (let k = 0; k < 4; k++)
              if (Math.abs((pa?.[k] ?? 0) - (pb?.[k] ?? 0)) > 2)
                throw new Error(`pixel ${x},${y}: ${pa} vs ${pb}`)
          }
    }
    same()
    l.set("cardTitl1", { w: 60 })
    same()
    l.set("inst00001", { theme: { mode: "dark" } })
    same()
    l.set("inst00001", { props: { rotation: 15 } })
    same()
    // A main edit an override hides in one instance (patched expansions).
    l.set("btnBar001", { w: 10 })
    same()
  })

  test("editing a main re-renders every instance (and only the edit redraws otherwise)", () => {
    const l = live(m3Doc)
    shot(l, {})
    // Plain edit: only the paper root is re-recorded.
    l.set("paper0001", { fill: "#F5F5F4" })
    r.attachRaster(760, 420, 1)
    r.setOverlay({ selection: [], hovered: null, marquee: null })
    r.render()
    expect(r.stats().recorded).toBe(1)
    // Main edit: the main is re-recorded and its three instances re-attach to shared pictures
    // (one recording per distinct expanded content; the button main is untouched).
    l.set("cardTitl1", { w: 60 })
    r.render()
    let st = r.stats()
    expect(st.wrapped).toBe(3)
    expect(st.recorded).toBe(1 + (st.sharedRecorded ?? 0))
    expect(st.sharedRecorded).toBeGreaterThanOrEqual(1)
    expect(st.sharedRecorded).toBeLessThanOrEqual(3)
    for (const id of ["inst00001/cardTitl1", "inst00002/cardTitl1", "inst00003/cardTitl1"])
      expect(l.layout.nodes.get(id)?.local.w).toBe(60)
    // Button main edit: every card holds a button → the card main and the button main are
    // re-recorded. Instances 1 and 3 re-attach; instance 2 overrides the bar's width (80), so
    // its expanded content is unchanged (patched in place, same node objects) and it keeps
    // its picture.
    l.set("btnBar001", { w: 10 })
    r.render()
    st = r.stats()
    expect(st.wrapped).toBe(2)
    expect(st.recorded).toBe(2 + (st.sharedRecorded ?? 0))
    expect(l.layout.nodes.get("inst00002/cardCta01/btnBar001")?.local.w).toBe(80)
    expect(l.layout.nodes.get("inst00001/cardCta01/btnBar001")?.local.w).toBe(10)
    r.detach()
  })
})

describe("M3 overlays (02c SD9TU, boards 11 / 12 / 13)", () => {
  const overlay: Partial<Overlay> = {
    selection: ["inst00002"],
    selectionTone: "component",
    sizeLabel: "200 × 128",
    componentOutlines: [
      { id: "card00001", role: "main" },
      { id: "inst00001", role: "instance" },
      { id: "inst00002/cardBody1", role: "slot" },
      { id: "inst00003/cardBody1", role: "slot", empty: true },
    ],
    instanceDrop: { kind: "replace", targetId: "inst00001/cardTitl1" },
  }

  test("golden", () => {
    golden("m3-overlays", shot(live(m3Doc), overlay))
  })

  test("main 1.5 / instance 1 inside outlines in `component`", () => {
    const l = live(m3Doc)
    const p = pixels(shot(l, overlay))
    // Main card at x 20…220: column 20 is fully violet, column 21 half covered (1.5 inside).
    expect(near(p.at(20, 120), VIOLET)).toBe(true)
    const half = p.at(21, 120)
    expect(near(half, VIOLET)).toBe(false)
    expect(near(p.at(22, 120), "#FFFFFF", 2)).toBe(true)
    // Instance 1 at x 260: one violet column, the next is the card fill.
    expect(near(p.at(260, 120), VIOLET)).toBe(true)
    expect(near(p.at(261, 120), "#FFFFFF", 2)).toBe(true)
  })

  test("slot: 1px dashed 4/3 at (−4, +2) +8 wide, soft fill only when empty", () => {
    const l = live(m3Doc)
    const p = pixels(shot(l, overlay))
    const b = l.layout.nodes.get("inst00003/cardBody1")?.world as { x: number; y: number }
    const x0 = b.x - 4
    const y0 = b.y + 2
    // Top edge row: dash 4 on, 3 off (path M0.5 0.5l4 0m3 0…: each dash spans x 0.5…4.5, drawn
    // crisp as the 4 pixels whose centers it covers, the same ink centroid as the design).
    const row = [...Array(15).keys()].map((i) => near(p.at(x0 + i, y0), VIOLET, 40))
    // biome-ignore format: dash pattern
    expect(row).toEqual([false, true, true, true, true, false, false, false, true, true, true, true, false, false, false])
    // Empty slot: `component-soft` (#7C3AED14 over white) inside.
    const inside = p.at(x0 + 20, y0 + 10)
    expect(near(inside, toHex([0.9686, 0.953, 0.996, 1] as never), 4)).toBe(true)
    // Filled slot (instance 2): no soft fill outside its content.
    const f = l.layout.nodes.get("inst00002/cardBody1")?.world as { x: number; y: number }
    expect(near(p.at(f.x - 2, f.y + 20), "#2A1E14", 30) || p.at(f.x - 2, f.y + 20)[0] < 80).toBe(
      true,
    )
  })

  test("component selection tone: outline, handles and size badge are violet", () => {
    const l = live(m3Doc)
    const p = pixels(shot(l, overlay))
    const b = l.layout.nodes.get("inst00002")?.world as {
      x: number
      y: number
      w: number
      h: number
    }
    expect(near(p.at(b.x + 100, b.y), VIOLET)).toBe(true)
    // Handle ring (8×8, stroke 1.5) centered on the top-right corner.
    expect(near(p.at(b.x + b.w + 3, b.y - 1), VIOLET, 4)).toBe(true)
    // Size badge 8 below, violet fill.
    expect(near(p.at(b.x + b.w / 2 - 30, b.y + b.h + 12), VIOLET, 20)).toBe(true)
  })

  test("drop feedback: replace target (outset 2, 1.5 stroke) and slot insertion bar (2 high)", () => {
    const l = live(m3Doc)
    let p = pixels(shot(l, overlay))
    const t = l.layout.nodes.get("inst00001/cardTitl1")?.world as { x: number; y: number }
    expect(near(p.at(t.x - 2, t.y + 6), VIOLET, 30)).toBe(true)
    expect(near(p.at(t.x - 3, t.y + 6), "#FFFFFF", 4)).toBe(true)
    const s = l.layout.nodes.get("slotB0001")?.world as { x: number; y: number; h: number }
    p = pixels(
      shot(l, {
        instanceDrop: {
          kind: "slot",
          slotId: "inst00002/cardBody1",
          bar: { x: s.x, y: s.y + s.h + 4, w: 176 },
        },
      }),
    )
    const y = s.y + s.h + 4
    expect(near(p.at(s.x + 50, y), VIOLET, 10)).toBe(true)
    expect(near(p.at(s.x + 50, y + 1), VIOLET, 10)).toBe(true)
    expect(near(p.at(s.x + 50, y + 2), VIOLET, 60)).toBe(false)
  })

  test("hover over a main/instance listed in componentOutlines draws no blue outline", () => {
    const l = live(m3Doc)
    const p = pixels(
      shot(l, { hovered: "inst00001", componentOutlines: [{ id: "inst00001", role: "instance" }] }),
    )
    expect(near(p.at(260, 120), VIOLET)).toBe(true)
    expect(near(p.at(261, 120), "#2F6BFF", 60)).toBe(false)
  })
})

describe("hit testing returns composite instance paths", () => {
  test("top-most first: instance child → instance; slot content keeps its real id", () => {
    const l = live(m3Doc)
    r.attachRaster(760, 420, 1)
    r.setViewport({ x: 0, y: 0, zoom: 1 })
    const at = (id: string, dx = 3, dy = 3) => {
      const b = l.layout.nodes.get(id)?.world as { x: number; y: number }
      return r.hitTest({ x: b.x + dx, y: b.y + dy })
    }
    expect(at("inst00001/cardCta01/btnDot001", 4, 4)).toEqual([
      "inst00001/cardCta01/btnDot001",
      "inst00001/cardCta01",
      "inst00001",
      "paper0001",
    ])
    expect(at("slotA0001")).toEqual(["slotA0001", "inst00002/cardBody1", "inst00002", "paper0001"])
    expect(at("missing01", 10, 10)).toEqual(["missing01", "paper0001"])
    const hits = r.hitTestRect({ x: 255, y: 75, w: 210, h: 105 }, { mode: "contain" })
    expect(hits).toContain("inst00001/cardTitl1")
    expect(hits).toContain("inst00001")
    expect(l.view.locate("inst00001/cardCta01/btnDot001")).toEqual({
      real: "inst00001",
      instance: "inst00001",
      path: "cardCta01/btnDot001",
    })
    r.detach()
  })
})
