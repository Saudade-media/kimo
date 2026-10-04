/**
 * DOM hints over the canvas (board 10; they are chrome, not canvas pixels):
 *
 * - `HintPill` = Tooltip/Hint `u0dQ1`: fill text-primary, radius-pill, shadow 0 4 12 shadow,
 *   row, gap 8, padding [6, 12, 6, 10], align center → Icon 12 text-inverse · Label sans
 *   text-sm 500 text-inverse. Used for the pen hint (above the toolbar, #7 BacCm), "Close path"
 *   (#5 Dl8Vz) and the path-edit mode pill (#6 SzSzZ).
 * - `ZoomBadge` = SizeBadge/Zoom `L5GCtM` at (16, 16) while the pixel grid shows (#4 I8Ia0D).
 * - The ⌥ "Measuring" hint (#3a/#3b CneCx) is the existing `Tooltip` (xbtkW) bubble
 *   (`TooltipContent` from `@kimo/ui` with the key "⌥").
 *
 * The visuals are `TooltipHint` / `ZoomBadge` from `@kimo/ui` (same node specs); this module only
 * adds the canvas placement classes (canvas-m2.css). `ZoomBadge` subscribes to the zoom itself so
 * the canvas host does not re-render on every zoom frame.
 */
import { TooltipHint, ZoomBadge as UiZoomBadge } from "@kimo/ui"
import { CircleDot, Crop, PenTool, Spline } from "lucide-react"
import type { ComponentPropsWithRef, ReactNode } from "react"
import { useUi } from "../lib/hooks"
import type { UiStore } from "./contract"

const HINT_ICONS = {
  "pen-tool": PenTool,
  "circle-dot": CircleDot,
  spline: Spline,
  crop: Crop,
} as const

export type HintIcon = keyof typeof HINT_ICONS

export function HintPill({
  icon,
  children,
  className,
  ...rest
}: { icon: HintIcon; children: ReactNode } & Omit<ComponentPropsWithRef<"div">, "children">) {
  const I = HINT_ICONS[icon]
  return (
    <TooltipHint
      {...rest}
      icon={<I />}
      className={className ? `canvas-hint ${className}` : "canvas-hint"}
      data-canvas-overlay=""
    >
      {children}
    </TooltipHint>
  )
}

/**
 * SizeBadge/Zoom (L5GCtM) at (16, 16) while the pixel grid shows; follows the live zoom. With
 * rulers on it moves past the 20 px strips (36, 36) so it never covers the numbers.
 */
export function ZoomBadge({ ui, rulers = false }: { ui: UiStore; rulers?: boolean }) {
  const zoom = useUi(ui, (s) => s.viewport.zoom)
  return (
    <UiZoomBadge
      zoom={zoom}
      className={rulers ? "canvas-zoom-badge canvas-zoom-badge--rulers" : "canvas-zoom-badge"}
      data-canvas-overlay=""
      role="status"
    />
  )
}
