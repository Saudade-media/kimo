/**
 * HTTP routes and the WebSocket upgrade (docs/spec/multiplayer.md §12). Bodies are ciphertext;
 * authenticated routes take `Authorization: Bearer <token>` and run the §4 verification. Tokens
 * never appear in logs: only method, path, status and duration are logged.
 */
import {
  EnvelopeKind,
  envelopeKind,
  isBlobId,
  isRoomId,
  MAX_ADMIN_BODY_BYTES,
  MAX_OWNER_COMMAND_BYTES,
  MP_ERRORS,
  type MpErrorCode,
  MultiplayerError,
  PROTOCOL,
  SUBPROTOCOL,
  toBase64Url,
} from "@kimo/sync/mp"
import type { Server } from "bun"
import pkg from "../package.json" with { type: "json" }
import { runAdmin } from "./admin"
import { bearerToken, recheckToken, type VerifiedToken, verifyToken } from "./auth"
import { retryAfterSeconds } from "./rate-limit"
import type { Relay, SocketData } from "./rooms"
import { webResponse } from "./web"
import { initialSocketData } from "./ws"

const ENVELOPE_OVERHEAD = 30
const MAX_MISSING_IDS = 1000
/**
 * Sockets per client address, across the whole relay, that have not finished `hello`. The room id
 * is not secret, so tokenless sockets never count against a room's admission.
 */
const MAX_PENDING_PER_IP = 3
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const

export interface VersionBody {
  name: string
  version: string
  protocol: typeof PROTOCOL
  limits: Relay["limits"]
  /** Base64url of the 16-byte relay id (§14.11). */
  relayId: string
  /** `external` under an external owner policy (§14.12). */
  owner: "unclaimed" | "claimed" | "external"
}

export function versionBody(relay: Relay): VersionBody {
  return {
    name: pkg.name,
    version: pkg.version,
    protocol: PROTOCOL,
    limits: relay.limits,
    relayId: toBase64Url(relay.relayId),
    owner: relay.owner.status(),
  }
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } })
}

export function errorResponse(error: unknown): Response {
  if (error instanceof MultiplayerError) {
    const status = MP_ERRORS[error.code].http ?? 500
    const headers: Record<string, string> = {}
    if (error.retryAfterMs !== undefined)
      headers["retry-after"] = String(retryAfterSeconds(error.retryAfterMs))
    return json({ error: error.code, message: error.message }, status, headers)
  }
  console.error("request failed", error instanceof Error ? error.message : error)
  return json({ error: "INTERNAL", message: "internal error" }, 500)
}

function fail(code: MpErrorCode, message: string, retryAfterMs?: number): never {
  throw new MultiplayerError(
    code,
    message,
    retryAfterMs === undefined ? undefined : { retryAfterMs },
  )
}

function methodNotAllowed(allow: string): Response {
  return json({ error: "METHOD_NOT_ALLOWED" }, 405, { allow })
}

export function clientIp(relay: Relay, req: Request, server: Server<SocketData>): string {
  if (relay.config.trustProxy) {
    // Proxies append the address they saw, so the leftmost entries are client-controlled: count
    // `trustProxyHops` entries from the right instead.
    const chain = (req.headers.get("x-forwarded-for") ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
    const hop = chain[chain.length - relay.config.trustProxyHops]
    if (hop) return hop
  }
  return server.requestIP(req)?.address ?? "unknown"
}

/**
 * The Kimo desktop app's webview origins (Tauri 2, `WebviewUrl::App`, no `useHttpsScheme`):
 * `tauri://localhost` on macOS and Linux, `http://tauri.localhost` on Windows (and
 * `https://tauri.localhost` with the https scheme). No web page can send them, so like a
 * missing Origin they are always admitted, whatever `KIMO_ALLOWED_ORIGINS` lists.
 */
export const DESKTOP_ORIGINS: readonly string[] = [
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
]

function corsHeaders(relay: Relay, req: Request): Record<string, string> {
  const allowed = relay.config.allowedOrigins
  const headers: Record<string, string> = {
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, HEAD, PUT, POST, OPTIONS",
    "access-control-expose-headers": "kimo-up-to, kimo-gen, retry-after",
    "access-control-max-age": "600",
  }
  if (allowed === "*") {
    headers["access-control-allow-origin"] = "*"
  } else {
    const origin = req.headers.get("origin")
    headers.vary = "origin"
    if (origin && (allowed.includes(origin) || DESKTOP_ORIGINS.includes(origin)))
      headers["access-control-allow-origin"] = origin
  }
  return headers
}

/**
 * Whether `origin` is the relay's own: the web app it serves (board 45) connects from there.
 * Browsers set both headers, so another site's page never matches.
 */
function sameOrigin(relay: Relay, req: Request, origin: string): boolean {
  let host: string
  try {
    host = new URL(origin).host
  } catch {
    return false
  }
  const forwarded = relay.config.trustProxy
    ? req.headers.get("x-forwarded-host")?.split(",")[0]?.trim()
    : undefined
  const own = forwarded || req.headers.get("host")
  return own !== null && host === own.toLowerCase()
}

function originAllowed(relay: Relay, req: Request): boolean {
  const allowed = relay.config.allowedOrigins
  const origin = req.headers.get("origin")
  return (
    allowed === "*" ||
    origin === null ||
    DESKTOP_ORIGINS.includes(origin) ||
    allowed.includes(origin) ||
    sameOrigin(relay, req, origin)
  )
}

/** Reads a request body as a stream, cancelling as soon as it passes `max` bytes. */
async function readBody(req: Request, max: number): Promise<Uint8Array> {
  const declared = Number(req.headers.get("content-length") ?? "0")
  if (Number.isFinite(declared) && declared > max) fail("TOO_LARGE", "body too large")
  if (!req.body) return new Uint8Array(0)
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.length
    if (length > max) {
      await reader.cancel().catch(() => {})
      fail("TOO_LARGE", "body too large")
    }
    chunks.push(value)
  }
  const body = new Uint8Array(length)
  let at = 0
  for (const chunk of chunks) {
    body.set(chunk, at)
    at += chunk.length
  }
  return body
}

async function authorize(
  relay: Relay,
  req: Request,
  roomId: string,
  need: "view" | "edit",
): Promise<VerifiedToken> {
  const verified = await verifyToken(
    relay.db,
    roomId,
    bearerToken(req),
    Math.floor(relay.now() / 1000),
  )
  if (need === "edit" && verified.token.role !== "edit") fail("VIEW_ONLY", "this link is view only")
  return verified
}

export function createFetchHandler(relay: Relay) {
  const { db, config } = relay

  function upgrade(req: Request, server: Server<SocketData>, roomId: string): Response | undefined {
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket")
      fail("BAD_REQUEST", "expected a WebSocket upgrade")
    if (!originAllowed(relay, req)) fail("ORIGIN_FORBIDDEN", "origin not allowed")
    const protocols = (req.headers.get("sec-websocket-protocol") ?? "")
      .split(",")
      .map((p) => p.trim())
    if (!protocols.includes(SUBPROTOCOL)) fail("PROTOCOL_MISMATCH", `expected ${SUBPROTOCOL}`)
    const ip = clientIp(relay, req, server)
    const wait = relay.connectLimiter.take(ip, relay.now())
    if (wait > 0) fail("RATE_LIMITED", "too many connections", wait)
    const room = isRoomId(roomId) ? db.getRoom(roomId) : null
    if (!room) fail("ROOM_NOT_FOUND", "unknown room")
    if (room.closed_at !== null) fail("ROOM_CLOSED", "the owner stopped sharing")
    // Only admitted peers count toward the room cap (admit checks it again). Sockets that have
    // not presented a token are bounded per client address over the whole relay instead.
    const live = relay.rooms.get(roomId)
    if ((live?.peers.size ?? 0) >= config.maxPeers) fail("ROOM_FULL", "room is full", 5000)
    let pendingFromIp = 0
    for (const other of relay.rooms.values())
      for (const ws of other.sockets)
        if (ws.data.stage !== "ready" && ws.data.ip === ip) pendingFromIp++
    if (pendingFromIp >= MAX_PENDING_PER_IP)
      fail("RATE_LIMITED", "too many connections are still joining", 5000)
    const ok = server.upgrade(req, {
      data: initialSocketData(roomId, ip, relay.now()),
    })
    return ok ? undefined : errorResponse(new MultiplayerError("BAD_REQUEST", "upgrade failed"))
  }

  async function admin(
    req: Request,
    server: Server<SocketData>,
    roomId: string,
  ): Promise<Response> {
    if (req.method !== "POST") return methodNotAllowed("POST")
    const wait = relay.adminLimiter.take(clientIp(relay, req, server), relay.now())
    if (wait > 0) fail("RATE_LIMITED", "too many admin requests", wait)
    if (!isRoomId(roomId)) fail("ROOM_NOT_FOUND", "unknown room")
    const body = await readBody(req, MAX_ADMIN_BODY_BYTES + 52 + 64)
    const result = await runAdmin(relay, roomId, body)
    return json(result.body, result.status)
  }

  /** `POST /owner` (§6.1): one device-signed owner command; shares the admin rate limit. */
  async function owner(req: Request, server: Server<SocketData>): Promise<Response> {
    if (req.method !== "POST") return methodNotAllowed("POST")
    const wait = relay.adminLimiter.take(clientIp(relay, req, server), relay.now())
    if (wait > 0) fail("RATE_LIMITED", "too many admin requests", wait)
    const body = await readBody(req, MAX_OWNER_COMMAND_BYTES)
    const result = await relay.owner.owner(body)
    return json(result.body, result.status)
  }

  async function roomInfo(req: Request, roomId: string): Promise<Response> {
    if (req.method !== "GET") return methodNotAllowed("GET")
    const { room } = await authorize(relay, req, roomId, "view")
    const snap = db.latestSnapshot(roomId)
    return json({
      room: roomId,
      kid: room.link_kid,
      head: room.head,
      base: room.base,
      snapshot: snap ? { upTo: snap.up_to, gen: snap.gen, bytes: snap.bytes } : null,
      usedBytes: room.blob_bytes + room.snapshot_bytes + room.log_bytes,
      quotaBytes: relay.quotaFor(room),
      peers: relay.rooms.get(roomId)?.peers.size ?? 0,
    })
  }

  async function snapshot(req: Request, url: URL, roomId: string): Promise<Response> {
    if (req.method === "GET") {
      await authorize(relay, req, roomId, "view")
      const snap = db.latestSnapshotEnv(roomId)
      if (!snap) fail("NOT_FOUND", "no snapshot")
      return new Response(snap.env as Uint8Array<ArrayBuffer>, {
        headers: {
          "content-type": "application/octet-stream",
          "kimo-up-to": String(snap.up_to),
          "kimo-gen": String(snap.gen),
        },
      })
    }
    if (req.method !== "PUT") return methodNotAllowed("GET, PUT")
    const verified = await authorize(relay, req, roomId, "edit")
    const upToText = url.searchParams.get("upTo")
    if (upToText === null || !/^\d{1,15}$/.test(upToText)) fail("BAD_REQUEST", "upTo is required")
    const upTo = Number(upToText)
    const carries = url.searchParams.get("carries") === "1"
    const env = await readBody(req, config.snapshotMaxBytes)
    if (envelopeKind(env) !== EnvelopeKind.snapshot || env.length < ENVELOPE_OVERHEAD)
      fail("BAD_REQUEST", "not a snapshot envelope")
    // Everything below is synchronous: head, the current snapshot and the write cannot interleave.
    // The link may have been revoked, reset or expired while the body was uploading.
    const room = recheckToken(db, verified, Math.floor(relay.now() / 1000))
    if (upTo > room.head) fail("SNAPSHOT_AHEAD", "snapshot covers entries the room does not have")
    const cur = db.latestSnapshot(roomId)
    if (cur && !(upTo > cur.up_to || (upTo === cur.up_to && carries)))
      fail("SNAPSHOT_STALE", "snapshot does not advance the current one")
    const retained = cur ? cur.bytes : 0
    if (room.blob_bytes + retained + env.length > relay.quotaFor(room))
      fail("QUOTA_EXCEEDED", "room storage quota exceeded")
    relay.checkAccountStorage(room, room.blob_bytes + retained + env.length)
    const gen = db.putSnapshot(roomId, upTo, carries, relay.now(), env)
    relay.snapshotAccepted(roomId, { upTo, gen, bytes: env.length }, carries)
    return json({ gen, upTo }, 201)
  }

  async function blobPut(req: Request, roomId: string, id: string): Promise<Response> {
    const verified = await authorize(relay, req, roomId, "edit")
    const { jtiHex } = verified
    if (!isBlobId(id)) fail("BAD_REQUEST", "invalid blob id")
    const wait = relay.blobLimiter.take(`${roomId}:${jtiHex}`, relay.now())
    if (wait > 0) fail("RATE_LIMITED", "too many uploads", wait)
    const max = config.blobMaxBytes + ENVELOPE_OVERHEAD
    const declared = Number(req.headers.get("content-length") ?? "0")
    if (Number.isFinite(declared) && declared > max) fail("TOO_LARGE", "blob too large")
    if (db.getBlob(roomId, id) && relay.blobs.has(roomId, id)) {
      // Unmark before draining: a sweep running during the await must see the blob as kept.
      db.clearUnref(roomId, id)
      await req.arrayBuffer().catch(() => undefined)
      return json({}, 200)
    }
    const body = await readBody(req, max)
    if (body.length < ENVELOPE_OVERHEAD || envelopeKind(body) !== EnvelopeKind.blob)
      fail("BAD_REQUEST", "not a blob envelope")
    const bytesWait = relay.blobBytesLimiter.take(roomId, relay.now(), body.length)
    if (bytesWait > 0) fail("RATE_LIMITED", "too many upload bytes", bytesWait)
    // A room with an account asks the owner policy, which records the account's limit (§14.12).
    const before = db.getRoom(roomId)
    const account = before?.account ?? null
    if (before && account !== null) await relay.owner.write({ ...before, account }, body.length)
    // The room may have been closed, or the link revoked or reset, while the body was uploading.
    const fresh = recheckToken(db, verified, Math.floor(relay.now() / 1000))
    const after = fresh.blob_bytes + fresh.snapshot_bytes + fresh.log_bytes + body.length
    if (after > relay.quotaFor(fresh)) fail("QUOTA_EXCEEDED", "room storage quota exceeded")
    relay.checkAccountStorage(fresh, after)
    relay.blobs.put(roomId, id, body)
    try {
      if (db.getBlob(roomId, id)) db.clearUnref(roomId, id)
      else db.insertBlob(roomId, id, body.length, relay.now())
    } catch (error) {
      relay.blobs.delete(roomId, id)
      throw error
    }
    return json({}, 201)
  }

  async function blob(req: Request, roomId: string, id: string): Promise<Response> {
    if (req.method === "PUT") return blobPut(req, roomId, id)
    if (req.method !== "GET" && req.method !== "HEAD") return methodNotAllowed("GET, HEAD, PUT")
    await authorize(relay, req, roomId, "view")
    if (!isBlobId(id)) fail("BAD_REQUEST", "invalid blob id")
    const row = db.getBlob(roomId, id)
    const file = row ? relay.blobs.read(roomId, id) : null
    if (!row || !file) fail("NOT_FOUND", "no such blob")
    if (req.method === "HEAD")
      return new Response(null, { headers: { "content-length": String(row.bytes) } })
    return new Response(file, {
      headers: {
        "content-type": "application/octet-stream",
        "cache-control": "private, max-age=31536000, immutable",
      },
    })
  }

  async function missing(req: Request, roomId: string): Promise<Response> {
    if (req.method !== "POST") return methodNotAllowed("POST")
    await authorize(relay, req, roomId, "view")
    let parsed: unknown
    try {
      parsed = JSON.parse(new TextDecoder().decode(await readBody(req, 1 << 20)))
    } catch (error) {
      if (error instanceof MultiplayerError) throw error
      return fail("BAD_REQUEST", "invalid JSON")
    }
    const ids = (parsed as { ids?: unknown } | null)?.ids
    if (!Array.isArray(ids) || ids.length > MAX_MISSING_IDS || !ids.every(isBlobId))
      fail("BAD_REQUEST", `ids must be up to ${MAX_MISSING_IDS} blob ids`)
    return json({ missing: (ids as string[]).filter((id) => !db.getBlob(roomId, id)) })
  }

  async function route(req: Request, server: Server<SocketData>): Promise<Response | undefined> {
    const url = new URL(req.url)
    const parts = url.pathname.split("/").filter(Boolean)
    const [head, roomId, tail] = parts

    if (req.method === "OPTIONS") return new Response(null, { status: 204 })
    if (url.pathname === "/healthz" || url.pathname === "/version") {
      if (req.method !== "GET" && req.method !== "HEAD") return methodNotAllowed("GET, HEAD")
      return json(url.pathname === "/healthz" ? { ok: true } : versionBody(relay))
    }
    if (url.pathname === "/owner") return owner(req, server)
    if (head === "sync" && parts.length <= 2) {
      if (!roomId) fail("BAD_REQUEST", "expected /sync/<room>")
      return upgrade(req, server, roomId)
    }
    if (head === "room" && roomId) {
      if (parts.length === 2) return roomInfo(req, roomId)
      if (parts.length === 3 && tail === "admin") return admin(req, server, roomId)
      if (parts.length === 3 && tail === "snapshot") return snapshot(req, url, roomId)
    }
    if (head === "blob" && roomId && tail && parts.length === 3) {
      if (!isRoomId(roomId)) fail("ROOM_NOT_FOUND", "unknown room")
      return tail === "missing" ? missing(req, roomId) : blob(req, roomId, tail)
    }
    const web = webResponse(req, url, relay.config.webDir ?? null)
    if (web) return web
    return json({ error: "NOT_FOUND", message: `No route for ${url.pathname}` }, 404)
  }

  return async function fetch(
    req: Request,
    server: Server<SocketData>,
  ): Promise<Response | undefined> {
    const started = performance.now()
    const path = new URL(req.url).pathname
    let response: Response | undefined
    try {
      response = await route(req, server)
    } catch (error) {
      response = errorResponse(error)
    }
    if (!response) return undefined
    for (const [name, value] of Object.entries(corsHeaders(relay, req)))
      response.headers.set(name, value)
    relay.log?.(
      `${req.method} ${path} ${response.status} ${Math.round(performance.now() - started)}ms`,
    )
    return response
  }
}
