/**
 * `kimo-mp/1` error codes (docs/spec/multiplayer.md §13): one {@link MultiplayerError} type for
 * every failure that crosses a module boundary, the HTTP status and WebSocket close code of each
 * code, and whether a provider retries after it.
 */

export type MpErrorCode =
  | "BAD_REQUEST"
  | "BAD_MESSAGE"
  | "AUTH_INVALID"
  | "KEY_ROTATED"
  | "TOKEN_REVOKED"
  | "VIEW_ONLY"
  | "ROLE_UNSUPPORTED"
  | "ORIGIN_FORBIDDEN"
  | "RELAY_UNCLAIMED"
  | "NOT_OWNER"
  | "PAIRING_EXPIRED"
  | "PAIRING_USED"
  | "RELAY_CLAIMED"
  | "LAST_DEVICE"
  | "ROOM_NOT_FOUND"
  | "NOT_FOUND"
  | "HELLO_TIMEOUT"
  | "NONCE_REPLAY"
  | "SNAPSHOT_STALE"
  | "ROOM_CLOSED"
  | "TOO_LARGE"
  | "TOKEN_EXPIRED"
  | "ROOM_ID_MISMATCH"
  | "STALE_REQUEST"
  | "KEY_ID_INVALID"
  | "SNAPSHOT_AHEAD"
  | "PROTOCOL_MISMATCH"
  | "RATE_LIMITED"
  | "INTERNAL"
  | "ROOM_FULL"
  | "RELAY_FULL"
  | "LOG_FULL"
  | "QUOTA_EXCEEDED"
  | "DECRYPT_FAILED"
  | "BLOB_INTEGRITY"
  | "BAD_LINK"
  | "BAD_RELAY_URL"
  | "NOT_A_RELAY"
  | "RELAY_UNREACHABLE"
  | "CRYPTO_UNSUPPORTED"

export interface MpErrorInfo {
  /** HTTP status, when the code is used over HTTP. */
  http?: number
  /** WebSocket close code, when the relay closes with it. */
  close?: number
  /** Whether a provider reconnects after a close with this code. */
  retry: boolean
}

/** The §13 table. */
export const MP_ERRORS: Readonly<Record<MpErrorCode, MpErrorInfo>> = Object.freeze({
  BAD_REQUEST: { http: 400, retry: false },
  BAD_MESSAGE: { close: 4400, retry: false },
  AUTH_INVALID: { http: 401, close: 4401, retry: false },
  KEY_ROTATED: { http: 401, close: 4402, retry: false },
  TOKEN_REVOKED: { http: 403, close: 4403, retry: false },
  VIEW_ONLY: { http: 403, retry: false },
  ROLE_UNSUPPORTED: { http: 403, close: 4405, retry: false },
  ORIGIN_FORBIDDEN: { http: 403, retry: false },
  RELAY_UNCLAIMED: { http: 403, retry: false },
  NOT_OWNER: { http: 403, retry: false },
  PAIRING_EXPIRED: { http: 401, retry: false },
  PAIRING_USED: { http: 409, retry: false },
  RELAY_CLAIMED: { http: 409, retry: false },
  LAST_DEVICE: { http: 409, retry: false },
  ROOM_NOT_FOUND: { http: 404, close: 4404, retry: false },
  NOT_FOUND: { http: 404, retry: false },
  HELLO_TIMEOUT: { close: 4408, retry: true },
  NONCE_REPLAY: { http: 409, retry: false },
  SNAPSHOT_STALE: { http: 409, retry: false },
  ROOM_CLOSED: { http: 410, close: 4410, retry: false },
  TOO_LARGE: { http: 413, close: 4413, retry: false },
  TOKEN_EXPIRED: { http: 401, close: 4419, retry: false },
  ROOM_ID_MISMATCH: { http: 422, retry: false },
  STALE_REQUEST: { http: 422, retry: false },
  KEY_ID_INVALID: { http: 422, retry: false },
  SNAPSHOT_AHEAD: { http: 422, retry: false },
  PROTOCOL_MISMATCH: { http: 426, close: 4426, retry: false },
  RATE_LIMITED: { http: 429, close: 4429, retry: true },
  INTERNAL: { http: 500, close: 4500, retry: true },
  ROOM_FULL: { http: 503, close: 4503, retry: true },
  RELAY_FULL: { http: 503, retry: false },
  LOG_FULL: { close: 4507, retry: true },
  QUOTA_EXCEEDED: { http: 507, retry: false },
  DECRYPT_FAILED: { retry: false },
  BLOB_INTEGRITY: { retry: false },
  BAD_LINK: { retry: false },
  BAD_RELAY_URL: { retry: false },
  NOT_A_RELAY: { retry: false },
  RELAY_UNREACHABLE: { retry: true },
  CRYPTO_UNSUPPORTED: { retry: false },
} satisfies Record<MpErrorCode, MpErrorInfo>)

/** True when `value` is one of the §13 codes. */
export function isMpErrorCode(value: unknown): value is MpErrorCode {
  return typeof value === "string" && Object.hasOwn(MP_ERRORS, value)
}

export class MultiplayerError extends Error {
  override readonly name = "MultiplayerError" as const
  readonly code: MpErrorCode
  /** Server-suggested wait (from `retry-after`), in ms. */
  declare readonly retryAfterMs?: number

  constructor(
    code: MpErrorCode,
    message?: string,
    options?: { retryAfterMs?: number; cause?: unknown },
  ) {
    super(message ?? code, options?.cause === undefined ? undefined : { cause: options.cause })
    this.code = code
    if (options?.retryAfterMs !== undefined) this.retryAfterMs = options.retryAfterMs
  }
}

const BY_CLOSE = new Map<number, MpErrorCode>()
for (const [code, info] of Object.entries(MP_ERRORS) as [MpErrorCode, MpErrorInfo][])
  if (info.close !== undefined) BY_CLOSE.set(info.close, code)

/**
 * Close code to error. The §13 close codes map to their code; `1000`, `1001`, `1006`, `1012` and
 * the client-side liveness close `4000` are `RELAY_UNREACHABLE` (retry); `1009` is `TOO_LARGE`.
 * An unknown code falls back to the reason when the reason is an error code, else `INTERNAL`.
 */
export function errorFromClose(code: number, reason: string): MultiplayerError {
  const message = reason || `connection closed (${code})`
  const known = BY_CLOSE.get(code)
  if (known) return new MultiplayerError(known, message)
  if (code === 1000 || code === 1001 || code === 1006 || code === 1012 || code === 4000)
    return new MultiplayerError("RELAY_UNREACHABLE", message)
  if (code === 1009) return new MultiplayerError("TOO_LARGE", message)
  if (isMpErrorCode(reason)) return new MultiplayerError(reason, message)
  return new MultiplayerError("INTERNAL", message)
}

/** WebSocket close code the relay uses for `code`, or `undefined` when it never closes with it. */
export function closeCodeFor(code: MpErrorCode): number | undefined {
  return MP_ERRORS[code].close
}

/** Whether a provider retries after `error` (only a {@link MultiplayerError} can be retryable). */
export function isRetryable(error: unknown): boolean {
  return error instanceof MultiplayerError && MP_ERRORS[error.code].retry
}

let support: Promise<void> | null = null

/** Throws `CRYPTO_UNSUPPORTED` when Ed25519, HKDF or AES-GCM is missing. Probed once. */
export function assertCryptoSupport(): Promise<void> {
  support ??= probeCrypto()
  return support
}

async function probeCrypto(): Promise<void> {
  try {
    const subtle = globalThis.crypto?.subtle
    if (!subtle || typeof globalThis.crypto.getRandomValues !== "function")
      throw new Error("no WebCrypto")
    const pair = (await subtle.generateKey({ name: "Ed25519" }, false, [
      "sign",
      "verify",
    ])) as CryptoKeyPair
    const data = new Uint8Array(1)
    const sig = await subtle.sign("Ed25519", pair.privateKey, data)
    if (!(await subtle.verify("Ed25519", pair.publicKey, sig, data))) throw new Error("Ed25519")
    const base = await subtle.importKey("raw", new Uint8Array(32), "HKDF", false, ["deriveKey"])
    const aes = await subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new Uint8Array(0) },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    )
    await subtle.encrypt({ name: "AES-GCM", iv: new Uint8Array(12) }, aes, data)
  } catch (cause) {
    support = null
    throw new MultiplayerError(
      "CRYPTO_UNSUPPORTED",
      "this runtime's WebCrypto lacks Ed25519, HKDF or AES-GCM",
      { cause },
    )
  }
}
