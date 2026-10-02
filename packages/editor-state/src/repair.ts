/**
 * Post-merge tree repair (teardown 9.2 "Tree moves on Yjs", ADR 0003 §4).
 *
 * The op layer rejects local moves that would create a cycle, but two concurrent moves (or a
 * git merge) can still produce one. The normative rule: within each cycle, the node whose move
 * has the later timestamp (ties: larger id) is reparented to its previous parent — or to the
 * root if that parent is also in the cycle (or would lead back into it). Nodes whose parent no
 * longer exists (a concurrent delete) are moved to the root.
 *
 * {@link planTreeRepairs} is pure and deterministic, so every replica (and the merge driver)
 * computes the same repairs from the same state and the repair writes converge.
 */
import { compareCodeUnits } from "@kimo/core-schema"

/** The tree fields of a node. */
export interface TreeFields {
  readonly parent: string | null
  readonly at?: string
  readonly order: string
}

/** Metadata recorded for the last reparenting move of a node. */
export interface MoveRecord {
  /** Wall-clock time of the move (ms). */
  readonly t: number
  /** Parent before the move. */
  readonly prevParent: string | null
  readonly prevAt?: string
  readonly prevOrder: string
}

/** One repair: set the node's tree fields to these values. */
export interface TreeRepair {
  id: string
  kind: "cycle" | "orphan"
  parent: string | null
  at?: string
  order: string
}

/**
 * Plans the repairs that make the parent graph a forest. Does not mutate its inputs.
 *
 * @param nodes id → tree fields of every node.
 * @param moves id → last move record (absent = never moved; timestamp 0).
 */
export function planTreeRepairs(
  nodes: ReadonlyMap<string, TreeFields>,
  moves: ReadonlyMap<string, MoveRecord> = new Map(),
): TreeRepair[] {
  const current = new Map<string, TreeFields>(nodes)
  const repairs: TreeRepair[] = []
  const ids = [...current.keys()].sort(compareCodeUnits)
  const set = (r: TreeRepair) => {
    repairs.push(r)
    current.set(r.id, r.at === undefined ? { parent: r.parent, order: r.order } : r)
  }

  for (const id of ids) {
    const n = current.get(id) as TreeFields
    if (n.parent !== null && !current.has(n.parent)) {
      set({ id, kind: "orphan", parent: null, order: n.order })
    }
  }

  const parentOf = (id: string) => current.get(id)?.parent ?? null
  /** True when walking up from `start` reaches `target` (visited-set guarded). */
  const reaches = (start: string | null, target: string): boolean => {
    const seen = new Set<string>()
    for (let p = start; p !== null && !seen.has(p); p = parentOf(p)) {
      if (p === target) return true
      seen.add(p)
    }
    return false
  }

  // Each iteration breaks one cycle without creating another, so this terminates.
  for (let guard = 0; guard <= ids.length; guard++) {
    const cycle = findCycle(ids, parentOf)
    if (!cycle) break
    const inCycle = new Set(cycle)
    let victim = cycle[0] as string
    for (const id of cycle) {
      const t = moves.get(id)?.t ?? 0
      const tv = moves.get(victim)?.t ?? 0
      if (t > tv || (t === tv && compareCodeUnits(id, victim) > 0)) victim = id
    }
    const rec = moves.get(victim)
    const n = current.get(victim) as TreeFields
    const prev = rec?.prevParent ?? null
    // Back to the previous position when it is still a valid one: the root (always), or a
    // live parent outside the cycle that does not descend from the victim.
    const prevValid =
      rec !== undefined &&
      (prev === null || (current.has(prev) && !inCycle.has(prev) && !reaches(prev, victim)))
    if (rec && prevValid) {
      const r: TreeRepair = { id: victim, kind: "cycle", parent: prev, order: rec.prevOrder }
      if (prev !== null && rec.prevAt !== undefined) r.at = rec.prevAt
      set(r)
    } else {
      set({ id: victim, kind: "cycle", parent: null, order: n.order })
    }
  }
  return repairs
}

/** Finds one parent cycle (members in walk order), scanning ids in the given order. */
function findCycle(
  ids: readonly string[],
  parentOf: (id: string) => string | null,
): string[] | null {
  const state = new Map<string, 1 | 2>() // 1 = on current path, 2 = done
  for (const start of ids) {
    if (state.has(start)) continue
    const path: string[] = []
    let p: string | null = start
    while (p !== null && !state.has(p)) {
      state.set(p, 1)
      path.push(p)
      p = parentOf(p)
    }
    if (p !== null && state.get(p) === 1) {
      return path.slice(path.indexOf(p))
    }
    for (const q of path) state.set(q, 2)
  }
  return null
}
