/**
 * Board 27 §2 paste order (R8OJ3 rules, shared with §3 raster import): where pasted or imported
 * nodes go.
 * 1. A single selected frame or group that is not an instance (nor inside one) → its last child.
 * 2. Else the pointer, when it is over the canvas → centred on the pointer (page root).
 * 3. Else the viewport centre (page root).
 */
import type { NodeData } from "@kimo/editor-state"
import type { LayoutResult } from "@kimo/layout"
import type { Point } from "@kimo/renderer"
import type { CanvasHandle, UiStore } from "../../canvas/contract"

export interface PasteTarget {
  /** Parent id (null = the active page's root). */
  parent: string | null
  /** World point the pasted block is centred on (unused when `parent` lays its children out). */
  center: Point
  /** How the target was chosen (rule 1, 2 or 3). */
  via: "selection" | "pointer" | "viewport"
}

export interface TargetReader {
  getNode(id: string): NodeData | undefined
}

/** True when `id` is a container a paste may enter (frame/group, not an instance or inside one). */
export function canPasteInto(
  doc: TargetReader,
  id: string,
  isVirtual?: (id: string) => boolean,
): boolean {
  if (isVirtual?.(id)) return false
  const n = doc.getNode(id)
  if (!n || (n.type !== "frame" && n.type !== "group")) return false
  // Inside an instance (instance-owned nodes have `at`; their parent chain reaches an instance).
  let cur: NodeData | undefined = n
  for (let guard = 0; cur && guard < 4096; guard++) {
    if (cur.type === "instance" || typeof cur.at === "string") return false
    cur = typeof cur.parent === "string" ? doc.getNode(cur.parent) : undefined
  }
  return true
}

/** The paste target for the current selection, pointer and viewport. */
export function pasteTarget(
  doc: TargetReader,
  ui: UiStore,
  canvas: CanvasHandle | null,
  options: { isVirtual?: (id: string) => boolean; layout?: LayoutResult | null } = {},
): PasteTarget {
  const s = ui.getState()
  const v = s.viewport
  const size = canvas?.size?.() ?? { w: 0, h: 0 }
  const viewportCenter = { x: v.x + size.w / 2 / v.zoom, y: v.y + size.h / 2 / v.zoom }
  const only = s.selection.length === 1 ? s.selection[0] : undefined
  if (only && canPasteInto(doc, only, options.isVirtual)) {
    const box = options.layout?.nodes.get(only)?.world
    return {
      parent: only,
      center: box ? { x: box.x + box.w / 2, y: box.y + box.h / 2 } : viewportCenter,
      via: "selection",
    }
  }
  const p = canvas?.pointer?.() ?? null
  if (p && p.x >= 0 && p.y >= 0 && p.x <= size.w && p.y <= size.h)
    return {
      parent: null,
      center: { x: v.x + p.x / v.zoom, y: v.y + p.y / v.zoom },
      via: "pointer",
    }
  return { parent: null, center: viewportCenter, via: "viewport" }
}
