/**
 * Color parsing and conversion to sRGB (spec §3 "Colors"): hex, OKLCH and Display-P3.
 * Out-of-gamut colors are gamut-mapped with the CSS Color 4 algorithm (OKLCH chroma
 * reduction with a deltaEOK just-noticeable-difference of 0.02). Pure, no CanvasKit.
 *
 * Color spaces (M3, ADR 0011): CanvasKit 0.42 can tag a surface `ColorSpace.DISPLAY_P3` and
 * convert per paint (`Paint.setColor(color, colorSpace)`), but every Kimo surface is sRGB: the
 * WebGL canvas (default `MakeWebGLCanvasSurface`), the CPU raster path and PNG export, so the
 * same document renders identically on every display and in exports. OKLCH and Display-P3
 * values (literal or variable-bound, including aliases) are therefore converted here and
 * gamut-mapped to sRGB once, before they reach Skia. Rendering wide-gamut on P3 displays would
 * need a P3 surface plus paints that carry their source space end to end (gradients, shadows,
 * blends); not in M3.
 */
import { isObject } from "@kimo/core-schema"

/** Non-premultiplied sRGB, every channel 0–1. */
export type RGBA = readonly [number, number, number, number]

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

const HEX = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/

/** Parses `#RGB`, `#RRGGBB`, `#RRGGBBAA`. */
export function parseHex(hex: string): RGBA | null {
  const m = HEX.exec(hex)
  if (!m) return null
  let h = m[1] as string
  if (h.length === 3) h = `${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`
  const n = (i: number) => Number.parseInt(h.slice(i, i + 2), 16) / 255
  return [n(0), n(2), n(4), h.length === 8 ? n(6) : 1]
}

/** Parses any literal Color value (already resolved; a `$ref` returns null). */
export function parseColor(value: unknown): RGBA | null {
  if (typeof value === "string") return parseHex(value)
  if (!isObject(value)) return null
  const alpha = typeof value.alpha === "number" ? clamp01(value.alpha) : 1
  if (value.space === "oklch") {
    const { l, c, h } = value
    if (typeof l !== "number" || typeof c !== "number" || typeof h !== "number") return null
    const [r, g, b] = oklchToSrgb(l, c, h)
    return [r, g, b, alpha]
  }
  if (value.space === "display-p3") {
    const { r, g, b } = value
    if (typeof r !== "number" || typeof g !== "number" || typeof b !== "number") return null
    const [sr, sg, sb] = p3ToSrgb(r, g, b)
    return [sr, sg, sb, alpha]
  }
  return null
}

/** Multiplies the alpha channel. */
export function withAlpha(c: RGBA, alpha: number): RGBA {
  return [c[0], c[1], c[2], c[3] * clamp01(alpha)]
}

/** `#RRGGBBAA` (lowercase) — handy for tests and debugging. */
export function toHex(c: RGBA): string {
  const h = (v: number) =>
    Math.round(clamp01(v) * 255)
      .toString(16)
      .padStart(2, "0")
  return `#${h(c[0])}${h(c[1])}${h(c[2])}${h(c[3])}`
}

// --- Transfer functions -------------------------------------------------------------------

const toLinear = (v: number) => {
  const a = Math.abs(v)
  return Math.sign(v) * (a <= 0.04045 ? a / 12.92 : ((a + 0.055) / 1.055) ** 2.4)
}
const toGamma = (v: number) => {
  const a = Math.abs(v)
  return Math.sign(v) * (a <= 0.0031308 ? 12.92 * a : 1.055 * a ** (1 / 2.4) - 0.055)
}

// --- OKLab --------------------------------------------------------------------------------

type Vec3 = [number, number, number]

/** OKLab → linear sRGB. */
export function oklabToLinearSrgb(L: number, a: number, b: number): Vec3 {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

/** Linear sRGB → OKLab. */
export function linearSrgbToOklab(r: number, g: number, b: number): Vec3 {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

/** sRGB (gamma) → OKLab, for gradient interpolation. */
export function srgbToOklab(c: RGBA): Vec3 {
  return linearSrgbToOklab(toLinear(c[0]), toLinear(c[1]), toLinear(c[2]))
}

/** OKLab → gamma sRGB, gamut-mapped. */
export function oklabToSrgb(L: number, a: number, b: number): Vec3 {
  const C = Math.hypot(a, b)
  const h = (Math.atan2(b, a) * 180) / Math.PI
  return oklchToSrgb(L, C, h)
}

const inGamut = (v: Vec3) => v.every((x) => x >= -1e-6 && x <= 1 + 1e-6)

const deltaEOK = (x: Vec3, y: Vec3) => Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2])

/** OKLCH → gamma sRGB with CSS Color 4 gamut mapping. */
export function oklchToSrgb(L: number, C: number, hDeg: number): Vec3 {
  if (L >= 1) return [1, 1, 1]
  if (L <= 0) return [0, 0, 0]
  const hr = (hDeg * Math.PI) / 180
  const lin = (c: number): Vec3 => oklabToLinearSrgb(L, c * Math.cos(hr), c * Math.sin(hr))
  const gamma = (v: Vec3): Vec3 => [toGamma(v[0]), toGamma(v[1]), toGamma(v[2])]
  const start = gamma(lin(C))
  if (inGamut(start)) return start.map(clamp01) as Vec3
  // CSS Color 4 §13.2: binary search on chroma, accepting a clipped color within JND.
  const JND = 0.02
  const EPS = 0.0001
  const clipOf = (v: Vec3): Vec3 => v.map(clamp01) as Vec3
  const labOf = (g: Vec3): Vec3 => linearSrgbToOklab(toLinear(g[0]), toLinear(g[1]), toLinear(g[2]))
  let clipped = clipOf(start)
  if (deltaEOK(labOf(clipped), [L, C * Math.cos(hr), C * Math.sin(hr)]) < JND) return clipped
  let min = 0
  let max = C
  let minInGamut = true
  while (max - min > EPS) {
    const chroma = (min + max) / 2
    const current = gamma(lin(chroma))
    if (minInGamut && inGamut(current)) {
      min = chroma
      continue
    }
    clipped = clipOf(current)
    const e = deltaEOK(labOf(clipped), [L, chroma * Math.cos(hr), chroma * Math.sin(hr)])
    if (e < JND) {
      if (JND - e < EPS) return clipped
      minInGamut = false
      min = chroma
    } else max = chroma
  }
  return clipped
}

/** Display-P3 (gamma) → gamut-mapped sRGB. */
export function p3ToSrgb(r: number, g: number, b: number): Vec3 {
  const R = toLinear(r)
  const G = toLinear(g)
  const B = toLinear(b)
  const lr = 1.2249401762805598 * R - 0.22494017628055996 * G
  const lg = -0.04205695470968816 * R + 1.0420569547096881 * G
  const lb = -0.01963755459033443 * R - 0.07863604555063183 * G + 1.0982736001409663 * B
  const direct: Vec3 = [toGamma(lr), toGamma(lg), toGamma(lb)]
  if (inGamut(direct)) return direct.map(clamp01) as Vec3
  const [L, a, bb] = linearSrgbToOklab(lr, lg, lb)
  return oklabToSrgb(L, a, bb)
}
