/**
 * Text section model (board 20 "Text section" YjE2h, rules table H7uymL): how each control maps
 * to a text node's fields (spec §8: `style.font` / `weight` / `size` / `lineHeight` /
 * `letterSpacing` / `align` / `valign` / `decoration` / `case`, and the node's `grow`), the
 * display strings, input parsing and the ops. Pure: unit-tested with `bun test`.
 *
 * Design property → Kimo field: fontFamily → `style.font`; fontWeight → `style.weight`;
 * fontSize → `style.size`; lineHeight (ratio = % / 100) → `style.lineHeight` (a multiplier;
 * "Auto" removes it); letterSpacing (px = % × size / 100) → `style.letterSpacing` (px);
 * textAlign → `style.align`; textAlignVertical → `style.valign`; textGrowth → `grow`
 * (`fixed-width-height` is Kimo's `fixed`); underline / strikethrough → `style.decoration`;
 * textCase → `style.case` (upper / lower / title: already in format 0.1, render-time only, so
 * `content` keeps what was typed).
 */
import type { NodeData, Op } from "@kimo/editor-state"
import { formatNumber, MIXED, type Mixed, parseNumber, shared } from "./props"

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v)
const isRef = (v: unknown): v is { $ref: string } => isObj(v) && typeof v.$ref === "string"

/** Reader defaults (`@kimo/layout` TEXT_STYLE_DEFAULTS, spec §8.2). */
export const TEXT_DEFAULTS = { font: "Inter", weight: 400, size: 16 } as const

export type TextAlign = "left" | "center" | "right" | "justify"
export type TextVAlign = "top" | "middle" | "bottom"
export type TextGrow = "auto" | "fixed-width" | "fixed"
export type TextDecoration = "none" | "underline" | "strike"
export type TextCase = "none" | "upper" | "lower" | "title"

/** The node's `style` object (empty when absent or not an object). */
export function styleOf(node: NodeData): Obj {
  return isObj(node.style) ? (node.style as Obj) : {}
}

/** Weight names for the Weight select (CSS / OpenType usWeightClass). */
export const WEIGHT_NAMES: readonly [number, string][] = [
  [100, "Thin"],
  [200, "Extra Light"],
  [300, "Light"],
  [400, "Regular"],
  [500, "Medium"],
  [600, "Semi Bold"],
  [700, "Bold"],
  [800, "Extra Bold"],
  [900, "Black"],
]

/** "Semi Bold" for 600; other numbers as-is ("650"). */
export function weightName(w: number): string {
  return WEIGHT_NAMES.find(([n]) => n === w)?.[1] ?? formatNumber(w)
}

/** `$name` for a binding. */
const refText = (v: { $ref: string }) => `$${v.$ref}`

export function fontOf(node: NodeData): string {
  const f = styleOf(node).font
  return typeof f === "string" ? f : isRef(f) ? refText(f) : TEXT_DEFAULTS.font
}

export function weightOf(node: NodeData): number | string {
  const w = styleOf(node).weight
  return typeof w === "number" ? w : isRef(w) ? refText(w) : TEXT_DEFAULTS.weight
}

export function sizeOf(node: NodeData): number | string {
  const s = styleOf(node).size
  return typeof s === "number" ? s : isRef(s) ? refText(s) : TEXT_DEFAULTS.size
}

/** The numeric size (bindings / unknown fall back to the default), for % ↔ px conversions. */
export function sizeNumber(node: NodeData): number {
  const s = styleOf(node).size
  return typeof s === "number" ? s : TEXT_DEFAULTS.size
}

/** Line height field: "110%" (multiplier 1.1), "24px" ({ px: 24 }), "Auto" (absent). */
export function lineHeightText(node: NodeData): string {
  const lh = styleOf(node).lineHeight
  if (typeof lh === "number") return `${formatNumber(lh * 100)}%`
  if (isObj(lh) && typeof lh.px === "number") return `${formatNumber(lh.px)}px`
  if (isRef(lh)) return refText(lh)
  return "Auto"
}

/** Letter spacing field as % of the size ("-2%" for -0.96px at 48). */
export function letterSpacingText(node: NodeData): string {
  const ls = styleOf(node).letterSpacing
  if (isRef(ls)) return refText(ls)
  const px = typeof ls === "number" ? ls : 0
  return `${formatNumber((px / sizeNumber(node)) * 100)}%`
}

export function alignOf(node: NodeData): TextAlign {
  const a = styleOf(node).align
  return a === "center" || a === "right" || a === "justify" ? a : "left"
}

export function valignOf(node: NodeData): TextVAlign {
  const a = styleOf(node).valign
  return a === "middle" || a === "bottom" ? a : "top"
}

export function growOf(node: NodeData): TextGrow {
  const g = node.grow
  return g === "fixed-width" || g === "fixed" ? g : "auto"
}

/** Mutually exclusive in the UI; a stored pair shows neither segment (null). */
export function decorationOf(node: NodeData): TextDecoration | null {
  const d = styleOf(node).decoration
  if (!Array.isArray(d) || d.length === 0) return "none"
  if (d.length === 1 && (d[0] === "underline" || d[0] === "strike")) return d[0]
  return null
}

export function caseOf(node: NodeData): TextCase {
  const c = styleOf(node).case
  return c === "upper" || c === "lower" || c === "title" ? c : "none"
}

/** Common value over the selection, or {@link MIXED}. */
export const sharedText = <T>(nodes: readonly NodeData[], pick: (n: NodeData) => T): T | Mixed =>
  shared(nodes, pick)

// --- Parsing ------------------------------------------------------------------------------

/**
 * Line height input: "Auto" / "" → absent; "110%" or "110" → 1.1; "1.1x" → 1.1; "24px" →
 * { px: 24 }. Null = invalid.
 */
export function parseLineHeight(input: string): number | { px: number } | undefined | null {
  const s = input.trim().toLowerCase()
  if (s === "" || s === "auto") return undefined
  const px = /^(.*)px$/.exec(s)
  if (px) {
    const n = parseNumber(px[1] ?? "")
    return n !== null && n >= 0 ? { px: n } : null
  }
  const x = /^(.*)x$/.exec(s)
  if (x) {
    const n = parseNumber(x[1] ?? "")
    return n !== null && n >= 0 ? round4(n) : null
  }
  const n = parseNumber(s.replace(/%$/, ""))
  return n !== null && n >= 0 ? round4(n / 100) : null
}

/** Letter spacing input in % of `size` ("-2%", "-2") or px ("-0.96px"); returns px. */
export function parseLetterSpacing(input: string, size: number): number | null {
  const s = input.trim().toLowerCase()
  const px = /^(.*)px$/.exec(s)
  if (px) {
    const n = parseNumber(px[1] ?? "")
    return n === null ? null : round4(n)
  }
  const n = parseNumber(s.replace(/%$/, ""))
  return n === null ? null : round4((n * size) / 100)
}

const round4 = (n: number) => Math.round(n * 10000) / 10000

// --- Ops ----------------------------------------------------------------------------------

/**
 * Update ops setting style field `key` on every node; `value(node)` returns the new value, or
 * undefined to remove the field (an empty style is removed). One op group = one undo step.
 */
export function styleOps(
  sel: readonly { id: string; node: NodeData }[],
  key: string,
  value: (node: NodeData) => unknown,
): Op[] {
  return sel.map(({ id, node }) => {
    const next = { ...styleOf(node) }
    const v = value(node)
    if (v === undefined) delete next[key]
    else next[key] = v
    return Object.keys(next).length === 0
      ? { op: "update", id, unset: ["style"] }
      : { op: "update", id, set: { style: next } }
  })
}

/** Default values are removed rather than stored (left, top, no decoration, as typed). */
export function alignValue(a: TextAlign): TextAlign | undefined {
  return a === "left" ? undefined : a
}
export function valignValue(a: TextVAlign): TextVAlign | undefined {
  return a === "top" ? undefined : a
}
export function decorationValue(d: TextDecoration): ("underline" | "strike")[] | undefined {
  return d === "none" ? undefined : [d]
}
export function caseValue(c: TextCase): Exclude<TextCase, "none"> | undefined {
  return c === "none" ? undefined : c
}

/**
 * Resizing (board 20 AL4la): `auto` hugs both axes (removes `grow`, `w`, `h`); `fixed-width`
 * keeps the laid-out width and grows vertically; `fixed` keeps both laid-out sizes. The W / H
 * modes in Position follow it (`style.ts` sizeModeOf reads `grow`).
 */
export function growOps(
  sel: readonly { id: string; node: NodeData }[],
  grow: TextGrow,
  laid: (id: string) => { w: number; h: number } | null,
): Op[] {
  const r2 = (n: number) => Math.round(n * 100) / 100
  return sel.map(({ id, node }) => {
    const box = laid(id)
    const w = typeof node.w === "number" ? node.w : box ? r2(box.w) : undefined
    const h = typeof node.h === "number" ? node.h : box ? r2(box.h) : undefined
    if (grow === "auto") return { op: "update", id, unset: ["grow", "w", "h"] }
    if (grow === "fixed-width")
      return {
        op: "update",
        id,
        set: { grow: "fixed-width", ...(w !== undefined ? { w } : {}) },
        unset: ["h"],
      }
    return {
      op: "update",
      id,
      set: {
        grow: "fixed",
        ...(w !== undefined ? { w } : {}),
        ...(h !== undefined ? { h } : {}),
      },
    }
  })
}

export { MIXED }
