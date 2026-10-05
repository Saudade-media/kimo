/**
 * Board 34 "Auto-approve" (aHEIi): the built-in agent's per-session switch, its thread lines and
 * activity rows, the MCP client option over the scripted host, and the approval prompt's
 * many-changes grouping.
 */
import { describe, expect, test } from "bun:test"
import type { KimoDocument } from "@kimo/core-schema"
import { createEmptyDocument, type DocStore, importDocument } from "@kimo/editor-state"
import type { ActivityEntry } from "@kimo/mcp-server"
import { createMemoryMcpHost, type McpApprovalRequest } from "@kimo/platform"
import { createAgentPanelController, createInWindowTools } from "../src/agent-panel"
import { autoApprovalLine } from "../src/agent-panel/approval"
import { createTestRuntime, type Script } from "../src/agent-panel/testing"
import { autoApproveCopy } from "../src/agents/AutoApproveConfirm"
import {
  APPROVAL_FLAT_MAX,
  APPROVAL_PER_KIND,
  activityRowView,
  approvalTargets,
  groupApprovalTargets,
} from "../src/agents/model"

function doc(): KimoDocument {
  const d = createEmptyDocument("Pricing page") as KimoDocument & {
    nodes: Record<string, unknown>
  }
  const frame = (id: string, name: string, parent: string | null, order: string) => {
    d.nodes[id] = { type: "frame", parent, order, name, x: 0, y: 0, w: 200, h: 120 }
  }
  frame("Pricing0001", "Pricing", null, "a0")
  frame("Card000001", "Card", "Pricing0001", "a1")
  frame("Navbar0001", "Navbar", null, "a1")
  return d
}

function setup(script: Script) {
  const store = importDocument(doc())
  const tools = createInWindowTools({ store, path: "/u/me/Pricing page.kimo" })
  const activity: Omit<ActivityEntry, "seq">[] = []
  const rt = createTestRuntime({
    tools: (spec) => tools.factory({ ...spec, onActivity: (e) => activity.push(e) }),
    script,
  })
  const c = createAgentPanelController({
    runtime: rt,
    fileId: "f-pricing",
    fileName: "Pricing page.kimo",
    docId: () => tools.docId(),
    nodeName: (id) => (store.getNode(id) as { name?: string } | undefined)?.name,
    parentOf: (id) => (store.getNode(id) as { parent?: string | null } | undefined)?.parent ?? null,
  })
  return { c, store, docId: tools.docId(), rt, activity }
}

const until = async (cond: () => boolean, ms = 3000) => {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timeout")
    await new Promise((r) => setTimeout(r, 5))
  }
}

const nameOf = (store: DocStore, id: string) =>
  (store.getNode(id) as { name?: string } | undefined)?.name

/** One turn that renames a layer outside the Card scope (Single mode asks: scope). */
const outOfScope =
  (holder: { docId: string }): Script =>
  (req, i) =>
    req.responseSchema
      ? { text: '{"title":"Rename"}' }
      : i % 2 === 0
        ? {
            tools: [
              {
                name: "kimo_apply_ops",
                input: {
                  docId: holder.docId,
                  ops: [{ op: "update", id: "Navbar0001", set: { name: `Nav ${i}` } }],
                },
              },
            ],
          }
        : { text: "Renamed the navbar." }

const card = [{ id: "Card000001", name: "Card", type: "frame" }]

describe("built-in agent: per-session auto-approve", () => {
  test("off by default; an out-of-area edit asks", async () => {
    const holder = { docId: "" }
    const { c, docId } = setup(outOfScope(holder))
    holder.docId = docId
    await c.refresh()
    expect(c.state.autoApprove).toBe(false)
    c.setSelection(card)
    const sending = c.send("Rename the navbar")
    await until(() => c.state.approvals.length === 1)
    await c.answerApproval(c.state.approvals[0]?.request.id as string, "deny")
    await sending
  })

  test("on: the request is approved at once, a thread line and an activity row record it", async () => {
    const holder = { docId: "" }
    const { c, store, docId, activity } = setup(outOfScope(holder))
    holder.docId = docId
    await c.refresh()
    c.setAutoApprove(true)
    expect(c.state.autoApprove).toBe(true)
    c.setSelection(card)
    await c.send("Rename the navbar")
    expect(c.state.approvals).toHaveLength(0)
    expect(nameOf(store, "Navbar0001")).toBe("Nav 0")
    const a = c.state.messages.find((m) => m.kind === "agent")
    if (a?.kind !== "agent") throw new Error()
    expect(a.autoApproved).toEqual(["Approved automatically: edited 1 layer outside its area"])
    const row = activity.find((e) => e.kind === "approval")
    expect(row?.outcome).toBe("auto")
    // The Activity tab reads it in warning: "<tool> · approved automatically".
    const view = activityRowView({ ...(row as Omit<ActivityEntry, "seq">), seq: 1 }, (id) => id)
    expect(view.tool).toBe("kimo_apply_ops · approved automatically")
    expect(view.tone).toBe("warning")
  })

  test("turning it on approves the pending cards; the run continues", async () => {
    const holder = { docId: "" }
    const { c, store, docId } = setup(outOfScope(holder))
    holder.docId = docId
    await c.refresh()
    c.setSelection(card)
    const sending = c.send("Rename the navbar")
    await until(() => c.state.approvals.length === 1)
    c.setAutoApprove(true)
    expect(c.state.approvals).toHaveLength(0)
    await sending
    expect(nameOf(store, "Navbar0001")).toBe("Nav 0")
    const a = c.state.messages.find((m) => m.kind === "agent")
    if (a?.kind !== "agent") throw new Error()
    expect(a.autoApproved).toHaveLength(1)
  })

  test("a new session starts off; a reopened one too, with its lines kept", async () => {
    const holder = { docId: "" }
    const { c, docId } = setup(outOfScope(holder))
    holder.docId = docId
    await c.refresh()
    c.setAutoApprove(true)
    c.setSelection(card)
    await c.send("Rename the navbar")
    const id = c.state.session?.id as string
    c.newSession()
    expect(c.state.autoApprove).toBe(false)
    c.setAutoApprove(true)
    await c.openSession(id)
    expect(c.state.autoApprove).toBe(false)
    const a = c.state.messages.find((m) => m.kind === "agent")
    if (a?.kind !== "agent") throw new Error()
    expect(a.autoApproved).toEqual(["Approved automatically: edited 1 layer outside its area"])
  })

  test("turning it off asks again", async () => {
    const holder = { docId: "" }
    const { c, docId } = setup(outOfScope(holder))
    holder.docId = docId
    await c.refresh()
    c.setAutoApprove(true)
    c.setAutoApprove(false)
    c.setSelection(card)
    const sending = c.send("Rename the navbar")
    await until(() => c.state.approvals.length === 1)
    c.stop()
    await sending
  })
})

describe("thread line per request kind", () => {
  const base = {
    id: "r1",
    client: { client: "kimo", label: "Kimo", session: "s", transport: "in-process" as const },
    tool: "kimo_save",
    summary: "x",
    requestedAt: 0,
    expiresAt: 1,
  }
  const line = (r: Partial<McpApprovalRequest>) =>
    autoApprovalLine({ ...base, ...r } as McpApprovalRequest, {
      name: (id) => ({ A: "Hero", B: "Card", P: "Pricing" })[id],
      parentName: () => "Pricing",
    })
  test("files: open, create, save, export", () => {
    expect(line({ reason: { kind: "file", path: "/u/site/landing.kimo", action: "save" } })).toBe(
      "Approved automatically: saved landing.kimo",
    )
    expect(line({ reason: { kind: "file", path: "/u/a.kimo", action: "open" } })).toBe(
      "Approved automatically: opened a.kimo",
    )
    expect(line({ reason: { kind: "file", path: "/u/b.kimo", action: "create" } })).toBe(
      "Approved automatically: created b.kimo",
    )
    expect(line({ reason: { kind: "file", path: "/u/site/exports/", action: "export" } })).toBe(
      "Approved automatically: exported to exports/",
    )
  })
  test("grants: document-wide changes, save, export, files.create", () => {
    expect(line({ reason: { kind: "grant", grant: "globals" } })).toBe(
      "Approved automatically: changed global variables",
    )
    expect(line({ reason: { kind: "grant", grant: "components" } })).toBe(
      "Approved automatically: changed components",
    )
    expect(line({ reason: { kind: "grant", grant: "save" }, path: "/u/landing.kimo" })).toBe(
      "Approved automatically: saved landing.kimo",
    )
    expect(line({ reason: { kind: "grant", grant: "export" } })).toBe(
      "Approved automatically: exported",
    )
    expect(line({ reason: { kind: "grant", grant: "files.create" } })).toBe(
      "Approved automatically: created a file",
    )
  })
  test("edits: out of area, deletes from the dry run", () => {
    expect(line({ reason: { kind: "scope", nodeIds: ["A", "B"] } })).toBe(
      "Approved automatically: edited 2 layers outside its area",
    )
    expect(
      line({
        reason: { kind: "destructive", ops: ["delete"], nodeIds: ["A"] },
        preview: { inserted: 0, updated: 0, deleted: 3, nodeIds: ["A", "B"] },
      }),
    ).toBe("Approved automatically: deleted 3 layers in Pricing")
  })
})

describe("confirm copy (k0K1nN)", () => {
  test("says what it covers, what stays undoable and what is still enforced", () => {
    const own = autoApproveCopy()
    expect(own.title).toBe("Turn on auto-approve?")
    expect(own.impact).toHaveLength(4)
    expect(own.impact.join(" ")).toContain("Kimo can't undo a file it wrote")
    expect(own.impact[3]).toContain("40 new layers per edit")
    const mcp = autoApproveCopy("Codex")
    expect(mcp.title).toBe("Turn on auto-approve for Codex?")
  })
})

describe("MCP client option over the scripted host", () => {
  const req = (id: string, client: string): McpApprovalRequest => ({
    id,
    client: { client, label: client, session: "s1", transport: "socket" },
    tool: "kimo_export",
    reason: { kind: "grant", grant: "export" },
    summary: "x",
    requestedAt: 0,
    expiresAt: 120_000,
  })
  const pol = {
    level: "edit" as const,
    files: [],
    nodes: [],
    grants: [],
    onExceed: "ask" as const,
    confirmDestructive: true,
  }

  test("autoApprove persists in the policy and approves waiting prompts of that client", async () => {
    const host = createMemoryMcpHost({ policies: { codex: pol } })
    const resolved: string[] = []
    host.approvals.onResolved((id, o) => resolved.push(`${id}:${o}`))
    const changes: string[] = []
    host.policies.onChange?.((client, p) => changes.push(`${client}:${p?.autoApprove ?? false}`))
    host.control.request(req("a", "codex"))
    host.control.request(req("b", "claude-code"))
    await host.policies.set("codex", { ...pol, autoApprove: true })
    expect((await host.policies.list()).codex?.autoApprove).toBe(true)
    expect(resolved).toEqual(["a:auto"])
    expect(host.approvals.pending().map((r) => r.id)).toEqual(["b"])
    expect(changes).toEqual(["codex:true"])
    // A grant-gated request (export) never shows a prompt while it is on.
    host.control.request(req("c", "codex"))
    expect(resolved).toEqual(["a:auto", "c:auto"])
    expect(host.approvals.pending().map((r) => r.id)).toEqual(["b"])
  })

  test("a client set to deny never gets prompts approved", async () => {
    const host = createMemoryMcpHost({
      policies: { codex: { ...pol, onExceed: "deny", autoApprove: true } },
    })
    host.control.request(req("a", "codex"))
    expect(host.approvals.pending()).toHaveLength(1)
  })
})

describe("approval with many changes (board 34 §4)", () => {
  const many = (n: number): McpApprovalRequest => {
    const ids = Array.from({ length: n }, (_, i) => `N${String(i).padStart(9, "0")}`)
    const kinds: Record<string, "insert" | "update" | "delete"> = {}
    ids.forEach((id, i) => {
      kinds[id] = i < n * 0.6 ? "delete" : i < n * 0.9 ? "insert" : "update"
    })
    return {
      id: "r",
      client: { client: "codex", label: "Codex", session: "s", transport: "socket" },
      tool: "kimo_apply_ops",
      reason: { kind: "destructive", ops: ["delete"], nodeIds: [] },
      summary: "Replace hero",
      preview: {
        deleted: Math.round(n * 0.6),
        inserted: Math.round(n * 0.3),
        updated: n - Math.round(n * 0.6) - Math.round(n * 0.3),
        nodeIds: ids,
        kinds,
      },
      requestedAt: 0,
      expiresAt: 1,
    }
  }

  test("a short list stays flat", () => {
    const r = many(APPROVAL_FLAT_MAX)
    expect(groupApprovalTargets(r, approvalTargets(r))).toBeNull()
  })

  test("200 changes: grouped by kind, 3 rows each, the rest counted; Show all lists them", () => {
    const r = many(200)
    const rows = approvalTargets(r)
    const g = groupApprovalTargets(r, rows) ?? []
    expect(g.map((x) => [x.label, x.total, x.rows.length, x.more])).toEqual([
      ["Delete", 120, APPROVAL_PER_KIND, 117],
      ["Insert", 60, APPROVAL_PER_KIND, 57],
      ["Update", 20, APPROVAL_PER_KIND, 17],
    ])
    const all = groupApprovalTargets(r, rows, true) ?? []
    expect(all.map((x) => [x.rows.length, x.more])).toEqual([
      [120, 0],
      [60, 0],
      [20, 0],
    ])
  })
})
