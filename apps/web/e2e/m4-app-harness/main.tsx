/**
 * M4 integrated-app harness (e2e only, not part of the app bundle): the real `App` (Home, editor,
 * Settings) over a macOS memory platform seeded with `.kimo` files on "disk", so the integrated
 * desktop editor (board 16 topbar, board 17 banners/toasts, board 18 conflicts) runs in a plain
 * browser. Built by `e2e/m4-app.e2e.ts`; driven through `window.__kimoApp`.
 */
import { recoveryIdFor } from "@kimo/sync"
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
  // Board 20 Text section specimen (t2DyQ): "Plan less. Ship more together."
  d.nodes.Headline01 = {
    type: "text",
    parent: "Frame00001",
    order: "a0",
    name: "Headline",
    x: 36,
    y: 64,
    w: 272,
    grow: "fixed-width",
    content: "Plan less. Ship more together.",
    style: { font: "Inter", weight: 600, size: 28, lineHeight: 1.1, letterSpacing: -0.56 },
  }
  d.nodes.Caption001 = {
    type: "text",
    parent: "Frame00001",
    order: "a1",
    name: "Caption",
    x: 36,
    y: 200,
    content: "Home — Desktop",
    style: { size: 11 },
  }
  return serialize(d)
}

// `?os=windows|linux` runs the same app as on Windows / Linux (board 20 KcXQz); `?os=web` reports
// a browser host (board 24 m: the web tab title format).
const requestedOs = (new URLSearchParams(location.search).get("os") ?? "macos") as
  | "macos"
  | "windows"
  | "linux"
  | "web"
const os = requestedOs === "web" ? "macos" : requestedOs
const platform = createMemoryPlatform({
  os,
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

if (requestedOs === "web") Object.defineProperty(platform, "os", { value: "web" })
const manager = createAppSessionManager(platform)
manager.install()
Object.assign(window, { __kimoApp: { platform, control: platform.control, manager, SITE, LOOM } })

// `?recovery=untitled|mixed|mixed3`: entries a crashed session left behind (launch recovery
// dialog). `mixed3` adds a second never-saved document (C3: Restore all with several).
const recoverySeed = new URLSearchParams(location.search).get("recovery")
async function seedRecovery(): Promise<void> {
  if (!recoverySeed) return
  const text = doc("Recovered")
  const entries = [
    {
      id: "untitled-seed1",
      sourceRef: null,
      name: "Untitled",
      reason: "untitled" as const,
      edits: 1,
    },
    ...(recoverySeed === "mixed3"
      ? [
          {
            id: "untitled-seed2",
            sourceRef: null,
            name: "Untitled",
            reason: "untitled" as const,
            edits: 1,
          },
        ]
      : []),
    ...(recoverySeed === "mixed" || recoverySeed === "mixed3"
      ? [
          {
            id: recoveryIdFor(`${SITE}/home.kimo`),
            sourceRef: `${SITE}/home.kimo`,
            name: "home.kimo",
            reason: "snapshot" as const,
            edits: 3,
          },
        ]
      : []),
  ]
  for (const e of entries) await platform.recovery.write({ ...e, text, layers: 2 })
  platform.control.killPid(1000)
}

initTheme()
const container = document.getElementById("root")
void Promise.all([platform.settings.ready, seedRecovery()]).then(() => {
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
