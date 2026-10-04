import type { ComponentPropsWithRef } from "react"
import { cx } from "../internal/util"
import { SegmentedText } from "../segmented-text/SegmentedText"

/** What the review step does with a changed file. */
export type ReviewChoice = "keep" | "overwrite"

/** Props for {@link ReviewFileRow}. Remaining `<div>` props go to the row. */
export interface ReviewFileRowProps
  extends Omit<ComponentPropsWithRef<"div">, "children" | "onSelect"> {
  name: string
  /** `changed`: exists and differs (Keep | Overwrite) · `new`: not on disk yet (New badge). */
  kind: "changed" | "new"
  added?: number
  removed?: number
  /** Changed files: the current choice. */
  choice?: ReviewChoice
  onChoice?: (choice: ReviewChoice) => void
  /** The row whose diff is shown (fill bg-muted). */
  selected?: boolean
  onSelect?: () => void
}

const CHOICES = [
  { value: "keep", label: "Keep" },
  { value: "overwrite", label: "Overwrite" },
] as const

/**
 * A file of the review step. Mirrors `File · Hero.tsx` (L888zt, selected) / `File ·
 * Button.tsx` (PC6fC) / `File · tokens.css` (wReGw): row fill, gap 8, padding [8, 8, 8, 10],
 * center, radius-md; selected fill bg-muted › Text (column fill, gap 2): Name mono 11 / 500
 * text-primary · Meta (row gap 6, center): +N mono 11 success · −N mono 11 danger · Kind sans 11
 * text-tertiary › Keep | Overwrite (SegmentedText, segments h 22, labels 11) or the New badge
 * (padding [2, 8], success-soft, radius-pill, sans 11 / 500 success).
 */
export function ReviewFileRow({
  name,
  kind,
  added = 0,
  removed = 0,
  choice = "keep",
  onChoice,
  selected = false,
  onSelect,
  className,
  ...rest
}: ReviewFileRowProps) {
  return (
    <div
      {...rest}
      data-file={name}
      data-kind={kind}
      data-selected={selected || undefined}
      className={cx("kimo-review-row", selected && "kimo-review-row--selected", className)}
    >
      <button
        type="button"
        className="kimo-review-row__text"
        aria-pressed={selected}
        onClick={onSelect}
      >
        <span className="kimo-review-row__name">{name}</span>
        <span className="kimo-review-row__meta">
          {kind === "changed" ? (
            <>
              <span className="kimo-review-row__added">{`+${added}`}</span>
              <span className="kimo-review-row__removed">{`−${removed}`}</span>
              <span className="kimo-review-row__kind">changed on disk</span>
            </>
          ) : (
            <span className="kimo-review-row__kind">new file</span>
          )}
        </span>
      </button>
      {kind === "changed" ? (
        <SegmentedText
          className="kimo-review-row__choice"
          label={`${name}: keep or overwrite`}
          options={CHOICES}
          value={choice}
          onChange={(v) => onChoice?.(v)}
        />
      ) : (
        <span className="kimo-review-row__new">New</span>
      )}
    </div>
  )
}
