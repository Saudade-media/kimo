/**
 * The one config module for model ids (ADR 0006 §5, ADR 0014 §3). Default ids live here and
 * nowhere else; a scheduled CI job checks the Anthropic ones against the Models API
 * (`GET /v1/models/{id}`). A model is always `{provider, model}`; an unknown provider or model
 * fails loudly ({@link resolveModel}), never falls back.
 */
import { ProviderError } from "./errors"
import { EFFORT_LEVELS, type EffortLevel, type ModelSelection } from "./types"

/** Adapter families. `custom` speaks OpenAI- or Anthropic-compatible wire formats. */
export const PROVIDER_KINDS = [
  "anthropic",
  "openai",
  "gemini",
  "openrouter",
  "custom",
  "bedrock",
  "vertex",
  "foundry",
] as const
export type ProviderKind = (typeof PROVIDER_KINDS)[number]

/** How a model takes the Effort control (board 39). `none` hides the control in the chooser. */
export type ThinkingStyle =
  /** Anthropic Opus/Sonnet 5.x, Fable: adaptive thinking, depth via `output_config.effort`. */
  | "effort"
  /** Anthropic Haiku 4.5 and older: `thinking: {type:"enabled", budget_tokens}`. */
  | "budget"
  /** OpenAI reasoning models: `reasoning_effort` / `reasoning.effort`. */
  | "reasoning-effort"
  /** Gemini 2.5: `thinkingConfig.thinkingBudget`. */
  | "gemini-budget"
  | "none"

export interface ModelInfo {
  id: string
  label: string
  thinking: ThinkingStyle
  vision: boolean
  contextWindow: number
  maxOutput: number
  /** Thinking cannot be disabled (Claude Opus 5.5): the detail line says "always thinks". */
  thinkingAlwaysOn?: boolean
  /** Board 39 tag in the chooser's meta slot (at most one per row). */
  tag?: ModelTag
  /** False: an alias of a listed id (resolves, but the chooser does not list it twice). */
  listed?: false
}

/** Board 39 row tags: Best, Fast, Local (Local comes from the provider, not the model). */
export type ModelTag = "best" | "fast" | "local"

/**
 * Known models per adapter family (picker labels and capabilities). Open-ended families
 * (`openai`, `openrouter`, `custom`) also accept ids the provider lists at runtime
 * (`Provider.listModels()`) or the user added in Settings.
 */
export const MODEL_CATALOG: Readonly<Record<ProviderKind, readonly ModelInfo[]>> = {
  anthropic: [
    {
      id: "claude-opus-5-5",
      label: "Claude Opus 5.5",
      thinking: "effort",
      thinkingAlwaysOn: true,
      tag: "best",
      vision: true,
      contextWindow: 1_000_000,
      maxOutput: 128_000,
    },
    {
      id: "claude-sonnet-5-5",
      label: "Claude Sonnet 5.5",
      thinking: "effort",
      vision: true,
      contextWindow: 1_000_000,
      maxOutput: 128_000,
    },
    {
      id: "claude-haiku-4-5-20251001",
      label: "Claude Haiku 4.5",
      thinking: "budget",
      tag: "fast",
      vision: true,
      contextWindow: 200_000,
      maxOutput: 64_000,
    },
    {
      id: "claude-haiku-4-5",
      label: "Claude Haiku 4.5",
      thinking: "budget",
      tag: "fast",
      listed: false,
      vision: true,
      contextWindow: 200_000,
      maxOutput: 64_000,
    },
    {
      id: "claude-fable-5-1",
      label: "Claude Fable 5.1",
      thinking: "effort",
      thinkingAlwaysOn: true,
      vision: true,
      contextWindow: 1_000_000,
      maxOutput: 128_000,
    },
  ],
  openai: [
    {
      id: "gpt-4.1",
      label: "gpt-4.1",
      thinking: "none",
      vision: true,
      contextWindow: 1_047_576,
      maxOutput: 32_768,
    },
    {
      id: "gpt-4.1-mini",
      label: "gpt-4.1-mini",
      thinking: "none",
      tag: "fast",
      vision: true,
      contextWindow: 1_047_576,
      maxOutput: 32_768,
    },
    {
      id: "o3",
      label: "o3",
      thinking: "reasoning-effort",
      tag: "best",
      vision: true,
      contextWindow: 200_000,
      maxOutput: 100_000,
    },
  ],
  gemini: [
    {
      id: "gemini-2.5-pro",
      label: "Gemini 2.5 Pro",
      thinking: "gemini-budget",
      tag: "best",
      vision: true,
      contextWindow: 1_048_576,
      maxOutput: 65_536,
    },
    {
      id: "gemini-2.5-flash",
      label: "Gemini 2.5 Flash",
      thinking: "gemini-budget",
      tag: "fast",
      vision: true,
      contextWindow: 1_048_576,
      maxOutput: 65_536,
    },
  ],
  openrouter: [],
  custom: [],
  bedrock: [],
  vertex: [],
  foundry: [],
}

/** Default agent and fast models per family (lead decision: Anthropic is the default provider). */
export const DEFAULT_MODELS: Readonly<
  Record<ProviderKind, { agent: string; fast: string } | null>
> = {
  anthropic: { agent: "claude-opus-5-5", fast: "claude-haiku-4-5-20251001" },
  openai: { agent: "gpt-4.1", fast: "gpt-4.1-mini" },
  gemini: { agent: "gemini-2.5-pro", fast: "gemini-2.5-flash" },
  // Open catalogs: the user picks in Settings (no guessed ids ship as defaults).
  openrouter: null,
  custom: null,
  // Cloud platforms use the Anthropic ids (Bedrock adds an `anthropic.` prefix in the relay).
  bedrock: { agent: "claude-opus-5-5", fast: "claude-haiku-4-5-20251001" },
  vertex: { agent: "claude-opus-5-5", fast: "claude-haiku-4-5-20251001" },
  foundry: { agent: "claude-opus-5-5", fast: "claude-haiku-4-5-20251001" },
}

/** The default provider id (lead decision). */
export const DEFAULT_PROVIDER_ID = "anthropic"

/** Ids the scheduled CI job verifies against the Anthropic Models API (ADR 0006 §5). */
export const VERIFIED_ANTHROPIC_IDS: readonly string[] = [
  DEFAULT_MODELS.anthropic?.agent ?? "",
  DEFAULT_MODELS.anthropic?.fast ?? "",
].filter(Boolean)

/** What {@link resolveModel} needs to know about one configured provider. */
export interface ConfiguredProvider {
  id: string
  kind: ProviderKind
  label: string
  models: { agent: string; fast: string }
  /** Extra ids the user added, plus ids the provider listed at runtime. */
  extraModels?: readonly string[]
}

export interface ResolvedModel {
  selection: ModelSelection
  provider: ConfiguredProvider
  info: ModelInfo
}

/** Capabilities for an id outside the static catalog (open families). Conservative. */
export function genericModelInfo(id: string): ModelInfo {
  return {
    id,
    label: id,
    thinking: "none",
    vision: false,
    contextWindow: 128_000,
    maxOutput: 8_192,
  }
}

export function catalogInfo(kind: ProviderKind, id: string): ModelInfo | undefined {
  const own = MODEL_CATALOG[kind].find((m) => m.id === id)
  if (own) return own
  // Cloud platforms serve the Anthropic catalog.
  if (kind === "bedrock" || kind === "vertex" || kind === "foundry")
    return MODEL_CATALOG.anthropic.find((m) => m.id === id)
  return undefined
}

/**
 * Resolves a selection against the configured providers. Throws `unknown_model` when the
 * provider is not configured or the model is neither in the catalog, nor the provider's agent /
 * fast model, nor in its extra list. Never substitutes another provider or model.
 */
export function resolveModel(
  selection: ModelSelection,
  providers: readonly ConfiguredProvider[],
): ResolvedModel {
  const provider = providers.find((p) => p.id === selection.provider)
  if (!provider)
    throw new ProviderError(
      "unknown_model",
      `Provider "${selection.provider}" is not configured. Add it in Settings › AI providers.`,
      { provider: selection.provider },
    )
  const known = catalogInfo(provider.kind, selection.model)
  const listed =
    selection.model === provider.models.agent ||
    selection.model === provider.models.fast ||
    (provider.extraModels ?? []).includes(selection.model)
  if (!known && !listed)
    throw new ProviderError(
      "unknown_model",
      `Model "${selection.model}" is not known for ${provider.label}. Pick a listed model or add the id in Settings.`,
      { provider: provider.id },
    )
  return { selection, provider, info: known ?? genericModelInfo(selection.model) }
}

/**
 * Legacy prompt-node form (format §5.5): a bare model id. Resolves only when exactly one
 * configured provider knows the id; otherwise fails loudly (no silent fallback).
 */
export function resolveLegacyModelId(
  id: string,
  providers: readonly ConfiguredProvider[],
): ResolvedModel {
  const matches = providers.filter(
    (p) =>
      catalogInfo(p.kind, id) !== undefined ||
      p.models.agent === id ||
      p.models.fast === id ||
      (p.extraModels ?? []).includes(id),
  )
  if (matches.length !== 1)
    throw new ProviderError(
      "unknown_model",
      matches.length === 0
        ? `No configured provider serves "${id}".`
        : `"${id}" is served by ${matches.map((m) => m.label).join(" and ")}; set {provider, model} on the prompt.`,
      { provider: matches[0]?.id ?? "unknown" },
    )
  return resolveModel({ provider: (matches[0] as ConfiguredProvider).id, model: id }, providers)
}

// --- Effort mapping (board 39) ---------------------------------------------------------------

/** The Effort levels a thinking style supports, lowest first. Empty: the chooser hides Effort. */
export function effortLevelsOf(style: ThinkingStyle): readonly EffortLevel[] {
  switch (style) {
    case "effort":
    case "budget":
    case "gemini-budget":
      return EFFORT_LEVELS
    case "reasoning-effort":
      return ["low", "medium", "high"]
    case "none":
      return []
  }
}

/** The Effort levels this model supports (board 39 "only the levels the model supports"). */
export function effortLevels(info: ModelInfo): readonly EffortLevel[] {
  return effortLevelsOf(info.thinking)
}

/** The level a new session starts at (board 39 A: High). */
export const DEFAULT_EFFORT: EffortLevel = "high"

/**
 * Reads a saved effort: board 39 levels pass through; the old Off / Auto / Max map to Low /
 * High / Max (Auto was "high" for effort models, the agentic default); anything else → High.
 */
export function migrateThinking(v: unknown): EffortLevel {
  if (typeof v !== "string") return DEFAULT_EFFORT
  if ((EFFORT_LEVELS as readonly string[]).includes(v)) return v as EffortLevel
  if (v === "off") return "low"
  if (v === "max") return "max"
  return DEFAULT_EFFORT
}

/**
 * The level to send for `levels`: the wanted one when supported, else the nearest supported
 * one (lower first: Max on a Low/Medium/High model is High). Undefined when `levels` is empty.
 */
export function clampEffort(
  levels: readonly EffortLevel[],
  wanted: unknown,
): EffortLevel | undefined {
  if (levels.length === 0) return undefined
  const want = migrateThinking(wanted)
  if (levels.includes(want)) return want
  const at = EFFORT_LEVELS.indexOf(want)
  let best = levels[0] as EffortLevel
  let dist = Number.POSITIVE_INFINITY
  for (const l of levels) {
    const d = Math.abs(EFFORT_LEVELS.indexOf(l) - at)
    // Ties go to the lower level.
    if (d < dist || (d === dist && EFFORT_LEVELS.indexOf(l) < EFFORT_LEVELS.indexOf(best))) {
      best = l
      dist = d
    }
  }
  return best
}

export type AnthropicThinking =
  | { thinking?: undefined; effort: EffortLevel }
  | { thinking: { type: "enabled"; budget_tokens: number }; effort?: undefined }
  | { thinking?: undefined; effort?: undefined }

/** Haiku 4.5 budgets per level (Low runs without extended thinking). */
export const ANTHROPIC_BUDGETS: Readonly<Record<EffortLevel, number>> = {
  low: 0,
  medium: 4_096,
  high: 8_192,
  max: 16_000,
}

/**
 * Effort → Anthropic parameters (claude-api skill, 2026-09):
 * - `effort` models (Opus/Sonnet 5.5, Fable 5.1): `output_config.effort` = the level as is
 *   (always set: Opus 5.5's own default is `medium`). `thinking` is adaptive.
 * - `budget` models (Haiku 4.5): Low = no thinking, Medium 4 096, High 8 192, Max 16 000
 *   budget tokens.
 */
export function anthropicThinking(info: ModelInfo, level: unknown): AnthropicThinking {
  const l = clampEffort(effortLevels(info), level)
  if (!l) return {}
  if (info.thinking === "effort") return { effort: l }
  if (info.thinking === "budget") {
    const budget = ANTHROPIC_BUDGETS[l]
    return budget > 0 ? { thinking: { type: "enabled", budget_tokens: budget } } : {}
  }
  return {}
}

/** OpenAI `reasoning_effort` for reasoning models (Low / Medium / High); undefined otherwise. */
export function openaiReasoningEffort(
  info: ModelInfo,
  level: unknown,
): "low" | "medium" | "high" | undefined {
  if (info.thinking !== "reasoning-effort") return undefined
  return clampEffort(effortLevels(info), level) as "low" | "medium" | "high" | undefined
}

/** Gemini 2.5 `thinkingBudget` per level (Pro cannot turn thinking off, so Low is 1 024). */
export const GEMINI_BUDGETS: Readonly<Record<EffortLevel, number>> = {
  low: 1_024,
  medium: 8_192,
  high: 16_384,
  max: 24_576,
}

/** Gemini `thinkingBudget` for the level; undefined for models without it. */
export function geminiThinkingBudget(info: ModelInfo, level: unknown): number | undefined {
  if (info.thinking !== "gemini-budget") return undefined
  const l = clampEffort(effortLevels(info), level)
  return l ? GEMINI_BUDGETS[l] : undefined
}

/** Whether the chooser shows Effort for this model (board 39 "hidden when it supports none"). */
export function supportsThinkingControl(info: ModelInfo): boolean {
  return effortLevels(info).length > 0
}

/** "1M", "200K", "128K", "65K" (board 39 detail line). */
export function compactTokens(n: number): string {
  if (n >= 1_000_000) return `${Math.floor(n / 100_000) / 10}M`
  return `${Math.floor(n / 1000)}K`
}

/** Board 39 B detail line: "1M context · 128K output · always thinks". */
export function modelDetail(
  info: Pick<ModelInfo, "contextWindow" | "maxOutput" | "thinkingAlwaysOn">,
): string {
  const parts = [
    `${compactTokens(info.contextWindow)} context`,
    `${compactTokens(info.maxOutput)} output`,
  ]
  if (info.thinkingAlwaysOn) parts.push("always thinks")
  return parts.join(" · ")
}
