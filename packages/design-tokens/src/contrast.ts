/** WCAG 2.x contrast helpers for `#RGB`, `#RRGGBB` and `#RRGGBBAA` colors. */

const parse = (hex: string): [number, number, number, number] => {
  let h = hex.replace(/^#/, "")
  if (h.length === 3) h = [...h].map((c) => c + c).join("")
  if (h.length !== 6 && h.length !== 8) throw new Error(`Unsupported color "${hex}"`)
  const n = (i: number) => Number.parseInt(h.slice(i, i + 2), 16) / 255
  return [n(0), n(2), n(4), h.length === 8 ? n(6) : 1]
}

const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

/**
 * WCAG relative luminance of an opaque color. A translucent color is first composited over
 * `backdrop` (default white).
 */
export function relativeLuminance(hex: string, backdrop = "#FFFFFF"): number {
  const [r, g, b, a] = parse(hex)
  const [br, bg, bb] = parse(backdrop)
  const mix = (c: number, d: number) => c * a + d * (1 - a)
  return 0.2126 * linear(mix(r, br)) + 0.7152 * linear(mix(g, bg)) + 0.0722 * linear(mix(b, bb))
}

/** WCAG contrast ratio (1–21) of `fg` drawn on an opaque `bg`. */
export function contrastRatio(fg: string, bg: string): number {
  const a = relativeLuminance(fg, bg)
  const b = relativeLuminance(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
