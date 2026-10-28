/**
 * Instances rendered through the shared expanded view: slot content, nested instances, theme
 * pins, OKLCH / Display-P3 bound colors, the unresolved placeholder, picture reuse when an edit
 * does not touch an instance, and hit testing with composite ids.
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
import { CanvasKitRenderer, parseColor, type RenderScene, toHex } from "../src"
import { loadCanvasKit } from "../src/ck"
import { cardsDoc, INSTANCE_COLORS } from "./fixtures/instances"
import { near, pixelsOf } from "./helpers/golden"
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

function shot(l: Live): Uint8Array {
  r.setLayout(l.layout)
  r.attachRaster(760, 420, 1)
  r.setViewport({ x: 0, y: 0, zoom: 1 })
  r.setOverlay({ selection: [], hovered: null, marquee: null })
  const bytes = r.snapshot()
  r.detach()
  return bytes
}

const pixels = (bytes: Uint8Array) => pixelsOf(ck, bytes)

describe("expanded instances render through the shared view", () => {
  test("mains, instances, slot content, theme pin, placeholder", () => {
    const l = live(cardsDoc)
    expect(l.layout.issues.map((i) => `${i.nodeId}:${i.code}`)).toEqual([
      "missing01:INSTANCE_UNRESOLVED",
    ])
    const p = pixels(shot(l))
    const box = (id: string) => l.layout.nodes.get(id)?.world as { x: number; y: number }
    // Light instance: white surface; dark-pinned instance: `ink` OKLCH surface.
    const i1 = box("inst00001")
    expect(near(p.at(i1.x + 4, i1.y + 60), "#FFFFFF", 2)).toBe(true)
    const i2 = box("inst00002")
    const ink = toHex(parseColor(INSTANCE_COLORS.ink) as never)
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
    expect(
      near(p.at(btn.x + 3, btn.y + 14), toHex(parseColor(INSTANCE_COLORS.accent) as never), 2),
    ).toBe(true)
    const bar = box("inst00001/cardCta01/btnBar001")
    expect(
      near(p.at(bar.x + 20, bar.y + 3), toHex(parseColor(INSTANCE_COLORS.hot) as never), 2),
    ).toBe(true)
    // Nested override `cardCta01/btnBar001` widens the bar inside instance 2 only.
    expect(l.layout.nodes.get("inst00002/cardCta01/btnBar001")?.local.w).toBe(80)
    expect(l.layout.nodes.get("inst00001/cardCta01/btnBar001")?.local.w).toBe(40)
    // Placeholder sized by props (120 × 60).
    expect(l.layout.nodes.get("missing01")?.local).toMatchObject({ w: 120, h: 60 })
  })

  test("shared instance pictures draw exactly what per-root recording draws", () => {
    // Instances draw from one picture per distinct expanded content (perf); slot content,
    // nested instances, overrides, theme pins and bound colors must match recording every
    // instance into its own root picture, also after edits and at 2×. The shared picture is
    // recorded in the instance's local space, so an anti-aliased edge may differ by a
    // rounding step (≤ 2 / 255 per channel).
    const l = live(cardsDoc)
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

  test("editing a main re-records its instances; a plain edit re-records only its root", () => {
    const l = live(cardsDoc)
    shot(l)
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

describe("hit testing returns composite instance paths", () => {
  test("top-most first: instance child → instance; slot content keeps its real id", () => {
    const l = live(cardsDoc)
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
