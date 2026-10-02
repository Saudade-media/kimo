/**
 * Network provider — INTERFACE ONLY in v1 (teardown 9.1, 12 "v2 multiplayer"; ADR 0001).
 *
 * Multiplayer needs nothing from the editor beyond what already exists: every edit is an
 * `editor-state` op applied as one transaction with an origin, and the {@link DocStore} exposes
 * the CRDT as opaque binary updates. A network provider only moves those bytes.
 *
 * ## Planned implementation (apps/server relay, y-websocket compatible)
 *
 * Wire protocol: the y-protocols framing used by `y-websocket`, so stock Yjs tooling can talk to
 * the relay. Each WebSocket binary message is `varUint messageType` followed by a payload:
 *
 * | type | name      | payload                                                                 |
 * |------|-----------|-------------------------------------------------------------------------|
 * | 0    | sync      | `varUint step` + `varUint8Array`: step 0 = state vector (`SyncStep1`), step 1 = update answering a step 1 (`SyncStep2`), step 2 = incremental `Update` |
 * | 1    | awareness | y-protocols awareness update (presence: user, color, cursor, selection)  |
 * | 2    | auth      | `varUint 0` + reason string = permission denied (reserved)              |
 * | 3    | query-awareness | (empty) ask peers to resend their awareness state                 |
 *
 * Mapping onto `DocStore` (no Yjs types needed in the provider):
 *
 * 1. On open, send `SyncStep1(store.encodeStateVector())`.
 * 2. On `SyncStep1(sv)` from the server, reply `SyncStep2(store.encodeStateAsUpdate(sv))`.
 * 3. On `SyncStep2(u)` or `Update(u)`, call `store.applyUpdate(u, "remote:<server>")`; the store
 *    repairs post-merge cycles and orphans itself (teardown 9.2).
 * 4. Subscribe with `store.onUpdate((u, origin) => …)` and send `Update(u)` for every origin
 *    except the provider's own `remote:<server>` (no echo).
 * 5. Status: `connecting` → `synced` after the first `SyncStep2`; `error` + exponential
 *    back-off reconnect on close; `detach()` closes the socket.
 *
 * Relay (apps/server, Bun): one room per document id at `/sync/<room>`. The relay keeps a
 * server-side `DocStore` per room (from `@kimo/editor-state`), answers step 1 from it, applies
 * and fans out updates, and persists snapshots. Because it holds a real store it can also
 * validate the merged document, attribute updates per connection, run headless exports and host
 * remote MCP (writes through the same op layer with `mcp:<client>` origins). Auth: a bearer
 * token on the upgrade request mapped to room permissions (read / comment / edit); read-only
 * connections have their sync updates dropped and receive `auth` denials.
 *
 * Revisions: in multiplayer, `Revision` becomes a hash of the state vector (teardown 11.1);
 * per-origin undo stays local to each replica (`Y.UndoManager` never undoes remote changes).
 */
import type { LocalOrigin } from "@kimo/editor-state"
import type { SyncProvider } from "./provider"

/** What a collaborator publishes about themselves (y-protocols awareness state). */
export interface PresenceState {
  user: { id: string; name: string; color: string }
  /** Origin of the collaborator's edits (`user`, or `agent:<id>` for a remote agent). */
  origin: LocalOrigin
  /** Pointer position in world coordinates. */
  cursor?: { x: number; y: number }
  /** Selected node ids. */
  selection?: readonly string[]
  /** Node ids an agent is currently working on (agent cursors). */
  working?: readonly string[]
}

/** Presence channel (y-protocols awareness, reduced to what Kimo needs). */
export interface Awareness {
  /** This replica's awareness client id. */
  readonly clientId: number
  getLocalState(): PresenceState | null
  /** Publishes (or with null, withdraws) this replica's presence. */
  setLocalState(state: PresenceState | null): void
  /** Every known collaborator, including this replica. */
  getStates(): ReadonlyMap<number, PresenceState>
  /** Subscribes to presence changes. Returns an unsubscribe function. */
  onChange(
    listener: (change: { added: number[]; updated: number[]; removed: number[] }) => void,
  ): () => void
}

/** Options for a network provider. */
export interface NetworkProviderOptions {
  /** Relay base URL, e.g. `wss://kimo.example.com/sync`. */
  url: string
  /** Room (document) id. */
  room: string
  /** Bearer token sent on the WebSocket upgrade. */
  token?: string
  /** WebSocket constructor (defaults to the global one; inject for Node < 22 or tests). */
  WebSocket?: new (
    url: string,
    protocols?: string | string[],
  ) => WebSocket
  /** Reconnect back-off bounds in ms. Default `[250, 10_000]`. */
  backoff?: [min: number, max: number]
}

/**
 * A provider that syncs a {@link DocStore} with an apps/server relay over WebSocket and carries
 * presence. Not implemented in v1; see the module documentation for the plan.
 */
export interface NetworkProvider extends SyncProvider {
  readonly url: string
  readonly room: string
  /** True while the socket is open and the initial sync completed. */
  readonly connected: boolean
  readonly awareness: Awareness
  /** Opens (or re-opens) the connection. `attach` connects automatically. */
  connect(): void
  /** Closes the connection without detaching; edits keep accumulating locally. */
  disconnect(): void
}

/** Factory signature the multiplayer milestone will implement. */
export type CreateNetworkProvider = (options: NetworkProviderOptions) => NetworkProvider
