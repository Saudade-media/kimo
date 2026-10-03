/**
 * The semantic three-way merge (spec §21.4 rule 6, ADR 0012): `kimo merge`, the file watcher's
 * merge with local edits and git "Keep my edits" all run {@link mergeDocuments}.
 *
 * - Header members, variables and nodes merge independently. Nodes merge per property, by JSON
 *   Pointer into structs; records (`overrides`, `args`, `props`, `imports`, `theme`, `meta`,
 *   `component.props`, …) merge per key; arrays, bindings (`$ref`), color literals and objects
 *   whose discriminant (`kind`, `mode`, `type`, `space`) or override tag differs are atomic.
 * - A change on one side wins; equal changes on both sides are not conflicts; different changes
 *   become stored conflicts (§21.2) and the body holds `ours`, except delete vs edit, where it
 *   holds the edited side and the entry's `restored` snapshots.
 * - Placement (`parent`, `order`, `at`) merges as one unit (`move`). After merging, parent
 *   cycles are repaired per teardown 9.2: the moved node with the larger id (files carry no move
 *   timestamps, so every move ties) returns to its base placement, or to the root. The repair is
 *   reported in `repairs` and, when the node exists on all three sides, stored as a `move`
 *   conflict whose body holds `base`, so no side is dropped silently.
 * - Orphans whose parent was deleted on the other side become `node` conflicts on the parent
 *   with the orphans (and the parent's whole kept subtree) in `restored`. Variables and
 *   components deleted on one side but still referenced by the merged body are kept the same
 *   way. Asset manifests merge add-only.
 * - The result validates. If the combined edits still break a cross-node rule, the merge falls
 *   back to holding `ours` everywhere and storing every change of `theirs` as an open conflict.
 *
 * Output is deterministic: no clocks, no randomness; conflict ids are derived from the target
 * unless `options.newId` is given.
 */
import { jsonEqual, stripDefaults } from "../defaults-ops"
import { escapePointer, isObject, setOwn } from "../json"
import { isThemedValue } from "../resolve"
import type { KimoDocument } from "../schema/document"
import type { Conflict, MergeInfo, Placement } from "../schema/merge"
import { compareCodeUnits } from "../tree"
import { type ValidateOptions, validate } from "../validate/index"
import {
  attachConflicts,
  conflictTargetKey,
  conflictTargetsOverlap,
  MERGE_FEATURE,
} from "./conflicts"
import type {
  CycleRepair,
  ThreeWayMerge,
  ThreeWayMergeInput,
  ThreeWayMergeOptions,
  ThreeWayMergeResult,
} from "./types"

/** Options of {@link mergeDocuments}: the contract's options plus validation context. */
export interface MergeDocumentsOptions extends ThreeWayMergeOptions {
  /** Passed to `validate` when checking the result (imported libraries, asset files). */
  validate?: Omit<ValidateOptions, "lints" | "nodes">
}

type Obj = Record<string, unknown>
type Side = "ours" | "theirs"

/** "Absent on this side". JSON has no `undefined`, so absence is its own value here. */
const ABSENT: unique symbol = Symbol("absent")

const get = (o: unknown, k: string): unknown => (isObject(o) && Object.hasOwn(o, k) ? o[k] : ABSENT)
const eq = (a: unknown, b: unknown): boolean =>
  a === ABSENT || b === ABSENT ? a === b : jsonEqual(a, b)
const clone = <T>(v: T): T => (v === ABSENT || v === undefined ? v : JSON.parse(JSON.stringify(v)))
const ptr = (tokens: readonly string[]) => tokens.map((t) => `/${escapePointer(t)}`).join("")
const byCode = (a: string, b: string) => compareCodeUnits(a, b)

/** Keys of `o` in order, then keys only in `t`. */
function unionKeys(...objs: unknown[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const o of objs)
    if (isObject(o))
      for (const k of Object.keys(o))
        if (!seen.has(k)) {
          seen.add(k)
          out.push(k)
        }
  return out
}

/** Sets the present sides of a conflict entry (a missing key means "absent on that side"). */
function withSides(c: Obj, b: unknown, o: unknown, t: unknown): Obj {
  if (b !== ABSENT) c.base = clone(b)
  if (o !== ABSENT) c.ours = clone(o)
  if (t !== ABSENT) c.theirs = clone(t)
  return c
}

// --- Value merge ------------------------------------------------------------------------------

/** How deep a value merges: struct (per key, recursively), opaque record (per key), atomic. */
type Mode = "struct" | "opaque" | "atomic"

/** Records whose values are opaque data (Appendix B): merged per key, values atomic. */
const OPAQUE_RECORDS = new Set(["meta", "args", "inputs", "uniforms", "options"])
/** Keys that select a union member: objects that disagree on one are atomic. */
const DISCRIMINANTS = ["kind", "mode", "type", "space"] as const
/** Override tags (§9.3): an override is exactly one of these. */
const OVERRIDE_TAGS = ["set", "slot", "replace"] as const

const childMode = (parent: Mode, key: string): Mode =>
  parent === "opaque" ? "atomic" : OPAQUE_RECORDS.has(key) ? "opaque" : "struct"

function recursable(tokens: readonly string[], b: unknown, o: unknown, t: unknown, mode: Mode) {
  if (mode === "atomic" || !isObject(o) || !isObject(t)) return false
  if (mode === "opaque") return true
  const objs: Obj[] = [o, t]
  if (isObject(b)) objs.push(b)
  if (objs.some((x) => Object.hasOwn(x, "$ref") || Object.hasOwn(x, "space"))) return false
  for (const d of DISCRIMINANTS) {
    const first = objs[0]?.[d]
    if (!objs.every((x) => jsonEqual(x[d], first))) return false
  }
  if (tokens.length >= 2 && tokens[tokens.length - 2] === "overrides") {
    const tag = (x: Obj) => OVERRIDE_TAGS.filter((k) => Object.hasOwn(x, k)).join(",")
    const first = tag(o)
    if (!objs.every((x) => tag(x) === first)) return false
  }
  return true
}

interface Counter {
  changes: number
  /** Fallback mode: a change of `theirs` alone is stored as a conflict instead of applied. */
  strict: boolean
}

type OnConflict = (tokens: string[], b: unknown, o: unknown, t: unknown) => void

/**
 * Merges one value. Returns the merged value (ours on conflict) or {@link ABSENT}; reports each
 * conflicting pointer to `onConflict`.
 */
function mergeValue(
  tokens: string[],
  b: unknown,
  o: unknown,
  t: unknown,
  mode: Mode,
  ctr: Counter,
  onConflict: OnConflict,
): unknown {
  if (eq(o, t)) {
    if (!eq(o, b)) ctr.changes++
    return o
  }
  if (eq(t, b)) {
    ctr.changes++
    return o
  }
  if (eq(o, b) && !ctr.strict) {
    ctr.changes++
    return t
  }
  if (recursable(tokens, b, o, t, mode)) {
    const out: Obj = {}
    for (const k of unionKeys(o, t)) {
      const v = mergeValue(
        [...tokens, k],
        get(b, k),
        get(o, k),
        get(t, k),
        childMode(mode, k),
        ctr,
        onConflict,
      )
      if (v !== ABSENT) setOwn(out, k, clone(v))
    }
    return out
  }
  onConflict(tokens, b, o, t)
  return o
}

// --- Nodes --------------------------------------------------------------------------------------

const PLACEMENT_KEYS = new Set(["type", "parent", "order", "at"])

function placementOf(n: unknown): Placement | typeof ABSENT {
  if (!isObject(n)) return ABSENT
  const p: Obj = { parent: n.parent ?? null, order: n.order }
  if (n.at !== undefined) p.at = n.at
  return p as unknown as Placement
}

function setPlacement(n: Obj, p: Placement): void {
  n.parent = p.parent
  n.order = p.order
  if (p.at !== undefined) n.at = p.at
  else delete n.at
}

const parentOf = (n: unknown): string | null =>
  isObject(n) && typeof n.parent === "string" ? n.parent : null

/** Child ids by parent id. */
function childIndex(nodes: Obj): Map<string, string[]> {
  const kids = new Map<string, string[]>()
  for (const [id, n] of Object.entries(nodes)) {
    const p = parentOf(n)
    if (p === null) continue
    const list = kids.get(p)
    if (list) list.push(id)
    else kids.set(p, [id])
  }
  return kids
}

/** Every node below `root` (by `parent` links), excluding `root`, in a stable order. */
function descendantsOf(nodes: Obj, root: string): string[] {
  const kids = childIndex(nodes)
  const out: string[] = []
  const seen = new Set<string>([root])
  const stack = [root]
  while (stack.length > 0) {
    const cur = stack.pop() as string
    for (const c of (kids.get(cur) ?? []).sort(byCode)) {
      if (seen.has(c)) continue
      seen.add(c)
      out.push(c)
      stack.push(c)
    }
  }
  return out
}

const nodeTable = (d: unknown): Obj => (isObject(d) && isObject(d.nodes) ? d.nodes : {})

/** A kept node that one side deleted (delete vs edit, orphan parent, referenced component). */
interface KeepRequest {
  node: string
  side: Side
  /** Ancestors put back because the deleting side removed them. */
  ancestors: string[]
}

/** A pending conflict (ids are assigned once every conflict is known). */
interface Pending {
  conflict: Obj
}

// --- The merge ------------------------------------------------------------------------------------

/**
 * Three-way merges `.kimo` documents (contract {@link ThreeWayMerge}). Inputs should validate on
 * their own; the result then always validates.
 */
export function mergeDocuments(
  input: ThreeWayMergeInput,
  options: MergeDocumentsOptions = {},
): ThreeWayMergeResult {
  const base = prepare(input.base, false)
  const ours = prepare(input.ours, true)
  const theirs = prepare(input.theirs, true)
  const vopts: ValidateOptions = { ...(options.validate ?? {}), lints: false }

  const merged = semanticMerge(base, ours.doc, theirs.doc)
  let out = finish(merged, input, options, ours.carried, theirs.carried, merged.changes)
  if (!validate(out.doc, vopts).ok) {
    const held = holdOurs(base, ours.doc, theirs.doc)
    out = finish(held, input, options, ours.carried, theirs.carried, 0)
  }
  return out
}

/** Compile-time check: {@link mergeDocuments} has the contract's signature. */
export const threeWayMerge: ThreeWayMerge = mergeDocuments

interface Prepared {
  doc: Obj
  /** Stored conflicts the input already carried (a merge of a file mid-resolution). */
  carried: Record<string, Conflict>
}

/** Defaults stripped (so "set to the default" equals "unset"), stored conflicts split off. */
function prepare(d: KimoDocument, keepConflicts: true): Prepared
function prepare(d: KimoDocument, keepConflicts: false): Obj
function prepare(d: KimoDocument, keepConflicts: boolean): Prepared | Obj {
  const doc = clone(stripDefaults(d)) as unknown as Obj
  const carried = isObject(doc.conflicts) ? (doc.conflicts as Record<string, Conflict>) : {}
  delete doc.conflicts
  delete doc.merge
  if (Array.isArray(doc.features)) {
    const rest = (doc.features as unknown[]).filter((f) => f !== MERGE_FEATURE)
    if (rest.length > 0) doc.features = rest
    else delete doc.features
  }
  return keepConflicts ? { doc, carried } : doc
}

/** A merged body plus its new conflicts. */
interface Merged {
  doc: Obj
  conflicts: Obj[]
  changes: number
  repairs: CycleRepair[]
}

function semanticMerge(b: Obj, o: Obj, t: Obj): Merged {
  const ctr: Counter = { changes: 0, strict: false }
  const conflicts: Pending[] = []
  const bn = nodeTable(b)
  const on = nodeTable(o)
  const tn = nodeTable(t)
  const sideNodes = (s: Side) => (s === "ours" ? on : tn)

  // 1. Nodes, one by one.
  const M: Obj = {}
  const keep = new Map<string, KeepRequest>()
  /** Conflicts that are about a node as a whole (no prop/move entries may share it). */
  const wholeNode = new Set<string>()
  for (const id of unionKeys(on, tn, bn).sort(byCode)) {
    const bv = get(bn, id)
    const ov = get(on, id)
    const tv = get(tn, id)
    if (eq(ov, tv)) {
      if (!eq(ov, bv)) ctr.changes++
      if (ov !== ABSENT) M[id] = clone(ov)
      continue
    }
    if (eq(tv, bv)) {
      ctr.changes++
      if (ov !== ABSENT) M[id] = clone(ov)
      continue
    }
    if (eq(ov, bv)) {
      ctr.changes++
      if (tv !== ABSENT) M[id] = clone(tv)
      continue
    }
    // Both changed, differently.
    if (bv !== ABSENT && (ov === ABSENT || tv === ABSENT)) {
      // Delete vs edit: the body keeps the edited side.
      const side: Side = ov === ABSENT ? "theirs" : "ours"
      M[id] = clone(side === "ours" ? ov : tv)
      keep.set(id, { node: id, side, ancestors: [] })
      wholeNode.add(id)
      continue
    }
    const oo = ov as Obj
    const to = tv as Obj
    const bo = bv === ABSENT ? undefined : (bv as Obj)
    if (bo === undefined || oo.type !== to.type || oo.type !== bo.type) {
      // Added on both sides differently, or a type change: a whole-node conflict.
      M[id] = clone(oo)
      wholeNode.add(id)
      conflicts.push({
        conflict: withSides({ kind: "node", node: id, applied: "ours" }, bv, ov, tv),
      })
      continue
    }
    const node: Obj = { type: oo.type }
    const place = mergeValue(
      ["@placement"],
      placementOf(bo),
      placementOf(oo),
      placementOf(to),
      "atomic",
      ctr,
      (_tk, pb, po, pt) => {
        conflicts.push({
          conflict: withSides({ kind: "move", node: id, applied: "ours" }, pb, po, pt),
        })
      },
    ) as Placement
    setPlacement(node, place)
    for (const k of unionKeys(oo, to)) {
      if (PLACEMENT_KEYS.has(k)) continue
      const v = mergeValue(
        [k],
        get(bo, k),
        get(oo, k),
        get(to, k),
        childMode("struct", k),
        ctr,
        (tokens, pb, po, pt) => {
          conflicts.push({
            conflict: withSides(
              { kind: "prop", node: id, path: ptr(tokens), applied: "ours" },
              pb,
              po,
              pt,
            ),
          })
        },
      )
      if (v !== ABSENT) setOwn(node, k, clone(v))
    }
    M[id] = node
  }

  // 2. Kept nodes bring back their subtree and the ancestors the other side deleted.
  const rescue = (req: KeepRequest) => {
    const src = sideNodes(req.side)
    if (!Object.hasOwn(M, req.node) && isObject(src[req.node])) M[req.node] = clone(src[req.node])
    for (const d of descendantsOf(src, req.node)) if (!Object.hasOwn(M, d)) M[d] = clone(src[d])
    const seen = new Set<string>([req.node])
    for (let p = parentOf(M[req.node]); p !== null && !seen.has(p); p = parentOf(src[p])) {
      seen.add(p)
      if (Object.hasOwn(M, p)) break
      if (!isObject(src[p])) break
      M[p] = clone(src[p])
      req.ancestors.push(p)
    }
  }
  for (const req of keep.values()) rescue(req)

  const repairs: CycleRepair[] = []
  const fixOrphans = () => {
    for (let guard = 0; guard < 10000; guard++) {
      const orphan = Object.keys(M)
        .sort(byCode)
        .find((id) => {
          const p = parentOf(M[id])
          return p !== null && !Object.hasOwn(M, p)
        })
      if (orphan === undefined) return
      const p = parentOf(M[orphan]) as string
      const side: Side | null = isObject(on[p]) ? "ours" : isObject(tn[p]) ? "theirs" : null
      if (side === null || keep.has(p)) {
        // No side has the parent (inputs were inconsistent): move the orphan to the root.
        const n = M[orphan] as Obj
        n.parent = null
        delete n.at
        repairs.push({ node: orphan, parent: null })
        continue
      }
      const req: KeepRequest = { node: p, side, ancestors: [] }
      keep.set(p, req)
      wholeNode.add(p)
      rescue(req)
    }
  }
  fixOrphans()

  // 3. Parent cycles (teardown 9.2).
  repairCycles(M, bn, on, tn, conflicts, wholeNode, repairs)
  fixOrphans()

  // 4. Variables and header members.
  const variables = mergeVariables(b, o, t, ctr, conflicts)
  const header = mergeHeader(b, o, t, ctr, conflicts)

  const assemble = (): Merged => {
    const doc: Obj = { ...header }
    if (variables !== null) doc.variables = variables
    doc.nodes = M
    const comps = mergeComponentsIndex(b, o, t, M)
    if (comps !== null) doc.components = comps
    else delete doc.components
    const all = conflicts.map((p) => p.conflict)
    for (const req of [...keep.values()].sort((x, y) => byCode(x.node, y.node))) {
      const restored: Obj = {}
      for (const a of req.ancestors) if (Object.hasOwn(M, a)) setOwn(restored, a, clone(M[a]))
      for (const d of descendantsOf(M, req.node)) setOwn(restored, d, clone(M[d]))
      const own = get(sideNodes(req.side), req.node)
      const c = withSides(
        { kind: "node", node: req.node, applied: req.side },
        get(bn, req.node),
        req.side === "ours" ? own : ABSENT,
        req.side === "theirs" ? own : ABSENT,
      )
      if (Object.keys(restored).length > 0) c.restored = restored
      all.push(c)
    }
    // A whole-node entry supersedes finer entries on the same node.
    const filtered = all.filter(
      (c) => c.kind === "node" || !(typeof c.node === "string" && wholeNode.has(c.node)),
    )
    return { doc, conflicts: filtered, changes: ctr.changes, repairs }
  }

  // 5. References the merged body still needs (variables, components) are kept, then checked.
  for (let attempt = 0; attempt < 4; attempt++) {
    const result = assemble()
    const r = validate(result.doc as unknown as KimoDocument, { lints: false })
    if (r.ok) return result
    const codes = new Set(r.errors.map((e) => e.code))
    let fixed = false
    if (codes.has("VARIABLE_MISSING") && variables !== null) {
      for (const name of referencedVariables(result.doc)) {
        if (Object.hasOwn(variables, name)) continue
        const ov = get(o.variables, name)
        const tv = get(t.variables, name)
        const side: Side | null = ov !== ABSENT ? "ours" : tv !== ABSENT ? "theirs" : null
        if (side === null) continue
        setOwn(variables, name, clone(side === "ours" ? ov : tv))
        const bv = get(b.variables, name)
        conflicts.push({
          conflict: withSides({ kind: "variable", variable: name, applied: side }, bv, ov, tv),
        })
        fixed = true
      }
    }
    if (codes.has("REF_MISSING")) {
      for (const n of Object.values(M)) {
        const of = isObject(n) && n.type === "instance" ? n.of : undefined
        if (typeof of !== "string" || of.includes(":") || Object.hasOwn(M, of)) continue
        const side: Side | null = isObject(on[of]) ? "ours" : isObject(tn[of]) ? "theirs" : null
        if (side === null || keep.has(of)) continue
        const req: KeepRequest = { node: of, side, ancestors: [] }
        keep.set(of, req)
        wholeNode.add(of)
        rescue(req)
        fixed = true
      }
      fixOrphans()
    }
    if (!fixed) return result
  }
  return assemble()
}

/** Breaks parent cycles: the moved node with the larger id goes back to its base placement. */
function repairCycles(
  M: Obj,
  bn: Obj,
  on: Obj,
  tn: Obj,
  conflicts: Pending[],
  wholeNode: Set<string>,
  repairs: CycleRepair[],
): void {
  const ids = Object.keys(M).sort(byCode)
  const moved = (id: string) =>
    !eq(placementOf(M[id]), placementOf(get(bn, id))) && !wholeNode.has(id)
  for (let guard = 0; guard <= ids.length; guard++) {
    const cycle = findCycle(ids, (id) => parentOf(M[id]))
    if (!cycle) return
    const inCycle = new Set(cycle)
    let victim = cycle[0] as string
    for (const id of cycle) {
      const rank = (x: string) => (moved(x) ? 1 : 0)
      if (rank(id) > rank(victim) || (rank(id) === rank(victim) && byCode(id, victim) > 0))
        victim = id
    }
    const n = M[victim] as Obj
    const bp = placementOf(get(bn, victim))
    const reaches = (start: string | null): boolean => {
      const seen = new Set<string>()
      for (let p = start; p !== null && !seen.has(p); p = parentOf(M[p])) {
        if (p === victim) return true
        seen.add(p)
      }
      return false
    }
    const backToBase =
      bp !== ABSENT &&
      (bp.parent === null ||
        (Object.hasOwn(M, bp.parent) && !inCycle.has(bp.parent) && !reaches(bp.parent)))
    if (backToBase) {
      setPlacement(n, bp as Placement)
      const existing = conflicts.find(
        (p) => p.conflict.kind === "move" && p.conflict.node === victim,
      )
      if (existing) existing.conflict.applied = "base"
      else if (isObject(on[victim]) && isObject(tn[victim])) {
        conflicts.push({
          conflict: withSides(
            { kind: "move", node: victim, applied: "base" },
            bp,
            placementOf(on[victim]),
            placementOf(tn[victim]),
          ),
        })
      }
    } else {
      n.parent = null
      delete n.at
      const existing = conflicts.findIndex(
        (p) => p.conflict.kind === "move" && p.conflict.node === victim,
      )
      if (existing >= 0) conflicts.splice(existing, 1)
    }
    repairs.push({ node: victim, parent: (n.parent as string | null) ?? null })
  }
}

/** One parent cycle (members in walk order), scanning ids in order. */
function findCycle(ids: readonly string[], parent: (id: string) => string | null): string[] | null {
  const state = new Map<string, 1 | 2>()
  for (const start of ids) {
    if (state.has(start)) continue
    const path: string[] = []
    let p: string | null = start
    while (p !== null && !state.has(p)) {
      state.set(p, 1)
      path.push(p)
      p = parent(p)
    }
    if (p !== null && state.get(p) === 1) return path.slice(path.indexOf(p))
    for (const q of path) state.set(q, 2)
  }
  return null
}

// --- Variables ----------------------------------------------------------------------------------

type Entry = { value: unknown; when?: Record<string, string> } & Obj

const whenKey = (e: Entry) =>
  isObject(e.when)
    ? Object.keys(e.when)
        .sort(byCode)
        .map((k) => `${k}=${String((e.when as Obj)[k])}`)
        .join(",")
    : ""

/** Themed entries keyed by their `when`, or null when two entries share one. */
function keyedEntries(v: unknown): Map<string, Entry> | null {
  if (!isObject(v) || !isThemedValue(v.value)) return null
  const m = new Map<string, Entry>()
  for (const e of v.value as Entry[]) {
    const k = whenKey(e)
    if (m.has(k)) return null
    m.set(k, e)
  }
  return m
}

function mergeVariables(b: Obj, o: Obj, t: Obj, ctr: Counter, conflicts: Pending[]): Obj | null {
  const bv = isObject(b.variables) ? b.variables : {}
  const ov = isObject(o.variables) ? o.variables : undefined
  const tv = isObject(t.variables) ? t.variables : undefined
  if (ov === undefined && tv === undefined) {
    if (isObject(b.variables)) ctr.changes++
    return null
  }
  const out: Obj = {}
  for (const name of unionKeys(ov, tv)) {
    const v = mergeVariable(name, get(bv, name), get(ov, name), get(tv, name), ctr, conflicts)
    if (v !== ABSENT) setOwn(out, name, clone(v))
  }
  return out
}

function mergeVariable(
  name: string,
  b: unknown,
  o: unknown,
  t: unknown,
  ctr: Counter,
  conflicts: Pending[],
): unknown {
  if (eq(o, t)) {
    if (!eq(o, b)) ctr.changes++
    return o
  }
  if (eq(t, b)) {
    ctr.changes++
    return o
  }
  if (eq(o, b) && !ctr.strict) {
    ctr.changes++
    return t
  }
  const whole = () => {
    // Delete vs edit keeps the edited side; otherwise the body holds ours.
    const side: Side = o === ABSENT && b !== ABSENT ? "theirs" : "ours"
    conflicts.push({
      conflict: withSides({ kind: "variable", variable: name, applied: side }, b, o, t),
    })
    return side === "ours" ? o : t
  }
  if (ctr.strict) return whole()
  const be = keyedEntries(b)
  const oe = keyedEntries(o)
  const te = keyedEntries(t)
  if (!be || !oe || !te) return whole()
  const bo = b as Obj
  const oo = o as Obj
  const to = t as Obj
  // Fields other than `value` (type, description, group) merge per key; a conflict there is a
  // whole-variable conflict.
  let clash = false
  const sub: Counter = { changes: 0, strict: false }
  const out: Obj = {}
  for (const k of unionKeys(oo, to)) {
    if (k === "value") continue
    const v = mergeValue([k], get(bo, k), get(oo, k), get(to, k), "atomic", sub, () => {
      clash = true
    })
    if (v !== ABSENT) setOwn(out, k, clone(v))
  }
  if (clash) return whole()
  const entryConflicts: Pending[] = []
  const merged = new Map<string, Entry>()
  for (const k of unionKeys(Object.fromEntries(oe), Object.fromEntries(te))) {
    const eb = be.get(k) ?? ABSENT
    const eo = oe.get(k) ?? ABSENT
    const et = te.get(k) ?? ABSENT
    const v = mergeValue([k], eb, eo, et, "atomic", sub, (_tk, xb, xo, xt) => {
      const when = ((xo !== ABSENT ? xo : xt !== ABSENT ? xt : xb) as Entry).when ?? {}
      const val = (x: unknown) => (x === ABSENT ? ABSENT : (x as Entry).value)
      entryConflicts.push({
        conflict: withSides(
          { kind: "variable", variable: name, when: clone(when), applied: "ours" },
          val(xb),
          val(xo),
          val(xt),
        ),
      })
    })
    if (v !== ABSENT) merged.set(k, clone(v) as Entry)
  }
  if (merged.size === 0) return whole()
  // Entry order: the side that reordered the surviving base entries wins; additions follow.
  const seq = (m: Map<string, Entry>) => [...m.keys()]
  const sb = seq(be)
  const so = seq(oe)
  const st = seq(te)
  let order: string[]
  if (jsonEqual(st, sb)) order = so
  else if (jsonEqual(so, sb)) order = st
  else {
    const survivors = sb.filter((k) => merged.has(k))
    const added = [...merged.keys()].filter((k) => !be.has(k)).sort(byCode)
    order = [...survivors, ...added]
  }
  const list = order.filter((k) => merged.has(k))
  for (const k of merged.keys()) if (!list.includes(k)) list.push(k)
  out.value = list.map((k) => merged.get(k))
  ctr.changes += sub.changes
  conflicts.push(...entryConflicts)
  return out
}

/** Local variable names bound anywhere in the document (`{ "$ref": "name" }`). */
function referencedVariables(doc: Obj): string[] {
  const out = new Set<string>()
  const walk = (v: unknown) => {
    if (Array.isArray(v)) for (const x of v) walk(x)
    else if (isObject(v)) {
      if (typeof v.$ref === "string" && !v.$ref.includes(":")) out.add(v.$ref)
      for (const x of Object.values(v)) walk(x)
    }
  }
  walk(doc.nodes)
  walk(doc.variables)
  return [...out].sort(byCode)
}

// --- Header -----------------------------------------------------------------------------------

const BODY_KEYS = new Set(["nodes", "variables", "features", "conflicts", "merge", "components"])
/** Header members whose conflicts can be stored (spec §21.2 `header`). */
const RECORD_HEADER = new Set(["meta", "themes", "imports"])

function mergeHeader(b: Obj, o: Obj, t: Obj, ctr: Counter, conflicts: Pending[]): Obj {
  const out: Obj = {}
  const headerConflict: OnConflict = (tokens, pb, po, pt) => {
    conflicts.push({
      conflict: withSides({ kind: "header", path: ptr(tokens), applied: "ours" }, pb, po, pt),
    })
  }
  for (const k of unionKeys(o, t)) {
    if (BODY_KEYS.has(k)) continue
    let v: unknown
    if (k === "assets") v = mergeAssets(b.assets, o.assets, t.assets, ctr, headerConflict)
    else if (RECORD_HEADER.has(k))
      v = mergeValue([k], get(b, k), get(o, k), get(t, k), "opaque", ctr, headerConflict)
    else
      v = mergeValue([k], get(b, k), get(o, k), get(t, k), "atomic", ctr, () => {
        // `$schema`, `format` and members unknown to this reader cannot be stored as
        // conflicts; inputs are at the reader's format, so this keeps ours.
      })
    if (v !== ABSENT) setOwn(out, k, clone(v))
  }
  const features = new Set<string>()
  for (const d of [o, t])
    if (Array.isArray(d.features))
      for (const f of d.features) if (typeof f === "string") features.add(f)
  if (features.size > 0) out.features = [...features].sort(byCode)
  return out
}

/** Asset manifests merge add-only: an entry on either side stays. */
function mergeAssets(
  b: unknown,
  o: unknown,
  t: unknown,
  ctr: Counter,
  onConflict: OnConflict,
): unknown {
  if (!isObject(o) && !isObject(t)) return ABSENT
  const out: Obj = {}
  for (const k of unionKeys(o, t)) {
    const ov = get(o, k)
    const tv = get(t, k)
    const bv = get(b, k)
    let v: unknown
    if (ov === ABSENT) {
      v = tv
      if (!eq(tv, bv)) ctr.changes++
    } else if (tv === ABSENT) {
      v = ov
      if (!eq(ov, bv)) ctr.changes++
    } else v = mergeValue(["assets", k], bv, ov, tv, "atomic", ctr, onConflict)
    if (v !== ABSENT) setOwn(out, k, clone(v))
  }
  return out
}

/** The components index as a set merge, kept to ids that are components in the result. */
function mergeComponentsIndex(b: Obj, o: Obj, t: Obj, M: Obj): string[] | null {
  const list = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []
  if (!Array.isArray(o.components) && !Array.isArray(t.components)) return null
  const bs = list(b.components)
  const os = new Set(list(o.components))
  const ts = new Set(list(t.components))
  const bset = new Set(bs)
  const isComponent = (id: string) => isObject(M[id]) && Boolean((M[id] as Obj).component)
  const keep = (id: string) => (os.has(id) || !bset.has(id)) && (ts.has(id) || !bset.has(id))
  const survivors = bs.filter((id) => os.has(id) && ts.has(id))
  const added = [...new Set([...os, ...ts])].filter((id) => !bset.has(id)).sort(byCode)
  return [...survivors, ...added].filter(
    (id, i, a) => a.indexOf(id) === i && keep(id) && isComponent(id),
  )
}

// --- Fallback: hold ours, store every change of theirs ---------------------------------------------

function holdOurs(b: Obj, o: Obj, t: Obj): Merged {
  const ctr: Counter = { changes: 0, strict: true }
  const conflicts: Pending[] = []
  const bn = nodeTable(b)
  const on = nodeTable(o)
  const tn = nodeTable(t)
  const changed = (id: string) => {
    const ov = get(on, id)
    const tv = get(tn, id)
    return !eq(ov, tv) && !eq(tv, get(bn, id))
  }
  const ids = unionKeys(on, tn, bn).filter(changed).sort(byCode)
  const idSet = new Set(ids)
  const missing = (side: Obj, id: string) => !isObject(side[id])
  for (const id of ids) {
    const ov = get(on, id)
    const tv = get(tn, id)
    const bv = get(bn, id)
    const restored: Obj = {}
    if (ov === ABSENT) {
      // Theirs has a node ours lacks: one entry per topmost such node.
      const p = parentOf(tn[id])
      if (p !== null && idSet.has(p) && missing(on, p)) continue
      for (const d of descendantsOf(tn, id)) if (missing(on, d)) setOwn(restored, d, clone(tn[d]))
      const seen = new Set<string>([id])
      for (let a = p; a !== null && !seen.has(a) && missing(on, a); a = parentOf(tn[a])) {
        seen.add(a)
        if (isObject(tn[a])) setOwn(restored, a, clone(tn[a]))
      }
    } else if (tv === ABSENT) {
      // Theirs deleted a node ours keeps: one entry per topmost deleted node.
      const p = parentOf(on[id])
      if (p !== null && idSet.has(p) && missing(tn, p)) continue
      for (const d of descendantsOf(on, id)) setOwn(restored, d, clone(on[d]))
    }
    const c = withSides({ kind: "node", node: id, applied: "ours" }, bv, ov, tv)
    if (Object.keys(restored).length > 0) c.restored = restored
    conflicts.push({ conflict: c })
  }
  const bv = isObject(b.variables) ? b.variables : {}
  const ov = isObject(o.variables) ? o.variables : {}
  const tv = isObject(t.variables) ? t.variables : {}
  for (const name of unionKeys(ov, tv)) {
    const [x, y, z] = [get(bv, name), get(ov, name), get(tv, name)]
    if (!eq(y, z) && !eq(z, x))
      conflicts.push({
        conflict: withSides({ kind: "variable", variable: name, applied: "ours" }, x, y, z),
      })
  }
  mergeHeader(b, o, t, ctr, conflicts)
  if (!jsonEqual(o.components, t.components) && !jsonEqual(t.components, b.components))
    conflicts.push({
      conflict: withSides(
        { kind: "header", path: "/components", applied: "ours" },
        get(b, "components"),
        get(o, "components"),
        get(t, "components"),
      ),
    })
  const doc = clone(o)
  return { doc, conflicts: conflicts.map((p) => p.conflict), changes: 0, repairs: [] }
}

// --- Result -------------------------------------------------------------------------------------

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

/** FNV-1a 32-bit with a seed. */
function fnv(s: string, seed: number): number {
  let h = (0x811c9dc5 ^ seed) >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

/** A 10-char id ("Cf" + 8 base62 chars) derived from `key`. */
function derivedId(key: string): string {
  let a = fnv(key, 0)
  let b = fnv(key, 0x9e3779b9)
  let s = ""
  for (let i = 0; i < 8; i++) {
    const src = i % 2 === 0 ? a : b
    s += BASE62[src % 62]
    if (i % 2 === 0) a = Math.floor(a / 62)
    else b = Math.floor(b / 62)
  }
  return `Cf${s}`
}

function finish(
  merged: Merged,
  input: ThreeWayMergeInput,
  options: ThreeWayMergeOptions,
  carriedOurs: Record<string, Conflict>,
  carriedTheirs: Record<string, Conflict>,
  changes: number,
): ThreeWayMergeResult {
  const fresh = merged.conflicts as unknown as Conflict[]
  const keyed = fresh
    .map((c) => ({ key: conflictTargetKey(c), c }))
    .sort((x, y) => byCode(x.key, y.key))
  const taken = new Set<string>([
    ...Object.keys(nodeTable(input.base)),
    ...Object.keys(nodeTable(input.ours)),
    ...Object.keys(nodeTable(input.theirs)),
  ])
  const table: Record<string, Conflict> = {}
  // Conflicts the inputs already stored stay, unless a new conflict covers the same target.
  for (const carried of [carriedOurs, carriedTheirs])
    for (const [id, c] of Object.entries(carried).sort((x, y) => byCode(x[0], y[0]))) {
      if (Object.hasOwn(table, id)) continue
      if (fresh.some((f) => conflictTargetsOverlap(f, c))) continue
      if (Object.values(table).some((x) => conflictTargetsOverlap(x, c))) continue
      table[id] = c
      taken.add(id)
    }
  for (const { key, c } of keyed) {
    let id = options.newId ? options.newId() : derivedId(key)
    for (let n = 1; taken.has(id) || Object.hasOwn(table, id); n++)
      id = options.newId ? options.newId() : derivedId(`${key}#${n}`)
    taken.add(id)
    table[id] = c
  }
  const info: MergeInfo = { ...(input.labels ?? {}), changes }
  const doc = attachConflicts(merged.doc, table, info) as unknown as KimoDocument
  return { doc, conflicts: table, changes, repairs: merged.repairs }
}
