/**
 * Board 41 canvas harness (e2e only): `?scene=editor` (default) is the real `App` over a memory
 * platform with one `.kimo` on disk and a multiplayer model over a scripted share backend
 * (`window.__mp.set(patch)` changes the document's snapshot: people, claims, pauses, asset
 * transfers). `?scene=panel` is the Agent tab (360 × 800) over the real agent loop with a mocked
 * provider and the in-window tool host, whose first edit touches "Hero", which Sol (Maya's
 * agent) claimed: the tool answers AREA_BUSY. `?theme=dark` for the dark variants.
 */
import "@kimo/design-tokens/editor.css"
import "@kimo/ui/styles.css"
import "../../src/fonts.css"
import "../../src/app.css"
import type { ProviderRequest } from "@kimo/ai-agent"
import type { KimoDocument } from "@kimo/core-schema"
import { claimsFor, createEmptyDocument, importDocument, serialize } from "@kimo/editor-state"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { Tabs } from "@kimo/ui"
import { StrictMode, useEffect } from "react"
import { createRoot } from "react-dom/client"
import { App } from "../../src/App"
import { AgentPanel, createAgentPanelController, createInWindowTools } from "../../src/agent-panel"
import { createTestRuntime, type Script } from "../../src/agent-panel/testing"
import { initTheme, setTheme } from "../../src/lib/theme"
import { areaWaitsFor } from "../../src/multiplayer/area-busy"
import { emptySnapshot, type ShareBackend, type ShareSnapshot } from "../../src/multiplayer/backend"
import { claimAwareToolHost } from "../../src/multiplayer/claim-tools"
import { createMultiplayerModel } from "../../src/multiplayer/model"
import { createAppSessionManager, RuntimeContext } from "../../src/platform/runtime"
import { bindAppearance } from "../../src/settings"

const params = new URLSearchParams(location.search)
const theme = params.get("theme") === "dark" ? "dark" : "light"
const FILE = "/Users/me/Work/site/landing.kimo"

/** Board 41 › 7 A stage: Landing (560 wide) › Nav 44, Hero 170, Features 110, Pricing 120. */
function landing(): KimoDocument & { nodes: Record<string, unknown> } {
  const d = createEmptyDocument("Landing") as KimoDocument & { nodes: Record<string, unknown> }
  const frame = (id: string, name: string, parent: string | null, extra: object) => {
    d.nodes[id] = {
      type: "frame",
      parent,
      order: `a${Object.keys(d.nodes).length}`,
      name,
      ...extra,
    }
  }
  frame("Landing001", "Landing", null, { x: 0, y: 0, w: 560, h: 444, fill: "#FFFFFF" })
  frame("Nav0000001", "Nav", "Landing001", { x: 0, y: 0, w: 560, h: 44 })
  frame("Hero000001", "Hero", "Landing001", { x: 0, y: 44, w: 560, h: 170, fill: "#F4F6F8" })
  frame("Features01", "Features", "Landing001", { x: 0, y: 214, w: 560, h: 110 })
  frame("Feature002", "Feature 2", "Features01", {
    x: 208,
    y: 20,
    w: 144,
    h: 70,
    fill: "#F4F6F8",
  })
  frame("Pricing001", "Pricing", "Landing001", { x: 0, y: 324, w: 560, h: 120 })
  // Board 41 › 8: images whose bytes are not here yet (320 × 200, as the board's placeholders).
  frame("Image00001", "Photo", null, {
    x: 640,
    y: 0,
    w: 320,
    h: 200,
    fill: { kind: "image", src: "./assets/0123456789abcdef.png" },
  })
  frame("Image00002", "Photo 2", null, {
    x: 640,
    y: 240,
    w: 320,
    h: 200,
    fill: { kind: "image", src: "./assets/0123456789abcde1.png" },
  })
  return d
}

function editorScene() {
  const platform = createMemoryPlatform({
    files: { [FILE]: serialize(landing()) },
    settings: { "general.appearance": theme, "files.autosave": false },
  })
  const manager = createAppSessionManager(platform)
  manager.install()

  // A scripted share backend: one document, its snapshot patched by the scenario.
  let snap: ShareSnapshot = emptySnapshot(FILE)
  const listeners = new Set<() => void>()
  const calls: { op: string; args: unknown[] }[] = []
  const record =
    (op: string) =>
    (...args: unknown[]) => {
      calls.push({ op, args })
    }
  const backend: ShareBackend = {
    snapshot: (key) => (key === FILE ? snap : emptySnapshot(key)),
    subscribe(_key, l) {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    start: async () => {},
    stop: async () => ({ relayNotified: true }),
    links: async () => [],
    mintLink: async () => {
      throw new Error("not in this harness")
    },
    revokeLink: async () => {},
    resetAllLinks: async () => ({ kid: 1 }),
    setPresence: record("setPresence"),
    ensureAsset: async (...args: unknown[]) => {
      calls.push({ op: "ensureAsset", args })
      return false
    },
    resumeAgent: record("resumeAgent"),
    stopAgent: record("stopAgent"),
  }
  const multiplayer = createMultiplayerModel({ backend, settings: platform.settings })
  Object.assign(window, {
    __mp: {
      FILE,
      calls,
      platform,
      set(patch: Partial<ShareSnapshot>) {
        snap = { ...snap, ...patch }
        for (const l of [...listeners]) l()
      },
      follow: (peer: number | null) => multiplayer.document(FILE).follow(peer),
      model: multiplayer,
    },
  })
  return { platform, manager, multiplayer }
}

function panelScene() {
  const d = landing()
  const store = importDocument(d)
  // Sol, Maya's agent, claimed Hero 2 minutes ago (a remote claim, peer 7).
  claimsFor(store).setRemote(7, [
    {
      holder: "agent:kimo.m9x2.3",
      ids: ["Hero000001"],
      since: Date.now() - 120_000,
      renewed: Date.now(),
      label: "Sol",
    },
  ])
  const tools = createInWindowTools({ store, path: FILE })
  const afterTool = (req: ProviderRequest) => req.messages[req.messages.length - 1]?.role === "tool"
  const script: Script = (req) =>
    afterTool(req)
      ? { text: "Hero is busy; I will come back to it.", delayMs: 60_000 }
      : {
          tools: [
            {
              name: "kimo_apply_ops",
              input: {
                docId: tools.docId(),
                ops: [{ op: "update", id: "Hero000001", set: { name: "Hero ✓" } }],
              },
            },
          ],
        }
  const runtime = createTestRuntime({
    tools: (spec) => claimAwareToolHost(tools.factory(spec), { origin: spec.origin, store }),
    script,
    platform: "web",
  })
  const controller = createAgentPanelController({
    runtime,
    fileId: "f-landing",
    fileName: "landing.kimo",
    docId: () => tools.docId(),
    nodeName: (id) => (store.getNode(id) as { name?: string } | undefined)?.name,
  })
  const waits = areaWaitsFor(store)
  Object.assign(window, {
    __panel: {
      controller,
      store,
      waits,
      release: () => claimsFor(store).setRemote(7, []),
    },
  })
  function PanelScene() {
    useEffect(() => {
      void controller.refresh()
    }, [])
    return (
      <aside className="h-panel" data-testid="right-panel">
        <Tabs
          label="Right panel"
          items={[
            { value: "design", label: "Design" },
            { value: "code", label: "Code" },
            { value: "agent", label: "Agent" },
          ]}
          value="agent"
        />
        <AgentPanel
          controller={controller}
          fileName="landing.kimo"
          platform="web"
          areaBusy={{
            waits,
            nodeName: (id) => (store.getNode(id) as { name?: string } | undefined)?.name,
            ownerOf: (holder) => (holder === "agent:kimo.m9x2.3" ? "Maya" : null),
          }}
        />
      </aside>
    )
  }
  return PanelScene
}

initTheme()
const container = document.getElementById("root")
if (params.get("scene") === "panel") {
  setTheme(theme)
  const css = document.createElement("style")
  css.textContent = `
    html, body { margin: 0; background: var(--kimo-bg-canvas); font-family: var(--kimo-font-sans); }
    .h-panel { box-sizing: border-box; display: flex; flex-direction: column; width: 360px; height: 800px; overflow: hidden; border-radius: var(--kimo-radius-md); background: var(--kimo-bg-app); box-shadow: inset 0 0 0 1px var(--kimo-border); }
  `
  document.head.append(css)
  const PanelScene = panelScene()
  if (container)
    createRoot(container).render(
      <StrictMode>
        <PanelScene />
      </StrictMode>,
    )
} else {
  const { platform, manager, multiplayer } = editorScene()
  void platform.settings.ready.then(() => {
    bindAppearance(platform.settings, setTheme)
    if (container)
      createRoot(container).render(
        <StrictMode>
          <RuntimeContext.Provider value={{ platform, manager, multiplayer }}>
            <App />
          </RuntimeContext.Provider>
        </StrictMode>,
      )
  })
}
