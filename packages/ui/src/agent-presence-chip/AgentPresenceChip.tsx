import { ChevronDown } from "lucide-react"
import type { ComponentPropsWithRef } from "react"
import { AgentOrb } from "../agent-orb/AgentOrb"
import { cx } from "../internal/util"

/** Chip state (board 21 rule "Chip states"). */
export type AgentPresenceState = "editing" | "paused" | "waiting"

/** Props for {@link AgentPresenceChip}. Remaining `<button>` props go to the chip. */
export interface AgentPresenceChipProps extends Omit<ComponentPropsWithRef<"button">, "children"> {
  state?: AgentPresenceState
  /** "Claude Code is editing", "Claude Code · edits paused", "Codex needs approval". */
  label: string
  /** "3 ops", "read-only", "1". Omitted: no Sep / Meta. */
  meta?: string
  /** 2+ clients collapse to stacked orbs (rule "Presence chip"). Default 1. */
  orbs?: number
  /** The session popover is open (aria-expanded). */
  open?: boolean
}

/**
 * Agent presence in the topbar drag region. Mirrors `AgentPresenceChip` (I3Q0Q): row, gap 6,
 * padding [0, 10, 0, 4], center, h 28, radius-pill, fill agent-soft: Orb (sZqHj) 20 · Label
 * (u7zeoB) sans 12 / 500 agent · Sep (S02ieE) 3 × 3 · Meta (sCc98) mono 11 · Chevron (OSvd0)
 * chevron-down 12. `/Paused` (fFrQA): warning-soft / warning. `/Waiting` (MFqUw): fill agent,
 * content on-accent, orb ring 1.5 on-accent; pulses once when it appears.
 */
export function AgentPresenceChip({
  state = "editing",
  label,
  meta,
  orbs = 1,
  open,
  className,
  type = "button",
  ...rest
}: AgentPresenceChipProps) {
  const count = Math.max(1, Math.min(3, orbs))
  return (
    <button
      {...rest}
      type={type}
      aria-haspopup="dialog"
      aria-expanded={open}
      data-state={state}
      className={cx("kimo-agent-chip", `kimo-agent-chip--${state}`, className)}
    >
      <span className="kimo-agent-chip__orbs">
        {Array.from({ length: count }, (_, i) => (
          <AgentOrb
            // biome-ignore lint/suspicious/noArrayIndexKey: identical decorative orbs.
            key={i}
            className="kimo-agent-chip__orb"
            ring={state === "waiting" || count > 1 ? 1.5 : 0}
          />
        ))}
      </span>
      <span className="kimo-agent-chip__label">{label}</span>
      {meta != null && (
        <>
          <span className="kimo-agent-chip__sep" aria-hidden="true" />
          <span className="kimo-agent-chip__meta">{meta}</span>
        </>
      )}
      <ChevronDown className="kimo-agent-chip__chevron" aria-hidden="true" />
    </button>
  )
}
