import { Grid3x3 } from "lucide-react"
import type { ComponentPropsWithRef } from "react"
import { cx } from "../internal/util"

/** Props for {@link ZoomBadge}. Remaining `<div>` props go to the chip. */
export interface ZoomBadgeProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
  /** Scale factor: 8 → "800%". */
  zoom: number
}

/** `"800%"` for 8 (whole percent). */
export const zoomLabel = (zoom: number): string => `${Math.round(zoom * 100)}%`

/**
 * Pixel-grid zoom chip. Mirrors `SizeBadge/Zoom` (L5GCtM): bg-app, radius-pill, stroke 1 border,
 * shadow 0 2 8 shadow, row, gap 6, padding [4, 10], center: lucide `grid-3x3` 12 text-secondary
 * · label mono 11 / 500 text-primary. The host shows it at the canvas's top-left (16, 16) while
 * the pixel grid is visible.
 */
export function ZoomBadge({ zoom, className, ...rest }: ZoomBadgeProps) {
  return (
    <div {...rest} className={cx("kimo-zoom-badge", className)}>
      <span className="kimo-zoom-badge__icon" aria-hidden="true">
        <Grid3x3 />
      </span>
      <span className="kimo-zoom-badge__label">{zoomLabel(zoom)}</span>
    </div>
  )
}
