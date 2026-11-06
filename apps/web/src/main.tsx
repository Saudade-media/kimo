import "@kimo/design-tokens/editor.css"
import "@kimo/ui/styles.css"
import "./fonts.css"
import "./app.css"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import { LaunchLoaderExit, setLaunchStatus } from "./launch-loader"
import { setLanguage } from "./lib/i18n"
import { initTheme, setTheme } from "./lib/theme"
import { installTitlebarDoubleClick } from "./lib/titlebar"
import { createAppRuntime, RuntimeContext } from "./platform/runtime"
import { diskPath, navigate } from "./router"
import { bindAppearance, watchLanguage } from "./settings"

const container = document.getElementById("root")
if (!container) throw new Error("Kimo: #root element missing from index.html")

initTheme()
// One platform + session manager per window (ADR 0012); files the window was started with
// (argv, file association, deep links) open in the editor route.
void createAppRuntime((session, request) =>
  navigate(diskPath(session.ref, request.node, request.page)),
).then(
  async (runtime) => {
    // General › Appearance drives `[data-theme]` (system follows prefers-color-scheme live).
    bindAppearance(runtime.platform.settings, setTheme)
    // General › Language: the pack loads before the first render, so nothing flashes in English.
    setLanguage(runtime.platform.settings.get("general.language"))
    watchLanguage(runtime.platform.settings, setLanguage)
    // macOS overlay title bar: honor the system double-click setting (zoom / minimize / none).
    if (runtime.platform.kind === "desktop" && runtime.platform.os === "macos") {
      installTitlebarDoubleClick(() => void runtime.platform.window.titlebarDoubleClick())
    }
    createRoot(container).render(
      <StrictMode>
        <RuntimeContext.Provider value={runtime}>
          <App />
        </RuntimeContext.Provider>
        <LaunchLoaderExit />
      </StrictMode>,
    )
  },
  (error: unknown) => {
    // The launch loader (board 29) would otherwise spin forever; its status line says why.
    setLaunchStatus("Kimo couldn't start. Reload the window to try again.")
    throw error
  },
)
