import { ChevronDown, ChevronRight, CornerDownRight } from "lucide-react"
import type { ComponentPropsWithRef, ReactNode } from "react"
import { cx } from "../internal/util"
import { LAYER_ROW_INDENT, LAYER_ROW_PADDING } from "../layer-row/LayerRow"

/** Props for {@link LayerRowDropTarget}. Remaining `<div>` props go to the row. */
export interface LayerRowDropTargetProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
  name: string
  /** 14 × 14 type icon (colored $selection). */
  icon: ReactNode
  depth?: number
  /** Disclosure state of the container (default collapsed: chevron-right). */
  expanded?: boolean
}

/**
 * The "into" state of a layer row while a drag hovers its middle half. Mirrors
 * `LayerRow/DropTarget` (tvN2q): fill_container × 28, fill $selection-soft, radius-sm, stroke 1.5
 * $selection, gap 6, padding [0, 8], alignItems center: Disclosure 12 (chevron-right,
 * text-tertiary) · Type Icon 14 ($selection) · Name sans text-sm text-primary · Spacer · Into
 * Icon 14 (corner-down-right, $selection). Indent as LayerRow (8 + 14 × depth).
 */
export function LayerRowDropTarget({
  name,
  icon,
  depth = 0,
  expanded = false,
  className,
  style,
  ...rest
}: LayerRowDropTargetProps) {
  return (
    <div
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={false}
      aria-expanded={expanded}
      data-drop-target="into"
      tabIndex={-1}
      {...rest}
      className={cx("kimo-layer-row-drop-target", className)}
      style={{ paddingLeft: LAYER_ROW_PADDING + LAYER_ROW_INDENT * depth, ...style }}
    >
      <span className="kimo-layer-row-drop-target__disclosure" aria-hidden="true">
        {expanded ? <ChevronDown /> : <ChevronRight />}
      </span>
      <span className="kimo-layer-row-drop-target__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="kimo-layer-row-drop-target__name">{name}</span>
      <span className="kimo-layer-row-drop-target__spacer" aria-hidden="true" />
      <span className="kimo-layer-row-drop-target__into" aria-hidden="true">
        <CornerDownRight />
      </span>
    </div>
  )
}
