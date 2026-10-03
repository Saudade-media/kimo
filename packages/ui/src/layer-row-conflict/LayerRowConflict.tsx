import { ChevronDown, ChevronRight } from "lucide-react"
import type { ComponentPropsWithRef, ReactNode } from "react"
import { ConflictMarker } from "../conflict-marker/ConflictMarker"
import { cx } from "../internal/util"
import { LAYER_ROW_INDENT, LAYER_ROW_PADDING } from "../layer-row/LayerRow"

/** Props for {@link LayerRowConflict}. Remaining `<div>` props go to the row. */
export interface LayerRowConflictProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
  name: string
  /** 14 × 14 type icon (lucide `frame`, `type`, …). */
  icon: ReactNode
  /** Nesting depth (0 = root). Indent = 8 + 14 × depth, as LayerRow. */
  depth?: number
  /** Disclosure state; `undefined` = leaf (the 12px slot stays, transparent). */
  expanded?: boolean
  onToggleExpanded?: () => void
  /** Selected (board 18 "Hero": LayerRow/Selected with the marker). */
  selected?: boolean
  /** Name weight 500 (root rows). */
  emphasized?: boolean
}

/**
 * A layer row whose node owns an open merge conflict. Mirrors `LayerRow/Conflict` (VpvIr) on
 * 02d: a LayerRow (GXnBT) whose Visibility slot is replaced by a ConflictMarker (16 × 16);
 * disclosure kept (transparent fill), type icon, name, spacer, marker. The selected variant is
 * LayerRow/Selected (dArBD) with the same marker (board 18 Hero row). It reuses LayerRow's
 * classes, so its geometry and states stay identical to the base row.
 */
export function LayerRowConflict({
  name,
  icon,
  depth = 0,
  expanded,
  onToggleExpanded,
  selected = false,
  emphasized = false,
  className,
  style,
  ...rest
}: LayerRowConflictProps) {
  const leaf = expanded === undefined
  return (
    <div
      tabIndex={-1}
      {...rest}
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={selected}
      aria-expanded={leaf ? undefined : expanded}
      data-conflict=""
      className={cx(
        "kimo-layer-row",
        "kimo-layer-row--conflict",
        selected && "kimo-layer-row--selected",
        className,
      )}
      style={{ paddingLeft: LAYER_ROW_PADDING + LAYER_ROW_INDENT * depth, ...style }}
    >
      <button
        type="button"
        tabIndex={-1}
        className={cx("kimo-layer-row__disclosure", leaf && "kimo-layer-row__disclosure--leaf")}
        aria-label={leaf ? undefined : expanded ? "Collapse" : "Expand"}
        aria-hidden={leaf || undefined}
        disabled={leaf}
        onClick={(e) => {
          e.stopPropagation()
          onToggleExpanded?.()
        }}
      >
        {expanded === false ? <ChevronRight /> : <ChevronDown />}
      </button>
      <span className="kimo-layer-row__icon" aria-hidden="true">
        {icon}
      </span>
      <span
        className={cx("kimo-layer-row__name", emphasized && "kimo-layer-row__name--emphasized")}
      >
        {name}
      </span>
      <span className="kimo-layer-row__spacer" aria-hidden="true" />
      <ConflictMarker />
    </div>
  )
}
