/**
 * The `kimo-mp/1` network provider (docs/spec/multiplayer.md §15): connects a {@link DocStore}
 * to one room of a blind relay. Everything that leaves the client is sealed with the room's
 * keys; the relay orders the encrypted log, fans it out and stores client-made snapshots.
 *
 * One {@link Connection} per WebSocket attempt holds the per-connection state; every handler
 * checks that its connection is still the current one after each `await`, so a late frame or
 * crypto result from a closed socket never touches the store.
 */
import type { DocStore, Origin, RemoteOrigin } from "@kimo/editor-state"
import { KimoAwareness } from "./awareness"
import {
  asBytes,
  type ClientMessage,
  DEFAULT_LIMITS,
  decodeRelayMessage,
  deriveRoomKeys,
  encodeClientMessage,
  equalBytes,
  errorFromClose,
  type FetchedSnapshot,
  isRetryable,
  type LogEntry,
  MAX_BODY_LIMIT_BYTES,
  type MpErrorCode,
  MultiplayerError,
  normalizeRelayUrl,
  openSnapshot,
  openUpdate,
  type PeerInfo,
  PROTOCOL_VERSION,
  parseRoomId,
  RelayHttpClient,
  type RelayLimits,
  type RelayMessage,
  type Role,
  type RoomKeys,
  type SnapshotInfo,
  SUBPROTOCOL,
  sealSnapshot,
  sealUpdate,
  syncUrlFor,
} from "./mp/index"
import type {
  NetworkEnvironment,
  NetworkEvent,
  NetworkProvider,
  NetworkProviderOptions,
  NetworkTiming,
} from "./network"
import { BaseProvider } from "./provider"
import { MemoryRoomStateStore, type RoomStateStore } from "./room-state"

/**
 * Size of an empty Yjs v1 update. The only Yjs-specific constant in the provider (§15.5);
 * revisit for Loro.
 */
const EMPTY_UPDATE_BYTES = 2
/** `DocStore.readOnly` reason set for `view` links. */
export const VIEW_ONLY_REASON = "multiplayer: view-only link"
/** `@kimo/sync` version, sent in `hello` (kept equal to package.json by a test). */
export const CLIENT_VERSION = "1.2.1-beta.0"
/** Client-side close code (liveness, protocol errors, resync). */
const CLIENT_CLOSE = 4000
const WS_OPEN = 1
/** Tries of a `carries=1` snapshot that lost a race with another snapshot. */
const OVERSIZE_TRIES = 3
/** The longest an oversize fallback waits for pending appends before the connection resyncs. */
const OVERSIZE_WAIT_MS = 30_000

const DEFAULT_TIMING: NetworkTiming = {
  pingIntervalMs: 20_000,
  idleTimeoutMs: 45_000,
  compactWaitMs: 30_000,
  cursorSaveMs: 1_000,
  stableMs: 10_000,
}

/** Codes after which a new token may succeed where the old one failed. */
const AUTH_CODES: ReadonlySet<MpErrorCode> = new Set([
  "AUTH_INVALID",
  "KEY_ROTATED",
  "TOKEN_REVOKED",
  "TOKEN_EXPIRED",
  "ROLE_UNSUPPORTED",
])

/** The runtime switch of §15.8, when the store has it. */
interface AutoRepairSwitch {
  readonly autoRepair: boolean
  setAutoRepair(enabled: boolean): void
}

function repairSwitch(store: DocStore): AutoRepairSwitch | null {
  const s = store as DocStore & Partial<AutoRepairSwitch>
  return typeof s.setAutoRepair === "function" && typeof s.autoRepair === "boolean"
    ? (s as DocStore & AutoRepairSwitch)
    : null
}

function asMpError(error: unknown): MultiplayerError {
  if (error instanceof MultiplayerError) return error
  const message = error instanceof Error ? error.message : String(error)
  return new MultiplayerError("INTERNAL", message, { cause: error })
}

function frameBytes(data: unknown): Uint8Array | null {
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  return null
}

/** One WebSocket attempt. */
class Connection {
  /** Socket open (hello sent). */
  opened = false
  welcomed = false
  caughtUp = false
  /** `welcome.head`: catch-up completes once `since` reaches it. */
  head = 0
  nextCid = 0
  /** Appends sent and not yet acknowledged. */
  readonly pending = new Set<number>()
  /** Tokens sent in `refresh` and not yet acknowledged by a `token` frame, oldest first. */
  readonly refreshing: string[] = []
  /** `welcome` showed an empty room (no entries, no snapshot): nothing to prove the key against. */
  emptyRoom = false
  /** Serial queue of incoming frames (decryption is async; order is preserved). */
  frames: Promise<void> = Promise.resolve()
  lastReceived = 0
  lastPing = 0
  pingCount = 0
  connectTimer: ReturnType<typeof setTimeout> | null = null
  liveness: ReturnType<typeof setInterval> | null = null

  constructor(
    readonly ws: WebSocket,
    /** The token this connection presents: the one in `hello`, then each accepted `refresh`. */
    public token: string,
  ) {}

  dispose(): void {
    if (this.connectTimer) clearTimeout(this.connectTimer)
    if (this.liveness) clearInterval(this.liveness)
    this.connectTimer = null
    this.liveness = null
    this.ws.onopen = null
    this.ws.onmessage = null
    this.ws.onclose = null
    this.ws.onerror = null
  }
}

/** {@link NetworkProvider} over a `kimo-mp/1` relay. Create with `createNetworkProvider`. */
export class RelayNetworkProvider extends BaseProvider implements NetworkProvider {
  readonly relayUrl: string
  readonly room: string
  readonly awareness: KimoAwareness
  /** Origin of every update this provider applies (never sent back: no echo). */
  readonly remoteOrigin: RemoteOrigin

  private token: string
  private readonly roomKey: Uint8Array
  private readonly stateStore: RoomStateStore
  private readonly WS: NonNullable<NetworkProviderOptions["WebSocket"]>
  private readonly http: RelayHttpClient
  private readonly backoff: [number, number]
  private readonly clientInfo: string
  private readonly connectTimeoutMs: number
  private readonly environment: NetworkEnvironment | undefined
  private readonly random: () => number
  private readonly now: () => number
  private readonly timing: NetworkTiming

  private keys: RoomKeys | null = null
  private conn: Connection | null = null
  /** Highest contiguous `seq` applied by this provider instance (§15.1). */
  private since = 0
  private _role: Role | null = null
  private _peer: number | null = null
  private _exp: number | null = null
  private limits: RelayLimits = DEFAULT_LIMITS
  private readonly peerTable = new Map<number, PeerInfo>()
  private _repairer: number | null = null
  private repairActive = false
  private snapshotGen = 0
  /**
   * Generation of a `carries` snapshot noticed and not merged yet. While set, this replica's state
   * lacks content the room holds: it must not compact, and it declares only the generations
   * before it as merged.
   */
  private pendingCarries: number | null = null

  private ackedSv: Uint8Array | null = null
  /** Local updates dropped while not caught up (the reconnect delta covers them). */
  private dirty = false
  /** Updates and tasks in the send queue. */
  private queued = 0
  /** Snapshot uploads in flight (status `saving`). */
  private uploads = 0
  private sendChain: Promise<void> = Promise.resolve()
  /** The store held nothing when attached and nothing foreign arrived since (§15.5). */
  private pristine = false
  private firstCatchUp = true
  /** An envelope of the room opened with this client's key (a snapshot, or a log entry). */
  private goodEntry = false
  /** An append was refused (not oversize): `ackedSv` stays put so the next reconnect delta resends it. */
  private refused: MultiplayerError | null = null
  /** A snapshot of the room did not open: upload this replica's state to supersede it once caught up. */
  private supersede = false

  private attempt = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private stableTimer: ReturnType<typeof setTimeout> | null = null
  private fatal: MultiplayerError | null = null
  /** `disconnect()` or `detach()` was called: no reconnects. */
  private stopped = false
  private offOnline: (() => void) | null = null
  private offUpdate: (() => void) | null = null
  private readOnlySet = false
  /** Reason another owner put on the store while this provider locks it for a `view` link. */
  private foreignReadOnly: string | null = null
  private unguardReadOnly: (() => void) | null = null
  private savedAutoRepair: boolean | null = null
  private cursorTimer: ReturnType<typeof setTimeout> | null = null
  private cursorDirty = false
  private attachWaiter: { resolve(): void; reject(error: unknown): void } | null = null
  private readonly waiters = new Set<() => void>()
  private readonly eventListeners = new Set<(event: NetworkEvent) => void>()

  constructor(options: NetworkProviderOptions) {
    super(`mp:${options.room}`)
    this.relayUrl = normalizeRelayUrl(options.relayUrl)
    this.room = options.room
    this.remoteOrigin = `remote:mp:${options.room}`
    this.token = options.token
    this.roomKey = options.roomKey
    this.stateStore = options.state ?? new MemoryRoomStateStore()
    const WS = options.WebSocket ?? globalThis.WebSocket
    if (!WS) throw new Error("No WebSocket implementation available")
    this.WS = WS
    this.http = new RelayHttpClient({
      relayUrl: this.relayUrl,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    })
    this.backoff = options.backoff ?? [250, 10_000]
    this.clientInfo = options.clientInfo ?? `kimo/${CLIENT_VERSION}`
    this.connectTimeoutMs = options.connectTimeoutMs ?? 15_000
    this.environment = options.environment
    this.random = options.random ?? Math.random
    this.now = options.now ?? Date.now
    this.timing = { ...DEFAULT_TIMING, ...options.timing }
    this.awareness = new KimoAwareness({
      keys: () => this.keys,
      canSend: () => this.conn?.caughtUp === true,
      send: (peer, clock, env) => {
        const conn = this.conn
        if (conn?.caughtUp && this._peer === peer)
          this.send(conn, { type: "awareness", clock, env })
      },
      originOf: (peer) => this.peerTable.get(peer)?.origin,
      hz: () => this.limits.awarenessHz,
      now: () => this.now(),
    })
  }

  // --- Public state -------------------------------------------------------------------------

  get connected(): boolean {
    return this.conn?.caughtUp === true
  }

  get role(): Role | null {
    return this._role
  }

  get peer(): number | null {
    return this._peer
  }

  get peers(): ReadonlyMap<number, PeerInfo> {
    return new Map(this.peerTable)
  }

  get repairer(): number | null {
    return this._repairer
  }

  get exp(): number | null {
    return this._exp
  }

  onEvent(listener: (event: NetworkEvent) => void): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  // --- Lifecycle ----------------------------------------------------------------------------

  /**
   * Attaches and connects. Resolves after the first catch-up, or when the first attempt fails
   * with a retryable error (the editor keeps working offline while the provider retries).
   * Rejects on a fatal error before the first catch-up.
   */
  async attach(store: DocStore): Promise<void> {
    this.assertDetached()
    this._store = store
    this.stopped = false
    this.fatal = null
    this.attempt = 0
    this.since = 0
    this.snapshotGen = 0
    this.pendingCarries = null
    this.dirty = false
    this.firstCatchUp = true
    this.goodEntry = false
    this.refused = null
    this.supersede = false
    this.pristine = store.size === 0
    this.savedAutoRepair = repairSwitch(store)?.autoRepair ?? null
    this.offUpdate = store.onUpdate((update, origin) => this.onLocalUpdate(update, origin))
    this.setStatus("connecting")
    const ready = new Promise<void>((resolve, reject) => {
      this.attachWaiter = { resolve, reject }
    })
    try {
      this.keys ??= await deriveRoomKeys(this.roomKey, parseRoomId(this.room))
      const cursor = await this.stateStore.load(this.room)
      this.ackedSv = cursor?.ackedSv ?? null
    } catch (error) {
      if (this._store === store) await this.detach()
      throw error
    }
    if (this._store !== store || this.stopped) return ready
    this.applyAutoRepair()
    if (this.environment) this.offOnline = this.environment.onOnline(() => this.onOnline())
    this.open()
    return ready
  }

  /** Withdraws presence, closes the socket, saves the cursor and restores the store's flags. */
  async detach(): Promise<void> {
    const store = this._store
    if (!store) return
    this.stopped = true
    this.clearRetry()
    this.offOnline?.()
    this.offOnline = null
    const conn = this.conn
    if (conn) {
      this.awareness.withdraw()
      this.closeSocket(conn, 1000, "detach")
      this.closed(conn, null)
    }
    this.offUpdate?.()
    this.offUpdate = null
    await this.flushCursor()
    this.releaseView(store)
    const sw = repairSwitch(store)
    if (sw && this.savedAutoRepair !== null && sw.autoRepair !== this.savedAutoRepair)
      sw.setAutoRepair(this.savedAutoRepair)
    this.savedAutoRepair = null
    this.repairActive = false
    this.awareness.reset()
    this._role = null
    this._peer = null
    this._exp = null
    this.setRepairer(null)
    this._store = null
    this.settleAttach(null)
    this.setStatus("detached")
  }

  connect(): void {
    this.stopped = false
    this.fatal = null
    this.attempt = 0
    if (!this._store || this.conn) return
    this.clearRetry()
    this.open()
  }

  disconnect(): void {
    this.stopped = true
    this.clearRetry()
    const conn = this.conn
    if (conn) {
      this.awareness.withdraw()
      this.closeSocket(conn, 1000, "disconnect")
      this.closed(conn, null)
    }
    this.settleAttach(null)
    if (this._store) this.setStatus("error")
  }

  setToken(token: string): void {
    this.token = token
    const conn = this.conn
    if (conn?.welcomed) {
      this.refreshToken(conn)
      return
    }
    if (!conn && this.fatal && this._store && !this.stopped) {
      this.fatal = null
      this.attempt = 0
      this.clearRetry()
      this.open()
    }
  }

  /** Presents `this.token` on a welcomed connection that still holds an older one. */
  private refreshToken(conn: Connection): void {
    conn.refreshing.push(this.token)
    this.send(conn, { type: "refresh", token: this.token })
  }

  // --- Connection -------------------------------------------------------------------------

  private open(): void {
    if (!this._store || this.stopped || this.fatal || this.conn) return
    this.clearRetry()
    if (this.environment && !this.environment.online()) {
      this.afterClose(new MultiplayerError("RELAY_UNREACHABLE", "offline"), null)
      return
    }
    this.setStatus("connecting")
    let ws: WebSocket
    try {
      ws = new this.WS(syncUrlFor(this.relayUrl, this.room), SUBPROTOCOL)
    } catch (error) {
      this.afterClose(
        new MultiplayerError("RELAY_UNREACHABLE", "could not open a WebSocket", { cause: error }),
        null,
      )
      return
    }
    const conn = new Connection(ws, this.token)
    this.conn = conn
    ws.binaryType = "arraybuffer"
    conn.connectTimer = setTimeout(
      () => this.drop(conn, new MultiplayerError("RELAY_UNREACHABLE", "connect timed out")),
      this.connectTimeoutMs,
    )
    ws.onopen = () => {
      if (this.conn !== conn) return
      conn.opened = true
      conn.lastReceived = conn.lastPing = this.now()
      this.send(conn, {
        type: "hello",
        proto: PROTOCOL_VERSION,
        token: conn.token,
        since: this.since,
        client: this.clientInfo,
      })
      const { pingIntervalMs, idleTimeoutMs } = this.timing
      conn.liveness = setInterval(
        () => this.checkLiveness(conn),
        Math.max(1, Math.min(pingIntervalMs, idleTimeoutMs) / 4),
      )
      this.applyAutoRepair()
    }
    ws.onmessage = (event: MessageEvent) => {
      if (this.conn !== conn) return
      conn.lastReceived = this.now()
      const bytes = frameBytes(event.data)
      if (!bytes) return // Relays only send binary frames; ignore anything else.
      conn.frames = conn.frames
        .then(() => this.handleFrame(conn, bytes))
        .catch((error) => this.drop(conn, asMpError(error)))
    }
    ws.onclose = (event: CloseEvent) => {
      if (this.conn === conn) this.closed(conn, errorFromClose(event.code, event.reason))
    }
    ws.onerror = () => {
      // A close event follows.
    }
  }

  private checkLiveness(conn: Connection): void {
    if (this.conn !== conn) return
    const now = this.now()
    if (now - conn.lastReceived >= this.timing.idleTimeoutMs) {
      this.drop(conn, errorFromClose(CLIENT_CLOSE, "no frame from the relay"))
      return
    }
    if (now - conn.lastPing >= this.timing.pingIntervalMs) {
      conn.lastPing = now
      this.send(conn, { type: "ping", n: ++conn.pingCount })
    }
  }

  private send(conn: Connection, message: ClientMessage): void {
    if (this.conn !== conn || conn.ws.readyState !== WS_OPEN) return
    try {
      conn.ws.send(asBytes(encodeClientMessage(message)))
    } catch {
      // The close event reports the failure.
    }
  }

  private closeSocket(conn: Connection, code: number, reason: string): void {
    try {
      conn.ws.close(code, reason)
    } catch {
      // Already closed.
    }
  }

  /** Closes `conn` from the client side and handles it like a relay close with `error`. */
  private drop(conn: Connection, error: MultiplayerError | null): void {
    if (this.conn !== conn) return
    this.closeSocket(conn, error ? CLIENT_CLOSE : 1000, error?.code ?? "resync")
    this.closed(conn, error)
  }

  /** `conn` is gone: resets per-connection state, then retries or stops (`afterClose`). */
  private closed(conn: Connection, error: MultiplayerError | null): void {
    if (this.conn !== conn) return
    this.conn = null
    this.pendingCarries = null
    conn.dispose()
    if (this.stableTimer) clearTimeout(this.stableTimer)
    this.stableTimer = null
    this.awareness.clearRemote()
    if (this.peerTable.size > 0) {
      this.peerTable.clear()
      this.emit({ type: "peers", peers: new Map() })
    }
    this.elect()
    this.applyAutoRepair()
    this.notify()
    this.afterClose(error, conn)
  }

  private afterClose(error: MultiplayerError | null, conn: Connection | null): void {
    if (!this._store || this.stopped) {
      this.emit({ type: "closed", error, willRetry: false })
      return
    }
    // A clean client close (resync) reconnects at once.
    if (!error) {
      this.emit({ type: "closed", error: null, willRetry: true, retryInMs: 0 })
      this.setStatus("connecting")
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null
        this.open()
      }, 0)
      return
    }
    // A token swapped in while this attempt was handshaking gets its own try.
    const tokenChanged = conn !== null && conn.token !== this.token && AUTH_CODES.has(error.code)
    if (!isRetryable(error) && !tokenChanged) {
      this.fatal = error
      this.emit({ type: "closed", error, willRetry: false })
      this.setStatus("error", error)
      this.settleAttach(error)
      return
    }
    const waitOnline = this.environment !== undefined && !this.environment.online()
    const delay = tokenChanged ? 0 : this.nextDelay(error)
    this.emit({
      type: "closed",
      error,
      willRetry: true,
      ...(waitOnline ? {} : { retryInMs: delay }),
    })
    this.setStatus("error", error)
    this.settleAttach(null)
    if (waitOnline) return
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.open()
    }, delay)
  }

  /** Full-jitter exponential back-off (§15.10), never shorter than the relay's `retry-after`. */
  private nextDelay(error: MultiplayerError): number {
    const [min, max] = this.backoff
    const delay = this.random() * Math.min(max, min * 2 ** this.attempt)
    this.attempt++
    return Math.max(delay, error.retryAfterMs ?? 0)
  }

  private onOnline(): void {
    if (this.conn || !this._store || this.stopped || this.fatal) return
    this.clearRetry()
    this.open()
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
  }

  private settleAttach(error: MultiplayerError | null): void {
    const waiter = this.attachWaiter
    if (!waiter) return
    this.attachWaiter = null
    if (error) waiter.reject(error)
    else waiter.resolve()
  }

  // --- Incoming frames --------------------------------------------------------------------

  private async handleFrame(conn: Connection, bytes: Uint8Array): Promise<void> {
    if (this.conn !== conn) return
    const message = decodeRelayMessage(bytes)
    if (!message) return // Unknown type from a newer relay.
    if (!conn.welcomed && message.type !== "welcome") return
    switch (message.type) {
      case "welcome":
        return this.onWelcome(conn, message)
      case "entries":
        return this.onEntries(conn, message.entries)
      case "ack":
        return this.onAck(conn, message.cid, message.seq)
      case "awareness":
        return this.awareness.receive(message.peer, message.env)
      case "peer-joined":
        this.peerTable.set(message.peer.peer, message.peer)
        this.peersChanged()
        return
      case "peer-left":
        this.awareness.removePeer(message.peer)
        if (this.peerTable.delete(message.peer)) this.peersChanged()
        return
      case "snapshot":
        return this.onSnapshotNotice(conn, message.info, message.carriesNew)
      case "compact":
        void this.compact(conn, message.upTo)
        return
      case "denied":
        return this.onDenied(conn, message.code, message.cid, message.message)
      case "token":
        this._exp = message.exp
        // HTTP calls on this connection present the accepted token from now on.
        conn.token = conn.refreshing.shift() ?? conn.token
        return
      case "pong":
        return
    }
  }

  private async onWelcome(
    conn: Connection,
    message: Extract<RelayMessage, { type: "welcome" }>,
  ): Promise<void> {
    if (conn.connectTimer) clearTimeout(conn.connectTimer)
    conn.connectTimer = null
    conn.welcomed = true
    conn.head = message.head
    this._peer = message.peer
    this._role = message.role
    this._exp = message.exp
    this.limits = {
      ...message.limits,
      maxSnapshotBytes: Math.min(message.limits.maxSnapshotBytes, MAX_BODY_LIMIT_BYTES),
    }
    // Uploads and downloads share one bound: a snapshot the relay takes is one a joiner can fetch.
    this.http.setLimits(this.limits)
    conn.emptyRoom = message.head === 0 && message.snapshot === null && !message.needSnapshot
    this.pendingCarries = null
    this.peerTable.clear()
    for (const p of message.peers) this.peerTable.set(p.peer, p)
    this.awareness.setSelf(message.peer, message.origin)
    this.emit({
      type: "welcome",
      peer: message.peer,
      role: message.role,
      exp: message.exp,
      limits: message.limits,
    })
    this.emit({ type: "peers", peers: new Map(this.peerTable) })
    if (message.head < this.since) {
      // The relay lost data we had seen: start over and push everything we hold (§15.4 step 6).
      this.since = 0
      this.ackedSv = null
      // A restored relay restarts its generations, and what we hold may be beyond its log.
      this.snapshotGen = 0
      this.pristine = false
      this.cursorDirty = true
      await this.flushCursor()
      this.drop(conn, null)
      return
    }
    this.applyRole()
    this.elect()
    this.applyAutoRepair()
    // setToken() ran while this connection was handshaking: hello carried the older token.
    if (conn.token !== this.token) this.refreshToken(conn)
    // A newer generation may be a `carries` snapshot whose content is in no log entry (a missed
    // notice): merging is idempotent, so a plain snapshot only costs the download.
    if (message.needSnapshot || (message.snapshot && message.snapshot.gen > this.snapshotGen)) {
      const fetched = await this.http.getSnapshot(this.room, conn.token)
      if (this.conn !== conn) return
      if (fetched) await this.applySnapshot(conn, fetched)
    }
    this.maybeCaughtUp(conn)
  }

  private async applySnapshot(conn: Connection, snapshot: FetchedSnapshot): Promise<void> {
    const keys = this.keys as RoomKeys
    let state: Uint8Array
    try {
      state = await openSnapshot(keys, snapshot.upTo, snapshot.envelope)
    } catch (error) {
      // Until one envelope of the room has opened, a failure means a wrong room key (§9).
      if (!this.goodEntry) throw asMpError(error)
      // Any edit-token holder can publish a snapshot the relay cannot vet: treat it like a corrupt
      // entry. What it covered is lost, so the log resumes after it and (edit role) this replica
      // uploads its own state to supersede it.
      if (this.conn !== conn) return
      this.since = Math.max(this.since, snapshot.upTo)
      this.snapshotGen = Math.max(this.snapshotGen, snapshot.gen)
      this.supersede = true
      this.emit({ type: "corrupt-snapshot", upTo: snapshot.upTo, gen: snapshot.gen })
      return
    }
    const store = this._store
    if (this.conn !== conn || !store) return
    this.goodEntry = true // It opened: this client holds the room's key.
    store.applyUpdate(state, this.remoteOrigin)
    this.since = Math.max(this.since, snapshot.upTo)
    this.snapshotGen = Math.max(this.snapshotGen, snapshot.gen)
    this.emit({ type: "snapshot-applied", upTo: snapshot.upTo, gen: snapshot.gen })
  }

  private async onEntries(conn: Connection, entries: readonly LogEntry[]): Promise<void> {
    const keys = this.keys as RoomKeys
    for (const entry of entries) {
      if (entry.seq <= this.since) continue
      if (entry.seq !== this.since + 1)
        throw new MultiplayerError(
          "INTERNAL",
          `gap in the room log: ${this.since} then ${entry.seq}`,
        )
      let update: Uint8Array | null = null
      try {
        update = await openUpdate(keys, entry.env)
      } catch (error) {
        // Until one envelope of the room has opened, a failure means a wrong room key (§9).
        if (!this.goodEntry) throw asMpError(error)
        this.skipEntry(entry.seq)
      }
      const store = this._store
      if (this.conn !== conn || !store) return
      if (update) {
        this.goodEntry = true
        try {
          store.applyUpdate(update, this.remoteOrigin)
        } catch {
          this.skipEntry(entry.seq)
        }
      }
      this.since = entry.seq
    }
    this.maybeCaughtUp(conn)
    this.maybeClean()
    this.notify()
  }

  /**
   * A log entry that does not open or apply contributes nothing trustworthy (the relay is blind
   * and cannot vet it): skip it and report it. The caller has already ruled out a wrong key.
   */
  private skipEntry(seq: number): void {
    this.emit({ type: "corrupt-entry", seq })
  }

  private onAck(conn: Connection, cid: number, seq: number): void {
    conn.pending.delete(cid)
    // An ack proves nothing about the key (in an empty room anyone may append): goodEntry is set
    // only when an envelope written by someone else opens.
    if (seq > this.since) {
      if (seq !== this.since + 1)
        throw new MultiplayerError("INTERNAL", `gap in the room log: ${this.since} then ${seq}`)
      this.since = seq
    }
    this.updateStatus()
    this.maybeClean()
    this.notify()
  }

  private async onSnapshotNotice(
    conn: Connection,
    info: SnapshotInfo,
    carriesNew: boolean,
  ): Promise<void> {
    if (!carriesNew || info.gen <= this.snapshotGen) {
      this.snapshotGen = Math.max(this.snapshotGen, info.gen)
      return
    }
    // A `carries=1` snapshot holds content that is not in the log: download and merge it. Until
    // then this replica neither compacts nor claims the generation as merged.
    this.pendingCarries = Math.min(this.pendingCarries ?? info.gen, info.gen)
    const fetched = await this.http.getSnapshot(this.room, conn.token)
    if (this.conn !== conn) return
    if (fetched && fetched.gen > this.snapshotGen) await this.applySnapshot(conn, fetched)
    if (this.conn !== conn) return
    this.pendingCarries = null
    this.maybeSupersede(conn)
    this.maybeClean()
    this.notify()
  }

  /** Uploads this replica's state over a snapshot that did not open, once caught up (edit role). */
  private maybeSupersede(conn: Connection): void {
    const store = this._store
    if (!this.supersede || this.conn !== conn || !conn.caughtUp || this._role !== "edit") return
    if (!store || store.size === 0) return
    this.supersede = false
    this.enqueue(conn, () => this.oversize(conn))
  }

  /**
   * The newest generation whose `carries` content this replica's state includes, sent with every
   * upload as `merged`. Its own uploads count once the relay accepted them (the relay refuses an
   * upload that declares less than a retained `carries` generation).
   */
  private mergedGen(): number {
    return this.pendingCarries === null ? this.snapshotGen : this.pendingCarries - 1
  }

  private onDenied(conn: Connection, code: MpErrorCode, cid: number, message: string): void {
    this.emit({ type: "denied", code, message })
    if (cid === 0 && conn.refreshing.length > 0) {
      // The relay answers each refresh in order, with `token` or `denied`: this one was refused.
      conn.refreshing.shift()
      if (conn.refreshing.length === 0) this.token = conn.token // Reconnects keep the accepted token.
      return
    }
    if (code === "VIEW_ONLY") {
      this._role = "view"
      conn.pending.clear()
      this.applyRole()
      this.elect()
      this.applyAutoRepair()
      this.updateStatus()
      this.notify()
      return
    }
    if (cid <= 0 || !conn.pending.delete(cid)) return
    if (code === "TOO_LARGE") {
      this.enqueue(conn, () => this.oversize(conn))
      return
    }
    // QUOTA_EXCEEDED, BAD_MESSAGE, ...: the relay refused this append. It no longer counts as in
    // flight, but ackedSv must not move past it so the next reconnect delta resends the content.
    this.refused = new MultiplayerError(code, message)
    this.updateStatus()
    this.notify()
  }

  private peersChanged(): void {
    this.emit({ type: "peers", peers: new Map(this.peerTable) })
    this.elect()
    this.applyAutoRepair()
  }

  private maybeCaughtUp(conn: Connection): void {
    if (conn.caughtUp || !conn.welcomed || this.since < conn.head || this.conn !== conn) return
    conn.caughtUp = true
    this.send(conn, { type: "caught-up", seq: this.since })
    this.emit({ type: "caught-up", since: this.since })
    if (this._role === "edit") this.pushDelta(conn)
    this.firstCatchUp = false
    this.pristine = false
    this.elect()
    this.applyAutoRepair()
    this.awareness.flush()
    this.updateStatus()
    this.maybeSupersede(conn)
    this.maybeClean()
    this.stableTimer = setTimeout(() => {
      this.stableTimer = null
      this.attempt = 0
    }, this.timing.stableMs)
    this.settleAttach(null)
  }

  // --- Outgoing updates -------------------------------------------------------------------

  private onLocalUpdate(update: Uint8Array, origin: Origin): void {
    if (origin === this.remoteOrigin) return
    this.pristine = false
    if (this._role === "view") {
      this.applyRole() // Another owner cleared the read-only flag: lock again.
      return
    }
    const conn = this.conn
    if (!conn?.caughtUp || !this.keyProven(conn)) {
      this.dirty = true
      return
    }
    this.enqueue(conn, () => this.sendUpdate(conn, update))
  }

  /** Nothing leaves this client before its key opened something of the room (or the room is empty). */
  private keyProven(conn: Connection): boolean {
    return this.goodEntry || conn.emptyRoom
  }

  /** The reconnect delta (§15.5): everything the relay has not acknowledged, as one append. */
  private pushDelta(conn: Connection): void {
    const store = this._store
    if (!store) return
    if (!this.keyProven(conn)) {
      this.dirty = true
      return
    }
    this.dirty = false
    this.refused = null
    if (this.pristine && this.firstCatchUp) {
      // A pristine store holds nothing the room lacks, whatever an older cursor says.
      this.ackedSv = store.encodeStateVector()
      this.scheduleCursorSave()
      return
    }
    const update = this.ackedSv
      ? store.encodeStateAsUpdate(this.ackedSv)
      : store.encodeStateAsUpdate()
    if (update.length > EMPTY_UPDATE_BYTES) this.enqueue(conn, () => this.sendUpdate(conn, update))
  }

  /** Runs `task` in the serial send queue (keeps appends in update order). */
  private enqueue(conn: Connection, task: () => Promise<void>): void {
    this.queued++
    this.updateStatus()
    this.sendChain = this.sendChain
      .then(() => (this.conn === conn ? task() : undefined))
      .catch((error) => this.drop(conn, asMpError(error)))
      .finally(() => {
        this.queued--
        this.updateStatus()
        this.maybeClean()
        this.notify()
      })
  }

  private async sendUpdate(conn: Connection, update: Uint8Array): Promise<void> {
    const env = await sealUpdate(this.keys as RoomKeys, update)
    if (this.conn !== conn) return
    if (env.length > this.limits.maxEntryBytes) return this.oversize(conn)
    const cid = ++conn.nextCid
    conn.pending.add(cid)
    this.send(conn, { type: "append", cid, env })
  }

  /**
   * The oversize fallback (§15.7): the whole state as a `carries=1` snapshot covering `since`,
   * once no append is pending. On success everything captured counts as acknowledged.
   */
  private async oversize(conn: Connection): Promise<void> {
    for (let tries = 1; ; tries++) {
      const idle = await this.waitUntil(
        () => this.conn !== conn || (conn.pending.size === 0 && this.pendingCarries === null),
        OVERSIZE_WAIT_MS,
      )
      // An ack that never comes must not hold the serial send queue forever: resync instead.
      if (!idle) throw new MultiplayerError("RELAY_UNREACHABLE", "appends were not acknowledged")
      const store = this._store
      if (this.conn !== conn || !store) return
      const upTo = this.since
      const merged = this.mergedGen()
      const sv = store.encodeStateVector()
      const state = store.encodeStateAsUpdate()
      const env = await sealSnapshot(this.keys as RoomKeys, upTo, state)
      if (env.length > this.limits.maxSnapshotBytes)
        throw new MultiplayerError("TOO_LARGE", "the document exceeds the relay's snapshot limit")
      this.uploads++
      try {
        const result = await this.http.putSnapshot(this.room, conn.token, upTo, env, {
          carries: true,
          merged,
        })
        this.snapshotGen = Math.max(this.snapshotGen, result.gen)
        this.ackedSv = sv
        this.scheduleCursorSave()
        return
      } catch (error) {
        // Another snapshot advanced past `since` meanwhile: wait for the log to catch up, retry.
        if (!(error instanceof MultiplayerError && error.code === "SNAPSHOT_STALE")) throw error
        // Snapshots keep landing past `since`: a retryable close reconnects and the delta (or this
        // fallback) runs again. SNAPSHOT_STALE itself is a benign race, never a fatal stop.
        if (tries >= OVERSIZE_TRIES)
          throw new MultiplayerError("RELAY_UNREACHABLE", "snapshot uploads kept racing", {
            cause: error,
          })
        await this.waitUntil(
          () => this.conn !== conn || this.since > upTo || this.mergedGen() > merged,
          1_000,
        )
      } finally {
        this.uploads--
      }
    }
  }

  /** A `compact {upTo}` request (§15.7): seal the state as a snapshot once clean. */
  private async compact(conn: Connection, upTo: number): Promise<void> {
    if (this._role !== "edit") return
    const clean = await this.waitUntil(
      () => this.conn !== conn || (this.since >= upTo && this.isClean(conn)),
      this.timing.compactWaitMs,
    )
    const store = this._store
    if (!clean || this.conn !== conn || !store || this._role !== "edit") return
    // An ack does not prove the key: in a room that started empty, wait for a foreign envelope.
    if (!this.goodEntry) return
    // One synchronous step: the state captured is exactly what `since` covers, and `merged` is
    // what it includes of the `carries` generations (one that lands before the PUT is refused).
    const at = this.since
    const merged = this.mergedGen()
    const state = store.encodeStateAsUpdate()
    this.uploads++
    this.updateStatus()
    try {
      const env = await sealSnapshot(this.keys as RoomKeys, at, state)
      if (env.length > this.limits.maxSnapshotBytes) return
      const result = await this.http.putSnapshot(this.room, conn.token, at, env, { merged })
      this.snapshotGen = Math.max(this.snapshotGen, result.gen)
      this.emit({ type: "compacted", upTo: result.upTo, gen: result.gen })
    } catch {
      // SNAPSHOT_STALE: someone else won. Anything else: the relay asks another peer.
    } finally {
      this.uploads--
      this.updateStatus()
    }
  }

  private isClean(conn: Connection): boolean {
    return (
      conn.caughtUp &&
      conn.pending.size === 0 &&
      this.queued === 0 &&
      !this.dirty &&
      this.pendingCarries === null
    )
  }

  /** Records `ackedSv` once everything local is acknowledged. */
  private maybeClean(): void {
    const conn = this.conn
    const store = this._store
    if (!conn || !store || this._role !== "edit" || !this.isClean(conn) || this.refused) return
    const sv = store.encodeStateVector()
    if (this.ackedSv && equalBytes(sv, this.ackedSv)) return
    this.ackedSv = sv
    this.scheduleCursorSave()
  }

  private scheduleCursorSave(): void {
    this.cursorDirty = true
    if (this.cursorTimer) return
    this.cursorTimer = setTimeout(() => {
      this.cursorTimer = null
      void this.saveCursor()
    }, this.timing.cursorSaveMs)
  }

  private async flushCursor(): Promise<void> {
    if (this.cursorTimer) clearTimeout(this.cursorTimer)
    this.cursorTimer = null
    await this.saveCursor()
  }

  private async saveCursor(): Promise<void> {
    if (!this.cursorDirty) return
    this.cursorDirty = false
    try {
      await this.stateStore.save(this.room, { ackedSv: this.ackedSv?.slice() ?? null })
    } catch {
      // Without a saved cursor the next session pushes a larger delta; nothing is lost.
    }
  }

  // --- Roles, repair, status --------------------------------------------------------------

  /** `view` makes the store read-only (§15.4 step 2); undone only if this provider set it. */
  private applyRole(): void {
    const store = this._store
    if (!store) return
    if (this._role === "view") {
      if (!store.readOnly) {
        store.setReadOnly(VIEW_ONLY_REASON)
        this.readOnlySet = true
      } else if (store.readOnly.reason === VIEW_ONLY_REASON) this.readOnlySet = true
      else this.foreignReadOnly = store.readOnly.reason
      this.guardReadOnly(store)
    } else this.releaseView(store)
  }

  /**
   * While `view`, another owner clearing its read-only flag locks the store again at once (an
   * edit must never reach a view replica's local state): `setReadOnly(null)` keeps this lock.
   */
  private guardReadOnly(store: DocStore): void {
    if (this.unguardReadOnly) return
    const own = Object.getOwnPropertyDescriptor(store, "setReadOnly")
    const original = store.setReadOnly.bind(store)
    store.setReadOnly = (reason: string | null) => {
      if (this._store !== store || this._role !== "view") return original(reason)
      if (reason === null || reason === VIEW_ONLY_REASON) {
        if (reason === null) this.foreignReadOnly = null
        this.readOnlySet = true
        return original(VIEW_ONLY_REASON)
      }
      this.foreignReadOnly = reason
      return original(reason)
    }
    this.unguardReadOnly = () => {
      if (own) Object.defineProperty(store, "setReadOnly", own)
      else delete (store as { setReadOnly?: unknown }).setReadOnly
      this.unguardReadOnly = null
    }
  }

  /** Leaves `view`: drops the guard and, if this provider's lock is on, restores the other owner's. */
  private releaseView(store: DocStore): void {
    this.unguardReadOnly?.()
    if (this.readOnlySet && store.readOnly?.reason === VIEW_ONLY_REASON)
      store.setReadOnly(this.foreignReadOnly)
    this.readOnlySet = false
    this.foreignReadOnly = null
  }

  /** Repairer = the lowest peer id among this client (if `edit`) and every `edit` peer. */
  private elect(): void {
    let next: number | null = null
    if (this.conn?.welcomed) {
      for (const p of this.peerTable.values())
        if (p.role === "edit" && (next === null || p.peer < next)) next = p.peer
      const self = this._peer
      if (this._role === "edit" && self !== null && (next === null || self < next)) next = self
    }
    this.setRepairer(next)
  }

  private setRepairer(next: number | null): void {
    if (next === this._repairer) return
    this._repairer = next
    this.emit({ type: "repairer", peer: next, self: next !== null && next === this._peer })
  }

  /** The §15.8 table. */
  private applyAutoRepair(): void {
    const store = this._store
    if (!store) return
    const conn = this.conn
    let enabled: boolean
    let active = false
    if (this._role === "view") enabled = false
    else if (!conn?.opened) enabled = true
    else if (!conn.caughtUp) enabled = false
    else enabled = active = this._repairer !== null && this._repairer === this._peer
    const sw = repairSwitch(store)
    if (sw && sw.autoRepair !== enabled) sw.setAutoRepair(enabled)
    const became = active && !this.repairActive
    this.repairActive = active
    if (became) store.repair()
  }

  private updateStatus(): void {
    const conn = this.conn
    if (!this._store || !conn?.caughtUp) return
    if (this._role === "view") this.setStatus("read-only")
    else if (this.refused) this.setStatus("error", this.refused)
    else if (conn.pending.size > 0 || this.queued > 0 || this.uploads > 0) this.setStatus("saving")
    else this.setStatus("synced")
  }

  // --- Plumbing -----------------------------------------------------------------------------

  /** Resolves true once `predicate` holds (checked on every state change), false on timeout. */
  private waitUntil(predicate: () => boolean, timeoutMs = Number.POSITIVE_INFINITY) {
    if (predicate()) return Promise.resolve(true)
    return new Promise<boolean>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null
      const check = () => {
        if (!predicate()) return
        this.waiters.delete(check)
        if (timer) clearTimeout(timer)
        resolve(true)
      }
      this.waiters.add(check)
      if (Number.isFinite(timeoutMs))
        timer = setTimeout(() => {
          this.waiters.delete(check)
          resolve(false)
        }, timeoutMs)
    })
  }

  private notify(): void {
    for (const check of [...this.waiters]) check()
  }

  private emit(event: NetworkEvent): void {
    for (const l of [...this.eventListeners]) l(event)
  }
}
