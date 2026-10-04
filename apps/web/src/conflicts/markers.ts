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
  /** Board 24 (l) "+N" menu meta: the property ("fill") or "2 conflicts". */
  meta: string
  /** Top-left of the pill. */
  left: number
  top: number
  /** Pill width ({@link MarkerMeasure}). */
  width: number
  /** The node box to stroke with `$danger`, or null (selected nodes). */
  outline: MarkerRect | null
  /** Collapsed into a cluster's "+N" pill (board 20): the pill is not drawn, its outline is. */
  hidden: boolean
}

/**
 * `CanvasMarker/Conflict/More` (board 20 mvPXI): "+N" for the markers of a cluster of three or
 * more overlapping pills, 4px right of the cluster's first pill.
 */
export interface CanvasConflictMoreSpec {
  /** "+2". */
  label: string
  left: number
  top: number
  /** The hidden markers, in layer order (the Menu/Dense it opens lists them). */
  hidden: CanvasConflictMarkerSpec[]
}

export interface CanvasConflictMarkerLayout {
  markers: CanvasConflictMarkerSpec[]
  more: CanvasConflictMoreSpec[]
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

/**
 * Width of a pill for its label (screen px). The pill hugs its content: ar36v = 6 + icon 12 +
 * gap 4 + label + 8; mvPXI ("+N") = 8 + label + 8.
 */
export type MarkerMeasure = (label: string, variant: "default" | "more") => number

/** Gap between stacked pills and between a pill and its "+N" (board 20 note BIO8v). */
export const STACK_GAP = 4

/** Marker label for a node's open rows (ar36v default copy: "2 conflicts"). */
export function markerLabel(rows: readonly ConflictRowView[]): string {
  const [first] = rows
  if (rows.length === 1 && first) return `${first.group} · ${first.property}`
  return `${rows.length} conflicts`
}

/** Label of the "+N" pill. */
export const moreLabel = (n: number) => `+${n}`

const overlaps = (a: MarkerRect, b: MarkerRect) =>
  a.left < b.left + b.width &&
  b.left < a.left + a.width &&
  a.top < b.top + b.height &&
  b.top < a.top + a.height

const pillRect = (m: { left: number; top: number; width: number }): MarkerRect => ({
  left: m.left,
  top: m.top,
  width: m.width,
  height: MARKER_HEIGHT,
})

/**
 * Board 20 pill stacking (vignette T7TxIQ, note BIO8v), applied to pills in layer order:
 * pills whose boxes intersect form a cluster. Two: the later one moves up above the earlier by
 * pill height + 4. Three or more: the first pill stays, the others are hidden behind a
 * `CanvasMarker/Conflict/More` "+N" pill 4px to its right. Screen-space: recomputed on zoom,
 * never scaled.
 */
export function stackMarkers(
  markers: readonly CanvasConflictMarkerSpec[],
): CanvasConflictMarkerLayout {
  const n = markers.length
  const parent = markers.map((_, i) => i)
  const find = (i: number): number => {
    let r = i
    while (parent[r] !== r) r = parent[r] as number
    parent[i] = r
    return r
  }
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      if (
        overlaps(
          pillRect(markers[i] as CanvasConflictMarkerSpec),
          pillRect(markers[j] as CanvasConflictMarkerSpec),
        )
      ) {
        const a = find(i)
        const b = find(j)
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b)
      }
  const clusters = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    const r = find(i)
    const list = clusters.get(r)
    if (list) list.push(i)
    else clusters.set(r, [i])
  }
  const out = markers.map((m) => ({ ...m }))
  const more: CanvasConflictMoreSpec[] = []
  for (const members of clusters.values()) {
    if (members.length < 2) continue
    const first = out[members[0] as number] as CanvasConflictMarkerSpec
    if (members.length === 2) {
      const later = out[members[1] as number] as CanvasConflictMarkerSpec
      later.top = first.top - MARKER_HEIGHT - STACK_GAP
      continue
    }
    const hidden = members.slice(1).map((i) => {
      const m = out[i] as CanvasConflictMarkerSpec
      m.hidden = true
      return m
    })
    more.push({
      label: moreLabel(hidden.length),
      left: first.left + first.width + STACK_GAP,
      top: first.top,
      hidden,
    })
  }
  return { markers: out, more }
}

/**
 * Markers for every node that owns an open conflict and is laid out and visible, in row
 * (layer) order, stacked ({@link stackMarkers}). Screen = (world − viewport origin) × zoom, as
 * the canvas transform.
 */
export function canvasConflictMarkers(
  rows: readonly ConflictRowView[],
  layout: MarkerLayout | null,
  viewport: MarkerViewport,
  selection: readonly string[] = [],
  measure: MarkerMeasure = estimateMarkerWidth,
): CanvasConflictMarkerLayout {
  if (!layout) return { markers: [], more: [] }
  const byNode = new Map<string, ConflictRowView[]>()
  for (const r of rows) {
    if (r.resolved || !r.nodeId) continue
    const list = byNode.get(r.nodeId)
    if (list) list.push(r)
    else byNode.set(r.nodeId, [r])
  }
  const selected = new Set(selection)
  const placed: CanvasConflictMarkerSpec[] = []
  for (const [nodeId, list] of byNode) {
    const box = layout.nodes.get(nodeId)
    if (!box?.visible) continue
    const z = viewport.zoom
    const left = (box.world.x - viewport.x) * z
    const top = (box.world.y - viewport.y) * z
    const label = markerLabel(list)
    placed.push({
      nodeId,
      conflictId: (list[0] as ConflictRowView).id,
      label,
      meta: list.length === 1 ? (list[0] as ConflictRowView).property : `${list.length} conflicts`,
      left,
      top: top - MARKER_HEIGHT - MARKER_GAP,
      width: measure(label, "default"),
      outline: selected.has(nodeId)
        ? null
        : { left, top, width: box.world.w * z, height: box.world.h * z },
      hidden: false,
    })
  }
  return stackMarkers(placed)
}

/** A pure fallback (tests, no DOM): 6.2 px per character of the 11 px / 600 label. */
export function estimateMarkerWidth(label: string, variant: "default" | "more"): number {
  const text = label.length * 6.2
  return Math.ceil(variant === "more" ? 8 + text + 8 : 6 + 12 + 4 + text + 8)
}
