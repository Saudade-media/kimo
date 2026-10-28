/**
 * Component drop resolution (board 13 drop rules; canvas contract `ComponentDropTarget`):
 * - over an instance's slot frame (or its content) → insert into the slot;
 * - over any other instance descendant → replace it (⌥ drops beside the instance instead);
 * - over a regular frame → insert into it; else onto the page.
 * Pure: unit-tested in test/m3-drop.test.ts.
 */
import type { ComponentDropTarget } from "../../canvas/contract"

type Rec = Readonly<Record<string, unknown>>

interface DropView {
  getNode(id: string): Rec | undefined
  isVirtual(id: string): boolean
  locate(id: string): { real: string; instance?: string; path?: string } | null
  origin(id: string): { owned?: { instance: string; at: string }; instance?: unknown } | null
  children(parent: string | null): readonly string[]
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)
const nameOf = (n: Rec | undefined) =>
  n && typeof n.name === "string" && n.name ? n.name : String(n?.type ?? "layer")

/** Where a dragged component lands for view ids under the pointer (top-most first). */
export function resolveComponentDrop(
  view: DropView,
  hits: readonly string[],
  alt: boolean,
): ComponentDropTarget | null {
  const top = hits[0]
  if (top !== undefined && !alt) {
    // Walk up from the hit: the first slot frame inside an instance wins; otherwise the hit
    // itself (inside an instance) is replaced.
    let cur: string | null = top
    let firstVirtual: string | null = null
    for (let guard = 0; cur !== null && guard < 256; guard++) {
      const n = view.getNode(cur)
      if (!n) break
      const virtual = view.isVirtual(cur)
      const owned = view.origin(cur)?.owned
      if (virtual && firstVirtual === null) firstVirtual = cur
      if (virtual && n.type === "frame" && isObj(n.slot)) {
        const loc = view.locate(cur)
        if (loc?.instance && loc.path !== undefined) {
          const count = view.children(cur).length
          const inst = view.getNode(loc.instance)
          return {
            kind: "slot",
            instance: loc.instance,
            path: loc.path,
            index: count,
            label: `Insert into ${nameOf(n)} · slot · ${count + 1} of ${count + 1}${inst ? "" : ""}`,
          }
        }
      }
      if (!virtual && !owned) break
      cur = typeof n.parent === "string" ? n.parent : null
    }
    if (firstVirtual !== null) {
      const loc = view.locate(firstVirtual)
      if (loc?.instance && loc.path !== undefined)
        return {
          kind: "replace",
          instance: loc.instance,
          path: loc.path,
          label: `Replace ${nameOf(view.getNode(firstVirtual))} in ${nameOf(view.getNode(loc.instance))}`,
        }
    }
  }
  // A regular frame: the deepest real frame under the pointer outside instances.
  for (const id of hits) {
    if (view.isVirtual(id) || view.origin(id)?.owned) continue
    const n = view.getNode(id)
    if (n?.type !== "frame" || view.origin(id)?.instance) continue
    const count = view.children(id).length
    return {
      kind: "frame",
      parent: id,
      index: count,
      label: `Insert into ${nameOf(n)} · ${count + 1} of ${count + 1}`,
    }
  }
  return { kind: "frame", parent: null, index: -1, label: "Place on the page" }
}
