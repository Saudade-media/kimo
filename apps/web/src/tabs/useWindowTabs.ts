/**
 * Board 44 §5: wires this window's tabs to the App root: the runtime (sessions), the route,
 * ⌘T / ⌘W / ⌘⇧] / ⌘⇧[ / ⌘1…⌘9 (keys, and File › New tab / Close tab from the native menu), ⌘R
 * (desktop: reload the window, tabs kept) and the Last files record (General › On launch,
 * desktop).
 */
import type { KimoPlatform } from "@kimo/platform"
import { useEffect } from "react"
import { isUntitledRef } from "../platform/contract"
import { noteReloadTabs, noteWindowTabs } from "../platform/last-files"
import type { FileSessionManager } from "../platform/session"
import type { Route } from "../router"
import { matches } from "../shortcuts/shortcuts"
import type { TabRooms, TabsController } from "./controller"
import { savedTabs, type TabTarget, tabCommandFor } from "./model"

/**
 * What a route shows as a tab: a file, Home (null), or nothing tabbed (undefined). A joined room
 * is a tab on desktop (a `kimo://join` link opens next to the open files); the web keeps its
 * own join page.
 */
export function routeTarget(
  route: Route,
  platform: Pick<KimoPlatform, "kind">,
): TabTarget | null | undefined {
  switch (route.name) {
    case "disk":
      return { kind: "disk", ref: route.ref }
    case "file":
      return { kind: "file", id: route.id }
    case "join":
      return platform.kind === "browser" ? undefined : { kind: "join", link: route.link }
    case "home":
      return null
    default:
      return undefined
  }
}

export function useWindowTabs({
  tabs,
  route,
  manager,
  platform,
  rooms = null,
  enabled,
}: {
  tabs: TabsController
  route: Route
  manager: FileSessionManager
  platform: KimoPlatform
  /** The window's joined rooms (multiplayer join model): closing a room's tab leaves it. */
  rooms?: TabRooms | null
  /** False in the Settings window (no tabs there). */
  enabled: boolean
}): void {
  useEffect(
    () => (enabled ? tabs.attach(manager, platform) : undefined),
    [enabled, tabs, manager, platform],
  )

  // Desktop: a room joined from a link stays joined while its tab is open (#79).
  useEffect(
    () => (enabled && rooms && platform.kind !== "browser" ? tabs.attachRooms(rooms) : undefined),
    [enabled, tabs, rooms, platform],
  )

  const target = routeTarget(route, platform)
  const key = target === undefined ? "" : target === null ? "home" : JSON.stringify(target)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` identifies `target`.
  useEffect(() => {
    if (enabled && target !== undefined) tabs.route(target)
  }, [enabled, tabs, key])

  // Keys (web, Windows and Linux; on macOS ⌘T / ⌘W come from the menu below). Capture phase:
  // the canvas and panels must not swallow them.
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return
      const cmd = tabCommandFor(e)
      if (!cmd) return
      e.preventDefault()
      e.stopPropagation()
      tabs.run(cmd)
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [enabled, tabs])

  // ⌘R (desktop): reloads the window. Pending edits are written first; the tabs come back.
  useEffect(() => {
    if (!enabled || platform.kind === "browser") return
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || !matches("reloadWindow", e)) return
      e.preventDefault()
      e.stopPropagation()
      noteReloadTabs(savedTabs(tabs.getState(), (r) => !isUntitledRef(r)))
      void manager
        .flushAll()
        .catch(() => undefined)
        .finally(() => location.reload())
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [enabled, tabs, manager, platform])

  // macOS menu bar: File › New tab ⌘T / Close tab ⌘W.
  useEffect(() => {
    const menu = platform.menu
    if (!enabled || !menu) return
    return menu.onAction((a) => {
      if (a === "new-tab") tabs.run({ kind: "new" })
      else if (a === "close-tab") tabs.run({ kind: "close" })
    })
  }, [enabled, tabs, platform])

  // General › On launch = Last files: this window's tabs, in order, and the focused one.
  useEffect(() => {
    if (!enabled || platform.kind === "browser") return
    const label = platform.window.label
    const note = () =>
      noteWindowTabs(
        label,
        savedTabs(tabs.getState(), (r) => !isUntitledRef(r)),
      )
    note()
    return tabs.subscribe(note)
  }, [enabled, tabs, platform])
}
