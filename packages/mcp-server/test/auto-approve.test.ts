/**
 * Board 34 auto-approve for MCP clients: a policy with `autoApprove` approves every request it
 * would ask for (outcome `auto`, logged), including grant-gated tools and files outside the
 * allow-list. Hard limits that are errors, not prompts, still apply.
 */
import { describe, expect, test } from "bun:test"
import { createMemoryPlatform } from "@kimo/platform/memory"
import {
  type ActivityEntry,
  AGENT_MAX_NEW_LAYERS,
  ApprovalBroker,
  type ApprovalRequest,
  ASK_POLICY,
  approvedOutcome,
  authorize,
  autoApproves,
  type ClientPolicy,
  createMemoryDocumentHost,
  createStubHandlers,
  DEFAULT_POLICY,
  type DocumentHost,
  dispatch,
  emptyAllowances,
  kimoCreate,
  kimoExport,
  kimoSave,
  protectedPath,
  type ToolContext,
  type WireOp,
} from "../src/index"
import { validateInput } from "../src/server"

const policy = (p: Partial<ClientPolicy> = {}): ClientPolicy => ({ ...ASK_POLICY, ...p })
const del = { docId: "d_abc_k9", ops: [{ op: "delete", id: "Abcdef1234" }] }

function ctx(p: ClientPolicy, log: Omit<ActivityEntry, "seq">[]): ToolContext {
  return {
    identity: { client: "codex", label: "Codex", session: "abc123", transport: "socket" },
    origin: "mcp:codex.abc123",
    policy: p,
    allowances: emptyAllowances(),
    host: {} as DocumentHost,
    requestApproval: async () => {
      throw new Error("auto-approve must not prompt")
    },
    recordActivity: (e) => log.push(e),
    signal: new AbortController().signal,
    now: () => 1000,
    newId: () => "ap_1",
  }
}

describe("auto-approve policy", () => {
  test("autoApproves needs autoApprove and onExceed ask; approvedOutcome covers auto", () => {
    expect(autoApproves(policy())).toBe(false)
    expect(autoApproves(policy({ autoApprove: true }))).toBe(true)
    expect(autoApproves(policy({ autoApprove: true, onExceed: "deny" }))).toBe(false)
    expect(approvedOutcome("auto")).toBe(true)
    expect(approvedOutcome("once")).toBe(true)
    expect(approvedOutcome("deny")).toBe(false)
    expect(approvedOutcome("timeout")).toBe(false)
  })

  test("connected clients are trusted by default; Ask before changes turns it off", () => {
    expect(autoApproves(DEFAULT_POLICY)).toBe(true)
    expect(autoApproves(ASK_POLICY)).toBe(false)
  })

  test("Read only and protected paths are refused, not auto-approved", async () => {
    const cases: [ClientPolicy, string, Record<string, unknown>, string][] = [
      [policy({ autoApprove: true, level: "read" }), "kimo_apply_ops", del, "Read only"],
      [
        policy({ autoApprove: true }),
        "kimo_open",
        { path: "/Users/me/.ssh/x.kimo" },
        "system or hidden folder",
      ],
      [policy({ autoApprove: true }), "kimo_open", { path: "/etc/x.kimo" }, "system or hidden"],
    ]
    for (const [p, tool, input, says] of cases) {
      const log: Omit<ActivityEntry, "seq">[] = []
      const path = typeof input.path === "string" ? input.path : undefined
      const out = await dispatch(tool, input, ctx(p, log), createStubHandlers(), {
        validate: () => [],
        targets: async () => (path ? { path } : {}),
      })
      expect(out.result.ok).toBe(false)
      if (!out.result.ok) {
        expect(out.result.errors[0]?.code).toBe("PERMISSION_DENIED")
        expect(out.result.errors[0]?.message).toContain(says)
      }
      expect(log.some((e) => e.kind === "approval")).toBe(false)
      expect(log.find((e) => e.kind === "denied")?.tool).toBe(tool)
    }
  })

  test("protectedPath: system and hidden folders, not ~/.kimo or ordinary folders", () => {
    for (const p of [
      "/etc/hosts",
      "/private/etc/x.kimo",
      "/usr/local/x.kimo",
      "/System/x.kimo",
      "/Library/LaunchDaemons/x.kimo",
      "/Users/me/.ssh/id",
      "/Users/me/.config/x.kimo",
      "/Users/me/repo/.env",
      "C:/Windows/x.kimo",
      "c:/Program Files/x.kimo",
    ])
      expect(protectedPath(p)).toBe(true)
    for (const p of [
      "/Users/me/repo/design/home.kimo",
      "/Users/me/Library/Mobile Documents/x.kimo",
      "/Users/me/.kimo/cli-workspaces/s1/x.kimo",
      "/private/var/folders/ab/T/x.kimo",
      "/tmp/out",
      "C:/Users/me/Documents/x.kimo",
    ])
      expect(protectedPath(p)).toBe(false)
  })

  test("every reason kind that asks is approved without a prompt and logged as auto", async () => {
    const auto = policy({ autoApprove: true, grants: [], files: [] })
    const cases: [string, Record<string, unknown>, Parameters<typeof dispatch>[4]["targets"]][] = [
      // destructive
      ["kimo_apply_ops", del, async () => ({})],
      // file outside the allow-list
      ["kimo_open", { path: "/Users/me/x.kimo" }, async () => ({ path: "/Users/me/x.kimo" })],
      // node scope
      [
        "kimo_apply_ops",
        { docId: "d_abc_k9", ops: [{ op: "update", id: "Abcdef1234", set: { name: "x" } }] },
        async () => ({ outOfScope: ["Abcdef1234"] }),
      ],
      // grant-gated tools: save, export, files.create
      [
        "kimo_save",
        { docId: "d_abc_k9" },
        async () => ({ path: "/a.kimo", pathAlreadyOpen: true }),
      ],
      ["kimo_export", { docId: "d_abc_k9", format: "png", outDir: "/out" }, async () => ({})],
      ["kimo_create", { path: "/repo/new.kimo" }, async () => ({ path: "/repo/new.kimo" })],
    ]
    for (const [tool, input, targets] of cases) {
      const log: Omit<ActivityEntry, "seq">[] = []
      const out = await dispatch(tool, input, ctx(auto, log), createStubHandlers(), {
        validate: () => [],
        targets,
      })
      // The stub handler ran (UNSUPPORTED), so authorization let it through.
      expect(out.result.ok).toBe(false)
      if (!out.result.ok) expect(out.result.errors[0]?.code).toBe("UNSUPPORTED")
      const approval = log.find((e) => e.kind === "approval")
      expect(approval?.outcome).toBe("auto")
      expect(approval?.tool).toBe(tool)
    }
  })

  test("grant-gated tools ask without the grant (so auto-approve is what lets them run)", () => {
    const ctxA = { policy: policy({ grants: [] }), allowances: emptyAllowances() }
    for (const def of [kimoSave, kimoExport, kimoCreate]) {
      const a = authorize(def, {}, ctxA)
      expect(a.kind).toBe("ask")
      if (a.kind === "ask") expect(a.reason.kind).toBe("grant")
    }
  })

  test("onExceed deny still denies: auto-approve only replaces prompts", async () => {
    const log: Omit<ActivityEntry, "seq">[] = []
    const out = await dispatch(
      "kimo_apply_ops",
      del,
      ctx(policy({ autoApprove: true, onExceed: "deny" }), log),
      createStubHandlers(),
      { validate: () => [], targets: async () => ({}) },
    )
    expect(out.result.ok).toBe(false)
    if (!out.result.ok) expect(out.result.errors[0]?.code).toBe("PERMISSION_DENIED")
    expect(log[0]?.kind).toBe("denied")
  })

  test("broker approveWhere resolves matching prompts as auto, oldest first", async () => {
    const b = new ApprovalBroker("ask", 60_000)
    const req = (id: string, session: string, at: number): ApprovalRequest => ({
      id,
      client: { client: "codex", label: "Codex", session, transport: "socket" },
      tool: "kimo_apply_ops",
      reason: { kind: "destructive", ops: ["delete"], nodeIds: [] },
      summary: "x",
      requestedAt: at,
      expiresAt: at + 60_000,
    })
    const resolved: string[] = []
    b.onResolved((id, o) => resolved.push(`${id}:${o}`))
    const p1 = b.request(req("b", "s1", 2))
    const p2 = b.request(req("a", "s1", 1))
    const p3 = b.request(req("c", "s2", 3))
    expect(b.approveWhere((r) => r.client.session === "s1")).toBe(2)
    expect(await p1).toBe("auto")
    expect(await p2).toBe("auto")
    expect(resolved).toEqual(["a:auto", "b:auto"])
    expect(b.pending().map((r) => r.id)).toEqual(["c"])
    b.dispose()
    expect(await p3).toBe("disconnected")
  })
})

describe("auto-approve in the host runtime", () => {
  function setup() {
    const platform = createMemoryPlatform({ pid: 3100, files: {} })
    const log: ActivityEntry[] = []
    const host = createMemoryDocumentHost({
      platform,
      autosaveMs: 0,
      validate: validateInput,
      approvals: "ask",
      clientPolicy: policy({ level: "edit+delete", files: ["/w/**"], grants: ["files.create"] }),
      onActivity: (_f, e) => log.push(e),
    })
    return { host, log }
  }

  test("turning it on approves the client's waiting prompt; the edit lands", async () => {
    const { host, log } = setup()
    const conn = host.runtime.connect({ client: "codex", label: "Codex", transport: "socket" })
    const created = await conn.call("kimo_create", { path: "/w/a.kimo", template: "blank" })
    expect(created.result.ok).toBe(true)
    const docId = (created.result as { data: { doc: { id: string } } }).data.doc.id
    const ins = await conn.call("kimo_apply_ops", {
      docId,
      ops: [
        {
          op: "insert",
          key: "f",
          parent: "root",
          node: { type: "frame", name: "F", x: 0, y: 0, w: 10, h: 10 },
        },
      ],
    })
    expect(ins.result.ok).toBe(true)
    const id = (ins.result as { changed?: string[] }).changed?.[0] as string
    // Deletes ask (confirmDestructive): the call waits on the broker.
    const waiting = conn.call("kimo_apply_ops", { docId, ops: [{ op: "delete", id }] })
    await new Promise((r) => setTimeout(r, 10))
    expect(host.runtime.approvals.pending()).toHaveLength(1)
    // Settings › Agents & MCP turns auto-approve on for codex.
    host.runtime.setClientPolicy("codex", { ...conn.policy, autoApprove: true })
    const out = await waiting
    expect(out.result.ok).toBe(true)
    expect(host.runtime.approvals.pending()).toHaveLength(0)
    expect(log.some((e) => e.kind === "approval" && e.outcome === "auto")).toBe(true)
    // Later deletes never ask.
    const again = await conn.call("kimo_apply_ops", {
      docId,
      ops: [
        {
          op: "insert",
          key: "g",
          parent: "root",
          node: { type: "frame", name: "G", x: 0, y: 0, w: 10, h: 10 },
        },
      ],
    })
    const gid = (again.result as { changed?: string[] }).changed?.[0] as string
    const del2 = await conn.call("kimo_apply_ops", { docId, ops: [{ op: "delete", id: gid }] })
    expect(del2.result.ok).toBe(true)
    expect(host.runtime.approvals.pending()).toHaveLength(0)
    await host.dispose()
  })

  test("hard limits still apply: batch size and path checks are errors, not prompts", async () => {
    const { host } = setup()
    const conn = host.runtime.connect(
      { client: "codex", label: "Codex", transport: "socket" },
      {
        policy: policy({
          level: "edit+delete",
          files: [],
          grants: [],
          autoApprove: true,
        }),
      },
    )
    // Outside the allow-list and without files.create: approved automatically…
    const created = await conn.call("kimo_create", { path: "/x/a.kimo", template: "blank" })
    expect(created.result.ok).toBe(true)
    const docId = (created.result as { data: { doc: { id: string } } }).data.doc.id
    // …but the path must still end in .kimo.
    const bad = await conn.call("kimo_create", { path: "/x/a.txt", template: "blank" })
    expect(bad.result.ok).toBe(false)
    if (!bad.result.ok) expect(bad.result.errors[0]?.code).toBe("INVALID_INPUT")
    // 41 new layers in one call: BATCH_TOO_LARGE, nothing asks or applies.
    const ops: WireOp[] = [
      {
        op: "insert",
        key: "f",
        parent: "root",
        node: { type: "frame", name: "F", x: 0, y: 0, w: 100, h: 100 },
      } as WireOp,
      ...Array.from(
        { length: AGENT_MAX_NEW_LAYERS },
        (_, i) =>
          ({
            op: "insert",
            parent: "@f",
            node: { type: "rect", name: `R${i}`, x: 0, y: 0, w: 1, h: 1 },
          }) as WireOp,
      ),
    ]
    const big = await conn.call("kimo_apply_ops", { docId, ops })
    expect(big.result.ok).toBe(false)
    if (!big.result.ok) expect(big.result.errors[0]?.code).toBe("BATCH_TOO_LARGE")
    await host.dispose()
  })
})
