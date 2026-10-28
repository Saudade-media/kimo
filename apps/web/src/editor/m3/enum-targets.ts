/**
 * Enum prop targets (desing.pen board 27 §8 (a) `e0wsU`, rule FZirR "Enum targets"): each option
 * owns a list of targets Layer × Property × Value. Stored as the PropDef's `targets` (spec §9.6:
 * option → `{target, field, value}[]`, `field` may be `<property>/<key>`); a legacy single
 * target (`target`/`field`/`options`) reads as one target per option and is rewritten to
 * `targets` on the first edit ("old opacity-only files migrate to one opacity target per
 * option").
 *
 * A UI Property maps to one or more stored fields (Size → `w` + `h`); rows are the stored
 * entries grouped back into properties. Pure (unit-tested).
 */
import { isNodeType, isRef, nodeKeys } from "@kimo/core-schema"

type Rec = Record<string, unknown>
const isObj = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v)

type PropertyKind = "number" | "pad" | "color" | "boolean" | "string" | "radius"

/** A Property of the target picker (rule FZirR: "filtered to what that layer supports"). */
interface TargetProperty {
  key: string
  label: string
  /** Stored fields (`<property>` or `<property>/<key>`); one row writes all of them. */
  fields: readonly string[]
  kind: PropertyKind
  /** Node types it is offered for (`*` = any type that has the top-level property). */
  types: readonly string[] | "*"
}

/**
 * Catalog, in picker order. Multi-field properties come first so grouping prefers them.
 */
export const TARGET_PROPERTIES: readonly TargetProperty[] = [
  { key: "size", label: "Size", fields: ["w", "h"], kind: "number", types: ["icon"] },
  { key: "w", label: "Width", fields: ["w"], kind: "number", types: "*" },
  { key: "h", label: "Height", fields: ["h"], kind: "number", types: "*" },
  { key: "pad", label: "Padding", fields: ["layout/pad"], kind: "pad", types: ["frame"] },
  { key: "gap", label: "Gap", fields: ["layout/gap"], kind: "number", types: ["frame"] },
  { key: "radius", label: "Radius", fields: ["radius"], kind: "radius", types: "*" },
  { key: "opacity", label: "Opacity", fields: ["opacity"], kind: "number", types: "*" },
  { key: "fill", label: "Fill", fields: ["fill"], kind: "color", types: "*" },
  { key: "color", label: "Color", fields: ["color"], kind: "color", types: ["icon"] },
  { key: "fontSize", label: "Font size", fields: ["style/size"], kind: "number", types: ["text"] },
  {
    key: "fontWeight",
    label: "Font weight",
    fields: ["style/weight"],
    kind: "number",
    types: ["text"],
  },
  { key: "visible", label: "Visibility", fields: ["visible"], kind: "boolean", types: "*" },
  { key: "content", label: "Text", fields: ["content"], kind: "string", types: ["text"] },
  { key: "icon", label: "Icon", fields: ["icon"], kind: "string", types: ["icon"] },
]

/** Instance layers take single-level `props/<field>` targets of these properties. */
const INSTANCE_PROPERTIES = new Set(["w", "h", "radius", "opacity", "fill", "visible"])

/** The stored field of property field `f` on a layer of `type` (instances: `props/<f>`). */
function storedField(type: string, f: string): string {
  return type === "instance" ? `props/${f}` : f
}

/** Properties a layer of `type` supports. */
export function propertiesFor(type: string): TargetProperty[] {
  if (type === "instance") return TARGET_PROPERTIES.filter((p) => INSTANCE_PROPERTIES.has(p.key))
  if (!isNodeType(type)) return []
  const keys = nodeKeys(type)
  return TARGET_PROPERTIES.filter(
    (p) =>
      (p.types === "*" || p.types.includes(type)) &&
      p.fields.every((f) => keys.has(f.split("/")[0] as string)),
  )
}

/** One stored target. */
interface StoredTarget {
  target: string
  field: string
  value: unknown
}

/** Option names in declaration order. */
export function optionNames(def: Rec): string[] {
  return isObj(def.options) ? Object.keys(def.options) : []
}

/**
 * Option → its stored targets: the legacy single target (when present) first, then `targets`.
 */
export function targetsByOption(def: Rec): Record<string, StoredTarget[]> {
  const out: Record<string, StoredTarget[]> = {}
  const options = isObj(def.options) ? def.options : {}
  for (const o of Object.keys(options)) {
    const list: StoredTarget[] = []
    if (typeof def.target === "string" && typeof def.field === "string")
      list.push({ target: def.target, field: def.field, value: options[o] })
    const extra = isObj(def.targets) ? def.targets[o] : undefined
    if (Array.isArray(extra))
      for (const t of extra)
        if (isObj(t) && typeof t.target === "string" && typeof t.field === "string")
          list.push({ target: t.target, field: t.field, value: t.value })
    out[o] = list
  }
  return out
}

/** One editor row: a layer, a catalog property (or a raw field), its value. */
export interface TargetRow {
  layer: string
  /** Catalog key, or `field:<stored field>` for a field outside the catalog. */
  property: string
  value: unknown
}

/** Groups stored targets into rows (Size = `w` + `h` with one value). `typeOf` gives a layer's type. */
export function rowsOf(list: readonly StoredTarget[], typeOf: (id: string) => string): TargetRow[] {
  const rows: TargetRow[] = []
  const used = new Set<number>()
  list.forEach((t, i) => {
    if (used.has(i)) return
    const type = typeOf(t.target)
    const props = propertiesFor(type)
    // A multi-field property whose fields are all present with one value on the same layer.
    for (const p of props) {
      const fields = p.fields.map((f) => storedField(type, f))
      if (!fields.includes(t.field)) continue
      const idx = fields.map((f) =>
        list.findIndex(
          (x, j) =>
            !used.has(j) &&
            x.target === t.target &&
            x.field === f &&
            JSON.stringify(x.value) === JSON.stringify(t.value),
        ),
      )
      if (idx.some((j) => j < 0)) continue
      for (const j of idx) used.add(j)
      rows.push({ layer: t.target, property: p.key, value: t.value })
      return
    }
    used.add(i)
    rows.push({ layer: t.target, property: `field:${t.field}`, value: t.value })
  })
  return rows
}

/** Rows → stored targets (each row writes every field of its property). */
export function storedOf(
  rows: readonly TargetRow[],
  typeOf: (id: string) => string,
): StoredTarget[] {
  const out: StoredTarget[] = []
  for (const r of rows) {
    if (r.property.startsWith("field:")) {
      out.push({ target: r.layer, field: r.property.slice(6), value: r.value })
      continue
    }
    const type = typeOf(r.layer)
    const p = TARGET_PROPERTIES.find((x) => x.key === r.property)
    if (!p) continue
    for (const f of p.fields)
      out.push({ target: r.layer, field: storedField(type, f), value: structuredClone(r.value) })
  }
  return out
}

/**
 * The PropDef with option `option`'s targets replaced (targets form: the legacy single target
 * moves into `targets`, option values become `null`).
 */
export function withOptionTargets(def: Rec, option: string, list: readonly StoredTarget[]): Rec {
  const all = targetsByOption(def)
  all[option] = list.map((t) => ({ ...t }))
  return targetsForm(def, all)
}

/** Rewrites `def` in targets form with `all` (option → targets; option order = keys of `all`). */
function targetsForm(def: Rec, all: Record<string, readonly StoredTarget[]>): Rec {
  const next: Rec = { ...def }
  delete next.target
  delete next.field
  const options: Rec = {}
  const targets: Rec = {}
  for (const [o, list] of Object.entries(all)) {
    options[o] = null
    if (list.length)
      targets[o] = list.map((t) => ({ target: t.target, field: t.field, value: t.value }))
  }
  next.options = options
  next.targets = targets
  return next
}

/** Adds option `name` (empty targets) after the others. */
export function withOption(def: Rec, name: string): Rec {
  return targetsForm(def, { ...targetsByOption(def), [name]: [] })
}

/** Renames option `from` to `to` (`null` removes it; the last option is kept). */
export function withOptionRenamed(def: Rec, from: string, to: string | null): Rec | null {
  const all = targetsByOption(def)
  if (!Object.hasOwn(all, from)) return null
  if (to === null) {
    if (Object.keys(all).length <= 1) return null
    delete all[from]
    return targetsForm(def, all)
  }
  if (Object.hasOwn(all, to)) return null
  const renamed: Record<string, StoredTarget[]> = {}
  for (const [o, l] of Object.entries(all)) renamed[o === from ? to : o] = l
  return targetsForm(def, renamed)
}

// --- Values ---------------------------------------------------------------------------------

/** Display text of a value ("8 · 14", "14", "$space/md", "#FF5500", "true"). */
export function valueText(v: unknown): string {
  if (v === undefined || v === null) return ""
  if (isRef(v)) return `$${v.$ref}`
  if (Array.isArray(v)) return v.map((x) => valueText(x)).join(" · ")
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v)
  return JSON.stringify(v)
}

/**
 * Parses an edited value for a property kind: `$name` / `{name}` bind a variable; numbers and
 * "8 14" / "8 · 14" lists for pad/radius; colors as hex; booleans; else the text. Null when the
 * text does not fit the kind.
 */
export function parseValue(text: string, kind: PropertyKind | null): unknown {
  const t = text.trim()
  const ref = /^\$([^\s]+)$/.exec(t) ?? /^\{([^\s{}]+)\}$/.exec(t)
  if (ref) return { $ref: ref[1] }
  const nums = t
    .split(/\s*·\s*|\s+|,\s*/)
    .filter(Boolean)
    .map(Number)
  const allNums = nums.length > 0 && nums.every((n) => Number.isFinite(n))
  switch (kind) {
    case "number":
      return allNums && nums.length === 1 ? nums[0] : null
    case "pad":
    case "radius":
      if (!allNums || nums.length > 4) return null
      return nums.length === 1 ? nums[0] : nums
    case "color": {
      const h = t.startsWith("#") ? t : `#${t}`
      return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(h) ? h.toUpperCase() : null
    }
    case "boolean":
      return /^(true|on|yes|1|visible|shown)$/i.test(t)
        ? true
        : /^(false|off|no|0|hidden)$/i.test(t)
          ? false
          : null
    case "string":
      return t
    default:
      if (allNums) return nums.length === 1 ? nums[0] : nums
      try {
        return JSON.parse(t)
      } catch {
        return t
      }
  }
}

/** The kind of a row's property (raw fields: null = free). */
export function kindOf(property: string): PropertyKind | null {
  return TARGET_PROPERTIES.find((p) => p.key === property)?.kind ?? null
}

/** The current value of `field` on node data (`<property>/<key>` reads into the struct). */
function readField(node: Rec | undefined, field: string): unknown {
  if (!node) return undefined
  const [top, sub] = field.split("/") as [string, string | undefined]
  const v =
    top === "props" && sub !== undefined
      ? isObj(node.props)
        ? node.props[sub]
        : undefined
      : node[top]
  if (sub === undefined || top === "props") return v
  return isObj(v) ? v[sub] : undefined
}

/**
 * "default: <option>": the option every target of which already equals the main's own values
 * (an instance without the arg renders as authored, §9.6), else "as authored".
 */
export function defaultOptionLabel(def: Rec, nodeOf: (id: string) => Rec | undefined): string {
  const all = targetsByOption(def)
  for (const [o, list] of Object.entries(all))
    if (
      list.length > 0 &&
      list.every(
        (t) => JSON.stringify(readField(nodeOf(t.target), t.field)) === JSON.stringify(t.value),
      )
    )
      return `default: ${o}`
  return "default: as authored"
}
