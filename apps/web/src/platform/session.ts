/**
 * M4 document sessions (ADR 0012 §4): `SessionManager` and `DocumentSession` over
 * `@kimo/platform` (host) and `@kimo/sync`'s `FileDocumentProvider` (the
 * `FileSessionProvider`). Works on every host: memory (tests), browser (File System Access /
 * uploads) and, later, Tauri. The UI renders {@link SessionState} only (see `../files`).
 *
 * Lifecycle of one session (contract.ts `DocumentSession`):
 * 1. lease → held elsewhere: read-only view, status `locked`, banner `locked`.
 * 2. read + `openDocument`: unparsable/invalid → `failed-load` (terminal); newer/unknown
 *    feature → `read-only` + `newer-format`; older → `needs-consent` (autosave → recovery).
 * 3. stored conflicts → paused(conflicts) + `merge-conflicts` banner.
 * 4. `git.state`: an operation in progress → paused(git) + `git-operation` banner.
 * 5. watchers (file, git, lease, settings, focus); autosave after `files.autosaveIntervalMs`
 *    idle; recovery snapshots every `files.recoverySnapshotMs` while dirty; flush on blur/close.
 */

import * as coreSchema from "@kimo/core-schema"
import {
  conflictCounts,
  FORMAT_VERSION,
  type KimoDocument,
  KimoParseError,
  listConflicts,
  mergeInfo,
  type OpenOptions as SchemaOpenOptions,
  type ThreeWayMerge,
} from "@kimo/core-schema"
import {
  createDocStore,
  createEmptyDocument,
  type DocStore,
  isLocalOrigin,
  openDocument,
  serialize,
} from "@kimo/editor-state"
import {
  dirnameOf,
  type FileRef,
  type GitChange,
  type GitOperation,
  type GitState,
  isPlatformError,
  KIMO_FILE_FILTER,
  type KimoPlatform,
  type Lease,
  type LeaseHolder,
  type OpenRequest,
  REPO_URL_PLACEHOLDER,
  type RecoveryEntry,
  rebaseRelativeRefs,
  type Unsubscribe,
  type WatchEvent,
} from "@kimo/platform"
import {
  type DocumentMerge,
  FileDocumentProvider,
  type FileLoadError,
  type ReloadUndoToken,
  type SaveFailure,
} from "@kimo/sync"
import {
  type Banner,
  type BannerActionId,
  type ClosePromptChoice,
  type ClosePromptRequest,
  type ConflictSession,
  commitCommand,
  type DocumentSession,
  displayedSaveStatus,
  type FailedLoadDetail,
  GIT_MARKERS_EXPLANATION,
  type GitChoice,
  isUntitledRef,
  type MigrationConsentChoice,
  type MigrationConsentRequest,
  type OpenOptions,
  pickBanner,
  type ReadOnlyCause,
  type RecoveryCandidate,
  type RecoveryChoice,
  type RecoveryDialogChoice,
  type SaveStatus,
  type SessionManager,
  type SessionPhase,
  type SessionState,
  type Toast,
  toastForExternalChange,
  UNTITLED_NAME,
  untitledRecoveryId,
  untitledRef,
} from "./contract"
import { displayPath, fileNameOf, formatTime, majorMinor } from "./format"

/** The nodes stored conflicts are about (prop / node / move conflicts), deduplicated. */
function conflictNodeIds(doc: KimoDocument): string[] {
  const out = new Set<string>()
  for (const { conflict } of listConflicts(doc)) {
    const node = (conflict as { node?: unknown }).node
    if (typeof node === "string") out.add(node)
  }
  return [...out]
}

/** The merge `kimo merge` uses, once `@kimo/core-schema` exports it (M4 merge builder). */
export function defaultMerge(): ThreeWayMerge | null {
  const key = "mergeDocuments"
  const fn = (coreSchema as unknown as Record<string, unknown>)[key]
  return typeof fn === "function" ? (fn as ThreeWayMerge) : null
}

export interface SessionManagerOptions {
  platform: KimoPlatform
  /** Three-way merge for external changes with local edits. Default {@link defaultMerge}. */
  merge?: ThreeWayMerge | null
  /** Store factory. Default `createDocStore()`. */
  createStore?: () => DocStore
  /** Options for `openDocument` (libraries, migrations). */
  openOptions?: SchemaOpenOptions
  /** Clock. Default `Date.now`. */
  now?: () => number
  /** Builds the board 18 conflict session for a session with stored conflicts. */
  createConflictSession?: (session: FileDocumentSession) => ConflictSession | null
  /** Retry interval after a failed save. Default `SAVE_RETRY_MS` (30 s, board 17). */
  saveRetryMs?: number
  /** Recovery entries owned by this process are hidden from the launch dialog. Default true. */
  hideOwnRecovery?: boolean
  /**
   * M5 (ADR 0013 §12, ADR 0002): builds each session. Desktop editor windows pass the document
   * host's factory (`apps/web/src/host`), so the session's store is a replica of the host's and
   * the host owns the lease, autosave and recovery. Default: a local `FileDocumentSession`.
   */
  createSession?: (
    ref: FileRef,
    manager: FileSessionManager,
    store: DocStore,
  ) => FileDocumentSession
}

const READER_FORMAT = majorMinor(FORMAT_VERSION)
const MARKER_RE = /^(<{7}|>{7}|={7})(\s|$)/m

/** Lines changed between two texts (added + removed), the consent dialog's "about N lines". */
export function approxChangedLines(before: string, after: string): number {
  const count = new Map<string, number>()
  for (const l of before.split("\n")) count.set(l, (count.get(l) ?? 0) + 1)
  let added = 0
  for (const l of after.split("\n")) {
    const n = count.get(l) ?? 0
    if (n > 0) count.set(l, n - 1)
    else added++
  }
  let removed = 0
  for (const n of count.values()) removed += n
  return added + removed
}

const truncate = (s: string, n = 52) => (s.length > n ? `${s.slice(0, n)}…` : s)

/** Board 17 "Failed load" card content for a load error. */
export function failedLoadDetail(
  error: FileLoadError | null,
  text: string | null,
): FailedLoadDetail {
  const markers = text !== null && MARKER_RE.test(text)
  const cause = (error as { cause?: unknown } | null)?.cause
  let headline = "Couldn't read this file"
  let explanation = "Kimo couldn't read the file from disk."
  let err: string | null = error?.message ?? null
  let line: number | undefined
  if (cause instanceof KimoParseError) {
    headline = "This file can't be parsed"
    explanation = "The file isn't valid JSON, so Kimo can't open it."
    line = cause.line
    err =
      cause.line !== undefined
        ? `SyntaxError · line ${cause.line}${cause.column !== undefined ? `, column ${cause.column}` : ""}`
        : `SyntaxError · ${cause.message}`
  } else if (error?.code === "READ_ONLY") {
    headline = "This file isn't valid"
    explanation = "It doesn't match the .kimo format, so Kimo opened nothing to edit."
    err = error.reasons.map((r) => r.message).join("; ") || error.message
  }
  if (markers) explanation = GIT_MARKERS_EXPLANATION
  const lines = text?.split("\n") ?? []
  if (line === undefined && markers) {
    const i = lines.findIndex((l) => /^(<{7}|>{7}|={7})/.test(l))
    if (i >= 0) line = i + 1
  }
  const excerpt: FailedLoadDetail["excerpt"] = []
  if (line !== undefined)
    for (let n = Math.max(1, line - 1); n <= Math.min(lines.length, line + 1); n++)
      excerpt.push({ line: n, text: truncate(lines[n - 1] ?? "") })
  return { headline, explanation, error: err, excerpt, gitConflictMarkers: markers }
}

type Listener = (state: SessionState) => void

/** One open `.kimo` file (contract `DocumentSession`). */
export class FileDocumentSession implements DocumentSession {
  readonly store: DocStore
  provider: FileDocumentProvider | null = null
  conflicts: ConflictSession | null = null
  /**
   * Derived header data added to every write of this file without editing the store (board 28:
   * the editor lists the font assets the text uses in the `assets` manifest). Pure, idempotent.
   */
  prepareWrite: (doc: KimoDocument) => KimoDocument = (doc) => doc

  private _ref: FileRef
  private phase: SessionPhase = "opening"
  private readOnlyCause: ReadOnlyCause | null = null
  private lease: Lease | null = null
  private holder: LeaseHolder | null = null
  private lockedDismissed = false
  private failed: FailedLoadDetail | null = null
  private newer: Extract<Banner, { kind: "newer-format" }> | null = null
  private consent: MigrationConsentRequest | null = null
  private git: GitState | null = null
  private gitOperation: GitOperation | null = null
  private gitBannerHidden = false
  private gitChoice: GitChoice | null = null
  private pendingReconcile = false
  private conflictCounts: { open: number; total: number; resolved: number } | null = null
  private mergeReady = false
  /** Board 25 §6 (e): "Commit in terminal…" copied the command (banner says "Copied"). */
  private mergeReadyCopied = false
  /** Board 25 §6 (e): × hides "Ready to commit" until the next git change. */
  private mergeReadyDismissed = false
  /** Conflicts the finished merge resolved (count + their nodes, for "Review changes"). */
  private mergeResolved: { count: number; nodes: string[] } | null = null
  /** Nodes the stored conflicts are about (kept to hand to "Review changes"). */
  private conflictNodes: string[] = []
  /**
   * Board 24 (n): the stored merge was just finished (Mark resolved & save) and not written yet:
   * that save goes through even while git still merges ("resolved AND saved").
   */
  private resolutionUnsaved = false
  /** Board 24 (i): the pending close prompt of a never-saved document. */
  private closeAsk: { request: ClosePromptRequest; resolve(c: ClosePromptChoice): void } | null =
    null
  private toasts: Toast[] = []
  private lastShown: SaveStatus | null = null
  private dirtySince: number | null = null
  private savingTimer: ReturnType<typeof setTimeout> | null = null
  private readonly listeners = new Set<Listener>()
  private readonly unsubs: Unsubscribe[] = []
  private providerUnsubs: Unsubscribe[] = []
  private reconciling: Promise<void> | null = null
  private openedAt: number
  /** Untitled (board 20 V7ey1Q): local edits since the document was created. */
  private untitledEdits = 0
  private untitledTimer: ReturnType<typeof setTimeout> | null = null
  private untitledUnsubs: Unsubscribe[] = []

  constructor(
    ref: FileRef,
    readonly manager: FileSessionManager,
    store: DocStore,
  ) {
    this._ref = ref
    this.store = store
    this.openedAt = manager.now()
  }

  get ref(): FileRef {
    return this._ref
  }
  get fileName(): string {
    return this.untitled ? UNTITLED_NAME : fileNameOf(this._ref)
  }
  /**
   * Never saved yet (board 20 "New file" V7ey1Q): no path, no lease, no provider; edits autosave
   * to the recovery store only, and the first ⌘S opens the native save panel.
   */
  get untitled(): boolean {
    return isUntitledRef(this._ref)
  }
  private get platform(): KimoPlatform {
    return this.manager.platform
  }

  // --- Opening ----------------------------------------------------------------------------------

  /** Runs the lifecycle (lease → load → conflicts → git → watchers). Never rejects. */
  async init(options: OpenOptions = {}): Promise<void> {
    const { platform } = this
    try {
      if (this.untitled) {
        await this.initUntitled()
      } else if (options.readOnly) {
        this.readOnlyCause = "user-choice"
        await this.loadReadOnlyView()
      } else {
        const acquired = await this.acquireLease()
        if (acquired) await this.attachProvider()
        else await this.loadReadOnlyView()
      }
    } catch (e) {
      this.failed = failedLoadDetail(null, null)
      this.failed.error = e instanceof Error ? e.message : String(e)
      this.phase = "failed-load"
      this.readOnlyCause = "failed-load"
    }
    this.unsubs.push(
      platform.settings.onChange((key, value) => {
        const p = this.provider
        if (!p) return
        if (key === "files.autosaveIntervalMs") p.setAutosaveMs(value as number)
        if (key === "files.autosave") {
          if (value) p.resumeAutosave("setting")
          else p.pauseAutosave("setting")
        }
        if (key === "files.pauseAutosaveDuringGit") this.applyGit(this.git)
      }),
      platform.window.onFocusChange((focused) => {
        if (!focused) void this.flushOnBlur()
      }),
    )
    if (this.phase !== "failed-load" && !this.untitled)
      void platform.recents.noteOpened(this._ref).catch(() => {})
    this.emit()
  }

  // --- Untitled ---------------------------------------------------------------------------------

  /** The recovery entry of an untitled document (`untitled-<docId>`). */
  get untitledRecoveryId(): string | null {
    return this.untitled ? untitledRecoveryId(this._ref) : null
  }

  /**
   * Starts an untitled document: an empty one, or what its recovery entry holds (a reload of
   * the window, or "Restore"). Local edits snapshot to recovery after the autosave interval.
   */
  private async initUntitled(): Promise<void> {
    const id = untitledRecoveryId(this._ref)
    const saved = await this.platform.recovery.restore(id).catch(() => null)
    let doc = createEmptyDocument(UNTITLED_NAME)
    if (saved) {
      try {
        doc = openDocument(saved.text, this.manager.openOptions).doc
        this.untitledEdits = saved.entry.edits
        this.openedAt = saved.entry.createdAt
      } catch {
        // An unreadable snapshot starts over (the entry stays for the launch dialog).
      }
    }
    this.store.loadDocument(doc, { origin: "file", validate: false })
    this.store.clearHistory()
    this.phase = "ready"
    this.untitledUnsubs.push(
      this.store.onChange((c) => {
        if (!isLocalOrigin(c.origin)) return
        this.untitledEdits++
        this.scheduleUntitledSnapshot()
        this.emit()
      }),
    )
  }

  private scheduleUntitledSnapshot(): void {
    if (this.untitledTimer !== null) clearTimeout(this.untitledTimer)
    this.untitledTimer = setTimeout(() => {
      this.untitledTimer = null
      void this.writeUntitledSnapshot()
    }, this.platform.settings.get("files.autosaveIntervalMs"))
  }

  /** Writes the untitled document to its recovery entry (autosave target until saved). */
  async writeUntitledSnapshot(): Promise<void> {
    if (!this.untitled || this.untitledEdits === 0) return
    const doc = this.prepareWrite(this.store.toDocument())
    await this.platform.recovery
      .write({
        id: untitledRecoveryId(this._ref),
        sourceRef: null,
        name: UNTITLED_NAME,
        reason: "untitled",
        text: serialize(doc),
        edits: this.untitledEdits,
        lastAutosaveAt: this.manager.now(),
        layers: Object.keys(doc.nodes ?? {}).length,
      })
      .catch(() => {})
  }

  private stopUntitled(): void {
    if (this.untitledTimer !== null) clearTimeout(this.untitledTimer)
    this.untitledTimer = null
    for (const u of this.untitledUnsubs.splice(0)) u()
  }

  /** Takes the per-file lease. False when another live process holds it. */
  private async acquireLease(): Promise<boolean> {
    const { platform } = this
    if (platform.capabilities.leases === "none") return true
    let r: Awaited<ReturnType<KimoPlatform["leases"]["acquire"]>>
    try {
      // A holder whose pid is dead on this host is reclaimed (board 17 "Retry").
      r = await platform.leases.acquire(this._ref, { reclaimStale: true })
    } catch (e) {
      if (isPlatformError(e, "UNSUPPORTED")) return true
      throw e
    }
    if (r.ok) {
      this.lease = r.lease
      this.holder = null
      return true
    }
    this.holder = r.holder
    this.phase = "read-only"
    if (!this.unsubs.some((u) => (u as { lease?: boolean }).lease)) {
      const off = platform.leases.watch(this._ref, (h) => {
        if (this.holder && h && !h.self) {
          this.holder = h
          this.emit()
        }
      }) as Unsubscribe & { lease?: boolean }
      off.lease = true
      this.unsubs.push(off)
    }
    return false
  }

  /** Loads the file for viewing only (locked, or "Open read-only"); no provider, no writes. */
  private async loadReadOnlyView(): Promise<void> {
    let text: string
    try {
      text = (await this.platform.files.readText(this._ref)).text
    } catch (e) {
      this.failed = failedLoadDetail(null, null)
      this.failed.error = e instanceof Error ? e.message : String(e)
      this.phase = "failed-load"
      this.readOnlyCause = "failed-load"
      return
    }
    try {
      const r = openDocument(text, this.manager.openOptions)
      this.store.loadDocument(r.doc, { origin: "file", validate: false })
      this.store.setReadOnly(this.holder ? "Locked by another app" : "Opened read-only")
      this.phase = "read-only"
      this.refreshConflicts()
      await this.readGitOnce()
    } catch (e) {
      const err = new Error(String(e)) as FileLoadError
      Object.assign(err, { code: "LOAD_FAILED", reasons: [], cause: e })
      this.failed = failedLoadDetail(err, text)
      this.phase = "failed-load"
      this.readOnlyCause = "failed-load"
    }
  }

  /** Git state for the topbar without watching or pausing (failed load, read-only views). */
  private async readGitOnce(): Promise<void> {
    if (this.platform.capabilities.git)
      this.git = await this.platform.git.state(this._ref).catch(() => null)
  }

  private async attachProvider(): Promise<void> {
    const { platform, manager } = this
    const settings = platform.settings
    const p = new FileDocumentProvider({
      path: this._ref,
      files: platform.files,
      recovery: platform.recovery,
      merge: manager.merge as DocumentMerge | null,
      autosaveMs: settings.get("files.autosaveIntervalMs"),
      recoverySnapshotMs: settings.get("files.recoverySnapshotMs"),
      ...(manager.openOptions ? { open: manager.openOptions } : {}),
      now: manager.now,
      name: this.fileName,
      ...(manager.saveRetryMs !== undefined ? { retryMs: manager.saveRetryMs } : {}),
      prepareWrite: (doc) => this.prepareWrite(doc as KimoDocument) as typeof doc,
    })
    this.provider = p
    this.providerUnsubs.push(
      p.onChange(() => this.onProviderChange()),
      p.onSaveFailure(() => this.emit()),
    )
    await p.attach(this.store)
    if (p.loadError) {
      const newer = p.loadError.reasons.filter(
        (r) => r.code === "FORMAT_NEWER" || r.code === "FEATURE_UNSUPPORTED",
      )
      if (p.loadError.code === "READ_ONLY" && newer.length === p.loadError.reasons.length) {
        this.setNewer(p)
      } else {
        this.failed = failedLoadDetail(p.loadError, p.failedText)
        this.phase = "failed-load"
        this.readOnlyCause = "failed-load"
        // Terminal: nothing else runs for this window (no watchers, no recovery writes). The
        // topbar still shows where the file lives (folder-git-2 + branch, board 17 TrOIn).
        await this.readGitOnce()
        return
      }
    } else if (p.needsUpgradeConsent) {
      const migrated = serialize(this.store.toDocument())
      this.consent = {
        fileName: this.fileName,
        fromFormat: majorMinor(p.openResult?.sourceFormat),
        toFormat: READER_FORMAT,
        approxChangedLines: approxChangedLines(p.diskText ?? "", migrated),
        minimumReader: READER_FORMAT,
      }
      this.phase = "needs-consent"
    } else {
      this.phase = "ready"
    }
    if (!settings.get("files.autosave")) p.pauseAutosave("setting")
    this.refreshConflicts()
    this.unsubs.push(
      this.store.onChange((c) => {
        if (c.header || this.conflictCounts) this.refreshConflicts()
      }),
    )
    if (platform.capabilities.git) {
      const g = await platform.git.state(this._ref).catch(() => null)
      this.applyGit(g)
      this.unsubs.push(
        platform.git.watch(this._ref, (state, change) => this.onGitChange(state, change)),
      )
    }
    if (platform.capabilities.watch) {
      this.unsubs.push(
        platform.files.watch([this._ref], { debounceMs: 150 }, (events) =>
          this.onFileEvents(events),
        ),
      )
    }
  }

  private setNewer(p: FileDocumentProvider): void {
    const features = (p.loadError?.reasons ?? [])
      .filter((r) => r.code === "FEATURE_UNSUPPORTED")
      .map((r) => /"([^"]+)"/.exec(r.message)?.[1] ?? r.message)
    this.newer = {
      kind: "newer-format",
      severity: "info",
      fileName: this.fileName,
      fileFormat: majorMinor(p.openResult?.sourceFormat),
      features,
      readerFormat: READER_FORMAT,
    }
    this.phase = "read-only"
    this.readOnlyCause = "newer-format"
  }

  // --- Events -----------------------------------------------------------------------------------

  private onProviderChange(): void {
    const p = this.provider
    if (!p) return
    if (p.dirty && this.dirtySince === null) this.dirtySince = this.manager.now()
    if (!p.dirty) this.dirtySince = null
    // Reload/merge toasts offer Undo only while the provider still holds the token.
    const live = p.lastUndoToken?.id ?? null
    this.toasts = this.toasts.filter((t) => !("undo" in t) || t.undo.id === live)
    this.emit()
  }

  private onFileEvents(events: WatchEvent[]): void {
    if (this.phase === "failed-load" || this.phase === "closed") return
    if (!events.some((e) => e.ref === this._ref || e.to === this._ref)) return
    if (this.provider?.pauses.has("git")) {
      // Git rewrites the file several times; reconcile once when the operation finishes.
      this.pendingReconcile = true
      return
    }
    void this.reconcile()
  }

  /** Reconciles the working file after an external change and shows the matching toast. */
  reconcile(): Promise<void> {
    const run = async () => {
      const p = this.provider
      if (!p) return
      try {
        const outcome = await p.reconcileExternalChange()
        const toast = toastForExternalChange(outcome, this.fileName, p.lastUndoToken)
        if (toast) this.pushToast(toast)
        if (p.loadError && this.phase !== "failed-load") this.setNewer(p)
        else if (!p.loadError && this.readOnlyCause === "newer-format") {
          this.readOnlyCause = null
          this.newer = null
          this.phase = p.needsUpgradeConsent ? "needs-consent" : "ready"
        }
        this.refreshConflicts()
      } catch {
        // Terminal load or detached: nothing to reconcile.
      }
      this.emit()
    }
    const prev = this.reconciling ?? Promise.resolve()
    const next = prev.then(run)
    this.reconciling = next
    return next
  }

  private onGitChange(state: GitState | null, _change: GitChange): void {
    // Board 25 §6 (e): any git change brings a dismissed "Ready to commit" back; it leaves for
    // good once git no longer merges (the commit was made, or the merge aborted outside Kimo).
    this.mergeReadyDismissed = false
    if (this.mergeReady && !state?.operation) this.clearMergeReady()
    this.applyGit(state)
    this.emit()
  }

  private applyGit(state: GitState | null): void {
    this.git = state
    const p = this.provider
    if (!p || this.phase === "failed-load") return
    const active = !!state && (state.operation !== null || state.indexLocked)
    const pause = active && this.platform.settings.get("files.pauseAutosaveDuringGit")
    if (pause) {
      if (!p.pauses.has("git")) {
        this.gitBannerHidden = false
        this.gitChoice = null
      }
      this.gitOperation = state?.operation ?? this.gitOperation ?? null
      if (state?.operation) this.gitOperation = state.operation
      p.pauseAutosave("git")
    } else if (p.pauses.has("git")) {
      p.resumeAutosave("git")
      this.gitOperation = null
      const reconcile = this.pendingReconcile || this.gitChoice === "keep"
      this.pendingReconcile = false
      this.gitChoice = null
      this.gitBannerHidden = false
      if (reconcile) void this.reconcile()
    }
  }

  private refreshConflicts(): void {
    const header = this.store.toHeader() as unknown as KimoDocument
    const c = conflictCounts(header)
    const p = this.provider
    if (c.total === 0) {
      if (this.conflictCounts) {
        this.resolutionUnsaved = true
        this.mergeResolved = { count: this.conflictCounts.total, nodes: this.conflictNodes }
      }
      this.conflictCounts = null
      // The editor's conflict session (board 18) holds store listeners: release them.
      ;(this.conflicts as { destroy?: () => void } | null)?.destroy?.()
      this.conflicts = null
      p?.resumeAutosave("conflicts")
    } else {
      this.conflictCounts = c
      this.conflictNodes = conflictNodeIds(header)
      this.resolutionUnsaved = false
      // Board 24 (n): a resolution undone (conflicts back in the file) → the git banner returns;
      // "Ready to commit" shows again after the next Mark resolved & save.
      this.clearMergeReady()
      if (!this.conflicts && this.manager.createConflictSession)
        this.conflicts = this.manager.createConflictSession(this)
      if (c.open > 0) p?.pauseAutosave("conflicts")
      else p?.resumeAutosave("conflicts")
    }
  }

  private pushToast(t: Toast): void {
    // One toast per kind: a newer reload replaces the previous one.
    this.toasts = [...this.toasts.filter((x) => x.kind !== t.kind), t]
  }

  private async flushOnBlur(): Promise<void> {
    const p = this.provider
    if (!p?.canSave || !p.dirty || p.pauses.size > 0) return
    await p.flush().catch(() => {})
  }

  // --- State ------------------------------------------------------------------------------------

  /** The status before the 400 ms "Saving…" rule. */
  actualSaveStatus(): SaveStatus {
    const p = this.provider
    if (this.untitled)
      // Board 20 Zvw7e: SaveStatus/Unsaved reading "Not saved"; autosave goes to recovery.
      return {
        kind: "unsaved",
        dirtySince: this.openedAt,
        autosaveAt: null,
        target: "recovery",
        untitled: true,
      }
    if (this.phase === "failed-load") return { kind: "read-only", cause: "failed-load" }
    if (this.holder && !this.lockedDismissed) return { kind: "locked", holder: this.holder }
    if (this.readOnlyCause === "newer-format") return { kind: "read-only", cause: "newer-format" }
    if (this.readOnlyCause === "user-choice" || this.holder || !p)
      return { kind: "read-only", cause: "user-choice" }
    if (p.lastFailure) return { kind: "failed", failure: p.lastFailure }
    if (p.writingSince !== null && p.needsUpgradeConsent === false)
      return { kind: "saving", since: p.writingSince }
    // Board 20 "Banner priority": stored conflicts from `kimo merge` replace the generic git
    // merge state, in the pill as in the banner (autosave stays paused either way).
    if (p.pauses.has("conflicts") && this.conflictCounts)
      return { kind: "paused", reason: "conflicts", open: this.conflictCounts.open }
    if (p.pauses.has("git")) return { kind: "paused", reason: "git", operation: this.gitOperation }
    if (p.needsUpgradeConsent && p.edits > 0)
      return {
        kind: "unsaved",
        dirtySince: this.dirtySince ?? this.openedAt,
        autosaveAt: null,
        target: "recovery",
      }
    if (p.dirty) {
      const autosaveOn = !p.pauses.has("setting")
      return {
        kind: "unsaved",
        dirtySince: this.dirtySince ?? this.manager.now(),
        autosaveAt: autosaveOn ? (p.lastEditAt ?? this.manager.now()) + p.autosaveDelay : null,
        target: "file",
      }
    }
    return { kind: "saved", savedAt: p.lastSavedAt ?? this.openedAt, ref: this._ref }
  }

  private banners(): Banner[] {
    const out: Banner[] = []
    const p = this.provider
    if (this.phase === "failed-load" && this.failed)
      out.push({
        kind: "failed-load",
        severity: "danger",
        fileName: this.fileName,
        ref: this._ref,
        detail: this.failed,
      })
    if (p?.lastFailure)
      out.push({
        kind: "save-failed",
        severity: "danger",
        fileName: this.fileName,
        failure: p.lastFailure,
      })
    if (this.holder && !this.lockedDismissed)
      out.push({
        kind: "locked",
        severity: "warning",
        fileName: this.fileName,
        holder: this.holder,
      })
    // Board 24 (n): "Ready to commit" replaces the git banner in the same slot once every
    // conflict is resolved and saved (no stored conflicts left).
    const ready = this.mergeReady && !this.conflictCounts
    const showReady = ready && !this.mergeReadyDismissed
    if (p?.pauses.has("git") && !this.gitBannerHidden && !ready)
      out.push({
        kind: "git-operation",
        severity: "warning",
        operation: this.gitOperation,
        unsavedEdits: p.edits,
      })
    // Board 24 (n) step 2: all resolved but not saved yet keeps the banner (CTA "Save").
    if (this.conflictCounts && this.conflictCounts.total > 0)
      out.push({
        kind: "merge-conflicts",
        severity: "warning",
        info: mergeInfo(this.store.toHeader() as unknown as KimoDocument),
        ...this.conflictCounts,
      })
    if (this.newer) out.push(this.newer)
    if (showReady)
      out.push({
        kind: "merge-ready",
        severity: "info",
        fileName: this.fileName,
        command: commitCommand(this.fileName),
        copied: this.mergeReadyCopied,
        ...(this.mergeResolved
          ? { resolved: this.mergeResolved.count, nodes: this.mergeResolved.nodes }
          : {}),
      })
    return out
  }

  state(): SessionState {
    const now = this.manager.now()
    const actual = this.actualSaveStatus()
    const shown = displayedSaveStatus(actual, this.lastShown, now)
    this.lastShown = shown
    if (actual.kind === "saving" && shown !== actual) this.scheduleSavingCheck(actual.since)
    const info = this.conflictCounts
      ? mergeInfo(this.store.toHeader() as unknown as KimoDocument)
      : null
    const branch = this.git?.branch ?? null
    return {
      ref: this._ref,
      fileName: this.fileName,
      phase: this.phase,
      saveStatus: shown,
      banner: pickBanner(this.banners()),
      toasts: [...this.toasts],
      consent: this.phase === "needs-consent" ? this.consent : null,
      branchLabel: info?.ours && info.theirs ? `${info.ours} ← ${info.theirs}` : branch,
      git: this.git,
      conflicts: this.conflictCounts
        ? { open: this.conflictCounts.open, total: this.conflictCounts.total }
        : null,
      unsavedEdits: this.provider?.edits ?? 0,
      closePrompt: this.closeAsk?.request ?? null,
    }
  }

  private scheduleSavingCheck(since: number): void {
    if (this.savingTimer !== null) return
    const wait = Math.max(0, since + 400 - this.manager.now())
    this.savingTimer = setTimeout(() => {
      this.savingTimer = null
      this.emit()
    }, wait + 5)
  }

  subscribe(listener: Listener): Unsubscribe {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(): void {
    if (this.listeners.size === 0) return
    const s = this.state()
    for (const l of [...this.listeners]) l(s)
  }

  // --- Commands ---------------------------------------------------------------------------------

  async save(): Promise<void> {
    // The first ⌘S of an untitled document opens the native save panel (board 20 V7ey1Q).
    if (this.untitled) {
      await this.saveAs()
      return
    }
    const p = this.provider
    if (!p?.canSave || this.readOnlyCause) return
    if (this.phase === "needs-consent") return this.respondToConsent("upgrade")
    if (
      p.pauses.has("git") &&
      this.gitChoice !== "keep" &&
      !this.conflictCounts &&
      !this.resolutionUnsaved
    ) {
      // ⌘S during a git operation asks which of the three to do (board 17 "Do nothing"). With
      // stored conflicts the merge is Kimo's own (`kimo merge`): ⌘S saves them as-is, and
      // "Mark resolved & save" writes the resolved file (board 20 "Banner priority").
      this.gitBannerHidden = false
      this.emit()
      return
    }
    await p.save().catch(() => {})
    if (!p.dirty) this.resolutionUnsaved = false
    this.emit()
  }

  async saveAs(): Promise<FileRef | null> {
    const { platform } = this
    const text = serialize(this.prepareWrite(this.store.toDocument()))
    let target: FileRef | null = null
    const untitled = this.untitled
    try {
      target = await platform.dialogs.saveFile({
        title: "Save as",
        // Untitled: "Untitled.kimo" in the last-used folder (board 20 note h6JPi).
        suggestedName: untitled ? `${UNTITLED_NAME}.kimo` : this.fileName,
        filters: [KIMO_FILE_FILTER],
        ...(untitled
          ? this.manager.lastFolder
            ? { defaultDir: this.manager.lastFolder }
            : {}
          : { defaultDir: dirnameOf(this._ref) }),
      })
    } catch (e) {
      if (!isPlatformError(e, "UNSUPPORTED") && !isPlatformError(e, "CANCELLED")) throw e
    }
    if (!target) {
      if (!platform.capabilities.saveInPlace)
        await platform.files.download(
          this.fileName,
          new TextEncoder().encode(text),
          "application/json",
        )
      return null
    }
    if (platform.capabilities.leases !== "none") {
      const r = await platform.leases.acquire(target).catch(() => null)
      if (r && !r.ok) throw new Error(`${fileNameOf(target)} is locked by ${r.holder.appLabel}`)
      if (r?.ok) {
        if (this.lease) await platform.leases.release(this.lease).catch(() => {})
        this.lease = r.lease
      }
    }
    // Board 27 §8 rule gPEqc: library imports stay relative to the file's new location.
    let out = text
    if (!untitled) {
      const imports = (this.store.toDocument().imports ?? {}) as Record<string, string>
      const rebased = rebaseRelativeRefs(imports, this._ref, target)
      if (rebased) {
        this.store.apply(
          { op: "setHeader", set: { imports: rebased } },
          {
            origin: "user",
            label: "Update library paths",
          },
        )
        out = serialize(this.prepareWrite(this.store.toDocument()))
      }
    }
    await platform.files.writeTextAtomic(target, out, { mkdirs: true })
    this.manager.lastFolder = dirnameOf(target)
    const old = this.provider
    const oldRef = this._ref
    if (old?.hasRecoveryCopy) await platform.recovery.discard(old.recoveryId).catch(() => {})
    if (untitled) {
      // From now on autosave writes the file; the recovery snapshot is no longer needed.
      this.stopUntitled()
      await platform.recovery.discard(untitledRecoveryId(oldRef)).catch(() => {})
    }
    await this.teardownProvider()
    this._ref = target
    this.holder = null
    this.lockedDismissed = false
    this.failed = null
    this.newer = null
    this.readOnlyCause = null
    this.consent = null
    this.toasts = []
    this.store.setReadOnly(null)
    await this.attachProvider()
    void platform.recents.noteOpened(target).catch(() => {})
    this.manager.rekey(this, oldRef)
    this.emit()
    return target
  }

  async flush(): Promise<void> {
    if (this.untitled) {
      await this.writeUntitledSnapshot()
      return
    }
    const p = this.provider
    if (!p?.canSave || !p.dirty) return
    if (p.needsUpgradeConsent) await p.flush()
    else if (p.pauses.has("git")) await p.writeRecovery("snapshot")
    else await p.flush({ ignorePauses: true })
    this.emit()
  }

  async respondToConsent(choice: MigrationConsentChoice): Promise<void> {
    const p = this.provider
    if (!p || this.phase !== "needs-consent") return
    if (choice === "upgrade") {
      this.phase = "ready"
      this.consent = null
      await p.acceptUpgrade().catch(() => {})
    } else {
      this.phase = "read-only"
      this.readOnlyCause = "user-choice"
      this.consent = null
      this.store.setReadOnly("Opened read-only")
    }
    this.emit()
  }

  async respondToGit(choice: GitChoice): Promise<void> {
    const p = this.provider
    if (!p) return
    this.gitChoice = choice
    if (choice === "later") {
      this.gitBannerHidden = false
    } else if (choice === "keep") {
      this.gitBannerHidden = true
    } else {
      if (choice === "stash" && p.dirty) await p.writeRecovery("git-stash")
      const token = await p.discardAndReload()
      this.gitBannerHidden = true
      this.pendingReconcile = false
      this.pushToast({ kind: "external-reloaded", fileName: this.fileName, undo: token })
      this.refreshConflicts()
    }
    this.emit()
  }

  async runAction(id: BannerActionId): Promise<void> {
    const { platform } = this
    const p = this.provider
    switch (id) {
      case "whats-new":
        await platform.files.openExternalUrl(`${REPO_URL_PLACEHOLDER}/releases`).catch(() => {})
        break
      case "update-kimo":
        if (platform.capabilities.updater) await platform.updater.check().catch(() => null)
        else
          await platform.files.openExternalUrl(`${REPO_URL_PLACEHOLDER}/releases`).catch(() => {})
        break
      case "open-read-only":
        this.lockedDismissed = true
        this.readOnlyCause = "user-choice"
        break
      case "retry-lease":
        if (await this.acquireLease()) {
          this.store.setReadOnly(null)
          this.lockedDismissed = false
          this.readOnlyCause = null
          await this.attachProvider()
        }
        break
      case "git-discard":
        return this.respondToGit("discard")
      case "git-stash":
        return this.respondToGit("stash")
      case "git-keep":
        return this.respondToGit("keep")
      case "save-as":
        await this.saveAs()
        break
      case "retry-save":
        if (p) await p.flush({ ignorePauses: true }).catch(() => {})
        break
      case "show-diff":
        // Not designed: shows the recovery copy (Kimo's version) next to the file.
        if (p) await platform.files.reveal(p.recoveryPath).catch(() => {})
        break
      case "reveal":
        await platform.files.reveal(this._ref).catch(() => {})
        break
      case "open-as-text":
        await platform.files.openWithDefaultApp(this._ref).catch(() => {})
        break
      case "next-conflict":
      case "previous-conflict": {
        const c = this.conflicts
        const next = c ? (id === "next-conflict" ? c.next() : c.previous()) : null
        if (c && next) c.focus(next)
        break
      }
      case "mark-resolved-save":
        await this.conflicts?.markResolvedAndSave().catch(() => {})
        break
      case "copy-commit-command": {
        // Board 25 §6 (e): copy, confirm "Copied"; the banner stays until git is clean.
        await globalThis.navigator?.clipboard
          ?.writeText(commitCommand(this.fileName))
          .catch(() => {})
        this.mergeReadyCopied = true
        break
      }
      case "review-changes":
        // Handled by the editor (BannerHost `onReview`: select + reveal `nodes`).
        break
    }
    this.emit()
  }

  /** Board 18 "Ready to commit" (after Mark resolved & save while MERGE_HEAD exists). */
  showMergeReady(show = true): void {
    if (show) {
      this.mergeReady = true
      this.mergeReadyCopied = false
      this.mergeReadyDismissed = false
    } else this.clearMergeReady()
    this.emit()
  }

  /** Board 25 §6 (e) Dismiss (×): hides "Ready to commit" until the next git change. */
  dismissMergeReady(): void {
    this.mergeReadyDismissed = true
    this.emit()
  }

  private clearMergeReady(): void {
    this.mergeReady = false
    this.mergeReadyCopied = false
    this.mergeReadyDismissed = false
  }

  /** Adds a toast (merge-saved, update toasts) from outside the session. */
  addToast(toast: Toast): void {
    this.pushToast(toast)
    this.emit()
  }

  async undoExternal(token: ReloadUndoToken): Promise<void> {
    const p = this.provider
    if (!p) return
    await p.undoReload(token)
    this.toasts = this.toasts.filter((t) => !("undo" in t) || t.undo.id !== token.id)
    this.refreshConflicts()
    this.emit()
  }

  dismissToast(index: number): void {
    this.toasts = this.toasts.filter((_, i) => i !== index)
    this.emit()
  }

  /** True when the last save failed and edits are not on disk. */
  get saveFailed(): boolean {
    return !!this.provider?.lastFailure && !!this.provider.dirty
  }

  // --- Board 24 (i): closing a never-saved document -------------------------------------------

  /** A never-saved document with edits: closing it would lose them. */
  get needsClosePrompt(): boolean {
    return this.untitled && this.untitledEdits > 0 && this.phase !== "closed"
  }

  /** Top-level frames of the document (the close prompt's "its 12 frames"). */
  topLevelFrames(): number {
    const doc = this.store.toDocument() as unknown as {
      nodes?: Record<string, { type?: string; parent?: string | null }>
    }
    let n = 0
    for (const node of Object.values(doc.nodes ?? {}))
      if (node && node.type === "frame" && (node.parent ?? null) === null) n++
    return n
  }

  /**
   * Asks before a never-saved document goes away (tab ×, ⌘W, window close). Resolves true when
   * it may close: saved through Save…, or Don't save (its recovery entry is discarded). Cancel /
   * Escape, or a cancelled save panel, resolve false. Saved-before files never ask (autosave
   * already wrote them).
   */
  async confirmClose(): Promise<boolean> {
    if (!this.needsClosePrompt) return true
    const choice = await this.askClose()
    if (choice === "cancel") return false
    if (choice === "discard") {
      this.stopUntitled()
      this.untitledEdits = 0
      await this.platform.recovery.discard(untitledRecoveryId(this._ref)).catch(() => {})
      return true
    }
    const ref = await this.saveAs().catch(() => null)
    return ref !== null && !this.untitled
  }

  private askClose(): Promise<ClosePromptChoice> {
    // A second request (window close while the tab prompt shows) joins the pending one.
    const pending = this.closeAsk
    if (pending)
      return new Promise((resolve) => {
        const prev = pending.resolve
        pending.resolve = (c) => {
          prev(c)
          resolve(c)
        }
      })
    return new Promise((resolve) => {
      this.closeAsk = {
        request: { fileName: this.fileName, frames: this.topLevelFrames() },
        resolve,
      }
      this.emit()
    })
  }

  /** The prompt's answer (Save… / Don't save / Cancel). */
  respondToClose(choice: ClosePromptChoice): void {
    const ask = this.closeAsk
    if (!ask) return
    this.closeAsk = null
    this.emit()
    ask.resolve(choice)
  }

  /** Board 24 (i) close: asks first for a never-saved document, then {@link close}. */
  async requestClose(): Promise<boolean> {
    if (!(await this.confirmClose())) return false
    return this.close()
  }

  async close(): Promise<boolean> {
    if (this.phase === "closed") return true
    await this.flush().catch(() => {})
    if (this.saveFailed) {
      this.emit()
      return false
    }
    await this.dispose()
    return true
  }

  /** Stops everything without flushing (window gone). */
  async dispose(): Promise<void> {
    this.stopUntitled()
    for (const u of this.unsubs.splice(0)) u()
    if (this.savingTimer !== null) clearTimeout(this.savingTimer)
    await this.teardownProvider()
    if (this.lease) await this.platform.leases.release(this.lease).catch(() => {})
    this.lease = null
    this.phase = "closed"
    this.manager.forget(this)
    this.emit()
  }

  private async teardownProvider(): Promise<void> {
    for (const u of this.providerUnsubs.splice(0)) u()
    const p = this.provider
    this.provider = null
    if (p) await p.detach({ flush: false }).catch(() => {})
  }

  /** Last failure (for tests and the lease/save popovers). */
  get failure(): SaveFailure | null {
    return this.provider?.lastFailure ?? null
  }
}

/** The app's sessions (contract `SessionManager`). */
export class FileSessionManager implements SessionManager {
  readonly platform: KimoPlatform
  readonly merge: ThreeWayMerge | null
  readonly openOptions: SchemaOpenOptions | undefined
  readonly now: () => number
  readonly createConflictSession: SessionManagerOptions["createConflictSession"]
  readonly saveRetryMs: number | undefined
  private readonly createStore: () => DocStore
  private readonly createSession: SessionManagerOptions["createSession"]
  private readonly hideOwn: boolean
  private readonly byRef = new Map<FileRef, FileDocumentSession>()
  private readonly opening = new Map<FileRef, Promise<FileDocumentSession>>()
  private readonly listeners = new Set<() => void>()
  private offClose: Unsubscribe | null = null
  private offOpen: Unsubscribe | null = null
  /** The folder of the last Save as / open (the untitled save panel starts there). */
  lastFolder: FileRef | null = null

  constructor(options: SessionManagerOptions) {
    this.platform = options.platform
    this.merge = options.merge === undefined ? defaultMerge() : options.merge
    this.openOptions = options.openOptions
    this.now = options.now ?? Date.now
    this.createConflictSession = options.createConflictSession
    this.createStore = options.createStore ?? (() => createDocStore())
    this.createSession = options.createSession
    this.hideOwn = options.hideOwnRecovery ?? true
    this.saveRetryMs = options.saveRetryMs
  }

  /** Flush-before-close and launch requests (call once per window). */
  install(onOpened?: (session: FileDocumentSession, request: OpenRequest) => void): Unsubscribe {
    this.offClose = this.platform.window.onCloseRequested(async () => {
      // Board 24 (i): never-saved documents ask first; Cancel keeps the window open.
      if (!(await this.confirmCloseAll())) return false
      return (await this.flushAll()).ok
    })
    this.offOpen = this.platform.launch.onOpenRequest((req) => {
      void this.handleOpenRequest(req).then(() => {
        const s = req.refs[0] ? this.byRef.get(req.refs[0]) : undefined
        if (s) onOpened?.(s, req)
      })
    })
    return () => {
      this.offClose?.()
      this.offOpen?.()
    }
  }

  async open(ref: FileRef, options: OpenOptions = {}): Promise<FileDocumentSession> {
    const existing = this.byRef.get(ref)
    if (existing) return existing
    const pending = this.opening.get(ref)
    if (pending) return pending
    if (!isUntitledRef(ref)) this.lastFolder = dirnameOf(ref)
    const p = (async () => {
      const store = this.createStore()
      const session = this.createSession
        ? this.createSession(ref, this, store)
        : new FileDocumentSession(ref, this, store)
      this.byRef.set(ref, session)
      await session.init(options)
      this.changed()
      return session
    })()
    this.opening.set(ref, p)
    try {
      return await p
    } finally {
      this.opening.delete(ref)
    }
  }

  /**
   * Board 20 "New file" (desktop): an untitled document that opens immediately, autosaves to
   * recovery only, and asks where on its first ⌘S. Route to `diskPath(session.ref)`.
   */
  async newUntitled(): Promise<FileDocumentSession> {
    return this.open(untitledRef(newUntitledId()))
  }

  get(ref: FileRef): FileDocumentSession | undefined {
    return this.byRef.get(ref)
  }

  sessions(): FileDocumentSession[] {
    return [...this.byRef.values()]
  }

  /** Fires when sessions open, close or move (Save as). */
  subscribe(listener: () => void): Unsubscribe {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private changed(): void {
    for (const l of [...this.listeners]) l()
  }

  /** @internal Session moved to a new ref (Save as). */
  rekey(session: FileDocumentSession, oldRef: FileRef): void {
    if (this.byRef.get(oldRef) === session) this.byRef.delete(oldRef)
    this.byRef.set(session.ref, session)
    this.changed()
  }

  /** @internal Session closed. */
  forget(session: FileDocumentSession): void {
    for (const [ref, s] of this.byRef) if (s === session) this.byRef.delete(ref)
    this.changed()
  }

  async recoveryCandidates(): Promise<RecoveryCandidate[]> {
    const entries = await this.platform.recovery.list().catch(() => [] as RecoveryEntry[])
    const open = new Set(
      this.sessions().map((s) => s.provider?.recoveryId ?? s.untitledRecoveryId ?? undefined),
    )
    return entries
      .filter((e) => !(this.hideOwn && e.ownerAlive) && !open.has(e.id))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((entry) => recoveryCandidate(entry))
  }

  async resolveRecovery(id: string, choice: RecoveryChoice): Promise<FileDocumentSession | null> {
    const { platform } = this
    if (choice === "discard") {
      await platform.recovery.discard(id)
      return null
    }
    const { entry, text } = await platform.recovery.restore(id)
    if (choice === "restore" && entry.sourceRef) {
      const session = await this.open(entry.sourceRef, { source: "recovery" })
      if (session.provider?.canSave) await session.provider.restoreFrom(text, entry.edits)
      return session
    }
    const target = await platform.dialogs.saveFile({
      title: "Save as",
      suggestedName: entry.name.endsWith(".kimo") ? entry.name : `${entry.name}.kimo`,
      filters: [KIMO_FILE_FILTER],
    })
    if (!target) return null
    await platform.files.writeTextAtomic(target, text, { mkdirs: true })
    await platform.recovery.discard(id)
    return this.open(target, { source: "recovery" })
  }

  async resolveRecoveryDialog(choice: RecoveryDialogChoice): Promise<void> {
    if (choice === "decide-later") return
    const candidates = await this.recoveryCandidates()
    for (const c of candidates) {
      if (choice === "discard-all") await this.platform.recovery.discard(c.entry.id)
      else if (c.entry.sourceRef) await this.resolveRecovery(c.entry.id, "restore")
    }
  }

  /** Board 24 (i): asks for every never-saved document with edits, in order; false on Cancel. */
  async confirmCloseAll(): Promise<boolean> {
    for (const s of this.sessions()) if (!(await s.confirmClose())) return false
    return true
  }

  async flushAll(): Promise<{ ok: boolean; failed: FileRef[] }> {
    const failed: FileRef[] = []
    for (const s of this.sessions()) {
      await s.flush().catch(() => {})
      if (s.saveFailed) failed.push(s.ref)
    }
    return { ok: failed.length === 0, failed }
  }

  async handleOpenRequest(request: OpenRequest): Promise<void> {
    for (const ref of request.refs) {
      await this.open(ref, {
        source: request.source,
        ...(request.node ? { node: request.node } : {}),
      })
    }
  }

  /** Closes every session (window teardown). */
  async dispose(): Promise<void> {
    this.offClose?.()
    this.offOpen?.()
    for (const s of this.sessions()) await s.dispose()
  }
}

/** Board 17 RecoveryItem copy for an entry. */
export function recoveryCandidate(entry: RecoveryEntry): RecoveryCandidate {
  const untitled = entry.sourceRef === null
  const badge = untitled ? "never saved" : `${entry.edits} edit${entry.edits === 1 ? "" : "s"}`
  let detail: string
  if (untitled) {
    detail = `Created ${formatTime(entry.createdAt)}${entry.layers !== undefined ? ` · ${entry.layers} layers` : ""}`
  } else {
    const parts = [
      entry.lastAutosaveAt !== null
        ? `Last autosave ${formatTime(entry.lastAutosaveAt)}`
        : `Saved to recovery ${formatTime(entry.updatedAt)}`,
    ]
    if (entry.sourceChangedSince === false) parts.push("file unchanged on disk since")
    else if (entry.sourceChangedSince === true) parts.push("file changed on disk since")
    else if (entry.ownerExitedAt !== null)
      parts.push(`quit unexpectedly ${formatTime(entry.ownerExitedAt)}`)
    detail = parts.join(" · ")
  }
  return {
    entry,
    badge,
    location: untitled ? "not on disk yet" : displayPath(entry.sourceRef as string),
    detail,
    choices: untitled ? ["discard", "save-as"] : ["save-as", "discard", "restore"],
  }
}

/** A fresh untitled document id (10 base-36 chars, like node ids). */
function newUntitledId(): string {
  const bytes = new Uint8Array(8)
  globalThis.crypto.getRandomValues(bytes)
  return [...bytes]
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 10)
}

/** Creates the app's session manager. */
export function createSessionManager(options: SessionManagerOptions): FileSessionManager {
  return new FileSessionManager(options)
}
