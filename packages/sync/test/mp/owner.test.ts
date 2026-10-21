import { describe, expect, test } from "bun:test"
import {
  concatBytes,
  deriveRoomId,
  exportPublicKey,
  fromBase64Url,
  generateSigningKeyPair,
  isDeviceName,
  mintPairingToken,
  type OwnerBody,
  PAIRING_TOKEN_BYTES,
  parseOwnerCommand,
  parsePairingToken,
  randomBytes,
  signOwnerCommand,
  signRegisterOwner,
  signWithContext,
  toBase64Url,
  utf8,
  verifyOwnerCommand,
  verifyPairingToken,
  verifyRegisterOwner,
  viewOf,
} from "../../src/mp"
import { expectCode, flipBit } from "./helpers"

const RELAY_ID = new Uint8Array(16).fill(3)
const IAT = 1_792_000_000_000

async function device() {
  const keys = await generateSigningKeyPair()
  return { keys, pub: await exportPublicKey(keys.publicKey) }
}

describe("owner commands", () => {
  test("every op signs, parses and verifies", async () => {
    const { keys, pub } = await device()
    const other = toBase64Url((await device()).pub)
    const bodies: OwnerBody[] = [
      { op: "claim", name: "Chrome on Mac" },
      { op: "devices" },
      { op: "pair", token: toBase64Url(randomBytes(148)), name: "Mac" },
      { op: "remove", pub: other },
      { op: "cancel-pairing", jti: "ab".repeat(16), exp: 1_792_000_900 },
      { op: "rename", pub: other, name: "Studio" },
    ]
    for (const body of bodies) {
      const nonce = new Uint8Array(16).fill(5)
      const bytes = await signOwnerCommand(keys, RELAY_ID, body, { iat: IAT, nonce })
      const command = parseOwnerCommand(bytes)
      const { op, ...rest } = body
      expect(command.op).toBe(op)
      expect(command.body).toEqual(rest)
      expect(command.iat).toBe(IAT)
      expect(command.nonce).toEqual(nonce)
      expect(command.relayId).toEqual(RELAY_ID)
      expect(command.devicePub).toEqual(pub)
      expect(await verifyOwnerCommand(command)).toBe(true)
    }
  })

  test("a flipped bit, another relayId or another device key fails", async () => {
    const { keys } = await device()
    const bytes = await signOwnerCommand(keys, RELAY_ID, { op: "devices" }, { iat: IAT })
    // The relayId lives in the signed header: flipping it breaks the signature.
    expect(await verifyOwnerCommand(parseOwnerCommand(flipBit(bytes, 30)))).toBe(false)
    expect(await verifyOwnerCommand(parseOwnerCommand(flipBit(bytes, bytes.length - 1)))).toBe(
      false,
    )
    // Claiming another device's key: the signature does not verify against it.
    const swapped = bytes.slice()
    swapped.set((await device()).pub, 44)
    expect(await verifyOwnerCommand(parseOwnerCommand(swapped))).toBe(false)
    const command = parseOwnerCommand(bytes)
    expect(await verifyOwnerCommand({ ...command, relayId: new Uint8Array(16) })).toBe(false)
    expect(await verifyOwnerCommand({ ...command, op: "claim", body: { name: "x" } })).toBe(false)
  })

  test("bad names and bodies over 16 KiB are BAD_REQUEST", async () => {
    const { keys } = await device()
    for (const name of ["", " Mac", "Mac ", "a\u0007b", "é".repeat(33)])
      await expectCode(signOwnerCommand(keys, RELAY_ID, { op: "claim", name }), "BAD_REQUEST")
    await expectCode(
      signOwnerCommand(keys, RELAY_ID, { op: "remove", pub: "short" }),
      "BAD_REQUEST",
    )
    await expectCode(signOwnerCommand(keys, new Uint8Array(15), { op: "devices" }), "BAD_REQUEST")
    // Hand-build an oversized body: signing refuses it, so bypass signOwnerCommand.
    const json = utf8(JSON.stringify({ pad: "x".repeat(16 * 1024) }))
    const payload = new Uint8Array(80 + json.length)
    payload.set([1, 4, 2, 0])
    viewOf(payload).setUint32(76, json.length)
    payload.set(json, 80)
    await expectCode(
      () => parseOwnerCommand(concatBytes(payload, new Uint8Array(64))),
      "BAD_REQUEST",
    )
    const ok = await signOwnerCommand(keys, RELAY_ID, { op: "devices" })
    await expectCode(() => parseOwnerCommand(ok.subarray(0, ok.length - 1)), "BAD_REQUEST")
    const admin = ok.slice()
    admin[1] = 3
    await expectCode(() => parseOwnerCommand(admin), "BAD_REQUEST")
  })

  test("isDeviceName", () => {
    expect(isDeviceName("Chrome on Mac")).toBe(true)
    expect(isDeviceName("a".repeat(64))).toBe(true)
    expect(isDeviceName("a".repeat(65))).toBe(false)
    expect(isDeviceName("tab\there")).toBe(false)
    expect(isDeviceName(7)).toBe(false)
  })
})

describe("register owner proof", () => {
  test("signs and verifies; fails for another room, nonce, iat, rootPub or relayId", async () => {
    const { keys } = await device()
    const rootPub = (await device()).pub
    const room = await deriveRoomId(rootPub)
    const input = { relayId: RELAY_ID, room, nonce: new Uint8Array(16).fill(1), iat: IAT, rootPub }
    const owner = await signRegisterOwner(keys, input)
    expect(owner.pub).toBe(toBase64Url(await exportPublicKey(keys.publicKey)))
    expect(await verifyRegisterOwner(owner, input)).toBe(true)
    const otherRoot = (await device()).pub
    for (const changed of [
      { room: await deriveRoomId(otherRoot) },
      { nonce: new Uint8Array(16).fill(2) },
      { iat: IAT + 1 },
      { rootPub: otherRoot },
      { relayId: new Uint8Array(16) },
    ])
      expect(await verifyRegisterOwner(owner, { ...input, ...changed })).toBe(false)
    expect(await verifyRegisterOwner({ ...owner, pub: toBase64Url(otherRoot) }, input)).toBe(false)
    expect(await verifyRegisterOwner({ pub: "x", sig: owner.sig }, input)).toBe(false)
  })
})

describe("pairing tokens", () => {
  const claims = () => ({
    iat: 1_792_000_000,
    exp: 1_792_000_900,
    jti: new Uint8Array(16).fill(4),
    relayId: RELAY_ID,
  })

  test("mint, parse (148 bytes) and verify", async () => {
    const { keys, pub } = await device()
    const token = await mintPairingToken(keys, claims())
    expect(fromBase64Url(token).length).toBe(PAIRING_TOKEN_BYTES)
    expect(PAIRING_TOKEN_BYTES).toBe(148)
    expect(token.length).toBe(198)
    const parsed = parsePairingToken(token)
    expect(parsed).toMatchObject({ ...claims(), issuerPub: pub })
    expect(await verifyPairingToken(parsed)).toBe(true)
    expect(await verifyPairingToken({ ...parsed, exp: parsed.exp + 1 })).toBe(false)
    const tampered = parsePairingToken(toBase64Url(flipBit(fromBase64Url(token), 30)))
    expect(await verifyPairingToken(tampered)).toBe(false)
  })

  test("mint refuses a lifetime over an hour or a non-increasing exp", async () => {
    const { keys } = await device()
    await expectCode(mintPairingToken(keys, { ...claims(), exp: 1_792_003_601 }), "BAD_REQUEST")
    await expectCode(mintPairingToken(keys, { ...claims(), exp: 1_792_000_000 }), "BAD_REQUEST")
  })

  test("trailing bytes, wrong type and nonzero flags are AUTH_INVALID", async () => {
    const { keys } = await device()
    const bytes = fromBase64Url(await mintPairingToken(keys, claims()))
    await expectCode(
      () => parsePairingToken(toBase64Url(concatBytes(bytes, new Uint8Array(1)))),
      "AUTH_INVALID",
    )
    for (const [index, value] of [
      [0, 2],
      [1, 1],
      [2, 1],
      [3, 1],
    ] as const) {
      const copy = bytes.slice()
      copy[index] = value
      await expectCode(() => parsePairingToken(toBase64Url(copy)), "AUTH_INVALID")
    }
    await expectCode(() => parsePairingToken("not a token!"), "AUTH_INVALID")
    // Re-signed with a nonzero flag: still refused at parse.
    const flagged = bytes.slice(0, 84)
    flagged[2] = 1
    const sig = await signWithContext(keys.privateKey, utf8("kimo/v1/pairing\0"), flagged)
    await expectCode(
      () => parsePairingToken(toBase64Url(concatBytes(flagged, sig))),
      "AUTH_INVALID",
    )
  })
})
