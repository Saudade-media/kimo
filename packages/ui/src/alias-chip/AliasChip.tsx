import { Link2 } from "lucide-react"
import type { ComponentPropsWithRef } from "react"
import { cx } from "../internal/util"

/** Props for {@link AliasChip}. Native `<button>` props pass through. */
export interface AliasChipProps extends Omit<ComponentPropsWithRef<"button">, "children"> {
  /** Referenced variable ("ink-900", "ui:color/ink"). */
  name: string
}

/**
 * `{"$ref"}` binding chip; click opens the Alias Picker. Mirrors `AliasChip` (bEYCg): row,
 * gap 4, padding [2, 8, 2, 6], center, fill bg-muted, stroke 1 border, radius-pill; Icon (UCO47)
 * `link-2` 10 text-secondary · Name (HanrP) mono 11 text-primary.
 */
export function AliasChip({ name, className, type = "button", ...rest }: AliasChipProps) {
  return (
    <button
      aria-label={`Alias of ${name}`}
      {...rest}
      type={type}
      className={cx("kimo-alias-chip", className)}
    >
      <span className="kimo-alias-chip__icon" aria-hidden="true">
        <Link2 />
      </span>
      <span className="kimo-alias-chip__name">{name}</span>
    </button>
  )
}

/** Props for {@link WhenChip}. Remaining `<span>` props go to the chip. */
export interface WhenChipProps extends Omit<ComponentPropsWithRef<"span">, "children"> {
  axis: string
  value: string
}

/**
 * One `axis = value` condition of a themed entry. Mirrors `WhenChip` (FOOJI): row, gap 3,
 * padding [1, 5], center, fill bg-muted, radius-xs; Axis (A3Ic6) mono 11 text-tertiary · Eq
 * (n95i7v) "=" mono 11 text-tertiary · Value (T20Nq) mono 11 / 500 text-primary.
 */
export function WhenChip({ axis, value, className, ...rest }: WhenChipProps) {
  return (
    <span {...rest} className={cx("kimo-when-chip", className)}>
      <span className="kimo-when-chip__axis">{axis}</span>
      <span className="kimo-when-chip__eq">=</span>
      <span className="kimo-when-chip__value">{value}</span>
    </span>
  )
}
