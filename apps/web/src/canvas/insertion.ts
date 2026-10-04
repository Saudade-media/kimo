/**
 * Board 27 §2 (c2o3u, Y4vVe): slot math for inserting into an auto-layout frame. Pure: world
 * rects in, world rects out.
 *
 * - {@link slotIndex}: the slot the pointer picks along the main axis. It finds the flow child
 *   nearest the pointer and takes the gap before or after it, so wrapped rows work too.
 * - {@link slotBar}: the InsertionBar (OGqUu horizontal / sKpaJ vertical) in world space. It is
 *   centred in the gap between the two neighbours (half a gap outside the first or last child),
 *   and it spans the content box on the cross axis, or the neighbour's line when the frame wraps.
 * - {@link flowSiblingIndex}: maps a flow slot to a `MoveOp`/`InsertOp` sibling index, because
 *   absolute children are siblings too.
 */
import type { Rect } from "@kimo/layout"

export type FlowDir = "row" | "column"

export interface FlowChild {
  id: string
  /** World box. */
  box: Rect
}

export interface FlowFrame {
  dir: FlowDir
  /** World content box (frame box minus padding). */
  content: Rect
  gap: number
  wrap?: boolean
  /** Flow children in sibling order (dragged nodes already removed). */
  children: readonly FlowChild[]
}

/** A bar in world space: `axis` "v" = vertical (row layouts), "h" = horizontal (column layouts). */
export interface SlotBar {
  /** Centre line on the main axis; start on the cross axis. */
  x: number
  y: number
  length: number
  axis: "h" | "v"
}

const mainOf = (dir: FlowDir) =>
  dir === "row"
    ? ({ p: "x", s: "w", q: "y", t: "h" } as const)
    : ({ p: "y", s: "h", q: "x", t: "w" } as const)

/** The slot (0…children.length) for world point `p`. */
export function slotIndex(f: FlowFrame, p: { x: number; y: number }): number {
  const kids = f.children
  if (!kids.length) return 0
  const a = mainOf(f.dir)
  let best = 0
  let bestD = Number.POSITIVE_INFINITY
  kids.forEach((c, i) => {
    const cm = c.box[a.p] + c.box[a.s] / 2
    const cc = c.box[a.q] + c.box[a.t] / 2
    // Off the child's line on the cross axis weighs more (wrapped rows pick the right line).
    const dm = Math.abs(p[a.p] - cm)
    const crossOut = Math.max(0, Math.abs(p[a.q] - cc) - c.box[a.t] / 2)
    const d = dm + crossOut * 4
    if (d < bestD) {
      bestD = d
      best = i
    }
  })
  const c = kids[best] as FlowChild
  return p[a.p] < c.box[a.p] + c.box[a.s] / 2 ? best : best + 1
}

/** The InsertionBar for slot `index` (world space). */
export function slotBar(f: FlowFrame, index: number): SlotBar {
  const a = mainOf(f.dir)
  const kids = f.children
  const i = Math.max(0, Math.min(kids.length, index))
  const prev = kids[i - 1]
  const next = kids[i]
  const half = f.gap > 0 ? f.gap / 2 : 0
  let main: number
  if (prev && next && (!f.wrap || sameLine(f.dir, prev.box, next.box)))
    main = (prev.box[a.p] + prev.box[a.s] + next.box[a.p]) / 2
  else if (next) main = next.box[a.p] - half
  else if (prev) main = prev.box[a.p] + prev.box[a.s] + half
  else main = f.content[a.p]
  // Cross axis: the content box, or the neighbour's line in a wrapped frame.
  const ref = f.wrap ? (next ?? prev) : undefined
  const crossStart = ref ? ref.box[a.q] : f.content[a.q]
  const length = ref ? ref.box[a.t] : f.content[a.t]
  return f.dir === "row"
    ? { x: main, y: crossStart, length, axis: "v" }
    : { x: crossStart, y: main, length, axis: "h" }
}

function sameLine(dir: FlowDir, a: Rect, b: Rect): boolean {
  const m = mainOf(dir)
  return a[m.p] + a[m.s] <= b[m.p] + 0.5
}

/**
 * The sibling index of flow slot `slot`: `siblings` are every child of the frame in sibling
 * order (dragged nodes removed), `flow` the flow children among them.
 */
export function flowSiblingIndex(
  siblings: readonly string[],
  flow: readonly string[],
  slot: number,
): number {
  if (!flow.length) return siblings.length
  if (slot < flow.length) return Math.max(0, siblings.indexOf(flow[slot] as string))
  return siblings.indexOf(flow[flow.length - 1] as string) + 1
}

/** World content box of a frame box with padding `[t, r, b, l]`. */
export function contentBox(box: Rect, pad: readonly [number, number, number, number]): Rect {
  const [t, r, b, l] = pad
  return {
    x: box.x + l,
    y: box.y + t,
    w: Math.max(0, box.w - l - r),
    h: Math.max(0, box.h - t - b),
  }
}

/** Normalizes a layout `pad` value (number, `[v, h]` or `[t, r, b, l]`) to four numbers. */
export function padOf(pad: unknown): [number, number, number, number] {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0)
  if (Array.isArray(pad)) {
    if (pad.length === 2) return [n(pad[0]), n(pad[1]), n(pad[0]), n(pad[1])]
    if (pad.length === 4) return [n(pad[0]), n(pad[1]), n(pad[2]), n(pad[3])]
    return [0, 0, 0, 0]
  }
  const v = n(pad)
  return [v, v, v, v]
}

/** True when `p` lies inside world rect `r` (edges included). */
export function insideRect(r: Rect, p: { x: number; y: number }): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
}

/**
 * Sibling indices for moving `moving` (in order) so they end up together right before `anchor`
 * (null = at the end), each index as `MoveOp.index` reads it: the position among the destination
 * siblings after removing the node itself, with the earlier moves already applied.
 */
export function sequentialIndices(
  siblings: readonly string[],
  moving: readonly string[],
  anchor: string | null,
): number[] {
  const list = siblings.slice()
  const out: number[] = []
  for (const id of moving) {
    const i = list.indexOf(id)
    if (i >= 0) list.splice(i, 1)
    const at = anchor === null ? -1 : list.indexOf(anchor)
    const idx = at < 0 ? list.length : at
    list.splice(idx, 0, id)
    out.push(idx)
  }
  return out
}

/**
 * The sibling a flow slot inserts before: the flow child at `slot`, or after the last flow child
 * the next sibling that is not moving (null = the end). `base` is every sibling in order.
 */
export function slotAnchor(
  base: readonly string[],
  flow: readonly string[],
  slot: number,
  moving: ReadonlySet<string>,
): string | null {
  if (slot < flow.length) return flow[slot] as string
  const last = flow[flow.length - 1]
  if (last === undefined) return null
  const i = base.indexOf(last)
  return base.slice(i + 1).find((id) => !moving.has(id)) ?? null
}

/** Screen-space structure feedback the canvas host draws (DOM, CSS px). */
export interface StructureDom {
  /** InsertionBar: `axis` "v" = sKpaJ (x = centre line, y = top), "h" = OGqUu (x = left, y = centre). */
  bar: { x: number; y: number; length: number; axis: "h" | "v" } | null
  /** Vacated slots (Y4vVe "Gap Placeholder"). */
  gaps: { x: number; y: number; w: number; h: number; radius: number }[]
  /** Dragged nodes following the pointer (Y4vVe "Card Two · dragged"). */
  ghosts: {
    key: string
    x: number
    y: number
    w: number
    h: number
    radius: number
    src: string | null
  }[]
  /** The rectangle being drawn into a layout (c2o3u "Draw Ghost" + MeasurePill). */
  draw: { x: number; y: number; w: number; h: number; label: string } | null
  /** Tooltip/Hint (u0dQ1) text and icon. */
  hint: { icon: "square" | "move"; text: string } | null
}
