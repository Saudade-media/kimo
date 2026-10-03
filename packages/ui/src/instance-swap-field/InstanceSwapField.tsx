import { ChevronDown, Diamond } from "lucide-react"
import type { ComponentPropsWithRef, ReactNode } from "react"
import { cx } from "../internal/util"

/** Props for {@link InstanceSwapField}. Native `<button>` props pass through. */
export interface InstanceSwapFieldProps extends Omit<ComponentPropsWithRef<"button">, "children"> {
  /** Current component name ("Icon/Arrow"). */
  value: string
  /** 12 × 12 preview: the component's thumbnail (`<img>`) or glyph. */
  preview?: ReactNode
}

/**
 * Instance-swap trigger (opens the Swap Popover). Mirrors `InstanceSwapField` (VjO7v):
 * fill_container × 28, bg-subtle, radius-sm, row, gap 6, padding [0, 8, 0, 4], center.
 * Preview (G23zFQ) 20 × 20, bg-app, stroke 1 border, radius-xs, center → Preview Icon (nGWUc)
 * 12 text-primary · Value (QKKLp) sans 12 text-primary · Spacer · Glyph (y5oFE6) `diamond` 12
 * component · Chevron (H6W9cl) `chevron-down` 14 text-tertiary.
 */
export function InstanceSwapField({
  value,
  preview,
  className,
  type = "button",
  ...rest
}: InstanceSwapFieldProps) {
  return (
    <button
      aria-haspopup="dialog"
      aria-label={`Swap instance: ${value}`}
      {...rest}
      type={type}
      className={cx("kimo-instance-swap-field", className)}
    >
      <span className="kimo-instance-swap-field__preview" aria-hidden="true">
        <span className="kimo-instance-swap-field__preview-icon">{preview}</span>
      </span>
      <span className="kimo-instance-swap-field__value">{value}</span>
      <span className="kimo-instance-swap-field__spacer" aria-hidden="true" />
      <span className="kimo-instance-swap-field__glyph" aria-hidden="true">
        <Diamond />
      </span>
      <span className="kimo-instance-swap-field__chevron" aria-hidden="true">
        <ChevronDown />
      </span>
    </button>
  )
}
