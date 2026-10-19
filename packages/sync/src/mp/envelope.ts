/**
 * Encrypted envelopes (docs/spec/multiplayer.md §9): `version || kind || iv || AES-GCM(ciphertext
 * || tag)`, 30 bytes of overhead. The associated data binds each envelope to its room, its kind
 * and (for snapshots, awareness and blobs) the position or sender it claims, so the blind relay
 * cannot replay one as another.
 */
import { asBytes, type Bytes, isUint, randomBytes, utf8 } from "./bytes"
import { MultiplayerError } from "./errors"
import type { RoomKeys } from "./keys"

export const ENVELOPE_VERSION = 1
export const EnvelopeKind = { update: 1, snapshot: 2, awareness: 3, blob: 4 } as const
export type EnvelopeKind = (typeof EnvelopeKind)[keyof typeof EnvelopeKind]

export const IV_BYTES = 12
const TAG_BYTES = 16
const HEADER_BYTES = 2 + IV_BYTES
/** Bytes an envelope adds to its plaintext. */
export const ENVELOPE_OVERHEAD = HEADER_BYTES + TAG_BYTES

/** `iv` is for tests and vectors only. */
export interface SealOptions {
  iv?: Uint8Array
}

/** Associated data `kimo/v1|<roomId>|<parts...>`. */
function aad(roomId: string, ...parts: (string | number)[]): Bytes {
  return utf8(["kimo/v1", roomId, ...parts].join("|"))
}

function checkPosition(name: string, value: number): void {
  if (!isUint(value)) throw new MultiplayerError("BAD_REQUEST", `${name} must be an integer >= 0`)
}

/** Seals `plaintext` under `key` as an envelope of `kind`. */
export async function seal(
  kind: EnvelopeKind,
  key: CryptoKey,
  additionalData: Uint8Array,
  plaintext: Uint8Array,
  options?: SealOptions,
): Promise<Bytes> {
  const iv = options?.iv ?? randomBytes(IV_BYTES)
  if (iv.length !== IV_BYTES) throw new MultiplayerError("BAD_REQUEST", "an IV is 12 bytes")
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: asBytes(iv), additionalData: asBytes(additionalData), tagLength: 128 },
      key,
      asBytes(plaintext),
    ),
  )
  const out = new Uint8Array(HEADER_BYTES + ciphertext.length)
  out[0] = ENVELOPE_VERSION
  out[1] = kind
  out.set(iv, 2)
  out.set(ciphertext, HEADER_BYTES)
  return out
}

/**
 * Opens an envelope of `kind`. Any version or kind mismatch, short input or tag failure is
 * `DECRYPT_FAILED`.
 */
export async function open(
  kind: EnvelopeKind,
  key: CryptoKey,
  additionalData: Uint8Array,
  envelope: Uint8Array,
): Promise<Bytes> {
  const fail = (cause?: unknown) =>
    new MultiplayerError("DECRYPT_FAILED", "envelope did not open (wrong key or tampered)", {
      cause,
    })
  if (!(envelope instanceof Uint8Array) || envelope.length < ENVELOPE_OVERHEAD) throw fail()
  if (envelope[0] !== ENVELOPE_VERSION || envelope[1] !== kind) throw fail()
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: asBytes(envelope.slice(2, HEADER_BYTES)),
          additionalData: asBytes(additionalData),
          tagLength: 128,
        },
        key,
        asBytes(envelope.subarray(HEADER_BYTES)),
      ),
    )
  } catch (cause) {
    throw fail(cause)
  }
}

export function sealUpdate(
  keys: RoomKeys,
  update: Uint8Array,
  options?: SealOptions,
): Promise<Uint8Array> {
  return seal(EnvelopeKind.update, keys.doc, aad(keys.room.id, "update"), update, options)
}

export function openUpdate(keys: RoomKeys, envelope: Uint8Array): Promise<Uint8Array> {
  return open(EnvelopeKind.update, keys.doc, aad(keys.room.id, "update"), envelope)
}

export async function sealSnapshot(
  keys: RoomKeys,
  upTo: number,
  state: Uint8Array,
  options?: SealOptions,
): Promise<Uint8Array> {
  checkPosition("upTo", upTo)
  return seal(EnvelopeKind.snapshot, keys.doc, aad(keys.room.id, "snapshot", upTo), state, options)
}

export async function openSnapshot(
  keys: RoomKeys,
  upTo: number,
  envelope: Uint8Array,
): Promise<Uint8Array> {
  checkPosition("upTo", upTo)
  return open(EnvelopeKind.snapshot, keys.doc, aad(keys.room.id, "snapshot", upTo), envelope)
}

export async function sealAwareness(
  keys: RoomKeys,
  peer: number,
  json: Uint8Array,
  options?: SealOptions,
): Promise<Uint8Array> {
  checkPosition("peer", peer)
  return seal(
    EnvelopeKind.awareness,
    keys.awareness,
    aad(keys.room.id, "awareness", peer),
    json,
    options,
  )
}

export async function openAwareness(
  keys: RoomKeys,
  peer: number,
  envelope: Uint8Array,
): Promise<Uint8Array> {
  checkPosition("peer", peer)
  return open(
    EnvelopeKind.awareness,
    keys.awareness,
    aad(keys.room.id, "awareness", peer),
    envelope,
  )
}

/** Associated data of a blob envelope. */
export function blobAad(keys: RoomKeys, blobId: string): Bytes {
  return aad(keys.room.id, "blob", blobId)
}

/** The kind of a well-formed version 1 envelope, or null. Does not authenticate anything. */
export function envelopeKind(envelope: Uint8Array): EnvelopeKind | null {
  if (!(envelope instanceof Uint8Array) || envelope.length < ENVELOPE_OVERHEAD) return null
  if (envelope[0] !== ENVELOPE_VERSION) return null
  const kind = envelope[1] as number
  return kind >= EnvelopeKind.update && kind <= EnvelopeKind.blob ? (kind as EnvelopeKind) : null
}
