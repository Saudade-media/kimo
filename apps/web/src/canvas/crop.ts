/**
 * Board 27 §6 (d) "Image crop mode" (VCSml): pure crop math and the per-editor crop store the
 * canvas and the properties panel share.
 *
 * Rules (j3Rcc › R6uRRw): Crop is a 4th image fit mode ("crop"); choosing it, or double-clicking
 * an image fill on the canvas, enters crop mode. The whole source shows, the crop box is edited
 * in source px (⇧ keeps the ratio; dragging inside pans), Enter / Apply commits to the paint's
 * `crop` affine, Esc reverts, Reset = the whole image. The layer's own size never changes.
 *
 * `crop` = `[a, b, c, d, tx, ty]`: a point (u, v) of the node box (normalized) samples the
 * image (normalized) at (a·u + c·v + tx, b·u + d·v + ty); an axis-aligned rect x, y, w, h is
 * `[w, 0, 0, h, x, y]` and an absent crop is the identity (core-schema ImagePaint).
 */
import { useSyncExternalStore } from "react"
import type { UiStore } from "./contract"

/** A crop rectangle in source px. */
export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

export type CropAffine = [number, number, number, number, number, number]

/** Smallest crop edge in source px. */
const MIN_CROP = 1

/** `crop` affine of a source-px rect (`[w, 0, 0, h, x, y]` normalized to the image). */
export function cropToAffine(r: CropRect, iw: number, ih: number): CropAffine {
  const q = (v: number) => Math.round(v * 1e6) / 1e6
  return [q(r.w / iw), 0, 0, q(r.h / ih), q(r.x / iw), q(r.y / ih)]
}

/** Source-px rect of an axis-aligned `crop` affine; null when it is rotated / skewed / invalid. */
export function affineToCrop(m: unknown, iw: number, ih: number): CropRect | null {
  if (!Array.isArray(m) || m.length !== 6) return null
  if (!m.every((v) => typeof v === "number" && Number.isFinite(v))) return null
  const [a, b, c, d, tx, ty] = m as number[] as CropAffine
  if (Math.abs(b) > 1e-9 || Math.abs(c) > 1e-9 || a <= 0 || d <= 0) return null
  return { x: tx * iw, y: ty * ih, w: a * iw, h: d * ih }
}

/** The source region a `cover` fit shows in a `bw × bh` box (centered). */
function coverRect(iw: number, ih: number, bw: number, bh: number): CropRect {
  if (bw <= 0 || bh <= 0) return { x: 0, y: 0, w: iw, h: ih }
  const s = Math.max(bw / iw, bh / ih)
  const w = bw / s
  const h = bh / s
  return { x: (iw - w) / 2, y: (ih - h) / 2, w, h }
}

/**
 * The crop rect crop mode starts from: the paint's own axis-aligned crop, else what its fit
 * shows now (cover = the centered region with the box's ratio; stretch / contain / tile / crop
 * without an affine = the whole image).
 */
export function initialCrop(
  paint: Record<string, unknown>,
  iw: number,
  ih: number,
  bw: number,
  bh: number,
): CropRect {
  const own = paint.crop !== undefined ? affineToCrop(paint.crop, iw, ih) : null
  if (own) return clampRect(own, iw, ih)
  const fit = typeof paint.fit === "string" ? paint.fit : "cover"
  if (fit === "cover") return coverRect(iw, ih, bw, bh)
  return { x: 0, y: 0, w: iw, h: ih }
}

/** Keeps a rect inside the image (size first, then position). */
export function clampRect(r: CropRect, iw: number, ih: number): CropRect {
  const w = Math.min(Math.max(r.w, MIN_CROP), iw)
  const h = Math.min(Math.max(r.h, MIN_CROP), ih)
  const x = Math.min(Math.max(r.x, 0), iw - w)
  const y = Math.min(Math.max(r.y, 0), ih - h)
  return { x, y, w, h }
}

/** Crop handles: corners, edges, or the inside (pan). */
export type CropHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "inside"

/** Moves a pan by `dx`, `dy` source px (the box keeps its size; stays inside the image). */
export function panCrop(start: CropRect, dx: number, dy: number, iw: number, ih: number): CropRect {
  return clampRect({ ...start, x: start.x + dx, y: start.y + dy }, iw, ih)
}

/**
 * Drags an edge / corner handle by `dx`, `dy` source px. The opposite edge stays put; the rect
 * never leaves the image and never shrinks below {@link MIN_CROP}. `keepRatio` (⇧) keeps the
 * start's w/h ratio: corners follow the larger relative change, edges grow the other axis
 * around its center.
 */
export function resizeCrop(
  start: CropRect,
  handle: Exclude<CropHandle, "inside">,
  dx: number,
  dy: number,
  iw: number,
  ih: number,
  keepRatio = false,
): CropRect {
  const west = handle.includes("w")
  const east = handle.includes("e")
  const north = handle.includes("n")
  const south = handle.includes("s")
  let l = start.x
  let t = start.y
  let r = start.x + start.w
  let b = start.y + start.h
  if (west) l = Math.min(Math.max(0, l + dx), r - MIN_CROP)
  if (east) r = Math.max(Math.min(iw, r + dx), l + MIN_CROP)
  if (north) t = Math.min(Math.max(0, t + dy), b - MIN_CROP)
  if (south) b = Math.max(Math.min(ih, b + dy), t + MIN_CROP)
  if (!keepRatio) return { x: l, y: t, w: r - l, h: b - t }

  const ratio = start.w / start.h
  let w = r - l
  let h = b - t
  const horizontal = west || east
  const vertical = north || south
  if (horizontal && vertical) {
    // Corner: the axis that changed more (relatively) drives the other.
    if (Math.abs(w / start.w - 1) >= Math.abs(h / start.h - 1)) h = w / ratio
    else w = h * ratio
  } else if (horizontal) h = w / ratio
  else w = h * ratio
  // Fit inside the image from the fixed anchor.
  const ax = west ? start.x + start.w : east ? start.x : start.x + start.w / 2
  const ay = north ? start.y + start.h : south ? start.y : start.y + start.h / 2
  const maxW = west ? ax : east ? iw - ax : 2 * Math.min(ax, iw - ax)
  const maxH = north ? ay : south ? ih - ay : 2 * Math.min(ay, ih - ay)
  const s = Math.min(1, maxW / w, maxH / h)
  w = Math.max(MIN_CROP, w * s)
  h = Math.max(MIN_CROP, h * s)
  const x = west ? ax - w : east ? ax : ax - w / 2
  const y = north ? ay - h : south ? ay : ay - h / 2
  return { x, y, w, h }
}

/** Whole source px for the panel ("480", "1440"). */
export const cropPx = (v: number): number => Math.round(v)

/** MeasurePill / Hint size text: "1440 × 960". */
export function cropSizeLabel(r: CropRect): string {
  return `${cropPx(r.w)} × ${cropPx(r.h)}`
}

/** Which handle a box-local point hits (box px; `tol` px around edges). */
export function cropHandleAt(
  p: { x: number; y: number },
  w: number,
  h: number,
  tol: number,
): CropHandle | null {
  const nearL = Math.abs(p.x) <= tol
  const nearR = Math.abs(p.x - w) <= tol
  const nearT = Math.abs(p.y) <= tol
  const nearB = Math.abs(p.y - h) <= tol
  const inX = p.x >= -tol && p.x <= w + tol
  const inY = p.y >= -tol && p.y <= h + tol
  if (!inX || !inY) return null
  if (nearT && nearL) return "nw"
  if (nearT && nearR) return "ne"
  if (nearB && nearL) return "sw"
  if (nearB && nearR) return "se"
  if (nearT) return "n"
  if (nearB) return "s"
  if (nearL) return "w"
  if (nearR) return "e"
  return "inside"
}

/** CSS cursor per handle. */
export const CROP_CURSOR: Record<CropHandle, string> = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  inside: "move",
}

// --- Store shared by the canvas (controller) and the panel (Image section) ------------------

/** The image fill being cropped. */
export interface CropSession {
  nodeId: string
  /** Index of the image paint in the node's fill list (stored order). */
  paint: number
  imageWidth: number
  imageHeight: number
  rect: CropRect
}

/** What the controller does for the panel (registered while a canvas is mounted). */
interface CropActions {
  /** Enters crop mode on an image fill (no-op when it is not an image paint). */
  start(nodeId: string, paint: number): void
  setRect(rect: CropRect): void
  /** Commits to `fill[paint].crop` (fit "crop") and leaves crop mode. */
  apply(): void
  /** Leaves crop mode without writing. */
  cancel(): void
  /** The whole image. */
  reset(): void
}

export interface CropStore {
  get(): CropSession | null
  set(session: CropSession | null): void
  subscribe(listener: () => void): () => void
  actions: CropActions | null
}

const stores = new WeakMap<UiStore, CropStore>()

export function cropStore(ui: UiStore): CropStore {
  let s = stores.get(ui)
  if (s) return s
  let state: CropSession | null = null
  const listeners = new Set<() => void>()
  s = {
    get: () => state,
    set(next) {
      if (next === state) return
      state = next
      for (const l of listeners) l()
    },
    subscribe(l) {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    actions: null,
  }
  stores.set(ui, s)
  return s
}

/** React binding: the active crop session, or null. */
export function useCropSession(ui: UiStore): CropSession | null {
  const s = cropStore(ui)
  return useSyncExternalStore(s.subscribe, s.get, s.get)
}
