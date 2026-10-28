/**
 * Board 44 §5 rule "Collapse": which floating cards are collapsed to their header pill. The
 * header button collapses one card, ⌘\ toggles both, View › Show left panel / Show right panel.
 * State is kept per window: one store per webview (a desktop window or a browser tab), mirrored
 * to `sessionStorage` so a reload of the same window keeps it.
 */
import { useSyncExternalStore } from "react"

interface PanelsState {
  /** The left card (Layers) is collapsed to its header. */
  left: boolean
  /** The right card (Design / Code / Agent) is collapsed to its header. */
  right: boolean
}

const KEY = "kimo.panels.collapsed"
const OPEN: PanelsState = { left: false, right: false }

function read(): PanelsState {
  try {
    const raw = globalThis.sessionStorage?.getItem(KEY)
    if (!raw) return OPEN
    const v = JSON.parse(raw) as Partial<PanelsState>
    return { left: v.left === true, right: v.right === true }
  } catch {
    return OPEN
  }
}

let state: PanelsState | null = null
const listeners = new Set<() => void>()

function current(): PanelsState {
  state ??= read()
  return state
}

/** Replaces the collapsed state (and stores it for this window). */
function setPanels(next: PanelsState): void {
  const prev = current()
  if (prev.left === next.left && prev.right === next.right) return
  state = { left: next.left, right: next.right }
  try {
    globalThis.sessionStorage?.setItem(KEY, JSON.stringify(state))
  } catch {
    // Storage blocked: the state still holds for this window's lifetime.
  }
  for (const l of [...listeners]) l()
}

/** Collapses or expands one card. */
export function togglePanel(side: keyof PanelsState): void {
  const s = current()
  setPanels({ ...s, [side]: !s[side] })
}

/** ⌘\: with either card open both collapse; with both collapsed both open. */
export function toggleBothPanels(): void {
  const s = current()
  const collapse = !s.left || !s.right
  setPanels({ left: collapse, right: collapse })
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** The collapsed state of this window's cards, kept current. */
export function usePanels(): PanelsState {
  return useSyncExternalStore(subscribe, current, current)
}
