import { describe, expect, test } from "bun:test"
import { authorize, emptyAllowances, toolByName, type WireOp } from "@kimo/mcp-server"
import {
  agentOrigin,
  type ChildSpec,
  childPolicy,
  clampAgents,
  createSpawnTool,
  exploreBrief,
  leadPolicy,
  MAX_AGENTS,
  parseAgentOrigin,
  planSideBySide,
  revertCalls,
  runChildren,
} from "../src/modes"
import { checkScope, outOfScopeIds, type ScopeTree } from "../src/scope"

// page ─┬─ Navbar
//       ├─ Hero ── Headline
//       └─ Features ── Card1
const parents: Record<string, string | null> = {
  Page000001: null,
  Navbar0001: "Page000001",
  Hero000001: "Page000001",
  Headline01: "Hero000001",
  Features01: "Page000001",
  Card000001: "Features01",
}
const tree: ScopeTree = { exists: (id) => id in parents, parentOf: (id) => parents[id] ?? null }

describe("scope enforcement (per op)", () => {
  const scope = ["Hero000001"]
  const v = (ops: unknown[], opts = {}) => checkScope(ops as WireOp[], tree, scope, opts)

  test("edits inside the scope pass, including @key children", () => {
    expect(
      v([
        { op: "update", id: "Headline01", set: { content: "Hi" } },
        { op: "update", id: "Hero000001", set: { fill: "#fff" } },
        { op: "insert", key: "form", parent: "Hero000001", node: { type: "frame" } },
        { op: "insert", key: "email", parent: "@form", node: { type: "text" } },
      ]),
    ).toEqual([])
  })

  test("targets and parents outside are rejected", () => {
    const r = v([
      { op: "update", id: "Navbar0001", set: { name: "x" } },
      { op: "insert", key: "x", parent: "root", node: { type: "frame" } },
      { op: "insert", key: "y", parent: "@x", node: { type: "text" } },
    ])
    expect(r.map((x) => x.reason)).toEqual(["outside", "outside", "outside"])
    expect(outOfScopeIds(r)).toContain("Navbar0001")
  })

  test("moves across the scope edge, deleting/moving the scope root, globals and make_component are rejected", () => {
    const r = v([
      { op: "move", id: "Headline01", parent: "Features01" },
      { op: "move", id: "Card000001", parent: "Hero000001" },
      { op: "delete", id: "Hero000001" },
      { op: "move", id: "Hero000001", parent: "Features01" },
      { op: "set_variables", set: [] },
      { op: "make_component", ids: ["Headline01"] },
      { op: "declare_prop", component: "Navbar0001", name: "x" },
    ])
    expect(r.map((x) => x.reason)).toEqual([
      "crosses-edge",
      "crosses-edge",
      "scope-root",
      "scope-root",
      "global",
      "component",
      "component",
    ])
  })

  test("globals pass for the lead with the grant; empty scope means unscoped", () => {
    expect(v([{ op: "create_variable", name: "x" }], { globalsGrant: true })).toEqual([])
    expect(checkScope([{ op: "update", id: "Navbar0001" } as unknown as WireOp], tree, [])).toEqual(
      [],
    )
  })

  test("M5 authorize turns out-of-scope ids into OUT_OF_SCOPE for a child (deny, no prompt)", () => {
    const def = toolByName("kimo_apply_ops")
    if (!def) throw new Error()
    const input = { docId: "d_1", ops: [{ op: "update", id: "Navbar0001", set: { name: "x" } }] }
    const outOfScope = outOfScopeIds(checkScope(input.ops as WireOp[], tree, scope))
    const auth = authorize(
      def,
      input,
      { policy: childPolicy(scope), allowances: emptyAllowances() },
      { outOfScope },
    )
    expect(auth.kind).toBe("deny")
    expect(auth.kind === "deny" && auth.error.code).toBe("OUT_OF_SCOPE")
    const ok = authorize(
      def,
      { docId: "d_1", ops: [{ op: "update", id: "Headline01" }] },
      { policy: childPolicy(scope), allowances: emptyAllowances() },
      { outOfScope: [] },
    )
    expect(ok.kind).toBe("allow")
  })

  test("a child cannot save or export (no grants); the lead asks", () => {
    const save = toolByName("kimo_save")
    if (!save) throw new Error()
    expect(
      authorize(
        save,
        { docId: "d_1" },
        { policy: childPolicy(scope), allowances: emptyAllowances() },
      ).kind,
    ).toBe("deny")
    expect(
      authorize(save, { docId: "d_1" }, { policy: leadPolicy(), allowances: emptyAllowances() })
        .kind,
    ).toBe("ask")
  })
})

describe("modes", () => {
  test("origins and caps", () => {
    expect(agentOrigin("abc123", 2)).toBe("agent:kimo.abc123.2")
    expect(parseAgentOrigin("agent:kimo.abc123.2")).toEqual({ session: "abc123", n: 2 })
    expect(clampAgents(9)).toBe(MAX_AGENTS)
    expect(clampAgents(0)).toBe(1)
    expect(() => childPolicy([])).toThrow()
  })

  test("side by side: N placeholder frames to the right, each owned by its child", () => {
    const ops = planSideBySide(
      { id: "P", name: "Pricing", x: 0, y: 0, w: 1200, h: 800 },
      3,
      ["agent:kimo.s.1", "agent:kimo.s.2", "agent:kimo.s.3"],
      { now: new Date(0) },
    )
    expect(ops).toHaveLength(3)
    const second = ops[1] as unknown as {
      key: string
      node: { x: number; placeholder: { by: string } }
    }
    expect(second.key).toBe("v2")
    expect(second.node.x).toBe(2 * 1280)
    expect(second.node.placeholder.by).toBe("agent:kimo.s.2")
    expect(exploreBrief("layout", 0, 3)).toContain("LAYOUT")
  })

  test("runChildren runs in parallel, enforces the cap, and reports failures per child", async () => {
    const spec = (i: number): ChildSpec => ({
      index: i,
      origin: agentOrigin("s", i),
      docId: "d_1",
      scopeRoots: [`F${i}`],
      policy: childPolicy([`F${i}`]),
      model: { provider: "anthropic", model: "claude-opus-5-5" },
      thinking: "high",
      brief: "b",
    })
    let running = 0
    let peak = 0
    const results = await runChildren(
      [spec(1), spec(2), spec(3)],
      async (s) => {
        running++
        peak = Math.max(peak, running)
        await new Promise((r) => setTimeout(r, 5))
        running--
        if (s.index === 2) throw new Error("boom")
        return {
          index: s.index,
          origin: s.origin,
          status: "done",
          opsApplied: 3,
          rejected: 0,
          summary: "",
          costUsd: 0.01,
        }
      },
      new AbortController().signal,
    )
    expect(peak).toBe(3)
    expect(results.map((r) => r.status)).toEqual(["done", "error", "done"])
    await expect(
      runChildren(
        Array.from({ length: 7 }, (_, i) => spec(i)),
        async () => ({}) as never,
        new AbortController().signal,
      ),
    ).rejects.toThrow()
  })

  test("kimo_spawn_agents validates frames and spawns scoped children", async () => {
    let n = 0
    const seen: ChildSpec[] = []
    const tool = createSpawnTool({
      session: "s1",
      leadScope: [],
      defaultModel: { provider: "anthropic", model: "claude-opus-5-5" },
      thinking: "high",
      validateFrame: (_d, f) => (f.startsWith("F") ? null : `${f} is not a frame`),
      nextIndex: () => ++n,
      runner: async (s) => {
        seen.push(s)
        return {
          index: s.index,
          origin: s.origin,
          status: "done",
          opsApplied: 4,
          rejected: 0,
          summary: "",
          costUsd: 0.05,
        }
      },
    })
    expect(tool.spec.inputSchema.type).toBe("object")
    const bad = await tool.run(
      { docId: "d_1", agents: [{ frameId: "X", brief: "b" }] },
      new AbortController().signal,
    )
    expect(bad.result.ok).toBe(false)
    const dup = await tool.run(
      {
        docId: "d_1",
        agents: [
          { frameId: "F1", brief: "a" },
          { frameId: "F1", brief: "b" },
        ],
      },
      new AbortController().signal,
    )
    expect(dup.result.ok).toBe(false)
    const ok = await tool.run(
      {
        docId: "d_1",
        agents: [
          { frameId: "F1", brief: "hero" },
          {
            frameId: "F2",
            brief: "features",
            provider: "anthropic",
            model: "claude-haiku-4-5-20251001",
          },
        ],
      },
      new AbortController().signal,
    )
    expect(ok.result.ok).toBe(true)
    expect(seen.map((s) => s.origin)).toEqual(["agent:kimo.s1.1", "agent:kimo.s1.2"])
    expect(seen[0]?.policy.nodes).toEqual(["F1"])
    expect(seen[0]?.policy.grants).toEqual([])
    expect(seen[0]?.policy.onExceed).toBe("deny")
    expect(seen[1]?.model.model).toBe("claude-haiku-4-5-20251001")
  })

  test("iterate: revert to a pass undoes later passes newest first", () => {
    const passes = [
      { pass: 1, undoTokens: [{ docId: "d", token: "a" }], changes: 3, costUsd: 0.01 },
      {
        pass: 2,
        undoTokens: [
          { docId: "d", token: "b" },
          { docId: "d", token: "c" },
        ],
        changes: 6,
        costUsd: 0.07,
      },
    ]
    expect(revertCalls(passes, 0).map((u) => u.token)).toEqual(["c", "b", "a"])
    expect(revertCalls(passes, 1).map((u) => u.token)).toEqual(["c", "b"])
  })
})
