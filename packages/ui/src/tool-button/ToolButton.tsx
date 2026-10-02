import type { ComponentPropsWithRef, ReactNode } from "react"
import { cx } from "../internal/util"

/** Props for {@link ToolButton}. All native `<button>` props pass through. */
export interface ToolButtonProps extends Omit<ComponentPropsWithRef<"button">, "children"> {
  /** Accessible name (the tool's name). */
  label: string
  /** 18 × 18 icon (Lucide). Colored with `currentColor`. */
  icon: ReactNode
  /** The current tool (`ToolButton/Active`); sets `aria-pressed`. */
  active?: boolean
}

/**
 * Toolbar tool. Mirrors `ToolButton` (N0cHp) / `ToolButton/Active` (l6HCd):
 * 36 × 36, radius-pill, centered 18px icon; text-secondary, active accent / on-accent.
 */
export function ToolButton({
  label,
  icon,
  active = false,
  className,
  type = "button",
  ...rest
}: ToolButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={cx("kimo-tool-button", active && "kimo-tool-button--active", className)}
      aria-label={label}
      aria-pressed={active}
    >
      <span className="kimo-tool-button__icon" aria-hidden="true">
        {icon}
      </span>
    </button>
  )
}
