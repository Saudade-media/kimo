/**
 * Editor UI state (teardown 9.2 "UI state": selection, tool, viewport) in a vanilla Zustand
 * store. It is deliberately separate from the document: nothing here is persisted to the
 * `.kimo` file, synced to peers or tracked by undo. React apps bind to it with
 * `useStore(uiStore, selector)` from `zustand`.
 */
import { createStore, type StoreApi } from "zustand/vanilla"
import type { DocStore } from "./types"

/** Canvas tools. */
export type Tool =
  | "select"
  | "hand"
  | "frame"
  | "rect"
  | "ellipse"
  | "polygon"
  | "path"
  | "text"
  | "icon"
  | "note"

/**
 * The visible region: `x`/`y` are the world coordinates shown at the canvas's top-left corner;
 * `zoom` is screen pixels per world unit. `screen = (world - {x, y}) * zoom`.
 */
export interface Viewport {
  x: number
  y: number
  zoom: number
}

/** Zoom limits (2% … 25600%). */
export const MIN_ZOOM = 0.02
export const MAX_ZOOM = 256

/** UI state and its actions. */
export interface UiState {
  /** Selected node ids, in selection order. */
  selection: readonly string[]
  /** Node under the pointer. */
  hovered: string | null
  tool: Tool
  viewport: Viewport

  select(ids: readonly string[]): void
  /** Adds ids not yet selected (shift-click). */
  addToSelection(ids: readonly string[]): void
  /** Toggles one id. */
  toggleSelection(id: string): void
  clearSelection(): void
  setHovered(id: string | null): void
  setTool(tool: Tool): void
  setViewport(viewport: Partial<Viewport>): void
  /** Pans by a screen-space delta. */
  panBy(dx: number, dy: number): void
  /** Sets the zoom (clamped), keeping the world point under screen point (`sx`, `sy`) fixed. */
  zoomAt(sx: number, sy: number, zoom: number): void
}

/** Initial values for {@link createUiStore}. */
export type UiInit = Partial<Pick<UiState, "selection" | "hovered" | "tool" | "viewport">>

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
const unique = (ids: readonly string[]) => [...new Set(ids)]

/** Creates a UI store. Framework-agnostic (no React import). */
export function createUiStore(init: UiInit = {}): StoreApi<UiState> {
  return createStore<UiState>()((set, get) => ({
    selection: unique(init.selection ?? []),
    hovered: init.hovered ?? null,
    tool: init.tool ?? "select",
    viewport: { x: 0, y: 0, zoom: 1, ...init.viewport },

    select: (ids) => set({ selection: unique(ids) }),
    addToSelection: (ids) => set({ selection: unique([...get().selection, ...ids]) }),
    toggleSelection: (id) => {
      const s = get().selection
      set({ selection: s.includes(id) ? s.filter((x) => x !== id) : [...s, id] })
    },
    clearSelection: () => set({ selection: [] }),
    setHovered: (id) => set({ hovered: id }),
    setTool: (tool) => set({ tool }),
    setViewport: (v) => {
      const next = { ...get().viewport, ...v }
      next.zoom = clampZoom(next.zoom)
      set({ viewport: next })
    },
    panBy: (dx, dy) => {
      const v = get().viewport
      set({ viewport: { ...v, x: v.x - dx / v.zoom, y: v.y - dy / v.zoom } })
    },
    zoomAt: (sx, sy, zoom) => {
      const v = get().viewport
      const z = clampZoom(zoom)
      const wx = v.x + sx / v.zoom
      const wy = v.y + sy / v.zoom
      set({ viewport: { x: wx - sx / z, y: wy - sy / z, zoom: z } })
    },
  }))
}

/**
 * Keeps UI state consistent with the document: drops deleted nodes from the selection and
 * clears `hovered` when its node disappears. Returns an unsubscribe function.
 */
export function bindUiToDocument(ui: StoreApi<UiState>, doc: DocStore): () => void {
  return doc.onChange((change) => {
    const { selection, hovered } = ui.getState()
    const kept = selection.filter((id) => !change.nodes.has(id) || doc.hasNode(id))
    const patch: Partial<UiState> = {}
    if (kept.length !== selection.length) patch.selection = kept
    if (hovered !== null && change.nodes.has(hovered) && !doc.hasNode(hovered)) patch.hovered = null
    if (Object.keys(patch).length > 0) ui.setState(patch)
  })
}
