import { Check, Component } from "lucide-react"
import type { ComponentPropsWithRef, ReactNode } from "react"
import { cx } from "../internal/util"

/** Props for {@link AssetRow}. Remaining `<div>` props go to the row. */
export interface AssetRowProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
  name: string
  /** Mono meta at the end (usage "12×", "—"). Replaced by the check when selected. */
  meta?: string
  /** `AssetRow/Selected` (Nugw3): bg-hover, name 500, `check` 14 instead of the meta. */
  selected?: boolean
  /** Library rows nested under a library header (board 13 `d8gVP`): padding [0, 8, 0, 26]. */
  indent?: boolean
  /** 14px glyph; default lucide `component` in component. */
  glyph?: ReactNode
}

/**
 * Component list row (Assets list view, Swap popover). Mirrors `AssetRow` (h6gLx) /
 * `AssetRow/Selected` (Nugw3): fill_container × 28, radius-sm, row, gap 8, padding [0, 8],
 * center; Glyph (UlF9Z) `component` 14 component · Name (jEh39) sans 12 text-primary · Spacer ·
 * Meta (N4UyW) mono 11 text-tertiary | Check (i5kIH) `check` 14 text-primary. Hover bg-hover.
 */
export function AssetRow({
  name,
  meta,
  selected = false,
  indent = false,
  glyph,
  className,
  ...rest
}: AssetRowProps) {
  return (
    <div
      {...rest}
      className={cx(
        "kimo-asset-row",
        selected && "kimo-asset-row--selected",
        indent && "kimo-asset-row--indent",
        className,
      )}
    >
      <span className="kimo-asset-row__glyph" aria-hidden="true">
        {glyph ?? <Component />}
      </span>
      <span className="kimo-asset-row__name">{name}</span>
      <span className="kimo-asset-row__spacer" aria-hidden="true" />
      {selected ? (
        <span className="kimo-asset-row__check" aria-hidden="true">
          <Check />
        </span>
      ) : (
        meta !== undefined && <span className="kimo-asset-row__meta">{meta}</span>
      )}
    </div>
  )
}
