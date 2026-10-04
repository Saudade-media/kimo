/**
 * Measured-pass helpers for the board 25 Code tab / Export additions scenarios (not a scenario
 * file: the runner only loads `*.e2e.ts`). One getComputedStyle / getBoundingClientRect read
 * per element, compared to the design node values, logged as a table.
 */
import type { Page } from "playwright"
import { type E2EContext, expect } from "./run"

export type Box = {
  w: number
  h: number
  x: number
  y: number
  pad: string
  gap: number
  fs: number
  fw: string
  ff: string | undefined
  fst: string
  bg: string
  color: string
  radius: number
  shadow: string
  border: string
  opacity: string
  display: string
  dir: string
  align: string
  justify: string
  ta: string
}

export function measure(page: Page, selectors: Record<string, string>) {
  return page.evaluate((sels) => {
    const out: Record<string, unknown> = {}
    for (const [k, sel] of Object.entries(sels)) {
      const e = document.querySelector(sel)
      if (!e) {
        out[k] = null
        continue
      }
      const r = e.getBoundingClientRect()
      const cs = getComputedStyle(e)
      out[k] = {
        w: r.width,
        h: r.height,
        x: r.x,
        y: r.y,
        pad: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft]
          .map((p) => String(parseFloat(p)))
          .join(" "),
        gap: parseFloat(cs.columnGap) || parseFloat(cs.rowGap) || 0,
        fs: parseFloat(cs.fontSize),
        fw: cs.fontWeight,
        ff: cs.fontFamily.split(",")[0]?.replace(/"/g, "").trim(),
        fst: cs.fontStyle,
        bg: cs.backgroundColor,
        color: cs.color,
        radius: parseFloat(cs.borderTopLeftRadius),
        shadow: cs.boxShadow,
        border: `${cs.borderTopWidth} ${cs.borderTopColor}`,
        opacity: cs.opacity,
        display: cs.display,
        dir: cs.flexDirection,
        align: cs.alignItems,
        justify: cs.justifyContent,
        ta: cs.textAlign,
      }
    }
    return out
  }, selectors) as Promise<Record<string, Box | null>>
}

/** Resolved colors of design tokens (`var(--kimo-…)` → `rgb(…)`). */
export const tokens = (page: Page, names: string[]) =>
  page.evaluate((ns) => {
    const out: Record<string, string> = {}
    for (const n of ns) {
      const el = document.createElement("div")
      el.style.color = `var(${n})`
      document.body.append(el)
      out[n] = getComputedStyle(el).color
      el.remove()
    }
    return out
  }, names)

type Want = Partial<Record<"w" | "h" | "gap" | "fs" | "radius", number>> &
  Partial<
    Record<
      "pad" | "fw" | "ff" | "fst" | "bg" | "color" | "dir" | "align" | "justify" | "ta" | "opacity",
      string
    >
  > & { shadowHas?: string; border?: string }

export function checker(ctx: E2EContext, surface: string) {
  const rows: string[] = []
  const check = (el: string, prop: string, got: unknown, want: number | string, tol = 0.75) => {
    const ok =
      typeof want === "number"
        ? typeof got === "number" && Math.abs(got - want) <= tol
        : got === want
    rows.push(
      `| ${el} | ${prop} | ${want} | ${typeof got === "number" ? Math.round(got * 100) / 100 : got} | ${ok ? "=" : "≠"} |`,
    )
    expect(ok, `${surface} › ${el} ${prop}: want ${want}, got ${got}`)
  }
  const box = (el: string, b: Box | null | undefined, want: Want) => {
    expect(b, `${surface} › ${el} is rendered`)
    if (!b) return
    expect(b.display !== "none" && b.h > 0, `${surface} › ${el} has a box`)
    for (const k of ["w", "h", "gap", "fs", "radius"] as const)
      if (want[k] !== undefined) check(el, k, b[k], want[k] as number)
    for (const k of [
      "pad",
      "fw",
      "ff",
      "fst",
      "bg",
      "color",
      "dir",
      "align",
      "justify",
      "ta",
      "opacity",
    ] as const)
      if (want[k] !== undefined) check(el, k, b[k], want[k] as string)
    if (want.border !== undefined) check(el, "border", b.border, want.border)
    if (want.shadowHas !== undefined)
      check(
        el,
        "shadow ∋",
        b.shadow.includes(want.shadowHas) ? want.shadowHas : b.shadow,
        want.shadowHas,
      )
  }
  const flush = () =>
    ctx.log(
      `\n    ${surface}\n    | element | property | design | measured | |\n    |---|---|---|---|---|\n${rows.map((r) => `    ${r}`).join("\n")}`,
    )
  return { check, box, flush }
}
