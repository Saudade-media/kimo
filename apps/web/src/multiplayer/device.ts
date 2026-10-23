/**
 * This install's device key and ownership client per window (docs/spec/multiplayer.md §16.9): the
 * OS keychain on desktop, IndexedDB on web. Settings › Multiplayer, the pairing sheet, the relay
 * setup wizard and the share service all reach relays as the same device.
 */
import type { KimoPlatform } from "@kimo/platform"
import { tauriBridge } from "../host/bridge"
import { inTauri } from "../platform/runtime"
import {
  createIndexedDbDeviceKeyStore,
  createKeychainDeviceKeyStore,
  createMemoryDeviceKeyStore,
  type DeviceKeyStore,
  defaultDeviceName,
} from "./device-key"
import { createOwnershipClient, type OwnershipClient } from "./ownership"

const keysByPlatform = new WeakMap<KimoPlatform, DeviceKeyStore>()
const ownershipByPlatform = new WeakMap<KimoPlatform, OwnershipClient>()

/** The device key store of `platform` (one per window). */
export function deviceKeysFor(platform: KimoPlatform): DeviceKeyStore {
  let keys = keysByPlatform.get(platform)
  if (!keys) {
    if (platform.kind === "desktop" && inTauri()) {
      const bridge = tauriBridge()
      keys = createKeychainDeviceKeyStore((cmd, args) => bridge.invoke(cmd, args))
    } else
      keys =
        typeof indexedDB === "undefined"
          ? createMemoryDeviceKeyStore()
          : createIndexedDbDeviceKeyStore()
    keysByPlatform.set(platform, keys)
  }
  return keys
}

/** "Mac", "Chrome on Mac": the platform only, never an account, computer or person name. */
export function deviceNameFor(platform: Pick<KimoPlatform, "kind" | "os">): string {
  return defaultDeviceName({
    kind: platform.kind === "desktop" ? "desktop" : "web",
    os: platform.os,
    ...(typeof navigator === "object" ? { userAgent: navigator.userAgent } : {}),
  })
}

/** Base for pairing and join links: `kimo:` on desktop, this page's origin on web. */
export function webOriginFor(platform: Pick<KimoPlatform, "kind">): string {
  return platform.kind === "desktop" ? "kimo:" : typeof location === "object" ? location.origin : ""
}

/** The ownership client of `platform` (one per window). */
export function ownershipFor(platform: KimoPlatform): OwnershipClient {
  let client = ownershipByPlatform.get(platform)
  if (!client) {
    client = createOwnershipClient({
      deviceKeys: deviceKeysFor(platform),
      deviceName: () => deviceNameFor(platform),
      webOrigin: webOriginFor(platform),
    })
    ownershipByPlatform.set(platform, client)
  }
  return client
}
