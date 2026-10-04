import type { ComponentPropsWithRef } from "react"
import { cx } from "../internal/util"

/** Props for {@link DropIndicator}. Remaining `<div>` props go to the frame. */
export interface DropIndicatorProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
  /** `DropIndicator/Invalid` (nN73G): $danger instead of $selection. */
  invalid?: boolean
}

/**
 * Drop slot marker between tree / page rows. Mirrors `DropIndicator/Between` (miJd9) and
 * `DropIndicator/Invalid` (nN73G): fill_container × 8, alignItems center: Ring (8 × 8 ellipse,
 * fill bg-app, stroke 2 $selection) · Line (fill_container × 2, $selection). Invalid: $danger.
 * The host positions it (absolute, over the gap) at the target indent.
 */
export function DropIndicator({ invalid = false, className, ...rest }: DropIndicatorProps) {
  return (
    <div
      aria-hidden="true"
      {...rest}
      className={cx("kimo-drop-indicator", invalid && "kimo-drop-indicator--invalid", className)}
    >
      <span className="kimo-drop-indicator__ring" />
      <span className="kimo-drop-indicator__line" />
    </div>
  )
}
