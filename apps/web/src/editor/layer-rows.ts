/**
 * The rows of the layers tree: the active page's roots and what is open under them, in tree
 * order (board 27 §1). A root's rows are kept while its subtree keeps its shape, so an edit
 * walks one root and not the page.
 */
import type { ExpandedView } from "@kimo/core-schema"
import type { DocStore, NodeData } from "@kimo/editor-state"
import { rootShapeRev } from "../lib/tree-hub"

export interface Row {
  id: string
  depth: number
  hasChildren: boolean
  parent: string | null
}

/** Rows per root as last walked, valid for one view and one open state. */
export interface RowCache {
  view: ExpandedView
  isOpen: (id: string, depth: number) => boolean
  roots: Map<string, { rev: number; rows: Row[] }>
}

export function layerRows(o: {
  store: DocStore
  /** The expanded view: instances list their main's children under composite ids. */
  view: ExpandedView
  /** Roots of the active page. */
  onPage: ReadonlySet<string>
  isOpen: (id: string, depth: number) => boolean
  /** Search: true for a node whose own text matches (its ancestors are then listed too). */
  matches: ((n: NodeData) => boolean) | null
  /** The cache the previous call returned (null: walk everything). */
  cache: RowCache | null
}): { rows: Row[]; cache: RowCache | null } {
  const { store, view, onPage, isOpen } = o
  const out: Row[] = []
  const memo = new Map<string, boolean>()
  const listed = (id: string): boolean => {
    const own = o.matches
    if (!own) return true
    const hit = memo.get(id)
    if (hit !== undefined) return hit
    const n = view.getNode(id) as NodeData | undefined
    const ok = !!n && (own(n) || view.children(id).some(listed))
    memo.set(id, ok)
    return ok
  }
  // Set when a walk meets something whose rows another root can change: an instance (it
  // mirrors its main), a composite id, or slot content.
  let mirrored = false
  const row = (id: string, depth: number, parent: string | null, into: Row[]) => {
    if (!listed(id)) return
    if (!mirrored) {
      const n = store.getNode(id)
      if (!n || n.type === "instance" || typeof n.at === "string") mirrored = true
    }
    const kids = view.children(id)
    into.push({ id, depth, hasChildren: kids.length > 0, parent })
    if (kids.length > 0 && isOpen(id, depth)) for (const c of kids) row(c, depth + 1, id, into)
  }
  // Not kept with a search (rows then depend on names), nor for a root with instances in its
  // rows.
  const keep = o.matches === null
  let cache = o.cache
  if (!cache || cache.view !== view || cache.isOpen !== isOpen)
    cache = { view, isOpen, roots: new Map() }
  const kept = cache.roots
  const roots = view.children(null)
  // Roots that are gone leave their entry behind: dropped once they outnumber the live ones.
  if (kept.size > 2 * roots.length + 1024)
    for (const id of [...kept.keys()]) if (!store.getNode(id)) kept.delete(id)
  for (const id of roots) {
    if (!onPage.has(id)) continue
    const rev = rootShapeRev(store, id)
    const hit = keep ? kept.get(id) : undefined
    if (hit && hit.rev === rev) {
      for (const r of hit.rows) out.push(r)
      continue
    }
    mirrored = false
    const mine: Row[] = []
    row(id, 0, null, mine)
    for (const r of mine) out.push(r)
    if (keep && !mirrored) kept.set(id, { rev, rows: mine })
    else kept.delete(id)
  }
  return { rows: out, cache: keep ? cache : null }
}
