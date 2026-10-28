/**
 * Pure helpers behind the M2 Design tab (board 08 `hgQkJ`): layer blend modes, sizing modes,
 * paint lists (Fill rows top-paint-first, visibility, reorder, kinds), strokes (per-side
 * widths, dashes, cap/join) and effects (kinds, visibility). No React; unit-tested.
 *
 * Every function returns new values (document data is frozen) and drops values equal to their
 * spec default so the canonical file stays minimal.
 */
import type { NodeData } from "@kimo/editor-state"
import { formatNumber, paintColor, refLabel, splitHex, titleCase } from "./props"

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)
const isRef = (v: unknown): v is { $ref: string } => isObj(v) && typeof v.$ref === "string"

// --- Layer --------------------------------------------------------------------------------

type LayerBlend =
  | "normal"
  | "pass-through"
  | "darken"
  | "multiply"
  | "linear-burn"
  | "color-burn"
  | "lighten"
  | "screen"
  | "linear-dodge"
  | "color-dodge"
  | "overlay"
  | "soft-light"
  | "hard-light"
  | "difference"
  | "exclusion"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity"

/** The node's layer blend (absent = normal). */
export const blendOf = (n: NodeData): LayerBlend =>
  typeof n.blend === "string" ? (n.blend as LayerBlend) : "normal"

/** Stored value of a blend (`normal` is the default: removed). */
export const blendValue = (b: LayerBlend) => (b === "normal" ? undefined : b)

// --- Sizing -------------------------------------------------------------------------------

type SizeMode = "fixed" | "fit" | "fill"

/** Sizing mode of a node axis as stored (absent: the type's default). */
export function sizeModeOf(n: NodeData, axis: "w" | "h"): SizeMode {
  if (n.type === "text") {
    const grow = n.grow ?? "auto"
    if (grow === "fixed") return isObj(n[axis]) ? modeOfObj(n[axis]) : "fixed"
    if (grow === "fixed-width" && axis === "w") return isObj(n.w) ? modeOfObj(n.w) : "fixed"
    if (isObj(n[axis])) return modeOfObj(n[axis])
    return "fit"
  }
  const v = n[axis]
  if (typeof v === "number" || isRef(v)) return "fixed"
  if (isObj(v)) return modeOfObj(v)
  return n.type === "frame" || n.type === "note" ? "fit" : "fixed"
}

const modeOfObj = (v: unknown): SizeMode =>
  isObj(v) && v.mode === "fill" ? "fill" : isObj(v) && v.mode === "fit" ? "fit" : "fixed"

/**
 * Modes the size menu enables for a node: Hug for frames (content-sized) and text (auto
 * width/height), Fill only inside an auto-layout parent (contract: "Fill only in a layout
 * parent").
 */
export function sizeModes(n: NodeData, inLayout: boolean): SizeMode[] {
  const out: SizeMode[] = ["fixed"]
  if (n.type === "frame" || n.type === "text" || n.type === "note") out.push("fit")
  if (inLayout && n.position !== "absolute") out.push("fill")
  return out
}

/**
 * Fields to set for a sizing-mode change on one axis. `size` is the node's laid-out size on
 * that axis (fixed freezes it). Text: Hug = `grow: auto` (both axes hug), fixed width =
 * `grow: fixed-width`, fixed height = `grow: fixed`.
 */
export function sizeModeFields(
  n: NodeData,
  axis: "w" | "h",
  mode: SizeMode,
  size: number,
  otherSize: number,
): { set: Record<string, unknown>; unset: string[] } {
  const fixed = Math.max(0, Math.round(size * 100) / 100)
  if (n.type === "text") {
    const grow = (n.grow ?? "auto") as string
    if (mode === "fill") {
      const set: Record<string, unknown> = { [axis]: { mode: "fill" } }
      if (axis === "w" && grow === "auto") set.grow = "fixed-width"
      if (axis === "h") set.grow = "fixed"
      if (axis === "h" && grow === "auto") set.w = Math.round(otherSize * 100) / 100
      return { set, unset: [] }
    }
    if (mode === "fit") {
      if (axis === "w") return { set: {}, unset: ["grow", "w", "h"] }
      // Hug height keeps the width: fixed-width text grows vertically.
      return grow === "fixed"
        ? { set: { grow: "fixed-width" }, unset: ["h"] }
        : { set: {}, unset: ["h"] }
    }
    if (axis === "w")
      return grow === "fixed"
        ? { set: { w: fixed }, unset: [] }
        : { set: { w: fixed, grow: "fixed-width" }, unset: ["h"] }
    const set: Record<string, unknown> = { h: fixed, grow: "fixed" }
    if (grow === "auto") set.w = Math.round(otherSize * 100) / 100
    return { set, unset: [] }
  }
  if (mode === "fixed") return { set: { [axis]: fixed }, unset: [] }
  if (mode === "fill") return { set: { [axis]: { mode: "fill" } }, unset: [] }
  // fit: frames default to fit → unset.
  if (n.type === "frame") return { set: {}, unset: [axis] }
  return { set: { [axis]: { mode: "fit" } }, unset: [] }
}

// --- Padding ----------------------------------------------------------------------------

/** Padding as `[t, r, b, l]` (bindings read as 0). */
export function padSides(pad: unknown): [number, number, number, number] {
  const n = (v: unknown) => (typeof v === "number" ? v : 0)
  if (typeof pad === "number") return [pad, pad, pad, pad]
  if (Array.isArray(pad) && pad.length === 2) return [n(pad[0]), n(pad[1]), n(pad[0]), n(pad[1])]
  if (Array.isArray(pad) && pad.length === 4) return [n(pad[0]), n(pad[1]), n(pad[2]), n(pad[3])]
  return [0, 0, 0, 0]
}

// --- Paints -------------------------------------------------------------------------------

type PaintKind = "solid" | "linear" | "radial" | "angular" | "image" | "other"

export function paintKind(p: unknown): PaintKind {
  if (typeof p === "string" || isRef(p)) return "solid"
  if (!isObj(p)) return "other"
  if (p.kind === "solid") return "solid"
  if (p.kind === "linear" || p.kind === "radial" || p.kind === "angular") return p.kind
  if (p.kind === "image") return "image"
  // OKLCH / Display-P3 color objects (no `kind`) are solid colors.
  if (typeof p.space === "string") return "solid"
  return "other"
}

export const paintVisible = (p: unknown) => !(isObj(p) && p.visible === false)

/**
 * A paint with its visibility changed. A bare color becomes `{kind:"solid"}` to carry
 * `visible: false`; a solid wrapper that only carries the color collapses back.
 */
export function withPaintVisible(p: unknown, visible: boolean): unknown {
  if (visible) {
    if (!isObj(p) || p.visible === undefined) return p
    const { visible: _, ...rest } = p
    if (rest.kind === "solid" && Object.keys(rest).length === 2) return rest.color
    return rest
  }
  if (typeof p === "string" || isRef(p) || (isObj(p) && typeof p.space === "string"))
    return { kind: "solid", color: p, visible: false }
  if (isObj(p)) return { ...p, visible: false }
  return p
}

/** Board 27 §6 (c) rule K7NZ9: a paint's own blend mode (`fill[i].blend`); "normal" = absent. */
export function paintBlend(p: unknown): string {
  return isObj(p) && typeof p.blend === "string" ? p.blend : "normal"
}

/** Whether a paint can carry `blend` (solid, gradient, image; not mesh / shader). */
export const paintBlendable = (p: unknown) => paintKind(p) !== "other"

/**
 * A paint with its blend mode changed. A bare color becomes `{kind:"solid"}` to carry the mode;
 * "normal" removes the key, and a solid wrapper left with only its color collapses back.
 */
export function withPaintBlend(p: unknown, mode: string): unknown {
  if (mode === "normal") {
    if (!isObj(p) || p.blend === undefined) return p
    const { blend: _, ...rest } = p
    if (rest.kind === "solid" && Object.keys(rest).length === 2) return rest.color
    return rest
  }
  if (typeof p === "string" || isRef(p) || (isObj(p) && typeof p.space === "string"))
    return { kind: "solid", color: p, blend: mode }
  if (isObj(p)) return { ...p, blend: mode }
  return p
}

/** Fill rows in panel order: the top paint (last in the list) first. */
export function rowsTopFirst<T>(list: readonly T[]): { item: T; index: number }[] {
  return list.map((item, index) => ({ item, index })).reverse()
}

/** Moves list item `from` to stored index `to` (both indices into the stored list). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list]
  if (from < 0 || from >= out.length) return out
  const [it] = out.splice(from, 1)
  out.splice(Math.max(0, Math.min(out.length, to)), 0, it as T)
  return out
}

/** Stored `fill` for a list: one paint stays a single value (as M1 files store it), none = unset. */
export const fillValue = (list: readonly unknown[], wasArray: boolean): unknown =>
  list.length === 0 ? undefined : list.length === 1 && !wasArray ? list[0] : [...list]

const FIT_LABEL: Record<string, string> = {
  cover: "Cover",
  contain: "Contain",
  stretch: "Stretch",
  tile: "Tile",
  crop: "Crop",
}

/**
 * Fill row text and font (board 08 Fill rows): hex digits in mono (`F4A261`), variable
 * names in sans (`brand/sand`), kinds in sans (`Linear`, `Image · Cover`).
 */
export function paintRowLabel(p: unknown): { label: string; font: "mono" | "sans" } {
  const c = paintColor(p)
  if (typeof c === "string") return { label: splitHex(c).rgb.slice(1), font: "mono" }
  if (c) return { label: c.$ref, font: "sans" }
  if (isObj(p)) {
    const color = p.kind === "solid" ? p.color : p
    if (isObj(color) && color.space === "oklch") return { label: "OKLCH", font: "sans" }
    if (isObj(color) && color.space === "display-p3") return { label: "Display P3", font: "sans" }
    if (p.kind === "image")
      return {
        label: `Image · ${Array.isArray(p.crop) ? "Crop" : (FIT_LABEL[String(p.fit ?? "cover")] ?? "Cover")}`,
        font: "sans",
      }
    if (typeof p.kind === "string") return { label: titleCase(p.kind), font: "sans" }
  }
  return { label: "—", font: "sans" }
}

/** Opacity of a paint as a 0–1 number (hex alpha for solids, `opacity` for gradients/images). */
export function paintAlpha(p: unknown): number {
  const c = paintColor(p)
  if (typeof c === "string") return splitHex(c).alpha
  if (isObj(p)) {
    if (typeof p.opacity === "number") return p.opacity
    const color = p.kind === "solid" ? p.color : p
    if (isObj(color) && typeof color.alpha === "number") return color.alpha
  }
  return 1
}

/** A solid paint with a new color (hex or `{ $ref }`), keeping a wrapper's `visible`/`blend`. */
export function withSolid(p: unknown, color: string | { $ref: string }): unknown {
  if (isObj(p) && p.kind === "solid") return { ...p, color }
  return color
}

/**
 * CSS `background` for a paint swatch. `resolve` maps a variable binding to a CSS color,
 * `assetUrl` an asset reference to an object URL.
 */
export function paintCss(
  p: unknown,
  resolve: (name: string) => string | null = () => null,
  assetUrl: (src: string) => string | null = () => null,
): string {
  const c = paintColor(p)
  if (typeof c === "string") return c
  if (c) return resolve(c.$ref) ?? "var(--kimo-bg-muted)"
  if (!isObj(p)) return "var(--kimo-bg-muted)"
  const color = p.kind === "solid" ? p.color : p
  if (isObj(color) && color.space === "oklch")
    return `oklch(${Number(color.l)} ${Number(color.c)} ${Number(color.h)} / ${Number(color.alpha ?? 1)})`
  if (isObj(color) && color.space === "display-p3")
    return `color(display-p3 ${Number(color.r)} ${Number(color.g)} ${Number(color.b)} / ${Number(color.alpha ?? 1)})`
  if (Array.isArray(p.stops)) {
    const stops = p.stops
      .filter(isObj)
      .map((s) => {
        const sc =
          typeof s.color === "string" ? s.color : isRef(s.color) ? resolve(s.color.$ref) : null
        return `${sc ?? "#999999"} ${formatNumber(Number(s.at) * 100)}%`
      })
      .join(", ")
    const rot = Number(p.rotation ?? 0)
    // Spec: rotation CCW, 0 = up; CSS linear-gradient angles are CW from up.
    if (p.kind === "radial") return `radial-gradient(circle, ${stops})`
    if (p.kind === "angular") return `conic-gradient(from ${formatNumber(-rot)}deg, ${stops})`
    return `linear-gradient(${formatNumber(-rot)}deg, ${stops})`
  }
  if (p.kind === "image" && typeof p.src === "string") {
    const url = assetUrl(p.src)
    return url ? `center / cover no-repeat url("${url}")` : "var(--kimo-bg-muted)"
  }
  return "var(--kimo-bg-muted)"
}

/** Default new fill (M1 house value). */
export const NEW_SOLID = "#D9D9D9"

/** A two-stop linear gradient from a solid color (to the same color, transparent). */
export function gradientFrom(p: unknown): Record<string, unknown> {
  const c = paintColor(p)
  const hex = typeof c === "string" ? splitHex(c).rgb : "#0A0A0A"
  return {
    kind: "linear",
    stops: [
      { color: hex, at: 0 },
      { color: `${hex}00`, at: 1 },
    ],
  }
}

// --- Gradients ----------------------------------------------------------------------------

interface Stop {
  color: unknown
  at: number
}

export const stopsOf = (p: unknown): Stop[] =>
  isObj(p) && Array.isArray(p.stops)
    ? p.stops.filter(isObj).map((s) => ({ color: s.color, at: Number(s.at) || 0 }))
    : []

/** Stops sorted by position, with their original indices. */
export function sortedStops(p: unknown): { stop: Stop; index: number }[] {
  return stopsOf(p)
    .map((stop, index) => ({ stop, index }))
    .sort((a, b) => a.stop.at - b.stop.at || a.index - b.index)
}

const round4 = (n: number) => Math.round(n * 10000) / 10000

export function withStops(p: unknown, stops: readonly Stop[]): unknown {
  if (!isObj(p)) return p
  return { ...p, stops: stops.map((s) => ({ color: s.color, at: round4(s.at) })) }
}

/** Rotate 90° (CCW, the spec's direction) — the Type Row's `rotate-cw` button turns CW. */
export function rotateGradient(p: unknown, deg: number): unknown {
  if (!isObj(p)) return p
  const r = ((((Number(p.rotation ?? 0) + deg) % 360) + 540) % 360) - 180
  const { rotation: _, ...rest } = p
  return r === 0 ? rest : { ...rest, rotation: r }
}

/** Reverses the stops (`flip-horizontal-2`). */
export function flipGradient(p: unknown): unknown {
  return withStops(
    p,
    stopsOf(p).map((s) => ({ color: s.color, at: 1 - s.at })),
  )
}

export function withGradientKind(p: unknown, kind: "linear" | "radial" | "angular"): unknown {
  return isObj(p) ? { ...p, kind } : p
}

/**
 * Stored stops for the editor's hex stops: a stop whose hex is unchanged keeps its stored
 * color (a `{ $ref }` binding stays bound). Matched by the editor's `sources` when given
 * (exact for add and remove); without them, by index when the count is unchanged (move,
 * recolor), else by first unused equal hex.
 */
export function mergeStops(
  stored: readonly Stop[],
  shown: readonly { color: string }[],
  next: readonly { color: string; at: number }[],
  sources?: readonly (number | null)[],
): Stop[] {
  if (sources) {
    // By source index (the editor reports where each stop came from): a stop keeps its stored
    // color (binding) unless its shown color was edited.
    return next.map((s, i) => {
      const j = sources[i]
      if (j === null || j === undefined) return { color: s.color, at: s.at }
      return { color: s.color === shown[j]?.color ? (stored[j] as Stop).color : s.color, at: s.at }
    })
  }
  if (next.length === stored.length)
    return next.map((s, i) => ({
      color: s.color === shown[i]?.color ? (stored[i] as Stop).color : s.color,
      at: s.at,
    }))
  const used = new Set<number>()
  return next.map((s) => {
    const j = shown.findIndex((x, k) => !used.has(k) && x.color === s.color)
    if (j < 0) return { color: s.color, at: s.at }
    used.add(j)
    return { color: (stored[j] as Stop).color, at: s.at }
  })
}

// --- Strokes ------------------------------------------------------------------------------

export interface Sides {
  t: number
  r: number
  b: number
  l: number
}

export const strokeObj = (s: unknown): Record<string, unknown> | null => (isObj(s) ? s : null)

/** Per-side widths of a stroke (null when the width is uniform or a binding). */
export function strokeSides(s: unknown): Sides | null {
  const w = strokeObj(s)?.width
  if (!isObj(w) || isRef(w)) return null
  const n = (v: unknown) => (typeof v === "number" ? v : 0)
  return { t: n(w.t), r: n(w.r), b: n(w.b), l: n(w.l) }
}

/** Uniform stroke width (1 when absent; null for per-side widths or bindings). */
export function strokeWidthOf(s: unknown): number | { $ref: string } | null {
  const w = strokeObj(s)?.width
  if (w === undefined) return 1
  if (typeof w === "number") return w
  if (isRef(w)) return w
  return null
}

const dropDefault = (o: Record<string, unknown>, key: string, def: unknown) => {
  if (o[key] === def) delete o[key]
  return o
}

/** A stroke with one field changed (defaults removed). */
export function withStrokeField(s: unknown, key: string, value: unknown): Record<string, unknown> {
  const o: Record<string, unknown> = { ...(strokeObj(s) ?? { paint: "#0A0A0A" }) }
  if (value === undefined) delete o[key]
  else o[key] = value
  dropDefault(o, "width", 1)
  dropDefault(o, "align", "inside")
  dropDefault(o, "cap", "butt")
  dropDefault(o, "join", "miter")
  dropDefault(o, "miterLimit", 4)
  return o
}

/** Individual sides on: a uniform width w becomes `{t:w,r:w,b:w,l:w}`; off: the widest side. */
export function withSidesMode(s: unknown, on: boolean): Record<string, unknown> {
  if (on) {
    const w = strokeWidthOf(s)
    const v = typeof w === "number" ? w : 1
    return withStrokeField(s, "width", { t: v, r: v, b: v, l: v })
  }
  const sides = strokeSides(s)
  const v = sides ? Math.max(sides.t, sides.r, sides.b, sides.l) : 1
  return withStrokeField(s, "width", v)
}

export function withSide(s: unknown, side: keyof Sides, value: number): Record<string, unknown> {
  // From a uniform width, the other sides keep that width (a bound width keeps 1: per-side
  // widths are literal numbers).
  const w = strokeWidthOf(s)
  const u = typeof w === "number" ? w : 1
  // Board 27 §7: a side bound to a variable keeps its binding when another side is edited.
  const rw = strokeObj(s)?.width
  const sides: Record<string, unknown> =
    isObj(rw) && !isRef(rw)
      ? { t: rw.t ?? 0, r: rw.r ?? 0, b: rw.b ?? 0, l: rw.l ?? 0 }
      : { t: u, r: u, b: u, l: u }
  const next: Record<string, unknown> = { ...sides, [side]: Math.max(0, value) }
  // An absent side is 0: store only non-zero sides; all sides 0 is a zero-width stroke (not an
  // empty `{}` sides object).
  for (const k of Object.keys(next)) if (next[k] === 0) delete next[k]
  return withStrokeField(s, "width", Object.keys(next).length ? next : 0)
}

/** Board 08 example dash (Dash 4 · Gap 2). */
export const DEFAULT_DASH: readonly [number, number] = [4, 2]

export function dashOf(s: unknown): [number, number] | null {
  const d = strokeObj(s)?.dash
  if (!Array.isArray(d) || d.length === 0) return null
  const a = Number(d[0]) || 0
  return [a, d.length > 1 ? Number(d[1]) || 0 : a]
}

export function withDash(s: unknown, dash: readonly [number, number] | null) {
  const d = dash ? [Math.max(0, dash[0]), Math.max(0, dash[1])] : null
  // An all-zero dash draws solid: store it as no dash.
  return withStrokeField(s, "dash", d && (d[0] as number) + (d[1] as number) > 0 ? d : undefined)
}

// --- Effects ------------------------------------------------------------------------------

type EffectKind = "drop-shadow" | "inner-shadow" | "layer-blur" | "background-blur"

export function effectKind(e: unknown): EffectKind {
  if (isObj(e) && e.kind === "blur") return "layer-blur"
  if (isObj(e) && e.kind === "backdrop-blur") return "background-blur"
  return isObj(e) && e.inner === true ? "inner-shadow" : "drop-shadow"
}

/** Board 08 drop shadow example: X 0, Y 8, Blur 24, Spread 0, #0A0A0A at 12%. */
export const NEW_EFFECT = { kind: "shadow", x: 0, y: 8, blur: 24, color: "#0A0A0A1F" } as const
const NEW_BLUR_RADIUS = 4

export function withEffectKind(e: unknown, kind: EffectKind): Record<string, unknown> {
  const cur = isObj(e) ? e : {}
  const visible = cur.visible === false ? { visible: false } : {}
  if (kind === "layer-blur" || kind === "background-blur") {
    const radius =
      typeof cur.radius === "number"
        ? cur.radius
        : typeof cur.blur === "number"
          ? cur.blur
          : NEW_BLUR_RADIUS
    return { kind: kind === "layer-blur" ? "blur" : "backdrop-blur", radius, ...visible }
  }
  const base: Record<string, unknown> =
    cur.kind === "shadow"
      ? { ...cur }
      : { ...NEW_EFFECT, ...(typeof cur.radius === "number" ? { blur: cur.radius } : {}) }
  delete base.inner
  delete base.visible
  return { ...base, ...(kind === "inner-shadow" ? { inner: true } : {}), ...visible }
}

export const effectVisible = (e: unknown) => !(isObj(e) && e.visible === false)

export function withEffectVisible(e: unknown, visible: boolean): unknown {
  if (!isObj(e)) return e
  const { visible: _, ...rest } = e
  return visible ? rest : { ...rest, visible: false }
}

/** One numeric field of an effect (`x`, `y`, `blur`, `spread`, `radius`). */
export function effectNumber(e: unknown, key: string): number | { $ref: string } {
  const v = isObj(e) ? e[key] : undefined
  if (typeof v === "number" || isRef(v)) return v
  return 0
}

export function withEffectField(e: unknown, key: string, value: unknown): unknown {
  if (!isObj(e)) return e
  const o = { ...e }
  if (value === undefined || (key === "spread" && value === 0)) delete o[key]
  else o[key] = value
  return o
}

/** Display text of a number-or-binding. */
export const numText = (v: number | { $ref: string }) =>
  typeof v === "number" ? formatNumber(v) : refLabel(v)

// --- Icons --------------------------------------------------------------------------------

type IconLibraryId = "lucide" | "phosphor" | "material" | "feather"
/** Library of an icon node's `set` (`material-rounded` → material). */
export function iconLibrary(set: unknown): IconLibraryId {
  const s = String(set)
  if (s.startsWith("material")) return "material"
  if (s === "phosphor" || s === "feather") return s
  return "lucide"
}

/** Stroke libraries show "Stroke" (`strokeWidth`), the others "Weight" (`weight`). */
export const isStrokeLibrary = (lib: IconLibraryId) => lib === "lucide" || lib === "feather"

export const LIBRARY_LABEL: Record<IconLibraryId, string> = {
  lucide: "Lucide",
  phosphor: "Phosphor",
  material: "Material",
  feather: "Feather",
}

/** Native defaults: stroke 2 (lucide/feather), weight 400. */
export const iconStrokeOf = (n: NodeData) =>
  typeof n.strokeWidth === "number" || isRef(n.strokeWidth)
    ? (n.strokeWidth as number | { $ref: string })
    : 2
export const iconWeightOf = (n: NodeData) =>
  typeof n.weight === "number" || isRef(n.weight) ? (n.weight as number | { $ref: string }) : 400
