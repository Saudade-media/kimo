/**
 * Board 43 "Kimo Cloud" rendered to HTML: the wizard's Choose step with Kimo Cloud first and Host
 * your own collapsed, its Sign in and Subscribe steps, the Share popover's Kimo Cloud bodies and
 * Settings › Multiplayer with an account. The flows and the measured pass are in
 * e2e/board43-cloud.e2e.ts.
 */
import { describe, expect, test } from "bun:test"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { createElement as h } from "react"
import { renderToString } from "react-dom/server"
import { createCloudClient } from "../src/multiplayer/cloud/client"
import { createFakeCloud } from "../src/multiplayer/cloud/fake"
import { type CloudStore, createCloudStore } from "../src/multiplayer/cloud/store"
import { createMemoryDeviceKeyStore, devicePubOf } from "../src/multiplayer/device-key"
import { createMultiplayerModel } from "../src/multiplayer/model"
import { createOwnershipClient } from "../src/multiplayer/ownership"
import {
  createRelaySetupServices,
  RelaySetupContext,
} from "../src/multiplayer/relay-setup/services"
import { CloudPlanBanner } from "../src/multiplayer/ui/CloudPlanBanner"
import { CloudNotice, CloudSignOutDialog } from "../src/multiplayer/ui/cloud-parts"
import { MultiplayerPane } from "../src/multiplayer/ui/MultiplayerPane"
import { RelayWizard, type WizardStart } from "../src/multiplayer/ui/RelayWizard"
import { SharePopover } from "../src/multiplayer/ui/SharePopover"
import { createFakeShareBackend } from "../src/multiplayer/ui/testing"

const keys = createMemoryDeviceKeyStore()
const ownership = createOwnershipClient({
  deviceKeys: keys,
  deviceName: () => "Mac",
  webOrigin: "https://getkimo.design",
})

function cloudFor(fake = createFakeCloud()) {
  const store = createCloudStore({
    client: createCloudClient({ apiUrl: fake.apiUrl, deviceKeys: keys, fetch: fake.fetch }),
    deviceName: () => "Mac",
    clientKind: "desktop",
    openUrl: async () => {},
    onFocus: () => () => {},
  })
  return { fake, store }
}

function services(cloud: CloudStore | null, kind: "web" | "desktop" = "desktop") {
  const platform = createMemoryPlatform({ os: "macos" })
  return {
    platform,
    services: createRelaySetupServices(platform, {
      cloud,
      kind,
      host: null,
      pageOrigin: kind === "web" ? "https://design.maya.studio" : null,
      ownership,
    }),
  }
}

const wizard = (cloud: CloudStore | null, start?: WizardStart) =>
  renderToString(
    h(RelayWizard, {
      services: services(cloud).services,
      from: "share",
      inline: true,
      ...(start ? { start } : {}),
      saveRelayUrl: async (u: string) => u,
      onClose: () => {},
      onStartSharing: async () => {},
    }),
  )

async function signedIn(status: "active" | "none" | "grace" | "past_due") {
  const { fake, store } = cloudFor()
  fake.signIn(await devicePubOf(await keys.get()), "maya@studio.design")
  fake.setPlan("maya@studio.design", status)
  fake.setUsage("maya@studio.design", 1_200_000_000)
  await store.refresh()
  return { fake, store }
}

describe("wizard · Choose (section 1)", () => {
  test("A: Kimo Cloud first and selected, Host your own collapsed, Choose · Sign in · Subscribe", () => {
    const { store } = cloudFor()
    const html = wizard(store)
    expect(html).toContain("Step 1 of 3 · Choose where it runs")
    expect(html).toMatch(/aria-checked="true"[^>]*data-value="cloud"/)
    expect(html).toContain("We run the relay for you. Sign in, subscribe, share.")
    expect(html).toContain("No setup")
    expect(html).toContain("$8 a month")
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain("This computer, Docker, Fly.io, Railway or a relay you have")
    expect(html).not.toContain("Docker or your own server")
    expect(html).toContain("Self-hosting is always free")
    expect(html.indexOf("Sign in")).toBeGreaterThan(-1)
    expect(html).toContain("Subscribe")
    expect(html).not.toContain("Kimo runs no servers for you")
  })

  test("B: signed in with a plan skips to Use Kimo Cloud", async () => {
    const { store } = await signedIn("active")
    const html = wizard(store)
    expect(html).toContain("Signed in as maya@studio.design. Your plan is active.")
    expect(html).toContain(">Active<")
    expect(html).toContain("Nothing to set up")
    expect(html).toContain("Use Kimo Cloud")
  })

  test("without Kimo Cloud the wizard is board 42", () => {
    const html = wizard(null)
    expect(html).toContain("Kimo runs no servers for you")
    expect(html).toContain("Fastest")
    expect(html).not.toContain("Kimo Cloud")
  })
})

describe("wizard · Sign in and Subscribe (sections 2, 3)", () => {
  test("2 A enter email: Email me a link waits for an email", () => {
    const { store } = cloudFor()
    const html = wizard(store, "sign-in")
    expect(html).toContain("Step 2 of 3 · Sign in")
    expect(html).toContain("Sign in to Kimo Cloud")
    expect(html).toContain("We email you a link. No password to remember.")
    expect(html).toMatch(
      /data-action="send-link"[^>]*disabled=""|disabled=""[^>]*data-action="send-link"/,
    )
  })

  test("2 B check your inbox: waiting, Resend counts down", async () => {
    const { store } = cloudFor()
    await store.startSignIn("maya@studio.design")
    const html = wizard(store, "sign-in")
    expect(html).toContain("Check your inbox")
    expect(html).toContain(
      "We sent a link to maya@studio.design. Open it on any device and this one signs in.",
    )
    expect(html).toContain("Waiting for the link")
    expect(html).toMatch(/Resend in [01]:\d\d/)
    expect(html).toContain("Use a different email")
    store.dispose()
  })

  test("3 A choose billing: Monthly selected, Yearly two months free, what is included", () => {
    const { store } = cloudFor()
    const html = wizard(store, "subscribe")
    expect(html).toContain("Step 3 of 3 · Subscribe")
    expect(html).toMatch(/aria-checked="true"[^>]*data-value="month"/)
    expect(html).toContain("$80 a year")
    expect(html).toContain("2 months free")
    expect(html).toContain("10 GB of storage for shared files and images")
    expect(html).toContain("Prices in USD. Tax is added at checkout.")
    expect(html).toContain("Continue to checkout")
  })
})

function popover(store: CloudStore | null, relayUrl: string | null = null) {
  const { platform, services: s } = services(store, "web")
  const fake = createFakeShareBackend()
  const model = createMultiplayerModel({
    backend: fake.backend,
    settings: platform.settings,
    platformKind: "browser",
  })
  if (relayUrl) void platform.settings.set("multiplayer.relayUrl", relayUrl)
  return renderToString(
    h(
      RelaySetupContext.Provider,
      { value: s },
      h(SharePopover, {
        model,
        docKey: "/Users/maya/home.kimo",
        anchor: null,
        onClose: () => {},
        onResetAll: () => {},
        onSetUpRelay: () => {},
      }),
    ),
  )
}

describe("Share popover (section 4, 6 A)", () => {
  test("4 A first run: Share with Kimo Cloud, the price line, Host your own collapsed", () => {
    const { store } = cloudFor()
    const html = popover(store)
    expect(html).toContain("Share with Kimo Cloud")
    expect(html).toContain("Use Kimo Cloud")
    expect(html).toContain("$8 a month · sign in with email · guests join free")
    expect(html).toContain("Set up a relay, or use one you have")
    expect(html).not.toContain("Relay URL")
    expect(html).toContain("Set once, kept in Settings")
  })

  test("4 B ready, 4 C subscribe, 6 A lapsed", async () => {
    const ready = popover((await signedIn("active")).store)
    expect(ready).toContain("Share this file. Anyone with the link can join, no account needed.")
    expect(ready).toContain("maya@studio.design")
    expect(ready).toContain("Monthly · 1.2 GB of 10 GB")
    const subscribe = popover((await signedIn("none")).store)
    expect(subscribe).toContain("Subscribe to share")
    expect(subscribe).toContain("$8 a month or $80 a year · cancel any time")
    expect(subscribe).toContain("Files already shared keep syncing")
    const lapsed = popover((await signedIn("grace")).store)
    expect(lapsed).toContain("Your Kimo Cloud plan has ended")
    expect(lapsed).toContain("Renew plan")
    expect(lapsed).toContain("Guests are not affected")
  })

  test("without Kimo Cloud the popover is board 41 / 42", () => {
    const html = popover(null)
    expect(html).toContain("Share through your own relay")
    expect(html).not.toContain("Kimo Cloud")
  })
})

describe("Settings › Multiplayer (section 5) and the fragments (6 D to F)", () => {
  test("A: Relay Kimo Cloud, Account, Devices", async () => {
    const { store } = await signedIn("active")
    const { platform, services: s } = services(store)
    await platform.settings.set("multiplayer.relayUrl", "https://relay.cloud.test")
    await platform.settings.set("multiplayer.relaySetup", { path: "cloud", extraOrigins: [] })
    const html = renderToString(
      h(RelaySetupContext.Provider, { value: s }, h(MultiplayerPane, { platform })),
    )
    expect(html).toContain("Kimo Cloud")
    expect(html).toContain("Change")
    expect(html).toContain("You pay for Kimo Cloud here. Guests never need an account.")
    expect(html).toContain("Monthly · $8")
    expect(html).toContain("1.2 GB of 10 GB")
    expect(html).toContain("Manage billing")
    expect(html).toContain("Sign out")
    expect(html).toContain("Devices signed in to your account.")
    expect(html).toContain("To add a device, sign in on it with the same email.")
    expect(html).not.toContain("What a relay is")
  })

  test("fragments and dialogs", async () => {
    const { store } = await signedIn("past_due")
    const account = store.getState().account
    const past = renderToString(h(CloudNotice, { kind: "payment-failed", account, onAction() {} }))
    expect(past).toContain("Past due")
    expect(past).toContain("Update payment")
    const off = renderToString(h(CloudNotice, { kind: "offline", account: null, onAction() {} }))
    expect(off).toContain("Can&#x27;t reach Kimo Cloud")
    expect(off).toContain("Try again")
    const full = renderToString(h(CloudNotice, { kind: "storage-full", account, onAction() {} }))
    expect(full).toContain("Kimo Cloud storage is full")
    const self = renderToString(
      h(CloudSignOutDialog, { device: null, inline: true, onCancel() {}, onConfirm() {} }),
    )
    expect(self).toContain("Sign out of Kimo Cloud?")
    const other = renderToString(
      h(CloudSignOutDialog, {
        device: {
          pub: "x",
          name: "Chrome on Windows",
          linkedAt: 0,
          lastSeenAt: null,
          self: false,
        },
        inline: true,
        onCancel() {},
        onConfirm() {},
      }),
    )
    expect(other).toContain("Sign out Chrome on Windows?")
  })
})

describe("editor banners (6 B, 6 C)", () => {
  const banner = (store: CloudStore, owner = true, relayHost = "relay.cloud.test") =>
    renderToString(
      h(CloudPlanBanner, {
        cloud: store,
        state: store.getState(),
        docKey: "/Users/maya/home.kimo",
        relayHost,
        owner,
      }),
    )

  test("grace: the owner's warning banner with Manage billing and Renew plan", async () => {
    const { store } = await signedIn("grace")
    await store.relay()
    const html = banner(store)
    expect(html).toContain("Kimo Cloud plan ended")
    expect(html).toMatch(/This file keeps syncing until \w{3} \d+, then turns read-only\./)
    expect(html).toContain("Manage billing")
    expect(html).toContain("Renew plan")
    expect(html).toContain('aria-label="Dismiss"')
    expect(banner(store, false)).toBe("")
    expect(banner(store, true, "relay.maya.studio")).toBe("")
  })

  test("read-only: no dismiss; an active plan shows nothing", async () => {
    const lapsed = await signedIn("grace")
    lapsed.fake.setPlan("maya@studio.design", "read_only")
    await lapsed.store.refresh()
    await lapsed.store.relay()
    const html = banner(lapsed.store)
    expect(html).toContain("Read-only")
    expect(html).toContain("The owner&#x27;s Kimo Cloud plan ended. Everyone keeps their own copy.")
    expect(html).not.toContain('aria-label="Dismiss"')
    const active = await signedIn("active")
    await active.store.relay()
    expect(banner(active.store)).toBe("")
  })
})
