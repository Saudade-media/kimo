/**
 * Theme and variable resolution (teardown 10.4, normative). Pure functions over documents;
 * `@kimo/design-tokens` builds its resolver on these.
 */
import { isObject } from "./json"
import type { KimoDocument } from "./schema/document"

/** Imported library documents, keyed by the consumer's import alias. */
export type Libraries = Readonly<Record<string, KimoDocument>>

/** An effective theme: axis key (`axis` or `alias:axis`) → value. */
export type Theme = Record<string, string>

/** Splits `alias:name` into its parts; `alias` is null for a local name. */
export function splitQualified(s: string): { alias: string | null; name: string } {
  const i = s.indexOf(":")
  return i < 0 ? { alias: null, name: s } : { alias: s.slice(0, i), name: s.slice(i + 1) }
}

/** True for a binding object `{ "$ref": string }` (exactly one member). */
export function isRef(v: unknown): v is { $ref: string } {
  if (!isObject(v) || typeof v.$ref !== "string") return false
  for (const k in v) if (k !== "$ref") return false
  return true
}

/**
 * True when a variable `value` is in themed form: a non-empty array whose entries are all
 * objects with a `value` member. Any other value is a plain value used under every theme.
 */
export function isThemedValue(value: unknown): value is { value: unknown; when?: Theme }[] {
  return Array.isArray(value) && value.length > 0 && value.every((e) => isObject(e) && "value" in e)
}

/** Default theme: the first value of every axis, plus `alias:axis` defaults of loaded libraries. */
export function defaultTheme(doc: KimoDocument, libraries: Libraries = {}): Theme {
  const theme: Theme = {}
  for (const [axis, values] of Object.entries(doc.themes ?? {})) {
    if (Array.isArray(values) && typeof values[0] === "string") theme[axis] = values[0]
  }
  for (const alias of Object.keys(doc.imports ?? {})) {
    const lib = libraries[alias]
    if (!lib) continue
    for (const [axis, values] of Object.entries(lib.themes ?? {})) {
      if (Array.isArray(values) && typeof values[0] === "string")
        theme[`${alias}:${axis}`] = values[0]
    }
  }
  return theme
}

/**
 * Effective theme of a node (10.4 rule 1): document defaults, then every `theme` pin from the
 * root down to the node along its placement path (`parent` links, which include instance
 * placement), each overwriting only the axes it names. Parent cycles are cut.
 */
export function effectiveTheme(
  doc: KimoDocument,
  nodeId: string,
  libraries: Libraries = {},
): Theme {
  const chain: Record<string, unknown>[] = []
  const seen = new Set<string>()
  let id: unknown = nodeId
  while (typeof id === "string" && !seen.has(id)) {
    seen.add(id)
    const n = (doc.nodes as Record<string, unknown>)[id]
    if (!isObject(n)) break
    chain.push(n)
    id = n.parent
  }
  const theme = defaultTheme(doc, libraries)
  for (let i = chain.length - 1; i >= 0; i--) {
    const pins = chain[i]?.theme
    if (isObject(pins))
      for (const [k, v] of Object.entries(pins)) if (typeof v === "string") theme[k] = v
  }
  return theme
}

/** Result of {@link selectThemedValue}. */
export interface ThemedSelection {
  value: unknown
  /** False when no entry matched and a fallback (or the first entry) was used: lint THEME_NO_MATCH. */
  matched: boolean
}

/**
 * Picks the value of a (possibly themed) variable value under `axisValue` (10.4 rules 3–4).
 * `axisValue(key)` returns the effective value of a `when` key, or undefined.
 */
export function selectThemedValue(
  value: unknown,
  axisValue: (key: string) => string | undefined,
): ThemedSelection {
  if (!isThemedValue(value)) return { value, matched: true }
  let winner: { value: unknown } | undefined
  let fallback: { value: unknown } | undefined
  for (const entry of value) {
    const when = isObject(entry.when) ? entry.when : {}
    const keys = Object.keys(when)
    if (keys.length === 0) {
      fallback = entry
      continue
    }
    if (keys.every((k) => axisValue(k) === when[k])) winner = entry
  }
  if (winner) return { value: winner.value, matched: true }
  return { value: (fallback ?? value[0])?.value, matched: false }
}

/** Why a binding could not be resolved. */
export type ResolveFailure =
  | "VARIABLE_MISSING"
  | "VARIABLE_CYCLE"
  | "ALIAS_UNKNOWN"
  | "LIBRARY_NOT_LOADED"

/** Result of {@link resolveVariable}. */
export type Resolution =
  | {
      ok: true
      /** The final literal value (after following aliases). */
      value: unknown
      /** Declared type of the variable the binding names. */
      type: string
      /** False when any step had no themed match (lint THEME_NO_MATCH). */
      matched: boolean
      /** Qualified names visited, starting with the binding's own target. */
      chain: string[]
    }
  | { ok: false; reason: ResolveFailure; chain: string[] }

/**
 * Resolves a binding target (`name` or `alias:name`) under an effective theme (10.4 rules
 * 3–6). Aliases are followed recursively with cycle detection. A library variable is resolved
 * inside its library, where its own axes read the consumer's `alias:axis` values (or the
 * library's defaults).
 */
export function resolveVariable(
  doc: KimoDocument,
  target: string,
  theme: Theme,
  libraries: Libraries = {},
): Resolution {
  const chain: string[] = []
  let matched = true
  let type: string | undefined
  let scope: { doc: KimoDocument; alias: string | null } = { doc, alias: null }
  let current = target
  for (;;) {
    const { alias, name } = splitQualified(current)
    if (alias !== null) {
      if (scope.alias !== null) return { ok: false, reason: "LIBRARY_NOT_LOADED", chain }
      if (!doc.imports || !Object.hasOwn(doc.imports, alias))
        return { ok: false, reason: "ALIAS_UNKNOWN", chain }
      const lib = libraries[alias]
      if (!lib) return { ok: false, reason: "LIBRARY_NOT_LOADED", chain }
      scope = { doc: lib, alias }
    }
    const qualified = scope.alias === null ? name : `${scope.alias}:${name}`
    if (chain.includes(qualified))
      return { ok: false, reason: "VARIABLE_CYCLE", chain: [...chain, qualified] }
    chain.push(qualified)
    const vars = scope.doc.variables as Record<string, unknown> | undefined
    const variable = vars && Object.hasOwn(vars, name) ? vars[name] : undefined
    if (!isObject(variable)) return { ok: false, reason: "VARIABLE_MISSING", chain }
    type ??= String(variable.type)
    const s = scope
    const axisValue = (key: string): string | undefined => {
      if (s.alias === null) return theme[key]
      if (key.includes(":")) return undefined
      return theme[`${s.alias}:${key}`] ?? (s.doc.themes?.[key]?.[0] as string | undefined)
    }
    const sel = selectThemedValue(variable.value, axisValue)
    matched &&= sel.matched
    if (isRef(sel.value)) {
      current = sel.value.$ref
      continue
    }
    return { ok: true, value: sel.value, type, matched, chain }
  }
}

/** Variable that supplies the fill of text nodes without `fill` (10.3 `Text.style` note). */
export const TEXT_DEFAULT_VARIABLE = "text/default"

/**
 * The fill a text node without a `fill` property paints with: a binding to the color variable
 * {@link TEXT_DEFAULT_VARIABLE} when the document declares it, otherwise opaque black. Text is
 * never invisible by omission. (An explicit `fill: []` is respected and linted.)
 */
export function defaultTextFill(doc: KimoDocument): { $ref: string } | "#000000" {
  const v = (doc.variables as Record<string, unknown> | undefined)?.[TEXT_DEFAULT_VARIABLE]
  return isObject(v) && v.type === "color" ? { $ref: TEXT_DEFAULT_VARIABLE } : "#000000"
}
