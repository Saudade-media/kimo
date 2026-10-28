/**
 * SVG → Kimo nodes ("Vector paths" option of the SVG import popover, board 19 `mevh8`):
 * "Editable paths in a frame". One root frame sized to the SVG; every shape becomes a `path`
 * node (absolute geometry, transforms baked in), with fills, strokes and gradients mapped to
 * Kimo paints. Options: Keep groups as frames, Match fills to variables, Outline strokes.
 */
import type { InsertOp, Op } from "@kimo/editor-state"
import {
  type Bounds,
  type Matrix,
  matrixScale,
  multiply,
  parsePath,
  parseTransform,
  type Seg,
  segmentBounds,
  serializeSegments,
  shapeToSegments,
  transformSegments,
  unionBounds,
} from "./geometry"
import { type SanitizedSvg, type SanitizeReport, type SvgElement, sanitizeSvg } from "./sanitize"

export interface SvgImportOptions {
  /** "Keep groups as frames" (default on). Off: every path goes straight into the root frame. */
  keepGroups: boolean
  /** "Match fills to variables" (default on): a fill equal to a color variable binds to it. */
  matchVariables: boolean
  /** "Outline strokes" (default off): strokes become filled paths (needs an outliner). */
  outlineStrokes: boolean
}

export const DEFAULT_SVG_OPTIONS: SvgImportOptions = {
  keepGroups: true,
  matchVariables: true,
  outlineStrokes: false,
}

export interface SvgStats {
  paths: number
  groups: number
  gradients: number
  /** Unsupported element → count (dropped). */
  unsupported: Record<string, number>
  /** Security removals (scripts, handlers, external refs). */
  blocked: string[]
  /** Strokes that stayed strokes because no outliner was available. */
  strokesKept: number
  /**
   * Paths with a visible stroke (board 27 r6nLx: enables "Outline strokes" and is the count in
   * its sub line). Absent = 0.
   */
  stroked?: number
}

/** Outlines a stroke into fill geometry (CanvasKit `Path.stroke` in the app). */
export type StrokeOutliner = (
  d: string,
  stroke: {
    width: number
    cap: string
    join: string
    miterLimit: number
    /** SVG `stroke-dasharray` (absent / empty = solid). */
    dash?: readonly number[]
    /** SVG `stroke-dashoffset`. */
    dashOffset?: number
  },
) => string | null

export interface ConvertContext {
  /** Root frame name (file name without `.svg`). */
  name: string
  /** Color variables of the document, name → hex (non-themed / default entry). */
  colorVariables?: Readonly<Record<string, string>>
  outline?: StrokeOutliner
  /** Id generator (`generateId` from editor-state). */
  newId: () => string
  /** Where to put the root frame. */
  at?: { x: number; y: number }
  parent?: string | null
}

interface ConvertResult {
  ops: Op[]
  rootId: string
  stats: SvgStats
  size: { w: number; h: number }
}

// --- Colors ----------------------------------------------------------------------------------

const NAMED: Record<string, string> = {
  black: "#000000",
  white: "#FFFFFF",
  red: "#FF0000",
  green: "#008000",
  blue: "#0000FF",
  yellow: "#FFFF00",
  orange: "#FFA500",
  purple: "#800080",
  gray: "#808080",
  grey: "#808080",
  silver: "#C0C0C0",
  navy: "#000080",
  teal: "#008080",
  maroon: "#800000",
  lime: "#00FF00",
  aqua: "#00FFFF",
  cyan: "#00FFFF",
  fuchsia: "#FF00FF",
  magenta: "#FF00FF",
  olive: "#808000",
}

const hex2 = (n: number) =>
  Math.round(Math.min(255, Math.max(0, n)))
    .toString(16)
    .padStart(2, "0")
    .toUpperCase()

/** `#RRGGBB` / `#RRGGBBAA` for a CSS color, or null (`none`, unknown). */
function parseSvgColor(v: string | undefined, alpha = 1): string | null {
  if (!v) return null
  const s = v.trim().toLowerCase()
  if (s === "none" || s === "transparent") return null
  let r = 0
  let g = 0
  let b = 0
  let a = 1
  const m3 = /^#([0-9a-f]{3,4})$/.exec(s)
  const m6 = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(s)
  const rgb =
    /^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s)
  const ch = (x: string) => (x.endsWith("%") ? (Number.parseFloat(x) * 255) / 100 : Number(x))
  if (m3) {
    const h = m3[1] as string
    r = Number.parseInt(`${h[0]}${h[0]}`, 16)
    g = Number.parseInt(`${h[1]}${h[1]}`, 16)
    b = Number.parseInt(`${h[2]}${h[2]}`, 16)
    if (h[3]) a = Number.parseInt(h[3] + h[3], 16) / 255
  } else if (m6) {
    const h = m6[1] as string
    r = Number.parseInt(h.slice(0, 2), 16)
    g = Number.parseInt(h.slice(2, 4), 16)
    b = Number.parseInt(h.slice(4, 6), 16)
    if (m6[2]) a = Number.parseInt(m6[2], 16) / 255
  } else if (rgb) {
    r = ch(rgb[1] as string)
    g = ch(rgb[2] as string)
    b = ch(rgb[3] as string)
    if (rgb[4]) a = rgb[4].endsWith("%") ? Number.parseFloat(rgb[4]) / 100 : Number(rgb[4])
  } else if (NAMED[s]) return parseSvgColor(NAMED[s], alpha)
  else if (s === "currentcolor") return parseSvgColor("#000000", alpha)
  else return null
  if (![r, g, b, a].every(Number.isFinite)) return null
  const fa = Math.min(1, Math.max(0, a * alpha))
  return `#${hex2(r)}${hex2(g)}${hex2(b)}${fa < 1 ? hex2(fa * 255) : ""}`
}

// --- Styles ----------------------------------------------------------------------------------

/** Presentation properties that inherit. */
const INHERITED = [
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "color",
  "visibility",
] as const

type Style = Record<string, string>

function parseDeclarations(s: string | undefined): Style {
  const out: Style = {}
  if (!s) return out
  for (const decl of s.split(";")) {
    const i = decl.indexOf(":")
    if (i < 0) continue
    const k = decl.slice(0, i).trim().toLowerCase()
    const v = decl
      .slice(i + 1)
      .replace(/!important/i, "")
      .trim()
    if (k && v) out[k] = v
  }
  return out
}

interface CssRule {
  sel: { kind: "class" | "id" | "tag"; name: string }
  decls: Style
}

/** Simple `<style>` rules: `.cls`, `#id`, `tag` (and comma lists). Others are ignored. */
function parseCss(css: string): CssRule[] {
  const out: CssRule[] = []
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "")
  const re = /([^{}]+)\{([^{}]*)\}/g
  for (let m = re.exec(clean); m; m = re.exec(clean)) {
    const decls = parseDeclarations(m[2])
    for (const raw of (m[1] as string).split(",")) {
      const s = raw.trim()
      const k = /^\.([\w-]+)$/.exec(s)
      const id = /^#([\w-]+)$/.exec(s)
      const tag = /^([a-zA-Z][\w-]*)$/.exec(s)
      if (k) out.push({ sel: { kind: "class", name: k[1] as string }, decls })
      else if (id) out.push({ sel: { kind: "id", name: id[1] as string }, decls })
      else if (tag) out.push({ sel: { kind: "tag", name: tag[1] as string }, decls })
    }
  }
  return out
}

// --- Conversion ------------------------------------------------------------------------------

interface Gradient {
  kind: "linear" | "radial"
  stops: { color: string; at: number }[]
  attrs: Record<string, string>
}

function collectIds(root: SvgElement): Map<string, SvgElement> {
  const out = new Map<string, SvgElement>()
  const walk = (el: SvgElement) => {
    if (el.attrs.id && !out.has(el.attrs.id)) out.set(el.attrs.id, el)
    for (const c of el.children) walk(c)
  }
  walk(root)
  return out
}

const len = (v: string | undefined, d: number) => {
  const x = Number.parseFloat(v ?? "")
  return Number.isFinite(x) && !/%$/.test(v ?? "") ? x : d
}

/** The SVG's viewBox and display size. */
export function svgSize(root: SvgElement): { viewBox: Bounds; w: number; h: number } {
  const vb = (root.attrs.viewBox ?? "")
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number)
  const hasVb =
    vb.length === 4 && vb.every(Number.isFinite) && (vb[2] as number) > 0 && (vb[3] as number) > 0
  const viewBox: Bounds = hasVb
    ? { x: vb[0] as number, y: vb[1] as number, w: vb[2] as number, h: vb[3] as number }
    : { x: 0, y: 0, w: len(root.attrs.width, 100), h: len(root.attrs.height, 100) }
  const w = len(root.attrs.width, viewBox.w)
  const h = len(root.attrs.height, viewBox.h)
  return { viewBox, w: w > 0 ? w : viewBox.w, h: h > 0 ? h : viewBox.h }
}

/** Popover description: "Editable paths in a frame. 14 paths · 3 groups · 1 gradient.
 * Unsupported: 1 filter (dropped)." */
export function describeStats(s: SvgStats): string {
  const p = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
  const parts = [p(s.paths, "path")]
  if (s.groups) parts.push(p(s.groups, "group"))
  if (s.gradients) parts.push(p(s.gradients, "gradient"))
  if (s.stroked) parts.push(p(s.stroked, "stroked path"))
  let out = `Editable paths in a frame. ${parts.join(" · ")}.`
  const un = Object.entries(s.unsupported)
  if (un.length)
    out += ` Unsupported: ${un.map(([k, n]) => `${n} ${k}${n === 1 ? "" : "s"}`).join(", ")} (dropped).`
  return out
}

interface Draft {
  kind: "path" | "group"
  name: string
  bounds: Bounds | null
  segs?: Seg[]
  style?: Style
  fillRule?: string
  scale?: number
  children?: Draft[]
}

/** Walks the sanitized tree into drafts (paths with world geometry, groups). */
function walk(svg: SanitizedSvg, report: SanitizeReport) {
  const ids = collectIds(svg.root)
  const rules = svg.root.children
    .flatMap(function styles(el): SvgElement[] {
      return el.name === "style" ? [el] : el.children.flatMap(styles)
    })
    .flatMap((s) => parseCss(s.text ?? ""))
  const { viewBox, w, h } = svgSize(svg.root)
  const rootM: Matrix = [
    w / viewBox.w,
    0,
    0,
    h / viewBox.h,
    (-viewBox.x * w) / viewBox.w,
    (-viewBox.y * h) / viewBox.h,
  ]
  const gradients = new Map<string, Gradient | null>()
  const stats: SvgStats = {
    paths: 0,
    groups: 0,
    gradients: 0,
    unsupported: { ...report.unsupported },
    blocked: [...report.blocked],
    strokesKept: 0,
    stroked: 0,
  }

  const ownStyle = (el: SvgElement): Style => {
    const s: Style = {}
    for (const k of INHERITED) if (el.attrs[k] !== undefined) s[k] = el.attrs[k] as string
    if (el.attrs.opacity !== undefined) s.opacity = el.attrs.opacity
    if (el.attrs.display !== undefined) s.display = el.attrs.display
    for (const r of rules) {
      const hit =
        (r.sel.kind === "tag" && r.sel.name === el.name) ||
        (r.sel.kind === "id" && r.sel.name === el.attrs.id) ||
        (r.sel.kind === "class" && (el.attrs.class ?? "").split(/\s+/).includes(r.sel.name))
      if (hit) Object.assign(s, r.decls)
    }
    Object.assign(s, parseDeclarations(el.attrs.style))
    return s
  }

  const gradient = (id: string): Gradient | null => {
    if (gradients.has(id)) return gradients.get(id) ?? null
    const el = ids.get(id)
    let g: Gradient | null = null
    if (el && (el.name === "linearGradient" || el.name === "radialGradient")) {
      // Stops may be inherited from an href'd gradient.
      let stopsFrom: SvgElement | undefined = el
      for (let i = 0; i < 4 && stopsFrom && !stopsFrom.children.some((c) => c.name === "stop"); i++)
        stopsFrom = stopsFrom.attrs.href ? ids.get(stopsFrom.attrs.href.slice(1)) : undefined
      const stops = (stopsFrom?.children ?? [])
        .filter((c) => c.name === "stop")
        .map((s) => {
          const st = { ...s.attrs, ...parseDeclarations(s.attrs.style) }
          const off = st.offset ?? "0"
          const at = off.endsWith("%") ? Number.parseFloat(off) / 100 : Number.parseFloat(off)
          return {
            color:
              parseSvgColor(st["stop-color"] ?? "#000000", len(st["stop-opacity"], 1)) ??
              "#00000000",
            at: Math.min(1, Math.max(0, Number.isFinite(at) ? at : 0)),
          }
        })
      if (stops.length >= 2) {
        g = { kind: el.name === "linearGradient" ? "linear" : "radial", stops, attrs: el.attrs }
        stats.gradients++
      } else if (stops[0]) g = { kind: "linear", stops: [stops[0], stops[0]], attrs: el.attrs }
    }
    gradients.set(id, g)
    return g
  }

  const visit = (
    el: SvgElement,
    m: Matrix,
    inherited: Style,
    depth: number,
    useDepth: number,
  ): Draft[] => {
    if (depth > 64) return []
    if (
      el.name === "defs" ||
      el.name === "style" ||
      el.name === "linearGradient" ||
      el.name === "radialGradient" ||
      el.name === "symbol" ||
      el.name === "stop"
    )
      return []
    const own = ownStyle(el)
    if (own.display === "none" || own.visibility === "hidden") return []
    const style: Style = { ...inherited }
    for (const k of INHERITED) if (own[k] !== undefined) style[k] = own[k] as string
    // Group opacity multiplies into children (Kimo groups have no opacity of their own here).
    const op = len(own.opacity, 1)
    style["--opacity"] = String(len(inherited["--opacity"], 1) * op)
    const mm = multiply(m, parseTransform(el.attrs.transform))
    if (el.name === "use") {
      const target = el.attrs.href ? ids.get(el.attrs.href.slice(1)) : undefined
      if (!target || useDepth > 8) return []
      const tm = multiply(mm, [1, 0, 0, 1, len(el.attrs.x, 0), len(el.attrs.y, 0)])
      const inner = target.name === "symbol" ? { ...target, name: "g" } : target
      return visit(inner, tm, style, depth + 1, useDepth + 1)
    }
    if (el.name === "g" || el.name === "svg") {
      const children = el.children.flatMap((c) => visit(c, mm, style, depth + 1, useDepth))
      if (!children.length) return []
      if (el.name === "svg" && depth === 0) return children
      stats.groups++
      return [
        {
          kind: "group",
          name: el.attrs.id ?? "Group",
          bounds: children.reduce<Bounds | null>((b, c) => unionBounds(b, c.bounds), null),
          children,
        },
      ]
    }
    const segs = shapeToSegments(el.name, el.attrs)
    if (!segs?.length) return []
    const world = transformSegments(segs, mm)
    stats.paths++
    if (hasStroke(style)) stats.stroked = (stats.stroked ?? 0) + 1
    for (const v of [style.fill, style.stroke]) {
      const ref = v ? /^url\(\s*['"]?#([\w.:-]+)/.exec(v) : null
      if (ref) gradient(ref[1] as string)
    }
    return [
      {
        kind: "path",
        name: el.attrs.id ?? el.name[0]?.toUpperCase() + el.name.slice(1),
        bounds: segmentBounds(world),
        segs: world,
        style,
        fillRule: style["fill-rule"] === "evenodd" ? "evenodd" : "nonzero",
        scale: matrixScale(mm),
      },
    ]
  }
  const drafts = visit(svg.root, rootM, {}, 0, 0)
  return { drafts, stats, w, h, gradient }
}

type Paint = string | { $ref: string } | Record<string, unknown>

/** Converts a sanitized SVG to insert ops (one root frame + children), ready for `store.apply`. */
export function convertSvg(
  svg: SanitizedSvg,
  options: SvgImportOptions,
  ctx: ConvertContext,
): ConvertResult {
  const { drafts, stats, w, h, gradient } = walk(svg, svg.report)
  const vars = ctx.colorVariables ?? {}
  const varByHex = new Map<string, string>()
  for (const [name, hexv] of Object.entries(vars)) {
    const k = hexv.toUpperCase()
    if (!varByHex.has(k)) varByHex.set(k, name)
  }
  const color = (hex: string): Paint => {
    if (options.matchVariables) {
      const v = varByHex.get(hex.toUpperCase())
      if (v) return { $ref: v }
    }
    return hex
  }
  const paintOf = (value: string | undefined, alpha: number, b: Bounds | null): Paint | null => {
    if (!value) return null
    const url = /^url\(\s*['"]?#([\w.:-]+)['"]?\s*\)/.exec(value)
    if (url) {
      const g = gradient(url[1] as string)
      if (!g) return null
      const at = g.attrs
      const userSpace = at.gradientUnits === "userSpaceOnUse"
      const frac = (v: string | undefined, d: number) =>
        v === undefined ? d : v.endsWith("%") ? Number.parseFloat(v) / 100 : Number.parseFloat(v)
      const stops = g.stops.map((s) => ({ color: color(s.color), at: s.at }))
      if (g.kind === "linear") {
        let x1 = frac(at.x1, 0)
        let y1 = frac(at.y1, 0)
        let x2 = frac(at.x2, 1)
        let y2 = frac(at.y2, 0)
        if (userSpace && b && b.w > 0 && b.h > 0) {
          x1 = (x1 - b.x) / b.w
          x2 = (x2 - b.x) / b.w
          y1 = (y1 - b.y) / b.h
          y2 = (y2 - b.y) / b.h
        }
        // Kimo: rotation in degrees CCW with 0 = up (towards -y); size[1] = length.
        const dx = x2 - x1
        const dy = y2 - y1
        const rotation = Math.round(((Math.atan2(-dx, -dy) * 180) / Math.PI) * 100) / 100
        return {
          kind: "linear",
          stops,
          center: [(x1 + x2) / 2, (y1 + y2) / 2],
          size: [1, Math.hypot(dx, dy) || 1],
          ...(rotation ? { rotation } : {}),
          ...(alpha < 1 ? { opacity: alpha } : {}),
        }
      }
      const r = frac(at.r, 0.5)
      return {
        kind: "radial",
        stops,
        center: [frac(at.cx, 0.5), frac(at.cy, 0.5)],
        size: [r * 2, r * 2],
        ...(alpha < 1 ? { opacity: alpha } : {}),
      }
    }
    const hex = parseSvgColor(value, alpha)
    return hex ? color(hex) : null
  }

  const ops: Op[] = []
  const rootId = ctx.newId()
  const at = ctx.at ?? { x: 0, y: 0 }
  ops.push({
    op: "insert",
    id: rootId,
    parent: ctx.parent ?? null,
    node: { type: "frame", name: ctx.name, x: at.x, y: at.y, w: round(w), h: round(h) },
  } as InsertOp)

  const emit = (d: Draft, parent: string, origin: { x: number; y: number }) => {
    if (d.kind === "group") {
      if (!options.keepGroups) {
        for (const c of d.children ?? []) emit(c, parent, origin)
        return
      }
      const b = d.bounds ?? { x: 0, y: 0, w: 0, h: 0 }
      const id = ctx.newId()
      ops.push({
        op: "insert",
        id,
        parent,
        node: {
          type: "frame",
          name: d.name,
          x: round(b.x - origin.x),
          y: round(b.y - origin.y),
          w: round(Math.max(b.w, 0.01)),
          h: round(Math.max(b.h, 0.01)),
        },
      } as InsertOp)
      for (const c of d.children ?? []) emit(c, id, { x: b.x, y: b.y })
      return
    }
    const st = d.style ?? {}
    const b = d.bounds
    if (!b || !d.segs) return
    const groupAlpha = len(st["--opacity"], 1)
    const fill = paintOf(st.fill ?? "#000000", len(st["fill-opacity"], 1) * groupAlpha, b)
    const strokePaint = paintOf(st.stroke, len(st["stroke-opacity"], 1) * groupAlpha, b)
    const width = len(st["stroke-width"], 1) * (d.scale ?? 1)
    const local = transformSegments(d.segs, [1, 0, 0, 1, -b.x, -b.y])
    const dataStr = serializeSegments(local)
    const node: Record<string, unknown> = {
      type: "path",
      name: d.name,
      x: round(b.x - origin.x),
      y: round(b.y - origin.y),
      w: round(Math.max(b.w, 0.01)),
      h: round(Math.max(b.h, 0.01)),
      viewBox: [0, 0, round(Math.max(b.w, 0.01)), round(Math.max(b.h, 0.01))],
      d: dataStr,
    }
    if (d.fillRule === "evenodd") node.fillRule = "evenodd"
    node.fill = fill ? [fill] : []
    if (strokePaint && width > 0) {
      const stroke = {
        width: round(width),
        cap: st["stroke-linecap"] ?? "butt",
        join: st["stroke-linejoin"] ?? "miter",
        miterLimit: len(st["stroke-miterlimit"], 4),
      }
      const dash = (st["stroke-dasharray"] ?? "")
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(Number)
        .filter((v) => Number.isFinite(v) && v >= 0)
      const scale = d.scale ?? 1
      const outlined =
        options.outlineStrokes && ctx.outline
          ? outlineNode(
              ctx.outline(dataStr, {
                ...stroke,
                width,
                ...(dash.length && st["stroke-dasharray"] !== "none"
                  ? { dash: dash.map((v) => v * scale) }
                  : {}),
                dashOffset: len(st["stroke-dashoffset"], 0) * scale,
              }),
            )
          : null
      if (outlined) {
        // The outline is a separate filled path above the fill, sized to its own bounds (the
        // stroke reaches past the geometry by half its width, more at miters and caps).
        if (fill) ops.push({ op: "insert", id: ctx.newId(), parent, node } as InsertOp)
        const { fillRule: _evenodd, ...base } = node
        ops.push({
          op: "insert",
          id: ctx.newId(),
          parent,
          node: {
            ...base,
            name: `${d.name} stroke`,
            x: round(b.x + outlined.box.x - origin.x),
            y: round(b.y + outlined.box.y - origin.y),
            w: outlined.box.w,
            h: outlined.box.h,
            viewBox: [0, 0, outlined.box.w, outlined.box.h],
            d: outlined.d,
            fill: [strokePaint],
          },
        } as InsertOp)
        return
      }
      if (options.outlineStrokes) stats.strokesKept++
      node.stroke = {
        paint: strokePaint,
        width: stroke.width,
        align: "center",
        ...(stroke.cap !== "butt" ? { cap: stroke.cap } : {}),
        ...(stroke.join !== "miter" ? { join: stroke.join } : {}),
        ...(stroke.miterLimit !== 4 ? { miterLimit: stroke.miterLimit } : {}),
        ...(dash.length && st["stroke-dasharray"] !== "none" ? { dash } : {}),
      }
    }
    ops.push({ op: "insert", id: ctx.newId(), parent, node } as InsertOp)
  }
  for (const d of drafts) emit(d, rootId, { x: 0, y: 0 })
  return { ops, rootId, stats, size: { w, h } }
}

const round = (v: number) => Math.round(v * 1000) / 1000

/** A path with a visible stroke: a paint other than none and a positive width. */
function hasStroke(st: Style): boolean {
  const s = st.stroke?.trim()
  if (!s || s === "none" || s === "transparent") return false
  if (!/^url\(/i.test(s) && parseSvgColor(s) === null) return false
  return len(st["stroke-width"], 1) > 0 && len(st["stroke-opacity"], 1) > 0
}

/** Outline path data (node-local space) → its bounds and data re-based to them. */
function outlineNode(d: string | null): { d: string; box: Bounds } | null {
  if (!d) return null
  const segs = parsePath(d)
  const box = segmentBounds(segs)
  if (!box) return null
  const w = round(Math.max(box.w, 0.01))
  const h = round(Math.max(box.h, 0.01))
  return {
    d: serializeSegments(transformSegments(segs, [1, 0, 0, 1, -box.x, -box.y])),
    box: { x: box.x, y: box.y, w, h },
  }
}

/** Parses, sanitizes and converts in one call (throws `SvgImportError` for unusable input). */
export function importSvgAsVectors(
  input: string | Uint8Array,
  options: SvgImportOptions,
  ctx: ConvertContext,
): ConvertResult {
  return convertSvg(sanitizeSvg(input), options, ctx)
}

/** Stats without converting (for the popover description before Import). */
export function analyzeSvg(svg: SanitizedSvg): SvgStats {
  return walk(svg, svg.report).stats
}
