import { describe, expect, test } from "bun:test"
import { oklchToSrgb, p3ToSrgb, parseColor, parseHex, srgbToOklab, toHex } from "../src/color"

describe("colors", () => {
  test("hex forms", () => {
    expect(parseHex("#fff")).toEqual([1, 1, 1, 1])
    expect(toHex(parseHex("#2F6BFF") ?? [0, 0, 0, 0])).toBe("#2f6bffff")
    expect(toHex(parseHex("#2F6BFF1A") ?? [0, 0, 0, 0])).toBe("#2f6bff1a")
    expect(parseHex("#ffff")).toBeNull()
    expect(parseColor({ $ref: "x" })).toBeNull()
  })

  test("OKLCH → sRGB (in gamut, round trip through OKLab)", () => {
    const c = parseColor({ space: "oklch", l: 0.6, c: 0.1, h: 250, alpha: 0.5 })
    expect(c?.[3]).toBe(0.5)
    const [L, a, b] = srgbToOklab(c ?? [0, 0, 0, 1])
    expect(L).toBeCloseTo(0.6, 3)
    expect(Math.hypot(a, b)).toBeCloseTo(0.1, 3)
    // white/black extremes
    expect(oklchToSrgb(1, 0.2, 30)).toEqual([1, 1, 1])
    expect(oklchToSrgb(0, 0.2, 30)).toEqual([0, 0, 0])
  })

  test("out-of-gamut OKLCH is gamut-mapped into [0, 1]", () => {
    const c = oklchToSrgb(0.7, 0.4, 145)
    for (const v of c) expect(v >= 0 && v <= 1).toBe(true)
    // hue preserved approximately
    const [, a, b] = srgbToOklab([c[0], c[1], c[2], 1])
    const h = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360
    expect(Math.abs(h - 145)).toBeLessThan(6)
  })

  test("Display-P3", () => {
    expect(p3ToSrgb(1, 1, 1).map((v) => Math.round(v * 255))).toEqual([255, 255, 255])
    const red = p3ToSrgb(1, 0, 0) // outside sRGB → mapped
    for (const v of red) expect(v >= 0 && v <= 1).toBe(true)
    expect(red[0]).toBeGreaterThan(0.9)
    for (const v of p3ToSrgb(0.5, 0.5, 0.5)) expect(v).toBeCloseTo(0.5, 5)
  })
})
