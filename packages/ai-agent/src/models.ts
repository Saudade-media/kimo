/**
 * The one config module for model ids (ADR 0006 §5, ADR 0014 §3). Default ids live here and
 * nowhere else; a scheduled CI job checks the Anthropic ones against the Models API
 * (`GET /v1/models/{id}`). A model is always `{provider, model}`; an unknown provider or model
 * fails loudly ({@link resolveModel}), never falls back.
 */
import { ProviderError } from "./errors"
import type { ModelSelection, ThinkingMode } from "./types"

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

/** How a model takes the Off / Auto / Max control. `none` hides the control in the picker. */
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
  /** Thinking cannot be disabled (Claude Opus 5.5: Off maps to the lowest effort). */
  thinkingAlwaysOn?: boolean
}

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
      vision: true,
      contextWindow: 200_000,
      maxOutput: 64_000,
    },
    {
      id: "claude-haiku-4-5",
      label: "Claude Haiku 4.5",
      thinking: "budget",
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
      vision: true,
      contextWindow: 1_047_576,
      maxOutput: 32_768,
    },
    {
      id: "o3",
      label: "o3",
      thinking: "reasoning-effort",
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
      vision: true,
      contextWindow: 1_048_576,
      maxOutput: 65_536,
    },
    {
      id: "gemini-2.5-flash",
      label: "Gemini 2.5 Flash",
      thinking: "gemini-budget",
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

// --- Thinking mapping -------------------------------------------------------------------------

export type AnthropicThinking =
  | { thinking?: undefined; effort: "low" | "medium" | "high" | "max" }
  | { thinking: { type: "enabled"; budget_tokens: number }; effort?: undefined }
  | { thinking?: undefined; effort?: undefined }

/**
 * Off / Auto / Max → Anthropic parameters (claude-api skill, 2026-09):
 * - `effort` models (Opus 5.5 cannot disable thinking): Off = effort `low`, Auto = `high`
 *   (agentic design work; Opus 5.5's own default is `medium`, so it is always set explicitly),
 *   Max = `max`. `thinking` is omitted (adaptive).
 * - `budget` models (Haiku 4.5): Off = no thinking, Auto = 4 096, Max = 16 000 budget tokens.
 */
export function anthropicThinking(info: ModelInfo, mode: ThinkingMode): AnthropicThinking {
  if (info.thinking === "effort")
    return { effort: mode === "off" ? "low" : mode === "max" ? "max" : "high" }
  if (info.thinking === "budget") {
    if (mode === "off") return {}
    return { thinking: { type: "enabled", budget_tokens: mode === "max" ? 16_000 : 4_096 } }
  }
  return {}
}

/** OpenAI `reasoning_effort` for reasoning models; undefined otherwise. */
export function openaiReasoningEffort(
  info: ModelInfo,
  mode: ThinkingMode,
): "low" | "medium" | "high" | undefined {
  if (info.thinking !== "reasoning-effort") return undefined
  return mode === "off" ? "low" : mode === "max" ? "high" : "medium"
}

/** Gemini `thinkingBudget`: 0 off, -1 dynamic, 24 576 max. */
export function geminiThinkingBudget(info: ModelInfo, mode: ThinkingMode): number | undefined {
  if (info.thinking !== "gemini-budget") return undefined
  return mode === "off" ? 0 : mode === "max" ? 24_576 : -1
}

/** Whether the picker shows Off / Auto / Max for this model (board 22 "shown only for models that support it"). */
export function supportsThinkingControl(info: ModelInfo): boolean {
  return info.thinking !== "none"
}
