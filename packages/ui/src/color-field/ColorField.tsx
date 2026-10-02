import type {
  ComponentPropsWithoutRef,
  ComponentPropsWithRef,
  CSSProperties,
  MouseEventHandler,
} from "react"
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
  /**
   * CSS `background` of the swatch, overriding `color` (M2 FillRow: a gradient or `url()` for
   * image fills, `vBwVv` / `a16BW6`).
   */
  swatchBackground?: string
  /** Value font: `"mono"` (default, hex) or `"sans"` (M2 kind labels / variable names). */
  valueFont?: "mono" | "sans"
  /**
   * M2 states: `"active"` = its popover is open (`H3Grs`: bg-hover, stroke 1 border-strong);
   * `"selected"` = the selected gradient stop (`KaNVU`: bg-hover, stroke 1 selection).
   */
  highlight?: "active" | "selected"
  /** Extra props of the swatch button (e.g. `aria-haspopup` / `aria-expanded`). */
  swatchProps?: Omit<ComponentPropsWithoutRef<"button">, "style" | "onClick" | "className">
}

/** Gradients and `url()` go to `background-image` so the stylesheet's `cover` sizing applies. */
export function swatchStyle(color: string, background?: string): CSSProperties {
  if (background == null) return { backgroundColor: color }
  return /gradient\(|url\(/.test(background)
    ? { backgroundImage: background }
    : { backgroundColor: background }
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
  swatchBackground,
  valueFont = "mono",
  highlight,
  swatchProps,
  className,
  ...rest
}: ColorFieldProps) {
  return (
    <div
      {...rest}
      className={cx("kimo-color-field", highlight && `kimo-color-field--${highlight}`, className)}
    >
      <button
        {...swatchProps}
        type="button"
        className="kimo-color-field__swatch"
        style={swatchStyle(color, swatchBackground)}
        aria-label={swatchLabel}
        onClick={onSwatchClick}
      />
      <span
        className={cx(
          "kimo-color-field__value",
          valueFont === "sans" && "kimo-color-field__value--sans",
        )}
      >
        {value}
      </span>
      <span className="kimo-color-field__spacer" aria-hidden="true" />
      {opacity != null && <span className="kimo-color-field__opacity">{opacity}</span>}
    </div>
  )
}
