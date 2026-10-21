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
import { ownershipFor } from "../device"
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

export function createRelaySetupServices(
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
    openUrl:
      overrides.openUrl ??
      ((url) => {
        if (platform.kind === "desktop") return platform.files.openExternalUrl(url)
        window.open(url, "_blank", "noopener")
        return Promise.resolve()
      }),
    copy: overrides.copy ?? ((text) => copyText(platform, text)),
    clock,
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
export const RelaySetupContext = createContext<RelaySetupServices | null>(null)

export function useRelaySetupServices(platform: KimoPlatform | null): RelaySetupServices | null {
  const provided = useContext(RelaySetupContext)
  return useMemo(
    () => provided ?? (platform ? relaySetupFor(platform) : null),
    [provided, platform],
  )
}

export function useRelaySetupState(store: RelaySetupStore): RelaySetupState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState)
}

const STOPPED_SUB = () => () => {}

export function useLocalRelay(local: LocalRelay | null): LocalRelayState | null {
  return useSyncExternalStore(
    local ? (fn) => local.subscribe(fn) : STOPPED_SUB,
    () => local?.getState() ?? null,
    () => local?.getState() ?? null,
  )
}
