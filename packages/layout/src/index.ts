/**
 * @kimo/layout — the `LayoutEngine` contract and its Yoga implementation (ADR 0004, ADR 0009).
 * Contracts live in ./types; the helpers below (node sources, resolver, text resolution) are
 * shared by layout and renderer so both read the document identically.
 */
import { isObject, type KimoDocument } from "@kimo/core-schema"
import type { LayoutNodeData, NodeSource } from "./types"

export {
  type AgentNodeChrome,
  type AgentNodeType,
  agentNodeBodyBox,
  agentNodeChrome,
  NOTE_CHROME,
  PROMPT_CHROME,
} from "./agent-nodes"
export { createLayoutEngine } from "./engine"

export {
  createInstanceView,
  type ExpandedNodeSource,
  type ExpandOptions,
  expandInstances,
  type InstanceView,
  isExpandedView,
  isInstanceView,
} from "./expand"
export { pathBounds } from "./geometry"
export {
  createResolver,
  paintOnlyHeaderChange,
  type ResolverOptions,
  resolveText,
  resolveTextStyle,
} from "./resolve"
export * from "./types"

// --- Node sources -------------------------------------------------------------------------

/**
 * A {@link NodeSource} over a plain document (headless/CLI/tests). A `DocStore` already
 * satisfies `NodeSource` structurally (`getNode`, `children`).
 */
export function nodeSourceFromDocument(doc: Pick<KimoDocument, "nodes">): NodeSource {
  const nodes = doc.nodes as Record<string, LayoutNodeData>
  const children = new Map<string | null, string[]>()
  const owned = new Map<string, string[]>()
  for (const [id, n] of Object.entries(nodes)) {
    if (!isObject(n)) continue
    const p = n.parent
    if (p !== null && !Object.hasOwn(nodes, p)) continue
    let list: string[] | undefined
    if (typeof n.at === "string") {
      if (p === null) continue
      const k = `${p}\u0000${n.at}`
      list = owned.get(k)
      if (!list) {
        list = []
        owned.set(k, list)
      }
    } else {
      list = children.get(p)
      if (!list) {
        list = []
        children.set(p, list)
      }
    }
    list.push(id)
  }
  const key = (id: string) => (nodes[id] as LayoutNodeData).order
  for (const lists of [children.values(), owned.values()])
    for (const list of lists)
      list.sort((a, b) => {
        const ka = key(a)
        const kb = key(b)
        return ka < kb ? -1 : ka > kb ? 1 : a < b ? -1 : a > b ? 1 : 0
      })
  return {
    getNode: (id) => (Object.hasOwn(nodes, id) ? nodes[id] : undefined),
    children: (parent, at) =>
      at == null
        ? (children.get(parent) ?? [])
        : parent === null
          ? []
          : (owned.get(`${parent}\u0000${at}`) ?? []),
  }
}
