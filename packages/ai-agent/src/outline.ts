/**
 * Page outline for the turn context (board 31 token pass): a compact, bounded map of the page
 * so the model edits by id without exploratory kimo_get_state / kimo_query calls. One line per
 * node, indented by depth (canvas-space box, layout with gap/pad, fill, radius, text style):
 *
 *   Lp01 frame "Landing" 0,0 1440x4210 layout={dir:column} fill=$color/bg sel
 *    Lp02 frame "Nav" 0,0 1440x80 layout={dir:row,pad:[24,80]}
 *     Lp03 text "Wordmark" 80,26 68x28 fill=$color/ink style={font:Inter,size:20} "Lumen"
 *
 * The selected subtrees come first and as deep as the budget allows; the other top-level nodes
 * of the page follow, shallow. Elided children show as `+N`; when the budget runs out the
 * outline ends with a note naming kimo_query.
 */

export interface OutlineBox {
  x: number
  y: number
  w: number
  h: number
}

/** What the outline reads from the document (the editor's store and layout). */
export interface OutlineSource {
  /** Top-level node ids of the page the user is on, in order. */
  roots(): readonly string[]
  /** Child ids in order. */
  children(id: string): readonly string[]
  /** The node's `.kimo` body. */
  node(id: string): Readonly<Record<string, unknown>> | undefined
  /** Laid-out box in canvas space, when known. */
  box?(id: string): OutlineBox | null | undefined
}

export interface OutlineOptions {
  /** Selected node ids (outlined first and deepest). */
  selection?: readonly string[]
  /** Character budget (~4 characters per token). Default 12 000 (~3k tokens). */
  maxChars?: number
  /** Child levels shown under top-level nodes that are not selected. Default 1. */
  otherDepth?: number
}

export const OUTLINE_MAX_CHARS = 12_000

const TEXT_SNIPPET = 32
const NAME_MAX = 40

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const r = (v: number) => Math.round(v)

function textOf(content: unknown): string | null {
  if (typeof content === "string") return content
  if (Array.isArray(content))
    return content.map((s) => (s && typeof s === "object" ? String(s.text ?? "") : "")).join("")
  return null
}

const LAYOUT_KEYS = ["dir", "gap", "pad", "justify", "align", "wrap"]
const STYLE_KEYS = ["font", "size", "weight", "lineHeight", "letterSpacing", "align"]

/** `{dir:row,gap:24,pad:[24,80]}`: the listed keys of an object, unquoted. */
function compact(o: Record<string, unknown>, keys: readonly string[]): string {
  const v = (x: unknown): string =>
    Array.isArray(x)
      ? `[${x.map(v).join(",")}]`
      : isRef(x)
        ? `$${x.$ref}`
        : x && typeof x === "object"
          ? JSON.stringify(x).replace(/"/g, "")
          : String(x)
  return `{${keys
    .filter((k) => o[k] !== undefined)
    .map((k) => `${k}:${v(o[k])}`)
    .join(",")}}`
}

const isRef = (v: unknown): v is { $ref: string } =>
  !!v && typeof v === "object" && typeof (v as { $ref?: unknown }).$ref === "string"

/** A short label of a paint: `#hex`, `$variable`, `linear`…; the first of a list. */
function paintOf(p: unknown): string | null {
  if (Array.isArray(p)) return p.length ? paintOf(p[0]) : null
  if (typeof p === "string") return p
  if (isRef(p)) return `$${p.$ref}`
  if (p && typeof p === "object" && typeof (p as { kind?: unknown }).kind === "string")
    return String((p as { kind: string }).kind)
  return null
}

/** One node's line (without indentation or the elided-children count). */
export function outlineLine(id: string, src: OutlineSource, selected: boolean): string {
  const n = src.node(id) ?? {}
  const parts = [id, String(n.type ?? "?")]
  if (typeof n.name === "string" && n.name) parts.push(JSON.stringify(clip(n.name, NAME_MAX)))
  const b = src.box?.(id)
  if (b) parts.push(`${r(b.x)},${r(b.y)} ${r(b.w)}x${r(b.h)}`)
  // Field names as in the format (layout.gap, style.size…), so they can be copied into ops.
  const layout = n.layout as Record<string, unknown> | undefined
  if (layout && typeof layout.dir === "string") parts.push(`layout=${compact(layout, LAYOUT_KEYS)}`)
  const fill = paintOf(n.fill)
  if (fill) parts.push(`fill=${fill}`)
  if (typeof n.radius === "number" && n.radius) parts.push(`radius=${n.radius}`)
  else if (isRef(n.radius)) parts.push(`radius=$${n.radius.$ref}`)
  if (n.type === "text" && n.style && typeof n.style === "object")
    parts.push(`style=${compact(n.style as Record<string, unknown>, STYLE_KEYS)}`)
  if (n.component !== undefined) parts.push("component")
  if (n.type === "instance" && typeof n.of === "string") parts.push(`of=${n.of}`)
  if (n.visible === false) parts.push("hidden")
  if (n.placeholder !== undefined) parts.push("placeholder")
  if (n.type === "text") {
    const t = textOf(n.content)
    if (t) parts.push(JSON.stringify(clip(t.replace(/\s+/g, " ").trim(), TEXT_SNIPPET)))
  }
  if (selected) parts.push("sel")
  return parts.join(" ")
}

/** Number of nodes in a subtree (root included). */
function sizeOf(id: string, src: OutlineSource, seen = new Set<string>()): number {
  if (seen.has(id)) return 0
  seen.add(id)
  let n = 1
  for (const c of src.children(id)) n += sizeOf(c, src, seen)
  return n
}

/**
 * The outline text, or null when the page is empty. Never longer than `maxChars` (plus the
 * one-line truncation note).
 */
export function buildPageOutline(src: OutlineSource, o: OutlineOptions = {}): string | null {
  const budget = o.maxChars ?? OUTLINE_MAX_CHARS
  const otherDepth = o.otherDepth ?? 1
  const roots = src.roots()
  if (!roots.length) return null
  const selection = (o.selection ?? []).filter((id) => src.node(id))
  const selected = new Set(selection)
  const lines: string[] = []
  let used = 0
  let truncated = false
  const omitted: string[] = []
  const emitted = new Set<string>()

  /** A subtree in DFS order down to `maxDepth` (children below show as +N). */
  const subtree = (id: string, maxDepth: number) => {
    const out: string[] = []
    const ids: string[] = []
    const seen = new Set<string>()
    let size = 0
    const walk = (nid: string, depth: number) => {
      if (emitted.has(nid) || seen.has(nid)) return
      seen.add(nid)
      const kids = src.children(nid)
      // Past the budget the subtree stops growing (the caller then keeps a shallower one).
      const descend = depth < maxDepth && used + size <= budget
      const elided = !descend && kids.length ? ` +${kids.length}` : ""
      const line = `${" ".repeat(depth)}${outlineLine(nid, src, selected.has(nid))}${elided}`
      out.push(line)
      ids.push(nid)
      size += line.length + 1
      if (descend) for (const c of kids) walk(c, depth + 1)
    }
    walk(id, 0)
    return { lines: out, ids }
  }
  const cost = (ls: string[]) => ls.reduce((a, l) => a + l.length + 1, 0)

  /** Emits the deepest version of a subtree that fits the remaining budget. */
  const emit = (id: string, maxDepth: number) => {
    let best: { lines: string[]; ids: string[] } | null = null
    const total = sizeOf(id, src)
    for (let d = 0; d <= maxDepth; d++) {
      const t = subtree(id, d)
      if (used + cost(t.lines) > budget) break
      best = t
      if (t.ids.length >= total) break
    }
    if (!best) {
      truncated = true
      omitted.push(id)
      return
    }
    if (maxDepth > otherDepth && best.ids.length < total) omitted.push(id)
    lines.push(...best.lines)
    used += cost(best.lines)
    for (const x of best.ids) emitted.add(x)
  }

  // Selected subtrees first, as deep as they fit (their top-level root as context line).
  for (const id of selection) {
    if (emitted.has(id)) continue
    emit(id, 64)
  }
  // Then the page's other top-level nodes, shallow.
  for (const id of roots) {
    if (emitted.has(id)) continue
    if (used >= budget) {
      truncated = true
      omitted.push(id)
      continue
    }
    emit(id, otherDepth)
  }
  const header =
    'Page outline (id type "name" x,y wxh in canvas space, then key fields; $v = {"$ref":"v"}; indent = child; +N = children not shown):'
  const notes: string[] = []
  if (truncated || omitted.length)
    notes.push(
      `… outline shortened; read the rest with kimo_query (under: ${omitted.slice(0, 6).join(", ")}${omitted.length > 6 ? ", …" : ""}).`,
    )
  return [header, ...lines, ...notes].join("\n")
}
