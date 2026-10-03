/**
 * React bindings for the M4 session layer: session state, the session list, window chrome
 * (traffic-light inset, focus, fullscreen) and Home's recents / watched folders.
 */
import type { KimoPlatform, RecentFile, WatchedFolder } from "@kimo/platform"
import { useEffect, useState, useSyncExternalStore } from "react"
import type { SessionState } from "../platform/contract"
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
    return () => {
      a()
      b()
    }
  }
  const focused = useSyncExternalStore(subscribe, () => platform.window.isFocused())
  const fullscreen = useSyncExternalStore(subscribe, () => platform.window.isFullscreen())
  const inset = useSyncExternalStore(subscribe, () => platform.window.trafficLightInset())
  return { inset, focused, fullscreen, drawLights: platform.kind !== "desktop" }
}

/** Recent files and watched folders (Home, board 16), refreshed on `recents.onChange`. */
export function useRecents(
  platform: KimoPlatform,
  limit = 50,
): { files: RecentFile[] | null; folders: WatchedFolder[] | null; error: string | null } {
  const [files, setFiles] = useState<RecentFile[] | null>(null)
  const [folders, setFolders] = useState<WatchedFolder[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    const load = () => {
      Promise.all([platform.recents.listFiles({ limit }), platform.recents.listFolders()])
        .then(([f, d]) => {
          if (!live) return
          setFiles(f)
          setFolders(d)
          setError(null)
        })
        .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)))
    }
    load()
    const off = platform.recents.onChange(load)
    return () => {
      live = false
      off()
    }
  }, [platform, limit])
  return { files, folders, error }
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
