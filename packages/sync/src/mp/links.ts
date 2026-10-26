/**
 * Join links, pairing links and relay URLs (docs/spec/multiplayer.md §7, §7.1).
 *
 * `<web-origin>/join#<relay-url>/<room>/<token>/<room-key>`: everything a guest needs is in the
 * fragment, which browsers never send to a server, so neither the web host nor the relay sees the
 * token or the room key in a request line or a log.
 */
import { fromBase64Url, toBase64Url } from "./bytes"
import { MultiplayerError } from "./errors"
import { isRoomId } from "./identity"
import { ROOM_KEY_BYTES } from "./keys"
import { parsePairingToken } from "./owner"
import { parseToken } from "./tokens"

export interface JoinLink {
  /** e.g. `https://app.kimo.design` or `kimo:`; empty when parsed from a bare fragment. */
  webOrigin: string
  /** Normalized relay base URL. */
  relayUrl: string
  room: string
  token: string
  roomKey: Uint8Array
}

const DEFAULT_PORTS: Record<string, string> = { "http:": "80", "https:": "443" }
const SCHEMES: Record<string, string> = {
  "https:": "https:",
  "http:": "http:",
  "wss:": "https:",
  "ws:": "http:",
}

/** Whether plain `http` is acceptable for `hostname` (loopback, `.local` and private IPv4). */
function isLocalHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") return true
  if (hostname.endsWith(".local") && hostname.length > ".local".length) return true
  // The URL parser has already canonicalized IPv4 hosts to dotted decimal.
  const match = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(hostname)
  if (!match) return false
  const a = Number(match[1])
  const b = Number(match[2])
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

/**
 * Normalizes a relay base URL: `wss` to `https`, `ws` to `http`; lowercase scheme and host; no
 * default port, query, fragment, credentials or trailing slash; the path prefix is kept. `http`
 * only for local hosts. Throws `BAD_RELAY_URL`.
 */
export function normalizeRelayUrl(url: string): string {
  const fail = (why: string) => new MultiplayerError("BAD_RELAY_URL", `relay URL: ${why}`)
  if (typeof url !== "string") throw fail("not a string")
  const text = url.trim()
  if (!/^(?:https?|wss?):\/\//i.test(text)) throw fail("use https://, http://, wss:// or ws://")
  let parsed: URL
  try {
    parsed = new URL(text)
  } catch {
    throw fail("does not parse")
  }
  const scheme = SCHEMES[parsed.protocol]
  if (!scheme) throw fail("unsupported scheme")
  const hostname = parsed.hostname
  if (!hostname) throw fail("missing host")
  if (scheme === "http:" && !isLocalHost(hostname))
    throw fail("http is only allowed for localhost, .local and private network addresses")
  const port = parsed.port && parsed.port !== DEFAULT_PORTS[scheme] ? `:${parsed.port}` : ""
  const path = parsed.pathname.replace(/\/+$/, "")
  return `${scheme}//${hostname}${port}${path}`
}

/** `wss://<host>[/prefix]/sync/<room>` (or `ws://` for an `http` relay). */
export function syncUrlFor(relayUrl: string, room: string): string {
  if (!isRoomId(room)) throw new MultiplayerError("BAD_REQUEST", "invalid room id")
  const base = normalizeRelayUrl(relayUrl)
  return `${base.replace(/^http/, "ws")}/sync/${room}`
}

/** `<relay base><path>` (a missing leading `/` is added). */
export function httpUrlFor(relayUrl: string, path: string): string {
  const base = normalizeRelayUrl(relayUrl)
  return `${base}${path.startsWith("/") ? path : `/${path}`}`
}

/** Builds a join link (§7). Throws `BAD_LINK` when a part is invalid. */
export function formatJoinLink(link: JoinLink): string {
  return withOrigin(link.webOrigin, "join", joinFragment(link))
}

/** `<origin>/<route>#<fragment>`; a bare scheme (`kimo:`) becomes `kimo://<route>#...`. */
function withOrigin(webOrigin: string, route: string, fragment: string): string {
  const origin = webOrigin.trim()
  if (origin === "") return `#${fragment}`
  const prefix = /^[a-z][a-z0-9+.-]*:$/i.test(origin)
    ? `${origin}//${route}`
    : `${origin.replace(/\/+$/, "")}/${route}`
  return `${prefix}#${fragment}`
}

function joinFragment(link: JoinLink): string {
  let relayUrl: string
  try {
    relayUrl = normalizeRelayUrl(link.relayUrl)
  } catch (cause) {
    throw new MultiplayerError("BAD_LINK", "invalid relay URL", { cause })
  }
  checkParts(link.room, link.token, link.roomKey)
  return `${relayUrl}/${link.room}/${link.token}/${toBase64Url(link.roomKey)}`
}

function checkParts(room: string, token: string, roomKey: Uint8Array): void {
  if (!isRoomId(room)) throw new MultiplayerError("BAD_LINK", "invalid room id")
  let claims: ReturnType<typeof parseToken>
  try {
    claims = parseToken(token)
  } catch (cause) {
    throw new MultiplayerError("BAD_LINK", "invalid token", { cause })
  }
  if (claims.room.id !== room)
    throw new MultiplayerError("BAD_LINK", "the token belongs to another room")
  if (!(roomKey instanceof Uint8Array) || roomKey.length !== ROOM_KEY_BYTES)
    throw new MultiplayerError("BAD_LINK", "a room key is 32 bytes")
}

/**
 * Parses a join link: a full URL (`https://app/join#...`, `kimo://join#...`) or a bare fragment
 * with or without `#`. Whitespace anywhere is ignored (links wrapped by mail clients), as are
 * trailing slashes; a fragment percent-encoded by a messenger is decoded once. Throws `BAD_LINK`.
 */
export function parseJoinLink(text: string): JoinLink {
  if (typeof text !== "string") throw new MultiplayerError("BAD_LINK", "not a link")
  return parseCompact(text.replace(/\s+/g, ""), true, parseFragment)
}

function parseCompact<T>(
  compact: string,
  mayDecode: boolean,
  parse: (fragment: string) => T,
): T & { webOrigin: string } {
  const hash = compact.indexOf("#")
  const before = hash >= 0 ? compact.slice(0, hash) : ""
  const fragment = hash >= 0 ? compact.slice(hash + 1) : compact
  try {
    return { webOrigin: webOriginOf(before), ...parse(fragment) }
  } catch (error) {
    if (!mayDecode || !/%[0-9a-f]{2}/i.test(compact)) throw error
    let decoded: string
    try {
      decoded = decodeURIComponent(compact)
    } catch {
      throw error
    }
    // The whole link may have been encoded (a redirector or a URL parameter): parse it again
    // from the top, '#' split included, but decode only once.
    return parseCompact(decoded, false, parse)
  }
}

function webOriginOf(prefix: string): string {
  if (prefix === "") return ""
  try {
    const url = new URL(prefix)
    if (url.protocol === "http:" || url.protocol === "https:") return url.origin
    return url.protocol
  } catch {
    return ""
  }
}

/** The relay URL of a link fragment's leading segments (`BAD_LINK` when it does not normalize). */
function relayOfSegments(segments: readonly string[]): string {
  const relaySegment = segments.join("/")
  // normalizeRelayUrl drops a query, fragment and credentials; here they mean a malformed or
  // wrapped link that would resolve to another host, so they are refused instead.
  if (/[?#@]/.test(relaySegment))
    throw new MultiplayerError("BAD_LINK", "the relay URL has a query, fragment or credentials")
  try {
    return normalizeRelayUrl(relaySegment)
  } catch (cause) {
    throw new MultiplayerError("BAD_LINK", "invalid relay URL", { cause })
  }
}

function parseFragment(fragment: string): Omit<JoinLink, "webOrigin"> {
  const segments = fragment.replace(/\/+$/, "").split("/")
  if (segments.length < 4) throw new MultiplayerError("BAD_LINK", "missing link segments")
  const key = segments.pop() as string
  const token = segments.pop() as string
  const room = segments.pop() as string
  const relayUrl = relayOfSegments(segments)
  let roomKey: Uint8Array
  try {
    roomKey = fromBase64Url(key)
  } catch (cause) {
    throw new MultiplayerError("BAD_LINK", "invalid room key", { cause })
  }
  checkParts(room, token, roomKey)
  return { relayUrl, room, token, roomKey }
}

/**
 * The browser form of a join or pairing link: the same fragment under the link's own relay, which
 * serves `/join` and `/pair` (`https://<relay>/join#<relay>/...`). Links of older versions
 * (`kimo://join#...`, another web origin) are rewritten; anything else is returned unchanged.
 */
export function relayLink(text: string): string {
  try {
    const link = parseJoinLink(text)
    return formatJoinLink({ ...link, webOrigin: link.relayUrl })
  } catch {
    try {
      const link = parsePairingLink(text)
      return formatPairingLink({ ...link, webOrigin: link.relayUrl })
    } catch {
      return text
    }
  }
}

// Pairing links (§7.1) -------------------------------------------------------------------------

export interface PairingLink {
  /** e.g. `https://app.kimo.design` or `kimo:`; empty when parsed from a bare fragment. */
  webOrigin: string
  /** Normalized relay base URL. */
  relayUrl: string
  /** Base64url pairing token (§6.2). */
  token: string
}

/** Builds a pairing link, `<webOrigin>/pair#<relay>/<token>`. Throws `BAD_LINK`. */
export function formatPairingLink(link: PairingLink): string {
  let relayUrl: string
  try {
    relayUrl = normalizeRelayUrl(link.relayUrl)
  } catch (cause) {
    throw new MultiplayerError("BAD_LINK", "invalid relay URL", { cause })
  }
  checkPairingToken(link.token)
  return withOrigin(link.webOrigin, "pair", `${relayUrl}/${link.token}`)
}

/**
 * Parses a pairing link: a full URL (`https://app/pair#...`, `kimo://pair#...`) or a bare
 * fragment, with the same tolerance as {@link parseJoinLink}. A join link is not a pairing link.
 * Throws `BAD_LINK`.
 */
export function parsePairingLink(text: string): PairingLink {
  if (typeof text !== "string") throw new MultiplayerError("BAD_LINK", "not a link")
  return parseCompact(text.replace(/\s+/g, ""), true, (fragment) => {
    const segments = fragment.replace(/\/+$/, "").split("/")
    if (segments.length < 4) throw new MultiplayerError("BAD_LINK", "missing link segments")
    const token = segments.pop() as string
    checkPairingToken(token)
    return { relayUrl: relayOfSegments(segments), token }
  })
}

function checkPairingToken(token: string): void {
  try {
    parsePairingToken(token)
  } catch (cause) {
    throw new MultiplayerError("BAD_LINK", "invalid pairing token", { cause })
  }
}
