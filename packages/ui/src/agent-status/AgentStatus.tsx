import { LocateFixed } from "lucide-react"
import type { ComponentPropsWithRef } from "react"
import { AgentMark } from "../agent-mark/AgentMark"
import type { AgentMarkState } from "../agent-mark/faces"
import type { Persona } from "../agent-mark/persona"
import { cx } from "../internal/util"

/** Props for {@link AgentStatus}. Remaining `<div>` props go to the row. */
export interface AgentStatusProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
  /** What the agent is doing now ("Building the pricing section"). One line, ellipsized. */
  status: string
  /** Elapsed time since the turn started ("0:42"). */
  elapsed: string
  /** "5 steps". Omitted: the separator and steps text are not shown. */
  steps?: string
  /** Mark state: `working` (default), `thinking` before the first step, `waiting`, `paused`. */
  markState?: AgentMarkState
  persona?: Persona
  /** Follow chip: jump the viewport to where the agent works. Omitted: no chip. */
  onFollow?: () => void
}

/**
 * The live status line of a running agent turn (board 31 "Agent progress", component
 * `AgentStatus` qi4M9): row fill, gap 10, center ›
 *   Mark AgentMark/24 (Working) ·
 *   Body (fill, column, gap 2) › Status sans 13 / 500 text-primary · Meta (row, gap 6, center) ›
 *     Elapsed mono 11 text-tertiary · Sep 3 × 3 ellipse text-tertiary · Steps sans 11 text-tertiary ·
 *   Follow h 22, padding [0, 8, 0, 6], gap 4, pill, agent-soft › locate-fixed 12 agent ·
 *     Label "Follow" sans 11 / 500 agent.
 */
export function AgentStatus({
  status,
  elapsed,
  steps,
  markState = "working",
  persona = "teal",
  onFollow,
  className,
  ...rest
}: AgentStatusProps) {
  return (
    <div {...rest} className={cx("kimo-agent-status", className)} aria-live="polite">
      <AgentMark
        size={24}
        state={markState}
        persona={persona}
        className="kimo-agent-status__mark"
      />
      <div className="kimo-agent-status__body">
        <span className="kimo-agent-status__text" title={status}>
          {status}
        </span>
        <span className="kimo-agent-status__meta">
          <span className="kimo-agent-status__elapsed">{elapsed}</span>
          {steps != null && (
            <>
              <span className="kimo-agent-status__sep" aria-hidden="true" />
              <span className="kimo-agent-status__steps">{steps}</span>
            </>
          )}
        </span>
      </div>
      {onFollow && (
        <button type="button" className="kimo-agent-status__follow" onClick={onFollow}>
          <LocateFixed className="kimo-agent-status__follow-icon" aria-hidden="true" />
          <span className="kimo-agent-status__follow-label">Follow</span>
        </button>
      )}
    </div>
  )
}
