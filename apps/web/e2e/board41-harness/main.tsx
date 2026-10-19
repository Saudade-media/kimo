/**
 * Board 41 share UI harness (e2e only, not part of the app bundle): the real topbar share
 * cluster, Share popover, Reset all links dialog, people list and Settings › Multiplayer over a
 * scripted share backend (`src/multiplayer/ui/testing.ts`) and a memory platform, one surface per
 * page: `?surface=<name>&theme=light|dark`. Built by `e2e/board41-share.e2e.ts`; driven through
 * `window.__board41`.
 *
 * Surfaces: `topbar` (section 2, the six cards), `share-a` / `share-b` / `share-c` (section 3),
 * `reset` (3 D), `people` (6 B, following Maya), `settings` (section 4), and `app`: the real App
 * with the window's multiplayer wiring over a memory platform with a `.kimo` on disk
 * (`#/disk/…`), to check the Share button in the editor topbar.
 */
import "@kimo/design-tokens/editor.css"
import "@kimo/ui/styles.css"
import "../../src/fonts.css"
import "../../src/app.css"
import { createEmptyDocument, serialize } from "@kimo/editor-state"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { SaveStatus, Toast } from "@kimo/ui"
import { type ReactNode, StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"
import { App } from "../../src/App"
import { M3Context } from "../../src/editor/m3/controller"
import { Icon } from "../../src/lib/icons"
import { setTheme } from "../../src/lib/theme"
import { MultiplayerContext } from "../../src/multiplayer/hooks"
import { createMultiplayerModel } from "../../src/multiplayer/model"
import { PeoplePopover } from "../../src/multiplayer/ui/PeoplePopover"
import { ResetLinksDialog } from "../../src/multiplayer/ui/ResetLinksDialog"
import { SharePopover } from "../../src/multiplayer/ui/SharePopover"
import { type ShareToast, ShareToastContext } from "../../src/multiplayer/ui/shared"
import { TopbarShare, TopbarSyncStatus } from "../../src/multiplayer/ui/TopbarShare"
import {
  BOARD41_NODES,
  board41Snapshot,
  createFakeShareBackend,
  fakeProbe,
  issuedLink,
  peerOf,
  presenceOf,
} from "../../src/multiplayer/ui/testing"
import { createWindowMultiplayer } from "../../src/multiplayer/window"
import { createAppSessionManager, RuntimeContext } from "../../src/platform/runtime"
import { SettingsView } from "../../src/settings/SettingsView"

const params = new URLSearchParams(location.search)
const surface = params.get("surface") ?? "topbar"
const theme = params.get("theme") === "dark" ? "dark" : "light"
setTheme(theme)

const platform = createMemoryPlatform({ os: "macos" })
const fake = createFakeShareBackend()
const model = createMultiplayerModel({
  backend: fake.backend,
  settings: platform.settings,
  platformKind: "browser",
  probe: fakeProbe({
    "relay.maya.studio": { version: "1.2", delayMs: 84 },
    "slow.example": { pending: true },
    "example.com": { code: "NOT_A_RELAY", message: "not a Kimo relay" },
    "down.example": { code: "RELAY_UNREACHABLE", message: "ECONNREFUSED" },
    "old.example": {
      code: "NOT_A_RELAY",
      message: "this relay speaks an older protocol (protocol 0)",
    },
  }),
})

const now = Date.now()
const HOUR = 3600
const nodeName = (id: string) => BOARD41_NODES[id] ?? null

/** Section 2: one card per topbar state (A not shared … F offline). */
function seedTopbar() {
  const full = board41Snapshot(now)
  fake.set("b", { ...board41Snapshot(now), peers: [] })
  fake.set("c", full)
  // Not connected yet: "Syncing…" until the relay has every update.
  fake.set("d", { ...full, status: "connecting" })
  // Connected once, then the relay dropped: Reconnecting… (E), and past 30 s Offline (F).
  fake.set("e", full)
  fake.set("f", full)
}

function settleTopbar() {
  for (const k of ["e", "f"]) model.document(k).getState()
  fake.set("e", { status: "connecting", downSince: Date.now() })
  fake.set("f", { status: "connecting", downSince: Date.now() - 31_000 })
}

async function seed() {
  if (surface === "topbar") seedTopbar()
  if (surface === "share-b" || surface === "settings")
    await platform.settings.set("multiplayer.relayUrl", "wss://relay.maya.studio")
  if (surface === "share-c" || surface === "reset" || surface === "people") {
    fake.set("live", board41Snapshot(now))
    fake.setLinks("live", [
      issuedLink("l3", "view", 23 * HOUR + 600, now - 2000),
      issuedLink("l2", "view", null, now - 1000),
      issuedLink("l1", "edit", 6 * 24 * HOUR + 600, now),
    ])
    await model.document("live").refreshLinks()
  }
  if (surface === "reset") {
    // An agent connected with its own link (3 D: "and 1 agent using these links").
    const snap = board41Snapshot(now)
    fake.set("live", {
      ...snap,
      peers: [
        ...(snap.peers ?? []),
        peerOf(7, presenceOf("u-cc", "Claude Code", "presence-slate"), {
          origin: "mcp:claude-code",
        }),
      ],
    })
  }
  if (surface === "people") model.document("live").follow(2)
  if (surface === "settings") await platform.settings.set("multiplayer.displayName", "Gui")
}

function Card({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div className="b41-card" data-card={id}>
      {children}
    </div>
  )
}

function Topbar() {
  const saved = (
    <SaveStatus kind="saved" label="Saved locally" icon={<Icon name="cloud-check" size={14} />} />
  )
  return (
    <div className="b41-cards">
      {["a", "b", "c", "d", "e", "f"].map((k) => (
        <Card key={k} id={k}>
          <TopbarSyncStatus docKey={k} fallback={saved} />
          <TopbarShare docKey={k} nodeName={nodeName} />
        </Card>
      ))}
    </div>
  )
}

function Surface() {
  switch (surface) {
    case "topbar":
      return <Topbar />
    case "share-a":
    case "share-b":
      return (
        <div className="b41-stage" style={{ width: 360 }}>
          <SharePopover
            model={model}
            docKey="setup"
            anchor={null}
            onClose={() => {}}
            onResetAll={() => {}}
          />
        </div>
      )
    case "share-c":
      return (
        <div className="b41-stage" style={{ width: 360 }}>
          <SharePopover
            model={model}
            docKey="live"
            anchor={null}
            onClose={() => {}}
            onResetAll={() => {}}
          />
        </div>
      )
    case "reset":
      return (
        <div className="b41-stage" style={{ width: 480 }}>
          <ResetLinksDialog
            model={model}
            docKey="live"
            inline
            onCancel={() => {}}
            onDone={() => {}}
          />
        </div>
      )
    case "people":
      return (
        <div className="b41-stage" style={{ width: 300 }}>
          <PeoplePopover
            model={model}
            docKey="live"
            anchor={null}
            nodeName={nodeName}
            onClose={() => {}}
          />
        </div>
      )
    case "settings":
      return (
        <SettingsView
          platform={platform}
          pane="multiplayer"
          onPaneChange={() => {}}
          variant="dialog"
        />
      )
    default:
      return null
  }
}

function Harness() {
  const [toasts, setToasts] = useState<ShareToast[]>([])
  const push = (t: ShareToast) => setToasts((list) => [...list, t])
  ;(window as unknown as { __board41: unknown }).__board41 = { fake, model, platform, toasts }
  return (
    <MultiplayerContext.Provider value={model}>
      <M3Context.Provider value={null}>
        <ShareToastContext.Provider value={push}>
          <div className="b41-root">
            <Surface />
            <div className="b41-toasts">
              {toasts.map((t, i) => (
                <Toast
                  // biome-ignore lint/suspicious/noArrayIndexKey: append-only log
                  key={i}
                  className="b41-toast"
                  tone={t.tone === "component" ? "neutral" : t.tone}
                  icon={
                    <Icon
                      name={t.icon ?? (t.tone === "danger" ? "circle-x" : "circle-check")}
                      size={16}
                    />
                  }
                  {...(t.action ? { actionLabel: t.action.label, onAction: t.action.run } : {})}
                >
                  {t.text}
                </Toast>
              ))}
            </div>
          </div>
        </ShareToastContext.Provider>
      </M3Context.Provider>
    </MultiplayerContext.Provider>
  )
}

const style = document.createElement("style")
style.textContent = `
  body { margin: 0; background: var(--kimo-bg-canvas); font-family: var(--kimo-font-sans); }
  .b41-root { display: flex; flex-direction: column; align-items: flex-start; gap: 24px; padding: 32px; }
  .b41-cards { display: flex; flex-direction: column; gap: 16px; width: 520px; }
  .b41-card { box-sizing: border-box; display: flex; justify-content: flex-end; align-items: center; gap: 8px;
    height: 56px; padding: 0 12px; background: var(--kimo-bg-app); border: 1px solid var(--kimo-border);
    border-radius: var(--kimo-radius-md); }
  .b41-toasts { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
`
document.head.append(style)

const APP_FILE = "/Users/me/Work/site/home.kimo"

function renderApp(root: HTMLElement) {
  const appPlatform = createMemoryPlatform({
    os: "macos",
    files: { [APP_FILE]: serialize(createEmptyDocument("Home")) },
    settings: { "general.appearance": theme },
  })
  const manager = createAppSessionManager(appPlatform)
  manager.install()
  const { model: appModel } = createWindowMultiplayer({ platform: appPlatform, manager })
  Object.assign(window, { __board41: { platform: appPlatform, model: appModel, manager } })
  createRoot(root).render(
    <StrictMode>
      <RuntimeContext.Provider value={{ platform: appPlatform, manager, multiplayer: appModel }}>
        <App />
      </RuntimeContext.Provider>
    </StrictMode>,
  )
}

void seed().then(() => {
  const root = document.getElementById("root")
  if (!root) return
  if (surface === "app") {
    renderApp(root)
    document.documentElement.dataset.ready = "1"
    return
  }
  createRoot(root).render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  )
  if (surface === "topbar") setTimeout(settleTopbar, 50)
  document.documentElement.dataset.ready = "1"
})
