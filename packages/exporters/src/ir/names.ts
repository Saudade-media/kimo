/**
 * Stable naming for exported code: CSS class keys, CSS custom properties, React component and
 * prop identifiers, file names. Pure functions of their inputs plus a deterministic
 * de-duplication order (the caller visits nodes in document order), so the same document always
 * yields the same names.
 */

/** Lowercase kebab-case ASCII; `fallback` when nothing remains. */
export function kebab(s: string, fallback = "node"): string {
  const out = s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  if (!out) return fallback
  return /^[0-9]/.test(out) ? `n-${out}` : out
}

/** PascalCase identifier (`Card/Pricing` → `CardPricing`); `fallback` when nothing remains. */
export function pascal(s: string, fallback = "Component"): string {
  const parts = kebab(s, "").split("-").filter(Boolean)
  const out = parts.map((p) => p[0]?.toUpperCase() + p.slice(1)).join("")
  if (!out) return fallback
  return /^[0-9]/.test(out) ? `C${out}` : out
}

const RESERVED = new Set(
  (
    "break case catch class const continue debugger default delete do else enum export extends " +
    "false finally for function if import in instanceof new null return super switch this throw " +
    "true try typeof var void while with yield let static implements interface package private " +
    "protected public await children className style key ref"
  ).split(" "),
)

/** camelCase JS identifier for a prop name (declared props are already identifiers, §3). */
export function propIdent(s: string): string {
  let out = s.replace(/[^A-Za-z0-9_$]/g, "_")
  if (!/^[A-Za-z_$]/.test(out)) out = `_${out}`
  return RESERVED.has(out) ? `${out}Prop` : out
}

/** CSS custom property name of a (possibly `alias:`-qualified) variable: `--ui-accent`. */
export function cssVarName(qualified: string): string {
  const s = qualified
    .replace(/:/g, "-")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return `--${s || "var"}`
}

/** `data-*` attribute of a theme axis (`mode` → `data-mode`, `ui:mode` → `data-ui-mode`). */
export function axisAttr(axis: string): string {
  return `data-${kebab(axis.replace(/:/g, "-"), "axis")}`
}

/** Hands out unique names: the first request of a base gets it, later ones get `-2`, `-3`… */
export class NameRegistry {
  private readonly used = new Set<string>()
  constructor(private readonly sep = "-") {}
  take(base: string): string {
    let name = base
    for (let i = 2; this.used.has(name); i++) name = `${base}${this.sep}${i}`
    this.used.add(name)
    return name
  }
  has(name: string): boolean {
    return this.used.has(name)
  }
}
