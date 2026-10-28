/**
 * Stored merge conflicts (spec §21, ADR 0012): listing, applying a side, finishing a merge.
 *
 * Pure functions over plain documents; they never mutate their input. The editor applies the
 * same changes through `editor-state` ops (so they are undoable and synced); these functions
 * are the reference semantics, used directly by `kimo merge`, the CLI and tests.
 */
import { jsonEqual } from "../defaults-ops"
import { isObject } from "../json"
import type { KimoDocument } from "../schema/document"
import type {
  AppliedState,
  Conflict,
  ConflictSide,
  Conflicts,
  MergeInfo,
  Placement,
} from "../schema/merge"

/** The feature flag every document with stored conflicts declares. */
export const MERGE_FEATURE = "merge/conflicts"

/** Why a conflict operation was refused. */
export type ConflictErrorCode =
  | "NOT_FOUND"
  /** The body has no target to apply the side to (e.g. the node was deleted by hand). */
  | "CANNOT_APPLY"
  /** `finishMerge` while conflicts are still open. */
  | "OPEN_CONFLICTS"

export class ConflictError extends Error {
  override readonly name = "ConflictError"
  constructor(
    readonly code: ConflictErrorCode,
    message: string,
    readonly conflictId?: string,
  ) {
    super(message)
  }
}

/** A conflict with its id. */
export interface ConflictEntry {
  id: string
  conflict: Conflict
}

/** A side's value: `present: false` means the value is absent on that side. */
export type SideValue = { present: true; value: unknown } | { present: false }

type Doc = Record<string, unknown>
type Obj = Record<string, unknown>

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T))

/** All stored conflicts, sorted by id (code unit). */
export function listConflicts(doc: KimoDocument | Doc): ConflictEntry[] {
  const c = (doc as Doc).conflicts
  if (!isObject(c)) return []
  return Object.keys(c)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((id) => ({ id, conflict: c[id] as Conflict }))
}

/** Open / resolved counts ("3 of 5 resolved"). */
export function conflictCounts(doc: KimoDocument | Doc): {
  total: number
  open: number
  resolved: number
} {
  const all = listConflicts(doc)
  const resolved = all.filter((e) => e.conflict.resolved === true).length
  return { total: all.length, open: all.length - resolved, resolved }
}

/** The merge labels, if any. */
export function mergeInfo(doc: KimoDocument | Doc): MergeInfo | null {
  const m = (doc as Doc).merge
  return isObject(m) ? (m as MergeInfo) : null
}

/** A side of a conflict. Move conflicts always have all three sides. */
export function sideValue(conflict: Conflict, side: ConflictSide): SideValue {
  const c = conflict as Obj
  return Object.hasOwn(c, side) ? { present: true, value: c[side] } : { present: false }
}

/**
 * A key that identifies what a conflict is about; two conflicts with the same key are
 * duplicates (`CONFLICT_DUPLICATE`). Prop conflicts on a node that also has a `node` conflict
 * share its key prefix and are duplicates too (see {@link conflictTargetsOverlap}).
 */
export function conflictTargetKey(conflict: Conflict): string {
  switch (conflict.kind) {
    case "prop":
      return `node:${conflict.node}:prop:${conflict.path}`
    case "node":
      return `node:${conflict.node}`
    case "move":
      return `node:${conflict.node}:move`
    case "variable":
      return conflict.when
        ? `variable:${conflict.variable}:when:${canonicalWhen(conflict.when)}`
        : `variable:${conflict.variable}`
    case "header":
      return `header:${conflict.path}`
  }
}

/** True when the two conflicts address the same thing, or one contains the other. */
export function conflictTargetsOverlap(a: Conflict, b: Conflict): boolean {
  const ka = conflictTargetKey(a)
  const kb = conflictTargetKey(b)
  if (ka === kb) return true
  // A whole-node / whole-variable conflict contains every finer conflict on the same target.
  const whole = (c: Conflict) =>
    c.kind === "node" || (c.kind === "variable" && c.when === undefined)
  if (whole(a) && kb.startsWith(`${ka}:`)) return true
  if (whole(b) && ka.startsWith(`${kb}:`)) return true
  // Header pointers: one is a prefix of the other.
  if (a.kind === "header" && b.kind === "header")
    return a.path.startsWith(`${b.path}/`) || b.path.startsWith(`${a.path}/`)
  if (a.kind === "prop" && b.kind === "prop" && a.node === b.node)
    return a.path.startsWith(`${b.path}/`) || b.path.startsWith(`${a.path}/`)
  return false
}

function canonicalWhen(when: Record<string, string>): string {
  return Object.keys(when)
    .sort()
    .map((k) => `${k}=${when[k]}`)
    .join(",")
}

// --- JSON Pointer helpers -----------------------------------------------------------------------

/** Tokens of a JSON Pointer (`""` → no tokens). */
export function pointerTokens(p: string): string[] {
  if (p === "") return []
  return p
    .slice(1)
    .split("/")
    .map((t) => t.replace(/~1/g, "/").replace(/~0/g, "~"))
}

/** Reads a pointer below `root`; `present: false` when any step is missing. */
export function readPointer(root: unknown, tokens: readonly string[]): SideValue {
  let cur: unknown = root
  for (const t of tokens) {
    if (Array.isArray(cur)) {
      const i = Number(t)
      if (!/^(0|[1-9][0-9]*)$/.test(t) || i >= cur.length) return { present: false }
      cur = cur[i]
    } else if (isObject(cur) && Object.hasOwn(cur, t)) {
      cur = cur[t]
    } else return { present: false }
  }
  return { present: true, value: cur }
}

/** Sets (or, for an absent side, deletes) a pointer below `root`, creating objects as needed. */
function writePointer(root: Obj, tokens: readonly string[], v: SideValue): void {
  let cur: unknown = root
  for (let i = 0; i < tokens.length - 1; i++) {
    const t = tokens[i] as string
    if (Array.isArray(cur)) {
      cur = cur[Number(t)]
    } else if (isObject(cur)) {
      if (!isObject(cur[t]) && !Array.isArray(cur[t])) {
        if (!v.present) return // nothing to delete
        cur[t] = {}
      }
      cur = cur[t]
    }
    if (!isObject(cur) && !Array.isArray(cur)) throw new Error("pointer through a scalar")
  }
  const last = tokens[tokens.length - 1] as string
  if (Array.isArray(cur)) {
    const i = Number(last)
    if (v.present) cur[i] = clone(v.value)
    else cur.splice(i, 1)
  } else if (isObject(cur)) {
    if (v.present) cur[last] = clone(v.value)
    else delete cur[last]
  }
}

// --- Applying sides ------------------------------------------------------------------------------

/** Options for {@link applyConflictSide}. */
export interface ApplyConflictOptions {
  /** Mark the conflict resolved (default true). Board 18 picks resolve immediately. */
  resolve?: boolean
}

/**
 * Returns a copy of `doc` whose body holds `side` for conflict `id`, with the entry's
 * `applied` set to `side` (and `resolved: true` unless `options.resolve` is false). Applying a
 * side is reversible: applying another side afterwards restores that side exactly.
 *
 * @throws {ConflictError} `NOT_FOUND` for an unknown id; `CANNOT_APPLY` when the body lacks the
 *   target (a prop/move conflict whose node is gone, a themed entry on a non-themed variable).
 */
export function applyConflictSide<T extends KimoDocument | Doc>(
  doc: T,
  id: string,
  side: ConflictSide,
  options: ApplyConflictOptions = {},
): T {
  const out = clone(doc) as Doc
  applyInPlace(out, id, side, options.resolve !== false)
  return out as T
}

/**
 * Applies `side` to every conflict (only open ones unless `onlyOpen` is false), as "Take all
 * ours / theirs" does: board 18 applies pick-all to unresolved rows only.
 */
export function applyAllConflicts<T extends KimoDocument | Doc>(
  doc: T,
  side: ConflictSide,
  options: { onlyOpen?: boolean } = {},
): T {
  const out = clone(doc) as Doc
  for (const { id, conflict } of listConflicts(out)) {
    if (options.onlyOpen !== false && conflict.resolved === true) continue
    applyInPlace(out, id, side, true)
  }
  return out as T
}

/** Marks a conflict as resolved by a manual edit (`applied: "edited"`, `resolved: true`). */
export function markConflictEdited<T extends KimoDocument | Doc>(doc: T, id: string): T {
  const out = clone(doc) as Doc
  const c = entryOf(out, id)
  c.applied = "edited" satisfies AppliedState
  c.resolved = true
  return out as T
}

/**
 * "Mark resolved & save": returns a copy without `conflicts`, `merge` and the
 * `merge/conflicts` feature. The body already holds every chosen side.
 *
 * @throws {ConflictError} `OPEN_CONFLICTS` when a conflict is not resolved (unless `force`).
 */
export function finishMerge<T extends KimoDocument | Doc>(
  doc: T,
  options: { force?: boolean } = {},
): T {
  const { open } = conflictCounts(doc)
  if (open > 0 && !options.force)
    throw new ConflictError("OPEN_CONFLICTS", `${open} conflict(s) are still open`)
  const out = clone(doc) as Doc
  delete out.conflicts
  delete out.merge
  if (Array.isArray(out.features)) {
    const rest = (out.features as unknown[]).filter((f) => f !== MERGE_FEATURE)
    if (rest.length > 0) out.features = rest
    else delete out.features
  }
  return out as T
}

/**
 * Stores conflicts in a merged document (what `kimo merge` writes): sets `conflicts`, `merge`
 * and declares the feature. With no conflicts, returns the document without them.
 */
export function attachConflicts<T extends KimoDocument | Doc>(
  doc: T,
  conflicts: Conflicts,
  info: MergeInfo = {},
): T {
  const out = clone(doc) as Doc
  if (Object.keys(conflicts).length === 0) {
    return finishMerge(out as T, { force: true })
  }
  out.conflicts = clone(conflicts)
  if (Object.keys(info).length > 0) out.merge = clone(info)
  else delete out.merge
  const features = Array.isArray(out.features) ? [...(out.features as string[])] : []
  if (!features.includes(MERGE_FEATURE)) features.push(MERGE_FEATURE)
  out.features = features
  return out as T
}

function entryOf(doc: Doc, id: string): Obj {
  const table = doc.conflicts
  if (!isObject(table) || !Object.hasOwn(table, id) || !isObject(table[id]))
    throw new ConflictError("NOT_FOUND", `No conflict "${id}"`, id)
  return table[id] as Obj
}

function nodesOf(doc: Doc): Obj {
  if (!isObject(doc.nodes)) doc.nodes = {}
  return doc.nodes as Obj
}

/** Ids of every node below `id` (by `parent` links). */
function descendants(nodes: Obj, ids: Iterable<string>): Set<string> {
  const children = new Map<string, string[]>()
  for (const [nid, n] of Object.entries(nodes)) {
    const p = isObject(n) ? n.parent : null
    if (typeof p === "string") {
      const list = children.get(p) ?? []
      list.push(nid)
      children.set(p, list)
    }
  }
  const out = new Set<string>()
  const stack = [...ids]
  while (stack.length > 0) {
    const cur = stack.pop() as string
    for (const c of children.get(cur) ?? []) {
      if (!out.has(c)) {
        out.add(c)
        stack.push(c)
      }
    }
  }
  return out
}

function applyInPlace(doc: Doc, id: string, side: ConflictSide, resolve: boolean): void {
  const entry = entryOf(doc, id)
  const conflict = entry as unknown as Conflict
  const v = sideValue(conflict, side)
  const fail = (why: string) => {
    throw new ConflictError("CANNOT_APPLY", `Conflict "${id}": ${why}`, id)
  }
  switch (conflict.kind) {
    case "prop": {
      const nodes = nodesOf(doc)
      const node = nodes[conflict.node]
      if (!isObject(node)) fail(`node ${conflict.node} is not in the document`)
      writePointer(node as Obj, pointerTokens(conflict.path), v)
      break
    }
    case "node": {
      const nodes = nodesOf(doc)
      const restored = isObject(conflict.restored) ? conflict.restored : {}
      if (v.present) {
        nodes[conflict.node] = clone(v.value)
        for (const [rid, rn] of Object.entries(restored))
          if (!Object.hasOwn(nodes, rid)) nodes[rid] = clone(rn)
      } else {
        const gone = [conflict.node, ...Object.keys(restored)]
        for (const d of descendants(nodes, gone)) gone.push(d)
        for (const g of gone) delete nodes[g]
      }
      break
    }
    case "move": {
      const nodes = nodesOf(doc)
      const node = nodes[conflict.node]
      if (!isObject(node)) fail(`node ${conflict.node} is not in the document`)
      const p = (v as { value: Placement }).value
      const n = node as Obj
      n.parent = p.parent
      n.order = p.order
      if (p.at !== undefined) n.at = p.at
      else delete n.at
      break
    }
    case "variable": {
      if (!isObject(doc.variables)) doc.variables = {}
      const vars = doc.variables as Obj
      if (!conflict.when) {
        if (v.present) vars[conflict.variable] = clone(v.value)
        else delete vars[conflict.variable]
        break
      }
      const variable = vars[conflict.variable]
      if (!isObject(variable)) fail(`variable ${conflict.variable} is not in the document`)
      const def = variable as Obj
      if (!Array.isArray(def.value)) fail(`variable ${conflict.variable} is not themed`)
      const entries = def.value as Obj[]
      const i = entries.findIndex((e) => isObject(e) && jsonEqual(e.when ?? {}, conflict.when))
      if (v.present) {
        if (i >= 0) (entries[i] as Obj).value = clone(v.value)
        else entries.push({ value: clone(v.value), when: clone(conflict.when) })
      } else if (i >= 0) {
        if (entries.length === 1) fail("cannot remove the last themed entry")
        entries.splice(i, 1)
      }
      break
    }
    case "header": {
      writePointer(doc, pointerTokens(conflict.path), v)
      break
    }
  }
  entry.applied = side
  if (resolve) entry.resolved = true
}

/**
 * True when the body still holds the conflict's `applied` side (always true for `edited`).
 * Used by the `CONFLICT_STALE` lint and by editors to notice hand edits.
 */
export function conflictMatchesBody(doc: KimoDocument | Doc, conflict: Conflict): boolean {
  if (conflict.applied === "edited") return true
  const v = sideValue(conflict, conflict.applied)
  const d = doc as Doc
  const nodes = isObject(d.nodes) ? d.nodes : {}
  const same = (actual: SideValue) =>
    actual.present === v.present &&
    (!actual.present || jsonEqual(actual.value, (v as { value: unknown }).value))
  switch (conflict.kind) {
    case "prop": {
      const node = nodes[conflict.node]
      if (!isObject(node)) return false
      return same(readPointer(node, pointerTokens(conflict.path)))
    }
    case "node":
      return same(
        Object.hasOwn(nodes, conflict.node)
          ? { present: true, value: nodes[conflict.node] }
          : { present: false },
      )
    case "move": {
      const node = nodes[conflict.node]
      if (!isObject(node) || !v.present) return false
      const p = v.value as Placement
      return node.parent === p.parent && node.order === p.order && node.at === p.at
    }
    case "variable": {
      const vars = isObject(d.variables) ? d.variables : {}
      const def = vars[conflict.variable]
      if (!conflict.when)
        return same(
          Object.hasOwn(vars, conflict.variable)
            ? { present: true, value: def }
            : { present: false },
        )
      if (!isObject(def) || !Array.isArray(def.value)) return false
      const e = (def.value as unknown[]).find(
        (x) => isObject(x) && jsonEqual(x.when ?? {}, conflict.when),
      ) as Obj | undefined
      return same(e ? { present: true, value: e.value } : { present: false })
    }
    case "header":
      return same(readPointer(d, pointerTokens(conflict.path)))
  }
}
