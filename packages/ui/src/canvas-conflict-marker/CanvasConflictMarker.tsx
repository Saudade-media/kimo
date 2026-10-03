import { GitMerge } from "lucide-react"
import type { ComponentPropsWithRef } from "react"
import { cx } from "../internal/util"

/** Props for {@link CanvasConflictMarker}. Native `<button>` props pass through. */
export interface CanvasConflictMarkerProps
  extends Omit<ComponentPropsWithRef<"button">, "children"> {
  /** "Hero · fill", "Headline · content", "2 conflicts"; "+2" for `more`. */
  label: string
  /**
   * `CanvasMarker/Conflict/More` (board 20 mvPXI): the "+N" pill standing for hidden overlapping
   * markers: padding [0, 8], fill bg-overlay, 1px danger stroke, no icon, label danger.
   */
  variant?: "default" | "more"
}

/**
 * Canvas pill above a conflicted node. Mirrors `CanvasMarker/Conflict` (ar36v) on 02d: height
 * 20, fill danger, radius-pill, gap 4, padding [0, 8, 0, 6], align center; icon lucide
 * git-merge 12, text-inverse; label sans 11 / 600 text-inverse. Board 18 places it 4px above
 * the node's top-left corner. Clicking focuses the node's first open conflict.
 */
export function CanvasConflictMarker({
  label,
  variant = "default",
  className,
  type = "button",
  ...rest
}: CanvasConflictMarkerProps) {
  return (
    <button
      type={type}
      {...rest}
      className={cx(
        "kimo-canvas-conflict-marker",
        variant === "more" && "kimo-canvas-conflict-marker--more",
        className,
      )}
    >
      {variant !== "more" && (
        <GitMerge className="kimo-canvas-conflict-marker__icon" aria-hidden="true" />
      )}
      <span className="kimo-canvas-conflict-marker__label">{label}</span>
    </button>
  )
}
