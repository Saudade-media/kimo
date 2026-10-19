/**
 * Multiplayer, headless (docs/spec/multiplayer.md §16): the share service, the local registry and
 * asset sync. No UI lives here; the Share panel and the join route call these APIs.
 */
export { type AssetSync, createAssetSync, withRemoteAssets } from "./asset-sync"
export {
  createMemoryRegistry,
  createRegistry,
  fileRegistryBackend,
  type IssuedLink,
  indexedDbRegistryBackend,
  type JoinedRoom,
  memoryRegistryBackend,
  type OwnedRoom,
  type Registry,
  type RegistryBackend,
  type SavedState,
  type SaveStore,
} from "./registry"
export {
  createShareService,
  cursorKey,
  documentHash,
  type JoinedRoomSummary,
  type MintLinkOptions,
  type OwnedRoomSummary,
  type PrepareResult,
  type PresenceChange,
  roomBinding,
  type SharedSession,
  type ShareService,
  type ShareServiceDeps,
  type ShareTarget,
  type StopSharingResult,
  type SweepResult,
} from "./share"
