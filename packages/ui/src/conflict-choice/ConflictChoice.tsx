import type { ComponentPropsWithRef } from "react"
import { cx } from "../internal/util"

/** Props for {@link ConflictChoice}. Native `<button>` props pass through. */
export interface ConflictChoiceProps extends Omit<ComponentPropsWithRef<"button">, "children"> {
  /** The side's value as text ("#E8590C", "Plan less. Ship more together.", "Deleted"). */
  value: string
  /** Side caption ("ours", "theirs", "ours · main"). */
  side: string
  /** A color drawn in the 12 × 12 swatch; null/undefined hides the swatch. */
  swatch?: string | null
  /** `ConflictChoice/Selected`: the applied side of a resolved conflict. */
  selected?: boolean
}

/**
 * One side of a merge conflict. Mirrors `ConflictChoice` (o2cOff) / `ConflictChoice/Selected`
 * (nBjfh) on 02d: fill_container, bg-subtle, radius-sm, 1px border, gap 8, padding 8, align
 * center; Radio 14 (pill, 1.5px border-strong; selected: accent fill + accent stroke, 6px
 * on-accent dot); Swatch 12 (radius-2xs, 1px chip-edge); Value mono 11 / 1.4 text-primary
 * fill-width (wraps); Side sans 11 text-tertiary. Selected: fill bg-app, stroke text-primary.
 * Clicking applies the side (role `radio` inside the row's radiogroup).
 */
export function ConflictChoice({
  value,
  side,
  swatch,
  selected = false,
  className,
  type = "button",
  ...rest
}: ConflictChoiceProps) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: the whole ConflictChoice is the hit target; an <input type="radio"> cannot hold the swatch and two labels
    <button
      type={type}
      role="radio"
      aria-checked={selected}
      {...rest}
      className={cx(
        "kimo-conflict-choice",
        selected && "kimo-conflict-choice--selected",
        className,
      )}
    >
      <span className="kimo-conflict-choice__radio" aria-hidden="true">
        {selected && <span className="kimo-conflict-choice__dot" />}
      </span>
      {swatch != null && (
        <span
          className="kimo-conflict-choice__swatch"
          aria-hidden="true"
          style={{ background: swatch }}
        />
      )}
      <span className="kimo-conflict-choice__value">{value}</span>
      <span className="kimo-conflict-choice__side">{side}</span>
    </button>
  )
}
