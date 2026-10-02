/**
 * Pure geometry for the canvas host: matrices, boxes, resize handles, viewport fitting and the
 * selection size badge. No DOM, no React (unit-tested in Bun).
 */
import type { NodeData, Viewport } from "@kimo/editor-state"
import { MAX_ZOOM, MIN_ZOOM } from "@kimo/editor-state"
import type { Matrix, Rect } from "@kimo/layout"
import type { Point } from "@kimo/renderer"

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

export function invert(m: Matrix): Matrix {
  const [a, b, c, d, e, f] = m
  const det = a * d - b * c
  if (!det) return IDENTITY
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]
}

/** Applies only the linear part (for deltas). */
export function applyLinear(m: Matrix, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y, y: m[1] * p.x + m[3] * p.y }
}

export function unionRects(rects: Iterable<Rect>): Rect | null {
  let x0 = Number.POSITIVE_INFINITY
  let y0 = Number.POSITIVE_INFINITY
  let x1 = Number.NEGATIVE_INFINITY
  let y1 = Number.NEGATIVE_INFINITY
  for (const r of rects) {
    x0 = Math.min(x0, r.x)
    y0 = Math.min(y0, r.y)
    x1 = Math.max(x1, r.x + r.w)
    y1 = Math.max(y1, r.y + r.h)
  }
  return x0 > x1 ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Normalized rect from two corners. */
export function rectFromPoints(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  }
}

export function containsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  )
}

export function containsPoint(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.y >= r.y && p.x <= r.x + r.w && p.y <= r.y + r.h
}

/** Rounds document values to 1/100 (pointer math at fractional zoom). */
export const round2 = (v: number) => Math.round(v * 100) / 100

// --- Resize handles -------------------------------------------------------------------------

/** The 8 resize handles: 4 drawn corners (board 03) + 4 edge zones. */
export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w"
export const HANDLES: readonly Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"]

/** Direction of a handle: -1 = left/top edge, 1 = right/bottom edge, 0 = unaffected. */
export function handleDir(h: Handle): { fx: -1 | 0 | 1; fy: -1 | 0 | 1 } {
  return {
    fx: h.includes("w") ? -1 : h.includes("e") ? 1 : 0,
    fy: h.startsWith("n") ? -1 : h.startsWith("s") ? 1 : 0,
  }
}

export const HANDLE_CURSOR: Record<Handle, string> = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
}

/**
 * Handle under a screen point for a screen-space selection box: corners win within
 * `corner` px of their center (the drawn 8×8 handle + slop), edges within `edge` px of the line.
 */
export function handleAt(box: Rect, p: Point, corner = 7, edge = 4): Handle | null {
  const x0 = box.x
  const y0 = box.y
  const x1 = box.x + box.w
  const y1 = box.y + box.h
  const near = (ax: number, ay: number) =>
    Math.abs(p.x - ax) <= corner && Math.abs(p.y - ay) <= corner
  if (near(x0, y0)) return "nw"
  if (near(x1, y0)) return "ne"
  if (near(x1, y1)) return "se"
  if (near(x0, y1)) return "sw"
  const inX = p.x > x0 && p.x < x1
  const inY = p.y > y0 && p.y < y1
  if (inX && Math.abs(p.y - y0) <= edge) return "n"
  if (inX && Math.abs(p.y - y1) <= edge) return "s"
  if (inY && Math.abs(p.x - x0) <= edge) return "w"
  if (inY && Math.abs(p.x - x1) <= edge) return "e"
  return null
}

/**
 * New box after dragging handle `h` by (`dx`, `dy`) world units from `start`.
 * `aspect` (shift) keeps the start ratio; `center` (alt) resizes symmetrically. Dragging a
 * handle past the opposite edge flips the box to the other side of the fixed edge (the size
 * stays positive, min 1), like Figma.
 */
export function resizeBox(
  start: Rect,
  h: Handle,
  dx: number,
  dy: number,
  opts: { aspect?: boolean; center?: boolean } = {},
): Rect {
  const { fx, fy } = handleDir(h)
  const k = opts.center ? 2 : 1
  // Signed extents: negative once the handle crossed the fixed edge.
  let sw = start.w + fx * dx * k
  let sh = start.h + fy * dy * k
  if (opts.aspect && start.w > 0 && start.h > 0) {
    if (fx && fy) {
      const s = Math.max(Math.abs(sw) / start.w, Math.abs(sh) / start.h)
      sw = Math.sign(sw || 1) * start.w * s
      sh = Math.sign(sh || 1) * start.h * s
    } else if (fx) sh = (Math.abs(sw) * start.h) / start.w
    else if (fy) sw = (Math.abs(sh) * start.w) / start.h
  }
  const w = Math.max(1, Math.abs(sw))
  const hh = Math.max(1, Math.abs(sh))
  const place = (s: number, size: number, newSize: number, signed: number, f: number) => {
    if (opts.center || f === 0) return s + (size - newSize) / 2
    // East/south handles keep the start edge fixed; west/north keep the far edge.
    const anchor = f === 1 ? s : s + size
    const towardsHandle = signed >= 0
    return f === 1
      ? towardsHandle
        ? anchor
        : anchor - newSize
      : towardsHandle
        ? anchor - newSize
        : anchor
  }
  return {
    x: place(start.x, start.w, w, sw, opts.aspect && !fx ? 0 : fx),
    y: place(start.y, start.h, hh, sh, opts.aspect && !fy ? 0 : fy),
    w,
    h: hh,
  }
}

/** Maps box `b` (inside `from`) to the corresponding box inside `to`. */
export function mapBox(b: Rect, from: Rect, to: Rect): Rect {
  const sx = from.w ? to.w / from.w : 1
  const sy = from.h ? to.h / from.h : 1
  return { x: to.x + (b.x - from.x) * sx, y: to.y + (b.y - from.y) * sy, w: b.w * sx, h: b.h * sy }
}

// --- Viewport ------------------------------------------------------------------------------

export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

/** Viewport that fits `bounds` into a `width × height` canvas with `padding` px, at most 100%. */
export function fitViewport(
  bounds: Rect,
  width: number,
  height: number,
  padding = 64,
  maxZoom = 1,
): Viewport {
  const aw = Math.max(1, width - 2 * padding)
  const ah = Math.max(1, height - 2 * padding)
  const zoom = clampZoom(
    Math.min(maxZoom, aw / Math.max(bounds.w, 1e-6), ah / Math.max(bounds.h, 1e-6)),
  )
  return {
    zoom,
    x: bounds.x + bounds.w / 2 - width / 2 / zoom,
    y: bounds.y + bounds.h / 2 - height / 2 / zoom,
  }
}

/** Zoom factor for a wheel/pinch delta (ctrl/cmd + wheel). */
export const wheelZoomFactor = (deltaY: number, deltaMode = 0) =>
  Math.exp(-deltaY * (deltaMode === 1 ? 0.05 : 0.01))

// --- Size badge ----------------------------------------------------------------------------

const fmt = (n: number) => String(Math.round(n * 100) / 100)

/** Sizing mode label of one axis: "Hug" (fit), "Fill", or "" for a fixed size. */
export function sizeMode(node: NodeData, axis: "w" | "h"): "" | "Hug" | "Fill" {
  if (node.type === "text") {
    const grow = node.grow ?? "auto"
    if (grow === "auto" || (grow === "fixed-width" && axis === "h")) return "Hug"
  }
  const v = node[axis]
  if (v && typeof v === "object" && "mode" in v) {
    const mode = (v as { mode: unknown }).mode
    return mode === "fill" ? "Fill" : mode === "fit" ? "Hug" : ""
  }
  if (v === undefined && (node.type === "frame" || node.type === "group")) return "Hug"
  return ""
}

/**
 * Board 03 Size Badge text (vlBD0 > f8KgH): `"720 × Hug 366"`. Only hugging axes get a
 * prefix; fixed and fill axes show the resolved number alone (the selected Hero fills its
 * parent's width and reads "720").
 */
export function sizeLabel(node: NodeData | null, box: Rect): string {
  const part = (axis: "w" | "h", v: number) =>
    node && sizeMode(node, axis) === "Hug" ? `Hug ${fmt(v)}` : fmt(v)
  return `${part("w", box.w)} × ${part("h", box.h)}`
}
