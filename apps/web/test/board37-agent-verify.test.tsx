/**
 * Board 37 audit, agent scope, verifier round: Before / After any number of times and Revert
 * after a toggle (F3), Regenerate after Undo turn (F6), iterate Review row Revert (F12), host
 * Redo / Undo order (F11, A8 / F9), and the agent-panel actions that used to fail silently (A5:
 * error-card links, Discard variant, Use <CLI>).
 */
import { describe, expect, test } from "bun:test"
import type { ProviderRequest, ToolHost } from "@kimo/ai-agent"
import type { KimoDocument } from "@kimo/core-schema"
import { createEmptyDocument, type DocStore, importDocument } from "@kimo/editor-state"
import type { McpActivityEntry } from "@kimo/platform"
import { createElement as h } from "react"
import { renderToString } from "react-dom/server"
import {
  type AgentPanelControllerExt,
  createAgentPanelController,
  createInWindowTools,
} from "../src/agent-panel"
import type { AgentPanelRuntime } from "../src/agent-panel/runtime"
import { createTestRuntime, type Script } from "../src/agent-panel/testing"
import { AgentActivityPanel, type AgentsNotice, createAgentsController } from "../src/agents"
import { createScriptedMcpHost, sampleConnection } from "../src/agents/testing"

function pricingDoc(): KimoDocument {
  const d = createEmptyDocument("Pricing") as KimoDocument & { nodes: Record<string, unknown> }
  const frame = (id: string, name: string, parent: string | null, order: string, extra = {}) => {
    d.nodes[id] = { type: "frame", parent, order, name, x: 0, y: 0, w: 200, h: 120, ...extra }
  }
  frame("Pricing0001", "Pricing", null, "a0", { w: 640, h: 460 })
  frame("Card000001", "Card", "Pricing0001", "a0")
  frame("Card000002", "Team", "Pricing0001", "a1")
  return d
}

const lastUserText = (req: ProviderRequest) => {
  const u = [...req.messages].reverse().find((m) => m.role === "user")
  return u?.role === "user" ? u.content.map((p) => (p.type === "text" ? p.text : "")).join("") : ""
}

interface PanelOpts {
  rt?: Partial<AgentPanelRuntime>
  /** kimo_history answers this instead (a refused undo). */
  refuseHistory?: () => boolean
}

function panel(script: Script, opts: PanelOpts = {}) {
  const store = importDocument(pricingDoc())
  const tools = createInWindowTools({ store, path: "/u/me/Pricing.kimo" })
  const factory = (spec: Parameters<typeof tools.factory>[0]): ToolHost => {
    const t = tools.factory(spec)
    return {
      ...t,
      tools: () => t.tools(),
      ...(t.stream ? { stream: (c: { id: string; name: string }) => t.stream?.(c) } : {}),
      call: (c, s) =>
        c.name === "kimo_history" && opts.refuseHistory?.()
          ? Promise.resolve({
              result: {
                ok: false,
                errors: [{ code: "INVALID_INPUT", message: "Unknown undo token." }],
              },
            } as never)
          : t.call(c, s),
    }
  }
  const rt = { ...createTestRuntime({ tools: factory, script }), ...opts.rt }
  const errors: string[] = []
  const c: AgentPanelControllerExt = createAgentPanelController({
    runtime: rt,
    fileId: "f-pricing",
    fileName: "Pricing.kimo",
    docId: () => tools.docId(),
    nodeName: (id) => (store.getNode(id) as { name?: string } | undefined)?.name,
    parentOf: (id) => (store.getNode(id) as { parent?: string | null } | undefined)?.parent ?? null,
    frameBox: (id) => {
      const n = store.getNode(id) as
        | { name: string; x: number; y: number; w: number; h: number }
        | undefined
      return n ? { id, name: n.name, x: n.x, y: n.y, w: n.w, h: n.h } : null
    },
    onError: (t) => errors.push(t),
  })
  return { c, store, docId: tools.docId(), errors }
}

const nameOf = (store: DocStore, id: string) =>
  (store.getNode(id) as unknown as { name: string }).name

/** One iterate pass renames the card ("Card p1", "Card p2", …). */
async function iterate(passes = 2) {
  const holder = { docId: "" }
  let n = 0
  const p = panel((req) => {
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
  holder.docId = p.docId
  await p.c.refresh()
  p.c.setMode({ ...p.c.state.composer.mode, mode: "iterate", passes })
  p.c.setSelection([{ id: "Card000001", name: "Card" }])
  await p.c.send("Make it premium")
  return p
}

describe("F3: Before / After any number of times; Revert after a toggle", () => {
  test("Before, After, Before, After each switch the canvas", async () => {
    const { c, store } = await iterate()
    expect(nameOf(store, "Card000001")).toBe("Card p1")
    for (let i = 0; i < 3; i++) {
      await c.setIterateView("before")
      expect(c.state.modeRun?.iterate?.view).toBe("before")
      expect(nameOf(store, "Card000001")).toBe("Card")
      await c.setIterateView("after")
      expect(c.state.modeRun?.iterate?.view).toBe("after")
      expect(nameOf(store, "Card000001")).toBe("Card p1")
    }
    expect(c.state.modeRun?.iterate?.issue).toBeUndefined()
  })

  test("Revert after Before / After puts the original back", async () => {
    const { c, store } = await iterate()
    await c.setIterateView("before")
    await c.setIterateView("after")
    await c.review({ action: "revert", toPass: 0 })
    expect(nameOf(store, "Card000001")).toBe("Card")
    expect(c.state.modeRun?.iterate?.pass).toBe(0)
    expect(c.state.modeRun?.iterate?.issue).toBeUndefined()
  })

  test("a refused Revert says so and keeps the pass", async () => {
    let refuse = false
    const holder = { docId: "" }
    const p = panel(
      (req) =>
        req.messages.slice(-1)[0]?.role !== "tool" && lastUserText(req).startsWith("Iterate pass")
          ? {
              tools: [
                {
                  name: "kimo_apply_ops",
                  input: {
                    docId: holder.docId,
                    ops: [{ op: "update", id: "Card000001", set: { name: "Card p1" } }],
                  },
                },
              ],
            }
          : { text: "Done." },
      { refuseHistory: () => refuse },
    )
    holder.docId = p.docId
    await p.c.refresh()
    p.c.setMode({ ...p.c.state.composer.mode, mode: "iterate", passes: 2 })
    p.c.setSelection([{ id: "Card000001", name: "Card" }])
    await p.c.send("Make it premium")
    refuse = true
    await p.c.review({ action: "revert", toPass: 0 })
    const it = p.c.state.modeRun?.iterate
    expect(it?.pass).toBe(1)
    expect(it?.passes.length).toBe(1)
    expect(it?.issue).toMatch(/^Couldn't revert to the original\. /)
    expect(nameOf(p.store, "Card000001")).toBe("Card p1")
  })
})

describe("F12: Revert on an iterate Review card row", () => {
  test("the row reverts its op group; Before / After skip the reverted group", async () => {
    const { c, store } = await iterate()
    const it = c.state.modeRun?.iterate
    const row = it?.rows[0]
    expect(row?.undoToken).toBeString()
    // The Review card renders the row's Revert icon.
    const { ReviewCard } = await import("../src/agent-panel/Modes")
    const html = renderToString(h(ReviewCard, { controller: c, run: c.state.modeRun as never }))
    expect(html).toContain('aria-label="Revert')
    await c.revertOp(row?.key as string)
    expect(nameOf(store, "Card000001")).toBe("Card")
    expect(c.state.modeRun?.iterate?.rows[0]?.reverted).toBe(true)
    await c.setIterateView("before")
    await c.setIterateView("after")
    expect(nameOf(store, "Card000001")).toBe("Card")
    expect(c.state.modeRun?.iterate?.issue).toBeUndefined()
  })
})

describe("F12: Mode Summary pill copy", () => {
  test("iterate review reads the pass, not an agent count; Stop all hides while nothing runs", async () => {
    const { c } = await iterate()
    const { ModeSummaryOverlay } = await import("../src/agent-panel/Modes")
    const html = renderToString(h(ModeSummaryOverlay, { controller: c }))
    expect(html).toContain("Iterate · pass 1 of 2 · review")
    expect(html).not.toContain("agents")
    expect(html).not.toContain("Stop all")
  })
  test("one agent reads singular; several read plural", async () => {
    const { modeSummaryLabel } = await import("../src/agent-panel/Modes")
    const row = { origin: "a", state: "done" } as never
    const run = (mode: "split" | "side-by-side", n: number, done: number) =>
      ({ mode, agents: Array.from({ length: n }, () => row), done }) as never
    expect(modeSummaryLabel(run("split", 1, 0))).toBe("Split · 1 agent · 0 done")
    expect(modeSummaryLabel(run("side-by-side", 3, 1))).toBe("Side by side · 3 agents · 1 done")
  })
})

describe("F6: Regenerate after Undo turn", () => {
  test("resends the prompt without undoing again", async () => {
    const holder = { docId: "" }
    let v = 0
    const p = panel((req) =>
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
    holder.docId = p.docId
    await p.c.refresh()
    await p.c.send("Rename the card")
    const turn = p.c.state.messages.find((m) => m.kind === "agent")
    if (turn?.kind !== "agent") throw new Error("no agent message")
    const r = await p.c.undoTurn(turn.turnId)
    expect(r).toEqual({ ok: true, stale: false })
    expect(nameOf(p.store, "Card000001")).toBe("Card")
    await p.c.regenerate(turn.turnId)
    expect(p.c.state.turnIssues[turn.turnId]).toBeUndefined()
    expect(nameOf(p.store, "Card000001")).toBe("Card v2")
  })
})

describe("A5: agent-panel actions report their failures", () => {
  test("the error card's Get desktop / Provider matrix links report a failed open", async () => {
    const p = panel(() => ({ text: "x" }), {
      rt: { openLink: () => Promise.reject(new Error("No browser.")) },
    })
    p.c.cardAction("t1", "get_desktop")
    p.c.cardAction("t1", "provider_matrix")
    await new Promise((r) => setTimeout(r, 0))
    expect(p.errors).toEqual([
      "Couldn't open https://kimo.design/docs/getting-started/. No browser.",
      "Couldn't open https://kimo.design/docs/built-in-agent/#api-providers. No browser.",
    ])
  })

  test("Use <CLI> reports a failed settings write and keeps the model", async () => {
    const p = panel(() => ({ text: "x" }), {
      rt: {
        clis: () =>
          [
            {
              id: "claude-code",
              label: "Claude Code",
              installed: true,
              path: "/x",
              signedIn: true,
            },
          ] as never,
        chooseCli: () => Promise.reject(new Error("The settings file is read-only.")),
      },
    })
    await p.c.refresh()
    const before = p.c.state.composer.model
    await p.c.chooseCli("claude-code")
    expect(p.errors).toEqual(["Couldn't use Claude Code. The settings file is read-only."])
    expect(p.c.state.composer.model).toEqual(before)
  })

  test("Discard variant keeps the row when the undo is refused", async () => {
    let refuse = false
    const holder = { docId: "" }
    const p = panel(
      (req) => {
        const frame = /your frame is (\w+)/i.exec(lastUserText(req))?.[1]
        if (frame && !req.messages.some((m) => m.role === "tool"))
          return {
            tools: [
              {
                name: "kimo_apply_ops",
                input: {
                  docId: holder.docId,
                  ops: [
                    {
                      op: "insert",
                      key: "t",
                      parent: frame,
                      node: { type: "rect", name: "Tier", x: 0, y: 0, w: 10, h: 10 },
                    },
                  ],
                },
              },
            ],
          }
        return { text: "Variant done." }
      },
      { refuseHistory: () => refuse },
    )
    holder.docId = p.docId
    await p.c.refresh()
    p.c.setMode({ ...p.c.state.composer.mode, mode: "side-by-side", agents: 2 })
    p.c.setSelection([{ id: "Pricing0001", name: "Pricing", type: "frame" }])
    await p.c.send("Pricing section, 3 tiers")
    const row = p.c.state.modeRun?.agents[1]
    refuse = true
    await p.c.discardVariant(row?.origin as string)
    expect(p.c.state.modeRun?.agents[1]?.discarded).toBeFalsy()
    expect(p.store.hasNode(row?.scopeId as string)).toBe(true)
    expect(p.c.state.modeRun?.issue).toMatch(/^Couldn't discard /)
    refuse = false
    await p.c.discardVariant(row?.origin as string)
    expect(p.c.state.modeRun?.agents[1]?.discarded).toBe(true)
    expect(p.c.state.modeRun?.issue).toBeUndefined()
  })
})

// --- Activity log (desktop host history) ----------------------------------------------------------

const ORIGIN = "mcp:claude-code.k3x9qa"
const FILE = "f1"
const entry = (seq: number, label: string): McpActivityEntry => ({
  seq,
  time: 100_000,
  origin: ORIGIN,
  actor: "Claude Code",
  kind: "edit",
  tool: "kimo_apply_ops",
  summary: label,
  label,
  revision: { epoch: "k9abc", seq: 40 + seq },
  nodeIds: ["Card000001"],
  undoToken: `u${seq}`,
})
const tick = () => new Promise((r) => setTimeout(r, 0))

async function hosted() {
  const store = importDocument(pricingDoc())
  const conn = sampleConnection({ docs: ["doc-1"], state: "idle", lastActivityAt: 0 })
  const host = createScriptedMcpHost({ connections: [conn] })
  const notices: AgentsNotice[] = []
  const c = createAgentsController({
    host,
    fileId: FILE,
    filePath: "/Users/me/repo/design/home.kimo",
    docId: "doc-1",
    store,
    now: () => 100_000,
    onError: (n) => notices.push(n),
  })
  await tick()
  await tick()
  host.control.append(FILE, entry(1, "Edit 1"))
  host.control.append(FILE, entry(2, "Edit 2"))
  const [a, b] = c.state.activity as [McpActivityEntry, McpActivityEntry]
  return { host, c, notices, a, b }
}

describe("A8 / F9: Undo on a row that is not the agent's newest edit", () => {
  test("says to undo the newer edits first and keeps the row undoable", async () => {
    const { host, c, notices, a, b } = await hosted()
    host.control.setUndo((_p, _o, t) =>
      t === "u1"
        ? { ok: false, stale: false, conflict: true, message: "x" }
        : { ok: true, stale: false },
    )
    await c.undoEntry(a)
    expect(notices.map((n) => n.text)).toEqual([
      "Couldn't undo “Edit 1”. Undo the newer edits from Claude Code first.",
    ])
    expect(c.state.stale.has(1)).toBe(false)
    host.control.setUndo(() => ({ ok: true, stale: false }))
    await c.undoEntry(b)
    await c.undoEntry(a)
    expect([...c.state.undone].sort()).toEqual([1, 2])
    c.dispose()
  })
})

describe("F11: Redo only on the last undone entry, with its token", () => {
  test("Redo shows on the top of the redo stack and replays that group", async () => {
    const { host, c, notices, a, b } = await hosted()
    await c.undoEntry(b)
    await c.undoEntry(a)
    // A was undone last: only A can redo now.
    expect([...c.state.redoable]).toEqual([1])
    const html = renderToString(h(AgentActivityPanel as never, { controller: c } as never))
    expect(html.match(/aria-label="Redo"/g)?.length ?? 0).toBe(1)
    const refused = await c.redoEntry?.(b)
    expect(refused?.ok).toBe(false)
    expect(notices.at(-1)?.text).toBe(
      "Couldn't redo “Edit 2”. Redo the edit you undid last from Claude Code first.",
    )
    expect(host.calls).not.toContain(`redo ${ORIGIN} u2`)
    expect(await c.redoEntry?.(a)).toEqual({ ok: true, stale: false })
    expect(host.calls).toContain(`redo ${ORIGIN} u1`)
    expect([...c.state.redoable]).toEqual([2])
    expect(await c.redoEntry?.(b)).toEqual({ ok: true, stale: false })
    expect(c.state.undone.size).toBe(0)
    // Redone entries undo again with the same token.
    await c.undoEntry(b)
    expect(c.state.undone.has(2)).toBe(true)
    expect(c.state.stale.size).toBe(0)
    c.dispose()
  })

  test("a new edit of the agent clears its redo stack", async () => {
    const { host, c, b } = await hosted()
    await c.undoEntry(b)
    expect([...c.state.redoable]).toEqual([2])
    host.control.append(FILE, entry(3, "Edit 3"))
    expect(c.state.redoable.size).toBe(0)
    c.dispose()
  })
})
