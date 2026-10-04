/**
 * Board 27 §1 page commands (rules WqZ84): add, rename, reorder, duplicate, delete (always
 * confirmed; never the last page) and switch. Each edit is one undo step through the session.
 */
import {
  addPageOps,
  deletePageOps,
  duplicatePageOps,
  materializePageOps,
  movePageOps,
  pagesOf,
  renamePageOps,
} from "@kimo/editor-state"
import type { M3Controller } from "../m3/controller"
import type { FileSession } from "../session"
import { activePageId, activeRoots, pageLayerCount, rootsPerPage } from "./model"

export interface PageCommandContext {
  session: FileSession
  m3: M3Controller
}

/**
 * Switches to `id` (null = the first page): restores that page's last viewport and selection;
 * a page never visited before is zoomed to fit (when it has content).
 */
export function activatePage({ session, m3 }: PageCommandContext, id: string | null): void {
  const ui = session.ui.getState()
  if (activePageId(session.store, ui.page) === id && ui.page === id) return
  const remembered = ui.setPage(id)
  if (remembered) return
  const roots = activeRoots(session.store, id)
  if (roots.length === 0) return
  requestAnimationFrame(() => m3.canvas()?.zoomToFit())
}

/** Appends a page ("Page N" or `name`) and switches to it. Returns the new page id. */
export function addPage(ctx: PageCommandContext, name?: string): string | null {
  const { ops, pageId } = addPageOps(ctx.session.store, name ? { name } : {})
  if (!ctx.session.apply(ops, "Add page")) return null
  activatePage(ctx, pageId)
  return pageId
}

/** Renames page `id`; null names the implicit page of a one-page document (gives it an entry). */
export function renamePage(ctx: PageCommandContext, id: string | null, name: string): void {
  const store = ctx.session.store
  const ops =
    id === null
      ? name.trim()
        ? materializePageOps(store, name).ops
        : []
      : renamePageOps(store, id, name)
  if (ops.length) ctx.session.apply(ops, "Rename page")
}

/** Moves page `id` to position `index` among the pages (after removing it). */
export function movePage(ctx: PageCommandContext, id: string, index: number): void {
  const ops = movePageOps(ctx.session.store, id, index)
  if (ops.length) ctx.session.apply(ops, "Move page")
}

export function duplicatePage(ctx: PageCommandContext, id: string | null): void {
  const { ops, pageId } = duplicatePageOps(ctx.session.store, id)
  if (ctx.session.apply(ops, "Duplicate page")) activatePage(ctx, pageId)
}

/** "Its N layers are removed from this file" — the count shown by the delete confirm. */
export function pageLayers(session: FileSession, id: string | null): number {
  const roots = rootsPerPage(session.store).get(id ?? "") ?? []
  return pageLayerCount(session.store, roots)
}

/**
 * Deletes page `id` after the 400 px quick confirm (Zq3KS A7NLVt); refused for the only page.
 * When the active page goes, the page before it (else the next) becomes active.
 */
export function deletePage(ctx: PageCommandContext, id: string, confirmed: boolean): boolean {
  const store = ctx.session.store
  const list = pagesOf(store)
  if (list.length <= 1 || !confirmed) return false
  const at = list.findIndex((p) => p.id === id)
  const active = activePageId(store, ctx.session.ui.getState().page)
  const ops = deletePageOps(store, id)
  if (!ops.length || !ctx.session.apply(ops, "Delete page")) return false
  if (active === id) {
    const next = list[at - 1] ?? list[at + 1]
    activatePage(ctx, next?.id ?? null)
  }
  return true
}
