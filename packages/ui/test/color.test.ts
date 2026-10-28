import { describe, expect, test } from "bun:test"
import fc from "fast-check"
import {
  color,
  formatColor,
  parseColor,
  parseHex,
  parsePercent,
  percent,
  toHex,
} from "../src/index"

const byte = fc.integer({ min: 0, max: 255 })
const rgb = fc.record({ r: byte, g: byte, b: byte })

describe("color conversions", () => {
  test("hex parse / format", () => {
    expect(parseHex("#F4A261")).toEqual({ r: 244, g: 162, b: 97, a: 1 })
    expect(parseHex("f4a")).toEqual({ r: 255, g: 68, b: 170, a: 1 })
    expect(parseHex("#0A0A0A80")?.a).toBeCloseTo(128 / 255, 6)
    expect(parseHex("#12345")).toBeNull()
    expect(parseHex("zzzzzz")).toBeNull()
    expect(toHex({ r: 244, g: 162, b: 97, a: 1 })).toBe("#F4A261")
    expect(toHex({ r: 10, g: 10, b: 10, a: 0.5 })).toBe("#0A0A0A80")
  })

  test("known values in every format (CSS Color 4 reference values)", () => {
    const c = { r: 244, g: 162, b: 97, a: 1 }
    expect(formatColor(c, "hex")).toBe("F4A261")
    expect(formatColor(c, "rgb")).toBe("244 162 97")
    expect(formatColor(c, "hsl")).toBe("27 87 67")
    expect(formatColor(c, "oklch")).toBe("0.78 0.13 58")
    expect(formatColor({ r: 255, g: 0, b: 0, a: 1 }, "oklch")).toBe("0.63 0.26 29")
    expect(formatColor({ r: 0, g: 0, b: 255, a: 1 }, "hsl")).toBe("240 100 50")
    const white = color.rgbToOklch({ r: 255, g: 255, b: 255, a: 1 })
    expect(white.l).toBeCloseTo(1, 4)
    expect(white.c).toBeLessThan(1e-4)
  })

  test("HSV, HSL and OKLCH round-trip every sRGB byte triple", () => {
    fc.assert(
      fc.property(rgb, ({ r, g, b }) => {
        const c = { r, g, b, a: 1 }
        const hsv = color.hsvToRgb(color.rgbToHsv(c))
        const hsl = color.hslToRgb(color.rgbToHsl(c))
        const ok = color.oklchToRgb(color.rgbToOklch(c))
        expect([Math.round(hsv.r), Math.round(hsv.g), Math.round(hsv.b)]).toEqual([r, g, b])
        for (const [back, tol] of [
          [hsl, 1e-6],
          [ok, 0.01],
        ] as const) {
          expect(Math.abs(back.r - r)).toBeLessThan(tol)
          expect(Math.abs(back.g - g)).toBeLessThan(tol)
          expect(Math.abs(back.b - b)).toBeLessThan(tol)
        }
      }),
      { numRuns: 150 },
    )
  })

  test("typed values parse back (hsl: integer H/S/L quantise to <= 4.6 per byte channel)", () => {
    fc.assert(
      fc.property(
        rgb,
        fc.constantFrom("rgb", "hsl", "hex") as fc.Arbitrary<"rgb" | "hsl" | "hex">,
        (c, f) => {
          const text = formatColor({ ...c, a: 1 }, f)
          const p = parseColor(text, f)
          expect(p).not.toBeNull()
          const tol = f === "hsl" ? 4.6 : 0.5
          expect(Math.abs((p?.r ?? -9) - c.r)).toBeLessThanOrEqual(tol)
          expect(Math.abs((p?.g ?? -9) - c.g)).toBeLessThanOrEqual(tol)
          expect(Math.abs((p?.b ?? -9) - c.b)).toBeLessThanOrEqual(tol)
        },
      ),
      { numRuns: 100 },
    )
  })

  test("oklch out of gamut clips per channel; invalid input is null; hex alpha is kept", () => {
    const c = color.oklchToRgb({ l: 0.9, c: 0.4, h: 140 })
    for (const v of [c.r, c.g, c.b]) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(255)
    }
    expect(parseColor("1 2", "rgb")).toBeNull()
    expect(parseColor("a b c", "hsl")).toBeNull()
    expect(parseColor("#F4A26180", "hex", 1)?.a).toBeCloseTo(128 / 255, 6)
    expect(parseColor("F4A261", "hex", 0.5)?.a).toBe(0.5)
  })

  test("percent helpers clamp and reject junk", () => {
    expect(percent(0.8)).toBe("80%")
    expect(parsePercent("45%")).toBe(0.45)
    expect(parsePercent("150")).toBe(1)
    expect(parsePercent("x")).toBeNull()
  })
})
