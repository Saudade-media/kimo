/**
 * Relay ownership (docs/spec/multiplayer.md §6, §6.1, §6.2, ADR 0017): the register owner proof,
 * owner commands signed by a device key, and pairing tokens.
 *
 * A device key is one Ed25519 key pair per Kimo install. The relay keeps a set of device public
 * keys (its owners); only an owner may register rooms or run owner commands. A pairing token is
 * minted locally by an owner device and redeemed by the new device with op `pair`.
 */
import {
  type Bytes,
  concatBytes,
  equalBytes,
  fromBase64Url,
  fromUtf8,
  isUint,
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
  exportPublicKey,
  PUBLIC_KEY_BYTES,
  ROOM_ID_BYTES,
  type RoomId,
  SIGNATURE_BYTES,
  signWithContext,
  verifyWithContext,
} from "./identity"
import { NONCE_BYTES } from "./tokens"

/** Bytes of a relay id (`/version` `relayId`, §14.11). */
export const RELAY_ID_BYTES = 16

const REGISTER_OWNER_CONTEXT = utf8("kimo/v1/register-owner\0")
const OWNER_CONTEXT = utf8("kimo/v1/owner\0")
const PAIRING_CONTEXT = utf8("kimo/v1/pairing\0")

const isB64 = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value)

/** True for a base64url Ed25519 public key (43 characters, 32 bytes). */
export function isDevicePub(value: unknown): value is string {
  if (!isB64(value) || value.length !== 43) return false
  try {
    return fromBase64Url(value).length === PUBLIC_KEY_BYTES
  } catch {
    return false
  }
}

// Register owner proof (§6) --------------------------------------------------------------------

export interface RegisterOwnerInput {
  relayId: Uint8Array
  room: RoomId
  nonce: Uint8Array
  /** The admin command's `iat`, unix ms. */
  iat: number
  rootPub: Uint8Array
}

function registerOwnerBytes(input: RegisterOwnerInput): Bytes {
  const { relayId, room, nonce, iat, rootPub } = input
  const fail = (why: string) => new MultiplayerError("BAD_REQUEST", `owner proof: ${why}`)
  if (!(relayId instanceof Uint8Array) || relayId.length !== RELAY_ID_BYTES)
    throw fail("relayId is 16 bytes")
  if (room.raw.length !== ROOM_ID_BYTES) throw fail("invalid room id")
  if (!(nonce instanceof Uint8Array) || nonce.length !== NONCE_BYTES)
    throw fail("nonce is 16 bytes")
  if (!isUint(iat)) throw fail("iat must be unix milliseconds")
  if (!(rootPub instanceof Uint8Array) || rootPub.length !== PUBLIC_KEY_BYTES)
    throw fail("rootPub is 32 bytes")
  const time = new Uint8Array(8)
  writeU64(viewOf(time), 0, iat)
  return concatBytes(relayId, room.raw, nonce, time, rootPub)
}

/** The register owner proof: signs relayId, room, nonce, iat and rootPub (§6). */
export async function signRegisterOwner(
  device: CryptoKeyPair,
  input: RegisterOwnerInput,
): Promise<{ pub: string; sig: string }> {
  const payload = registerOwnerBytes(input)
  const sig = await signWithContext(device.privateKey, REGISTER_OWNER_CONTEXT, payload)
  return { pub: toBase64Url(await exportPublicKey(device.publicKey)), sig: toBase64Url(sig) }
}

/** Verifies a register owner proof against `owner.pub`. Never throws. */
export async function verifyRegisterOwner(
  owner: { pub: string; sig: string },
  input: RegisterOwnerInput,
): Promise<boolean> {
  try {
    if (!isDevicePub(owner.pub) || !isB64(owner.sig)) return false
    return await verifyWithContext(
      fromBase64Url(owner.pub),
      REGISTER_OWNER_CONTEXT,
      registerOwnerBytes(input),
      fromBase64Url(owner.sig),
    )
  } catch {
    return false
  }
}

// Owner commands (§6.1) ------------------------------------------------------------------------

export type OwnerOp = "claim" | "devices" | "pair" | "remove" | "cancel-pairing" | "rename"

export type OwnerBody =
  | { op: "claim"; name: string }
  | { op: "devices" }
  | { op: "pair"; token: string; name: string }
  | { op: "remove"; pub: string }
  | { op: "cancel-pairing"; jti: string; exp: number }
  | { op: "rename"; pub: string; name: string }

export interface OwnerCommand {
  op: OwnerOp
  /** Unix ms. */
  iat: number
  nonce: Uint8Array
  relayId: Uint8Array
  devicePub: Uint8Array
  /** Parsed JSON body (without `op`). */
  body: Record<string, unknown>
  payload: Uint8Array
  signature: Uint8Array
}

const OWNER_VERSION = 1
const OWNER_TYPE = 4
const OWNER_HEADER_BYTES = 80
/** Largest owner command body, in bytes (16 KiB). */
export const MAX_OWNER_BODY_BYTES = 16 * 1024
/** Largest owner command, header and signature included. */
export const MAX_OWNER_COMMAND_BYTES = OWNER_HEADER_BYTES + MAX_OWNER_BODY_BYTES + SIGNATURE_BYTES
/** Longest device name, in UTF-8 bytes. */
export const MAX_DEVICE_NAME_BYTES = 64
const OWNER_OPS: readonly (OwnerOp | undefined)[] = [
  undefined,
  "claim",
  "devices",
  "pair",
  "remove",
  "cancel-pairing",
  "rename",
]

/**
 * True for a device display name: trimmed, 1 to 64 UTF-8 bytes, no control characters (§6.1).
 */
export function isDeviceName(value: unknown): value is string {
  if (typeof value !== "string" || value === "" || value !== value.trim()) return false
  if (/\p{Cc}/u.test(value)) return false
  return utf8(value).length <= MAX_DEVICE_NAME_BYTES
}

/** Checks an owner body against its op's schema; returns why it is invalid, or null. */
export function ownerBodyError(op: OwnerOp, body: Record<string, unknown>): string | null {
  const name = () => (isDeviceName(body.name) ? null : "name must be 1 to 64 bytes of text")
  switch (op) {
    case "claim":
      return name()
    case "devices":
      return null
    case "pair":
      if (!isB64(body.token)) return "token must be base64url"
      return name()
    case "remove":
      return isDevicePub(body.pub) ? null : "pub must be a base64url public key"
    case "cancel-pairing":
      if (typeof body.jti !== "string" || !/^[0-9a-f]{32}$/.test(body.jti))
        return "jti must be 32 lowercase hex digits"
      if (!isUint(body.exp)) return "exp must be unix seconds"
      return null
    case "rename":
      if (!isDevicePub(body.pub)) return "pub must be a base64url public key"
      return name()
  }
}

/** Signs `body` (serialized with JSON.stringify, `op` removed) as an owner command. */
export async function signOwnerCommand(
  device: CryptoKeyPair,
  relayId: Uint8Array,
  body: OwnerBody,
  options?: { iat?: number; nonce?: Uint8Array },
): Promise<Uint8Array> {
  const fail = (why: string) => new MultiplayerError("BAD_REQUEST", `owner command: ${why}`)
  const opCode = OWNER_OPS.indexOf(body.op)
  if (opCode < 1) throw fail("unknown op")
  const { op: _op, ...rest } = body as OwnerBody & Record<string, unknown>
  const bodyError = ownerBodyError(body.op, rest)
  if (bodyError) throw fail(bodyError)
  if (!(relayId instanceof Uint8Array) || relayId.length !== RELAY_ID_BYTES)
    throw fail("relayId is 16 bytes")
  const iat = options?.iat ?? Date.now()
  if (!isUint(iat)) throw fail("iat must be unix milliseconds")
  const nonce = options?.nonce ?? randomBytes(NONCE_BYTES)
  if (nonce.length !== NONCE_BYTES) throw fail("nonce is 16 bytes")
  const devicePub = await exportPublicKey(device.publicKey)
  const json = utf8(JSON.stringify(rest))
  if (json.length > MAX_OWNER_BODY_BYTES) throw fail("body over 16 KiB")
  const payload = new Uint8Array(OWNER_HEADER_BYTES + json.length)
  const view = viewOf(payload)
  payload[0] = OWNER_VERSION
  payload[1] = OWNER_TYPE
  payload[2] = opCode
  payload[3] = 0
  writeU64(view, 4, iat)
  payload.set(nonce, 12)
  payload.set(relayId, 28)
  payload.set(devicePub, 44)
  writeU32(view, 76, json.length)
  payload.set(json, OWNER_HEADER_BYTES)
  const signature = await signWithContext(device.privateKey, OWNER_CONTEXT, payload)
  return concatBytes(payload, signature)
}

/**
 * Parses owner command bytes (`BAD_REQUEST` on any format error, a body length mismatch or a body
 * that does not match its op's schema; the signature is not checked).
 */
export function parseOwnerCommand(bytes: Uint8Array): OwnerCommand {
  const invalid = (why: string) => new MultiplayerError("BAD_REQUEST", `owner command: ${why}`)
  if (!(bytes instanceof Uint8Array) || bytes.length < OWNER_HEADER_BYTES + SIGNATURE_BYTES)
    throw invalid("too short")
  if (bytes[0] !== OWNER_VERSION) throw invalid("unknown version")
  if (bytes[1] !== OWNER_TYPE) throw invalid("not an owner command")
  const op = OWNER_OPS[bytes[2] as number]
  if (op === undefined) throw invalid("unknown op")
  if (bytes[3] !== 0) throw invalid("reserved byte set")
  const view = viewOf(bytes)
  const iat = readU64(view, 4)
  if (iat < 0) throw invalid("iat out of range")
  const bodyLength = readU32(view, 76)
  if (bodyLength > MAX_OWNER_BODY_BYTES) throw invalid("body over 16 KiB")
  if (bytes.length !== OWNER_HEADER_BYTES + bodyLength + SIGNATURE_BYTES)
    throw invalid("body length mismatch")
  let body: unknown
  try {
    body = JSON.parse(fromUtf8(bytes.subarray(OWNER_HEADER_BYTES, OWNER_HEADER_BYTES + bodyLength)))
  } catch {
    throw invalid("body is not UTF-8 JSON")
  }
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw invalid("body is not a JSON object")
  const record = body as Record<string, unknown>
  const bodyError = ownerBodyError(op, record)
  if (bodyError) throw invalid(bodyError)
  const end = OWNER_HEADER_BYTES + bodyLength
  return {
    op,
    iat,
    nonce: bytes.slice(12, 28),
    relayId: bytes.slice(28, 44),
    devicePub: bytes.slice(44, 76),
    body: record,
    payload: bytes.slice(0, end),
    signature: bytes.slice(end),
  }
}

/** Verifies the device signature of a parsed owner command against `command.devicePub`. Never throws. */
export async function verifyOwnerCommand(command: OwnerCommand): Promise<boolean> {
  // The parsed fields must be the signed ones (the relay acts on op, relayId, devicePub and body).
  let signed: OwnerCommand
  try {
    signed = parseOwnerCommand(concatBytes(command.payload, command.signature))
  } catch {
    return false
  }
  if (
    signed.op !== command.op ||
    signed.iat !== command.iat ||
    !equalBytes(signed.nonce, command.nonce) ||
    !equalBytes(signed.relayId, command.relayId) ||
    !equalBytes(signed.devicePub, command.devicePub) ||
    JSON.stringify(signed.body) !== JSON.stringify(command.body)
  )
    return false
  return verifyWithContext(command.devicePub, OWNER_CONTEXT, command.payload, command.signature)
}

// Pairing tokens (§6.2) ------------------------------------------------------------------------

export interface PairingClaims {
  /** Unix seconds. */
  iat: number
  /** Unix seconds. */
  exp: number
  /** 16 bytes. */
  jti: Uint8Array
  relayId: Uint8Array
  issuerPub: Uint8Array
}

export interface ParsedPairingToken extends PairingClaims {
  payload: Uint8Array
  signature: Uint8Array
}

/** Default pairing link lifetime: 15 minutes. */
export const PAIRING_TTL_SECONDS = 900
/** Longest pairing link lifetime: one hour. */
export const PAIRING_MAX_TTL_SECONDS = 3600
const PAIRING_VERSION = 1
const PAIRING_TYPE = 5
const PAIRING_PAYLOAD_BYTES = 84
/** A pairing token: 84-byte payload and a 64-byte signature (198 base64url characters). */
export const PAIRING_TOKEN_BYTES = PAIRING_PAYLOAD_BYTES + SIGNATURE_BYTES

/** Signs a pairing token with the issuing owner device's key. */
export async function mintPairingToken(
  issuer: CryptoKeyPair,
  claims: Omit<PairingClaims, "issuerPub">,
): Promise<string> {
  const { iat, exp, jti, relayId } = claims
  const fail = (why: string) => new MultiplayerError("BAD_REQUEST", `pairing token: ${why}`)
  if (!isUint(iat)) throw fail("iat must be unix seconds")
  if (!isUint(exp) || exp <= iat || exp - iat > PAIRING_MAX_TTL_SECONDS)
    throw fail("exp must be after iat, at most one hour")
  if (!(jti instanceof Uint8Array) || jti.length !== 16) throw fail("jti is 16 bytes")
  if (!(relayId instanceof Uint8Array) || relayId.length !== RELAY_ID_BYTES)
    throw fail("relayId is 16 bytes")
  const payload = new Uint8Array(PAIRING_PAYLOAD_BYTES)
  const view = viewOf(payload)
  payload[0] = PAIRING_VERSION
  payload[1] = PAIRING_TYPE
  payload[2] = 0
  payload[3] = 0
  writeU64(view, 4, iat)
  writeU64(view, 12, exp)
  payload.set(jti, 20)
  payload.set(relayId, 36)
  payload.set(await exportPublicKey(issuer.publicKey), 52)
  const signature = await signWithContext(issuer.privateKey, PAIRING_CONTEXT, payload)
  return toBase64Url(concatBytes(payload, signature))
}

/** Parses a pairing token (`AUTH_INVALID` on any format error; the signature is not checked). */
export function parsePairingToken(token: string): ParsedPairingToken {
  const invalid = (why: string) => new MultiplayerError("AUTH_INVALID", `pairing token: ${why}`)
  if (typeof token !== "string" || token.length > 1024) throw invalid("not a token")
  let bytes: Bytes
  try {
    bytes = fromBase64Url(token)
  } catch {
    throw invalid("not base64url")
  }
  if (bytes.length !== PAIRING_TOKEN_BYTES) throw invalid("wrong length")
  if (bytes[0] !== PAIRING_VERSION) throw invalid("unknown version")
  if (bytes[1] !== PAIRING_TYPE) throw invalid("not a pairing token")
  if (bytes[2] !== 0) throw invalid("flags set")
  if (bytes[3] !== 0) throw invalid("reserved byte set")
  const view = viewOf(bytes)
  const iat = readU64(view, 4)
  const exp = readU64(view, 12)
  if (iat < 0 || exp < 0) throw invalid("time out of range")
  return {
    iat,
    exp,
    jti: bytes.slice(20, 36),
    relayId: bytes.slice(36, 52),
    issuerPub: bytes.slice(52, 84),
    payload: bytes.slice(0, PAIRING_PAYLOAD_BYTES),
    signature: bytes.slice(PAIRING_PAYLOAD_BYTES),
  }
}

/** Verifies the issuer signature of a parsed pairing token (signature only). Never throws. */
export async function verifyPairingToken(token: ParsedPairingToken): Promise<boolean> {
  let signed: ParsedPairingToken
  try {
    signed = parsePairingToken(toBase64Url(concatBytes(token.payload, token.signature)))
  } catch {
    return false
  }
  if (
    signed.iat !== token.iat ||
    signed.exp !== token.exp ||
    !equalBytes(signed.jti, token.jti) ||
    !equalBytes(signed.relayId, token.relayId) ||
    !equalBytes(signed.issuerPub, token.issuerPub)
  )
    return false
  return verifyWithContext(token.issuerPub, PAIRING_CONTEXT, token.payload, token.signature)
}
