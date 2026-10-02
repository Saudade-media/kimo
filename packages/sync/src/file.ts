/**
 * `FileProvider`: `.kimo` working-file persistence for Bun and Node (desktop document server,
 * CLI, headless MCP). Import from `@kimo/sync/file`; the main entry stays free of `node:*`.
 *
 * Behaviour (teardown 9.3, 9.4, 10.2 rules 6–7):
 * - **Load** → parse → version check → migrate → validate (core-schema `openDocument`). A load
 *   that fails (unreadable, unparsable, invalid, newer format, unknown feature) is terminal:
 *   the provider and the store become read-only and nothing is ever written.
 * - **Autosave**, at most `autosaveMs` (default 3 s) after the first unsaved change, plus
 *   {@link FileProvider.flush} for blur/quit.
 * - **Canonical serializer** from core-schema, so saves are byte-stable.
 * - **Atomic write**: temp file in the same directory → fsync → rename over the target →
 *   read back and compare SHA-256. A crash leaves the original intact (plus a stray temp file).
 * - **Recovery**: while an older-format file awaits upgrade consent, autosave goes to
 *   `<recoveryDir>/<sha256(path)[:16]>.kimo`, never to the working file, until
 *   {@link FileProvider.acceptUpgrade} or an explicit {@link FileProvider.save}.
 */
import { createHash, randomBytes } from "node:crypto"
import * as fsp from "node:fs/promises"
import { homedir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
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
import { BaseProvider } from "./provider"

/** The file operations the provider needs (injectable for tests and other runtimes). */
export interface FileSystem {
  /** Reads a UTF-8 file. Rejects with `code: "ENOENT"` when it does not exist. */
  readFile(path: string): Promise<string>
  /** Creates/truncates `path`, writes `data` (UTF-8) and fsyncs it before resolving. */
  writeFileDurable(path: string, data: string): Promise<void>
  /** Atomically replaces `to` with `from` (same directory). */
  rename(from: string, to: string): Promise<void>
  unlink(path: string): Promise<void>
  /** Creates a directory and its parents. */
  mkdirp(path: string): Promise<void>
  /** Best-effort fsync of a directory (persists a rename). Optional. */
  syncDir?(path: string): Promise<void>
}

/** {@link FileSystem} on `node:fs/promises` (Bun and Node). */
export const nodeFileSystem: FileSystem = {
  readFile: (path) => fsp.readFile(path, "utf8"),
  async writeFileDurable(path, data) {
    const h = await fsp.open(path, "w", 0o644)
    try {
      await h.writeFile(data, "utf8")
      await h.sync()
    } finally {
      await h.close()
    }
  },
  rename: (from, to) => fsp.rename(from, to),
  unlink: (path) => fsp.unlink(path),
  mkdirp: async (path) => {
    await fsp.mkdir(path, { recursive: true })
  },
  async syncDir(path) {
    try {
      const h = await fsp.open(path, "r")
      try {
        await h.sync()
      } finally {
        await h.close()
      }
    } catch {
      // Not supported everywhere (e.g. Windows); the rename itself is still atomic.
    }
  },
}

/** SHA-256 of a string's UTF-8 bytes, hex. */
export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

/** The read-back after a write did not match what was written. */
export class SaveVerifyError extends Error {
  override readonly name = "SaveVerifyError"
  constructor(readonly path: string) {
    super(`Read-back verification failed for ${path}`)
  }
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

/**
 * Writes `text` to `target` atomically: temp file in the same directory, fsync, rename, then
 * read back and verify the SHA-256. On failure the temp file is removed (best effort) and the
 * original file is untouched.
 */
export async function atomicWrite(
  fs: FileSystem,
  target: string,
  text: string,
): Promise<{ bytes: number; hash: string }> {
  const dir = dirname(target)
  const tmp = join(dir, `.${basename(target)}.${randomBytes(6).toString("hex")}.tmp`)
  try {
    await fs.writeFileDurable(tmp, text)
    await fs.rename(tmp, target)
  } catch (e) {
    await fs.unlink(tmp).catch(() => {})
    throw e
  }
  await fs.syncDir?.(dir)
  const hash = sha256(text)
  const back = await fs.readFile(target)
  if (sha256(back) !== hash) throw new SaveVerifyError(target)
  return { bytes: new TextEncoder().encode(text).byteLength, hash }
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

/** Options for {@link FileProvider}. */
export interface FileProviderOptions {
  /** Path of the `.kimo` working file. */
  path: string
  /** Autosave window in ms: a change is written at most this long after it was made. Default 3000. */
  autosaveMs?: number
  /** Directory for recovery files. Default `~/.kimo/recovery`. */
  recoveryDir?: string
  /**
   * When the file does not exist: create a new empty document (with this name when a string)
   * and write it on the first save. Default false (a missing file is a failed load).
   */
  createIfMissing?: boolean | string
  /** Options for core-schema `openDocument` (libraries, asset files, migrations, …). */
  open?: OpenOptions
  /** File system implementation. Default {@link nodeFileSystem}. */
  fs?: FileSystem
}

const errno = (e: unknown) => (e as { code?: unknown } | null)?.code

/** Persists a {@link DocStore} to a `.kimo` file with autosave, atomic writes and recovery. */
export class FileProvider extends BaseProvider {
  /** Absolute path of the working file. */
  readonly path: string
  /** Where autosaves go while upgrade consent is pending. */
  readonly recoveryPath: string
  /** Result of the last successful open, if any. */
  openResult: OpenResult | null = null
  /** Why the file is read-only, if it is. */
  loadError: FileLoadError | null = null
  lastSave: SaveResult | null = null

  private readonly fs: FileSystem
  private readonly autosaveMs: number
  private consented = true
  private loaded = false
  /** True once a document was loaded writable: later reload failures are not terminal. */
  private everLoaded = false
  /** True while the store's read-only flag was set by this provider (cleared on detach). */
  private madeReadOnly = false
  private _dirty = false
  private loading = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private off: (() => void) | null = null
  private queue: Promise<unknown> = Promise.resolve()
  /** Last text known to be on disk, per path (skips no-op writes). */
  private readonly written = new Map<string, string>()

  constructor(private readonly options: FileProviderOptions) {
    const path = resolve(options.path)
    super(`file:${path}`)
    this.path = path
    this.fs = options.fs ?? nodeFileSystem
    this.autosaveMs = Math.max(0, options.autosaveMs ?? 3000)
    const recoveryDir = options.recoveryDir ?? join(homedir(), ".kimo", "recovery")
    this.recoveryPath = join(resolve(recoveryDir), `${sha256(path).slice(0, 16)}.kimo`)
  }

  /** True when the provider may write (loaded successfully, not read-only). */
  get canSave(): boolean {
    return this.loaded && this.loadError === null && this._store !== null
  }

  /** True when the store has changes not yet written anywhere. */
  get dirty(): boolean {
    return this._dirty
  }

  /** True while autosave goes to the recovery file (older format, no consent yet). */
  get needsUpgradeConsent(): boolean {
    return !this.consented
  }

  async attach(store: DocStore): Promise<void> {
    this.assertDetached()
    this._store = store
    this.setStatus("loading")
    let text: string
    try {
      text = await this.fs.readFile(this.path)
    } catch (e) {
      if (errno(e) === "ENOENT" && this.options.createIfMissing) {
        const name =
          typeof this.options.createIfMissing === "string"
            ? this.options.createIfMissing
            : undefined
        this.withLoading(() => store.loadDocument(createEmptyDocument(name), { origin: "file" }))
        this.loaded = true
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
    this.applyText(text)
  }

  async detach(options: { flush?: boolean } = {}): Promise<void> {
    if (!this._store) return
    try {
      if (options.flush !== false && this.canSave && this._dirty) await this.flush()
    } finally {
      this.clearTimer()
      this.off?.()
      this.off = null
      // The read-only state is this provider's, not the store's: do not leak it to the next one.
      if (this.madeReadOnly) this._store?.setReadOnly(null)
      this.madeReadOnly = false
      this._store = null
      this.loaded = false
      this.everLoaded = false
      this.loadError = null
      this.openResult = null
      this.consented = true
      this.written.clear()
      this.setStatus("detached")
    }
  }

  /**
   * Writes pending changes now (to the recovery file while upgrade consent is pending).
   * Resolves to null when there was nothing to write. Rejects on write/verify failure (the
   * changes stay pending and the status becomes `error`).
   */
  async flush(): Promise<SaveResult | null> {
    this.clearTimer()
    if (!this.canSave || !this._dirty) return null
    return this.write(this.consented ? "file" : "recovery", false)
  }

  /**
   * Explicit save (Cmd+S): always writes the working file — which also counts as consent to
   * upgrade an older format (10.2 rule 6). `force` rewrites even when nothing changed.
   */
  async save(options: { force?: boolean } = {}): Promise<SaveResult | null> {
    this.assertCanSave()
    this.clearTimer()
    this.consented = true
    return this.write("file", options.force ?? false)
  }

  /** Accepts the one-time format upgrade and writes the working file. */
  async acceptUpgrade(): Promise<SaveResult> {
    this.assertCanSave()
    this.consented = true
    return (await this.write("file", true)) as SaveResult
  }

  /**
   * Re-reads the working file (external change) when there are no unsaved local edits.
   * Returns false, without touching the store, when local edits are pending (merging them is
   * the M4 three-way merge) or when the file cannot be parsed (e.g. caught half-written): the
   * status becomes `error` and the session stays writable, so a later reload can recover.
   *
   * @throws {SaveRefusedError} `READ_ONLY` when the initial load failed: that is terminal.
   */
  async reload(): Promise<boolean> {
    if (!this._store) throw new SaveRefusedError("NOT_ATTACHED", "Provider is not attached")
    if (this.loadError && !this.everLoaded)
      throw new SaveRefusedError("READ_ONLY", this.loadError.message)
    if (this._dirty) return false
    const text = await this.fs.readFile(this.path)
    if (text === this.written.get(this.path) && this.loadError === null) return true
    let result: OpenResult
    try {
      result = openDocument(text, this.options.open)
    } catch (e) {
      const msg = e instanceof KimoParseError ? e.message : String(e)
      this.setStatus(
        "error",
        new FileLoadError("LOAD_FAILED", `Cannot parse ${this.path}: ${msg}`, [], { cause: e }),
      )
      return false
    }
    this.applyOpened(text, result)
    return true
  }

  // --- Internals ------------------------------------------------------------------------------

  private applyText(text: string): void {
    let result: OpenResult
    try {
      result = openDocument(text, this.options.open)
    } catch (e) {
      const msg = e instanceof KimoParseError ? e.message : String(e)
      this.failLoad(
        new FileLoadError("LOAD_FAILED", `Cannot parse ${this.path}: ${msg}`, [], { cause: e }),
      )
      return
    }
    this.applyOpened(text, result)
  }

  /** Loads an opened document into the store (read-only when the open result says so). */
  private applyOpened(text: string, result: OpenResult): void {
    const store = this._store as DocStore
    this.openResult = result
    if (this.madeReadOnly) {
      // A previous (re)load made the store read-only; lift it so the new content can load.
      store.setReadOnly(null)
      this.madeReadOnly = false
    }
    // Validated by openDocument (with the caller's libraries/assets); load without re-checking.
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
    this.written.set(this.path, text)
    this._dirty = false
    this.subscribe()
    this.setStatus("synced")
  }

  /**
   * Read-only store and provider; nothing is written. Terminal for the initial load; after a
   * hot reload of a newer/invalid file, a later successful reload lifts it.
   */
  private failLoad(error: FileLoadError): void {
    this.loadError = error
    this.loaded = false
    this.madeReadOnly = this._store !== null
    this._store?.setReadOnly(error.message)
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
    if (this.status !== "saving") this.setStatus("dirty")
    if (this.timer === null) {
      this.timer = setTimeout(() => {
        this.timer = null
        this.flush().catch(() => {
          // Reported through the `error` status; retried on the next change or flush.
        })
      }, this.autosaveMs)
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  private assertCanSave(): void {
    if (!this._store) throw new SaveRefusedError("NOT_ATTACHED", "Provider is not attached")
    if (!this.canSave) {
      throw new SaveRefusedError("READ_ONLY", this.loadError?.message ?? "File is read-only")
    }
  }

  /** Serialized writes: one at a time, in call order. */
  private write(target: "file" | "recovery", force: boolean): Promise<SaveResult | null> {
    const run = async (): Promise<SaveResult | null> => {
      const store = this._store
      if (!store || !this.canSave) throw new SaveRefusedError("READ_ONLY", "File is read-only")
      const revision = store.revision
      const text = serialize(store.toDocument())
      const path = target === "file" ? this.path : this.recoveryPath
      this._dirty = false
      if (!force && this.written.get(path) === text) {
        this.setStatus("synced")
        return null
      }
      this.setStatus("saving")
      try {
        if (target === "recovery") await this.fs.mkdirp(dirname(path))
        const { bytes, hash } = await atomicWrite(this.fs, path, text)
        this.written.set(path, text)
        const result: SaveResult = { target, path, bytes, hash, revision }
        this.lastSave = result
        if (target === "file") await this.fs.unlink(this.recoveryPath).catch(() => {})
        this.setStatus(this._dirty ? "dirty" : "synced")
        return result
      } catch (e) {
        this._dirty = true
        this.setStatus("error", e instanceof Error ? e : new Error(String(e)))
        throw e
      }
    }
    const p = this.queue.then(run)
    this.queue = p.catch(() => {})
    return p
  }
}
