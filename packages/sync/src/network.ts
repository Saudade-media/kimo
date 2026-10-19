/**
 * Network provider: syncs a {@link DocStore} with a user-hosted `kimo-mp/1` relay, end-to-end
 * encrypted (docs/spec/multiplayer.md §11, §15; ADR 0016).
 *
 * Multiplayer needs nothing from the editor beyond what already exists: every edit is an
 * `editor-state` op applied as one transaction with an origin, and the {@link DocStore} exposes
 * the CRDT as opaque binary updates. The provider moves those bytes, sealed with AES-GCM under
 * keys derived from the room key, so the relay only ever sees ciphertext.
 *
 * ## The blind relay
 *
 * There is no project-run relay: the relay URL always comes from the user (self-hosted process,
 * Docker image, or their own Fly/Railway/VPS deploy). The relay holds no `DocStore` and no key.
 * Per room it keeps an append-only log of encrypted update envelopes (each stamped with a `seq`
 * and the author's token origin) and the latest encrypted snapshots, which CLIENTS produce. The
 * room key travels only in the join link fragment (`/join#<relay>/<room>/<token>/<key>`) and
 * stays on clients; tokens are Ed25519-signed capabilities (`view` / `edit`) that the relay
 * verifies on `hello`.
 *
 * ## Mapping onto `DocStore` (no Yjs types needed in the provider)
 *
 * 1. Connect to `<relay>/sync/<room>` (subprotocol `kimo-mp.1`) and send
 *    `hello {token, since}`. The relay answers `welcome` (peer id, role, head, whether a
 *    snapshot is needed), then the log tail as `entries`.
 * 2. Catch-up: when `welcome.needSnapshot`, download the snapshot over HTTP, open it and
 *    `store.applyUpdate(state, "remote:mp:<room>")`; then open and apply each entry in `seq`
 *    order (a gap reconnects). Once `since >= head`, send `caught-up`.
 * 3. Local changes: `store.onUpdate((u, origin) => ...)` seals every update whose origin is not
 *    the provider's own `remote:mp:<room>` (no echo) and sends it as `append`; the relay
 *    answers `ack {seq}` and fans it out to the other peers as `entries`.
 * 4. Offline edits: when every local change is acknowledged, the store's state vector is saved
 *    as `ackedSv` ({@link RoomStateStore}); after each catch-up the provider sends
 *    `encodeStateAsUpdate(ackedSv)` as one append, which merges everything made offline.
 * 5. Client-side compaction: when the log grows past the relay's threshold, the relay sends
 *    `compact {upTo}` to one caught-up `edit` peer, which seals `encodeStateAsUpdate()` as a
 *    snapshot covering `since` and uploads it; the relay then drops covered entries. Updates
 *    too large for one entry travel the same way (`carries=1` snapshots).
 * 6. Repair: cycle and orphan repair after merges runs on exactly one replica while online, the
 *    elected repairer (lowest `edit` peer id); every replica repairs locally while offline
 *    (`DocStore.autoRepair`, §15.8).
 * 7. Presence ({@link Awareness}) is sealed with its own key; a collaborator's `origin` is taken
 *    from the relay-stamped token origin, never from the payload.
 * 8. Status: `connecting` (socket, handshake, catch-up), then `synced` / `saving` (edit) or
 *    `read-only` (view; the store is set read-only too); `error` on a close, with jittered
 *    exponential back-off reconnects for retryable codes and none for fatal ones (auth,
 *    revoked, room closed, decrypt failure).
 *
 * Revisions stay local; per-origin undo stays local to each replica (`Y.UndoManager` never
 * undoes remote changes).
 */
import type { ClaimRecord, LocalOrigin } from "@kimo/editor-state"
import type { MpErrorCode, MultiplayerError, PeerInfo, RelayLimits, Role } from "./mp/index"
import { RelayNetworkProvider } from "./network-provider"
import type { SyncProvider } from "./provider"
import type { RoomStateStore } from "./room-state"

/** What a collaborator publishes about themselves (sealed awareness state). */
export interface PresenceState {
  user: { id: string; name: string; color: string }
  /** Set from the relay-stamped token origin on receipt; ignored when sent. */
  origin: LocalOrigin
  /** Pointer position in world coordinates. */
  cursor?: { x: number; y: number }
  /** Selected node ids. */
  selection?: readonly string[]
  /** Node ids an agent is currently working on (agent cursors; the union of `claims` ids). */
  working?: readonly string[]
  /**
   * Area claims of the agents on this client (ADR 0016 item 16, spec §15.11): each claims its
   * `ids` and their subtrees. Published by `bindClaimsToPresence`.
   */
  claims?: readonly ClaimRecord[]
  /** Page the collaborator is looking at. */
  page?: string
}

/** Presence channel (reduced to what Kimo needs). */
export interface Awareness {
  /** Relay-assigned peer id of this replica (0 before the first welcome). */
  readonly clientId: number
  getLocalState(): PresenceState | null
  /** Publishes (or with null, withdraws) this replica's presence; `origin` is filled in. */
  setLocalState(state: Omit<PresenceState, "origin"> | null): void
  /** Every known collaborator, including this replica. */
  getStates(): ReadonlyMap<number, PresenceState>
  /** Subscribes to presence changes. Returns an unsubscribe function. */
  onChange(
    listener: (change: { added: number[]; updated: number[]; removed: number[] }) => void,
  ): () => void
}

/** Connectivity hints (the browser's `navigator.onLine` and `online` event). */
export interface NetworkEnvironment {
  online(): boolean
  onOnline(listener: () => void): () => void
}

/** Provider timings in ms, overridable for tests. */
export interface NetworkTiming {
  /** Ping interval while open. Default 20 000. */
  pingIntervalMs: number
  /** Close and reconnect when nothing was received for this long. Default 45 000. */
  idleTimeoutMs: number
  /** How long a `compact` request may wait for the provider to be clean. Default 30 000. */
  compactWaitMs: number
  /** Debounce of `ackedSv` saves. Default 1 000. */
  cursorSaveMs: number
  /** Time caught up after which the back-off attempt counter resets. Default 10 000. */
  stableMs: number
}

/** Options for a network provider. */
export interface NetworkProviderOptions {
  /** Normalized relay base URL (`https://relay.example.com`). */
  relayUrl: string
  /** Room id (32 base32 characters). */
  room: string
  /** Capability token (base64url) from the join link. */
  token: string
  /** 32-byte room key from the link. */
  roomKey: Uint8Array
  /** Persists `ackedSv`. Default: in memory. */
  state?: RoomStateStore
  /** WebSocket constructor (defaults to the global one; inject for tests). */
  WebSocket?: new (
    url: string,
    protocols?: string | string[],
  ) => WebSocket
  fetch?: typeof fetch
  /** Reconnect back-off bounds in ms. Default `[250, 10_000]`. */
  backoff?: [min: number, max: number]
  /** Sent in `hello`. Default `kimo/<package version>`. */
  clientInfo?: string
  /** Default 15 000. */
  connectTimeoutMs?: number
  environment?: NetworkEnvironment
  random?: () => number
  now?: () => number
  /** Timing overrides (tests). */
  timing?: Partial<NetworkTiming>
}

/** What the provider reports besides status transitions (headless hooks for the UI). */
export type NetworkEvent =
  | { type: "welcome"; peer: number; role: Role; exp: number; limits: RelayLimits }
  | { type: "caught-up"; since: number }
  | { type: "peers"; peers: ReadonlyMap<number, PeerInfo> }
  | { type: "repairer"; peer: number | null; self: boolean }
  | { type: "corrupt-entry"; seq: number }
  | { type: "corrupt-snapshot"; upTo: number; gen: number }
  | { type: "denied"; code: MpErrorCode; message: string }
  | { type: "closed"; error: MultiplayerError | null; willRetry: boolean; retryInMs?: number }
  | { type: "compacted"; upTo: number; gen: number }
  | { type: "snapshot-applied"; upTo: number; gen: number }

/**
 * A provider that syncs a {@link DocStore} with a `kimo-mp/1` relay over WebSocket and carries
 * presence. See the module documentation.
 */
export interface NetworkProvider extends SyncProvider {
  readonly relayUrl: string
  readonly room: string
  /** True while the socket is open and the initial catch-up completed. */
  readonly connected: boolean
  readonly role: Role | null
  readonly peer: number | null
  /** The other peers in the room. */
  readonly peers: ReadonlyMap<number, PeerInfo>
  /** Elected repairer's peer id (§15.8), or null. */
  readonly repairer: number | null
  /** Token expiry from the last welcome (unix s; 0 = never), or null. */
  readonly exp: number | null
  readonly awareness: Awareness
  /** Opens (or re-opens) the connection. `attach` connects automatically. */
  connect(): void
  /** Closes the connection without detaching; edits keep accumulating locally. */
  disconnect(): void
  /** Swaps the token (refresh when open, reconnect after a fatal auth close). */
  setToken(token: string): void
  /** Subscribes to {@link NetworkEvent}s. Returns an unsubscribe function. */
  onEvent(listener: (event: NetworkEvent) => void): () => void
}

export type CreateNetworkProvider = (options: NetworkProviderOptions) => NetworkProvider

/** Creates a network provider for one room; `attach(store)` connects. */
export const createNetworkProvider: CreateNetworkProvider = (options) =>
  new RelayNetworkProvider(options)
