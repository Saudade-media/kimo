/**
 * Board 27 §8 (desing.pen d7gkR) editor actions on components that are not plain planner
 * commands. Pure op builders (unit-tested):
 *
 * - (d) ⌘D on a main component (rule WYOjQ "Duplicate a main"): an **instance** of the main
 *   (default), placed like any duplicate (+16/+16; auto-layout children → next sibling), or a
 *   **new component** named "<name> 2" with its props copied (targets re-pointed at the copy's
 *   layers, new id). Other selected layers duplicate as usual.
 */
import type { NodeData, Op } from "@kimo/editor-state"
import { type DocReader, isFlowChild, topLevel } from "../../canvas/commands"
import { round2 } from "../../canvas/math"
import { DUPLICATE_OFFSET, type DuplicateResult, duplicateNodesOps } from "../clipboard/structure"

type Rec = Record<string, unknown>
const isObj = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v)
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined

/** A main component (a node with `component`, incl. a derived component). */
export function isMain(n: NodeData | Readonly<Rec> | undefined): boolean {
  return !!n && n.component !== undefined && n.component !== false
}

/** The first selected top-level main, or null (⌘D then asks). */
export function selectedMain(doc: DocReader, ids: readonly string[]): string | null {
  return topLevel(doc, ids).find((id) => isMain(doc.getNode(id))) ?? null
}

export type DuplicateMainMode = "instance" | "component"

/** "<name> 2" (or the next free number among `taken`). */
export function copyName(name: string, taken: ReadonlySet<string>): string {
  const base = name.replace(/\s+\d+$/, "")
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`)) return `${base} ${i}`
}

/** Source ids of a duplicate's inserts, in op order (mirrors `duplicateNodesOps`'s walk). */
function sourceOrder(doc: DocReader, ids: readonly string[]): string[] {
  const out: string[] = []
  const kids = (src: string) => {
    const n = doc.getNode(src)
    const ats: (string | null)[] = [null]
    if (n?.type === "instance" && isObj(n.overrides))
      for (const [k, v] of Object.entries(n.overrides))
        if (isObj(v) && (v.slot === true || v.replace === true)) ats.push(k)
    for (const at of ats)
      for (const c of doc.children(src, at)) {
        if (!doc.getNode(c)) continue
        out.push(c)
        kids(c)
      }
  }
  for (const id of topLevel(doc, ids)) {
    if (!doc.getNode(id)) continue
    out.push(id)
    kids(id)
  }
  return out
}

/** Re-points a component definition's prop targets through `map` (old id → copy id). */
function remapComponent(def: unknown, root: string, newRoot: string, map: Map<string, string>) {
  return remapComponentTargets(def, (id) => (id === root ? newRoot : map.get(id)))
}

/**
 * Re-points a component definition's prop targets (`target` and enum `targets[]`): the first
 * IdPath segment goes through `to` (undefined keeps it). Used by duplicate and paste.
 */
export function remapComponentTargets(def: unknown, to: (id: string) => string | undefined) {
  if (!isObj(def) || !isObj(def.props)) return def
  const path = (p: string) => {
    const [first, ...rest] = p.split("/")
    const next = to(first as string)
    return next === undefined ? p : [next, ...rest].join("/")
  }
  const props: Rec = {}
  for (const [name, raw] of Object.entries(def.props)) {
    if (!isObj(raw)) continue
    const d: Rec = { ...raw }
    if (typeof d.target === "string") d.target = path(d.target)
    if (isObj(d.targets)) {
      const t: Rec = {}
      for (const [o, list] of Object.entries(d.targets))
        t[o] = Array.isArray(list)
          ? list.map((x) =>
              isObj(x) && typeof x.target === "string" ? { ...x, target: path(x.target) } : x,
            )
          : list
      d.targets = t
    }
    props[name] = d
  }
  return { ...def, props }
}

/**
 * ⌘D with a main in the selection. `instance`: mains become instances of themselves (other
 * layers duplicate as usual). `component`: everything duplicates; each main's copy is a new
 * component "<name> 2" whose prop targets point at its own layers.
 */
export function duplicateMainOps(
  doc: DocReader,
  ids: readonly string[],
  mode: DuplicateMainMode,
  names: ReadonlySet<string>,
  newId: () => string,
  delta: { x: number; y: number } = DUPLICATE_OFFSET,
): DuplicateResult {
  const top = topLevel(doc, ids)
  if (mode === "component") {
    const order = sourceOrder(doc, top)
    const r = duplicateNodesOps(doc, top, delta, newId)
    const map = new Map<string, string>()
    r.ops.forEach((op, i) => {
      const src = order[i]
      if (op.op === "insert" && src !== undefined && typeof op.id === "string") map.set(src, op.id)
    })
    const taken = new Set(names)
    const ops = r.ops.map((op, i) => {
      const src = order[i]
      if (op.op !== "insert" || src === undefined || !top.includes(src)) return op
      const n = doc.getNode(src)
      if (!isMain(n)) return op
      const name = copyName(typeof n?.name === "string" ? n.name : "Component", taken)
      taken.add(name)
      return {
        ...op,
        node: {
          ...op.node,
          name,
          component: remapComponent(n?.component, src, String(op.id), map),
        },
      } as Op
    })
    return { ...r, ops }
  }
  // Instance mode: mains → instances placed like a duplicate; the rest duplicates as usual.
  const plain = top.filter((id) => !isMain(doc.getNode(id)))
  const base = duplicateNodesOps(doc, plain, delta, newId)
  const ops: Op[] = [...base.ops]
  const created: string[] = []
  const pairs: [string, string][] = []
  for (const id of top) {
    const n = doc.getNode(id)
    if (!n) continue
    if (!isMain(n)) {
      const p = base.pairs.find(([s]) => s === id)
      if (p) {
        created.push(p[1])
        pairs.push(p)
      }
      continue
    }
    const parent = typeof n.parent === "string" ? n.parent : null
    const body: Rec = { type: "instance", of: id }
    if (!isFlowChild(doc, id)) {
      body.x = round2((num(n.x) ?? 0) + delta.x)
      body.y = round2((num(n.y) ?? 0) + delta.y)
    }
    if (typeof n.page === "string") body.page = n.page
    const at = typeof n.at === "string" ? n.at : null
    const copy = newId()
    const insert: Op = {
      op: "insert",
      id: copy,
      parent,
      index: doc.children(parent, at).indexOf(id) + 1,
      node: body,
    }
    if (at !== null) (insert as { at?: string }).at = at
    ops.push(insert)
    created.push(copy)
    pairs.push([id, copy])
  }
  return { ops, created, pairs }
}

export type DuplicateMainPref = "ask" | DuplicateMainMode

/** The copies an ⌥-drag moves: the clone ops, original → copy ids, and the ask alternative. */
export interface AltDragClone {
  ops: Op[]
  pairs: Map<string, string>
  /** The first selected main (the one the dialog names). */
  main: string
  /**
   * `pref === "ask"`: the drag previews instances (the default answer); these are the clone
   * ops of "As a new component" with the SAME copy root ids, so the drag's move ops replay
   * unchanged on top of either answer.
   */
  component?: Op[]
}

/**
 * Board 27 §8 (d) rule WYOjQ: ⌥-drag of a selection holding a main follows the ⌘D rule. Null
 * when no main is selected (the plain clone applies). Copies sit on the originals (delta 0);
 * the drag moves them.
 */
export function altDragCloneOps(
  doc: DocReader,
  ids: readonly string[],
  pref: DuplicateMainPref,
  names: () => ReadonlySet<string>,
  newId: () => string,
): AltDragClone | null {
  const main = selectedMain(doc, ids)
  if (!main) return null
  const zero = { x: 0, y: 0 }
  const top = topLevel(doc, ids)
  if (pref === "component") {
    const r = duplicateMainOps(doc, top, "component", names(), newId, zero)
    return { ops: r.ops, pairs: new Map(r.pairs), main }
  }
  const inst = duplicateMainOps(doc, top, "instance", new Set(), newId, zero)
  const out: AltDragClone = { ops: inst.ops, pairs: new Map(inst.pairs), main }
  if (pref === "ask") {
    const comp = duplicateMainOps(doc, top, "component", names(), newId, zero)
    // Give the component copies the instance copies' root ids (ids are unique random tokens).
    let json = JSON.stringify(comp.ops)
    for (const [src, id] of comp.pairs) {
      const to = out.pairs.get(src)
      if (to !== undefined && to !== id) json = json.split(id).join(to)
    }
    out.component = JSON.parse(json) as Op[]
  }
  return out
}
