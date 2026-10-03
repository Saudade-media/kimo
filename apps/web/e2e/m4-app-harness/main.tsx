/**
 * M4 integrated-app harness (e2e only, not part of the app bundle): the real `App` (Home, editor,
 * Settings) over a macOS memory platform seeded with `.kimo` files on "disk", so the integrated
 * desktop editor (board 16 topbar, board 17 banners/toasts, board 18 conflicts) runs in a plain
 * browser. Built by `e2e/m4-app.e2e.ts`; driven through `window.__kimoApp`.
 */
import "@kimo/design-tokens/editor.css"
import "@kimo/ui/styles.css"
import "../../src/fonts.css"
import "../../src/app.css"
import { createEmptyDocument, serialize } from "@kimo/editor-state"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import board18 from "../../../../packages/core-schema/fixtures/lint/CONFLICT_OPEN--board-18.kimo?raw"
import { App } from "../../src/App"
import { initTheme, setTheme } from "../../src/lib/theme"
import { createAppSessionManager, RuntimeContext } from "../../src/platform/runtime"
import { bindAppearance } from "../../src/settings"

const SITE = "/Users/me/Work/kimo-site/design"
const LOOM = "/Users/me/Projects/loom"

function doc(name: string): string {
  const d = createEmptyDocument(name) as ReturnType<typeof createEmptyDocument> & {
    nodes: Record<string, unknown>
  }
  d.nodes.Frame00001 = {
    type: "frame",
    parent: null,
    order: "a0",
    name: "Home — Desktop",
    x: 0,
    y: 0,
    w: 720,
    h: 480,
    fill: "#FFFFFF",
  }
  return serialize(d)
}

const platform = createMemoryPlatform({
  os: "macos",
  files: {
    [`${SITE}/home.kimo`]: doc("Home"),
    [`${LOOM}/marketing.kimo`]: board18,
  },
  settings: { "general.appearance": "light" },
})
const repo = (branch: string, operation: null) => ({
  branch,
  head: "4f1c2ab",
  operation,
  indexLocked: false,
  fileStatus: "clean" as const,
  changedCount: 0,
})
platform.control.setGit("/Users/me/Work/kimo-site", repo("main", null), { kind: "status-changed" })
// `kimo merge` already stored the conflicts (board 18): no git operation pauses the file.
platform.control.setGit(LOOM, repo("main", null), { kind: "status-changed" })
void platform.recents.addFolder("/Users/me/Work/kimo-site")
void platform.recents.addFolder(LOOM)

const manager = createAppSessionManager(platform)
manager.install()
Object.assign(window, { __kimoApp: { platform, control: platform.control, manager, SITE, LOOM } })

initTheme()
const container = document.getElementById("root")
void platform.settings.ready.then(() => {
  bindAppearance(platform.settings, setTheme)
  if (container)
    createRoot(container).render(
      <StrictMode>
        <RuntimeContext.Provider value={{ platform, manager }}>
          <App />
        </RuntimeContext.Provider>
      </StrictMode>,
    )
})
