/**
 * Per-turn cost warning (desing.pen board 27 §10 (b) EP0Ir, rules THx2k "Per-turn warning" and
 * r9hTk "Show cost"). Before a turn is sent its cost is estimated as
 *
 *   input tokens × input price + expected output tokens × output price
 *
 * and compared with Settings › AI providers › "Warn per turn above" (`warnPerTurnUsd`; 0 = never
 * warn). Over it the message is held and the card offers Send anyway / Edit message. Side by side
 * and split count as one turn × N agents, iterate × passes. Subscription CLIs, local / free
 * runtimes and unpriced models never warn (they have no dollar estimate).
 *
 * The input side is a heuristic — the real context is read by tools during the turn: a fixed
 * system + tool-definition budget, ~4 characters per token of the thread so far and the new
 * message, a flat budget per attached image and per selected frame (its node tree is read).
 *
 * The output side is the *expected* reply, not the request's output cap: a design turn's reply
 * (prose + tool calls) typically lands well under 4k tokens, while the cap is 32k–128k. Pricing
 * the cap made every turn on an expensive model (Fable: 32k × $50/M = $1.60) trip the $1 default,
 * so the estimate uses min(model max output, {@link TURN_OUTPUT_TYPICAL}).
 */
import {
  estimateCost,
  formatTokens,
  formatUsd,
  MODEL_CATALOG,
  type ProviderKind,
} from "@kimo/ai-agent"

/** System prompt + tool definitions sent with every request (tokens). */
export const SYSTEM_TOKENS = 6_000
/** One attached image (≈ 1.15k × 1.15k at Anthropic's 750 px²/token). */
export const IMAGE_TOKENS = 1_600
/** One selected frame: its node tree as read by `kimo_get_state` (average). */
export const FRAME_TOKENS = 1_500
/** Output cap of one request when the adapter is not told otherwise (anthropic.ts: 32k). */
export const TURN_OUTPUT_CAP = 32_000
/**
 * Expected output of one turn (tokens): a typical design turn's reply — a short answer plus the
 * tool-call JSON of a few edits. Used instead of the cap so the warning tracks a realistic cost.
 */
export const TURN_OUTPUT_TYPICAL = 4_096

/** ~4 characters per token (English prose + JSON). */
export const tokensOfText = (s: string): number => Math.ceil(s.length / 4)

export interface TurnEstimateInput {
  /** Provider family of the selected model (`anthropic`, `openai`, …). */
  kind: ProviderKind
  model: string
  /** Free / local runtime (custom endpoint marked free). */
  free?: boolean
  /** The new message text. */
  text: string
  /** Text of the thread so far (sent as history). */
  history: readonly string[]
  /** Selected frames / layers attached as chips. */
  frames: number
  images: number
  /** Agents that run this turn (side by side / split N, iterate passes); default 1. */
  multiplier?: number
}

export interface TurnEstimate {
  inputTokens: number
  outputTokens: number
  /** Total tokens of the turn (in + expected out) × multiplier. */
  tokens: number
  /** Null: the model has no price (never warns). */
  usd: number | null
  frames: number
  images: number
}

export function estimateTurn(i: TurnEstimateInput): TurnEstimate {
  const n = Math.max(1, i.multiplier ?? 1)
  const inputTokens =
    SYSTEM_TOKENS +
    tokensOfText(i.text) +
    i.history.reduce((t, h) => t + tokensOfText(h), 0) +
    i.images * IMAGE_TOKENS +
    i.frames * FRAME_TOKENS
  const info = MODEL_CATALOG[i.kind].find((m) => m.id === i.model)
  const outputTokens = Math.min(info?.maxOutput ?? TURN_OUTPUT_CAP, TURN_OUTPUT_TYPICAL)
  const c = estimateCost(
    i.kind,
    i.model,
    { inputTokens, outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 },
    i.free ? { free: true } : {},
  )
  return {
    inputTokens: inputTokens * n,
    outputTokens: outputTokens * n,
    tokens: (inputTokens + outputTokens) * n,
    usd: c.usd === null ? null : c.usd * n,
    frames: i.frames,
    images: i.images,
  }
}

/** Over the per-turn threshold? 0 / empty / NaN threshold = never warn; no price = never warn. */
export function shouldWarn(e: Pick<TurnEstimate, "usd">, warnPerTurnUsd: number | null): boolean {
  if (!warnPerTurnUsd || !Number.isFinite(warnPerTurnUsd) || warnPerTurnUsd <= 0) return false
  if (e.usd === null || e.usd <= 0) return false
  return e.usd > warnPerTurnUsd
}

/** The held turn shown in the card. */
export interface CostWarningView {
  /** The held message text. */
  text: string
  estimate: TurnEstimate
  thresholdUsd: number
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`

/** "14 frames + 3 images in context" / "a long thread in context". */
export function contextPhrase(e: Pick<TurnEstimate, "frames" | "images">): string {
  const parts = [
    ...(e.frames > 0 ? [plural(e.frames, "frame")] : []),
    ...(e.images > 0 ? [plural(e.images, "image")] : []),
  ]
  return parts.length ? `${parts.join(" + ")} in context` : "a long thread in context"
}

/**
 * Card copy. Show cost on: "This turn may cost about $0.42" / "Above your $0.25 per-turn warning
 * — 14 frames + 3 images in context. Trim the selection or send anyway." Off (no $ anywhere):
 * "This turn is large: ~180k tokens" / "Above your per-turn warning: …".
 */
export function costWarningCopy(
  w: CostWarningView,
  showCost: boolean,
): { title: string; description: string } {
  const ctx = contextPhrase(w.estimate)
  if (!showCost)
    return {
      title: `This turn is large: ~${formatTokens(w.estimate.tokens)} tokens`,
      description: `Above your per-turn warning: ${ctx}. Trim the selection or send anyway.`,
    }
  return {
    title: `This turn may cost about ${formatUsd(w.estimate.usd)}`,
    description: `Above your ${formatUsd(w.thresholdUsd)} per-turn warning: ${ctx}. Trim the selection or send anyway.`,
  }
}
