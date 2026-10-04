/**
 * Board 27 §2 structure feedback over the canvas (DOM chrome, screen px from the controller):
 *
 * - InsertionBar/Horizontal `OGqUu` (120×6, row, align center: Cap L 2×6 · Bar fill×2 · Cap R
 *   2×6, all $selection) and its vertical twin `sKpaJ` (6 wide, column: Cap T 6×2 · Bar 2×fill ·
 *   Cap B 6×2). The bar's length is the slot's cross extent at the current zoom.
 * - Gap Placeholder (Y4vVe `m3Qwz`): the vacated slot, 1 px $border-strong, the node's radius.
 * - The dragged node (Y4vVe `EERUC` "Card Two · dragged"): its raster at opacity 0.85, 1.5 px
 *   $selection stroke, shadow 0 8 20 $shadow-strong.
 * - Draw Ghost (c2o3u `N5i12`: fill #2F6BFF14, 1 px $selection) with a MeasurePill (`lSZXU`,
 *   fill $selection, radius pill, padding [2, 8], mono xs 500 $on-accent) 8 px to its right.
 * - Tooltip/Hint `u0dQ1` ("Release → inserts at N · ⌘ draws on top" with `square`; "Outside →
 *   to Canvas · ⌘ keeps it absolute" with `move`), above the floating toolbar like the pen hint.
 */
import { TooltipHint } from "@kimo/ui"
import { Move, Square } from "lucide-react"
import type { StructureDom } from "./insertion"
import "./insertion.css"

export function StructureOverlay({ dom }: { dom: StructureDom }) {
  const { bar, gaps, ghosts, draw, hint } = dom
  return (
    <>
      {gaps.map((g, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: one gap per moved node, in order
          key={i}
          className="canvas-gap"
          data-testid="gap-placeholder"
          data-canvas-overlay=""
          style={{ left: g.x, top: g.y, width: g.w, height: g.h, borderRadius: g.radius }}
        />
      ))}
      {ghosts.map((g) => (
        <div
          key={g.key}
          className="canvas-drag-ghost"
          data-testid="drag-ghost"
          data-canvas-overlay=""
          style={{
            left: g.x,
            top: g.y,
            width: g.w,
            height: g.h,
            borderRadius: g.radius,
            backgroundImage: g.src ? `url(${g.src})` : undefined,
          }}
        />
      ))}
      {draw && (
        <>
          <div
            className="canvas-draw-ghost"
            data-testid="draw-ghost"
            data-canvas-overlay=""
            style={{ left: draw.x, top: draw.y, width: draw.w, height: draw.h }}
          />
          <div
            className="canvas-draw-pill"
            data-testid="draw-pill"
            data-canvas-overlay=""
            style={{ left: draw.x + draw.w + 8, top: draw.y + draw.h / 2 }}
          >
            {draw.label}
          </div>
        </>
      )}
      {bar && (
        <div
          className={`canvas-insertion-bar canvas-insertion-bar--${bar.axis === "v" ? "vertical" : "horizontal"}`}
          data-testid="insertion-bar"
          data-axis={bar.axis}
          data-canvas-overlay=""
          style={
            bar.axis === "v"
              ? { left: bar.x - 3, top: bar.y, height: bar.length }
              : { left: bar.x, top: bar.y - 3, width: bar.length }
          }
        >
          <span className="canvas-insertion-bar__cap" />
          <span className="canvas-insertion-bar__bar" />
          <span className="canvas-insertion-bar__cap" />
        </div>
      )}
      {hint && (
        <TooltipHint
          icon={hint.icon === "square" ? <Square /> : <Move />}
          className="canvas-hint canvas-hint--toolbar"
          data-testid="structure-hint"
          data-canvas-overlay=""
        >
          {hint.text}
        </TooltipHint>
      )}
    </>
  )
}
