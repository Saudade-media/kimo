import { GitMerge } from "lucide-react"
import type { ComponentPropsWithRef } from "react"
import { cx } from "../internal/util"

/** Props for {@link ConflictMarker}. Native `<span>` props pass through. */
export type ConflictMarkerProps = Omit<ComponentPropsWithRef<"span">, "children">

/**
 * Layer-row conflict badge. Mirrors `ConflictMarker` (VXsYo) on 02d: 16 × 16, fill danger-soft,
 * radius-pill, center/center; icon lucide git-merge 10 × 10, danger.
 */
export function ConflictMarker({ className, ...rest }: ConflictMarkerProps) {
  return (
    <span
      role="img"
      aria-label="Merge conflict"
      {...rest}
      className={cx("kimo-conflict-marker", className)}
    >
      <GitMerge aria-hidden="true" />
    </span>
  )
}
