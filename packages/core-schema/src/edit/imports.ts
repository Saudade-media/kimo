/**
 * Planners for linked libraries (spec §11; M3, ADR 0011; desing.pen boards 13 and 15).
 * Libraries are read-only links re-read when the file opens; whether a library "changed since
 * last open" is an editor-cache concern (a local snapshot), never stored in the `.kimo`.
 */
import { isObject } from "../json"
import { effectiveTheme, isRef, isThemedValue, resolveVariable, splitQualified } from "../resolve"
import type { KimoDocument, Variable } from "../schema/document"
import { ALIAS_PATTERN, RELATIVE_PATH_PATTERN } from "../schema/primitives"
import { planDetachInstance } from "./components"
import {
  applyPlanInPlace,
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
const imports = (doc: KimoDocument): Record<string, string> =>
  (doc.imports ?? {}) as Record<string, string>

/** "Link library…" (Library manager footer): adds `imports[alias] = path`. */
export function planLinkLibrary(ctx: PlanContext, alias: string, path: string): Plan {
  if (!new RegExp(ALIAS_PATTERN).test(alias))
    return fail("INVALID", `"${alias}" is not a valid alias`)
  if (!new RegExp(RELATIVE_PATH_PATTERN).test(path))
    return fail("INVALID", "Library paths are relative to this file (./ or ../)")
  if (Object.hasOwn(imports(ctx.doc), alias)) return fail("CONFLICT", `Alias "${alias}" is in use`)
  return ok([{ op: "setHeader", set: { imports: { ...imports(ctx.doc), [alias]: path } } }])
}

/** "Locate…" for a missing library: points the alias at another path. */
export function planRelinkLibrary(ctx: PlanContext, alias: string, path: string): Plan {
  if (!Object.hasOwn(imports(ctx.doc), alias)) return fail("NOT_FOUND", `"${alias}" is not linked`)
  if (!new RegExp(RELATIVE_PATH_PATTERN).test(path))
    return fail("INVALID", "Library paths are relative to this file (./ or ../)")
  return ok([{ op: "setHeader", set: { imports: { ...imports(ctx.doc), [alias]: path } } }])
}

/** Everything in the consumer that references `alias` (Unlink confirm impact list). */
export interface LibraryUsage {
  instances: string[]
  bindings: number
  pins: number
  /** Override `set.of`, instance-prop args/defaults, slot suggestions naming the library. */
  references: number
}

/** Counts the consumer's references to a library. */
export function libraryUsage(doc: KimoDocument, alias: string): LibraryUsage {
  const usage: LibraryUsage = { instances: [], bindings: 0, pins: 0, references: 0 }
  const mine = (s: unknown) => typeof s === "string" && splitQualified(s).alias === alias
  for (const [id, n] of Object.entries(nodeTable(doc))) {
    if (n.type === "instance" && mine(n.of)) usage.instances.push(id)
    for (const [k, v] of Object.entries(n))
      if (k !== "meta")
        mapJson(
          v,
          (x, key) => {
            if (isRef(x) && mine(x.$ref)) usage.bindings++
            else if ((key === "theme" || key === "when") && isObject(x))
              usage.pins += Object.keys(x).filter(mine).length
            else if (key === "of" && mine(x) && k !== "of") usage.references++
            else if (key === "suggested" && Array.isArray(x))
              usage.references += x.filter(mine).length
            return x
          },
          k,
        )
  }
  for (const v of Object.values((doc.variables ?? {}) as Record<string, Rec>))
    mapJson(v.value, (x, key) => {
      if (isRef(x) && mine(x.$ref)) usage.bindings++
      if (key === "when" && isObject(x)) usage.pins += Object.keys(x).filter(mine).length
      return x
    })
  return usage
}

/**
 * Unlink (board 15 confirm "Detach all & unlink"): detaches every instance of the library's
 * components (repeatedly, so materialized nested library instances are detached too), turns
 * bindings to its variables into literals, removes its theme pins, `when` keys, slot
 * suggestions and instance-prop references, then removes the import. Needs the library (or the
 * editor's cached copy) in `ctx.libraries`: without it detach is unavailable ("locate the file
 * instead"). Undo restores everything (one transaction).
 */
export function planUnlinkLibrary(ctx: PlanContext, alias: string): Plan {
  if (!Object.hasOwn(imports(ctx.doc), alias)) return fail("NOT_FOUND", `"${alias}" is not linked`)
  const lib = ctx.libraries?.[alias]
  const usage = libraryUsage(ctx.doc, alias)
  if (!lib && (usage.instances.length > 0 || usage.bindings > 0))
    return fail(
      "LIBRARY_NOT_LOADED",
      "Without a cached copy, instances can't be detached — locate the file instead",
    )
  const mine = (s: unknown) => typeof s === "string" && splitQualified(s).alias === alias
  const ops: PlanOp[] = []
  const notes: PlanNote[] = []
  // One working copy, patched in place by each detach (no per-instance document copy).
  const doc = structuredClone(ctx.doc)
  const step = (p: Plan): Plan | null => {
    if (!p.ok) return p
    ops.push(...p.ops)
    notes.push(...p.notes)
    applyPlanInPlace(doc, p.ops)
    return null
  }
  // 1. Detach instances, outermost first. Library instances materialized by a detach (nested
  //    ones) are inserted by its ops, deeper than it, so they join the end of the queue.
  const nodes = nodeTable(doc)
  const depth = (id: string) => {
    let d = 0
    let p = nodes[id]?.parent
    while (typeof p === "string" && d < 1000) {
      d++
      p = nodes[p]?.parent
    }
    return d
  }
  const queue = Object.entries(nodes)
    .filter(([, n]) => n.type === "instance" && mine(n.of))
    .map(([id]) => [id, depth(id)] as const)
    .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1))
    .map(([id]) => id)
  for (let i = 0; i < queue.length && i < 100_000; i++) {
    const id = queue[i] as string
    const n = nodes[id]
    if (n?.type !== "instance" || !mine(n.of)) continue
    const p = planDetachInstance({ ...ctx, doc }, id)
    const err = step(p)
    if (err) return err
    if (p.ok)
      for (const op of p.ops)
        if (op.op === "insert" && op.node.type === "instance" && mine(op.node.of)) queue.push(op.id)
  }
  // 2. Bindings → literals (nodes: effective theme; variables: entry `when`).
  const libs = ctx.libraries ?? {}
  let failed: string | null = null
  const nodeOps: PlanOp[] = []
  // Effective themes top-down (memoized per node) instead of one root walk per node.
  const defaults = effectiveTheme({ ...doc, nodes: {} } as KimoDocument, "\u0000", libs)
  const themes = new Map<string, Record<string, string>>()
  const themeOf = (id: string, guard = 0): Record<string, string> => {
    const known = themes.get(id)
    if (known) return known
    const n = nodes[id]
    const parent = typeof n?.parent === "string" && guard < 1000 ? n.parent : null
    const t = { ...(parent !== null && nodes[parent] ? themeOf(parent, guard + 1) : defaults) }
    if (n && isObject(n.theme))
      for (const [k, v] of Object.entries(n.theme)) if (typeof v === "string") t[k] = v
    themes.set(id, t)
    return t
  }
  for (const [id, n] of Object.entries(nodes)) {
    const theme = themeOf(id)
    const set: Rec = {}
    for (const [k, v] of Object.entries(n)) {
      if (k === "meta" || k === "parent" || k === "order" || k === "type" || k === "at") continue
      const nv = mapJson(
        v,
        (x, key) => {
          if (isRef(x) && mine(x.$ref)) {
            const r = resolveVariable(doc, x.$ref, theme, libs)
            if (!r.ok) failed = r.reason
            return r.ok ? r.value : x
          }
          if ((key === "theme" || key === "when") && isObject(x)) {
            const out = { ...x }
            for (const pk of Object.keys(out)) if (mine(pk)) delete out[pk]
            return Object.keys(out).length ? out : undefined
          }
          if (key === "suggested" && Array.isArray(x)) {
            const out = x.filter((q) => !mine(q))
            return out.length ? out : undefined
          }
          if (key === "of" && k !== "of" && mine(x)) return undefined
          return x
        },
        k,
      )
      if (JSON.stringify(nv) !== JSON.stringify(v)) set[k] = nv
    }
    if (Object.keys(set).length) nodeOps.push({ op: "update", id, set })
  }
  // 3. Variables: aliases into the library become literals; library `when` keys are dropped
  //    (entries on a non-default library value are removed).
  const vset: Record<string, Variable> = {}
  for (const [name, v] of Object.entries((doc.variables ?? {}) as Record<string, Rec>)) {
    const theme = effectiveTheme({ ...doc, nodes: {} } as KimoDocument, "\u0000", libs)
    const lit = (x: unknown, when?: Record<string, string>) => {
      if (!isRef(x) || !mine(x.$ref)) return x
      const r = resolveVariable(doc, x.$ref, { ...theme, ...(when ?? {}) }, libs)
      if (!r.ok) failed = r.reason
      return r.ok ? r.value : x
    }
    let value: unknown
    if (isThemedValue(v.value)) {
      const out: { value: unknown; when?: Record<string, string> }[] = []
      for (const e of v.value as { value: unknown; when?: Record<string, string> }[]) {
        const when = { ...(e.when ?? {}) }
        let drop = false
        for (const k of Object.keys(when)) {
          if (!mine(k)) continue
          const axis = splitQualified(k).name
          const def = (lib?.themes as Record<string, string[]> | undefined)?.[axis]?.[0]
          if (when[k] !== def) drop = true
          delete when[k]
        }
        if (drop) {
          notes.push({ code: "ENTRY_REMOVED", message: `Entry of "${name}" removed`, key: name })
          continue
        }
        const entry: { value: unknown; when?: Record<string, string> } = {
          value: lit(e.value, e.when),
        }
        if (Object.keys(when).length) entry.when = when
        out.push(entry)
      }
      value = out
    } else value = lit(v.value)
    if (JSON.stringify(value) !== JSON.stringify(v.value)) vset[name] = { ...v, value } as Variable
  }
  if (failed) return fail("INVALID", `Some bindings into "${alias}" can't be resolved (${failed})`)
  ops.push(...nodeOps)
  if (Object.keys(vset).length) ops.push({ op: "setVariables", set: vset })
  if (usage.bindings)
    notes.push({ code: "BINDING_DETACHED", message: `${usage.bindings} binding(s) detached` })
  if (usage.pins) notes.push({ code: "PIN_REMOVED", message: `${usage.pins} pin(s) removed` })
  // 4. The import itself.
  const rest = { ...imports(ctx.doc) }
  delete rest[alias]
  ops.push(
    Object.keys(rest).length
      ? { op: "setHeader", set: { imports: rest } }
      : { op: "setHeader", unset: ["imports"] },
  )
  return ok(ops, notes)
}
