/**
 * App root: hash routing between Home (`#/`), the editor (`#/file/:id` for the browser library,
 * `#/disk/<ref>` for a `.kimo` on disk), the desktop Settings window (`#/settings/<pane>`) and
 * the @kimo/ui component gallery (`#/gallery`). The gallery (and its demo boards/icons) is a lazy
 * chunk so it never ships in the editor's main bundle.
 *
 * Window-wide M4 hosts live here: the launch recovery dialog (board 17), the web Settings dialog
 * and ⌘, (board 19), and the updater toasts (board 19, desktop only).
 */
import type { SettingsPane } from "@kimo/platform"
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { DiskEditor, Editor } from "./editor/Editor"
import { RecoveryDialog, RestoredToasts } from "./files"
import { Home } from "./home/Home"
import { HandoffGate } from "./join/Handoff"
import { JoinRoute } from "./join/JoinRoute"
import { useJoinRoute } from "./join/useJoinRoute"
import { useHash } from "./lib/hooks"
import { type ThemeMode, useTheme } from "./lib/theme"
import { PairRoute } from "./pair/PairRoute"
import { usePairRoute } from "./pair/usePairRoute"
import { isUntitledRef } from "./platform/contract"
import { noteWindowFile } from "./platform/last-files"
import { SettingsOpenerContext, useRuntime } from "./platform/runtime"
import type { FileDocumentSession } from "./platform/session"
import { diskPath, navigate, parseRoute } from "./router"
import {
  HelpHost,
  openSettings,
  SettingsDialog,
  SettingsRoute,
  useSettingsShortcut,
} from "./settings"
import { ShortcutsSheetHost } from "./shortcuts"
import { createUpdaterController, UpdateToastHost } from "./updater"
import { serveFlushRequests } from "./updater/restart-broadcast"

/** Dev builds and the e2e bundle (`VITE_KIMO_DEBUG=1`) only; never in a release. */
const GALLERY_ENABLED = import.meta.env.DEV || import.meta.env.VITE_KIMO_DEBUG === "1"

// A release build drops the chunk entirely (the condition is static).
const Gallery = GALLERY_ENABLED
  ? lazy(() => import("@kimo/ui/gallery").then((m) => ({ default: m.Gallery })))
  : null

export function App() {
  const hash = useHash()
  const route = usePairRoute(useJoinRoute(parseRoute(hash), hash), hash)
  const theme = useTheme()
  const { platform, manager } = useRuntime()
  const [settingsPane, setSettingsPane] = useState<{
    pane: SettingsPane
    focus: string | null
  } | null>(null)
  const [recovery, setRecovery] = useState(
    route.name !== "settings" && route.name !== "join" && route.name !== "pair",
  )
  const [restored, setRestored] = useState<FileDocumentSession[]>([])
  const showDialog = useCallback((pane: SettingsPane) => setSettingsPane({ pane, focus: null }), [])
  useSettingsShortcut(platform, showDialog)
  const opener = useCallback(
    (pane: SettingsPane = "general", focus: string | null = null) =>
      void openSettings(platform, pane, focus).then((how) => {
        if (how === "dialog") setSettingsPane({ pane, focus })
      }),
    [platform],
  )

  // Updater (desktop): restart only after every open file flushed (board 19 wsHiA / aF0vX).
  const settingsWindow = route.name === "settings"
  const updater = useMemo(
    () =>
      platform.capabilities.updater && !settingsWindow
        ? createUpdaterController({ platform, flushAll: () => manager.flushAll() })
        : null,
    [platform, manager, settingsWindow],
  )
  useEffect(() => {
    if (!updater) return
    updater.start()
    return () => updater.dispose()
  }, [updater])

  // Settings › Updates › Restart to update (board 37 D10): this window saves its files first.
  useEffect(() => {
    if (platform.kind === "browser" || settingsWindow) return
    return serveFlushRequests(platform.window.label, () => manager.flushAll())
  }, [platform, manager, settingsWindow])

  // General › On launch: remember the file this desktop window shows (reopened after a quit).
  const shownRef = route.name === "disk" && !isUntitledRef(route.ref) ? route.ref : null
  useEffect(() => {
    if (platform.kind === "browser" || settingsWindow) return
    noteWindowFile(platform.window.label, shownRef)
  }, [platform, shownRef, settingsWindow])

  if (route.name === "settings") return <SettingsRoute platform={platform} hash={hash} />

  return (
    <SettingsOpenerContext.Provider value={opener}>
      <Routed route={route} theme={theme} />
      {recovery && (
        <RecoveryDialog
          manager={manager}
          onOpened={(s) => navigate(diskPath(s.ref))}
          onRestoredAll={([first, ...others]) => {
            if (first) navigate(diskPath(first.ref))
            setRestored(others)
          }}
          onClose={() => setRecovery(false)}
        />
      )}
      <RestoredToasts
        manager={manager}
        sessions={restored}
        onOpen={(s) => {
          setRestored((list) => list.filter((x) => x !== s))
          navigate(diskPath(s.ref))
        }}
      />
      {settingsPane && (
        <SettingsDialog
          platform={platform}
          initialPane={settingsPane.pane}
          initialFocus={settingsPane.focus}
          onClose={() => setSettingsPane(null)}
        />
      )}
      {updater && <UpdateToastHost controller={updater} />}
      <ShortcutsSheetHost />
      <HelpHost platform={platform} />
    </SettingsOpenerContext.Provider>
  )
}

function Routed({ route, theme }: { route: ReturnType<typeof parseRoute>; theme: ThemeMode }) {
  switch (route.name) {
    case "home":
      return <Home section={route.section} />
    case "file":
      return <Editor key={route.id} fileId={route.id} />
    case "disk":
      return <DiskEditor key={route.ref} fileRef={route.ref} node={route.node} />
    case "join":
      // Board 41 section 5: `key` restarts the join for another link. Board 45: a browser
      // opened at the link offers it to the Kimo app first.
      return (
        <HandoffGate>
          <JoinRoute key={route.link} link={route.link} />
        </HandoffGate>
      )
    case "pair":
      // ADR 0017: another device's Add device link (board 45 hand-off first, as for joins).
      return (
        <HandoffGate>
          <PairRoute key={route.link} link={route.link} />
        </HandoffGate>
      )
    case "gallery":
      // Board 37 §4: the component gallery is for development only (no sidebar row).
      if (!Gallery) return <NotFound path="/gallery" />
      return (
        <div className="gallery-route">
          <Suspense fallback={null}>
            <Gallery theme={theme} />
          </Suspense>
        </div>
      )
    default:
      return <NotFound path={route.name === "not-found" ? route.path : ""} />
  }
}

function NotFound({ path }: { path: string }) {
  return (
    <main className="not-found">
      <p className="not-found__label">Nothing at {path}</p>
      <a className="not-found__link" href="#/">
        Back to files
      </a>
    </main>
  )
}
