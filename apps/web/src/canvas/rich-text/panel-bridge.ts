/**
 * Board 30 "Rich text": how the Design tab's Text and Fill sections act on character ranges.
 *
 * The sections read nodes and write `update` ops; they don't know about spans. This bridge
 * hands them VIRTUAL selections instead — one per distinct attribute set in the target range —
 * whose `node` is the text node with that set as its own `style` / `fill`. The sections' usual
 * "shared value or Mixed" logic then shows the range's values, and their ops are translated
 * back into attribute patches on exactly those characters:
 *
 * - while editing: the editor's selection (a collapsed caret = the typing attributes); the
 *   patch goes to the live session (committed with the text edit, one undo step);
 * - not editing, a text with runs selected: the whole text; the patch is written to the document
 *   at once (canonical runs, `text/runs` declared when spans remain).
 *
 * Virtual ids are `<nodeId>~<a>-<b>[,<a>-<b>…]` (the character ranges of the group), so a
 * translation never depends on a stale snapshot. Ops on anything else pass through unchanged.
 */
import type { NodeData, Op } from "@kimo/editor-state"
import {
  type AttrGroup,
  type AttrPatch,
  applyAttrs,
  groupsIn,
  lengthOf,
  patchFromEdit,
  type Run,
  runsOf,
  toNodePatch,
  virtualNode,
} from "./model"
import type { RichTextSession } from "./session"

type Obj = Record<string, unknown>

export interface SelLike {
  id: string
  node: NodeData
}

const SEP = "~"

function virtualId(nodeId: string, ranges: readonly [number, number][]): string {
  return `${nodeId}${SEP}${ranges.map(([a, b]) => `${a}-${b}`).join(",")}`
}

/** The real node id and ranges of a virtual id (null for a plain id). */
function parseVirtualId(id: string): { nodeId: string; ranges: [number, number][] } | null {
  const i = id.lastIndexOf(SEP)
  if (i < 0) return null
  const ranges = id
    .slice(i + 1)
    .split(",")
    .map((r) => r.split("-").map(Number) as [number, number])
  if (ranges.some(([a, b]) => !Number.isFinite(a) || !Number.isFinite(b))) return null
  return { nodeId: id.slice(0, i), ranges }
}

/** The real node id behind a (possibly virtual) selection id. */
export const realId = (id: string): string => parseVirtualId(id)?.nodeId ?? id

const hasRuns = (n: NodeData): boolean => Array.isArray(n.content)

function virtualSels(nodeId: string, node: NodeData, groups: readonly AttrGroup[]): SelLike[] {
  return groups.map((g) => ({
    id: virtualId(nodeId, g.ranges),
    node: virtualNode(node, g.attrs) as NodeData,
  }))
}

/**
 * The selection the Text / Fill sections should show. Null when no bridging applies (plain
 * texts, other node types): use the real selection.
 */
export function richSelection(
  sel: readonly SelLike[],
  session: RichTextSession | null,
): SelLike[] | null {
  if (sel.length === 0) return null
  if (session?.rich && session.nodeId && sel.length === 1 && sel[0]?.id === session.nodeId) {
    const s = sel[0]
    return virtualSels(s.id, s.node, session.groups())
  }
  if (!sel.some((s) => s.node.type === "text" && hasRuns(s.node))) return null
  return sel.flatMap((s) => {
    if (s.node.type !== "text" || !hasRuns(s.node)) return [s]
    const runs = runsOf(s.node)
    return virtualSels(s.id, s.node, groupsIn(runs, 0, lengthOf(runs)))
  })
}

/** Ops on one virtual group: its patch, node-level paragraph changes and pass-through ops. */
interface Collected {
  edits: { ranges: [number, number][]; patch: AttrPatch; before: NodeData }[]
  paragraph: Obj
  /** A non-color fill for the whole node (gradients, lists, none). */
  wholeFill?: { value: unknown }
  other: Op[]
}

/**
 * Translates section ops into the session (editing) and/or document ops. Returns the document
 * ops to apply (possibly none, when everything went to the session).
 */
export function translateOps(
  ops: readonly Op[],
  view: readonly SelLike[],
  getNode: (id: string) => NodeData | undefined,
  session: RichTextSession | null,
  features: readonly string[],
): Op[] {
  const byNode = new Map<string, Collected>()
  const out: Op[] = []
  const vnodes = new Map(view.map((s) => [s.id, s.node]))
  for (const op of ops) {
    const id = (op as { id?: unknown }).id
    const v = typeof id === "string" ? parseVirtualId(id) : null
    if (!v || op.op !== "update") {
      out.push(v ? ({ ...op, id: v.nodeId } as Op) : op)
      continue
    }
    const before = vnodes.get(id as string) ?? virtualOf(getNode(v.nodeId), v.ranges)
    if (!before) continue
    const u = op as { set?: Obj; unset?: string[] }
    const c = byNode.get(v.nodeId) ?? { edits: [], paragraph: {}, other: [] }
    byNode.set(v.nodeId, c)
    const { attrs, paragraph, fill } = patchFromEdit(before, u.set, u.unset)
    Object.assign(c.paragraph, paragraph)
    if (fill && fill.value !== undefined && !isColor(fill.value)) {
      c.wholeFill = fill
      delete attrs.fill
    }
    if (Object.keys(attrs).length) c.edits.push({ ranges: v.ranges, patch: attrs, before })
    // Fields outside style / fill (grow, w, h, content binding): the node itself.
    const rest: Obj = {}
    for (const [k, x] of Object.entries(u.set ?? {})) if (k !== "style" && k !== "fill") rest[k] = x
    const restUnset = (u.unset ?? []).filter((k) => k !== "style" && k !== "fill")
    if (Object.keys(rest).length || restUnset.length)
      c.other.push({
        op: "update",
        id: v.nodeId,
        ...(Object.keys(rest).length ? { set: rest } : {}),
        ...(restUnset.length ? { unset: restUnset } : {}),
      } as Op)
  }
  let needRuns = false
  for (const [nodeId, c] of byNode) {
    const node = getNode(nodeId)
    if (!node) continue
    const editing = session?.rich && session.nodeId === nodeId
    if (editing && session) {
      if (c.edits.length) session.applyRanges(c.edits)
      if (c.wholeFill) {
        // A paint a span can't hold: the node's fill, and no span keeps its own color.
        session.applyRanges([{ ranges: [[0, session.length]], patch: { fill: c.wholeFill.value } }])
      }
      // A live edit wrote the range change already (it may move attributes onto the node).
      const style = paragraphStyle(nodeId, getNode(nodeId) ?? node, c.paragraph)
      if (style) out.push(style)
      out.push(...c.other)
      continue
    }
    let runs: Run[] = runsOf(node)
    for (const e of c.edits) for (const [a, b] of e.ranges) runs = applyAttrs(runs, a, b, e.patch)
    if (c.wholeFill) runs = applyAttrs(runs, 0, lengthOf(runs), { fill: c.wholeFill.value })
    const base = { ...node, style: withParagraph(node, c.paragraph) }
    const p = toNodePatch(runs, base)
    needRuns ||= p.runs
    const set: Obj = { content: p.content }
    const unset: string[] = []
    if (p.style) set.style = p.style
    else unset.push("style")
    if (p.fill !== undefined) set.fill = p.fill
    else unset.push("fill")
    out.push({ op: "update", id: nodeId, set, ...(unset.length ? { unset } : {}) } as Op)
    out.push(...c.other)
  }
  if (needRuns && !features.includes("text/runs"))
    out.unshift({ op: "setHeader", set: { features: [...features, "text/runs"].sort() } } as Op)
  return out
}

function virtualOf(node: NodeData | undefined, ranges: [number, number][]): NodeData | undefined {
  if (!node) return undefined
  const runs = runsOf(node)
  const [a, b] = ranges[0] ?? [0, 0]
  const g = groupsIn(runs, a, Math.max(b, a))[0]
  return g ? (virtualNode(node, g.attrs) as NodeData) : node
}

const isColor = (v: unknown): boolean =>
  typeof v === "string" ||
  (typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    (typeof (v as Obj).$ref === "string" ||
      (v as Obj).space === "oklch" ||
      (v as Obj).space === "display-p3"))

function withParagraph(node: NodeData, paragraph: Obj): Obj | undefined {
  const style: Obj =
    typeof node.style === "object" && node.style !== null ? { ...(node.style as Obj) } : {}
  for (const [k, v] of Object.entries(paragraph)) {
    if (v === undefined) delete style[k]
    else style[k] = v
  }
  return Object.keys(style).length ? style : undefined
}

function paragraphStyle(id: string, node: NodeData, paragraph: Obj): Op | null {
  if (!Object.keys(paragraph).length) return null
  const style = withParagraph(node, paragraph)
  return style
    ? ({ op: "update", id, set: { style } } as Op)
    : ({ op: "update", id, unset: ["style"] } as Op)
}
