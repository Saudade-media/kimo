/**
 * CSS of one run of the inline text editor, from the same resolved style the renderer draws
 * with (`@kimo/layout` resolveTextStyle), so the DOM editor lays out like the canvas text.
 */
import type { ResolvedTextStyle } from "@kimo/layout"
import type { RunCss } from "./RichTextEditor"

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v)

export function runCss(s: ResolvedTextStyle, color: string): RunCss {
  const lh = s.lineHeight
  return {
    fontFamily: `"${s.fontFamily}", var(--kimo-font-sans)`,
    fontSize: s.fontSize,
    fontWeight: s.fontWeight,
    italic: s.italic,
    lineHeight: !lh ? "normal" : "px" in lh ? `${lh.px}px` : String(lh.multiplier),
    letterSpacing: s.letterSpacing,
    decoration: s.decoration.length
      ? s.decoration.map((d) => (d === "strike" ? "line-through" : d)).join(" ")
      : "none",
    textTransform:
      s.case === "upper"
        ? "uppercase"
        : s.case === "lower"
          ? "lowercase"
          : s.case === "title"
            ? "capitalize"
            : "none",
    fontFeatureSettings: Object.entries(s.features)
      .map(([k, v]) => `"${k}" ${v === true ? 1 : v === false ? 0 : v}`)
      .join(", "),
    color,
  }
}

const fmt = (n: number) => String(Math.round(n * 10000) / 10000)

/**
 * CSS text of a resolved paint: a hex string, an OKLCH / Display-P3 color, a solid paint, or
 * the top visible paint of a list (a gradient shows its last stop). Null when there is none.
 */
export function cssColor(v: unknown): string | null {
  if (typeof v === "string") return v
  if (Array.isArray(v)) {
    for (let i = v.length - 1; i >= 0; i--) {
      const c = cssColor(v[i])
      if (c) return c
    }
    return null
  }
  if (!isObj(v)) return null
  if (v.visible === false) return null
  const a = typeof v.alpha === "number" ? v.alpha : 1
  if (v.space === "oklch")
    return `oklch(${fmt(Number(v.l))} ${fmt(Number(v.c))} ${fmt(Number(v.h))} / ${fmt(a)})`
  if (v.space === "display-p3")
    return `color(display-p3 ${fmt(Number(v.r))} ${fmt(Number(v.g))} ${fmt(Number(v.b))} / ${fmt(a)})`
  if (v.kind === "solid") return cssColor(v.color)
  if (Array.isArray(v.stops)) {
    const last = v.stops[v.stops.length - 1]
    return isObj(last) ? cssColor(last.color) : null
  }
  return null
}
