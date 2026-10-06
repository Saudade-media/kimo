/**
 * CSS declarations → Tailwind v4 utilities. Theme tokens (`@theme` keys) where a declaration
 * is bound to a variable exposed in that namespace, standard utilities for keyword values, and
 * arbitrary values / arbitrary properties for everything else (never a rounded "nearest"
 * utility: exported values stay exact).
 */
import type { Decl } from "./style"

/** Encodes an arbitrary value: spaces → `_`, `_` → `\_`, double quotes → single. */
export function arb(v: string): string {
  return v.replace(/_/g, "\\_").replace(/"/g, "'").replace(/\s+/g, "_")
}

const KEYWORDS: Record<string, Record<string, string>> = {
  position: { relative: "relative", absolute: "absolute" },
  display: { flex: "flex", grid: "grid", none: "hidden" },
  "flex-direction": { row: "flex-row", column: "flex-col" },
  "flex-wrap": { wrap: "flex-wrap" },
  "align-content": { "flex-start": "content-start", center: "content-center", end: "content-end" },
  "justify-content": {
    "flex-start": "justify-start",
    center: "justify-center",
    "flex-end": "justify-end",
    "space-between": "justify-between",
    "space-around": "justify-around",
    "space-evenly": "justify-evenly",
  },
  "align-items": {
    "flex-start": "items-start",
    center: "items-center",
    "flex-end": "items-end",
    stretch: "items-stretch",
    baseline: "items-baseline",
  },
  "align-self": { start: "self-start", stretch: "self-stretch" },
  "justify-self": { start: "justify-self-start" },
  "flex-shrink": { "0": "shrink-0", "1": "shrink" },
  "flex-grow": { "1": "grow" },
  "flex-basis": { auto: "basis-auto", "0": "basis-0" },
  "min-width": { "0": "min-w-0" },
  "min-height": { "0": "min-h-0" },
  width: { "max-content": "w-max" },
  isolation: { isolate: "isolate" },
  overflow: { hidden: "overflow-hidden" },
  "font-style": { italic: "italic", normal: "not-italic" },
  "text-align": {
    left: "text-left",
    center: "text-center",
    right: "text-right",
    justify: "text-justify",
  },
  "white-space": { pre: "whitespace-pre", "pre-wrap": "whitespace-pre-wrap" },
  "text-transform": {
    uppercase: "uppercase",
    lowercase: "lowercase",
    capitalize: "capitalize",
    none: "normal-case",
  },
  "text-decoration-line": {
    underline: "underline",
    "line-through": "line-through",
    none: "no-underline",
  },
  "transform-origin": { "0 0": "origin-top-left" },
  "pointer-events": { none: "pointer-events-none" },
  "font-weight": {
    "100": "font-thin",
    "200": "font-extralight",
    "300": "font-light",
    "400": "font-normal",
    "500": "font-medium",
    "600": "font-semibold",
    "700": "font-bold",
    "800": "font-extrabold",
    "900": "font-black",
  },
}

/** Utility prefix for arbitrary values whose type Tailwind infers unambiguously. */
const ARBITRARY: Record<string, string> = {
  left: "left",
  top: "top",
  "margin-left": "ml",
  "margin-top": "mt",
  width: "w",
  height: "h",
  "min-width": "min-w",
  "min-height": "min-h",
  "max-width": "max-w",
  "max-height": "max-h",
  "flex-grow": "grow",
  "row-gap": "gap-y",
  "column-gap": "gap-x",
  "padding-top": "pt",
  "padding-right": "pr",
  "padding-bottom": "pb",
  "padding-left": "pl",
  "border-radius": "rounded",
  opacity: "opacity",
  "letter-spacing": "tracking",
  "box-shadow": "shadow",
}

/** Utility prefix of a theme token per property. */
const TOKEN: Record<string, string> = {
  "background-color": "bg",
  color: "text",
  width: "w",
  height: "h",
  "row-gap": "gap-y",
  "column-gap": "gap-x",
  "padding-top": "pt",
  "padding-right": "pr",
  "padding-bottom": "pb",
  "padding-left": "pl",
  "border-radius": "rounded",
  "font-size": "text",
  "font-family": "font",
  "font-weight": "font",
  "letter-spacing": "tracking",
}

/** Tokens the emitter may use: namespace → refs exposed under it in `@theme`. */
export type ThemeTokens = (ns: string, ref: string) => string | null

const isColor = (v: string) => /^(#|oklch\(|color\(|rgb)/.test(v)
const isLength = (v: string) => /^-?[0-9.]+px$|^calc\(/.test(v)

/** One declaration → one utility class. */
export function utility(d: Decl, tokens: ThemeTokens): string {
  if (d.token && TOKEN[d.prop]) {
    const name = tokens(d.token.ns, d.token.ref)
    if (name) return `${TOKEN[d.prop]}-${name}`
  }
  const kw = KEYWORDS[d.prop]?.[d.value]
  if (kw) return kw
  const v = d.value
  switch (d.prop) {
    case "background-color":
      if (isColor(v)) return `bg-[${arb(v)}]`
      break
    case "color":
      if (isColor(v)) return `text-[${arb(v)}]`
      break
    case "font-size":
      if (isLength(v)) return `text-[length:${arb(v)}]`
      break
    case "line-height":
      if (isLength(v)) return `leading-[${arb(v)}]`
      break
    case "font-weight":
      if (/^[0-9]+$/.test(v)) return `font-[${v}]`
      break
    default: {
      const p = ARBITRARY[d.prop]
      if (
        p &&
        (isLength(v) ||
          /^[0-9.]+$/.test(v) ||
          d.prop === "box-shadow" ||
          d.prop === "border-radius")
      )
        return `${p}-[${arb(v)}]`
    }
  }
  return `[${d.prop}:${arb(v)}]`
}

export function utilities(decls: Decl[], tokens: ThemeTokens): string[] {
  const out: string[] = []
  for (const d of decls) {
    const u = utility(d, tokens)
    if (!out.includes(u)) out.push(u)
  }
  return out
}
