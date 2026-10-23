import { describe, expect, test } from "bun:test"
import {
  concatBytes,
  deriveRoomId,
  exportPublicKey,
  fromBase64Url,
  generateSigningKeyPair,
  isMpOrigin,
  mintToken,
  parseToken,
  type RoomId,
  randomBytes,
  signWithContext,
  TOKEN_MIN_BYTES,
  type TokenClaims,
  toBase64Url,
  utf8,
  verifyTokenSignature,
} from "../../src/mp"
import { expectCode, flipBit } from "./helpers"

async function setup() {
  const root = await generateSigningKeyPair()
  const link = await generateSigningKeyPair()
  const room = await deriveRoomId(await exportPublicKey(root.publicKey))
  const linkPub = await exportPublicKey(link.publicKey)
  return { link, linkPub, room }
}

function claims(room: RoomId, overrides: Partial<TokenClaims> = {}): TokenClaims {
  return {
    room,
    role: "view",
    kid: 1,
    iat: 1_800_000_000,
    exp: 1_800_086_400,
    jti: randomBytes(16),
    origin: "user",
    ...overrides,
  }
}

/** Signs arbitrary payload bytes the way a token is signed (to build malformed tokens). */
async function rawToken(key: CryptoKey, payload: Uint8Array): Promise<string> {
  const signature = await signWithContext(key, utf8("kimo/v1/token\0"), payload)
  return toBase64Url(concatBytes(payload, signature))
}

describe("capability tokens", () => {
  test("mint, parse and verify every role and origin", async () => {
    const { link, linkPub, room } = await setup()
    for (const role of ["view", "edit", "comment"] as const)
      for (const origin of ["user", "agent:claude-1", "mcp:figma"] as const) {
        const c = claims(room, { role, origin })
        const token = await mintToken(link.privateKey, c)
        const parsed = parseToken(token)
        expect(parsed.role).toBe(role)
        expect(parsed.origin).toBe(origin)
        expect(parsed.kid).toBe(1)
        expect(parsed.iat).toBe(c.iat)
        expect(parsed.exp).toBe(c.exp)
        expect(parsed.jti).toEqual(c.jti)
        expect(parsed.room.id).toBe(room.id)
        expect(await verifyTokenSignature(parsed, linkPub)).toBe(true)
      }
  })

  test("exp = 0 (never) and large times round trip", async () => {
    const { link, room } = await setup()
    const never = parseToken(await mintToken(link.privateKey, claims(room, { exp: 0 })))
    expect(never.exp).toBe(0)
    const far = parseToken(
      await mintToken(link.privateKey, claims(room, { exp: Number.MAX_SAFE_INTEGER })),
    )
    expect(far.exp).toBe(Number.MAX_SAFE_INTEGER)
  })

  test("a wrong link key fails verification", async () => {
    const { link, room } = await setup()
    const other = await setup()
    const parsed = parseToken(await mintToken(link.privateKey, claims(room)))
    expect(await verifyTokenSignature(parsed, other.linkPub)).toBe(false)
    expect(await verifyTokenSignature(parsed, new Uint8Array(32))).toBe(false)
    expect(await verifyTokenSignature(parsed, new Uint8Array(5))).toBe(false)
  })

  test("a parsed token with any field changed after parsing fails verification", async () => {
    const { link, linkPub, room } = await setup()
    const other = await setup()
    const token = await mintToken(link.privateKey, claims(room, { origin: "agent:a1" }))
    const parsed = parseToken(token)
    expect(await verifyTokenSignature(parsed, linkPub)).toBe(true)
    expect(await verifyTokenSignature({ ...parsed }, linkPub)).toBe(true)
    const tampered = [
      { ...parsed, role: "edit" as const },
      { ...parsed, kid: 2 },
      { ...parsed, iat: 1 },
      { ...parsed, exp: parsed.exp + 1 },
      { ...parsed, jti: new Uint8Array(16) },
      { ...parsed, origin: "user" as const },
      { ...parsed, room: other.room },
    ]
    for (const t of tampered) expect(await verifyTokenSignature(t, linkPub)).toBe(false)
  })

  test("any flipped payload or signature bit fails", async () => {
    const { link, linkPub, room } = await setup()
    const bytes = fromBase64Url(await mintToken(link.privateKey, claims(room, { role: "edit" })))
    let checked = 0
    for (let i = 0; i < bytes.length; i++) {
      let parsed: ReturnType<typeof parseToken>
      try {
        parsed = parseToken(toBase64Url(flipBit(bytes, i, i % 8)))
      } catch (error) {
        expect((error as { code: string }).code).toBe("AUTH_INVALID")
        continue
      }
      expect(await verifyTokenSignature(parsed, linkPub)).toBe(false)
      checked++
    }
    expect(checked).toBeGreaterThan(100)
  })

  test("a token without an origin field is 124 bytes and parses as user", async () => {
    const { link, linkPub, room } = await setup()
    const full = fromBase64Url(await mintToken(link.privateKey, claims(room)))
    const payload = full.slice(0, 60)
    payload[3] = 0
    const token = await rawToken(link.privateKey, payload)
    expect(fromBase64Url(token).length).toBe(TOKEN_MIN_BYTES)
    expect(token.length).toBe(166)
    const parsed = parseToken(token)
    expect(parsed.origin).toBe("user")
    expect(await verifyTokenSignature(parsed, linkPub)).toBe(true)
  })

  test("format errors are AUTH_INVALID", async () => {
    const { link, room } = await setup()
    const full = fromBase64Url(await mintToken(link.privateKey, claims(room)))
    const payload = full.slice(0, full.length - 64)
    const variant = async (edit: (p: Uint8Array) => Uint8Array) =>
      rawToken(link.privateKey, edit(payload.slice()))
    const set = (i: number, v: number) => (p: Uint8Array) => {
      p[i] = v
      return p
    }
    const cases: Record<string, string> = {
      "trailing bytes": toBase64Url(concatBytes(full, new Uint8Array([0]))),
      truncated: toBase64Url(full.subarray(0, full.length - 1)),
      "too short": toBase64Url(full.subarray(0, 100)),
      "unknown version": await variant(set(0, 2)),
      "wrong type": await variant(set(1, 2)),
      "role 0": await variant(set(2, 0)),
      "role 4": await variant(set(2, 4)),
      "reserved flag bit": await variant(set(3, 0b11)),
      "origin length 0": await variant(set(60, 0)),
      "origin length past the end": await variant(set(60, 64)),
      "u64 over 2^53 - 1": await variant(set(16, 0x01)),
      "invalid origin grammar": await rawToken(
        link.privateKey,
        concatBytes(payload.subarray(0, 60), new Uint8Array([4]), utf8("root")),
      ),
      "origin with whitespace": await rawToken(
        link.privateKey,
        concatBytes(payload.subarray(0, 60), new Uint8Array([7]), utf8("agent:a b")),
      ),
      "origin over 64 bytes": await rawToken(
        link.privateKey,
        concatBytes(payload.subarray(0, 60), new Uint8Array([70]), utf8(`agent:${"x".repeat(64)}`)),
      ),
      "origin not UTF-8": await rawToken(
        link.privateKey,
        concatBytes(payload.subarray(0, 60), new Uint8Array([8, ...utf8("agent:"), 0xc3, 0x28])),
      ),
      "not base64url": `${toBase64Url(full)}=`,
      empty: "",
      huge: "A".repeat(5000),
    }
    for (const [name, token] of Object.entries(cases)) {
      try {
        parseToken(token)
      } catch (error) {
        expect([name, (error as { code: string }).code]).toEqual([name, "AUTH_INVALID"])
        continue
      }
      throw new Error(`${name} parsed`)
    }
  })

  test("mint rejects invalid claims", async () => {
    const { link, room } = await setup()
    const bad: Partial<TokenClaims>[] = [
      { kid: 0 },
      { kid: 2 ** 32 },
      { iat: -1 },
      { exp: 1.5 },
      { exp: 2 ** 53 },
      { jti: new Uint8Array(15) },
      { origin: "system" as never },
      { origin: `agent:${"x".repeat(60)}` as never },
      { role: "owner" as never },
    ]
    for (const overrides of bad)
      await expectCode(mintToken(link.privateKey, claims(room, overrides)), "BAD_REQUEST")
  })

  test("isMpOrigin follows the LocalOrigin grammar within 64 bytes", () => {
    for (const ok of ["user", "agent:a", "agent:claude/1", "mcp:x", `agent:${"x".repeat(58)}`])
      expect(isMpOrigin(ok)).toBe(true)
    for (const bad of [
      "",
      "system",
      "file",
      "agent:",
      "mcp:",
      "agent:a b",
      "agent:a\n",
      "User",
      ` user`,
      `agent:${"x".repeat(59)}`,
      42,
      null,
    ])
      expect(isMpOrigin(bad)).toBe(false)
  })
})
