/**
 * WebSocket handlers for `/sync/<room>` (docs/spec/multiplayer.md §11). Every frame is binary;
 * the relay checks the token, the role and sizes, then stores or forwards ciphertext it cannot
 * read.
 */
import {
  type ClientMessage,
  decodeClientMessage,
  EnvelopeKind,
  envelopeKind,
  MAX_AWARENESS_BYTES,
  MP_ERRORS,
  type MpErrorCode,
  MultiplayerError,
  PROTOCOL_VERSION,
} from "@kimo/sync/mp"
import type { WebSocketHandler } from "bun"
import { recheckToken, verifyToken } from "./auth"
import { TokenBucket } from "./rate-limit"
import type { Relay, Sock, SocketData } from "./rooms"

/** Appends per second per connection, with a burst of twice that (§14.8). */
const APPEND_PER_SECOND = 100
const APPEND_BURST = 200
/** All frames per second per connection (ping, caught-up, refresh included), with a burst. */
const FRAME_PER_SECOND = 200
const FRAME_BURST = 400
/** Token refreshes: a burst of 2, then one per 10 s; only one verifies at a time. */
const REFRESH_BURST = 2
const REFRESH_REFILL_PER_MS = 1 / 10_000

function codeOf(error: unknown): MpErrorCode {
  if (error instanceof MultiplayerError && MP_ERRORS[error.code].close !== undefined)
    return error.code
  return error instanceof MultiplayerError && error.code === "BAD_REQUEST"
    ? "AUTH_INVALID"
    : "INTERNAL"
}

export function initialSocketData(room: string, ip: string, now: number): SocketData {
  return {
    room,
    ip,
    openedAt: now,
    stage: "hello",
    peer: 0,
    role: "view",
    origin: "user",
    exp: 0,
    kid: 0,
    jti: "",
    caughtUp: false,
    lastClock: -1,
    appendBucket: null,
    awarenessBucket: null,
    frameBucket: null,
    refreshBucket: null,
    refreshing: false,
  }
}

export function websocketHandlers(relay: Relay): WebSocketHandler<SocketData> {
  const deny = (ws: Sock, code: MpErrorCode, cid: number, message: string) =>
    relay.send(ws, { type: "denied", code, cid, message })

  async function onHello(ws: Sock, msg: Extract<ClientMessage, { type: "hello" }>) {
    const data = ws.data
    if (msg.proto !== PROTOCOL_VERSION) return relay.closeSocket(ws, "PROTOCOL_MISMATCH")
    data.stage = "verifying"
    let verified: Awaited<ReturnType<typeof verifyToken>>
    try {
      verified = await verifyToken(relay.db, data.room, msg.token, Math.floor(relay.now() / 1000))
    } catch (error) {
      return relay.closeSocket(ws, codeOf(error))
    }
    if (ws.readyState !== 1) return
    // The room may have been closed, rotated or the token revoked while the signature was checked.
    const row = relay.db.getRoom(data.room)
    if (!row || row.closed_at !== null) return relay.closeSocket(ws, "ROOM_CLOSED")
    if (row.link_kid !== verified.token.kid) return relay.closeSocket(ws, "KEY_ROTATED")
    if (relay.db.isRevoked(data.room, verified.token.jti))
      return relay.closeSocket(ws, "TOKEN_REVOKED")
    const now = relay.now()
    data.appendBucket = new TokenBucket(APPEND_BURST, APPEND_PER_SECOND / 1000, now)
    const hz = relay.limits.awarenessHz
    data.awarenessBucket = new TokenBucket(hz, hz / 1000, now)
    data.frameBucket = new TokenBucket(FRAME_BURST, FRAME_PER_SECOND / 1000, now)
    data.refreshBucket = new TokenBucket(REFRESH_BURST, REFRESH_REFILL_PER_MS, now)
    relay.admit(ws, verified, msg.since)
  }

  async function onRefresh(ws: Sock, token: string) {
    const data = ws.data
    if (data.refreshing || (data.refreshBucket && data.refreshBucket.take(relay.now()) > 0))
      return relay.closeSocket(ws, "RATE_LIMITED")
    data.refreshing = true
    try {
      const verified = await verifyToken(relay.db, data.room, token, Math.floor(relay.now() / 1000))
      if (ws.readyState !== 1) return
      // A revoke or reset may have landed during the signature check, before data.jti changed.
      try {
        recheckToken(relay.db, verified, Math.floor(relay.now() / 1000))
      } catch (error) {
        return relay.closeSocket(ws, codeOf(error))
      }
      if (verified.token.role !== data.role || verified.token.origin !== data.origin)
        return deny(ws, "BAD_MESSAGE", 0, "refresh must keep role and origin")
      data.exp = verified.token.exp
      data.kid = verified.token.kid
      data.jti = verified.jtiHex
      relay.send(ws, { type: "token", exp: data.exp })
    } catch (error) {
      deny(ws, error instanceof MultiplayerError ? error.code : "INTERNAL", 0, "refresh refused")
    } finally {
      data.refreshing = false
    }
  }

  function onAppend(ws: Sock, cid: number, env: Uint8Array) {
    const data = ws.data
    const room = relay.rooms.get(data.room)
    if (!room) return relay.closeSocket(ws, "ROOM_CLOSED")
    if (data.appendBucket && data.appendBucket.take(relay.now()) > 0)
      return relay.closeSocket(ws, "RATE_LIMITED")
    if (data.role !== "edit") return deny(ws, "VIEW_ONLY", cid, "this link is view only")
    if (env.length > relay.config.entryMaxBytes)
      return deny(ws, "TOO_LARGE", cid, "entry too large")
    if (envelopeKind(env) !== EnvelopeKind.update)
      return deny(ws, "BAD_MESSAGE", cid, "not an update envelope")
    const row = relay.db.getRoom(room.id)
    if (!row || row.closed_at !== null) return relay.closeSocket(ws, "ROOM_CLOSED")
    if (row.log_bytes > relay.config.logMaxBytes) return relay.closeSocket(ws, "LOG_FULL")
    if (row.blob_bytes + row.snapshot_bytes + row.log_bytes + env.length > relay.quotaFor(row))
      return deny(ws, "QUOTA_EXCEEDED", cid, "room storage quota exceeded")
    const seq = relay.append(room, ws, env)
    relay.afterAppend(room, ws, cid, seq, env)
  }

  function onAwareness(ws: Sock, clock: number, env: Uint8Array) {
    const data = ws.data
    const room = relay.rooms.get(data.room)
    if (!room) return
    if (env.length > MAX_AWARENESS_BYTES) return deny(ws, "TOO_LARGE", 0, "awareness too large")
    if (clock <= data.lastClock) return
    if (data.awarenessBucket && data.awarenessBucket.take(relay.now()) > 0) return
    if (env.length > 0 && envelopeKind(env) !== EnvelopeKind.awareness) return
    data.lastClock = clock
    if (env.length === 0) room.awareness.delete(data.peer)
    else room.awareness.set(data.peer, { clock, env })
    relay.publish(room, { type: "awareness", peer: data.peer, clock, env }, ws)
  }

  function onMessage(ws: Sock, msg: ClientMessage) {
    const data = ws.data
    if (data.stage !== "ready") {
      if (msg.type === "hello" && data.stage === "hello") {
        void onHello(ws, msg).catch(() => relay.closeSocket(ws, "INTERNAL"))
        return
      }
      return relay.closeSocket(ws, "BAD_MESSAGE")
    }
    if (data.frameBucket && data.frameBucket.take(relay.now()) > 0)
      return relay.closeSocket(ws, "RATE_LIMITED")
    switch (msg.type) {
      case "hello":
        return relay.closeSocket(ws, "BAD_MESSAGE")
      case "append":
        return onAppend(ws, msg.cid, msg.env)
      case "awareness":
        return onAwareness(ws, msg.clock, msg.env)
      case "caught-up": {
        data.caughtUp = true
        const room = relay.rooms.get(data.room)
        if (room) relay.checkCompaction(room)
        return
      }
      case "refresh":
        void onRefresh(ws, msg.token).catch(() => relay.closeSocket(ws, "INTERNAL"))
        return
      case "ping":
        return relay.send(ws, { type: "pong", n: msg.n })
    }
  }

  return {
    maxPayloadLength: relay.config.entryMaxBytes + 65_536,
    idleTimeout: 60,
    sendPings: true,
    backpressureLimit: 64 * (1 << 20),
    closeOnBackpressureLimit: true,
    perMessageDeflate: false,
    open(ws) {
      const room = relay.live(ws.data.room)
      if (!room) return relay.closeSocket(ws, "ROOM_NOT_FOUND")
      relay.attach(room, ws)
    },
    message(ws, raw) {
      if (typeof raw === "string") return relay.closeSocket(ws, "BAD_MESSAGE")
      let msg: ClientMessage
      try {
        msg = decodeClientMessage(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength))
      } catch {
        return relay.closeSocket(ws, "BAD_MESSAGE")
      }
      try {
        onMessage(ws, msg)
      } catch (error) {
        console.error("ws handler failed", error instanceof Error ? error.message : error)
        relay.closeSocket(ws, "INTERNAL")
      }
    },
    close(ws) {
      const room = relay.rooms.get(ws.data.room)
      if (room) relay.detach(room, ws)
    },
  }
}
