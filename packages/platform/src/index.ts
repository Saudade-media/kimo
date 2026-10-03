/**
 * @kimo/platform — the host abstraction the editor calls for files, dialogs, watching,
 * recent files, leases, recovery, git state, fonts, updates, window chrome, settings and
 * launch requests (ADR 0012). Implementations: `@kimo/platform/browser`,
 * `@kimo/platform/memory`, and the desktop one in `apps/desktop` over `@kimo/platform/tauri`.
 *
 * The main entry has no DOM or Node imports and runs anywhere.
 */
export type { AppliedCapabilities } from "./capabilities"
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
  KIMO_EXTENSIONS,
  parseDeepLink,
  resolveAgainstFile,
} from "./links"
export {
  type Appearance,
  type ExternalChangePolicy,
  googleFontsAllowed,
  isSettingKey,
  isValidSetting,
  normalizeSettings,
  SETTING_CHOICES,
  SETTING_KEYS,
  SETTINGS_DEFAULTS,
  type SettingKey,
  type Settings,
  type SettingsSchema,
  type UpdateChannel,
} from "./settings"
export { createSettingsStore, type SettingsBackend } from "./settings-store"
export * from "./types"
export { createBatcher, DEFAULT_WATCH_DEBOUNCE_MS, Emitter, sha256Hex } from "./util"
