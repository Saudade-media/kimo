/** Measured-pass helpers shared by the M6 e2e scenarios (getComputedStyle + getBoundingClientRect). */
import type { Page } from "playwright"
import { type E2EContext, expect } from "./run"

export type Box = {
  x: number
  y: number
  w: number
  h: number
  pad: number[]
  gap: number
  fs: number
  fw: string
  ff: string | undefined
  lh: number
  bg: string
  color: string
  radius: number
  shadow: string
  border: string
  borderB: string
  display: string
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
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
        pad: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(parseFloat),
        gap: parseFloat(cs.columnGap) || parseFloat(cs.rowGap) || 0,
        fs: parseFloat(cs.fontSize),
        fw: cs.fontWeight,
        ff: cs.fontFamily.split(",")[0]?.replace(/"/g, "").trim(),
        lh: parseFloat(cs.lineHeight),
        bg: cs.backgroundColor,
        color: cs.color,
        radius: parseFloat(cs.borderTopLeftRadius),
        shadow: cs.boxShadow,
        border: `${cs.borderTopWidth} ${cs.borderTopColor}`,
        borderB: `${cs.borderBottomWidth} ${cs.borderBottomColor}`,
        display: cs.display,
      }
    }
    return out
  }, selectors) as Promise<Record<string, Box | null>>
}

export const token = (page: Page, name: string) =>
  page.evaluate((n) => {
    const el = document.createElement("div")
    el.style.color = `var(${n})`
    document.body.append(el)
    const c = getComputedStyle(el).color
    el.remove()
    return c
  }, name)

export function checker(ctx: E2EContext, surface: string) {
  const rows: string[] = []
  const check = (
    el: string,
    prop: string,
    got: number | string | undefined | null,
    want: number | string,
    tol = 0.75,
  ) => {
    const ok =
      typeof want === "number"
        ? typeof got === "number" && Math.abs(got - want) <= tol
        : got === want
    rows.push(
      `| ${el} | ${prop} | ${want} | ${typeof got === "number" ? Math.round(got * 100) / 100 : got} | ${ok ? "=" : "≠"} |`,
    )
    expect(ok, `${surface} › ${el} ${prop}: want ${want}, got ${got}`)
  }
  const box = (
    el: string,
    b: Box | null | undefined,
    want: Partial<Record<"w" | "h" | "gap" | "fs" | "lh" | "radius", number>> & {
      pad?: number[]
      fw?: string
      ff?: string
      bg?: string
      color?: string
    },
  ) => {
    expect(b, `${surface} › ${el} is rendered`)
    if (!b) return
    expect(b.display !== "none" && b.h > 0, `${surface} › ${el} has a box`)
    for (const k of ["w", "h", "gap", "fs", "lh", "radius"] as const)
      if (want[k] !== undefined) check(el, k, b[k], want[k] as number)
    if (want.pad) check(el, "padding", b.pad.join(" "), want.pad.join(" "))
    if (want.fw) check(el, "font-weight", b.fw, want.fw)
    if (want.ff) check(el, "font-family", b.ff, want.ff)
    if (want.bg) check(el, "background", b.bg, want.bg)
    if (want.color) check(el, "color", b.color, want.color)
  }
  const flush = () =>
    ctx.log(
      `\n    ${surface}\n    | element | property | design | measured | |\n    |---|---|---|---|---|\n${rows.map((r) => `    ${r}`).join("\n")}`,
    )
  return { check, box, flush }
}
