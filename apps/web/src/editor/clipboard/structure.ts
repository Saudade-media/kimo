/**
 * Board 27 §2 structure commands as pure op builders (rules F1FPb, notes cRE9Q): duplicate
 * (+16/+16, repeat keeps the last delta; auto-layout children → next sibling), group (a real
 * `group` node), wrap in frame, ungroup (groups and plain frames), add / remove auto layout,
 * bring to front / send to back, select all / inverse, copy / paste properties.
 */
import { generateId, type NodeData, type Op } from "@kimo/editor-state"
import type { LayoutResult, Rect } from "@kimo/layout"
import {
  type DocReader,
  groupOps,
  isFlowChild,
  pathOf,
  toLocal,
  topLevel,
} from "../../canvas/commands"
import { round2, unionRects } from "../../canvas/math"

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/** Duplicate offset of free nodes (rules: "+16/+16"). */
export const DUPLICATE_OFFSET = { x: 16, y: 16 } as const

const TREE_KEYS = new Set(["parent", "order", "at"])
const bodyOf = (n: NodeData): Record<string, unknown> =>
  Object.fromEntries(Object.entries(n).filter(([k]) => !TREE_KEYS.has(k)))

/** True for a main component (or a node inside one) or an instance (structure items disabled). */
export function isMainOrInstance(doc: DocReader, id: string): boolean {
  const n = doc.getNode(id)
  if (!n) return false
  return n.type === "instance" || (n.component !== undefined && n.component !== false)
}

/** True when `id` sits inside an instance (instance-owned or below one). */
export function insideInstance(doc: DocReader, id: string): boolean {
  return pathOf(doc, id)
    .slice(0, -1)
    .some((a) => doc.getNode(a)?.type === "instance")
}

// --- Duplicate --------------------------------------------------------------------------------

export interface DuplicateResult {
  ops: Op[]
  /** New top-level ids, in input order. */
  created: string[]
  /** Source → copy (top-level). */
  pairs: [string, string][]
}

/**
 * Copies each top-level selected subtree. Free nodes (roots included) land `delta` away
 * (default +16/+16); flow children of an auto-layout parent are inserted right after the
 * original. Instance-owned nodes keep their `at`.
 */
export function duplicateNodesOps(
  doc: DocReader,
  ids: readonly string[],
  delta: { x: number; y: number } = DUPLICATE_OFFSET,
  newId: () => string = () => generateId(),
): DuplicateResult {
  const ops: Op[] = []
  const created: string[] = []
  const pairs: [string, string][] = []
  const copyKids = (src: string, dst: string) => {
    const n = doc.getNode(src)
    const ats: (string | null)[] = [null]
    if (n?.type === "instance" && isObj(n.overrides))
      for (const [k, v] of Object.entries(n.overrides))
        if (isObj(v) && (v.slot === true || v.replace === true)) ats.push(k)
    for (const at of ats) {
      for (const c of doc.children(src, at)) {
        const cn = doc.getNode(c)
        if (!cn) continue
        const cid = newId()
        const op: Op = { op: "insert", id: cid, parent: dst, node: bodyOf(cn) }
        if (at !== null) (op as { at?: string }).at = at
        ops.push(op)
        copyKids(c, cid)
      }
    }
  }
  for (const id of topLevel(doc, ids)) {
    const n = doc.getNode(id)
    if (!n) continue
    const parent = typeof n.parent === "string" ? n.parent : null
    const body = bodyOf(n)
    if (!isFlowChild(doc, id)) {
      body.x = round2((num(n.x) ?? 0) + delta.x)
      body.y = round2((num(n.y) ?? 0) + delta.y)
    }
    const at = typeof n.at === "string" ? n.at : null
    const siblings = doc.children(parent, at)
    const copy = newId()
    const insert: Op = {
      op: "insert",
      id: copy,
      parent,
      index: siblings.indexOf(id) + 1,
      node: body,
    }
    if (at !== null) (insert as { at?: string }).at = at
    ops.push(insert)
    created.push(copy)
    pairs.push([id, copy])
    copyKids(id, copy)
  }
  return { ops, created, pairs }
}

/**
 * The delta of a repeated ⌘D: when the selection is exactly the copies of the last duplicate
 * and they were moved, the offset between each copy and its source (the same for all), else
 * the default +16/+16.
 */
export function repeatDelta(
  doc: DocReader,
  last: { pairs: readonly [string, string][] } | null,
  selection: readonly string[],
): { x: number; y: number } {
  if (!last || last.pairs.length !== selection.length) return DUPLICATE_OFFSET
  const copies = new Set(last.pairs.map(([, c]) => c))
  if (!selection.every((id) => copies.has(id))) return DUPLICATE_OFFSET
  let d: { x: number; y: number } | null = null
  for (const [src, copy] of last.pairs) {
    const a = doc.getNode(src)
    const b = doc.getNode(copy)
    if (!a || !b || a.parent !== b.parent) return DUPLICATE_OFFSET
    const dx = (num(b.x) ?? 0) - (num(a.x) ?? 0)
    const dy = (num(b.y) ?? 0) - (num(a.y) ?? 0)
    if (d && (Math.abs(d.x - dx) > 0.01 || Math.abs(d.y - dy) > 0.01)) return DUPLICATE_OFFSET
    d = { x: dx, y: dy }
  }
  return d && (d.x !== 0 || d.y !== 0) ? d : DUPLICATE_OFFSET
}

// --- Group / wrap / ungroup -----------------------------------------------------------------

/** The selection's common parent, or undefined when the selection spans parents / is invalid. */
function commonParent(doc: DocReader, sel: readonly string[]): string | null | undefined {
  const first = doc.getNode(sel[0] as string)
  if (!first) return undefined
  const parent = typeof first.parent === "string" ? first.parent : null
  if (sel.some((id) => doc.getNode(id)?.parent !== parent || doc.getNode(id)?.at !== undefined))
    return undefined
  if (parent && doc.getNode(parent)?.type === "instance") return undefined
  return parent
}

/**
 * ⌘G: a real `group` node (no fill, no layout) around the selection, which must share one
 * parent. The group takes the topmost node's place; children keep their world boxes (sizes an
 * auto-layout parent gave them are frozen, as Wrap in frame does).
 */
export function groupNodesOps(
  doc: DocReader,
  layout: LayoutResult,
  ids: readonly string[],
  groupId: string = generateId(),
): Op[] | null {
  const sel = topLevel(doc, ids)
  if (!sel.length) return null
  const parent = commonParent(doc, sel)
  if (parent === undefined) return null
  // Reuse Wrap in frame's child placement, then turn the frame into a group.
  const ops = groupOps(doc, layout, sel, groupId)
  if (!ops) return null
  const first = ops[0]
  if (first?.op !== "insert") return null
  const node = { ...(first.node as Record<string, unknown>) }
  delete node.w
  delete node.h
  node.type = "group"
  node.name = nextGroupName(doc)
  return [{ ...first, node }, ...ops.slice(1)]
}

function nextGroupName(doc: DocReader): string {
  let max = 0
  for (const id of doc.nodeIds()) {
    const m = /^Group (\d+)$/.exec(String(doc.getNode(id)?.name ?? ""))
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `Group ${max + 1}`
}

/**
 * ⌥⌘G Wrap in frame: a frame sized to the selection bounds, keeping absolute positions; it takes
 * the parent's (auto-layout) slot of the first selected node.
 */
export function wrapInFrameOps(
  doc: DocReader,
  layout: LayoutResult,
  ids: readonly string[],
  frameId: string = generateId(),
): Op[] | null {
  const sel = topLevel(doc, ids)
  if (!sel.length) return null
  const parent = commonParent(doc, sel)
  if (parent === undefined) return null
  const ops = groupOps(doc, layout, sel, frameId)
  if (!ops) return null
  const first = ops[0]
  if (first?.op !== "insert") return null
  const siblings = doc.children(parent)
  const at = siblings.indexOf(sel[0] as string)
  return [{ ...first, index: at < 0 ? first.index : at }, ...ops.slice(1)]
}

const PAINT_KEYS = ["fill", "stroke", "effects"] as const

/** A frame Ungroup accepts: no fill, stroke, effects, clip or layout; not a main / instance. */
export function isPlainFrame(n: NodeData | undefined): boolean {
  if (n?.type !== "frame") return false
  if (n.component !== undefined && n.component !== false) return false
  if (n.layout !== undefined || (n.clip !== undefined && n.clip !== false)) return false
  for (const k of PAINT_KEYS) {
    const v = n[k]
    if (v === undefined) continue
    if (Array.isArray(v) && v.length === 0) continue
    return false
  }
  return true
}

/** True when ⇧⌘G applies to `id` (a group or a plain frame with children). */
export function canUngroup(doc: DocReader, id: string): boolean {
  const n = doc.getNode(id)
  if (!n || insideInstance(doc, id)) return false
  return (n.type === "group" || isPlainFrame(n)) && doc.children(id).length > 0
}

/**
 * ⇧⌘G: moves the children of every selected group / plain frame to its parent, at its place,
 * keeping their on-canvas position, and deletes the container. Returns the freed children.
 */
export function ungroupOps(
  doc: DocReader,
  layout: LayoutResult,
  ids: readonly string[],
): { ops: Op[]; freed: string[] } | null {
  const targets = topLevel(doc, ids).filter((id) => canUngroup(doc, id))
  if (!targets.length) return null
  const ops: Op[] = []
  const freed: string[] = []
  for (const g of targets) {
    const n = doc.getNode(g) as NodeData
    const parent = typeof n.parent === "string" ? n.parent : null
    const siblings = doc.children(parent)
    let index = siblings.indexOf(g)
    const parentFlows = !!parent && isObj(doc.getNode(parent)?.layout) && n.position !== "absolute"
    for (const c of doc.children(g)) {
      const l = layout.nodes.get(c)
      const cn = doc.getNode(c)
      if (!cn) continue
      ops.push({ op: "move", id: c, parent, index: ++index })
      if (!parentFlows && l) {
        // The child's laid-out world box in the new parent's space.
        const flow = isFlowChild(doc, c)
        const ox = flow ? 0 : l.local.x - (num(cn.x) ?? 0)
        const oy = flow ? 0 : l.local.y - (num(cn.y) ?? 0)
        const tl = toLocal(layout, parent, { x: l.world.x, y: l.world.y })
        const set: Record<string, unknown> = { x: round2(tl.x - ox), y: round2(tl.y - oy) }
        if (flow) {
          for (const axis of ["w", "h"] as const)
            if (typeof cn[axis] !== "number")
              set[axis] = round2(axis === "w" ? l.local.w : l.local.h)
        }
        ops.push({ op: "update", id: c, set })
      }
      freed.push(c)
    }
    ops.push({ op: "delete", id: g })
  }
  return { ops, freed }
}

// --- Auto layout ------------------------------------------------------------------------------

/**
 * ⌥⇧A Remove auto layout: the frame keeps its size, each flowing child is frozen at its current
 * x/y (and laid-out size where the layout gave it one); layout/gap/padding are cleared.
 */
export function removeAutoLayoutOps(doc: DocReader, layout: LayoutResult, id: string): Op[] {
  const n = doc.getNode(id)
  if (n?.type !== "frame" || !isObj(n.layout)) return []
  const box = layout.nodes.get(id)?.local
  const ops: Op[] = []
  const set: Record<string, unknown> = {}
  if (box) {
    if (typeof n.w !== "number") set.w = round2(box.w)
    if (typeof n.h !== "number") set.h = round2(box.h)
  }
  ops.push({ op: "update", id, set, unset: ["layout"] })
  for (const c of doc.children(id)) {
    const cn = doc.getNode(c)
    const l = layout.nodes.get(c)
    if (!cn || !l) continue
    const cset: Record<string, unknown> = {}
    const unset: string[] = []
    if (cn.position === "absolute") unset.push("position")
    else {
      cset.x = round2(l.local.x)
      cset.y = round2(l.local.y)
      for (const axis of ["w", "h"] as const) {
        const v = cn[axis]
        if (isObj(v) && v.mode === "fill") cset[axis] = round2(axis === "w" ? l.local.w : l.local.h)
      }
    }
    ops.push({ op: "update", id: c, set: cset, unset })
  }
  return ops
}

/**
 * ⇧A Add auto layout to a frame without layout: direction from the children's arrangement
 * (wider spread → row), gap = the median space between neighbours, padding = the children's
 * insets; children are reordered by position. The frame keeps its size.
 */
export function addAutoLayoutOps(doc: DocReader, layout: LayoutResult, id: string): Op[] {
  const n = doc.getNode(id)
  if (n?.type !== "frame" || isObj(n.layout)) return []
  const frame = layout.nodes.get(id)?.local
  const kids = doc
    .children(id)
    .map((c) => ({ id: c, box: layout.nodes.get(c)?.local }))
    .filter((k): k is { id: string; box: Rect } => !!k.box)
  if (!frame || kids.length === 0) return [{ op: "update", id, set: { layout: { dir: "column" } } }]
  const u = unionRects(kids.map((k) => k.box)) as Rect
  const dir = u.w >= u.h ? "row" : "column"
  const along = (b: Rect) => (dir === "row" ? b.x : b.y)
  const size = (b: Rect) => (dir === "row" ? b.w : b.h)
  kids.sort((a, b) => along(a.box) - along(b.box))
  const gaps: number[] = []
  for (let i = 1; i < kids.length; i++) {
    const a = kids[i - 1]?.box as Rect
    const b = kids[i]?.box as Rect
    gaps.push(Math.max(0, along(b) - (along(a) + size(a))))
  }
  gaps.sort((a, b) => a - b)
  const gap = gaps.length ? Math.round(gaps[Math.floor(gaps.length / 2)] as number) : 0
  const pad = [
    Math.max(0, Math.round(u.y)),
    Math.max(0, Math.round(frame.w - (u.x + u.w))),
    Math.max(0, Math.round(frame.h - (u.y + u.h))),
    Math.max(0, Math.round(u.x)),
  ]
  const lay: Record<string, unknown> = { dir }
  if (gap) lay.gap = gap
  if (pad.some((p) => p !== 0)) lay.pad = pad.every((p) => p === pad[0]) ? pad[0] : pad
  const ops: Op[] = [{ op: "update", id, set: { layout: lay } }]
  kids.forEach((k, i) => {
    ops.push({ op: "move", id: k.id, parent: id, index: i })
  })
  return ops
}

// --- Z order ----------------------------------------------------------------------------------

/** ⌘] / ⌘[: moves each node to the top (front) or bottom (back) of its siblings. */
export function arrangeOps(doc: DocReader, ids: readonly string[], to: "front" | "back"): Op[] {
  const ops: Op[] = []
  const sel = topLevel(doc, ids).filter((id) => !insideInstance(doc, id))
  const list = to === "back" ? [...sel].reverse() : sel
  for (const id of list) {
    const n = doc.getNode(id)
    if (!n) continue
    const parent = typeof n.parent === "string" ? n.parent : null
    const op: Op = {
      op: "move",
      id,
      parent,
      index: to === "front" ? Number.MAX_SAFE_INTEGER : 0,
    }
    if (typeof n.at === "string") (op as { at?: string }).at = n.at
    ops.push(op)
  }
  return ops
}

// --- Selection --------------------------------------------------------------------------------

/** ⌘A: every sibling of the first selected node (or every root of `roots` when nothing is). */
export function selectAllIds(
  doc: DocReader,
  selection: readonly string[],
  roots: readonly string[],
): string[] {
  const first = selection[0]
  if (first === undefined) return [...roots]
  const n = doc.getNode(first)
  if (!n) return [...roots]
  if (n.parent === null) return [...roots]
  return doc.children(n.parent, typeof n.at === "string" ? n.at : null).slice()
}

/** ⇧⌘A: the siblings of the selection that are not selected. */
export function selectInverseIds(
  doc: DocReader,
  selection: readonly string[],
  roots: readonly string[],
): string[] {
  const set = new Set(selection)
  return selectAllIds(doc, selection, roots).filter((id) => !set.has(id))
}

// --- Copy / paste properties -------------------------------------------------------------------

/** The style keys ⌥⌘C copies (when the source has them). */
const STYLE_KEYS = [
  "fill",
  "stroke",
  "effects",
  "opacity",
  "blend",
  "radius",
  "style",
  "color",
] as const

export type CopiedProperties = Record<string, unknown>

/** ⌥⌘C: the visual properties of `id` (absent ones recorded as null = "unset"). */
export function copyProperties(doc: DocReader, id: string): CopiedProperties | null {
  const n = doc.getNode(id)
  if (!n || n.type === "instance") return null
  const out: CopiedProperties = {}
  for (const k of STYLE_KEYS) out[k] = n[k] === undefined ? null : structuredClone(n[k])
  return out
}

/** ⌥⌘V: applies copied properties to every selected node that has those fields. */
export function pastePropertiesOps(
  doc: DocReader,
  ids: readonly string[],
  props: CopiedProperties,
  keysOf: (type: string) => ReadonlySet<string>,
): Op[] {
  const ops: Op[] = []
  for (const id of topLevel(doc, ids)) {
    const n = doc.getNode(id)
    if (!n || n.type === "instance" || insideInstance(doc, id)) continue
    const keys = keysOf(n.type)
    const set: Record<string, unknown> = {}
    const unset: string[] = []
    for (const [k, v] of Object.entries(props)) {
      if (!keys.has(k)) continue
      if (v === null) {
        if (n[k] !== undefined) unset.push(k)
      } else set[k] = structuredClone(v)
    }
    if (Object.keys(set).length || unset.length) ops.push({ op: "update", id, set, unset })
  }
  return ops
}
