import { describe, expect, test } from "bun:test"
import {
  deriveRoomId,
  deriveRoomKeys,
  ENVELOPE_OVERHEAD,
  EnvelopeKind,
  envelopeKind,
  generateRoomKey,
  openAwareness,
  openSnapshot,
  openUpdate,
  type RoomKeys,
  randomBytes,
  sealAwareness,
  sealSnapshot,
  sealUpdate,
  toHex,
} from "../../src/mp"
import { expectCode, flipBit } from "./helpers"

async function roomKeys(roomKey = generateRoomKey()): Promise<RoomKeys> {
  return deriveRoomKeys(roomKey, await deriveRoomId(randomBytes(32)))
}

const plaintext = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])

describe("envelopes", () => {
  test("round trip per kind, with the 30-byte layout", async () => {
    const keys = await roomKeys()
    const update = await sealUpdate(keys, plaintext)
    expect(update.length).toBe(plaintext.length + ENVELOPE_OVERHEAD)
    expect(ENVELOPE_OVERHEAD).toBe(30)
    expect([update[0], update[1]]).toEqual([1, EnvelopeKind.update])
    expect(await openUpdate(keys, update)).toEqual(plaintext)
    expect(await openSnapshot(keys, 9, await sealSnapshot(keys, 9, plaintext))).toEqual(plaintext)
    expect(await openAwareness(keys, 3, await sealAwareness(keys, 3, plaintext))).toEqual(plaintext)
    const empty = await sealUpdate(keys, new Uint8Array(0))
    expect(empty.length).toBe(30)
    expect((await openUpdate(keys, empty)).length).toBe(0)
  })

  test("large payloads round trip", async () => {
    const keys = await roomKeys()
    const big = randomBytes(1 << 20)
    expect(await openSnapshot(keys, 0, await sealSnapshot(keys, 0, big))).toEqual(big)
  })

  test("IVs differ between seals", async () => {
    const keys = await roomKeys()
    const ivs = new Set<string>()
    for (let i = 0; i < 50; i++) ivs.add(toHex((await sealUpdate(keys, plaintext)).subarray(2, 14)))
    expect(ivs.size).toBe(50)
  })

  test("wrong AAD inputs fail with DECRYPT_FAILED", async () => {
    const keys = await roomKeys()
    const roomKey = generateRoomKey()
    const a = await roomKeys(roomKey)
    // Same room key, another room id: the salt and the AAD both differ.
    const otherRoom = await roomKeys(roomKey)
    await expectCode(openUpdate(otherRoom, await sealUpdate(a, plaintext)), "DECRYPT_FAILED")
    await expectCode(
      openSnapshot(keys, 8, await sealSnapshot(keys, 9, plaintext)),
      "DECRYPT_FAILED",
    )
    await expectCode(
      openAwareness(keys, 4, await sealAwareness(keys, 3, plaintext)),
      "DECRYPT_FAILED",
    )
  })

  test("a wrong room key fails", async () => {
    const keys = await roomKeys()
    const other = await deriveRoomKeys(generateRoomKey(), keys.room)
    await expectCode(openUpdate(other, await sealUpdate(keys, plaintext)), "DECRYPT_FAILED")
  })

  test("a kind byte swap fails, even with the same key", async () => {
    const keys = await roomKeys()
    const update = await sealUpdate(keys, plaintext)
    const asSnapshot = update.slice()
    asSnapshot[1] = EnvelopeKind.snapshot
    await expectCode(openSnapshot(keys, 0, asSnapshot), "DECRYPT_FAILED")
    await expectCode(openSnapshot(keys, 0, update), "DECRYPT_FAILED")
    await expectCode(openUpdate(keys, await sealSnapshot(keys, 0, plaintext)), "DECRYPT_FAILED")
    await expectCode(openAwareness(keys, 0, update), "DECRYPT_FAILED")
  })

  test("every flipped bit and every truncation fails", async () => {
    const keys = await roomKeys()
    const env = await sealUpdate(keys, plaintext)
    for (let i = 0; i < env.length; i++)
      await expectCode(openUpdate(keys, flipBit(env, i, i % 8)), "DECRYPT_FAILED")
    for (let n = 0; n < env.length; n++)
      await expectCode(openUpdate(keys, env.subarray(0, n)), "DECRYPT_FAILED")
    const versioned = env.slice()
    versioned[0] = 2
    await expectCode(openUpdate(keys, versioned), "DECRYPT_FAILED")
  })

  test("envelopeKind", async () => {
    const keys = await roomKeys()
    expect(envelopeKind(await sealUpdate(keys, plaintext))).toBe(EnvelopeKind.update)
    expect(envelopeKind(await sealSnapshot(keys, 1, plaintext))).toBe(EnvelopeKind.snapshot)
    expect(envelopeKind(await sealAwareness(keys, 1, plaintext))).toBe(EnvelopeKind.awareness)
    expect(envelopeKind(new Uint8Array(29))).toBeNull()
    const bad = new Uint8Array(30)
    bad[0] = 1
    bad[1] = 5
    expect(envelopeKind(bad)).toBeNull()
    bad[1] = 4
    expect(envelopeKind(bad)).toBe(EnvelopeKind.blob)
    bad[0] = 2
    expect(envelopeKind(bad)).toBeNull()
  })

  test("invalid positions and IVs are BAD_REQUEST", async () => {
    const keys = await roomKeys()
    await expectCode(sealSnapshot(keys, -1, plaintext), "BAD_REQUEST")
    await expectCode(sealAwareness(keys, 1.5, plaintext), "BAD_REQUEST")
    await expectCode(openSnapshot(keys, Number.NaN, new Uint8Array(40)), "BAD_REQUEST")
    await expectCode(sealUpdate(keys, plaintext, { iv: new Uint8Array(8) }), "BAD_REQUEST")
  })

  test("deriveRoomKeys rejects a room key that is not 32 bytes", async () => {
    const room = await deriveRoomId(randomBytes(32))
    await expectCode(deriveRoomKeys(new Uint8Array(16), room), "BAD_REQUEST")
  })
})
