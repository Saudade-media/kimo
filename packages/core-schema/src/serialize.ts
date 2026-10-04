/**
 * Canonical serialization (teardown 10.2, spec section "Serialization").
 *
 * Output is a pure function of the document's data: object keys in canonical order, one
 * line per header member, one line per table entry (`variables`, `assets`, `conflicts`, `nodes`) with the
 * separating comma at the start of the line and a blank line between entries, LF line
 * endings and a trailing newline. `serialize(parse(s)) === s` for every canonical `s`.
 */
import { stripDefaults } from "./defaults-ops"
import { isObject, type JsonValue, KimoParseError, parseJson, setOwn } from "./json"
import type { KimoDocument } from "./schema/document"

/**
 * Canonical key order for schema-defined ("struct") objects. Keys are ranked by this single
 * global list, whatever object they belong to; keys not in the list follow, sorted by code
 * unit, and everything below an unlisted key is ordered purely by code unit.
 */
export const KEY_ORDER: readonly string[] = [
  "$schema",
  "format",
  "type",
  "kind",
  "space",
  "mode",
  "$ref",
  "stops",
  "parent",
  "at",
  "order",
  "name",
  "library",
  "createdWith",
  "of",
  "component",
  "placeholder",
  "by",
  "since",
  "locked",
  "text",
  "inner",
  "x",
  "y",
  "position",
  "w",
  "t",
  "r",
  "g",
  "b",
  "l",
  "c",
  "h",
  "alpha",
  "fallback",
  "font",
  "center",
  "size",
  "weight",
  "strokeWidth",
  "min",
  "max",
  "italic",
  "lineHeight",
  "px",
  "letterSpacing",
  "rotation",
  "flipX",
  "flipY",
  "theme",
  "props",
  "args",
  "overrides",
  "content",
  "grow",
  "style",
  "set",
  "icon",
  "d",
  "fillRule",
  "viewBox",
  "sides",
  "innerRadius",
  "startAngle",
  "sweepAngle",
  "src",
  "inputs",
  "url",
  "device",
  "zoom",
  "scrollX",
  "scrollY",
  "model",
  "radius",
  "clip",
  "cols",
  "rows",
  "colors",
  "points",
  "interpolation",
  "fit",
  "crop",
  "uniforms",
  "blur",
  "spread",
  "color",
  "opacity",
  "blend",
  "visible",
  "fill",
  "stroke",
  "effects",
  "dir",
  "gap",
  "crossGap",
  "pad",
  "justify",
  "mime",
  "bytes",
  "paint",
  "width",
  "height",
  "align",
  "valign",
  "cap",
  "join",
  "miterLimit",
  "dash",
  "wrap",
  "includeStroke",
  "layout",
  "slot",
  "suggested",
  "replace",
  "decoration",
  "case",
  "features",
  "href",
  "typography",
  "value",
  "unit",
  "when",
  "description",
  "group",
  "target",
  "field",
  "default",
  "options",
  "meta",
  "themes",
  "imports",
  "variables",
  "assets",
  "components",
  "nodes",
]

const RANK = new Map(KEY_ORDER.map((k, i) => [k, i]))

/** Keys whose object value is a record (keys are data): sorted by code unit. */
const RECORD_KEYS = new Set([
  "themes",
  "imports",
  "variables",
  "assets",
  "nodes",
  "theme",
  "when",
  "overrides",
  "args",
  "inputs",
  "uniforms",
  "meta",
  "options",
  "features",
])
/** Records whose values are opaque (ordered purely by code unit). */
const OPAQUE_VALUE_RECORDS = new Set(["meta", "args", "inputs", "uniforms", "options"])

/** Header members laid out as one-entry-per-line tables. */
const TABLES = new Set(["variables", "assets", "conflicts", "nodes"])

type Mode = "struct" | "record" | "opaque"

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Orders the member names of a schema-defined object (a node, a paint, …) canonically: known
 * keys by their rank, then unknown ones by code unit. Exposed so in-memory replicas can present
 * nodes in one order whatever their CRDT history (Yjs map iteration order is not stable).
 */
export function structOrder(keys: string[]): string[] {
  const known: string[] = []
  const unknown: string[] = []
  for (const k of keys) (RANK.has(k) ? known : unknown).push(k)
  known.sort((a, b) => (RANK.get(a) as number) - (RANK.get(b) as number))
  unknown.sort(byCodeUnit)
  return known.concat(unknown)
}

/**
 * Root members defined by format 1.0 (§4), in canonical order (`nodes` is always last). Any
 * other root member is unknown and opaque. `merge` and `conflicts` (feature "merge/conflicts",
 * §21) are root-only: their names are not in {@link KEY_ORDER} (Appendix A stays frozen), so
 * they never rank keys below the root.
 */
const ROOT_ORDER: readonly string[] = [
  "$schema",
  "format",
  "features",
  "meta",
  "themes",
  "imports",
  "variables",
  "assets",
  "components",
  "merge",
  "conflicts",
  "nodes",
]
const ROOT_MEMBERS: ReadonlySet<string> = new Set(ROOT_ORDER)
const ROOT_RANK = new Map(ROOT_ORDER.map((k, i) => [k, i]))

/** Child modes of root members that Appendix A does not rank (§21). */
const ROOT_ONLY_MODES: ReadonlyMap<string, Mode> = new Map<string, Mode>([
  ["merge", "struct"],
  ["conflicts", "record"],
])

/** Root order (§15.1 rule 2): defined members by rank, then unknown ones by code unit, `nodes` last. */
function rootOrder(keys: string[]): string[] {
  const known = keys.filter((k) => ROOT_MEMBERS.has(k) && k !== "nodes")
  known.sort((a, b) => (ROOT_RANK.get(a) as number) - (ROOT_RANK.get(b) as number))
  const unknown = keys.filter((k) => !ROOT_MEMBERS.has(k)).sort(byCodeUnit)
  return [...known, ...unknown, ...(keys.includes("nodes") ? ["nodes"] : [])]
}

function childMode(mode: Mode, key: string, parentKey: string | null, topLevel: boolean): Mode {
  if (mode === "opaque") return "opaque"
  if (mode === "record")
    return parentKey !== null && OPAQUE_VALUE_RECORDS.has(parentKey) ? "opaque" : "struct"
  if (!RANK.has(key)) return "opaque"
  if (key === "meta" && topLevel) return "struct"
  if (RECORD_KEYS.has(key)) return "record"
  if (key === "props" && parentKey === "component") return "record"
  return "struct"
}

function assertNumber(n: number, path: string): void {
  if (!Number.isFinite(n))
    throw new TypeError(`Cannot serialize non-finite number at ${path || "/"}`)
}

/**
 * Returns a deep copy of `value` with object keys in canonical order. Arrays keep their order.
 * `parentKey` is the key under which `value` sits; `topLevel` is true for the document root.
 */
function order(
  value: unknown,
  mode: Mode,
  parentKey: string | null,
  topLevel: boolean,
  path: string,
): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") {
    assertNumber(value, path)
    return Object.is(value, -0) ? 0 : value // JSON has no negative zero
  }
  if (Array.isArray(value)) {
    const childMode_ = mode === "record" ? "struct" : mode
    return value.map((v, i) => order(v, childMode_, parentKey, false, `${path}/${i}`))
  }
  if (typeof value !== "object")
    throw new TypeError(`Cannot serialize ${typeof value} at ${path || "/"}`)
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined)
  const root = topLevel && mode === "struct"
  const sorted = root
    ? rootOrder(keys)
    : mode === "struct"
      ? structOrder(keys)
      : keys.sort(byCodeUnit)
  const out: Record<string, JsonValue> = {}
  for (const k of sorted) {
    const cm =
      mode === "record"
        ? childMode("record", k, parentKey, false)
        : root && !ROOT_MEMBERS.has(k)
          ? "opaque"
          : root && ROOT_ONLY_MODES.has(k)
            ? (ROOT_ONLY_MODES.get(k) as Mode)
            : childMode(mode, k, parentKey, topLevel)
    const v = order(obj[k], cm, mode === "record" ? parentKey : k, false, `${path}/${k}`)
    setOwn(out, k, v)
  }
  return out
}

/** Options for {@link serialize} and {@link canonicalize}. */
export interface SerializeOptions {
  /**
   * Omit properties equal to their normative default (10.2 rule 4). Default `true`. Turn off
   * only for debugging; files written without it are not canonical.
   */
  stripDefaults?: boolean
}

/**
 * Returns the canonical form of a document as data: defaults stripped, top-level `features`
 * sorted, keys in canonical order. Unknown properties are kept.
 */
export function canonicalize<T extends object = KimoDocument>(
  doc: T,
  options: SerializeOptions = {},
): T {
  let d: unknown = doc
  if (options.stripDefaults !== false) d = stripDefaults(d as KimoDocument)
  if (isObject(d) && Array.isArray(d.features) && d.features.every((f) => typeof f === "string")) {
    d = { ...d, features: [...(d.features as string[])].sort(byCodeUnit) }
  }
  return order(d, "struct", null, true, "") as T
}

const compact = (v: JsonValue) => JSON.stringify(v)

function table(entries: Record<string, JsonValue>): string {
  const keys = Object.keys(entries)
  if (keys.length === 0) return "{}"
  const lines = keys.map(
    (k, i) => `${i === 0 ? "" : ", "}${JSON.stringify(k)}: ${compact(entries[k] as JsonValue)}`,
  )
  return `{\n${lines.join("\n\n")}\n}`
}

/**
 * Serializes a document to canonical `.kimo` text.
 *
 * Layout: `{` on the first line; each header member on its own line as `"key": <compact JSON>`
 * in canonical order with a trailing comma; tables (`variables`, `assets`, `conflicts`, `nodes`) span
 * several lines with one entry per line; `nodes` is always the last member; `}` and a
 * trailing newline end the file.
 *
 * @throws {TypeError} for values JSON cannot represent (non-finite numbers, functions, …).
 */
export function serialize(
  doc: KimoDocument | Record<string, unknown>,
  options: SerializeOptions = {},
): string {
  const c = canonicalize(doc as KimoDocument, options) as unknown as Record<string, JsonValue>
  const keys = Object.keys(c).filter((k) => k !== "nodes")
  if (Object.hasOwn(c, "nodes")) keys.push("nodes")
  const members = keys.map((k) => {
    const v = c[k] as JsonValue
    const body = TABLES.has(k) && isObject(v) ? table(v as Record<string, JsonValue>) : compact(v)
    return `${JSON.stringify(k)}: ${body}`
  })
  return members.length === 0 ? "{}\n" : `{\n${members.join(",\n")}\n}\n`
}

/**
 * Parses `.kimo` text into a document. The result is well-formed JSON with unique keys and an
 * object root; it is NOT schema-checked — call `validate()` (or use `openDocument()`), and
 * check the format version before editing. Unknown properties are preserved.
 *
 * @throws {KimoParseError}
 */
export function parse(text: string): KimoDocument {
  const v = parseJson(text)
  if (!isObject(v))
    throw new KimoParseError("NOT_AN_OBJECT", "A .kimo document must be a JSON object", "")
  return v as unknown as KimoDocument
}

/** True when `text` is exactly the canonical serialization of its own content. */
export function isCanonical(text: string): boolean {
  try {
    return serialize(parse(text)) === text
  } catch {
    return false
  }
}
