import type { DocStore } from "@kimo/editor-state"
import type { WorldData } from "./session"

interface LayoutLike {
  nodes: ReadonlyMap<string, { world?: { x: number; y: number; w: number; h: number } }>
}

/** Max nodes a script can read with Get (a larger document is cut, deepest last). */
export const WORLD_MAX_NODES = 20_000

/**
 * The document for Get / Children: every node's fields, `id`, `parent` (null at the top level),
 * `children` ids and its laid-out `box` (page space), as it is now. Taken once per script, so the
 * streamed statements and the call that commits them read the same values.
 */
export function snapshotWorld(store: DocStore, layout: LayoutLike | null | undefined): WorldData {
  const nodes: WorldData = {}
  let count = 0
  const queue: (string | null)[] = [null]
  while (queue.length && count < WORLD_MAX_NODES) {
    const parent = queue.shift() as string | null
    for (const id of store.children(parent)) {
      if (count >= WORLD_MAX_NODES) break
      const n = store.getNode(id) as Record<string, unknown> | undefined
      if (!n) continue
      const b = layout?.nodes.get(id)?.world
      const kids = store.children(id)
      nodes[id] = JSON.parse(
        JSON.stringify({
          ...n,
          id,
          parent,
          children: kids,
          ...(b ? { box: { x: b.x, y: b.y, w: b.w, h: b.h } } : {}),
        }),
      ) as Record<string, unknown>
      count++
      queue.push(id)
    }
  }
  return nodes
}
