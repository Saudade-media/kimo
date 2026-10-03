import { type RefObject, useLayoutEffect, useState } from "react"

/**
 * Shortens `text` to fit `maxWidth` by cutting its middle ("~/Work/kimo…/design"), keeping
 * the start and the end (02d: "paths are always mono, middle-truncated").
 */
export function middleTruncate(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
): string {
  if (maxWidth <= 0 || measure(text) <= maxWidth) return text
  let lo = 0
  let hi = text.length - 1
  let best = "…"
  while (lo <= hi) {
    const keep = (lo + hi) >> 1
    const head = Math.ceil(keep / 2)
    const candidate = `${text.slice(0, head)}…${text.slice(text.length - (keep - head))}`
    if (measure(candidate) <= maxWidth) {
      best = candidate
      lo = keep + 1
    } else hi = keep - 1
  }
  return best
}

let canvas: HTMLCanvasElement | null = null

/** {@link middleTruncate} bound to an element's width and computed font; re-runs on resize. */
export function useMiddleTruncate(ref: RefObject<HTMLElement | null>, text: string): string {
  const [shown, setShown] = useState(text)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof document === "undefined") {
      setShown(text)
      return
    }
    const run = () => {
      canvas ??= document.createElement("canvas")
      const ctx = canvas.getContext("2d")
      const box = el.parentElement ?? el
      if (!ctx) return setShown(text)
      ctx.font = getComputedStyle(el).font
      setShown(middleTruncate(text, box.clientWidth, (s) => ctx.measureText(s).width))
    }
    run()
    if (typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(run)
    ro.observe(el.parentElement ?? el)
    return () => ro.disconnect()
  }, [ref, text])
  return shown
}
