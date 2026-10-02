/**
 * Node ids (spec §2: `^[A-Za-z0-9]{6,24}$`). Kimo generates 10-character base-62 ids.
 */
import { ID_PATTERN } from "@kimo/core-schema"

const ID_RE = new RegExp(ID_PATTERN)
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

/** True when `id` is a legal node id. */
export function isNodeId(id: unknown): id is string {
  return typeof id === "string" && ID_RE.test(id)
}

/**
 * Generates a random 10-character base-62 node id (~59.5 bits). Uses
 * `crypto.getRandomValues`, available in browsers, workers, Bun and Node ≥ 19.
 */
export function generateId(length = 10): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  const bytes = new Uint8Array(length)
  if (c?.getRandomValues) c.getRandomValues(bytes)
  else for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256)
  let out = ""
  // 248 = 4 * 62: rejection-free modulo bias is negligible for ids, but keep it unbiased anyway.
  for (let i = 0; i < length; i++) {
    let b = bytes[i] as number
    while (b >= 248) b = Math.floor(Math.random() * 248)
    out += ALPHABET[b % 62]
  }
  return out
}

/** Short random token (base 36) for epochs and temp names. */
export function randomToken(length = 8): string {
  let s = ""
  while (s.length < length) s += generateId(length).toLowerCase()
  return s.slice(0, length)
}
