/**
 * Planners for variables, theme axes and theme pins (spec §10; M3, ADR 0011; desing.pen board
 * 14). Each returns a {@link Plan} for ONE `store.apply`.
 *
 * Grid model (board 14): one column per axis value. A cell (variable × `axis=value`) shows the
 * value of the last entry whose `when` is exactly `{ axis: value }`; multi-axis entries are
 * edited in the Entries list (whole `value` arrays, {@link planSetVariableValue}).
 */
import { isObject } from "../json"
import {
  effectiveTheme,
  isRef,
  isThemedValue,
  resolveVariable,
  splitQualified,
  type Theme,
} from "../resolve"
import type { KimoDocument, Variable } from "../schema/document"
import {
  fail,
  mapJson,
  nodeTable,
  ok,
  type Plan,
  type PlanContext,
  type PlanNote,
  type PlanOp,
} from "./plan"

type Rec = Record<string, unknown>
type Entry = { value: unknown; when?: Record<string, string> }

const vars = (doc: KimoDocument): Record<string, Rec> =>
  (doc.variables ?? {}) as unknown as Record<string, Rec>
const axes = (doc: KimoDocument): Record<string, string[]> =>
  (doc.themes ?? {}) as Record<string, string[]>

const setVar = (name: string, v: Rec): PlanOp => ({
  op: "setVariables",
  set: { [name]: v as unknown as Variable },
})

// --- Variables ------------------------------------------------------------------------------

/** New variable (board 14 "New variable" menu: Color / Number / String / Boolean). */
export function planCreateVariable(ctx: PlanContext, name: string, variable: Variable): Plan {
  if (Object.hasOwn(vars(ctx.doc), name)) return fail("CONFLICT", `"${name}" already exists`)
  const cyc = aliasCycle(ctx.doc, name, (variable as Rec).value)
  if (cyc) return fail("CYCLE", `Can't alias ${name} to itself — that would create a cycle`)
  return ok([setVar(name, variable as unknown as Rec)])
}

/** Patch of {@link planUpdateVariable}; `null` removes `group` / `description`. */
export interface VariablePatch {
  type?: Variable["type"]
  value?: unknown
  group?: string | null
  description?: string | null
}

/** Edits a variable's value, type, group (DTCG path) or description ("Edit details…"). */
export function planUpdateVariable(ctx: PlanContext, name: string, patch: VariablePatch): Plan {
  const cur = vars(ctx.doc)[name]
  if (!cur) return fail("NOT_FOUND", `Variable "${name}" does not exist`)
  const next: Rec = { ...cur }
  if (patch.type !== undefined) next.type = patch.type
  if (patch.value !== undefined) next.value = patch.value
  for (const k of ["group", "description"] as const) {
    const v = patch[k]
    if (v === null || v === "") delete next[k]
    else if (v !== undefined) next[k] = v
  }
  if (patch.value !== undefined && aliasCycle(ctx.doc, name, patch.value))
    return fail("CYCLE", `Can't alias ${name} to itself — that would create a cycle`)
  return ok([setVar(name, next)])
}

/** Replaces a variable's whole `value` (Entries list: add, remove, reorder, fallback). */
export function planSetVariableValue(ctx: PlanContext, name: string, value: unknown): Plan {
  return planUpdateVariable(ctx, name, { value: collapse(value) })
}

/**
 * Edits one grid cell: the value of `name` under `axisKey = axisValue`. `undefined` clears the
 * cell (removes the single-axis entries for it). A plain value becomes a themed value whose
 * first entry is the old value as the fallback; a themed value left with only its fallback
 * collapses back to a plain value.
 */
export function planSetCell(
  ctx: PlanContext,
  name: string,
  axisKey: string,
  axisValue: string,
  value: unknown,
): Plan {
  const cur = vars(ctx.doc)[name]
  if (!cur) return fail("NOT_FOUND", `Variable "${name}" does not exist`)
  const exact = (e: Entry) => {
    const w = e.when ?? {}
    const keys = Object.keys(w)
    return keys.length === 1 && w[axisKey] === axisValue
  }
  let entries: Entry[] = isThemedValue(cur.value)
    ? (structuredClone(cur.value) as Entry[])
    : [{ value: structuredClone(cur.value) }]
  if (value === undefined) entries = entries.filter((e) => !exact(e))
  else {
    let hit = -1
    entries.forEach((e, i) => {
      if (exact(e)) hit = i
    })
    if (hit >= 0) (entries[hit] as Entry).value = value
    else entries.push({ value, when: { [axisKey]: axisValue } })
  }
  return planSetVariableValue(ctx, name, entries)
}

/**
 * Renames a variable and rewrites every local binding to it (nodes, other variables'
 * aliases). A library's consumers are other files: renaming there breaks them (note).
 */
export function planRenameVariable(ctx: PlanContext, from: string, to: string): Plan {
  const all = vars(ctx.doc)
  if (!all[from]) return fail("NOT_FOUND", `Variable "${from}" does not exist`)
  if (from === to) return ok([])
  if (Object.hasOwn(all, to)) return fail("CONFLICT", `"${to}" already exists`)
  const swap = (v: unknown) => (isRef(v) && v.$ref === from ? { $ref: to } : v)
  const ops: PlanOp[] = rewriteNodes(ctx.doc, swap)
  const set: Record<string, Variable> = {}
  for (const [n, v] of Object.entries(all)) {
    const nv = mapJson(n === from ? v : v, swap) as Rec
    if (n === from) set[to] = nv as unknown as Variable
    else if (JSON.stringify(nv) !== JSON.stringify(v)) set[n] = nv as unknown as Variable
  }
  ops.push({ op: "setVariables", set, unset: [from] })
  const notes: PlanNote[] = []
  if (isObject(ctx.doc.meta) && ctx.doc.meta.library === true)
    notes.push({
      code: "BINDING_DETACHED",
      message: "Files that link this library and bind the old name will need updating",
    })
  return ok(ops, notes)
}

/** Duplicate (row menu): a copy under `to`. */
export function planDuplicateVariable(ctx: PlanContext, from: string, to: string): Plan {
  const cur = vars(ctx.doc)[from]
  if (!cur) return fail("NOT_FOUND", `Variable "${from}" does not exist`)
  if (Object.hasOwn(vars(ctx.doc), to)) return fail("CONFLICT", `"${to}" already exists`)
  return ok([setVar(to, structuredClone(cur))])
}

/**
 * Deletes a variable. While bound (nodes or aliases) it needs `detach: true`: every binding
 * becomes the literal it resolves to where it is used (nodes: their effective theme; aliases:
 * the entry's `when` over the defaults) — "Detach keeps the resolved literal".
 */
export function planDeleteVariable(
  ctx: PlanContext,
  name: string,
  options: { detach?: boolean } = {},
): Plan {
  if (!vars(ctx.doc)[name]) return fail("NOT_FOUND", `Variable "${name}" does not exist`)
  const uses = countBindings(ctx.doc, name)
  if (uses > 0 && !options.detach) return fail("IN_USE", `"${name}" is bound ${uses}×`)
  const det = detachBindings(ctx, name)
  if (!det.ok) return det
  return ok([...det.ops, { op: "setVariables", unset: [name] }], det.notes)
}

/** Detach alias (alias picker): entry `index` (or the plain value) becomes its literal. */
export function planDetachAlias(ctx: PlanContext, name: string, index: number | null): Plan {
  const cur = vars(ctx.doc)[name]
  if (!cur) return fail("NOT_FOUND", `Variable "${name}" does not exist`)
  const lib = ctx.libraries ?? {}
  const base = effectiveThemeOfRoot(ctx)
  if (index === null || !isThemedValue(cur.value)) {
    if (!isRef(cur.value)) return ok([])
    const r = resolveVariable(ctx.doc, cur.value.$ref, base, lib)
    if (!r.ok) return fail("INVALID", `"${cur.value.$ref}" can't be resolved (${r.reason})`)
    return ok([setVar(name, { ...cur, value: r.value })])
  }
  const entries = structuredClone(cur.value) as Entry[]
  const e = entries[index]
  if (!e) return fail("NOT_FOUND", `Entry ${index} does not exist`)
  if (!isRef(e.value)) return ok([])
  const r = resolveVariable(ctx.doc, e.value.$ref, { ...base, ...(e.when ?? {}) }, lib)
  if (!r.ok) return fail("INVALID", `"${e.value.$ref}" can't be resolved (${r.reason})`)
  e.value = r.value
  return ok([setVar(name, { ...cur, value: entries })])
}

// --- Theme axes -----------------------------------------------------------------------------

const LIB_AXIS = (k: string) => k.includes(":")

/** New theme axis (board 14 "Theme axis…"): the first value is the default. */
export function planCreateAxis(ctx: PlanContext, axis: string, values: readonly string[]): Plan {
  if (LIB_AXIS(axis)) return fail("LIBRARY_READ_ONLY", "Library axes are edited in the library")
  if (Object.hasOwn(axes(ctx.doc), axis)) return fail("CONFLICT", `Axis "${axis}" exists`)
  if (values.length === 0 || new Set(values).size !== values.length)
    return fail("INVALID", "An axis needs one or more distinct values")
  return ok([
    { op: "setThemes", set: { [axis]: [...values] } },
    ...axisOrder(ctx.doc, (o) => [...o, axis]),
  ])
}

/** Renames an axis: theme pins (incl. `set.theme` overrides) and `when` keys follow. */
export function planRenameAxis(ctx: PlanContext, from: string, to: string): Plan {
  const all = axes(ctx.doc)
  if (LIB_AXIS(from)) return fail("LIBRARY_READ_ONLY", "Library axes are edited in the library")
  if (!all[from]) return fail("NOT_FOUND", `Axis "${from}" does not exist`)
  if (Object.hasOwn(all, to)) return fail("CONFLICT", `Axis "${to}" exists`)
  const renameKey = (pins: Rec) => {
    const out: Rec = {}
    for (const [k, v] of Object.entries(pins)) out[k === from ? to : k] = v
    return out
  }
  const ops = rewritePins(ctx.doc, renameKey)
  ops.push(
    ...rewriteWhen(ctx.doc, (e) =>
      e.when ? { ...e, when: renameKey(e.when) as Entry["when"] } : e,
    ),
  )
  ops.push({ op: "setThemes", set: { [to]: [...(all[from] as string[])] }, unset: [from] })
  ops.push(...axisOrder(ctx.doc, (o) => o.map((a) => (a === from ? to : a))))
  return ok(ops)
}

/**
 * Deletes an axis. Pins on it are removed; entries keyed on its default value lose that key
 * (they now apply under every theme), other entries keyed on it are removed (notes).
 */
export function planDeleteAxis(ctx: PlanContext, axis: string): Plan {
  const all = axes(ctx.doc)
  if (LIB_AXIS(axis)) return fail("LIBRARY_READ_ONLY", "Library axes are edited in the library")
  const values = all[axis]
  if (!values) return fail("NOT_FOUND", `Axis "${axis}" does not exist`)
  const def = values[0]
  const notes: PlanNote[] = []
  const ops = rewritePins(ctx.doc, (pins) => {
    const out = { ...pins }
    delete out[axis]
    return out
  })
  ops.push(
    ...rewriteWhen(ctx.doc, (e, name) => {
      if (!e.when || !(axis in e.when)) return e
      if (e.when[axis] !== def) {
        notes.push({ code: "ENTRY_REMOVED", message: `Entry of "${name}" removed`, key: name })
        return null
      }
      const when = { ...e.when }
      delete when[axis]
      return Object.keys(when).length ? { value: e.value, when } : { value: e.value }
    }),
  )
  ops.push({ op: "setThemes", unset: [axis] })
  ops.push(...axisOrder(ctx.doc, (o) => o.filter((a) => a !== axis)))
  return ok(ops, notes)
}

/** Adds a value to an axis (at `index`, default last; 0 makes it the default). */
export function planAddAxisValue(ctx: PlanContext, axis: string, value: string, index?: number) {
  const values = axes(ctx.doc)[axis]
  if (LIB_AXIS(axis)) return fail("LIBRARY_READ_ONLY", "Library axes are edited in the library")
  if (!values) return fail("NOT_FOUND", `Axis "${axis}" does not exist`)
  if (values.includes(value)) return fail("CONFLICT", `"${value}" exists`)
  const next = [...values]
  next.splice(index ?? next.length, 0, value)
  return ok([{ op: "setThemes", set: { [axis]: next } }])
}

/** Moves a value (column drag; "Make default (moves first)" = index 0). */
export function planMoveAxisValue(ctx: PlanContext, axis: string, value: string, index: number) {
  const values = axes(ctx.doc)[axis]
  if (LIB_AXIS(axis)) return fail("LIBRARY_READ_ONLY", "Library axes are edited in the library")
  if (!values?.includes(value)) return fail("NOT_FOUND", `"${axis}=${value}" does not exist`)
  const next = values.filter((v) => v !== value)
  next.splice(Math.max(0, Math.min(index, next.length)), 0, value)
  return ok([{ op: "setThemes", set: { [axis]: next } }])
}

/** Renames a value: pins and `when` conditions follow. */
export function planRenameAxisValue(ctx: PlanContext, axis: string, from: string, to: string) {
  const values = axes(ctx.doc)[axis]
  if (LIB_AXIS(axis)) return fail("LIBRARY_READ_ONLY", "Library axes are edited in the library")
  if (!values?.includes(from)) return fail("NOT_FOUND", `"${axis}=${from}" does not exist`)
  if (values.includes(to)) return fail("CONFLICT", `"${to}" exists`)
  const fix = (pins: Rec) => (pins[axis] === from ? { ...pins, [axis]: to } : pins)
  const ops = rewritePins(ctx.doc, fix)
  ops.push(
    ...rewriteWhen(ctx.doc, (e) => (e.when ? { ...e, when: fix(e.when) as Entry["when"] } : e)),
  )
  ops.push({ op: "setThemes", set: { [axis]: values.map((v) => (v === from ? to : v)) } })
  return ok(ops)
}

/** Duplicate value (column menu): adds `to` after `from` and copies its entries. */
export function planDuplicateAxisValue(ctx: PlanContext, axis: string, from: string, to: string) {
  const values = axes(ctx.doc)[axis]
  if (LIB_AXIS(axis)) return fail("LIBRARY_READ_ONLY", "Library axes are edited in the library")
  if (!values?.includes(from)) return fail("NOT_FOUND", `"${axis}=${from}" does not exist`)
  if (values.includes(to)) return fail("CONFLICT", `"${to}" exists`)
  const next = [...values]
  next.splice(values.indexOf(from) + 1, 0, to)
  const ops: PlanOp[] = [{ op: "setThemes", set: { [axis]: next } }]
  const set: Record<string, Variable> = {}
  for (const [name, v] of Object.entries(vars(ctx.doc))) {
    if (!isThemedValue(v.value)) continue
    const entries = v.value as Entry[]
    const copies = entries
      .filter((e) => e.when?.[axis] === from)
      .map((e) => ({ value: structuredClone(e.value), when: { ...e.when, [axis]: to } }))
    if (copies.length) set[name] = { ...v, value: [...entries, ...copies] } as unknown as Variable
  }
  if (Object.keys(set).length) ops.push({ op: "setVariables", set })
  return ok(ops)
}

/**
 * Removes a value. Entries keyed on it are removed; pins on it need `force` (they are
 * removed, so those subtrees inherit again). The last value can't be removed.
 */
export function planRemoveAxisValue(
  ctx: PlanContext,
  axis: string,
  value: string,
  options: { force?: boolean } = {},
): Plan {
  const values = axes(ctx.doc)[axis]
  if (LIB_AXIS(axis)) return fail("LIBRARY_READ_ONLY", "Library axes are edited in the library")
  if (!values?.includes(value)) return fail("NOT_FOUND", `"${axis}=${value}" does not exist`)
  if (values.length === 1) return fail("INVALID", "An axis needs at least one value")
  const notes: PlanNote[] = []
  let pinned = 0
  const ops = rewritePins(ctx.doc, (pins) => {
    if (pins[axis] !== value) return pins
    pinned++
    const out = { ...pins }
    delete out[axis]
    return out
  })
  if (pinned > 0 && !options.force) return fail("IN_USE", `${pinned} layer(s) pin ${axis}=${value}`)
  if (pinned) notes.push({ code: "PIN_REMOVED", message: `${pinned} pin(s) removed` })
  ops.push(
    ...rewriteWhen(ctx.doc, (e, name) => {
      if (e.when?.[axis] !== value) return e
      notes.push({ code: "ENTRY_REMOVED", message: `Entry of "${name}" removed`, key: name })
      return null
    }),
  )
  ops.push({ op: "setThemes", set: { [axis]: values.filter((v) => v !== value) } })
  return ok(ops, notes)
}

// --- Theme pins -----------------------------------------------------------------------------

/**
 * Pins (or, with `null`, un-pins: "Inherit") axis `axisKey` on a real node's subtree (Theme
 * section, boards 11/14). Library axes are `alias:axis`. Inside an instance, pin through
 * `planSetOverride(…, { kind: "set", set: { theme } })` instead.
 */
export function planSetThemePin(
  ctx: PlanContext,
  nodeId: string,
  axisKey: string,
  value: string | null,
): Plan {
  const n = nodeTable(ctx.doc)[nodeId]
  if (!n) return fail("NOT_FOUND", `Node ${nodeId} does not exist`, nodeId)
  const { alias, name } = splitQualified(axisKey)
  if (value !== null) {
    let values: string[] | undefined
    if (alias === null) values = axes(ctx.doc)[name]
    else {
      if (!ctx.doc.imports || !Object.hasOwn(ctx.doc.imports, alias))
        return fail("NOT_FOUND", `Alias "${alias}" is not imported`)
      const lib = ctx.libraries?.[alias]
      if (!lib) return fail("LIBRARY_NOT_LOADED", `Library "${alias}" is not loaded`)
      values = (lib.themes as Record<string, string[]> | undefined)?.[name]
    }
    if (!values) return fail("NOT_FOUND", `Axis "${axisKey}" does not exist`)
    if (!values.includes(value)) return fail("NOT_FOUND", `"${axisKey}" has no value "${value}"`)
  }
  const pins: Rec = { ...(isObject(n.theme) ? n.theme : {}) }
  if (value === null) delete pins[axisKey]
  else pins[axisKey] = value
  return ok([
    { op: "update", id: nodeId, set: { theme: Object.keys(pins).length ? pins : undefined } },
  ])
}

// --- Helpers --------------------------------------------------------------------------------

/** Root meta key: display order of theme axes (string[]; the `themes` record sorts by name). */
export const THEMES_ORDER_META_KEY = "kimo.themes.order"

/** Theme axes in display order: `meta["kimo.themes.order"]` first, the rest by name. */
export function axisDisplayOrder(doc: Pick<KimoDocument, "themes" | "meta">): string[] {
  const names = Object.keys(doc.themes ?? {}).sort()
  const raw = (doc.meta as Record<string, unknown> | undefined)?.[THEMES_ORDER_META_KEY]
  const listed = Array.isArray(raw)
    ? raw.filter((a): a is string => typeof a === "string" && names.includes(a))
    : []
  return [...new Set([...listed, ...names])]
}

/** A `setHeader meta` op writing the new axis order (only when the document keeps one or it now needs one). */
function axisOrder(doc: KimoDocument, fn: (order: string[]) => string[]): PlanOp[] {
  const meta = { ...((doc.meta ?? {}) as Record<string, unknown>) }
  const next = fn(axisDisplayOrder(doc))
  const sorted = [...next].sort()
  if (!(THEMES_ORDER_META_KEY in meta) && JSON.stringify(next) === JSON.stringify(sorted)) return []
  meta[THEMES_ORDER_META_KEY] = next
  return [{ op: "setHeader", set: { meta } }]
}

/** Plain value for a themed value left with only a fallback entry. */
function collapse(value: unknown): unknown {
  if (!isThemedValue(value)) return value
  const entries = value as Entry[]
  if (entries.length === 1 && (!entries[0]?.when || Object.keys(entries[0].when).length === 0))
    return entries[0]?.value
  return value
}

/** True when setting `name`'s value to `value` would close a local alias cycle. */
function aliasCycle(doc: KimoDocument, name: string, value: unknown): boolean {
  const all = vars(doc)
  const targets = (v: unknown): string[] =>
    (isThemedValue(v) ? (v as Entry[]).map((e) => e.value) : [v])
      .filter(isRef)
      .map((r) => r.$ref)
      .filter((t) => !t.includes(":"))
  const stack = targets(value)
  const seen = new Set<string>()
  while (stack.length) {
    const t = stack.pop() as string
    if (t === name) return true
    if (seen.has(t)) continue
    seen.add(t)
    stack.push(...targets(all[t]?.value))
  }
  return false
}

/** Update ops for every node whose JSON changes under `fn` (bindings rewrite). */
function rewriteNodes(doc: KimoDocument, fn: (v: unknown) => unknown): PlanOp[] {
  const ops: PlanOp[] = []
  for (const [id, n] of Object.entries(nodeTable(doc))) {
    const set: Rec = {}
    for (const [k, v] of Object.entries(n)) {
      if (k === "meta" || k === "parent" || k === "order" || k === "type" || k === "at") continue
      const nv = mapJson(v, fn, k)
      if (JSON.stringify(nv) !== JSON.stringify(v)) set[k] = nv
    }
    if (Object.keys(set).length) ops.push({ op: "update", id, set })
  }
  return ops
}

/** Update ops rewriting theme pins: node `theme` and `set.theme` of overrides. */
function rewritePins(doc: KimoDocument, fn: (pins: Rec) => Rec): PlanOp[] {
  const ops: PlanOp[] = []
  const clean = (p: Rec) => (Object.keys(p).length ? p : undefined)
  for (const [id, n] of Object.entries(nodeTable(doc))) {
    const set: Rec = {}
    if (isObject(n.theme)) {
      const t = fn(n.theme)
      if (JSON.stringify(t) !== JSON.stringify(n.theme)) set.theme = clean(t)
    }
    if (isObject(n.overrides)) {
      let changed = false
      const ov: Rec = {}
      for (const [k, o] of Object.entries(n.overrides)) {
        if (isObject(o) && isObject(o.set) && isObject(o.set.theme)) {
          const t = fn(o.set.theme)
          if (JSON.stringify(t) !== JSON.stringify(o.set.theme)) {
            changed = true
            const s = { ...o.set, theme: clean(t) }
            if (s.theme === undefined) delete s.theme
            ov[k] = { set: s }
            continue
          }
        }
        ov[k] = o
      }
      if (changed) set.overrides = ov
    }
    if (Object.keys(set).length) ops.push({ op: "update", id, set })
  }
  return ops
}

/**
 * One `setVariables` op rewriting themed entries: `fn` returns the new entry, or null to drop
 * it. Values left with a single unconditioned entry collapse to plain values.
 */
function rewriteWhen(
  doc: KimoDocument,
  fn: (e: Entry, variable: string) => Entry | null,
): PlanOp[] {
  const set: Record<string, Variable> = {}
  for (const [name, v] of Object.entries(vars(doc))) {
    if (!isThemedValue(v.value)) continue
    const entries = (v.value as Entry[]).map((e) => fn(e, name)).filter((e): e is Entry => !!e)
    if (JSON.stringify(entries) === JSON.stringify(v.value)) continue
    set[name] = {
      ...v,
      value: entries.length ? collapse(entries) : (v.value as Entry[])[0]?.value,
    } as unknown as Variable
  }
  return Object.keys(set).length ? [{ op: "setVariables", set }] : []
}

function countBindings(doc: KimoDocument, name: string): number {
  let n = 0
  const count = (v: unknown) => {
    if (isRef(v) && v.$ref === name) n++
    return v
  }
  for (const node of Object.values(nodeTable(doc)))
    for (const [k, v] of Object.entries(node)) if (k !== "meta") mapJson(v, count, k)
  for (const [vn, v] of Object.entries(vars(doc))) if (vn !== name) mapJson(v.value, count)
  return n
}

function effectiveThemeOfRoot(ctx: PlanContext): Theme {
  return effectiveTheme({ ...ctx.doc, nodes: {} } as KimoDocument, "\u0000", ctx.libraries ?? {})
}

/** Replaces every binding to `name` with its resolved literal (nodes and aliases). */
function detachBindings(ctx: PlanContext, name: string): Plan {
  const lib = ctx.libraries ?? {}
  const ops: PlanOp[] = []
  const notes: PlanNote[] = []
  let failed: string | null = null
  for (const [id, n] of Object.entries(nodeTable(ctx.doc))) {
    const theme = effectiveTheme(ctx.doc, id, lib)
    const lit = (v: unknown) => {
      if (!isRef(v) || v.$ref !== name) return v
      const r = resolveVariable(ctx.doc, name, theme, lib)
      if (!r.ok) {
        failed = r.reason
        return v
      }
      return r.value
    }
    const set: Rec = {}
    for (const [k, v] of Object.entries(n)) {
      if (k === "meta" || k === "parent" || k === "order" || k === "type" || k === "at") continue
      const nv = mapJson(v, lit, k)
      if (JSON.stringify(nv) !== JSON.stringify(v)) set[k] = nv
    }
    if (Object.keys(set).length) {
      ops.push({ op: "update", id, set })
      notes.push({ code: "BINDING_DETACHED", message: `Detached on ${id}`, nodeId: id })
    }
  }
  const base = effectiveThemeOfRoot(ctx)
  const vset: Record<string, Variable> = {}
  for (const [vn, v] of Object.entries(vars(ctx.doc))) {
    if (vn === name) continue
    const lit = (val: unknown, when?: Record<string, string>) => {
      if (!isRef(val) || val.$ref !== name) return val
      const r = resolveVariable(ctx.doc, name, { ...base, ...(when ?? {}) }, lib)
      if (!r.ok) {
        failed = r.reason
        return val
      }
      return r.value
    }
    const value = isThemedValue(v.value)
      ? (v.value as Entry[]).map((e) => ({ ...e, value: lit(e.value, e.when) }))
      : lit(v.value)
    if (JSON.stringify(value) !== JSON.stringify(v.value))
      vset[vn] = { ...v, value } as unknown as Variable
  }
  if (failed) return fail("INVALID", `"${name}" can't be resolved everywhere (${failed})`)
  if (Object.keys(vset).length) ops.push({ op: "setVariables", set: vset })
  return ok(ops, notes)
}
