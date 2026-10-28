/**
 * What the relay setup UI (board 42) runs on, per window: the settings store, this device's
 * ownership client, the desktop host (null on web), the relay on this computer, the relay test's
 * network calls, the clipboard and external links. Harnesses provide their own through {@link RelaySetupContext}.
 */
import type { KimoPlatform } from "@kimo/platform"
import { RelayHttpClient } from "@kimo/sync/mp"
import { createContext, useContext, useMemo, useSyncExternalStore } from "react"
import { tauriBridge } from "../../host/bridge"
import { inTauri } from "../../platform/runtime"
import { createCloudClient } from "../cloud/client"
import { resolveCloudApiUrl } from "../cloud/config"
import { type CloudState, type CloudStore, createCloudStore } from "../cloud/store"
import { deviceKeysFor, deviceNameFor, ownershipFor } from "../device"
import type { OwnershipClient } from "../ownership"
import { copyText } from "../ui/shared"
import { createTauriRelayHost, type RelayHostApi } from "./host"
import type { RelayTestDeps } from "./relay-test"
import { type Clock, LocalRelay, type LocalRelayState, realClock } from "./runner"
import { createRelaySetupStore, type RelaySetupState, type RelaySetupStore } from "./store"

export interface RelaySetupServices {
  kind: "web" | "desktop"
  os: string
  arch: string
  /** This page's origin on web (added to the allowed origins); null on desktop. */
  pageOrigin: string | null
  store: RelaySetupStore
  /** This device against relays: its public key (`KIMO_OWNER_KEY`), claim, devices, pairing. */
  ownership: OwnershipClient
  host: RelayHostApi | null
  local: LocalRelay | null
  test: RelayTestDeps
  openUrl(url: string): Promise<void>
  copy(text: string): Promise<void>
  clock: Clock
  /** Kimo Cloud (board 43); null when the build or settings hide it. */
  cloud: CloudStore | null
}

/** The relay test over the network (the relay's `/version`, then ownership as this device). */
export function networkTestDeps(
  ownership: OwnershipClient,
  clock: Clock = realClock,
): RelayTestDeps {
  return {
    probe: (url) => new RelayHttpClient({ relayUrl: url, timeoutMs: 5000 }).probe(),
    ownership: async (url) => (await ownership.relayOwnership(url)).state,
    claim: async (url) => {
      await ownership.claimRelay(url)
    },
    ...clock,
  }
}

/**
 * Kimo Cloud for `platform`: the API origin from the `multiplayer.cloudApiUrl` setting or the
 * build, this install's device key, pages opened with `openUrl`.
 */
export function createPlatformCloud(
  platform: KimoPlatform,
  openUrl: (url: string) => Promise<void>,
  clock: Clock = realClock,
): CloudStore | null {
  const apiUrl = resolveCloudApiUrl(platform.settings?.get("multiplayer.cloudApiUrl") ?? null)
  if (!apiUrl) return null
  return createCloudStore({
    client: createCloudClient({ apiUrl, deviceKeys: deviceKeysFor(platform) }),
    deviceName: () => deviceNameFor(platform),
    clientKind: platform.kind === "desktop" ? "desktop" : "web",
    openUrl,
    clock,
  })
}

function createRelaySetupServices(
  platform: KimoPlatform,
  overrides: Partial<Omit<RelaySetupServices, "store">> = {},
): RelaySetupServices {
  const desktop = platform.kind === "desktop" && inTauri()
  const bridge = desktop ? tauriBridge() : null
  const ownership = overrides.ownership ?? ownershipFor(platform)
  const host =
    overrides.host !== undefined
      ? overrides.host
      : bridge
        ? createTauriRelayHost({
            invoke: (cmd, args) => bridge.invoke(cmd, args),
            listen: (event, handler) => bridge.listen(event, handler),
          })
        : null
  const clock = overrides.clock ?? realClock
  const info = { os: platform.os, arch: platform.arch ?? "aarch64" }
  // Desktop: the system browser through the opener plugin; web: a new tab. Checkout and the billing
  // portal open after a network answer, when a strict popup blocker (Safari) may refuse the tab, so
  // the tab is opened without "noopener" (which always returns null) to see a refusal, and its
  // opener is cut before the page loads.
  const openUrl =
    overrides.openUrl ??
    ((url: string) => {
      if (platform.kind === "desktop") return platform.files.openExternalUrl(url)
      const tab = window.open(url, "_blank")
      if (!tab)
        return Promise.reject(
          new Error("The browser blocked the new tab. Allow pop-ups for Kimo and try again."),
        )
      tab.opener = null
      return Promise.resolve()
    })
  return {
    kind: overrides.kind ?? (desktop || platform.kind === "desktop" ? "desktop" : "web"),
    os: info.os,
    arch: info.arch,
    pageOrigin:
      overrides.pageOrigin !== undefined
        ? overrides.pageOrigin
        : platform.kind === "desktop"
          ? null
          : typeof location === "object"
            ? location.origin
            : null,
    store: createRelaySetupStore({ settings: platform.settings }),
    ownership,
    host,
    local:
      overrides.local !== undefined
        ? overrides.local
        : host
          ? new LocalRelay(host, info, clock)
          : null,
    test: overrides.test ?? networkTestDeps(ownership, clock),
    openUrl,
    copy: overrides.copy ?? ((text) => copyText(platform, text)),
    clock,
    cloud:
      overrides.cloud !== undefined
        ? overrides.cloud
        : createPlatformCloud(platform, openUrl, clock),
  }
}

const byPlatform = new WeakMap<KimoPlatform, RelaySetupServices>()

/** One set of services per window (per platform object). */
export function relaySetupFor(platform: KimoPlatform): RelaySetupServices {
  let s = byPlatform.get(platform)
  if (!s) {
    s = createRelaySetupServices(platform)
    byPlatform.set(platform, s)
  }
  return s
}

/** Harnesses and tests: services to use instead of the platform's. */
const RelaySetupContext = createContext<RelaySetupServices | null>(null)

export function useRelaySetupServices(platform: KimoPlatform | null): RelaySetupServices | null {
  const provided = useContext(RelaySetupContext)
  return useMemo(
    () => provided ?? (platform ? relaySetupFor(platform) : null),
    [provided, platform],
  )
}

const NO_CLOUD_SUB = () => () => {}

export function useRelaySetupState(store: RelaySetupStore): RelaySetupState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState)
}

const NO_SETUP = () => null

/** {@link useRelaySetupState} for surfaces that may have no relay setup services. */
export function useRelaySetupStateOrNull(store: RelaySetupStore | null): RelaySetupState | null {
  return useSyncExternalStore(
    store ? store.subscribe : NO_CLOUD_SUB,
    store ? store.getState : NO_SETUP,
    store ? store.getState : NO_SETUP,
  )
}

const STOPPED_SUB = () => () => {}

const NO_CLOUD = () => null

/** Kimo Cloud's state (null when it is hidden). */
export function useCloudState(cloud: CloudStore | null): CloudState | null {
  return useSyncExternalStore(
    cloud ? cloud.subscribe : NO_CLOUD_SUB,
    cloud ? cloud.getState : NO_CLOUD,
    cloud ? cloud.getState : NO_CLOUD,
  )
}

export function useLocalRelay(local: LocalRelay | null): LocalRelayState | null {
  return useSyncExternalStore(
    local ? (fn) => local.subscribe(fn) : STOPPED_SUB,
    () => local?.getState() ?? null,
    () => local?.getState() ?? null,
  )
}
