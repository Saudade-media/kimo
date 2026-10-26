/** Permissions, approvals and dispatch (teardown 11.3–11.4, ADR 0013 §6). */
import { describe, expect, test } from "bun:test"
import {
  ACTIVITY_LIMIT,
  type ActivityEntry,
  APPROVAL_TIMEOUT_MS,
  type ApprovalOutcome,
  ASK_POLICY,
  authorize,
  type ClientPolicy,
  clientSlug,
  createStubHandlers,
  type DocumentHost,
  dispatch,
  emptyAllowances,
  fileAllowed,
  kimoApplyOps,
  kimoOpen,
  kimoQuery,
  originOf,
  parseMcpOrigin,
  sessionAllowable,
  type ToolContext,
  trimActivity,
} from "../src/index"
import { validateInput } from "../src/server"

const policy = (p: Partial<ClientPolicy> = {}): ClientPolicy => ({ ...ASK_POLICY, ...p })
const del = { docId: "d_abc_k9", ops: [{ op: "delete", id: "Abcdef1234" }] }
const upd = { docId: "d_abc_k9", ops: [{ op: "update", id: "Abcdef1234", set: { name: "x" } }] }

describe("identity", () => {
  test("origin round-trips and is a valid editor-state origin", () => {
    const o = originOf({ client: clientSlug("Claude Code"), session: "k3f9a2" })
    expect(o).toBe("mcp:claude-code.k3f9a2")
    expect(parseMcpOrigin(o)).toEqual({ client: "claude-code", session: "k3f9a2" })
  })
})

describe("authorize", () => {
  test("reads are always allowed", () => {
    expect(
      authorize(kimoQuery, {}, { policy: policy({ level: "read" }), allowances: emptyAllowances() })
        .kind,
    ).toBe("allow")
  })

  test("edit level: deletes ask (destructive) and edits pass", () => {
    const ctx = { policy: policy(), allowances: emptyAllowances() }
    expect(authorize(kimoApplyOps, upd, ctx).kind).toBe("allow")
    const a = authorize(kimoApplyOps, del, ctx)
    expect(a.kind).toBe("ask")
    if (a.kind === "ask") expect(a.reason.kind).toBe("destructive")
  })

  test("read level with deny mode denies edits", () => {
    const a = authorize(kimoApplyOps, upd, {
      policy: policy({ level: "read", onExceed: "deny" }),
      allowances: emptyAllowances(),
    })
    expect(a.kind).toBe("deny")
    if (a.kind === "deny") expect(a.error.code).toBe("PERMISSION_DENIED")
  })

  test("session allowance covers later destructive ops of the same kind", () => {
    const ctx = { policy: policy({ level: "edit+delete" }), allowances: emptyAllowances() }
    ctx.allowances.ops.add("delete")
    expect(authorize(kimoApplyOps, del, ctx).kind).toBe("allow")
  })

  test("files outside the allow-list ask every time; never session-allowable", () => {
    const ctx = { policy: policy({ files: ["/repo/**"] }), allowances: emptyAllowances() }
    expect(authorize(kimoOpen, { path: "/repo/a.kimo" }, ctx, { path: "/repo/a.kimo" }).kind).toBe(
      "allow",
    )
    const a = authorize(kimoOpen, { path: "/etc/x.kimo" }, ctx, { path: "/etc/x.kimo" })
    expect(a.kind).toBe("ask")
    if (a.kind === "ask") expect(sessionAllowable(a.reason)).toBe(false)
  })

  test("glob semantics", () => {
    expect(fileAllowed("/repo/design/a.kimo", ["/repo/**"])).toBe(true)
    expect(fileAllowed("/repo/design/a.kimo", ["/repo/*.kimo"])).toBe(false)
    expect(fileAllowed("/other/a.kimo", [])).toBe(false)
  })
})

describe("dispatch", () => {
  const ctx = (answer: ApprovalOutcome, log: Omit<ActivityEntry, "seq">[]): ToolContext => ({
    identity: {
      client: "claude-code",
      label: "Claude Code",
      session: "abc123",
      transport: "socket",
    },
    origin: "mcp:claude-code.abc123",
    policy: policy(),
    allowances: emptyAllowances(),
    host: {} as DocumentHost,
    requestApproval: async (r) => {
      expect(r.expiresAt - r.requestedAt).toBe(APPROVAL_TIMEOUT_MS)
      return answer
    },
    recordActivity: (e) => log.push(e),
    signal: new AbortController().signal,
    now: () => 1000,
    newId: () => "ap_1",
  })
  const opts = { validate: validateInput, targets: async () => ({}) }

  test("invalid input → INVALID_INPUT envelope with a path", async () => {
    const out = await dispatch(
      "kimo_apply_ops",
      { docId: "d_abc_k9", ops: [{ op: "nope" }] },
      ctx("once", []),
      createStubHandlers(),
      opts,
    )
    expect(out.result.ok).toBe(false)
    if (!out.result.ok) expect(out.result.errors[0]?.code).toBe("INVALID_INPUT")
  })

  test("approval timeout → PERMISSION_DENIED and an activity entry", async () => {
    const log: Omit<ActivityEntry, "seq">[] = []
    const out = await dispatch(
      "kimo_apply_ops",
      del,
      ctx("timeout", log),
      createStubHandlers(),
      opts,
    )
    expect(out.result.ok).toBe(false)
    if (!out.result.ok) expect(out.result.errors[0]?.code).toBe("PERMISSION_DENIED")
    expect(log.at(-1)?.outcome).toBe("timeout")
  })

  test("session approval is remembered for op kinds", async () => {
    const c = ctx("session", [])
    await dispatch("kimo_apply_ops", del, c, createStubHandlers(), opts)
    expect(c.allowances.ops.has("delete")).toBe(true)
  })

  test("unknown tool", async () => {
    const out = await dispatch("kimo_nope", {}, ctx("once", []), createStubHandlers(), opts)
    expect(out.result.ok).toBe(false)
  })
})

describe("activity", () => {
  test("keeps the last 500", () => {
    const many = Array.from({ length: 620 }, (_, i) => ({
      seq: i,
      time: i,
      origin: "user",
      actor: "You",
      kind: "edit" as const,
      summary: "",
    }))
    const t = trimActivity(many)
    expect(t.length).toBe(ACTIVITY_LIMIT)
    expect(t[0]?.seq).toBe(120)
  })
})
