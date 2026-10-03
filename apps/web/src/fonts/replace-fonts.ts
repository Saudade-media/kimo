/**
 * "Replace 2 fonts" (board 19 Missing fonts dialog): one undoable edit that swaps every use of a
 * family for another: literal `font` values in node styles, text spans and instance overrides,
 * plus string / typography variables that feed a `font`. Bindings stay bindings (the variable's
 * value changes), so themes keep working.
 */
import type { Op } from "@kimo/editor-state"

type Json = unknown
type Mapping = Readonly<Record<string, string>>

const lc = (s: string) => s.toLowerCase()

function target(mapping: Mapping, family: unknown): string | undefined {
  if (typeof family !== "string") return undefined
  for (const [from, to] of Object.entries(mapping)) if (lc(from) === lc(family)) return to
  return undefined
}

/** Deep copy of `v` with `font` replaced per `mapping`; returns the same reference when unchanged. */
function rewrite(v: Json, mapping: Mapping, depth = 0): Json {
  if (depth > 12 || !v || typeof v !== "object") return v
  if (Array.isArray(v)) {
    let changed = false
    const out = v.map((x) => {
      const y = rewrite(x, mapping, depth + 1)
      if (y !== x) changed = true
      return y
    })
    return changed ? out : v
  }
  const o = v as Record<string, Json>
  let out: Record<string, Json> | null = null
  for (const [k, x] of Object.entries(o)) {
    let y: Json
    if (k === "font") y = target(mapping, x) ?? x
    else y = rewrite(x, mapping, depth + 1)
    if (y !== x) {
      out ??= { ...o }
      out[k] = y
    }
  }
  return out ?? v
}

/** Variables referenced as `font` (`{ font: { $ref } }`) or as `typography` anywhere in nodes. */
function fontVariableNames(nodes: Record<string, Json>): { font: Set<string>; typo: Set<string> } {
  const font = new Set<string>()
  const typo = new Set<string>()
  const walk = (v: Json, depth: number) => {
    if (depth > 12 || !v || typeof v !== "object") return
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1)
      return
    }
    for (const [k, x] of Object.entries(v as Record<string, Json>)) {
      const ref = x && typeof x === "object" ? (x as { $ref?: unknown }).$ref : undefined
      if (typeof ref === "string" && k === "font") font.add(ref)
      else if (typeof ref === "string" && k === "typography") typo.add(ref)
      else walk(x, depth + 1)
    }
  }
  for (const n of Object.values(nodes)) walk(n, 0)
  return { font, typo }
}

/**
 * Ops replacing families per `mapping` (`{ "Söhne": "Inter" }`) in `doc`. Apply them in one
 * `store.apply(ops, …)` for a single undo step. Returns [] when nothing uses the families.
 */
export function replaceFontOps(
  doc: { nodes?: Record<string, Json>; variables?: Record<string, Json> },
  mapping: Mapping,
): Op[] {
  if (!Object.keys(mapping).length) return []
  const ops: Op[] = []
  const nodes = doc.nodes ?? {}
  for (const [id, node] of Object.entries(nodes)) {
    if (!node || typeof node !== "object") continue
    const set: Record<string, Json> = {}
    for (const [field, value] of Object.entries(node as Record<string, Json>)) {
      if (field === "parent" || field === "order" || field === "type" || field === "at") continue
      const next = rewrite(value, mapping)
      if (next !== value) set[field] = next
    }
    if (Object.keys(set).length) ops.push({ op: "update", id, set })
  }
  const vars = doc.variables ?? {}
  const used = fontVariableNames(nodes)
  const varSet: Record<string, Json> = {}
  for (const [name, variable] of Object.entries(vars)) {
    const v = variable as { type?: string; value?: Json }
    if (v.type === "string" && used.font.has(name)) {
      const swap = (x: Json) => target(mapping, x) ?? x
      const value = Array.isArray(v.value)
        ? v.value.map((e) => ({ ...(e as object), value: swap((e as { value: Json }).value) }))
        : swap(v.value)
      if (JSON.stringify(value) !== JSON.stringify(v.value)) varSet[name] = { ...v, value }
    } else if (v.type === "typography" && used.typo.has(name)) {
      const value = rewrite(v.value, mapping)
      if (value !== v.value) varSet[name] = { ...v, value }
    }
  }
  if (Object.keys(varSet).length)
    ops.push({ op: "setVariables", set: varSet as Record<string, never> })
  return ops
}

/** Default "Replace with…" choice: JetBrains Mono for monospaced names, else Inter. */
export function suggestReplacement(family: string): string {
  return /mono|code|courier|console|typewriter/i.test(family) ? "JetBrains Mono" : "Inter"
}
