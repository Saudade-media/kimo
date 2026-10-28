/**
 * An in-memory `kimo-mp/1` relay for the network provider tests (log sequencing, snapshot
 * rules, `compact` requests), over a fake `WebSocket` class and a fake `fetch`, using the
 * protocol codec. It does not verify signatures (that is the real
 * relay's job): tokens are plain strings mapped to a role and origin by a table.
 */
import { type DocStoreOptions, YjsDocStore } from "@kimo/editor-state"
import {
  type ClientMessage,
  DEFAULT_LIMITS,
  decodeClientMessage,
  deriveRoomKeys,
  encodeRelayMessage,
  generateRoomKey,
  type LogEntry,
  MP_ERRORS,
  type MpErrorCode,
  type MpOrigin,
  type PeerInfo,
  parseRoomId,
  type RelayLimits,
  type RelayMessage,
  type Role,
  randomBytes,
  roomIdFromRaw,
  SUBPROTOCOL,
  sealSnapshot,
} from "../src/mp"
import { createNetworkProvider, type NetworkProviderOptions } from "../src/network"
import type { RelayNetworkProvider } from "../src/network-provider"
import { emptyStore } from "./helpers"

export const RELAY_URL = "https://relay.test"

/** What a token string grants in the fake relay. */
export interface FakeGrant {
  role: Role | "comment"
  origin?: MpOrigin
  exp?: number
  /** The relay refuses this token with this code at `hello` (expired, revoked...). */
  refuse?: MpErrorCode
}

interface StoredSnapshot {
  upTo: number
  gen: number
  carries: boolean
  env: Uint8Array
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  })
const fail = (code: MpErrorCode, message: string = code) =>
  json(MP_ERRORS[code].http ?? 400, { error: code, message })

/** A socket as both ends see it: the client-facing WebSocket API and the relay's peer state. */
export class FakeSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  readyState = 0
  binaryType = "blob"
  protocol = ""
  onopen: ((event: unknown) => void) | null = null
  onmessage: ((event: { data: ArrayBuffer }) => void) | null = null
  onclose: ((event: { code: number; reason: string }) => void) | null = null
  onerror: ((event: unknown) => void) | null = null

  /** Relay side. */
  peer = 0
  role: Role = "view"
  origin: MpOrigin = "user"
  token = ""
  helloed = false
  caughtUp = false
  awarenessClock = 0
  /** Every frame this socket sent, decoded. */
  readonly sent: ClientMessage[] = []
  /** Every frame the relay sent to it. */
  readonly received: RelayMessage[] = []

  constructor(
    readonly relay: FakeRelay,
    readonly url: string,
    protocols?: string | string[],
  ) {
    relay.connect(this, protocols)
  }

  send(data: Uint8Array | ArrayBuffer): void {
    if (this.readyState !== FakeSocket.OPEN) throw new Error("socket not open")
    const message = decodeClientMessage(data instanceof Uint8Array ? data : new Uint8Array(data))
    this.sent.push(message)
    queueMicrotask(() => this.relay.receive(this, message))
  }

  close(code = 1000, reason = ""): void {
    if (this.readyState === FakeSocket.CLOSED) return
    this.readyState = FakeSocket.CLOSED
    this.relay.disconnected(this)
    queueMicrotask(() => this.onclose?.({ code, reason }))
  }

  /** @internal Relay to client. */
  deliver(message: RelayMessage): void {
    if (this.readyState !== FakeSocket.OPEN || this.relay.mute) return
    this.received.push(message)
    const bytes = encodeRelayMessage(message).slice()
    queueMicrotask(() => {
      if (this.readyState === FakeSocket.OPEN) this.onmessage?.({ data: bytes.buffer })
    })
  }

  /** @internal The relay closes this socket. */
  serverClose(code: number, reason: string): void {
    if (this.readyState === FakeSocket.CLOSED) return
    this.readyState = FakeSocket.CLOSED
    this.relay.disconnected(this)
    queueMicrotask(() => this.onclose?.({ code, reason }))
  }
}

export class FakeRelay {
  readonly relayUrl = RELAY_URL
  readonly tokens = new Map<string, FakeGrant>()
  readonly log: LogEntry[] = []
  readonly snapshots: StoredSnapshot[] = []
  /** Accepted snapshot PUTs, in order. */
  readonly snapshotPuts: { upTo: number; carries: boolean }[] = []
  /** Every snapshot PUT, accepted or not, with the HTTP status it got. */
  readonly snapshotAttempts: { upTo: number; carries: boolean; status: number }[] = []
  /** Every socket ever created. */
  readonly allSockets: FakeSocket[] = []
  readonly live = new Set<FakeSocket>()
  head = 0
  base = 0
  limits: RelayLimits = { ...DEFAULT_LIMITS }
  /** New sockets fail like an unreachable relay (close 1006 without opening). */
  refuse = false
  /** When set, snapshot GETs wait for it. */
  snapshotGate: Promise<void> | null = null
  /** Appends are stored and fanned out, but the author gets no `ack` (an unclean client). */
  holdAcks = false
  /** Appends are refused with this code (and their cid), like a full room. */
  denyAppends: MpErrorCode | null = null
  /** The next N snapshot PUTs answer 409 SNAPSHOT_STALE whatever they carry (a bounded race). */
  staleSnapshots = 0
  /** The relay stops sending anything (a silently dead connection). */
  mute = false
  /** Snapshot GETs served. */
  snapshotGets = 0
  private nextPeer = 1
  private readonly awarenessCache = new Map<number, { clock: number; env: Uint8Array }>()

  constructor(readonly room: string) {}

  /** The constructor to pass as `WebSocket`. */
  get WebSocket(): NonNullable<NetworkProviderOptions["WebSocket"]> {
    const relay = this
    return class extends FakeSocket {
      constructor(url: string, protocols?: string | string[]) {
        super(relay, url, protocols)
      }
    } as unknown as NonNullable<NetworkProviderOptions["WebSocket"]>
  }

  /** The function to pass as `fetch`. */
  readonly fetch = (async (input: string | URL | Request, init?: RequestInit) =>
    this.http(String(input), init ?? {})) as unknown as typeof fetch

  grant(token: string, grant: FakeGrant): string {
    this.tokens.set(token, grant)
    return token
  }

  get latest(): StoredSnapshot | null {
    return this.snapshots[this.snapshots.length - 1] ?? null
  }

  /** Sockets that completed `hello`. */
  get peers(): FakeSocket[] {
    return [...this.live].filter((s) => s.helloed)
  }

  /** Every `append` the relay received (accepted or not). */
  appends(): ClientMessage[] {
    return this.allSockets.flatMap((s) => s.sent.filter((m) => m.type === "append"))
  }

  /** Drops covered entries (retention elapsed): `base` moves to the latest snapshot. */
  prune(): void {
    const upTo = this.latest?.upTo ?? 0
    while (this.log.length > 0 && (this.log[0] as LogEntry).seq <= upTo) this.log.shift()
    this.base = Math.max(this.base, upTo)
  }

  /** Simulates a relay that lost its data (restored from an old backup): empties everything. */
  wipe(): void {
    this.log.length = 0
    this.snapshots.length = 0
    this.head = 0
    this.base = 0
  }

  /** Closes every live socket with `code`. */
  closeAll(code = 1012, reason = ""): void {
    for (const s of [...this.live]) s.serverClose(code, reason)
  }

  /** Sends `compact {upTo: head}` to `peer` (default: the lowest caught-up edit peer). */
  requestCompaction(peer?: number): FakeSocket | null {
    const target =
      peer === undefined
        ? (this.peers
            .filter((s) => s.role === "edit" && s.caughtUp)
            .sort((a, b) => a.peer - b.peer)[0] ?? null)
        : (this.peers.find((s) => s.peer === peer) ?? null)
    if (!target) return null
    target.deliver({ type: "compact", upTo: this.head })
    return target
  }

  // --- WebSocket side -----------------------------------------------------------------------

  /** @internal */
  connect(socket: FakeSocket, protocols?: string | string[]): void {
    this.allSockets.push(socket)
    const list = typeof protocols === "string" ? [protocols] : (protocols ?? [])
    queueMicrotask(() => {
      if (socket.readyState === FakeSocket.CLOSED) return
      if (
        this.refuse ||
        !list.includes(SUBPROTOCOL) ||
        !socket.url.endsWith(`/sync/${this.room}`)
      ) {
        socket.readyState = FakeSocket.CLOSED
        socket.onclose?.({ code: 1006, reason: "" })
        return
      }
      socket.readyState = FakeSocket.OPEN
      socket.protocol = SUBPROTOCOL
      this.live.add(socket)
      socket.onopen?.({})
    })
  }

  /** @internal */
  disconnected(socket: FakeSocket): void {
    if (!this.live.delete(socket)) return
    this.awarenessCache.delete(socket.peer)
    if (socket.helloed)
      for (const other of this.peers) other.deliver({ type: "peer-left", peer: socket.peer })
  }

  /** @internal */
  receive(socket: FakeSocket, message: ClientMessage): void {
    if (!this.live.has(socket)) return
    if (!socket.helloed && message.type !== "hello") {
      socket.serverClose(4400, "BAD_MESSAGE")
      return
    }
    switch (message.type) {
      case "hello":
        this.hello(socket, message.token, message.since)
        return
      case "append":
        this.append(socket, message.cid, message.env)
        return
      case "awareness": {
        if (message.clock <= socket.awarenessClock) return
        socket.awarenessClock = message.clock
        if (message.env.length === 0) this.awarenessCache.delete(socket.peer)
        else this.awarenessCache.set(socket.peer, { clock: message.clock, env: message.env })
        for (const other of this.peers)
          if (other !== socket)
            other.deliver({
              type: "awareness",
              peer: socket.peer,
              clock: message.clock,
              env: message.env,
            })
        return
      }
      case "caught-up":
        socket.caughtUp = true
        return
      case "refresh": {
        const grant = this.tokens.get(message.token)
        if (!grant || grant.refuse || grant.role !== socket.role) {
          socket.deliver({ type: "denied", code: "BAD_MESSAGE", cid: 0, message: "refresh" })
          return
        }
        socket.token = message.token
        socket.deliver({ type: "token", exp: grant.exp ?? 0 })
        return
      }
      case "ping":
        socket.deliver({ type: "pong", n: message.n })
        return
    }
  }

  private hello(socket: FakeSocket, token: string, sinceIn: number): void {
    const grant = this.tokens.get(token)
    const refuse: MpErrorCode | null = !grant
      ? "AUTH_INVALID"
      : grant.refuse
        ? grant.refuse
        : grant.role === "comment"
          ? "ROLE_UNSUPPORTED"
          : null
    if (refuse || !grant || grant.role === "comment") {
      socket.serverClose(MP_ERRORS[refuse ?? "AUTH_INVALID"].close ?? 4401, refuse ?? "")
      return
    }
    socket.helloed = true
    socket.token = token
    socket.peer = this.nextPeer++
    socket.role = grant.role
    socket.origin = grant.origin ?? "user"
    const since = sinceIn > this.head ? 0 : sinceIn
    const snap = this.latest
    const needSnapshot = snap !== null && (since === 0 || since < this.base)
    const from = needSnapshot && snap ? snap.upTo + 1 : since + 1
    const others: PeerInfo[] = this.peers
      .filter((s) => s !== socket)
      .map((s) => ({ peer: s.peer, role: s.role, origin: s.origin }))
    socket.deliver({
      type: "welcome",
      peer: socket.peer,
      role: socket.role,
      origin: socket.origin,
      exp: grant.exp ?? 0,
      kid: 1,
      head: this.head,
      base: this.base,
      from,
      needSnapshot,
      snapshot: snap ? { upTo: snap.upTo, gen: snap.gen, bytes: snap.env.length } : null,
      limits: this.limits,
      peers: others,
    })
    const tail = this.log.filter((e) => e.seq >= from)
    for (let i = 0; i < tail.length; i += 512)
      socket.deliver({ type: "entries", entries: tail.slice(i, i + 512) })
    for (const [peer, cached] of this.awarenessCache)
      if (peer !== socket.peer)
        socket.deliver({ type: "awareness", peer, clock: cached.clock, env: cached.env })
    for (const other of others) {
      const s = this.peers.find((p) => p.peer === other.peer)
      s?.deliver({
        type: "peer-joined",
        peer: { peer: socket.peer, role: socket.role, origin: socket.origin },
      })
    }
  }

  private append(socket: FakeSocket, cid: number, env: Uint8Array): void {
    if (socket.role !== "edit") {
      socket.deliver({ type: "denied", code: "VIEW_ONLY", cid, message: "view-only link" })
      return
    }
    if (env.length > this.limits.maxEntryBytes) {
      socket.deliver({ type: "denied", code: "TOO_LARGE", cid, message: "entry too large" })
      return
    }
    if (this.denyAppends) {
      socket.deliver({ type: "denied", code: this.denyAppends, cid, message: "refused" })
      return
    }
    const entry: LogEntry = { seq: ++this.head, origin: socket.origin, env }
    this.log.push(entry)
    if (!this.holdAcks) socket.deliver({ type: "ack", cid, seq: entry.seq })
    for (const other of this.peers)
      if (other !== socket) other.deliver({ type: "entries", entries: [entry] })
  }

  // --- HTTP side ----------------------------------------------------------------------------

  private async http(url: string, init: RequestInit): Promise<Response> {
    const { pathname, searchParams } = new URL(url)
    const method = init.method ?? "GET"
    const auth = new Headers(init.headers).get("authorization") ?? ""
    const grant = this.tokens.get(auth.replace(/^Bearer /, ""))
    if (!grant || grant.refuse) return fail(grant?.refuse ?? "AUTH_INVALID")
    if (pathname !== `/room/${this.room}/snapshot`) return fail("NOT_FOUND")
    if (method === "GET") {
      if (this.snapshotGate) await this.snapshotGate
      this.snapshotGets++
      const snap = this.latest
      if (!snap) return fail("NOT_FOUND")
      return new Response(snap.env.slice(), {
        status: 200,
        headers: { "kimo-up-to": String(snap.upTo), "kimo-gen": String(snap.gen) },
      })
    }
    if (method !== "PUT") return fail("BAD_REQUEST")
    if (grant.role !== "edit") return fail("VIEW_ONLY")
    const upTo = Number(searchParams.get("upTo"))
    const carries = searchParams.get("carries") === "1"
    const mergedText = searchParams.get("merged")
    const merged = mergedText === null ? null : Number(mergedText)
    const env = new Uint8Array(await new Response(init.body).arrayBuffer())
    if (env.length > this.limits.maxSnapshotBytes) return fail("TOO_LARGE")
    if (this.staleSnapshots > 0) {
      this.staleSnapshots--
      this.snapshotAttempts.push({ upTo, carries, status: 409 })
      return fail("SNAPSHOT_STALE")
    }
    return this.putSnapshot(upTo, carries, env, merged)
  }

  /** Snapshot acceptance; also used by tests to seed a room. */
  putSnapshot(
    upTo: number,
    carries: boolean,
    env: Uint8Array,
    merged: number | null = null,
  ): Response {
    const response = this.acceptSnapshot(upTo, carries, env, merged)
    this.snapshotAttempts.push({ upTo, carries, status: response.status })
    return response
  }

  private acceptSnapshot(
    upTo: number,
    carries: boolean,
    env: Uint8Array,
    merged: number | null,
  ): Response {
    const cur = this.latest
    if (upTo > this.head) return fail("SNAPSHOT_AHEAD")
    // A retained carries generation newer than what the uploader merged would be lost.
    if (merged !== null && this.snapshots.some((s) => s.carries && s.gen > merged))
      return fail("SNAPSHOT_STALE", "unmerged carries snapshot")
    if (cur && !(upTo > cur.upTo || (upTo === cur.upTo && carries))) return fail("SNAPSHOT_STALE")
    const gen = (cur?.gen ?? 0) + 1
    this.snapshots.push({ upTo, gen, carries, env })
    while (this.snapshots.length > 2) this.snapshots.shift()
    this.snapshotPuts.push({ upTo, carries })
    for (const s of this.peers)
      s.deliver({
        type: "snapshot",
        info: { upTo, gen, bytes: env.length },
        carriesNew: carries,
      })
    return json(201, { gen, upTo })
  }
}

// --- Test helpers -----------------------------------------------------------------------------

/** A fresh room id and room key. */
export function makeRoom(): { room: string; roomKey: Uint8Array } {
  return { room: roomIdFromRaw(randomBytes(20)).id, roomKey: generateRoomKey() }
}

/** A `YjsDocStore` with the runtime auto-repair switch (`autoRepair` / `setAutoRepair`). */
export class SwitchableStore extends YjsDocStore {
  constructor(options: DocStoreOptions = {}) {
    super(options)
  }
}

/** Fast timings for tests. */
export const FAST = {
  pingIntervalMs: 50,
  idleTimeoutMs: 200,
  compactWaitMs: 300,
  cursorSaveMs: 5,
  stableMs: 50,
}

/** A provider wired to `relay`. */
export function providerFor(
  relay: FakeRelay,
  roomKey: Uint8Array,
  token: string,
  options: Partial<NetworkProviderOptions> = {},
): RelayNetworkProvider {
  return createNetworkProvider({
    relayUrl: relay.relayUrl,
    room: relay.room,
    token,
    roomKey,
    WebSocket: relay.WebSocket,
    fetch: relay.fetch,
    backoff: [5, 40],
    random: () => 0.5,
    timing: FAST,
    connectTimeoutMs: 500,
    ...options,
  }) as RelayNetworkProvider
}

/** Polls `predicate` until it holds; throws after `timeoutMs`. */
export async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2_000,
  what = "condition",
): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 2))
  }
}

/** `r` if it succeeded, else throws with its errors. */
export const ok = <T extends { ok: boolean }>(r: T) => {
  if (!r.ok) throw new Error(JSON.stringify(r))
  return r
}

/**
 * A relay with `edit`, `agent` (origin `agent:bot`) and `view` tokens, seeded with `seed`'s state
 * as the genesis snapshot.
 */
export async function seededRoom(seed: YjsDocStore = emptyStore()) {
  const { room, roomKey } = makeRoom()
  const relay = new FakeRelay(room)
  relay.grant("edit", { role: "edit" })
  relay.grant("agent", { role: "edit", origin: "agent:bot" })
  relay.grant("view", { role: "view" })
  const keys = await deriveRoomKeys(roomKey, parseRoomId(room))
  relay.putSnapshot(0, false, await sealSnapshot(keys, 0, seed.encodeStateAsUpdate()))
  return { relay, roomKey, seed, keys }
}
