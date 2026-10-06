/**
 * Board 39 model chooser: per-provider model lists, per-model Effort levels, their mapping onto
 * each provider's parameter and CLI flag, and the migration of saved Off / Auto / Max values.
 */
import { describe, expect, test } from "bun:test"
import {
  CLAUDE_CODE,
  CODEX,
  claudeInvocation,
  cliEffort,
  cliModelEfforts,
  codexInvocation,
  GEMINI_CLI,
  geminiInvocation,
} from "../src/cli/adapters"
import { shimLaunch } from "../src/cli/engine"
import type { CliTurnInput } from "../src/cli/types"
import {
  anthropicThinking,
  clampEffort,
  compactTokens,
  effortLevels,
  geminiThinkingBudget,
  MODEL_CATALOG,
  migrateThinking,
  modelDetail,
  openaiReasoningEffort,
  supportsThinkingControl,
} from "../src/models"
import { newSession, planRegenerate } from "../src/session"
import type { EffortLevel } from "../src/types"

const info = (kind: keyof typeof MODEL_CATALOG, id: string) => {
  const m = MODEL_CATALOG[kind].find((x) => x.id === id)
  if (!m) throw new Error(`no ${id}`)
  return m
}

describe("catalog", () => {
  test("API providers list specific versioned models, at most one tag each", () => {
    expect(MODEL_CATALOG.anthropic.filter((m) => m.listed !== false).map((m) => m.label)).toEqual([
      "Claude Opus 5.5",
      "Claude Sonnet 5.5",
      "Claude Haiku 4.5",
      "Claude Fable 5.1",
    ])
    expect(MODEL_CATALOG.openai.map((m) => m.id)).toEqual(["gpt-4.1", "gpt-4.1-mini", "o3"])
    expect(MODEL_CATALOG.gemini.map((m) => m.id)).toEqual(["gemini-2.5-pro", "gemini-2.5-flash"])
    expect(info("anthropic", "claude-opus-5-5").tag).toBe("best")
    expect(info("anthropic", "claude-haiku-4-5-20251001").tag).toBe("fast")
  })

  test("CLIs list Default (CLI decides) first, then the verified full ids", () => {
    const listed = (models: typeof CLAUDE_CODE.models) =>
      models.filter((m) => m.listed !== false).map((m) => m.id)
    expect(listed(CLAUDE_CODE.models)).toEqual([
      "default",
      "claude-opus-5-5",
      "claude-sonnet-5-5",
      "claude-haiku-4-5-20251001",
      "claude-fable-5-1",
    ])
    expect(listed(CODEX.models)).toEqual(["default", "gpt-5.6-terra", "gpt-5.6-luna"])
    expect(listed(GEMINI_CLI.models)).toEqual(["default", "gemini-2.5-pro", "gemini-2.5-flash"])
    for (const def of [CLAUDE_CODE, CODEX, GEMINI_CLI])
      expect(def.models[0]?.label).toBe("Default (CLI decides)")
    // The old "(latest)" aliases still resolve (saved sessions) but are not listed.
    expect(CLAUDE_CODE.models.find((m) => m.id === "opus")?.listed).toBe(false)
  })

  test("detail line: context, output, always thinks", () => {
    expect(modelDetail(info("anthropic", "claude-opus-5-5"))).toBe(
      "1M context · 128K output · always thinks",
    )
    expect(modelDetail(info("anthropic", "claude-haiku-4-5-20251001"))).toBe(
      "200K context · 64K output",
    )
    expect(compactTokens(65_536)).toBe("65K")
    expect(compactTokens(1_048_576)).toBe("1M")
  })
})

describe("effort levels", () => {
  test("only the levels each model supports; none hides the control", () => {
    expect(effortLevels(info("anthropic", "claude-opus-5-5"))).toEqual([
      "low",
      "medium",
      "high",
      "max",
    ])
    expect(effortLevels(info("openai", "o3"))).toEqual(["low", "medium", "high"])
    expect(effortLevels(info("openai", "gpt-4.1"))).toEqual([])
    expect(supportsThinkingControl(info("openai", "gpt-4.1"))).toBe(false)
    expect(effortLevels(info("gemini", "gemini-2.5-flash"))).toHaveLength(4)
  })

  test("clamp picks the nearest supported level, lower on a tie", () => {
    expect(clampEffort(["low", "medium", "high"], "max")).toBe("high")
    expect(clampEffort(["low", "max"], "medium")).toBe("low")
    expect(clampEffort(["low", "max"], "high")).toBe("max")
    expect(clampEffort([], "high")).toBeUndefined()
  })

  test("migration of saved Off / Auto / Max", () => {
    expect(migrateThinking("off")).toBe("low")
    expect(migrateThinking("auto")).toBe("high")
    expect(migrateThinking("max")).toBe("max")
    expect(migrateThinking("medium")).toBe("medium")
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
})

describe("effort mapping per provider", () => {
  const opus = info("anthropic", "claude-opus-5-5")
  const haiku = info("anthropic", "claude-haiku-4-5-20251001")
  test("Anthropic effort models: output_config.effort = the level", () => {
    for (const l of ["low", "medium", "high", "max"] as const)
      expect(anthropicThinking(opus, l)).toEqual({ effort: l })
    // A legacy value read straight from an old turn still maps.
    expect(anthropicThinking(opus, "auto")).toEqual({ effort: "high" })
  })

  test("Anthropic budget models: Low = no thinking, then 4 096 / 8 192 / 16 000", () => {
    expect(anthropicThinking(haiku, "low")).toEqual({})
    expect(anthropicThinking(haiku, "medium")).toEqual({
      thinking: { type: "enabled", budget_tokens: 4096 },
    })
    expect(anthropicThinking(haiku, "high")).toEqual({
      thinking: { type: "enabled", budget_tokens: 8192 },
    })
    expect(anthropicThinking(haiku, "max")).toEqual({
      thinking: { type: "enabled", budget_tokens: 16000 },
    })
  })

  test("OpenAI reasoning models: low / medium / high (Max → high); others none", () => {
    expect(openaiReasoningEffort(info("openai", "o3"), "medium")).toBe("medium")
    expect(openaiReasoningEffort(info("openai", "o3"), "max")).toBe("high")
    expect(openaiReasoningEffort(info("openai", "gpt-4.1"), "max")).toBeUndefined()
  })

  test("Gemini 2.5: thinkingBudget per level", () => {
    const pro = info("gemini", "gemini-2.5-pro")
    expect(["low", "medium", "high", "max"].map((l) => geminiThinkingBudget(pro, l))).toEqual([
      1024, 8192, 16384, 24576,
    ])
  })
})

const turn = (extra: Partial<CliTurnInput>): CliTurnInput => ({
  session: "s",
  model: "default",
  thinking: "high",
  prompt: "hi",
  systemPrompt: "sys",
  mcp: shimLaunch("/k/kimo-mcp", "claude-code"),
  workspace: "/w",
  ...extra,
})

describe("CLI effort flags", () => {
  const at = (args: string[], flag: string) =>
    args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined
  test("Claude Code: --model <full id> and --effort <level>", () => {
    for (const l of ["low", "medium", "high", "max"] as const) {
      const { args } = claudeInvocation(turn({ model: "claude-sonnet-5-5", thinking: l }))
      expect(at(args, "--model")).toBe("claude-sonnet-5-5")
      expect(at(args, "--effort")).toBe(l)
    }
    // Haiku 4.5 takes no effort: no flag.
    const h = claudeInvocation(turn({ model: "claude-haiku-4-5-20251001", thinking: "max" }))
    expect(h.args).not.toContain("--effort")
    // Default (CLI decides): no --model, effort still passed.
    const d = claudeInvocation(turn({ thinking: "low" }))
    expect(d.args).not.toContain("--model")
    expect(at(d.args, "--effort")).toBe("low")
  })

  test("Codex: -m <id> and model_reasoning_effort", () => {
    const { args } = codexInvocation(turn({ model: "gpt-5.6-luna", thinking: "max" }))
    expect(at(args, "--model")).toBe("gpt-5.6-luna")
    expect(args).toContain('model_reasoning_effort="max"')
    const legacy = codexInvocation(turn({ thinking: "auto" as unknown as EffortLevel }))
    expect(legacy.args).toContain('model_reasoning_effort="high"')
  })

  test("Gemini CLI: no effort flag, no Effort control", () => {
    expect(cliModelEfforts(GEMINI_CLI, "gemini-2.5-pro")).toEqual([])
    const { args } = geminiInvocation(turn({ model: "gemini-2.5-pro", thinking: "max" }))
    expect(args.join(" ")).not.toMatch(/effort|thinking/i)
  })

  test("an unlisted id gets the Default row's levels", () => {
    expect(cliEffort(CLAUDE_CODE, "claude-opus-6-0", "medium")).toBe("medium")
    expect(cliEffort(CODEX, "gpt-7", "max")).toBe("max")
  })
})
