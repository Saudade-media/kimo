/**
 * M6 AI providers harness (e2e only, not part of the app bundle): Settings › AI providers (board
 * 23 g6AqH) inside the real SettingsView, and the Home composer (board 22 w9bz9 / board 24
 * o8YoQ), over a controller with memory secrets, a fake CLI host and a routed mock fetch.
 *
 * `?scene=settings-desktop` (default) | `settings-web` | `home`; `&providers=cli,key` (default),
 * `key`, `cli` or `none`
 * and `&platform=desktop|web`. Driven through `window.__ai`.
 */
import "@kimo/design-tokens/editor.css"
import "@kimo/ui/styles.css"
import "../../src/fonts.css"
import "../../src/app.css"
import "../../src/settings/settings.css"
import type { SettingsPane } from "@kimo/platform"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"
import { AiSettingsContext } from "../../src/ai-settings/runtime"
import {
  BOARD_23_CLIS,
  createMockFetch,
  createTestAiSettings,
  memoryStorage,
} from "../../src/ai-settings/testing"
import { HomeComposer } from "../../src/home/HomeComposer"
import { peekHomeHandoff } from "../../src/home/handoff"
import {
  createAppSessionManager,
  RuntimeContext,
  SettingsOpenerContext,
} from "../../src/platform/runtime"
import { SettingsView } from "../../src/settings/SettingsView"

const q = new URLSearchParams(location.search)
const scene = q.get("scene") ?? "settings-desktop"
const providers = (q.get("providers") ?? "cli,key").split(",")
const web = scene === "settings-web" || q.get("platform") === "web"

const KEY = "sk-ant-api03-test-3f9a"
const fetch = createMockFetch({ reply: '{"title":"Pricing page"}', delayMs: 40 })
const storage = memoryStorage()
const ctl = createTestAiSettings({
  platform: web ? "web" : "desktop",
  clis: providers.includes("cli") ? BOARD_23_CLIS : {},
  keys: providers.includes("key") ? { "provider.anthropic": KEY } : {},
  fetch,
  storage,
  now: () => new Date(2026, 9, 14, 12).getTime(),
})
// Board 23 usage figures (Oct 1 – Oct 31: $18.42 of $50.00, 2.31M tokens, 64 sessions).
const at = new Date(2026, 9, 10).getTime()
for (let i = 0; i < 64; i++)
  ctl.recordUsage({
    at,
    provider: i < 40 ? "anthropic" : i < 60 ? "openai" : "custom:ollama",
    label: i < 40 ? "Anthropic" : i < 60 ? "OpenAI-compatible" : "Ollama",
    tokens: i === 0 ? 1_522_500 : 12_500,
    costUsd: i < 40 ? 16.9 / 40 : i < 60 ? 1.52 / 20 : 0,
    billing: i < 60 ? "api" : "local",
    sessionId: `s${i}`,
  })
void ctl.setUsageSettings({ monthlyLimitUsd: 50 })

const platform = createMemoryPlatform({
  settings: { "files.newFilesDir": "/Users/me/Kimo" },
  appVersion: "0.6.0",
})
const manager = createAppSessionManager(platform)
const opened: unknown[] = []
const settingsOpened: (SettingsPane | undefined)[] = []

declare global {
  interface Window {
    __ai: {
      ctl: typeof ctl
      fetch: typeof fetch
      opened: unknown[]
      settingsOpened: (SettingsPane | undefined)[]
      handoff(path: string): unknown
      KEY: string
    }
  }
}
window.__ai = {
  ctl,
  fetch,
  opened,
  settingsOpened,
  handoff: (p) => peekHomeHandoff(p),
  KEY,
}

function Settings() {
  const [pane, setPane] = useState<SettingsPane>("ai-providers")
  return (
    <div className="m6-stage m6-stage--settings">
      <SettingsView platform={platform} pane={pane} onPaneChange={setPane} variant="dialog" />
    </div>
  )
}

function Home() {
  return (
    <div className="m6-stage m6-stage--home">
      {/* Home Main (xHCjM / ND2Vs): 636 wide, column, gap 16, padding 24. */}
      <main className="m6-home-main">
        <HomeComposer platform={platform} onOpen={(t) => opened.push(t)} dwellMs={200} />
      </main>
    </div>
  )
}

await ctl.refresh()
const root = document.getElementById("root") as HTMLElement
createRoot(root).render(
  <StrictMode>
    <RuntimeContext.Provider value={{ platform, manager }}>
      <SettingsOpenerContext.Provider value={(p) => settingsOpened.push(p)}>
        <AiSettingsContext.Provider value={ctl}>
          <style>{`
            body { margin: 0; background: var(--kimo-bg-canvas); font-family: var(--kimo-font-sans); }
            .m6-stage { padding: 40px; }
            /* The board's window is 840 × 1500 (no scrolling) — the harness shows it whole. */
            .m6-stage--settings .settings-window--dialog { height: 1500px; max-height: none; }
            .m6-home-main { box-sizing: border-box; display: flex; flex-direction: column; gap: 16px;
              width: 636px; padding: 24px; background: var(--kimo-bg-app);
              border-radius: var(--kimo-radius-md); box-shadow: inset 0 0 0 1px var(--kimo-border); }
          `}</style>
          {scene === "home" ? <Home /> : <Settings />}
        </AiSettingsContext.Provider>
      </SettingsOpenerContext.Provider>
    </RuntimeContext.Provider>
  </StrictMode>,
)
