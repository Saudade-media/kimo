import { ChevronDown, ChevronRight } from "lucide-react"
import type { ComponentPropsWithRef } from "react"
import { cx } from "../internal/util"

/** Props for {@link StepsToggle}. Remaining `<button>` props go to the toggle. */
export interface StepsToggleProps extends Omit<ComponentPropsWithRef<"button">, "children"> {
  /** Number of steps ("6 steps"). */
  count: number
  /** Failed steps ("· 1 failed" in danger). 0: not shown. */
  failed?: number
  open: boolean
}

/**
 * The "N steps" toggle under a finished agent reply (board 31, StepsToggle RWTLi /
 * StepsToggle/Open ZBNJa): row, gap 4, padding [0, 0, 0, 34], center › Chevron 12 (chevron-right
 * text-tertiary; open: chevron-down text-secondary) · Label sans 11 / 500 (text-tertiary; open:
 * text-secondary) · Failed "· N failed" sans 11 / 500 danger.
 */
export function StepsToggle({ count, failed = 0, open, className, ...rest }: StepsToggleProps) {
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <button
      type="button"
      aria-expanded={open}
      {...rest}
      className={cx("kimo-steps-toggle", open && "kimo-steps-toggle--open", className)}
    >
      <Chevron className="kimo-steps-toggle__chevron" aria-hidden="true" />
      <span className="kimo-steps-toggle__label">
        {count} step{count === 1 ? "" : "s"}
      </span>
      {failed > 0 && <span className="kimo-steps-toggle__failed">· {failed} failed</span>}
    </button>
  )
}
