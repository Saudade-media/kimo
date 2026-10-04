/**
 * M6 canvas model (board 22 D0zDSY, board 24 iLW1l): placeholder / prompt tracking, renderer
 * overlay fields, flash on clear, DOM projections (tags, ready chip, ScopeTags, rejected pill,
 * persona cursors, prompt footers, target chips), personas and the Note / Prompt tools.
 */
import { describe, expect, test } from "bun:test"
import { createDocStore, type DocStore, type Op } from "@kimo/editor-state"
import {
  createLayoutEngine,
  createResolver,
  type LayoutResult,
  type TextMeasurer,
} from "@kimo/layout"
import {
  AgentCanvasModel,
  defaultAgo,
  FLASH_MS,
  personaFor,
  READY_CHIP_MS,
  REJECT_MS,
} from "../src/canvas/agent-canvas"
import { type AgentCanvasProps, CANVAS_TOOLS } from "../src/canvas/contract"

const measure: TextMeasurer = {
  measure: (t, maxWidth) => {
    const text = t.runs.map((r) => r.text).join("")
    const w = text.length * t.style.fontSize * 0.5
    const lines = maxWidth ? Math.max(1, Math.ceil(w / Math.max(1, maxWidth))) : 1
    return { w: maxWidth ? Math.min(w, maxWidth) : w, h: lines * t.style.fontSize * 1.5 }
  },
}

const LEAD = "agent:kimo.s1.0"
const A1 = "agent:kimo.s1.1"

function doc(): DocStore {
  const store = createDocStore()
  const ops: Op[] = [
    {
      op: "insert",
      id: "pricing",
      parent: null,
      node: { type: "frame", name: "Pricing", x: 360, y: 52, w: 340, h: 230 },
    },
    {
      op: "insert",
      id: "holder",
      parent: null,
      node: {
        type: "frame",
        name: "Features",
        x: 740,
        y: 52,
        w: 300,
        h: 300,
        placeholder: { by: LEAD, since: "2026-10-04T10:00:00.000Z" },
      },
    },
    {
      op: "insert",
      id: "orphan",
      parent: null,
      node: {
        type: "frame",
        name: "Hero",
        x: 0,
        y: 400,
        w: 200,
        h: 100,
        placeholder: { by: "agent:kimo.old.0" },
      },
    },
    {
      op: "insert",
      id: "prompt",
      parent: null,
      node: { type: "prompt", x: 32, y: 220, content: "Draft 3 pricing cards", target: "pricing" },
    },
    {
      op: "insert",
      id: "note01",
      parent: null,
      node: { type: "note", x: 32, y: 40, content: "Hi" },
    },
  ]
  const res = store.apply(ops, { origin: "user" })
  if (!res.ok) throw new Error(JSON.stringify(res))
  return store
}

async function layoutOf(store: DocStore): Promise<LayoutResult> {
  const engine = createLayoutEngine()
  await engine.init()
  const src = {
    getNode: (id: string) => store.getNode(id),
    children: (p: string | null) => store.children(p),
  }
  return engine.compute({
    nodes: src as never,
    resolve: createResolver({}, src as never),
    measureText: measure,
  })
}

function model(store: DocStore, clock = { t: 1000 }) {
  const m = new AgentCanvasModel(
    {
      getNode: (id) => store.getNode(id) as Record<string, unknown> | undefined,
      children: (p) => store.children(p),
      nodeIds: () => store.nodeIds(),
    },
    () => clock.t,
  )
  m.scanAll()
  return m
}

const props = (over: Partial<AgentCanvasProps> = {}): AgentCanvasProps => ({
  liveOrigins: new Set([LEAD, A1]),
  agent: (o) =>
    o === LEAD
      ? { label: "Kimo", persona: "agent", ops: 14 }
      : o === A1
        ? { label: "Agent 1", persona: "iris" }
        : null,
  reducedMotion: false,
  ...over,
})

const V = { x: 0, y: 0, zoom: 1 }
const SIZE = { w: 1400, h: 900 }

describe("tracking", () => {
  test("scanAll finds placeholder frames and prompts; incremental scans follow edits", () => {
    const store = doc()
    const m = model(store)
    expect([...m.placeholders.keys()].sort()).toEqual(["holder", "orphan"])
    expect([...m.prompts]).toEqual([["prompt", "pricing"]])
    store.apply([{ op: "update", id: "prompt", unset: ["target"] }], { origin: "user" })
    m.scan(["prompt"])
    expect(m.prompts.get("prompt")).toBeUndefined()
    store.apply([{ op: "delete", id: "orphan" }], { origin: "user" })
    m.scan(["orphan"])
    expect(m.placeholders.has("orphan")).toBe(false)
  })
})

describe("renderer overlay fields", () => {
  test("placeholders: building vs interrupted, skeleton only while empty, persona", async () => {
    const store = doc()
    const layout = await layoutOf(store)
    const m = model(store)
    m.setProps(props())
    const o = m.overlay(layout)
    expect(o.placeholders).toEqual([
      { id: "holder", persona: "agent", state: "building", skeleton: true },
      { id: "orphan", persona: "agent", state: "interrupted", skeleton: true },
    ])
    expect(o.promptConnectors).toEqual([{ prompt: "prompt", target: "pricing" }])
    expect(typeof o.shimmerPhase).toBe("number")
    // A child arrives: no skeleton (DzQcZ f7c6p1 "Skeleton bars only while the frame has no children").
    store.apply(
      [{ op: "insert", id: "kid001", parent: "holder", node: { type: "rect", w: 10, h: 10 } }],
      { origin: "user" },
    )
    m.scan(["kid001", "holder"])
    expect(m.overlay(layout).placeholders?.[0]?.skeleton).toBe(false)
  })

  test("without agent props every owned placeholder is interrupted (no live owner)", async () => {
    const store = doc()
    const m = model(store)
    const o = m.overlay(await layoutOf(store))
    expect(o.placeholders?.every((p) => p.state === "interrupted")).toBe(true)
  })

  test("reduced motion: the shimmer stands still, nothing animates for it", async () => {
    const store = doc()
    const m = model(store)
    m.setProps(props({ reducedMotion: true }))
    expect(m.overlay(await layoutOf(store)).shimmerPhase).toBeNull()
    expect(m.animating()).toBe(false)
    m.setProps(props())
    expect(m.animating()).toBe(true)
  })

  test("clearing a placeholder flashes 1.2 s and shows the ready chip 4 s", async () => {
    const store = doc()
    const layout = await layoutOf(store)
    const clock = { t: 1000 }
    const m = model(store, clock)
    m.setProps(props())
    store.apply([{ op: "update", id: "holder", unset: ["placeholder"] }], { origin: "user" })
    m.scan(["holder"])
    expect(m.overlay(layout).placeholderFlashes).toEqual([
      { id: "holder", progress: 0, persona: "agent" },
    ])
    expect(m.dom(layout, V, SIZE).ready).toEqual([
      {
        id: "holder",
        origin: LEAD,
        left: 740,
        top: 52 + 300 + 12,
        text: "Features ready · 14 ops",
      },
    ])
    clock.t += FLASH_MS
    expect(m.overlay(layout).placeholderFlashes).toEqual([])
    expect(m.dom(layout, V, SIZE).ready.length).toBe(1)
    clock.t += READY_CHIP_MS - FLASH_MS
    m.prune()
    expect(m.dom(layout, V, SIZE).ready.length).toBe(0)
  })

  test("scopes: split = flush, others outset; persona selections and rejected flashes", async () => {
    const store = doc()
    const layout = await layoutOf(store)
    const clock = { t: 1000 }
    const m = model(store, clock)
    m.setProps(
      props({
        scopes: [
          { origin: A1, roots: ["pricing"], mode: "split" },
          { origin: LEAD, roots: ["holder"], mode: "side-by-side" },
        ],
        cursors: [
          { origin: A1, nodeId: "pricing", text: "setting Headline font…", state: "working" },
        ],
        rejections: [
          { key: "r1", origin: A1, nodeId: "pricing", text: "update Navbar → OUT_OF_SCOPE" },
        ],
      }),
    )
    const o = m.overlay(layout)
    expect(o.scopes).toEqual([
      { id: "pricing", persona: "iris", fit: "flush" },
      { id: "holder", persona: "agent", fit: "outset" },
    ])
    expect(o.agentSelections).toEqual([{ id: "pricing", persona: "iris" }])
    expect(o.rejected).toEqual(["pricing"])
    clock.t += REJECT_MS
    expect(m.overlay(layout).rejected).toEqual([])
  })
})

describe("DOM projection", () => {
  test("tags, ScopeTags, rejected pill, cursor, prompt footer and target chip positions", async () => {
    const store = doc()
    const layout = await layoutOf(store)
    const m = model(store)
    m.setProps(
      props({
        scopes: [
          { origin: A1, roots: ["pricing"], mode: "split" },
          { origin: LEAD, roots: ["holder"], mode: "side-by-side" },
          {
            origin: LEAD,
            roots: ["holder"],
            mode: "iterate",
            iterate: { pass: 2, of: 3, reviewing: true },
          },
        ],
        cursors: [
          { origin: A1, nodeId: "pricing", text: "setting Headline font…", state: "working" },
        ],
        rejections: [
          { key: "r1", origin: A1, nodeId: "pricing", text: "update Navbar → OUT_OF_SCOPE" },
        ],
        promptRun: () => ({
          status: "idle",
          lastRun: { at: Date.now() - 4 * 60_000, ops: 18, costUsd: 0.06, billing: "api" },
        }),
      }),
    )
    const d = m.dom(layout, { x: 0, y: 0, zoom: 1 }, SIZE)
    // Tag inside the frame's 16 px padding (EKCy7), copy "<agent> · building <name> · N ops".
    expect(d.tags.find((t) => t.id === "holder")).toMatchObject({
      left: 756,
      top: 68,
      text: "Kimo · building Features · 14 ops",
      state: "building",
    })
    expect(d.tags.find((t) => t.id === "orphan")).toMatchObject({
      text: "Interrupted",
      state: "interrupted",
    })
    // ScopeTags: split inside top-right (6 px), side by side 3 px above the 3 px outset outline.
    expect(d.scopes[0]).toMatchObject({
      left: 360 + 340 - 6,
      top: 58,
      anchor: "right",
      text: "Agent 1 · only inside Pricing",
      persona: "iris",
    })
    expect(d.scopes[1]).toMatchObject({
      left: 737,
      top: 52 - 3 - 3 - 20,
      anchor: "left",
      text: "Kimo · only inside Features",
    })
    expect(d.scopes[2]?.text).toBe("Agent can only edit inside Features")
    // Pass Chip (NCElh): 7 below the outset outline (outline bottom 451 → chip 458 in h6oHb).
    expect(d.passes).toEqual([
      {
        key: `${LEAD}/holder`,
        left: 737,
        top: 52 + 300 + 3 + 7,
        text: "Iterate · pass 2 of 3 · review",
      },
    ])
    expect(d.rejected[0]).toMatchObject({
      cx: 530,
      top: 64,
      text: "Agent 1 · update Navbar → OUT_OF_SCOPE",
    })
    expect(d.cursors[0]).toMatchObject({
      left: 364,
      top: 56,
      text: "Agent 1 · setting Headline font…",
      persona: "iris",
      stack: 0,
    })
    const p = d.prompts[0]
    expect(p?.box.w).toBe(300)
    expect(p?.footer).toBe("Ran 4m ago · 18 ops · $0.06")
    expect(p?.action).toBe("run")
    expect(p?.target).toEqual({ left: 360, top: 52 + 230 + 10, text: "target · Pricing" })
  })

  test("prompt states: never run, running (Stop), failed (Retry)", async () => {
    const store = doc()
    const layout = await layoutOf(store)
    const m = model(store)
    const at = (run: AgentCanvasProps["promptRun"]) => {
      m.setProps(props({ promptRun: run }))
      return m.dom(layout, V, SIZE).prompts[0]
    }
    expect(at(undefined)).toMatchObject({ status: "never", footer: "Not run yet", action: "run" })
    expect(at(() => ({ status: "running", live: { ops: 9, costUsd: 0.02 } }))).toMatchObject({
      status: "running",
      footer: "Running · 9 ops · $0.02",
      action: "stop",
    })
    expect(
      at(() => ({ status: "failed", error: { kind: "auth", message: "no key for Gemini" } })),
    ).toMatchObject({ status: "failed", footer: "Failed · no key for Gemini", action: "retry" })
  })

  test("zoomed out: projections scale, tiny placeholders get no tag", async () => {
    const store = doc()
    const layout = await layoutOf(store)
    const m = model(store)
    m.setProps(props())
    const d = m.dom(layout, { x: 0, y: 0, zoom: 0.1 }, SIZE)
    expect(d.tags.length).toBe(0)
    expect(d.prompts[0]?.zoom).toBe(0.1)
  })

  test("nothing to show → the shared empty state (no React work)", async () => {
    const store = createDocStore()
    const m = model(store)
    const layout = await layoutOf(store)
    expect(m.active()).toBe(false)
    expect(m.dom(layout, V, SIZE).tags).toEqual([])
    expect(m.overlay(layout)).toEqual({})
  })
})

describe("personas and tools", () => {
  test("lead teal, then Iris → Violet → Rose → Ember → Moss, repeating", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(personaFor)).toEqual([
      "agent",
      "iris",
      "violet",
      "rose",
      "ember",
      "moss",
      "iris",
    ])
  })

  test("Note (N) and Prompt (⇧P) follow Component in the toolbar", () => {
    const ids = CANVAS_TOOLS.map((t) => t.id)
    expect(ids.slice(-3)).toEqual(["component", "note", "prompt"])
    expect(CANVAS_TOOLS.find((t) => t.id === "note")).toMatchObject({
      icon: "sticky-note",
      iconColor: "note-text",
      shortcut: "N",
      action: "insertNote",
    })
    expect(CANVAS_TOOLS.find((t) => t.id === "prompt")).toMatchObject({
      icon: "sparkles",
      iconColor: "agent",
      shortcut: "⇧P",
      action: "insertPrompt",
    })
  })

  test("footer time formatter", () => {
    expect(defaultAgo(0, 30_000)).toBe("just now")
    expect(defaultAgo(0, 4 * 60_000)).toBe("4m ago")
    expect(defaultAgo(0, 3 * 3600_000)).toBe("3h ago")
  })
})

describe("side by side placement", () => {
  test("free row: the original's own row; occupied: below what it would overlap", async () => {
    const { sideBySideAnchor, SIDE_BY_SIDE_GAP } = await import("../src/canvas/agent-canvas")
    const { planSideBySide } = await import("@kimo/ai-agent")
    const original = { id: "p", name: "Pricing", x: 24, y: 64, w: 280, h: 340 }
    expect(sideBySideAnchor(original, [], 3)).toBe(original)
    // agblr: v1 at 344, v2 at 664 (gap 40), same y.
    const ops = planSideBySide(sideBySideAnchor(original, [], 3), 3, ["a", "b", "c"], {
      gap: SIDE_BY_SIDE_GAP,
    }) as unknown as {
      node: { x: number; y: number }
    }[]
    expect(ops.map((o) => [o.node.x, o.node.y])).toEqual([
      [344, 64],
      [664, 64],
      [984, 64],
    ])
    // A frame right of the original pushes the row below it (+ the gap).
    const moved = sideBySideAnchor(original, [{ x: 500, y: 0, w: 200, h: 500 }], 3)
    expect(moved.y).toBe(540)
    expect(moved.x).toBe(24)
  })
})
