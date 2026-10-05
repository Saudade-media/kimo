/**
 * Rich-text model of the inline text editor (board 30 "Rich text"; spec §8.1 feature
 * `text/runs`). Pure: unit-tested with `bun test`.
 *
 * While editing, a text is a list of runs, each carrying its EFFECTIVE attributes — the node's
 * `style` with the span's `style` on top, the span's `fill` (else the node's) and link (`href`).
 * An attribute that is `undefined` means "absent" (the reader default). Editing splits and
 * merges runs; {@link toNodePatch} writes the result back canonically:
 *
 * - an attribute every run agrees on lives on the node (`style.<key>`, `fill`, `style.href`) and
 *   no span repeats it;
 * - otherwise each run that differs from the node value carries it on its span;
 * - adjacent runs with equal attributes merge; a text whose runs are all equal is a plain string
 *   (so `text/runs` is only needed when styles really differ).
 *
 * Paragraph fields (`align`, `valign`, `typography`) stay on the node only.
 */

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v)

/** TextStyle keys a span may carry (spec §8.2 minus paragraph fields). */
export const SPAN_STYLE_KEYS = [
  "font",
  "size",
  "weight",
  "italic",
  "lineHeight",
  "letterSpacing",
  "decoration",
  "case",
  "features",
] as const
export type SpanStyleKey = (typeof SPAN_STYLE_KEYS)[number]
/** Every attribute of a run: span style keys, the span's own color and its link. */
export const ATTR_KEYS = [...SPAN_STYLE_KEYS, "fill", "href"] as const
export type AttrKey = (typeof ATTR_KEYS)[number]

/** Effective attributes of a run (absent / undefined = the reader default). */
export type Attrs = Partial<Record<AttrKey, unknown>>

export interface Run {
  text: string
  attrs: Attrs
}

/** A partial attribute change: `undefined` removes the attribute (reader default). */
export type AttrPatch = Partial<Record<AttrKey, unknown>>

/** A text node (the model reads `content`, `style` and `fill`). */
export type TextNodeLike = object
const fields = (n: TextNodeLike) => n as { content?: unknown; style?: unknown; fill?: unknown }

// --- Equality -------------------------------------------------------------------------------

/** Structural equality for JSON values (key order independent). */
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const bb = b as unknown[]
    return a.length === bb.length && a.every((x, i) => same(x, bb[i]))
  }
  const ka = Object.keys(a as Obj).filter((k) => (a as Obj)[k] !== undefined)
  const kb = Object.keys(b as Obj).filter((k) => (b as Obj)[k] !== undefined)
  return ka.length === kb.length && ka.every((k) => same((a as Obj)[k], (b as Obj)[k]))
}

export function sameAttrs(a: Attrs, b: Attrs): boolean {
  return ATTR_KEYS.every((k) => same(a[k], b[k]))
}

/** Drops `undefined` entries (stable key order of ATTR_KEYS). */
export function cleanAttrs(a: Attrs): Attrs {
  const out: Attrs = {}
  for (const k of ATTR_KEYS) if (a[k] !== undefined) out[k] = a[k]
  return out
}

// --- Node → runs ----------------------------------------------------------------------------

/** The node's own (inherited) attributes: style keys, `fill`, `style.href`. */
export function nodeAttrs(n: TextNodeLike): Attrs {
  const node = fields(n)
  const style = isObj(node.style) ? node.style : {}
  const out: Attrs = {}
  for (const k of SPAN_STYLE_KEYS) if (style[k] !== undefined) out[k] = style[k]
  if (node.fill !== undefined) out.fill = node.fill
  if (typeof style.href === "string") out.href = style.href
  return out
}

/** Runs with effective attributes (content string → one run; a binding → its text, if given). */
export function runsOf(n: TextNodeLike, boundText?: string): Run[] {
  const node = fields(n)
  const base = nodeAttrs(node)
  const c = node.content
  if (Array.isArray(c)) {
    const runs: Run[] = []
    for (const span of c) {
      if (!isObj(span)) continue
      const attrs: Attrs = { ...base }
      const st = isObj(span.style) ? span.style : {}
      for (const k of SPAN_STYLE_KEYS) if (st[k] !== undefined) attrs[k] = st[k]
      if (typeof st.href === "string") attrs.href = st.href
      if (typeof span.href === "string") attrs.href = span.href
      if (span.fill !== undefined) attrs.fill = span.fill
      runs.push({ text: typeof span.text === "string" ? span.text : "", attrs: cleanAttrs(attrs) })
    }
    return normalize(runs, base)
  }
  const text = typeof c === "string" ? c : (boundText ?? "")
  return [{ text, attrs: cleanAttrs(base) }]
}

export const plainText = (runs: readonly Run[]): string => runs.map((r) => r.text).join("")
export const lengthOf = (runs: readonly Run[]): number =>
  runs.reduce((n, r) => n + r.text.length, 0)

// --- Normalization ----------------------------------------------------------------------------

/**
 * Merges adjacent runs with equal attributes and drops empty runs. An empty text keeps one
 * empty run (its attributes are the typing style), `fallback` when there is none.
 */
export function normalize(runs: readonly Run[], fallback: Attrs = {}): Run[] {
  const out: Run[] = []
  for (const r of runs) {
    if (!r.text) continue
    const last = out[out.length - 1]
    if (last && sameAttrs(last.attrs, r.attrs)) last.text += r.text
    else out.push({ text: r.text, attrs: r.attrs })
  }
  if (out.length === 0) {
    const keep = runs.find((r) => r) ?? { text: "", attrs: fallback }
    return [{ text: "", attrs: keep.attrs }]
  }
  return out
}

/** Splits runs so that offsets `a` and `b` fall on run boundaries; returns [runs, i0, i1). */
function splitAt(
  runs: readonly Run[],
  a: number,
  b: number,
): { runs: Run[]; i0: number; i1: number } {
  const out: Run[] = []
  let pos = 0
  let i0 = -1
  let i1 = -1
  const cut = (r: Run, from: number, to: number) => {
    if (to > from) out.push({ text: r.text.slice(from, to), attrs: r.attrs })
  }
  for (const r of runs) {
    const end = pos + r.text.length
    const points = [0, r.text.length]
    if (a > pos && a < end) points.push(a - pos)
    if (b > pos && b < end) points.push(b - pos)
    const sorted = [...new Set(points)].sort((x, y) => x - y)
    for (let k = 0; k < sorted.length - 1; k++) {
      const from = sorted[k] as number
      if (pos + from === a && i0 < 0) i0 = out.length
      if (pos + from === b && i1 < 0) i1 = out.length
      cut(r, from, sorted[k + 1] as number)
    }
    pos = end
  }
  if (i0 < 0) i0 = out.length
  if (i1 < 0) i1 = out.length
  return { runs: out, i0, i1 }
}

// --- Queries ------------------------------------------------------------------------------------

/**
 * Attributes typed at a collapsed caret: the character before it (Figma), else the one after,
 * else the (empty) first run's.
 */
export function attrsAt(runs: readonly Run[], offset: number): Attrs {
  let pos = 0
  for (const r of runs) {
    const end = pos + r.text.length
    if (offset > pos && offset <= end) return r.attrs
    pos = end
  }
  return runs[0]?.attrs ?? {}
}

/** One distinct attribute set inside a range, with the sub-ranges it covers. */
export interface AttrGroup {
  attrs: Attrs
  ranges: [number, number][]
}

/** Distinct attribute sets inside [a, b) (a collapsed range: the typing attributes). */
export function groupsIn(
  runs: readonly Run[],
  a: number,
  b: number,
  typing?: Attrs | null,
): AttrGroup[] {
  if (a >= b) return [{ attrs: typing ?? attrsAt(runs, a), ranges: [[a, a]] }]
  const groups: AttrGroup[] = []
  let pos = 0
  for (const r of runs) {
    const end = pos + r.text.length
    const from = Math.max(a, pos)
    const to = Math.min(b, end)
    if (to > from) {
      const g = groups.find((x) => sameAttrs(x.attrs, r.attrs))
      if (g) g.ranges.push([from, to])
      else groups.push({ attrs: r.attrs, ranges: [[from, to]] })
    }
    pos = end
  }
  return groups
}

// --- Edits ----------------------------------------------------------------------------------------

/** Applies `patch` (or a per-run function) to the characters in [a, b). */
export function applyAttrs(
  runs: readonly Run[],
  a: number,
  b: number,
  patch: AttrPatch | ((attrs: Attrs) => AttrPatch),
): Run[] {
  if (a >= b) return runs.map((r) => ({ ...r }))
  const s = splitAt(runs, a, b)
  const out = s.runs.map((r, i) => {
    if (i < s.i0 || i >= s.i1) return r
    const p = typeof patch === "function" ? patch(r.attrs) : patch
    return { text: r.text, attrs: cleanAttrs({ ...r.attrs, ...p }) }
  })
  return normalize(out, runs[0]?.attrs)
}

/** Replaces [a, b) with `text` carrying `attrs` (default: the attributes typed at `a`). */
export function replaceText(
  runs: readonly Run[],
  a: number,
  b: number,
  text: string,
  attrs?: Attrs,
): Run[] {
  const typed =
    attrs ?? (a < b ? (groupsIn(runs, a, a + 1)[0]?.attrs ?? attrsAt(runs, a)) : attrsAt(runs, a))
  const s = splitAt(runs, a, b)
  const out = [...s.runs.slice(0, s.i0), { text, attrs: typed }, ...s.runs.slice(s.i1)]
  const fallback = text ? undefined : typed
  return normalize(out, fallback ?? runs[0]?.attrs)
}

/** The text in [a, b). */
export function sliceText(runs: readonly Run[], a: number, b: number): string {
  return plainText(runs).slice(a, b)
}

// --- Runs → node ----------------------------------------------------------------------------------

/** Solid colors (and color bindings) are the only values a span `fill` can hold. */
export function isColorValue(v: unknown): boolean {
  if (typeof v === "string") return true
  if (!isObj(v)) return false
  if (typeof v.$ref === "string") return true
  return v.space === "oklch" || v.space === "display-p3"
}

/** Fields to write on the node: `content`, `style` and `fill` (`undefined` = remove). */
export interface NodePatch {
  content: string | Obj[]
  style: Obj | undefined
  fill: unknown
  /** True when `content` is spans (the document needs feature `text/runs`). */
  runs: boolean
}

/**
 * The canonical node fields for `runs` over `node` (see the module comment). Paragraph style
 * fields of the node are kept as they are.
 */
export function toNodePatch(runs: readonly Run[], n: TextNodeLike): NodePatch {
  const node = fields(n)
  const style: Obj = isObj(node.style) ? { ...node.style } : {}
  let fill: unknown = node.fill
  const live = runs.filter((r) => r.text.length > 0)
  const all = live.length ? live : runs.slice(0, 1)
  /** Node value of each attribute; runs differing from it carry their own. */
  const nodeValue: Attrs = {}
  const current = nodeAttrs(node)
  for (const k of ATTR_KEYS) {
    const values = all.map((r) => r.attrs[k])
    const first = values[0]
    let v: unknown
    if (values.every((x) => same(x, first))) v = first
    // Keep the node's own value when some runs still use it (the smallest change).
    else if (
      current[k] !== undefined &&
      values.some((x) => same(x, current[k])) &&
      !values.includes(undefined) &&
      (k !== "fill" ||
        values.every((x) => x === undefined || isColorValue(x) || same(x, current[k])))
    )
      v = current[k]
    else if (k === "fill") {
      // Spans can only hold colors: a paint (gradient, list) must stay on the node.
      const paint = values.find((x) => x !== undefined && !isColorValue(x))
      v =
        paint !== undefined
          ? paint
          : values.some((x) => x === undefined)
            ? undefined
            : mostCommon(values)
    } else v = values.some((x) => x === undefined) ? undefined : mostCommon(values)
    nodeValue[k] = v
    if (k === "fill") fill = v
    else if (k === "href") {
      if (v === undefined) delete style.href
      else style.href = v
    } else if (v === undefined) delete style[k]
    else style[k] = v
  }
  const spans: Obj[] = []
  for (const r of live) {
    const span: Obj = { text: r.text }
    const own: Obj = {}
    for (const k of SPAN_STYLE_KEYS)
      if (r.attrs[k] !== undefined && !same(r.attrs[k], nodeValue[k])) own[k] = r.attrs[k]
    if (Object.keys(own).length) span.style = own
    if (r.attrs.href !== undefined && !same(r.attrs.href, nodeValue.href)) span.href = r.attrs.href
    if (
      r.attrs.fill !== undefined &&
      !same(r.attrs.fill, nodeValue.fill) &&
      isColorValue(r.attrs.fill)
    )
      span.fill = r.attrs.fill
    const last = spans[spans.length - 1]
    if (last && same(withoutText(last), withoutText(span)))
      last.text = `${last.text as string}${r.text}`
    else spans.push(span)
  }
  const plain = spans.length <= 1 && (spans[0] === undefined || Object.keys(spans[0]).length === 1)
  return {
    content: plain ? ((spans[0]?.text as string | undefined) ?? "") : spans,
    style: Object.keys(style).length ? style : undefined,
    fill,
    runs: !plain,
  }
}

const withoutText = (s: Obj): Obj => {
  const { text: _t, ...rest } = s
  return rest
}

function mostCommon(values: unknown[]): unknown {
  let best = values[0]
  let bestN = 0
  for (const v of values) {
    const n = values.filter((x) => same(x, v)).length
    if (n > bestN) {
      best = v
      bestN = n
    }
  }
  return best
}

// --- Panel bridge -----------------------------------------------------------------------------

/**
 * A node as the right panel should see one attribute group: the node with the group's attributes
 * as its own `style` / `fill` (paragraph fields kept), so the Text and Fill sections read the
 * selection's values with their usual helpers ("Mixed" when groups differ).
 */
export function virtualNode<N extends TextNodeLike>(node: N, attrs: Attrs): N {
  const style: Obj = {}
  const ns = isObj(fields(node).style) ? (fields(node).style as Obj) : {}
  for (const [k, v] of Object.entries(ns))
    if (!(SPAN_STYLE_KEYS as readonly string[]).includes(k) && k !== "href") style[k] = v
  for (const k of SPAN_STYLE_KEYS) if (attrs[k] !== undefined) style[k] = attrs[k]
  if (attrs.href !== undefined) style.href = attrs.href
  const out: Obj = { ...(node as Obj), style }
  if (Object.keys(style).length === 0) delete out.style
  if (attrs.fill !== undefined) out.fill = attrs.fill
  else delete out.fill
  return out as N
}

/**
 * The attribute change a panel edit made to a virtual node: compares its new `style` / `fill`
 * with the virtual node's. `paragraph` holds node-level style fields (align, valign, typography)
 * that changed.
 */
export function patchFromEdit(
  before: TextNodeLike,
  set: Obj | undefined,
  unset: readonly string[] | undefined,
): { attrs: AttrPatch; paragraph: Obj; fill?: { value: unknown } } {
  const attrs: AttrPatch = {}
  const paragraph: Obj = {}
  const bs = fields(before).style
  const prevStyle = isObj(bs) ? bs : {}
  let nextStyle: Obj | null = null
  if (set && "style" in set) nextStyle = isObj(set.style) ? set.style : {}
  if (unset?.includes("style")) nextStyle = {}
  if (nextStyle) {
    for (const k of SPAN_STYLE_KEYS) if (!same(prevStyle[k], nextStyle[k])) attrs[k] = nextStyle[k]
    if (!same(prevStyle.href, nextStyle.href)) attrs.href = nextStyle.href
    for (const k of new Set([...Object.keys(prevStyle), ...Object.keys(nextStyle)])) {
      if ((SPAN_STYLE_KEYS as readonly string[]).includes(k) || k === "href") continue
      if (!same(prevStyle[k], nextStyle[k])) paragraph[k] = nextStyle[k]
    }
  }
  let fill: { value: unknown } | undefined
  if (set && "fill" in set) fill = { value: set.fill }
  if (unset?.includes("fill")) fill = { value: undefined }
  if (fill) attrs.fill = fill.value
  return fill ? { attrs, paragraph, fill } : { attrs, paragraph }
}
