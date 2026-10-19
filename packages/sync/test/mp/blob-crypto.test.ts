import { describe, expect, test } from "bun:test"
import {
  blobIdFor,
  deriveRoomId,
  deriveRoomKeys,
  generateRoomKey,
  isBlobId,
  openBlob,
  type RoomKeys,
  randomBytes,
  sealBlob,
  sha256,
  utf8,
} from "../../src/mp"
import { expectCode, flipBit } from "./helpers"

async function roomKeys(roomKey = generateRoomKey()): Promise<RoomKeys> {
  return deriveRoomKeys(roomKey, await deriveRoomId(randomBytes(32)))
}

describe("blobs", () => {
  test("seal and open round trip; the id is 64 hex", async () => {
    const keys = await roomKeys()
    const bytes = randomBytes(5000)
    const sealed = await sealBlob(keys, bytes)
    expect(isBlobId(sealed.id)).toBe(true)
    expect(sealed.sha).toEqual(await sha256(bytes))
    expect(sealed.envelope.length).toBe(bytes.length + 30)
    expect(sealed.envelope[1]).toBe(4)
    expect(await openBlob(keys, sealed.sha, sealed.envelope)).toEqual(bytes)
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
    const otherKey = await deriveRoomKeys(generateRoomKey(), a.room)
    expect((await sealBlob(otherKey, bytes)).id).not.toBe(first.id)
    expect(await blobIdFor(a, first.sha)).toBe(first.id)
  })

  test("a wrong sha is DECRYPT_FAILED (other key) and a lying sender is BLOB_INTEGRITY", async () => {
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
    await expectCode(openBlob(keys, sealed.sha.subarray(0, 16), sealed.envelope), "BAD_REQUEST")
  })

  test("isBlobId", () => {
    expect(isBlobId("0".repeat(64))).toBe(true)
    for (const bad of ["0".repeat(63), "0".repeat(65), "A".repeat(64), `${"0".repeat(63)}g`, 5])
      expect(isBlobId(bad)).toBe(false)
  })
})
