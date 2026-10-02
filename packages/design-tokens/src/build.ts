/**
 * Token build pipeline: DTCG `tokens.json` → `editor.css`, `tokens.ts`, `tailwind-theme.css`.
 *
 * Pure functions only (no file IO), so the same code drives `scripts/build-tokens.ts`,
 * `check:generated` and the up-to-date test.
 *
 * Conventions read from `tokens.json`:
 * - `$type` is inherited from the nearest group that declares it (DTCG).
 * - A token's CSS name is its path without the layer segment (`primitive.space.4` → `space-4`).
 *   A group with `$extensions["kimo.flatten"] = true` contributes no segment, so
 *   `semantic.color.bg-app` → `bg-app` (matching the .pen variable name 1:1).
 * - Mode-dependent tokens keep their light value in `$value` and every mode's value in
 *   `$extensions["kimo.modes"]`. Aliases (`{path.to.token}`) are emitted as `var()` references and
 *   therefore follow the active mode.
 */

/** Theme axis values, in emission order. The first is the default. */
export const MODES = ["light", "dark"] as const
/** A value of the single theme axis, `mode`. */
export type Mode = (typeof MODES)[number]

/** Prefix of every emitted custom property. */
export const CSS_PREFIX = "--kimo-"

/** DTCG token types used by Kimo. */
export type TokenType =
  | "color"
  | "dimension"
  | "fontFamily"
  | "fontWeight"
  | "number"
  | "shadow"
  | "typography"

/** A DTCG 2025.10 sRGB color value. `hex` is `#RRGGBB`; alpha lives in `alpha`. */
export interface ColorValue {
  colorSpace: "srgb"
  components: [number, number, number]
  alpha?: number
  hex: string
}

/** A DTCG dimension value. Kimo uses `px` only. */
export interface DimensionValue {
  value: number
  unit: "px" | "rem"
}

/** A DTCG shadow layer. */
export interface ShadowValue {
  color: ColorValue | string
  offsetX: DimensionValue | string
  offsetY: DimensionValue | string
  blur: DimensionValue | string
  spread: DimensionValue | string
  inset?: boolean
}

/** One token found while walking the tree. */
export interface CollectedToken {
  /** Dot path in `tokens.json`, e.g. `semantic.color.bg-app`. */
  path: string
  /** CSS name without prefix, e.g. `bg-app`. */
  name: string
  type: TokenType
  value: unknown
  /** Per-mode values, present only on mode-dependent tokens. */
  modes?: Partial<Record<Mode, unknown>>
  /** Name of the .pen variable this token mirrors, if any. */
  pen?: string
  description?: string
}

/** One emitted CSS custom property. Typography tokens expand to several. */
export interface CssEntry {
  /** Name without the `--kimo-` prefix. */
  name: string
  /** Source token path (plus `#field` for expanded composite fields). */
  path: string
  type: TokenType
  pen?: string
  /** Declared value per mode, with aliases as `var(--kimo-…)`. */
  declared: Record<Mode, string>
  /** Fully resolved literal value per mode. */
  resolved: Record<Mode, string>
  /** True when the value differs by mode, directly or through an alias. */
  modeDependent: boolean
}

/** The three generated artifacts, keyed by path relative to `src/generated/`. */
export interface GeneratedFiles {
  "editor.css": string
  "tokens.ts": string
  "tailwind-theme.css": string
}

type Json = Record<string, unknown>

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v)
const ALIAS = /^\{([^{}]+)\}$/

/**
 * Walk a DTCG tree and return every token in document order.
 * Throws on a token without a resolvable `$type` or with a duplicate CSS name.
 */
export function collectTokens(tree: Json): CollectedToken[] {
  const out: CollectedToken[] = []
  const names = new Set<string>()
  const walk = (node: Json, path: string[], nameParts: string[], inherited?: TokenType) => {
    const type = (node.$type as TokenType | undefined) ?? inherited
    if ("$value" in node) {
      if (!type) throw new Error(`Token ${path.join(".")} has no $type`)
      const ext = isObject(node.$extensions) ? node.$extensions : {}
      const name = nameParts.join("-")
      if (names.has(name)) throw new Error(`Duplicate CSS token name "${name}"`)
      names.add(name)
      const token: CollectedToken = { path: path.join("."), name, type, value: node.$value }
      if (isObject(ext["kimo.modes"])) token.modes = ext["kimo.modes"] as CollectedToken["modes"]
      if (typeof ext["kimo.pen"] === "string") token.pen = ext["kimo.pen"]
      if (typeof node.$description === "string") token.description = node.$description
      if (type === "fontFamily" && Array.isArray(ext["kimo.fallback"])) {
        token.value = [node.$value, ...(ext["kimo.fallback"] as string[])]
        if (token.modes) throw new Error(`fontFamily ${token.path} cannot be mode-dependent`)
      }
      out.push(token)
      return
    }
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith("$") || !isObject(child)) continue
      // A flattened group contributes no segment to its descendants' names.
      const flatten = isObject(child.$extensions) && child.$extensions["kimo.flatten"] === true
      walk(child, [...path, key], flatten ? nameParts : [...nameParts, key], type)
    }
  }
  // Top-level groups are layers; their key is dropped from names but kept in paths.
  for (const [layer, child] of Object.entries(tree)) {
    if (layer.startsWith("$") || !isObject(child)) continue
    walk(child, [layer], [], undefined)
  }
  return out
}

const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, "0")

/** Serialize a DTCG color to `#RRGGBB` or `#RRGGBBAA`, preserving the source hex exactly. */
export function colorToHex(c: ColorValue): string {
  const base = c.hex.toUpperCase()
  if (c.alpha === undefined || c.alpha === 1) return base
  return `${base}${hex2(Math.round(c.alpha * 255))}`
}

const GENERIC_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "emoji",
  "math",
  "fangsong",
])

/** Quote a font family name unless it is a CSS generic family keyword. */
const quoteFamily = (f: string) => (GENERIC_FAMILIES.has(f) ? f : `"${f}"`)

/**
 * Build CSS entries for every token: declared (alias-preserving) and resolved values per mode.
 */
export function buildCssEntries(tokens: CollectedToken[]): CssEntry[] {
  const byPath = new Map(tokens.map((t) => [t.path, t]))
  const entries: CssEntry[] = []
  const resolving = new Set<string>()

  /** Resolve an alias to its target token, guarding against cycles. */
  const target = (ref: string, from: string): CollectedToken => {
    const t = byPath.get(ref)
    if (!t) throw new Error(`Unknown alias {${ref}} in ${from}`)
    if (t.type === "typography") throw new Error(`Cannot alias composite {${ref}} from ${from}`)
    return t
  }

  /** Does a raw value depend on mode, directly or through aliases? */
  const dependsOnMode = (value: unknown, from: string): boolean => {
    if (typeof value === "string") {
      const m = ALIAS.exec(value)
      if (!m?.[1]) return false
      const t = target(m[1], from)
      if (resolving.has(t.path)) throw new Error(`Alias cycle through ${t.path}`)
      resolving.add(t.path)
      const r = t.modes !== undefined || dependsOnMode(t.value, t.path)
      resolving.delete(t.path)
      return r
    }
    if (Array.isArray(value)) return value.some((v) => dependsOnMode(v, from))
    if (isObject(value) && !("colorSpace" in value) && !("unit" in value)) {
      return Object.values(value).some((v) => dependsOnMode(v, from))
    }
    return false
  }

  /** Serialize a raw value to CSS for a mode. */
  const toCss = (
    value: unknown,
    type: TokenType,
    mode: Mode,
    resolve: boolean,
    from: string,
  ): string => {
    if (typeof value === "string") {
      const m = ALIAS.exec(value)
      if (m?.[1]) {
        const t = target(m[1], from)
        if (!resolve) return `var(${CSS_PREFIX}${t.name})`
        const v = t.modes?.[mode] ?? t.value
        return toCss(v, t.type, mode, true, t.path)
      }
      if (type === "fontFamily") return quoteFamily(value)
      return value
    }
    if (typeof value === "number") return String(value)
    if (Array.isArray(value)) {
      return value.map((v) => toCss(v, type, mode, resolve, from)).join(", ")
    }
    if (isObject(value)) {
      if (type === "color" && "hex" in value) return colorToHex(value as unknown as ColorValue)
      if ("unit" in value && typeof value.value === "number") return `${value.value}${value.unit}`
      if (type === "shadow") {
        const s = value as unknown as ShadowValue
        const parts = [
          toCss(s.offsetX, "dimension", mode, resolve, from),
          toCss(s.offsetY, "dimension", mode, resolve, from),
          toCss(s.blur, "dimension", mode, resolve, from),
          toCss(s.spread, "dimension", mode, resolve, from),
          toCss(s.color, "color", mode, resolve, from),
        ].join(" ")
        return s.inset ? `inset ${parts}` : parts
      }
    }
    throw new Error(`Cannot serialize ${from} (${type}): ${JSON.stringify(value)}`)
  }

  const perMode = (fn: (mode: Mode) => string) =>
    Object.fromEntries(MODES.map((m) => [m, fn(m)])) as Record<Mode, string>

  for (const t of tokens) {
    if (t.type === "typography") {
      if (!isObject(t.value)) throw new Error(`Typography ${t.path} must be an object`)
      const fields: [string, string, TokenType][] = [
        ["fontFamily", "font-family", "fontFamily"],
        ["fontSize", "font-size", "dimension"],
        ["fontWeight", "font-weight", "fontWeight"],
        ["letterSpacing", "letter-spacing", "dimension"],
        ["lineHeight", "line-height", "number"],
      ]
      for (const [key, suffix, type] of fields) {
        const v = t.value[key]
        if (v === undefined) continue
        entries.push({
          name: `${t.name}-${suffix}`,
          path: `${t.path}#${key}`,
          type,
          declared: perMode((m) => toCss(v, type, m, false, t.path)),
          resolved: perMode((m) => toCss(v, type, m, true, t.path)),
          modeDependent: dependsOnMode(v, t.path),
        })
      }
      continue
    }
    const valueFor = (m: Mode) => t.modes?.[m] ?? t.value
    const entry: CssEntry = {
      name: t.name,
      path: t.path,
      type: t.type,
      declared: perMode((m) => toCss(valueFor(m), t.type, m, false, t.path)),
      resolved: perMode((m) => toCss(valueFor(m), t.type, m, true, t.path)),
      modeDependent: t.modes !== undefined || dependsOnMode(t.value, t.path),
    }
    if (t.pen) entry.pen = t.pen
    entries.push(entry)
  }
  return entries
}

const HEADER =
  "Generated by packages/design-tokens/scripts/build-tokens.ts from src/tokens.json. Do not edit."

const decls = (entries: CssEntry[], mode: Mode, indent: string) =>
  entries.map((e) => `${indent}${CSS_PREFIX}${e.name}: ${e.declared[mode]};`).join("\n")

/**
 * `editor.css`: light values on `:root`; dark values under `[data-theme="dark"]` and, when no
 * explicit theme is set on the root, under `prefers-color-scheme: dark`.
 *
 * Theme blocks redeclare every mode-dependent entry, including aliases: a custom property's `var()`
 * is resolved on the element that declares it, so a scoped `[data-theme]` subtree must redeclare
 * aliases for them to pick up the subtree's mode.
 */
export function renderEditorCss(entries: CssEntry[]): string {
  const themed = entries.filter((e) => e.modeDependent)
  return `/* ${HEADER} */

:root {
  color-scheme: light;
${decls(entries, "light", "  ")}
}

[data-theme="light"] {
  color-scheme: light;
${decls(themed, "light", "  ")}
}

[data-theme="dark"] {
  color-scheme: dark;
${decls(themed, "dark", "  ")}
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
${decls(themed, "dark", "    ")}
  }
}
`
}

/** Map a CSS entry to its Tailwind v4 theme variable(s), or none. */
function tailwindNames(e: CssEntry): string[] {
  const [layer, group, key] = e.path.split("#")[0]?.split(".") ?? []
  const field = e.path.split("#")[1]
  if (layer === "semantic" && group === "color") return [`--color-${e.name}`]
  if (layer === "semantic" && group === "elevation") return [`--shadow-${key}`]
  if (layer === "semantic" && group === "type") {
    if (field === "fontSize") return [`--text-${key}`]
    if (field === "fontWeight") return [`--text-${key}--font-weight`]
    if (field === "letterSpacing") return [`--text-${key}--letter-spacing`]
    if (field === "lineHeight") return [`--text-${key}--line-height`]
    return []
  }
  if (layer !== "primitive") return []
  const ns: Record<string, string> = {
    font: "font",
    space: "spacing",
    radius: "radius",
    text: "text",
    "font-weight": "font-weight",
  }
  const n = group ? ns[group] : undefined
  return n ? [`--${n}-${key}`] : []
}

/**
 * `tailwind-theme.css`: a Tailwind v4 `@theme inline` block whose values point at the
 * `--kimo-*` properties, so utilities follow the active mode. Tailwind's default color palette is
 * reset (monochrome rule: color is reserved for selection, agent and status).
 */
export function renderTailwindTheme(entries: CssEntry[]): string {
  const lines: string[] = []
  for (const e of entries) {
    for (const n of tailwindNames(e)) lines.push(`  ${n}: var(${CSS_PREFIX}${e.name});`)
  }
  return `/* ${HEADER} */
/* Import after "tailwindcss" and "@kimo/design-tokens/editor.css". */

@theme inline {
  --color-*: initial;
${lines.join("\n")}
}
`
}

/** `tokens.ts`: typed token map with per-mode resolved values. */
export function renderTokensTs(entries: CssEntry[]): string {
  const body = entries
    .map((e) => {
      const fields = [
        `cssVar: ${JSON.stringify(`${CSS_PREFIX}${e.name}`)}`,
        `path: ${JSON.stringify(e.path)}`,
        `type: ${JSON.stringify(e.type)}`,
        ...(e.pen ? [`pen: ${JSON.stringify(e.pen)}`] : []),
        `modeDependent: ${e.modeDependent}`,
        `declared: { light: ${JSON.stringify(e.declared.light)}, dark: ${JSON.stringify(e.declared.dark)} }`,
        `value: { light: ${JSON.stringify(e.resolved.light)}, dark: ${JSON.stringify(e.resolved.dark)} }`,
      ]
      return `  ${JSON.stringify(e.name)}: {\n    ${fields.join(",\n    ")},\n  },`
    })
    .join("\n")
  return `// ${HEADER}

/** A Kimo token as emitted to CSS. */
export interface TokenEntry {
  /** Custom property name, e.g. \`--kimo-bg-app\`. */
  readonly cssVar: string
  /** Path in tokens.json (\`#field\` marks an expanded typography field). */
  readonly path: string
  readonly type: "color" | "dimension" | "fontFamily" | "fontWeight" | "number" | "shadow"
  /** The desing.pen variable this token mirrors, if any. */
  readonly pen?: string
  /** True when the value differs between light and dark. */
  readonly modeDependent: boolean
  /** CSS value as declared (aliases are \`var()\` references). */
  readonly declared: { readonly light: string; readonly dark: string }
  /** Fully resolved CSS value per mode. */
  readonly value: { readonly light: string; readonly dark: string }
}

/** Every emitted token, keyed by CSS name without the \`--kimo-\` prefix. */
export const tokens = {
${body}
} as const satisfies Record<string, TokenEntry>

/** Name of any Kimo token (without the \`--kimo-\` prefix). */
export type TokenName = keyof typeof tokens
`
}

/** Build all generated files from a parsed `tokens.json`. */
export function buildTokens(tree: Json): GeneratedFiles {
  const entries = buildCssEntries(collectTokens(tree))
  return {
    "editor.css": renderEditorCss(entries),
    "tokens.ts": renderTokensTs(entries),
    "tailwind-theme.css": renderTailwindTheme(entries),
  }
}
