/**
 * A store's document without a copy of its node table. `store.toDocument()` copies every
 * node, which a very large document has no room for on a save or a scan.
 */
import { type KimoDocument, serializeParts } from "@kimo/core-schema"
import type { DocStore } from "./types"

type Source = Pick<DocStore, "toHeader" | "getNode" | "nodeIds">

/**
 * The document read in place: the header as data, `nodes` as a read-through view of the
 * store. For read-only use; it follows later edits.
 */
export function documentView(store: Source): KimoDocument {
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
  return { ...store.toHeader(), nodes } as unknown as KimoDocument
}

/**
 * The canonical text of the store's document, the same as `serialize(store.toDocument())`,
 * written node by node. `prepare` may replace header members (it gets a {@link documentView});
 * the nodes written are the store's.
 */
export function documentText(store: Source, prepare?: (doc: KimoDocument) => KimoDocument): string {
  const view = documentView(store)
  const { nodes: _nodes, ...header } = (prepare ? prepare(view) : view) as unknown as Record<
    string,
    unknown
  >
  let text = ""
  for (const part of serializeParts(header, store.nodeIds(), (id) => store.getNode(id)))
    text += part
  return text
}
