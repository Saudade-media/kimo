import { describe, expect, test } from "bun:test"
import { backoffDelay } from "../src/backoff"
import { ProviderError } from "../src/errors"
import {
  anthropicThinking,
  clampEffort,
  effortLevels,
  geminiThinkingBudget,
  MODEL_CATALOG,
  migrateThinking,
  openaiReasoningEffort,
  resolveLegacyModelId,
  resolveModel,
  supportsThinkingControl,
} from "../src/models"
import { estimateCost, sumCosts } from "../src/pricing"
import { newSession, planRegenerate } from "../src/session"
import type { EffortLevel } from "../src/types"

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

const info = (kind: keyof typeof MODEL_CATALOG, id: string) => {
  const m = MODEL_CATALOG[kind].find((x) => x.id === id)
  if (!m) throw new Error(`no ${id}`)
  return m
}

describe("model resolution", () => {
  test("unknown provider or model fails loudly; no fallback", () => {
    expect(() => resolveModel({ provider: "gemini", model: "gemini-2.5-pro" }, providers)).toThrow(
      ProviderError,
    )
    expect(() =>
      resolveModel({ provider: "anthropic", model: "claude-sonnet-9" }, providers),
    ).toThrow(/not known/)
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
})

describe("effort", () => {
  test("models without a thinking control expose no levels; clamp picks the nearest, lower on a tie", () => {
    expect(effortLevels(info("openai", "o3"))).toEqual(["low", "medium", "high"])
    expect(effortLevels(info("openai", "gpt-4.1"))).toEqual([])
    expect(supportsThinkingControl(info("openai", "gpt-4.1"))).toBe(false)
    expect(clampEffort(["low", "medium", "high"], "max")).toBe("high")
    expect(clampEffort(["low", "max"], "medium")).toBe("low")
    expect(clampEffort(["low", "max"], "high")).toBe("max")
    expect(clampEffort([], "high")).toBeUndefined()
  })

  test("saved Off / Auto values migrate, in new sessions and in regenerated turns", () => {
    expect(migrateThinking("off")).toBe("low")
    expect(migrateThinking("auto")).toBe("high")
    expect(migrateThinking("max")).toBe("max")
    expect(migrateThinking(undefined)).toBe("high")
    expect(migrateThinking(42)).toBe("high")
    const s = newSession({
      fileId: "f",
      fileName: "a.kimo",
      model: { provider: "anthropic", model: "claude-opus-5-5" },
      thinking: "auto" as unknown as EffortLevel,
    })
    expect(s.thinking).toBe("high")
    const turn = {
      id: "t1",
      model: s.model,
      thinking: "off" as unknown as EffortLevel,
      messages: [{ role: "user" as const, content: [{ type: "text" as const, text: "hi" }] }],
      opGroups: [],
    }
    const plan = planRegenerate({ ...s, turns: [turn as never] }, "t1")
    expect(plan?.thinking).toBe("low")
  })

  test("each level maps onto the provider's own parameter", () => {
    const opus = info("anthropic", "claude-opus-5-5")
    const haiku = info("anthropic", "claude-haiku-4-5-20251001")
    // Effort models send the level; Off never disables thinking on them.
    expect(anthropicThinking(opus, "max")).toEqual({ effort: "max" })
    expect(anthropicThinking(opus, "off")).toEqual({ effort: "low" })
    // Budget models: Low = no thinking.
    expect(anthropicThinking(haiku, "low")).toEqual({})
    expect(anthropicThinking(haiku, "max")).toEqual({
      thinking: { type: "enabled", budget_tokens: 16000 },
    })
    expect(openaiReasoningEffort(info("openai", "o3"), "max")).toBe("high")
    expect(openaiReasoningEffort(info("openai", "gpt-4.1"), "max")).toBeUndefined()
    const pro = info("gemini", "gemini-2.5-pro")
    expect(geminiThinkingBudget(pro, "low")).toBeLessThan(geminiThinkingBudget(pro, "max") ?? 0)
  })
})

describe("pricing and backoff", () => {
  test("estimates per published price with cache reads; unknown models are null, free runtimes $0", () => {
    const c = estimateCost("anthropic", "claude-opus-5-5", {
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 0,
    })
    expect(c.usd).toBeCloseTo(4 + 2 + 0.2, 10)
    expect(c.estimated).toBe(true)
    const none = { inputTokens: 5, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 }
    expect(estimateCost("openrouter", "x/y", none).usd).toBeNull()
    expect(estimateCost("custom", "llama", none, { free: true }).usd).toBe(0)
    expect(
      sumCosts([
        { usd: 1, estimated: true, priceVersion: "" },
        { usd: null, estimated: true, priceVersion: "" },
      ]),
    ).toEqual({ usd: 1, partial: true })
  })

  test("backoff grows exponentially and honors retry-after", () => {
    const p = { maxAttempts: 5, baseMs: 1000, maxMs: 60_000, jitter: 0 }
    expect(backoffDelay(1, p)).toBe(1000)
    expect(backoffDelay(3, p)).toBe(4000)
    expect(backoffDelay(1, p, 12_000)).toBe(12_000)
  })
})
