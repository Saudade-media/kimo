/**
 * Capability tokens (docs/spec/multiplayer.md §4) and root-signed admin commands (§6). The
 * register owner proof, owner commands and pairing tokens are in `./owner`.
 *
 * A token is `base64url(payload || Ed25519 signature)` signed by the room's link key; it names the
 * room, role, link key id, expiry, a random `jti` and the author origin the relay stamps on every
 * entry. Admin commands are signed by the root key and carry a small JSON body per op.
 */
import { isBlobId } from "./blob-crypto"
import {
  type Bytes,
  concatBytes,
  equalBytes,
  fromBase64Url,
  fromUtf8,
  isUint,
  MAX_U32,
  randomBytes,
  readU32,
  readU64,
  toBase64Url,
  utf8,
  viewOf,
  writeU32,
  writeU64,
} from "./bytes"
import { MultiplayerError } from "./errors"
import {
  ROOM_ID_BYTES,
  type RoomId,
  roomIdFromRaw,
  roomMatchesRootKey,
  SIGNATURE_BYTES,
  signWithContext,
  verifyWithContext,
} from "./identity"

export type Role = "view" | "edit"
export type TokenRole = Role | "comment"
export type MpOrigin = "user" | `agent:${string}` | `mcp:${string}`

export interface TokenClaims {
  room: RoomId
  role: TokenRole
  kid: number
  iat: number
  /** Unix seconds; 0 = never. */
  exp: number
  /** 16 bytes. */
  jti: Uint8Array
  origin: MpOrigin
}

export interface ParsedToken extends TokenClaims {
  payload: Uint8Array
  signature: Uint8Array
}

const TOKEN_VERSION = 1
const TOKEN_TYPE = 1
const FLAG_ORIGIN = 0b1
const TOKEN_FIXED_BYTES = 60
/** Size of a token without origin: 60-byte payload and a 64-byte signature (166 base64url chars). */
export const TOKEN_MIN_BYTES = TOKEN_FIXED_BYTES + SIGNATURE_BYTES
export const JTI_BYTES = 16
/** Longest origin a token carries, in UTF-8 bytes. */
export const MAX_ORIGIN_BYTES = 64
const TOKEN_CONTEXT = utf8("kimo/v1/token\0")

const ROLE_CODES: Record<TokenRole, number> = { view: 1, edit: 2, comment: 3 }
const ROLES_BY_CODE: readonly (TokenRole | undefined)[] = [undefined, "view", "edit", "comment"]
const ORIGIN_PATTERN = /^(?:user|agent:[^\s]+|mcp:[^\s]+)$/

/**
 * True for an origin a token can carry: the `LocalOrigin` grammar of `@kimo/editor-state`
 * (`user`, `agent:<id>`, `mcp:<id>`) in at most 64 UTF-8 bytes.
 */
export function isMpOrigin(value: unknown): value is MpOrigin {
  return (
    typeof value === "string" &&
    ORIGIN_PATTERN.test(value) &&
    utf8(value).length <= MAX_ORIGIN_BYTES
  )
}

/** True for a role a v2.0 connection can hold. */
export function isRole(value: unknown): value is Role {
  return value === "view" || value === "edit"
}

/**
 * Signs `claims` with the link private key. The origin is always written, `user` included (§19
 * vector); a token without the origin field parses as `user`.
 */
export async function mintToken(linkPrivateKey: CryptoKey, claims: TokenClaims): Promise<string> {
  const { room, role, kid, iat, exp, jti, origin } = claims
  const fail = (why: string) => new MultiplayerError("BAD_REQUEST", `token claims: ${why}`)
  const roleCode = Object.hasOwn(ROLE_CODES, role) ? ROLE_CODES[role] : undefined
  if (roleCode === undefined) throw fail("unknown role")
  if (!isUint(kid, MAX_U32) || kid < 1) throw fail("kid must be an integer from 1 to 2^32 - 1")
  if (!isUint(iat)) throw fail("iat must be unix seconds")
  if (!isUint(exp)) throw fail("exp must be unix seconds or 0")
  if (!(jti instanceof Uint8Array) || jti.length !== JTI_BYTES) throw fail("jti is 16 bytes")
  if (room.raw.length !== ROOM_ID_BYTES) throw fail("invalid room id")
  if (!isMpOrigin(origin)) throw fail("invalid origin")
  const originBytes = utf8(origin)
  const payload = new Uint8Array(TOKEN_FIXED_BYTES + 1 + originBytes.length)
  const view = viewOf(payload)
  payload[0] = TOKEN_VERSION
  payload[1] = TOKEN_TYPE
  payload[2] = roleCode
  payload[3] = FLAG_ORIGIN
  writeU32(view, 4, kid)
  writeU64(view, 8, iat)
  writeU64(view, 16, exp)
  payload.set(jti, 24)
  payload.set(room.raw, 40)
  payload[TOKEN_FIXED_BYTES] = originBytes.length
  payload.set(originBytes, TOKEN_FIXED_BYTES + 1)
  const signature = await signWithContext(linkPrivateKey, TOKEN_CONTEXT, payload)
  return toBase64Url(concatBytes(payload, signature))
}

/** Parses a token string (`AUTH_INVALID` on any format error; the signature is not checked). */
export function parseToken(token: string): ParsedToken {
  const invalid = (why: string) => new MultiplayerError("AUTH_INVALID", `token: ${why}`)
  // 4 KiB of text is far beyond any valid token; refuse before decoding.
  if (typeof token !== "string" || token.length > 4096) throw invalid("not a token")
  let bytes: Bytes
  try {
    bytes = fromBase64Url(token)
  } catch {
    throw invalid("not base64url")
  }
  if (bytes.length < TOKEN_MIN_BYTES) throw invalid("too short")
  if (bytes[0] !== TOKEN_VERSION) throw invalid("unknown version")
  if (bytes[1] !== TOKEN_TYPE) throw invalid("not a capability token")
  const role = ROLES_BY_CODE[bytes[2] as number]
  if (role === undefined) throw invalid("unknown role")
  const flags = bytes[3] as number
  if ((flags & ~FLAG_ORIGIN) !== 0) throw invalid("reserved flag bits set")
  const view = viewOf(bytes)
  const kid = readU32(view, 4)
  const iat = readU64(view, 8)
  const exp = readU64(view, 16)
  if (iat < 0 || exp < 0) throw invalid("time out of range")
  let end = TOKEN_FIXED_BYTES
  let origin: MpOrigin = "user"
  if (flags & FLAG_ORIGIN) {
    const length = bytes[end] as number | undefined
    if (length === undefined || length < 1 || length > MAX_ORIGIN_BYTES)
      throw invalid("origin length")
    if (end + 1 + length + SIGNATURE_BYTES > bytes.length) throw invalid("truncated")
    let text: string
    try {
      text = fromUtf8(bytes.subarray(end + 1, end + 1 + length))
    } catch {
      throw invalid("origin is not UTF-8")
    }
    if (!isMpOrigin(text)) throw invalid("invalid origin")
    origin = text
    end += 1 + length
  }
  if (bytes.length !== end + SIGNATURE_BYTES) throw invalid("trailing bytes")
  return {
    room: roomIdFromRaw(bytes.subarray(40, 60)),
    role,
    kid,
    iat,
    exp,
    jti: bytes.slice(24, 40),
    origin,
    payload: bytes.slice(0, end),
    signature: bytes.slice(end),
  }
}

/** Verifies the link-key signature of a parsed token. Never throws. */
export async function verifyTokenSignature(
  token: ParsedToken,
  linkPublicKey: Uint8Array,
): Promise<boolean> {
  // The parsed fields must be the signed ones (a caller could spread or hand-build an object).
  let signed: ParsedToken
  try {
    signed = parseToken(toBase64Url(concatBytes(token.payload, token.signature)))
  } catch {
    return false
  }
  if (
    signed.room.id !== token.room.id ||
    signed.role !== token.role ||
    signed.kid !== token.kid ||
    signed.iat !== token.iat ||
    signed.exp !== token.exp ||
    signed.origin !== token.origin ||
    !equalBytes(signed.jti, token.jti)
  )
    return false
  return verifyWithContext(linkPublicKey, TOKEN_CONTEXT, token.payload, token.signature)
}

// Admin commands (§6) -------------------------------------------------------------------------

export type AdminOp = "register" | "revoke" | "rotate" | "close" | "sweep"

export type AdminBody =
  | { op: "register"; rootPub: string; cert: string; owner: { pub: string; sig: string } }
  | { op: "revoke"; jti: string; exp: number }
  | { op: "rotate"; cert: string }
  | { op: "close" }
  | { op: "sweep"; keep: string[]; graceDays?: number }

export interface AdminCommand {
  op: AdminOp
  /** Unix ms. */
  iat: number
  nonce: Uint8Array
  room: RoomId
  /** Parsed JSON body (without `op`). */
  body: Record<string, unknown>
  payload: Uint8Array
  signature: Uint8Array
}

const ADMIN_VERSION = 1
const ADMIN_TYPE = 3
const ADMIN_HEADER_BYTES = 52
/** Largest admin body, in bytes (1 MiB). */
export const MAX_ADMIN_BODY_BYTES = 1 << 20
export const NONCE_BYTES = 16
const ADMIN_CONTEXT = utf8("kimo/v1/admin\0")
const ADMIN_OPS: readonly (AdminOp | undefined)[] = [
  undefined,
  "register",
  "revoke",
  "rotate",
  "close",
  "sweep",
]

/**
 * Checks an admin body against its op's schema; returns why it is invalid, or null. Unknown extra
 * keys are allowed (ignored by relays that do not know them).
 */
export function adminBodyError(op: AdminOp, body: Record<string, unknown>): string | null {
  const isB64 = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value)
  switch (op) {
    case "register":
      if (!isB64(body.rootPub)) return "rootPub must be base64url"
      if (!isB64(body.cert)) return "cert must be base64url"
      // A missing owner proof parses: the relay answers NOT_OWNER (§6).
      if (body.owner !== undefined) {
        const owner = body.owner as Record<string, unknown> | null
        if (typeof owner !== "object" || owner === null || Array.isArray(owner))
          return "owner must be an object"
        if (!isB64(owner.pub) || !isB64(owner.sig))
          return "owner.pub and owner.sig must be base64url"
      }
      return null
    case "revoke":
      if (typeof body.jti !== "string" || !/^[0-9a-f]{32}$/.test(body.jti))
        return "jti must be 32 lowercase hex digits"
      if (!isUint(body.exp)) return "exp must be unix seconds or 0"
      return null
    case "rotate":
      return isB64(body.cert) ? null : "cert must be base64url"
    case "close":
      return null
    case "sweep":
      if (!Array.isArray(body.keep) || !body.keep.every((id) => isBlobId(id)))
        return "keep must be an array of blob ids"
      if (body.graceDays !== undefined && (!isUint(body.graceDays) || body.graceDays < 1))
        return "graceDays must be an integer of at least 1"
      return null
  }
}

/** Signs `body` (serialized with JSON.stringify, `op` removed) as an admin command. */
export async function signAdminCommand(
  rootPrivateKey: CryptoKey,
  room: RoomId,
  body: AdminBody,
  options?: { iat?: number; nonce?: Uint8Array },
): Promise<Uint8Array> {
  const fail = (why: string) => new MultiplayerError("BAD_REQUEST", `admin command: ${why}`)
  const opCode = ADMIN_OPS.indexOf(body.op)
  if (opCode < 1) throw fail("unknown op")
  const { op: _op, ...rest } = body as AdminBody & Record<string, unknown>
  const bodyError = adminBodyError(body.op, rest)
  if (bodyError) throw fail(bodyError)
  const iat = options?.iat ?? Date.now()
  if (!isUint(iat)) throw fail("iat must be unix milliseconds")
  const nonce = options?.nonce ?? randomBytes(NONCE_BYTES)
  if (nonce.length !== NONCE_BYTES) throw fail("nonce is 16 bytes")
  if (room.raw.length !== ROOM_ID_BYTES) throw fail("invalid room id")
  const json = utf8(JSON.stringify(rest))
  if (json.length > MAX_ADMIN_BODY_BYTES) throw fail("body over 1 MiB")
  const payload = new Uint8Array(ADMIN_HEADER_BYTES + json.length)
  const view = viewOf(payload)
  payload[0] = ADMIN_VERSION
  payload[1] = ADMIN_TYPE
  payload[2] = opCode
  payload[3] = 0
  writeU64(view, 4, iat)
  payload.set(nonce, 12)
  payload.set(room.raw, 28)
  writeU32(view, 48, json.length)
  payload.set(json, ADMIN_HEADER_BYTES)
  const signature = await signWithContext(rootPrivateKey, ADMIN_CONTEXT, payload)
  return concatBytes(payload, signature)
}

/**
 * Parses admin command bytes (`BAD_REQUEST` on any format error, a body length mismatch or a body
 * that does not match its op's schema; the signature is not checked).
 */
export function parseAdminCommand(bytes: Uint8Array): AdminCommand {
  const invalid = (why: string) => new MultiplayerError("BAD_REQUEST", `admin command: ${why}`)
  if (!(bytes instanceof Uint8Array) || bytes.length < ADMIN_HEADER_BYTES + SIGNATURE_BYTES)
    throw invalid("too short")
  if (bytes[0] !== ADMIN_VERSION) throw invalid("unknown version")
  if (bytes[1] !== ADMIN_TYPE) throw invalid("not an admin command")
  const op = ADMIN_OPS[bytes[2] as number]
  if (op === undefined) throw invalid("unknown op")
  if (bytes[3] !== 0) throw invalid("reserved byte set")
  const view = viewOf(bytes)
  const iat = readU64(view, 4)
  if (iat < 0) throw invalid("iat out of range")
  const bodyLength = readU32(view, 48)
  if (bodyLength > MAX_ADMIN_BODY_BYTES) throw invalid("body over 1 MiB")
  if (bytes.length !== ADMIN_HEADER_BYTES + bodyLength + SIGNATURE_BYTES)
    throw invalid("body length mismatch")
  let body: unknown
  try {
    body = JSON.parse(fromUtf8(bytes.subarray(ADMIN_HEADER_BYTES, ADMIN_HEADER_BYTES + bodyLength)))
  } catch {
    throw invalid("body is not UTF-8 JSON")
  }
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw invalid("body is not a JSON object")
  const record = body as Record<string, unknown>
  const bodyError = adminBodyError(op, record)
  if (bodyError) throw invalid(bodyError)
  const end = ADMIN_HEADER_BYTES + bodyLength
  return {
    op,
    iat,
    nonce: bytes.slice(12, 28),
    room: roomIdFromRaw(bytes.subarray(28, 48)),
    body: record,
    payload: bytes.slice(0, end),
    signature: bytes.slice(end),
  }
}

/**
 * Verifies the root signature of a parsed command and that its room is the room of
 * `rootPublicKey`. Never throws. Freshness (`iat`) and nonce replay are the relay's checks.
 */
export async function verifyAdminCommand(
  command: AdminCommand,
  rootPublicKey: Uint8Array,
): Promise<boolean> {
  // The parsed fields must be the signed ones (the relay acts on op, iat, nonce and body).
  let signed: AdminCommand
  try {
    signed = parseAdminCommand(concatBytes(command.payload, command.signature))
  } catch {
    return false
  }
  if (
    signed.op !== command.op ||
    signed.iat !== command.iat ||
    !equalBytes(signed.nonce, command.nonce) ||
    !equalBytes(signed.room.raw, command.room.raw) ||
    canonicalJson(signed.body) !== canonicalJson(command.body)
  )
    return false
  if (!(await roomMatchesRootKey(command.room, rootPublicKey))) return false
  return verifyWithContext(rootPublicKey, ADMIN_CONTEXT, command.payload, command.signature)
}

/** JSON with sorted object keys, so equal bodies compare equal whatever their key order. */
function canonicalJson(value: unknown): string {
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
