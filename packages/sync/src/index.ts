/**
 * @kimo/sync: persistence and transport for a {@link DocStore} behind one
 * {@link SyncProvider} interface (teardown 9.1, ADR 0001 §4).
 *
 * Entry points (platform-specific providers live in their own files so that importing this
 * package in a browser never pulls `node:fs`):
 * - `@kimo/sync`: the interface and the end-to-end encrypted network provider
 *   (`createNetworkProvider`, `kimo-mp/1`);
 * - `@kimo/sync`: also `FileDocumentProvider`, the runtime-neutral M4 file provider over an
 *   `AtomicFileStore` (`@kimo/platform` files);
 * - `@kimo/sync/file`: `FileProvider` (Bun/Node file system);
 * - `@kimo/sync/indexeddb`: `IndexedDbProvider` (browser/worker, y-indexeddb);
 * - `@kimo/sync/mp`: the `kimo-mp/1` protocol core (no CRDT code; the relay loads only this).
 */
export type { DocStore } from "@kimo/editor-state"
export { type AwarenessHost, KimoAwareness, parseClaims } from "./awareness"
export { type BindClaimsOptions, bindClaimsToPresence } from "./claims-presence"
export {
  countChangedNodes,
  type DocumentMerge,
  FileDocumentProvider,
  type FileDocumentProviderOptions,
  FileLoadError,
  type KimoDoc,
  type RecoveryStore,
  type RecoveryStoreInput,
  SaveRefusedError,
  type SaveResult,
} from "./file-session"
export {
  base64ToBytes,
  bytesToBase64,
  createTransportPair,
  HostSyncHub,
  type HostSyncMessage,
  type HostSyncTransport,
  originalOrigin,
  remoteOriginFor,
  WindowSyncProvider,
  type WindowSyncProviderOptions,
} from "./host-sync"
export {
  type Awareness,
  type CreateNetworkProvider,
  createNetworkProvider,
  type NetworkEnvironment,
  type NetworkEvent,
  type NetworkProvider,
  type NetworkProviderOptions,
  type NetworkTiming,
  type PresenceState,
  type TextPresence,
} from "./network"
export { VIEW_ONLY_REASON } from "./network-provider"
export { BaseProvider, type SyncProvider, type SyncStatus, type SyncStatusEvent } from "./provider"
export { MemoryRoomStateStore, type RoomCursor, type RoomStateStore } from "./room-state"
export { recoveryIdFor, sha256Sync } from "./sha256"
export {
  type AtomicFileStore,
  type AtomicWriteResult,
  type AutosavePauseReason,
  classifySaveError,
  type ExternalChangeOutcome,
  type FileSessionProvider,
  type RecoveryReason,
  type RecoveryWrite,
  type ReloadUndoToken,
  SAVE_RETRY_MS,
  type SaveFailure,
  type SaveFailureCode,
} from "./types"
