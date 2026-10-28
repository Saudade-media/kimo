import { describe, expect, test } from "bun:test"
import {
  fromBase32,
  fromBase64Url,
  fromHex,
  fromUtf8,
  randomBytes,
  toBase32,
  toBase64Url,
  toHex,
  utf8,
} from "../../src/mp"
import { expectCode } from "./helpers"

const lengths = Array.from({ length: 65 }, (_, i) => i)

describe("base64url", () => {
  test("round trips lengths 0 to 64 and matches Buffer", () => {
    for (const n of lengths) {
      const bytes = randomBytes(n)
      const text = toBase64Url(bytes)
      expect(text).toBe(Buffer.from(bytes).toString("base64url"))
      expect(text).not.toContain("=")
      expect(fromBase64Url(text)).toEqual(bytes)
    }
  })

  test("rejects padding, the standard alphabet, whitespace and non-canonical trailing bits", async () => {
    for (const bad of ["AQ==", "a+b_", "AQ ", "A", "AAAAA", "A.Q", "é"])
      await expectCode(() => fromBase64Url(bad), "BAD_REQUEST")
    // "AR" decodes to 0x01 with trailing bits 0001: only "AQ" is canonical.
    await expectCode(() => fromBase64Url("AR"), "BAD_REQUEST")
    expect(fromBase64Url("AQ")).toEqual(new Uint8Array([1]))
  })
})

describe("base32", () => {
  test("round trips lengths 0 to 64 in lowercase", () => {
    for (const n of lengths) {
      const bytes = randomBytes(n)
      const text = toBase32(bytes)
      expect(text).toMatch(/^[a-z2-7]*$/)
      expect(fromBase32(text)).toEqual(bytes)
    }
  })

  test("matches RFC 4648 and rejects uppercase, padding, bad lengths and nonzero trailing bits", async () => {
    expect(toBase32(utf8("foobar"))).toBe("mzxw6ytboi")
    expect(fromUtf8(fromBase32("mzxw6ytboi"))).toBe("foobar")
    // "mz" decodes to 0x66 only with zero trailing bits.
    for (const bad of ["MY", "my======", "m1", "a", "abc", "mz"])
      await expectCode(() => fromBase32(bad), "BAD_REQUEST")
  })
})

describe("hex and random bytes", () => {
  test("hex round trip, lowercase only", async () => {
    const bytes = new Uint8Array([0, 1, 0xab, 0xff])
    expect(toHex(bytes)).toBe("0001abff")
    expect(fromHex("0001abff")).toEqual(bytes)
    for (const bad of ["0", "AB", "0g", "00 "]) await expectCode(() => fromHex(bad), "BAD_REQUEST")
  })

  test("randomBytes beyond the getRandomValues chunk limit", () => {
    const big = randomBytes(70_000)
    expect(big.length).toBe(70_000)
    expect(big.subarray(65_536).some((b) => b !== 0)).toBe(true)
    expect(randomBytes(16)).not.toEqual(randomBytes(16))
  })
})
