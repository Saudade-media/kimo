/**
 * Board 27 §10 (a) q2UAb + (b) EP0Ir, rules q07tZ "Default provider", THx2k "Per-turn
 * warning", r9hTk "Show cost": the turn estimate, the threshold, the held send (Send anyway /
 * Edit message), Show cost off hiding every $ while tokens stay, and the Default provider /
 * Default model rows with their fallback when the default provider is removed.
 */
import { describe, expect, test } from "bun:test"
import type { CliDetection } from "@kimo/ai-agent"
import { createEmptyDocument, importDocument } from "@kimo/editor-state"
import { CostWarningCard } from "@kimo/ui"
import { createElement as h } from "react"
import { renderToString } from "react-dom/server"
import {
  createAgentPanelController,
  createInWindowTools,
  headerCostLabel,
  sessionMetaLabel,
} from "../src/agent-panel"
import {
  contextPhrase,
  costWarningCopy,
  estimateTurn,
  FRAME_TOKENS,
  IMAGE_TOKENS,
  SYSTEM_TOKENS,
  shouldWarn,
  TURN_OUTPUT_TYPICAL,
} from "../src/agent-panel/cost-warning"
import { createTestRuntime } from "../src/agent-panel/testing"
import { AiProvidersPane } from "../src/ai-settings/AiProvidersPane"
import { defaultProviderChoices, selectionForProvider } from "../src/ai-settings/model"
import { createMockFetch, createTestAiSettings } from "../src/ai-settings/testing"
import { AGENT_USAGE_DEFAULTS, type AgentUsageSettings } from "../src/platform/contract"

describe("turn estimate (THx2k)", () => {
  test("input tokens × input price + expected output × output price", () => {
    const e = estimateTurn({
      kind: "anthropic",
      model: "claude-opus-5-5",
      text: "a".repeat(400),
      history: ["b".repeat(4000)],
      frames: 2,
      images: 1,
    })
    const input = SYSTEM_TOKENS + 100 + 1000 + 2 * FRAME_TOKENS + IMAGE_TOKENS
    expect(e.inputTokens).toBe(input)
    expect(e.outputTokens).toBe(TURN_OUTPUT_TYPICAL)
    expect(e.tokens).toBe(input + TURN_OUTPUT_TYPICAL)
    // Opus 5.5: $4 / M in, $20 / M out.
    expect(e.usd).toBeCloseTo((input * 4 + TURN_OUTPUT_TYPICAL * 20) / 1e6, 9)
  })

  test("a plain Fable turn stays under the $1 default (expected output, not the 128k cap)", () => {
    const e = estimateTurn({
      kind: "anthropic",
      model: "claude-fable-5-1",
      text: "Make the hero warmer",
      history: [],
      frames: 1,
      images: 0,
    })
    expect(e.outputTokens).toBe(TURN_OUTPUT_TYPICAL)
    expect(e.usd ?? 0).toBeLessThan(1)
    expect(shouldWarn(e, 1)).toBe(false)
  })

  test("the expected output never exceeds a model's own max output", () => {
    const e = estimateTurn({
      kind: "anthropic",
      model: "not-in-catalog",
      text: "",
      history: [],
      frames: 0,
      images: 0,
    })
    expect(e.outputTokens).toBeLessThanOrEqual(TURN_OUTPUT_TYPICAL)
  })

  test("side by side × N counts as one turn × N", () => {
    const one = estimateTurn({
      kind: "anthropic",
      model: "claude-opus-5-5",
      text: "x",
      history: [],
      frames: 0,
      images: 0,
    })
    const three = estimateTurn({
      kind: "anthropic",
      model: "claude-opus-5-5",
      text: "x",
      history: [],
      frames: 0,
      images: 0,
      multiplier: 3,
    })
    expect(three.tokens).toBe(one.tokens * 3)
    expect(three.usd).toBeCloseTo((one.usd ?? 0) * 3, 9)
  })

  test("free / unpriced models have no $ and never warn", () => {
    const free = estimateTurn({
      kind: "custom",
      model: "llama",
      free: true,
      text: "x",
      history: [],
      frames: 0,
      images: 0,
    })
    expect(free.usd).toBe(0)
    expect(shouldWarn(free, 0.01)).toBe(false)
    const unpriced = estimateTurn({
      kind: "openrouter",
      model: "x/y",
      text: "x",
      history: [],
      frames: 0,
      images: 0,
    })
    expect(unpriced.usd).toBeNull()
    expect(shouldWarn(unpriced, 0.01)).toBe(false)
  })

  test("0 / empty threshold = never warn; strictly above warns", () => {
    expect(shouldWarn({ usd: 5 }, 0)).toBe(false)
    expect(shouldWarn({ usd: 5 }, null)).toBe(false)
    expect(shouldWarn({ usd: 5 }, Number.NaN)).toBe(false)
    expect(shouldWarn({ usd: 0.25 }, 0.25)).toBe(false)
    expect(shouldWarn({ usd: 0.42 }, 0.25)).toBe(true)
  })
})

describe("card copy and Show cost (r9hTk)", () => {
  const w = {
    text: "go",
    thresholdUsd: 0.25,
    estimate: {
      inputTokens: 148_000,
      outputTokens: 32_000,
      tokens: 180_000,
      usd: 0.42,
      frames: 14,
      images: 3,
    },
  }
  test("on: dollars, the board copy", () => {
    expect(costWarningCopy(w, true)).toEqual({
      title: "This turn may cost about $0.42",
      description:
        "Above your $0.25 per-turn warning — 14 frames + 3 images in context. Trim the selection or send anyway.",
    })
  })
  test("off: wording switches to tokens, no $", () => {
    const c = costWarningCopy(w, false)
    expect(c.title).toBe("This turn is large — ~180k tokens")
    expect(`${c.title}${c.description}`).not.toContain("$")
  })
  test("context phrase", () => {
    expect(contextPhrase({ frames: 1, images: 0 })).toBe("1 frame in context")
    expect(contextPhrase({ frames: 0, images: 0 })).toBe("a long thread in context")
  })
  test("header chip and session rows hide $ when off; tokens stay", () => {
    const hdr = { costUsd: 0.31, tokens: 41_000, billing: "api" as const }
    expect(headerCostLabel(hdr)).toBe("$0.31 · 41k tok")
    expect(headerCostLabel(hdr, false)).toBe("41k tok")
    const meta = {
      id: "s1",
      fileId: "f",
      fileName: "Pricing.kimo",
      title: "Warm hero",
      model: { provider: "anthropic", model: "claude-opus-5-5" },
      messageCount: 6,
      billing: "api",
      costUsd: 0.38,
      createdAt: 0,
      updatedAt: 0,
    } as unknown as Parameters<typeof sessionMetaLabel>[0]
    expect(sessionMetaLabel(meta, { otherFile: false, clis: [] })).toBe(
      "Opus 5.5 · 6 messages · $0.38",
    )
    expect(sessionMetaLabel(meta, { otherFile: false, clis: [], showCost: false })).toBe(
      "Opus 5.5 · 6 messages",
    )
    expect(sessionMetaLabel(meta, { otherFile: true, clis: [], showCost: false })).toBe("Pricing")
  })
  test("CostWarningCard renders the qtTiZ parts", () => {
    const html = renderToString(
      h(CostWarningCard, {
        ...costWarningCopy(w, true),
        onSendAnyway: () => {},
        onEditMessage: () => {},
        onSettings: () => {},
      }),
    )
    for (const s of ["This turn may cost about $0.42", "Send anyway", "Edit message", "Settings"])
      expect(html).toContain(s)
  })
})

describe("held send (EP0Ir)", () => {
  function setup(settings: Partial<AgentUsageSettings>) {
    const store = importDocument(createEmptyDocument("P"))
    const tools = createInWindowTools({ store, path: "/u/me/P.kimo" })
    let usage: AgentUsageSettings = { ...AGENT_USAGE_DEFAULTS, ...settings }
    const rt = createTestRuntime({
      tools: tools.factory,
      script: () => ({ text: "Done." }),
      usage: () => ({ ...usage, monthUsd: 0 }),
    })
    const c = createAgentPanelController({
      runtime: rt,
      fileId: "f",
      fileName: "P.kimo",
      docId: () => tools.docId(),
    })
    return { c, set: (p: Partial<AgentUsageSettings>) => (usage = { ...usage, ...p }) }
  }

  test("above the threshold: held, nothing sent; Edit message keeps the text", async () => {
    const { c } = setup({ warnPerTurnUsd: 0.05 })
    await c.refresh()
    c.setText("Redesign everything")
    await c.send("Redesign everything")
    expect(c.state.messages).toEqual([])
    expect(c.state.costWarning?.text).toBe("Redesign everything")
    expect(c.state.costWarning?.thresholdUsd).toBe(0.05)
    expect(c.state.composer.text).toBe("Redesign everything")
    c.editHeldMessage()
    expect(c.state.costWarning).toBeNull()
    expect(c.state.composer.text).toBe("Redesign everything")
    expect(c.state.messages).toEqual([])
  })

  test("Send anyway sends the held message", async () => {
    const { c } = setup({ warnPerTurnUsd: 0.05 })
    await c.refresh()
    await c.send("Go")
    expect(c.state.costWarning).not.toBeNull()
    await c.sendAnyway()
    expect(c.state.costWarning).toBeNull()
    expect(c.state.messages.map((m) => m.kind)).toEqual(["user", "agent"])
    expect(c.state.messages[0]?.kind === "user" && c.state.messages[0].text).toBe("Go")
  })

  test("0 = never warn; under the threshold sends straight away", async () => {
    const { c } = setup({ warnPerTurnUsd: 0 })
    await c.refresh()
    await c.send("Go")
    expect(c.state.costWarning).toBeNull()
    expect(c.state.messages.length).toBe(2)
    const big = setup({ warnPerTurnUsd: 100 })
    await big.c.refresh()
    await big.c.send("Go")
    expect(big.c.state.messages.length).toBe(2)
  })

  test("Show cost mirrors the setting", async () => {
    const { c, set } = setup({ showCost: false })
    await c.refresh()
    expect(c.state.showCost).toBe(false)
    set({ showCost: true })
    await c.refresh()
    expect(c.state.showCost).toBe(true)
  })
})

describe("default provider / model (q2UAb, q07tZ)", () => {
  const KEY = "sk-ant-api03-test-3f9a"
  const cli = (over: Partial<CliDetection>): CliDetection => ({
    id: "claude-code",
    label: "Claude Code",
    installed: true,
    signedIn: true,
    billing: "subscription",
    ...over,
  })

  test("choices list connected providers only (+ signed-in CLIs on desktop)", () => {
    const providers = [
      {
        id: "anthropic",
        kind: "anthropic",
        label: "Anthropic",
        status: "connected",
        models: { agent: "claude-opus-5-5", fast: "claude-haiku-4-5" },
      },
      {
        id: "openai",
        kind: "openai",
        label: "OpenAI",
        status: "not-set",
        models: { agent: "gpt-5", fast: "gpt-5-mini" },
      },
      {
        id: "custom:ollama",
        kind: "custom",
        label: "Ollama",
        status: "local",
        models: { agent: "llama3", fast: "llama3" },
      },
    ] as const
    const choices = defaultProviderChoices({
      platform: "desktop",
      providers,
      clis: [
        { detection: cli({}) },
        { detection: cli({ id: "codex", label: "Codex", signedIn: false }) },
      ],
      selection: null,
    })
    expect(choices.map((c) => c.provider)).toEqual([
      "anthropic",
      "custom:ollama",
      "cli:claude-code",
    ])
    expect(choices[0]?.models.some((m) => m.value === "claude-opus-5-5")).toBe(true)
    expect(selectionForProvider(choices, "anthropic")).toEqual({
      provider: "anthropic",
      model: "claude-opus-5-5",
    })
    // Web: CLIs never listed.
    expect(
      defaultProviderChoices({
        platform: "web",
        providers,
        clis: [{ detection: cli({}) }],
        selection: null,
      }).map((c) => c.provider),
    ).toEqual(["anthropic", "custom:ollama"])
    expect(
      defaultProviderChoices({ platform: "web", providers: [], clis: [], selection: null }),
    ).toEqual([])
  })

  test("Make default; removing the default falls back to the next connected provider", async () => {
    const c = createTestAiSettings({ clis: {}, fetch: createMockFetch() })
    await c.refresh()
    await c.setKey("anthropic", KEY)
    await c.addCustom({
      label: "LM Studio",
      baseURL: "http://localhost:1234/v1",
      wire: "openai-chat",
      models: { agent: "qwen", fast: "qwen" },
      free: true,
    })
    const custom = c.state.providers.find((p) => p.label === "LM Studio")
    if (!custom) throw new Error("no custom row")
    await c.setDefault({ provider: custom.id, model: "qwen" })
    expect(c.state.defaultSelection?.provider).toBe(custom.id)
    await c.removeProvider(custom.id)
    expect(c.state.defaultSelection).toEqual({ provider: "anthropic", model: "claude-opus-5-5" })
  })

  test("pane: Default provider / Default model rows; disabled copy with nothing connected", async () => {
    const none = createTestAiSettings({ clis: {} })
    await none.refresh()
    const empty = renderToString(h(AiProvidersPane, { platform: null, controller: none }))
    expect(empty).toContain("Default provider")
    expect(empty).toContain("Default model")
    expect(empty).toContain("Connect a provider first")

    const c = createTestAiSettings({ clis: {}, fetch: createMockFetch() })
    await c.refresh()
    await c.setKey("anthropic", KEY)
    const html = renderToString(h(AiProvidersPane, { platform: null, controller: c }))
    expect(html).toContain("New agent sessions start here. Only connected providers are listed.")
    expect(html).toContain("Fast model is used for titles and summaries.")
    expect(html).toContain('data-testid="ai-default-action"')
    expect(html).toContain(">Default<")
  })
})
