/**
 * M6 Agent tab controller (board 22 s4pGz0 / ZFOQf, board 24): real `@kimo/ai-agent` loop and
 * CLI engine over a mocked provider / fake CLI, the in-window M5 tool host over a real DocStore.
 */
import { describe, expect, test } from "bun:test"
import type { CliDetection, ProviderRequest } from "@kimo/ai-agent"
import type { KimoDocument } from "@kimo/core-schema"
import { createEmptyDocument, type DocStore, importDocument } from "@kimo/editor-state"
import {
  type AgentPanelControllerExt,
  costLabel,
  createAgentPanelController,
  createInWindowTools,
  durationLabel,
  headerCostLabel,
  modelLabel,
  pickerGroups,
  relativeTime,
  sessionMetaLabel,
  tokensLabel,
} from "../src/agent-panel"
import {
  createFakeCliHost,
  createTestRuntime,
  MOCK_ANTHROPIC,
  type Script,
} from "../src/agent-panel/testing"

function doc(): KimoDocument {
  const d = createEmptyDocument("Pricing page") as KimoDocument & {
    nodes: Record<string, unknown>
  }
  const frame = (id: string, name: string, parent: string | null, order: string, extra = {}) => {
    d.nodes[id] = { type: "frame", parent, order, name, x: 0, y: 0, w: 200, h: 120, ...extra }
  }
  frame("Pricing0001", "Pricing", null, "a0", { w: 640, h: 460 })
  frame("Hero000001", "Hero", "Pricing0001", "a0")
  frame("Card000001", "Card", "Pricing0001", "a1")
  frame("Navbar0001", "Navbar", null, "a1", { x: 900 })
  return d
}

const lastUserText = (req: ProviderRequest) => {
  const u = [...req.messages].reverse().find((m) => m.role === "user")
  return u?.role === "user" ? u.content.map((p) => (p.type === "text" ? p.text : "")).join("") : ""
}

function setup(
  script: Script,
  extra: Partial<Parameters<typeof createTestRuntime>[0]> = {},
): {
  c: AgentPanelControllerExt
  store: DocStore
  docId: string
  rt: ReturnType<typeof createTestRuntime>
} {
  const store = importDocument(doc())
  const tools = createInWindowTools({ store, path: "/u/me/Pricing page.kimo" })
  const rt = createTestRuntime({ tools: tools.factory, script, ...extra })
  const c = createAgentPanelController({
    runtime: rt,
    fileId: "f-pricing",
    fileName: "Pricing page.kimo",
    docId: () => tools.docId(),
    nodeName: (id) => (store.getNode(id) as { name?: string } | undefined)?.name,
    parentOf: (id) => (store.getNode(id) as { parent?: string | null } | undefined)?.parent ?? null,
    frameBox: (id) => {
      const n = store.getNode(id) as
        | { name: string; x: number; y: number; w: number; h: number }
        | undefined
      return n ? { id, name: n.name, x: n.x, y: n.y, w: n.w, h: n.h } : null
    },
  })
  return { c, store, docId: tools.docId(), rt }
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

describe("single turn: streaming, steps, meta, session (board 22 A)", () => {
  test("text + one op batch → steps done, meta tokens/cost/time, title by the fast model", async () => {
    const holder = { docId: "" }
    const { c, store, rt, docId } = setup((req, i) => {
      if (req.responseSchema) return { text: '{"title":"Warm up the hero"}' }
      return i === 0
        ? {
            text: "Warming the hero. ",
            tools: [
              {
                name: "kimo_apply_ops",
                input: {
                  docId: holder.docId,
                  label: "Warm Hero",
                  ops: [{ op: "update", id: "Hero000001", set: { name: "Hero warm" } }],
                },
              },
            ],
            usage: { inputTokens: 3000, outputTokens: 400 },
          }
        : { text: "Warmed the palette.", usage: { inputTokens: 100, outputTokens: 1000 } }
    })
    holder.docId = docId
    await c.refresh()
    expect(c.state.composer.model).toEqual({ provider: "anthropic", model: "claude-opus-5-5" })
    expect(c.state.modelLabel).toBe("Opus 5.5")
    await c.send("Make the hero warmer")
    expect(nameOf(store, "Hero000001")).toBe("Hero warm")
    const [u, a] = c.state.messages
    expect(u?.kind).toBe("user")
    expect(a?.kind).toBe("agent")
    if (a?.kind !== "agent") throw new Error()
    expect(a.streaming).toBe(false)
    // Board 31: the note before the tool call was the live status; the reply is the final text.
    expect(a.text).toBe("Warmed the palette.")
    expect(a.progress).toBeUndefined()
    expect(a.steps).toHaveLength(1)
    expect(a.steps[0]?.state).toBe("done")
    expect(a.meta?.billing).toBe("api")
    expect(a.meta?.tokensIn).toBe(3100)
    expect(a.meta?.tokensOut).toBe(1400)
    expect(a.meta?.canRegenerate).toBe(true)
    // (3100 × 4 + 1400 × 20) / 1e6 = 0.0404
    expect(a.meta?.costUsd).toBeCloseTo(0.0404, 6)
    await until(() => c.state.header.title === "Warm up the hero")
    expect(c.state.session?.messageCount).toBe(3)
    expect((await rt.sessions.list("f-pricing")).length).toBe(1)
    // Regenerate = undo that turn's op group, then resend.
    let undoneSeen = false
    const off = c.subscribe(() => {
      if (nameOf(store, "Hero000001") === "Hero") undoneSeen = true
    })
    await c.regenerate(a.turnId)
    off()
    expect(undoneSeen).toBe(true)
    expect(c.state.messages.filter((m) => m.kind === "agent")).toHaveLength(1)
    expect(nameOf(store, "Hero000001")).toBe("Hero warm")
    expect(c.state.session?.messageCount).toBe(3)
  })

  test("undo turn undoes the op groups newest first; regenerate restores then reapplies", async () => {
    const holder = { docId: "" }
    const { c, store, docId } = setup((req, i) =>
      req.responseSchema
        ? { text: '{"title":"Rename"}' }
        : i % 2 === 0
          ? {
              tools: [
                {
                  name: "kimo_apply_ops",
                  input: {
                    docId: holder.docId,
                    ops: [{ op: "update", id: "Card000001", set: { name: `Card v${i}` } }],
                  },
                },
              ],
            }
          : { text: "Done." },
    )
    holder.docId = docId
    await c.refresh()
    await c.send("Rename the card")
    expect(nameOf(store, "Card000001")).toBe("Card v0")
    const turn = c.state.messages.find((m) => m.kind === "agent")
    if (turn?.kind !== "agent") throw new Error()
    const r = await c.undoTurn(turn.turnId)
    expect(r).toEqual({ ok: true, stale: false })
    expect(nameOf(store, "Card000001")).toBe("Card")
    expect(c.state.undoneTurns).toContain(turn.turnId)
  })
})

describe("scope, errors and stop (board 22 E)", () => {
  test("single mode scope = selection: an op outside fails OUT_OF_SCOPE (batch rolled back)", async () => {
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
    c.setSelection([{ id: "Card000001", name: "Card", type: "frame" }])
    expect(c.state.composer.attachments).toEqual([
      { id: "sel:Card000001", kind: "selection", label: "Card", nodeIds: ["Card000001"] },
    ])
    const sending = c.send("Rename things")
    // Single mode: leaving the scope asks (in-app approvals wait until answered).
    await until(() => c.state.approval !== null)
    expect(c.state.mark).toBe("waiting")
    expect(c.state.approval?.choices).toEqual(["deny", "once"])
    await c.answerApproval(c.state.approval?.request.id as string, "deny")
    await sending
    expect(nameOf(store, "Card000001")).toBe("Card")
    expect(nameOf(store, "Navbar0001")).toBe("Navbar")
    const a = c.state.messages.find((m) => m.kind === "agent")
    if (a?.kind !== "agent") throw new Error()
    expect(a.steps[0]?.state).toBe("failed")
    expect(a.steps[0]?.errorCode).toBe("PERMISSION_DENIED")
    expect(c.state.messages[0]?.kind === "user" && c.state.messages[0].attachments).toHaveLength(1)
  })

  test("auth error → danger card with Open settings / Retry; never a modal", async () => {
    const { c } = setup(() => ({ error: "auth", status: 401, message: "invalid x-api-key" }))
    await c.refresh()
    await c.send("hi")
    const a = c.state.messages.find((m) => m.kind === "agent")
    if (a?.kind !== "agent") throw new Error()
    expect(a.card?.kind).toBe("auth")
    expect(a.card?.title).toBe("Anthropic rejected the API key")
    expect(a.card?.actions).toEqual(["open_settings", "retry"])
  })

  test("rate limit retries with a warning card, then succeeds and clears it", async () => {
    let seen = false
    const { c } = setup((_r, i) => {
      if (i === 0) return { error: "rate_limit", status: 429, retryAfterMs: 1 }
      return { text: "OK." }
    })
    await c.refresh()
    const unsub = c.subscribe((s) => {
      const a = s.messages.find((m) => m.kind === "agent")
      if (a?.kind === "agent" && a.card?.kind === "rate_limit") seen = true
    })
    await c.send("go")
    unsub()
    expect(seen).toBe(true)
    const a = c.state.messages.find((m) => m.kind === "agent")
    if (a?.kind !== "agent") throw new Error()
    expect(a.card).toBeUndefined()
    expect(a.text).toBe("OK.")
  })

  test("Stop aborts the stream → Stopped card (Undo turn / Continue); typing while streaming queues", async () => {
    const { c } = setup((req) =>
      lastUserText(req).includes("second")
        ? { text: "Second." }
        : { text: "a b c d e f g h i j k l m n o p", delayMs: 15 },
    )
    await c.refresh()
    const running = c.send("first")
    await until(() => c.state.busy && (c.state.live?.tokensOut ?? 0) > 0)
    // An unfinished sentence is not a status yet (no word-by-word streaming).
    const m1 = c.state.messages[1]
    expect(m1?.kind === "agent" && m1.progress?.status).toBe("Thinking…")
    // Board 31: streamed text is the live status, never the message text while running.
    expect(c.state.messages[1]?.text).toBe("")
    expect(c.state.composer.state).toBe("streaming")
    expect(c.state.live?.tokensOut).toBeGreaterThan(0)
    await c.send("second")
    expect(c.state.composer.queued).toEqual(["second"])
    c.stop()
    await running
    const first = c.state.messages[1]
    if (first?.kind !== "agent") throw new Error()
    expect(first.card?.kind).toBe("stopped")
    expect(first.card?.actions).toEqual(["undo_turn", "continue"])
    // Stop also drops the queue.
    expect(c.state.composer.queued).toEqual([])
  })

  test("spending limit pauses before the next call (budget card)", async () => {
    const { c } = setup(() => ({ text: "x" }), {
      usage: () => ({
        monthlyLimitUsd: 50,
        warnPerTurnUsd: 1,
        showCost: true,
        defaultModel: null,
        monthUsd: 50,
      }),
    })
    await c.refresh()
    await c.send("go")
    const a = c.state.messages.find((m) => m.kind === "agent")
    if (a?.kind !== "agent") throw new Error()
    expect(a.card?.kind).toBe("budget")
    expect(a.card?.title).toBe("Monthly limit reached · $50.00")
  })
})

describe("skills, model picker, sessions", () => {
  test("'/' opens the skills menu; /name forces a skill for one turn (stable prompt)", async () => {
    const { c, rt } = setup(() => ({ text: "Done." }))
    await c.refresh()
    c.setText("/")
    expect(c.state.menu).toBe("skills")
    expect(c.state.composer.slash).toEqual({ open: true, filter: "" })
    c.insertSkill("kimo-layout")
    expect(c.state.composer.text).toBe("/kimo-layout ")
    c.setText("/kimo-layout tidy the grid")
    await c.send(c.state.composer.text)
    const req = rt.providersMade[0]?.calls[0]
    expect(req?.system.stable).toContain('<skill name="kimo-layout">')
    expect(req?.system.stable).toContain('<skill name="kimo-design">')
    const u = c.state.messages[0]
    expect(u?.kind === "user" && u.skills).toEqual(["kimo-design", "kimo-layout"])
    expect(lastUserText(req as ProviderRequest)).toBe("tidy the grid")
    c.toggleSkill("kimo-tokens", true)
    expect(c.state.skills.enabled).toEqual(["kimo-design", "kimo-tokens"])
  })

  test("picker: local CLIs first (Claude Code default when signed in), API providers, Add-a-key rows", () => {
    const clis: CliDetection[] = [
      { id: "codex", label: "Codex", installed: true, signedIn: true, billing: "subscription" },
      {
        id: "claude-code",
        label: "Claude Code",
        installed: true,
        signedIn: true,
        billing: "subscription",
      },
    ]
    const g = pickerGroups({
      platform: "desktop",
      providers: [MOCK_ANTHROPIC],
      unavailable: [{ id: "gemini", label: "Google Gemini", tag: "no key" }],
      clis,
      defaultSelection: { provider: "cli:claude-code", model: "default" },
      labelOf: (p) => p,
    })
    expect(g.map((x) => x.provider)).toEqual([
      "cli:claude-code",
      "cli:codex",
      "anthropic",
      "gemini",
    ])
    expect(g[0]?.isDefault).toBe(true)
    expect(g[0]?.tag).toBe("subscription")
    expect(g[2]?.models.map((m) => [m.label, m.role])).toEqual([
      ["Claude Opus 5.5", "agent"],
      ["Claude Haiku 4.5", "fast"],
    ])
    expect(g[3]).toMatchObject({ available: false, tag: "no key" })
    const web = pickerGroups({
      platform: "web",
      providers: [MOCK_ANTHROPIC],
      unavailable: [],
      clis,
      defaultSelection: null,
      labelOf: (p) => p,
    })
    expect(web.map((x) => x.provider)).toEqual(["anthropic"])
  })

  test("thinking control only for models that support it; sessions list / open / search", async () => {
    const { c } = setup((req) =>
      req.responseSchema
        ? {
            text: lastUserText(req).includes("footer")
              ? '{"title":"Footer pass"}'
              : '{"title":"Other"}',
          }
        : { text: "ok" },
    )
    await c.refresh()
    expect(c.state.composer.thinkingAvailable).toBe(true)
    c.setThinking("max")
    await c.send("Fix the footer")
    await until(() => c.state.header.title === "Footer pass")
    const first = c.state.session?.id as string
    c.newSession()
    expect(c.state.messages).toEqual([])
    await c.send("Another")
    c.toggleHistory()
    await until(() => c.state.sessions.thisFile.length === 2)
    c.searchSessions("footer")
    await until(() => c.state.sessions.thisFile.length === 1)
    await c.openSession(first)
    expect(c.state.messages.map((m) => m.kind)).toEqual(["user", "agent"])
    expect(c.state.composer.thinking).toBe("max")
    expect(c.state.sessionsOpen).toBe(false)
  })
})

describe("local CLI (ADR 0014 §11): subscription billing, never dollars", () => {
  test("Claude Code turn → AgentEvents, cost 'subscription', CLI session resumed next turn", async () => {
    const envelope = {
      ok: true,
      summary: "Inserted Waitlist Form",
      changed: ["F1"],
      undoToken: "u1",
      ops: [{}],
      doc: { id: "d" },
    }
    const host = createFakeCliHost(() =>
      [
        {
          type: "system",
          subtype: "init",
          session_id: "s-cli",
          mcp_servers: [{ name: "kimo", status: "connected" }],
        },
        {
          type: "stream_event",
          session_id: "s-cli",
          event: {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "Adding the form." },
          },
        },
        {
          type: "assistant",
          session_id: "s-cli",
          message: {
            content: [
              { type: "text", text: "Adding the form." },
              {
                type: "tool_use",
                id: "t1",
                name: "mcp__kimo__kimo_apply_ops",
                input: { label: "Insert Waitlist Form", ops: [] },
              },
            ],
          },
        },
        {
          type: "user",
          session_id: "s-cli",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "t1",
                content: [{ type: "text", text: JSON.stringify(envelope) }],
              },
            ],
          },
        },
        {
          type: "result",
          subtype: "success",
          is_error: false,
          session_id: "s-cli",
          num_turns: 2,
          total_cost_usd: 0.04,
          usage: { input_tokens: 3100, output_tokens: 1400 },
        },
      ].map((l) => JSON.stringify(l)),
    )
    const clis: CliDetection[] = [
      {
        id: "claude-code",
        label: "Claude Code",
        installed: true,
        path: "/usr/local/bin/claude",
        signedIn: true,
        billing: "subscription",
      },
    ]
    const { c } = setup(() => ({ text: "unused" }), {
      platform: "desktop",
      clis,
      cliHost: host,
      defaultSelection: { provider: "cli:claude-code", model: "default" },
    })
    await c.refresh()
    expect(c.state.modelLabel).toBe("Claude Code")
    await c.send("Add a waitlist form")
    const a = c.state.messages.find((m) => m.kind === "agent")
    if (a?.kind !== "agent") throw new Error()
    expect(a.text).toContain("Adding the form.")
    expect(a.steps[0]?.state).toBe("done")
    expect(a.meta?.billing).toBe("subscription")
    expect(a.meta?.costUsd).toBeNull()
    expect(costLabel(a.meta as NonNullable<typeof a.meta>)).toBe("subscription")
    expect(c.state.header.billing).toBe("subscription")
    expect(host.spawned[0]?.args).toContain("--strict-mcp-config")
    await c.send("More")
    expect(host.spawned[1]?.args.join(" ")).toContain("--resume s-cli")
  })

  test("CLIs never run on web: unsupported_platform card", async () => {
    const { c } = setup(() => ({ text: "x" }), {
      platform: "web",
      defaultSelection: { provider: "cli:claude-code", model: "default" },
    })
    await c.refresh()
    await c.send("hi")
    const a = c.state.messages.find((m) => m.kind === "agent")
    if (a?.kind !== "agent") throw new Error()
    expect(a.card?.kind).toBe("error")
    expect(a.card?.actions).toEqual(["open_settings"])
  })
})

describe("modes (board 22 ZFOQf, board 24 GmEAl)", () => {
  test("side by side: N variant frames next to the original, one child per frame, personas", async () => {
    const holder = { docId: "" }
    const { c, store, docId } = setup((req) => {
      const sys = req.system.volatile ?? ""
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
      return { text: sys ? "Variant done." : "ok" }
    })
    holder.docId = docId
    await c.refresh()
    c.setMode({ ...c.state.composer.mode, mode: "side-by-side", agents: 2 })
    expect(c.state.modeLabel).toBe("Side by side · 2")
    c.setSelection([{ id: "Pricing0001", name: "Pricing", type: "frame" }])
    await c.send("Pricing section, 3 tiers")
    const run = c.state.modeRun
    expect(run?.mode).toBe("side-by-side")
    expect(run?.agents.map((a) => [a.label, a.persona, a.state])).toEqual([
      ["Agent 1", "iris", "done"],
      ["Agent 2", "violet", "done"],
    ])
    expect(run?.done).toBe(2)
    const frames = (run?.agents ?? []).map((a) => a.scopeId as string)
    for (const [i, f] of frames.entries()) {
      const n = store.getNode(f) as unknown as { name: string; x: number; parent: string | null }
      expect(n.name).toBe(`Pricing · v${i + 1}`)
      expect(n.parent ?? null).toBeNull()
      expect(n.x).toBe((640 + 80) * (i + 1))
    }
    const a = c.state.messages.find((m) => m.kind === "agent")
    if (a?.kind !== "agent") throw new Error()
    expect(a.text).toBe("2 of 2 variants done next to Pricing.")
    expect(c.state.session?.agents).toBe(2)
    // Discard undoes the child's groups and deletes its frame.
    await c.discardVariant(run?.agents[1]?.origin as string)
    expect(store.hasNode(frames[1] as string)).toBe(false)
    expect(c.state.modeRun?.agents[1]?.discarded).toBe(true)
  })

  test("split: lead creates sections, spawns children; a child outside its scope is rejected", async () => {
    const holder = { docId: "" }
    const { c, store, docId } = setup((req, i) => {
      const brief = /Your brief: (.*)/.exec(req.system.volatile ?? "")?.[1] ?? ""
      const toolsDone = req.messages.some((m) => m.role === "tool")
      if (brief.includes("Hero") && !toolsDone)
        return {
          tools: [
            {
              name: "kimo_apply_ops",
              input: {
                docId: holder.docId,
                ops: [{ op: "update", id: "Navbar0001", set: { name: "Hacked" } }],
              },
            },
          ],
        }
      if (brief.includes("Card") && !toolsDone)
        return {
          tools: [
            {
              name: "kimo_apply_ops",
              input: {
                docId: holder.docId,
                ops: [{ op: "update", id: "Card000001", set: { name: "Card ✓" } }],
              },
            },
          ],
        }
      if (brief) return { text: "done" }
      // Lead: spawn one child per section.
      if (i === 0)
        return {
          tools: [
            {
              name: "kimo_spawn_agents",
              input: {
                docId: holder.docId,
                agents: [
                  { frameId: "Hero000001", brief: "Build the Hero" },
                  { frameId: "Card000001", brief: "Build the Card" },
                ],
              },
            },
          ],
        }
      return { text: "Sections are in." }
    })
    holder.docId = docId
    await c.refresh()
    c.setMode({ ...c.state.composer.mode, mode: "split", agents: 3 })
    await c.send("Landing page")
    expect(nameOf(store, "Navbar0001")).toBe("Navbar")
    expect(nameOf(store, "Card000001")).toBe("Card ✓")
    const run = c.state.modeRun
    expect(run?.agents.map((a) => [a.label, a.persona])).toEqual([
      ["Lead", "teal"],
      ["Agent 1", "iris"],
      ["Agent 2", "violet"],
    ])
    expect(run?.agents[1]?.rejected).toBe(1)
    expect(run?.log.some((r) => r.op === "reject" && r.persona === "iris")).toBe(true)
    expect(c.state.canvas.rejections.some((r) => r.text.includes("OUT_OF_SCOPE"))).toBe(true)
  })

  test("split (teardown §12 M6): globals, moves across the scope edge and component origins are rejected per op", async () => {
    const holder = { docId: "" }
    const heroTries = [
      // Globals: a child has no `globals` grant.
      [
        {
          op: "set_variables",
          set: [{ name: "brand", variable: { type: "color", value: "#f00" } }],
        },
      ],
      // Move across the scope edge: Card000001 is outside the Hero child's scope.
      [{ op: "move", id: "Card000001", parent: "Hero000001" }],
      // Moving the scope root itself out.
      [{ op: "move", id: "Hero000001", parent: "Navbar0001" }],
      // Component origins: make_component is never allowed for a scoped agent.
      [{ op: "make_component", ids: ["Hero000001"] }],
      [{ op: "declare_prop", component: "Navbar0001", name: "label", prop: { type: "text" } }],
    ]
    const { c, store, docId } = setup((req, i) => {
      const brief = /Your brief: (.*)/.exec(req.system.volatile ?? "")?.[1] ?? ""
      const toolTurns = req.messages.filter((m) => m.role === "tool").length
      if (brief.includes("Hero")) {
        const ops = heroTries[toolTurns]
        return ops
          ? { tools: [{ name: "kimo_apply_ops", input: { docId: holder.docId, ops } }] }
          : { text: "done" }
      }
      if (brief.includes("Card"))
        return toolTurns === 0
          ? {
              tools: [
                {
                  name: "kimo_apply_ops",
                  input: {
                    docId: holder.docId,
                    ops: [{ op: "update", id: "Card000001", set: { name: "Card ✓" } }],
                  },
                },
              ],
            }
          : { text: "done" }
      if (i === 0)
        return {
          tools: [
            {
              name: "kimo_spawn_agents",
              input: {
                docId: holder.docId,
                agents: [
                  { frameId: "Hero000001", brief: "Build the Hero" },
                  { frameId: "Card000001", brief: "Build the Card" },
                ],
              },
            },
          ],
        }
      return { text: "Sections are in." }
    })
    holder.docId = docId
    const before = store.toDocument() as KimoDocument & { variables?: unknown }
    await c.refresh()
    c.setMode({ ...c.state.composer.mode, mode: "split", agents: 3 })
    await c.send("Landing page")
    const after = store.toDocument() as KimoDocument & { variables?: unknown }
    // Every Hero attempt was rejected; nothing it tried reached the document.
    expect(c.state.modeRun?.agents[1]?.rejected).toBe(heroTries.length)
    const heroRejects = (c.state.modeRun?.log ?? []).filter(
      (r) => r.op === "reject" && r.persona === "iris",
    )
    expect(heroRejects.map((r) => r.detail.includes("OUT_OF_SCOPE") || r.detail)).toEqual(
      heroTries.map(() => true),
    )
    expect(after.variables).toEqual(before.variables)
    expect((store.getNode("Card000001") as { parent?: string }).parent).toBe("Pricing0001")
    expect((store.getNode("Hero000001") as { parent?: string }).parent).toBe("Pricing0001")
    expect(
      Object.values(after.nodes).some((n) => (n as { type?: string }).type === "component"),
    ).toBe(false)
    expect((store.getNode("Hero000001") as { reusable?: unknown }).reusable).toBeUndefined()
    // The in-scope child still works.
    expect(nameOf(store, "Card000001")).toBe("Card ✓")
    expect(
      c.state.canvas.rejections.filter((r) => r.text.includes("OUT_OF_SCOPE")).length,
    ).toBeGreaterThan(0)
  })

  test("iterate: one pass per turn, review card, next with steer, revert to original", async () => {
    const holder = { docId: "" }
    let n = 0
    const { c, store, docId } = setup((req) => {
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
    c.setMode({ ...c.state.composer.mode, mode: "iterate", passes: 3 })
    c.setSelection([{ id: "Card000001", name: "Card" }])
    await c.send("Make Team feel premium")
    expect(c.state.modeRun?.iterate).toMatchObject({ pass: 1, of: 3, reviewing: true, changes: 1 })
    expect(c.state.modeRun?.iterate?.rows[0]).toMatchObject({ op: "update", target: "Card" })
    await c.review({ action: "next", steer: "less contrast" })
    expect(c.state.modeRun?.iterate).toMatchObject({ pass: 2, steer: "less contrast" })
    expect(nameOf(store, "Card000001")).toBe("Card p2")
    await c.review({ action: "revert", toPass: 0 })
    expect(nameOf(store, "Card000001")).toBe("Card")
    expect(c.state.modeRun?.iterate?.pass).toBe(0)
  })
})

describe("Home hand-off", () => {
  test("startFromHome: session id from Home, origin home, first message tagged From Home", async () => {
    const { c, rt } = setup((req) =>
      req.responseSchema ? { text: '{"title":"Pricing"}' } : { text: "Drafting." },
    )
    await c.refresh()
    await c.startFromHome({
      prompt: "A pricing page",
      path: "/u/me/Pricing page.kimo",
      sessionId: "h0me12",
      model: { provider: "anthropic", model: "claude-opus-5-5" },
    })
    expect(c.state.session?.id).toBe("h0me12")
    expect(c.state.session?.origin).toBe("home")
    const u = c.state.messages[0]
    expect(u?.kind === "user" && u.fromHome).toBe(true)
    expect(rt.providersMade[0]?.calls[0]?.system.volatile).toContain("Home screen")
  })
})

describe("formats (board 22 copy)", () => {
  test("meta, header, session rows, times", () => {
    expect(tokensLabel(3100, 1400)).toBe("3.1k in · 1.4k out")
    expect(costLabel({ costUsd: 0.034, billing: "api" })).toBe("$0.034")
    expect(costLabel({ costUsd: null, billing: "api" })).toBe("—")
    expect(costLabel({ costUsd: 0.04, billing: "subscription" })).toBe("subscription")
    expect(durationLabel(11_200)).toBe("11.2s")
    expect(headerCostLabel({ costUsd: 0.38, tokens: 41_000, billing: "api" })).toBe(
      "$0.38 · 41k tok",
    )
    expect(modelLabel({ provider: "anthropic", model: "claude-haiku-4-5-20251001" }, [])).toBe(
      "Haiku 4.5",
    )
    const now = new Date(2026, 9, 4, 12).getTime()
    expect(relativeTime(now - 10_000, now)).toBe("now")
    expect(relativeTime(now - 3_600_000, now)).toBe("1h")
    expect(relativeTime(now - 26 * 3_600_000, now)).toBe("yesterday")
    expect(relativeTime(new Date(2026, 9, 1).getTime(), now)).toBe("Oct 1")
    const meta = {
      id: "s",
      fileId: "f",
      fileName: "Loom — Mobile app.kimo",
      title: "t",
      createdAt: 0,
      updatedAt: 0,
      model: { provider: "anthropic", model: "claude-opus-5-5" },
      thinking: "auto" as const,
      mode: {
        mode: "single" as const,
        agents: 3,
        models: "same" as const,
        explore: "both" as const,
        passes: 3,
      },
      origin: "panel" as const,
      enabledSkills: [],
      messageCount: 6,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      costUsd: 0.38,
      billing: "api" as const,
    }
    expect(sessionMetaLabel(meta, { otherFile: false, clis: [] })).toBe(
      "Opus 5.5 · 6 messages · $0.38",
    )
    expect(
      sessionMetaLabel({ ...meta, agents: 3, costUsd: 1.12 }, { otherFile: false, clis: [] }),
    ).toBe("Opus 5.5 · 3 agents · $1.12")
    expect(sessionMetaLabel({ ...meta, costUsd: 0.64 }, { otherFile: true, clis: [] })).toBe(
      "Loom — Mobile app · $0.64",
    )
  })
})

describe("board 31: live status, step by step, steps toggle state", () => {
  const rects = (parent: string, n: number) =>
    Array.from({ length: n }, (_, i) => ({
      op: "insert",
      parent,
      node: { type: "rect", name: `Bar ${i}`, x: 0, y: i * 4, w: 10, h: 2 },
    }))

  test("notes become the status; an oversize edit stays internal; the reply lands at the end", async () => {
    const holder = { docId: "" }
    const { c, store, docId } = setup((_req, i) => {
      const tool = (ops: unknown[]) => [
        { name: "kimo_apply_ops", input: { docId: holder.docId, ops } },
      ]
      if (i === 0)
        return { text: "Building the pricing section\n", tools: tool(rects("Hero000001", 41)) }
      if (i === 1) return { text: "", tools: tool(rects("Hero000001", 20)) }
      if (i === 2)
        return {
          text: "Tightening the card",
          tools: tool([{ op: "update", id: "Card000001", set: { name: "Card tight" } }]),
        }
      return { text: "Added 20 bars to Hero and tightened the card." }
    })
    holder.docId = docId
    await c.refresh()
    const seen: string[] = []
    const unsub = c.subscribe((st) => {
      const a = st.messages[1]
      if (a?.kind === "agent" && a.progress) {
        const last = seen[seen.length - 1]
        if (last !== a.progress.status) seen.push(a.progress.status)
        // Never the running text in the message while the turn runs.
        expect(a.text).toBe("")
      }
    })
    await c.send("Add bars")
    unsub()
    expect(seen[0]).toBe("Thinking…")
    expect(seen).toContain("Building the pricing section")
    // Step 2 had no note: the tool's own label, with count and place.
    expect(seen).toContain("Adding 20 layers in Hero")
    expect(seen).toContain("Tightening the card")
    const a = c.state.messages[1]
    if (a?.kind !== "agent") throw new Error()
    expect(a.progress).toBeUndefined()
    expect(a.text).toBe("Added 20 bars to Hero and tightened the card.")
    // The BATCH_TOO_LARGE call is not a step and nothing failed.
    expect(a.steps.map((s) => s.state)).toEqual(["done", "done"])
    expect(a.card).toBeUndefined()
    expect(store.children("Hero000001")).toHaveLength(20)
    // Landing flashes: top-most changed layers per landed edit, attributed to the lead.
    expect(c.state.canvas.landed).toHaveLength(2)
    expect(c.state.canvas.landed[1]?.ids).toEqual(["Card000001"])
    // Canvas cursor pill: the agent's name only.
    for (const cur of c.state.canvas.cursors) expect(cur.text).toBe("Kimo")
  })

  test("Follow targets the last landed layers while the turn runs", async () => {
    const holder = { docId: "" }
    let follow: string[] = []
    const { c, docId } = setup((_req, i) =>
      i === 0
        ? {
            text: "Renaming the card",
            tools: [
              {
                name: "kimo_apply_ops",
                input: {
                  docId: holder.docId,
                  ops: [{ op: "update", id: "Card000001", set: { name: "Card 2" } }],
                },
              },
            ],
          }
        : { text: "Done.", delayMs: 20 },
    )
    holder.docId = docId
    await c.refresh()
    const unsub = c.subscribe((st) => {
      const a = st.messages[1]
      if (a?.kind === "agent" && a.progress?.follow.length) follow = a.progress.follow
    })
    await c.send("Rename")
    unsub()
    expect(follow).toEqual(["Card000001"])
  })
})
