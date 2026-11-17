/**
 * The ids of a store's main components, kept current from its change events: counting them
 * does not scan the document (file stats are refreshed after every edit burst).
 */
import { isComponentNode } from "@kimo/core-schema"
import type { DocStore } from "@kimo/editor-state"

const indexes = new WeakMap<DocStore, Set<string>>()

export function componentIds(store: DocStore): ReadonlySet<string> {
  let ids = indexes.get(store)
  if (!ids) {
    const set = new Set<string>()
    const scan = () => {
      set.clear()
      for (const id of store.nodeIds()) if (isComponentNode(store.getNode(id))) set.add(id)
    }
    scan()
    store.onChange((c) => {
      if (c.cause === "load") {
        scan()
        return
      }
      for (const id of c.nodes) {
        if (isComponentNode(store.getNode(id))) set.add(id)
        else set.delete(id)
      }
    })
    ids = set
    indexes.set(store, set)
  }
  return ids
}
