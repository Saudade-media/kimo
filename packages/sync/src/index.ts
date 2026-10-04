/**
 * @kimo/sync — persistence and transport for a {@link DocStore} behind one
 * {@link SyncProvider} interface (teardown 9.1, ADR 0001 §4).
 *
 * Entry points (platform-specific providers live in their own files so that importing this
 * package in a browser never pulls `node:fs`):
 * - `@kimo/sync`: the interface, {@link MemoryProvider} and the network provider contract;
 * - `@kimo/sync`: also `FileDocumentProvider`, the runtime-neutral M4 file provider over an
 *   `AtomicFileStore` (`@kimo/platform` files);
 * - `@kimo/sync/file`: `FileProvider` (Bun/Node file system);
 * - `@kimo/sync/indexeddb`: `IndexedDbProvider` (browser/worker, y-indexeddb).
 */
export type { DocStore } from "@kimo/editor-state"
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
export { MemoryHub, MemoryProvider } from "./memory"
export type {
  Awareness,
  CreateNetworkProvider,
  NetworkProvider,
  NetworkProviderOptions,
  PresenceState,
} from "./network"
export { BaseProvider, type SyncProvider, type SyncStatus, type SyncStatusEvent } from "./provider"
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
