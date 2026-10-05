/**
 * Agent pointer (board 31 "Agent cursor"): the cursor sits on the area the agent works on (the
 * layers a step reads / edits, else what its last landed edit created or changed), never on the
 * page frame's 0:0 corner, and glides between areas in world space (no drift while panning).
 */
import { describe, expect, test } from "bun:test"
import type { KimoDocument } from "@kimo/core-schema"
import { createDocStore, createEmptyDocument, importDocument, type Op } from "@kimo/editor-state"
import { createLayoutEngine, createResolver, type TextMeasurer } from "@kimo/layout"
import { callTargets } from "@kimo/mcp-server"
import { createAgentPanelController } from "../src/agent-panel/controller"
import { createTestRuntime, type Script } from "../src/agent-panel/testing"
import { createInWindowTools } from "../src/agent-panel/tools"
import { CURSOR_GLIDE_MS, unionBox, workAreaIds } from "../src/canvas/agent-area"
import { AgentCanvasModel } from "../src/canvas/agent-canvas"
import type { AgentCanvasProps } from "../src/canvas/contract"

const parents: Record<string, string | null> = {
  page: null,
  section: "page",
  card: "section",
  title: "card",
  other: "page",
}

describe("work area", () => {
  test("workAreaIds drops a top-level frame that covers other ids; nested ancestors stay", () => {
    expect(workAreaIds(["page", "section", "card", "other"], (id) => parents[id])).toEqual([
      "section",
      "card",
      "other",
    ])
    expect(workAreaIds(["page"], (id) => parents[id])).toEqual(["page"])
    expect(workAreaIds(["card", "card", "title"], (id) => parents[id])).toEqual(["card", "title"])
  })

  test("unionBox", () => {
    expect(
      unionBox([{ x: 800, y: 400, w: 100, h: 50 }, null, { x: 850, y: 300, w: 200, h: 60 }]),
    ).toEqual({ x: 800, y: 300, w: 250, h: 150 })
    expect(unionBox([null, undefined])).toBeNull()
  })

  test("callTargets: edited ids, insert parents; @keys and root left out", () => {
    expect(
      callTargets("kimo_apply_ops", {
        ops: [
          { op: "insert", key: "faq", parent: "page", node: { type: "frame" } },
          { op: "insert", parent: "@faq", node: { type: "text" } },
          { op: "update", id: "page", set: { h: 4000 } },
          { op: "instantiate", of: "cmp", parent: "root" },
          { op: "set_override", instance: "inst1", kind: "set" },
          { op: "make_component", ids: ["a", "b"] },
        ],
      }),
    ).toEqual({ ids: ["page", "inst1", "a", "b"], parents: ["page"] })
    expect(
      callTargets("kimo_apply_ops", { ops: [{ op: "insert", parent: "page", node: {} }] }),
    ).toEqual({ ids: [], parents: ["page"] })
    expect(callTargets("kimo_query", { select: { ids: ["x", "@k"], under: "y" } })).toEqual({
      ids: ["x", "y"],
      parents: [],
    })
    expect(callTargets("kimo_render", { ids: ["z"] }).ids).toEqual(["z"])
  })
})

function landing(): KimoDocument {
  const d = createEmptyDocument("Landing") as KimoDocument & { nodes: Record<string, unknown> }
  d.nodes.Landing0001 = {
    type: "frame",
    parent: null,
    order: "a0",
    name: "Landing",
    x: 0,
    y: 0,
    w: 1440,
    h: 1200,
  }
  d.nodes.Pricing0001 = {
    type: "frame",
    parent: "Landing0001",
    order: "a0",
    name: "Pricing",
    x: 800,
    y: 400,
    w: 400,
    h: 300,
  }
  return d
}

describe("built-in agent cursor (agent panel → canvas)", () => {
  test("a landed edit moves the cursor to the layers it created, not the page frame", async () => {
    const store = importDocument(landing())
    const tools = createInWindowTools({ store, path: "/u/me/Landing.kimo" })
    const holder = { docId: "" }
    const script: Script = (_req, i) =>
      i === 0
        ? {
            tools: [
              {
                name: "kimo_apply_ops",
                input: {
                  docId: holder.docId,
                  ops: [
                    // Grows the page frame and adds a FAQ inside Pricing: the page frame is an
                    // ancestor of the new layer, so the cursor must not land on its corner.
                    { op: "update", id: "Landing0001", set: { h: 1600 } },
                    {
                      op: "insert",
                      key: "faq",
                      parent: "Pricing0001",
                      node: { type: "frame", name: "FAQ", x: 20, y: 20, w: 200, h: 80 },
                    },
                  ],
                },
              },
            ],
          }
        : i === 1
          ? {
              // Insert-only batch into the page frame: the cursor keeps its last area.
              tools: [
                {
                  name: "kimo_apply_ops",
                  input: {
                    docId: holder.docId,
                    ops: [{ op: "insert", parent: "Landing0001", node: { type: "frame" } }],
                  },
                },
              ],
              delayMs: 10,
            }
          : { text: "Added a FAQ to Pricing.", delayMs: 10 }
    const rt = createTestRuntime({ tools: tools.factory, script })
    const c = createAgentPanelController({
      runtime: rt,
      fileId: "f-landing",
      fileName: "Landing.kimo",
      docId: () => tools.docId(),
      nodeName: (id) => (store.getNode(id) as { name?: string } | undefined)?.name ?? undefined,
      parentOf: (id) =>
        (store.getNode(id) as { parent?: string | null } | undefined)?.parent ?? null,
    })
    holder.docId = tools.docId()
    await c.refresh()
    const areas: string[][] = []
    let follow: string[] = []
    const unsub = c.subscribe((st) => {
      const cur = st.canvas.cursors[0]
      const ids = cur ? [...(cur.nodeIds ?? [cur.nodeId])] : []
      const last = areas[areas.length - 1]
      if (ids.length && JSON.stringify(last) !== JSON.stringify(ids)) areas.push(ids)
      const a = st.messages[1]
      if (a?.kind === "agent" && a.progress?.follow.length) follow = [...a.progress.follow]
    })
    await c.send("Add a FAQ")
    unsub()
    const faq = store.children("Pricing0001")[0] as string
    expect(faq).toBeTruthy()
    // In flight: the layer the batch edits; landed: the new FAQ only (innermost).
    expect(areas[0]).toEqual(["Landing0001"])
    expect(areas).toContainEqual([faq])
    // The insert-only batch into the page frame kept the FAQ area, then landed on its new layer.
    expect(areas.some((a) => a.includes("Landing0001") && areas.indexOf(a) > 0)).toBe(false)
    // Follow targets the cursor's area.
    expect(follow.length).toBeGreaterThan(0)
    expect(follow).not.toContain("Landing0001")
    // Idle: the cursor is gone once the turn ends.
    expect(c.state.canvas.cursors).toHaveLength(0)
  })
})

const measure: TextMeasurer = {
  measure: () => ({ w: 10, h: 10 }),
}

describe("canvas cursor projection (AgentCanvasModel)", () => {
  async function setup() {
    const store = createDocStore()
    const ops: Op[] = [
      {
        op: "insert",
        id: "PageFrame1",
        parent: null,
        node: { type: "frame", name: "Page", x: 0, y: 0, w: 1440, h: 1200 },
      },
      {
        op: "insert",
        id: "AreaA00001",
        parent: "PageFrame1",
        node: { type: "frame", name: "A", x: 800, y: 400, w: 200, h: 100 },
      },
      {
        op: "insert",
        id: "AreaB00001",
        parent: "PageFrame1",
        node: { type: "frame", name: "B", x: 900, y: 450, w: 200, h: 300 },
      },
      {
        op: "insert",
        id: "AreaC00001",
        parent: "PageFrame1",
        node: { type: "frame", name: "C", x: 100, y: 900, w: 100, h: 100 },
      },
    ] as unknown as Op[]
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
    const clock = { t: 1000 }
    const m = new AgentCanvasModel(
      {
        getNode: (id) => store.getNode(id) as Record<string, unknown> | undefined,
        children: (p) => store.children(p),
        nodeIds: () => store.nodeIds(),
      },
      () => clock.t,
    )
    m.scanAll()
    const props = (nodeIds: string[]): AgentCanvasProps => ({
      liveOrigins: new Set(["agent:k"]),
      agent: () => ({ label: "Kimo", persona: "agent", ops: 0, paused: false }),
      cursors: [
        {
          origin: "agent:k",
          nodeId: nodeIds[0] as string,
          nodeIds,
          text: "Kimo",
          state: "working",
        },
      ],
      reducedMotion: false,
    })
    return { m, layout, clock, props }
  }

  test("the anchor is the union box's top-left (+4, +4)", async () => {
    const { m, layout, props } = await setup()
    m.setProps(props(["AreaA00001", "AreaB00001"]))
    m.overlay(layout)
    const d = m.dom(layout, { x: 0, y: 0, zoom: 1 }, { w: 1440, h: 900 })
    expect(d.cursors[0]).toMatchObject({ left: 804, top: 404 })
  })

  test("glides between areas in world space; a pan mid-glide moves it with the canvas", async () => {
    const { m, layout, clock, props } = await setup()
    m.setProps(props(["AreaA00001"]))
    m.overlay(layout)
    expect(m.animating()).toBe(false)
    m.setProps(props(["AreaC00001"]))
    m.overlay(layout)
    expect(m.animating()).toBe(true)
    const at = (v: { x: number; y: number; zoom: number }) =>
      m.dom(layout, v, { w: 1440, h: 900 }).cursors[0] as { left: number; top: number }
    expect(at({ x: 0, y: 0, zoom: 1 })).toMatchObject({ left: 804, top: 404 })
    clock.t += CURSOR_GLIDE_MS / 2
    const mid = at({ x: 0, y: 0, zoom: 1 })
    expect(mid.left).toBeLessThan(804)
    expect(mid.left).toBeGreaterThan(104)
    // Same instant, panned and zoomed: the same world point, projected (no trailing).
    const panned = at({ x: -50, y: 30, zoom: 2 })
    expect(panned.left).toBeCloseTo((mid.left - 4 + 50) * 2 + 4, 5)
    expect(panned.top).toBeCloseTo((mid.top - 4 - 30) * 2 + 4, 5)
    clock.t += CURSOR_GLIDE_MS
    expect(at({ x: 0, y: 0, zoom: 1 })).toMatchObject({ left: 104, top: 904 })
    expect(m.animating()).toBe(false)
  })
})
