/**
 * Shared document readers for layout and renderer: the variable/theme resolver and text
 * resolution (ADR 0009: measure and draw read the same runs).
 */
import {
  defaultTheme,
  isObject,
  isRef,
  type KimoDocument,
  type Libraries,
  resolveVariable,
  type Theme,
} from "@kimo/core-schema"
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

// --- Resolver -----------------------------------------------------------------------------

/** Options for {@link createResolver}. */
export interface ResolverOptions {
  libraries?: Libraries
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
  let base: Theme | null = null

  const baseTheme = (): Theme => {
    base ??= defaultTheme({ ...getHeader(), nodes: {} } as KimoDocument, libs)
    return base
  }
  const theme = (nodeId: string): Theme => {
    const cached = themes.get(nodeId)
    if (cached) return cached
    const n = nodes.getNode(nodeId)
    const parent = n && typeof n.parent === "string" ? theme(n.parent) : baseTheme()
    const pins = n?.theme
    const t = isObject(pins) ? { ...parent } : parent
    if (isObject(pins))
      for (const [k, v] of Object.entries(pins)) if (typeof v === "string") t[k] = v
    themes.set(nodeId, t)
    return t
  }

  return {
    theme,
    value(nodeId, value) {
      if (!isRef(value)) return value
      const doc = { ...getHeader(), nodes: {} } as KimoDocument
      const r = resolveVariable(doc, value.$ref, theme(nodeId), libs)
      if (r.ok) return r.value
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
    },
  }
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
  const style = resolveTextStyle(nodeId, node.style, resolve)
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
