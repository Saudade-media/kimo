/**
 * Light/dark mode for the editor chrome. `@kimo/design-tokens/editor.css` switches every
 * `--kimo-*` color on `[data-theme]`, so the toggle only sets that attribute on <html>
 * (boards "03 Editor — Light" / "05 Editor — Agent — Dark").
 */
import { useSyncExternalStore } from "react"

export type ThemeMode = "light" | "dark"

const KEY = "kimo.theme"
const listeners = new Set<() => void>()

function read(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY)
    if (v === "light" || v === "dark") return v
  } catch {
    // Storage blocked: fall back to the system preference.
  }
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light"
}

let mode: ThemeMode = typeof document === "undefined" ? "light" : read()

/** Applies the stored mode to <html>. Call once at startup. */
export function initTheme(): void {
  document.documentElement.dataset.theme = mode
}

export function getTheme(): ThemeMode {
  return mode
}

export function setTheme(next: ThemeMode): void {
  mode = next
  document.documentElement.dataset.theme = next
  try {
    localStorage.setItem(KEY, next)
  } catch {
    // Not persisted; the attribute still applies for this session.
  }
  for (const l of listeners) l()
}

export const toggleTheme = () => setTheme(mode === "light" ? "dark" : "light")

export function useTheme(): ThemeMode {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    getTheme,
    () => "light",
  )
}

/** Reads a `--kimo-*` token's computed value (for canvas overlay colors). */
export function cssToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}
