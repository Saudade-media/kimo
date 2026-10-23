/**
 * Live collaborative text (ADR 0016 item 17, multiplayer spec §15.12): the plain-data model of a
 * text layer's `content` as attributed runs, and the minimal edits between two of them. Pure (no
 * Yjs): the store maps these edits onto its CRDT text, the editor and tests use them as data.
 *
 * A run is a piece of text with FLAT span attributes: `style.<key>` for each member of the span's
 * `style`, `href` and `fill` for the span's own fields. Values are the JSON values of the span; an
 * absent key means the span does not set it. Offsets are UTF-16 code units, like `String#length`.
 *
 * {@link contentOf} is the canonical content of runs: adjacent runs with equal attributes merge,
 * empty runs drop, and a single run without attributes (or nothing) is a plain string. A content
 * value is {@link liveRepresentable} when it is exactly the canonical content of its own runs; only
 * those are held as collaborative text (others keep their exact shape as a plain field).
 */
import { jsonEqual } from "@kimo/core-schema"

/** Flat span attributes (`style.<key>`, `href`, `fill`), JSON values. */
export type TextAttrs = Readonly<Record<string, unknown>>

/** A piece of text with its span attributes. */
export interface TextRun {
  text: string
  attrs: TextAttrs
}

/**
 * One edit of a text layer's content, at UTF-16 offsets of the text as it is when the edit runs
 * (edits of one list apply in order):
 * - `insert`: `text` at `at`, carrying exactly `attrs` (none: no span attributes);
 * - `delete`: `length` characters from `at`;
 * - `format`: sets `attrs` on `length` characters from `at`; a `null` value removes that key.
 */
export type TextEdit =
  | { op: "insert"; at: number; text: string; attrs?: TextAttrs }
  | { op: "delete"; at: number; length: number }
  | { op: "format"; at: number; length: number; attrs: TextAttrs }

/**
 * A change of a text layer's characters, as positions move: retain `n` characters, insert a
 * string, delete `n` characters (format-only changes are retains).
 */
export type TextDelta = readonly ({ retain: number } | { insert: string } | { delete: number })[]

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

const STYLE = "style."

/** Runs of a content value (a string or spans); null for anything else (a binding). */
export function textRunsOf(content: unknown): TextRun[] | null {
  if (typeof content === "string") return content ? [{ text: content, attrs: {} }] : []
  if (!Array.isArray(content)) return null
  const runs: TextRun[] = []
  for (const span of content) {
    if (!isObj(span) || typeof span.text !== "string") return null
    const attrs: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(span)) {
      if (k === "text") continue
      if (k === "style") {
        if (!isObj(v)) return null
        for (const [sk, sv] of Object.entries(v)) attrs[STYLE + sk] = sv
      } else attrs[k] = v
    }
    runs.push({ text: span.text, attrs })
  }
  return runs
}

/** Equal attribute sets (absent and `undefined` alike). */
export function sameTextAttrs(a: TextAttrs, b: TextAttrs): boolean {
  const ka = Object.keys(a).filter((k) => a[k] !== undefined)
  const kb = Object.keys(b).filter((k) => b[k] !== undefined)
  return ka.length === kb.length && ka.every((k) => b[k] !== undefined && jsonEqual(a[k], b[k]))
}

/** Merges adjacent runs with equal attributes and drops empty ones. */
export function normalizeTextRuns(runs: readonly TextRun[]): TextRun[] {
  const out: TextRun[] = []
  for (const r of runs) {
    if (!r.text) continue
    const last = out[out.length - 1]
    if (last && sameTextAttrs(last.attrs, r.attrs)) last.text += r.text
    else out.push({ text: r.text, attrs: r.attrs })
  }
  return out
}

/** The canonical content of runs (see the module comment). */
export function contentOf(runs: readonly TextRun[]): string | Record<string, unknown>[] {
  const merged = normalizeTextRuns(runs)
  const bare = (r: TextRun) => Object.keys(r.attrs).every((k) => r.attrs[k] === undefined)
  if (merged.length === 0) return ""
  if (merged.length === 1 && bare(merged[0] as TextRun)) return (merged[0] as TextRun).text
  return merged.map((r) => {
    const span: Record<string, unknown> = { text: r.text }
    const style: Record<string, unknown> = {}
    for (const k of Object.keys(r.attrs).sort()) {
      const v = r.attrs[k]
      if (v === undefined) continue
      if (k.startsWith(STYLE)) style[k.slice(STYLE.length)] = v
    }
    if (Object.keys(style).length) span.style = style
    for (const k of Object.keys(r.attrs).sort()) {
      const v = r.attrs[k]
      if (v !== undefined && !k.startsWith(STYLE)) span[k] = v
    }
    return span
  })
}

/** True when `content` is held as collaborative text: exactly the canonical content of its runs. */
export function liveRepresentable(content: unknown): boolean {
  const runs = textRunsOf(content)
  return runs !== null && jsonEqual(contentOf(runs), content)
}

/** The plain text of runs. */
export const textOfRuns = (runs: readonly TextRun[]): string => runs.map((r) => r.text).join("")

/** Thrown by {@link applyTextEdits} for an edit outside the text. */
export class TextEditError extends RangeError {
  override readonly name = "TextEditError"
}

/** Splits runs at offset `at`; returns the index of the first run at or after it. */
function splitRuns(runs: TextRun[], at: number): number {
  let pos = 0
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i] as TextRun
    if (at === pos) return i
    const end = pos + r.text.length
    if (at < end) {
      runs.splice(
        i,
        1,
        { text: r.text.slice(0, at - pos), attrs: r.attrs },
        { text: r.text.slice(at - pos), attrs: r.attrs },
      )
      return i + 1
    }
    pos = end
  }
  return runs.length
}

const withAttrs = (base: TextAttrs, patch: TextAttrs): TextAttrs => {
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined) delete out[k]
    else out[k] = v
  }
  return out
}

/** Applies edits to runs (what the store does to its text). Throws {@link TextEditError}. */
export function applyTextEdits(runs: readonly TextRun[], edits: readonly TextEdit[]): TextRun[] {
  let out = runs.map((r) => ({ text: r.text, attrs: r.attrs }))
  for (const e of edits) {
    const length = textOfRuns(out).length
    const span = e.op === "insert" ? 0 : e.length
    if (
      !Number.isInteger(e.at) ||
      !Number.isInteger(span) ||
      e.at < 0 ||
      span < 0 ||
      e.at + span > length
    )
      throw new TextEditError(`Text edit ${e.op} at ${e.at} is outside the text (${length})`)
    if (e.op === "insert") {
      if (typeof e.text !== "string") throw new TextEditError("Text insert without text")
      const i = splitRuns(out, e.at)
      const attrs: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(e.attrs ?? {}))
        if (v !== null && v !== undefined) attrs[k] = v
      out.splice(i, 0, { text: e.text, attrs })
    } else {
      const i = splitRuns(out, e.at)
      const j = splitRuns(out, e.at + span)
      if (e.op === "delete") out.splice(i, j - i)
      else
        for (let k = i; k < j; k++) {
          const r = out[k] as TextRun
          out[k] = { text: r.text, attrs: withAttrs(r.attrs, e.attrs) }
        }
    }
    out = normalizeTextRuns(out)
  }
  return normalizeTextRuns(out)
}

/**
 * The common prefix and suffix of two strings, shifted so that the changed region of `b` ends at
 * `caret` when repeated characters leave a choice (typing "a" after "a" inserts after it).
 */
export function changedRegion(
  a: string,
  b: string,
  caret?: number,
): { prefix: number; suffix: number } {
  const min = Math.min(a.length, b.length)
  let prefix = 0
  while (prefix < min && a.charCodeAt(prefix) === b.charCodeAt(prefix)) prefix++
  let maxSuffix = 0
  while (
    maxSuffix < min &&
    a.charCodeAt(a.length - 1 - maxSuffix) === b.charCodeAt(b.length - 1 - maxSuffix)
  )
    maxSuffix++
  let suffix = Math.min(maxSuffix, min - prefix)
  const end = b.length - suffix
  if (caret !== undefined && Number.isInteger(caret) && caret >= 0 && caret < end) {
    // Slide the region left: the prefix shrinks and the suffix grows by as much (both still
    // match, since the suffix stays within the longest common one).
    const shift = Math.min(end - caret, prefix, maxSuffix - suffix)
    prefix -= shift
    suffix += shift
  }
  // Never split a surrogate pair.
  const isHigh = (s: string, i: number) => {
    const c = s.charCodeAt(i)
    return c >= 0xd800 && c <= 0xdbff
  }
  const isLow = (s: string, i: number) => {
    const c = s.charCodeAt(i)
    return c >= 0xdc00 && c <= 0xdfff
  }
  while (prefix > 0 && (isHigh(a, prefix - 1) || isHigh(b, prefix - 1))) prefix--
  while (suffix > 0 && (isLow(a, a.length - suffix) || isLow(b, b.length - suffix))) suffix--
  return { prefix, suffix }
}

/** Attributes of each character in [from, to) as (length, attrs) pieces. */
function piecesIn(runs: readonly TextRun[], from: number, to: number): TextRun[] {
  const out: TextRun[] = []
  let pos = 0
  for (const r of runs) {
    const end = pos + r.text.length
    const a = Math.max(from, pos)
    const b = Math.min(to, end)
    if (b > a) out.push({ text: r.text.slice(a - pos, b - pos), attrs: r.attrs })
    pos = end
  }
  return out
}

/** The format patch turning `a` into `b` (null removes), or null when they are equal. */
function attrPatch(a: TextAttrs, b: TextAttrs): Record<string, unknown> | null {
  const out: Record<string, unknown> = {}
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k]
    const y = b[k]
    if (x === undefined && y === undefined) continue
    if (y === undefined) out[k] = null
    else if (x === undefined || !jsonEqual(x, y)) out[k] = y
  }
  return Object.keys(out).length ? out : null
}

/** Format edits turning the attributes of `from` into those of `to` (same text), from `offset`. */
function formatEdits(from: readonly TextRun[], to: readonly TextRun[], offset: number): TextEdit[] {
  const edits: TextEdit[] = []
  // Walk both run lists by character boundaries.
  const cuts = new Set<number>([0])
  for (const runs of [from, to]) {
    let p = 0
    for (const r of runs) {
      p += r.text.length
      cuts.add(p)
    }
  }
  const points = [...cuts].sort((x, y) => x - y)
  const attrsAt = (runs: readonly TextRun[], at: number): TextAttrs => {
    let pos = 0
    for (const r of runs) {
      const end = pos + r.text.length
      if (at >= pos && at < end) return r.attrs
      pos = end
    }
    return {}
  }
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i] as number
    const b = points[i + 1] as number
    if (b <= a) continue
    const patch = attrPatch(attrsAt(from, a), attrsAt(to, a))
    if (!patch) continue
    const last = edits[edits.length - 1]
    if (
      last?.op === "format" &&
      last.at + last.length === offset + a &&
      jsonEqual(last.attrs, patch)
    )
      last.length += b - a
    else edits.push({ op: "format", at: offset + a, length: b - a, attrs: patch })
  }
  return edits
}

/**
 * The minimal edits turning runs `from` into runs `to`: one replaced region of characters (the
 * common prefix and suffix are kept; `caret` places it when repeated characters leave a choice)
 * and format changes of the kept characters. Applying them with {@link applyTextEdits} gives `to`
 * (normalized).
 */
export function diffTextRuns(
  from: readonly TextRun[],
  to: readonly TextRun[],
  caret?: number,
): TextEdit[] {
  const a = textOfRuns(from)
  const b = textOfRuns(to)
  const { prefix, suffix } = changedRegion(a, b, caret)
  const edits: TextEdit[] = []
  // Formats of the kept suffix first (offsets of the old text), then the prefix, then the
  // replacement: earlier offsets stay valid.
  edits.push(
    ...formatEdits(
      piecesIn(from, a.length - suffix, a.length),
      piecesIn(to, b.length - suffix, b.length),
      a.length - suffix,
    ),
  )
  edits.push(...formatEdits(piecesIn(from, 0, prefix), piecesIn(to, 0, prefix), 0))
  const removed = a.length - suffix - prefix
  if (removed > 0) edits.push({ op: "delete", at: prefix, length: removed })
  let at = prefix
  for (const r of piecesIn(to, prefix, b.length - suffix)) {
    const attrs: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(r.attrs)) if (v !== undefined) attrs[k] = v
    edits.push({ op: "insert", at, text: r.text, attrs })
    at += r.text.length
  }
  return edits
}

/** Moves offset `pos` through `delta` (`assoc` < 0 keeps it before an insertion at `pos`). */
export function transformOffset(pos: number, delta: TextDelta, assoc = 1): number {
  let index = 0
  let out = pos
  for (const d of delta) {
    if (index > pos || (index === pos && assoc < 0 && "insert" in d)) break
    if ("retain" in d) index += d.retain
    else if ("insert" in d) {
      out += d.insert.length
    } else {
      const removed = Math.min(d.delete, Math.max(0, pos - index))
      out -= removed
      index += d.delete
      if (pos < index) break
    }
  }
  return out
}
