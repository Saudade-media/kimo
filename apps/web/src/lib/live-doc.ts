/**
 * The store's document read in place: the header, and `nodes` as a read-through view of the
 * store (nothing is copied). For read-only scans and lookups; `store.toDocument()` copies every
 * node, which a large document cannot afford on each edit or selection.
 */
import type { KimoDocument } from "@kimo/core-schema"
import type { DocStore } from "@kimo/editor-state"
import { currentHeader } from "./header"

export function liveDocument(store: DocStore): KimoDocument {
  const node = (k: string | symbol) => (typeof k === "string" ? store.getNode(k) : undefined)
  const nodes = new Proxy(
    {},
    {
      get: (_t, k) => node(k),
      has: (_t, k) => node(k) !== undefined,
      ownKeys: () => store.nodeIds(),
      getOwnPropertyDescriptor: (_t, k) => {
        const value = node(k)
        return value ? { value, enumerable: true, configurable: true, writable: false } : undefined
      },
    },
  )
  return { ...currentHeader(store), nodes } as unknown as KimoDocument
}
