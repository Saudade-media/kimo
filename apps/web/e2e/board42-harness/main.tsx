/**
 * Board 42 relay setup harness (e2e only, not part of the app bundle): the real Share popover,
 * relay setup wizard and Settings › Multiplayer over a memory platform, one surface per page:
 * `?surface=<name>&theme=light|dark`. Built by `e2e/board42-relay-setup.e2e.ts`; driven through
 * `window.__board42`.
 *
 * Surfaces: `share` (web: Share opens the popover, whose Set up a relay opens the wizard; the
 * relay test reaches the real relay the e2e starts), `settings` (web: Settings › Multiplayer),
 * `desktop` (the wizard on desktop over a scripted relay host: Bun and cloudflared found, the
 * relay and a quick tunnel answer), `pair` (the pairing link landing for `&link=<link>`, adding
 * this page's device).
 */
import "@kimo/design-tokens/editor.css"
import "@kimo/ui/styles.css"
import "../../src/fonts.css"
import "../../src/app.css"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { Button, Toast } from "@kimo/ui"
import { StrictMode, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { Icon } from "../../src/lib/icons"
import { setTheme } from "../../src/lib/theme"
import { createMemoryDeviceKeyStore } from "../../src/multiplayer/device-key"
import { createMultiplayerModel } from "../../src/multiplayer/model"
import { createOwnershipClient } from "../../src/multiplayer/ownership"
import { createFakeRelayHost } from "../../src/multiplayer/relay-setup/host"
import {
  createRelaySetupServices,
  RelaySetupContext,
} from "../../src/multiplayer/relay-setup/services"
import { MultiplayerPane } from "../../src/multiplayer/ui/MultiplayerPane"
import { RelayWizard } from "../../src/multiplayer/ui/RelayWizard"
import { SharePopover } from "../../src/multiplayer/ui/SharePopover"
import { type ShareToast, ShareToastContext } from "../../src/multiplayer/ui/shared"
import { createFakeShareBackend } from "../../src/multiplayer/ui/testing"
import { PairRoute } from "../../src/pair/PairRoute"

const params = new URLSearchParams(location.search)
const surface = params.get("surface") ?? "share"
const theme = params.get("theme") === "dark" ? "dark" : "light"
setTheme(theme)

const platform = createMemoryPlatform({ os: "macos" })
const fake = createFakeShareBackend()
// This page's device key (memory: every load is a new device, so runs never share an owner).
const ownership = createOwnershipClient({
  deviceKeys: createMemoryDeviceKeyStore(),
  deviceName: () => "Chrome on Mac",
  webOrigin: location.origin,
})
const model = createMultiplayerModel({
  backend: fake.backend,
  settings: platform.settings,
  platformKind: "browser",
  ownership: async (url) => (await ownership.relayOwnership(url)).state,
})
const desktop = surface === "desktop"
const host = desktop
  ? createFakeRelayHost({
      tools: {
        bun: { path: "/Users/maya/.bun/bin/bun", version: "1.2.19" },
        cloudflared: { path: "/opt/homebrew/bin/cloudflared", version: "2025.9.1" },
      },
      lan: "192.168.1.24",
      scripts: {
        relay: { lines: ["@kimo/server listening on http://0.0.0.0:8787/ (data: x)"], everyMs: 30 },
        cloudflared: {
          lines: [
            "INF Requesting new quick Tunnel on trycloudflare.com...",
            "INF |  https://quiet-otter-lime.trycloudflare.com  |",
          ],
          everyMs: 30,
        },
      },
    })
  : null
const services = createRelaySetupServices(platform, {
  // Board 42 / 41 without Kimo Cloud (board 43 has its own harness).
  cloud: null,
  kind: desktop ? "desktop" : "web",
  host,
  pageOrigin: desktop ? null : "https://design.maya.studio",
  ownership,
  copy: async (text) => {
    ;(window as unknown as { __clipboard: string }).__clipboard = text
  },
})

const toasts: ShareToast[] = []
let toastSeq = 0
/** Another device of the same person: redeems a pairing link the way its own Kimo would. */
const pairOther = (link: string, name: string) =>
  createOwnershipClient({
    deviceKeys: createMemoryDeviceKeyStore(),
    deviceName: () => name,
    webOrigin: location.origin,
  }).acceptPairingLink(link)

Object.assign(window, {
  __board42: { platform, model, fake, host, services, ownership, pairOther, toasts },
})

const style = document.createElement("style")
style.textContent = `
  html, body { margin: 0; background: var(--kimo-bg-canvas); color: var(--kimo-text-primary); }
  #root { padding: 24px; display: flex; flex-direction: column; gap: 24px; align-items: flex-start; }
  .b42-pane { width: 560px; box-sizing: border-box; padding: 0 24px 12px 24px; background: var(--kimo-bg-app); border: 1px solid var(--kimo-border); border-radius: var(--kimo-radius-lg); }
  .b42-toasts { position: fixed; bottom: 16px; left: 16px; display: flex; flex-direction: column; gap: 8px; }
`
document.head.append(style)

function Toasts({ items }: { items: (ShareToast & { n: number })[] }) {
  return (
    <div className="b42-toasts">
      {items.map((t) => (
        <Toast
          key={t.n}
          tone={t.tone === "component" ? "neutral" : t.tone}
          icon={t.icon ? <Icon name={t.icon} size={14} /> : undefined}
        >
          {t.text}
        </Toast>
      ))}
    </div>
  )
}

function ShareSurface() {
  const button = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState<"share" | "relay" | null>(null)
  return (
    <>
      <Button
        ref={button}
        variant="secondary"
        className="b42-share"
        icon={<Icon name="users" size={16} />}
        onClick={() => setOpen((o) => (o === "share" ? null : "share"))}
      >
        Share
      </Button>
      {open === "share" && (
        <SharePopover
          model={model}
          docKey="/Users/maya/home.kimo"
          anchor={button.current}
          onClose={() => setOpen(null)}
          onResetAll={() => {}}
          onSetUpRelay={() => setOpen("relay")}
        />
      )}
      {open === "relay" && (
        <RelayWizard
          services={services}
          from="share"
          saveRelayUrl={(u) => model.settings.setRelayUrl(u)}
          onStartSharing={async (relayUrl) => {
            await model.document("/Users/maya/home.kimo").startSharing({ relayUrl })
            Object.assign(window, { __started: { relayUrl } })
            setOpen("share")
          }}
          onClose={() => setOpen((o) => (o === "relay" ? null : o))}
        />
      )}
    </>
  )
}

function Harness() {
  const [items, setItems] = useState<(ShareToast & { n: number })[]>([])
  const push = (t: ShareToast) => {
    toasts.push(t)
    setItems((xs) => [...xs, { ...t, n: ++toastSeq }].slice(-3))
  }
  return (
    <ShareToastContext.Provider value={push}>
      <RelaySetupContext.Provider value={services}>
        {surface === "pair" ? (
          <PairRoute
            link={params.get("link") ?? ""}
            ownership={ownership}
            deviceName="Chrome on Mac"
          />
        ) : surface === "settings" ? (
          <div className="b42-pane">
            <MultiplayerPane platform={platform} model={model} />
          </div>
        ) : surface === "desktop" ? (
          <RelayWizard
            services={services}
            from="settings"
            saveRelayUrl={(u) => model.settings.setRelayUrl(u)}
            onClose={() => {}}
          />
        ) : (
          <ShareSurface />
        )}
        <Toasts items={items} />
      </RelaySetupContext.Provider>
    </ShareToastContext.Provider>
  )
}

const root = document.getElementById("root")
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  )
  document.documentElement.dataset.ready = "1"
}
