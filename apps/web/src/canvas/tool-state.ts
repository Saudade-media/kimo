/**
 * Canvas tool state shared between the canvas host and the floating toolbar without routing it
 * through the shell: the armed image placement (the toolbar shows Image active while armed) and
 * whether the pen's "Click to add points" hint is showing (board 10 #7: shown while the pen is
 * armed, fades after the first anchor). One small store per UI store (one per editor session).
 */
import { useSyncExternalStore } from "react"
import type { ImagePlacement, UiStore } from "./contract"

export interface CanvasToolState {
  placement: ImagePlacement | null
  /** Pen armed and no anchor placed yet. */
  penHint: boolean
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
  let state: CanvasToolState = { placement: null, penHint: false }
  const listeners = new Set<() => void>()
  s = {
    get: () => state,
    set(patch) {
      const next = { ...state, ...patch }
      if (next.placement === state.placement && next.penHint === state.penHint) return
      state = next
      for (const l of listeners) l()
    },
    subscribe(l) {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  }
  stores.set(ui, s)
  return s
}

/** React binding of {@link canvasToolStore}. */
export function useCanvasToolState(ui: UiStore): CanvasToolState {
  const s = canvasToolStore(ui)
  return useSyncExternalStore(s.subscribe, s.get)
}
