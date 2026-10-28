/**
 * React bindings for the M4 session layer: session state, the session list and window chrome
 * (traffic-light inset, focus, fullscreen).
 */
import type { KimoPlatform } from "@kimo/platform"
import { useEffect, useState, useSyncExternalStore } from "react"
import { type SessionState, type TabTitleInput, tabTitle } from "../platform/contract"
import type { FileDocumentSession, FileSessionManager } from "../platform/session"

/** The session's state, re-rendered on every change. */
export function useSessionState(session: FileDocumentSession): SessionState {
  const [state, setState] = useState(() => session.state())
  useEffect(() => {
    setState(session.state())
    return session.subscribe(setState)
  }, [session])
  return state
}

/** The manager's open sessions. */
export function useSessions(manager: FileSessionManager): FileDocumentSession[] {
  const [list, setList] = useState(() => manager.sessions())
  useEffect(() => {
    setList(manager.sessions())
    return manager.subscribe(() => setList(manager.sessions()))
  }, [manager])
  return list
}

export interface WindowChromeState {
  /** `platform.window.trafficLightInset()`: 68 / 4 (fullscreen) / 0. */
  inset: number
  focused: boolean
  fullscreen: boolean
  /** Draw the lights ourselves: never on desktop (macOS draws them), yes elsewhere when inset. */
  drawLights: boolean
}

/** Traffic-light inset and window focus, kept current. */
export function useWindowChrome(platform: KimoPlatform): WindowChromeState {
  const subscribe = (cb: () => void) => {
    const a = platform.window.onFocusChange(cb)
    const b = platform.window.onFullscreenChange(cb)
    const c = platform.window.onTrafficLightInsetChange(cb)
    return () => {
      a()
      b()
      c()
    }
  }
  const focused = useSyncExternalStore(subscribe, () => platform.window.isFocused())
  const fullscreen = useSyncExternalStore(subscribe, () => platform.window.isFullscreen())
  const inset = useSyncExternalStore(subscribe, () => platform.window.trafficLightInset())
  return { inset, focused, fullscreen, drawLights: platform.kind !== "desktop" }
}

/** A clock that re-renders every `ms` (relative "12 min ago" labels). */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

/**
 * Board 24 (m) web tab title for an editor that has no document session (the browser library,
 * IndexedDB): `[●] {file} [· state] — Kimo`; back to "Kimo" on unmount. Desktop windows keep the
 * board 20 window title (`editor/disk.tsx` `useWindowTitle`).
 */
export function useWebTabTitle(platform: KimoPlatform, input: TabTitleInput | null): void {
  const title = input ? tabTitle(input) : null
  useEffect(() => {
    if (platform.kind === "desktop" || title === null) return
    void platform.window.setTitle(title).catch(() => {})
  }, [platform, title])
  useEffect(() => {
    if (platform.kind === "desktop") return
    return () => {
      void platform.window.setTitle("Kimo").catch(() => {})
    }
  }, [platform])
}
