/**
 * The device key (docs/spec/multiplayer.md §16.9, ADR 0017): one Ed25519 key pair per Kimo install,
 * created the first time it is needed and never rotated. A relay's owner set lists device public
 * keys; this key signs owner commands, the register owner proof and pairing tokens.
 *
 * - Web: a non-extractable `CryptoKeyPair` in IndexedDB `kimo-multiplayer`, store `device`, key
 *   `"self"` (like the web room keys). Clearing site data loses it.
 * - Desktop: the private key (PKCS#8, base64url) in the OS keychain, service `kimo`, account
 *   `relay.device-key`, through `kimo_device_key_get` / `kimo_device_key_set`; every window imports
 *   it as a non-extractable `CryptoKey`.
 */
import {
  exportPublicKey,
  fromBase64Url,
  generateSigningKeyPair,
  MultiplayerError,
  toBase64Url,
} from "@kimo/sync/mp"
import { openMultiplayerDb, REGISTRY_DB } from "./registry"

export interface DeviceKeyStore {
  readonly backend: "keychain" | "indexeddb" | "memory"
  /** The install's key pair, created and stored on first call. */
  get(): Promise<CryptoKeyPair>
}

/** Base64url of the raw 32-byte public key of `keys` (43 characters). */
export async function devicePubOf(keys: CryptoKeyPair): Promise<string> {
  return toBase64Url(await exportPublicKey(keys.publicKey))
}

/** Calls of `get` share one creation, so two windows of one store never make two keys. */
function once(load: () => Promise<CryptoKeyPair>): () => Promise<CryptoKeyPair> {
  let pending: Promise<CryptoKeyPair> | null = null
  return () => {
    pending ??= load().catch((error: unknown) => {
      pending = null
      throw error
    })
    return pending
  }
}

/** A key that lives as long as the store (tests, hosts without persistence). */
export function createMemoryDeviceKeyStore(): DeviceKeyStore {
  return { backend: "memory", get: once(() => generateSigningKeyPair(false)) }
}

/**
 * IndexedDB: the pair is structured-cloned as non-extractable CryptoKeys, so script in the origin
 * can sign with it but never read the private key.
 */
export function createIndexedDbDeviceKeyStore(name = REGISTRY_DB): DeviceKeyStore {
  const request = <T>(
    db: IDBDatabase,
    mode: IDBTransactionMode,
    f: (s: IDBObjectStore) => IDBRequest<T>,
  ) =>
    new Promise<T>((resolve, reject) => {
      const t = db.transaction("device", mode)
      const req = f(t.objectStore("device"))
      t.oncomplete = () => resolve(req.result)
      t.onerror = () => reject(t.error)
      t.onabort = () => reject(t.error)
    })
  return {
    backend: "indexeddb",
    get: once(async () => {
      const db = await openMultiplayerDb(name)
      try {
        const stored = await request<unknown>(db, "readonly", (s) => s.get("self"))
        if (isKeyPair(stored)) return stored
        const created = await generateSigningKeyPair(false)
        // `add` fails when another tab stored its key first: then that one is the key.
        try {
          await request(db, "readwrite", (s) => s.add(created, "self"))
          return created
        } catch {
          const winner = await request<unknown>(db, "readonly", (s) => s.get("self"))
          if (isKeyPair(winner)) return winner
          throw new MultiplayerError("INTERNAL", "could not store the device key")
        }
      } finally {
        db.close()
      }
    }),
  }
}

function isKeyPair(value: unknown): value is CryptoKeyPair {
  const pair = value as Partial<CryptoKeyPair> | null | undefined
  return (
    typeof CryptoKey !== "undefined" &&
    pair?.privateKey instanceof CryptoKey &&
    pair.publicKey instanceof CryptoKey
  )
}

/** The desktop commands behind the keychain store (apps/desktop/src-tauri/src/relay_commands.rs). */
export type DeviceKeyInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>

/**
 * The OS keychain (desktop): `kimo_device_key_get` returns the stored PKCS#8 (base64url) or null;
 * a new key is generated extractable once, stored with `kimo_device_key_set`, and every window
 * then imports it non-extractable.
 */
export function createKeychainDeviceKeyStore(invoke: DeviceKeyInvoke): DeviceKeyStore {
  return {
    backend: "keychain",
    get: once(async () => {
      const stored = await invoke("kimo_device_key_get")
      if (typeof stored === "string" && stored !== "") return importPkcs8(fromBase64Url(stored))
      const fresh = await generateSigningKeyPair(true)
      const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", fresh.privateKey))
      await invoke("kimo_device_key_set", { value: toBase64Url(pkcs8) })
      // Another window may have stored its key between the get and the set: read back the winner.
      const kept = await invoke("kimo_device_key_get")
      return importPkcs8(typeof kept === "string" && kept !== "" ? fromBase64Url(kept) : pkcs8)
    }),
  }
}

/** An Ed25519 PKCS#8 private key as a non-extractable pair (the public key is exportable). */
export async function importPkcs8(pkcs8: Uint8Array): Promise<CryptoKeyPair> {
  const bytes = pkcs8.slice()
  // Extractable once, only to read the public half (JWK `x`); the kept key is not.
  const readable = await crypto.subtle.importKey("pkcs8", bytes, { name: "Ed25519" }, true, [
    "sign",
  ])
  const jwk = await crypto.subtle.exportKey("jwk", readable)
  if (typeof jwk.x !== "string") throw new MultiplayerError("INTERNAL", "not an Ed25519 key")
  const privateKey = await crypto.subtle.importKey("pkcs8", bytes, { name: "Ed25519" }, false, [
    "sign",
  ])
  const publicKey = await crypto.subtle.importKey(
    "raw",
    fromBase64Url(jwk.x),
    { name: "Ed25519" },
    true,
    ["verify"],
  )
  return { privateKey, publicKey }
}

/** What a default device name may read: the platform, never an account, host or person name. */
export interface DeviceNameInput {
  kind: "web" | "desktop"
  /** `macos`, `windows`, `linux`, ... (the platform's `os`). */
  os?: string
  /** The browser's user agent (web). */
  userAgent?: string
}

/**
 * Default device name (§16.9): desktop "Mac", "Windows" or "Linux"; web "<Browser> on <platform>"
 * ("Chrome on Mac", "Safari on iPhone"). Never the OS account name, the computer name or anyone's
 * name. The user can rename a device.
 */
export function defaultDeviceName(input: DeviceNameInput): string {
  const ua = input.userAgent ?? ""
  if (input.kind === "desktop") return osName(input.os, ua)
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /(Chrome|CriOS)\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser"
  return `${browser} on ${osName(input.os, ua)}`
}

function osName(os: string | undefined, ua: string): string {
  if (/iPhone/.test(ua)) return "iPhone"
  if (/iPad/.test(ua)) return "iPad"
  if (/Android/.test(ua)) return "Android"
  const name = (os ?? "").toLowerCase()
  if (name === "macos" || name === "darwin" || /Mac OS X|Macintosh/.test(ua)) return "Mac"
  if (name === "windows" || /Windows/.test(ua)) return "Windows"
  if (name === "linux" || /Linux|X11/.test(ua)) return "Linux"
  return "Computer"
}
