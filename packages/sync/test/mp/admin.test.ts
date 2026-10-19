import { describe, expect, test } from "bun:test"
import {
  type AdminBody,
  concatBytes,
  deriveRoomId,
  exportPublicKey,
  generateSigningKeyPair,
  parseAdminCommand,
  signAdminCommand,
  signLinkCert,
  signWithContext,
  toBase64Url,
  toHex,
  utf8,
  verifyAdminCommand,
  viewOf,
} from "../../src/mp"
import { expectCode, flipBit } from "./helpers"

async function setup() {
  const root = await generateSigningKeyPair()
  const rootPub = await exportPublicKey(root.publicKey)
  const room = await deriveRoomId(rootPub)
  const link = await generateSigningKeyPair()
  const cert = await signLinkCert(root.privateKey, {
    kid: 1,
    iat: 1_800_000_000,
    room,
    linkPub: await exportPublicKey(link.publicKey),
  })
  return { root, rootPub, room, cert: toBase64Url(cert.bytes) }
}

const blobId = "ab".repeat(32)

describe("admin commands", () => {
  test("every op signs and parses back its body", async () => {
    const { root, rootPub, room, cert } = await setup()
    const bodies: AdminBody[] = [
      { op: "register", rootPub: toBase64Url(rootPub), cert },
      { op: "revoke", jti: "00".repeat(16), exp: 0 },
      { op: "rotate", cert },
      { op: "close" },
      { op: "sweep", keep: [blobId] },
      { op: "sweep", keep: [], graceDays: 7 },
    ]
    for (const body of bodies) {
      const nonce = new Uint8Array(16).fill(9)
      const bytes = await signAdminCommand(root.privateKey, room, body, {
        iat: 1_792_000_000_000,
        nonce,
      })
      const command = parseAdminCommand(bytes)
      const { op, ...rest } = body
      expect(command.op).toBe(op)
      expect(command.body).toEqual(rest)
      expect(command.iat).toBe(1_792_000_000_000)
      expect(command.nonce).toEqual(nonce)
      expect(command.room.id).toBe(room.id)
      expect(await verifyAdminCommand(command, rootPub)).toBe(true)
    }
  })

  test("defaults: iat is now and nonces are random", async () => {
    const { root, room } = await setup()
    const before = Date.now()
    const a = parseAdminCommand(await signAdminCommand(root.privateKey, room, { op: "close" }))
    const b = parseAdminCommand(await signAdminCommand(root.privateKey, room, { op: "close" }))
    expect(a.iat).toBeGreaterThanOrEqual(before)
    expect(a.iat).toBeLessThanOrEqual(Date.now())
    expect(toHex(a.nonce)).not.toBe(toHex(b.nonce))
  })

  test("a tampered body, header or signature fails verification", async () => {
    const { root, rootPub, room } = await setup()
    const bytes = await signAdminCommand(root.privateKey, room, {
      op: "revoke",
      jti: "11".repeat(16),
      exp: 5,
    })
    // Change the exp digit in the JSON body (5 -> 7) so it still parses.
    const at = bytes.lastIndexOf(0x35, bytes.length - 65)
    const body = flipBit(bytes, at, 1)
    expect(parseAdminCommand(body).body.exp).toBe(7)
    expect(await verifyAdminCommand(parseAdminCommand(body), rootPub)).toBe(false)
    for (const i of [6, 12, 20, bytes.length - 1]) {
      const parsed = parseAdminCommand(flipBit(bytes, i))
      expect(await verifyAdminCommand(parsed, rootPub)).toBe(false)
    }
  })

  test("a parsed command with any field changed after parsing fails verification", async () => {
    const { root, rootPub, room } = await setup()
    const bytes = await signAdminCommand(root.privateKey, room, {
      op: "revoke",
      jti: "11".repeat(16),
      exp: 5,
    })
    const parsed = parseAdminCommand(bytes)
    expect(await verifyAdminCommand(parsed, rootPub)).toBe(true)
    // A copy with the same body in another key order is still the signed body.
    expect(
      await verifyAdminCommand({ ...parsed, body: { exp: 5, jti: "11".repeat(16) } }, rootPub),
    ).toBe(true)
    const tampered = [
      { ...parsed, op: "close" as const },
      { ...parsed, body: {} },
      { ...parsed, body: { ...parsed.body, exp: 6 } },
      { ...parsed, iat: 1 },
      { ...parsed, nonce: new Uint8Array(16) },
    ]
    for (const command of tampered) expect(await verifyAdminCommand(command, rootPub)).toBe(false)
    expect(
      await verifyAdminCommand({ ...parsed, payload: parsed.payload.subarray(0, 10) }, rootPub),
    ).toBe(false)
  })

  test("another root key or another room fails verification", async () => {
    const a = await setup()
    const b = await setup()
    const own = parseAdminCommand(
      await signAdminCommand(a.root.privateKey, a.room, { op: "close" }),
    )
    expect(await verifyAdminCommand(own, b.rootPub)).toBe(false)
    const crossed = parseAdminCommand(
      await signAdminCommand(a.root.privateKey, b.room, { op: "close" }),
    )
    expect(await verifyAdminCommand(crossed, a.rootPub)).toBe(false)
    expect(await verifyAdminCommand(crossed, b.rootPub)).toBe(false)
    expect(await verifyAdminCommand({ ...own, room: b.room }, a.rootPub)).toBe(false)
  })

  test("body length mismatch and format errors are BAD_REQUEST", async () => {
    const { root, room } = await setup()
    const bytes = await signAdminCommand(root.privateKey, room, { op: "close" })
    const withU32 = (offset: number, value: number) => {
      const copy = bytes.slice()
      viewOf(copy).setUint32(offset, value)
      return copy
    }
    const withByte = (i: number, v: number) => {
      const copy = bytes.slice()
      copy[i] = v
      return copy
    }
    await expectCode(() => parseAdminCommand(withU32(48, 3)), "BAD_REQUEST")
    await expectCode(() => parseAdminCommand(withU32(48, 2 ** 20 + 1)), "BAD_REQUEST")
    await expectCode(() => parseAdminCommand(concatBytes(bytes, new Uint8Array(1))), "BAD_REQUEST")
    await expectCode(() => parseAdminCommand(bytes.subarray(0, 100)), "BAD_REQUEST")
    await expectCode(() => parseAdminCommand(withByte(0, 2)), "BAD_REQUEST")
    await expectCode(() => parseAdminCommand(withByte(1, 1)), "BAD_REQUEST")
    await expectCode(() => parseAdminCommand(withByte(2, 0)), "BAD_REQUEST")
    await expectCode(() => parseAdminCommand(withByte(2, 6)), "BAD_REQUEST")
    await expectCode(() => parseAdminCommand(withByte(3, 1)), "BAD_REQUEST")
    await expectCode(() => parseAdminCommand(withByte(4, 0xff)), "BAD_REQUEST")
  })

  test("bodies that break their op's schema are rejected on both sides", async () => {
    const { root, room } = await setup()
    const bad = [
      { op: "register", rootPub: "", cert: "x" },
      { op: "register", rootPub: "a=", cert: "x" },
      { op: "revoke", jti: "AB".repeat(16), exp: 0 },
      { op: "revoke", jti: "00".repeat(16), exp: -1 },
      { op: "rotate" },
      { op: "sweep", keep: ["nope"] },
      { op: "sweep", keep: [], graceDays: 0 },
      { op: "sweep", keep: [], graceDays: 1.5 },
      { op: "reboot" },
    ] as unknown as AdminBody[]
    for (const body of bad)
      await expectCode(signAdminCommand(root.privateKey, room, body), "BAD_REQUEST")
    // The same bodies signed by hand are refused by the parser.
    const raw = async (op: number, json: string) => {
      const body = utf8(json)
      const payload = new Uint8Array(52 + body.length)
      payload.set([1, 3, op, 0])
      payload.set(room.raw, 28)
      viewOf(payload).setUint32(48, body.length)
      payload.set(body, 52)
      return concatBytes(
        payload,
        await signWithContext(root.privateKey, utf8("kimo/v1/admin\0"), payload),
      )
    }
    await expectCode(() => parseAdminCommand(new Uint8Array()), "BAD_REQUEST")
    for (const [op, json] of [
      [2, '{"jti":"zz","exp":0}'],
      [5, '{"keep":"x"}'],
      [4, "[]"],
      [4, "null"],
      [4, "{"],
    ] as const)
      await expectCode(async () => parseAdminCommand(await raw(op, json)), "BAD_REQUEST")
    expect(parseAdminCommand(await raw(4, '{"future":1}')).body).toEqual({ future: 1 })
  })

  test("signing rejects a bad nonce or iat", async () => {
    const { root, room } = await setup()
    await expectCode(
      signAdminCommand(root.privateKey, room, { op: "close" }, { nonce: new Uint8Array(8) }),
      "BAD_REQUEST",
    )
    await expectCode(
      signAdminCommand(root.privateKey, room, { op: "close" }, { iat: -5 }),
      "BAD_REQUEST",
    )
  })
})
