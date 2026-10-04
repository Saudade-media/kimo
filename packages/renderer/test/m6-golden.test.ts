/**
 * M6 renderer goldens and measured checks (desing.pen board 22 D0zDSY, board 24 iLW1l, ADR
 * 0014): note and prompt cards (NoteNode afq5v, PromptNode poE5B) laid out by the real Yoga
 * engine, placeholder frames (EKCy7: 1.5 outline, shimmer, skeleton only while empty), the
 * clear flash, scope outlines (side by side / split), persona selections (GmEAl), the rejected
 * flash and the prompt connector. Every measured value is the design node's.
 */
import { beforeAll, describe, expect, test } from "bun:test"
import {
  createLayoutEngine,
  createResolver,
  type LayoutEngine,
  type LayoutResult,
  nodeSourceFromDocument,
} from "@kimo/layout"
import type { CanvasKit } from "canvaskit-wasm"
import {
  CanvasKitRenderer,
  connectorPoints,
  DEFAULT_AGENT_CANVAS_THEME,
  hasAgentOverlays,
  type Overlay,
  parseColor,
  type RenderScene,
  shimmerSpan,
  skeletonBars,
} from "../src"
import { loadCanvasKit } from "../src/ck"
import { compareGolden } from "./helpers/golden"

let ck: CanvasKit
const r = new CanvasKitRenderer()
let engine: LayoutEngine

beforeAll(async () => {
  await r.init({ offlineFonts: true })
  ck = await loadCanvasKit()
  engine = createLayoutEngine()
  await engine.init()
})

type N = Record<string, unknown>
let k = 0
const o = () => `a${String(k++).padStart(4, "0")}`

const T = DEFAULT_AGENT_CANVAS_THEME

/** cf2sC vignette layout: a note, a prompt targeting "Pricing", plus placeholders and scopes. */
const nodes: Record<string, N> = {
  paper0001: {
    type: "rect",
    parent: null,
    order: o(),
    x: 0,
    y: 0,
    w: 1100,
    h: 520,
    fill: "#F4F3F1",
  },
  note00001: {
    type: "note",
    parent: null,
    order: o(),
    x: 32,
    y: 40,
    author: "Gui",
    content: "Hero needs a warmer palette — think terracotta, not orange. Keep the CTA black.",
  },
  prompt001: {
    type: "prompt",
    parent: null,
    order: o(),
    x: 32,
    y: 220,
    content:
      "Draft 3 pricing cards (Free, Team, Business) inside Pricing. Use $brand tokens and the Card component.",
    model: { provider: "anthropic", model: "claude-opus-5-5" },
    target: "pricing01",
  },
  pricing01: {
    type: "frame",
    parent: null,
    order: o(),
    name: "Pricing — Desktop",
    x: 360,
    y: 52,
    w: 340,
    h: 230,
    fill: "#FFFFFF",
    layout: { dir: "column", gap: 14, pad: 22 },
  },
  ptitle001: {
    type: "rect",
    parent: "pricing01",
    order: o(),
    w: 160,
    h: 18,
    radius: 4,
    fill: "#1A1A1A",
  },
  // Placeholder frame, empty: outline + shimmer + skeleton (State 1, O0GeI 300×300).
  holder001: {
    type: "frame",
    parent: null,
    order: o(),
    x: 740,
    y: 52,
    w: 300,
    h: 300,
    radius: 6,
    fill: "#FFFFFF",
    placeholder: { by: "agent:kimo.s1.0", since: "2026-10-04T10:00:00.000Z" },
  },
  // Placeholder with children (State 2): no skeleton, content under the outline.
  holder002: {
    type: "frame",
    parent: null,
    order: o(),
    x: 740,
    y: 380,
    w: 300,
    h: 120,
    radius: 6,
    fill: "#FFFFFF",
    placeholder: { by: "agent:kimo.s1.1" },
    layout: { dir: "row", gap: 8, pad: 16 },
  },
  card00001: {
    type: "rect",
    parent: "holder002",
    order: o(),
    w: 80,
    h: 80,
    radius: 8,
    fill: "#F4F1EC",
  },
  // Split sections (flush scopes) inside a page.
  page00001: {
    type: "frame",
    parent: null,
    order: o(),
    x: 360,
    y: 320,
    w: 340,
    h: 180,
    fill: "#FFFFFF",
    layout: { dir: "column" },
  },
  nav000001: {
    type: "frame",
    parent: "page00001",
    order: o(),
    w: { mode: "fill" },
    h: 40,
    fill: "#FFFFFF",
  },
  hero00001: {
    type: "frame",
    parent: "page00001",
    order: o(),
    w: { mode: "fill" },
    h: 80,
    fill: "#F6EFE6",
  },
  feat00001: {
    type: "frame",
    parent: "page00001",
    order: o(),
    w: { mode: "fill" },
    h: 60,
    fill: "#FFFFFF",
  },
  head00001: {
    type: "rect",
    parent: "hero00001",
    order: o(),
    x: 24,
    y: 20,
    w: 160,
    h: 24,
    fill: "#1A1A1A",
  },
}

function live(overlayDoc = nodes): { scene: RenderScene; layout: LayoutResult } {
  const src = nodeSourceFromDocument({ nodes: overlayDoc } as never)
  const header = {}
  const resolve = createResolver(header, src)
  const scene: RenderScene = {
    nodes: src,
    header,
    resolve,
    assets: { load: async () => null },
    labels: {
      promptModel: (m) =>
        typeof m === "object" && m !== null && (m as { model?: string }).model === "claude-opus-5-5"
          ? "Opus 5.5"
          : String(m),
    },
  }
  r.setDocument(scene)
  const layout = engine.compute({ nodes: src, resolve, measureText: r.textMeasurer() })
  r.setLayout(layout)
  return { scene, layout }
}

const OVERLAY: Overlay = {
  selection: [],
  hovered: null,
  marquee: null,
  placeholders: [
    { id: "holder001", state: "building", skeleton: true },
    { id: "holder002", state: "building", skeleton: false, persona: "violet" },
  ],
  shimmerPhase: null,
  scopes: [
    { id: "pricing01", fit: "outset" },
    { id: "hero00001", fit: "flush", persona: "iris" },
    { id: "feat00001", fit: "flush", persona: "violet" },
  ],
  agentSelections: [{ id: "head00001", persona: "iris" }],
  rejected: ["nav000001"],
  promptConnectors: [{ prompt: "prompt001", target: "pricing01" }],
}

function pixels(bytes: Uint8Array) {
  const img = ck.MakeImageFromEncoded(bytes)
  if (!img) throw new Error("png")
  const w = img.width()
  const px = img.readPixels(0, 0, {
    width: w,
    height: img.height(),
    colorType: ck.ColorType.RGBA_8888,
    alphaType: ck.AlphaType.Unpremul,
    colorSpace: ck.ColorSpace.SRGB,
  }) as Uint8Array
  img.delete()
  return (x: number, y: number) => {
    const i = (Math.round(y) * w + Math.round(x)) * 4
    return [px[i], px[i + 1], px[i + 2], px[i + 3]] as number[]
  }
}

const rgb = (hex: string) => {
  const c = parseColor(hex) as unknown as number[]
  return [0, 1, 2].map((i) => Math.round((c[i] as number) * 255))
}
const near = (a: number[], hex: string, tol = 12) =>
  rgb(hex).every((v, i) => Math.abs(v - (a[i] as number)) <= tol)

describe("M6 cards (layout + paint)", () => {
  test("note and prompt boxes follow the design chrome", () => {
    const { layout } = live()
    const note = layout.nodes.get("note00001")
    const prompt = layout.nodes.get("prompt001")
    // NoteNode afq5v: 220 wide; prompt poE5B: 300 wide.
    expect(note?.local.w).toBe(220)
    expect(prompt?.local.w).toBe(300)
    // Body lines: 12 × 1.45 (note), 12 × 1.5 (prompt); chrome 33 + 14 / 38 + 20 + 42.
    // Same copy as the design nodes → the design's measured boxes: afq5v 220 × 98, poE5B
    // 300 × 154 (three body lines each: 3 × 17 / 3 × 18).
    expect(note?.local.h).toBe(98)
    expect(prompt?.local.h).toBe(154)
    expect(note?.text?.h).toBe(51)
    expect(prompt?.text?.h).toBe(54)
  })

  test("note / prompt card pixels (exportRaster at scale 1)", async () => {
    live()
    const note = pixels(await r.exportRaster("note00001"))
    // Fill `note`, edge `note-edge` (1 px inside), author text row at y 12..25.
    expect(near(note(110, 30), T.note, 3)).toBe(true)
    expect(near(note(110, 0), T.noteEdge, 24)).toBe(true)
    const prompt = pixels(await r.exportRaster("prompt001"))
    // Head divider: 1 px `border` at y 37; footer `bg-subtle` from h − 42; body `bg-app`.
    expect(near(prompt(150, 37), T.border, 4)).toBe(true)
    expect(near(prompt(150, 45), T.bgApp, 2)).toBe(true)
    // Model pill (bg-muted) 8 from the right edge, 22 tall at y 8: sample inside it.
    expect(near(prompt(300 - 8 - 3, 19), T.bgMuted, 4)).toBe(true)
  })

  test("a parent export skips notes and prompts (spec §5.5)", async () => {
    const doc = {
      ...nodes,
      board0001: {
        type: "frame",
        parent: null,
        order: "z",
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
    live(doc as never)
    const p = pixels(await r.exportRaster("board0001"))
    expect(near(p(100, 40), "#FFFFFF", 1)).toBe(true)
    // The note itself still exports when it is the root.
    const n = pixels(await r.exportRaster("inner0001"))
    expect(near(n(110, 40), T.note, 3)).toBe(true)
  })
})

describe("M6 overlays (attachRaster)", () => {
  test("golden: cards, placeholders, scopes, persona selection, rejected, connector", async () => {
    live()
    // Warm the chrome glyphs (export waits for icons) so the frame draws them.
    await r.exportRaster("note00001")
    await r.exportRaster("prompt001")
    r.attachRaster(1100, 520, 1)
    r.setViewport({ x: 0, y: 0, zoom: 1 })
    r.setOverlay(OVERLAY)
    const bytes = r.snapshot()
    const res = compareGolden(ck, "m6-agent-canvas", bytes)
    expect(res.message && res.ok).toBe(true)
    const px = pixels(bytes)
    // Placeholder outline: 1.5 `agent`, inside the frame edge (holder001 at 740,52).
    expect(near(px(890, 52), T.agent, 40)).toBe(true)
    // Skeleton Bar · title: frame-local (16, 52) 140×14 `agent-soft` (+ the centered shimmer).
    expect(near(px(740 + 16 + 4, 52 + 52 + 7), T.agentSoft, 24)).toBe(true)
    // No skeleton in a placeholder with children (holder002): its first child is drawn.
    expect(near(px(740 + 16 + 40, 380 + 16 + 40), "#F4F1EC", 12)).toBe(true)
    // Persona placeholder outline in `agent-violet`.
    expect(near(px(890, 380), T.violet, 40)).toBe(true)
    // Outset scope: outer edge 3 px outside Pricing (360,52): x 357..358.5 is `agent`.
    expect(near(px(357, 160), T.agent, 50)).toBe(true)
    // Flush split scope (hero, iris) on the section's own left edge.
    expect(near(px(360, 400), T.iris, 50)).toBe(true)
    // Agent selection 2 px outside head00001 (384, 380): x 382..383.5 `agent-iris`.
    expect(near(px(382, 392), T.iris, 50)).toBe(true)
    // Rejected flash: 1.5 `danger` inside the nav (360, 320, 340 × 40).
    expect(near(px(500, 320), T.danger, 50)).toBe(true)
    // Connector: prompt right edge (332) → Pricing left edge (360), 7 px dot centered on the
    // edge at the middle of the vertical overlap.
    const cy = connectorY()
    expect(cy).toBe(251)
    expect(near(px(358, cy), T.agent, 30)).toBe(true)
    expect(near(px(346, cy), T.agent, 80)).toBe(true)
    r.detach()
  })

  test("the shimmer moves with the phase and only touches the placeholder", () => {
    live()
    r.attachRaster(1100, 520, 1)
    r.setViewport({ x: 0, y: 0, zoom: 1 })
    const at = (phase: number | null) => {
      r.setOverlay({
        selection: [],
        hovered: null,
        marquee: null,
        placeholders: [{ id: "holder001", state: "building", skeleton: false }],
        shimmerPhase: phase,
      })
      return pixels(r.snapshot())
    }
    const still = at(null)
    const early = at(0)
    // Centered band: the frame center is tinted; at phase 0 the band sits before the box.
    expect(near(still(890, 202), "#FFFFFF", 4)).toBe(false)
    expect(near(early(890, 202), "#FFFFFF", 1)).toBe(true)
    // Interrupted placeholders do not shimmer.
    r.setOverlay({
      selection: [],
      hovered: null,
      marquee: null,
      placeholders: [{ id: "holder001", state: "interrupted", skeleton: false }],
      shimmerPhase: null,
    })
    expect(near(pixels(r.snapshot())(890, 202), "#FFFFFF", 1)).toBe(true)
    r.detach()
  })

  test("clear flash: 3 px soft ring fading over the progress", () => {
    live()
    r.attachRaster(1100, 520, 1)
    r.setViewport({ x: 0, y: 0, zoom: 1 })
    r.setOverlay({
      selection: [],
      hovered: null,
      marquee: null,
      placeholderFlashes: [{ id: "holder001", progress: 0.5 }],
    })
    const p = pixels(r.snapshot())
    // Ring at 2 px inside the edge, half-faded `agent-soft` over white.
    expect(near(p(890, 54), "#FFFFFF", 1)).toBe(false)
    r.setOverlay({
      selection: [],
      hovered: null,
      marquee: null,
      placeholderFlashes: [{ id: "holder001", progress: 1 }],
    })
    expect(near(pixels(r.snapshot())(890, 54), "#FFFFFF", 1)).toBe(true)
    r.detach()
  })
})

/** Vertical position of the prompt → Pricing connector (middle of their vertical overlap). */
function connectorY(): number {
  const { layout } = live()
  const a = layout.nodes.get("prompt001")?.world
  const b = layout.nodes.get("pricing01")?.world
  if (!a || !b) return 0
  return connectorPoints(a, b)?.from.y ?? 0
}

describe("M6 overlay helpers", () => {
  test("hasAgentOverlays", () => {
    expect(hasAgentOverlays({ selection: [], hovered: null, marquee: null })).toBe(false)
    expect(hasAgentOverlays({ selection: [], hovered: null, marquee: null, rejected: ["a"] })).toBe(
      true,
    )
  })

  test("skeleton bars of EKCy7 (280 × 200)", () => {
    const bars = skeletonBars(280, 200)
    expect(bars[0]).toEqual({ x: 16, y: 52, w: 140, h: 14, r: 4 })
    expect(bars[1]).toEqual({ x: 16, y: 74, w: 248, h: 8, r: 4 })
    expect(bars[2]).toEqual({ x: 16, y: 90, w: 180, h: 8, r: 4 })
    // Blocks: y 106 + 6 → 184 (h − 16), three equal widths with gap 8.
    expect(bars.slice(3).map((b) => [b.x, b.y, b.w, b.h, b.r])).toEqual([
      [16, 112, 232 / 3, 72, 6],
      [16 + 232 / 3 + 8, 112, 232 / 3, 72, 6],
      [16 + (2 * 232) / 3 + 16, 112, 232 / 3, 72, 6],
    ])
    // A short frame drops what does not fit.
    expect(skeletonBars(280, 90).length).toBe(1)
  })

  test("shimmer span: centered when still, sweeping from before to past the box", () => {
    const box = { x: 0, y: 0, w: 100, h: 100 }
    const c = shimmerSpan(box, null)
    expect((c.from.x + c.to.x) / 2).toBeCloseTo(50, 6)
    expect((c.from.y + c.to.y) / 2).toBeCloseTo(50, 6)
    const s0 = shimmerSpan(box, 0)
    const s1 = shimmerSpan(box, 1)
    // Direction: up-right (rotation −60 = 60° clockwise from up).
    expect(s1.to.x).toBeGreaterThan(s0.to.x)
    expect(s1.to.y).toBeLessThan(s0.to.y)
  })

  test("connector points", () => {
    // cf2sC: prompt 32,220 300×156 → frame 360,52 340×230: horizontal at the overlap middle.
    expect(
      connectorPoints({ x: 32, y: 220, w: 300, h: 156 }, { x: 360, y: 52, w: 340, h: 230 }),
    ).toEqual({
      from: { x: 332, y: 251 },
      to: { x: 360, y: 251 },
    })
    // Stacked: vertical between facing edges.
    expect(
      connectorPoints({ x: 0, y: 0, w: 100, h: 50 }, { x: 20, y: 100, w: 100, h: 50 }),
    ).toEqual({
      from: { x: 60, y: 50 },
      to: { x: 60, y: 100 },
    })
    expect(
      connectorPoints({ x: 0, y: 0, w: 100, h: 100 }, { x: 50, y: 50, w: 10, h: 10 }),
    ).toBeNull()
  })
})
