/**
 * Room identity (docs/spec/multiplayer.md §3, §5): Ed25519 key pairs, the self-certifying room id
 * derived from the root public key, and link certificates that bind a link key to a room under
 * the root key.
 */
import {
  asBytes,
  type Bytes,
  concatBytes,
  equalBytes,
  fromBase32,
  isUint,
  MAX_U32,
  readU32,
  readU64,
  toBase32,
  utf8,
  viewOf,
  writeU32,
  writeU64,
} from "./bytes"
import { MultiplayerError } from "./errors"

export interface RoomId {
  /** 32-character base32. */
  id: string
  /** 20 bytes. */
  raw: Uint8Array
}

/** Length of an Ed25519 public key and of `roomIdRaw`. */
export const PUBLIC_KEY_BYTES = 32
export const ROOM_ID_BYTES = 20
export const SIGNATURE_BYTES = 64

const ROOM_ID_CONTEXT = utf8("kimo/v1/room-id")
const CERT_CONTEXT = utf8("kimo/v1/cert\0")
const ROOM_ID_PATTERN = /^[a-z2-7]{32}$/

/** Ed25519 key pair; private key non-extractable unless asked (the public key always is). */
export async function generateSigningKeyPair(extractable = false): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey({ name: "Ed25519" }, extractable, [
    "sign",
    "verify",
  ])) as CryptoKeyPair
}

/** Raw 32-byte Ed25519 public key. */
export async function exportPublicKey(key: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.exportKey("raw", key))
}

/** Imports a raw 32-byte Ed25519 public key for `verify` (`BAD_REQUEST` on a wrong length). */
export async function importPublicKey(raw: Uint8Array): Promise<CryptoKey> {
  if (!(raw instanceof Uint8Array) || raw.length !== PUBLIC_KEY_BYTES)
    throw new MultiplayerError("BAD_REQUEST", "an Ed25519 public key is 32 bytes")
  try {
    return await crypto.subtle.importKey("raw", asBytes(raw), { name: "Ed25519" }, true, ["verify"])
  } catch (cause) {
    throw new MultiplayerError("BAD_REQUEST", "invalid Ed25519 public key", { cause })
  }
}

/** `roomIdRaw = SHA-256("kimo/v1/room-id" || rootPub)[0..20]`, `id = base32(roomIdRaw)`. */
export async function deriveRoomId(rootPublicKey: Uint8Array): Promise<RoomId> {
  if (!(rootPublicKey instanceof Uint8Array) || rootPublicKey.length !== PUBLIC_KEY_BYTES)
    throw new MultiplayerError("BAD_REQUEST", "an Ed25519 public key is 32 bytes")
  const digest = await crypto.subtle.digest("SHA-256", concatBytes(ROOM_ID_CONTEXT, rootPublicKey))
  const raw = new Uint8Array(digest, 0, ROOM_ID_BYTES).slice()
  return { id: toBase32(raw), raw }
}

/** True for a 32-character lowercase base32 room id. */
export function isRoomId(id: string): boolean {
  return typeof id === "string" && ROOM_ID_PATTERN.test(id)
}

/** Parses a room id string (`BAD_REQUEST` when it is not 32 lowercase base32 characters). */
export function parseRoomId(id: string): RoomId {
  if (!isRoomId(id)) throw new MultiplayerError("BAD_REQUEST", "invalid room id")
  return { id, raw: fromBase32(id) }
}

/** Room id from its 20 raw bytes. */
export function roomIdFromRaw(raw: Uint8Array): RoomId {
  if (raw.length !== ROOM_ID_BYTES) throw new MultiplayerError("BAD_REQUEST", "invalid room id")
  const copy = raw.slice()
  return { id: toBase32(copy), raw: copy }
}

/** Whether `room` is the room of `rootPublicKey` (false for a malformed key). */
export async function roomMatchesRootKey(
  room: RoomId,
  rootPublicKey: Uint8Array,
): Promise<boolean> {
  if (!(rootPublicKey instanceof Uint8Array) || rootPublicKey.length !== PUBLIC_KEY_BYTES)
    return false
  return equalBytes((await deriveRoomId(rootPublicKey)).raw, room.raw)
}

/** Ed25519 signature over `context || payload`. */
export async function signWithContext(
  privateKey: CryptoKey,
  context: Uint8Array,
  payload: Uint8Array,
): Promise<Bytes> {
  return new Uint8Array(
    await crypto.subtle.sign("Ed25519", privateKey, concatBytes(context, payload)),
  )
}

/** Verifies an Ed25519 signature over `context || payload`; false (never throws) on any failure. */
export async function verifyWithContext(
  publicKey: Uint8Array,
  context: Uint8Array,
  payload: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  if (signature.length !== SIGNATURE_BYTES) return false
  try {
    const key = await importPublicKey(publicKey)
    return await crypto.subtle.verify(
      "Ed25519",
      key,
      asBytes(signature),
      concatBytes(context, payload),
    )
  } catch {
    return false
  }
}

export interface LinkCert {
  kid: number
  iat: number
  room: RoomId
  linkPub: Uint8Array
  /** The full certificate bytes (payload and signature). */
  bytes: Uint8Array
}

const CERT_VERSION = 1
const CERT_TYPE = 2
const CERT_PAYLOAD_BYTES = 66
/** Certificate size: 66-byte payload and a 64-byte signature. */
export const LINK_CERT_BYTES = CERT_PAYLOAD_BYTES + SIGNATURE_BYTES

/** Signs a link certificate (§5) with the room's root private key. */
export async function signLinkCert(
  rootPrivateKey: CryptoKey,
  input: { kid: number; iat: number; room: RoomId; linkPub: Uint8Array },
): Promise<LinkCert> {
  const { kid, iat, room, linkPub } = input
  if (!isUint(kid, MAX_U32) || kid < 1)
    throw new MultiplayerError("BAD_REQUEST", "kid must be an integer from 1 to 2^32 - 1")
  if (!isUint(iat)) throw new MultiplayerError("BAD_REQUEST", "iat must be unix seconds")
  if (room.raw.length !== ROOM_ID_BYTES)
    throw new MultiplayerError("BAD_REQUEST", "invalid room id")
  if (linkPub.length !== PUBLIC_KEY_BYTES)
    throw new MultiplayerError("BAD_REQUEST", "an Ed25519 public key is 32 bytes")
  const payload = new Uint8Array(CERT_PAYLOAD_BYTES)
  const view = viewOf(payload)
  payload[0] = CERT_VERSION
  payload[1] = CERT_TYPE
  writeU32(view, 2, kid)
  writeU64(view, 6, iat)
  payload.set(room.raw, 14)
  payload.set(linkPub, 34)
  const signature = await signWithContext(rootPrivateKey, CERT_CONTEXT, payload)
  return {
    kid,
    iat,
    room: { id: room.id, raw: room.raw.slice() },
    linkPub: linkPub.slice(),
    bytes: concatBytes(payload, signature),
  }
}

/** Parses certificate bytes (`AUTH_INVALID` on any format error; the signature is not checked). */
export function parseLinkCert(bytes: Uint8Array): LinkCert {
  const invalid = (why: string) => new MultiplayerError("AUTH_INVALID", `link certificate: ${why}`)
  if (!(bytes instanceof Uint8Array) || bytes.length !== LINK_CERT_BYTES)
    throw invalid("wrong length")
  if (bytes[0] !== CERT_VERSION) throw invalid("unknown version")
  if (bytes[1] !== CERT_TYPE) throw invalid("not a link certificate")
  const view = viewOf(bytes)
  const kid = readU32(view, 2)
  if (kid < 1) throw invalid("kid must be at least 1")
  const iat = readU64(view, 6)
  if (iat < 0) throw invalid("iat out of range")
  return {
    kid,
    iat,
    room: roomIdFromRaw(bytes.subarray(14, 34)),
    linkPub: bytes.slice(34, 66),
    bytes: bytes.slice(),
  }
}

/**
 * Checks the root signature and that the certificate's room is the room of `rootPublicKey`
 * (a certificate for another room never verifies). Never throws.
 */
export async function verifyLinkCert(cert: LinkCert, rootPublicKey: Uint8Array): Promise<boolean> {
  if (cert.bytes.length !== LINK_CERT_BYTES) return false
  if (!(await roomMatchesRootKey(cert.room, rootPublicKey))) return false
  const payload = cert.bytes.subarray(0, CERT_PAYLOAD_BYTES)
  // The parsed fields must be the signed ones (a caller could hand-build a mismatched object).
  if (!equalBytes(payload.subarray(14, 34), cert.room.raw)) return false
  if (!equalBytes(payload.subarray(34, 66), cert.linkPub)) return false
  const view = viewOf(payload)
  if (readU32(view, 2) !== cert.kid || readU64(view, 6) !== cert.iat) return false
  return verifyWithContext(
    rootPublicKey,
    CERT_CONTEXT,
    payload,
    cert.bytes.subarray(CERT_PAYLOAD_BYTES),
  )
}
