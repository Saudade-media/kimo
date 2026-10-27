import { type ComponentPropsWithRef, useRef } from "react"
import { cx, mergeRefs } from "../internal/util"
import type { PlacementOptions } from "../popover/position"
import { floating, type PopoverAnchor, useAnchoredPosition } from "../popover/usePopover"

/**
 * Board 24 (k) "Warning dot" (HWYvD): a 6 × 6 `$warning` ellipse on the weight field, between
 * the value spacer and the chevron, while the chosen weight is not available for the family.
 */
export function WarningDot({ className, ...rest }: ComponentPropsWithRef<"span">) {
  return <span aria-hidden="true" {...rest} className={cx("kimo-warning-dot", className)} />
}

/** Props for {@link MissingWeightTooltip}. Remaining `<div>` props go to the bubble. */
export interface MissingWeightTooltipProps extends ComponentPropsWithRef<"div"> {
  /** "Inter Bold (700) isn't installed". */
  title: string
  /** "Showing Semibold 600. Install the weight or pick another." */
  body: string
  /** Positions the tooltip (`position: fixed`) under this element; omit to render in flow. */
  anchor?: PopoverAnchor
  placement?: PlacementOptions
}

/**
 * Board 24 (k) "Tooltip · missing weight" (Esdjk): column, gap 2, padding [6, 8], width 260,
 * fill text-primary, radius-sm, shadow 0 4 12 shadow. Title (rQ5cV) sans 12 / 500 text-inverse;
 * Body (tPank) sans 11 text-inverse, opacity 0.8, lineHeight 1.45, fixed width.
 */
export function MissingWeightTooltip({
  title,
  body,
  anchor,
  placement,
  className,
  style,
  ref,
  ...rest
}: MissingWeightTooltipProps) {
  const root = useRef<HTMLDivElement>(null)
  const pos = useAnchoredPosition(root, anchor, {
    side: "bottom",
    align: "start",
    offset: 6,
    ...placement,
  })
  return floating(
    <div
      role="tooltip"
      {...rest}
      ref={mergeRefs(root, ref)}
      className={cx("kimo-weight-tooltip", className)}
      style={
        pos
          ? {
              position: "fixed",
              left: pos.x,
              top: pos.y,
              visibility: pos.ready ? undefined : "hidden",
              ...style,
            }
          : style
      }
    >
      <span className="kimo-weight-tooltip__title">{title}</span>
      <span className="kimo-weight-tooltip__body">{body}</span>
    </div>,
    anchor,
  )
}
