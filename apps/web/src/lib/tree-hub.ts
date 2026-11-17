/**
 * The shape of a store's layer tree, tracked from its change events: a token for the whole
 * tree and one per root. No React: `useTreeRevision` (hooks.ts) subscribes to it.
 */
import type { DocStore } from "@kimo/editor-state"

export interface TreeHub {
  rev: number
  sigs: Map<string, string>
  listeners: Set<() => void>
  /** `rev` of the last full scan (creation, document load). */
  scanned: number
  /** Per root: `rev` of the last shape change inside its subtree since that scan. */
  roots: Map<string, number>
}
const treeHubs = new WeakMap<DocStore, TreeHub>()

function treeSig(store: DocStore, id: string): string {
  const n = store.getNode(id)
  if (!n) return ""
  // M3: whether it is a main and what an instance points at (canvas labels, layer glyphs).
  const main = n.component !== undefined && n.component !== false ? "C" : ""
  // Board 27 §1: a root's page (spec §5.6) decides which page tree it is listed in.
  // Joined, not concatenated: one flat string per node instead of a chain of string pieces.
  return [
    String(n.parent),
    String(n.order),
    String(n.at),
    String(n.name),
    main,
    typeof n.of === "string" ? n.of : "",
    typeof n.page === "string" ? n.page : "",
  ].join("\u0000")
}

export function treeHubFor(store: DocStore): TreeHub {
  let hub = treeHubs.get(store)
  if (!hub) {
    const h: TreeHub = {
      rev: 0,
      sigs: new Map(),
      listeners: new Set(),
      scanned: 0,
      roots: new Map(),
    }
    const scan = () => {
      h.sigs.clear()
      h.roots.clear()
      for (const id of store.nodeIds()) h.sigs.set(id, treeSig(store, id))
    }
    scan()
    /** The root `id` sat under before this change, read from the signatures not yet updated. */
    const rootBefore = (id: string): string | null => {
      if (!h.sigs.has(id)) return null
      let cur = id
      for (let depth = 0; depth < 1024; depth++) {
        const sig = h.sigs.get(cur) as string
        const parent = sig.slice(0, sig.indexOf("\u0000"))
        if (!h.sigs.has(parent)) return cur
        cur = parent
      }
      return cur
    }
    const rootNow = (id: string): string | null => {
      let cur = id
      for (let depth = 0; depth < 1024; depth++) {
        const parent = store.getNode(cur)?.parent
        if (typeof parent !== "string" || !store.getNode(parent)) break
        cur = parent
      }
      return store.getNode(cur) ? cur : null
    }
    store.onChange((c) => {
      let changed = false
      if (c.cause === "load") {
        scan()
        h.scanned = h.rev + 1
        changed = true
      } else {
        const diff: [id: string, next: string][] = []
        const touched = new Set<string>()
        for (const id of c.nodes) {
          const next = treeSig(store, id)
          if (next === (h.sigs.get(id) ?? "")) continue
          diff.push([id, next])
          // Before any signature is replaced: a removed subtree is still walked to its root.
          const before = rootBefore(id)
          if (before !== null) touched.add(before)
        }
        for (const [id, next] of diff) {
          if (next) h.sigs.set(id, next)
          else h.sigs.delete(id)
          const now = rootNow(id)
          if (now !== null) touched.add(now)
        }
        changed = diff.length > 0
        for (const root of touched) {
          if (store.getNode(root)) h.roots.set(root, h.rev + 1)
          else h.roots.delete(root)
        }
      }
      if (!changed) return
      h.rev++
      for (const cb of [...h.listeners]) cb()
    })
    hub = h
    treeHubs.set(store, h)
  }
  return hub
}

/**
 * A token for the shape of one root's subtree: it changes when a node is added to or removed
 * from it, or moved, renamed or reordered inside it (see {@link useTreeRevision}). What is
 * derived from one root's subtree (its layer count) is kept while its token stays.
 */
export function rootShapeRev(store: DocStore, root: string): number {
  const hub = treeHubFor(store)
  return hub.roots.get(root) ?? hub.scanned
}
