/**
 * @kimo/platform — the host abstraction the editor calls for files, dialogs, watching,
 * recent files, leases, recovery, git state, fonts, updates, window chrome, settings and
 * launch requests (ADR 0012). Implementations: `@kimo/platform/browser`,
 * `@kimo/platform/memory`, and the desktop one in `apps/desktop` over `@kimo/platform/tauri`.
 *
 * The main entry has no DOM or Node imports and runs anywhere.
 */
export type { AppliedCapabilities } from "./capabilities"
export * from "./cli-agents"
export {
  codeForErrno,
  isPlatformError,
  PlatformError,
  type PlatformErrorCode,
  unsupported,
} from "./errors"
export {
  basenameOf,
  DEEP_LINK_SCHEME,
  type DeepLink,
  dirnameOf,
  formatDeepLink,
  isAbsolutePath,
  isKimoPath,
  isOpenableUrl,
  KIMO_EXTENSIONS,
  parseDeepLink,
  parseJoinDeepLink,
  rebaseRelativeRefs,
  relativeRefBetween,
  resolveAgainstFile,
  resolveRelativeRef,
} from "./links"
export * from "./mcp"
export * from "./mcp-memory"
export * from "./relay-host"
export * from "./secrets"
export {
  type Appearance,
  type ExternalChangePolicy,
  googleFontsAllowed,
  isSettingKey,
  isValidSetting,
  type NudgePreset,
  normalizeSettings,
  nudgeSteps,
  RECENT_MODELS_MAX,
  type RecentModel,
  type RelaySetupSetting,
  SETTING_CHOICES,
  SETTING_KEYS,
  SETTINGS_DEFAULTS,
  type SettingKey,
  type Settings,
  type SettingsSchema,
  type UpdateChannel,
  webAccessAllowed,
} from "./settings"
export { createSettingsStore, type SettingsBackend } from "./settings-store"
export * from "./skills"
export { createTauriPlatform, type TauriBridge } from "./tauri-platform"
export {
  createFileThumbnails,
  createMemoryThumbnails,
  type ThumbnailInfo,
  type ThumbnailsApi,
  thumbnailKey,
} from "./thumbnails"
export * from "./types"
export { createBatcher, DEFAULT_WATCH_DEBOUNCE_MS, Emitter, sha256Hex } from "./util"
