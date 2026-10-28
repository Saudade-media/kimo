/**
 * Prompt-node runs through the Agent tab controller (ADR 0014 §9): a prompt with a target runs
 * one Single turn scoped to it; one without builds into a new frame next to it.
 */
import { describe, expect, test } from "bun:test"
import type { KimoDocument } from "@kimo/core-schema"
import { createEmptyDocument, type DocStore, importDocument } from "@kimo/editor-state"
import {
  type AgentPanelControllerExt,
  createAgentPanelController,
  createInWindowTools,
} from "../../src/agent-panel"
import { createTestRuntime, type Script } from "../../src/agent-panel/testing"
import { SIDE_BY_SIDE_GAP, sideBySideAnchor } from "../../src/canvas/agent-canvas"

function doc(): KimoDocument {
  const d = createEmptyDocument("Prompts") as KimoDocument & { nodes: Record<string, unknown> }
  d.nodes.Pricing0001 = {
    type: "frame",
    parent: null,
    order: "a0",
    name: "Pricing",
    x: 0,
    y: 0,
    w: 600,
    h: 400,
  }
  d.nodes.Below00001 = {
    type: "frame",
    parent: null,
    order: "a1",
    name: "Footer",
    x: 700,
    y: 0,
    w: 300,
    h: 200,
  }
  d.nodes.Prompt0001 = {
    type: "prompt",
    parent: null,
    order: "a3",
    name: "Cards",
    x: 1300,
    y: 0,
    w: 280,
    content: "Draft 3 pricing cards.",
    target: "Pricing0001",
  }
  d.nodes.Prompt0002 = {
    type: "prompt",
    parent: null,
    order: "a4",
    name: "Footer links",
    x: 1300,
    y: 400,
    w: 280,
    content: "Add a footer.",
  }
  return d
}

type Box = { x: number; y: number; w: number; h: number }
const box = (store: DocStore, id: string): Box => {
  const n = store.getNode(id) as Record<string, number>
  return { x: n.x ?? 0, y: n.y ?? 0, w: typeof n.w === "number" ? n.w : 0, h: n.h ?? 0 }
}

function setup(script: Script): {
  c: AgentPanelControllerExt
  store: DocStore
  docId: string
} {
  const store = importDocument(doc())
  const tools = createInWindowTools({ store, path: "/u/me/Prompts.kimo" })
  const rt = createTestRuntime({ tools: tools.factory, script })
  const c = createAgentPanelController({
    runtime: rt,
    fileId: "f-prompts",
    fileName: "Prompts.kimo",
    docId: () => tools.docId(),
    nodeName: (id) => (store.getNode(id) as { name?: string } | undefined)?.name,
    frameBox: (id, n = 1) => {
      const node = store.getNode(id) as { name: string } | undefined
      if (!node) return null
      const roots = store
        .children(null)
        .filter((r) => r !== id && store.getNode(r)?.type === "frame")
        .map((r) => box(store, r))
      return sideBySideAnchor({ id, name: node.name, ...box(store, id) }, roots, n)
    },
    sideBySideGap: SIDE_BY_SIDE_GAP,
  })
  return { c, store, docId: tools.docId() }
}

const promptInput = (store: DocStore, id: string) => {
  const n = store.getNode(id) as Record<string, unknown>
  return {
    prompt: {
      id,
      content: String(n.content),
      box: box(store, id),
      ...(typeof n.name === "string" ? { name: n.name } : {}),
      ...(typeof n.target === "string" ? { target: n.target } : {}),
    },
    notes: [],
    frame: (fid: string) =>
      store.getNode(fid)?.type === "frame" ? { id: fid, box: box(store, fid) } : null,
  }
}

describe("prompt node runs", () => {
  test("a prompt with a target runs one Single turn scoped to it; an edit outside is refused", async () => {
    const seen: string[] = []
    const holder = { docId: "" }
    const { c, store, docId } = setup((req, i) => {
      if (req.responseSchema) return { text: '{"title":"Cards"}' }
      const u = [...req.messages].reverse().find((m) => m.role === "user")
      if (u?.role === "user")
        seen.push(u.content.map((p) => (p.type === "text" ? p.text : "")).join(""))
      return i === 0
        ? {
            tools: [
              {
                name: "kimo_apply_ops",
                input: {
                  docId: holder.docId,
                  ops: [
                    {
                      op: "insert",
                      parent: "Pricing0001",
                      node: { type: "frame", name: "Card", x: 0, y: 0, w: 100, h: 100 },
                    },
                    // Outside the target: rejected per op.
                    { op: "update", id: "Below00001", set: { name: "Hacked" } },
                  ],
                },
              },
            ],
          }
        : { text: "Done." }
    })
    holder.docId = docId
    await c.refresh()
    c.setAutoApprove(false) // "Ask before changes" on
    // Out of scope -> an in-app approval (it waits until answered): deny it.
    let asked = false
    const off = c.subscribe((st) => {
      if (st.approval && !asked) {
        asked = true
        void c.answerApproval((st.approval.request as { id: string }).id, "deny")
      }
    })
    await c.runPrompt(promptInput(store, "Prompt0001"))
    off()
    expect(seen[0]).toContain("Draft 3 pricing cards.")
    expect((store.getNode("Below00001") as unknown as { name: string }).name).toBe("Footer")
    expect(c.state.promptRuns.Prompt0001?.status).toBe("idle")
  })

  test("a prompt without a target builds into a new frame next to it, then clears its flag", async () => {
    const holder = { docId: "" }
    const before = new Set<string>()
    const { c, store, docId } = setup((req, i) => {
      if (req.responseSchema) return { text: '{"title":"Footer"}' }
      if (i > 0) return { text: "Built." }
      const target = store.nodeIds().find((id) => !before.has(id)) as string
      return {
        tools: [
          {
            name: "kimo_apply_ops",
            input: {
              docId: holder.docId,
              ops: [
                {
                  op: "insert",
                  parent: target,
                  node: { type: "frame", name: "Links", x: 0, y: 0, w: 100, h: 40 },
                },
              ],
            },
          },
        ],
      }
    })
    holder.docId = docId
    for (const id of store.nodeIds()) before.add(id)
    await c.refresh()
    await c.runPrompt(promptInput(store, "Prompt0002"))
    const created = store.nodeIds().filter((id) => !before.has(id))
    const frame = created
      .map((id) => store.getNode(id) as Record<string, unknown>)
      .find((n) => n.name === "Footer links · result")
    expect(frame).toBeDefined()
    expect(frame?.placeholder).toBeUndefined()
    expect(c.state.promptRuns.Prompt0002?.status).toBe("idle")
    expect(c.state.promptRuns.Prompt0002?.lastRun?.ops).toBeGreaterThan(0)
  })
})
