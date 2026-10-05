/**
 * Board 35 "Agent build motion" (IASl0): the scheduler that picks which new layers animate and
 * how (origins, stagger, reflow, large batches, reduced motion), against the board's values.
 */
import { describe, expect, test } from "bun:test"
import type { LayoutResult, NodeLayout, Rect } from "@kimo/layout"
import {
  animatesChange,
  BUILD_MOTION,
  BuildMotion,
  buildEase,
  staggerFor,
} from "../src/canvas/agent-motion"

type N = { parent: string | null; type: string }

function layoutOf(boxes: Record<string, Rect>, changed: string[] = []): LayoutResult {
  const nodes = new Map<string, NodeLayout>()
  for (const [id, r] of Object.entries(boxes))
    nodes.set(id, {
      id,
      local: { x: 0, y: 0, w: r.w, h: r.h },
      world: r,
      transform: [1, 0, 0, 1, r.x, r.y],
      visible: true,
    } as NodeLayout)
  return {
    version: 1,
    nodes,
    order: Object.keys(boxes),
    bounds: null,
    issues: [],
    changed: new Set(changed),
  }
}

function setup(doc: Record<string, N>, opts: { reduced?: boolean } = {}) {
  let t = 1000
  const m = new BuildMotion(
    { getNode: (id) => doc[id] },
    () => opts.reduced ?? false,
    () => t,
  )
  return {
    m,
    at: (ms: number) => {
      t = 1000 + ms
    },
  }
}

const page = { x: 0, y: 0, w: 220, h: 164 }
const box = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h })

describe("board 35 origins (rule Who animates)", () => {
  test("agent and MCP edits animate, also relayed by the document host", () => {
    expect(animatesChange("agent:kimo.s1.0", "ops")).toBe(true)
    expect(animatesChange("mcp:claude-code.k3", "ops")).toBe(true)
    expect(animatesChange("remote:agent:kimo.s1.0", "update")).toBe(true)
    expect(animatesChange("remote:mcp:cursor.a1", "update")).toBe(true)
  })
  test("user edits, undo / redo, collaborators, files and repairs never do", () => {
    expect(animatesChange("user", "ops")).toBe(false)
    expect(animatesChange("agent:kimo.s1.0", "undo")).toBe(false)
    expect(animatesChange("mcp:claude-code.k3", "redo")).toBe(false)
    expect(animatesChange("remote", "update")).toBe(false)
    expect(animatesChange("remote:user", "update")).toBe(false)
    expect(animatesChange("file", "load")).toBe(false)
    expect(animatesChange("system", "repair")).toBe(false)
  })
})

describe("board 35 entrance (keyframes mvNij)", () => {
  const doc: Record<string, N> = {
    page: { parent: null, type: "frame" },
    card: { parent: "page", type: "frame" },
  }
  const before = layoutOf({ page })
  const after = layoutOf({ page, card: box(36, 36, 160, 96) })

  test("eases opacity 0 → 1, scale 0.96 → 1 and rise 6 → 0 over 200 ms", () => {
    const { m, at } = setup(doc)
    m.noteChange({ origin: "mcp:x.1", cause: "ops", nodes: ["card"] }, (id) => before.nodes.has(id))
    m.afterLayout(before, after)
    const f0 = m.frame(after)?.get("card")
    expect(f0).toEqual({ opacity: 0, scale: 0.96, dy: 6 })
    at(40)
    const f40 = m.frame(after)?.get("card")
    expect(f40?.opacity).toBeCloseTo(0.5, 2)
    expect(f40?.scale).toBeCloseTo(0.98, 3)
    expect(f40?.dy).toBeCloseTo(3, 1)
    at(80)
    expect(m.frame(after)?.get("card")?.opacity).toBeCloseTo(0.8, 2)
    at(120)
    expect(m.frame(after)?.get("card")?.opacity).toBeCloseTo(0.93, 2)
    expect(m.animating()).toBe(true)
    at(200)
    expect(m.frame(after)).toBeNull()
    expect(m.animating()).toBe(false)
  })

  test("the easing is cubic-bezier(0.2, 0, 0, 1)", () => {
    expect(BUILD_MOTION.ease).toEqual([0.2, 0, 0, 1])
    expect(buildEase(0)).toBe(0)
    expect(buildEase(1)).toBe(1)
    expect(buildEase(0.5)).toBeCloseTo(0.878, 3)
  })

  test("user edits, undo and reduced motion draw the final state at once", () => {
    for (const [origin, cause] of [
      ["user", "ops"],
      ["agent:kimo.s.0", "undo"],
      ["remote:peer", "update"],
    ] as const) {
      const { m } = setup(doc)
      m.noteChange({ origin, cause, nodes: ["card"] }, (id) => before.nodes.has(id))
      m.afterLayout(before, after)
      expect(m.frame(after)).toBeNull()
    }
    const r = setup(doc, { reduced: true })
    r.m.noteChange({ origin: "agent:k.s.0", cause: "ops", nodes: ["card"] }, () => false)
    r.m.afterLayout(before, after)
    expect(r.m.frame(after)).toBeNull()
  })

  test("a layer the canvas has shown before never animates (redo through the host)", () => {
    const { m } = setup(doc)
    // Shown, then removed by an undo relayed as an update, then brought back.
    m.noteChange({ origin: "agent:k.s.0", cause: "ops", nodes: ["card"] }, () => true)
    m.noteChange({ origin: "remote:agent:k.s.0", cause: "update", nodes: ["card"] }, () => false)
    m.afterLayout(before, after)
    expect(m.frame(after)).toBeNull()
  })

  test("your own edit ends a running animation", () => {
    const { m, at } = setup(doc)
    m.noteChange({ origin: "agent:k.s.0", cause: "ops", nodes: ["card"] }, () => false)
    m.afterLayout(before, after)
    at(40)
    expect(m.frame(after)).not.toBeNull()
    m.noteChange({ origin: "user", cause: "ops", nodes: ["page"] }, () => true)
    expect(m.frame(after)).toBeNull()
  })
})

describe("board 35 sibling reflow (V2Bfh0)", () => {
  // Page (auto layout, gap 8, padding 12): Hero, Features, [Pricing new], Footer.
  const doc: Record<string, N> = {
    page: { parent: null, type: "frame" },
    hero: { parent: "page", type: "frame" },
    features: { parent: "page", type: "frame" },
    pricing: { parent: "page", type: "frame" },
    footer: { parent: "page", type: "frame" },
    footerText: { parent: "footer", type: "text" },
  }
  const before = layoutOf({
    page,
    hero: box(12, 12, 196, 56),
    features: box(12, 76, 196, 40),
    footer: box(12, 124, 196, 28),
    footerText: box(22, 130, 60, 16),
  })
  const after = layoutOf(
    {
      page: box(0, 0, 220, 220),
      hero: box(12, 12, 196, 56),
      features: box(12, 76, 196, 40),
      pricing: box(12, 124, 196, 48),
      footer: box(12, 180, 196, 28),
      footerText: box(22, 186, 60, 16),
    },
    ["page", "pricing", "footer", "footerText"],
  )

  test("siblings slide and the parent grows over the same 200 ms; children ride along", () => {
    const { m, at } = setup(doc)
    m.noteChange({ origin: "agent:k.s.0", cause: "ops", nodes: ["pricing", "page"] }, (id) =>
      before.nodes.has(id),
    )
    m.afterLayout(before, after)
    const f0 = m.frame(after)
    expect(f0?.get("footer")).toEqual({ dy: -56 })
    expect(f0?.get("page")).toEqual({ w: 220, h: 164 })
    // The footer's text moves with the footer: no motion of its own.
    expect(f0?.has("footerText")).toBe(false)
    expect(f0?.has("hero")).toBe(false)
    at(80)
    const f80 = m.frame(after)
    // Board: Footer drawn at y 168.8 (124 → 180, eased 0.80), Page h 208.8.
    const k = buildEase(80 / 200)
    expect(12 + 180 + (f80?.get("footer")?.dy ?? 0) - 12).toBeCloseTo(124 + 56 * k, 5)
    expect(f80?.get("page")?.h).toBeCloseTo(164 + 56 * k, 5)
    expect(168.8).toBeCloseTo(124 + 56 * 0.8, 5)
    at(200)
    expect(m.frame(after)).toBeNull()
  })

  test("a batch landing mid-slide starts from where the sibling is drawn", () => {
    const { m, at } = setup(doc)
    m.noteChange({ origin: "agent:k.s.0", cause: "ops", nodes: ["pricing"] }, (id) =>
      before.nodes.has(id),
    )
    m.afterLayout(before, after)
    at(80)
    const k = buildEase(0.4)
    const drawnY = 124 + 56 * k
    // Another layer pushes the footer 20 further.
    doc.extra = { parent: "page", type: "frame" }
    const next = layoutOf(
      {
        page: box(0, 0, 220, 240),
        hero: box(12, 12, 196, 56),
        features: box(12, 76, 196, 40),
        pricing: box(12, 124, 196, 48),
        extra: box(12, 180, 196, 12),
        footer: box(12, 200, 196, 28),
      },
      ["page", "extra", "footer"],
    )
    m.noteChange({ origin: "agent:k.s.0", cause: "ops", nodes: ["extra"] }, (id) =>
      after.nodes.has(id),
    )
    m.afterLayout(after, next)
    expect(200 + (m.frame(next)?.get("footer")?.dy ?? 0)).toBeCloseTo(drawnY, 5)
    delete doc.extra
  })
})

describe("board 35 batch stagger (HfsF5)", () => {
  function batch(n: number) {
    const doc: Record<string, N> = { page: { parent: null, type: "frame" } }
    const boxes: Record<string, Rect> = { page }
    const ids: string[] = []
    for (let i = 0; i < n; i++) {
      const id = `l${i}`
      doc[id] = { parent: "page", type: "rect" }
      boxes[id] = box(0, i * 4, 10, 4)
      ids.push(id)
    }
    return { doc, ids, before: layoutOf({ page }), after: layoutOf(boxes, ids) }
  }

  test("stagger = min(16, 400 / (n − 1)): 16 ms for 10 layers, 13.8 ms for 30", () => {
    expect(staggerFor(1)).toBe(0)
    expect(staggerFor(10)).toBe(16)
    expect(staggerFor(30)).toBeCloseTo(13.79, 2)
    expect(staggerFor(200)).toBeCloseTo(400 / 199, 6)
  })

  test("30 layers start in document order and the batch ends by 600 ms", () => {
    const { doc, ids, before, after } = batch(30)
    const { m, at } = setup(doc)
    m.noteChange({ origin: "mcp:c.1", cause: "ops", nodes: [...ids].reverse() }, () => false)
    m.afterLayout(before, after)
    at(13.8)
    const f = m.frame(after)
    expect(f?.get("l0")?.opacity).toBeGreaterThan(0)
    expect(f?.get("l1")?.opacity).toBeCloseTo(0, 2)
    expect(f?.get("l2")?.opacity).toBe(0)
    at(400)
    expect(m.frame(after)?.get("l29")?.opacity).toBe(0)
    expect(m.frame(after)?.has("l0")).toBe(false)
    at(599)
    expect(m.animating()).toBe(true)
    at(600)
    expect(m.frame(after)).toBeNull()
  })

  test("more than 200 layers: one 200 ms fade of the parent, no per-layer motion", () => {
    const { doc, ids, before, after } = batch(201)
    const { m, at } = setup(doc)
    m.noteChange({ origin: "mcp:c.1", cause: "ops", nodes: ids }, () => false)
    m.afterLayout(before, after)
    const f = m.frame(after)
    expect([...(f?.keys() ?? [])]).toEqual(["page"])
    expect(f?.get("page")).toEqual({ opacity: 0 })
    at(100)
    expect(m.frame(after)?.get("page")?.opacity).toBeCloseTo(buildEase(0.5), 5)
    at(200)
    expect(m.frame(after)).toBeNull()
  })

  test("a large batch under one new section fades that section", () => {
    const doc: Record<string, N> = { section: { parent: null, type: "frame" } }
    const boxes: Record<string, Rect> = { section: box(0, 0, 100, 900) }
    const ids = ["section"]
    for (let i = 0; i < 220; i++) {
      doc[`c${i}`] = { parent: "section", type: "text" }
      boxes[`c${i}`] = box(0, i * 4, 10, 4)
      ids.push(`c${i}`)
    }
    const { m } = setup(doc)
    m.noteChange({ origin: "agent:k.s.0", cause: "ops", nodes: ids }, () => false)
    m.afterLayout(layoutOf({}), layoutOf(boxes, ids))
    expect([...(m.frame(layoutOf(boxes))?.keys() ?? [])]).toEqual(["section"])
  })
})
