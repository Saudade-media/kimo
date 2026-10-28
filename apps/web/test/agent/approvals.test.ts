/**
 * Approval rules: what the built-in agent may do outside its scope, what auto-approve is allowed
 * to approve, and the per-client MCP auto-approve option.
 */
import { describe, expect, test } from "bun:test"
import { importDocument } from "@kimo/editor-state"
import type { ActivityEntry } from "@kimo/mcp-server"
import { createMemoryMcpHost, type McpApprovalRequest } from "@kimo/platform"
import { createAgentPanelController, createInWindowTools } from "../../src/agent-panel"
import { createTestRuntime, type Script } from "../../src/agent-panel/testing"
import { approvalChoices } from "../../src/platform/contract"
import { nameOf, pricingDoc, until } from "./helpers"

function setup(script: Script) {
  const store = importDocument(pricingDoc())
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
    nodeName: (id) => nameOf(store, id),
    parentOf: (id) => (store.getNode(id) as { parent?: string | null } | undefined)?.parent ?? null,
  })
  return { c, store, docId: tools.docId(), activity }
}

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

describe("built-in agent scope", () => {
  test("an op outside the selection asks; denying rolls the whole batch back", async () => {
    const holder = { docId: "" }
    const { c, store, docId } = setup((_r, i) =>
      i === 0
        ? {
            tools: [
              {
                name: "kimo_apply_ops",
                input: {
                  docId: holder.docId,
                  ops: [
                    { op: "update", id: "Card000001", set: { name: "Card ok" } },
                    { op: "update", id: "Navbar0001", set: { name: "Nope" } },
                  ],
                },
              },
            ],
          }
        : { text: "I can only edit inside Card." },
    )
    holder.docId = docId
    await c.refresh()
    c.setSelection(card)
    c.setAutoApprove(false) // "Ask before changes" on
    const sending = c.send("Rename things")
    await until(() => c.state.approval !== null)
    expect(c.state.approval?.choices).toEqual(["deny", "once"])
    await c.answerApproval(c.state.approval?.request.id as string, "deny")
    await sending
    expect(nameOf(store, "Card000001")).toBe("Card")
    expect(nameOf(store, "Navbar0001")).toBe("Navbar")
    const a = c.state.messages.find((m) => m.kind === "agent")
    if (a?.kind !== "agent") throw new Error("no agent message")
    expect(a.steps[0]?.state).toBe("failed")
    expect(a.steps[0]?.errorCode).toBe("PERMISSION_DENIED")
  })

  test("file and out-of-scope approvals cannot be granted for the whole session", () => {
    const req = (reason: McpApprovalRequest["reason"]): McpApprovalRequest => ({
      id: "ap1",
      client: { client: "codex", label: "Codex", session: "q7w2er", transport: "http" },
      tool: "kimo_apply_ops",
      reason,
      summary: "x",
      requestedAt: 0,
      expiresAt: 1,
    })
    expect(approvalChoices(req({ kind: "destructive", ops: ["delete"], nodeIds: ["n"] }))).toEqual([
      "deny",
      "session",
      "once",
    ])
    expect(approvalChoices(req({ kind: "file", path: "/tmp/x.kimo", action: "open" }))).toEqual([
      "deny",
      "once",
    ])
    expect(approvalChoices(req({ kind: "scope", nodeIds: ["n"] }))).toEqual(["deny", "once"])
  })
})

describe("built-in agent auto-approve", () => {
  test("on: an out-of-area edit is approved at once and recorded in the thread and activity", async () => {
    const holder = { docId: "" }
    const { c, store, docId, activity } = setup(outOfScope(holder))
    holder.docId = docId
    await c.refresh()
    c.setAutoApprove(true)
    c.setSelection(card)
    await c.send("Rename the navbar")
    expect(c.state.approvals).toHaveLength(0)
    expect(nameOf(store, "Navbar0001")).toBe("Nav 0")
    const a = c.state.messages.find((m) => m.kind === "agent")
    if (a?.kind !== "agent") throw new Error("no agent message")
    expect(a.autoApproved).toHaveLength(1)
    expect(activity.find((e) => e.kind === "approval")?.outcome).toBe("auto")
  })

  test("off: it asks, and turning it on approves the pending card so the run continues", async () => {
    const holder = { docId: "" }
    const { c, store, docId } = setup(outOfScope(holder))
    holder.docId = docId
    await c.refresh()
    c.setAutoApprove(false)
    c.setSelection(card)
    const sending = c.send("Rename the navbar")
    await until(() => c.state.approvals.length === 1)
    expect(nameOf(store, "Navbar0001")).toBe("Navbar")
    c.setAutoApprove(true)
    expect(c.state.approvals).toHaveLength(0)
    await sending
    expect(nameOf(store, "Navbar0001")).toBe("Nav 0")
  })
})

describe("MCP client auto-approve", () => {
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
    autoApprove: false,
  }

  test("it persists in the policy and approves only the waiting prompts of that client", async () => {
    const host = createMemoryMcpHost({ policies: { codex: pol } })
    const resolved: string[] = []
    host.approvals.onResolved((id, o) => resolved.push(`${id}:${o}`))
    host.control.request(req("a", "codex"))
    host.control.request(req("b", "claude-code"))
    await host.policies.set("codex", { ...pol, autoApprove: true })
    expect((await host.policies.list()).codex?.autoApprove).toBe(true)
    expect(resolved).toEqual(["a:auto"])
    expect(host.approvals.pending().map((r) => r.id)).toEqual(["b"])
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
