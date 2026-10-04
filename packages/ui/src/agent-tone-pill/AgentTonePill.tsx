import type { ComponentPropsWithRef } from "react"
import { cx } from "../internal/util"

/** Tone of an {@link AgentTonePill} (Settings › Agents & MCP rules "Server status", "Host rows"). */
export type AgentPillTone = "success" | "warning" | "neutral" | "danger"

/** Props for {@link AgentTonePill}. Remaining `<span>` props go to the pill. */
export interface AgentTonePillProps extends Omit<ComponentPropsWithRef<"span">, "children"> {
  tone: AgentPillTone
  label: string
}

/**
 * The `StatusPill` (SVobH) instances of board 21 with free labels: row, gap 5, padding
 * [2, 8, 2, 6], center, radius-pill; Dot 6 × 6 · Label sans 11 / 500. success: success-soft /
 * success ("Installed", "Running · 2 clients") · warning: warning-soft / warning ("Outdated ·
 * kimo-mcp 0.4") · neutral: bg-muted, dot text-tertiary, label text-secondary ("Not installed",
 * "Not found", "Stopped") · danger: `/Missing` (jwQVJ) danger-soft / danger ("Error · HTTP down").
 */
export function AgentTonePill({ tone, label, className, ...rest }: AgentTonePillProps) {
  return (
    <span
      {...rest}
      data-tone={tone}
      className={cx("kimo-agent-pill", `kimo-agent-pill--${tone}`, className)}
    >
      <span className="kimo-agent-pill__dot" aria-hidden="true" />
      <span className="kimo-agent-pill__label">{label}</span>
    </span>
  )
}
