/**
 * `kimo-mp/1` WebSocket messages and their binary codec (docs/spec/multiplayer.md §11). Every
 * frame is `varUint type` then the fields of that type, in lib0 encoding (as y-protocols uses).
 *
 * Decoding is strict where the relay reads (client messages: trailing bytes, bad UTF-8 and
 * out-of-range values are `BAD_MESSAGE`) and forward compatible where clients read (relay
 * messages: an unknown type decodes to null and trailing bytes after the known fields are
 * ignored, so a newer relay may append fields). Byte fields are copied out of the frame.
 */
import * as decoding from "lib0/decoding"
import * as encoding from "lib0/encoding"
import { isUint, utf8 } from "./bytes"
import { isMpErrorCode, type MpErrorCode, MultiplayerError } from "./errors"
import { isMpOrigin, isRole, type MpOrigin, type Role } from "./tokens"

export const PROTOCOL = "kimo-mp/1"
export const SUBPROTOCOL = "kimo-mp.1"
export const PROTOCOL_VERSION = 1

export const ClientType = {
  hello: 1,
  append: 2,
  awareness: 3,
  caughtUp: 4,
  refresh: 5,
  ping: 6,
} as const

export const RelayType = {
  welcome: 16,
  entries: 17,
  ack: 18,
  awareness: 19,
  peerJoined: 20,
  peerLeft: 21,
  snapshot: 22,
  compact: 23,
  denied: 24,
  token: 25,
  pong: 26,
} as const

export interface RelayLimits {
  maxEntryBytes: number
  maxSnapshotBytes: number
  maxBlobBytes: number
  roomQuotaBytes: number
  awarenessHz: number
}

const MiB = 1 << 20

export const DEFAULT_LIMITS: RelayLimits = Object.freeze({
  maxEntryBytes: 4 * MiB,
  maxSnapshotBytes: 64 * MiB,
  maxBlobBytes: 20 * MiB,
  roomQuotaBytes: 500 * MiB,
  awarenessHz: 20,
})

/** Longest `client` string in `hello`, in UTF-8 bytes. */
export const MAX_CLIENT_INFO_BYTES = 64
/** Longest awareness envelope (§14.8). */
export const MAX_AWARENESS_BYTES = 16 * 1024
/** Most entries, and most envelope bytes, the relay packs into one `entries` frame (§11.4). */
export const MAX_ENTRIES_PER_FRAME = 512
export const MAX_ENTRIES_FRAME_BYTES = MiB
/** Longest token string accepted in `hello` and `refresh` (valid tokens are far shorter). */
export const MAX_TOKEN_CHARS = 4096

export interface PeerInfo {
  peer: number
  role: Role
  origin: MpOrigin
}

export interface SnapshotInfo {
  upTo: number
  gen: number
  bytes: number
}

export interface LogEntry {
  seq: number
  origin: MpOrigin
  env: Uint8Array
}

export type ClientMessage =
  | { type: "hello"; proto: number; token: string; since: number; client: string }
  | { type: "append"; cid: number; env: Uint8Array }
  | { type: "awareness"; clock: number; env: Uint8Array }
  | { type: "caught-up"; seq: number }
  | { type: "refresh"; token: string }
  | { type: "ping"; n: number }

export type RelayMessage =
  | {
      type: "welcome"
      peer: number
      role: Role
      origin: MpOrigin
      exp: number
      kid: number
      head: number
      base: number
      from: number
      needSnapshot: boolean
      snapshot: SnapshotInfo | null
      limits: RelayLimits
      peers: PeerInfo[]
    }
  | { type: "entries"; entries: LogEntry[] }
  | { type: "ack"; cid: number; seq: number }
  | { type: "awareness"; peer: number; clock: number; env: Uint8Array }
  | { type: "peer-joined"; peer: PeerInfo }
  | { type: "peer-left"; peer: number }
  | { type: "snapshot"; info: SnapshotInfo; carriesNew: boolean }
  | { type: "compact"; upTo: number }
  | { type: "denied"; code: MpErrorCode; cid: number; message: string }
  | { type: "token"; exp: number }
  | { type: "pong"; n: number }

// Encoding ------------------------------------------------------------------------------------

function badMessage(why: string, cause?: unknown): MultiplayerError {
  return new MultiplayerError("BAD_MESSAGE", why, cause === undefined ? undefined : { cause })
}

class Writer {
  readonly encoder = encoding.createEncoder()

  uint(name: string, value: number): this {
    if (!isUint(value)) throw badMessage(`${name} must be an integer from 0 to 2^53 - 1`)
    encoding.writeVarUint(this.encoder, value)
    return this
  }

  flag(value: boolean): this {
    encoding.writeVarUint(this.encoder, value ? 1 : 0)
    return this
  }

  /** `maxBytes` mirrors the Reader's limit, so the codec never encodes what the relay rejects. */
  string(name: string, value: string, maxBytes?: number): this {
    if (typeof value !== "string") throw badMessage(`${name} must be a string`)
    const raw = utf8(value)
    if (maxBytes !== undefined && raw.length > maxBytes) throw badMessage(`${name} too long`)
    encoding.writeVarUint8Array(this.encoder, raw)
    return this
  }

  bytes(name: string, value: Uint8Array): this {
    if (!(value instanceof Uint8Array)) throw badMessage(`${name} must be bytes`)
    encoding.writeVarUint8Array(this.encoder, value)
    return this
  }

  peer(info: PeerInfo): this {
    if (!isRole(info.role)) throw badMessage("peer role must be view or edit")
    if (!isMpOrigin(info.origin)) throw badMessage("invalid peer origin")
    return this.uint("peer", info.peer).string("role", info.role).string("origin", info.origin)
  }

  done(): Uint8Array {
    return encoding.toUint8Array(this.encoder)
  }
}

export function encodeClientMessage(message: ClientMessage): Uint8Array {
  const w = new Writer()
  switch (message.type) {
    case "hello":
      return w
        .uint("type", ClientType.hello)
        .uint("proto", message.proto)
        .string("token", message.token, MAX_TOKEN_CHARS)
        .uint("since", message.since)
        .string("client", message.client, MAX_CLIENT_INFO_BYTES)
        .done()
    case "append":
      return w
        .uint("type", ClientType.append)
        .uint("cid", message.cid)
        .bytes("env", message.env)
        .done()
    case "awareness":
      return w
        .uint("type", ClientType.awareness)
        .uint("clock", message.clock)
        .bytes("env", message.env)
        .done()
    case "caught-up":
      return w.uint("type", ClientType.caughtUp).uint("seq", message.seq).done()
    case "refresh":
      return w
        .uint("type", ClientType.refresh)
        .string("token", message.token, MAX_TOKEN_CHARS)
        .done()
    case "ping":
      return w.uint("type", ClientType.ping).uint("n", message.n).done()
    default:
      throw badMessage("unknown client message type")
  }
}

export function encodeRelayMessage(message: RelayMessage): Uint8Array {
  const w = new Writer()
  switch (message.type) {
    case "welcome": {
      if (!isRole(message.role)) throw badMessage("role must be view or edit")
      if (!isMpOrigin(message.origin)) throw badMessage("invalid origin")
      w.uint("type", RelayType.welcome)
        .uint("peer", message.peer)
        .string("role", message.role)
        .string("origin", message.origin)
        .uint("exp", message.exp)
        .uint("kid", message.kid)
        .uint("head", message.head)
        .uint("base", message.base)
        .uint("from", message.from)
        .flag(message.needSnapshot)
        .flag(message.snapshot !== null)
      if (message.snapshot)
        w.uint("upTo", message.snapshot.upTo)
          .uint("gen", message.snapshot.gen)
          .uint("bytes", message.snapshot.bytes)
      const limits = message.limits
      w.uint("maxEntryBytes", limits.maxEntryBytes)
        .uint("maxSnapshotBytes", limits.maxSnapshotBytes)
        .uint("maxBlobBytes", limits.maxBlobBytes)
        .uint("roomQuotaBytes", limits.roomQuotaBytes)
        .uint("awarenessHz", limits.awarenessHz)
        .uint("peers", message.peers.length)
      for (const peer of message.peers) w.peer(peer)
      return w.done()
    }
    case "entries":
      w.uint("type", RelayType.entries).uint("n", message.entries.length)
      for (const entry of message.entries) {
        if (!isMpOrigin(entry.origin)) throw badMessage("invalid entry origin")
        w.uint("seq", entry.seq).string("origin", entry.origin).bytes("env", entry.env)
      }
      return w.done()
    case "ack":
      return w.uint("type", RelayType.ack).uint("cid", message.cid).uint("seq", message.seq).done()
    case "awareness":
      return w
        .uint("type", RelayType.awareness)
        .uint("peer", message.peer)
        .uint("clock", message.clock)
        .bytes("env", message.env)
        .done()
    case "peer-joined":
      return w.uint("type", RelayType.peerJoined).peer(message.peer).done()
    case "peer-left":
      return w.uint("type", RelayType.peerLeft).uint("peer", message.peer).done()
    case "snapshot":
      return w
        .uint("type", RelayType.snapshot)
        .uint("upTo", message.info.upTo)
        .uint("gen", message.info.gen)
        .uint("bytes", message.info.bytes)
        .flag(message.carriesNew)
        .done()
    case "compact":
      return w.uint("type", RelayType.compact).uint("upTo", message.upTo).done()
    case "denied":
      if (!isMpErrorCode(message.code)) throw badMessage("unknown error code")
      return w
        .uint("type", RelayType.denied)
        .string("code", message.code)
        .uint("cid", message.cid)
        .string("message", message.message)
        .done()
    case "token":
      return w.uint("type", RelayType.token).uint("exp", message.exp).done()
    case "pong":
      return w.uint("type", RelayType.pong).uint("n", message.n).done()
    default:
      throw badMessage("unknown relay message type")
  }
}

// Decoding ------------------------------------------------------------------------------------

const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })

class Reader {
  private readonly decoder: decoding.Decoder

  constructor(bytes: Uint8Array) {
    if (!(bytes instanceof Uint8Array)) throw badMessage("a frame is binary")
    this.decoder = decoding.createDecoder(bytes)
  }

  uint(name: string): number {
    let value: number
    try {
      value = decoding.readVarUint(this.decoder)
    } catch (cause) {
      throw badMessage(`truncated or oversized ${name}`, cause)
    }
    // lib0 only range-checks continuation bytes; a large final byte can still overflow.
    if (!Number.isSafeInteger(value)) throw badMessage(`${name} exceeds 2^53 - 1`)
    return value
  }

  flag(name: string): boolean {
    const value = this.uint(name)
    if (value > 1) throw badMessage(`${name} must be 0 or 1`)
    return value === 1
  }

  /** A length-prefixed byte field, copied out of the frame. */
  bytes(name: string): Uint8Array {
    try {
      return decoding.readVarUint8Array(this.decoder).slice()
    } catch (cause) {
      throw badMessage(`truncated ${name}`, cause)
    }
  }

  string(name: string, maxBytes?: number): string {
    let raw: Uint8Array
    try {
      raw = decoding.readVarUint8Array(this.decoder)
    } catch (cause) {
      throw badMessage(`truncated ${name}`, cause)
    }
    if (maxBytes !== undefined && raw.length > maxBytes) throw badMessage(`${name} too long`)
    try {
      return strictUtf8.decode(raw)
    } catch (cause) {
      throw badMessage(`${name} is not UTF-8`, cause)
    }
  }

  role(): Role {
    const role = this.string("role")
    if (!isRole(role)) throw badMessage("role must be view or edit")
    return role
  }

  origin(): MpOrigin {
    const origin = this.string("origin")
    if (!isMpOrigin(origin)) throw badMessage("invalid origin")
    return origin
  }

  /** A count of items that each take at least `minItemBytes`; bounded by the bytes left. */
  count(name: string, minItemBytes: number): number {
    const n = this.uint(name)
    if (n * minItemBytes > this.remaining) throw badMessage(`${name} exceeds the frame`)
    return n
  }

  get remaining(): number {
    return this.decoder.arr.length - this.decoder.pos
  }

  end(): void {
    if (decoding.hasContent(this.decoder)) throw badMessage("trailing bytes")
  }
}

/** Throws MultiplayerError("BAD_MESSAGE") on malformed input or an unknown type. */
export function decodeClientMessage(bytes: Uint8Array): ClientMessage {
  const r = new Reader(bytes)
  const type = r.uint("type")
  let message: ClientMessage
  switch (type) {
    case ClientType.hello: {
      const proto = r.uint("proto")
      const token = r.string("token", MAX_TOKEN_CHARS)
      const since = r.uint("since")
      const client = r.string("client", MAX_CLIENT_INFO_BYTES)
      message = { type: "hello", proto, token, since, client }
      break
    }
    case ClientType.append:
      message = { type: "append", cid: r.uint("cid"), env: r.bytes("env") }
      break
    case ClientType.awareness:
      message = { type: "awareness", clock: r.uint("clock"), env: r.bytes("env") }
      break
    case ClientType.caughtUp:
      message = { type: "caught-up", seq: r.uint("seq") }
      break
    case ClientType.refresh:
      message = { type: "refresh", token: r.string("token", MAX_TOKEN_CHARS) }
      break
    case ClientType.ping:
      message = { type: "ping", n: r.uint("n") }
      break
    default:
      throw badMessage(`unknown client message type ${type}`)
  }
  r.end()
  return message
}

/**
 * Returns null for an unknown type (clients ignore it); throws BAD_MESSAGE when malformed. A
 * `denied` code this version does not know decodes as `INTERNAL` with the code in the message.
 */
export function decodeRelayMessage(bytes: Uint8Array): RelayMessage | null {
  const r = new Reader(bytes)
  const type = r.uint("type")
  switch (type) {
    case RelayType.welcome: {
      const peer = r.uint("peer")
      const role = r.role()
      const origin = r.origin()
      const exp = r.uint("exp")
      const kid = r.uint("kid")
      const head = r.uint("head")
      const base = r.uint("base")
      const from = r.uint("from")
      const needSnapshot = r.flag("needSnapshot")
      const snapshot = r.flag("hasSnapshot")
        ? { upTo: r.uint("upTo"), gen: r.uint("gen"), bytes: r.uint("bytes") }
        : null
      const limits: RelayLimits = {
        maxEntryBytes: r.uint("maxEntryBytes"),
        maxSnapshotBytes: r.uint("maxSnapshotBytes"),
        maxBlobBytes: r.uint("maxBlobBytes"),
        roomQuotaBytes: r.uint("roomQuotaBytes"),
        awarenessHz: r.uint("awarenessHz"),
      }
      const n = r.count("peers", 3)
      const peers: PeerInfo[] = []
      for (let i = 0; i < n; i++)
        peers.push({ peer: r.uint("peer"), role: r.role(), origin: r.origin() })
      return {
        type: "welcome",
        peer,
        role,
        origin,
        exp,
        kid,
        head,
        base,
        from,
        needSnapshot,
        snapshot,
        limits,
        peers,
      }
    }
    case RelayType.entries: {
      const n = r.count("entries", 3)
      const entries: LogEntry[] = []
      for (let i = 0; i < n; i++)
        entries.push({ seq: r.uint("seq"), origin: r.origin(), env: r.bytes("env") })
      return { type: "entries", entries }
    }
    case RelayType.ack:
      return { type: "ack", cid: r.uint("cid"), seq: r.uint("seq") }
    case RelayType.awareness:
      return {
        type: "awareness",
        peer: r.uint("peer"),
        clock: r.uint("clock"),
        env: r.bytes("env"),
      }
    case RelayType.peerJoined:
      return {
        type: "peer-joined",
        peer: { peer: r.uint("peer"), role: r.role(), origin: r.origin() },
      }
    case RelayType.peerLeft:
      return { type: "peer-left", peer: r.uint("peer") }
    case RelayType.snapshot: {
      const info = { upTo: r.uint("upTo"), gen: r.uint("gen"), bytes: r.uint("bytes") }
      return { type: "snapshot", info, carriesNew: r.flag("carriesNew") }
    }
    case RelayType.compact:
      return { type: "compact", upTo: r.uint("upTo") }
    case RelayType.denied: {
      const raw = r.string("code")
      const cid = r.uint("cid")
      const text = r.string("message")
      if (isMpErrorCode(raw)) return { type: "denied", code: raw, cid, message: text }
      return { type: "denied", code: "INTERNAL", cid, message: `${raw}: ${text}` }
    }
    case RelayType.token:
      return { type: "token", exp: r.uint("exp") }
    case RelayType.pong:
      return { type: "pong", n: r.uint("n") }
    default:
      return null
  }
}
