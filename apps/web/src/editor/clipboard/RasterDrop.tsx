/**
 * Board 27 §3 (a) vgvYj "Drag files over the canvas · drop overlay + target", 1:1 from the node
 * values (canvas-local px):
 * - Drop Overlay (pQA7W): the whole canvas, fill $selection 4 % (#2F6BFF0A), 2 px $selection
 *   stroke, radius 8, opacity 0.9 — only while a drag carries files.
 * - Target Outline (RBQV2): the frame under the pointer, 2 px $selection; Target Tag (u6Bi1):
 *   pill $selection, padding [3, 8], gap 4, corner-down-right 12 $on-accent + "Into Gallery ·
 *   slot 2" text-xs $on-accent, 8 px below the frame, right edge 4 px past the frame's.
 * - InsertionBar (OGqUu / sKpaJ) in an auto-layout target: 2 px bar, 6 px end caps, $selection.
 * - Drag Cursor Stack (p6EqEy): file chips 24 px below the pointer, gap 4; Chip: padding
 *   [3, 8, 3, 6], gap 4, $bg-overlay, 1 px $border, pill, shadow 0 2 6 $shadow; image 12
 *   $text-secondary + mono text-xs $text-primary. (Browsers hide file names until the drop, so
 *   a chip names the format.)
 * - Drop Pill (Ty50V): bottom centre, 13 px above the canvas edge; $text-primary pill, padding
 *   [6, 12], gap 8, image-plus 14 $text-inverse + "Drop 2 images" text-sm $text-inverse + meta
 *   "PNG · JPEG · WebP · GIF" text-xs $text-tertiary; "1 of 3 can't be imported" with
 *   unsupported files.
 * Drops and image pastes run {@link importRasterFiles}.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import type { CanvasHandle } from "../../canvas/contract"
import type { AssetStore } from "../../lib/assets"
import { isTyping } from "../../lib/hooks"
import { Icon } from "../../lib/icons"
import type { M3Controller } from "../m3/controller"
import type { FileSession } from "../session"
import {
  dropFrameAt,
  dropPillText,
  flowSlot,
  importRasterFiles,
  isAutoLayout,
  isRasterType,
  isSvgLike,
  padOf,
  RASTER_FORMATS_LABEL,
  type RasterContext,
  registerRasterAssets,
  slotNumber,
} from "./raster"
import "./raster.css"

/** Board 27 §2 / N77cg "Sources": Kimo nodes win over image data in a mixed paste. */
const KIMO_TYPE = /kimo/i
const KIMO_HTML = /data-kimo|x-kimo|kimo\/nodes/i

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

interface DragState {
  /** Pointer, canvas-local px. */
  x: number
  y: number
  /** Chip labels (one per dragged file; formats). */
  chips: string[]
  supported: number
  total: number
  target: { box: Rect; tag: string; bar: (Rect & { dir: "h" | "v" }) | null } | null
}

const FORMAT: Record<string, string> = {
  "image/png": "PNG",
  "image/jpeg": "JPEG",
  "image/webp": "WebP",
  "image/gif": "GIF",
  "image/svg+xml": "SVG",
}

/** Drop + paste of raster images on the canvas (props for the canvas container + overlay). */
export function useRasterDrop({
  session,
  m3,
  canvas,
  assets,
  container,
}: {
  session: FileSession
  m3: M3Controller
  canvas: { readonly current: CanvasHandle | null }
  assets: AssetStore
  container: { readonly current: HTMLElement | null }
}) {
  useEffect(() => registerRasterAssets(session, assets), [session, assets])
  const ctx = useMemo<RasterContext>(
    () => ({
      session,
      m3,
      canvas: () => canvas.current,
      isVirtual: (id) => m3.view().isVirtual(id),
    }),
    [session, m3, canvas],
  )
  const [drag, setDrag] = useState<DragState | null>(null)
  const last = useRef(0)

  // Paste of image data / image files (no Kimo payload): the §2 paste order.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (e.defaultPrevented || isTyping(e.target)) return
      const data = e.clipboardData
      if (!data) return
      if (data.types.some((t) => KIMO_TYPE.test(t))) return
      if (data.types.includes("text/html") && KIMO_HTML.test(data.getData("text/html"))) return
      const files = [...data.files].filter((f) => !isSvgLike(f))
      if (!files.length) return
      e.preventDefault()
      void importRasterFiles(ctx, files, { kind: "paste" })
    }
    window.addEventListener("paste", onPaste)
    return () => window.removeEventListener("paste", onPaste)
  }, [ctx])

  // A drag that leaves the window or ends anywhere hides the overlay.
  useEffect(() => {
    if (!drag) return
    const end = () => setDrag(null)
    window.addEventListener("dragend", end)
    window.addEventListener("drop", end)
    return () => {
      window.removeEventListener("dragend", end)
      window.removeEventListener("drop", end)
    }
  }, [drag])

  const state = (e: React.DragEvent<HTMLElement>): DragState => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    const items = [...e.dataTransfer.items].filter((i) => i.kind === "file")
    const chips = items.map((i) => FORMAT[i.type.toLowerCase()] ?? "File")
    const supported = items.filter(
      (i) => isRasterType(i.type) || i.type.toLowerCase() === "image/svg+xml",
    ).length
    const c = canvas.current
    const view = m3.view()
    let target: DragState["target"] = null
    const id = dropFrameAt(c, view, { x, y }, (v) => view.isVirtual(v))
    const layout = id ? c?.layout() : null
    const world = id ? layout?.nodes.get(id)?.world : undefined
    if (id && layout && world) {
      const v = session.ui.getState().viewport
      const toScreen = (b: { x: number; y: number; w: number; h: number }): Rect => ({
        x: (b.x - v.x) * v.zoom,
        y: (b.y - v.y) * v.zoom,
        w: b.w * v.zoom,
        h: b.h * v.zoom,
      })
      const n = view.getNode(id)
      const name = String(n?.name ?? "Frame")
      let bar: NonNullable<DragState["target"]>["bar"] = null
      let tag = `Into ${name}`
      if (isAutoLayout(n)) {
        const p = { x: v.x + x / v.zoom, y: v.y + y / v.zoom }
        const index = flowSlot(view, layout, id, p)
        tag = `Into ${name} · slot ${slotNumber(view, id, index)}`
        bar = insertionBar(view, layout, id, index, toScreen)
      }
      target = { box: toScreen(world), tag, bar }
    }
    return { x, y, chips, supported, total: items.length, target }
  }

  const handlers = {
    onDragOver(e: React.DragEvent<HTMLElement>) {
      if (!e.dataTransfer.types.includes("Files")) return
      const items = [...e.dataTransfer.items].filter((i) => i.kind === "file")
      // SVG-only drags belong to the SVG importer (its own feedback).
      if (items.length && items.every((i) => i.type.toLowerCase() === "image/svg+xml")) return
      e.preventDefault()
      e.dataTransfer.dropEffect = "copy"
      const now = performance.now()
      if (now - last.current < 32 && drag) return
      last.current = now
      setDrag(state(e))
    },
    onDragLeave(e: React.DragEvent<HTMLElement>) {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrag(null)
    },
    onDrop(e: React.DragEvent<HTMLElement>) {
      setDrag(null)
      const files = [...e.dataTransfer.files]
      const raster = files.filter((f) => !isSvgLike(f))
      if (!raster.length) return
      // Mixed with SVGs: leave the event to the SVG importer too.
      if (raster.length === files.length) e.preventDefault()
      void importRasterFiles(ctx, raster, { kind: "drop", clientX: e.clientX, clientY: e.clientY })
    },
  }

  void container
  const overlay = drag ? <RasterDropOverlay drag={drag} /> : null
  return { handlers, overlay }
}

/** The InsertionBar box (screen px) for slot `index` of auto-layout frame `parent`. */
function insertionBar(
  view: ReturnType<M3Controller["view"]>,
  layout: NonNullable<ReturnType<CanvasHandle["layout"]>>,
  parent: string,
  index: number,
  toScreen: (b: Rect) => Rect,
): Rect & { dir: "h" | "v" } {
  const n = view.getNode(parent)
  const row = (n?.layout as { dir?: unknown } | undefined)?.dir !== "column"
  const world = layout.nodes.get(parent)?.world as Rect
  const box = toScreen(world)
  const zoom = world.w > 0 ? box.w / world.w : 1
  const [pt, pr, pb, pl] = padOf(n).map((p) => p * zoom) as [number, number, number, number]
  const flowing = view
    .children(parent)
    .map((k, i) => ({ k, i }))
    .filter(({ k }) => {
      const kn = view.getNode(k)
      return kn && kn.position !== "absolute" && kn.visible !== false
    })
  const boxOf = (k: string) => {
    const w = layout.nodes.get(k)?.world
    return w ? toScreen(w) : null
  }
  const prev = [...flowing].reverse().find(({ i }) => i < index)
  const next = flowing.find(({ i }) => i >= index)
  const before = prev ? boxOf(prev.k) : null
  const nb = next ? boxOf(next.k) : null
  if (row) {
    const end = (b: Rect) => b.x + b.w
    const at =
      before && nb
        ? (end(before) + nb.x) / 2
        : before
          ? end(before) + Math.min(6, box.x + box.w - pr - end(before)) / 2
          : nb
            ? nb.x - Math.min(6, nb.x - box.x - pl) / 2
            : box.x + pl
    return { dir: "v", x: at - 3, y: box.y + pt, w: 6, h: Math.max(0, box.h - pt - pb) }
  }
  const end = (b: Rect) => b.y + b.h
  const at =
    before && nb
      ? (end(before) + nb.y) / 2
      : before
        ? end(before) + Math.min(6, box.y + box.h - pb - end(before)) / 2
        : nb
          ? nb.y - Math.min(6, nb.y - box.y - pt) / 2
          : box.y + pt
  return { dir: "h", x: box.x + pl, y: at - 3, w: Math.max(0, box.w - pl - pr), h: 6 }
}

function RasterDropOverlay({ drag }: { drag: DragState }) {
  const shown = drag.chips.slice(0, 3)
  const more = drag.chips.length - shown.length
  return (
    <div className="raster-drop" data-testid="raster-drop-overlay" aria-hidden="true">
      <div className="raster-drop__overlay" data-testid="raster-drop-tint" />
      {drag.target && (
        <>
          <div
            className="raster-drop__target"
            data-testid="raster-drop-target"
            style={{
              left: drag.target.box.x,
              top: drag.target.box.y,
              width: drag.target.box.w,
              height: drag.target.box.h,
            }}
          />
          {drag.target.bar && (
            <div
              className={`raster-drop__bar raster-drop__bar--${drag.target.bar.dir}`}
              data-testid="raster-drop-bar"
              style={{
                left: drag.target.bar.x,
                top: drag.target.bar.y,
                width: drag.target.bar.w,
                height: drag.target.bar.h,
              }}
            >
              <span className="raster-drop__cap" />
              <span className="raster-drop__line" />
              <span className="raster-drop__cap" />
            </div>
          )}
          <div
            className="raster-drop__tag"
            data-testid="raster-drop-tag"
            style={{
              left: drag.target.box.x + drag.target.box.w + 4,
              top: drag.target.box.y + drag.target.box.h + 8,
            }}
          >
            <Icon name="corner-down-right" size={12} />
            <span className="raster-drop__tag-label">{drag.target.tag}</span>
          </div>
        </>
      )}
      {drag.chips.length > 0 && (
        <div className="raster-drop__chips" style={{ left: drag.x, top: drag.y + 24 }}>
          {shown.map((c, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: chips are positional
            <span key={i} className="raster-drop__chip" data-testid="raster-drop-chip">
              <Icon name="image" size={12} />
              <span className="raster-drop__chip-name">{c}</span>
            </span>
          ))}
          {more > 0 && (
            <span className="raster-drop__chip">
              <span className="raster-drop__chip-name">+{more}</span>
            </span>
          )}
        </div>
      )}
      <div className="raster-drop__pill" data-testid="raster-drop-pill">
        <Icon name="image-plus" size={14} />
        <span className="raster-drop__pill-label">{dropPillText(drag.supported, drag.total)}</span>
        <span className="raster-drop__pill-meta">{RASTER_FORMATS_LABEL}</span>
      </div>
    </div>
  )
}
