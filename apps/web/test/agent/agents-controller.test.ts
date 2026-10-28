/**
 * The window's view of MCP clients and in-app agents (AgentsController over McpHostApi and a
 * DocStore): what a session changed, undoing an agent's edits as a unit, pausing a client and
 * answering its approval prompts.
 */
import { describe, expect, test } from "bun:test"
import type { KimoDocument } from "@kimo/core-schema"
import { createEmptyDocument, importDocument } from "@kimo/editor-state"
import type { McpActivityEntry, McpApprovalRequest } from "@kimo/platform"
import { type AgentsNotice, createAgentsController, sessionOps } from "../../src/agents"
import { createScriptedMcpHost, sampleConnection } from "../../src/agents/testing"
import { tick } from "./helpers"

const ORIGIN = "mcp:claude-code.k3x9qa"
const FILE = "f1"
const PATH = "/Users/me/repo/design/home.kimo"

function pricingDoc(): KimoDocument {
  const d = createEmptyDocument("Pricing") as KimoDocument & { nodes: Record<string, unknown> }
  const frame = (id: string, name: string, parent: string | null, order: string, extra = {}) => {
    d.nodes[id] = { type: "frame", parent, order, name, x: 0, y: 0, w: 136, h: 220, ...extra }
  }
  frame("Pricing0001", "Pricing Desktop", null, "a0", { w: 520, h: 420, fill: "#FFFFFF" })
  frame("Cards00001", "Cards", "Pricing0001", "a0", { w: 440 })
  frame("Card000001", "Card 1", "Cards00001", "a0", { fill: "#F4F1EC" })
  frame("Card000002", "Card 2", "Cards00001", "a1", { fill: "#F4F1EC", radius: 12 })
  frame("Card000003", "Card 3", "Cards00001", "a2", { fill: "#F4F1EC" })
  d.nodes.Divider001 = {
    type: "rect",
    parent: "Pricing0001",
    order: "a1",
    name: "Divider",
    x: 0,
    y: 0,
    w: 440,
    h: 1,
  }
  return d
}

const entry = (seq: number, over: Partial<McpActivityEntry> = {}): McpActivityEntry => ({
  seq,
  time: 100_000,
  origin: ORIGIN,
  actor: "Claude Code",
  kind: "edit",
  tool: "kimo_apply_ops",
  summary: `Edit ${seq}`,
  label: `Edit ${seq}`,
  revision: { epoch: "k9abc", seq: 40 + seq },
  nodeIds: ["Card000001"],
  undoToken: `u${seq}`,
  ...over,
})

describe("session ops from the op log", () => {
  test("groups the origin's edits, leaves the user's out; undo pops the top group, keep commits", () => {
    const store = importDocument(pricingDoc())
    const o = { origin: ORIGIN } as const
    expect(
      store.apply({ op: "update", id: "Card000002", set: { fill: "#E9DFCF", radius: 20 } }, o).ok,
    ).toBe(true)
    expect(
      store.apply(
        [
          {
            op: "insert",
            id: "Popular001",
            node: {
              type: "frame",
              parent: "Card000002",
              name: "Popular",
              x: 0,
              y: 0,
              w: 57,
              h: 19,
            },
          },
          {
            op: "insert",
            id: "PopLabel01",
            node: {
              type: "text",
              parent: "Popular001",
              name: "Label",
              x: 0,
              y: 0,
              content: "Popular",
            },
          },
        ],
        o,
      ).ok,
    ).toBe(true)
    expect(store.apply({ op: "delete", id: "Divider001" }, o).ok).toBe(true)
    expect(
      store.apply({ op: "update", id: "Card000001", set: { name: "Free" } }, { origin: "user" }).ok,
    ).toBe(true)

    const s = sessionOps(store.log(), ORIGIN, -1, store)
    expect(s.groups.length).toBe(3)
    expect(s.rows.map((r) => r.op)).toEqual(["update", "update", "insert", "delete"])
    expect(s.rows.map((r) => r.group)).toEqual([0, 0, 1, 2])
    expect([...s.touched].sort()).toEqual(["Card000002", "PopLabel01", "Popular001"])

    store.undo(ORIGIN)
    expect(sessionOps(store.log(), ORIGIN, -1, store).groups.length).toBe(2)
    const keep = sessionOps(store.log(), ORIGIN, -1, store).after?.seq ?? 0
    expect(sessionOps(store.log(), ORIGIN, keep, store).rows).toEqual([])
  })
})

describe("controller over an in-process store", () => {
  async function setup() {
    const store = importDocument(pricingDoc())
    const conn = sampleConnection({ docs: ["doc-1"], state: "idle", lastActivityAt: 0 })
    const host = createScriptedMcpHost({ connections: [conn] })
    const c = createAgentsController({
      host,
      fileId: FILE,
      filePath: PATH,
      docId: "doc-1",
      store,
      // The test store owns the agent's undo stack (in-process host).
      hostHistory: false,
      now: () => 100_000,
    })
    await tick(0)
    await tick(0)
    return { store, host, c }
  }

  test("undo top, undo all and a guarded undo entry; an entry with nothing left to undo is stale", async () => {
    const { store, host, c } = await setup()
    store.apply({ op: "update", id: "Card000002", set: { fill: "#E9DFCF" } }, { origin: ORIGIN })
    store.apply({ op: "update", id: "Card000003", set: { fill: "#E9DFCF" } }, { origin: ORIGIN })
    host.control.append(FILE, entry(30, { nodeIds: ["Card000002", "Card000003"] }))
    expect(c.state.chips[0]?.session.groups.length).toBe(2)
    await c.undoTop(ORIGIN)
    expect(c.state.chips[0]?.session.groups.length).toBe(1)
    const r = await c.undoAll(ORIGIN)
    expect(r.undone).toBe(1)
    expect((store.getNode("Card000002") as { fill?: unknown }).fill).toBe("#F4F1EC")
    const e = c.state.activity.at(-1) as McpActivityEntry
    const res = await c.undoEntry(e)
    expect(res.ok).toBe(false)
    expect(c.state.stale.has(30)).toBe(true)
    c.dispose()
  })

  test("pausing a client is a real pause in the host, not a policy change", async () => {
    const { host, c } = await setup()
    host.control.append(FILE, entry(20))
    await c.pause("claude-code")
    expect(host.calls).toContain("pause claude-code")
    expect(host.control.policies["claude-code"]).toBeUndefined()
    expect(await host.clients.paused()).toEqual(["claude-code"])
    await c.resume("claude-code")
    expect(await host.clients.paused()).toEqual([])
    c.dispose()
  })

  test("approval prompts queue oldest first and each answer goes back to the host", async () => {
    const { host, c } = await setup()
    const approval = (id: string, requestedAt: number): McpApprovalRequest => ({
      id,
      client: {
        client: "claude-code",
        label: "Claude Code",
        session: "k3x9qa",
        transport: "socket",
      },
      tool: "kimo_apply_ops",
      path: PATH,
      reason: { kind: "destructive", ops: ["delete"], nodeIds: ["Card000001"] },
      summary: "Replace hero",
      preview: { inserted: 0, updated: 0, deleted: 1, nodeIds: ["Card000001"] },
      requestedAt,
      expiresAt: requestedAt + 120_000,
    })
    host.control.request(approval("b", 5))
    host.control.request(approval("a", 2))
    expect(c.state.prompt?.request.id).toBe("a")
    expect(c.state.prompt?.queued).toBe(2)
    await c.answer("a", "once")
    expect(host.calls).toContain("respond a once")
    expect(c.state.prompt?.request.id).toBe("b")
    host.control.resolve("b", "timeout")
    expect(c.state.prompt).toBeNull()
    c.dispose()
  })
})

describe("controller over the document host's history", () => {
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
    await tick(0)
    await tick(0)
    return { host, c, notices }
  }

  test("Undo all replays the agent's logged edits newest first through the host", async () => {
    const { host, c, notices } = await hosted()
    host.control.append(FILE, entry(1))
    host.control.append(FILE, entry(2))
    expect(c.state.chips[0]?.session.entries.map((e) => e.seq)).toEqual([1, 2])
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

  test("a stale entry in Undo all is reported, not dropped silently", async () => {
    const { host, c, notices } = await hosted()
    host.control.append(FILE, entry(1))
    host.control.append(FILE, entry(2))
    host.control.setUndo((_p, _o, t) => ({ ok: true, stale: t === "u1" }))
    const r = await c.undoAll(ORIGIN)
    expect(r).toEqual({ undone: 1, stale: 1 })
    expect(notices.length).toBeGreaterThan(0)
    c.dispose()
  })

  test("undoing an entry that is not the agent's newest says so and keeps it undoable", async () => {
    const { host, c, notices } = await hosted()
    host.control.append(FILE, entry(1))
    host.control.append(FILE, entry(2))
    const [a, b] = c.state.activity as [McpActivityEntry, McpActivityEntry]
    host.control.setUndo((_p, _o, t) =>
      t === "u1"
        ? { ok: false, stale: false, conflict: true, message: "x" }
        : { ok: true, stale: false },
    )
    await c.undoEntry(a)
    expect(notices).toHaveLength(1)
    expect(c.state.stale.has(1)).toBe(false)
    host.control.setUndo(() => ({ ok: true, stale: false }))
    await c.undoEntry(b)
    await c.undoEntry(a)
    expect([...c.state.undone].sort()).toEqual([1, 2])
    c.dispose()
  })

  test("Redo works only on the last undone entry, with that entry's token", async () => {
    const { host, c, notices } = await hosted()
    host.control.append(FILE, entry(1))
    host.control.append(FILE, entry(2))
    const [a, b] = c.state.activity as [McpActivityEntry, McpActivityEntry]
    await c.undoEntry(b)
    await c.undoEntry(a)
    // A was undone last: only A can redo now.
    expect([...c.state.redoable]).toEqual([1])
    const noticed = notices.length
    const refused = await c.redoEntry?.(b)
    expect(refused?.ok).toBe(false)
    expect(notices.length).toBe(noticed + 1)
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
    const { host, c } = await hosted()
    host.control.append(FILE, entry(1))
    host.control.append(FILE, entry(2))
    const b = c.state.activity[1] as McpActivityEntry
    await c.undoEntry(b)
    expect([...c.state.redoable]).toEqual([2])
    host.control.append(FILE, entry(3))
    expect(c.state.redoable.size).toBe(0)
    c.dispose()
  })
})
