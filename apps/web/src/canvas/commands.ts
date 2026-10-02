/**
 * Canvas edits as op builders (pure: they read the store + layout and return `Op[]`, never
 * apply). The host applies each list as one undo step (or through a {@link Gesture}).
 */
import { type DocStore, generateId, type NodeData, type Op } from "@kimo/editor-state"
import type { LayoutResult, Rect } from "@kimo/layout"
import type { Point } from "@kimo/renderer"
import { applyLinear, IDENTITY, invert, mapBox, round2, unionRects } from "./math"

/** Read access the builders need (a `DocStore` satisfies it). */
export type DocReader = Pick<DocStore, "getNode" | "children" | "hasNode" | "nodeIds">

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined

/** True when `id` flows inside an auto-layout parent (its x/y are computed, not stored). */
export function isFlowChild(doc: DocReader, id: string): boolean {
  const n = doc.getNode(id)
  if (!n || typeof n.parent !== "string" || n.position === "absolute") return false
  const p = doc.getNode(n.parent)
  return !!p && p.type !== "instance" && typeof p.layout === "object" && p.layout !== null
}

/** True when a node can be dragged / nudged in M1 (free position, not locked). */
export function canMove(doc: DocReader, id: string): boolean {
  const n = doc.getNode(id)
  return !!n && n.locked !== true && !isFlowChild(doc, id)
}

/** Ancestors of `id`, root first, `id` last. */
export function pathOf(doc: DocReader, id: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  let cur: string | null = id
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    out.unshift(cur)
    const p: unknown = doc.getNode(cur)?.parent
    cur = typeof p === "string" ? p : null
  }
  return out
}

/** Drops ids whose ancestor is also in the list (keeps the list order). */
export function topLevel(doc: DocReader, ids: readonly string[]): string[] {
  const set = new Set(ids)
  return ids.filter(
    (id) =>
      doc.hasNode(id) &&
      !pathOf(doc, id)
        .slice(0, -1)
        .some((a) => set.has(a)),
  )
}

/** World → parent-local delta for a node (parent rotation/flip undone). */
function toParentDelta(layout: LayoutResult, parent: unknown, d: Point): Point {
  const t = typeof parent === "string" ? layout.nodes.get(parent)?.transform : undefined
  return applyLinear(invert(t ?? IDENTITY), d)
}

// --- Move / nudge -------------------------------------------------------------------------

/** Start state of a move gesture. */
export interface MoveStart {
  id: string
  x: number
  y: number
}

export function moveStart(doc: DocReader, ids: readonly string[]): MoveStart[] {
  return topLevel(doc, ids)
    .filter((id) => canMove(doc, id))
    .map((id) => {
      const n = doc.getNode(id) as NodeData
      return { id, x: num(n.x) ?? 0, y: num(n.y) ?? 0 }
    })
}

/** Ops moving every started node by a world-space delta. */
export function moveOps(
  doc: DocReader,
  layout: LayoutResult,
  start: readonly MoveStart[],
  d: Point,
): Op[] {
  const ops: Op[] = []
  for (const s of start) {
    const n = doc.getNode(s.id)
    if (!n) continue
    const l = toParentDelta(layout, n.parent, d)
    ops.push({ op: "update", id: s.id, set: { x: round2(s.x + l.x), y: round2(s.y + l.y) } })
  }
  return ops
}

// --- Resize -------------------------------------------------------------------------------

export interface ResizeItem {
  id: string
  /** World box at gesture start. */
  world: Rect
  /** Local box at gesture start. */
  local: Rect
  /** Stored x/y at gesture start (local.x minus any group offset). */
  x: number
  y: number
  flow: boolean
}

export interface ResizeStart {
  box: Rect
  items: ResizeItem[]
}

/**
 * Snapshot for a resize gesture. Groups and rotated nodes are skipped in M1 (groups take their
 * size from children; rotated resizing needs local-axis handles).
 */
export function resizeStart(
  doc: DocReader,
  layout: LayoutResult,
  ids: readonly string[],
): ResizeStart | null {
  const items: ResizeItem[] = []
  for (const id of topLevel(doc, ids)) {
    const n = doc.getNode(id)
    const l = layout.nodes.get(id)
    if (!n || !l || n.locked === true) continue
    if (n.type === "group" || n.type === "instance" || num(n.rotation)) continue
    items.push({
      id,
      world: l.world,
      local: l.local,
      x: num(n.x) ?? 0,
      y: num(n.y) ?? 0,
      flow: isFlowChild(doc, id),
    })
  }
  const box = unionRects(items.map((i) => i.world))
  return box ? { box, items } : null
}

/** Ops resizing the started nodes so their union box becomes `to`. */
export function resizeOps(
  doc: DocReader,
  layout: LayoutResult,
  start: ResizeStart,
  to: Rect,
): Op[] {
  const ops: Op[] = []
  const sx = start.box.w ? to.w / start.box.w : 1
  const sy = start.box.h ? to.h / start.box.h : 1
  for (const it of start.items) {
    const n = doc.getNode(it.id)
    if (!n) continue
    const nb = mapBox(it.world, start.box, to)
    const set: Record<string, unknown> = {}
    const w = round2(Math.max(1, it.local.w * sx))
    const h = round2(Math.max(1, it.local.h * sy))
    const changeW = Math.abs(sx - 1) > 1e-9
    const changeH = Math.abs(sy - 1) > 1e-9
    if (changeW) set.w = w
    if (changeH) set.h = h
    if (n.type === "text") {
      const grow = n.grow ?? "auto"
      if (changeH || grow === "fixed") {
        set.grow = "fixed"
        set.w = w
        set.h = h
      } else if (changeW) set.grow = "fixed-width"
    }
    if (!it.flow) {
      const d = toParentDelta(layout, n.parent, { x: nb.x - it.world.x, y: nb.y - it.world.y })
      if (Math.abs(d.x) > 1e-9) set.x = round2(it.x + d.x)
      if (Math.abs(d.y) > 1e-9) set.y = round2(it.y + d.y)
    }
    if (Object.keys(set).length) ops.push({ op: "update", id: it.id, set })
  }
  return ops
}

// --- Create -------------------------------------------------------------------------------

export type ShapeKind = "frame" | "rect" | "ellipse"

/** Kinds that get "Name N" names. */
export type NameKind = ShapeKind | "text" | "path" | "image"

const SHAPE_NAME: Record<NameKind, string> = {
  frame: "Frame",
  rect: "Rectangle",
  ellipse: "Ellipse",
  text: "Text",
  path: "Path",
  image: "Image",
}

/**
 * Default fills (the design specifies none for new shapes): frames are white artboards, shapes
 * a neutral grey that reads on both canvas modes.
 */
export const SHAPE_FILL: Record<ShapeKind, string> = {
  frame: "#FFFFFF",
  rect: "#D9D9D9",
  ellipse: "#D9D9D9",
}

/** Next free "Rectangle 3"-style name. */
export function nextName(doc: DocReader, kind: NameKind): string {
  const base = SHAPE_NAME[kind]
  const re = new RegExp(`^${base} (\\d+)$`)
  let max = 0
  for (const id of doc.nodeIds()) {
    const m = re.exec(String(doc.getNode(id)?.name ?? ""))
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `${base} ${max + 1}`
}

/**
 * The container a new node drops into at world point `p`: the deepest frame under the
 * point that is not an auto-layout frame and not inside an instance (hits are top-most first).
 */
export function dropParent(doc: DocReader, hits: readonly string[]): string | null {
  for (const id of hits) {
    const path = pathOf(doc, id)
    for (let i = path.length - 1; i >= 0; i--) {
      const n = doc.getNode(path[i] as string)
      if (n?.type !== "frame" || n.layout || n.locked === true) continue
      if (path.slice(0, i).some((a) => doc.getNode(a)?.type === "instance")) continue
      return path[i] as string
    }
  }
  return null
}

/** World point → a parent's local space. */
export function toLocal(layout: LayoutResult, parent: string | null, p: Point): Point {
  if (!parent) return p
  const t = layout.nodes.get(parent)?.transform ?? IDENTITY
  const inv = invert(t)
  return { x: inv[0] * p.x + inv[2] * p.y + inv[4], y: inv[1] * p.x + inv[3] * p.y + inv[5] }
}

/** Insert op for a shape covering world rect `r` in `parent`. */
export function createShapeOp(
  doc: DocReader,
  layout: LayoutResult,
  kind: ShapeKind,
  parent: string | null,
  r: Rect,
  id: string,
  name = nextName(doc, kind),
): Op {
  const tl = toLocal(layout, parent, r)
  const node: Record<string, unknown> = {
    type: kind,
    name,
    x: round2(tl.x),
    y: round2(tl.y),
    w: round2(Math.max(1, r.w)),
    h: round2(Math.max(1, r.h)),
    fill: SHAPE_FILL[kind],
  }
  return { op: "insert", id, parent, node }
}

// --- M2: pen paths, images, icons ---------------------------------------------------------

/** Variable that paints text without a fill (spec §5.5); reused for the pen's default stroke. */
const TEXT_DEFAULT = "text/default"

/**
 * Insert op for a pen contour (ADR 0010 commit rule): `fields` from `pathGeometry.toNode`
 * (already in the parent's space), a 1px centered stroke in `text/default` when the document
 * declares it (else #000000); closed contours get the shape fill, open ones none.
 */
export function createPathOp(
  doc: DocReader,
  parent: string | null,
  fields: { x: number; y: number; w: number; h: number; d: string; viewBox: readonly number[] },
  closed: boolean,
  hasTextDefault: boolean,
  id: string = generateId(),
): Op {
  const node: Record<string, unknown> = {
    type: "path",
    name: nextName(doc, "path"),
    x: fields.x,
    y: fields.y,
    w: fields.w,
    h: fields.h,
    d: fields.d,
    viewBox: [...fields.viewBox],
    stroke: {
      paint: hasTextDefault ? { $ref: TEXT_DEFAULT } : "#000000",
      width: 1,
      align: "center",
    },
  }
  if (closed) node.fill = SHAPE_FILL.rect
  return { op: "insert", id, parent, node }
}

/** Insert op for an image placed as a frame with an image fill (cover) covering world `r`. */
export function createImageFrameOp(
  doc: DocReader,
  layout: LayoutResult,
  parent: string | null,
  r: Rect,
  src: string,
  id: string = generateId(),
): Op {
  const tl = toLocal(layout, parent, r)
  return {
    op: "insert",
    id,
    parent,
    node: {
      type: "frame",
      name: nextName(doc, "image"),
      x: round2(tl.x),
      y: round2(tl.y),
      w: round2(Math.max(1, r.w)),
      h: round2(Math.max(1, r.h)),
      fill: { kind: "image", src, fit: "cover" },
    },
  }
}

/** Insert op for an icon node centered on world point `c`. */
export function createIconOp(
  layout: LayoutResult,
  parent: string | null,
  c: Point,
  icon: { set: string; name: string; weight?: number; strokeWidth?: number; size?: number },
  id: string = generateId(),
): Op {
  const size = icon.size ?? 24
  const tl = toLocal(layout, parent, { x: c.x - size / 2, y: c.y - size / 2 })
  const node: Record<string, unknown> = {
    type: "icon",
    name: icon.name,
    x: round2(tl.x),
    y: round2(tl.y),
    w: size,
    h: size,
    set: icon.set,
    icon: icon.name,
  }
  if (icon.weight !== undefined) node.weight = icon.weight
  if (icon.strokeWidth !== undefined) node.strokeWidth = icon.strokeWidth
  return { op: "insert", id, parent, node }
}

/** Default text style for new text (reader default family/size from ADR 0009). */
export const NEW_TEXT_STYLE = { font: "Inter", size: 16 } as const

export function createTextOp(
  doc: DocReader,
  layout: LayoutResult,
  parent: string | null,
  at: Point,
  content: string,
  id = generateId(),
): Op {
  const tl = toLocal(layout, parent, at)
  return {
    op: "insert",
    id,
    parent,
    node: {
      type: "text",
      name: nextName(doc, "text"),
      x: round2(tl.x),
      y: round2(tl.y),
      content,
      style: { ...NEW_TEXT_STYLE },
    },
  }
}

// --- Delete / duplicate / group -------------------------------------------------------------

export function deleteOps(doc: DocReader, ids: readonly string[]): Op[] {
  return topLevel(doc, ids)
    .filter((id) => doc.getNode(id)?.locked !== true)
    .map((id) => ({ op: "delete" as const, id }))
}

const TREE_KEYS = new Set(["parent", "order", "at"])
const bodyOf = (n: NodeData): Record<string, unknown> =>
  Object.fromEntries(Object.entries(n).filter(([k]) => !TREE_KEYS.has(k)))

/**
 * Duplicates each top-level selected subtree: root nodes land to the right (32 = the gap
 * between the board 03 artboards), free children +10/+10, flow children right after the original.
 * Returns the ops and the new top-level ids (in input order).
 */
export function duplicateOps(
  doc: DocReader,
  layout: LayoutResult,
  ids: readonly string[],
  newId: () => string = () => generateId(),
): { ops: Op[]; created: string[] } {
  const ops: Op[] = []
  const created: string[] = []
  for (const id of topLevel(doc, ids)) {
    const n = doc.getNode(id)
    if (!n) continue
    const parent = typeof n.parent === "string" ? n.parent : null
    const body = bodyOf(n)
    if (!isFlowChild(doc, id)) {
      if (parent === null) {
        const w = layout.nodes.get(id)?.local.w ?? 0
        body.x = round2((num(n.x) ?? 0) + w + 32)
      } else {
        body.x = round2((num(n.x) ?? 0) + 10)
        body.y = round2((num(n.y) ?? 0) + 10)
      }
    }
    const siblings = doc.children(parent, typeof n.at === "string" ? n.at : null)
    const copy = newId()
    const insert: Op = {
      op: "insert",
      id: copy,
      parent,
      index: siblings.indexOf(id) + 1,
      node: body,
    }
    if (typeof n.at === "string") (insert as { at?: string }).at = n.at
    ops.push(insert)
    created.push(copy)
    const walk = (src: string, dst: string) => {
      for (const c of doc.children(src)) {
        const cn = doc.getNode(c)
        if (!cn) continue
        const cid = newId()
        ops.push({ op: "insert", id: cid, parent: dst, node: bodyOf(cn) })
        walk(c, cid)
      }
    }
    walk(id, copy)
  }
  return { ops, created }
}

/**
 * Wraps the selection in a new frame sized to its union box (⌘G "frame selection"). All
 * selected nodes must share one parent. The frame takes the topmost node's place; children keep
 * their world boxes (x/y relative to the frame; sizes an auto-layout parent gave them, fill or
 * stretch, are frozen to their laid-out values) in their original sibling order.
 */
export function groupOps(
  doc: DocReader,
  layout: LayoutResult,
  ids: readonly string[],
  frameId: string = generateId(),
): Op[] | null {
  const sel = topLevel(doc, ids)
  if (!sel.length) return null
  const first = doc.getNode(sel[0] as string)
  if (!first) return null
  const parent = typeof first.parent === "string" ? first.parent : null
  if (sel.some((id) => doc.getNode(id)?.parent !== parent || doc.getNode(id)?.at !== undefined))
    return null
  if (parent && doc.getNode(parent)?.type === "instance") return null
  const siblings = doc.children(parent)
  const ordered = siblings.filter((s) => sel.includes(s))
  const boxes = ordered.map((id) => layout.nodes.get(id)?.world).filter((b): b is Rect => !!b)
  const world = unionRects(boxes)
  if (!world) return null
  const topIndex = Math.max(...ordered.map((id) => siblings.indexOf(id)))
  const tl = toLocal(layout, parent, world)
  const ops: Op[] = [
    {
      op: "insert",
      id: frameId,
      parent,
      index: topIndex + 1,
      node: {
        type: "frame",
        name: nextName(doc, "frame"),
        x: round2(tl.x),
        y: round2(tl.y),
        w: round2(world.w),
        h: round2(world.h),
      },
    },
  ]
  const parentLayout = parent ? doc.getNode(parent)?.layout : undefined
  const stretch =
    typeof parentLayout === "object" &&
    parentLayout !== null &&
    (parentLayout as { align?: unknown }).align === "stretch"
  const crossAxis =
    typeof parentLayout === "object" &&
    parentLayout !== null &&
    (parentLayout as { dir?: unknown }).dir === "column"
      ? "w"
      : "h"
  for (const id of ordered) {
    const l = layout.nodes.get(id)
    const n = doc.getNode(id)
    if (!l || !n) continue
    const flow = isFlowChild(doc, id)
    // Offset between the stored x/y and the laid-out local box (groups: content origin).
    const ox = l.local.x - (flow ? l.local.x : (num(n.x) ?? 0))
    const oy = l.local.y - (flow ? l.local.y : (num(n.y) ?? 0))
    const set: Record<string, unknown> = {
      x: round2(l.world.x - world.x - ox),
      y: round2(l.world.y - world.y - oy),
    }
    // The new frame has no auto layout: sizes the flow parent gave (fill, stretch) would
    // collapse to their content, so freeze them at the laid-out size.
    if (flow) {
      for (const axis of ["w", "h"] as const) {
        const v = n[axis]
        const filled =
          typeof v === "object" && v !== null && (v as { mode?: unknown }).mode === "fill"
        const stretched = stretch && axis === crossAxis && typeof v !== "number"
        if (filled || stretched) set[axis] = round2(axis === "w" ? l.local.w : l.local.h)
      }
    }
    ops.push({ op: "move", id, parent: frameId })
    ops.push({ op: "update", id, set })
  }
  return ops
}

/** Arrow-key nudge (1 or 10 world units). */
export function nudgeOps(
  doc: DocReader,
  layout: LayoutResult,
  ids: readonly string[],
  dx: number,
  dy: number,
): Op[] {
  return moveOps(doc, layout, moveStart(doc, ids), { x: dx, y: dy })
}
