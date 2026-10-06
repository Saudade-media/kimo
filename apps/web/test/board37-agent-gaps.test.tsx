/**
 * Board 37 audit, agent scope (A8, F1, F2, F3, F6, F9, F11, F13, F14, A5): hosted-window session
 * rows and Undo all, failures reported (never swallowed), queued prompt runs, iterate Before /
 * After, stale Undo turn, the disabled stale activity Undo, host Redo, the skills menu's top row.
 */
import { describe, expect, test } from "bun:test"
import type { ProviderRequest } from "@kimo/ai-agent"
import type { KimoDocument } from "@kimo/core-schema"
import { createEmptyDocument, type DocStore, importDocument } from "@kimo/editor-state"
import type { McpActivityEntry } from "@kimo/platform"
import { ActivityRow } from "@kimo/ui"
import { createElement as h } from "react"
import { renderToString } from "react-dom/server"
import {
  type AgentPanelControllerExt,
  createAgentPanelController,
  createInWindowTools,
} from "../src/agent-panel"
import { visibleSkills } from "../src/agent-panel/Menus"
import { createTestRuntime, type Script } from "../src/agent-panel/testing"
import { type AgentsNotice, createAgentsController } from "../src/agents"
import { createScriptedMcpHost, sampleConnection } from "../src/agents/testing"

const ORIGIN = "mcp:claude-code.k3x9qa"
const FILE = "f1"
const PATH = "/Users/me/repo/design/home.kimo"

function pricingDoc(): KimoDocument {
  const d = createEmptyDocument("Pricing") as KimoDocument & { nodes: Record<string, unknown> }
  const frame = (id: string, name: string, parent: string | null, order: string, extra = {}) => {
    d.nodes[id] = { type: "frame", parent, order, name, x: 0, y: 0, w: 200, h: 120, ...extra }
  }
  frame("Pricing0001", "Pricing", null, "a0", { w: 640, h: 460 })
  frame("Card000001", "Card", "Pricing0001", "a0")
  frame("Card000002", "Team", "Pricing0001", "a1")
  frame("Prompt0001", "P1", null, "a2")
  frame("Prompt0002", "P2", null, "a3")
  return d
}

const entry = (over: Partial<McpActivityEntry> & { seq: number }): McpActivityEntry => ({
  time: 100_000,
  origin: ORIGIN,
  actor: "Claude Code",
  kind: "edit",
  tool: "kimo_apply_ops",
  summary: "Restyle cards",
  revision: { epoch: "k9abc", seq: 43 },
  nodeIds: ["Card000001"],
  undoToken: `u${over.seq}`,
  ...over,
})

const tick = () => new Promise((r) => setTimeout(r, 0))

/** A hosted (desktop) window: the agent's groups live in the document host, not in the store. */
async function hosted() {
  const store = importDocument(pricingDoc())
  const conn = sampleConnection({ docs: ["doc-1"], state: "idle", lastActivityAt: 0 })
  const host = createScriptedMcpHost({ connections: [conn] })
  const notices: AgentsNotice[] = []
  const c = createAgentsController({
    host,
    fileId: FILE,
    filePath: PATH,
    docId: "doc-1",
    store,
    now: () => 100_000,
    onError: (n) => notices.push(n),
  })
  await tick()
  await tick()
  return { store, host, c, notices }
}

describe("A8 / F1: hosted session popover lists the agent's logged edits", () => {
  test("rows from the activity log, Undo all replays them newest first through the host", async () => {
    const { host, c, notices } = await hosted()
    host.control.append(FILE, entry({ seq: 1, label: "Update Card" }))
    host.control.append(FILE, entry({ seq: 2, label: "Delete Team", nodeIds: ["Card000002"] }))
    const chip = c.state.chips[0]
    expect(chip?.session.groups).toHaveLength(0)
    expect(chip?.session.entries.map((e) => e.seq)).toEqual([1, 2])
    expect(chip?.session.rows.map((r) => r.op)).toEqual(["update", "delete"])
    expect(chip?.session.rows[1]?.tone).toBe("danger")
    const r = await c.undoAll(ORIGIN)
    expect(r).toEqual({ undone: 2, stale: 0 })
    expect(host.calls.filter((x) => x.startsWith("undo"))).toEqual([
      `undo ${ORIGIN} u2`,
      `undo ${ORIGIN} u1`,
    ])
    expect(notices).toEqual([])
    // Undone entries leave the session.
    expect(c.state.chips[0]?.session.entries ?? []).toHaveLength(0)
    c.dispose()
  })

  test("Keep commits the hosted session: the rows clear", async () => {
    const { host, c } = await hosted()
    host.control.append(FILE, entry({ seq: 1 }))
    expect(c.state.chips[0]?.session.entries).toHaveLength(1)
    c.keep(ORIGIN)
    expect(c.state.chips[0]?.session.entries ?? []).toHaveLength(0)
    c.dispose()
  })

  test("a stale entry in Undo all is reported, not dropped silently", async () => {
    const { host, c, notices } = await hosted()
    host.control.append(FILE, entry({ seq: 1 }))
    host.control.append(FILE, entry({ seq: 2 }))
    host.control.setUndo((_p, _o, t) => ({ ok: true, stale: t === "u1" }))
    const r = await c.undoAll(ORIGIN)
    expect(r).toEqual({ undone: 1, stale: 1 })
    expect(notices[0]?.text).toBe(
      "Couldn't undo 1 of 2 changes. The layers changed after the agent's edit, or Claude Code disconnected.",
    )
    c.dispose()
  })
})

describe("F14 / A5: failed agent actions roll back and are reported", () => {
  test("Pause with the host down: Paused rolls back, Toast/Danger with Retry", async () => {
    const { host, c, notices } = await hosted()
    host.control.append(FILE, entry({ seq: 1 }))
    host.clients.pause = async () => {
      throw new Error("the document host is not running")
    }
    await c.pause("claude-code")
    expect(c.state.chips[0]?.presence).not.toBe("paused")
    expect(notices[0]?.text).toBe("Couldn't pause Claude Code. The document host is not running.")
    expect(notices[0]?.action?.label).toBe("Retry")
    c.dispose()
  })

  test("Resume refused: the pause comes back", async () => {
    const { host, c, notices } = await hosted()
    host.control.append(FILE, entry({ seq: 1 }))
    await c.pause("claude-code")
    expect(c.state.chips[0]?.presence).toBe("paused")
    host.clients.resume = async () => {
      throw new Error("permission denied")
    }
    await c.resume("claude-code")
    expect(c.state.chips[0]?.presence).toBe("paused")
    expect(notices[0]?.text).toBe("Couldn't resume Claude Code. Permission denied.")
    c.dispose()
  })

  test("an approval answer that fails re-reads the queue and reports", async () => {
    const { host, c, notices } = await hosted()
    host.approvals.respond = async () => {
      throw new Error("the request expired")
    }
    await c.answer("gone", "once")
    expect(notices[0]?.text).toBe("Couldn't send your answer. The request expired.")
    c.dispose()
  })
})

describe("F11: Redo through the document host", () => {
  test("an undone entry redoes with kimo_history redo as its origin", async () => {
    const { host, c } = await hosted()
    host.control.append(FILE, entry({ seq: 1 }))
    const e = c.state.activity[0] as McpActivityEntry
    await c.undoEntry(e)
    expect(c.state.undone.has(1)).toBe(true)
    expect(c.redoEntry).not.toBeNull()
    const r = await c.redoEntry?.(e)
    expect(r).toEqual({ ok: true, stale: false })
    // The entry's own group: its token goes with the redo.
    expect(host.calls).toContain(`redo ${ORIGIN} u1`)
    expect(c.state.undone.has(1)).toBe(false)
    c.dispose()
  })
})

describe("F9: stale activity rows and hover", () => {
  test("a stale row's Undo renders disabled with a tooltip; a live one is enabled", () => {
    const base = { time: "10:47", label: "Restyle", tool: "kimo_apply_ops", target: "Card" }
    const stale = renderToString(h(ActivityRow, { ...base, stale: true }))
    expect(stale).toContain('aria-label="Undo (stale)"')
    expect(stale).toContain("disabled")
    expect(stale).toContain("Nothing to undo. The layers changed after this edit.")
    const live = renderToString(h(ActivityRow, { ...base, onUndo: () => {} }))
    expect(live).toContain('aria-label="Undo"')
    expect(live).not.toContain("disabled")
  })

  test("hover highlights every target of the entry", async () => {
    const { c } = await hosted()
    c.setHighlight(["Card000001", "Card000002"])
    expect(c.state.highlight).toEqual(["Card000001", "Card000002"])
    c.setHighlight(null)
    expect(c.state.highlight).toEqual([])
    c.dispose()
  })
})

// --- Agent tab controller -------------------------------------------------------------------------

const lastUserText = (req: ProviderRequest) => {
  const u = [...req.messages].reverse().find((m) => m.role === "user")
  return u?.role === "user" ? u.content.map((p) => (p.type === "text" ? p.text : "")).join("") : ""
}

function panel(
  script: Script,
  extra: Partial<Parameters<typeof createAgentPanelController>[0]> = {},
): { c: AgentPanelControllerExt; store: DocStore; docId: string } {
  const store = importDocument(pricingDoc())
  const tools = createInWindowTools({ store, path: "/u/me/Pricing.kimo" })
  const rt = createTestRuntime({ tools: tools.factory, script })
  const c = createAgentPanelController({
    runtime: rt,
    fileId: "f-pricing",
    fileName: "Pricing.kimo",
    docId: () => tools.docId(),
    nodeName: (id) => (store.getNode(id) as { name?: string } | undefined)?.name,
    ...extra,
  })
  return { c, store, docId: tools.docId() }
}

const nameOf = (store: DocStore, id: string) =>
  (store.getNode(id) as unknown as { name: string }).name

const promptInput = (id: string, content: string) => ({
  prompt: { id, content, box: { x: 0, y: 0, w: 200, h: 120 }, target: "Card000001" },
  notes: [],
  frame: (fid: string) => ({ id: fid, box: { x: 0, y: 0, w: 200, h: 120 } }),
})

describe("F2: Run N prompts queues them", () => {
  test("a second prompt waits for the first (running), then runs; none fails as busy", async () => {
    const seen: string[] = []
    const { c } = panel((req) => {
      if (req.responseSchema) return { text: '{"title":"Run"}' }
      seen.push(lastUserText(req))
      return { text: "Done." }
    })
    await c.refresh()
    const first = c.runPrompt(promptInput("Prompt0001", "First prompt."))
    await c.runPrompt(promptInput("Prompt0002", "Second prompt."))
    // Queued behind the first: shown as running, not failed.
    expect(c.state.promptRuns.Prompt0002?.status).toBe("running")
    await first
    expect(c.state.promptRuns.Prompt0001?.status).toBe("idle")
    expect(c.state.promptRuns.Prompt0002?.status).toBe("idle")
    expect(seen.some((t) => t.includes("First prompt."))).toBe(true)
    expect(seen.some((t) => t.includes("Second prompt."))).toBe(true)
  })

  test("Stop on a queued prompt takes it out of the queue", async () => {
    const { c } = panel((req) =>
      req.responseSchema ? { text: '{"title":"Run"}' } : { text: "Ok." },
    )
    await c.refresh()
    const first = c.runPrompt(promptInput("Prompt0001", "First prompt."))
    await c.runPrompt(promptInput("Prompt0002", "Second prompt."))
    c.stopPrompt("Prompt0002")
    expect(c.state.promptRuns.Prompt0002).toBeUndefined()
    await first
    expect(c.state.promptRuns.Prompt0002).toBeUndefined()
  })
})

describe("F3: iterate Before / After", () => {
  test("Before undoes the current pass on the canvas, After puts it back", async () => {
    const holder = { docId: "" }
    let n = 0
    const { c, store, docId } = panel((req) => {
      const toolsDone = req.messages.slice(-1)[0]?.role === "tool"
      if (!toolsDone && lastUserText(req).startsWith("Iterate pass"))
        return {
          tools: [
            {
              name: "kimo_apply_ops",
              input: {
                docId: holder.docId,
                ops: [{ op: "update", id: "Card000001", set: { name: `Card p${++n}` } }],
              },
            },
          ],
        }
      return { text: `Pass ${n} done.` }
    })
    holder.docId = docId
    await c.refresh()
    c.setMode({ ...c.state.composer.mode, mode: "iterate", passes: 2 })
    c.setSelection([{ id: "Card000001", name: "Card" }])
    await c.send("Make it premium")
    expect(nameOf(store, "Card000001")).toBe("Card p1")
    expect(c.state.modeRun?.iterate?.view).toBe("after")
    await c.setIterateView("before")
    expect(c.state.modeRun?.iterate?.view).toBe("before")
    expect(nameOf(store, "Card000001")).toBe("Card")
    await c.setIterateView("after")
    expect(c.state.modeRun?.iterate?.view).toBe("after")
    expect(nameOf(store, "Card000001")).toBe("Card p1")
    // A decision taken while showing Before first returns to the pass's result.
    await c.setIterateView("before")
    await c.review({ action: "next" })
    expect(nameOf(store, "Card000001")).toBe("Card p2")
  })
})

describe("F6: Undo turn / Regenerate that can't run say so", () => {
  test("a later turn on top makes Undo turn of the earlier one stale: the message shows why", async () => {
    const holder = { docId: "" }
    let v = 0
    const { c, store, docId } = panel((req) =>
      req.responseSchema
        ? { text: '{"title":"Rename"}' }
        : req.messages.slice(-1)[0]?.role !== "tool"
          ? {
              tools: [
                {
                  name: "kimo_apply_ops",
                  input: {
                    docId: holder.docId,
                    ops: [{ op: "update", id: "Card000001", set: { name: `Card v${++v}` } }],
                  },
                },
              ],
            }
          : { text: "Done." },
    )
    holder.docId = docId
    await c.refresh()
    await c.send("Rename the card")
    const turn = c.state.messages.find((m) => m.kind === "agent")
    if (turn?.kind !== "agent") throw new Error("no agent message")
    // A second turn lands on top of the first one's group.
    await c.send("Rename it again")
    const after = nameOf(store, "Card000001")
    expect(after).toBe("Card v2")
    const r = await c.undoTurn(turn.turnId)
    expect(r.ok && !r.stale).toBe(false)
    expect(c.state.undoneTurns).not.toContain(turn.turnId)
    expect(c.state.turnIssues[turn.turnId]).toMatch(/^Couldn't undo this turn\. /)
    expect(nameOf(store, "Card000001")).toBe(after)
  })

  test("session history failures are reported through onError", async () => {
    const errors: string[] = []
    const { c } = panel(() => ({ text: "x" }), { onError: (t) => errors.push(t) })
    await c.openSession("missing")
    expect(errors).toEqual(["Couldn't open this session. It is no longer in the history."])
  })
})

describe("F13: the skills menu's top row is the one Enter picks", () => {
  test("the composer and the menu share one filter (includes, Built-in first)", () => {
    const state = {
      composer: { slash: { filter: "brand" } },
      skills: {
        builtin: [{ name: "kimo-design" }, { name: "rebrand" }],
        user: [{ name: "brand-voice" }],
      },
    } as unknown as Parameters<typeof visibleSkills>[0]
    expect(visibleSkills(state).map((s) => s.name)).toEqual(["rebrand", "brand-voice"])
  })
})
