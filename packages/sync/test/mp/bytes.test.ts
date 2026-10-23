import { describe, expect, test } from "bun:test"
import {
  concatBytes,
  equalBytes,
  fromBase32,
  fromBase64Url,
  fromHex,
  fromUtf8,
  MAX_U64,
  randomBytes,
  readU64,
  toBase32,
  toBase64Url,
  toHex,
  utf8,
  viewOf,
  writeU64,
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

  test("rejects padding, +, /, whitespace and other characters", async () => {
    for (const bad of ["AQ==", "AQ=", "a+b_", "a/b_", "AQ ", " AQ", "AQ\n", "A.Q", "é"])
      await expectCode(() => fromBase64Url(bad), "BAD_REQUEST")
  })

  test("rejects impossible lengths and nonzero trailing bits", async () => {
    await expectCode(() => fromBase64Url("A"), "BAD_REQUEST")
    await expectCode(() => fromBase64Url("AAAAA"), "BAD_REQUEST")
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

  test("RFC 4648 test vectors (lowercased, unpadded)", () => {
    const cases: [string, string][] = [
      ["", ""],
      ["f", "my"],
      ["fo", "mzxq"],
      ["foo", "mzxw6"],
      ["foob", "mzxw6yq"],
      ["fooba", "mzxw6ytb"],
      ["foobar", "mzxw6ytboi"],
    ]
    for (const [plain, encoded] of cases) {
      expect(toBase32(utf8(plain))).toBe(encoded)
      expect(fromUtf8(fromBase32(encoded))).toBe(plain)
    }
  })

  test("rejects uppercase, padding, invalid characters and lengths", async () => {
    for (const bad of ["MY", "my======", "m1", "m8", "a", "abc", "abcdef", "mz=q"])
      await expectCode(() => fromBase32(bad), "BAD_REQUEST")
    // "mz" decodes to 0x66 only with zero trailing bits.
    await expectCode(() => fromBase32("mz"), "BAD_REQUEST")
  })
})

describe("hex, UTF-8 and helpers", () => {
  test("hex round trip, lowercase only", async () => {
    const bytes = new Uint8Array([0, 1, 0xab, 0xff])
    expect(toHex(bytes)).toBe("0001abff")
    expect(fromHex("0001abff")).toEqual(bytes)
    for (const bad of ["0", "AB", "0g", "00 "]) await expectCode(() => fromHex(bad), "BAD_REQUEST")
  })

  test("strict UTF-8 decoding", async () => {
    expect(fromUtf8(utf8("héllo ✓"))).toBe("héllo ✓")
    await expectCode(() => fromUtf8(new Uint8Array([0xc3, 0x28])), "BAD_REQUEST")
  })

  test("equalBytes and concatBytes", () => {
    expect(equalBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true)
    expect(equalBytes(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false)
    expect(equalBytes(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false)
    expect(equalBytes(new Uint8Array(0), new Uint8Array(0))).toBe(true)
    expect(concatBytes(new Uint8Array([1]), new Uint8Array(0), new Uint8Array([2, 3]))).toEqual(
      new Uint8Array([1, 2, 3]),
    )
  })

  test("randomBytes beyond the getRandomValues chunk limit", () => {
    const big = randomBytes(70_000)
    expect(big.length).toBe(70_000)
    expect(big.subarray(65_536).some((b) => b !== 0)).toBe(true)
    expect(randomBytes(16)).not.toEqual(randomBytes(16))
  })

  test("u64 big-endian up to 2^53 - 1", () => {
    const buf = new Uint8Array(8)
    for (const value of [0, 1, 0xffff_ffff, 0x1_0000_0000, MAX_U64]) {
      writeU64(viewOf(buf), 0, value)
      expect(readU64(viewOf(buf), 0)).toBe(value)
    }
    expect(toHex(buf)).toBe("001fffffffffffff")
    buf[1] = 0x20
    expect(readU64(viewOf(buf), 0)).toBe(-1)
  })
})
