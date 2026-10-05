/**
 * Deleting a layer that contains a main component other layers still instantiate would leave
 * those instances pointing at nothing (`REF_MISSING`), and the store refuses the whole delete.
 * This finds the instances outside the deleted subtrees so the caller can detach them first.
 *
 * Pure: unit-tested in test/delete-deps.test.ts.
 */
import type { Op } from "@kimo/editor-state"

type Node = {
  parent?: string | null
  type?: string
  component?: boolean
  of?: string
  name?: string
}

export interface DeleteDeps {
  /** Instances outside the deleted subtrees whose main component is being deleted. */
  instances: string[]
  /** Names of the components going away (for the toast). */
  components: string[]
}

/** Ids of every real (non-composite) delete op in `ops`. */
export function deletedRoots(ops: readonly Op[]): string[] {
  return ops.flatMap((o) => (o.op === "delete" ? [o.id] : []))
}

export function deleteDependents(
  nodes: Record<string, Node | undefined>,
  roots: readonly string[],
): DeleteDeps {
  const out: DeleteDeps = { instances: [], components: [] }
  if (roots.length === 0) return out
  const rootSet = new Set(roots)
  const inside = (id: string): boolean => {
    for (let cur: string | null | undefined = id, n = 0; cur && n < 10_000; n++) {
      if (rootSet.has(cur)) return true
      cur = nodes[cur]?.parent
    }
    return false
  }
  const gone = new Set<string>()
  for (const id of Object.keys(nodes)) {
    if (nodes[id]?.component === true && inside(id)) {
      gone.add(id)
      out.components.push(nodes[id]?.name ?? id)
    }
  }
  if (gone.size === 0) return out
  for (const id of Object.keys(nodes)) {
    const n = nodes[id]
    if (n?.type === "instance" && typeof n.of === "string" && gone.has(n.of) && !inside(id))
      out.instances.push(id)
  }
  return out
}
