/**
 * Board 43 Kimo Cloud harness (e2e only, not part of the app bundle): the real relay wizard, Share
 * popover, Settings › Multiplayer, fragments and editor banners over a memory platform and an
 * in-page fake Kimo Cloud (`src/multiplayer/cloud/fake.ts`, signatures verified). One surface per
 * page: `?surface=<name>&state=<name>&theme=light|dark`. Built by `e2e/board43-cloud.e2e.ts`;
 * driven through `window.__board43`.
 *
 * Surfaces: `wizard` (states: signed-out, active), `share` (signed-out, active, none, grace),
 * `settings` (active, past-due), `fragments` (6 D, E, F at 458), `banners` (6 B, C), `dialogs`
 * (5 B, C).
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
import { createCloudClient } from "../../src/multiplayer/cloud/client"
import { createFakeCloud } from "../../src/multiplayer/cloud/fake"
import { createCloudStore } from "../../src/multiplayer/cloud/store"
import { createMemoryDeviceKeyStore, devicePubOf } from "../../src/multiplayer/device-key"
import { createMultiplayerModel } from "../../src/multiplayer/model"
import { createOwnershipClient } from "../../src/multiplayer/ownership"
import {
  createRelaySetupServices,
  RelaySetupContext,
} from "../../src/multiplayer/relay-setup/services"
import { CloudPlanBanner } from "../../src/multiplayer/ui/CloudPlanBanner"
import { CloudNotice, CloudSignOutDialog } from "../../src/multiplayer/ui/cloud-parts"
import { MultiplayerPane } from "../../src/multiplayer/ui/MultiplayerPane"
import { RelayWizard, type WizardStart } from "../../src/multiplayer/ui/RelayWizard"
import { SharePopover } from "../../src/multiplayer/ui/SharePopover"
import { type ShareToast, ShareToastContext } from "../../src/multiplayer/ui/shared"
import { createFakeShareBackend } from "../../src/multiplayer/ui/testing"

const params = new URLSearchParams(location.search)
const surface = params.get("surface") ?? "wizard"
const state = params.get("state") ?? "signed-out"
const theme = params.get("theme") === "dark" ? "dark" : "light"
setTheme(theme)

const EMAIL = "maya@studio.design"
const platform = createMemoryPlatform({ os: "macos" })
const share = createFakeShareBackend()
const keys = createMemoryDeviceKeyStore()
const ownership = createOwnershipClient({
  deviceKeys: keys,
  deviceName: () => "Mac",
  webOrigin: location.origin,
})
const model = createMultiplayerModel({
  backend: share.backend,
  settings: platform.settings,
  platformKind: "browser",
})
const fake = createFakeCloud({ apiUrl: "https://cloud.test", relayUrl: "https://relay.cloud.test" })
const opened: string[] = []
const cloud = createCloudStore({
  client: createCloudClient({ apiUrl: fake.apiUrl, deviceKeys: keys, fetch: fake.fetch }),
  deviceName: () => "Mac",
  clientKind: "desktop",
  openUrl: async (url) => {
    opened.push(url)
  },
})
const services = createRelaySetupServices(platform, {
  kind: "desktop",
  host: null,
  pageOrigin: null,
  ownership,
  cloud,
  openUrl: async (url) => {
    opened.push(url)
  },
})
const toasts: ShareToast[] = []

Object.assign(window, { __board43: { platform, model, fake, cloud, services, opened, toasts } })

/** Puts the account in `state` before the first render. */
async function prepare() {
  const pub = await devicePubOf(await keys.get())
  if (state === "signed-out") return
  fake.signIn(pub, EMAIL, "Mac", Date.now() - 19 * 86_400_000)
  const other = await devicePubOf(await createMemoryDeviceKeyStore().get())
  fake.signIn(other, EMAIL, "Chrome on Windows")
  fake.setUsage(EMAIL, state === "full" ? 10_000_000_000 : 1_200_000_000)
  fake.setPlan(
    EMAIL,
    state === "none"
      ? "none"
      : state === "grace"
        ? "grace"
        : state === "read-only"
          ? "read_only"
          : state === "past-due"
            ? "past_due"
            : "active",
  )
  await cloud.refresh()
  await cloud.relay()
  if (surface === "settings") {
    await platform.settings.set("multiplayer.relayUrl", fake.relayUrl)
    await platform.settings.set("multiplayer.relaySetup", { path: "cloud", extraOrigins: [] })
  }
}

const style = document.createElement("style")
style.textContent = `
  html, body { margin: 0; background: var(--kimo-bg-canvas); color: var(--kimo-text-primary); }
  #root { padding: 24px; display: flex; flex-direction: column; gap: 24px; align-items: flex-start; }
  .b43-pane { width: 560px; box-sizing: border-box; padding: 0 24px 12px 24px; background: var(--kimo-bg-app); border: 1px solid var(--kimo-border); border-radius: var(--kimo-radius-lg); }
  .b43-fragment { width: 458px; }
  .b43-banners { width: 900px; display: flex; flex-direction: column; gap: 32px; }
  .b43-toasts { position: fixed; bottom: 16px; left: 16px; display: flex; flex-direction: column; gap: 8px; }
`
document.head.append(style)

function ShareSurface() {
  const button = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState<"share" | "relay" | null>(null)
  const [start, setStart] = useState<WizardStart>("choose")
  return (
    <>
      <Button
        ref={button}
        variant="secondary"
        className="b43-share"
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
          onSetUpRelay={(s = "choose") => {
            setStart(s)
            Object.assign(window, { __wizardStart: s })
            setOpen("relay")
          }}
        />
      )}
      {open === "relay" && (
        <RelayWizard
          services={services}
          from="share"
          start={start}
          saveRelayUrl={(u) => model.settings.setRelayUrl(u)}
          onStartSharing={async (relayUrl) => {
            Object.assign(window, { __started: { relayUrl } })
            setOpen("share")
          }}
          onClose={() => setOpen((o) => (o === "relay" ? null : o))}
        />
      )}
    </>
  )
}

function Surface() {
  if (surface === "share") return <ShareSurface />
  if (surface === "settings")
    return (
      <div className="b43-pane">
        <MultiplayerPane platform={platform} model={model} />
      </div>
    )
  if (surface === "fragments") {
    const account = cloud.getState().account
    return (
      <>
        {(["payment-failed", "offline", "storage-full"] as const).map((k) => (
          <div key={k} className="b43-fragment">
            <CloudNotice kind={k} account={account} framed onAction={() => {}} />
          </div>
        ))}
      </>
    )
  }
  if (surface === "banners")
    return (
      <div className="b43-banners">
        <CloudPlanBanner
          cloud={cloud}
          state={cloud.getState()}
          docKey="/Users/maya/home.kimo"
          relayHost="relay.cloud.test"
          owner
        />
      </div>
    )
  if (surface === "dialogs")
    return (
      <>
        <CloudSignOutDialog device={null} inline onCancel={() => {}} onConfirm={() => {}} />
        <CloudSignOutDialog
          device={{
            pub: "x",
            name: "Chrome on Windows",
            linkedAt: Date.now(),
            lastSeenAt: null,
            self: false,
          }}
          inline
          onCancel={() => {}}
          onConfirm={() => {}}
        />
      </>
    )
  return (
    <RelayWizard
      services={services}
      from={params.get("from") === "settings" ? "settings" : "share"}
      start={(params.get("start") as WizardStart | null) ?? "choose"}
      saveRelayUrl={(u) => model.settings.setRelayUrl(u)}
      onStartSharing={async (relayUrl) => {
        Object.assign(window, { __started: { relayUrl } })
      }}
      onClose={() => {}}
    />
  )
}

function Harness() {
  const [items, setItems] = useState<(ShareToast & { n: number })[]>([])
  const push = (t: ShareToast) => {
    toasts.push(t)
    setItems((xs) => [...xs, { ...t, n: xs.length + 1 }].slice(-3))
  }
  return (
    <ShareToastContext.Provider value={push}>
      <RelaySetupContext.Provider value={services}>
        <Surface />
        <div className="b43-toasts">
          {items.map((t) => (
            <Toast
              key={t.n}
              tone={t.tone === "component" ? "neutral" : t.tone}
              icon={t.icon ? <Icon name={t.icon} size={16} /> : undefined}
            >
              {t.text}
            </Toast>
          ))}
        </div>
      </RelaySetupContext.Provider>
    </ShareToastContext.Provider>
  )
}

void prepare().then(() => {
  const root = document.getElementById("root")
  if (!root) return
  createRoot(root).render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  )
  document.documentElement.dataset.ready = "1"
})
