/**
 * Turns a document change into `editor-state` ops, so a conflict pick (core-schema
 * `applyConflictSide` / `applyAllConflicts` / `finishMerge`, the reference semantics) runs as
 * ONE undoable op group through `store.apply`.
 */
import { isObject, jsonEqual, type KimoDocument } from "@kimo/core-schema"
import { HEADER_OP_KEYS, type HeaderOpKey, type Op } from "@kimo/editor-state"

type Obj = Record<string, unknown>
const PLACEMENT = new Set(["type", "parent", "order", "at"])
const rec = (v: unknown): Obj => (isObject(v) ? v : {})

/** Depth of `id` in `nodes` (parent links; cycles stop). */
function depthOf(nodes: Obj, id: string): number {
  let d = 0
  const seen = new Set<string>()
  for (let p = rec(nodes[id]).parent; typeof p === "string" && !seen.has(p); d++) {
    seen.add(p)
    p = rec(nodes[p]).parent
  }
  return d
}

function descendants(nodes: Obj, root: string): string[] {
  const out: string[] = []
  const kids = new Map<string, string[]>()
  for (const [id, n] of Object.entries(nodes)) {
    const p = rec(n).parent
    if (typeof p === "string") kids.set(p, [...(kids.get(p) ?? []), id])
  }
  const stack = [root]
  const seen = new Set(stack)
  while (stack.length > 0) {
    for (const c of kids.get(stack.pop() as string) ?? [])
      if (!seen.has(c)) {
        seen.add(c)
        out.push(c)
        stack.push(c)
      }
  }
  return out
}

/** Ops that turn `cur` into `next` (header, themes, variables, nodes). */
export function diffOps(cur: KimoDocument, next: KimoDocument): Op[] {
  const c = cur as unknown as Obj
  const n = next as unknown as Obj
  const ops: Op[] = []

  const hSet: Partial<Record<HeaderOpKey, unknown>> = {}
  const hUnset: HeaderOpKey[] = []
  for (const k of HEADER_OP_KEYS) {
    if (jsonEqual(c[k], n[k])) continue
    if (n[k] === undefined) hUnset.push(k)
    else hSet[k] = n[k]
  }
  if (Object.keys(hSet).length > 0 || hUnset.length > 0)
    ops.push({ op: "setHeader", set: hSet, unset: hUnset })

  const diffRecord = (a: Obj, b: Obj) => {
    const set: Obj = {}
    const unset: string[] = []
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (jsonEqual(a[k], b[k])) continue
      if (Object.hasOwn(b, k)) set[k] = b[k]
      else unset.push(k)
    }
    return { set, unset, empty: Object.keys(set).length === 0 && unset.length === 0 }
  }
  const themes = diffRecord(rec(c.themes), rec(n.themes))
  if (!themes.empty)
    ops.push({
      op: "setThemes",
      set: themes.set as Record<string, string[]>,
      unset: themes.unset,
    })
  const vars = diffRecord(rec(c.variables), rec(n.variables))
  if (!vars.empty) ops.push({ op: "setVariables", set: vars.set as never, unset: vars.unset })

  const cn = rec(c.nodes)
  const nn = rec(n.nodes)
  // A type change is a delete + insert of the node and its subtree.
  const retyped = new Set<string>()
  for (const id of Object.keys(cn))
    if (Object.hasOwn(nn, id) && rec(cn[id]).type !== rec(nn[id]).type) {
      retyped.add(id)
      for (const d of descendants(cn, id)) retyped.add(d)
    }
  for (const id of retyped)
    if (!retyped.has(String(rec(cn[id]).parent))) ops.push({ op: "delete", id })

  const added = Object.keys(nn).filter((id) => !Object.hasOwn(cn, id) || retyped.has(id))
  added.sort((a, b) => depthOf(nn, a) - depthOf(nn, b) || (a < b ? -1 : a > b ? 1 : 0))
  for (const id of added) ops.push({ op: "insert", id, node: nn[id] as Obj })

  for (const id of Object.keys(nn)) {
    if (!Object.hasOwn(cn, id) || retyped.has(id)) continue
    const a = rec(cn[id])
    const b = rec(nn[id])
    if (a.parent !== b.parent || a.order !== b.order || a.at !== b.at) {
      ops.push({
        op: "move",
        id,
        parent: (b.parent as string | null) ?? null,
        order: b.order as string,
        at: (b.at as string | undefined) ?? null,
      })
    }
    const set: Obj = {}
    const unset: string[] = []
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (PLACEMENT.has(k) || jsonEqual(a[k], b[k])) continue
      if (Object.hasOwn(b, k)) set[k] = b[k]
      else unset.push(k)
    }
    if (Object.keys(set).length > 0 || unset.length > 0) ops.push({ op: "update", id, set, unset })
  }

  // Deletions last (after moves out of deleted parents), topmost only: delete takes the subtree.
  const removed = new Set(Object.keys(cn).filter((id) => !Object.hasOwn(nn, id)))
  for (const id of removed)
    if (!removed.has(String(rec(cn[id]).parent)) && !retyped.has(id)) ops.push({ op: "delete", id })
  return ops
}
