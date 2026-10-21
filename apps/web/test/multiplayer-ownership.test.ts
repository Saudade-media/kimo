/**
 * Relay ownership and pairing through the share service against a real in-process relay
 * (docs/spec/multiplayer.md §16.9, §18.D, ADR 0017). Every service gets its own memory device key.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { exportPublicKey, toBase64Url } from "@kimo/sync/mp"
import { createMemoryDeviceKeyStore, defaultDeviceName } from "../src/multiplayer/device-key"
import { makePeer, makeTarget, type Relay, startRelay } from "./multiplayer-helpers"

let relay: Relay
beforeAll(() => {
  relay = startRelay()
})
afterAll(() => relay.stop())

const device = (name: string) => {
  const keys = createMemoryDeviceKeyStore()
  return makePeer({ deviceKeys: keys, deviceName: () => name })
}

async function expectCode(run: Promise<unknown>, code: string) {
  try {
    await run
  } catch (error) {
    expect((error as { code?: string }).code).toBe(code)
    return
  }
  throw new Error(`expected ${code}`)
}

describe("ownership (ADR 0017)", () => {
  test("relayOwnership: unclaimed, then yours after a claim, other for another device", async () => {
    const fresh = startRelay()
    const a = device("Mac")
    const b = device("Windows")
    expect((await a.service.relayOwnership(fresh.url)).state).toBe("unclaimed")
    const claimed = await a.service.claimRelay(fresh.url)
    expect(claimed).toHaveLength(1)
    expect(claimed[0]).toMatchObject({ name: "Mac", via: "claim", self: true })
    const mine = await a.service.relayOwnership(fresh.url)
    expect(mine.state).toBe("yours")
    expect(mine.devices?.map((d) => d.self)).toEqual([true])
    expect(await b.service.relayOwnership(fresh.url)).toEqual({
      relayUrl: fresh.url,
      state: "other",
      devices: null,
    })
    await expectCode(b.service.claimRelay(fresh.url), "RELAY_CLAIMED")
    await fresh.stop()
  })

  test("startSharing claims an unclaimed relay first, then registers", async () => {
    const fresh = startRelay()
    const a = device("Mac")
    const room = await a.service.startSharing(makeTarget("/tmp/claim.kimo"), {
      relayUrl: fresh.url,
    })
    expect(room.relayUrl).toBe(fresh.url)
    expect((await a.service.relayOwnership(fresh.url)).state).toBe("yours")
    await fresh.stop()
  })

  test("startSharing on another device's relay fails with NOT_OWNER before anything changes", async () => {
    const fresh = startRelay()
    const a = device("Mac")
    const b = device("Windows")
    await a.service.claimRelay(fresh.url)
    const target = makeTarget("/tmp/other.kimo")
    const before = target.store.encodeStateVector()
    await expectCode(b.service.startSharing(target, { relayUrl: fresh.url }), "NOT_OWNER")
    expect(target.store.encodeStateVector()).toEqual(before)
    expect(await b.service.roomForFile("/tmp/other.kimo")).toBeNull()
    await fresh.stop()
  })

  test("a relay started with KIMO_OWNER_KEY is yours without a claim", async () => {
    const keys = createMemoryDeviceKeyStore()
    const pub = await exportPublicKey((await keys.get()).publicKey)
    const preclaimed = startRelay({ ownerKeys: [pub] })
    const a = makePeer({ deviceKeys: keys, deviceName: () => "Mac" })
    const ownership = await a.service.relayOwnership(preclaimed.url)
    expect(ownership.state).toBe("yours")
    expect(ownership.devices?.[0]).toMatchObject({ via: "env", self: true })
    await a.service.startSharing(makeTarget("/tmp/pre.kimo"), { relayUrl: preclaimed.url })
    expect(await a.service.devicePublicKey()).toBe(toBase64Url(pub))
    await preclaimed.stop()
  })

  test("a pairing link adds a second device, which can then start sharing", async () => {
    const fresh = startRelay()
    const a = device("Mac")
    const b = device("Chrome on Windows")
    await a.service.claimRelay(fresh.url)
    const issued = await a.service.createPairingLink(fresh.url)
    expect(issued.link.startsWith("https://kimo.test/pair#")).toBe(true)
    expect(issued.exp - issued.iat).toBe(900)
    const accepted = await b.service.acceptPairingLink(issued.link)
    expect(accepted.relayUrl).toBe(fresh.url)
    expect(accepted.added).toBe(true)
    expect(accepted.devices.map((d) => [d.name, d.self, d.via])).toEqual([
      ["Mac", false, "claim"],
      ["Chrome on Windows", true, "pair"],
    ])
    await b.service.startSharing(makeTarget("/tmp/paired.kimo"), { relayUrl: fresh.url })
    // Opening the link again on a device that is already in: nothing changes.
    const again = await a.service.acceptPairingLink(
      (await a.service.createPairingLink(fresh.url)).link,
    )
    expect(again.added).toBe(false)
    await fresh.stop()
  })

  test("used and cancelled links surface their codes", async () => {
    const fresh = startRelay()
    const a = device("Mac")
    await a.service.claimRelay(fresh.url)
    const used = await a.service.createPairingLink(fresh.url)
    await device("B").service.acceptPairingLink(used.link)
    await expectCode(device("C").service.acceptPairingLink(used.link), "PAIRING_USED")
    const cancelled = await a.service.createPairingLink(fresh.url)
    await a.service.cancelPairingLink(fresh.url, cancelled)
    await expectCode(device("D").service.acceptPairingLink(cancelled.link), "PAIRING_USED")
    await expectCode(device("E").service.acceptPairingLink("https://kimo.test/pair#x"), "BAD_LINK")
    await fresh.stop()
  })

  test("an expired link is PAIRING_EXPIRED", async () => {
    // The relay's clock moves on two minutes after a one-minute link was made.
    let skew = 0
    const fresh = startRelay({}, { now: () => Date.now() + skew })
    const a = device("Mac")
    await a.service.claimRelay(fresh.url)
    const short = await a.service.createPairingLink(fresh.url, { ttlSeconds: 60 })
    skew = 120_000
    const b = makePeer({
      deviceKeys: createMemoryDeviceKeyStore(),
      now: () => Date.now() + skew,
    })
    await expectCode(b.service.acceptPairingLink(short.link), "PAIRING_EXPIRED")
    await fresh.stop()
  })

  test("removing this device turns the relay to other; the last device cannot go", async () => {
    const fresh = startRelay()
    const a = device("Mac")
    const b = device("Windows")
    await a.service.claimRelay(fresh.url)
    await b.service.acceptPairingLink((await a.service.createPairingLink(fresh.url)).link)
    const self = await b.service.devicePublicKey()
    const left = await b.service.removeDevice(fresh.url, self)
    expect(left.map((d) => d.name)).toEqual(["Mac"])
    expect((await b.service.relayOwnership(fresh.url)).state).toBe("other")
    await expectCode(
      a.service.removeDevice(fresh.url, await a.service.devicePublicKey()),
      "LAST_DEVICE",
    )
    await fresh.stop()
  })

  test("renameDevice updates the list", async () => {
    const fresh = startRelay()
    const a = device("Mac")
    await a.service.claimRelay(fresh.url)
    const renamed = await a.service.renameDevice(
      fresh.url,
      await a.service.devicePublicKey(),
      "  Studio   Mac ",
    )
    expect(renamed[0]?.name).toBe("Studio Mac")
    await expectCode(
      a.service.renameDevice(fresh.url, await a.service.devicePublicKey(), "   "),
      "BAD_REQUEST",
    )
    await fresh.stop()
  })
})

describe("default device name (section 16.9)", () => {
  test("the platform only, never an account, host or person name", () => {
    expect(defaultDeviceName({ kind: "desktop", os: "macos" })).toBe("Mac")
    expect(defaultDeviceName({ kind: "desktop", os: "windows" })).toBe("Windows")
    expect(defaultDeviceName({ kind: "desktop", os: "linux" })).toBe("Linux")
    const chromeMac =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
    expect(defaultDeviceName({ kind: "web", os: "web", userAgent: chromeMac })).toBe(
      "Chrome on Mac",
    )
    const safariPhone =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
    expect(defaultDeviceName({ kind: "web", userAgent: safariPhone })).toBe("Safari on iPhone")
    const edgeWin =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0"
    expect(defaultDeviceName({ kind: "web", userAgent: edgeWin })).toBe("Edge on Windows")
    const user = process.env.USER ?? "nobody-here"
    for (const name of [
      defaultDeviceName({ kind: "desktop", os: "macos" }),
      defaultDeviceName({ kind: "web", userAgent: chromeMac }),
    ]) {
      expect(name).not.toContain(user)
      expect(name).not.toContain(require("node:os").hostname())
    }
  })
})
