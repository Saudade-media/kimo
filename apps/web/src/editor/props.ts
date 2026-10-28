/**
 * Pure helpers behind the Design tab and the layer tree: display strings for node fields,
 * input parsing, multi-selection "Mixed" values and the op groups that edits produce.
 * No React here, so everything is unit-tested with `bun test`.
 */
import type { NodeData, Op } from "@kimo/editor-state"

/** Marker for a property whose value differs across the selected nodes. */
export const MIXED: unique symbol = Symbol("mixed")
export type Mixed = typeof MIXED
export const MIXED_LABEL = "Mixed"

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)
const isRef = (v: unknown): v is { $ref: string } => isObj(v) && typeof v.$ref === "string"

/** Stable JSON for comparisons (key order independent). */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`
  if (isObj(v))
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(v[k])}`)
      .join(",")}}`
  return v === undefined ? "undefined" : JSON.stringify(v)
}

/** The common value of `pick(node)` over `nodes`, or {@link MIXED}. */
export function shared<I, T>(items: readonly I[], pick: (item: I) => T): T | Mixed {
  if (items.length === 0) return undefined as T
  const first = pick(items[0] as I)
  const key = stable(first)
  for (let i = 1; i < items.length; i++) if (stable(pick(items[i] as I)) !== key) return MIXED
  return first
}

// --- Node kinds and icons -----------------------------------------------------------------

const KIND: Record<string, string> = {
  frame: "Frame",
  group: "Group",
  rect: "Rectangle",
  ellipse: "Ellipse",
  polygon: "Polygon",
  path: "Path",
  text: "Text",
  icon: "Icon",
  instance: "Instance",
  note: "Note",
  prompt: "Prompt",
  script: "Script",
  browser: "Browser",
}

/** Human kind for the selection badge (`Frame`, `Text`, `Component`, …). */
export function kindLabel(node: NodeData): string {
  if (node.component === true || isObj(node.component)) return "Component"
  // Board 27 §5: a star is a polygon with `star`.
  if (node.type === "polygon" && isObj(node.star)) return "Star"
  return KIND[node.type] ?? node.type
}

/** Display name of a node: its `name`, else its kind. */
export function nodeName(node: NodeData): string {
  return typeof node.name === "string" && node.name.length > 0 ? node.name : kindLabel(node)
}

const hasImagePaint = (fill: unknown): boolean =>
  paintList(fill).some((p) => isObj(p) && p.kind === "image")

/**
 * Exact lucide icon name for a layer row, following the icons used in board 03's layer tree
 * (`frame`, `type`, `image`, `smartphone`); M3 (board 02c legend): `component` for a main,
 * `diamond` for an instance.
 */
export function typeIcon(node: NodeData): string {
  // M3 legend (board 02c `M5DvY3`): `component` glyph = main, `diamond` = instance.
  if (node.component === true || isObj(node.component)) return "component"
  switch (node.type) {
    case "frame": {
      const w = node.w
      const h = node.h
      if (
        node.parent === null &&
        typeof w === "number" &&
        typeof h === "number" &&
        w <= 480 &&
        h > w
      )
        return "smartphone"
      // Auto layout frames show a stack glyph for their direction (board 21 `Y7KP0`).
      const layout = node.layout
      if (isObj(layout)) {
        if (layout.wrap === true) return "layout-grid"
        if (layout.dir === "row") return "columns-3"
        if (layout.dir === "column") return "rows-3"
      }
      return "frame"
    }
    case "text":
      return "type"
    case "rect":
      return hasImagePaint(node.fill) ? "image" : "square"
    case "ellipse":
      return "circle"
    case "group":
      return "group"
    case "instance":
      return "diamond"
    case "path":
      return "spline"
    case "polygon":
      return isObj(node.star) ? "star" : "hexagon"
    case "icon":
      return "smile"
    case "note":
      return "sticky-note"
    case "prompt":
      return "sparkles"
    case "script":
      return "code-xml"
    case "browser":
      return "globe"
    default:
      return "square"
  }
}

// --- Numbers and sizes --------------------------------------------------------------------

/** Formats a number for a field: integers as-is, otherwise up to 2 decimals. */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "0"
  const r = Math.round(n * 100) / 100
  return Object.is(r, -0) ? "0" : String(r)
}

/** `$name` for a binding. */
export const refLabel = (v: { $ref: string }) => `$${v.$ref}`

/** Parses a size field: a number, `hug`/`fit`, or `fill`. Null = invalid. */
export function parseSize(input: string): number | { mode: "fit" | "fill" } | null {
  const s = input.trim().toLowerCase()
  if (s === "hug" || s === "fit" || s === "auto") return { mode: "fit" }
  if (s === "fill") return { mode: "fill" }
  const n = parseNumber(s)
  return n !== null && n >= 0 ? n : null
}

/** Parses a number, accepting a simple arithmetic expression (`120+24`, `2*8`, `(10+2)/3`). */
export function parseNumber(input: string): number | null {
  const s = input.trim().replace(/,/g, ".").replace(/\s+/g, "")
  if (s === "") return null
  let i = 0
  const expr = (): number | null => {
    let v = term()
    while (v !== null && (s[i] === "+" || s[i] === "-")) {
      const op = s[i++]
      const r = term()
      if (r === null) return null
      v = op === "+" ? v + r : v - r
    }
    return v
  }
  const term = (): number | null => {
    let v = factor()
    while (v !== null && (s[i] === "*" || s[i] === "/")) {
      const op = s[i++]
      const r = factor()
      if (r === null) return null
      v = op === "*" ? v * r : v / r
    }
    return v
  }
  const factor = (): number | null => {
    if (s[i] === "-") {
      i++
      const v = factor()
      return v === null ? null : -v
    }
    if (s[i] === "+") {
      i++
      return factor()
    }
    if (s[i] === "(") {
      i++
      const v = expr()
      if (s[i] !== ")") return null
      i++
      return v
    }
    const m = /^\d*\.?\d+(?:e[-+]?\d+)?/i.exec(s.slice(i)) ?? /^\d+\./.exec(s.slice(i))
    if (!m) return null
    i += m[0].length
    return Number(m[0])
  }
  const v = expr()
  return v !== null && i === s.length && Number.isFinite(v) ? v : null
}

/** Padding display: `24`, `64 · 96`, `48 · 40 · 40 · 40`. */
function formatPad(v: unknown): string {
  if (v === undefined) return "0"
  if (typeof v === "number") return formatNumber(v)
  if (isRef(v)) return refLabel(v)
  if (Array.isArray(v)) {
    const parts = v.map((x) =>
      typeof x === "number" ? formatNumber(x) : isRef(x) ? refLabel(x) : "?",
    )
    // Shortest equivalent form, so it fits the half-width field (design: "64 · 96"):
    // [t, r, b, l] with t = b and r = l → [v, h]; [v, h] with v = h → one value.
    let short = parts
    if (short.length === 4 && short[0] === short[2] && short[1] === short[3])
      short = [short[0] as string, short[1] as string]
    if (short.length === 2 && short[0] === short[1]) short = [short[0] as string]
    // Four distinct sides: spaces only (parsePad reads them back) to stay within the field.
    return short.join(short.length === 4 ? " " : " · ")
  }
  return "0"
}

/** Parses padding: one, two (`v h`) or four numbers separated by spaces, commas or `·`. */
function parsePad(
  input: string,
): number | [number, number] | [number, number, number, number] | null {
  const parts = input
    .split(/[\s,·]+/)
    .filter(Boolean)
    .map((p) => parseNumber(p))
  if (parts.some((p) => p === null || p < 0)) return null
  const n = parts as number[]
  if (n.length === 1) return n[0] as number
  if (n.length === 2) return [n[0], n[1]] as [number, number]
  if (n.length === 4) return [n[0], n[1], n[2], n[3]] as [number, number, number, number]
  return null
}

/** Radius display: `24`, `8 · 8 · 0 · 0`. */
export const formatRadius = (v: unknown) => (v === undefined ? "0" : formatPad(v))

/** Parses a radius: one number or four. */
export function parseRadius(input: string): number | [number, number, number, number] | null {
  const p = parsePad(input)
  if (p === null || (Array.isArray(p) && p.length === 2)) return null
  return p as number | [number, number, number, number]
}

/** Title-cased enum value (`center` → `Center`, `between` → `Between`). */
export const titleCase = (s: string) => (s ? s[0]?.toUpperCase() + s.slice(1) : s)

// --- Paints -------------------------------------------------------------------------------

/** A node's `fill` as a list (a single paint becomes a one-item list; absent → []). */
export function paintList(fill: unknown): unknown[] {
  if (fill === undefined || fill === null) return []
  return Array.isArray(fill) ? [...fill] : [fill]
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/** Normalizes `#abc` / `#aabbcc` / `#aabbccdd` to uppercase 6 or 8 digits; null when invalid. */
function normalizeHex(input: string): string | null {
  let s = input.trim()
  if (!s.startsWith("#")) s = `#${s}`
  if (!HEX.test(s)) return null
  if (s.length === 4)
    s = `#${s
      .slice(1)
      .split("")
      .map((c) => c + c)
      .join("")}`
  return s.toUpperCase()
}

/** Splits a hex color into `#RRGGBB` and alpha (0–1). */
export function splitHex(hex: string): { rgb: string; alpha: number } {
  const h = normalizeHex(hex) ?? "#000000"
  if (h.length === 9) return { rgb: h.slice(0, 7), alpha: Number.parseInt(h.slice(7), 16) / 255 }
  return { rgb: h, alpha: 1 }
}

/** Solid color of a paint (bare color or `{kind:"solid"}`), or null. */
export function paintColor(paint: unknown): string | { $ref: string } | null {
  if (typeof paint === "string") return paint
  if (isRef(paint)) return paint
  if (isObj(paint) && paint.kind === "solid") {
    const c = paint.color
    if (typeof c === "string" || isRef(c)) return c
  }
  return null
}

// --- Strokes and effects ------------------------------------------------------------------

/** Effects as a list (`effects` may be a binding: then not editable here). */
export function effectList(effects: unknown): unknown[] {
  return Array.isArray(effects) ? [...effects] : []
}

// --- Ops ----------------------------------------------------------------------------------

/**
 * Update ops that set `key` on every id (one op group = one undo step). `undefined` removes
 * the field (back to the default).
 */
export function setOps(ids: readonly string[], key: string, value: unknown): Op[] {
  return ids.map((id) =>
    value === undefined
      ? { op: "update", id, unset: [key] }
      : { op: "update", id, set: { [key]: value } },
  )
}

/** Update ops computed per node (`next(node)` returns the new value, or `undefined` to unset). */
export function mapOps(
  nodes: readonly { id: string; node: NodeData }[],
  key: string,
  next: (node: NodeData) => unknown,
): Op[] {
  return nodes.map(({ id, node }) => {
    const v = next(node)
    return v === undefined
      ? { op: "update", id, unset: [key] }
      : { op: "update", id, set: { [key]: v } }
  })
}
