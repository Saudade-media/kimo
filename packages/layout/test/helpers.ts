import {
  createLayoutEngine,
  createResolver,
  type LayoutEngine,
  type LayoutEngineOptions,
  type LayoutInput,
  type LayoutNodeData,
  type LayoutResult,
  type NodeLayout,
  nodeSourceFromDocument,
  type ResolveHeader,
  type TextMeasurer,
} from "../src/index"

/**
 * Deterministic fake measurer: every glyph is `0.5 × fontSize` wide (spaces included), lines
 * are `lineHeight` tall (default 1.25 × fontSize), words wrap greedily at `maxWidth`, `\n`
 * breaks. Baseline = 0.8 × fontSize.
 */
export const fakeMeasurer: TextMeasurer & { calls: number } = {
  calls: 0,
  measure(t, maxWidth) {
    this.calls++
    const style = t.style
    const size = style.fontSize
    const lh = style.lineHeight
    const lineH =
      lh === null
        ? size * 1.25
        : "px" in lh
          ? lh.px
          : (lh as { multiplier: number }).multiplier * size
    const glyph = size * 0.5
    const text = t.runs.map((r) => r.text).join("")
    const lines: number[] = []
    for (const para of text.split("\n")) {
      if (maxWidth === undefined) {
        lines.push(para.length * glyph)
        continue
      }
      let line = ""
      for (const word of para.split(" ")) {
        const next = line ? `${line} ${word}` : word
        if (line && next.length * glyph > maxWidth) {
          lines.push(line.length * glyph)
          line = word
        } else line = next
      }
      lines.push(line.length * glyph)
    }
    return {
      w: Math.max(0, ...lines),
      h: lines.length * lineH,
      lines: lines.length,
      baseline: size * 0.8,
    }
  },
}

export type NodeSpec = Omit<LayoutNodeData, "order"> & { order?: string }

/** Builds a node table; `order` defaults to the insertion index (so siblings keep spec order). */
export function nodes(spec: Record<string, NodeSpec>): Record<string, LayoutNodeData> {
  const out: Record<string, LayoutNodeData> = {}
  let i = 0
  for (const [id, n] of Object.entries(spec))
    out[id] = { ...n, order: n.order ?? `a${String(i++).padStart(5, "0")}` } as LayoutNodeData
  return out
}

let shared: LayoutEngine | null = null

export async function engine(options?: LayoutEngineOptions): Promise<LayoutEngine> {
  if (!options && shared) return shared
  const e = createLayoutEngine(options)
  await e.init()
  if (!options) shared = e
  return e
}

export function inputFor(
  table: Record<string, LayoutNodeData>,
  header: Partial<ResolveHeader> = {},
  measureText: TextMeasurer = fakeMeasurer,
): LayoutInput {
  const src = nodeSourceFromDocument({ nodes: table as never })
  return {
    nodes: src,
    resolve: createResolver(header as ResolveHeader, src),
    measureText,
  }
}

export interface Laid {
  result: LayoutResult
  get(id: string): NodeLayout
  /** Local box `[x, y, w, h]`. */
  box(id: string): [number, number, number, number]
  /** World box `[x, y, w, h]`. */
  world(id: string): [number, number, number, number]
}

export async function lay(
  spec: Record<string, NodeSpec>,
  header?: Partial<ResolveHeader>,
  options?: LayoutEngineOptions,
): Promise<Laid> {
  const e = await engine(options)
  const result = e.compute(inputFor(nodes(spec), header))
  return wrap(result)
}

export function wrap(result: LayoutResult): Laid {
  const get = (id: string) => {
    const l = result.nodes.get(id)
    if (!l) throw new Error(`no layout for ${id}`)
    return l
  }
  const arr = (r: { x: number; y: number; w: number; h: number }) =>
    [r.x, r.y, r.w, r.h] as [number, number, number, number]
  return {
    result,
    get,
    box: (id) => arr(get(id).local),
    world: (id) => arr(get(id).world),
  }
}

/** Comparable projection of a result (everything but `version` and `changed`). */
export function snapshot(r: LayoutResult) {
  return {
    order: [...r.order],
    bounds: r.bounds,
    issues: r.issues.map((i) => `${i.nodeId} ${i.code} ${i.path ?? ""} ${i.message}`),
    nodes: [...r.nodes.values()]
      .map((n) => ({ ...n, transform: [...n.transform] }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  }
}
