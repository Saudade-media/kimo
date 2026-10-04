/**
 * Copy and number formats of the agent panel (board 22 s4pGz0): message meta "3.1k in · 1.4k
 * out · $0.034 · 11.2s", thread header "$0.38 · 41k tok", session rows "Opus 5.5 · 6 messages ·
 * $0.38", relative times "now / 1h / yesterday / Oct 1".
 */
import {
  type CliDetection,
  cliIdOf,
  formatTokens,
  formatUsd,
  isCliProvider,
  MODEL_CATALOG,
  type ModelSelection,
  type SessionMeta,
} from "@kimo/ai-agent"
import type { MessageMetaView } from "../platform/contract"

/** "3.1k in · 1.4k out". */
export function tokensLabel(tokensIn: number, tokensOut: number): string {
  return `${formatTokens(tokensIn)} in · ${formatTokens(tokensOut)} out`
}

/**
 * Cost cell of MessageMeta: dollars for API turns ("$0.034", "—" when the model has no price),
 * "subscription" for subscription CLIs (never dollars), the CLI's reported dollars for
 * `cli-api-key`, "$0.00" for local runtimes.
 */
export function costLabel(m: Pick<MessageMetaView, "costUsd" | "billing">): string {
  if (m.billing === "subscription") return "subscription"
  if (m.billing === "local") return "$0.00"
  return formatUsd(m.costUsd)
}

/** "11.2s", "1m 04s". */
export function durationLabel(ms: number): string {
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  return `${m}m ${String(Math.round(s % 60)).padStart(2, "0")}s`
}

/** Thread header chip: "$0.38 · 41k tok" (API), "subscription · 41k tok" (CLI). */
export function headerCostLabel(h: {
  costUsd: number | null
  tokens: number
  billing: MessageMetaView["billing"]
}): string {
  const k = `${formatTokens(h.tokens)} tok`
  if (h.billing === "subscription") return `subscription · ${k}`
  return `${formatUsd(h.costUsd ?? null)} · ${k}`
}

/** "Opus 5.5", "Haiku 4.5", "gpt-4.1", "Claude Code". */
export function modelLabel(sel: ModelSelection | null, clis: readonly CliDetection[]): string {
  if (!sel) return "No model"
  if (isCliProvider(sel.provider)) {
    const d = clis.find((c) => c.id === cliIdOf(sel.provider))
    return sel.model === "default" ? (d?.label ?? cliIdOf(sel.provider)) : sel.model
  }
  for (const list of Object.values(MODEL_CATALOG)) {
    const m = list.find((x) => x.id === sel.model)
    if (m) return m.label.replace(/^Claude /, "")
  }
  return sel.model
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** Session row time: "now", "12m", "1h", "yesterday", "Oct 1". */
export function relativeTime(t: number, now: number): string {
  const d = now - t
  if (d < 60_000) return "now"
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`
  const a = new Date(t)
  const b = new Date(now)
  const sameDay = a.toDateString() === b.toDateString()
  if (sameDay) return `${Math.floor(d / 3_600_000)}h`
  const y = new Date(now)
  y.setDate(y.getDate() - 1)
  if (a.toDateString() === y.toDateString()) return "yesterday"
  return `${MONTHS[a.getMonth()]} ${a.getDate()}`
}

/**
 * Session row meta (cV3ln D6w4a): this file "Opus 5.5 · 6 messages · $0.38" / "Opus 5.5 · 3
 * agents · $1.12"; other files "Loom — Mobile app · $0.64".
 */
export function sessionMetaLabel(
  m: SessionMeta,
  opts: { otherFile: boolean; clis: readonly CliDetection[] },
): string {
  const cost =
    m.billing === "subscription"
      ? "subscription"
      : m.billing === "local"
        ? "$0.00"
        : formatUsd(m.costUsd)
  if (opts.otherFile) return `${m.fileName.replace(/\.kimo$/, "")} · ${cost}`
  const count =
    m.agents && m.agents > 1
      ? `${m.agents} agents`
      : `${m.messageCount} ${m.messageCount === 1 ? "message" : "messages"}`
  return `${modelLabel(m.model, opts.clis)} · ${count} · ${cost}`
}
