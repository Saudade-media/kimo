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
      return "hexagon"
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

/** Node types that may have children. */
export const isContainer = (node: NodeData) => node.type === "frame" || node.type === "group"

// --- Numbers and sizes --------------------------------------------------------------------

/** Formats a number for a field: integers as-is, otherwise up to 2 decimals. */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "0"
  const r = Math.round(n * 100) / 100
  return Object.is(r, -0) ? "0" : String(r)
}

/** `$name` for a binding. */
export const refLabel = (v: { $ref: string }) => `$${v.$ref}`

/** Size display (`720`, `Hug`, `Fill`, `$size/lg`). `fallback` is shown when absent. */
export function formatSize(v: unknown, fallback = "Hug"): string {
  if (typeof v === "number") return formatNumber(v)
  if (isRef(v)) return refLabel(v)
  if (isObj(v)) return v.mode === "fill" ? "Fill" : "Hug"
  return fallback
}

/** What an absent `w`/`h` means for `node` (frame default fit; text auto = hug). */
export function sizeFallback(node: NodeData): string {
  return node.type === "frame" || node.type === "text" || node.type === "note" ? "Hug" : "—"
}

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
export function formatPad(v: unknown): string {
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
export function parsePad(
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
export function normalizeHex(input: string): string | null {
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

/** Joins `#RRGGBB` and alpha into a hex color (alpha 1 → 6 digits). */
export function joinHex(rgb: string, alpha: number): string {
  const base = (normalizeHex(rgb) ?? "#000000").slice(0, 7)
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
  return a === 255 ? base : base + a.toString(16).padStart(2, "0").toUpperCase()
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

/** Field text for a paint: hex, `$var`, `Linear`, `Image`, … */
export function paintLabel(paint: unknown): string {
  const c = paintColor(paint)
  if (typeof c === "string") return splitHex(c).rgb
  if (c) return refLabel(c)
  if (isObj(paint)) {
    if (paint.space === "oklch") return "OKLCH"
    if (paint.space === "display-p3") return "Display P3"
    if (typeof paint.kind === "string") return titleCase(paint.kind)
  }
  return "—"
}

/** CSS background for a paint swatch. */
export function paintSwatch(paint: unknown): string {
  const c = paintColor(paint)
  if (typeof c === "string") return c
  if (c) return "var(--kimo-bg-muted)"
  if (isObj(paint)) {
    if (Array.isArray(paint.stops)) {
      const stops = paint.stops
        .filter(isObj)
        .map((s) => `${typeof s.color === "string" ? s.color : "#999"} ${Number(s.at) * 100}%`)
        .join(", ")
      return `linear-gradient(${Number(paint.rotation ?? 0) + 90}deg, ${stops})`
    }
    if (paint.space === "oklch")
      return `oklch(${Number(paint.l)} ${Number(paint.c)} ${Number(paint.h)} / ${Number(paint.alpha ?? 1)})`
  }
  return "var(--kimo-bg-muted)"
}

/** Opacity label of a paint (`100%`). */
export function paintOpacity(paint: unknown): string {
  const c = paintColor(paint)
  let a = 1
  if (typeof c === "string") a = splitHex(c).alpha
  else if (isObj(paint) && typeof paint.opacity === "number") a = paint.opacity
  else if (isObj(paint) && typeof paint.alpha === "number") a = paint.alpha
  return `${Math.round(a * 100)}%`
}

/** Replaces the color of a paint, keeping a `{kind:"solid"}` wrapper's other fields. */
export function withColor(paint: unknown, hex: string): unknown {
  if (isObj(paint) && paint.kind === "solid") return { ...paint, color: hex }
  return hex
}

/** Default paint for a new fill. */
export const NEW_FILL = "#D9D9D9"

// --- Strokes and effects ------------------------------------------------------------------

/** Stroke width display: `1`, `—` when there is no stroke, `Mixed` for per-side widths. */
export function formatStroke(stroke: unknown): string {
  if (!isObj(stroke)) return "—"
  const w = stroke.width
  if (w === undefined) return "1"
  if (typeof w === "number") return formatNumber(w)
  if (isRef(w)) return refLabel(w)
  return "Sides"
}

/** New stroke value after the S field is edited. 0 or empty removes the stroke. */
export function strokeWithWidth(stroke: unknown, width: number | null): unknown {
  if (width === null || width <= 0) return undefined
  if (isObj(stroke)) return { ...stroke, width }
  return { paint: "#0A0A0A", width }
}

/** Effects as a list (`effects` may be a binding: then not editable here). */
export function effectList(effects: unknown): unknown[] {
  return Array.isArray(effects) ? [...effects] : []
}

/** Default effect added by "+" in the Effects section (the board 03 example: 0 8 24). */
export const NEW_SHADOW = { kind: "shadow", x: 0, y: 8, blur: 24, color: "#1B1A1826" } as const

/** Label of an effect row. */
export function effectLabel(effect: unknown): string {
  if (!isObj(effect)) return "Effect"
  if (effect.kind === "shadow") return effect.inner === true ? "Inner shadow" : "Drop shadow"
  if (effect.kind === "blur") return "Layer blur"
  if (effect.kind === "backdrop-blur") return "Background blur"
  return "Effect"
}

const n = (v: unknown) => (typeof v === "number" ? formatNumber(v) : isRef(v) ? refLabel(v) : "0")

/** Right-hand value of an effect row: `0 8 24` (x y blur) for shadows, the radius for blurs. */
export function effectValue(effect: unknown): string {
  if (!isObj(effect)) return ""
  if (effect.kind === "shadow") return `${n(effect.x)} ${n(effect.y)} ${n(effect.blur)}`
  return n(effect.radius)
}

/** Parses `x y blur` for a shadow, or a radius for a blur. Null = invalid. */
export function parseEffectValue(effect: unknown, input: string): unknown {
  if (!isObj(effect)) return null
  const parts = input
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((p) => parseNumber(p))
  if (parts.some((p) => p === null)) return null
  const v = parts as number[]
  if (effect.kind === "shadow") {
    if (v.length !== 3 || (v[2] as number) < 0) return null
    return { ...effect, x: v[0], y: v[1], blur: v[2] }
  }
  if (v.length !== 1 || (v[0] as number) < 0) return null
  return { ...effect, radius: v[0] }
}

/** Swatch of an effect row (the shadow color). */
export function effectSwatch(effect: unknown): string {
  if (isObj(effect) && typeof effect.color === "string") return effect.color
  return "var(--kimo-bg-muted)"
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

/** The layout object of a frame (or a fresh row layout when it has none). */
export function layoutOf(node: NodeData): Record<string, unknown> {
  return isObj(node.layout) ? { ...node.layout } : { dir: "row" }
}

/** A layout with one field changed; a value equal to the default is removed. */
export function withLayoutField(
  node: NodeData,
  key: string,
  value: unknown,
): Record<string, unknown> {
  const l = layoutOf(node)
  if (value === undefined) delete l[key]
  else l[key] = value
  return l
}
