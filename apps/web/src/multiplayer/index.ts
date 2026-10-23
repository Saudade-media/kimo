/**
 * Multiplayer, headless (docs/spec/multiplayer.md §16): the share service, the local registry and
 * asset sync. No UI lives here; the Share panel and the join route call these APIs. The view
 * model the UI reads is `./model` (hooks in `./hooks`), imported directly: it sits on top of
 * `../platform/share`, which imports this barrel.
 */
export {
  AGENT_RESUME_MS,
  AgentPauses,
  type AgentPauseView,
  pausesFor,
} from "./agent-pause"
export { type AssetSync, createAssetSync, withRemoteAssets } from "./asset-sync"
export {
  createIndexedDbDeviceKeyStore,
  createKeychainDeviceKeyStore,
  createMemoryDeviceKeyStore,
  type DeviceKeyStore,
  defaultDeviceName,
} from "./device-key"
export {
  createOwnershipClient,
  type IssuedPairingLink,
  type OwnershipClient,
  type RelayDevice,
  type RelayOwnerState,
  type RelayOwnership,
} from "./ownership"
export {
  isPresenceColor,
  JoinOrder,
  PRESENCE_COLORS,
  type PresenceColor,
  personLabel,
  pickPresenceColor,
  presenceColorAt,
} from "./presence"
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
  SELF_RENEW_CHECK_MS,
  type SharedSession,
  type ShareService,
  type ShareServiceDeps,
  type ShareTarget,
  type ShareTimers,
  type StopSharingResult,
  type SweepResult,
} from "./share"
