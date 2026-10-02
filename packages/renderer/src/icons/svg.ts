/**
 * Icon SVG → {@link IconGlyph} normalization (ADR 0010 "Icons"). The four icon packages ship
 * flat SVGs (no groups, transforms or `<use>`): `path`, `circle`, `ellipse`, `rect`, `line`,
 * `polyline`, `polygon`. Every element becomes path data; the root `fill="none"` +
 * `stroke` (lucide, feather) makes elements stroke paths, unless an element sets its own
 * `fill` (lucide's `fill="currentColor"` dots are filled and stroked). Pure, no CanvasKit.
 */
import type { IconGlyph, IconPath } from "../types"

const ELEMENT = /<(path|circle|ellipse|rect|line|polyline|polygon)\b([^>]*?)\/?>/g
const ATTR = /([a-zA-Z][a-zA-Z0-9:-]*)\s*=\s*"([^"]*)"/g
const ROOT = /<svg\b([^>]*)>/

function attrs(s: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of s.matchAll(ATTR)) out[m[1] as string] = m[2] as string
  return out
}

const n = (v: string | undefined, d = 0): number => {
  const x = v === undefined ? Number.NaN : Number.parseFloat(v)
  return Number.isFinite(x) ? x : d
}

const fmt = (v: number) => String(Math.round(v * 1e4) / 1e4)

function points(s: string | undefined): number[] {
  return (s ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .filter((v) => Number.isFinite(v))
}

/** Path data of one SVG element, or null when degenerate. */
export function elementPath(tag: string, a: Record<string, string>): string | null {
  switch (tag) {
    case "path":
      return a.d?.trim() || null
    case "circle":
    case "ellipse": {
      const cx = n(a.cx)
      const cy = n(a.cy)
      const rx = tag === "circle" ? n(a.r) : n(a.rx)
      const ry = tag === "circle" ? n(a.r) : n(a.ry, rx)
      if (rx <= 0 || ry <= 0) return null
      return `M${fmt(cx - rx)} ${fmt(cy)}a${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(2 * rx)} 0a${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(-2 * rx)} 0Z`
    }
    case "rect": {
      const x = n(a.x)
      const y = n(a.y)
      const w = n(a.width)
      const h = n(a.height)
      if (w <= 0 || h <= 0) return null
      let rx = a.rx !== undefined ? n(a.rx) : a.ry !== undefined ? n(a.ry) : 0
      let ry = a.ry !== undefined ? n(a.ry) : rx
      rx = Math.min(Math.max(0, rx), w / 2)
      ry = Math.min(Math.max(0, ry), h / 2)
      if (rx === 0 || ry === 0) return `M${fmt(x)} ${fmt(y)}h${fmt(w)}v${fmt(h)}h${fmt(-w)}Z`
      const ax = `a${fmt(rx)} ${fmt(ry)} 0 0 1`
      return (
        `M${fmt(x + rx)} ${fmt(y)}h${fmt(w - 2 * rx)}${ax} ${fmt(rx)} ${fmt(ry)}` +
        `v${fmt(h - 2 * ry)}${ax} ${fmt(-rx)} ${fmt(ry)}h${fmt(-(w - 2 * rx))}` +
        `${ax} ${fmt(-rx)} ${fmt(-ry)}v${fmt(-(h - 2 * ry))}${ax} ${fmt(rx)} ${fmt(-ry)}Z`
      )
    }
    case "line":
      return `M${fmt(n(a.x1))} ${fmt(n(a.y1))}L${fmt(n(a.x2))} ${fmt(n(a.y2))}`
    case "polyline":
    case "polygon": {
      const p = points(a.points)
      if (p.length < 4) return null
      let d = `M${fmt(p[0] as number)} ${fmt(p[1] as number)}`
      for (let i = 2; i + 1 < p.length; i += 2)
        d += `L${fmt(p[i] as number)} ${fmt(p[i + 1] as number)}`
      return tag === "polygon" ? `${d}Z` : d
    }
  }
  return null
}

/** Normalizes one icon SVG document. Returns null for unparseable input. */
export function normalizeSvg(
  svg: string,
  set: string,
  name: string,
  weight: number | null,
): IconGlyph | null {
  const root = ROOT.exec(svg)
  if (!root) return null
  const ra = attrs(root[1] as string)
  const vb = points(ra.viewBox)
  const viewBox: [number, number, number, number] =
    vb.length === 4
      ? [vb[0] as number, vb[1] as number, vb[2] as number, vb[3] as number]
      : [0, 0, n(ra.width, 24), n(ra.height, 24)]
  const rootStroke = ra.stroke !== undefined && ra.stroke !== "none"
  const rootFill = ra.fill === undefined ? !rootStroke : ra.fill !== "none"
  const paths: IconPath[] = []
  for (const m of svg.slice(root.index + root[0].length).matchAll(ELEMENT)) {
    const a = attrs(m[2] as string)
    const d = elementPath(m[1] as string, a)
    if (!d) continue
    const fill = a.fill === undefined ? rootFill : a.fill !== "none"
    const stroke = a.stroke === undefined ? rootStroke : a.stroke !== "none"
    const extra: Partial<IconPath> = {}
    const rule = a["fill-rule"] ?? ra["fill-rule"]
    if (rule === "evenodd") extra.fillRule = "evenodd"
    const op = a.opacity !== undefined ? n(a.opacity, 1) : 1
    if (op !== 1) extra.opacity = op
    if (fill) paths.push({ d, paint: "fill", ...extra })
    if (stroke) paths.push({ d, paint: "stroke", ...extra })
  }
  const glyph: IconGlyph = { set, name, weight, viewBox, paths }
  if (rootStroke) glyph.strokeWidth = n(ra["stroke-width"], 1)
  return glyph
}
