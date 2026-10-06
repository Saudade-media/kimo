/**
 * Board 36 "Agent on canvas" (desing.pen XDVdg): per agent one cursor on the center of the
 * section it works in plus a 1 px outline on that section; the section is the direct child of
 * the top-level frame that holds the edit; one ring per landed edit on the section only; the
 * built-in agent's own CLI MCP connection draws nothing (its panel cursor stands for it), while
 * an external MCP client follows the same rules with its own name.
 */
import { describe, expect, test } from "bun:test"
import type { KimoDocument } from "@kimo/core-schema"
import { createDocStore, createEmptyDocument, importDocument, type Op } from "@kimo/editor-state"
import { createLayoutEngine, createResolver, type TextMeasurer } from "@kimo/layout"
import { createElement as h } from "react"
import { renderToString } from "react-dom/server"
import { AgentCanvasLayer, builtInCliSession, createAgentsController } from "../src/agents"
import { createScriptedMcpHost, sampleConnection, sampleHosts } from "../src/agents/testing"
import { pickSection, sectionOf } from "../src/canvas/agent-area"
import { AgentCanvasModel } from "../src/canvas/agent-canvas"
import type { AgentCanvasProps } from "../src/canvas/contract"

const parents: Record<string, string | null> = {
  page: null,
  nav: "page",
  hero: "page",
  card: "hero",
  button: "card",
  article: "page",
  toc: "article",
  tocLabel: "toc",
  empty: null,
  lone: null,
}
const parentOf = (id: string) => parents[id] ?? null

describe("section resolution", () => {
  test("a nested edit resolves to the top-level frame's direct child", () => {
    expect(sectionOf("tocLabel", parentOf)).toBe("article")
    expect(sectionOf("button", parentOf)).toBe("hero")
    expect(sectionOf("hero", parentOf)).toBe("hero")
  })

  test("a layer inside an instance resolves through the instance's real ancestors", () => {
    expect(sectionOf("card/Btn01/Label", parentOf)).toBe("hero")
  })

  test("the top-level frame itself, or a top-level frame with no children, is its own section", () => {
    expect(sectionOf("page", parentOf)).toBe("page")
    expect(sectionOf("empty", parentOf)).toBe("empty")
  })

  test("pickSection: the pointer's section when it is in the work area, else the first", () => {
    expect(pickSection(["tocLabel", "button"], "button", parentOf)).toBe("hero")
    expect(pickSection(["tocLabel", "button"], undefined, parentOf)).toBe("article")
    // A stale pointer outside the work area does not win.
    expect(pickSection(["tocLabel"], "button", parentOf)).toBe("article")
    // No work area yet: the pointer alone.
    expect(pickSection([], "button", parentOf)).toBe("hero")
    // Sections that are not laid out are skipped.
    expect(pickSection(["tocLabel", "nav"], undefined, parentOf, (id) => id !== "article")).toBe(
      "nav",
    )
    expect(pickSection([], undefined, parentOf)).toBeNull()
  })
})

describe("built-in agent's own MCP connection", () => {
  test("a CLI session workspace cwd is the built-in agent's", () => {
    expect(builtInCliSession("/Users/me/.kimo/cli-workspaces/s1abc")).toBe("s1abc")
    expect(builtInCliSession("/Users/me/.kimo/cli-workspaces/s1abc/")).toBe("s1abc")
    expect(builtInCliSession("C:\\Users\\me\\.kimo\\cli-workspaces\\s9")).toBe("s9")
    expect(builtInCliSession("/Users/me/repo/design")).toBeNull()
    expect(builtInCliSession(undefined)).toBeNull()
  })
})

const measure: TextMeasurer = { measure: () => ({ w: 10, h: 10 }) }

async function pageModel() {
  const store = createDocStore()
  const ops = [
    ["Page000001", null, { x: 0, y: 0, w: 1000, h: 900 }],
    ["Nav0000001", "Page000001", { x: 0, y: 0, w: 1000, h: 100 }],
    ["Article001", "Page000001", { x: 0, y: 100, w: 1000, h: 600 }],
    ["Toc0000001", "Article001", { x: 40, y: 40, w: 200, h: 300 }],
    ["TocLabel01", "Toc0000001", { x: 0, y: 0, w: 120, h: 12 }],
  ].map(([id, parent, box]) => ({
    op: "insert",
    id,
    parent,
    node: { type: "frame", name: id, ...(box as object) },
  })) as unknown as Op[]
  const res = store.apply(ops, { origin: "user" })
  if (!res.ok) throw new Error(JSON.stringify(res))
  const engine = createLayoutEngine()
  await engine.init()
  const src = {
    getNode: (id: string) => store.getNode(id),
    children: (p: string | null) => store.children(p),
  }
  const layout = engine.compute({
    nodes: src as never,
    resolve: createResolver({}, src as never),
    measureText: measure,
  })
  const clock = { t: 5000 }
  const m = new AgentCanvasModel(
    {
      getNode: (id) => store.getNode(id) as Record<string, unknown> | undefined,
      children: (p) => store.children(p),
      nodeIds: () => store.nodeIds(),
    },
    () => clock.t,
  )
  m.scanAll()
  return { m, layout, clock }
}

describe("built-in agent on the canvas (AgentCanvasModel)", () => {
  const ORIGIN = "agent:kimo.s1abc.0"
  const props = (over: Partial<AgentCanvasProps> = {}): AgentCanvasProps => ({
    liveOrigins: new Set([ORIGIN]),
    agent: () => ({ label: "Kimo", persona: "agent", ops: 1 }),
    cursors: [
      { origin: ORIGIN, nodeId: "TocLabel01", pointerId: "TocLabel01", text: "", state: "working" },
    ],
    reducedMotion: false,
    ...over,
  })

  test("a small layer edit: one cursor on the section center, the outline on the section box", async () => {
    const { m, layout } = await pageModel()
    m.setProps(props())
    const d = m.dom(layout, { x: 0, y: 0, zoom: 1 }, { w: 1200, h: 900 })
    expect(d.cursors.length).toBe(1)
    expect(d.cursors[0]).toMatchObject({
      label: "Kimo",
      sectionId: "Article001",
      section: { x: 0, y: 100, w: 1000, h: 600 },
      tip: { x: 500, y: 400 },
    })
  })

  test("the landing flash rings the section only, once per landed edit", async () => {
    const { m, layout, clock } = await pageModel()
    m.setProps(
      props({
        landed: [{ key: "k1", origin: ORIGIN, ids: ["TocLabel01", "Toc0000001"] }],
      }),
    )
    const d = m.dom(layout, { x: 0, y: 0, zoom: 1 }, { w: 1200, h: 900 })
    expect(d.flashes).toEqual([
      { key: "k1/Article001", persona: "agent", box: { x: 0, y: 100, w: 1000, h: 600, radius: 0 } },
    ])
    // The renderer draws no per-layer flash any more.
    expect(m.overlay(layout).placeholderFlashes).toBeUndefined()
    clock.t += 1200
    expect(m.dom(layout, { x: 0, y: 0, zoom: 1 }, { w: 1200, h: 900 }).flashes).toEqual([])
  })

  test("no shimmer, tags or ready chips while a placeholder frame is being built", async () => {
    const { m, layout } = await pageModel()
    m.setProps(props())
    const o = m.overlay(layout)
    expect(o.placeholders).toBeUndefined()
    expect(o.shimmerPhase).toBeUndefined()
    const d = m.dom(layout, { x: 0, y: 0, zoom: 1 }, { w: 1200, h: 900 })
    expect("tags" in d || "ready" in d || "scopes" in d).toBe(false)
  })
})

function pricingDoc(): KimoDocument {
  const d = createEmptyDocument("Pricing") as KimoDocument & { nodes: Record<string, unknown> }
  const frame = (id: string, parent: string | null, order: string) => {
    d.nodes[id] = { type: "frame", parent, order, name: id, x: 0, y: 0, w: 100, h: 100 }
  }
  frame("Pricing0001", null, "a0")
  frame("Cards00001", "Pricing0001", "a0")
  frame("Card000002", "Cards00001", "a0")
  return d
}

describe("MCP canvas layer (AgentCanvasLayer)", () => {
  const BOXES: Record<string, { x: number; y: number; w: number; h: number }> = {
    Pricing0001: { x: 0, y: 0, w: 600, h: 400 },
    Cards00001: { x: 20, y: 40, w: 560, h: 300 },
    Card000002: { x: 200, y: 60, w: 136, h: 220 },
  }
  async function render(cwd: string, label = "Claude Code", origin?: string) {
    const store = importDocument(pricingDoc())
    const conn = sampleConnection({
      docs: ["doc-1"],
      state: "editing",
      label,
      cwd,
      focus: ["Card000002"],
      ...(origin ? { origin } : {}),
    })
    const host = createScriptedMcpHost({ connections: [conn], hosts: sampleHosts() })
    const c = createAgentsController({
      host,
      fileId: "f-pricing",
      filePath: "/Users/me/repo/design/pricing.kimo",
      docId: "doc-1",
      store,
      hostHistory: false,
    })
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
    const html = renderToString(
      h(AgentCanvasLayer, {
        controller: c,
        project: (id) => BOXES[id] ?? null,
        world: (id) => BOXES[id] ?? null,
        toLayer: (p) => p,
        parentOf: (id) => {
          const p = (store.getNode(id) as { parent?: unknown } | undefined)?.parent
          return typeof p === "string" ? p : null
        },
      }),
    )
    c.dispose()
    return html
  }

  test("an external client: one cursor with its name, the outline on its section", async () => {
    const html = await render("/Users/me/repo/design")
    expect(html.match(/data-testid="agent-cursor"/g)?.length).toBe(1)
    expect(html.match(/data-testid="agent-section-outline"/g)?.length).toBe(1)
    expect(html).toContain(">Claude Code<")
    expect(html).toContain('data-node-id="Cards00001"')
    // Cursor box = section center − (3, 3): Cards00001 center (300, 190).
    expect(html).toContain("left:297px;top:187px")
    expect(html).not.toContain("agent-tag")
    expect(html).not.toContain("agent-cursor-docked")
  })

  test("the built-in agent's own CLI connection draws nothing", async () => {
    const html = await render("/Users/me/.kimo/cli-workspaces/s1abc")
    expect(html).not.toContain('data-testid="agent-cursor"')
    expect(html).not.toContain('data-testid="agent-section-outline"')
  })

  test("the built-in agent's in-app host connection (agent:*) draws nothing either", async () => {
    const html = await render("/Users/me/repo/design", "Kimo", "agent:kimo.s1abc.0")
    expect(html).not.toContain('data-testid="agent-cursor"')
  })
})
