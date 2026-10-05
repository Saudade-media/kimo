/**
 * The launch loader (desing.pen board 29 "Launch loader", vIK2m) is static markup + CSS in
 * index.html (`#kimo-launch`, a sibling of `#root`), on screen from first paint. This module is
 * the JS side once the bundle runs:
 *
 * - {@link setLaunchStatus}: the mono status line under the mark ("Starting…" by default, e.g.
 *   "Opening landing.kimo…"). The CSS keeps it invisible until 3 s whatever the copy.
 * - {@link hideLaunchLoader}: rule "Exit" — opacity 1 → 0 in 180 ms ease-out (the transition
 *   lives in index.html), then the element is removed. Idempotent.
 * - {@link LaunchLoaderExit}: rendered once by main.tsx; hides the loader after React's first
 *   commit.
 */
import { useEffect } from "react"

export const LAUNCH_LOADER_ID = "kimo-launch"
/** The exit transition (index.html `#kimo-launch` transition: opacity 180ms ease-out). */
export const LAUNCH_EXIT_MS = 180
/** Removal fallback when `transitionend` never fires (hidden window, display none). */
const REMOVE_FALLBACK_MS = 400

let leaving: Promise<void> | null = null

const loader = (): HTMLElement | null =>
  typeof document === "undefined" ? null : document.getElementById(LAUNCH_LOADER_ID)

/** Sets the loader's status line; a no-op once the loader is gone. */
export function setLaunchStatus(text: string): void {
  const status = loader()?.querySelector(".kimo-launch__status")
  if (status) status.textContent = text
}

/** Fades the loader out and removes it. Resolves once it is out of the DOM. */
export function hideLaunchLoader(): Promise<void> {
  const el = loader()
  if (!el) return Promise.resolve()
  if (el.classList.contains("is-leaving")) return leaving ?? Promise.resolve()
  leaving = new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer)
      el.removeEventListener("transitionend", onEnd)
      el.remove()
      resolve()
    }
    const onEnd = (e: TransitionEvent) => {
      if (e.target === el && e.propertyName === "opacity") done()
    }
    const timer = setTimeout(done, REMOVE_FALLBACK_MS)
    // Not rendered (the document host turns it off): nothing to fade.
    if (getComputedStyle(el).display === "none") return done()
    el.addEventListener("transitionend", onEnd)
    el.classList.add("is-leaving")
  })
  return leaving
}

/** Hides the launch loader once the app has committed its first render. Renders nothing. */
export function LaunchLoaderExit(): null {
  useEffect(() => {
    void hideLaunchLoader()
  }, [])
  return null
}
