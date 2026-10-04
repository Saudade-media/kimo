/**
 * Page edits as op builders (spec §5.6, board 27 §1): pure functions of a store that return the
 * ops of one undo step. Pages live in the root `pages` record; a root node's `page` names its
 * page. The first explicit page of a one-page document materializes the implicit page too, and
 * every builder that can change which page is first stamps `page` on the roots that relied on
 * "absent = first page", so no root ever changes page as a side effect.
 */
import { DEFAULT_PAGE_NAME, listPages, type PageInfo, pageOfRoot } from "@kimo/core-schema"
import { generateId } from "./ids"
import type { Op } from "./ops"
import { keyBetween } from "./order-key"
import type { DocStore } from "./types"

/** Read access the builders need. */
export type PageReader = Pick<DocStore, "toHeader" | "children" | "getNode">

type PageRecord = Record<string, { order: string; name: string }>

const docOf = (store: PageReader) => ({ pages: store.toHeader().pages, nodes: undefined })

/** The pages of the store's document, in display order (never empty; id null = implicit). */
export function pagesOf(store: PageReader): PageInfo[] {
  return listPages(docOf(store))
}

/** The page of node `id` (its root's page); null for the implicit page or a missing node. */
export function pageOfNode(store: PageReader, id: string): string | null {
  let cur = store.getNode(id)
  const seen = new Set<string>()
  while (cur && typeof cur.parent === "string" && !seen.has(cur.parent)) {
    seen.add(cur.parent)
    cur = store.getNode(cur.parent)
  }
  return cur ? pageOfRoot(docOf(store), cur) : null
}

/** Root ids on page `pageId` (null = the first page), in sibling order. */
export function pageRoots(store: PageReader, pageId: string | null): string[] {
  const doc = docOf(store)
  const target = pageId ?? (listPages(doc)[0] as PageInfo).id
  return store.children(null).filter((id) => pageOfRoot(doc, store.getNode(id)) === target)
}

/** A copy of the explicit `pages` record (empty for a one-page document). */
function record(store: PageReader): PageRecord {
  const raw = store.toHeader().pages as PageRecord | undefined
  return raw ? { ...raw } : {}
}

/** Ops giving every root that resolves to `pageId` through the fallback an explicit `page`. */
function stampOps(store: PageReader, pageId: string): Op[] {
  const pages = store.toHeader().pages as PageRecord | undefined
  const ops: Op[] = []
  for (const id of pageRoots(store, null)) {
    const n = store.getNode(id)
    const p = n?.page
    if (typeof p === "string" && pages && Object.hasOwn(pages, p)) continue
    ops.push({ op: "update", id, set: { page: pageId } })
  }
  return ops
}

/** Next free "Page N" name. */
export function nextPageName(store: PageReader): string {
  const names = new Set(pagesOf(store).map((p) => p.name))
  let n = pagesOf(store).length + 1
  while (names.has(`Page ${n}`)) n++
  return `Page ${n}`
}

export interface PageEdit {
  ops: Op[]
  /** The page the edit created or affected. */
  pageId: string
}

/**
 * Appends a page (or inserts it after `after`). A one-page document without `pages` first gets
 * an explicit entry for its implicit page ("Page 1") holding the existing roots.
 */
export function addPageOps(
  store: PageReader,
  options: { name?: string; id?: string; after?: string | null } = {},
): PageEdit {
  const pages = record(store)
  const ops: Op[] = []
  let list = pagesOf(store)
  if (list[0]?.id === null) {
    const firstId = generateId()
    pages[firstId] = { order: keyBetween(null, null), name: DEFAULT_PAGE_NAME }
    ops.push(...stampOps(store, firstId))
    list = [{ id: firstId, name: DEFAULT_PAGE_NAME, order: pages[firstId].order }]
  }
  const id = options.id ?? generateId()
  const at = options.after ? list.findIndex((p) => p.id === options.after) : list.length - 1
  const prev = list[at] ?? list[list.length - 1]
  const next = list[at + 1]
  pages[id] = {
    order: keyBetween(prev?.order || null, next?.order || null),
    name: options.name ?? nextPageName(store),
  }
  ops.unshift({ op: "setHeader", set: { pages } })
  return { ops, pageId: id }
}

/** Renames a page (an empty name is refused: returns no ops). */
export function renamePageOps(store: PageReader, pageId: string, name: string): Op[] {
  const pages = record(store)
  const cur = pages[pageId]
  if (!cur || name.trim() === "" || cur.name === name) return []
  pages[pageId] = { ...cur, name }
  return [{ op: "setHeader", set: { pages } }]
}

/**
 * Moves a page to position `index` (0-based, among the pages, after removing it). Roots that
 * relied on "absent = first page" are stamped first when the first page changes.
 */
export function movePageOps(store: PageReader, pageId: string, index: number): Op[] {
  const list = pagesOf(store)
  const from = list.findIndex((p) => p.id === pageId)
  if (from < 0) return []
  const rest = list.filter((p) => p.id !== pageId)
  const i = Math.max(0, Math.min(rest.length, Math.floor(index)))
  if (i === from) return []
  const pages = record(store)
  const before = rest[i - 1]
  const after = rest[i]
  pages[pageId] = {
    ...(pages[pageId] as { order: string; name: string }),
    order: keyBetween(before?.order || null, after?.order || null),
  }
  const ops: Op[] = [{ op: "setHeader", set: { pages } }]
  const first = list[0]?.id
  if (first && (from === 0 || i === 0)) ops.push(...stampOps(store, first))
  return ops
}

/**
 * Deletes a page and every root on it (one undo step). Refused (no ops) for the only page.
 */
export function deletePageOps(store: PageReader, pageId: string): Op[] {
  const list = pagesOf(store)
  if (list.length <= 1 || !list.some((p) => p.id === pageId)) return []
  const pages = record(store)
  const ops: Op[] = []
  // Roots relying on "absent = first page" are on the first page, so deleting any other page
  // never moves them; deleting the first page deletes them with it.
  for (const id of pageRoots(store, pageId)) ops.push({ op: "delete", id })
  delete pages[pageId]
  ops.unshift({ op: "setHeader", set: { pages } })
  return ops
}

/** Moves root nodes (or nodes, which become roots) to page `pageId`, appended in order. */
export function moveToPageOps(store: PageReader, ids: readonly string[], pageId: string): Op[] {
  const ops: Op[] = []
  for (const id of ids) {
    const n = store.getNode(id)
    if (!n) continue
    if (n.parent !== null) ops.push({ op: "move", id, parent: null })
    ops.push({ op: "update", id, set: { page: pageId } })
  }
  return ops
}

/**
 * Duplicates a page: a new page right after it named `name` (default "<name> copy") holding a
 * copy of every root on it with all descendants (instance-owned nodes keep their `at`; sibling
 * order keys are kept). A prompt's `target` inside the copy points at the copied frame.
 */
export function duplicatePageOps(
  store: PageReader & Pick<DocStore, "nodeIds">,
  pageId: string | null,
  options: { name?: string; newId?: () => string } = {},
): PageEdit {
  const newId = options.newId ?? (() => generateId())
  const list = pagesOf(store)
  const src = list.find((p) => p.id === pageId) ?? (list[0] as PageInfo)
  const roots = pageRoots(store, src.id)
  const added = addPageOps(store, {
    name: options.name ?? `${src.name} copy`,
    after: src.id,
  })
  // A one-page document was materialized: the source is now its first explicit page.
  const byParent = new Map<string, string[]>()
  for (const id of store.nodeIds()) {
    const p = store.getNode(id)?.parent
    if (typeof p !== "string") continue
    const kids = byParent.get(p) ?? []
    kids.push(id)
    byParent.set(p, kids)
  }
  const map = new Map<string, string>()
  const order: string[] = []
  const visit = (id: string) => {
    map.set(id, newId())
    order.push(id)
    for (const k of byParent.get(id) ?? []) visit(k)
  }
  for (const r of roots) visit(r)
  const ops: Op[] = [...added.ops]
  for (const id of order) {
    const n = store.getNode(id)
    if (!n) continue
    const node: Record<string, unknown> = { ...n }
    const parent = typeof n.parent === "string" ? (map.get(n.parent) ?? n.parent) : null
    node.parent = parent
    if (parent === null) node.page = added.pageId
    else delete node.page
    if (n.type === "prompt" && typeof n.target === "string" && map.has(n.target))
      node.target = map.get(n.target)
    ops.push({ op: "insert", id: map.get(id) as string, node })
  }
  return { ops, pageId: added.pageId }
}

/**
 * Gives the implicit page of a one-page document an explicit entry (named `name`, default
 * "Page 1") and stamps the existing roots; no ops when the document already has pages.
 */
export function materializePageOps(store: PageReader, name: string = DEFAULT_PAGE_NAME): PageEdit {
  const first = pagesOf(store)[0] as PageInfo
  if (first.id !== null) return { ops: [], pageId: first.id }
  const id = generateId()
  return {
    ops: [
      { op: "setHeader", set: { pages: { [id]: { order: keyBetween(null, null), name } } } },
      ...stampOps(store, id),
    ],
    pageId: id,
  }
}
