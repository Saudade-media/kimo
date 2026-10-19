/**
 * Room key and content keys (docs/spec/multiplayer.md §8). The 32-byte room key travels only in
 * link fragments; every content key is HKDF-SHA256 of it with `salt = roomIdRaw` and a fixed
 * `info` label, so two rooms never share a key even if a room key were reused.
 */
import { asBytes, type Bytes, randomBytes, toHex, utf8 } from "./bytes"
import { MultiplayerError } from "./errors"
import type { RoomId } from "./identity"

export const ROOM_KEY_BYTES = 32

export const HKDF_INFO = Object.freeze({
  doc: "kimo/v1/doc",
  awareness: "kimo/v1/awareness",
  blobId: "kimo/v1/blob-id",
  blobPrefix: "kimo/v1/blob/",
} as const)

/** 32 random bytes. */
export function generateRoomKey(): Uint8Array {
  return randomBytes(ROOM_KEY_BYTES)
}

export interface RoomKeys {
  readonly room: RoomId
  readonly doc: CryptoKey
  readonly awareness: CryptoKey
  readonly blobMac: CryptoKey
  /** AES-GCM key for one blob, from the plaintext SHA-256 (32 bytes). */
  blobKey(sha256: Uint8Array): Promise<CryptoKey>
}

function hkdfParams(room: RoomId, info: string): HkdfParams {
  return { name: "HKDF", hash: "SHA-256", salt: asBytes(room.raw), info: utf8(info) }
}

async function importBase(roomKey: Uint8Array): Promise<CryptoKey> {
  if (!(roomKey instanceof Uint8Array) || roomKey.length !== ROOM_KEY_BYTES)
    throw new MultiplayerError("BAD_REQUEST", "a room key is 32 bytes")
  return crypto.subtle.importKey("raw", asBytes(roomKey), "HKDF", false, [
    "deriveKey",
    "deriveBits",
  ])
}

const AES: AesKeyGenParams = { name: "AES-GCM", length: 256 }
const AES_USAGES: KeyUsage[] = ["encrypt", "decrypt"]

/** Derives the room's non-extractable content keys. */
export async function deriveRoomKeys(roomKey: Uint8Array, room: RoomId): Promise<RoomKeys> {
  const base = await importBase(roomKey)
  const subtle = crypto.subtle
  const roomCopy: RoomId = Object.freeze({ id: room.id, raw: room.raw.slice() })
  const [doc, awareness, blobMac] = await Promise.all([
    subtle.deriveKey(hkdfParams(room, HKDF_INFO.doc), base, AES, false, AES_USAGES),
    subtle.deriveKey(hkdfParams(room, HKDF_INFO.awareness), base, AES, false, AES_USAGES),
    subtle.deriveKey(
      hkdfParams(room, HKDF_INFO.blobId),
      base,
      { name: "HMAC", hash: "SHA-256", length: 256 },
      false,
      ["sign", "verify"],
    ),
  ])
  return Object.freeze({
    room: roomCopy,
    doc,
    awareness,
    blobMac,
    blobKey(sha256: Uint8Array): Promise<CryptoKey> {
      if (!(sha256 instanceof Uint8Array) || sha256.length !== 32)
        return Promise.reject(new MultiplayerError("BAD_REQUEST", "a SHA-256 digest is 32 bytes"))
      return subtle.deriveKey(
        hkdfParams(roomCopy, HKDF_INFO.blobPrefix + toHex(sha256)),
        base,
        AES,
        false,
        AES_USAGES,
      )
    },
  })
}

/**
 * The 32 raw bytes HKDF derives for `info` (what {@link deriveRoomKeys} turns into keys). For test
 * vectors and diagnostics; production code keeps derived keys non-extractable.
 */
export async function deriveKeyBits(
  roomKey: Uint8Array,
  room: RoomId,
  info: string,
): Promise<Bytes> {
  const base = await importBase(roomKey)
  return new Uint8Array(await crypto.subtle.deriveBits(hkdfParams(room, info), base, 256))
}
