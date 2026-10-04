import { ChevronDown, Hand } from "lucide-react"
import type { ComponentPropsWithRef } from "react"
import { AgentMark } from "../agent-mark/AgentMark"
import type { AgentMarkState } from "../agent-mark/faces"
import type { Persona } from "../agent-mark/persona"
import { cx } from "../internal/util"

/** Chip state (board 21 rule "Chip states"). */
export type AgentPresenceState = "editing" | "paused" | "waiting"

/** Props for {@link AgentPresenceChip}. Remaining `<button>` props go to the chip. */
export interface AgentPresenceChipProps extends Omit<ComponentPropsWithRef<"button">, "children"> {
  state?: AgentPresenceState
  /** "Claude Code is editing", "Claude Code · edits paused", "Codex is waiting". */
  label: string
  /** "3 ops", "read-only", "+2" (2+ agents: the lead + "+N", board 24 yeF1Z). Omitted: no Sep / Meta. */
  meta?: string
  /**
   * Approval queue (board 24 vignette e, I7jut): a neutral count badge (hand + N, ">9" → "9+")
   * replaces Sep / Meta. Never $warning: waiting is not a problem.
   */
  queue?: number
  /** Mark state; default follows `state` (editing → Working, waiting → Listening, paused → Idle frozen). */
  markState?: AgentMarkState
  persona?: Persona
  /** The session popover is open (aria-expanded). */
  open?: boolean
}

export function presenceMarkState(state: AgentPresenceState): AgentMarkState {
  return state === "waiting" ? "listening" : state === "paused" ? "paused" : "working"
}

/**
 * Agent presence in the topbar drag region. Mirrors `AgentPresenceChip` (I3Q0Q) as replaced on
 * board 24 (BXTD5 Ma9Si / W42AfV): row, gap 6, padding [0, 10, 0, 4], center, h 28, radius-pill,
 * fill agent-soft › AgentMark 24 (whSu1 Working / i6eT4U Listening) · Label sans 12 / 500 agent ·
 * Sep 3 × 3 · Meta mono 11 · Chevron chevron-down 12 agent. Queue badge (kMZD0): h 18, gap 4,
 * padding [0, 7], fill text-primary, radius-pill › hand 11 + Count sans 11 / 600 text-inverse.
 * `/Paused` (fFrQA): warning-soft / warning, the mark idle and frozen.
 */
export function AgentPresenceChip({
  state = "editing",
  label,
  meta,
  queue,
  markState,
  persona = "teal",
  open,
  className,
  type = "button",
  ...rest
}: AgentPresenceChipProps) {
  const badge = queue != null && queue > 0 ? (queue > 9 ? "9+" : String(queue)) : null
  return (
    <button
      {...rest}
      type={type}
      aria-haspopup="dialog"
      aria-expanded={open}
      data-state={state}
      className={cx("kimo-agent-chip", `kimo-agent-chip--${state}`, className)}
    >
      <AgentMark
        size={24}
        state={markState ?? presenceMarkState(state)}
        persona={persona}
        className="kimo-agent-chip__mark"
      />
      <span className="kimo-agent-chip__label">{label}</span>
      {badge != null ? (
        <span
          className="kimo-agent-chip__queue"
          role="img"
          aria-label={`${badge} waiting for approval`}
        >
          <Hand className="kimo-agent-chip__queue-icon" aria-hidden="true" />
          <span className="kimo-agent-chip__queue-count">{badge}</span>
        </span>
      ) : (
        meta != null && (
          <>
            <span className="kimo-agent-chip__sep" aria-hidden="true" />
            <span className="kimo-agent-chip__meta">{meta}</span>
          </>
        )
      )}
      <ChevronDown className="kimo-agent-chip__chevron" aria-hidden="true" />
    </button>
  )
}
