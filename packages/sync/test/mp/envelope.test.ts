import { describe, expect, test } from "bun:test"
import {
  blobIdFor,
  deriveRoomId,
  deriveRoomKeys,
  ENVELOPE_OVERHEAD,
  EnvelopeKind,
  generateRoomKey,
  isBlobId,
  openAwareness,
  openBlob,
  openSnapshot,
  openUpdate,
  type RoomKeys,
  randomBytes,
  sealAwareness,
  sealBlob,
  sealSnapshot,
  sealUpdate,
  sha256,
  toHex,
  utf8,
} from "../../src/mp"
import { expectCode, flipBit } from "./helpers"

async function roomKeys(roomKey = generateRoomKey()): Promise<RoomKeys> {
  return deriveRoomKeys(roomKey, await deriveRoomId(randomBytes(32)))
}

const plaintext = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])

describe("envelopes", () => {
  test("round trip per kind, including an empty payload", async () => {
    const keys = await roomKeys()
    const update = await sealUpdate(keys, plaintext)
    expect(update.length).toBe(plaintext.length + ENVELOPE_OVERHEAD)
    expect(await openUpdate(keys, update)).toEqual(plaintext)
    expect(await openSnapshot(keys, 9, await sealSnapshot(keys, 9, plaintext))).toEqual(plaintext)
    expect(await openAwareness(keys, 3, await sealAwareness(keys, 3, plaintext))).toEqual(plaintext)
    const empty = await sealUpdate(keys, new Uint8Array(0))
    expect((await openUpdate(keys, empty)).length).toBe(0)
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
})

describe("blob envelopes", () => {
  test("seal and open round trip; the id is 64 hex", async () => {
    const keys = await roomKeys()
    const bytes = randomBytes(5000)
    const sealed = await sealBlob(keys, bytes)
    expect(isBlobId(sealed.id)).toBe(true)
    expect(sealed.sha).toEqual(await sha256(bytes))
    expect(await openBlob(keys, sealed.sha, sealed.envelope)).toEqual(bytes)
    for (const bad of ["0".repeat(63), "A".repeat(64), `${"0".repeat(63)}g`])
      expect(isBlobId(bad)).toBe(false)
  })

  test("the same plaintext has the same id in one room and different ids in two", async () => {
    const roomKey = generateRoomKey()
    const a = await roomKeys(roomKey)
    const b = await roomKeys(roomKey)
    const bytes = utf8("logo.png bytes")
    const first = await sealBlob(a, bytes)
    const second = await sealBlob(a, bytes)
    expect(second.id).toBe(first.id)
    expect(second.envelope).not.toEqual(first.envelope)
    expect((await sealBlob(b, bytes)).id).not.toBe(first.id)
    expect(await blobIdFor(a, first.sha)).toBe(first.id)
  })

  test("a wrong sha is DECRYPT_FAILED and a lying sender is BLOB_INTEGRITY", async () => {
    const keys = await roomKeys()
    const bytes = utf8("real")
    const sealed = await sealBlob(keys, bytes)
    await expectCode(openBlob(keys, await sha256(utf8("fake")), sealed.envelope), "DECRYPT_FAILED")
    const claimed = await sha256(utf8("claimed"))
    const lying = await sealBlob(keys, bytes, { sha: claimed })
    await expectCode(openBlob(keys, claimed, lying.envelope), "BLOB_INTEGRITY")
  })

  test("tampering and wrong room keys fail", async () => {
    const keys = await roomKeys()
    const sealed = await sealBlob(keys, randomBytes(100))
    await expectCode(openBlob(keys, sealed.sha, flipBit(sealed.envelope, 50)), "DECRYPT_FAILED")
    const other = await deriveRoomKeys(generateRoomKey(), keys.room)
    await expectCode(openBlob(other, sealed.sha, sealed.envelope), "DECRYPT_FAILED")
  })
})
