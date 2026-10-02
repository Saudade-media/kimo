import type { ComponentPropsWithRef } from "react"
import { cx } from "../internal/util"
import { PropField } from "../prop-field/PropField"

export type StrokeSide = "t" | "r" | "b" | "l"

/** Props for {@link StrokeSideFields}. Remaining `<div>` props go to the frame. */
export interface StrokeSideFieldsProps
  extends Omit<ComponentPropsWithRef<"div">, "onChange" | "children"> {
  /** Per-side values; a string shows a keyword (`Mixed`). */
  value: Record<StrokeSide, number | string>
  onChange?: (side: StrokeSide, value: number) => void
  /** Scrub gesture bounds, so the host makes one undo step per drag. */
  onScrubStart?: () => void
  onScrubEnd?: () => void
  /** Default 0. */
  min?: number
  /** Accessible-name prefix, e.g. `"Stroke"` → "Stroke top". Default `"Stroke"`. */
  label?: string
}

const SIDES: readonly [StrokeSide, string, string][] = [
  ["t", "T", "top"],
  ["r", "R", "right"],
  ["b", "B", "bottom"],
  ["l", "L", "left"],
]

/**
 * Per-side widths. Mirrors `StrokeSideFields` (YMKcJ): fill_container, row, gap 4; four
 * `PropField` (A9DDs) instances fill_container with prefixes T, R, B, L. Also used for
 * individual padding (Auto layout section).
 */
export function StrokeSideFields({
  value,
  onChange,
  onScrubStart,
  onScrubEnd,
  min = 0,
  label = "Stroke",
  className,
  ...rest
}: StrokeSideFieldsProps) {
  return (
    <div {...rest} className={cx("kimo-stroke-side-fields", className)}>
      {SIDES.map(([side, prefix, name]) => (
        <PropField
          key={side}
          prefix={prefix}
          inputLabel={`${label} ${name}`}
          value={value[side]}
          min={min}
          onChange={(v) => onChange?.(side, v)}
          onScrubStart={onScrubStart}
          onScrubEnd={onScrubEnd}
        />
      ))}
    </div>
  )
}
