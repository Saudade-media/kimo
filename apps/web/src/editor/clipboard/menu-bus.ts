/**
 * Board 27 §2 (g1jiG): layer rows open the same context menu as the canvas. The Layers panel
 * asks; the canvas menu hook (CanvasMenu.tsx) listens, per document store.
 */
import type { DocStore } from "@kimo/editor-state"

type Opener = (x: number, y: number) => void
const openers = new WeakMap<DocStore, Opener>()

/** The canvas menu registers how to open itself at a client point for `store`'s editor. */
export function registerRowMenu(store: DocStore, open: Opener): () => void {
  openers.set(store, open)
  return () => {
    if (openers.get(store) === open) openers.delete(store)
  }
}

/** Opens the canvas context menu for the current selection at client point (x, y). */
export function openRowMenu(store: DocStore, x: number, y: number): boolean {
  const open = openers.get(store)
  if (!open) return false
  open(x, y)
  return true
}
