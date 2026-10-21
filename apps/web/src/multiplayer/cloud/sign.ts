/**
 * Request signing for Kimo Cloud (kimo-cloud docs/api.md §2): no sessions, every request is signed
 * by this install's device key (ADR 0017, `../device-key`), the same key that owns relays.
 *
 *   message = UTF-8("kimo/v1/cloud\0") || UTF-8(canonicalJson({v: 1, aud, method, path, iat,
 *             nonce, pub, body}))
 *
 * `aud` is the configured API origin, `path` includes the query, `body` is the base64url SHA-256
 * of the exact body bytes (of zero bytes without a body). Headers: `kimo-pub`, `kimo-iat`,
 * `kimo-nonce`, `kimo-sig`.
 */
import { randomBytes, toBase64Url } from "@kimo/sync/mp"

export const CLOUD_SIGN_CONTEXT = "kimo/v1/cloud\0"

/** JSON with sorted object keys and no whitespace (the same form as `canonicalJson` in tokens.ts). */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

/** Base64url SHA-256 of `bytes`. */
export async function bodyHash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice())
  return toBase64Url(new Uint8Array(digest))
}

export interface SignInput {
  aud: string
  method: string
  /** Path with the query string, as sent. */
  path: string
  iat: number
  /** Base64url of 16 bytes; fresh per request. */
  nonce: string
  pub: string
  /** The exact body bytes (empty without a body). */
  body: Uint8Array
}

/** The canonical string that is signed (after the context). */
export async function canonicalRequest(input: SignInput): Promise<string> {
  return canonicalJson({
    v: 1,
    aud: input.aud,
    method: input.method.toUpperCase(),
    path: input.path,
    iat: input.iat,
    nonce: input.nonce,
    pub: input.pub,
    body: await bodyHash(input.body),
  })
}

export interface SignedHeaders {
  "kimo-pub": string
  "kimo-iat": string
  "kimo-nonce": string
  "kimo-sig": string
}

/** Signs one request with `privateKey` (Ed25519, non-extractable is fine). */
export async function signRequest(privateKey: CryptoKey, input: SignInput): Promise<SignedHeaders> {
  const message = new TextEncoder().encode(CLOUD_SIGN_CONTEXT + (await canonicalRequest(input)))
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, privateKey, message))
  return {
    "kimo-pub": input.pub,
    "kimo-iat": String(input.iat),
    "kimo-nonce": input.nonce,
    "kimo-sig": toBase64Url(sig),
  }
}

/** A fresh nonce: base64url of 16 random bytes (22 characters). */
export const newNonce = () => toBase64Url(randomBytes(16))
