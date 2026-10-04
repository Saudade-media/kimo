import { describe, expect, test } from "bun:test"
import { backoffDelay } from "../src/backoff"
import { ProviderError } from "../src/errors"
import type { TurnRecord } from "../src/loop"
import {
  anthropicThinking,
  DEFAULT_MODELS,
  MODEL_CATALOG,
  resolveLegacyModelId,
  resolveModel,
} from "../src/models"
import { isOrphanPlaceholder, PlaceholderTracker, placeholderTag } from "../src/placeholder"
import { estimateCost, formatTokens, formatUsd, sumCosts } from "../src/pricing"
import { buildSystemPrompt } from "../src/prompt"
import {
  contextNotes,
  convertNoteToPromptOp,
  planPromptRun,
  promptFooter,
} from "../src/prompt-node"
import {
  appendTurn,
  createMemorySessionStore,
  groupSessions,
  historyOf,
  newSession,
  planRegenerate,
  undoCallInputs,
} from "../src/session"
import {
  activeSkills,
  builtinSkills,
  loadSkills,
  parseSkill,
  parseSlash,
  skillsPrompt,
} from "../src/skills/index"
import { registryToolSpecs } from "../src/toolhost"

const providers = [
  {
    id: "anthropic",
    kind: "anthropic" as const,
    label: "Anthropic",
    models: { agent: "claude-opus-5-5", fast: "claude-haiku-4-5-20251001" },
  },
  {
    id: "openai",
    kind: "openai" as const,
    label: "OpenAI",
    models: { agent: "gpt-4.1", fast: "gpt-4.1-mini" },
  },
]

describe("models", () => {
  test("lead defaults", () => {
    expect(DEFAULT_MODELS.anthropic).toEqual({
      agent: "claude-opus-5-5",
      fast: "claude-haiku-4-5-20251001",
    })
  })

  test("unknown provider or model fails loudly; no fallback", () => {
    expect(() => resolveModel({ provider: "gemini", model: "gemini-2.5-pro" }, providers)).toThrow(
      ProviderError,
    )
    expect(() =>
      resolveModel({ provider: "anthropic", model: "claude-sonnet-9" }, providers),
    ).toThrow(/not known/)
    expect(
      resolveModel({ provider: "anthropic", model: "claude-opus-5-5" }, providers).info.thinking,
    ).toBe("effort")
  })

  test("legacy bare model ids resolve only when exactly one provider serves them", () => {
    expect(resolveLegacyModelId("gpt-4.1", providers).provider.id).toBe("openai")
    expect(() => resolveLegacyModelId("llama3", providers)).toThrow(/No configured provider/)
    const two = [
      ...providers,
      { ...providers[0], id: "anthropic-work" } as (typeof providers)[number],
    ]
    expect(() => resolveLegacyModelId("claude-opus-5-5", two)).toThrow(/served by/)
  })

  test("Opus 5.5 never disables thinking (Off = effort low)", () => {
    const opus = MODEL_CATALOG.anthropic[0]
    if (!opus) throw new Error()
    expect(anthropicThinking(opus, "off")).toEqual({ effort: "low" })
  })
})

describe("pricing", () => {
  test("estimates per published price, cache reads/writes included", () => {
    const c = estimateCost("anthropic", "claude-opus-5-5", {
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 0,
    })
    expect(c.usd).toBeCloseTo(4 + 2 + 0.2, 10)
    expect(c.estimated).toBe(true)
    // Dated snapshot matches its alias.
    expect(
      estimateCost("anthropic", "claude-haiku-4-5-20251001", {
        inputTokens: 1e6,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }).usd,
    ).toBe(1)
  })

  test("unknown model → null (shown as —), free local runtimes → $0", () => {
    expect(
      estimateCost("openrouter", "x/y", {
        inputTokens: 5,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }).usd,
    ).toBeNull()
    expect(
      estimateCost(
        "custom",
        "llama",
        { inputTokens: 5, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
        { free: true },
      ).usd,
    ).toBe(0)
    expect(
      sumCosts([
        { usd: 1, estimated: true, priceVersion: "" },
        { usd: null, estimated: true, priceVersion: "" },
      ]),
    ).toEqual({ usd: 1, partial: true })
    expect(formatUsd(0.034)).toBe("$0.034")
    expect(formatUsd(1.12)).toBe("$1.12")
    expect(formatUsd(null)).toBe("—")
    expect(formatTokens(41_200)).toBe("41k")
    expect(formatTokens(2_310_000)).toBe("2.31M")
  })

  test("backoff grows exponentially and honors retry-after", () => {
    const p = { maxAttempts: 5, baseMs: 1000, maxMs: 60_000, jitter: 0 }
    expect(backoffDelay(1, p)).toBe(1000)
    expect(backoffDelay(3, p)).toBe(4000)
    expect(backoffDelay(1, p, 12_000)).toBe(12_000)
  })
})

describe("skills", () => {
  test("built-ins parse (kimo-design, kimo-layout, kimo-tokens)", () => {
    expect(builtinSkills().map((s) => s.name)).toEqual([
      "kimo-design",
      "kimo-layout",
      "kimo-tokens",
    ])
  })

  test("SKILL.md parsing: front matter, quoted and folded values, errors", () => {
    const ok = parseSkill(
      "---\nname: brand-voice\ndescription: >\n  Rewrite copy in\n  our voice.\n---\n# Voice\nShort.",
      "user",
      "/h/.kimo/skills/brand-voice/SKILL.md",
    )
    expect(ok.ok && ok.skill).toMatchObject({
      name: "brand-voice",
      description: "Rewrite copy in our voice.",
      body: "# Voice\nShort.",
      source: "user",
    })
    const q = parseSkill(
      '---\nname: "pricing-pages"\ndescription: "Pricing \\"tables\\""\n---\nbody',
      "user",
    )
    expect(q.ok && q.skill.description).toBe('Pricing "tables"')
    expect(parseSkill("no front matter", "user").ok).toBe(false)
    expect(parseSkill("---\nname: Bad Name\ndescription: x\n---\n", "user").ok).toBe(false)
    expect(parseSkill("---\nname: x\n---\n", "user").ok).toBe(false)
  })

  test("user skills load sorted; a name clash with a built-in is reported", async () => {
    const cat = await loadSkills({
      list: async () => [
        {
          path: "/s/pricing-pages/SKILL.md",
          text: "---\nname: pricing-pages\ndescription: p\n---\nP",
        },
        { path: "/s/brand-voice/SKILL.md", text: "---\nname: brand-voice\ndescription: b\n---\nB" },
        {
          path: "/s/kimo-design/SKILL.md",
          text: "---\nname: kimo-design\ndescription: shadow\n---\nX",
        },
        { path: "/s/broken/SKILL.md", text: "oops" },
      ],
    })
    expect(cat.user.map((s) => s.name)).toEqual(["brand-voice", "pricing-pages"])
    expect(cat.errors).toHaveLength(2)
  })

  test("/name forces a skill for one turn; active skills are name-ordered", async () => {
    const cat = await loadSkills({
      list: async () => [{ path: "/b", text: "---\nname: brand-voice\ndescription: b\n---\nB" }],
    })
    const known = new Set([...cat.builtin, ...cat.user].map((s) => s.name))
    expect(parseSlash("/brand-voice rewrite the hero copy", known)).toEqual({
      forced: ["brand-voice"],
      text: "rewrite the hero copy",
    })
    expect(parseSlash("/unknown hi", known)).toEqual({ forced: [], text: "/unknown hi" })
    const act = activeSkills(cat, ["kimo-design"], ["brand-voice"])
    expect(act.map((s) => s.name)).toEqual(["brand-voice", "kimo-design"])
    expect(skillsPrompt(act)).toContain('<skill name="brand-voice">')
    const sys = buildSystemPrompt({
      mode: "split",
      skills: act,
      scope: [{ id: "Hero000001", name: "Hero" }],
    })
    expect(sys.stable).toContain("kimo_spawn_agents")
    expect(sys.volatile).toContain("Hero (Hero000001)")
  })
})

describe("sessions", () => {
  const turn = (id: string, groups: number): TurnRecord => ({
    id,
    model: { provider: "anthropic", model: "claude-opus-5-5" },
    thinking: "auto",
    startedAt: 0,
    endedAt: 1,
    messages: [
      { role: "user", content: [{ type: "text", text: `prompt ${id}` }] },
      { role: "assistant", content: [{ type: "text", text: "done" }] },
    ],
    usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
    cost: { usd: 0.01, estimated: true, priceVersion: "v" },
    opGroups: Array.from({ length: groups }, (_, i) => ({
      docId: "d_1",
      undoToken: `${id}-${i}`,
      summary: "",
      changed: [],
      tool: "kimo_apply_ops",
    })),
    opsApplied: groups,
    status: "done",
    servedBy: "claude-opus-5-5",
    skillsUsed: [],
  })

  test("store: per file newest first, search by content", async () => {
    const store = createMemorySessionStore()
    let s = newSession({
      id: "s1",
      fileId: "f1",
      fileName: "Marketing",
      model: { provider: "anthropic", model: "claude-opus-5-5" },
      now: 1,
    })
    s = appendTurn(s, turn("t1", 1), 5)
    await store.put(s)
    await store.put(
      newSession({ id: "s2", fileId: "f2", fileName: "Other", model: s.model, now: 3 }),
    )
    expect((await store.list("f1")).map((m) => m.id)).toEqual(["s1"])
    expect((await store.list()).map((m) => m.id)).toEqual(["s1", "s2"])
    expect((await store.search("prompt t1")).map((m) => m.id)).toEqual(["s1"])
    expect(s.costUsd).toBeCloseTo(0.01)
    expect(historyOf(s)).toHaveLength(2)
    const g = groupSessions(await store.list(), "f2")
    expect(g.thisFile.map((m) => m.id)).toEqual(["s2"])
  })

  test("regenerate = undo the last turn's op groups newest first, then resend the same prompt and model", () => {
    let s = newSession({
      fileId: "f",
      fileName: "F",
      model: { provider: "anthropic", model: "claude-opus-5-5" },
    })
    s = appendTurn(appendTurn(s, turn("t1", 1)), turn("t2", 2))
    expect(planRegenerate(s, "t1")).toBeNull()
    const plan = planRegenerate(s, "t2")
    expect(plan?.undo.map((u) => u.token)).toEqual(["t2-1", "t2-0"])
    expect(undoCallInputs(plan?.undo ?? [])[0]).toEqual({
      docId: "d_1",
      action: "undo",
      token: "t2-1",
    })
    expect(plan?.prompt.content[0]).toEqual({ type: "text", text: "prompt t2" })
    expect(plan?.rest.turns).toHaveLength(1)
  })
})

describe("placeholders", () => {
  test("ownership, orphans and tags", () => {
    const live = new Set(["agent:kimo.s.1"])
    expect(isOrphanPlaceholder({ by: "agent:kimo.s.1" }, live)).toBe(false)
    expect(isOrphanPlaceholder({ by: "agent:kimo.old.1" }, live)).toBe(true)
    expect(isOrphanPlaceholder(true, live)).toBe(false)
    expect(
      placeholderTag(
        { by: "agent:kimo.old.1" },
        { name: "Hero", agentLabel: "Kimo", liveOrigins: live },
      ).text,
    ).toBe("Interrupted")
    expect(
      placeholderTag(
        { by: "agent:kimo.s.1" },
        { name: "Hero", agentLabel: "Kimo", liveOrigins: live },
      ).text,
    ).toBe("Kimo · building Hero")
  })

  test("tracker: set by insert/update, released by unset/delete", () => {
    const t = new PlaceholderTracker("agent:kimo.s.0")
    t.observe(
      {
        docId: "d",
        ops: [
          { op: "insert", key: "a", parent: "root", node: { type: "frame", placeholder: true } },
          { op: "update", id: "B000000001", set: { placeholder: true } },
        ],
      },
      [{ key: "a", id: "A000000001" }],
    )
    expect(t.size).toBe(2)
    t.observe({ docId: "d", ops: [{ op: "update", id: "B000000001", unset: ["placeholder"] }] })
    expect(t.clearingCalls()).toEqual([
      {
        docId: "d",
        ops: [{ op: "update", id: "A000000001", unset: ["placeholder"] }],
        label: "Clear placeholders",
      } as never,
    ])
  })
})

describe("prompt nodes", () => {
  const frames: Record<
    string,
    { id: string; box: { x: number; y: number; w: number; h: number } }
  > = {
    Pricing001: { id: "Pricing001", box: { x: 0, y: 0, w: 1200, h: 800 } },
  }
  const doc = {
    frame: (id: string) => frames[id] ?? null,
    notes: [
      {
        id: "N1",
        content: "Use $brand",
        author: "Gui",
        parent: null,
        box: { x: 100, y: 100, w: 200, h: 100 },
      },
      { id: "N2", content: "elsewhere", parent: null, box: { x: 5000, y: 0, w: 10, h: 10 } },
    ],
    origin: "agent:kimo.s.0",
    now: new Date(0),
  }
  const def = { provider: "anthropic", model: "claude-opus-5-5" }

  test("with a target: scope = target, overlapping notes as context", () => {
    const plan = planPromptRun(
      {
        id: "P1",
        content: "Draft 3 cards",
        model: { provider: "openai", model: "gpt-4.1" },
        target: "Pricing001",
        box: { x: 1300, y: 0, w: 280, h: 100 },
      },
      doc,
      providers,
      def,
    )
    expect(plan.scopeRoots).toEqual(["Pricing001"])
    expect(plan.setup).toEqual([])
    expect(plan.model.provider.id).toBe("openai")
    expect(plan.notes).toEqual([{ author: "Gui", content: "Use $brand" }])
    expect(contextNotes(doc.notes, null)).toEqual([])
  })

  test("without a valid target: a placeholder frame next to the prompt", () => {
    const plan = planPromptRun(
      {
        id: "P2",
        name: "Footer prompt",
        content: "Add a footer",
        target: "Gone000001",
        box: { x: 1300, y: 400, w: 280, h: 100 },
      },
      doc,
      providers,
      def,
    )
    expect(plan.scopeRoots).toEqual(["@prompt_target"])
    const ins = plan.setup[0] as unknown as { node: { x: number; placeholder: { by: string } } }
    expect(ins.node.x).toBe(1300 + 280 + 80)
    expect(ins.node.placeholder.by).toBe("agent:kimo.s.0")
  })

  test("no key for the prompt's provider fails loudly", () => {
    expect(() =>
      planPromptRun(
        {
          id: "P3",
          content: "x",
          model: { provider: "gemini", model: "gemini-2.5-pro" },
          box: { x: 0, y: 0, w: 1, h: 1 },
        },
        doc,
        providers,
        def,
      ),
    ).toThrow(ProviderError)
  })

  test("convert note → prompt keeps the body; footer copy", () => {
    expect(
      convertNoteToPromptOp({ id: "N1", body: { type: "note", content: "c", author: "Gui" } }, def),
    ).toEqual({
      op: "replace",
      id: "N1",
      node: { type: "prompt", content: "c", author: "Gui", model: def },
    } as never)
    expect(
      promptFooter(
        { status: "idle", lastRun: { at: 0, ops: 18, costUsd: 0.06, billing: "api" } },
        () => "4m ago",
        formatUsd,
      ),
    ).toBe("Ran 4m ago · 18 ops · $0.06")
    expect(
      promptFooter(
        { status: "idle", lastRun: { at: 0, ops: 3, costUsd: null, billing: "subscription" } },
        () => "now",
        formatUsd,
      ),
    ).toBe("Ran now · 3 ops · subscription")
    expect(
      promptFooter(
        { status: "failed", error: { kind: "unknown_model", message: "no key for Gemini" } },
        () => "",
        formatUsd,
      ),
    ).toBe("Failed · no key for Gemini")
  })
})

describe("tool registry exposure", () => {
  test("the agent sees the M5 registry minus stubs, in registry order", () => {
    const specs = registryToolSpecs("desktop")
    expect(specs[0]?.name).toBe("kimo_get_state")
    expect(specs.some((s) => s.name === "kimo_script")).toBe(false)
    expect(specs.every((s) => (s.inputSchema as { type: string }).type === "object")).toBe(true)
    expect(registryToolSpecs("desktop", ["kimo_save"]).some((s) => s.name === "kimo_save")).toBe(
      false,
    )
  })
})
