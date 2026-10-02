import type { ComponentPropsWithRef, MouseEventHandler } from "react"
import { cx } from "../internal/util"

/** Props for {@link ColorField}. Remaining `<div>` props go to the frame. */
export interface ColorFieldProps extends Omit<ComponentPropsWithRef<"div">, "children" | "color"> {
  /** Swatch color: any CSS color (document data, not a UI token). */
  color: string
  /** Value text: a variable name (`accent`) or a hex (`#0A0A0A`). */
  value: string
  /** Opacity text (`100%`). Omit to hide. */
  opacity?: string
  /** Swatch click (the host opens its color picker). */
  onSwatchClick?: MouseEventHandler<HTMLButtonElement>
  /** Accessible name of the swatch button. Default `"Edit color"`. */
  swatchLabel?: string
}

/**
 * Color property field. Mirrors `ColorField` (GOaBx): fill_container × 28, bg-subtle, radius-sm,
 * padding [0, 6], gap 8; swatch 16 × 16 radius 4 with a 1px border stroke; value mono 12
 * text-primary; spacer; opacity sans 12 text-tertiary.
 */
export function ColorField({
  color,
  value,
  opacity,
  onSwatchClick,
  swatchLabel = "Edit color",
  className,
  ...rest
}: ColorFieldProps) {
  return (
    <div {...rest} className={cx("kimo-color-field", className)}>
      <button
        type="button"
        className="kimo-color-field__swatch"
        style={{ backgroundColor: color }}
        aria-label={swatchLabel}
        onClick={onSwatchClick}
      />
      <span className="kimo-color-field__value">{value}</span>
      <span className="kimo-color-field__spacer" aria-hidden="true" />
      {opacity != null && <span className="kimo-color-field__opacity">{opacity}</span>}
    </div>
  )
}
