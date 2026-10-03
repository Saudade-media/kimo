import { Component, GripVertical } from "lucide-react"
import type { ComponentPropsWithRef, ReactNode } from "react"
import { cx } from "../internal/util"

/** Props for {@link AssetTile}. Remaining `<div>` props go to the tile. */
export interface AssetTileProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
  /** Component name ("Button/Primary"; derived: "Button/Ghost · from Primary"). */
  name: string
  /** Preview: an image URL (renderer `exportRaster`), or any node (placeholder). */
  thumbnail?: string | ReactNode
  /** Forces the `AssetTile/Hover` (SGo9R) look (bg-hover, border-strong, grip). */
  hover?: boolean
  /** Drag source (board 13 `a5C4Uc`): hover look at opacity 0.5. */
  dragging?: boolean
  /** Drag ghost (board 13 `kVsm2`): bg-overlay, stroke component, shadow 0 12 32. */
  ghost?: boolean
  /** Selected/activated (Enter or click). */
  onSelect?: () => void
  /** Glyph before the name; default lucide `component`. */
  glyph?: ReactNode
}

/**
 * Assets-panel tile. Mirrors `AssetTile` (Q4zkG) / `AssetTile/Hover` (SGo9R): width 112, column,
 * gap 6, padding 4, stroke 1 transparent, radius-md. Preview (hwUNY) fill_container × 72,
 * bg-subtle, radius-sm, clip, center/center, with Grip (WhNv3, `grip-vertical` 12
 * text-tertiary, absolute 4,4; hover only). Name Row (B0LqDC) row, gap 4, padding [0, 2, 2, 2],
 * center: Glyph (fjQ56) `component` 12 component · Name (eHHvU) sans 11 / 500 text-primary,
 * fill, ellipsis. Draggable when `onDragStart` is given.
 */
export function AssetTile({
  name,
  thumbnail,
  hover = false,
  dragging = false,
  ghost = false,
  onSelect,
  glyph,
  className,
  onClick,
  onKeyDown,
  onDragStart,
  ...rest
}: AssetTileProps) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a draggable tile that contains block content and a preview image; a <button> drag source is unreliable across browsers.
    <div
      role="button"
      tabIndex={0}
      aria-label={name}
      draggable={onDragStart !== undefined || undefined}
      {...rest}
      onDragStart={onDragStart}
      className={cx(
        "kimo-asset-tile",
        (hover || dragging) && "kimo-asset-tile--hover",
        dragging && "kimo-asset-tile--dragging",
        ghost && "kimo-asset-tile--ghost",
        className,
      )}
      onClick={(e) => {
        onClick?.(e)
        if (!e.defaultPrevented) onSelect?.()
      }}
      onKeyDown={(e) => {
        onKeyDown?.(e)
        if (!e.defaultPrevented && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault()
          onSelect?.()
        }
      }}
    >
      <span className="kimo-asset-tile__preview">
        {typeof thumbnail === "string" ? (
          <img className="kimo-asset-tile__image" src={thumbnail} alt="" draggable={false} />
        ) : (
          thumbnail
        )}
        <span className="kimo-asset-tile__grip" aria-hidden="true">
          <GripVertical />
        </span>
      </span>
      <span className="kimo-asset-tile__name-row">
        <span className="kimo-asset-tile__glyph" aria-hidden="true">
          {glyph ?? <Component />}
        </span>
        <span className="kimo-asset-tile__name">{name}</span>
      </span>
    </div>
  )
}
