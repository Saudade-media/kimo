import { describe, expect, test } from "bun:test"
import {
  assertCryptoSupport,
  closeCodeFor,
  errorFromClose,
  isMpErrorCode,
  isRetryable,
  MP_ERRORS,
  type MpErrorCode,
  MultiplayerError,
} from "../../src/mp"

const ALL_CODES: MpErrorCode[] = [
  "BAD_REQUEST",
  "BAD_MESSAGE",
  "AUTH_INVALID",
  "KEY_ROTATED",
  "TOKEN_REVOKED",
  "VIEW_ONLY",
  "ROLE_UNSUPPORTED",
  "ORIGIN_FORBIDDEN",
  "RELAY_UNCLAIMED",
  "NOT_OWNER",
  "PAIRING_EXPIRED",
  "PAIRING_USED",
  "RELAY_CLAIMED",
  "LAST_DEVICE",
  "ROOM_NOT_FOUND",
  "NOT_FOUND",
  "HELLO_TIMEOUT",
  "NONCE_REPLAY",
  "SNAPSHOT_STALE",
  "ROOM_CLOSED",
  "TOO_LARGE",
  "TOKEN_EXPIRED",
  "ROOM_ID_MISMATCH",
  "STALE_REQUEST",
  "KEY_ID_INVALID",
  "SNAPSHOT_AHEAD",
  "PROTOCOL_MISMATCH",
  "RATE_LIMITED",
  "INTERNAL",
  "ROOM_FULL",
  "RELAY_FULL",
  "LOG_FULL",
  "QUOTA_EXCEEDED",
  "DECRYPT_FAILED",
  "BLOB_INTEGRITY",
  "BAD_LINK",
  "BAD_RELAY_URL",
  "NOT_A_RELAY",
  "RELAY_UNREACHABLE",
  "CRYPTO_UNSUPPORTED",
]

describe("MP_ERRORS", () => {
  test("covers exactly the §13 codes", () => {
    expect(Object.keys(MP_ERRORS).sort()).toEqual([...ALL_CODES].sort())
    for (const code of ALL_CODES) expect(isMpErrorCode(code)).toBe(true)
    expect(isMpErrorCode("toString")).toBe(false)
    expect(isMpErrorCode("NOPE")).toBe(false)
  })

  test("close codes are unique and map back to their code", () => {
    const closes = ALL_CODES.map((c) => MP_ERRORS[c].close).filter((c) => c !== undefined)
    expect(new Set(closes).size).toBe(closes.length)
    for (const code of ALL_CODES) {
      const close = closeCodeFor(code)
      if (close === undefined) continue
      expect(errorFromClose(close, code).code).toBe(code)
    }
  })

  test("spot checks against the table", () => {
    expect(MP_ERRORS.TOKEN_EXPIRED).toEqual({ http: 401, close: 4419, retry: false })
    expect(MP_ERRORS.LOG_FULL).toEqual({ close: 4507, retry: true })
    expect(MP_ERRORS.RELAY_UNREACHABLE.retry).toBe(true)
    expect(MP_ERRORS.ROOM_FULL).toEqual({ http: 503, close: 4503, retry: true })
  })
})

describe("errorFromClose", () => {
  test("standard codes", () => {
    for (const code of [1000, 1001, 1006, 1012, 4000])
      expect(errorFromClose(code, "").code).toBe("RELAY_UNREACHABLE")
    expect(errorFromClose(1009, "").code).toBe("TOO_LARGE")
  })

  test("unknown codes use the reason when it is a code, else INTERNAL", () => {
    expect(errorFromClose(4999, "ROOM_CLOSED").code).toBe("ROOM_CLOSED")
    expect(errorFromClose(4999, "whatever").code).toBe("INTERNAL")
    expect(errorFromClose(3000, "").message).toContain("3000")
  })
})

describe("MultiplayerError", () => {
  test("carries code, message, retryAfterMs and cause", () => {
    const cause = new Error("x")
    const error = new MultiplayerError("RATE_LIMITED", "slow down", { retryAfterMs: 2000, cause })
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe("MultiplayerError")
    expect(error.code).toBe("RATE_LIMITED")
    expect(error.message).toBe("slow down")
    expect(error.retryAfterMs).toBe(2000)
    expect(error.cause).toBe(cause)
    expect(new MultiplayerError("INTERNAL").message).toBe("INTERNAL")
  })

  test("isRetryable", () => {
    expect(isRetryable(new MultiplayerError("RELAY_UNREACHABLE"))).toBe(true)
    expect(isRetryable(new MultiplayerError("TOKEN_EXPIRED"))).toBe(false)
    expect(isRetryable(new Error("network"))).toBe(false)
    expect(isRetryable(null)).toBe(false)
  })

  test("assertCryptoSupport passes on Bun", async () => {
    await assertCryptoSupport()
  })
})
