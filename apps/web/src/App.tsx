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
import { RecoveryDialog } from "./files"
import { Home } from "./home/Home"
import { useHash } from "./lib/hooks"
import { type ThemeMode, useTheme } from "./lib/theme"
import { SettingsOpenerContext, useRuntime } from "./platform/runtime"
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

const Gallery = lazy(() => import("@kimo/ui/gallery").then((m) => ({ default: m.Gallery })))

export function App() {
  const hash = useHash()
  const route = parseRoute(hash)
  const theme = useTheme()
  const { platform, manager } = useRuntime()
  const [settingsPane, setSettingsPane] = useState<SettingsPane | null>(null)
  const [recovery, setRecovery] = useState(route.name !== "settings")
  const showDialog = useCallback((pane: SettingsPane) => setSettingsPane(pane), [])
  useSettingsShortcut(platform, showDialog)
  const opener = useCallback(
    (pane: SettingsPane = "general") =>
      void openSettings(platform, pane).then((how) => {
        if (how === "dialog") setSettingsPane(pane)
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

  if (route.name === "settings") return <SettingsRoute platform={platform} hash={hash} />

  return (
    <SettingsOpenerContext.Provider value={opener}>
      <Routed route={route} theme={theme} />
      {recovery && (
        <RecoveryDialog
          manager={manager}
          onOpened={(s) => navigate(diskPath(s.ref))}
          onClose={() => setRecovery(false)}
        />
      )}
      {settingsPane && (
        <SettingsDialog
          platform={platform}
          initialPane={settingsPane}
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
      return <Home />
    case "file":
      return <Editor key={route.id} fileId={route.id} />
    case "disk":
      return <DiskEditor key={route.ref} fileRef={route.ref} node={route.node} />
    case "gallery":
      return (
        <div className="gallery-route">
          <Suspense fallback={null}>
            <Gallery theme={theme} />
          </Suspense>
        </div>
      )
    default:
      return (
        <main className="not-found">
          <p className="not-found__label">
            Nothing at {route.name === "not-found" ? route.path : ""}
          </p>
          <a className="not-found__link" href="#/">
            Back to files
          </a>
        </main>
      )
  }
}
