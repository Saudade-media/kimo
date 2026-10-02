import type { ComponentPropsWithRef, ReactNode } from "react"
import { cx } from "../internal/util"

/** Props for {@link TooltipHint}. Remaining `<div>` props go to the pill. */
export interface TooltipHintProps extends ComponentPropsWithRef<"div"> {
  /** 12 × 12 icon: lucide `pen-tool` / `circle-dot` / `spline`. */
  icon: ReactNode
  /** Exact design copy, e.g. "Click to add points · Drag to curve · Enter to finish". */
  children: ReactNode
}

/**
 * Canvas hint pill. Mirrors `Tooltip/Hint` (u0dQ1): text-primary fill, radius-pill, shadow
 * 0 4 12 shadow, row, gap 8, padding [6, 12, 6, 10], center; icon 12 text-inverse; label sans
 * 12 / 500 text-inverse. `role="status"` so the hint is announced. The host positions it
 * (board 10: 12px above the floating toolbar; next to the cursor; top of the canvas).
 */
export function TooltipHint({ icon, children, className, ...rest }: TooltipHintProps) {
  return (
    <div {...rest} role="status" className={cx("kimo-tooltip-hint", className)}>
      <span className="kimo-tooltip-hint__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="kimo-tooltip-hint__label">{children}</span>
    </div>
  )
}
