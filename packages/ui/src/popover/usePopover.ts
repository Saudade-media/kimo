import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { anchoredPosition, type PlacementOptions, type Rect } from "./position"

/** What a floating surface is anchored to: a live element (preferred) or a fixed rect. */
export type PopoverAnchor = HTMLElement | DOMRect | Rect | null | undefined

const isElement = (a: PopoverAnchor): a is HTMLElement =>
  typeof HTMLElement !== "undefined" && a instanceof HTMLElement

const rectOf = (a: HTMLElement | DOMRect | Rect): Rect => {
  const r = isElement(a) ? a.getBoundingClientRect() : a
  return { x: r.x, y: r.y, width: r.width, height: r.height }
}

/**
 * Surfaces a floating one stays inside: a dialog, popover, menu or tooltip already floats above
 * the page, and a nested element with its own `data-theme` (the gallery) keeps its theme.
 */
const LAYER =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="tooltip"], :not(html)[data-theme]'

/**
 * Renders an anchored surface where nothing can cover it: in `document.body` when its anchor
 * element sits outside every {@link LAYER}, since a panel's stacking context (Workspace v2's
 * cards are `z-index: 3` siblings) traps a `position: fixed` child under the other panel. In
 * place inside a layer (it stacks above its parent there, and stays in its DOM for outside
 * clicks), for a rect anchor, and without an anchor.
 */
export function floating(node: ReactNode, anchor: PopoverAnchor): ReactNode {
  if (!isElement(anchor) || anchor.closest(LAYER)) return node
  return createPortal(node, anchor.ownerDocument.body)
}

/**
 * `position: fixed` coordinates for `ref` next to `anchor` (see {@link anchoredPosition}).
 * Re-measures on window resize and on any scroll (capture), so it follows a scrolled panel.
 * Returns `undefined` without an anchor: the surface then renders in flow (gallery, tests).
 */
export function useAnchoredPosition(
  ref: RefObject<HTMLElement | null>,
  anchor: PopoverAnchor,
  options: PlacementOptions = {},
): { x: number; y: number; ready: boolean } | undefined {
  const [pos, setPos] = useState<{ x: number; y: number; ready: boolean }>({
    x: 0,
    y: 0,
    ready: false,
  })
  const { side, align, offset, padding, flip } = options
  useLayoutEffect(() => {
    if (!anchor) return
    const update = () => {
      const el = ref.current
      if (!el) return
      const box = el.getBoundingClientRect()
      const p = anchoredPosition(
        rectOf(anchor),
        { width: box.width, height: box.height },
        { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
        { side, align, offset, padding, flip },
      )
      setPos((prev) =>
        prev.ready && prev.x === p.x && prev.y === p.y ? prev : { x: p.x, y: p.y, ready: true },
      )
    }
    update()
    window.addEventListener("resize", update)
    window.addEventListener("scroll", update, true)
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : undefined
    if (ref.current) ro?.observe(ref.current)
    return () => {
      window.removeEventListener("resize", update)
      window.removeEventListener("scroll", update, true)
      ro?.disconnect()
    }
  }, [anchor, ref, side, align, offset, padding, flip])

  return anchor ? pos : undefined
}

/** Focused elements that handle Escape themselves (never dismissed over). */
const OWN_ESCAPE =
  'input, textarea, select, [contenteditable="true"], [role="menu"], [role="listbox"], [role="dialog"], [role="alertdialog"]'

/** Open dismissable surfaces, oldest first: Escape outside every surface closes the topmost. */
const openSurfaces: RefObject<HTMLElement | null>[] = []

/**
 * Closes a floating surface on a pointerdown outside it (and outside its anchor element, so
 * the trigger can toggle). Escape with focus inside a surface is handled by that surface's own
 * keydown handler, which stops propagation, so a menu open inside a popover closes alone.
 * Escape while focus is outside every open surface (on the trigger, or on `body` after a click
 * on a non-focusable area) closes the topmost surface only and never reaches the canvas.
 */
export function useDismiss(
  ref: RefObject<HTMLElement | null>,
  onClose: (() => void) | undefined,
  anchor?: PopoverAnchor,
  enabled = true,
): void {
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    if (!enabled) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null
      if (!t || ref.current?.contains(t)) return
      if (isElement(anchor) && anchor.contains(t)) return
      close.current?.()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return
      if (openSurfaces[openSurfaces.length - 1] !== ref) return
      const active = document.activeElement
      // Focus inside some surface: its own handler decides (nested surfaces stop propagation).
      if (active && openSurfaces.some((s) => s.current?.contains(active))) return
      // Focus in a control or widget that handles Escape itself (a text field reverting its
      // draft, another menu or dialog): leave the key to it.
      if (active instanceof HTMLElement && active.closest(OWN_ESCAPE)) return
      e.preventDefault()
      e.stopPropagation()
      close.current?.()
    }
    openSurfaces.push(ref)
    document.addEventListener("pointerdown", onDown, true)
    document.addEventListener("keydown", onKey, true)
    return () => {
      const i = openSurfaces.lastIndexOf(ref)
      if (i >= 0) openSurfaces.splice(i, 1)
      document.removeEventListener("pointerdown", onDown, true)
      document.removeEventListener("keydown", onKey, true)
    }
  }, [ref, anchor, enabled])
}

const FOCUSABLE =
  'button:not([disabled]):not([tabindex="-1"]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Tabbable descendants of `root`, in DOM order (hidden ones excluded). */
export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.closest("[hidden]") && el.getAttribute("aria-hidden") !== "true",
  )
}

/**
 * Keeps Tab / Shift+Tab inside `root` (APG dialog pattern). Returns the keydown handler to put
 * on the root. Focus moves into the surface on mount (`initial`: `"first"` tabbable or the
 * `"root"` itself) and returns to the previously focused element on unmount.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  initial: "first" | "root" | "none" | RefObject<HTMLElement | null> = "root",
  ready = true,
): (e: { key: string; shiftKey: boolean; preventDefault(): void }) => void {
  // Focus returns to the opener on unmount.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    return () => {
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true })
    }
  }, [])
  // Initial focus once the surface is visible: an anchored surface renders
  // `visibility: hidden` until its position is measured, and focus() on it is then a no-op.
  const moved = useRef(false)
  useEffect(() => {
    if (!ready || moved.current) return
    moved.current = true
    const root = ref.current
    if (!root || initial === "none") return
    const target =
      typeof initial === "object"
        ? (initial.current ?? root)
        : initial === "first"
          ? (focusables(root)[0] ?? root)
          : root
    target.focus({ preventScroll: true })
  }, [ref, initial, ready])

  return (e) => {
    if (e.key !== "Tab") return
    const root = ref.current
    if (!root) return
    const list = focusables(root)
    if (list.length === 0) {
      e.preventDefault()
      return
    }
    const first = list[0] as HTMLElement
    const last = list[list.length - 1] as HTMLElement
    const active = document.activeElement
    if (e.shiftKey && (active === first || active === root)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (active === last || active === root)) {
      e.preventDefault()
      first.focus()
    }
  }
}
