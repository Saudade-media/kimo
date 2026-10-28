/**
 * Board 27 §7 "Variable binding everywhere" (H7PYY): the pure model behind bindable property
 * fields — which variables a field may bind (type-filtered, local + imported libraries), how a
 * binding resolves and displays, and what Detach writes. No React here (unit-tested).
 *
 * Rules (TWxWq): number / string / boolean fields bind like colours do; library variables bind
 * as `{ $ref: "alias:name" }` and resolve through the import; a renamed / missing variable keeps
 * its last resolved value; Detach writes the currently resolved value as a literal; bound values
 * re-resolve per node theme.
 *
 * Panel-bindable (docs/guide/components/variables-and-themes.md "What can be bound"):
 * number — W/H (fixed), opacity, corner radius, stroke width, gap, row gap, padding (axis pairs
 * and each side), font size, font weight, line height, letter spacing, icon weight / stroke
 * width, shadow x / y / blur / spread, blur radius; string — text content, font family;
 * boolean — visibility, clip content. The format also binds per-corner radius, per-side stroke
 * widths and icon names (agents / files; rendered and exported).
 * Not bindable in format 1.0 (no affordance): X / Y, rotation, wrap, polygon sides, image URL.
 */
import {
  type KimoDocument,
  type Libraries,
  resolveVariable,
  splitQualified,
  type Theme,
} from "@kimo/core-schema"
import type { DocHeader } from "../lib/header"
import { formatNumber } from "./props"

export type BindType = "number" | "string" | "boolean"

/** Variable types a field of each kind accepts (schema REF_TYPES: numbers take dimensions). */
const ACCEPTS: Readonly<Record<BindType, readonly string[]>> = {
  number: ["number", "dimension"],
  string: ["string"],
  boolean: ["boolean"],
}

type Ref = { $ref: string }

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

const isRef = (v: unknown): v is Ref =>
  isObj(v) && typeof v.$ref === "string" && Object.keys(v).length === 1

/** The binding shared by every value, or null (literals, Mixed, or different bindings). */
export function sharedRef(values: readonly unknown[]): string | null {
  if (values.length === 0) return null
  const first = values[0]
  if (!isRef(first)) return null
  for (const v of values) if (!isRef(v) || v.$ref !== first.$ref) return null
  return first.$ref
}

/** Display name of a binding target: `space/4`, a library's `alias:space/md` → `brand/space/md`. */
export function refName(ref: string): string {
  const { alias, name } = splitQualified(ref)
  return alias === null ? name : `${alias}/${name}`
}

/** A dimension variable's px value, a number as-is; anything else null. */
function numberOf(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (isObj(v) && typeof v.value === "number" && v.unit === "px") return v.value
  return null
}

/** Coerces a resolved variable value to the field's literal type (null when it can't). */
function literalOf(type: BindType, v: unknown): number | string | boolean | null {
  if (type === "number") return numberOf(v)
  if (type === "string") return typeof v === "string" ? v : null
  return typeof v === "boolean" ? v : null
}

/** Picker row / chip text of a resolved value. */
export function valueText(type: BindType, v: unknown): string {
  const lit = literalOf(type, v)
  if (lit === null) return "—"
  if (typeof lit === "number") return formatNumber(lit)
  return String(lit)
}

interface Resolved {
  ok: boolean
  /** The literal for the field's type (null when unresolved / wrong type). */
  value: number | string | boolean | null
  /** The variable no longer exists (renamed / deleted / unknown alias): $danger chip. */
  missing: boolean
  /** Next hop when the variable is an alias (`→ target`). */
  aliasOf: string | null
}

/**
 * Last successfully resolved value per binding target: a renamed / missing variable keeps
 * showing (and detaches to) the value it had (rule h4bLV "last value kept").
 */
const lastResolved = new Map<string, number | string | boolean>()

/** Resolves `ref` for a field of `type` under `theme`. */
export function resolveRef(
  header: DocHeader,
  libraries: Libraries,
  ref: string,
  type: BindType,
  theme: Theme,
): Resolved {
  const r = resolveVariable(header as unknown as KimoDocument, ref, theme, libraries)
  if (r.ok) {
    const value = literalOf(type, r.value)
    if (value !== null) lastResolved.set(ref, value)
    return { ok: value !== null, value, missing: false, aliasOf: r.chain[1] ?? null }
  }
  const missing =
    r.reason === "VARIABLE_MISSING" || r.reason === "ALIAS_UNKNOWN" || r.reason === "VARIABLE_CYCLE"
  return { ok: false, value: lastResolved.get(ref) ?? null, missing, aliasOf: null }
}

/** Testing hook: forget remembered values. */
export function clearResolvedCache(): void {
  lastResolved.clear()
}

interface PickerItem {
  ref: string
  name: string
  value: string
  alias?: boolean
}

interface PickerGroup {
  key: string
  title: string
  meta: string
  library?: boolean
  items: PickerItem[]
}

function itemsOf(
  header: DocHeader,
  libraries: Libraries,
  vars: Readonly<Record<string, unknown>>,
  type: BindType,
  theme: Theme,
  qualify: (name: string) => string,
): PickerItem[] {
  return Object.keys(vars)
    .filter((k) => {
      const v = vars[k]
      return isObj(v) && ACCEPTS[type].includes(String(v.type))
    })
    .sort()
    .map((k) => {
      const ref = qualify(k)
      const r = resolveRef(header, libraries, ref, type, theme)
      if (r.aliasOf)
        return { ref, name: refName(ref), value: `→ ${refName(r.aliasOf)}`, alias: true }
      return { ref, name: refName(ref), value: r.value === null ? "—" : valueText(type, r.value) }
    })
}

/**
 * The picker's groups for a field of `type` (rule wDOBf): "This file" first (meta = count),
 * then each imported library by alias (meta = its path from `imports`), libraries sorted by
 * alias. Empty groups are dropped.
 */
export function pickerGroups(
  header: DocHeader,
  libraries: Libraries,
  type: BindType,
  theme: Theme,
): PickerGroup[] {
  const out: PickerGroup[] = []
  const local = itemsOf(
    header,
    libraries,
    (header.variables ?? {}) as Record<string, unknown>,
    type,
    theme,
    (n) => n,
  )
  if (local.length)
    out.push({ key: "", title: "This file", meta: String(local.length), items: local })
  const imports = (header.imports ?? {}) as Record<string, string>
  for (const alias of Object.keys(imports).sort()) {
    const lib = libraries[alias]
    if (!lib) continue
    const items = itemsOf(
      header,
      libraries,
      (lib.variables ?? {}) as Record<string, unknown>,
      type,
      theme,
      (n) => `${alias}:${n}`,
    )
    if (items.length)
      out.push({ key: alias, title: alias, meta: imports[alias] ?? "", library: true, items })
  }
  return out
}

/** Every variable name (`variables` keys) of the document. */
const localNames = (header: DocHeader) => Object.keys((header.variables ?? {}) as object)

/**
 * Name for "Create variable from <value>": `<base>/<value>` (`gap/16`, `opacity/64`), made
 * unique with `-2`, `-3`, … Strings and booleans use `<base>/value`.
 */
export function newVariableName(
  header: DocHeader,
  base: string,
  value: number | string | boolean,
): string {
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  const leaf = typeof value === "number" ? formatNumber(value).replace(".", "_") : "value"
  const want = `${slug || "var"}/${leaf}`
  const taken = new Set(localNames(header))
  if (!taken.has(want)) return want
  for (let i = 2; ; i++) if (!taken.has(`${want}-${i}`)) return `${want}-${i}`
}

/** The variable definition "Create variable" writes (numbers as `number`, never dimension). */
export function newVariable(type: BindType, value: number | string | boolean) {
  return { type, value }
}

// --- Composite fields: padding sides, stroke sides, radius corners ------------------------------

/** Raw `[t, r, b, l]` of a `layout.pad` value, bindings kept (absent / invalid = 0). */
export function padSidesRaw(pad: unknown): [unknown, unknown, unknown, unknown] {
  if (typeof pad === "number" || isRef(pad)) return [pad, pad, pad, pad]
  if (Array.isArray(pad) && pad.length === 2) return [pad[0], pad[1], pad[0], pad[1]]
  if (Array.isArray(pad) && pad.length === 4) return [pad[0], pad[1], pad[2], pad[3]]
  return [0, 0, 0, 0]
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Shortest stored padding for raw sides (bindings kept): one value, `[v, h]`, or four. */
export function padValueRaw(
  [t, r, b, l]: readonly [unknown, unknown, unknown, unknown],
  individual: boolean,
): unknown {
  if (individual) return [t, r, b, l]
  if (same(t, r) && same(r, b) && same(b, l)) return t === 0 ? undefined : t
  if (same(t, b) && same(r, l)) return [t, r]
  return [t, r, b, l]
}

// --- Detach all (layer context menu, rule RAez2) ------------------------------------------------

/** Keys never rewritten by "Detach all variables" (identity / tree / nested override maps). */
const DETACH_SKIP = new Set(["type", "parent", "at", "order", "component", "overrides", "page"])

/** True when `v` holds a binding at any depth. */
function hasBinding(v: unknown, depth = 0): boolean {
  if (depth > 32 || v === null || typeof v !== "object") return false
  if (isRef(v)) return true
  if (Array.isArray(v)) return v.some((x) => hasBinding(x, depth + 1))
  return Object.values(v as Record<string, unknown>).some((x) => hasBinding(x, depth + 1))
}

/** True when a node holds a binding in any detachable field. */
export function nodeHasBinding(node: Readonly<Record<string, unknown>>): boolean {
  for (const [k, v] of Object.entries(node)) if (!DETACH_SKIP.has(k) && hasBinding(v)) return true
  return false
}

/**
 * The node fields with every binding replaced by its resolved literal (`resolve` returns
 * undefined for an unresolvable binding, which is then kept). A dimension resolves to its px
 * number. `style.typography` merges the typography's fields under the inline ones. Returns only
 * the changed top-level keys; empty when nothing changed.
 */
export function detachAllFields(
  node: Readonly<Record<string, unknown>>,
  resolve: (ref: string) => unknown,
): Record<string, unknown> {
  const literal = (v: unknown, key: string | null): unknown => {
    const r = resolve((v as Ref).$ref)
    if (r === undefined) return v
    // A dimension in a number field is its px number.
    if (key !== "value" && numberOf(r) !== null && isObj(r)) return numberOf(r)
    return r
  }
  const walk = (v: unknown, key: string | null, depth: number): unknown => {
    if (depth > 32) return v
    if (isRef(v)) return literal(v, key)
    if (Array.isArray(v)) return v.map((x) => walk(x, key, depth + 1))
    if (!isObj(v)) return v
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) {
      if (k === "typography" && isRef(x)) continue
      out[k] = walk(x, k, depth + 1)
    }
    if (isRef(v.typography)) {
      const t = resolve(v.typography.$ref)
      if (isObj(t)) {
        const base = walk(t, null, depth + 1) as Record<string, unknown>
        return { ...base, ...out }
      }
      out.typography = v.typography
    }
    return out
  }
  const changed: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(node)) {
    if (DETACH_SKIP.has(k) || !hasBinding(v)) continue
    const next = walk(v, k, 0)
    if (JSON.stringify(next) !== JSON.stringify(v)) changed[k] = next
  }
  return changed
}
