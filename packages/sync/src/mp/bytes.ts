/**
 * Byte helpers for `kimo-mp/1` (docs/spec/multiplayer.md §2): strict base64url and base32 (no
 * padding, canonical trailing bits), lowercase hex, UTF-8, big-endian integers, concatenation,
 * constant-time comparison and random bytes. Runtime-neutral (browser, Bun, worker).
 *
 * Every decoder here rejects anything a conforming encoder would not produce, so one byte string
 * has exactly one text form (tokens, room ids and keys compare as text in places).
 */
import { MultiplayerError } from "./errors"

/** A `Uint8Array` over a plain `ArrayBuffer`, the shape WebCrypto and `fetch` bodies accept. */
export type Bytes = Uint8Array<ArrayBuffer>

/** Narrows any `Uint8Array` to {@link Bytes} for WebCrypto (copies only a shared-buffer view). */
export function asBytes(bytes: Uint8Array): Bytes {
  return bytes.buffer instanceof ArrayBuffer ? (bytes as Bytes) : new Uint8Array(bytes)
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
const B32 = "abcdefghijklmnopqrstuvwxyz234567"
const B64_INDEX = indexOf(B64)
const B32_INDEX = indexOf(B32)

function indexOf(alphabet: string): Int16Array {
  const table = new Int16Array(128).fill(-1)
  for (let i = 0; i < alphabet.length; i++) table[alphabet.charCodeAt(i)] = i
  return table
}

function bad(what: string): MultiplayerError {
  return new MultiplayerError("BAD_REQUEST", `invalid ${what}`)
}

/** Unpadded base64url (RFC 4648 §5). */
export function toBase64Url(bytes: Uint8Array): string {
  return encodeBits(bytes, B64, 6)
}

/**
 * Decodes unpadded base64url. Rejects `=`, `+`, `/`, whitespace, impossible lengths and nonzero
 * trailing bits (`BAD_REQUEST`).
 */
export function fromBase64Url(text: string): Bytes {
  return decodeBits(text, B64_INDEX, 6, "base64url")
}

/** Lowercase unpadded base32 (RFC 4648 alphabet, most significant bit first). */
export function toBase32(bytes: Uint8Array): string {
  return encodeBits(bytes, B32, 5)
}

/** Decodes lowercase unpadded base32; uppercase, padding and invalid lengths are `BAD_REQUEST`. */
export function fromBase32(text: string): Bytes {
  return decodeBits(text, B32_INDEX, 5, "base32")
}

function encodeBits(bytes: Uint8Array, alphabet: string, width: number): string {
  const mask = (1 << width) - 1
  let out = ""
  let acc = 0
  let bits = 0
  for (const byte of bytes) {
    acc = ((acc << 8) | byte) & 0xffff
    bits += 8
    while (bits >= width) {
      bits -= width
      out += alphabet[(acc >> bits) & mask]
    }
  }
  if (bits > 0) out += alphabet[(acc << (width - bits)) & mask]
  return out
}

function decodeBits(text: string, index: Int16Array, width: number, what: string): Bytes {
  if (typeof text !== "string") throw bad(what)
  const length = Math.floor((text.length * width) / 8)
  // A valid encoding uses the fewest characters, so the leftover bits are fewer than `width`.
  if (text.length * width - length * 8 >= width) throw bad(what)
  const out = new Uint8Array(length)
  let acc = 0
  let bits = 0
  let o = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    const value = code < 128 ? (index[code] as number) : -1
    if (value < 0) throw bad(what)
    acc = ((acc << width) | value) & 0xffff
    bits += width
    if (bits >= 8) {
      bits -= 8
      out[o++] = (acc >> bits) & 0xff
    }
  }
  if (bits > 0 && (acc & ((1 << bits) - 1)) !== 0) throw bad(what)
  return out
}

/** Lowercase hex. */
export function toHex(bytes: Uint8Array): string {
  let out = ""
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0")
  return out
}

/** Decodes lowercase hex of even length (`BAD_REQUEST` otherwise). */
export function fromHex(text: string): Bytes {
  if (typeof text !== "string" || text.length % 2 !== 0 || !/^[0-9a-f]*$/.test(text))
    throw bad("hex")
  const out = new Uint8Array(text.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(text.slice(i * 2, i * 2 + 2), 16)
  return out
}

const encoder = new TextEncoder()
const strictDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })

/** UTF-8 bytes of `text`. */
export function utf8(text: string): Bytes {
  return encoder.encode(text) as Bytes
}

/** Decodes UTF-8; malformed input is `BAD_REQUEST` (never replacement characters). */
export function fromUtf8(bytes: Uint8Array): string {
  try {
    return strictDecoder.decode(bytes)
  } catch {
    throw bad("UTF-8")
  }
}

/** Concatenates `parts` into one new array. */
export function concatBytes(...parts: Uint8Array[]): Bytes {
  let length = 0
  for (const part of parts) length += part.length
  const out = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** Byte equality; constant time when the lengths are equal (lengths are not secret). */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number)
  return diff === 0
}

/** `length` bytes from `crypto.getRandomValues` (chunked past its 65 536-byte limit). */
export function randomBytes(length: number): Bytes {
  const out = new Uint8Array(length)
  for (let offset = 0; offset < length; offset += 65_536)
    crypto.getRandomValues(out.subarray(offset, Math.min(length, offset + 65_536)))
  return out
}

/** Largest `u64` the protocol carries (§2): `2^53 - 1`. */
export const MAX_U64 = Number.MAX_SAFE_INTEGER
/** Largest `u32`. */
export const MAX_U32 = 0xffff_ffff

/** True for an integer in `[0, max]`. */
export function isUint(value: unknown, max: number = MAX_U64): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max
}

/** Writes a big-endian `u32` at `offset`. */
export function writeU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value)
}

/** Writes a big-endian `u64` (at most `2^53 - 1`) at `offset`. */
export function writeU64(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, Math.floor(value / 0x1_0000_0000))
  view.setUint32(offset + 4, value >>> 0)
}

/** Reads a big-endian `u32`. */
export function readU32(view: DataView, offset: number): number {
  return view.getUint32(offset)
}

/** Reads a big-endian `u64`; returns -1 when it exceeds `2^53 - 1` (callers reject it). */
export function readU64(view: DataView, offset: number): number {
  const high = view.getUint32(offset)
  if (high > 0x1f_ffff) return -1
  return high * 0x1_0000_0000 + view.getUint32(offset + 4)
}

/** A `DataView` over exactly `bytes`. */
export function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}
