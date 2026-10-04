import { Check, X } from "lucide-react"
import type { ComponentPropsWithRef } from "react"
import { cx } from "../internal/util"

/** Props for {@link OpenTypeFeatureRow}. Remaining `<div>` props go to the row. */
export interface OpenTypeFeatureRowProps extends ComponentPropsWithRef<"div"> {
  /** The 4-character OpenType tag ("ss02"). */
  tag: string
  /**
   * Board 25 §6 (d) rule v0gB4: true when the resolved font has no such feature — the row then
   * says "not in font" (tertiary, never a warning). False / undefined (in font or unknown): no
   * mark.
   */
  notInFont?: boolean
  /** The trailing × (removes the feature). */
  onRemove: () => void
}

/**
 * Board 25 §6 (d) "Feature · ss02 (custom, not in font)" (LFdEa): row, gap 8, center, fill.
 *   Check (FVAKK) `check` 14 text-primary · Tag (G7TNL) mono 11 / 500 text-primary · Support
 *   (uM7QP) "not in font" sans 11 text-tertiary · Spacer · Remove (ercGd) `x` 12 text-tertiary.
 */
export function OpenTypeFeatureRow({
  tag,
  notInFont = false,
  onRemove,
  className,
  ...rest
}: OpenTypeFeatureRowProps) {
  return (
    <div {...rest} data-tag={tag} className={cx("kimo-ot-feature-row", className)}>
      <Check className="kimo-ot-feature-row__check" aria-hidden="true" />
      <span className="kimo-ot-feature-row__tag">{tag}</span>
      {notInFont && <span className="kimo-ot-feature-row__support">not in font</span>}
      <span className="kimo-ot-feature-row__spacer" aria-hidden="true" />
      <button
        type="button"
        className="kimo-ot-feature-row__remove"
        aria-label={`Remove ${tag}`}
        onClick={onRemove}
      >
        <X aria-hidden="true" />
      </button>
    </div>
  )
}
