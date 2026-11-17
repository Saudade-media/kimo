/**
 * Board 27 §1 (pages): the editor side of spec §5.6. Which page is active lives in the UI store
 * (`ui.page`, null = the first page); this module resolves it against the document and keeps
 * edits on the active page: a root insert or a move to the root gets `page`, a move into a
 * container drops it. Pure: no React.
 */
import { listPages, type PageInfo, pageOfRoot } from "@kimo/core-schema"
import type { DocStore, NodeData, Op } from "@kimo/editor-state"
import type { UiStore } from "../../canvas/contract"
import { rootShapeRev } from "../../lib/tree-hub"

type PageDoc = { pages?: unknown }

const headerOf = (store: Pick<DocStore, "toHeader">): PageDoc => ({
  pages: store.toHeader().pages,
})

/** The active page id: `ui.page` when it still exists, else the first page (null = implicit). */
export function activePageId(
  store: Pick<DocStore, "toHeader">,
  page: string | null,
): string | null {
  const pages = listPages(headerOf(store))
  if (page !== null && pages.some((p) => p.id === page)) return page
  return (pages[0] as PageInfo).id
}

/** True when the document has explicit pages (roots then carry `page`). */
export function hasPages(store: Pick<DocStore, "toHeader">): boolean {
  const p = store.toHeader().pages
  return typeof p === "object" && p !== null && Object.keys(p).length > 0
}

/** True when root node `n` is on page `pageId` (already resolved with {@link activePageId}). */
function rootOnPage(doc: PageDoc, n: NodeData | undefined, pageId: string | null): boolean {
  if (!n) return false
  return pageOfRoot(doc, n) === pageId
}

interface RootsMemo {
  rev: number
  pages: string
  page: string | null
  roots: readonly string[]
  set: ReadonlySet<string> | null
}

/** The last answer of {@link activeRoots}, kept while the root list and the pages stay. */
const activeRootsMemo = new WeakMap<DocStore, RootsMemo>()

function rootsOf(store: DocStore, page: string | null): RootsMemo {
  const doc = headerOf(store)
  // Asked on every edit and frame: the roots are filtered again only when one was added,
  // removed, reordered or moved to another page, or the page list changed.
  const rev = store.rootsRev
  const pages = JSON.stringify(doc.pages ?? null)
  const memo = activeRootsMemo.get(store)
  if (memo && memo.rev === rev && memo.pages === pages && memo.page === page) return memo
  const id = activePageId(store, page)
  const roots = store.children(null).filter((r) => rootOnPage(doc, store.getNode(r), id))
  const next: RootsMemo = { rev: rev ?? -1, pages, page, roots, set: null }
  // A store that does not count root changes is asked every time.
  if (rev !== undefined) activeRootsMemo.set(store, next)
  return next
}

/** Root ids of the active page, in sibling order. */
export function activeRoots(store: DocStore, page: string | null): string[] {
  // A copy: callers own the returned array.
  return rootsOf(store, page).roots.slice()
}

/** {@link activeRoots} as a set (shared: do not change it). */
export function activeRootSet(store: DocStore, page: string | null): ReadonlySet<string> {
  const memo = rootsOf(store, page)
  memo.set ??= new Set(memo.roots)
  return memo.set
}

/**
 * A node source whose roots are the active page's (`children(null)`); everything else reads
 * the store. The canvas lays out, renders and hit-tests through it, so other pages cost nothing.
 */
export function pageScopedSource(store: DocStore, ui: UiStore) {
  return {
    getNode: (id: string) => store.getNode(id),
    children: (parent: string | null, at?: string | null): readonly string[] =>
      parent === null && (at === undefined || at === null)
        ? activeRoots(store, ui.getState().page)
        : store.children(parent, at),
    /** The active page's roots as a set (shared: do not change it). */
    rootSet: (): ReadonlySet<string> => activeRootSet(store, ui.getState().page),
  }
}

/**
 * Rewrites an op group so it stays on the active page (only when the document has explicit
 * pages): a root `insert` without `page` gets the active page, a `move` to the root sets it
 * and a `move` of a root into a container removes it.
 */
export function withActivePage(store: DocStore, ui: UiStore, ops: readonly Op[]): readonly Op[] {
  if (!hasPages(store)) return ops
  const page = activePageId(store, ui.getState().page)
  if (page === null) return ops
  let changed = false
  const map = (list: readonly Op[]): Op[] => {
    const out: Op[] = []
    for (const op of list) {
      if (op.op === "batch") {
        out.push({ ...op, ops: map(op.ops) })
        continue
      }
      if (op.op === "insert") {
        const node = op.node as Record<string, unknown>
        const parent = op.parent !== undefined ? op.parent : (node.parent ?? null)
        if (parent === null && node.page === undefined) {
          out.push({ ...op, node: { ...node, page } })
          changed = true
          continue
        }
      }
      out.push(op)
      if (op.op === "move") {
        // Unconditional (not read from the store): a gesture step is rewritten before the
        // previous step is reverted, so the store may not show the state the op applies to.
        out.push(
          op.parent === null
            ? { op: "update", id: op.id, set: { page } }
            : { op: "update", id: op.id, unset: ["page"] },
        )
        changed = true
      }
    }
    return out
  }
  const next = map(ops)
  return changed ? next : ops
}

/** Layer count of each root's subtree, kept while the subtree keeps its shape. */
const subtreeCounts = new WeakMap<DocStore, Map<string, { rev: number; n: number }>>()

/** "N layers": the number of nodes on a page (its roots and their descendants, real nodes). */
export function pageLayerCount(store: DocStore, roots: readonly string[]): number {
  let counts = subtreeCounts.get(store)
  if (!counts) {
    counts = new Map()
    subtreeCounts.set(store, counts)
  }
  // Roots that are gone leave their entry behind: dropped once they outnumber the live ones.
  if (counts.size > 2 * roots.length + 1024)
    for (const id of [...counts.keys()]) if (!store.getNode(id)) counts.delete(id)
  let total = 0
  let n = 0
  const walk = (id: string) => {
    n++
    for (const c of store.children(id)) walk(c)
  }
  for (const r of roots) {
    const rev = rootShapeRev(store, r)
    let entry = counts.get(r)
    if (!entry || entry.rev !== rev) {
      n = 0
      walk(r)
      entry = { rev, n }
      counts.set(r, entry)
    }
    total += entry.n
  }
  return total
}

/** Root ids per page key ("" = implicit page), every root assigned exactly once. */
export function rootsPerPage(store: DocStore): Map<string, string[]> {
  const doc = headerOf(store)
  const out = new Map<string, string[]>()
  for (const p of listPages(doc)) out.set(p.id ?? "", [])
  for (const r of store.children(null)) out.get(pageOfRoot(doc, store.getNode(r)) ?? "")?.push(r)
  return out
}
