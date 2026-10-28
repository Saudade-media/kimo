/**
 * `KimoPlatform`: everything the editor needs from its host (ADR 0012). The web app only talks
 * to the host through this interface; implementations:
 *
 * - desktop: `createTauriPlatform()` in `apps/desktop/src` over the commands in `./tauri.ts`;
 * - browser: `createBrowserPlatform()` (`@kimo/platform/browser`): File System Access API,
 *   downloads, IndexedDB, Web Locks; explicit `UNSUPPORTED` otherwise;
 * - tests: `createMemoryPlatform()` (`@kimo/platform/memory`).
 *
 * Conventions:
 * - Every async method rejects with a `PlatformError` (`./errors.ts`).
 * - A method whose capability is false rejects with `UNSUPPORTED` (sync methods throw it).
 * - Subscriptions return an {@link Unsubscribe}.
 * - Times are ms since the epoch unless named `…Iso`.
 */
import type { AppliedCapabilities } from "./capabilities"
import type { DeepLink } from "./links"
import type { McpHostApi } from "./mcp"
import type { SettingKey, Settings, SettingsSchema, UpdateChannel } from "./settings"
import type { SkillsApi } from "./skills"
import type { ThumbnailsApi } from "./thumbnails"

export type Unsubscribe = () => void

/** Which host this is. */
export type HostKind = "desktop" | "browser" | "memory"

/** Operating system (`web` for the browser build). */
export type HostOS = "macos" | "windows" | "linux" | "web"

/**
 * A file or folder reference.
 * - desktop: an absolute native path (`/Users/me/loom/marketing.kimo`, `C:\\…`);
 * - browser: `fsa:<handleId>/<name>` for a File System Access handle the user picked (or a
 *   path below a picked folder: `fsa:<folderId>/design/home.kimo`);
 * - memory: any absolute POSIX-style path.
 * Relative references inside documents are resolved with `resolveAgainstFile` (./links.ts).
 */
export type FileRef = string

/** The host abstraction. */
export interface KimoPlatform {
  readonly kind: HostKind
  readonly os: HostOS
  /** The app's version (`0.4.2`), shown in Settings › Updates / About. */
  readonly appVersion: string
  /**
   * Desktop: the Kimo home (`~/.kimo`), inside the files API's scope. Multiplayer keeps the
   * owner's room registry under `multiplayer/` there. Undefined on other hosts.
   */
  readonly kimoHome?: string
  /** What this host supports; the UI hides affordances for false entries. */
  readonly capabilities: AppliedCapabilities
  readonly files: FilesApi
  readonly dialogs: DialogsApi
  readonly recents: RecentsApi
  /**
   * Board 37 §3: Move to Trash with Restore. Desktop moves files to the OS trash and keeps an
   * index (`~/.kimo/trash.json`) so the Trash view can list and restore them; memory scripts it.
   * Absent in the browser (the web library soft-deletes with `trashedAt` instead).
   */
  readonly trash?: TrashApi
  /**
   * Board 37 §9: Home's file previews, cached in `~/.kimo/thumbs` (desktop over the files API,
   * memory scripted). Absent in the browser (the web library keeps them in IndexedDB).
   */
  readonly thumbnails?: ThumbnailsApi
  readonly leases: LeasesApi
  readonly recovery: RecoveryApi
  readonly git: GitApi
  readonly fonts: FontsApi
  readonly updater: UpdaterApi
  readonly window: WindowApi
  readonly settings: SettingsApi
  readonly launch: LaunchApi
  /**
   * M5 MCP server surface (ADR 0013 §11): desktop over Rust + the document host, memory
   * scripted; absent in the browser (no MCP server there).
   */
  readonly mcp?: McpHostApi
  /**
   * M6 user skills (`~/.kimo/skills/<name>/SKILL.md`, ADR 0014 §10): desktop over Rust,
   * memory scripted; absent in the browser. Structurally a `@kimo/ai-agent` `SkillSource`.
   */
  readonly skills?: SkillsApi
  /**
   * CPU architecture of the running app (`aarch64`, `x86_64`; Rust `std::env::consts::ARCH`) for
   * the version string (board 25 §7 "Version string"); absent when the host can't tell (web).
   */
  readonly arch?: string
  /**
   * Board 25 §7 (b): the native Help menu (macOS) and "Show logs in Finder"; desktop only. The
   * browser and memory hosts have no native menu (their Help lives in File › Help).
   */
  readonly help?: HelpHostApi
  /**
   * Audit G3: plain-text clipboard writes that work outside a user gesture (a native menu item
   * is not one in WKWebView). Desktop only; pages use `navigator.clipboard` without it.
   */
  readonly clipboard?: ClipboardApi
  /**
   * Board 27 §9/§10: native menu-bar items that act on the focused editor (File › Export…,
   * Copy selection as PNG, View › Preview); desktop only.
   */
  readonly menu?: EditorMenuApi
  /**
   * Board 32 "Dock activity": reports built-in agent turns so the macOS Dock tile animates
   * while any agent works; desktop only (Rust ignores it on Windows / Linux).
   */
  readonly dock?: DockActivityApi
  /**
   * Settings › Files › Default app for .kimo and .kimoz (board 37 D15): whether the OS opens
   * these files with Kimo, and a way to make it so. Desktop only; absent where Kimo can't tell.
   */
  readonly defaultApp?: DefaultAppApi
  /** Stops watchers and listeners (window teardown). */
  dispose(): void
}

/** A Help menu item the window runs (board 25 §7 (b) A0qRF). Show logs is `HelpHostApi.showLogs`. */
export type HelpMenuAction =
  | "docs"
  | "shortcuts"
  | "whats-new"
  | "report-issue"
  | "copy-diagnostics"

/**
 * A native menu-bar item the focused editor window runs (`kimo://editor-menu`). The editor runs
 * all of them; Home runs `new-file` / `open-file` and the Edit items. `undo` / `redo` /
 * `select-all` act on a focused text field (`execCommand`) before the document.
 */
export type EditorMenuAction =
  | "export"
  | "copy-png"
  | "preview"
  | "go-home"
  | "new-file"
  | "open-file"
  | "undo"
  | "redo"
  | "select-all"
  /** Board 44 §5: File › New tab ⌘T (Home in a new tab). */
  | "new-tab"
  /** Board 44 §5: File › Close tab ⌘W (the pinned Home tab closes the window instead). */
  | "close-tab"

/** What an editor window shows; the native menu enables the document items for `"editor"`. */
export type MenuContext = "home" | "editor"

export interface EditorMenuApi {
  /** Native File / Edit / View menu items picked while this window is the focused editor. */
  onAction(listener: (action: EditorMenuAction) => void): () => void
  /**
   * This window now shows Home or a document (board 37, audit A6/G2): Back to files, Export…,
   * Copy selection as PNG and Preview are disabled while the focused window shows Home.
   */
  setContext(context: MenuContext): Promise<void>
}

export interface ClipboardApi {
  /** Replaces the clipboard with `text`. Rejects when the system clipboard refuses it. */
  writeText(text: string): Promise<void>
}

export interface HelpHostApi {
  /** Native Help menu items picked while this window is the focused editor. */
  onMenu(listener: (action: HelpMenuAction) => void): () => void
  /** Reveals Kimo's log file (`~/.kimo/mcp/server.log`) in Finder / Explorer / the file manager. */
  showLogs(): Promise<void>
}

/**
 * `default`: the OS opens .kimo and .kimoz files with this Kimo. `other`: another app (or none)
 * opens at least one of them. `unknown`: this OS gives no answer (the row is hidden).
 */
export type DefaultAppStatus = "default" | "other" | "unknown"

export interface DefaultAppApi {
  status(): Promise<DefaultAppStatus>
  /** Makes Kimo the default app for .kimo and .kimoz. Rejects when the OS refuses. */
  makeDefault(): Promise<void>
}

/** Board 32: the Dock tile's agent-activity reports (`kimo_dock_agent_activity`). */
export interface DockActivityApi {
  /**
   * `source` (unique per agent controller in this window) is working or not. Re-send `true`
   * at least every 5 s while working: Rust drops a source silent for 15 s (reloads, crashes).
   */
  setAgentWorking(source: string, working: boolean): Promise<void>
}

// ===============================================================================================
// Files
// ===============================================================================================

export interface FileStat {
  ref: FileRef
  name: string
  kind: "file" | "directory"
  size: number
  mtimeMs: number
  /** The current user cannot write it (or its directory). */
  readOnly: boolean
}

export interface AtomicWriteResult {
  bytes: number
  /** SHA-256 (hex) of the bytes written, equal to the read-back hash. */
  hash: string
}

export interface WatchOptions {
  /** Coalescing window: events within it are delivered as one batch. Default 150 ms. */
  debounceMs?: number
  /** Watch directories recursively (assets/, scripts/, shaders/). Default false. */
  recursive?: boolean
}

/** One change seen by a watcher. Renames are reported as `removed` + `created` when the host
 * cannot pair them. */
export interface WatchEvent {
  kind: "created" | "modified" | "removed" | "renamed"
  ref: FileRef
  /** New location, for `renamed`. */
  to?: FileRef
  at: number
}

/**
 * File system access. `readText` / `writeTextAtomic` / `remove` are structurally identical to
 * `@kimo/sync`'s `AtomicFileStore`, so this API plugs straight into the file provider.
 */
export interface FilesApi {
  /** Reads a UTF-8 file and its SHA-256. `NOT_FOUND` when missing. */
  readText(ref: FileRef): Promise<{ text: string; hash: string }>
  readBytes(ref: FileRef): Promise<Uint8Array>
  /**
   * Atomic write with read-back verification: temp file in the same directory → fsync →
   * rename → fsync directory → read back → compare SHA-256 (`READ_BACK_MISMATCH` otherwise).
   * The original file is untouched on any failure. `mkdirs` creates parent directories.
   * Browser: `FileSystemWritableFileStream` (writes a swap file and commits on close), then
   * `getFile()` + hash for the read-back.
   */
  writeTextAtomic(
    ref: FileRef,
    text: string,
    options?: {
      mkdirs?: boolean
      /**
       * Secrets (the multiplayer room registry): desktop writes the file 0600 and its parent
       * directory 0700 on Unix. Elsewhere it has no effect (the browser has no file modes).
       */
      ownerOnly?: boolean
    },
  ): Promise<AtomicWriteResult>
  writeBytesAtomic(
    ref: FileRef,
    bytes: Uint8Array,
    options?: { mkdirs?: boolean },
  ): Promise<AtomicWriteResult>
  /** Removes a file; resolves when it does not exist. */
  remove(ref: FileRef): Promise<void>
  /**
   * Renames (moves) a file. Never overwrites: rejects `EXISTS` when `to` exists and
   * `NOT_FOUND` when `from` is missing (Home › Rename, board 37 §5).
   */
  rename(from: FileRef, to: FileRef): Promise<void>
  /** Copies a file. Never overwrites: rejects `EXISTS` when `to` exists (Home › Duplicate). */
  copy(from: FileRef, to: FileRef): Promise<void>
  /** Metadata, or null when nothing exists at `ref`. */
  stat(ref: FileRef): Promise<FileStat | null>
  /** Entries of a directory (non-recursive), optionally filtered by extension (no dot). */
  list(dir: FileRef, options?: { extensions?: string[] }): Promise<FileStat[]>
  /**
   * Watches files or directories. Events are coalesced per `debounceMs` and delivered as a
   * batch. Includes the app's own writes: sessions compare hashes to ignore them.
   */
  watch(
    refs: FileRef[],
    options: WatchOptions,
    listener: (events: WatchEvent[]) => void,
  ): Unsubscribe
  /** Reveal in Finder / Explorer / the file manager (board 17 "Reveal in Finder"). */
  reveal(ref: FileRef): Promise<void>
  /** Opens a file with the OS default app ("Open as text", "Open fonts folder"). */
  openWithDefaultApp(ref: FileRef): Promise<void>
  /**
   * Opens a file in the OS text editor (failed-load card "Open as text"). Not the default app:
   * for .kimo that is Kimo itself, which would fail to load it again.
   */
  openAsText(ref: FileRef): Promise<void>
  /** Opens an https URL in the browser (release notes, repo). */
  openExternalUrl(url: string): Promise<void>
  /** Hands bytes to the user as a download (browser fallback when there is no save dialog). */
  download(name: string, bytes: Uint8Array, mime: string): Promise<void>
}

// ===============================================================================================
// Dialogs
// ===============================================================================================

export interface FileFilter {
  name: string
  /** Extensions without the dot. */
  extensions: string[]
}

/** Native dialogs. Picking a file or folder also widens the desktop fs scope to it. */
export interface DialogsApi {
  /** Returns [] when cancelled. */
  openFile(options?: {
    title?: string
    filters?: FileFilter[]
    multiple?: boolean
    defaultDir?: FileRef
  }): Promise<FileRef[]>
  /** Returns null when cancelled. */
  saveFile(options: {
    title?: string
    suggestedName: string
    filters?: FileFilter[]
    defaultDir?: FileRef
  }): Promise<FileRef | null>
  /** Returns null when cancelled. */
  pickFolder(options?: { title?: string; defaultDir?: FileRef }): Promise<FileRef | null>
}

/** The filter used by Open… / Save as… */
export const KIMO_FILE_FILTER: FileFilter = { name: "Kimo document", extensions: ["kimo", "kimoz"] }
/** Open dialogs: Kimo documents plus pen.dev `.pen` files (converted to `.kimo` on open). */
export const KIMO_OPEN_FILTER: FileFilter = {
  name: "Kimo document",
  extensions: ["kimo", "kimoz", "pen"],
}

// ===============================================================================================
// Recent files and watched folders (Home, board 16)
// ===============================================================================================

export type GitFileStatus = "clean" | "modified" | "untracked" | "conflict" | "ignored"

/** The GIT column of FileRow ("main · clean", "merge · 3 conflicts", "not a repo" = null). */
export interface GitSummary {
  /** Branch name; null when detached. */
  branch: string | null
  status: GitFileStatus
  /** Conflicted paths in the file (merge conflicts stored in the `.kimo`, or git's). */
  conflicts: number
  operation: GitOperation | null
}

export interface RecentFile {
  ref: FileRef
  name: string
  /** The containing folder, displayed as LOCATION (middle-truncated, mono). */
  folder: FileRef
  modifiedAt: number
  openedAt: number | null
  /** null = not in a git repository ("not a repo"). */
  git: GitSummary | null
  /** The file no longer exists at `ref`. */
  missing: boolean
}

/** A folder listed under LOCAL FOLDERS on Home. */
export interface WatchedFolder {
  ref: FileRef
  label: string
  /** Branch + number of changed files in the repo ("loom · 3 · feat/onboarding"); null = no repo. */
  git: { branch: string | null; changedCount: number } | null
  /** `.kimo` / `.kimoz` files found under it. */
  fileCount: number
}

export interface RecentsApi {
  /** Recent files from the open history and watched folders, newest `modifiedAt` first. */
  listFiles(options?: { limit?: number }): Promise<RecentFile[]>
  noteOpened(ref: FileRef): Promise<void>
  removeFile(ref: FileRef): Promise<void>
  clearFiles(): Promise<void>
  listFolders(): Promise<WatchedFolder[]>
  addFolder(ref: FileRef): Promise<void>
  removeFolder(ref: FileRef): Promise<void>
  /** `.kimo` / `.kimoz` files under a folder (recursive, skips `node_modules` and dot dirs). */
  scanFolder(ref: FileRef): Promise<RecentFile[]>
  /** Fires when the lists change (a file was saved, a branch switched, a folder added). */
  onChange(listener: () => void): Unsubscribe
}

// ===============================================================================================
// Trash (Home, board 37 §3)
// ===============================================================================================

/*
 * Desktop contract (Rust, `src-tauri`; TS side in tauri.ts / tauri-platform.ts):
 * - `kimo_fs_rename {from, to} -> null` and `kimo_fs_copy {from, to} -> null`: never overwrite.
 *   Code `EXISTS` (errno `EEXIST`) when `to` exists, `NOT_FOUND` when `from` is missing. Both
 *   paths must be in the fs scope; grant `to` on success.
 * - `kimo_trash_move {path} -> TrashedFile`: moves the file to the OS trash (macOS `~/.Trash`),
 *   records where it landed in `~/.kimo/trash.json`, drops it from recents, emits
 *   `kimo://recents-changed`.
 * - `kimo_trash_list {} -> TrashedFile[]`: newest first; entries whose item left the trash are
 *   dropped.
 * - `kimo_trash_restore {id, path: string | null} -> string`: puts the item back at `path`
 *   (null = `originalRef`), creating the parent folder; `EXISTS` when the target is taken (never
 *   overwrite), `NOT_FOUND` when the item left the trash. Grants scope, notes it in recents,
 *   emits `kimo://recents-changed`. Returns the restored path.
 * - `kimo_trash_remove {id} -> null`: deletes that item for good and drops the entry.
 * - `kimo_trash_empty {} -> number`: deletes every item Kimo moved there; other items in the
 *   trash stay. Kimo never empties the trash on its own.
 * - `error.rs`: map `EEXIST` / `io::ErrorKind::AlreadyExists` to code `EXISTS` (as
 *   `codeForErrno` does).
 */

/** A file Kimo moved to the OS trash (one entry of `~/.kimo/trash.json`). */
export interface TrashedFile {
  /** Opaque entry id. */
  id: string
  /** Where the file lived; Restore puts it back here. */
  originalRef: FileRef
  /** File name at `originalRef` (`home.kimo`). */
  name: string
  trashedAt: number
}

/**
 * Kimo's view of the OS trash. Only files Kimo moved there are listed; other items in the
 * trash are never touched. Kimo never empties the trash on its own.
 */
export interface TrashApi {
  /** Moves a file to the OS trash and records it. Fires `recents.onChange`. */
  move(ref: FileRef): Promise<TrashedFile>
  /** Entries still in the OS trash, newest first (entries emptied elsewhere are dropped). */
  list(): Promise<TrashedFile[]>
  /**
   * Puts a file back at `originalRef`, or at `to` ("Restore as copy"). Rejects `EXISTS` when
   * the target is taken and `NOT_FOUND` when the item left the trash. Resolves to the restored
   * ref. Fires `recents.onChange`.
   */
  restore(id: string, to?: FileRef): Promise<FileRef>
  /** Deletes one entry's file for good. */
  remove(id: string): Promise<void>
  /** Deletes every file Kimo moved to the trash for good; resolves to how many. */
  empty(): Promise<number>
}

// ===============================================================================================
// Per-file leases (teardown 9.4 "single writer per file")
// ===============================================================================================

/** Who holds a lease (board 17 "Lease on marketing.kimo"). */
export interface LeaseHolder {
  pid: number
  /** Machine-readable app id. */
  app: "kimo-desktop" | "kimo-cli" | "kimo-mcp" | "kimo-web" | (string & {})
  /** Display name: "kimo mcp (headless)", "Kimo". */
  appLabel: string
  host: string
  /** When the lease was taken (ISO 8601). */
  sinceIso: string
  /** Socket the holder serves (CLI writers attach to it instead of opening the file). */
  socket?: string
  /** The lock file (`~/.kimo/locks/<sha256(path)[:16]>.lock`). */
  lockPath: string
  /** The pid is running (same host only; a holder on another host counts as alive). */
  alive: boolean
  /** Held by this process. */
  self: boolean
}

/** A lease this process holds. */
export interface Lease {
  ref: FileRef
  /** Opaque token proving ownership; required to release. */
  token: string
  holder: LeaseHolder
}

export type AcquireResult =
  | {
      ok: true
      lease: Lease /** A stale lease (dead pid) that was reclaimed. */
      reclaimed?: LeaseHolder
    }
  | { ok: false; holder: LeaseHolder }

/**
 * Lock-file format (shared with the CLI and headless MCP, JSON, one object):
 * `{"version":1,"path":"/abs/file.kimo","pid":48213,"app":"kimo-mcp","appLabel":"kimo mcp (headless)",
 *   "host":"mbp","sinceIso":"2026-10-03T10:31:07.000Z","socket":"~/.kimo/sock/48213","token":"…"}`
 * created with O_EXCL; a lease whose pid is dead on the same host is reclaimed on acquire.
 */
export interface LeasesApi {
  acquire(ref: FileRef, options?: { reclaimStale?: boolean }): Promise<AcquireResult>
  release(lease: Lease): Promise<void>
  /** The current holder, or null when the file is free. */
  inspect(ref: FileRef): Promise<LeaseHolder | null>
  /** Fires when the holder of `ref` changes (freed, taken, reclaimed). */
  watch(ref: FileRef, listener: (holder: LeaseHolder | null) => void): Unsubscribe
}

// ===============================================================================================
// Recovery store (~/.kimo/recovery)
// ===============================================================================================

/** Mirrors `@kimo/sync` `RecoveryReason` (checked in apps/web/src/platform/contract.ts). */
export type RecoveryReason =
  | "snapshot"
  | "upgrade-pending"
  | "git-stash"
  | "save-failed"
  | "read-back-mismatch"
  | "untitled"

/** One recovery file (board 17 "Launch recovery", 02d RecoveryItem). */
export interface RecoveryEntry {
  /** `<sha256(path)[:16]>` for a file, `untitled-<docId>` for a never-saved document. */
  id: string
  /** The working file it belongs to; null for Untitled ("not on disk yet"). */
  sourceRef: FileRef | null
  name: string
  reason: RecoveryReason
  createdAt: number
  updatedAt: number
  /** Edits newer than the last save ("14 edits"). */
  edits: number
  /** Last successful autosave of the working file ("Last autosave 10:42"). */
  lastAutosaveAt: number | null
  /** The working file changed on disk after the recovery was written; null = unknown/none. */
  sourceChangedSince: boolean | null
  /** Root layers count for Untitled ("22 layers"). */
  layers?: number
  bytes: number
  hash: string
  /** Process that wrote it, and whether it is still running. Entries of dead owners are what
   * the launch recovery dialog offers ("quit unexpectedly 10:43" = `ownerExitedAt`). */
  ownerPid: number
  ownerAlive: boolean
  ownerExitedAt: number | null
  appVersion: string
}

export interface RecoveryWriteInput {
  id: string
  sourceRef: FileRef | null
  name: string
  reason: RecoveryReason
  text: string
  edits: number
  lastAutosaveAt?: number | null
  layers?: number
}

/** Retention: board 17/19 "Kept for 30 days". */
export const RECOVERY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Layout: `<dir>/<id>.kimo` (the document, canonical text) + `<id>.meta.json` (the entry
 * without `bytes`/`hash`/`ownerAlive`). The `.kimo` path matches `FileProvider.recoveryPath`.
 */
export interface RecoveryApi {
  /** The recovery directory (`~/.kimo/recovery`), or null when it is not a real directory. */
  readonly dir: string | null
  list(): Promise<RecoveryEntry[]>
  write(input: RecoveryWriteInput): Promise<RecoveryEntry>
  /** Reads a recovery file. The entry stays until {@link discard} (after the restored document
   * reached disk). */
  restore(id: string): Promise<{ entry: RecoveryEntry; text: string }>
  discard(id: string): Promise<void>
  /** Removes entries older than `maxAgeMs` (default {@link RECOVERY_RETENTION_MS}). Returns the count. */
  prune(maxAgeMs?: number): Promise<number>
}

// ===============================================================================================
// Git state (only for the repository containing the open file)
// ===============================================================================================

/** A git operation in progress (`REBASE_HEAD`/`rebase-merge`, `MERGE_HEAD`,
 * `CHERRY_PICK_HEAD`, or a HEAD change while `index.lock` exists = checkout). */
export type GitOperation = "rebase" | "merge" | "cherry-pick" | "checkout"

export interface GitState {
  repoRoot: FileRef
  /** null when HEAD is detached. */
  branch: string | null
  /** HEAD commit (full sha), null in an empty repo. */
  head: string | null
  operation: GitOperation | null
  /** `.git/index.lock` exists right now. */
  indexLocked: boolean
  /** Status of the watched file. */
  fileStatus: GitFileStatus
  /** Changed paths in the repo (Home "· 3"). */
  changedCount: number
}

export type GitChange =
  | { kind: "operation-started"; operation: GitOperation }
  | { kind: "operation-finished"; operation: GitOperation }
  | { kind: "head-changed"; from: string | null; to: string | null }
  | { kind: "branch-changed"; from: string | null; to: string | null }
  | { kind: "status-changed" }

export interface GitApi {
  /** State of the repository containing `ref`; null when it is not inside a repository. */
  state(ref: FileRef): Promise<GitState | null>
  /**
   * Watches the repository containing `ref` (its `.git` dir: HEAD, index.lock, *_HEAD,
   * rebase-merge/, rebase-apply/) and nothing else. Fires with the new state and what changed.
   */
  watch(ref: FileRef, listener: (state: GitState | null, change: GitChange) => void): Unsubscribe
  /** Whether `kimo merge` is configured (`.gitattributes` + `git config merge.kimo.driver`). */
  mergeDriverStatus(repoRoot: FileRef): Promise<{ gitattributes: boolean; config: boolean }>
  /** Writes `*.kimo merge=kimo diff=kimo` to `.gitattributes` and the local git config. */
  installMergeDriver(repoRoot: FileRef): Promise<void>
}

// ===============================================================================================
// Fonts (board 19 "Fonts": Document → Local → Google cache)
// ===============================================================================================

export interface LocalFontStyle {
  postscriptName: string
  fullName: string
  weight: number
  italic: boolean
}

export interface LocalFontFamily {
  family: string
  styles: LocalFontStyle[]
}

export interface FontCacheEntry {
  /** First 16 hex chars of the bytes' SHA-256. */
  key: string
  family: string
  weight: number
  italic: boolean
  /** `pack`: the offline font pack ({@link FontsApi.pack}). */
  source: "google" | "document" | "file" | "pack"
  bytes: number
  cachedAt: number
}

/** A content-addressed font store (the offline font pack). */
export interface FontStoreApi {
  get(key: string): Promise<Uint8Array | null>
  put(
    entry: Omit<FontCacheEntry, "key" | "bytes" | "cachedAt">,
    bytes: Uint8Array,
  ): Promise<FontCacheEntry>
  list(): Promise<FontCacheEntry[]>
  stats(): Promise<{ count: number; bytes: number; dir: string | null }>
  clear(): Promise<void>
}

export interface FontsApi {
  /** Installed families (CoreText / DirectWrite / fontconfig + Settings extra folders;
   * browser: Local Font Access where granted). */
  listLocal(): Promise<LocalFontFamily[]>
  /** Bytes of an installed face. */
  loadLocal(postscriptName: string): Promise<Uint8Array>
  /** Content-addressed cache (`~/.kimo/fonts`; browser: IndexedDB). */
  readonly cache: {
    get(key: string): Promise<Uint8Array | null>
    put(
      entry: Omit<FontCacheEntry, "key" | "bytes" | "cachedAt">,
      bytes: Uint8Array,
    ): Promise<FontCacheEntry>
    list(): Promise<FontCacheEntry[]>
    stats(): Promise<{ count: number; bytes: number; dir: string | null }>
    clear(): Promise<void>
  }
  /**
   * The offline font pack (board 28 "Offline font pack"): curated Google faces downloaded once
   * on request and kept apart from the cache (Clear does not touch it). Desktop: the app data
   * dir `font-pack/` (same layout as the cache); browser: Cache Storage `kimo-font-pack`.
   * Entries carry `source: "pack"`. `put` stores bytes only — the download goes through
   * {@link fetchRemote}, so "No third-party fetch" blocks it.
   */
  readonly pack: FontStoreApi
  /**
   * Fetches a font file from `fonts.googleapis.com` / `fonts.gstatic.com` only. Rejects with
   * `BLOCKED` when "No third-party fetch" is on or Google Fonts is off, or for any other host.
   * Desktop performs the request in Rust (the webview CSP allows no remote connects).
   */
  fetchRemote(url: string): Promise<Uint8Array>
  /** Opens the font cache folder in the file manager. */
  openCacheFolder(): Promise<void>
}

// ===============================================================================================
// Updater (board 19 "Updater")
// ===============================================================================================

export interface UpdateInfo {
  version: string
  currentVersion: string
  channel: UpdateChannel
  notesUrl: string | null
  publishedIso: string | null
}

export type UpdaterStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "up-to-date"; checkedAt: number }
  | { state: "available"; info: UpdateInfo }
  | { state: "downloading"; info: UpdateInfo; received: number; total: number | null }
  /** Downloaded and verified: the "Kimo 0.5 is ready · Restart" toast (one per session). */
  | { state: "ready"; info: UpdateInfo }
  | { state: "error"; message: string }

/**
 * Signed Tauri updater. Never restarts on its own: the app flushes every session, waits for
 * "Saved to disk" on each, then calls {@link restart} (board 19 "Save & restart").
 */
export interface UpdaterApi {
  status(): UpdaterStatus
  /** Checks the channel from settings. Resolves to the available update or null. */
  check(): Promise<UpdateInfo | null>
  download(): Promise<void>
  /** Installs the downloaded update and relaunches. */
  restart(): Promise<void>
  onStatus(listener: (status: UpdaterStatus) => void): Unsubscribe
}

/** Placeholders until the release infrastructure exists (ADR 0012). */
export const UPDATE_FEED_PLACEHOLDER =
  "https://github.com/Saudade-media/kimo/releases/download/updater/latest-{channel}.json"
export const REPO_URL_PLACEHOLDER = "https://github.com/Saudade-media/kimo"

// ===============================================================================================
// Window (02d "Window chrome (macOS)")
// ===============================================================================================

/** Settings panes (board 19). */
export type SettingsPane =
  | "general"
  /** Board 27 §4 (Lwg6P): snapping, pixel grid, rulers, nudge. */
  | "canvas"
  | "files"
  | "fonts"
  | "agents-mcp"
  /** M6 (board 23 g6AqH): API keys, local agent CLIs, usage & limits. */
  | "ai-providers"
  /** Board 41 section 4: relay URL and Test, your name, other cursors, fetching assets. */
  | "multiplayer"
  | "updates"
  | "about"

export interface WindowApi {
  /** Window label: `main`, `settings`, `editor-<n>`; `web` in the browser. */
  readonly label: string
  /** macOS `trafficLightPosition` ({ x: 16, y: 18 }); null where Kimo draws no inset. */
  trafficLightPosition(): { x: number; y: number } | null
  /** Width the topbar reserves for the lights: 68 on macOS, 4 in fullscreen, 0 elsewhere. */
  trafficLightInset(): number
  /** The inset changed (first measurement of the native lights, display or theme change). */
  onTrafficLightInsetChange(listener: (inset: number) => void): Unsubscribe
  /**
   * Title bar double-click on a drag region. macOS runs the system "Double-click a window's
   * title bar to" action (zoom, minimize or nothing); Windows and Linux toggle maximize; the
   * browser does nothing.
   */
  titlebarDoubleClick(): Promise<void>
  isFocused(): boolean
  onFocusChange(listener: (focused: boolean) => void): Unsubscribe
  isFullscreen(): boolean
  onFullscreenChange(listener: (fullscreen: boolean) => void): Unsubscribe
  setTitle(title: string): Promise<void>
  /** macOS close-button dot for unsaved edits. No-op elsewhere. */
  setDocumentEdited(edited: boolean): Promise<void>
  /**
   * Opens Settings: a separate window on desktop (⌘,) → `"window"`; on the web nothing opens
   * and the result is `"dialog"`, so the app shows its in-app Settings dialog. `focus` names
   * what the pane opens on: an MCP client to expand (Agents & MCP) or `usage` (AI providers).
   */
  openSettings(pane?: SettingsPane, focus?: string | null): Promise<"window" | "dialog">
  /**
   * File › New window (audit G4): another editor window on Home. Desktop only (a browser tab
   * opens a new window itself).
   */
  openNewWindow?(): Promise<void>
  /**
   * Board 44 §4 C: a tab dragged below the strip opens in a new editor window on `ref` (a file
   * on disk). Desktop only; the web reorders tabs only.
   */
  openFileInNewWindow?(ref: FileRef): Promise<void>
  /**
   * Runs before the window closes (and before quit). Resolve false to keep it open (e.g. a
   * save failed); the handler should flush sessions first. One handler per window. `quitting`
   * is true when the window closes because the app quits (desktop), false for a user close.
   */
  onCloseRequested(
    handler: (info: { quitting: boolean }) => Promise<boolean> | boolean,
  ): Unsubscribe
  close(): Promise<void>
}

/** macOS chrome numbers from 02d (Tauri `titleBarStyle: Overlay`, `hiddenTitle`). */
export const MACOS_CHROME = {
  trafficLightPosition: { x: 16, y: 18 },
  /** 16 leading + 3 × 12 lights + 2 × 8 gaps. */
  inset: 68,
  /** Lights hidden in fullscreen; the frame collapses to 4. */
  fullscreenInset: 4,
  topbarHeight: 48,
} as const

// ===============================================================================================
// Settings
// ===============================================================================================

export interface SettingsApi {
  /** Resolves once the values are loaded; `get` returns defaults before that. */
  readonly ready: Promise<void>
  get<K extends SettingKey>(key: K): SettingsSchema[K]
  all(): Settings
  /** Validates, persists and broadcasts (to every window on desktop). `INVALID` for a bad value. */
  set<K extends SettingKey>(key: K, value: SettingsSchema[K]): Promise<void>
  reset(key?: SettingKey): Promise<void>
  onChange(listener: <K extends SettingKey>(key: K, value: SettingsSchema[K]) => void): Unsubscribe
}

// ===============================================================================================
// Launch: file association, deep links, argv
// ===============================================================================================

export interface OpenRequest {
  source: "file-association" | "deep-link" | "argv" | "launch-queue" | "second-instance"
  refs: FileRef[]
  /** From a deep link's `node`. */
  node?: string
  /** From a deep link's `page` (board 27 §1 "Copy link to page"). */
  page?: string
  /**
   * A multiplayer join link (`kimo://join#<relay>/<room>/<token>/<key>`, board 41 section 5), a
   * pairing link (`kimo://pair#...`) or a Kimo Cloud link (`kimo://cloud/invite#<token>`,
   * `kimo://cloud/transfer`, `kimo://cloud/signed-in`): the whole link. `refs` is empty; the app
   * tells them apart and opens the matching route or flow.
   */
  join?: string
}

export interface LaunchApi {
  /** Requests that arrived before the app was ready (cold start). Each is returned once. */
  takeInitialRequests(): Promise<OpenRequest[]>
  /** Requests while running (Finder double-click, `kimo://` link, `kimo open` from a shell). */
  onOpenRequest(listener: (request: OpenRequest) => void): Unsubscribe
}

export type { DeepLink }
