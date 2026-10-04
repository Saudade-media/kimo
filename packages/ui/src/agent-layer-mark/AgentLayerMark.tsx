import type { ComponentPropsWithRef } from "react"
import { cx } from "../internal/util"

/** Class that turns any LayerRow variant into `LayerRow/Agent` (PwDCI). */
export const AGENT_LAYER_ROW_CLASS = "kimo-layer-row--agent"

/**
 * The standalone "Agent Mark" (OEkBe) of `LayerRow/Agent` (PwDCI): fill_container, padding
 * [0, 0, 0, 2], center; Agent Dot 6 × 6 agent. Rows built from `LayerRow` should use
 * {@link AGENT_LAYER_ROW_CLASS} instead (it turns their Spacer into this mark).
 */
export function AgentLayerMark({ className, ...rest }: ComponentPropsWithRef<"span">) {
  return (
    <span
      {...rest}
      role="img"
      aria-label="Changed by an agent"
      className={cx("kimo-agent-layer-mark", className)}
    >
      <span className="kimo-agent-layer-mark__dot" />
    </span>
  )
}
