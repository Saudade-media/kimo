/**
 * @kimo/design-tokens: the Kimo editor's design tokens, transcribed 1:1 from `desing.pen`.
 *
 * - `@kimo/design-tokens/editor.css`: `--kimo-*` custom properties for light and dark.
 * - `@kimo/design-tokens/tailwind-theme.css`: Tailwind v4 `@theme inline` mapping.
 * - `@kimo/design-tokens/tokens.json`: the DTCG source.
 * - This module: the typed token map and CSS variable helpers.
 */
import { type TokenName, tokens } from "./generated/tokens"

export { type CssEntry, MODES, type Mode } from "./build"
export { contrastRatio, relativeLuminance } from "./contrast"
export { type TokenEntry, type TokenName, tokens } from "./generated/tokens"

/** Custom property name for a token: `cssVarName("bg-app")` → `"--kimo-bg-app"`. */
export function cssVarName<N extends TokenName>(name: N): `--kimo-${N}` {
  return tokens[name].cssVar as `--kimo-${N}`
}

/** `var()` reference for a token: `cssVar("bg-app")` → `"var(--kimo-bg-app)"`. */
export function cssVar<N extends TokenName>(name: N): `var(--kimo-${N})` {
  return `var(${cssVarName(name)})`
}

/** Resolved CSS value of a token in a mode, e.g. `tokenValue("bg-app", "dark")` → `"#0A0A0A"`. */
export function tokenValue(name: TokenName, mode: "light" | "dark" = "light"): string {
  return tokens[name].value[mode]
}
