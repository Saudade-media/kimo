/**
 * The Tauri command surface (ADR 0012 §5): every `#[tauri::command]` the desktop shell
 * implements, with its argument and result payloads, plus the events it emits. The desktop
 * builder implements the Rust side in `apps/desktop/src-tauri/src/` and
 * `createTauriPlatform()` in `apps/desktop/src/` on top of {@link TypedInvoke}.
 *
 * Rules:
 * - Command names are `kimo_<area>_<verb>` (snake_case Rust fns). JS passes camelCase argument
 *   keys (Tauri v2 maps them to snake_case parameters); payload structs use
 *   `#[serde(rename_all = "camelCase")]`, so the JSON shapes below are exact.
 * - Errors are `Err(PlatformErrorPayload)` and are rethrown in JS as `PlatformError`.
 * - Paths are absolute native paths. The fs scope is deny-by-default and widened at runtime
 *   (`fs_scope()`) for files/folders the user picked, opened via association/deep link, or
 *   listed as watched folders; Rust rejects anything else with `PERMISSION`.
 * - Binary payloads (`readBytes`, fonts) travel as `tauri::ipc::Response` (ArrayBuffer).
 * - Document content is only touched for the atomic write + read-back (ADR 0002 §3).
 */
import type { PlatformErrorCode } from "./errors"
import type { SettingKey, Settings, UpdateChannel } from "./settings"
import type {
  AcquireResult,
  AtomicWriteResult,
  EditorMenuAction,
  FileFilter,
  FileStat,
  FontCacheEntry,
  GitChange,
  GitState,
  HelpMenuAction,
  HostOS,
  LeaseHolder,
  LocalFontFamily,
  MenuContext,
  OpenRequest,
  RecentFile,
  RecoveryEntry,
  RecoveryWriteInput,
  SettingsPane,
  TrashedFile,
  UpdateInfo,
  UpdaterStatus,
  WatchEvent,
  WatchedFolder,
} from "./types"

/** Rust: `struct PlatformErrorPayload { code: String, message: String, errno: Option<String> }`. */
export interface PlatformErrorPayload {
  code: PlatformErrorCode
  message: string
  errno?: string
}

/** Rust: `struct AppInfo`. */
export interface AppInfo {
  version: string
  os: Exclude<HostOS, "web">
  arch: string
  /** Hostname, for lease holders. */
  host: string
  pid: number
  /** `~/.kimo`. */
  kimoHome: string
  /** The calling window's label. */
  windowLabel: string
}

/** Rust: `struct WindowState`. */
export interface WindowState {
  focused: boolean
  fullscreen: boolean
  /** `Some({x:16,y:18})` on macOS editor windows, `None` elsewhere. */
  trafficLightPosition: { x: number; y: number } | null
  /**
   * macOS: right edge of the zoom button in window points, measured from the real buttons
   * (76 with macOS 26's 14 pt buttons, 68 with the older 12 pt ones). `null` until measured
   * and off macOS.
   */
  trafficLightsRight?: number | null
}

/**
 * Every command: `args` is the invoke argument object, `result` the resolved value. `null`
 * results are `()` in Rust (Tauri resolves unit to null).
 */
export interface TauriCommandMap {
  // --- app ---
  kimo_app_info: { args: Record<string, never>; result: AppInfo }

  // --- files ---
  kimo_fs_read_text: { args: { path: string }; result: { text: string; hash: string } }
  kimo_fs_read_bytes: { args: { path: string }; result: ArrayBuffer }
  /** temp file → fsync → rename → fsync dir → read back → SHA-256 compare. */
  kimo_fs_write_text_atomic: {
    args: { path: string; text: string; mkdirs: boolean }
    result: AtomicWriteResult
  }
  /** Same, bytes as a base64 string (IPC requests are JSON). */
  kimo_fs_write_bytes_atomic: {
    args: { path: string; base64: string; mkdirs: boolean }
    result: AtomicWriteResult
  }
  kimo_fs_remove: { args: { path: string }; result: null }
  /** Never overwrites: `EXISTS` when `to` exists. */
  kimo_fs_rename: { args: { from: string; to: string }; result: null }
  kimo_fs_copy: { args: { from: string; to: string }; result: null }
  kimo_fs_stat: { args: { path: string }; result: FileStat | null }
  kimo_fs_list: { args: { dir: string; extensions: string[] | null }; result: FileStat[] }
  /** Starts a `notify` watcher; events arrive as {@link TauriEventMap} `kimo://fs-watch`. */
  kimo_fs_watch: {
    args: { watchId: string; paths: string[]; debounceMs: number; recursive: boolean }
    result: null
  }
  kimo_fs_unwatch: { args: { watchId: string }; result: null }
  kimo_fs_reveal: { args: { path: string }; result: null }
  kimo_fs_open_default: { args: { path: string }; result: null }
  /** http, https (with a host), mailto and tel; anything else is `BLOCKED`. */
  kimo_open_url: { args: { url: string }; result: null }
  /** Board 25 §7 (b): reveals `~/.kimo/mcp/server.log` (or opens its folder). */
  kimo_help_show_logs: { args: Record<string, never>; result: null }
  /** Board 37 (A6): this editor window shows Home or a document; the native menu follows focus. */
  kimo_menu_set_context: { args: { context: MenuContext }; result: null }
  /** Plain text on the system clipboard (macOS; `BLOCKED` elsewhere, where the page writes it). */
  kimo_clipboard_write_text: { args: { text: string }; result: null }
  /** Board 32: a built-in agent turn started / is still running / ended (macOS Dock tile). */
  kimo_dock_agent_activity: { args: { source: string; working: boolean }; result: null }

  // --- dialogs (each pick widens the fs scope) ---
  kimo_dialog_open_file: {
    args: {
      title: string | null
      filters: FileFilter[]
      multiple: boolean
      defaultDir: string | null
    }
    result: string[]
  }
  kimo_dialog_save_file: {
    args: {
      title: string | null
      suggestedName: string
      filters: FileFilter[]
      defaultDir: string | null
    }
    result: string | null
  }
  kimo_dialog_pick_folder: {
    args: { title: string | null; defaultDir: string | null }
    result: string | null
  }

  // --- recents (app data dir `recents.json`; git summaries computed in Rust via gix/git CLI) ---
  kimo_recents_list_files: { args: { limit: number | null }; result: RecentFile[] }
  kimo_recents_note_opened: { args: { path: string }; result: null }
  kimo_recents_remove_file: { args: { path: string }; result: null }
  kimo_recents_clear: { args: Record<string, never>; result: null }
  kimo_recents_list_folders: { args: Record<string, never>; result: WatchedFolder[] }
  kimo_recents_add_folder: { args: { path: string }; result: null }
  kimo_recents_remove_folder: { args: { path: string }; result: null }
  kimo_recents_scan_folder: { args: { path: string }; result: RecentFile[] }

  // --- trash (board 37 §3: OS trash + `~/.kimo/trash.json` index; emits recents-changed) ---
  kimo_trash_move: { args: { path: string }; result: TrashedFile }
  kimo_trash_list: { args: Record<string, never>; result: TrashedFile[] }
  /** `path` null = the entry's original path. `EXISTS` when the target is taken. */
  kimo_trash_restore: { args: { id: string; path: string | null }; result: string }
  kimo_trash_remove: { args: { id: string }; result: null }
  kimo_trash_empty: { args: Record<string, never>; result: number }

  // --- leases (`~/.kimo/locks/<sha256(path)[:16]>.lock`, O_EXCL, JSON body in types.ts) ---
  kimo_lease_acquire: { args: { path: string; reclaimStale: boolean }; result: AcquireResult }
  kimo_lease_release: { args: { path: string; token: string }; result: null }
  kimo_lease_inspect: { args: { path: string }; result: LeaseHolder | null }
  /** Watches the lock file; changes arrive as `kimo://lease-changed`. */
  kimo_lease_watch: { args: { watchId: string; path: string }; result: null }
  kimo_lease_unwatch: { args: { watchId: string }; result: null }

  // --- recovery (`~/.kimo/recovery/<id>.kimo` + `<id>.meta.json`) ---
  kimo_recovery_dir: { args: Record<string, never>; result: string }
  kimo_recovery_list: { args: Record<string, never>; result: RecoveryEntry[] }
  kimo_recovery_write: { args: { input: RecoveryWriteInput }; result: RecoveryEntry }
  kimo_recovery_read: { args: { id: string }; result: { entry: RecoveryEntry; text: string } }
  kimo_recovery_discard: { args: { id: string }; result: null }
  kimo_recovery_prune: { args: { maxAgeMs: number }; result: number }

  // --- git (repository containing `path` only) ---
  kimo_git_state: { args: { path: string }; result: GitState | null }
  /** Watches that repo's `.git` dir; changes arrive as `kimo://git-changed`. */
  kimo_git_watch: { args: { watchId: string; path: string }; result: null }
  kimo_git_unwatch: { args: { watchId: string }; result: null }
  kimo_git_merge_driver_status: {
    args: { repoRoot: string }
    result: { gitattributes: boolean; config: boolean }
  }
  kimo_git_install_merge_driver: { args: { repoRoot: string }; result: null }

  // --- fonts (`~/.kimo/fonts/<key>.<ext>` + `index.json`) ---
  kimo_fonts_list_local: { args: { extraFolders: string[] }; result: LocalFontFamily[] }
  kimo_fonts_load_local: { args: { postscriptName: string }; result: ArrayBuffer }
  kimo_fonts_cache_get: { args: { key: string }; result: ArrayBuffer | null }
  kimo_fonts_cache_put: {
    args: { meta: Omit<FontCacheEntry, "key" | "bytes" | "cachedAt">; base64: string }
    result: FontCacheEntry
  }
  kimo_fonts_cache_list: { args: Record<string, never>; result: FontCacheEntry[] }
  kimo_fonts_cache_stats: {
    args: Record<string, never>
    result: { count: number; bytes: number; dir: string }
  }
  kimo_fonts_cache_clear: { args: Record<string, never>; result: null }
  // Offline font pack (board 28): `<app data dir>/font-pack/<key>.<ext>` + `index.json`.
  kimo_fonts_pack_get: { args: { key: string }; result: ArrayBuffer | null }
  kimo_fonts_pack_put: {
    args: { meta: Omit<FontCacheEntry, "key" | "bytes" | "cachedAt">; base64: string }
    result: FontCacheEntry
  }
  kimo_fonts_pack_list: { args: Record<string, never>; result: FontCacheEntry[] }
  kimo_fonts_pack_stats: {
    args: Record<string, never>
    result: { count: number; bytes: number; dir: string }
  }
  kimo_fonts_pack_clear: { args: Record<string, never>; result: null }
  /** Allowlist: fonts.googleapis.com, fonts.gstatic.com. Rust re-checks the settings. */
  kimo_fonts_fetch_remote: { args: { url: string }; result: ArrayBuffer }
  kimo_fonts_open_cache_folder: { args: Record<string, never>; result: null }

  // --- updater (tauri-plugin-updater; endpoint = UPDATE_FEED_PLACEHOLDER) ---
  kimo_updater_status: { args: Record<string, never>; result: UpdaterStatus }
  kimo_updater_check: { args: { channel: UpdateChannel }; result: UpdateInfo | null }
  kimo_updater_download: { args: Record<string, never>; result: null }
  kimo_updater_restart: { args: Record<string, never>; result: null }

  // --- window ---
  kimo_window_state: { args: Record<string, never>; result: WindowState }
  /** Title bar double-click: macOS honors the system zoom / minimize / none setting. */
  kimo_window_titlebar_double_click: { args: Record<string, never>; result: null }
  kimo_window_set_title: { args: { title: string }; result: null }
  kimo_window_set_document_edited: { args: { edited: boolean }; result: null }
  /** Opens (or focuses) the `settings` window. */
  kimo_window_open_settings: {
    args: { pane: SettingsPane | null; focus: string | null }
    result: null
  }
  /** Answer to `kimo://close-requested`: true closes the window. */
  kimo_window_confirm_close: { args: { requestId: string; allow: boolean }; result: null }
  kimo_window_close: { args: Record<string, never>; result: null }
  /** File › New window (G4): another editor window (`editor-<n>`) on Home. */
  kimo_window_new: { args: Record<string, never>; result: null }

  // --- settings (app config dir `settings.json`; Rust validates keys, broadcasts changes) ---
  kimo_settings_get_all: { args: Record<string, never>; result: Partial<Settings> }
  kimo_settings_set: { args: { key: SettingKey; value: unknown }; result: null }

  // --- launch (file association, deep links, argv, second instance via single-instance plugin) ---
  /** Requests that arrived before the frontend was ready; each is returned once. */
  kimo_launch_take_initial: { args: Record<string, never>; result: OpenRequest[] }
}

export type TauriCommand = keyof TauriCommandMap

/** Every event the shell emits (`app.emit` / `window.emit`). */
export interface TauriEventMap {
  "kimo://fs-watch": { watchId: string; events: WatchEvent[] }
  "kimo://lease-changed": { watchId: string; holder: LeaseHolder | null }
  "kimo://git-changed": { watchId: string; state: GitState | null; change: GitChange }
  "kimo://recents-changed": Record<string, never>
  "kimo://updater-status": UpdaterStatus
  "kimo://window-state": WindowState
  /** Sent to the window before it closes; answer with `kimo_window_confirm_close`. */
  "kimo://close-requested": { requestId: string; quitting?: boolean }
  /** Broadcast to every window. */
  "kimo://settings-changed": { key: SettingKey; value: unknown }
  "kimo://open-request": OpenRequest
  /** Board 25 §7 (b): a native Help menu item, sent to the focused editor window. */
  "kimo://help-menu": { action: HelpMenuAction }
  /** Board 27: a native File / View item for the focused editor window. */
  "kimo://editor-menu": { action: EditorMenuAction }
}

export type TauriEvent = keyof TauriEventMap

/** `@tauri-apps/api/core` `invoke`, typed by {@link TauriCommandMap}. */
export type TypedInvoke = <C extends TauriCommand>(
  command: C,
  args: TauriCommandMap[C]["args"],
) => Promise<TauriCommandMap[C]["result"]>

/** `@tauri-apps/api/event` `listen`, typed by {@link TauriEventMap}. */
export type TypedListen = <E extends TauriEvent>(
  event: E,
  handler: (payload: TauriEventMap[E]) => void,
) => Promise<() => void>

/** All command names (for the capability allowlist in `src-tauri/capabilities`). */
export const TAURI_COMMANDS = [
  "kimo_app_info",
  "kimo_fs_read_text",
  "kimo_fs_read_bytes",
  "kimo_fs_write_text_atomic",
  "kimo_fs_write_bytes_atomic",
  "kimo_fs_remove",
  "kimo_fs_rename",
  "kimo_fs_copy",
  "kimo_fs_stat",
  "kimo_fs_list",
  "kimo_fs_watch",
  "kimo_fs_unwatch",
  "kimo_fs_reveal",
  "kimo_fs_open_default",
  "kimo_open_url",
  "kimo_dialog_open_file",
  "kimo_dialog_save_file",
  "kimo_dialog_pick_folder",
  "kimo_recents_list_files",
  "kimo_recents_note_opened",
  "kimo_recents_remove_file",
  "kimo_recents_clear",
  "kimo_recents_list_folders",
  "kimo_recents_add_folder",
  "kimo_recents_remove_folder",
  "kimo_recents_scan_folder",
  "kimo_trash_move",
  "kimo_trash_list",
  "kimo_trash_restore",
  "kimo_trash_remove",
  "kimo_trash_empty",
  "kimo_lease_acquire",
  "kimo_lease_release",
  "kimo_lease_inspect",
  "kimo_lease_watch",
  "kimo_lease_unwatch",
  "kimo_recovery_dir",
  "kimo_recovery_list",
  "kimo_recovery_write",
  "kimo_recovery_read",
  "kimo_recovery_discard",
  "kimo_recovery_prune",
  "kimo_git_state",
  "kimo_git_watch",
  "kimo_git_unwatch",
  "kimo_git_merge_driver_status",
  "kimo_git_install_merge_driver",
  "kimo_fonts_list_local",
  "kimo_fonts_load_local",
  "kimo_fonts_cache_get",
  "kimo_fonts_cache_put",
  "kimo_fonts_cache_list",
  "kimo_fonts_cache_stats",
  "kimo_fonts_cache_clear",
  "kimo_fonts_pack_get",
  "kimo_fonts_pack_put",
  "kimo_fonts_pack_list",
  "kimo_fonts_pack_stats",
  "kimo_fonts_pack_clear",
  "kimo_fonts_fetch_remote",
  "kimo_fonts_open_cache_folder",
  "kimo_updater_status",
  "kimo_updater_check",
  "kimo_updater_download",
  "kimo_updater_restart",
  "kimo_window_state",
  "kimo_window_titlebar_double_click",
  "kimo_window_set_title",
  "kimo_window_set_document_edited",
  "kimo_window_open_settings",
  "kimo_window_confirm_close",
  "kimo_window_close",
  "kimo_window_new",
  "kimo_settings_get_all",
  "kimo_settings_set",
  "kimo_launch_take_initial",
  "kimo_help_show_logs",
  "kimo_menu_set_context",
  "kimo_clipboard_write_text",
  "kimo_dock_agent_activity",
] as const satisfies readonly TauriCommand[]

/** All event names. */
export const TAURI_EVENTS = [
  "kimo://fs-watch",
  "kimo://lease-changed",
  "kimo://git-changed",
  "kimo://recents-changed",
  "kimo://updater-status",
  "kimo://window-state",
  "kimo://close-requested",
  "kimo://settings-changed",
  "kimo://open-request",
  "kimo://help-menu",
  "kimo://editor-menu",
] as const satisfies readonly TauriEvent[]
