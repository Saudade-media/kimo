/**
 * Shared document readers for layout and renderer: the variable/theme resolver and text
 * resolution (ADR 0009: measure and draw read the same runs).
 */

import {
  defaultTheme,
  isObject,
  isRef,
  isThemedValue,
  jsonEqual,
  type KimoDocument,
  type Libraries,
  resolveVariable,
  type Theme,
} from "@kimo/core-schema"
import { agentNodeChrome } from "./agent-nodes"
import {
  type LayoutIssue,
  type LayoutNodeData,
  type NodeSource,
  type ResolvedTextRun,
  type ResolvedTextStyle,
  type ResolveHeader,
  type Resolver,
  TEXT_STYLE_DEFAULTS,
  type TextMeasureInput,
} from "./types"

// --- Header changes ---------------------------------------------------------------------------

/**
 * True when a header change from `prev` to `next` can change painted colors only, never a
 * layout result: themes and imports are the same, the same variables exist, and every changed
 * variable is a `color` before and after with the same entry structure — the same `when`
 * conditions in the same order and no binding (`$ref`) added, removed or retargeted — so every
 * binding still resolves exactly where it did, to a color. Layout reads no colors (sizes, gaps,
 * padding, stroke widths, visibility and text metrics come from other types), so the previous
 * layout stays valid; only pictures that read a binding need re-recording (renderer
 * `invalidate()`).
 */
export function paintOnlyHeaderChange(prev: ResolveHeader, next: ResolveHeader): boolean {
  if (!jsonEqual(prev.themes ?? null, next.themes ?? null)) return false
  if (!jsonEqual(prev.imports ?? null, next.imports ?? null)) return false
  const a = (prev.variables ?? {}) as Record<string, unknown>
  const b = (next.variables ?? {}) as Record<string, unknown>
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  const changed = new Set<string>()
  for (const k of keys) {
    if (!Object.hasOwn(b, k)) return false
    const va = a[k]
    const vb = b[k]
    if (va === vb || jsonEqual(va, vb)) continue
    if (!isObject(va) || !isObject(vb)) return false
    if (va.type !== "color" || vb.type !== "color") return false
    for (const f of new Set([...Object.keys(va), ...Object.keys(vb)]))
      if (f !== "value" && !jsonEqual(va[f], vb[f])) return false
    if (!sameEntryShape(va.value, vb.value)) return false
    changed.add(k)
  }
  if (changed.size === 0) return true
  // Anything that aliases a changed variable must be a color as well (it repaints only).
  for (const [k, v] of Object.entries(b)) {
    if (changed.has(k) || !isObject(v) || v.type === "color") continue
    if (refsAny(v.value, changed)) return false
  }
  return true
}

/** Same themed/plain form, same `when` per entry, bindings in the same places to the same targets. */
function sameEntryShape(a: unknown, b: unknown): boolean {
  const ta = isThemedValue(a)
  if (ta !== isThemedValue(b)) return false
  if (!ta) return sameRefs(a, b)
  const ea = a as { value: unknown; when?: unknown }[]
  const eb = b as { value: unknown; when?: unknown }[]
  if (ea.length !== eb.length) return false
  for (let i = 0; i < ea.length; i++) {
    const x = ea[i] as { value: unknown; when?: unknown }
    const y = eb[i] as { value: unknown; when?: unknown }
    if (!jsonEqual(x.when ?? null, y.when ?? null)) return false
    for (const f of new Set([...Object.keys(x), ...Object.keys(y)]))
      if (f !== "value" && f !== "when" && !jsonEqual((x as never)[f], (y as never)[f]))
        return false
    if (!sameRefs(x.value, y.value)) return false
  }
  return true
}

/** Both plain (non-binding) values, or the same binding. */
function sameRefs(a: unknown, b: unknown): boolean {
  if (isRef(a) || isRef(b)) return isRef(a) && isRef(b) && a.$ref === b.$ref
  return true
}

function refsAny(v: unknown, names: ReadonlySet<string>, depth = 0): boolean {
  if (depth > 32 || v === null || typeof v !== "object") return false
  if (isRef(v)) return names.has(v.$ref)
  for (const x of Array.isArray(v) ? v : Object.values(v as Record<string, unknown>))
    if (refsAny(x, names, depth + 1)) return true
  return false
}

// --- Resolver -----------------------------------------------------------------------------

/** Options for {@link createResolver}. */
export interface ResolverOptions {
  libraries?: Libraries
  /**
   * M3: the shared expanded view. Themes of composite ids (`<instance>/<IdPath>`) walk the
   * expanded placement path through it (component root pins, §9.8). Not needed when `nodes`
   * already is the view.
   */
  expanded?: Pick<NodeSource, "getNode">
  onIssue?: (issue: LayoutIssue) => void
}

/**
 * A caching {@link Resolver} over a header + node source (spec §10.4). `header` is read
 * lazily so a store-backed caller may pass a getter-backed object; call `invalidate()` after
 * header or `theme`-pin changes.
 */
export function createResolver(
  header: ResolveHeader | (() => ResolveHeader),
  nodes: NodeSource,
  options: ResolverOptions = {},
): Resolver {
  const libs = options.libraries ?? {}
  const getHeader = typeof header === "function" ? header : () => header
  const themes = new Map<string, Theme>()
  const tree: Pick<NodeSource, "getNode"> = options.expanded ?? nodes
  let base: Theme | null = null

  const baseTheme = (): Theme => {
    base ??= defaultTheme({ ...getHeader(), nodes: {} } as KimoDocument, libs)
    return base
  }
  const theme = (nodeId: string): Theme => {
    const cached = themes.get(nodeId)
    if (cached) return cached
    const n = tree.getNode(nodeId)
    const parent = n && typeof n.parent === "string" ? theme(n.parent) : baseTheme()
    const pins = n?.theme
    const t = isObject(pins) ? { ...parent } : parent
    if (isObject(pins))
      for (const [k, v] of Object.entries(pins)) if (typeof v === "string") t[k] = v
    themes.set(nodeId, t)
    return t
  }

  /** The header as a document (built once per invalidation, not per binding). */
  let doc: KimoDocument | null = null
  type Resolved = ReturnType<typeof resolveVariable>
  /**
   * Resolutions per effective theme object (perf): nodes without pins share their parent's
   * theme object, so a binding read by 1k instance nodes resolves once per theme.
   */
  let memo = new WeakMap<Theme, Map<string, Resolved>>()

  return {
    theme,
    value(nodeId, value) {
      if (!isRef(value)) return value
      const t = theme(nodeId)
      let m = memo.get(t)
      if (!m) {
        m = new Map()
        memo.set(t, m)
      }
      let r = m.get(value.$ref)
      if (!r) {
        doc ??= { ...getHeader(), nodes: {} } as KimoDocument
        r = resolveVariable(doc, value.$ref, t, libs)
        m.set(value.$ref, r)
      }
      if (r.ok) return dimensionPx(r)
      options.onIssue?.({
        code: "VARIABLE_UNRESOLVED",
        severity: "warning",
        nodeId,
        message: `${r.reason}: ${value.$ref}`,
      })
      return undefined
    },
    invalidate() {
      // A pin change affects every descendant; themes are cheap to rebuild, so drop them all.
      base = null
      themes.clear()
      doc = null
      memo = new WeakMap()
    },
  }
}

/**
 * A `dimension` variable's value (`{ value, unit: "px" }`, px-only in format 0.x/1.x) as the px
 * number every length reader expects (gap, padding, sizes, radius, stroke width…); any other
 * resolution is returned as is.
 */
function dimensionPx(r: { value: unknown; type?: string | undefined }): unknown {
  const v = r.value
  if (r.type === "dimension" && isObject(v) && typeof v.value === "number") return v.value
  return v
}

// --- Text ---------------------------------------------------------------------------------

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined

/** Applies a (possibly partial, possibly bound) TextStyle on top of `base`. */
export function resolveTextStyle(
  nodeId: string,
  style: unknown,
  resolve: Resolver,
  base: ResolvedTextStyle = TEXT_STYLE_DEFAULTS,
): ResolvedTextStyle {
  if (!isObject(style)) return base
  const out: ResolvedTextStyle = { ...base }
  const layers: Record<string, unknown>[] = []
  const typo = resolve.value(nodeId, style.typography)
  if (isObject(typo)) layers.push(typo)
  layers.push(style)
  for (const s of layers) {
    const font = resolve.value(nodeId, s.font)
    if (typeof font === "string" && font) out.fontFamily = font
    const size = num(resolve.value(nodeId, s.size))
    if (size !== undefined && size > 0) out.fontSize = size
    const weight = num(resolve.value(nodeId, s.weight))
    if (weight !== undefined) out.fontWeight = weight
    if (typeof s.italic === "boolean") out.italic = s.italic
    const lh = s.lineHeight
    if (isObject(lh) && !isRef(lh)) {
      const px = num(lh.px)
      if (px !== undefined) out.lineHeight = { px }
    } else {
      const m = num(resolve.value(nodeId, lh))
      if (m !== undefined) out.lineHeight = { multiplier: m }
    }
    const ls = num(resolve.value(nodeId, s.letterSpacing))
    if (ls !== undefined) out.letterSpacing = ls
    if (typeof s.align === "string") out.align = s.align as ResolvedTextStyle["align"]
    if (typeof s.valign === "string") out.valign = s.valign as ResolvedTextStyle["valign"]
    if (Array.isArray(s.decoration))
      out.decoration = s.decoration as ResolvedTextStyle["decoration"]
    if (typeof s.case === "string") out.case = s.case as ResolvedTextStyle["case"]
    if (isObject(s.features))
      out.features = { ...out.features, ...(s.features as ResolvedTextStyle["features"]) }
  }
  return out
}

/**
 * The resolved runs of a text/note/prompt node — the single input both the measurer and the
 * painter use (ADR 0009: measure and draw must agree).
 */
export function resolveText(
  nodeId: string,
  node: LayoutNodeData,
  resolve: Resolver,
): TextMeasureInput {
  // Notes and prompts: the card's body style (board 22) is the base under `style`.
  const base = agentNodeChrome(node.type)?.text ?? TEXT_STYLE_DEFAULTS
  const style = resolveTextStyle(nodeId, node.style, resolve, base)
  const content = node.content
  let runs: ResolvedTextRun[]
  if (Array.isArray(content)) {
    runs = content.filter(isObject).map((span) => ({
      text: typeof span.text === "string" ? span.text : "",
      style: resolveTextStyle(nodeId, span.style, resolve, style),
    }))
  } else {
    const v = resolve.value(nodeId, content)
    runs = [{ text: typeof v === "string" ? v : "", style }]
  }
  return { nodeId, runs, style }
}
