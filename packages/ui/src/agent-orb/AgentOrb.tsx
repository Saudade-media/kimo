import type { ComponentPropsWithRef } from "react"
import { cx } from "../internal/util"

/** Props for {@link AgentOrb}. Remaining `<span>` props go to the orb. */
export interface AgentOrbProps extends Omit<ComponentPropsWithRef<"span">, "children"> {
  /** Diameter in px. Board 21 instances: 12 (canvas tag), 14 (cursor pill), 16 (activity group),
   * 20 (component, presence chip), 28 (client row, session popover), 32 (approval prompt). */
  size?: number
  /** White ring (instances on a solid agent fill): 1 (tag, cursor) or 1.5 (chip /Waiting). */
  ring?: 0 | 1 | 1.5
}

/**
 * An agent's identity mark. Mirrors `AgentOrb` (dT6Po): ellipse 20 × 20, linear gradient
 * rotation 225 agent → agent-2 (agent at the top-left). Instances resize it and add an
 * on-accent stroke where it sits on a solid agent fill.
 */
export function AgentOrb({ size = 20, ring = 0, className, style, ...rest }: AgentOrbProps) {
  return (
    <span
      aria-hidden="true"
      {...rest}
      data-ring={ring || undefined}
      className={cx("kimo-agent-orb", className)}
      style={{
        width: size,
        height: size,
        ...(ring ? { "--kimo-orb-ring": `${ring}px` } : {}),
        ...style,
      }}
    />
  )
}
