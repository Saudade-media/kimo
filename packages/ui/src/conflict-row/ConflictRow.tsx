import { CircleAlert, CircleCheck } from "lucide-react"
import type { ComponentPropsWithRef } from "react"
import { ConflictChoice } from "../conflict-choice/ConflictChoice"
import { cx } from "../internal/util"

/** One side shown by a {@link ConflictRow}. */
export interface ConflictRowSide {
  value: string
  caption: string
  swatch?: string | null
}

/** Props for {@link ConflictRow}. Remaining `<div>` props go to the row. */
export interface ConflictRowProps
  extends Omit<ComponentPropsWithRef<"div">, "children" | "onChange"> {
  /** Property label (mono): "fill", "content", "gap", "node", "parent", "$brand · light". */
  property: string
  /** Right-hand hint: "both changed", "deleted vs edited", "moved twice"; resolved: "kept ours". */
  hint: string
  ours: ConflictRowSide
  theirs: ConflictRowSide
  /** `ConflictRow/Resolved`: success check, and the applied side drawn selected. */
  resolved?: boolean
  /** The side the body holds when resolved ("ours" / "theirs"); anything else selects none. */
  applied?: string | null
  /** Picks a side (one undo step in the editor). */
  onChoose?: (side: "ours" | "theirs") => void
}

/**
 * A stored merge conflict. Mirrors `ConflictRow` (uP9RN) / `ConflictRow/Resolved` (d9zpM) on
 * 02d: fill_container, bottom border 1, vertical, gap 6, padding [10, 12]; Head (gap 6, center):
 * Status 14 (lucide circle-alert danger; resolved circle-check success), Property mono 11 / 500
 * text-primary, spacer, Hint sans 11 text-tertiary; then the Ours and Theirs ConflictChoices.
 */
export function ConflictRow({
  property,
  hint,
  ours,
  theirs,
  resolved = false,
  applied = null,
  onChoose,
  className,
  ...rest
}: ConflictRowProps) {
  return (
    <div
      {...rest}
      className={cx("kimo-conflict-row", resolved && "kimo-conflict-row--resolved", className)}
    >
      <div className="kimo-conflict-row__head">
        <span className="kimo-conflict-row__status" aria-hidden="true">
          {resolved ? <CircleCheck /> : <CircleAlert />}
        </span>
        <span className="kimo-conflict-row__property">{property}</span>
        <span className="kimo-conflict-row__spacer" aria-hidden="true" />
        <span className="kimo-conflict-row__hint">{hint}</span>
      </div>
      <div className="kimo-conflict-row__choices" role="radiogroup" aria-label={property}>
        <ConflictChoice
          value={ours.value}
          side={ours.caption}
          swatch={ours.swatch ?? null}
          selected={resolved && applied === "ours"}
          onClick={() => onChoose?.("ours")}
          data-side="ours"
        />
        <ConflictChoice
          value={theirs.value}
          side={theirs.caption}
          swatch={theirs.swatch ?? null}
          selected={resolved && applied === "theirs"}
          onClick={() => onChoose?.("theirs")}
          data-side="theirs"
        />
      </div>
    </div>
  )
}
