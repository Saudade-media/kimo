/**
 * Blob ids and blob encryption (docs/spec/multiplayer.md §10). A blob's id is
 * `hex(HMAC-SHA256(blobMac, SHA-256(plaintext)))`: stable within a room (the relay dedupes) and
 * unlinkable across rooms and to the content. Each blob has its own AES-GCM key derived from the
 * room key and its plaintext digest.
 */
import { asBytes, equalBytes, toHex } from "./bytes"
import { blobAad, EnvelopeKind, open, type SealOptions, seal } from "./envelope"
import { MultiplayerError } from "./errors"
import type { RoomKeys } from "./keys"

const BLOB_ID_PATTERN = /^[0-9a-f]{64}$/

/** SHA-256 digest (32 bytes). */
export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", asBytes(bytes)))
}

function checkSha(sha: Uint8Array): void {
  if (!(sha instanceof Uint8Array) || sha.length !== 32)
    throw new MultiplayerError("BAD_REQUEST", "a SHA-256 digest is 32 bytes")
}

/** The relay-side id of the blob whose plaintext digest is `sha`. */
export async function blobIdFor(keys: RoomKeys, sha: Uint8Array): Promise<string> {
  checkSha(sha)
  return toHex(new Uint8Array(await crypto.subtle.sign("HMAC", keys.blobMac, asBytes(sha))))
}

/**
 * Encrypts an asset for upload. `sha` skips hashing when the caller already has the digest (a
 * wrong one is caught by the receiver as `BLOB_INTEGRITY`).
 */
export async function sealBlob(
  keys: RoomKeys,
  plaintext: Uint8Array,
  options?: SealOptions & { sha?: Uint8Array },
): Promise<{ id: string; sha: Uint8Array; envelope: Uint8Array }> {
  const sha = options?.sha ? options.sha.slice() : await sha256(plaintext)
  checkSha(sha)
  const id = await blobIdFor(keys, sha)
  const key = await keys.blobKey(sha)
  const sealOptions = options?.iv ? { iv: options.iv } : undefined
  const envelope = await seal(EnvelopeKind.blob, key, blobAad(keys, id), plaintext, sealOptions)
  return { id, sha, envelope }
}

/**
 * Opens a downloaded blob and checks `SHA-256(plaintext) == sha` (`BLOB_INTEGRITY`). A wrong `sha`
 * usually fails earlier as `DECRYPT_FAILED` (it selects another key and id).
 */
export async function openBlob(
  keys: RoomKeys,
  sha: Uint8Array,
  envelope: Uint8Array,
): Promise<Uint8Array> {
  checkSha(sha)
  const id = await blobIdFor(keys, sha)
  const key = await keys.blobKey(sha)
  const plaintext = await open(EnvelopeKind.blob, key, blobAad(keys, id), envelope)
  if (!equalBytes(await sha256(plaintext), sha))
    throw new MultiplayerError("BLOB_INTEGRITY", "blob does not match its SHA-256")
  return plaintext
}

/** True for a 64-character lowercase hex blob id. */
export function isBlobId(id: unknown): id is string {
  return typeof id === "string" && BLOB_ID_PATTERN.test(id)
}
