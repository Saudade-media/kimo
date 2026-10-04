import { describe, expect, test } from "bun:test"
import {
  askKimoToFinish,
  finishMessage,
  placeholderSession,
  resumeAgentSession,
  resumeMessage,
} from "../src/agent-panel/resume"
import {
  canvasMenuModel,
  type MenuNodeReader,
  type MenuOwnerSession,
} from "../src/editor/context-menu"

type N = Record<string, unknown>
const docOf = (nodes: Record<string, N>): MenuNodeReader => ({ getNode: (id) => nodes[id] })

const OWNER = "agent:kimo.abc123.0"
const nodes: Record<string, N> = {
  page: { type: "frame", name: "Page" },
  pricing: { type: "frame", name: "Pricing" },
  note1: { type: "note", content: "warmer", parent: "page" },
  note2: { type: "note", content: "cta" },
  note3: { type: "note", content: "x" },
  card: { type: "frame", name: "Card", component: { props: {} } },
  noteInMain: { type: "note", content: "y", parent: "card" },
  prompt: { type: "prompt", content: "Draft 3 cards", target: "pricing" },
  prompt2: { type: "prompt", content: "Hero" },
  live: { type: "frame", name: "Live", placeholder: { by: OWNER } },
  orphan: { type: "frame", name: "Pricing", placeholder: { by: "agent:kimo.zzz999.0" } },
  mcp: { type: "frame", name: "MCP", placeholder: { by: "mcp:claude-code" } },
  locked: { type: "rect", locked: true },
}
const base = {
  doc: docOf(nodes),
  live: new Set([OWNER]),
  agent: true,
  ownerSession: (owner: string | undefined): MenuOwnerSession | null =>
    owner === "agent:kimo.zzz999.0" ? { sessionId: "zzz999", ordinal: 3 } : null,
}
const labels = (sel: string[], extra: Partial<typeof base> = {}) => {
  const m = canvasMenuModel({ ...base, ...extra, selection: sel })
  return m
    ? {
        agent: m.agent.map((r) => (r.meta ? `${r.label} [${r.meta}]` : r.label)),
        standard: m.standard.map((r) => r.label),
        danger: m.danger.map((r) => r.label),
      }
    : null
}

describe("board 25 §3 canvas context menu model", () => {
  test("nothing selected → no menu", () => {
    expect(labels([])).toBeNull()
  })
  test("standard items: Duplicate ⌘D · Bring to front · Lock, then Delete ⌫ (danger)", () => {
    const m = canvasMenuModel({ ...base, selection: ["pricing"] })
    expect(m?.agent).toEqual([])
    expect(m?.standard.map((r) => [r.label, r.meta ?? null])).toEqual([
      ["Duplicate", "⌘D"],
      ["Bring to front", null],
      ["Lock", null],
    ])
    expect(m?.danger.map((r) => [r.label, r.meta, r.tone])).toEqual([["Delete", "⌫", "danger"]])
    expect(labels(["locked"])?.standard).toContain("Unlock")
  })
  test("note → Convert to prompt (sparkles, agent tone); 3 notes → 'Convert 3 to prompts'", () => {
    const m = canvasMenuModel({ ...base, selection: ["note1"] })
    expect(m?.agent.map((r) => [r.label, r.icon, r.tone])).toEqual([
      ["Convert to prompt", "sparkles", "agent"],
    ])
    expect(labels(["note1", "note2", "note3"])?.agent).toEqual(["Convert 3 to prompts"])
  })
  test("notes inside a component main or an instance get no agent items", () => {
    expect(labels(["noteInMain"])?.agent).toEqual([])
    expect(
      labels(["note2"], { inInstance: (id: string) => id === "note2" } as never)?.agent,
    ).toEqual([])
  })
  test("mixed selection → only the standard items (every node must support it)", () => {
    expect(labels(["note1", "prompt"])?.agent).toEqual([])
    expect(labels(["note1", "pricing"])?.agent).toEqual([])
  })
  test("prompt → Run prompt (play) · Set as target (crosshair, meta = target name or —)", () => {
    const m = canvasMenuModel({ ...base, selection: ["prompt"] })
    expect(m?.agent.map((r) => [r.label, r.icon, r.meta ?? null])).toEqual([
      ["Run prompt", "play", null],
      ["Set as target", "crosshair", "Pricing"],
    ])
    expect(labels(["prompt2"])?.agent).toEqual(["Run prompt", "Set as target [—]"])
    expect(labels(["prompt", "prompt2"])?.agent).toEqual(["Run 2 prompts"])
    // No AI controller: Run needs the agent, Set as target does not.
    expect(labels(["prompt"], { agent: false })?.agent).toEqual(["Set as target [Pricing]"])
  })
  test("live placeholder → Clear flag only", () => {
    const m = canvasMenuModel({ ...base, selection: ["live"] })
    expect(m?.agent.map((r) => [r.label, r.icon])).toEqual([["Clear flag", "flag-off"]])
  })
  test("orphaned placeholder → Resume agent (AgentMark, 'session 3' sans) + Clear flag", () => {
    const m = canvasMenuModel({ ...base, selection: ["orphan"] })
    expect(m?.agent.map((r) => [r.label, r.icon, r.meta ?? null, r.metaFont ?? null])).toEqual([
      ["Resume agent", "agent-mark", "session 3", "sans"],
      ["Clear flag", "flag-off", null, null],
    ])
    expect(m?.agent[0]?.action).toEqual({ kind: "resume", frame: "orphan", sessionId: "zzz999" })
  })
  test("orphan whose session is gone (or an MCP owner) → Ask Kimo to finish + Clear flag", () => {
    expect(
      labels(["orphan"], { ownerSession: () => ({ sessionId: "zzz999", ordinal: null }) })?.agent,
    ).toEqual(["Ask Kimo to finish", "Clear flag"])
    expect(labels(["mcp"])?.agent).toEqual(["Ask Kimo to finish", "Clear flag"])
    expect(labels(["mcp"], { agent: false })?.agent).toEqual(["Clear flag"])
  })
})

/** A controller double over the public API the resume helpers use. */
function fakeController(sessions: { id: string; createdAt: number }[]) {
  const calls: string[] = []
  const state = {
    session: null as { id: string } | null,
    sessions: { thisFile: sessions, otherFiles: [], query: "" },
  }
  const c = {
    state,
    calls,
    async openSession(id: string) {
      calls.push(`open:${id}`)
      if (sessions.some((s) => s.id === id)) state.session = { id }
    },
    async send(text: string) {
      calls.push(`send:${text}`)
    },
    newSession() {
      calls.push("new")
      state.session = null
    },
    setText(t: string) {
      calls.push(`text:${t}`)
    },
    setFocused(f: boolean) {
      calls.push(`focus:${f}`)
    },
  }
  return c
}

describe("board 25 §3 resume API (agent-panel/resume.ts)", () => {
  const sessions = [
    { id: "c3", createdAt: 30 },
    { id: "a1", createdAt: 10 },
    { id: "b2", createdAt: 20 },
  ]
  test("placeholderSession: 'session N' counts this file's sessions oldest first", () => {
    const c = fakeController(sessions)
    expect(placeholderSession(c as never, "agent:kimo.c3.0")).toEqual({
      sessionId: "c3",
      ordinal: 3,
    })
    expect(placeholderSession(c as never, "agent:kimo.b2.2")).toEqual({
      sessionId: "b2",
      ordinal: 2,
    })
    expect(placeholderSession(c as never, "agent:kimo.gone.0")).toEqual({
      sessionId: "gone",
      ordinal: null,
    })
    expect(placeholderSession(c as never, "mcp:cursor")).toBeNull()
    expect(placeholderSession(c as never, undefined)).toBeNull()
  })
  test("resumeAgentSession opens the owning session and sends the continuation", async () => {
    const c = fakeController(sessions)
    expect(await resumeAgentSession(c as never, "b2", "Pricing")).toBe(true)
    expect(c.calls).toEqual(["open:b2", `send:${resumeMessage("Pricing")}`])
  })
  test("a deleted session is not resumed (the caller falls back to Ask Kimo to finish)", async () => {
    const c = fakeController(sessions)
    expect(await resumeAgentSession(c as never, "gone", "Pricing")).toBe(false)
    expect(c.calls).toEqual(["open:gone"])
    askKimoToFinish(c as never, "Pricing")
    expect(c.calls.slice(1)).toEqual(["new", `text:${finishMessage("Pricing")}`, "focus:true"])
  })
})
