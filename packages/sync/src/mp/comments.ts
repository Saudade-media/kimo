/**
 * Signed comment changes on the wire (docs/spec/comments.md §4.1, §4.2). A change is signed by
 * the writer's device key (or the room root key) over a context that names the room, so it is
 * worthless in any other room. Receivers verify the received bytes before parsing them.
 */
import {
  COMMENT_RECORD_MAX_BYTES,
  type CommentRecord,
  type CommentRecordBody,
  parseCommentRecordBody,
} from "@kimo/editor-state"
import * as decoding from "lib0/decoding"
import * as encoding from "lib0/encoding"
import { fromBase64Url, toBase64Url, utf8 } from "./bytes"
import { MultiplayerError } from "./errors"
import { PUBLIC_KEY_BYTES, SIGNATURE_BYTES, signWithContext, verifyWithContext } from "./identity"

/** Most changes in one comment log entry (positions leave 256 slots per entry). */
export const MAX_COMMENT_BATCH = 256

/** A change as sent: signing key, signature and the exact signed body bytes. */
export interface SignedComment {
  key: Uint8Array
  sig: Uint8Array
  body: Uint8Array
}

function context(roomId: string): Uint8Array {
  return utf8(`kimo/v1/comment|${roomId}\0`)
}

/** Canonical JSON (sorted keys, no whitespace). */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`
  if (v && typeof v === "object")
    return `{${Object.keys(v as object)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(",")}}`
  return JSON.stringify(v)
}

/** Signs a change body with `privateKey`, whose public half is `publicKey`. */
export async function signComment(
  roomId: string,
  body: CommentRecordBody,
  privateKey: CryptoKey,
  publicKey: Uint8Array,
): Promise<SignedComment> {
  const bytes = utf8(canonical(body))
  if (bytes.length > COMMENT_RECORD_MAX_BYTES)
    throw new MultiplayerError("TOO_LARGE", "a comment change is at most 32 KiB")
  const sig = await signWithContext(privateKey, context(roomId), bytes)
  return { key: publicKey.slice(), sig, body: bytes }
}

const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })

/**
 * The change a signed comment carries, or null when its signature, size or shape is wrong. Who
 * may make it is the fold's business (spec §4.3).
 */
export async function verifyComment(
  roomId: string,
  signed: SignedComment,
  pos: number | null,
): Promise<CommentRecord | null> {
  if (signed.key.length !== PUBLIC_KEY_BYTES || signed.sig.length !== SIGNATURE_BYTES) return null
  if (signed.body.length > COMMENT_RECORD_MAX_BYTES) return null
  if (!(await verifyWithContext(signed.key, context(roomId), signed.body, signed.sig))) return null
  let json: unknown
  try {
    json = JSON.parse(strictUtf8.decode(signed.body))
  } catch {
    return null
  }
  const body = parseCommentRecordBody(json)
  return body ? { body, key: toBase64Url(signed.key), pos } : null
}

/** The raw 32-byte key of a base64url key string. */
export function commentKeyBytes(key: string): Uint8Array {
  return fromBase64Url(key)
}

function writeSigned(e: encoding.Encoder, c: SignedComment): void {
  encoding.writeUint8Array(e, c.key)
  encoding.writeUint8Array(e, c.sig)
  encoding.writeVarUint8Array(e, c.body)
}

function readSigned(d: decoding.Decoder): SignedComment {
  const key = decoding.readUint8Array(d, PUBLIC_KEY_BYTES).slice()
  const sig = decoding.readUint8Array(d, SIGNATURE_BYTES).slice()
  const body = decoding.readVarUint8Array(d).slice()
  return { key, sig, body }
}

const bad = (why: string, cause?: unknown) =>
  new MultiplayerError("BAD_MESSAGE", why, cause === undefined ? undefined : { cause })

/** Plaintext of a comments-update envelope (spec §4.2). */
export function encodeCommentBatch(changes: readonly SignedComment[]): Uint8Array {
  if (changes.length === 0 || changes.length > MAX_COMMENT_BATCH)
    throw bad("a comment entry holds 1 to 256 changes")
  const e = encoding.createEncoder()
  encoding.writeVarUint(e, changes.length)
  for (const c of changes) writeSigned(e, c)
  return encoding.toUint8Array(e)
}

export function decodeCommentBatch(bytes: Uint8Array): SignedComment[] {
  try {
    const d = decoding.createDecoder(bytes)
    const n = decoding.readVarUint(d)
    if (n < 1 || n > MAX_COMMENT_BATCH) throw bad("bad comment batch size")
    const out: SignedComment[] = []
    for (let i = 0; i < n; i++) out.push(readSigned(d))
    if (decoding.hasContent(d)) throw bad("trailing bytes")
    return out
  } catch (cause) {
    throw cause instanceof MultiplayerError ? cause : bad("malformed comment batch", cause)
  }
}

/** Plaintext of a comments-snapshot envelope: each change with its position (spec §4.2). */
export function encodeCommentSnapshot(
  changes: readonly { pos: number; signed: SignedComment }[],
): Uint8Array {
  const e = encoding.createEncoder()
  encoding.writeVarUint(e, changes.length)
  for (const c of changes) {
    encoding.writeVarUint(e, c.pos)
    writeSigned(e, c.signed)
  }
  return encoding.toUint8Array(e)
}

export function decodeCommentSnapshot(bytes: Uint8Array): { pos: number; signed: SignedComment }[] {
  try {
    const d = decoding.createDecoder(bytes)
    const n = decoding.readVarUint(d)
    if (n * (PUBLIC_KEY_BYTES + SIGNATURE_BYTES) > bytes.length) throw bad("bad snapshot count")
    const out: { pos: number; signed: SignedComment }[] = []
    for (let i = 0; i < n; i++) {
      const pos = decoding.readVarUint(d)
      if (!Number.isSafeInteger(pos)) throw bad("bad position")
      out.push({ pos, signed: readSigned(d) })
    }
    if (decoding.hasContent(d)) throw bad("trailing bytes")
    return out
  } catch (cause) {
    throw cause instanceof MultiplayerError ? cause : bad("malformed comment snapshot", cause)
  }
}
