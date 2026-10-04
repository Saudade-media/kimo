/**
 * Pages (spec §5.6): the root `pages` table partitions the root nodes. Pure helpers shared by
 * the editor, exporters, MCP tools and agents so every consumer reads pages the same way.
 */
import { isObject } from "./json"
import { compareCodeUnits } from "./tree"

/** Display name of the implicit page of a document without `pages`. */
export const DEFAULT_PAGE_NAME = "Page 1"

/** One page, in display order. `id` is null for the implicit page of a document without pages. */
export interface PageInfo {
  id: string | null
  name: string
  order: string
}

type DocLike = { pages?: unknown; nodes?: unknown }
type NodeLike = { parent?: unknown; page?: unknown }

/** The document's pages by (`order`, then id), code-unit order. Never empty. */
export function listPages(doc: DocLike): PageInfo[] {
  const raw = isObject(doc.pages) ? doc.pages : {}
  const out: PageInfo[] = []
  for (const [id, p] of Object.entries(raw)) {
    if (!isObject(p)) continue
    out.push({
      id,
      name: typeof p.name === "string" ? p.name : "",
      order: typeof p.order === "string" ? p.order : "",
    })
  }
  out.sort((a, b) => compareCodeUnits(a.order, b.order) || compareCodeUnits(a.id ?? "", b.id ?? ""))
  if (out.length === 0) out.push({ id: null, name: DEFAULT_PAGE_NAME, order: "" })
  return out
}

/**
 * The page a root node is on: its `page` when that names a page, else the first page (null for
 * the implicit page). Non-root nodes are on their root's page; pass the root.
 */
export function pageOfRoot(doc: DocLike, node: NodeLike | undefined): string | null {
  const pages = listPages(doc)
  const first = (pages[0] as PageInfo).id
  const p = node?.page
  if (typeof p === "string" && isObject(doc.pages) && Object.hasOwn(doc.pages, p)) return p
  return first
}

/** True when the root `node` is on page `pageId` (null = the implicit / first page). */
export function isOnPage(doc: DocLike, node: NodeLike | undefined, pageId: string | null): boolean {
  return pageOfRoot(doc, node) === (pageId ?? listPages(doc)[0]?.id ?? null)
}

/** Ids of the root nodes on each page (keys: page id, or "" for the implicit page). */
export function rootsByPage(doc: DocLike): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const p of listPages(doc)) out.set(p.id ?? "", [])
  const nodes = isObject(doc.nodes) ? doc.nodes : {}
  for (const [id, n] of Object.entries(nodes)) {
    if (!isObject(n) || n.parent !== null) continue
    out.get(pageOfRoot(doc, n) ?? "")?.push(id)
  }
  return out
}
