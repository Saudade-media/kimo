/**
 * Board 27 §6 (d) image crop mode on the canvas (VCSml): pointer handling, the overlay and the
 * commit, behind a small host interface so the controller only forwards events.
 *
 * Mapping: while cropping, image px map to the node's local box through `local = (img - o) · s`,
 * with `s` fixed at entry (the entry crop fills the node box) and `o` the image-space origin.
 * Dragging an edge / corner moves the box over the still image; dragging inside pans the image
 * under the still box (both `rect` and `o` shift by the same amount). Nothing is written until
 * Apply / Enter: one undo step `fill[i] = { …paint, fit: "crop", crop }`.
 */
import type { NodeData, Op } from "@kimo/editor-state"
import type { LayoutResult, Matrix } from "@kimo/layout"
import type { CropOverlay, Point, Viewport } from "@kimo/renderer"
import {
  type CropHandle,
  type CropRect,
  type CropStore,
  clampRect,
  cropHandleAt,
  cropSizeLabel,
  cropToAffine,
  initialCrop,
  panCrop,
  resizeCrop,
} from "./crop"

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/** Screen px around the box edges that grab a handle (brackets are 3 px outside the box). */
const CROP_HANDLE_TOLERANCE = 6

/** `m · n` (apply `n` first). */
function mul(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ]
}
function inv(m: Matrix): Matrix | null {
  const det = m[0] * m[3] - m[1] * m[2]
  if (!det) return null
  const a = m[3] / det
  const b = -m[1] / det
  const c = -m[2] / det
  const d = m[0] / det
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])]
}
const ap = (m: Matrix, p: Point): Point => ({
  x: m[0] * p.x + m[2] * p.y + m[4],
  y: m[1] * p.x + m[3] * p.y + m[5],
})

/** The image paints of a fill value (stored order), with their indexes. */
export function imagePaints(fill: unknown): { index: number; paint: Record<string, unknown> }[] {
  const list = fill === undefined || fill === null ? [] : Array.isArray(fill) ? fill : [fill]
  return list.flatMap((p, index) =>
    isObj(p) && p.kind === "image" && typeof p.src === "string" ? [{ index, paint: p }] : [],
  )
}

/** Index of the top-most visible image paint of a node, or null. */
export function topImagePaint(node: NodeData | undefined): number | null {
  const all = imagePaints(node?.fill).filter((p) => p.paint.visible !== false)
  return all.length ? (all[all.length - 1] as { index: number }).index : null
}

/** Ops writing `paint` at `index` of the node's fill, keeping its single / list shape. */
export function writePaintOps(
  id: string,
  node: NodeData,
  index: number,
  paint: Record<string, unknown>,
): Op[] {
  const fill = node.fill
  const list = Array.isArray(fill) ? [...fill] : fill === undefined ? [] : [fill]
  if (index < 0 || index >= list.length) return []
  list[index] = paint
  const value = Array.isArray(fill) || list.length > 1 ? list : list[0]
  return [{ op: "update", id, set: { fill: value } } as Op]
}

/** The paint committed by Apply: fit "crop" with the rect's affine. */
export function croppedPaint(
  paint: Record<string, unknown>,
  rect: CropRect,
  iw: number,
  ih: number,
): Record<string, unknown> {
  return { ...paint, fit: "crop", crop: cropToAffine(rect, iw, ih) }
}

/** Drags land on whole source px (the panel edits source px). */
function wholePx(r: CropRect, st: { iw: number; ih: number }): CropRect {
  const x = Math.round(r.x)
  const y = Math.round(r.y)
  return clampRect(
    { x, y, w: Math.round(r.x + r.w) - x, h: Math.round(r.y + r.h) - y },
    st.iw,
    st.ih,
  )
}

export interface CropHost {
  getNode(id: string): NodeData | undefined
  /** False for composite ids inside instances (not croppable in v1). */
  isReal(id: string): boolean
  layout(): LayoutResult | null
  viewport(): Viewport
  imageSize(src: string): Promise<{ width: number; height: number } | null>
  apply(ops: readonly Op[], label: string): boolean
  /** Draw the node with this data (image paint hidden) while cropping; null restores it. */
  override(id: string, data: NodeData | null): void
  /** Overlay / cursor / hint changed. */
  changed(): void
  store: CropStore
}

interface Active {
  nodeId: string
  paint: number
  src: string
  opacity: number
  iw: number
  ih: number
  rect: CropRect
  /** Image-space origin of the node box (see module doc). */
  o: Point
  /** Node-local px per image px (fixed at entry). */
  s: Point
}

interface Drag {
  handle: CropHandle
  /** Pointer at press, in image px through the press-time mapping. */
  at: Point
  rect: CropRect
  o: Point
  /** Press-time image → screen mapping. */
  toScreen: Matrix
}

export class CropMode {
  private st: Active | null = null
  private drag: Drag | null = null
  private pending = 0

  constructor(private readonly host: CropHost) {}

  get active(): boolean {
    return this.st !== null
  }

  get nodeId(): string | null {
    return this.st?.nodeId ?? null
  }

  /** Enters crop mode on `fill[paint]` of `nodeId` (async: reads the image size). */
  async start(nodeId: string, paint?: number): Promise<boolean> {
    const h = this.host
    const node = h.getNode(nodeId)
    if (!node || !h.isReal(nodeId) || node.locked === true) return false
    const index = paint ?? topImagePaint(node)
    if (index === null) return false
    const p = imagePaints(node.fill).find((x) => x.index === index)?.paint
    if (!p) return false
    if (this.st) this.apply()
    const token = ++this.pending
    const size = await h.imageSize(p.src as string)
    if (token !== this.pending || !size) return false
    const l = h.layout()?.nodes.get(nodeId)
    if (!l || l.local.w <= 0 || l.local.h <= 0) return false
    const rect = initialCrop(p, size.width, size.height, l.local.w, l.local.h)
    this.st = {
      nodeId,
      paint: index,
      src: p.src as string,
      opacity: typeof p.opacity === "number" ? p.opacity : 1,
      iw: size.width,
      ih: size.height,
      rect,
      o: { x: rect.x, y: rect.y },
      s: { x: l.local.w / rect.w, y: l.local.h / rect.h },
    }
    // The canvas shows the source through the overlay: hide the paint itself meanwhile.
    const list = Array.isArray(node.fill) ? [...node.fill] : [node.fill]
    list[index] = { ...p, visible: false }
    h.override(nodeId, { ...node, fill: Array.isArray(node.fill) ? list : list[0] } as NodeData)
    this.publish()
    return true
  }

  private publish(): void {
    const st = this.st
    this.host.store.set(
      st
        ? {
            nodeId: st.nodeId,
            paint: st.paint,
            imageWidth: st.iw,
            imageHeight: st.ih,
            rect: st.rect,
          }
        : null,
    )
    this.host.changed()
  }

  private exit(): void {
    const st = this.st
    this.pending++
    this.st = null
    this.drag = null
    if (st) this.host.override(st.nodeId, null)
    this.publish()
  }

  /** Image px → screen CSS px for the current (or given) origin. */
  imageToScreen(o?: Point): Matrix | null {
    const st = this.st
    const l = st ? this.host.layout()?.nodes.get(st.nodeId) : null
    if (!st || !l) return null
    const v = this.host.viewport()
    const origin = o ?? st.o
    const imgToLocal: Matrix = [st.s.x, 0, 0, st.s.y, -origin.x * st.s.x, -origin.y * st.s.y]
    const view: Matrix = [v.zoom, 0, 0, v.zoom, -v.x * v.zoom, -v.y * v.zoom]
    return mul(view, mul(l.transform, imgToLocal))
  }

  overlay(): CropOverlay | null {
    const st = this.st
    const m = this.imageToScreen()
    if (!st || !m) return null
    const r = st.rect
    return {
      src: st.src,
      imageWidth: st.iw,
      imageHeight: st.ih,
      imageToScreen: m,
      box: [
        ap(m, { x: r.x, y: r.y }),
        ap(m, { x: r.x + r.w, y: r.y }),
        ap(m, { x: r.x + r.w, y: r.y + r.h }),
        ap(m, { x: r.x, y: r.y + r.h }),
      ],
      label: cropSizeLabel(r),
      opacity: st.opacity,
    }
  }

  /** The handle under screen point `p`, or null (outside the box). */
  handleAt(p: Point): CropHandle | null {
    const st = this.st
    const m = this.imageToScreen()
    const im = m && inv(m)
    if (!st || !m || !im) return null
    const q = ap(im, p)
    // Box-local screen px: image px from the box corner × screen px per image px.
    const kx = Math.hypot(m[0], m[1])
    const ky = Math.hypot(m[2], m[3])
    return cropHandleAt(
      { x: (q.x - st.rect.x) * kx, y: (q.y - st.rect.y) * ky },
      st.rect.w * kx,
      st.rect.h * ky,
      CROP_HANDLE_TOLERANCE,
    )
  }

  /** True when `p` is over the image source (inside the dimmed area or the box). */
  overImage(p: Point): boolean {
    const st = this.st
    const m = this.imageToScreen()
    const im = m && inv(m)
    if (!st || !im) return false
    const q = ap(im, p)
    return q.x >= 0 && q.y >= 0 && q.x <= st.iw && q.y <= st.ih
  }

  /** Pointer down (screen px). Always consumes the press while active. */
  down(p: Point): void {
    const st = this.st
    if (!st) return
    const handle = this.handleAt(p)
    if (!handle) {
      // Outside the box: outside the image commits (like leaving path edit); over the dimmed
      // source does nothing.
      if (!this.overImage(p)) this.apply()
      return
    }
    const m = this.imageToScreen()
    const im = m && inv(m)
    if (!m || !im) return
    this.drag = { handle, at: ap(im, p), rect: st.rect, o: st.o, toScreen: m }
  }

  move(p: Point, shift: boolean): boolean {
    const st = this.st
    const d = this.drag
    if (!st || !d) return false
    const im = inv(d.toScreen)
    if (!im) return false
    const q = ap(im, p)
    const dx = q.x - d.at.x
    const dy = q.y - d.at.y
    if (d.handle === "inside") {
      // Pan: the image follows the pointer under the still box.
      const rect = wholePx(panCrop(d.rect, -dx, -dy, st.iw, st.ih), st)
      st.rect = rect
      st.o = { x: d.o.x + (rect.x - d.rect.x), y: d.o.y + (rect.y - d.rect.y) }
    } else st.rect = wholePx(resizeCrop(d.rect, d.handle, dx, dy, st.iw, st.ih, shift), st)
    this.publish()
    return true
  }

  up(): boolean {
    if (!this.drag) return false
    this.drag = null
    this.host.changed()
    return true
  }

  get dragging(): CropHandle | null {
    return this.drag?.handle ?? null
  }

  /** Panel X/Y/W/H (source px): the box moves over the still image. */
  setRect(rect: CropRect): void {
    const st = this.st
    if (!st) return
    st.rect = clampRect(rect, st.iw, st.ih)
    this.publish()
  }

  /** Reset = the whole image. */
  reset(): void {
    const st = this.st
    if (!st) return
    st.rect = { x: 0, y: 0, w: st.iw, h: st.ih }
    this.publish()
  }

  /** Commits (one undo step) and leaves crop mode. */
  apply(): void {
    const st = this.st
    if (!st) return
    const node = this.host.getNode(st.nodeId)
    const paint = node ? imagePaints(node.fill).find((x) => x.index === st.paint)?.paint : null
    this.exit()
    if (!node || !paint) return
    const next = croppedPaint(paint, st.rect, st.iw, st.ih)
    this.host.apply(writePaintOps(st.nodeId, node, st.paint, next), "Crop image")
  }

  /** Esc: leaves without writing. */
  cancel(): void {
    if (this.st) this.exit()
  }
}
