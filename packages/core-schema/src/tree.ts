/**
 * Tree reconstruction from the flat node table (10.2 rule 3). Readers rebuild children lists
 * from `parent` (+ `at` for instance-owned nodes); siblings sort by (`order`, then id),
 * comparing by UTF-16 code unit.
 */
import { isObject } from "./json"
import type { KimoDocument } from "./schema/document"

/** Code-unit string comparison (not locale-aware). */
export function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Normative sibling order: by `order`, then by id. */
export function compareSiblings(
  a: { id: string; order: string },
  b: { id: string; order: string },
): number {
  return compareCodeUnits(a.order, b.order) || compareCodeUnits(a.id, b.id)
}

/** Returns `map.get(key)`, first storing `init()` when absent. */
export function getOrInit<K, V>(map: Map<K, V>, key: K, init: () => V): V {
  let v = map.get(key)
  if (v === undefined) {
    v = init()
    map.set(key, v)
  }
  return v
}

/** Children lists rebuilt from a document's node table. */
export interface Tree {
  /** Root node ids (`parent: null`), in sibling order. */
  roots: string[]
  /** Parent id → child ids (nodes without `at`), in sibling order. */
  children: Map<string, string[]>
  /** Instance id → `at` path → instance-owned node ids (slot content / replacements), in order. */
  owned: Map<string, Map<string, string[]>>
}

/**
 * Rebuilds children lists. Nodes whose `parent` is missing are left out (they are reported by
 * `validate()`); nodes are not checked for cycles here.
 */
export function buildTree(doc: Pick<KimoDocument, "nodes">): Tree {
  const nodes = doc.nodes as Record<string, unknown>
  const roots: { id: string; order: string }[] = []
  const children = new Map<string, { id: string; order: string }[]>()
  const owned = new Map<string, Map<string, { id: string; order: string }[]>>()
  for (const [id, n] of Object.entries(nodes)) {
    if (!isObject(n)) continue
    const entry = { id, order: typeof n.order === "string" ? n.order : "" }
    if (n.parent === null) {
      roots.push(entry)
    } else if (typeof n.parent === "string" && Object.hasOwn(nodes, n.parent)) {
      if (typeof n.at === "string") {
        const byPath = getOrInit(owned, n.parent, () => new Map())
        getOrInit(byPath, n.at, () => []).push(entry)
      } else {
        getOrInit(children, n.parent, () => []).push(entry)
      }
    }
  }
  const ids = (l: { id: string; order: string }[]) => l.sort(compareSiblings).map((e) => e.id)
  return {
    roots: ids(roots),
    children: new Map([...children].map(([k, l]) => [k, ids(l)])),
    owned: new Map([...owned].map(([k, m]) => [k, new Map([...m].map(([p, l]) => [p, ids(l)]))])),
  }
}
