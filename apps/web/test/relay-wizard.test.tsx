/**
 * Board 42 relay setup UI rendered to HTML: the wizard's Choose step on desktop and web, Settings ›
 * Multiplayer › Devices and the Add device sheet, the Share popover's no-relay and ownership states,
 * the pairing link cards and quick-tunnel link notes (ADR 0017). The flows are driven in
 * e2e/board42-relay-setup.e2e.ts.
 */
import { describe, expect, test } from "bun:test"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { type MpErrorCode, MultiplayerError } from "@kimo/sync/mp"
import { createElement as h } from "react"
import { renderToString } from "react-dom/server"
import { createMemoryDeviceKeyStore } from "../src/multiplayer/device-key"
import { createMultiplayerModel } from "../src/multiplayer/model"
import { createOwnershipClient, type RelayDevice } from "../src/multiplayer/ownership"
import { createFakeRelayHost } from "../src/multiplayer/relay-setup/host"
import { createRelaySetupServices } from "../src/multiplayer/relay-setup/services"
import {
  AddDeviceSheet,
  addedText,
  countdownText,
  DevicesSetting,
  RemoveDeviceDialog,
  shownPairingLink,
} from "../src/multiplayer/ui/DevicesSetting"
import { RelayWizard } from "../src/multiplayer/ui/RelayWizard"
import { SharePopover } from "../src/multiplayer/ui/SharePopover"
import { stopRelayDescription } from "../src/multiplayer/ui/StopRelayConfirm"
import {
  board41Snapshot,
  createFakeShareBackend,
  fakeProbe,
  issuedLink,
} from "../src/multiplayer/ui/testing"
import { outcomeCard, pairErrorOutcome, pairMeta } from "../src/pair/PairRoute"

const ownership = createOwnershipClient({
  deviceKeys: createMemoryDeviceKeyStore(),
  deviceName: () => "Mac",
  webOrigin: "https://getkimo.design",
})

function services(kind: "web" | "desktop") {
  const platform = createMemoryPlatform({ os: "macos" })
  return createRelaySetupServices(platform, {
    kind,
    host: kind === "desktop" ? createFakeRelayHost() : null,
    pageOrigin: kind === "web" ? "https://design.maya.studio" : null,
    ownership,
  })
}

const wizard = (kind: "web" | "desktop") =>
  renderToString(
    h(RelayWizard, {
      services: services(kind),
      from: "settings",
      inline: true,
      saveRelayUrl: async (u: string) => u,
      onClose: () => {},
    }),
  )

describe("wizard · Choose (section 2)", () => {
  test("desktop: five paths, This computer selected, Continue", () => {
    const html = wizard("desktop")
    expect(html).toContain("Step 1 of 3 · Choose where it runs")
    for (const label of [
      "This computer",
      "Docker or your own server",
      "Fly.io",
      "Railway",
      "I already have a relay",
    ])
      expect(html).toContain(label)
    expect(html).toMatch(/data-value="local"[^>]*>|aria-checked="true"[^>]*data-value="local"/)
    expect(html).toContain("One click with flyctl if it is installed")
    expect(html).toContain("Fastest")
    expect(html).toContain("Kimo runs no servers for you")
    expect(html).not.toContain("A browser tab can")
  })

  test("web: This computer disabled with a note, Docker preselected, Fly.io copy-paste", () => {
    const html = wizard("web")
    expect(html).toMatch(/aria-checked="false" aria-disabled="true" data-value="local"/)
    expect(html).toMatch(/aria-checked="true"[^>]*data-value="docker"/)
    expect(html).toContain("Desktop only")
    expect(html).toContain("A browser tab can&#x27;t run a server.")
    expect(html).toContain("Copy-paste commands from the Kimo repo, then paste the URL.")
    expect(html).toContain("A ready docker run command with a volume filled in")
    expect(html).toContain("Enter its URL.")
    expect(html.toLowerCase()).not.toContain("secret")
  })
})

const devices: RelayDevice[] = [
  {
    pub: "a".repeat(43),
    name: "Mac",
    addedAt: new Date(2026, 9, 2).getTime(),
    addedBy: null,
    via: "claim",
    self: true,
  },
  {
    pub: "b".repeat(43),
    name: "Chrome on Windows",
    addedAt: new Date(2026, 9, 21).getTime(),
    addedBy: "a".repeat(43),
    via: "pair",
    self: false,
  },
]

describe("Settings › Multiplayer › Devices (board 41 section 4)", () => {
  const render = (list: RelayDevice[]) =>
    renderToString(
      h(DevicesSetting, {
        ownership,
        relayUrl: "https://relay.maya.studio",
        devices: list,
        onDevices: () => {},
        onRemovedSelf: () => {},
        copy: async () => {},
      }),
    )

  test("rows: name, This device, added date, laptop or globe; Add device and its hint", () => {
    const html = render(devices)
    expect(html).toContain(
      "Only these can start sharing on this relay. Anyone with a link can still join.",
    )
    expect(html).toContain("This device")
    expect(html).toContain("Chrome on Windows")
    expect(html).toContain("Add device")
    expect(html).toContain("Makes a link that works once, for 15 minutes")
    expect(html).not.toContain("Add another device so you can still manage")
    expect(addedText(devices[0]?.addedAt as number, new Date(2026, 9, 21).getTime())).toBe(
      "Added Oct 2",
    )
  })

  test("the last device: Remove disabled, the one-device hint", () => {
    const html = render(devices.slice(0, 1))
    expect(html).toContain(
      "Add another device so you can still manage this relay if this one is lost.",
    )
    expect(html).toMatch(/disabled=""[^>]*mp-device__remove/)
  })

  test("Remove confirms, with separate copy for this device", () => {
    const other = renderToString(
      h(RemoveDeviceDialog, {
        device: { name: "Chrome on Windows", self: false },
        inline: true,
        onCancel: () => {},
        onConfirm: () => {},
      }),
    )
    expect(other).toContain("Remove Chrome on Windows?")
    expect(other).toContain(
      "It can no longer start sharing on this relay. Files it already shares keep working.",
    )
    const self = renderToString(
      h(RemoveDeviceDialog, {
        device: { name: "Mac", self: true },
        inline: true,
        onCancel: () => {},
        onConfirm: () => {},
      }),
    )
    expect(self).toContain("Remove this device?")
    expect(self).toContain("You will need a link from another device to add it back.")
  })

  test("Add device sheet: link ready, added, expired", () => {
    const link = {
      link: "https://getkimo.design/pair#https://relay.maya.studio/Q7mK2vX9abcdefgh",
      jti: "00".repeat(16),
      iat: 1_792_000_000,
      exp: 1_792_000_900,
    }
    const sheet = (initial: Parameters<typeof AddDeviceSheet>[0]["initial"]) =>
      renderToString(
        h(AddDeviceSheet, {
          ownership,
          relayUrl: "https://relay.maya.studio",
          known: devices,
          copy: async () => {},
          onDevices: () => {},
          onClose: () => {},
          inline: true,
          initial,
          now: () => 1_792_000_002_000,
        }),
      )
    const ready = sheet({ kind: "link", link })
    expect(ready).toContain("Add a device")
    expect(ready).toContain("Open this link on the other device. It works once, for 15 minutes.")
    expect(ready).toContain("getkimo.design/pair#Q7mK2vX9…")
    expect(ready).toContain("Waiting for the other device · 14:58 left")
    expect(ready).toContain("Cancel link")
    expect(sheet({ kind: "added", name: "Chrome on Windows" })).toContain("Added Chrome on Windows")
    const expired = sheet({ kind: "expired", link })
    expect(expired).toContain("This link expired")
    expect(expired).toContain("New link")
    expect(shownPairingLink("kimo://pair#https://r.example/abcdefghij")).toBe(
      "kimo://pair#abcdefgh…",
    )
    expect(countdownText(100, 99_000)).toBe("Waiting for the other device · 0:01 left")
  })
})

describe("Pairing link landing (board 41 section 5 H to N)", () => {
  test("result cards and error mapping", () => {
    expect(outcomeCard("added", "relay.maya.studio")).toMatchObject({
      title: "This device is added",
      desc: "You can now share files on relay.maya.studio.",
      primary: true,
    })
    expect(outcomeCard("already", "relay.maya.studio").title).toBe("Already added")
    expect(outcomeCard("expired", "r").title).toBe("This link has expired")
    expect(outcomeCard("used", "r").title).toBe("This link was already used")
    expect(outcomeCard("invalid", "r").title).toBe("This link doesn't work")
    const code = (c: MpErrorCode) => new MultiplayerError(c)
    expect(pairErrorOutcome(code("PAIRING_EXPIRED"))).toBe("expired")
    expect(pairErrorOutcome(code("PAIRING_USED"))).toBe("used")
    expect(pairErrorOutcome(code("AUTH_INVALID"))).toBe("invalid")
    expect(pairErrorOutcome(code("RELAY_UNCLAIMED"))).toBe("invalid")
    expect(pairErrorOutcome(code("RELAY_UNREACHABLE"))).toBe("unreachable")
    expect(pairErrorOutcome(code("NOT_A_RELAY"))).toBe("not-a-relay")
    expect(pairMeta(1_792_000_720, 1_792_000_000_000)).toBe("Works once · 12 min left")
  })

  test("stop relay copy names who disconnects", () => {
    expect(stopRelayDescription({ people: ["Maya", "Jonas", "Ana"], more: 2 })).toContain(
      "Maya, Jonas, Ana and 2 more are disconnected",
    )
  })
})

describe("Share popover (section 1 A, 3 I)", () => {
  const platform = createMemoryPlatform({ os: "macos" })
  test("no relay: Set up a relay above the manual URL field, and no secret", () => {
    const fake = createFakeShareBackend()
    const model = createMultiplayerModel({
      backend: fake.backend,
      settings: platform.settings,
      probe: fakeProbe({}),
    })
    const html = renderToString(
      h(SharePopover, {
        model,
        docKey: "/a.kimo",
        anchor: null,
        onClose: () => {},
        onResetAll: () => {},
        onSetUpRelay: () => {},
      }),
    )
    const setup = html.indexOf("Set up a relay")
    expect(setup).toBeGreaterThan(0)
    expect(html.indexOf("or use one you have")).toBeGreaterThan(setup)
    expect(html.indexOf("Relay URL")).toBeGreaterThan(setup)
    expect(html.toLowerCase()).not.toContain("secret")
    expect(html).toContain("Set once, kept in Settings")
    expect(html).toContain(
      "Kimo runs no server. Edits travel end-to-end encrypted through a relay you host, and the relay never sees the design.",
    )
  })

  test("links on a quick tunnel say they stop working when the relay restarts", async () => {
    const fake = createFakeShareBackend()
    fake.set("/q.kimo", {
      ...board41Snapshot(),
      relayUrl: "https://quiet-otter-lime.trycloudflare.com",
    })
    fake.setLinks("/q.kimo", [issuedLink("l1", "edit", 6 * 86_400)])
    const model = createMultiplayerModel({ backend: fake.backend, settings: platform.settings })
    await model.document("/q.kimo").refreshLinks()
    const html = renderToString(
      h(SharePopover, {
        model,
        docKey: "/q.kimo",
        anchor: null,
        onClose: () => {},
        onResetAll: () => {},
      }),
    )
    expect(html).toContain("mp-link--quick")
    expect(html).toContain("Stops working when your relay restarts")
  })
})
