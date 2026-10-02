/**
 * @kimo/sync — persistence and transport for a {@link DocStore} behind one
 * {@link SyncProvider} interface (teardown 9.1, ADR 0001 §4).
 *
 * Entry points (platform-specific providers live in their own files so that importing this
 * package in a browser never pulls `node:fs`):
 * - `@kimo/sync`: the interface, {@link MemoryProvider} and the network provider contract;
 * - `@kimo/sync/file`: `FileProvider` (Bun/Node file system);
 * - `@kimo/sync/indexeddb`: `IndexedDbProvider` (browser/worker, y-indexeddb).
 */
export type { DocStore } from "@kimo/editor-state"
export { MemoryHub, MemoryProvider } from "./memory"
export type {
  Awareness,
  CreateNetworkProvider,
  NetworkProvider,
  NetworkProviderOptions,
  PresenceState,
} from "./network"
export { BaseProvider, type SyncProvider, type SyncStatus, type SyncStatusEvent } from "./provider"
