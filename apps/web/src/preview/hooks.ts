/**
 * Board 27 §9 (b) mtgng: the topbar Preview button's live target — the name of the frame
 * Preview would open (tooltip "Preview “<name>”"), or null when the page has no top-level
 * frame (button disabled at 40 %).
 */
import type { DocStore } from "@kimo/editor-state"
import { useSyncExternalStore } from "react"
import type { UiStore } from "../canvas/contract"
import { frameName, pickPreviewFrame } from "./model"

export function usePreviewTarget(
  store: DocStore,
  ui: UiStore,
  roots?: () => readonly string[],
): string | null {
  return useSyncExternalStore(
    (notify) => {
      const offStore = store.onChange(notify)
      const offUi = ui.subscribe((s, prev) => {
        if (s.selection !== prev.selection) notify()
      })
      return () => {
        offStore()
        offUi()
      }
    },
    () => {
      const id = pickPreviewFrame(store, ui.getState().selection, roots?.())
      return id ? frameName(store, id) : null
    },
  )
}
