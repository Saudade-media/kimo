/**
 * Anchored positioning for popovers and dense menus (pure; no DOM).
 *
 * Board 09 places every panel popover and Select menu **4px below its trigger, left-aligned**
 * (`side: "bottom"`, `align: "start"`, `offset: 4`). When that side does not fit in the viewport
 * the popover flips to the opposite side (if it fits better there), then shifts along the cross
 * axis to stay `padding` px inside the viewport.
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export type Side = "top" | "bottom" | "left" | "right"
export type Align = "start" | "center" | "end"

export interface PlacementOptions {
  /** Default `"bottom"`. */
  side?: Side
  /** Default `"start"`. */
  align?: Align
  /** Gap between the anchor and the floating box. Default 4 (board 09). */
  offset?: number
  /** Minimum distance to the viewport edges. Default 8. */
  padding?: number
  /** Flip to the opposite side when the preferred one overflows. Default true. */
  flip?: boolean
}

export interface Placement {
  x: number
  y: number
  /** The side actually used (after flipping). */
  side: Side
}

const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" }

/**
 * Position of a `floating` box (only its size is used) against `anchor`, inside `viewport`
 * (usually `{ x: 0, y: 0, width: innerWidth, height: innerHeight }`). Coordinates share the
 * anchor's space (client coordinates for `position: fixed`).
 */
export function anchoredPosition(
  anchor: Rect,
  floating: { width: number; height: number },
  viewport: Rect,
  options: PlacementOptions = {},
): Placement {
  const { side = "bottom", align = "start", offset = 4, padding = 8, flip = true } = options

  const vertical = side === "top" || side === "bottom"
  const mainOf = (s: Side) => {
    switch (s) {
      case "bottom":
        return anchor.y + anchor.height + offset
      case "top":
        return anchor.y - offset - floating.height
      case "right":
        return anchor.x + anchor.width + offset
      case "left":
        return anchor.x - offset - floating.width
    }
  }
  /** Space left on a side, negative when the box overflows the viewport there. */
  const spaceOf = (s: Side) => {
    const pos = mainOf(s)
    switch (s) {
      case "bottom":
        return viewport.y + viewport.height - padding - (pos + floating.height)
      case "top":
        return pos - (viewport.y + padding)
      case "right":
        return viewport.x + viewport.width - padding - (pos + floating.width)
      case "left":
        return pos - (viewport.x + padding)
    }
  }

  let used = side
  if (flip && spaceOf(side) < 0 && spaceOf(OPPOSITE[side]) > spaceOf(side)) used = OPPOSITE[side]
  const main = mainOf(used)

  // Cross axis: align, then shift into the viewport.
  const aStart = vertical ? anchor.x : anchor.y
  const aSize = vertical ? anchor.width : anchor.height
  const fSize = vertical ? floating.width : floating.height
  const vStart = (vertical ? viewport.x : viewport.y) + padding
  const vEnd = (vertical ? viewport.x + viewport.width : viewport.y + viewport.height) - padding
  let cross =
    align === "start"
      ? aStart
      : align === "end"
        ? aStart + aSize - fSize
        : aStart + (aSize - fSize) / 2
  if (cross + fSize > vEnd) cross = vEnd - fSize
  if (cross < vStart) cross = vStart

  return vertical ? { x: cross, y: main, side: used } : { x: main, y: cross, side: used }
}
