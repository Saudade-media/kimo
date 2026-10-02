import type { ComponentPropsWithoutRef, ComponentPropsWithRef, ReactNode } from "react"
import { cx } from "../internal/util"

/** Props for {@link Input}. Native `<input>` props go to the inner field. */
export interface InputProps extends Omit<ComponentPropsWithRef<"input">, "size"> {
  /** Leading 16 × 16 icon (the design uses lucide `search`). */
  icon?: ReactNode
  /** Props of the outer frame (`<label>`): class, style, data attributes. */
  frameProps?: Omit<ComponentPropsWithoutRef<"label">, "children">
  /**
   * M2 popover search (board 09 `tub8E` / `SrSfb` / `jOl4f`): h 28, radius-sm, icon 14, text
   * sans 12.
   */
  dense?: boolean
}

/**
 * Text input. Mirrors `Input` (Zs05d): fill_container × 32, bg-muted, inside 1px border,
 * radius-md, padding [0, 10], gap 8; icon 16 text-tertiary; text 13 (placeholder text-tertiary).
 * Without an `aria-label`/`aria-labelledby`, pass `placeholder` and a label for accessibility.
 */
export function Input({ icon, frameProps, dense = false, className, ...rest }: InputProps) {
  return (
    <label
      {...frameProps}
      className={cx("kimo-input", dense && "kimo-input--dense", frameProps?.className)}
    >
      {icon != null && (
        <span className="kimo-input__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <input {...rest} className={cx("kimo-input__field", className)} />
    </label>
  )
}
