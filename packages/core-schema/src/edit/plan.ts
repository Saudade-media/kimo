/**
 * Edit plans (M3, ADR 0011): pure functions that turn one editor gesture on components,
 * instances, variables, themes or imports into an ordered list of low-level ops. The op shapes
 * are structurally identical to `@kimo/editor-state`'s `Op` (insert / update / move / delete /
 * setVariables / setThemes / setHeader), so a plan is applied with ONE `store.apply(plan.ops,
 * { origin, label })`: validated, one transaction, one undo step, inverse computed by the store.
 *
 * Planners never mutate their input. They check what the format cannot express or what the
 * editor must refuse with a message (board 15 "rejected edit" toasts); everything else is left
 * to the store's validation (`SCHEMA_VIOLATION` with the core-schema issue).
 */
import { isObject } from "../json"
import type { Libraries } from "../resolve"
import type { KimoDocument, Variable } from "../schema/document"
import { compareCodeUnits } from "../tree"

/** Root members a plan may set as whole values (editor-state `HEADER_OP_KEYS` superset). */
export type PlanHeaderKey = "features" | "assets" | "imports" | "components" | "meta"

/** One low-level op (editor-state `Op` subset, structurally identical). */
export type PlanOp =
  | {
      op: "insert"
      id: string
      node: Record<string, unknown>
      parent?: string | null
      at?: string | null
      order?: string
      index?: number
    }
  | { op: "update"; id: string; set?: Record<string, unknown>; unset?: string[] }
  | {
      op: "move"
      id: string
      parent: string | null
      at?: string | null
      order?: string
      index?: number
    }
  | { op: "delete"; id: string }
  | { op: "setVariables"; set?: Record<string, Variable>; unset?: string[] }
  | { op: "setThemes"; set?: Record<string, string[]>; unset?: string[] }
  | {
      op: "setHeader"
      set?: Partial<Record<PlanHeaderKey, unknown>>
      unset?: PlanHeaderKey[]
    }

/** Why a planner refused (each maps to a board 15 toast; copy is the UI's). */
export type PlanErrorCode =
  | "NOT_FOUND"
  | "NOT_AN_INSTANCE"
  | "NOT_A_COMPONENT"
  | "NOT_A_SLOT"
  /** The target belongs to a linked library (read-only, §11). */
  | "LIBRARY_READ_ONLY"
  /** The library is not loaded (and no cached copy was supplied). */
  | "LIBRARY_NOT_LOADED"
  | "PATH_UNRESOLVED"
  /** Would create an instance or alias cycle. */
  | "CYCLE"
  /** Still referenced (variable bound, axis value pinned…) and the caller did not opt in. */
  | "IN_USE"
  /** Name/alias/value already exists. */
  | "CONFLICT"
  | "INVALID"

export interface PlanError {
  code: PlanErrorCode
  message: string
  nodeId?: string
}

/** Something the plan did that the UI lists before confirming or after applying. */
export interface PlanNote {
  code:
    | "OVERRIDE_DROPPED"
    | "ARG_DROPPED"
    | "SLOT_CONTENT_DELETED"
    | "PROP_DROPPED"
    | "BINDING_DETACHED"
    | "PIN_REMOVED"
    | "ENTRY_REMOVED"
    | "HIDDEN_INSTEAD"
    | "INSTANCE_DETACHED"
    | "SUGGESTION_REMOVED"
  message: string
  nodeId?: string
  key?: string
}

/** Result of a planner. */
export type Plan =
  | {
      ok: true
      ops: PlanOp[]
      notes: PlanNote[]
      /** Ids the editor should select afterwards (e.g. the detached root), when any. */
      select?: string[]
    }
  | { ok: false; error: PlanError }

/** What every planner reads. */
export interface PlanContext {
  /** The current document (plain data; e.g. `store.toDocument()`). Not mutated. */
  doc: KimoDocument
  /** Loaded (or cached, for detach/unlink) libraries by alias. */
  libraries?: Libraries
  /** Id generator for new nodes (default: 10 random base-62 chars, unique in `doc`). */
  newId?: () => string
}

export const ok = (ops: PlanOp[], notes: PlanNote[] = [], select?: string[]): Plan =>
  select ? { ok: true, ops, notes, select } : { ok: true, ops, notes }

export const fail = (code: PlanErrorCode, message: string, nodeId?: string): Plan =>
  nodeId === undefined
    ? { ok: false, error: { code, message } }
    : { ok: false, error: { code, message, nodeId } }

// --- Ids ------------------------------------------------------------------------------------

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

/** A fresh-id generator that never returns an id present in `doc` or already handed out. */
export function idGenerator(ctx: PlanContext): () => string {
  const taken = new Set(Object.keys(ctx.doc.nodes as Record<string, unknown>))
  const base = ctx.newId
  return () => {
    for (;;) {
      let id: string
      if (base) id = base()
      else {
        const bytes = new Uint8Array(10)
        crypto.getRandomValues(bytes)
        id = Array.from(bytes, (b) => BASE62[b % 62]).join("")
      }
      if (!taken.has(id)) {
        taken.add(id)
        return id
      }
    }
  }
}

// --- Order keys (props declaration order; base-62 fractional keys) --------------------------

const DIGITS = BASE62

/**
 * A key strictly between `a` and `b` (null = unbounded), over base-62 digits (the fractional
 * part of the fractional-indexing midpoint algorithm). Used for declaration order; node keys
 * come from the store's jittered generator.
 * @throws RangeError when `a >= b` or no key fits (e.g. between "a" and "a0").
 */
export function orderBetween(a: string | null, b: string | null): string {
  const lo = a ?? ""
  if (b !== null && compareCodeUnits(lo, b) >= 0)
    throw new RangeError(`orderBetween: "${lo}" is not before "${b}"`)
  return midpoint(lo, b)
}

function midpoint(a: string, b: string | null): string {
  const zero = DIGITS[0] as string
  if (b !== null) {
    let n = 0
    while ((a[n] ?? zero) === b[n]) n++
    if (n >= b.length) throw new RangeError(`orderBetween: no key between "${a}" and "${b}"`)
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n))
  }
  const da = a ? DIGITS.indexOf(a[0] as string) : 0
  const db = b !== null ? DIGITS.indexOf(b[0] as string) : DIGITS.length
  if (db - da > 1) return DIGITS[Math.round((da + db) / 2)] as string
  if (b !== null && b.length > 1) return b.slice(0, 1)
  return (DIGITS[da] as string) + midpoint(a.slice(1), null)
}

// --- JSON walking ---------------------------------------------------------------------------

/**
 * Rebuilds a JSON value bottom-up: `fn(value, key)` returns a replacement (or the value
 * itself); `undefined` removes the value from its parent object/array. `meta` subtrees are kept
 * as they are (not interpreted, §5.2).
 */
export function mapJson(
  value: unknown,
  fn: (v: unknown, key: string | null) => unknown,
  key: string | null = null,
): unknown {
  let v = value
  if (Array.isArray(v)) {
    const out: unknown[] = []
    for (const x of v) {
      const m = mapJson(x, fn, key)
      if (m !== undefined) out.push(m)
    }
    v = out
  } else if (isObject(v)) {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) {
      if (k === "meta") {
        out[k] = x
        continue
      }
      const m = mapJson(x, fn, k)
      if (m !== undefined) out[k] = m
    }
    v = out
  }
  return fn(v, key)
}

/** Deep JSON equality. */
export function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Node table as plain records. */
export function nodeTable(doc: KimoDocument): Record<string, Record<string, unknown>> {
  return doc.nodes as unknown as Record<string, Record<string, unknown>>
}

/** Ids of a node's subtree (itself, regular children and instance-owned nodes), parents first. */
export function subtree(doc: KimoDocument, id: string): string[] {
  const nodes = nodeTable(doc)
  const byParent = new Map<string, string[]>()
  for (const [cid, n] of Object.entries(nodes)) {
    if (typeof n.parent !== "string") continue
    const l = byParent.get(n.parent)
    if (l) l.push(cid)
    else byParent.set(n.parent, [cid])
  }
  const out: string[] = []
  const stack = [id]
  const seen = new Set<string>()
  while (stack.length) {
    const cur = stack.shift() as string
    if (seen.has(cur) || !nodes[cur]) continue
    seen.add(cur)
    out.push(cur)
    stack.push(...(byParent.get(cur) ?? []).sort(compareCodeUnits))
  }
  return out
}

/** Instance-owned nodes of `instance` attached at `at` (unordered). */
export function ownedAt(doc: KimoDocument, instance: string, at: string): string[] {
  const out: string[] = []
  for (const [id, n] of Object.entries(nodeTable(doc)))
    if (n.parent === instance && n.at === at) out.push(id)
  return out.sort(compareCodeUnits)
}

// --- Applying a plan (headless, tests, dry runs) ---------------------------------------------

/**
 * Applies ops to a copy of `doc` with the store's semantics (shallow `update`, subtree
 * `delete`, `setHeader` whole values). Inserts/moves without `order` get a key after their
 * last sibling. Throws on an op the store would reject structurally (missing node, existing
 * id). Validation is the caller's (`validate(applyPlan(...))`).
 */
export function applyPlan(doc: KimoDocument, ops: readonly PlanOp[]): KimoDocument {
  const out = structuredClone(doc)
  applyPlanInPlace(out, ops)
  return out
}

/**
 * {@link applyPlan} on `doc` itself (mutated): for planners that apply many sub-plans to one
 * working copy without re-cloning the whole document each time.
 */
export function applyPlanInPlace(doc: KimoDocument, ops: readonly PlanOp[]): KimoDocument {
  const out = doc as KimoDocument & Record<string, unknown>
  const nodes = out.nodes as Record<string, Record<string, unknown>>
  const lastOrder = (parent: string | null, at: string | null | undefined, self?: string) => {
    let max: string | null = null
    for (const [id, n] of Object.entries(nodes)) {
      if (id === self || n.parent !== parent || (n.at ?? null) !== (at ?? null)) continue
      const o = String(n.order)
      if (max === null || compareCodeUnits(o, max) > 0) max = o
    }
    return orderBetween(max, null)
  }
  for (const op of ops) {
    switch (op.op) {
      case "insert": {
        if (nodes[op.id]) throw new Error(`insert: ${op.id} exists`)
        const body = structuredClone(op.node) as Record<string, unknown>
        const parent =
          op.parent !== undefined ? op.parent : ((body.parent as string | null) ?? null)
        const at = op.at !== undefined ? op.at : (body.at as string | undefined)
        const n: Record<string, unknown> = { ...body, parent }
        if (at) n.at = at
        else delete n.at
        n.order = op.order ?? (body.order as string | undefined) ?? lastOrder(parent, at)
        nodes[op.id] = n
        break
      }
      case "update": {
        const n = nodes[op.id]
        if (!n) throw new Error(`update: ${op.id} missing`)
        for (const [k, v] of Object.entries(op.set ?? {})) {
          if (v === undefined) delete n[k]
          else n[k] = structuredClone(v)
        }
        for (const k of op.unset ?? []) delete n[k]
        break
      }
      case "move": {
        const n = nodes[op.id]
        if (!n) throw new Error(`move: ${op.id} missing`)
        n.parent = op.parent
        if (op.at) n.at = op.at
        else delete n.at
        n.order = op.order ?? lastOrder(op.parent, op.at, op.id)
        break
      }
      case "delete":
        for (const id of subtree(out, op.id)) delete nodes[id]
        break
      case "setVariables": {
        const vars = { ...((out.variables as Record<string, unknown>) ?? {}) }
        for (const [k, v] of Object.entries(op.set ?? {})) vars[k] = structuredClone(v)
        for (const k of op.unset ?? []) delete vars[k]
        if (Object.keys(vars).length) out.variables = vars as KimoDocument["variables"]
        else delete out.variables
        break
      }
      case "setThemes": {
        const themes = { ...((out.themes as Record<string, string[]>) ?? {}) }
        for (const [k, v] of Object.entries(op.set ?? {})) themes[k] = [...v]
        for (const k of op.unset ?? []) delete themes[k]
        if (Object.keys(themes).length) out.themes = themes
        else delete out.themes
        break
      }
      case "setHeader":
        for (const [k, v] of Object.entries(op.set ?? {}))
          if (v !== undefined) out[k] = structuredClone(v)
        for (const k of op.unset ?? []) delete out[k]
        break
    }
  }
  return out
}
