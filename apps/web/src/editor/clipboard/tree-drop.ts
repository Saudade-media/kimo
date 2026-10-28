/**
 * Board 27 §2 (c) h0cqV3 "Layer drag": where a drag over the Layers tree drops (pure).
 * - Pointer in the top / bottom quarter of a row = Between (indent follows the pointer's x, so a
 *   drop after the last child of a group can go a level up); the middle half of a frame / group
 *   row = Into.
 * - Invalid: inside an instance, into a non-container, a node into itself / its descendants.
 */
import type { NodeData, Op } from "@kimo/editor-state"

interface TreeRow {
  id: string
  depth: number
  parent: string | null
}

interface TreeDropReader {
  getNode(id: string): NodeData | undefined
  children(parent: string | null, at?: string | null): readonly string[]
  /** Ids of the expanded instance view (rows inside an instance). */
  isVirtual(id: string): boolean
}

export type TreeDrop =
  | {
      kind: "between"
      /** Destination parent (null = page root). */
      parent: string | null
      /** Index among the destination's children (dragged nodes removed). */
      index: number
      /** Indent depth of the indicator. */
      depth: number
      /** Row boundary the indicator sits on (0 … rows.length). */
      slot: number
      valid: true
    }
  | { kind: "into"; target: string; row: number; valid: true }
  | {
      kind: "invalid"
      /** Where the red indicator is drawn. */
      slot: number
      depth: number
      reason: string
      valid: false
    }

const CONTAINER = new Set(["frame", "group"])

function ancestors(doc: TreeDropReader, id: string): string[] {
  const out: string[] = []
  let cur = doc.getNode(id)?.parent ?? null
  const seen = new Set<string>()
  while (typeof cur === "string" && !seen.has(cur)) {
    seen.add(cur)
    out.push(cur)
    cur = doc.getNode(cur)?.parent ?? null
  }
  return out
}

/** Why a parent can't receive the dragged nodes, or null when it can. */
export function refuseParent(
  doc: TreeDropReader,
  parent: string | null,
  dragged: readonly string[],
): string | null {
  if (parent === null) return null
  if (doc.isVirtual(parent)) return "Can't drop inside an instance"
  const n = doc.getNode(parent)
  if (!n) return "Can't drop here"
  if (n.type === "instance") return "Can't drop inside an instance"
  if (!CONTAINER.has(n.type)) return "Only frames and groups hold layers"
  const chain = [parent, ...ancestors(doc, parent)]
  if (
    chain.some((a) => doc.getNode(a)?.type === "instance" || typeof doc.getNode(a)?.at === "string")
  )
    return "Can't drop inside an instance"
  if (dragged.some((d) => chain.includes(d))) return "Can't drop a layer into itself"
  return null
}

/** Index among `parent`'s children, dragged ones removed, of the slot before `beforeId`. */
function indexBefore(
  doc: TreeDropReader,
  parent: string | null,
  beforeId: string | null,
  dragged: ReadonlySet<string>,
): number {
  const kids = doc.children(parent).filter((k) => !dragged.has(k))
  if (beforeId === null) return kids.length
  const i = kids.indexOf(beforeId)
  return i < 0 ? kids.length : i
}

/**
 * The drop for a pointer over row `index` at fraction `fy` (0 = top edge, 1 = bottom edge) of
 * the row, with the pointer's indent depth `px` (fractional rows of indentation).
 */
export function computeTreeDrop(
  rows: readonly TreeRow[],
  index: number,
  fy: number,
  px: number,
  dragged: readonly string[],
  doc: TreeDropReader,
  isOpen: (row: TreeRow) => boolean,
): TreeDrop | null {
  const row = rows[index]
  if (!row) return null
  const draggedSet = new Set(dragged)
  const node = doc.getNode(row.id)
  const container = !!node && CONTAINER.has(node.type) && !doc.isVirtual(row.id)
  const zone =
    fy < 0.25 ? "before" : fy > 0.75 ? "after" : container ? "into" : fy < 0.5 ? "before" : "after"

  if (zone === "into") {
    const why = refuseParent(doc, row.id, dragged)
    if (why)
      return { kind: "invalid", slot: index + 1, depth: row.depth + 1, reason: why, valid: false }
    return { kind: "into", target: row.id, row: index, valid: true }
  }

  if (zone === "before") {
    const why = refuseParent(doc, row.parent, dragged)
    if (why) return { kind: "invalid", slot: index, depth: row.depth, reason: why, valid: false }
    return {
      kind: "between",
      parent: row.parent,
      index: indexBefore(doc, row.parent, row.id, draggedSet),
      depth: row.depth,
      slot: index,
      valid: true,
    }
  }

  // After: an open container's first child slot, else after the row at a depth the pointer's x
  // picks between the next row's depth and this row's.
  const next = rows[index + 1]
  if (container && isOpen(row) && next && next.depth > row.depth) {
    const why = refuseParent(doc, row.id, dragged)
    if (why)
      return { kind: "invalid", slot: index + 1, depth: row.depth + 1, reason: why, valid: false }
    return {
      kind: "between",
      parent: row.id,
      index: indexBefore(doc, row.id, next.id, draggedSet),
      depth: row.depth + 1,
      slot: index + 1,
      valid: true,
    }
  }
  const minDepth = next ? Math.min(next.depth, row.depth) : 0
  const depth = Math.max(minDepth, Math.min(row.depth, Math.round(px)))
  // The ancestor of `row` at `depth` is the node the drop follows.
  let anchor: TreeRow = row
  for (let i = index; i >= 0 && anchor.depth > depth; i--) {
    const r = rows[i] as TreeRow
    if (r.depth === anchor.depth - 1 && r.id === anchor.parent) anchor = r
  }
  const parent = anchor.parent
  const why = refuseParent(doc, parent, dragged)
  if (why) return { kind: "invalid", slot: index + 1, depth, reason: why, valid: false }
  const sibs = doc.children(parent).filter((k) => !draggedSet.has(k))
  const at = sibs.indexOf(anchor.id)
  return {
    kind: "between",
    parent,
    index: at < 0 ? sibs.length : at + 1,
    depth,
    slot: index + 1,
    valid: true,
  }
}

/**
 * Ops moving `ids` (top-level, tree order) as one block to the drop. Nodes leaving a free
 * position keep their canvas position when they land in a free parent (`worldOf` / `originOf`
 * give laid-out world boxes); in an auto-layout parent they flow.
 */
export function treeDropOps(
  doc: TreeDropReader,
  ids: readonly string[],
  drop: Extract<TreeDrop, { valid: true }>,
  geometry?: {
    worldOf(id: string): { x: number; y: number } | null
    /** World origin of a parent's content box (null = page root: 0, 0). */
    originOf(parent: string | null): { x: number; y: number } | null
  },
): Op[] {
  const parent = drop.kind === "into" ? drop.target : drop.parent
  const base =
    drop.kind === "into" ? doc.children(parent).filter((k) => !ids.includes(k)).length : drop.index
  const p = parent ? doc.getNode(parent) : undefined
  const flows = !!p && typeof p.layout === "object" && p.layout !== null
  const ops: Op[] = []
  ids.forEach((id, i) => {
    const n = doc.getNode(id)
    if (!n) return
    ops.push({ op: "move", id, parent, index: base + i })
    if (!flows && geometry && n.parent !== parent) {
      const w = geometry.worldOf(id)
      const o = geometry.originOf(parent)
      if (w && o)
        ops.push({
          op: "update",
          id,
          set: { x: Math.round((w.x - o.x) * 100) / 100, y: Math.round((w.y - o.y) * 100) / 100 },
        })
    }
  })
  return ops
}
