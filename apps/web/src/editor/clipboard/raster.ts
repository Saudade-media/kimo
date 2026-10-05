/**
 * Board 27 §3 "Raster import" (nfBn1; rules N77cg, result/limits L2qTa): PNG · JPEG · WebP ·
 * GIF files dropped on the canvas or pasted become image-filled rectangles.
 *
 * - Node: a `rect` named after the file without its extension ("Pasted image" for clipboard
 *   data) with `fill: { kind: "image", src: "./assets/<sha256-16>.<ext>" }` (fit cover, the
 *   default), selected after the import.
 * - Size: natural px (`@2x` / `@3x` file names divided), then scaled down, ratio kept, to the
 *   target frame's content width, else to 80 % of the viewport. Never scaled up.
 * - Placement: drop → the frame under the pointer (auto layout: the slot nearest the pointer
 *   along the main axis; free frame / empty canvas: centred on the pointer); paste → the §2
 *   paste order ({@link pasteTarget}). Several files: consecutive children in an auto-layout
 *   target, else a row with 16 px gaps.
 * - Storage: the editor's asset store (content-addressed, de-duplicated); 20 MB per image.
 * - Feedback: one toast per import (Undo), one warning toast per rejected file; the whole
 *   import is one undo step.
 *
 * SVG files are not handled here: they go through the SVG import popover (`svg-drop.tsx`).
 */
import type { NodeData, Op } from "@kimo/editor-state"
import { generateId } from "@kimo/editor-state"
import type { LayoutResult } from "@kimo/layout"
import type { Point } from "@kimo/renderer"
import { toLocal } from "../../canvas/commands"
import type { CanvasHandle } from "../../canvas/contract"
import type { AssetInfo, AssetStore } from "../../lib/assets"
import { MAX_ASSET_BYTES, sniffImage } from "../../lib/assets"
import type { M3Controller } from "../m3/controller"
import type { FileSession } from "../session"
import { canPasteInto, pasteTarget } from "./target"

export interface RasterContext {
  session: FileSession
  m3: M3Controller
  canvas: () => CanvasHandle | null
  isVirtual?: (id: string) => boolean
}

export type RasterPlacement = { kind: "paste" } | { kind: "drop"; clientX: number; clientY: number }

/** Raster formats the importer accepts (N77cg "Formats"). */
export const RASTER_MIMES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const
/** Pill meta / warning copy (vgvYj "Meta", L2qTa warning toast). */
export const RASTER_FORMATS_LABEL = "PNG · JPEG · WebP · GIF"
/** Gap between several imported images laid out as a row (rules "Placement"). */
export const RASTER_ROW_GAP = 16
/** Share of the viewport an image may cover on empty canvas (rules "Size"). */
export const VIEWPORT_SHARE = 0.8
/** Name of an image pasted as clipboard data (rules "Node"). */
export const PASTED_IMAGE_NAME = "Pasted image"

const MB = 1024 * 1024

// --- Pure helpers (unit-tested) ---------------------------------------------------------------

/** The raster format of `bytes` (sniffed; the declared type is not trusted), or null. */
export function rasterMime(bytes: Uint8Array): string | null {
  const m = sniffImage(bytes)
  return m && (RASTER_MIMES as readonly string[]).includes(m) ? m : null
}

/** True for an SVG file (left to the SVG importer). */
export function isSvgLike(file: { name?: string; type?: string }): boolean {
  return file.type === "image/svg+xml" || /\.svg$/i.test(file.name ?? "")
}

/** True when a drag item's MIME type is a raster this importer takes. */
export function isRasterType(type: string): boolean {
  return (RASTER_MIMES as readonly string[]).includes(type.toLowerCase())
}

/** The file name without its extension ("team.jpg" → "team"); "" for none. */
export function baseName(name: string | undefined): string {
  const n = (name ?? "").replace(/^.*[\\/]/, "")
  const dot = n.lastIndexOf(".")
  return dot > 0 ? n.slice(0, dot) : n
}

/** Pixel density from an `@2x` / `@3x` file-name suffix (1 otherwise). */
export function densityOf(name: string | undefined): number {
  const m = /@([1-9])x$/i.exec(baseName(name))
  const d = m ? Number(m[1]) : 1
  return d >= 1 ? d : 1
}

/**
 * The placed size: natural px divided by the density, then scaled down (ratio kept) so the
 * width fits `maxW` and the height `maxH` (when given). Never scaled up. Rounded to 0.01.
 */
export function fitSize(
  natural: { width: number; height: number },
  density: number,
  maxW: number | null,
  maxH: number | null = null,
): { w: number; h: number } {
  const w0 = natural.width / density
  const h0 = natural.height / density
  let k = 1
  if (maxW !== null && maxW > 0 && w0 > maxW) k = Math.min(k, maxW / w0)
  if (maxH !== null && maxH > 0 && h0 > maxH) k = Math.min(k, maxH / h0)
  const r = (v: number) => Math.round(v * 100) / 100
  return { w: r(w0 * k), h: r(h0 * k) }
}

/** x offsets of `widths` laid out as a row with `gap`, and the row's total width. */
export function rowOffsets(
  widths: readonly number[],
  gap = RASTER_ROW_GAP,
): { xs: number[]; total: number } {
  const xs: number[] = []
  let x = 0
  for (const w of widths) {
    xs.push(x)
    x += w + gap
  }
  return { xs, total: widths.length ? x - gap : 0 }
}

/** "2.1 MB" (one decimal; at least 0.1 MB for any non-empty size). */
export function formatMb(bytes: number): string {
  const mb = bytes / MB
  return `${(bytes > 0 && mb < 0.1 ? 0.1 : Math.round(mb * 10) / 10).toFixed(1)} MB`
}

/** Warning copy for a file the importer rejects (L2qTa u7ZFT / mXBqS). */
export function rejectionText(
  name: string,
  reason: "unsupported" | "too-large" | "undecodable",
  bytes = 0,
): string {
  if (reason === "too-large")
    return `${name} is ${Math.round(bytes / MB)} MB. The limit is ${MAX_ASSET_BYTES / MB} MB per image`
  if (reason === "undecodable") return `${name} could not be read as an image`
  return `${name} isn't supported. Use PNG, JPEG, WebP or GIF`
}

/** Drop pill copy (vgvYj "Drop Pill"): "Drop 2 images" or "1 of 3 can't be imported". */
export function dropPillText(supported: number, total: number): string {
  const bad = total - supported
  if (bad > 0) return `${bad} of ${total} can't be imported`
  return `Drop ${total} image${total === 1 ? "" : "s"}`
}

// --- Asset store registry ---------------------------------------------------------------------

const stores = new WeakMap<FileSession, AssetStore>()

/** The editor registers its asset store for a session (Editor.tsx); returns an unregister. */
export function registerRasterAssets(session: FileSession, store: AssetStore): () => void {
  stores.set(session, store)
  return () => {
    if (stores.get(session) === store) stores.delete(session)
  }
}

// --- Targets ----------------------------------------------------------------------------------

interface ViewLike {
  getNode(id: string): NodeData | undefined
  children(parent: string | null): readonly string[]
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0)

/** Padding [t, r, b, l] of a frame's layout (bindings count as 0). */
export function padOf(n: NodeData | undefined): [number, number, number, number] {
  const lay = n?.layout
  const pad = typeof lay === "object" && lay !== null ? (lay as { pad?: unknown }).pad : undefined
  if (Array.isArray(pad)) {
    if (pad.length === 2) return [num(pad[0]), num(pad[1]), num(pad[0]), num(pad[1])]
    return [num(pad[0]), num(pad[1]), num(pad[2]), num(pad[3])]
  }
  const p = num(pad)
  return [p, p, p, p]
}

/** True when frame `n` lays its children out (auto layout). */
export function isAutoLayout(n: NodeData | undefined): boolean {
  return !!n && n.type === "frame" && typeof n.layout === "object" && n.layout !== null
}

/**
 * The slot an insert at world `p` takes among the flowing children of auto-layout frame
 * `parent` (index among ALL its children, so it works as an insert `index`).
 */
export function flowSlot(view: ViewLike, layout: LayoutResult, parent: string, p: Point): number {
  const n = view.getNode(parent)
  const dir = (n?.layout as { dir?: unknown } | undefined)?.dir === "column" ? "y" : "x"
  const kids = view.children(parent)
  let index = kids.length
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i] as string
    const kn = view.getNode(k)
    if (!kn || kn.position === "absolute" || kn.visible === false) continue
    const b = layout.nodes.get(k)?.world
    if (!b) continue
    const mid = dir === "x" ? b.x + b.w / 2 : b.y + b.h / 2
    if ((dir === "x" ? p.x : p.y) < mid) {
      index = i
      break
    }
  }
  return index
}

/** The ordinal (1-based) of `index` among the flowing children — the "slot N" of the tag. */
export function slotNumber(view: ViewLike, parent: string, index: number): number {
  const kids = view.children(parent).slice(0, index)
  return (
    kids.filter((k) => {
      const kn = view.getNode(k)
      return kn && kn.position !== "absolute" && kn.visible !== false
    }).length + 1
  )
}

/** The drop target frame under canvas point `screen` (deepest frame a drop may enter), or null. */
export function dropFrameAt(
  canvas: CanvasHandle | null,
  view: ViewLike,
  screen: Point,
  isVirtual?: (id: string) => boolean,
): string | null {
  const hits = canvas?.renderer?.hitTest(screen, { tolerance: 2 }) ?? []
  for (const hit of hits) {
    let cur: string | null = hit
    for (let guard = 0; cur && guard < 4096; guard++) {
      const n = view.getNode(cur)
      if (n?.type === "frame" && canPasteInto(view, cur, isVirtual)) return cur
      cur = typeof n?.parent === "string" ? n.parent : null
    }
  }
  return null
}

/** Canvas-local point of a client point (the canvas element's box). */
export function clientToCanvas(clientX: number, clientY: number): Point {
  const el = document.querySelector<HTMLElement>(".canvas-host__canvas")
  const r = el?.getBoundingClientRect()
  return r ? { x: clientX - r.left, y: clientY - r.top } : { x: clientX, y: clientY }
}

// --- Import -----------------------------------------------------------------------------------

interface Accepted {
  info: AssetInfo
  name: string
  density: number
  added: boolean
}

const nameOf = (f: File | Blob): string | undefined =>
  typeof (f as File).name === "string" && (f as File).name ? (f as File).name : undefined

/**
 * Imports raster files (one undo step): rejected files get one warning toast each, the rest
 * become image rectangles at the placement's target. Returns the created node ids.
 */
export async function importRasterFiles(
  ctx: RasterContext,
  files: readonly (File | Blob)[],
  placement: RasterPlacement,
): Promise<{ created: string[] }> {
  const { session, m3 } = ctx
  const assets = stores.get(session)
  const warn = (text: string) => m3.toast({ tone: "warning", text })
  if (!assets) {
    warn("Images can't be imported here: this file has no asset store")
    return { created: [] }
  }
  const known = new Set(await assets.keys().catch(() => [] as string[]))
  const accepted: Accepted[] = []
  for (const file of files) {
    // Browsers name clipboard image data "image.png": that is "Pasted image", not a file.
    const raw = nameOf(file)
    const fileName =
      placement.kind === "paste" && raw && /^image\.(png|jpe?g|gif|webp)$/i.test(raw)
        ? undefined
        : raw
    if (isSvgLike({ name: fileName, type: file.type })) continue
    const label = fileName ?? PASTED_IMAGE_NAME
    if (file.size > MAX_ASSET_BYTES) {
      warn(rejectionText(label, "too-large", file.size))
      continue
    }
    const head = new Uint8Array(await file.slice(0, 32).arrayBuffer())
    if (!rasterMime(head)) {
      warn(rejectionText(label, "unsupported"))
      continue
    }
    let info: AssetInfo
    try {
      info = await assets.put(file as Blob & { name?: string })
    } catch {
      warn(rejectionText(label, "undecodable"))
      continue
    }
    if (!info.width || !info.height) {
      warn(rejectionText(label, "undecodable"))
      continue
    }
    const key = info.src.slice("./assets/".length)
    const added = !known.has(key)
    known.add(key)
    accepted.push({
      info,
      name: fileName ? baseName(fileName) || PASTED_IMAGE_NAME : PASTED_IMAGE_NAME,
      density: densityOf(fileName),
      added,
    })
  }
  if (!accepted.length) return { created: [] }

  const canvas = ctx.canvas()
  const layout = canvas?.layout() ?? null
  const view = m3.view() as unknown as ViewLike
  const ui = session.ui
  const v = ui.getState().viewport
  const size = canvas?.size?.() ?? { w: 0, h: 0 }

  // Target: the frame under the pointer (drop) or the §2 paste order (paste).
  let parent: string | null
  let center: Point
  let via: "selection" | "pointer" | "viewport" | "drop"
  if (placement.kind === "drop") {
    const screen = clientToCanvas(placement.clientX, placement.clientY)
    center = { x: v.x + screen.x / v.zoom, y: v.y + screen.y / v.zoom }
    parent = dropFrameAt(canvas, view, screen, ctx.isVirtual)
    via = "drop"
  } else {
    const t = pasteTarget(view, ui, canvas, { isVirtual: ctx.isVirtual, layout })
    parent = t.parent
    center = t.center
    via = t.via
  }
  const pn = parent ? view.getNode(parent) : undefined
  const flow = isAutoLayout(pn)
  const box = parent ? layout?.nodes.get(parent)?.world : undefined

  // Size: the target frame's content width, else 80 % of the viewport.
  let maxW: number | null = null
  let maxH: number | null = null
  if (parent && box) {
    const [, pr, , pl] = flow ? padOf(pn) : [0, 0, 0, 0]
    maxW = Math.max(1, box.w - pl - pr)
  } else if (size.w > 0 && size.h > 0) {
    maxW = (size.w / v.zoom) * VIEWPORT_SHARE
    maxH = (size.h / v.zoom) * VIEWPORT_SHARE
  }
  const sizes = accepted.map((a) =>
    fitSize(
      { width: a.info.width as number, height: a.info.height as number },
      a.density,
      maxW,
      maxH,
    ),
  )

  const ops: Op[] = []
  const created: string[] = []
  if (flow && parent) {
    let index = layout ? flowSlot(view, layout, parent, center) : view.children(parent).length
    if (via === "selection") index = view.children(parent).length
    accepted.forEach((a, i) => {
      const id = generateId()
      created.push(id)
      ops.push({
        op: "insert",
        id,
        parent,
        index: index + i,
        node: rectNode(a, sizes[i] as { w: number; h: number }),
      })
    })
  } else {
    const { xs, total } = rowOffsets(sizes.map((s) => s.w))
    const hMax = Math.max(...sizes.map((s) => s.h))
    const left = center.x - total / 2
    accepted.forEach((a, i) => {
      const s = sizes[i] as { w: number; h: number }
      const world = { x: left + (xs[i] as number), y: center.y - hMax / 2 }
      const local = layout ? toLocal(layout, parent, world) : world
      const id = generateId()
      created.push(id)
      ops.push({
        op: "insert",
        id,
        parent,
        node: { ...rectNode(a, s), x: Math.round(local.x), y: Math.round(local.y) },
      })
    })
  }

  const n = accepted.length
  const label = n === 1 ? "Import image" : `Import ${n} images`
  if (!session.apply(ops, placement.kind === "paste" ? label.replace("Import", "Paste") : label))
    return { created: [] }
  ui.getState().select(created)
  const undo = { label: "Undo", run: () => void session.store.undo("user") }
  const into = parent
    ? ` into ${String(pn?.name ?? (pn?.type === "group" ? "Group" : "Frame"))}`
    : ""
  if (placement.kind === "paste") {
    const first = accepted[0] as Accepted
    const what =
      n === 1
        ? `${first.name === PASTED_IMAGE_NAME ? "Pasted image" : `Pasted “${first.name}”`} · ${Math.round((first.info.width as number) / first.density)} × ${Math.round((first.info.height as number) / first.density)}`
        : `Pasted ${n} images`
    const where = parent ? into : via === "pointer" ? " at the pointer" : " at the viewport centre"
    m3.toast({ tone: "success", icon: "clipboard-check", text: `${what}${where}`, action: undo })
  } else {
    const bytes = accepted.reduce((s, a) => s + (a.added ? a.info.bytes : 0), 0)
    const mb = bytes > 0 ? ` · ${formatMb(bytes)} added to assets` : ""
    m3.toast({
      tone: "success",
      text: `Imported ${n} image${n === 1 ? "" : "s"}${into}${mb}`,
      action: undo,
    })
  }
  return { created }
}

function rectNode(a: Accepted, s: { w: number; h: number }): Record<string, unknown> {
  return { type: "rect", name: a.name, w: s.w, h: s.h, fill: { kind: "image", src: a.info.src } }
}
