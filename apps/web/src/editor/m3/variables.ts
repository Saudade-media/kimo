/**
 * Pure helpers for the Variables tab and dialog (board 14, spec §10): grid cells per axis value,
 * value display, CSS colors for OKLCH / Display-P3 values (stored as written, gamut-mapped only
 * for display), entry states under the preview theme, THEME_NO_MATCH, groups and DTCG
 * import/export. Unit-tested in test/m3-variables.test.ts.
 */
import {
  defaultTheme,
  isRef,
  isThemedValue,
  type KimoDocument,
  type Libraries,
  resolveVariable,
  type Theme,
} from "@kimo/core-schema"

type Rec = Record<string, unknown>
const isObj = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v)

export interface Entry {
  value: unknown
  when?: Record<string, string>
}

export type VarType = "color" | "number" | "string" | "boolean"

/** A variable's value as an entry list (a plain value is one entry without `when`). */
export function entriesOf(value: unknown): Entry[] {
  return isThemedValue(value) ? (value as Entry[]) : [{ value }]
}

/** One grid cell (board 14 VarCell): the value for `axis = axisValue`. */
export type Cell =
  | { kind: "value"; value: unknown; multi: boolean; entry: number }
  | { kind: "empty" }

/**
 * The cell for one axis value: the last single-axis entry `{ axis: value }`, else the last
 * multi-axis entry naming it (shown with ≡ "multi"), else empty ("—": no entry, falls back).
 */
export function cellOf(value: unknown, axis: string, axisValue: string): Cell {
  if (!isThemedValue(value)) return { kind: "empty" }
  const list = value as Entry[]
  let single = -1
  let multi = -1
  list.forEach((e, i) => {
    const w = e.when ?? {}
    if (w[axis] !== axisValue) return
    if (Object.keys(w).length === 1) single = i
    else multi = i
  })
  if (single >= 0) return { kind: "value", value: list[single]?.value, multi: false, entry: single }
  if (multi >= 0) return { kind: "value", value: list[multi]?.value, multi: true, entry: multi }
  return { kind: "empty" }
}

/** True for a plain (non-themed) value: one value for all themes ("all themes" tag). */
export const isPlain = (value: unknown) => !isThemedValue(value)

// --- Colors -------------------------------------------------------------------------------------

export interface Oklch {
  space: "oklch"
  l: number
  c: number
  h: number
  alpha?: number
}
export interface P3 {
  space: "display-p3"
  r: number
  g: number
  b: number
  alpha?: number
}

const r3 = (n: number) => Number(n.toFixed(3)).toString()
const r2 = (n: number) => n.toFixed(2)

/** CSS color for a stored color literal (hex as is; OKLCH / P3 as CSS Color 4). */
export function cssColor(v: unknown): string | null {
  if (typeof v === "string") return v
  if (!isObj(v)) return null
  const a = typeof v.alpha === "number" && v.alpha !== 1 ? ` / ${r3(v.alpha)}` : ""
  if (v.space === "oklch")
    return `oklch(${r3(Number(v.l))} ${r3(Number(v.c))} ${r3(Number(v.h))}${a})`
  if (v.space === "display-p3")
    return `color(display-p3 ${r3(Number(v.r))} ${r3(Number(v.g))} ${r3(Number(v.b))}${a})`
  return null
}

/** Mono display text: hex without "#", OKLCH "0.70 0.17 45", P3 "p3 1 0.4 0.1". */
export function colorText(v: unknown): string {
  if (typeof v === "string") return v.replace(/^#/, "").toUpperCase()
  if (isObj(v) && v.space === "oklch")
    return `${r2(Number(v.l))} ${r2(Number(v.c))} ${Math.round(Number(v.h))}`
  if (isObj(v) && v.space === "display-p3")
    return `p3 ${r2(Number(v.r))} ${r2(Number(v.g))} ${r2(Number(v.b))}`
  return "—"
}

const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const gam = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

/** OKLCH → linear sRGB (Björn Ottosson's OKLab matrices). */
export function oklchToLinearSrgb(l: number, c: number, h: number): [number, number, number] {
  const hr = (h * Math.PI) / 180
  const a = c * Math.cos(hr)
  const b = c * Math.sin(hr)
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ]
}

/** Display-P3 (gamma-encoded) → linear sRGB. */
export function p3ToLinearSrgb(r: number, g: number, b: number): [number, number, number] {
  const R = lin(r)
  const G = lin(g)
  const B = lin(b)
  return [
    1.2249401 * R - 0.2249404 * G + 0 * B,
    -0.0420569 * R + 1.0420571 * G + 0 * B,
    -0.0196376 * R - 0.0786361 * G + 1.0982735 * B,
  ]
}

/** True when a stored color lies outside sRGB (the swatch corner flag / "outside sRGB"). */
export function outsideSrgb(v: unknown, eps = 1e-4): boolean {
  if (!isObj(v)) return false
  let rgb: [number, number, number] | null = null
  if (v.space === "oklch") rgb = oklchToLinearSrgb(Number(v.l), Number(v.c), Number(v.h))
  if (v.space === "display-p3") rgb = p3ToLinearSrgb(Number(v.r), Number(v.g), Number(v.b))
  return !!rgb && rgb.some((x) => x < -eps || x > 1 + eps)
}

/** Nearest sRGB hex of a stored color (clipped), for the M2 picker. */
export function toHexApprox(v: unknown): string | null {
  if (typeof v === "string") return v
  if (!isObj(v)) return null
  let rgb: [number, number, number] | null = null
  if (v.space === "oklch") rgb = oklchToLinearSrgb(Number(v.l), Number(v.c), Number(v.h))
  if (v.space === "display-p3") rgb = p3ToLinearSrgb(Number(v.r), Number(v.g), Number(v.b))
  if (!rgb) return null
  const hex = rgb
    .map((x) => Math.round(Math.min(1, Math.max(0, gam(Math.min(1, Math.max(0, x))))) * 255))
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("")
  return `#${hex.toUpperCase()}`
}

/** sRGB hex → OKLCH (to keep an OKLCH variable in its space when edited with the M2 picker). */
export function hexToOklch(hex: string): Oklch | null {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex)
  if (!m) return null
  const n = Number.parseInt(m[1] as string, 16)
  const r = lin(((n >> 16) & 255) / 255)
  const g = lin(((n >> 8) & 255) / 255)
  const b = lin((n & 255) / 255)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const mm = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * mm - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * mm + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * mm - 0.808675766 * s
  const C = Math.sqrt(A * A + B * B)
  let H = (Math.atan2(B, A) * 180) / Math.PI
  if (H < 0) H += 360
  const out: Oklch = {
    space: "oklch",
    l: Number(Math.min(1, Math.max(0, L)).toFixed(4)),
    c: Number(C.toFixed(4)),
    h: Number((H >= 360 ? 0 : H).toFixed(2)),
  }
  if (m[2]) out.alpha = Number((Number.parseInt(m[2], 16) / 255).toFixed(3))
  return out
}

/** sRGB hex → Display-P3 (to keep a P3 variable in its space when edited with the M2 picker). */
export function hexToP3(hex: string): P3 | null {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex)
  if (!m) return null
  const n = Number.parseInt(m[1] as string, 16)
  const r = lin(((n >> 16) & 255) / 255)
  const g = lin(((n >> 8) & 255) / 255)
  const b = lin((n & 255) / 255)
  // linear sRGB → linear Display-P3
  const R = 0.8224621 * r + 0.177538 * g + 0 * b
  const G = 0.0331941 * r + 0.9668058 * g + 0 * b
  const B = 0.0170827 * r + 0.0723974 * g + 0.9105199 * b
  const q = (x: number) => Number(Math.min(1, Math.max(0, gam(x))).toFixed(4))
  const out: P3 = { space: "display-p3", r: q(R), g: q(G), b: q(B) }
  if (m[2]) out.alpha = Number((Number.parseInt(m[2], 16) / 255).toFixed(3))
  return out
}

/** Writes a picked sRGB hex back in the stored value's space (OKLCH / P3 stay as they were). */
export function inSpaceOf(stored: unknown, hex: string): unknown {
  if (isObj(stored) && stored.space === "oklch") return hexToOklch(hex) ?? hex
  if (isObj(stored) && stored.space === "display-p3") return hexToP3(hex) ?? hex
  return hex
}

/** Parses "0.70 0.17 45" (OKLCH L C H) or "oklch(…)". */
export function parseOklch(text: string): Oklch | null {
  const nums = text
    .replace(/oklch\(|\)/gi, "")
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number)
  if (nums.length < 3 || nums.some((n) => !Number.isFinite(n))) return null
  const [l, c, h, a] = nums as [number, number, number, number | undefined]
  if (l < 0 || l > 1 || c < 0) return null
  const out: Oklch = { space: "oklch", l, c, h: ((h % 360) + 360) % 360 }
  if (a !== undefined && a >= 0 && a <= 1 && a !== 1) out.alpha = a
  return out
}

// --- Values -------------------------------------------------------------------------------------

/** Display of one literal value. */
export function valueText(type: string, v: unknown): string {
  if (isRef(v)) return v.$ref
  if (type === "color") return colorText(v)
  if (typeof v === "string") return v
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  return JSON.stringify(v) ?? ""
}

/** Parses an edited cell (number / string / boolean). */
export function parseValue(type: VarType, text: string): unknown {
  if (type === "number") {
    const n = Number(text.trim().replace(",", "."))
    return Number.isFinite(n) ? n : null
  }
  if (type === "boolean") return /^(true|1|yes|on)$/i.test(text.trim())
  return text
}

/** A sensible first value for a new variable of `type`. */
export function defaultValue(type: VarType): unknown {
  switch (type) {
    case "color":
      return "#000000"
    case "number":
      return 0
    case "string":
      return ""
    case "boolean":
      return true
  }
}

/** A free name `<base>`, `<base>-2`, … */
export function freeName(base: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  if (!used.has(base)) return base
  for (let i = 2; ; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`
}

// --- Themes ---------------------------------------------------------------------------------------

/** The preview theme: the document defaults overlaid with the user's preview picks. */
export function previewTheme(
  doc: KimoDocument,
  libraries: Libraries,
  preview: Theme | null,
): Theme {
  return { ...defaultTheme(doc, libraries), ...(preview ?? {}) }
}

/** Resolution of a variable under a theme (value + THEME_NO_MATCH + alias chain). */
export function resolveUnder(doc: KimoDocument, name: string, theme: Theme, libraries: Libraries) {
  return resolveVariable(doc, name, theme, libraries)
}

/** Entry states under the preview theme (board 14 Entries: "wins in preview", fallback note). */
export function entryStates(entries: readonly Entry[], theme: Theme): string[] {
  let winner = -1
  entries.forEach((e, i) => {
    const w = e.when ?? {}
    const keys = Object.keys(w)
    if (keys.length && keys.every((k) => theme[k] === w[k])) winner = i
  })
  return entries.map((e, i) => {
    const keys = Object.keys(e.when ?? {})
    if (!keys.length)
      return winner < 0 ? "used because nothing matches" : "used only if nothing matches"
    if (i === winner) return "wins in preview"
    const w = e.when ?? {}
    if (keys.every((k) => theme[k] === w[k])) return "shadowed"
    return ""
  })
}

/** "light · comfortable" from a theme in axis display order. */
export function themeLabel(theme: Theme, axes: readonly string[]): string {
  return axes
    .map((a) => theme[a])
    .filter((v): v is string => typeof v === "string")
    .join(" · ")
}

// --- Groups / DTCG ---------------------------------------------------------------------------------

/** Group of a variable: first segment of its `group` field (DTCG path), else "" (ungrouped). */
export function groupOf(v: unknown): string {
  if (!isObj(v) || typeof v.group !== "string" || !v.group) return ""
  return v.group.split(/[./]/)[0] ?? ""
}

const DTCG_TYPE: Record<string, string> = {
  color: "color",
  number: "number",
  string: "string",
  boolean: "boolean",
}

/** DTCG export (W3C Design Tokens): nested by group path then name segments; themes as $extensions. */
export function exportDtcg(variables: Readonly<Record<string, unknown>>): Rec {
  const root: Rec = {}
  for (const [name, raw] of Object.entries(variables)) {
    if (!isObj(raw)) continue
    const type = String(raw.type)
    const entries = entriesOf(raw.value)
    const first = entries.find((e) => !e.when) ?? entries[0]
    const toDtcg = (v: unknown): unknown =>
      isRef(v) ? `{${v.$ref.replace(/\//g, ".")}}` : type === "color" ? (cssColor(v) ?? v) : v
    const token: Rec = { $type: DTCG_TYPE[type] ?? type, $value: toDtcg(first?.value) }
    if (typeof raw.description === "string") token.$description = raw.description
    if (isThemedValue(raw.value))
      token.$extensions = {
        "dev.kimo.themed": entries.map((e) => ({ value: toDtcg(e.value), when: e.when ?? {} })),
      }
    const path = [
      ...(typeof raw.group === "string" ? raw.group.split(/[./]/) : []),
      ...name.split("/"),
    ].filter(Boolean)
    let cur = root
    for (const seg of path.slice(0, -1)) {
      if (!isObj(cur[seg])) cur[seg] = {}
      cur = cur[seg] as Rec
    }
    cur[path[path.length - 1] as string] = token
  }
  return root
}

/** DTCG import: flat `{ name: variable }` (names joined with "/"); unsupported types skipped. */
export function importDtcg(json: unknown): Record<string, Rec> {
  const out: Record<string, Rec> = {}
  const walk = (node: unknown, path: string[], inherited?: string) => {
    if (!isObj(node)) return
    const type = typeof node.$type === "string" ? node.$type : inherited
    if ("$value" in node) {
      const t = type === "dimension" || type === "fontWeight" ? "number" : type
      if (t !== "color" && t !== "number" && t !== "string" && t !== "boolean") return
      let v = node.$value
      if (typeof v === "string" && /^\{.+\}$/.test(v))
        v = { $ref: v.slice(1, -1).replace(/\./g, "/") }
      else if (t === "number" && typeof v === "string") v = Number.parseFloat(v)
      const variable: Rec = { type: t, value: v }
      if (typeof node.$description === "string") variable.description = node.$description
      out[path.join("/")] = variable
      return
    }
    for (const [k, child] of Object.entries(node))
      if (!k.startsWith("$")) walk(child, [...path, k], type)
  }
  walk(json, [])
  return out
}
