import type { CanvasHandle, UiStore } from "../canvas/contract"

/** Below this zoom a "fit everything" view is unreadable; frame the first root instead. */
const MIN_OVERVIEW_ZOOM = 0.1

/**
 * The opening view of a page: everything when that stays legible, else the first root in
 * reading order (top-most, then left-most). Used when a file opens and on a page's first visit,
 * since the viewport is not stored in the file.
 */
export function fitPage(canvas: CanvasHandle, ui: UiStore, roots: readonly string[]): void {
  const layout = canvas.layout()
  if (!layout) return
  canvas.zoomToFit()
  if (ui.getState().viewport.zoom >= MIN_OVERVIEW_ZOOM) return
  let first: { id: string; x: number; y: number } | null = null
  for (const id of roots) {
    const b = layout.nodes.get(id)?.world
    if (b && (!first || b.y < first.y || (b.y === first.y && b.x < first.x)))
      first = { id, x: b.x, y: b.y }
  }
  if (first) canvas.zoomToFit([first.id], 96)
}
