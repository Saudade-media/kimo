import type { ComponentPropsWithRef } from "react"
import { cx } from "../internal/util"

/** Props for {@link Toggle}. Native `<button>` props pass through. */
export interface ToggleProps
  extends Omit<ComponentPropsWithRef<"button">, "onChange" | "children" | "value"> {
  checked: boolean
  onChange?: (checked: boolean) => void
  /** Accessible name (or use `aria-labelledby`). */
  label?: string
}

/**
 * Switch. Mirrors `Toggle/On` (y893S) / `Toggle/Off` (CSYQj): 28 × 16, radius-pill, padding 2,
 * alignItems center; on: accent, knob at the end; off: border-strong, knob at the start;
 * knob ellipse 12 × 12 #FFFFFF.
 */
export function Toggle({
  checked,
  onChange,
  label,
  className,
  onClick,
  type = "button",
  ...rest
}: ToggleProps) {
  return (
    <button
      {...rest}
      type={type}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={cx("kimo-toggle", checked ? "kimo-toggle--on" : "kimo-toggle--off", className)}
      onClick={(e) => {
        onClick?.(e)
        if (!e.defaultPrevented) onChange?.(!checked)
      }}
    >
      <span className="kimo-toggle__knob" aria-hidden="true" />
    </button>
  )
}
