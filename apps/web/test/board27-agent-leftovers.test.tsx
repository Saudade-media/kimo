/**
 * Board 27 agent leftovers: prompt-node run state survives a reload (app data, never the
 * `.kimo`), side-by-side variant placeholders are cleared at turn end (an empty variant is
 * removed), and "Open skills folder" is a desktop-only action.
 */
import { describe, expect, test } from "bun:test"
import type { ProviderRequest } from "@kimo/ai-agent"
import type { KimoDocument } from "@kimo/core-schema"
import { createEmptyDocument, type DocStore, importDocument } from "@kimo/editor-state"
import { renderToStaticMarkup } from "react-dom/server"
import {
  type AgentPanelControllerExt,
  createAgentPanelController,
  createInWindowTools,
  createPromptRunStore,
  PROMPT_RUNS_KEY,
  type PromptRunStore,
  persistablePromptRun,
  SkillsMenu,
  skillsFolderAction,
} from "../src/agent-panel"
import { createTestRuntime, type Script } from "../src/agent-panel/testing"

function memoryStorage() {
  const m = new Map<string, string>()
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  }
}

function doc(): KimoDocument {
  const d = createEmptyDocument("Leftovers") as KimoDocument & { nodes: Record<string, unknown> }
  d.nodes.Pricing0001 = {
    type: "frame",
    parent: null,
    order: "a0",
    name: "Pricing",
    x: 0,
    y: 0,
    w: 640,
    h: 460,
  }
  d.nodes.Prompt0001 = {
    type: "prompt",
    parent: null,
    order: "a1",
    name: "Cards",
    x: 1300,
    y: 0,
    w: 280,
    content: "Draft 3 pricing cards.",
    target: "Pricing0001",
  }
  return d
}

const lastUserText = (req: ProviderRequest) => {
  const u = [...req.messages].reverse().find((m) => m.role === "user")
  return u?.role === "user" ? u.content.map((p) => (p.type === "text" ? p.text : "")).join("") : ""
}

function setup(
  script: Script,
  promptRuns?: PromptRunStore,
  store: DocStore = importDocument(doc()),
): { c: AgentPanelControllerExt; store: DocStore; docId: string } {
  const tools = createInWindowTools({ store, path: "/u/me/Leftovers.kimo" })
  const rt = createTestRuntime({ tools: tools.factory, script })
  const c = createAgentPanelController({
    runtime: promptRuns ? { ...rt, promptRuns } : rt,
    fileId: "f-left",
    fileName: "Leftovers.kimo",
    docId: () => tools.docId(),
    nodeName: (id) => (store.getNode(id) as { name?: string } | undefined)?.name,
    frameBox: (id) => {
      const n = store.getNode(id) as
        | { name: string; x: number; y: number; w: number; h: number }
        | undefined
      return n ? { id, name: n.name, x: n.x, y: n.y, w: n.w, h: n.h } : null
    },
  })
  return { c, store, docId: tools.docId() }
}

const promptInput = (store: DocStore) => {
  const n = store.getNode("Prompt0001") as Record<string, unknown>
  return {
    prompt: {
      id: "Prompt0001",
      content: String(n.content),
      box: { x: 1300, y: 0, w: 280, h: 120 },
      name: "Cards",
      target: "Pricing0001",
    },
    notes: [],
    frame: (fid: string) =>
      store.getNode(fid)?.type === "frame"
        ? { id: fid, box: { x: 0, y: 0, w: 640, h: 460 } }
        : null,
  }
}

describe("prompt-node run state persists in app data (ADR 0014 §9)", () => {
  test("the store keeps finished states per file, drops live counters and in-flight runs", () => {
    const storage = memoryStorage()
    const s = createPromptRunStore(storage)
    s.save("f1", "P1", {
      status: "idle",
      lastRun: { at: 5, ops: 12, costUsd: 0.04, billing: "api" },
      live: { ops: 3, costUsd: 0.01 },
    })
    s.save("f1", "P2", { status: "running", live: { ops: 1, costUsd: 0 } })
    s.save("f2", "P1", { status: "failed", error: { kind: "auth", message: "no key" } })
    expect(s.load("f1")).toEqual({
      P1: { status: "idle", lastRun: { at: 5, ops: 12, costUsd: 0.04, billing: "api" } },
    })
    expect(s.load("f2").P1?.error?.kind).toBe("auth")
    expect(Object.keys(JSON.parse(storage.m.get(PROMPT_RUNS_KEY) ?? "{}"))).toEqual([
      "f1/P1",
      "f2/P1",
    ])
    s.save("f1", "P1", null)
    expect(s.load("f1")).toEqual({})
    // A failed state's error is kept; an idle one never carries a stale error.
    expect(persistablePromptRun({ status: "idle", error: { kind: "x", message: "y" } })).toEqual({
      status: "idle",
    })
  })

  test("corrupt storage reads as empty", () => {
    const storage = memoryStorage()
    storage.setItem(PROMPT_RUNS_KEY, "{not json")
    expect(createPromptRunStore(storage).load("f1")).toEqual({})
  })

  test("a finished run is back after a reload (new controller, same file)", async () => {
    const storage = memoryStorage()
    const script: Script = (req, i) => {
      if (req.responseSchema) return { text: '{"title":"Cards"}' }
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
                  ],
                },
              },
            ],
          }
        : { text: "Done." }
    }
    const holder = { docId: "" }
    const first = setup(script, createPromptRunStore(storage))
    holder.docId = first.docId
    await first.c.refresh()
    await first.c.runPrompt(promptInput(first.store))
    const ran = first.c.state.promptRuns.Prompt0001
    expect(ran?.status).toBe("idle")
    expect(ran?.lastRun?.ops).toBe(1)
    first.c.dispose()

    const reloaded = setup(() => ({ text: "x" }), createPromptRunStore(storage), first.store)
    expect(reloaded.c.state.promptRuns.Prompt0001).toEqual({
      status: "idle",
      lastRun: ran?.lastRun as NonNullable<typeof ran>["lastRun"],
    })
  })

  test("a failure survives the reload too", async () => {
    const storage = memoryStorage()
    const { c, store } = setup(() => ({ text: "x" }), createPromptRunStore(storage))
    await c.refresh()
    const input = promptInput(store)
    await c.runPrompt({ ...input, prompt: { ...input.prompt, content: "  " } })
    const again = setup(() => ({ text: "x" }), createPromptRunStore(storage), store)
    expect(again.c.state.promptRuns.Prompt0001?.status).toBe("failed")
    expect(again.c.state.promptRuns.Prompt0001?.error?.message).toBe("The prompt is empty.")
  })
})

describe("side by side: variant placeholders are cleared at turn end (ADR 0014 §6)", () => {
  test("a built variant loses its flag; an empty one is removed and reads discarded", async () => {
    const holder = { docId: "" }
    const { c, store, docId } = setup((req) => {
      const frame = /your frame is (\w+)/i.exec(lastUserText(req))?.[1]
      const variant = /You are variant (\d+)/.exec(lastUserText(req))?.[1]
      // Variant 1 builds into its frame; variant 2 answers without touching the canvas.
      if (frame && variant === "1" && !req.messages.some((m) => m.role === "tool"))
        return {
          tools: [
            {
              name: "kimo_apply_ops",
              input: {
                docId: holder.docId,
                ops: [
                  {
                    op: "insert",
                    parent: frame,
                    node: { type: "rect", name: "Tier", x: 0, y: 0, w: 10, h: 10 },
                  },
                ],
              },
            },
          ],
        }
      return { text: "Variant done." }
    })
    holder.docId = docId
    await c.refresh()
    c.setMode({ ...c.state.composer.mode, mode: "side-by-side", agents: 2 })
    c.setSelection([{ id: "Pricing0001", name: "Pricing", type: "frame" }])
    await c.send("Pricing section, 3 tiers")
    const run = c.state.modeRun
    const [v1, v2] = (run?.agents ?? []).map((a) => a.scopeId as string)
    const built = store.getNode(v1 as string) as { placeholder?: unknown } | undefined
    expect(built).toBeDefined()
    expect(built?.placeholder).toBeUndefined()
    expect(store.hasNode(v2 as string)).toBe(false)
    expect(run?.agents[1]?.discarded).toBe(true)
    expect(run?.agents[0]?.discarded).toBeFalsy()
    // No frame on the page still carries a placeholder.
    const flagged = store
      .nodeIds()
      .filter((id) => (store.getNode(id) as { placeholder?: unknown }).placeholder !== undefined)
    expect(flagged).toEqual([])
  })
})

describe("Open skills folder (desktop reveals ~/.kimo/skills)", () => {
  test("desktop: the action calls platform.skills.reveal; web: no action", async () => {
    let revealed = 0
    const skills = {
      root: async () => "/Users/me/.kimo/skills",
      list: async () => [],
      read: async () => null,
      watch: () => () => {},
      reveal: async () => {
        revealed++
      },
    }
    const action = skillsFolderAction({ skills })
    expect(action).toBeDefined()
    action?.()
    await Promise.resolve()
    expect(revealed).toBe(1)
    expect(skillsFolderAction({})).toBeUndefined()
    const { reveal: _r, ...noReveal } = skills
    expect(skillsFolderAction({ skills: noReveal })).toBeUndefined()
  })

  test("the Skills menu hides the button without an action", async () => {
    const { c } = setup(() => ({ text: "x" }))
    await c.refresh()
    const html = (onOpenFolder?: () => void) =>
      renderToStaticMarkup(
        <SkillsMenu controller={c} state={c.state} {...(onOpenFolder ? { onOpenFolder } : {})} />,
      )
    expect(html(() => {})).toContain("Open skills folder")
    expect(html()).not.toContain("Open skills folder")
  })
})
