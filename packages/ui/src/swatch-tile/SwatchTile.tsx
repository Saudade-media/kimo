import type { ComponentPropsWithRef } from "react"
import { cx } from "../internal/util"

/** Props for {@link SwatchTile}. Native `<button>` props pass through. */
export interface SwatchTileProps extends Omit<ComponentPropsWithRef<"button">, "color"> {
  /** Any CSS color (document data). */
  color: string
  /** `SwatchTile/Selected` (Jr3U1): 1.5px accent ring. */
  selected?: boolean
  /** 20 (default, padding 2) or 18 (padding 1, the Variables list `Hvp8a`). */
  size?: 20 | 18
  "aria-label": string
}

/**
 * Color chip. Mirrors `SwatchTile` (rg74x) / `SwatchTile/Selected` (Jr3U1): 20 × 20, radius-sm,
 * stroke 1.5 transparent (selected: accent), padding 2 → Color (A4ord9) fill_container,
 * radius-xs, stroke 1 chip-edge. Sets `aria-pressed` when `selected` is defined.
 */
export function SwatchTile({
  color,
  selected,
  size = 20,
  className,
  type = "button",
  ...rest
}: SwatchTileProps) {
  return (
    <button
      {...rest}
      type={type}
      aria-pressed={selected}
      className={cx(
        "kimo-swatch-tile",
        size === 18 && "kimo-swatch-tile--18",
        selected && "kimo-swatch-tile--selected",
        className,
      )}
    >
      <span className="kimo-swatch-tile__color" style={{ backgroundColor: color }} />
    </button>
  )
}
