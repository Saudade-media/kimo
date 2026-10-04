/**
 * Canvas tool state shared between the canvas host and the floating toolbar without routing it
 * through the shell: the armed image placement (the toolbar shows Image active while armed) and
 * whether the pen's "Click to add points" hint is showing (board 10 #7: shown while the pen is
 * armed, fades after the first anchor). One small store per UI store (one per editor session).
 */
import type { Tool } from "@kimo/editor-state"
import type { Point, Rect } from "@kimo/renderer"
import { useSyncExternalStore } from "react"
import type { CanvasToolId, ImagePlacement, UiStore } from "./contract"

/** Board 27 §5 (J5Vng): what the path-edit toolbar shows. */
export interface PathEditBarState {
  id: string
  /** Select anchors (default) · Add (click a segment adds an anchor) · Bend (drag a segment). */
  mode: "select" | "add" | "bend"
  /** Kind of the selected anchors; null when none is selected or they are mixed. */
  anchorKind: "sharp" | "smooth" | null
  /** ≥ 1 anchor selected (scissors). */
  canCut: boolean
  /** A segment is selected (eraser / ⌫). */
  segmentSelected: boolean
  /** The path's screen bounds (canvas CSS px): the bar sits 12 px above. */
  box: Rect
  /** Cut Cue (NsORT) top-left in canvas CSS px while a segment is selected. */
  cue: Point | null
}

export interface CanvasToolState {
  placement: ImagePlacement | null
  /** Pen armed and no anchor placed yet. */
  penHint: boolean
  /** Board 27 §5: the shape slot's last-used shape (default Rectangle). */
  shape: CanvasToolId
  /** Polygon tool sides, remembered per session (tool default 3 = triangle). */
  polygonSides: number
  /** Star tool points, remembered per session (default 5). */
  starPoints: number
  /** Path edit mode toolbar; null outside path edit. */
  pathEdit: PathEditBarState | null
}

/** UI-store tools that live in the board 27 shape slot → their toolbar ids. */
const SLOT_OF: Partial<Record<Tool, CanvasToolId>> = {
  rect: "rectangle",
  ellipse: "ellipse",
  line: "line",
  arrow: "arrow",
  polygon: "polygon",
  star: "star",
}

export interface CanvasToolStore {
  get(): CanvasToolState
  set(patch: Partial<CanvasToolState>): void
  subscribe(listener: () => void): () => void
}

const stores = new WeakMap<UiStore, CanvasToolStore>()

export function canvasToolStore(ui: UiStore): CanvasToolStore {
  let s = stores.get(ui)
  if (s) return s
  let state: CanvasToolState = {
    placement: null,
    penHint: false,
    shape: "rectangle",
    polygonSides: 3,
    starPoints: 5,
    pathEdit: null,
  }
  const listeners = new Set<() => void>()
  s = {
    get: () => state,
    set(patch) {
      const next = { ...state, ...patch }
      if ((Object.keys(patch) as (keyof CanvasToolState)[]).every((k) => next[k] === state[k]))
        return
      state = next
      for (const l of listeners) l()
    },
    subscribe(l) {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  }
  stores.set(ui, s)
  // The slot shows the last-used shape: follow every tool change (keys or the flyout).
  const store = s
  ui.subscribe((u, prev) => {
    const shape = u.tool !== prev.tool ? SLOT_OF[u.tool] : undefined
    if (shape) store.set({ shape })
  })
  return s
}

/** The toolbar id of a UI-store tool in the shape slot, or null. */
export function slotToolId(tool: Tool): CanvasToolId | null {
  return SLOT_OF[tool] ?? null
}

/** React binding of {@link canvasToolStore}. */
export function useCanvasToolState(ui: UiStore): CanvasToolState {
  const s = canvasToolStore(ui)
  return useSyncExternalStore(s.subscribe, s.get)
}
