/**
 * Versioned price tables and the cost estimator (ADR 0014 §7). Costs shown in Kimo are always
 * **estimated**: response token usage × the provider's published per-token price as of the
 * table version. The provider's invoice is the source of truth (board 22 Usage & limits copy).
 *
 * Each adapter family owns one table; a table update bumps its `version`. Unknown models
 * estimate to `null` (the UI shows "—"), never to a guessed price.
 */
import type { ProviderKind } from "./models"
import type { Usage } from "./types"

/** USD per 1M tokens. */
export interface ModelPrice {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export interface PriceTable {
  /** ISO date the prices were taken from the provider's pricing page. */
  version: string
  source: string
  /** Model id → price. Ids without a date suffix also match dated snapshots by prefix. */
  models: Readonly<Record<string, ModelPrice>>
  /** True when every request is free (local runtimes). */
  free?: boolean
}

const anthropic: PriceTable = {
  version: "2026-09-25",
  source: "https://platform.claude.com/docs/en/about-claude/pricing",
  models: {
    // Cache writes (5-minute TTL) are 1.25× input; reads as published.
    "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
    "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
    "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
    "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
    "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  },
}

/** OpenAI list prices (Chat Completions / Responses), unverified since 2025; refresh before release. */
const openai: PriceTable = {
  version: "2025-08-01",
  source: "https://openai.com/api/pricing",
  models: {
    "gpt-4.1": { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 2 },
    "gpt-4.1-mini": { input: 0.4, output: 1.6, cacheRead: 0.1, cacheWrite: 0.4 },
    o3: { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 2 },
  },
}

/** Gemini paid-tier prices for prompts ≤ 200k tokens, unverified since 2025; refresh before release. */
const gemini: PriceTable = {
  version: "2025-08-01",
  source: "https://ai.google.dev/gemini-api/docs/pricing",
  models: {
    "gemini-2.5-pro": { input: 1.25, output: 10, cacheRead: 0.31, cacheWrite: 1.25 },
    "gemini-2.5-flash": { input: 0.3, output: 2.5, cacheRead: 0.075, cacheWrite: 0.3 },
  },
}

const none = (source: string): PriceTable => ({ version: "2026-10-04", source, models: {} })

/** Price tables per family. OpenRouter/custom have no static table (`null` estimates). */
export const PRICE_TABLES: Readonly<Record<ProviderKind, PriceTable>> = {
  anthropic,
  openai,
  gemini,
  openrouter: none("https://openrouter.ai/models"),
  custom: none("user endpoint"),
  // Partner pricing differs (Bedrock/Vertex); Foundry bills at Anthropic list prices.
  bedrock: none("https://aws.amazon.com/bedrock/pricing/"),
  vertex: none("https://cloud.google.com/vertex-ai/generative-ai/pricing"),
  foundry: anthropic,
}

export interface CostEstimate {
  /** Estimated USD, or null when the model has no price. */
  usd: number | null
  /** Always true: Kimo never shows costs as billed amounts. */
  estimated: true
  /** Table version used. */
  priceVersion: string
}

export function priceFor(table: PriceTable, model: string): ModelPrice | undefined {
  const exact = table.models[model]
  if (exact) return exact
  // Dated snapshots (`claude-haiku-4-5-20251001`) match their alias.
  const alias = model.replace(/-\d{8}$/, "")
  return table.models[alias]
}

/**
 * Estimated cost of `usage` on `model`. `inputTokens` are uncached input tokens (Anthropic
 * semantics); adapters that report cached tokens inside the input total subtract them first.
 */
export function estimateCost(
  kind: ProviderKind,
  model: string,
  usage: Usage,
  options: { free?: boolean } = {},
): CostEstimate {
  const table = PRICE_TABLES[kind]
  if (options.free || table.free) return { usd: 0, estimated: true, priceVersion: table.version }
  const p = priceFor(table, model)
  if (!p) return { usd: null, estimated: true, priceVersion: table.version }
  const usd =
    (usage.inputTokens * p.input +
      usage.outputTokens * p.output +
      usage.cacheReadTokens * p.cacheRead +
      usage.cacheWriteTokens * p.cacheWrite) /
    1_000_000
  return { usd, estimated: true, priceVersion: table.version }
}

/** Sums estimates; null contributions make the total a lower bound (`partial`). */
export function sumCosts(costs: readonly CostEstimate[]): { usd: number; partial: boolean } {
  let usd = 0
  let partial = false
  for (const c of costs) {
    if (c.usd === null) partial = true
    else usd += c.usd
  }
  return { usd, partial }
}

/** "$0.034" / "$1.12" / "$0.00" as on board 22. */
export function formatUsd(usd: number | null): string {
  if (usd === null) return "—"
  if (usd > 0 && usd < 0.1) return `$${usd.toFixed(3).replace(/0$/, "")}`
  return `$${usd.toFixed(2)}`
}

/** "41k tok" / "2.31M tokens" rounding (board 22 thread header). */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}
