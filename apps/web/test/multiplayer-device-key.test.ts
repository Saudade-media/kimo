/**
 * The device key stores (docs/spec/multiplayer.md §16.9, §18.D): one key pair per install, created
 * once; the private key is non-extractable; the keychain store round trips its PKCS#8 through the
 * desktop commands (a fake `invoke` here).
 */
import { describe, expect, test } from "bun:test"
import { exportPublicKey, fromBase64Url, toBase64Url } from "@kimo/sync/mp"
import {
  createKeychainDeviceKeyStore,
  createMemoryDeviceKeyStore,
  devicePubOf,
  importPkcs8,
} from "../src/multiplayer/device-key"

describe("device key", () => {
  test("memory: the same pair across calls, made once, private key non-extractable", async () => {
    const store = createMemoryDeviceKeyStore()
    const [a, b] = await Promise.all([store.get(), store.get()])
    expect(a).toBe(b)
    expect(await store.get()).toBe(a)
    expect(a.privateKey.extractable).toBe(false)
    expect((await devicePubOf(a)).length).toBe(43)
    await expect(crypto.subtle.exportKey("pkcs8", a.privateKey)).rejects.toThrow()
  })

  test("keychain: stores the PKCS#8 once and every window imports the same key", async () => {
    const keychain = new Map<string, string>()
    const calls: string[] = []
    const invoke = async (cmd: string, args?: Record<string, unknown>) => {
      calls.push(cmd)
      if (cmd === "kimo_device_key_get") return keychain.get("relay.device-key") ?? null
      if (cmd === "kimo_device_key_set") {
        keychain.set("relay.device-key", args?.value as string)
        return null
      }
      throw new Error(`unexpected ${cmd}`)
    }
    const first = await createKeychainDeviceKeyStore(invoke).get()
    expect(calls).toEqual(["kimo_device_key_get", "kimo_device_key_set", "kimo_device_key_get"])
    expect(first.privateKey.extractable).toBe(false)
    const stored = keychain.get("relay.device-key") as string
    expect(fromBase64Url(stored).length).toBe(48)
    // Another window: reads the stored key, makes none.
    calls.length = 0
    const second = await createKeychainDeviceKeyStore(invoke).get()
    expect(calls).toEqual(["kimo_device_key_get"])
    expect(toBase64Url(await exportPublicKey(second.publicKey))).toBe(await devicePubOf(first))
    // Signatures from one verify with the other's public key.
    const data = new Uint8Array([1, 2, 3])
    const sig = await crypto.subtle.sign("Ed25519", second.privateKey, data)
    expect(await crypto.subtle.verify("Ed25519", first.publicKey, sig, data)).toBe(true)
  })

  test("importPkcs8 refuses something that is not an Ed25519 key", async () => {
    await expect(importPkcs8(new Uint8Array(48))).rejects.toThrow()
  })
})
