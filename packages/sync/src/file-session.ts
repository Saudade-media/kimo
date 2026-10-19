/**
 * `FileDocumentProvider`: the runtime-neutral `.kimo` file provider (ADR 0012), implementing
 * {@link FileSessionProvider} on an {@link AtomicFileStore} (`@kimo/platform`'s `files` on
 * desktop and in the browser, the Node file system in `@kimo/sync/file`). No `node:*`, no DOM.
 *
 * Behaviour (teardown 9.3, 9.4, 10.2 rules 6–7; board 17):
 * - **Load** → core-schema `openDocument`. A failed load (unreadable, unparsable, invalid, newer
 *   format, unknown feature) is terminal: read-only, nothing is ever written (no saves, no
 *   autosave, no recovery writes).
 * - **Autosave** after `autosaveMs` of idle (default 2000, Settings › Autosave interval), while
 *   no {@link AutosavePauseReason} holds. Explicit {@link FileDocumentProvider.save} ignores pauses.
 * - **Atomic write + read-back** by the store; failures are classified
 *   ({@link classifySaveError}), the edits are copied to the recovery store, the
 *   {@link SaveFailure} is reported and the save is retried every {@link SAVE_RETRY_MS}.
 * - **Recovery snapshots** every `recoverySnapshotMs` while dirty (even with autosave paused or
 *   off). While an older format awaits consent, autosave goes to the recovery store only.
 * - **External changes**: {@link FileDocumentProvider.reconcileExternalChange} reloads in place
 *   (no local edits) or three-way merges the local edits with the file (injected
 *   {@link DocumentMerge}, core-schema `ThreeWayMerge`); conflicts pause autosave. Every reload,
 *   merge or discard returns an undo token that restores memory only, until the next edit.
 */
import {
  createEmptyDocument,
  type DocStore,
  KimoParseError,
  type OpenOptions,
  type OpenResult,
  openDocument,
  type ReadOnlyReason,
  type Revision,
  serialize,
} from "@kimo/editor-state"
import { BaseProvider, type SyncStatus } from "./provider"
import { recoveryIdFor } from "./sha256"
import {
  type AtomicFileStore,
  type AutosavePauseReason,
  classifySaveError,
  type ExternalChangeOutcome,
  type FileSessionProvider,
  type RecoveryReason,
  type RecoveryWrite,
  type ReloadUndoToken,
  SAVE_RETRY_MS,
  type SaveFailure,
} from "./types"

/** A `.kimo` document as plain data. */
export type KimoDoc = ReturnType<DocStore["toDocument"]>

/**
 * The three-way merge the provider uses for external changes with local edits. core-schema's
 * `ThreeWayMerge` (`mergeDocuments`) is assignable to it; `@kimo/sync` does not import
 * core-schema (teardown 9.1), so callers inject it.
 */
export type DocumentMerge = (input: { base: KimoDoc; ours: KimoDoc; theirs: KimoDoc }) => {
  doc: KimoDoc
  conflicts: Record<string, unknown>
  changes: number
}

/** What the provider writes to the recovery store (same fields as `@kimo/platform`'s). */
export interface RecoveryStoreInput {
  id: string
  sourceRef: string | null
  name: string
  reason: RecoveryReason
  text: string
  edits: number
  lastAutosaveAt?: number | null
  layers?: number
}

/** The recovery store the provider needs. `@kimo/platform`'s `recovery` is assignable to it. */
export interface RecoveryStore {
  /** The recovery directory, or null when it is not a real directory (IndexedDB, memory). */
  readonly dir: string | null
  write(input: RecoveryStoreInput): Promise<{ id: string; bytes: number; hash: string }>
  discard(id: string): Promise<void>
}

/** Outcome of a write. */
export interface SaveResult {
  /** `file`: the working file. `recovery`: the recovery copy (upgrade consent pending). */
  target: "file" | "recovery"
  path: string
  bytes: number
  /** SHA-256 (hex) of the bytes written, verified by read-back. */
  hash: string
  /** Store revision that was written. */
  revision: Revision
}

/** A save was refused (read-only provider, or not attached). */
export class SaveRefusedError extends Error {
  override readonly name = "SaveRefusedError"
  constructor(
    readonly code: "READ_ONLY" | "NOT_ATTACHED",
    message: string,
  ) {
    super(message)
  }
}

/** Why a file opened read-only (teardown 11.2 `LOAD_FAILED` / `READ_ONLY`). */
export class FileLoadError extends Error {
  override readonly name = "FileLoadError"
  constructor(
    /** `LOAD_FAILED`: unreadable or unparsable. `READ_ONLY`: newer format, unknown feature, invalid. */
    readonly code: "LOAD_FAILED" | "READ_ONLY",
    message: string,
    readonly reasons: readonly ReadOnlyReason[] = [],
    options?: { cause?: unknown },
  ) {
    super(message, options)
  }
}

/** Options for {@link FileDocumentProvider}. */
export interface FileDocumentProviderOptions {
  /** Path (or platform `FileRef`) of the `.kimo` working file. */
  path: string
  /** Atomic file operations (`platform.files`). */
  files: AtomicFileStore
  /** Recovery store (`platform.recovery`). Without one, recovery writes are refused. */
  recovery?: RecoveryStore | null
  /** Where recovery files live, for {@link FileDocumentProvider.recoveryPath}. Default `recovery.dir`. */
  recoveryDir?: string | null
  /** Three-way merge for external changes with local edits (core-schema `ThreeWayMerge`). */
  merge?: DocumentMerge | null
  /** Idle time before an autosave write. Default 2000 (Settings › Autosave interval). */
  autosaveMs?: number
  /** Recovery snapshot interval while dirty; null/0 = off. Default null. */
  recoverySnapshotMs?: number | null
  /** Retry interval after a failed save. Default {@link SAVE_RETRY_MS}. */
  retryMs?: number
  /**
   * When the file does not exist: create a new empty document (with this name when a string)
   * and write it on the first save. Default false (a missing file is a failed load).
   */
  createIfMissing?: boolean | string
  /** Options for core-schema `openDocument` (libraries, asset files, migrations, …). */
  open?: OpenOptions
  /** Display name for recovery entries. Default the path's last segment. */
  name?: string
  /** Clock (ms epoch). Default `Date.now`. */
  now?: () => number
  /**
   * Adds derived header data to the document right before it is written (file saves, recovery
   * copies, the "ours" side of a merge), without editing the store: board 28 lists the font
   * assets the text uses in the `assets` manifest here. Must be pure and idempotent.
   */
  prepareWrite?: (doc: KimoDoc) => KimoDoc
  /**
   * Multiplayer (docs/spec/multiplayer.md §16.3): called once on attach with the opened file,
   * before it loads into the (empty) store. Resolves true when it loaded the store itself: a
   * shared file whose room state came first and the file added only its own changes. The
   * provider then treats the file as its merge base without loading it. False loads it as usual.
   */
  openInto?: (doc: KimoDoc, store: DocStore) => Promise<boolean>
  /**
   * Called synchronously with the document right before it is written to the working file; the
   * function it returns runs once the file holds it (the write landed, or the file already had
   * that text). Multiplayer records the store state the shared file corresponds to here.
   */
  onFileWrite?: (doc: KimoDoc) => (() => void) | undefined
}

interface UndoSnapshot {
  id: string
  doc: KimoDoc
  dirty: boolean
  edits: number
  beforeRevision: Revision
}

const errorCode = (e: unknown): string | undefined => {
  const c = (e as { code?: unknown } | null)?.code
  return typeof c === "string" ? c : undefined
}
const isMissing = (e: unknown) => {
  const c = errorCode(e)
  return c === "ENOENT" || c === "NOT_FOUND"
}
const errnoOf = (e: unknown): string | undefined => {
  const x = e as { errno?: unknown; code?: unknown } | null
  if (typeof x?.errno === "string") return x.errno
  if (typeof x?.code === "string" && /^E[A-Z]+$/.test(x.code)) return x.code
  return undefined
}
const lastSegment = (path: string) => path.split(/[/\\]/).pop() || path

let undoSeq = 0

/** Persists a {@link DocStore} to a `.kimo` file: the M4 document-session provider. */
export class FileDocumentProvider extends BaseProvider implements FileSessionProvider {
  /** Path of the working file. */
  readonly path: string
  /** Recovery entry id (`sha256(path)[:16]`). */
  readonly recoveryId: string
  /** Where the recovery copy lives (`<recoveryDir>/<id>.kimo`), or `recovery:<id>` without a dir. */
  readonly recoveryPath: string
  /** Result of the last successful open, if any. */
  openResult: OpenResult | null = null
  /** Why the file is read-only, if it is. */
  loadError: FileLoadError | null = null
  /** The text read when the initial load failed (for the failed-load excerpt). */
  failedText: string | null = null
  lastSave: SaveResult | null = null

  protected readonly files: AtomicFileStore
  private readonly recovery: RecoveryStore | null
  private readonly merge: DocumentMerge | null
  private readonly opts: FileDocumentProviderOptions
  private readonly now: () => number
  private autosaveMs: number
  private snapshotMs: number | null
  private readonly retryMs: number
  private consented = true
  private loaded = false
  private everLoaded = false
  private madeReadOnly = false
  private _dirty = false
  private _edits = 0
  private loading = false
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private off: (() => void) | null = null
  private queue: Promise<unknown> = Promise.resolve()
  /** Last text known to be in the working file (the three-way merge base). */
  private base: string | null = null
  /** Bytes a read-back mismatch left on disk (ignored by reconcile). */
  private mismatchText: string | null = null
  private lastRecoveryText: string | null = null
  private recoveryWritten = false
  private readonly _pauses = new Set<AutosavePauseReason>()
  private _lastFailure: SaveFailure | null = null
  private _writingSince: number | null = null
  private _lastSavedAt: number | null = null
  private _lastEditAt: number | null = null
  private readonly undo = new Map<string, UndoSnapshot>()
  private _lastUndoToken: ReloadUndoToken | null = null
  private readonly failureListeners = new Set<(f: SaveFailure) => void>()
  private readonly changeListeners = new Set<() => void>()

  constructor(options: FileDocumentProviderOptions) {
    super(`file:${options.path}`)
    this.opts = options
    this.path = options.path
    this.files = options.files
    this.recovery = options.recovery ?? null
    this.merge = options.merge ?? null
    this.now = options.now ?? Date.now
    this.autosaveMs = Math.max(0, options.autosaveMs ?? 2000)
    this.snapshotMs = options.recoverySnapshotMs ? Math.max(1, options.recoverySnapshotMs) : null
    this.retryMs = Math.max(1, options.retryMs ?? SAVE_RETRY_MS)
    this.recoveryId = recoveryIdFor(options.path)
    const dir = options.recoveryDir ?? this.recovery?.dir ?? null
    this.recoveryPath = dir
      ? `${dir.replace(/[/\\]+$/, "")}/${this.recoveryId}.kimo`
      : `recovery:${this.recoveryId}`
  }

  // --- FileSessionProvider state ----------------------------------------------------------------

  get canSave(): boolean {
    return this.loaded && this.loadError === null && this._store !== null
  }
  get dirty(): boolean {
    return this._dirty
  }
  get needsUpgradeConsent(): boolean {
    return !this.consented
  }
  get pauses(): ReadonlySet<AutosavePauseReason> {
    return this._pauses
  }
  get lastFailure(): SaveFailure | null {
    return this._lastFailure
  }
  get writingSince(): number | null {
    return this._writingSince
  }
  get lastSavedAt(): number | null {
    return this._lastSavedAt
  }
  /** Edits (committed op groups) newer than the last write of the working file. */
  get edits(): number {
    return this._edits
  }
  /** Time of the last local edit, for "autosave at" (idle timer). */
  get lastEditAt(): number | null {
    return this._lastEditAt
  }
  /** Current autosave idle time. */
  get autosaveDelay(): number {
    return this.autosaveMs
  }
  /** The token of the last reload / merge / discard, while still undoable. */
  get lastUndoToken(): ReloadUndoToken | null {
    return this._lastUndoToken && this.undo.has(this._lastUndoToken.id) ? this._lastUndoToken : null
  }
  /** The text last read from or written to the working file (the three-way merge base). */
  get diskText(): string | null {
    return this.base
  }
  /** True once a recovery copy was written since the last successful file write. */
  get hasRecoveryCopy(): boolean {
    return this.recoveryWritten
  }

  /** Fires on any state change the session renders (dirty, writing, pauses, failure). */
  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener)
    return () => this.changeListeners.delete(listener)
  }

  onSaveFailure(listener: (failure: SaveFailure) => void): () => void {
    this.failureListeners.add(listener)
    return () => this.failureListeners.delete(listener)
  }

  protected override setStatus(status: SyncStatus, error?: Error): void {
    super.setStatus(status, error)
    this.changed()
  }

  private changed(): void {
    for (const l of [...this.changeListeners]) l()
  }

  // --- Lifecycle --------------------------------------------------------------------------------

  async attach(store: DocStore): Promise<void> {
    this.assertDetached()
    this._store = store
    this.setStatus("loading")
    let text: string
    try {
      text = (await this.files.readText(this.path)).text
    } catch (e) {
      if (isMissing(e) && this.opts.createIfMissing) {
        const name =
          typeof this.opts.createIfMissing === "string" ? this.opts.createIfMissing : undefined
        this.withLoading(() => store.loadDocument(createEmptyDocument(name), { origin: "file" }))
        this.loaded = true
        this.everLoaded = true
        this.subscribe()
        this.markDirty()
        return
      }
      this.failLoad(
        new FileLoadError("LOAD_FAILED", `Cannot read ${this.path}: ${(e as Error).message}`, [], {
          cause: e,
        }),
      )
      return
    }
    let result: OpenResult
    try {
      result = openDocument(text, this.opts.open)
    } catch (e) {
      this.failedText = text
      const msg = e instanceof KimoParseError ? e.message : String(e)
      this.failLoad(
        new FileLoadError("LOAD_FAILED", `Cannot parse ${this.path}: ${msg}`, [], { cause: e }),
      )
      return
    }
    let adopted = false
    if (this.opts.openInto && !result.readOnly) {
      // A failing hook leaves the file to load as usual (the session is then not shared).
      adopted = await this.opts.openInto(result.doc, store).catch(() => false)
      if (this._store !== store) return
    }
    this.applyOpened(text, result, adopted)
    if (this.loadError) this.failedText = text
  }

  async detach(options: { flush?: boolean } = {}): Promise<void> {
    if (!this._store) return
    try {
      if (options.flush !== false && this.canSave && this._dirty) {
        if (this._pauses.size > 0 && this.consented) {
          await this.enqueue(() => this.doWriteRecovery("snapshot")).catch(() => {})
        } else {
          await this.writePending()
        }
      }
    } finally {
      this.clearTimers()
      this.off?.()
      this.off = null
      if (this.madeReadOnly) this._store?.setReadOnly(null)
      this.madeReadOnly = false
      this._store = null
      this.loaded = false
      this.everLoaded = false
      this.loadError = null
      this.openResult = null
      this.consented = true
      this.base = null
      this.undo.clear()
      this._pauses.clear()
      this.setStatus("detached")
    }
  }

  // --- Autosave pauses --------------------------------------------------------------------------

  setAutosaveMs(ms: number): void {
    this.autosaveMs = Math.max(0, ms)
    if (this.autosaveTimer !== null) this.scheduleAutosave()
  }

  /**
   * Recovery snapshot interval while dirty (Settings › Recovery snapshots); null turns them off.
   * Applies live: a pending snapshot is rescheduled on the new interval.
   */
  setRecoverySnapshotMs(ms: number | null): void {
    const next = ms ? Math.max(1, ms) : null
    if (next === this.snapshotMs) return
    this.snapshotMs = next
    if (this.snapshotTimer !== null) {
      clearTimeout(this.snapshotTimer)
      this.snapshotTimer = null
      if (this._dirty && this._store) this.ensureSnapshotTimer()
    }
  }

  pauseAutosave(reason: AutosavePauseReason): void {
    if (this._pauses.has(reason)) return
    this._pauses.add(reason)
    if (this.autosaveTimer !== null && this.consented) this.clearAutosave()
    this.changed()
  }

  resumeAutosave(reason: AutosavePauseReason): void {
    if (!this._pauses.delete(reason)) return
    if (this._pauses.size === 0 && this._dirty && this.canSave) this.scheduleAutosave()
    this.changed()
  }

  // --- Writes -----------------------------------------------------------------------------------

  /**
   * Writes pending changes now (to the recovery store while upgrade consent is pending).
   * Respects autosave pauses unless `ignorePauses`. Resolves to null when nothing was written.
   * Rejects on write/verify failure (the changes stay pending and the status becomes `error`).
   */
  async flush(options: { ignorePauses?: boolean } = {}): Promise<void> {
    await this.writePending(options)
  }

  /** {@link flush}, resolving to what was written (null when nothing was). */
  async writePending(options: { ignorePauses?: boolean } = {}): Promise<SaveResult | null> {
    this.clearAutosave()
    if (!this.canSave || !this._dirty) return null
    if (!this.consented) return this.write("recovery", false)
    if (this._pauses.size > 0 && !options.ignorePauses) return null
    return this.write("file", false)
  }

  /** Explicit save (⌘S): writes the working file, counts as upgrade consent, ignores pauses. */
  async save(options: { force?: boolean } = {}): Promise<void> {
    await this.saveFile(options)
  }

  /** {@link save}, resolving to what was written (null when the file already held it). */
  async saveFile(options: { force?: boolean } = {}): Promise<SaveResult | null> {
    this.assertCanSave()
    this.clearAutosave()
    this.consented = true
    return this.write("file", options.force ?? false)
  }

  /** Accepts the one-time format upgrade and writes the working file. */
  async acceptUpgrade(): Promise<void> {
    await this.upgradeAndSave()
  }

  /** {@link acceptUpgrade}, resolving to the write. */
  async upgradeAndSave(): Promise<SaveResult> {
    this.assertCanSave()
    this.consented = true
    return (await this.write("file", true)) as SaveResult
  }

  /** Writes the current document to its recovery entry. */
  writeRecovery(reason: RecoveryReason): Promise<RecoveryWrite> {
    return this.enqueue(() => this.doWriteRecovery(reason))
  }

  // --- External changes -------------------------------------------------------------------------

  /** Re-reads the working file after a watcher event and reconciles (reload or 3-way merge). */
  /**
   * Reconciles the working file after an external change. With `ask` and local edits, nothing
   * is merged: the outcome is `pending` and autosave pauses ("external") until
   * {@link keepLocalVersion} or a reconcile without `ask` (the merge) settles it.
   */
  reconcileExternalChange(options: { ask?: boolean } = {}): Promise<ExternalChangeOutcome> {
    return this.enqueue(async () => {
      const outcome = await this.doReconcile(options.ask ?? false)
      if (outcome.kind !== "pending" && outcome.kind !== "unreadable")
        this.resumeAutosave("external")
      return outcome
    })
  }

  /**
   * "Keep mine" after a `pending` external change: the file on disk becomes the base, so the
   * next save writes the local version over it. Autosave resumes.
   */
  keepLocalVersion(): Promise<void> {
    return this.enqueue(async () => {
      try {
        this.base = (await this.files.readText(this.path)).text
      } catch (e) {
        if (!isMissing(e)) throw e
        this.base = null
      }
      this.mismatchText = null
      this.resumeAutosave("external")
    })
  }

  /**
   * Re-reads the working file when there are no unsaved local edits (M0 hot reload). Returns
   * false, without touching the store, when local edits are pending or the file cannot be
   * parsed right now (status `error`, still writable).
   *
   * @throws {SaveRefusedError} `READ_ONLY` when the initial load failed: that is terminal.
   */
  async reload(): Promise<boolean> {
    this.assertReconcilable()
    if (this._dirty) return false
    const text = (await this.files.readText(this.path)).text
    if (text === this.base && this.loadError === null) return true
    let result: OpenResult
    try {
      result = openDocument(text, this.opts.open)
    } catch (e) {
      this.setStatus("error", this.parseError(e))
      return false
    }
    this.applyOpened(text, result)
    return true
  }

  /** Drops local edits and reloads from disk (git "Discard"). Undoable until the next edit. */
  discardAndReload(): Promise<ReloadUndoToken> {
    return this.enqueue(async () => {
      this.assertReconcilable()
      const text = (await this.files.readText(this.path)).text
      let result: OpenResult
      try {
        result = openDocument(text, this.opts.open)
      } catch (e) {
        throw this.parseError(e)
      }
      const token = this.snapshot()
      this.clearFailure()
      this.applyOpened(text, result)
      return token
    })
  }

  /** Restores the in-memory document captured by a reload/merge/discard (marks it unsaved). */
  undoReload(token: ReloadUndoToken): Promise<void> {
    return this.enqueue(async () => {
      const snap = this.undo.get(token.id)
      const store = this._store
      if (!snap || !store) throw new Error("Undo is no longer available")
      this.undo.clear()
      this._lastUndoToken = null
      if (this.madeReadOnly) {
        store.setReadOnly(null)
        this.madeReadOnly = false
        this.loadError = null
        this.loaded = true
      }
      this.withLoading(() => store.loadDocument(snap.doc, { origin: "file", validate: false }))
      if (!("conflicts" in snap.doc)) this.resumeAutosave("conflicts")
      // Memory only: never rewrites the file by itself (board 17). The next edit or ⌘S does.
      this._dirty = true
      this._edits = Math.max(snap.edits, 1)
      this.clearAutosave()
      this.ensureSnapshotTimer()
      this.setStatus("dirty")
    })
  }

  /**
   * Loads recovered text (launch recovery "Restore") over the opened file: the document becomes
   * the recovered one, unsaved, and autosave writes it as usual. The recovery entry is discarded
   * by the first successful write of the working file.
   */
  restoreFrom(text: string, edits = 1): Promise<void> {
    return this.enqueue(async () => {
      const store = this._store
      if (!store || !this.canSave) throw new SaveRefusedError("READ_ONLY", "File is read-only")
      let result: OpenResult
      try {
        result = openDocument(text, this.opts.open)
      } catch (e) {
        throw this.parseError(e)
      }
      if (result.readOnly) throw new SaveRefusedError("READ_ONLY", "Recovery file is read-only")
      this.withLoading(() => store.loadDocument(result.doc, { origin: "file", validate: false }))
      this.recoveryWritten = true
      this._dirty = true
      this._edits = Math.max(1, edits)
      this._lastEditAt = this.now()
      this.scheduleAutosave()
      this.ensureSnapshotTimer()
      this.setStatus("dirty")
    })
  }

  // --- Internals --------------------------------------------------------------------------------

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(fn)
    this.queue = p.catch(() => {})
    return p
  }

  private assertReconcilable(): void {
    if (!this._store) throw new SaveRefusedError("NOT_ATTACHED", "Provider is not attached")
    if (this.loadError && !this.everLoaded)
      throw new SaveRefusedError("READ_ONLY", this.loadError.message)
  }

  private assertCanSave(): void {
    if (!this._store) throw new SaveRefusedError("NOT_ATTACHED", "Provider is not attached")
    if (!this.canSave)
      throw new SaveRefusedError("READ_ONLY", this.loadError?.message ?? "File is read-only")
  }

  private parseError(e: unknown): FileLoadError {
    const msg = e instanceof KimoParseError ? e.message : String(e)
    return new FileLoadError("LOAD_FAILED", `Cannot parse ${this.path}: ${msg}`, [], { cause: e })
  }

  private snapshot(): ReloadUndoToken {
    const store = this._store as DocStore
    const id = `u${++undoSeq}`
    const snap: UndoSnapshot = {
      id,
      doc: store.toDocument(),
      dirty: this._dirty,
      edits: this._edits,
      beforeRevision: store.revision,
    }
    this.undo.clear()
    this.undo.set(id, snap)
    const token: ReloadUndoToken = { id, beforeRevision: { ...store.revision } }
    this._lastUndoToken = token
    return token
  }

  private async doReconcile(ask = false): Promise<ExternalChangeOutcome> {
    this.assertReconcilable()
    const store = this._store as DocStore
    let text: string
    try {
      text = (await this.files.readText(this.path)).text
    } catch (e) {
      if (isMissing(e)) {
        this.base = null
        this._dirty = true
        this._edits = Math.max(this._edits, 1)
        this.clearAutosave()
        this.setStatus("dirty")
        return { kind: "removed" }
      }
      return { kind: "unreadable", message: (e as Error).message }
    }
    if (text === this.base && this.loadError === null) return { kind: "unchanged" }
    if (this.mismatchText !== null && text === this.mismatchText) return { kind: "unchanged" }
    let result: OpenResult
    try {
      result = openDocument(text, this.opts.open)
    } catch (e) {
      const err = this.parseError(e)
      this.setStatus("error", err)
      return { kind: "unreadable", message: err.message }
    }
    if (!this._dirty) {
      const before = store.toDocument()
      const token = this.snapshot()
      this.applyOpened(text, result)
      this._lastUndoToken = token
      return { kind: "reloaded", changedNodes: countChangedNodes(before, result.doc) }
    }
    if (ask) {
      this.pauseAutosave("external")
      return { kind: "pending" }
    }
    if (result.readOnly)
      return {
        kind: "unreadable",
        message: result.readOnlyReasons.map((r) => r.message).join("; "),
      }
    if (!this.merge) return { kind: "unreadable", message: "No three-way merge is available" }
    let baseDoc: KimoDoc
    try {
      baseDoc = this.base ? openDocument(this.base, this.opts.open).doc : createEmptyDocument()
    } catch {
      baseDoc = createEmptyDocument()
    }
    const merged = this.merge({ base: baseDoc, ours: this.toWrite(store), theirs: result.doc })
    const token = this.snapshot()
    this.withLoading(() => store.loadDocument(merged.doc, { origin: "file", validate: false }))
    this.base = text
    this.mismatchText = null
    this._dirty = true
    const localEdits = Math.max(this._edits, 1)
    this._edits = localEdits
    this._lastUndoToken = token
    const conflicts = Object.keys(merged.conflicts).length
    this.setStatus("dirty")
    this.ensureSnapshotTimer()
    if (conflicts > 0) {
      this.pauseAutosave("conflicts")
      return { kind: "conflicts", conflicts, changes: merged.changes, localEdits }
    }
    this.scheduleAutosave()
    return { kind: "merged", changes: merged.changes, localEdits }
  }

  /** Loads an opened document into the store (read-only when the open result says so). */
  /** `adopted`: the store already holds the document ({@link FileDocumentProviderOptions.openInto}). */
  private applyOpened(text: string, result: OpenResult, adopted = false): void {
    const store = this._store as DocStore
    this.openResult = result
    if (this.madeReadOnly) {
      store.setReadOnly(null)
      this.madeReadOnly = false
    }
    if (!adopted)
      this.withLoading(() => store.loadDocument(result.doc, { origin: "file", validate: false }))
    if (result.readOnly) {
      const msg = result.readOnlyReasons.map((r) => r.message).join("; ")
      this.failLoad(new FileLoadError("READ_ONLY", msg, result.readOnlyReasons))
      return
    }
    this.loaded = true
    this.everLoaded = true
    this.loadError = null
    this.consented = !result.needsUpgradeConsent
    this.base = text
    this.mismatchText = null
    this._dirty = false
    this._edits = 0
    this.clearAutosave()
    this.subscribe()
    this.setStatus("synced")
  }

  /** Read-only store and provider; nothing is written. */
  private failLoad(error: FileLoadError): void {
    this.loadError = error
    this.loaded = false
    this.madeReadOnly = this._store !== null
    this._store?.setReadOnly(error.message)
    this.clearTimers()
    this.setStatus("read-only", error)
  }

  private withLoading(fn: () => void): void {
    this.loading = true
    try {
      fn()
    } finally {
      this.loading = false
    }
  }

  private subscribe(): void {
    this.off?.()
    this.off = (this._store as DocStore).onChange(() => {
      if (!this.loading) this.markDirty()
    })
  }

  private markDirty(): void {
    this._dirty = true
    this._edits++
    this._lastEditAt = this.now()
    // "Undo" of a reload/merge is available until the next edit (board 17).
    this.undo.clear()
    this._lastUndoToken = null
    if (this.status !== "saving") this.setStatus("dirty")
    else this.changed()
    this.scheduleAutosave()
    this.ensureSnapshotTimer()
  }

  private scheduleAutosave(): void {
    this.clearAutosave()
    if (!this.canSave) return
    if (this._pauses.size > 0 && this.consented) return
    this.autosaveTimer = setTimeout(() => {
      this.autosaveTimer = null
      this.writePending().catch(() => {
        // Reported through `lastFailure` / the `error` status; retried every retryMs.
      })
    }, this.autosaveMs)
  }

  private ensureSnapshotTimer(): void {
    if (this.snapshotMs === null || this.snapshotTimer !== null || !this.recovery) return
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = null
      if (!this._dirty || !this.canSave) return
      this.writeRecovery(this.consented ? "snapshot" : "upgrade-pending")
        .catch(() => {})
        .finally(() => {
          if (this._dirty && this._store) this.ensureSnapshotTimer()
        })
    }, this.snapshotMs)
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== null) return
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      if (!this._store || !this._lastFailure) return
      this.writePending().catch(() => {})
    }, this.retryMs)
  }

  private clearAutosave(): void {
    if (this.autosaveTimer !== null) clearTimeout(this.autosaveTimer)
    this.autosaveTimer = null
  }

  private clearTimers(): void {
    this.clearAutosave()
    if (this.snapshotTimer !== null) clearTimeout(this.snapshotTimer)
    this.snapshotTimer = null
    if (this.retryTimer !== null) clearTimeout(this.retryTimer)
    this.retryTimer = null
  }

  private clearFailure(): void {
    this._lastFailure = null
    if (this.retryTimer !== null) clearTimeout(this.retryTimer)
    this.retryTimer = null
  }

  private async doWriteRecovery(reason: RecoveryReason): Promise<RecoveryWrite> {
    const store = this._store
    if (!store || !this.canSave)
      throw new SaveRefusedError("READ_ONLY", "No recovery writes for a read-only file")
    if (!this.recovery) throw new SaveRefusedError("READ_ONLY", "No recovery store")
    const text = serialize(this.toWrite(store))
    // A periodic snapshot keeps the reason of a pending save failure (board 17 copy).
    if (reason === "snapshot" && this._lastFailure)
      reason =
        this._lastFailure.code === "READ_BACK_MISMATCH" ? "read-back-mismatch" : "save-failed"
    const r = await this.recovery.write({
      id: this.recoveryId,
      sourceRef: this.path,
      name: this.opts.name ?? lastSegment(this.path),
      reason,
      text,
      edits: this._edits,
      lastAutosaveAt: this._lastSavedAt,
    })
    if (reason === "git-stash") {
      // A stash is kept for the launch recovery dialog: later saves must not discard it.
      this.recoveryWritten = false
      this.lastRecoveryText = null
    } else {
      this.recoveryWritten = true
      this.lastRecoveryText = text
    }
    return { id: r.id, path: this.recoveryPath, bytes: r.bytes, hash: r.hash }
  }

  /** The document as written ({@link FileDocumentProviderOptions.prepareWrite}). */
  private toWrite(store: { toDocument(): KimoDoc }): KimoDoc {
    const doc = store.toDocument()
    return this.opts.prepareWrite ? this.opts.prepareWrite(doc) : doc
  }

  /** Serialized writes: one at a time, in call order. */
  private write(target: "file" | "recovery", force: boolean): Promise<SaveResult | null> {
    return this.enqueue(async (): Promise<SaveResult | null> => {
      const store = this._store
      if (!store || !this.canSave) throw new SaveRefusedError("READ_ONLY", "File is read-only")
      const revision = store.revision
      const doc = this.toWrite(store)
      const text = serialize(doc)
      const editsAtStart = this._edits
      if (target === "recovery") {
        this._dirty = false
        if (!force && this.lastRecoveryText === text) {
          this.setStatus("synced")
          return null
        }
        this._writingSince = this.now()
        this.setStatus("saving")
        try {
          const r = await this.doWriteRecovery("upgrade-pending")
          const result: SaveResult = {
            target,
            path: r.path,
            bytes: r.bytes,
            hash: r.hash,
            revision,
          }
          this.lastSave = result
          this._writingSince = null
          this.setStatus(this._dirty ? "dirty" : "synced")
          return result
        } catch (e) {
          this._writingSince = null
          this._dirty = true
          this.setStatus("error", e instanceof Error ? e : new Error(String(e)))
          throw e
        }
      }
      this._dirty = false
      const written = this.opts.onFileWrite?.(doc)
      if (!force && this.base === text) {
        written?.()
        this._edits = 0
        this.clearFailure()
        await this.discardRecovery()
        this.setStatus("synced")
        return null
      }
      this._writingSince = this.now()
      this.setStatus("saving")
      try {
        const { bytes, hash } = await this.files.writeTextAtomic(this.path, text)
        written?.()
        this.base = text
        this.mismatchText = null
        this._lastSavedAt = this.now()
        this._edits = Math.max(0, this._edits - editsAtStart)
        const result: SaveResult = { target, path: this.path, bytes, hash, revision }
        this.lastSave = result
        this.clearFailure()
        await this.discardRecovery()
        this._writingSince = null
        this.setStatus(this._dirty ? "dirty" : "synced")
        return result
      } catch (e) {
        this._writingSince = null
        this._dirty = true
        await this.recordFailure(e)
        this.setStatus("error", e instanceof Error ? e : new Error(String(e)))
        throw e
      }
    })
  }

  private async discardRecovery(): Promise<void> {
    if (!this.recoveryWritten || !this.recovery) return
    this.recoveryWritten = false
    this.lastRecoveryText = null
    await this.recovery.discard(this.recoveryId).catch(() => {})
  }

  private async recordFailure(e: unknown): Promise<void> {
    const code = classifySaveError(e)
    const failure: SaveFailure = {
      code,
      path: this.path,
      message: e instanceof Error ? e.message : String(e),
      at: this.now(),
    }
    const errno = errnoOf(e)
    if (errno) failure.errno = errno
    if (code === "READ_BACK_MISMATCH") {
      // What is on disk now is not ours: remember it so the watcher event is not "external".
      this.mismatchText = await this.files
        .readText(this.path)
        .then((r) => r.text)
        .catch(() => null)
      this.base = null
    }
    if (this.recovery) {
      try {
        const r = await this.doWriteRecovery(
          code === "READ_BACK_MISMATCH" ? "read-back-mismatch" : "save-failed",
        )
        failure.recoveryPath = r.path
      } catch {
        // The recovery store failed too (same full disk): edits stay in memory.
      }
    }
    this._lastFailure = failure
    this.scheduleRetry()
    for (const l of [...this.failureListeners]) l(failure)
  }
}

/** Number of nodes added, removed or changed between two documents. */
export function countChangedNodes(a: KimoDoc, b: KimoDoc): number {
  const an = (a.nodes ?? {}) as Record<string, unknown>
  const bn = (b.nodes ?? {}) as Record<string, unknown>
  let n = 0
  for (const id of Object.keys(an))
    if (!(id in bn) || JSON.stringify(an[id]) !== JSON.stringify(bn[id])) n++
  for (const id of Object.keys(bn)) if (!(id in an)) n++
  return n
}
