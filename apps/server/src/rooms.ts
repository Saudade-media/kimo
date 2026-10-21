/**
 * The relay core (docs/spec/multiplayer.md §11.4, §14.1, §14.3, §14.4): live rooms, fan-out,
 * compaction scheduling, token expiry and the periodic jobs. It moves ciphertext only. Time comes
 * from the injected clock, and `tick` runs every timed rule, so tests drive both with a fake clock.
 */
import {
  closeCodeFor,
  DEFAULT_LIMITS,
  encodeRelayMessage,
  fromHex,
  MAX_ENTRIES_FRAME_BYTES,
  MAX_ENTRIES_PER_FRAME,
  type MpErrorCode,
  type MpOrigin,
  type PeerInfo,
  type RelayLimits,
  type RelayMessage,
  type Role,
} from "@kimo/sync/mp"
import type { ServerWebSocket } from "bun"
import type { VerifiedToken } from "./auth"
import { type BlobStore, createBlobStore } from "./blobs"
import type { RelayConfig } from "./config"
import { type LogRow, RelayDb, type RoomRow } from "./db"
import { bootOwnership } from "./owners"
import { KeyedLimiter, type TokenBucket } from "./rate-limit"

export const HELLO_TIMEOUT_MS = 10_000
export const COMPACT_RETRY_MS = 60_000
export const UNLOAD_AFTER_MS = 30_000
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const ACTIVE_WRITE_MS = MINUTE
/** Blob upload bytes per room per 10 minutes (§14.8). */
export const BLOB_WINDOW_BYTES = 200 * (1 << 20)

export interface SocketData {
  room: string
  ip: string
  openedAt: number
  stage: "hello" | "verifying" | "ready"
  peer: number
  role: Role
  origin: MpOrigin
  /** Unix seconds; 0 = never. */
  exp: number
  kid: number
  /** Token id as hex. */
  jti: string
  caughtUp: boolean
  lastClock: number
  appendBucket: TokenBucket | null
  awarenessBucket: TokenBucket | null
  /** Every frame after hello, so ping and caught-up cannot be spammed either. */
  frameBucket: TokenBucket | null
  /** Token refreshes: one in flight, and a slow refill. */
  refreshBucket: TokenBucket | null
  refreshing: boolean
}

export type Sock = ServerWebSocket<SocketData>

interface CompactRequest {
  upTo: number
  at: number
  peer: number
  tried: Set<number>
}

export interface LiveRoom {
  id: string
  /** Every open socket, including ones that have not sent `hello` yet. */
  sockets: Set<Sock>
  /** Sockets that completed `hello`, by peer id. */
  peers: Map<number, Sock>
  nextPeer: number
  awareness: Map<number, { clock: number; env: Uint8Array }>
  emptySince: number | null
  activeWrittenAt: number
  head: number
  snapUpTo: number
  /** Envelope bytes of entries after the latest snapshot. */
  sinceBytes: number
  compact: CompactRequest | null
}

export class Relay {
  readonly db: RelayDb
  readonly blobs: BlobStore
  readonly rooms = new Map<string, LiveRoom>()
  readonly connectLimiter: KeyedLimiter
  readonly adminLimiter: KeyedLimiter
  readonly blobLimiter: KeyedLimiter
  readonly blobBytesLimiter: KeyedLimiter
  /** 16 random bytes made at first boot; owner commands and pairing tokens name it (§14.11). */
  readonly relayId: Uint8Array
  /** Request log sink (method, path, status, duration only). */
  log?: (line: string) => void
  private lastMinute: number
  private lastHour: number

  constructor(
    readonly config: RelayConfig,
    readonly now: () => number = Date.now,
    log?: (line: string) => void,
  ) {
    this.db = new RelayDb(config.dataDir)
    if (log) this.log = log
    this.relayId = bootOwnership(this.db, config, now(), log)
    this.blobs = createBlobStore(config.dataDir)
    this.connectLimiter = new KeyedLimiter(
      config.connectRatePerMin,
      config.connectRatePerMin / MINUTE,
    )
    this.adminLimiter = new KeyedLimiter(config.adminRatePerMin, config.adminRatePerMin / MINUTE)
    this.blobLimiter = new KeyedLimiter(config.blobRatePerMin, config.blobRatePerMin / MINUTE)
    // The window must hold at least one maximum-size blob, or that blob could never be uploaded.
    const window = Math.max(BLOB_WINDOW_BYTES, config.blobMaxBytes + 30)
    this.blobBytesLimiter = new KeyedLimiter(window, window / (10 * MINUTE))
    this.lastMinute = this.lastHour = now()
  }

  get limits(): RelayLimits {
    return {
      maxEntryBytes: this.config.entryMaxBytes,
      maxSnapshotBytes: this.config.snapshotMaxBytes,
      maxBlobBytes: this.config.blobMaxBytes,
      roomQuotaBytes: this.config.roomQuotaBytes,
      awarenessHz: DEFAULT_LIMITS.awarenessHz,
    }
  }

  quotaFor(room: RoomRow): number {
    return room.quota_bytes ?? this.config.roomQuotaBytes
  }

  // Live rooms -------------------------------------------------------------------------------

  /** The loaded room, loading it from the database on first use. Null for an unknown room. */
  live(id: string): LiveRoom | null {
    const loaded = this.rooms.get(id)
    if (loaded) return loaded
    const row = this.db.getRoom(id)
    if (!row || row.closed_at !== null) return null
    const snap = this.db.latestSnapshot(id)
    const room: LiveRoom = {
      id,
      sockets: new Set(),
      peers: new Map(),
      nextPeer: 1,
      awareness: new Map(),
      emptySince: null,
      activeWrittenAt: 0,
      head: row.head,
      snapUpTo: snap?.up_to ?? 0,
      sinceBytes: this.db.logBytesAfter(id, snap?.up_to ?? 0),
      compact: null,
    }
    this.rooms.set(id, room)
    return room
  }

  attach(room: LiveRoom, ws: Sock): void {
    room.sockets.add(ws)
    room.emptySince = null
  }

  detach(room: LiveRoom, ws: Sock): void {
    room.sockets.delete(ws)
    const data = ws.data
    if (data.stage === "ready" && room.peers.get(data.peer) === ws) {
      room.peers.delete(data.peer)
      room.awareness.delete(data.peer)
      this.publish(room, { type: "peer-left", peer: data.peer })
      if (room.compact?.peer === data.peer) {
        room.compact = null
        this.checkCompaction(room)
      }
    }
    if (room.sockets.size === 0) room.emptySince = this.now()
  }

  send(ws: Sock, message: RelayMessage | Uint8Array): void {
    ws.send(message instanceof Uint8Array ? message : encodeRelayMessage(message))
  }

  /** Sends one frame to every joined socket of the room except `except`. */
  publish(room: LiveRoom, message: RelayMessage, except?: Sock): void {
    const frame = encodeRelayMessage(message)
    for (const peer of room.peers.values()) if (peer !== except) peer.send(frame)
  }

  closeSocket(ws: Sock, code: MpErrorCode): void {
    ws.close(closeCodeFor(code) ?? 4500, code)
  }

  /** Closes the room's sockets matching `match`; returns how many were joined peers. */
  closeWhere(roomId: string, match: (data: SocketData) => boolean, code: MpErrorCode): number {
    const room = this.rooms.get(roomId)
    if (!room) return 0
    let closed = 0
    for (const ws of [...room.sockets]) {
      if (!match(ws.data)) continue
      if (ws.data.stage === "ready") closed++
      this.closeSocket(ws, code)
    }
    return closed
  }

  /** Forgets a room's in-memory state after its sockets were closed. */
  unload(roomId: string): void {
    this.rooms.delete(roomId)
  }

  // Joining ----------------------------------------------------------------------------------

  /**
   * The synchronous half of `hello` (§11.4): no await between reading the log and subscribing,
   * so the client sees every `seq` exactly once, in order, as an entry or an ack.
   */
  admit(ws: Sock, verified: VerifiedToken, sinceRaw: number) {
    const room = this.rooms.get(ws.data.room)
    if (!room) return this.closeSocket(ws, "ROOM_CLOSED")
    const row = this.db.getRoom(room.id)
    if (!row || row.closed_at !== null) return this.closeSocket(ws, "ROOM_CLOSED")
    if (room.peers.size >= this.config.maxPeers) return this.closeSocket(ws, "ROOM_FULL")
    const { token } = verified
    const data = ws.data
    const snap = this.db.latestSnapshot(room.id)
    const since = sinceRaw > row.head ? 0 : sinceRaw
    const needSnapshot = snap !== null && (since === 0 || since < row.base)
    const from = needSnapshot && snap ? snap.up_to + 1 : since + 1

    data.peer = room.nextPeer++
    data.role = token.role as Role
    data.origin = token.origin
    data.exp = token.exp
    data.kid = token.kid
    data.jti = verified.jtiHex
    const others: PeerInfo[] = []
    for (const [peer, other] of room.peers)
      others.push({ peer, role: other.data.role, origin: other.data.origin })

    this.send(ws, {
      type: "welcome",
      peer: data.peer,
      role: data.role,
      origin: data.origin,
      exp: data.exp,
      kid: data.kid,
      head: row.head,
      base: row.base,
      from,
      needSnapshot,
      snapshot: snap ? { upTo: snap.up_to, gen: snap.gen, bytes: snap.bytes } : null,
      limits: { ...this.limits, roomQuotaBytes: this.quotaFor(row) },
      peers: others,
    })
    this.sendEntries(ws, this.db.iterateEntriesFrom(room.id, from))
    for (const [peer, state] of room.awareness)
      this.send(ws, { type: "awareness", peer, clock: state.clock, env: state.env })

    data.stage = "ready"
    room.peers.set(data.peer, ws)
    this.publish(
      room,
      { type: "peer-joined", peer: { peer: data.peer, role: data.role, origin: data.origin } },
      ws,
    )
    this.touchActive(room)
  }

  /** Pages stored entries into frames of at most 512 entries or 1 MiB of envelopes. */
  private sendEntries(ws: Sock, rows: Iterable<LogRow>): void {
    let page: LogRow[] = []
    let bytes = 0
    const flush = () => {
      if (page.length === 0) return
      this.send(ws, {
        type: "entries",
        entries: page.map((row) => ({
          seq: row.seq,
          origin: row.origin as MpOrigin,
          env: row.env,
        })),
      })
      page = []
      bytes = 0
    }
    for (const row of rows) {
      if (
        page.length > 0 &&
        (page.length >= MAX_ENTRIES_PER_FRAME || bytes + row.env.length > MAX_ENTRIES_FRAME_BYTES)
      )
        flush()
      page.push(row)
      bytes += row.env.length
    }
    flush()
  }

  private touchActive(room: LiveRoom): void {
    const now = this.now()
    if (now - room.activeWrittenAt < ACTIVE_WRITE_MS) return
    room.activeWrittenAt = now
    this.db.touchActive(room.id, now)
  }

  // Appending --------------------------------------------------------------------------------

  /** Stores one entry and fans it out; returns the `seq`. */
  append(room: LiveRoom, sender: Sock, env: Uint8Array): number {
    const data = sender.data
    const seq = this.db.appendLog(room.id, data.origin, fromHex(data.jti), this.now(), env)
    room.head = seq
    room.sinceBytes += env.length
    return seq
  }

  /** Called after `append`: ack the sender, publish to the others, maybe ask for a snapshot. */
  afterAppend(room: LiveRoom, sender: Sock, cid: number, seq: number, env: Uint8Array): void {
    this.send(sender, { type: "ack", cid, seq })
    this.publish(
      room,
      { type: "entries", entries: [{ seq, origin: sender.data.origin, env }] },
      sender,
    )
    this.touchActive(room)
    this.checkCompaction(room)
  }

  // Compaction -------------------------------------------------------------------------------

  private pickCompactor(room: LiveRoom, tried: ReadonlySet<number>): Sock | null {
    let best: Sock | null = null
    for (const ws of room.peers.values()) {
      const d = ws.data
      if (d.role !== "edit" || !d.caughtUp || tried.has(d.peer)) continue
      if (!best || d.peer < best.data.peer) best = ws
    }
    return best
  }

  checkCompaction(room: LiveRoom): void {
    if (room.compact) return
    const entries = room.head - room.snapUpTo
    if (entries < this.config.compactEntries && room.sinceBytes < this.config.compactBytes) return
    if (entries <= 0) return
    const target = this.pickCompactor(room, new Set())
    if (!target) return
    room.compact = { upTo: room.head, at: this.now(), peer: target.data.peer, tried: new Set() }
    this.send(target, { type: "compact", upTo: room.head })
  }

  /** A snapshot was stored: publish it and clear the outstanding request. */
  snapshotAccepted(
    roomId: string,
    info: { upTo: number; gen: number; bytes: number },
    carriesNew: boolean,
  ): void {
    const room = this.rooms.get(roomId)
    if (!room) return
    room.snapUpTo = info.upTo
    room.sinceBytes = this.db.logBytesAfter(roomId, info.upTo)
    room.compact = null
    this.publish(room, { type: "snapshot", info, carriesNew })
  }

  // Timed rules ------------------------------------------------------------------------------

  /** Runs every timed rule against the clock. The server calls it about once a second. */
  tick(): void {
    const now = this.now()
    for (const room of [...this.rooms.values()]) {
      for (const ws of [...room.sockets]) {
        const d = ws.data
        if (d.stage !== "ready") {
          if (now - d.openedAt >= HELLO_TIMEOUT_MS) this.closeSocket(ws, "HELLO_TIMEOUT")
        } else if (d.exp !== 0 && d.exp * 1000 <= now) {
          this.closeSocket(ws, "TOKEN_EXPIRED")
        }
      }
      const request = room.compact
      if (request && now - request.at >= COMPACT_RETRY_MS) {
        request.tried.add(request.peer)
        const next = this.pickCompactor(room, request.tried)
        if (next) {
          request.peer = next.data.peer
          request.at = now
          request.upTo = room.head
          this.send(next, { type: "compact", upTo: room.head })
        } else {
          room.compact = null
        }
      }
      if (
        room.sockets.size === 0 &&
        room.emptySince !== null &&
        now - room.emptySince >= UNLOAD_AFTER_MS
      )
        this.rooms.delete(room.id)
    }
    if (now - this.lastMinute >= MINUTE) {
      this.lastMinute = now
      this.everyMinute(now)
    }
    if (now - this.lastHour >= HOUR) {
      this.lastHour = now
      this.everyHour(now)
    }
  }

  private everyMinute(now: number): void {
    this.retain(now)
    this.db.pruneNonces(now)
    for (const limiter of [
      this.connectLimiter,
      this.adminLimiter,
      this.blobLimiter,
      this.blobBytesLimiter,
    ])
      limiter.prune(now)
  }

  /** Retention (§14.3): drop covered entries older than `logRetainMs`. */
  retain(now: number = this.now()): void {
    const cutoff = now - this.config.logRetainMs
    for (const id of this.db.roomsWithSnapshots()) {
      const snap = this.db.latestSnapshot(id)
      if (snap) this.db.pruneLog(id, snap.up_to, cutoff)
    }
  }

  private everyHour(now: number): void {
    this.db.pruneRevocations(Math.floor(now / 1000))
    this.db.prunePairings(Math.floor(now / 1000))
    if (this.config.roomTtlDays <= 0) return
    for (const id of this.db.idleRoomIds(now - this.config.roomTtlDays * DAY)) {
      if (this.rooms.get(id)?.sockets.size) continue
      this.rooms.delete(id)
      this.blobs.deleteRoom(id)
      this.db.deleteRoom(id)
    }
  }

  dispose(): void {
    for (const room of this.rooms.values())
      for (const ws of room.sockets) ws.close(1001, "going away")
    this.rooms.clear()
    this.db.close()
  }
}
