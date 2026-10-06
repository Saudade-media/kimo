/**
 * Home side of board 37 §9: a grid card's preview as an object URL, read from the store once
 * the card nears the viewport (lazy), re-read when the preview changes (`onThumbnail`) or the
 * file does (`version`: its modified time).
 */
import type { ThumbnailsApi } from "@kimo/platform"
import { useCallback, useEffect, useRef, useState } from "react"
import { onThumbnail } from "./store"

/** Starts `fn` once `el` is within 200px of the viewport; returns a cancel. */
function whenNearViewport(el: Element, fn: () => void): () => void {
  if (typeof IntersectionObserver !== "function") {
    fn()
    return () => {}
  }
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect()
        fn()
      }
    },
    { rootMargin: "200px" },
  )
  io.observe(el)
  return () => io.disconnect()
}

export interface FileThumbnail {
  /** Attach to the card: the preview is read once it nears the viewport. */
  ref: (el: Element | null) => void
  /** The preview's object URL, or null (no preview yet: the card shows its placeholder). */
  src: string | null
}

/** The preview of `key` (a path on disk or a library file id) in `store`. */
export function useFileThumbnail(
  store: ThumbnailsApi | null,
  key: string,
  version?: number,
): FileThumbnail {
  const [el, setEl] = useState<Element | null>(null)
  const [visible, setVisible] = useState(false)
  const [src, setSrc] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const current = useRef<string | null>(null)
  const ref = useCallback((node: Element | null) => setEl(node), [])

  useEffect(() => {
    if (!el || visible) return
    return whenNearViewport(el, () => setVisible(true))
  }, [el, visible])

  useEffect(() => onThumbnail((k) => k === key && setTick((t) => t + 1)), [key])

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` / `tick` re-read the preview
  useEffect(() => {
    if (!store || !visible) return
    let live = true
    void store
      .read(key)
      .then((png) => {
        if (!live) return
        const url = png
          ? URL.createObjectURL(new Blob([png as BlobPart], { type: "image/png" }))
          : null
        // The previous preview stays until the new one is ready (no placeholder flash).
        if (current.current) URL.revokeObjectURL(current.current)
        current.current = url
        setSrc(url)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [store, key, visible, version, tick])

  useEffect(
    () => () => {
      if (current.current) URL.revokeObjectURL(current.current)
      current.current = null
    },
    [],
  )

  return { ref, src }
}
