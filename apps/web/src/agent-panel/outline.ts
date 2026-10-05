/**
 * Board 31 token pass: the page outline of the turn context, read from the window's store and
 * layout (`buildPageOutline` in `@kimo/ai-agent` does the formatting and the size budget).
 */
import { buildPageOutline, type OutlineBox, type OutlineSource } from "@kimo/ai-agent"
import { type DocStore, pageRoots } from "@kimo/editor-state"

export interface StoreOutlineOptions {
  /** The active page (null = the first / implicit page). */
  pageId?: () => string | null
  /** Laid-out box in canvas space (the canvas layout's `world`), when known. */
  box?: (id: string) => OutlineBox | null | undefined
}

export function storeOutlineSource(
  store: Pick<DocStore, "toHeader" | "children" | "getNode">,
  o: StoreOutlineOptions = {},
): OutlineSource {
  return {
    roots: () => pageRoots(store, o.pageId?.() ?? null),
    children: (id) => store.children(id),
    node: (id) => store.getNode(id) as Readonly<Record<string, unknown>> | undefined,
    ...(o.box ? { box: o.box } : {}),
  }
}

/** The outline for `selection` on the active page, or null for an empty page. */
export function storeOutline(
  store: Pick<DocStore, "toHeader" | "children" | "getNode">,
  selection: readonly string[],
  o: StoreOutlineOptions = {},
): string | null {
  return buildPageOutline(storeOutlineSource(store, o), { selection })
}
