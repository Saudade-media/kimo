/**
 * Per-browser user settings (localStorage). `webFonts`: whether the canvas may fetch font
 * families a document uses from Google Fonts. Opening an untrusted `.kimo` otherwise sends its
 * font names and the user's IP to a third party (teardown 9.2 "no third-party fetch");
 * turning it off maps to the renderer's `offlineFonts` (bundled fonts and fallbacks only).
 */
import { useSyncExternalStore } from "react"

const KEY = "kimo.webFonts"
const listeners = new Set<() => void>()

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off"
  } catch {
    return true
  }
}

let webFonts = typeof window === "undefined" ? true : read()

export function getWebFonts(): boolean {
  return webFonts
}

export function setWebFonts(on: boolean): void {
  webFonts = on
  try {
    localStorage.setItem(KEY, on ? "on" : "off")
  } catch {
    // Not persisted; applies to this session.
  }
  for (const l of listeners) l()
}

export function useWebFonts(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    getWebFonts,
    () => true,
  )
}
