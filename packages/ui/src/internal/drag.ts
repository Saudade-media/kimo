import { type PointerEvent, useEffect, useRef } from "react"

/** A drag sample in the element's own box: `fx`/`fy` are 0–1 fractions (clamped). */
export interface DragSample {
  x: number
  y: number
  fx: number
  fy: number
  rect: DOMRect
  shiftKey: boolean
  altKey: boolean
}

export interface PointerDragOptions {
  /** Inset (px) of the usable range on each side, e.g. 7 for a 14px thumb kept inside. */
  insetX?: number
  insetY?: number
  /** Gesture start (pointerdown accepted). Hosts open an undo group here. */
  onStart?: (s: DragSample) => void
  /** Every pointer sample, including the pointerdown one. */
  onDrag: (s: DragSample) => void
  /** Gesture end (pointerup / cancel / lost capture). Hosts close the undo group here. */
  onEnd?: () => void
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n)

/**
 * Pointer-capture drag on an element (sliders, the color area, gradient stops): one gesture
 * per press, with `onStart`/`onEnd` bracketing it so the host makes one undo step per drag.
 */
export function usePointerDrag<E extends HTMLElement>(options: PointerDragOptions) {
  const opts = useRef(options)
  opts.current = options
  const active = useRef<number | null>(null)
  // Unmounted mid-drag (Escape closes the popover holding the slider): the element's own
  // pointerup / lostpointercapture never reach React, so end the gesture here. Otherwise the
  // host's undo group stays open and swallows the next, unrelated edit.
  useEffect(
    () => () => {
      if (active.current === null) return
      active.current = null
      opts.current.onEnd?.()
    },
    [],
  )

  const sample = (e: PointerEvent<E>, el: E): DragSample => {
    const rect = el.getBoundingClientRect()
    const ix = opts.current.insetX ?? 0
    const iy = opts.current.insetY ?? 0
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    return {
      x,
      y,
      fx: clamp01((x - ix) / Math.max(1, rect.width - 2 * ix)),
      fy: clamp01((y - iy) / Math.max(1, rect.height - 2 * iy)),
      rect,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
    }
  }

  const end = (e: PointerEvent<E>) => {
    if (active.current !== e.pointerId) return
    active.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId)
    opts.current.onEnd?.()
  }

  return {
    onPointerDown: (e: PointerEvent<E>) => {
      if (e.button !== 0 || active.current !== null) return
      e.preventDefault()
      const el = e.currentTarget
      el.setPointerCapture(e.pointerId)
      el.focus({ preventScroll: true })
      active.current = e.pointerId
      const s = sample(e, el)
      opts.current.onStart?.(s)
      opts.current.onDrag(s)
    },
    onPointerMove: (e: PointerEvent<E>) => {
      if (active.current !== e.pointerId) return
      opts.current.onDrag(sample(e, e.currentTarget))
    },
    onPointerUp: end,
    onPointerCancel: end,
    onLostPointerCapture: end,
  }
}
