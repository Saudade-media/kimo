/**
 * Canvas conflict markers (board 18): where the `CanvasMarker/Conflict` pills and the 1.5px
 * `$danger` outlines go, in canvas screen pixels, from the layout and the viewport. Pure.
 *
 * Board 18 geometry (canvas `S6HXd`): the pill sits at the node's left edge, its bottom 4px
 * above the node's top (Hero: outline y 130, marker y 106, marker height 20); the outline is
 * the node's box (`Conflict Outline · Headline` = Headline's 472 × 106 box). The selected node
 * already shows the selection outline, so it gets no danger outline.
 */
import type { ConflictRowView } from "../platform/contract"

/** Marker height (ar36v) and its gap above the node. */
export const MARKER_HEIGHT = 20
export const MARKER_GAP = 4

export interface MarkerRect {
  left: number
  top: number
  width: number
  height: number
}

export interface CanvasConflictMarkerSpec {
  nodeId: string
  /** First open conflict of the node (clicking the marker focuses it). */
  conflictId: string
  /** "Hero · fill" for one open conflict, "2 conflicts" for several. */
  label: string
  /** Top-left of the pill. */
  left: number
  top: number
  /** The node box to stroke with `$danger`, or null (selected nodes). */
  outline: MarkerRect | null
}

/** The subset of a layout pass the markers read. */
export interface MarkerLayout {
  readonly nodes: ReadonlyMap<
    string,
    { readonly world: { x: number; y: number; w: number; h: number }; readonly visible: boolean }
  >
}

export interface MarkerViewport {
  x: number
  y: number
  zoom: number
}

/** Marker label for a node's open rows (ar36v default copy: "2 conflicts"). */
export function markerLabel(rows: readonly ConflictRowView[]): string {
  const [first] = rows
  if (rows.length === 1 && first) return `${first.group} · ${first.property}`
  return `${rows.length} conflicts`
}

/**
 * Markers for every node that owns an open conflict and is laid out and visible, in row
 * (layer) order. Screen = (world − viewport origin) × zoom, as the canvas transform.
 */
export function canvasConflictMarkers(
  rows: readonly ConflictRowView[],
  layout: MarkerLayout | null,
  viewport: MarkerViewport,
  selection: readonly string[] = [],
): CanvasConflictMarkerSpec[] {
  if (!layout) return []
  const byNode = new Map<string, ConflictRowView[]>()
  for (const r of rows) {
    if (r.resolved || !r.nodeId) continue
    const list = byNode.get(r.nodeId)
    if (list) list.push(r)
    else byNode.set(r.nodeId, [r])
  }
  const selected = new Set(selection)
  const out: CanvasConflictMarkerSpec[] = []
  for (const [nodeId, list] of byNode) {
    const box = layout.nodes.get(nodeId)
    if (!box?.visible) continue
    const z = viewport.zoom
    const left = (box.world.x - viewport.x) * z
    const top = (box.world.y - viewport.y) * z
    out.push({
      nodeId,
      conflictId: (list[0] as ConflictRowView).id,
      label: markerLabel(list),
      left,
      top: top - MARKER_HEIGHT - MARKER_GAP,
      outline: selected.has(nodeId)
        ? null
        : { left, top, width: box.world.w * z, height: box.world.h * z },
    })
  }
  return out
}
