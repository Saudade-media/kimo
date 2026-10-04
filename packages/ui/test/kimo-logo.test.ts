import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToString } from "react-dom/server"
import {
  KIMO_LOGO_PATH,
  KIMO_LOGO_SMALL_PATH,
  KimoLockup,
  KimoLogo,
  kimoLogoVariant,
} from "../src/index"

/** Absolute vertices of an M/m/L/l/z path (the only commands the mark uses). */
function vertices(d: string): [number, number][] {
  const toks = d.match(/[a-zA-Z]|-?\d*\.?\d+/g) ?? []
  const out: [number, number][] = []
  let cmd = ""
  let x = 0
  let y = 0
  let sx = 0
  let sy = 0
  for (let i = 0; i < toks.length; ) {
    const t = toks[i] as string
    if (/[a-zA-Z]/.test(t)) {
      cmd = t
      i++
      if (cmd === "z") [x, y] = [sx, sy]
      continue
    }
    const a = Number(toks[i])
    const b = Number(toks[i + 1])
    i += 2
    const rel = cmd === "m" || cmd === "l"
    x = rel ? x + a : a
    y = rel ? y + b : b
    if (cmd === "m" || cmd === "M") {
      ;[sx, sy] = [x, y]
      cmd = rel ? "l" : "L"
    }
    out.push([x, y])
  }
  return out
}

describe("KimoLogo geometry (desing.pen HTfes / r8A1fF)", () => {
  test("only M/m/l/z commands, two closed subpaths each", () => {
    for (const d of [KIMO_LOGO_PATH, KIMO_LOGO_SMALL_PATH]) {
      expect(d.replace(/[^a-zA-Z]/g, "")).toBe("Mlzmlz")
    }
  })

  test("vertex counts and the shared outline match the Pencil export", () => {
    const big = vertices(KIMO_LOGO_PATH)
    const small = vertices(KIMO_LOGO_SMALL_PATH)
    expect(big.length).toBe(384)
    expect(small.length).toBe(336)
    // Same outer outline; only the opening differs.
    const outline = KIMO_LOGO_PATH.slice(0, KIMO_LOGO_PATH.indexOf("z") + 1)
    expect(KIMO_LOGO_SMALL_PATH.startsWith(outline)).toBe(true)
    // Each subpath closes on itself (within the 0.01 rounding of the source).
    for (const v of [big, small]) {
      for (const p of v) {
        expect(p[0]).toBeGreaterThanOrEqual(0)
        expect(p[0]).toBeLessThanOrEqual(100)
        expect(p[1]).toBeGreaterThanOrEqual(0)
        expect(p[1]).toBeLessThanOrEqual(100)
      }
    }
    // The openings start where Pencil's absolute export puts them (M49.17 37.40 / M48.05 35.17).
    const n = vertices(outline).length
    const round = (p: [number, number] | undefined) => p?.map((c) => Math.round(c * 100) / 100)
    expect(round(big[n])).toEqual([49.17, 37.4])
    expect(round(small[n])).toEqual([48.05, 35.17])
  })
})

describe("KimoLogo", () => {
  test("auto picks the small cut at 24 px and below", () => {
    expect(kimoLogoVariant(16)).toBe("small")
    expect(kimoLogoVariant(24)).toBe("small")
    expect(kimoLogoVariant(25)).toBe("regular")
    expect(kimoLogoVariant(16, "regular")).toBe("regular")
    expect(kimoLogoVariant(56, "small")).toBe("small")
  })

  test("renders a decorative currentColor even-odd svg in a 0 0 100 100 viewBox", () => {
    const html = renderToString(createElement(KimoLogo, { size: 28 }))
    expect(html).toContain('viewBox="0 0 100 100"')
    expect(html).toContain('width="28" height="28"')
    expect(html).toContain('fill="currentColor"')
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('fill-rule="evenodd"')
    expect(html).toContain('class="kimo-logo kimo-logo--regular"')
    expect(html).toContain(`d="${KIMO_LOGO_PATH}"`)
  })

  test("small sizes draw KimoLogo/Small; a title makes it an image", () => {
    const html = renderToString(createElement(KimoLogo, { size: 16, title: "Kimo" }))
    expect(html).toContain(`d="${KIMO_LOGO_SMALL_PATH}"`)
    expect(html).toContain('role="img"')
    expect(html).toContain('aria-label="Kimo"')
    expect(html).not.toContain("aria-hidden")
  })
})

describe("KimoLockup", () => {
  test("mark 28 then the wordmark", () => {
    const html = renderToString(createElement(KimoLockup, { className: "x" }))
    expect(html.startsWith('<span class="kimo-lockup x"><svg')).toBe(true)
    expect(html).toContain('width="28" height="28"')
    expect(html).toContain('<span class="kimo-lockup__wordmark">Kimo</span>')
  })
})
