import { Undo2 } from "lucide-react"
import type { ComponentPropsWithRef } from "react"
import { cx } from "../internal/util"

/** Props for {@link AgentOpRow}. Remaining `<div>` props go to the row. */
export interface AgentOpRowProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
  /** kimo_apply_ops op kind: "update", "insert", "move", "delete", "set_variables"… */
  op: string
  /** Node name ("Card 2"). */
  target: string
  /** "fill #F4F1EC → #E9DFCF", "frame · 6 children". */
  detail: string
  /** Destructive ops (delete): danger-soft / danger op chip. Default: agent. */
  tone?: "agent" | "danger"
  /** Reverts this op's group. Omitted: no Revert icon (approval prompt Targets hide it). */
  onRevert?: () => void
  /** Accessible name of the Revert button. */
  revertLabel?: string
}

/**
 * One op of an agent group. Mirrors `AgentOpRow` (m9RhF): row, gap 8, padding [5, 12], center,
 * fill_container. Op (GWVaR) 52 × 18 agent-soft radius-xs centered, Op Name (DuXnB) mono 11 /
 * 500 agent · Target (y7h2K) mono 11 text-primary · Detail (Rkonz) mono 11 text-secondary fill
 * (fixed width, truncates) · Revert (k16ep0) undo-2 14 text-tertiary.
 */
export function AgentOpRow({
  op,
  target,
  detail,
  tone = "agent",
  onRevert,
  revertLabel = "Revert",
  className,
  ...rest
}: AgentOpRowProps) {
  return (
    <div
      {...rest}
      data-op={op}
      className={cx(
        "kimo-agent-op-row",
        tone === "danger" && "kimo-agent-op-row--danger",
        className,
      )}
    >
      <span className="kimo-agent-op-row__op">
        <span className="kimo-agent-op-row__op-name">{op}</span>
      </span>
      <span className="kimo-agent-op-row__target">{target}</span>
      <span className="kimo-agent-op-row__detail" title={detail}>
        {detail}
      </span>
      {onRevert && (
        <button
          type="button"
          className="kimo-agent-op-row__revert"
          aria-label={revertLabel}
          onClick={onRevert}
        >
          <Undo2 aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
