/**
 * Positioned scene for the vector emitters (SVG, PDF): the IR tree with the boxes of a layout
 * pass (`@kimo/layout` `LayoutResult`, same view ids) and text broken into lines.
 *
 * Line breaking reproduces the canvas paragraph greedily with the same `TextMeasurer` the
 * layout used (word by word; explicit `\n` breaks). Without a measurer only explicit breaks
 * are honored.
 */
import type { LayoutResult, Matrix, ResolvedTextStyle, TextMeasurer } from "@kimo/layout"
import type { IRNode, IRTextStyle } from "../ir/types"

export interface SceneNode {
  node: IRNode
  w: number
  h: number
  /** Parent space → this node's local space (y down). */
  local: Matrix
  /** Root space → this node's local space. */
  world: Matrix
  children: SceneNode[]
  /** Text lines (text nodes). */
  lines?: TextLine[]
}

export interface TextSegment {
  text: string
  style: IRTextStyle
}

export interface TextLine {
  /** Left edge of the line in the node box. */
  x: number
  /** Baseline in the node box. */
  baseline: number
  width: number
  segments: TextSegment[]
}

export interface SceneOptions {
  layout: LayoutResult
  measureText?: TextMeasurer
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ]
}

export function invert(m: Matrix): Matrix | null {
  const det = m[0] * m[3] - m[1] * m[2]
  if (Math.abs(det) < 1e-12) return null
  const a = m[3] / det
  const b = -m[1] / det
  const c = -m[2] / det
  const d = m[0] / det
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])]
}

/** Converts an IR text style to the measurer's resolved style. */
export function resolvedStyle(s: IRTextStyle): ResolvedTextStyle {
  return {
    fontFamily: s.family.v,
    fontSize: s.size.v,
    fontWeight: s.weight.v,
    italic: s.italic,
    lineHeight:
      s.lineHeight.kind === "normal"
        ? null
        : s.lineHeight.kind === "px"
          ? { px: s.lineHeight.v }
          : { multiplier: s.lineHeight.v.v },
    letterSpacing: s.letterSpacing.v,
    align: s.align,
    valign: s.valign,
    decoration: s.decoration,
    case: s.case,
    features: s.features,
  }
}

/** Applies `case` (spec §8.2: a render-time transform). */
export function applyCase(t: string, c: IRTextStyle["case"]): string {
  if (c === "upper") return t.toUpperCase()
  if (c === "lower") return t.toLowerCase()
  if (c === "title")
    return t.replace(/(^|\s)(\S)/g, (_, a: string, b: string) => a + b.toUpperCase())
  return t
}

/** Builds the scene of `root` from a layout of the same document. */
export function buildScene(root: IRNode, o: SceneOptions): SceneNode | null {
  const rootLayout = o.layout.nodes.get(root.id)
  if (!rootLayout) return null
  const rootInv = invert(rootLayout.transform) ?? IDENTITY
  const visit = (n: IRNode, parentWorld: Matrix): SceneNode | null => {
    const l = o.layout.nodes.get(n.id)
    if (!l || !n.visible) return null
    const world = multiply(rootInv, l.transform)
    const local = multiply(invert(parentWorld) ?? IDENTITY, world)
    const s: SceneNode = { node: n, w: l.local.w, h: l.local.h, local, world, children: [] }
    if (n.text) s.lines = textLines(n, l.local.w, l.local.h, l.text?.lines, o.measureText)
    for (const c of n.children) {
      const cs = visit(c, world)
      if (cs) s.children.push(cs)
    }
    return s
  }
  return visit(
    root,
    rootLayout.transform === undefined ? IDENTITY : multiply(rootInv, rootLayout.transform),
  )
}

/** Lines of a text node in its `w`×`h` box. */
export function textLines(
  n: IRNode,
  w: number,
  h: number,
  expected: number | undefined,
  measurer: TextMeasurer | undefined,
): TextLine[] {
  const t = n.text
  if (!t) return []
  const style = t.style
  // Characters with their run index, case applied per run.
  const chars: { c: string; run: number }[] = []
  t.runs.forEach((r, i) => {
    // UTF-16 code units, so indices agree with string offsets (surrogate pairs stay adjacent).
    const cased = applyCase(r.text, r.style.case)
    for (let k = 0; k < cased.length; k++) chars.push({ c: cased[k] as string, run: i })
  })
  const full = chars.map((x) => x.c).join("")
  const measure = (s: string): { w: number; h: number; baseline?: number } => {
    if (!measurer) return { w: s.length * style.size.v * 0.5, h: style.size.v * 1.2 }
    return measurer.measure(
      {
        nodeId: n.id,
        runs: [{ text: s, style: resolvedStyle(style) }],
        style: resolvedStyle(style),
      },
      undefined,
    )
  }
  const wrap = t.grow !== "auto" && measurer !== undefined
  // Greedy word wrap of each paragraph (spaces stay at the end of the line they follow).
  const ranges: [number, number][] = []
  let start = 0
  for (const para of full.split("\n")) {
    const end = start + para.length
    if (!wrap) ranges.push([start, end])
    else {
      let lineStart = start
      let lastFit = start
      const words = para.match(/\S+\s*|\s+/g) ?? []
      let pos = start
      for (const word of words) {
        const next = pos + word.length
        const candidate = full.slice(lineStart, next).replace(/\s+$/, "")
        if (pos > lineStart && measure(candidate).w > w + 0.01) {
          ranges.push([lineStart, lastFit])
          lineStart = pos
        }
        pos = next
        lastFit = next
      }
      ranges.push([lineStart, end])
    }
    start = end + 1
  }
  const m = measure(full.split("\n")[0] ?? "")
  const lineH =
    style.lineHeight.kind === "px"
      ? style.lineHeight.v
      : style.lineHeight.kind === "multiplier"
        ? style.lineHeight.v.v * style.size.v
        : expected && expected > 0
          ? h / expected
          : m.h
  const baseline0 = m.baseline ?? lineH * 0.8
  const total = lineH * ranges.length
  const dy =
    t.grow === "fixed" && style.valign !== "top"
      ? style.valign === "middle"
        ? (h - total) / 2
        : h - total
      : 0
  return ranges.map(([a, b], i) => {
    const segs: TextSegment[] = []
    for (let k = a; k < b; k++) {
      const ch = chars[k] as { c: string; run: number }
      const last = segs[segs.length - 1]
      const runStyle = (t.runs[ch.run] as { style: IRTextStyle }).style
      if (last && last.style === runStyle) last.text += ch.c
      else segs.push({ text: ch.c, style: runStyle })
    }
    const text = full.slice(a, b).replace(/\s+$/, "")
    const lw = text ? measure(text).w : 0
    const x = style.align === "center" ? (w - lw) / 2 : style.align === "right" ? w - lw : 0
    return { x, baseline: dy + baseline0 + i * lineH, width: lw, segments: segs }
  })
}
