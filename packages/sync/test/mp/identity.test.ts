import { describe, expect, test } from "bun:test"
import {
  deriveRoomId,
  exportPublicKey,
  generateSigningKeyPair,
  importPublicKey,
  isRoomId,
  LINK_CERT_BYTES,
  parseLinkCert,
  parseRoomId,
  signLinkCert,
  verifyLinkCert,
} from "../../src/mp"
import { expectCode, flipBit } from "./helpers"

async function owner() {
  const root = await generateSigningKeyPair()
  const link = await generateSigningKeyPair()
  const rootPub = await exportPublicKey(root.publicKey)
  const linkPub = await exportPublicKey(link.publicKey)
  return { root, link, rootPub, linkPub, room: await deriveRoomId(rootPub) }
}

describe("room id", () => {
  test("is 32 base32 characters over 20 raw bytes", async () => {
    const { room, rootPub } = await owner()
    expect(room.id).toMatch(/^[a-z2-7]{32}$/)
    expect(room.raw.length).toBe(20)
    expect(isRoomId(room.id)).toBe(true)
    expect(parseRoomId(room.id).raw).toEqual(room.raw)
    expect((await deriveRoomId(rootPub)).id).toBe(room.id)
  })

  test("parseRoomId rejects bad input", async () => {
    const good = "5jbqciof3sh24vopwga56zxa5n5o4u3r"
    for (const bad of [
      "",
      good.slice(1),
      `${good}a`,
      good.toUpperCase(),
      `${good.slice(0, 31)}1`,
      `${good.slice(0, 31)}=`,
    ]) {
      expect(isRoomId(bad)).toBe(false)
      await expectCode(() => parseRoomId(bad), "BAD_REQUEST")
    }
  })

  test("deriveRoomId rejects a key that is not 32 bytes", async () => {
    await expectCode(deriveRoomId(new Uint8Array(31)), "BAD_REQUEST")
  })
})

describe("signing keys", () => {
  test("private keys are non-extractable by default; public keys export raw", async () => {
    const pair = await generateSigningKeyPair()
    expect(pair.privateKey.extractable).toBe(false)
    expect((await exportPublicKey(pair.publicKey)).length).toBe(32)
    expect((await generateSigningKeyPair(true)).privateKey.extractable).toBe(true)
  })

  test("importPublicKey round trips and rejects wrong lengths", async () => {
    const pair = await generateSigningKeyPair()
    const raw = await exportPublicKey(pair.publicKey)
    expect(await exportPublicKey(await importPublicKey(raw))).toEqual(raw)
    await expectCode(importPublicKey(new Uint8Array(33)), "BAD_REQUEST")
  })
})

describe("link certificates", () => {
  test("sign, parse, verify", async () => {
    const { root, rootPub, linkPub, room } = await owner()
    const cert = await signLinkCert(root.privateKey, { kid: 3, iat: 1_800_000_000, room, linkPub })
    expect(cert.bytes.length).toBe(LINK_CERT_BYTES)
    const parsed = parseLinkCert(cert.bytes)
    expect(parsed.kid).toBe(3)
    expect(parsed.iat).toBe(1_800_000_000)
    expect(parsed.room.id).toBe(room.id)
    expect(parsed.linkPub).toEqual(linkPub)
    expect(await verifyLinkCert(parsed, rootPub)).toBe(true)
  })

  test("tampering, wrong root key and another room fail", async () => {
    const a = await owner()
    const b = await owner()
    const cert = await signLinkCert(a.root.privateKey, {
      kid: 1,
      iat: 1,
      room: a.room,
      linkPub: a.linkPub,
    })
    for (let i = 2; i < cert.bytes.length; i += 9) {
      const tampered = flipBit(cert.bytes, i)
      let parsed: ReturnType<typeof parseLinkCert>
      try {
        parsed = parseLinkCert(tampered)
      } catch {
        continue
      }
      expect(await verifyLinkCert(parsed, a.rootPub)).toBe(false)
    }
    expect(await verifyLinkCert(parseLinkCert(cert.bytes), b.rootPub)).toBe(false)
    // Signed by A's root key but naming B's room: never valid for either.
    const crossed = await signLinkCert(a.root.privateKey, {
      kid: 1,
      iat: 1,
      room: b.room,
      linkPub: a.linkPub,
    })
    expect(await verifyLinkCert(crossed, a.rootPub)).toBe(false)
    expect(await verifyLinkCert(crossed, b.rootPub)).toBe(false)
    // A hand-built object whose fields differ from the signed bytes.
    expect(await verifyLinkCert({ ...parseLinkCert(cert.bytes), kid: 2 }, a.rootPub)).toBe(false)
  })

  test("parse rejects malformed bytes", async () => {
    const { root, linkPub, room } = await owner()
    const cert = await signLinkCert(root.privateKey, { kid: 1, iat: 1, room, linkPub })
    const withByte = (i: number, v: number) => {
      const copy = cert.bytes.slice()
      copy[i] = v
      return copy
    }
    await expectCode(() => parseLinkCert(cert.bytes.subarray(0, 129)), "AUTH_INVALID")
    await expectCode(() => parseLinkCert(new Uint8Array([...cert.bytes, 0])), "AUTH_INVALID")
    await expectCode(() => parseLinkCert(withByte(0, 2)), "AUTH_INVALID")
    await expectCode(() => parseLinkCert(withByte(1, 1)), "AUTH_INVALID")
    const kidZero = cert.bytes.slice()
    kidZero.set([0, 0, 0, 0], 2)
    await expectCode(() => parseLinkCert(kidZero), "AUTH_INVALID")
  })

  test("sign rejects invalid input", async () => {
    const { root, linkPub, room } = await owner()
    await expectCode(
      signLinkCert(root.privateKey, { kid: 0, iat: 1, room, linkPub }),
      "BAD_REQUEST",
    )
    await expectCode(
      signLinkCert(root.privateKey, { kid: 1, iat: -1, room, linkPub }),
      "BAD_REQUEST",
    )
    await expectCode(
      signLinkCert(root.privateKey, { kid: 1, iat: 1, room, linkPub: new Uint8Array(31) }),
      "BAD_REQUEST",
    )
  })
})
