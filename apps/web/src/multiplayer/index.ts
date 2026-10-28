/**
 * Multiplayer, headless (docs/spec/multiplayer.md §16): the share service and the local registry.
 * No UI lives here; the Share panel and the join route call these APIs. The view model the UI
 * reads is `./model` (hooks in `./hooks`), imported directly: it sits on top of
 * `../platform/share`, which imports this barrel.
 */
export {
  createMemoryRegistry,
  createRegistry,
  fileRegistryBackend,
  type IssuedLink,
  memoryRegistryBackend,
  type OwnedRoom,
  type Registry,
} from "./registry"
export {
  createShareService,
  type PresenceChange,
  type SharedSession,
  type ShareService,
  type ShareServiceDeps,
  type StopSharingResult,
  type SweepResult,
} from "./share"
