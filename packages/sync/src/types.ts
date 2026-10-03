/**
 * M4 provider contracts (ADR 0012): what a document session needs from the `.kimo` file
 * provider on desktop (document host, ADR 0002) and in the CLI, independent of the runtime.
 *
 * Runtime-neutral: no `node:*`, no DOM. `FileProvider` (`@kimo/sync/file`) implements
 * {@link FileSessionProvider} on top of an {@link AtomicFileStore}; on desktop the store is
 * `@kimo/platform`'s `files` API (Rust performs the atomic write and read-back), in Bun/Node it
 * is the existing `nodeFileSystem` + `atomicWrite`.
 */
import type { SyncProvider } from "./provider"

// --- File store --------------------------------------------------------------------------------

/** Result of an atomic write, verified by reading the file back. */
export interface AtomicWriteResult {
  bytes: number
  /** SHA-256 (hex) of the bytes written, equal to the read-back hash. */
  hash: string
}

/**
 * The file operations a document provider needs. `@kimo/platform`'s `FilesApi` has these
 * members with identical signatures, so `platform.files` is assignable to this interface
 * (checked at compile time in `apps/web/src/platform/contract.ts`).
 *
 * Every rejection carries a {@link SaveFailureCode}-compatible `code` (`ENOSPC`, `EACCES`, …
 * or `READ_BACK_MISMATCH`); use {@link classifySaveError}.
 */
export interface AtomicFileStore {
  /** Reads a UTF-8 file and hashes it. Rejects with `code: "ENOENT"` when missing. */
  readText(path: string): Promise<{ text: string; hash: string }>
  /**
   * Temp file in the same directory → fsync → rename over `path` → fsync dir → read back and
   * compare SHA-256. Creates parent directories when `mkdirs` is true. On failure the original
   * file is untouched (a stray temp file may remain).
   */
  writeTextAtomic(
    path: string,
    text: string,
    options?: { mkdirs?: boolean },
  ): Promise<AtomicWriteResult>
  /** Removes a file; resolves when it does not exist. */
  remove(path: string): Promise<void>
}

// --- Save failures -----------------------------------------------------------------------------

/**
 * Why a write failed (board 17 "Failures"): disk full, permission, read-back mismatch, or any
 * other I/O error. Save failures keep the document editable; edits stay in memory and in the
 * recovery file, and autosave retries every {@link SAVE_RETRY_MS}.
 */
export type SaveFailureCode = "DISK_FULL" | "PERMISSION" | "READ_BACK_MISMATCH" | "IO"

/** Retry interval after a failed save (board 17: "retrying every 30 s"). */
export const SAVE_RETRY_MS = 30_000

/** Maps an error from a write to a {@link SaveFailureCode}. */
export function classifySaveError(error: unknown): SaveFailureCode {
  const e = error as { code?: unknown; name?: unknown } | null
  const code = typeof e?.code === "string" ? e.code : ""
  if (e?.name === "SaveVerifyError" || code === "READ_BACK_MISMATCH") return "READ_BACK_MISMATCH"
  if (code === "ENOSPC" || code === "EDQUOT" || code === "DISK_FULL") return "DISK_FULL"
  if (code === "EACCES" || code === "EPERM" || code === "EROFS" || code === "PERMISSION")
    return "PERMISSION"
  return "IO"
}

/** A failed save as reported to the session. */
export interface SaveFailure {
  code: SaveFailureCode
  /** The OS error code when there was one (`ENOSPC`, `EACCES`, …). */
  errno?: string
  path: string
  message: string
  /** Where the edits are safe meanwhile (the recovery file), if it could be written. */
  recoveryPath?: string
  /** Free bytes on the volume when known (board 17: "0 B free on Macintosh HD"). */
  freeBytes?: number
  volume?: string
  at: number
}

// --- Autosave pauses ---------------------------------------------------------------------------

/** Why autosave is paused. Several reasons can hold at once; autosave runs when none does. */
export type AutosavePauseReason =
  /** A git operation is in progress in the file's repository (teardown 9.4). */
  | "git"
  /** The document has open merge conflicts (board 18: autosave stays paused). */
  | "conflicts"
  /** The user turned autosave off (Settings › Files & autosave). */
  | "setting"

// --- External changes --------------------------------------------------------------------------

/**
 * Outcome of reconciling the working file after it changed on disk (board 17 "Changes on
 * disk"). The base of the three-way merge is the last text this provider read or wrote.
 */
export type ExternalChangeOutcome =
  /** The file holds what we last wrote (our own write, a touch): nothing to do. */
  | { kind: "unchanged" }
  /** No local edits: reloaded in place (toast "changed on disk — reloaded", Undo). */
  | { kind: "reloaded"; changedNodes: number }
  /** Local edits merged cleanly (toast "Merged N changes from disk with your M edits"). */
  | { kind: "merged"; changes: number; localEdits: number }
  /** Merged with stored conflicts (toast "… — N conflicts", Review → board 18). */
  | { kind: "conflicts"; conflicts: number; changes: number; localEdits: number }
  /** The file is half-written or unparsable right now; retried on the next change. */
  | { kind: "unreadable"; message: string }
  /** The file was deleted or moved away; the session keeps the document and marks it unsaved. */
  | { kind: "removed" }

/** Snapshot that "Undo" of a reload/merge restores (in memory only; never rewrites the file). */
export interface ReloadUndoToken {
  readonly id: string
  /** Revision of the store before the reload or merge. */
  readonly beforeRevision: { epoch: string; seq: number }
}

// --- Recovery ----------------------------------------------------------------------------------

/** Why a recovery file was written. */
export type RecoveryReason =
  /** Periodic snapshot (Settings: every 30 s, even with autosave off). */
  | "snapshot"
  /** Older-format file awaiting upgrade consent (spec §16.2). */
  | "upgrade-pending"
  /** Git operation: "Stash as recovery file". */
  | "git-stash"
  /** A save failed; the edits are kept here. */
  | "save-failed"
  /** Read-back mismatch: "Your version is in a recovery file". */
  | "read-back-mismatch"
  /** Never saved (Untitled). */
  | "untitled"

/** Result of writing a recovery file. */
export interface RecoveryWrite {
  /** Recovery entry id (`<sha256(path)[:16]>` or `untitled-<docId>`). */
  id: string
  path: string
  bytes: number
  hash: string
}

// --- The session-facing provider ---------------------------------------------------------------

/**
 * The `.kimo` file provider as a document session uses it (M4). Extends the M0 behaviour of
 * `FileProvider` (load → terminal on failure, autosave, atomic write + read-back, recovery for
 * upgrade consent) with pauses, external-change reconciliation, recovery snapshots and typed
 * save failures.
 */
export interface FileSessionProvider extends SyncProvider {
  /** Absolute path of the working file. */
  readonly path: string
  /** True while there are edits newer than the last write. */
  readonly dirty: boolean
  /** True when the provider may write (loaded, not read-only). */
  readonly canSave: boolean
  /** True while autosave goes to the recovery file (older format, no consent yet). */
  readonly needsUpgradeConsent: boolean
  /** Active autosave pauses (empty = autosave runs). */
  readonly pauses: ReadonlySet<AutosavePauseReason>
  /** The last failed save, cleared by the next successful one. */
  readonly lastFailure: SaveFailure | null
  /** Time the current in-flight write started (ms epoch), or null. Drives "Saving…" after 400 ms. */
  readonly writingSince: number | null
  /** Last successful write of the working file. */
  readonly lastSavedAt: number | null

  /** Idle time before an autosave write (Settings: default 2000 ms). */
  setAutosaveMs(ms: number): void
  pauseAutosave(reason: AutosavePauseReason): void
  resumeAutosave(reason: AutosavePauseReason): void

  /** Writes pending edits now (blur, quit, restart for update). Respects pauses unless forced. */
  flush(options?: { ignorePauses?: boolean }): Promise<void>
  /** Explicit save (⌘S): writes the working file; counts as upgrade consent. */
  save(options?: { force?: boolean }): Promise<void>
  /** Accepts the one-time format upgrade and writes the working file. */
  acceptUpgrade(): Promise<void>
  /** Re-reads the working file after a watcher event and reconciles (reload or 3-way merge). */
  reconcileExternalChange(): Promise<ExternalChangeOutcome>
  /** Writes the current document to its recovery file. */
  writeRecovery(reason: RecoveryReason): Promise<RecoveryWrite>
  /** Drops local edits and reloads from disk (git "Discard"). Undoable until the next edit. */
  discardAndReload(): Promise<ReloadUndoToken>
  /** Restores the in-memory document captured by a reload/merge/discard (marks it unsaved). */
  undoReload(token: ReloadUndoToken): Promise<void>
  /** Subscribes to save failures. Returns an unsubscribe function. */
  onSaveFailure(listener: (failure: SaveFailure) => void): () => void
}
