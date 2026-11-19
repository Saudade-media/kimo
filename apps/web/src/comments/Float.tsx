/**
 * A comment popover (emoji picker, format and More menus, mention picker) floated in
 * document.body next to its trigger, so the thread's scrolling list or the composer never clips it.
 */
import { useAnchoredPosition } from "@kimo/ui"
import { type ReactNode, useEffect, useRef } from "react"
import { createPortal } from "react-dom"

export function Float({
  anchor,
  children,
  className,
  align = "start",
  offset = 6,
  onDismiss,
}: {
  anchor: HTMLElement | null
  children: ReactNode
  className?: string
  align?: "start" | "end"
  offset?: number
  /** Pointerdown outside the float and outside its anchor. */
  onDismiss?(): void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const pos = useAnchoredPosition(ref, anchor, { side: "bottom", align, offset, padding: 8 })
  const dismiss = useRef(onDismiss)
  dismiss.current = onDismiss
  useEffect(() => {
    if (!anchor) return
    const close = (e: PointerEvent) => {
      const target = e.target as Node | null
      if (!target || ref.current?.contains(target) || anchor.contains(target)) return
      dismiss.current?.()
    }
    // Escape closes the float first, before comment mode's own Escape (closes the thread).
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || !dismiss.current) return
      e.preventDefault()
      dismiss.current()
    }
    window.addEventListener("pointerdown", close, true)
    window.addEventListener("keydown", key, true)
    return () => {
      window.removeEventListener("pointerdown", close, true)
      window.removeEventListener("keydown", key, true)
    }
  }, [anchor])
  if (!anchor) return null
  return createPortal(
    <div
      ref={ref}
      className={className ? `comment-float ${className}` : "comment-float"}
      style={{ left: pos?.x ?? 0, top: pos?.y ?? 0, visibility: pos?.ready ? undefined : "hidden" }}
    >
      {children}
    </div>,
    anchor.ownerDocument.body,
  )
}
