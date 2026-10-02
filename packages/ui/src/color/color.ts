/**
 * Pure color math for the color picker (board 09 `E1jsd`): hex ↔ RGB(A) ↔ HSV (ColorArea and
 * HueSlider), HSL and OKLCH (the Format menu `GbOS1`). No DOM, no React.
 *
 * Units: r/g/b 0–255 (not rounded), a 0–1; HSV h 0–360, s/v 0–1; HSL h 0–360, s/l 0–100 (CSS
 * units); OKLCH l 0–1, c ≥ 0, h 0–360 (Björn Ottosson's OKLab, sRGB D65).
 */

export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}
export interface Hsv {
  h: number
  s: number
  v: number
}
export interface Hsl {
  h: number
  s: number
  l: number
}
export interface Oklch {
  l: number
  c: number
  h: number
}

/** Value formats of the picker's Format menu (board 09 Row E, `GbOS1`), in menu order. */
export type ColorFormat = "hex" | "rgb" | "hsl" | "oklch"
export const COLOR_FORMATS: readonly { value: ColorFormat; label: string }[] = [
  { value: "hex", label: "HEX" },
  { value: "rgb", label: "RGB" },
  { value: "hsl", label: "HSL" },
  { value: "oklch", label: "OKLCH" },
]

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const hex2 = (n: number) =>
  Math.round(clamp(n, 0, 255))
    .toString(16)
    .padStart(2, "0")
    .toUpperCase()
const wrapHue = (h: number) => ((h % 360) + 360) % 360

/** Parses `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` (the `#` is optional); null when invalid. */
export function parseHex(input: string): Rgba | null {
  let s = input.trim().replace(/^#/, "")
  if (!/^[0-9a-f]+$/i.test(s)) return null
  if (s.length === 3 || s.length === 4) s = [...s].map((c) => c + c).join("")
  if (s.length !== 6 && s.length !== 8) return null
  const n = (i: number) => Number.parseInt(s.slice(i, i + 2), 16)
  return { r: n(0), g: n(2), b: n(4), a: s.length === 8 ? n(6) / 255 : 1 }
}

/** `#RRGGBB` when opaque, else `#RRGGBBAA` (uppercase, as `.kimo` documents store colors). */
export function toHex({ r, g, b, a }: Rgba): string {
  const base = `#${hex2(r)}${hex2(g)}${hex2(b)}`
  const alpha = Math.round(clamp(a, 0, 1) * 255)
  return alpha === 255 ? base : base + hex2(alpha)
}

/** `RRGGBB`: no `#`, no alpha (the Hex field and the FillRow label). */
export const hexDigits = (c: Rgba): string => toHex({ ...c, a: 1 }).slice(1)

export function rgbToHsv({ r, g, b }: Rgba): Hsv {
  const R = r / 255
  const G = g / 255
  const B = b / 255
  const max = Math.max(R, G, B)
  const d = max - Math.min(R, G, B)
  let h = 0
  if (d !== 0) {
    if (max === R) h = ((G - B) / d) % 6
    else if (max === G) h = (B - R) / d + 2
    else h = (R - G) / d + 4
    h = wrapHue(h * 60)
  }
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

export function hsvToRgb({ h, s, v }: Hsv, a = 1): Rgba {
  const hh = wrapHue(h) / 60
  const S = clamp(s, 0, 1)
  const V = clamp(v, 0, 1)
  const c = V * S
  const x = c * (1 - Math.abs((hh % 2) - 1))
  const m = V - c
  const i = Math.floor(hh) % 6
  const [r, g, b] = (
    [
      [c, x, 0],
      [x, c, 0],
      [0, c, x],
      [0, x, c],
      [x, 0, c],
      [c, 0, x],
    ] as const
  )[i] ?? [0, 0, 0]
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255, a }
}

export function rgbToHsl(c: Rgba): Hsl {
  const R = c.r / 255
  const G = c.g / 255
  const B = c.b / 255
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const l = (max + min) / 2
  const d = max - min
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  return { h: rgbToHsv(c).h, s: s * 100, l: l * 100 }
}

export function hslToRgb({ h, s, l }: Hsl, a = 1): Rgba {
  const S = clamp(s, 0, 100) / 100
  const L = clamp(l, 0, 100) / 100
  const v = L + S * Math.min(L, 1 - L)
  return hsvToRgb({ h, s: v === 0 ? 0 : 2 * (1 - L / v), v }, a)
}

const toLinear = (c: number) => {
  const x = clamp(c, 0, 255) / 255
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
}
const fromLinear = (x: number) =>
  255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.max(0, x) ** (1 / 2.4) - 0.055)

export function rgbToOklch({ r, g, b }: Rgba): Oklch {
  const R = toLinear(r)
  const G = toLinear(g)
  const B = toLinear(b)
  const l_ = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m_ = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s_ = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_
  const Bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_
  const c = Math.sqrt(A * A + Bb * Bb)
  return { l: L, c, h: c < 1e-4 ? 0 : wrapHue((Math.atan2(Bb, A) * 180) / Math.PI) }
}

/** Linear sRGB of an OKLCH color (unclamped; outside 0–1 when out of gamut). */
function oklchLinear(l: number, c: number, h: number): [number, number, number] {
  const hr = (h * Math.PI) / 180
  const A = c * Math.cos(hr)
  const B = c * Math.sin(hr)
  const l_ = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m_ = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s_ = (l - 0.0894841775 * A - 1.291485548 * B) ** 3
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ]
}

const GAMUT_EPS = 1e-6
const inGamut = (rgb: readonly number[]) => rgb.every((v) => v >= -GAMUT_EPS && v <= 1 + GAMUT_EPS)

/**
 * OKLCH → sRGB. Out-of-gamut colors are mapped by reducing chroma at the same lightness and
 * hue (CSS Color 4 gamut mapping, binary search), not by clipping each channel, which would
 * shift the hue (`1 0.5 400` stays a light red-pink instead of turning pure red).
 */
export function oklchToRgb({ l, c, h }: Oklch, a = 1): Rgba {
  const L = clamp(l, 0, 1)
  let rgb = oklchLinear(L, c, h)
  if (!inGamut(rgb)) {
    let lo = 0
    let hi = Math.max(0, c)
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2
      if (inGamut(oklchLinear(L, mid, h))) lo = mid
      else hi = mid
    }
    rgb = oklchLinear(L, lo, h)
  }
  return {
    r: clamp(fromLinear(rgb[0]), 0, 255),
    g: clamp(fromLinear(rgb[1]), 0, 255),
    b: clamp(fromLinear(rgb[2]), 0, 255),
    a,
  }
}

const fmt = (n: number, digits = 0) => {
  const p = 10 ** digits
  const r = Math.round(n * p) / p
  return Object.is(r, -0) ? "0" : String(r)
}

/**
 * Value text of a color in a format, as the Format menu's Meta column shows it (`GbOS1`):
 * hex `F4A261` (no `#`; the menu adds it), rgb `244 162 97`, hsl `27 87 67`, oklch `0.78 0.13 55`.
 */
export function formatColor(c: Rgba, format: ColorFormat): string {
  switch (format) {
    case "hex":
      return hexDigits(c)
    case "rgb":
      return `${fmt(c.r)} ${fmt(c.g)} ${fmt(c.b)}`
    case "hsl": {
      const { h, s, l } = rgbToHsl(c)
      return `${fmt(h)} ${fmt(s)} ${fmt(l)}`
    }
    case "oklch": {
      const { l, c: ch, h } = rgbToOklch(c)
      return `${fmt(l, 2)} ${fmt(ch, 2)} ${fmt(h)}`
    }
  }
}

/** The three channel values of a color in a non-hex format (the RGB/HSL/OKLCH value fields). */
export function channels(c: Rgba, format: Exclude<ColorFormat, "hex">): [number, number, number] {
  if (format === "rgb") return [Math.round(c.r), Math.round(c.g), Math.round(c.b)]
  if (format === "hsl") {
    const { h, s, l } = rgbToHsl(c)
    return [Math.round(h), Math.round(s), Math.round(l)]
  }
  const { l, c: ch, h } = rgbToOklch(c)
  return [Math.round(l * 100) / 100, Math.round(ch * 100) / 100, Math.round(h)]
}

/** Channel prefixes of the value fields per format. */
export const CHANNEL_PREFIXES: Record<Exclude<ColorFormat, "hex">, [string, string, string]> = {
  rgb: ["R", "G", "B"],
  hsl: ["H", "S", "L"],
  oklch: ["L", "C", "H"],
}

/** The unrounded channel values of a color in a non-hex format. */
function exactChannels(c: Rgba, format: Exclude<ColorFormat, "hex">): [number, number, number] {
  if (format === "rgb") return [c.r, c.g, c.b]
  if (format === "hsl") {
    const { h, s, l } = rgbToHsl(c)
    return [h, s, l]
  }
  const { l, c: ch, h } = rgbToOklch(c)
  return [l, ch, h]
}

/**
 * Applies text typed into the value field to `current`. The field shows rounded channels
 * (`formatColor`), so re-parsing all three would shift the color (OKLCH `0.88 0.15 197` is
 * 40/255 away from #28F6FA). Channels whose text is unchanged keep their exact value; only
 * edited channels take the typed number. Unchanged text returns `current` itself.
 */
export function editColor(
  current: Rgba,
  format: ColorFormat,
  text: string,
  alpha = current.a,
): Rgba | null {
  const shown = formatColor(current, format)
  if (text.trim().replace(/^#/, "").toLowerCase() === shown.toLowerCase())
    return { ...current, a: alpha }
  if (format === "hex") return parseColor(text, format, alpha)
  const tokens = text
    .trim()
    .split(/[\s,/]+/)
    .filter(Boolean)
  const parts = tokens.map((p) => Number(p.replace(/[%°]$/, "")))
  if (parts.length !== 3 || parts.some((p) => !Number.isFinite(p))) return null
  const was = shown.split(" ").map(Number)
  const exact = exactChannels(current, format)
  const next = parts.map((p, i) => (p === was[i] ? (exact[i] as number) : p)) as [
    number,
    number,
    number,
  ]
  return fromChannels(next, format, alpha)
}

/** Builds a color from three channel values of a format (alpha from `alpha`). */
export function fromChannels(
  [x, y, z]: readonly [number, number, number],
  format: Exclude<ColorFormat, "hex">,
  alpha = 1,
): Rgba {
  if (format === "rgb")
    return { r: clamp(x, 0, 255), g: clamp(y, 0, 255), b: clamp(z, 0, 255), a: alpha }
  if (format === "hsl") return hslToRgb({ h: x, s: y, l: z }, alpha)
  return oklchToRgb({ l: clamp(x, 0, 1), c: Math.max(0, y), h: z }, alpha)
}

/** Parses a value typed in `format`; null when invalid. Hex with 8 digits keeps its alpha. */
export function parseColor(input: string, format: ColorFormat, alpha = 1): Rgba | null {
  if (format === "hex") {
    const c = parseHex(input)
    if (!c) return null
    const digits = input.trim().replace(/^#/, "").length
    return { ...c, a: digits === 4 || digits === 8 ? c.a : alpha }
  }
  const parts = input
    .trim()
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map((p) => Number(p.replace(/[%°]$/, "")))
  if (parts.length !== 3 || parts.some((p) => !Number.isFinite(p))) return null
  return fromChannels(parts as [number, number, number], format, alpha)
}

/** Pure hue as hex (ColorArea base fill, `H5QKDe`). */
export const hueColor = (h: number): string => toHex(hsvToRgb({ h, s: 1, v: 1 }))

/** `"80%"` for 0.8. */
export const percent = (a: number): string => `${Math.round(clamp(a, 0, 1) * 100)}%`

/** Parses `80` / `80%` as 0.8 (clamped 0–1); null when invalid. */
export function parsePercent(input: string): number | null {
  const t = input.trim().replace(/%$/, "").replace(",", ".")
  if (t === "") return null
  const n = Number(t)
  return Number.isFinite(n) ? clamp(n / 100, 0, 1) : null
}
