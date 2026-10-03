/**
 * `FileProvider`: `.kimo` working-file persistence for Bun and Node (desktop document server,
 * CLI, headless MCP). Import from `@kimo/sync/file`; the main entry stays free of `node:*`.
 *
 * It is the runtime-neutral {@link FileDocumentProvider} (`./file-session.ts`, the M4
 * `FileSessionProvider`) over the Node file system:
 * - **Load** → parse → version check → migrate → validate (core-schema `openDocument`). A load
 *   that fails is terminal: the provider and the store become read-only, nothing is written.
 * - **Autosave** after `autosaveMs` of idle (default 3 s here; the desktop session uses the
 *   Settings value, 2 s), plus {@link FileProvider.flush} for blur/quit.
 * - **Atomic write**: temp file in the same directory → fsync → rename over the target → read
 *   back and compare SHA-256. A crash leaves the original intact (plus a stray temp file).
 * - **Recovery**: while an older-format file awaits upgrade consent, autosave goes to
 *   `<recoveryDir>/<sha256(path)[:16]>.kimo`, never to the working file; failed saves and
 *   snapshots use the same file.
 */
import { createHash, randomBytes } from "node:crypto"
import * as fsp from "node:fs/promises"
import { homedir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import type { OpenOptions } from "@kimo/editor-state"
import {
  type DocumentMerge,
  FileDocumentProvider,
  type RecoveryStore,
  type RecoveryStoreInput,
} from "./file-session"
import type { AtomicFileStore } from "./types"

export {
  type DocumentMerge,
  FileDocumentProvider,
  type FileDocumentProviderOptions,
  FileLoadError,
  type RecoveryStore,
  type RecoveryStoreInput,
  SaveRefusedError,
  type SaveResult,
} from "./file-session"

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
  readonly code = "READ_BACK_MISMATCH"
  constructor(readonly path: string) {
    super(`Read-back verification failed for ${path}`)
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

/** An {@link AtomicFileStore} over a Node {@link FileSystem}. */
export function nodeAtomicStore(fs: FileSystem = nodeFileSystem): AtomicFileStore {
  return {
    async readText(path) {
      const text = await fs.readFile(path)
      return { text, hash: sha256(text) }
    },
    async writeTextAtomic(path, text, options) {
      if (options?.mkdirs) await fs.mkdirp(dirname(path))
      return atomicWrite(fs, path, text)
    },
    async remove(path) {
      await fs.unlink(path).catch((e: { code?: string }) => {
        if (e?.code !== "ENOENT") throw e
      })
    },
  }
}

/** A recovery store writing `<dir>/<id>.kimo` atomically (no metadata; CLI and tests). */
export function directoryRecoveryStore(
  dir: string,
  fs: FileSystem = nodeFileSystem,
): RecoveryStore {
  const store = nodeAtomicStore(fs)
  return {
    dir,
    async write(input: RecoveryStoreInput) {
      const r = await store.writeTextAtomic(join(dir, `${input.id}.kimo`), input.text, {
        mkdirs: true,
      })
      return { id: input.id, ...r }
    },
    discard: (id) => store.remove(join(dir, `${id}.kimo`)),
  }
}

/** Options for {@link FileProvider}. */
export interface FileProviderOptions {
  /** Path of the `.kimo` working file. */
  path: string
  /** Autosave idle window in ms. Default 3000. */
  autosaveMs?: number
  /** Directory for recovery files. Default `~/.kimo/recovery`. */
  recoveryDir?: string
  /** Recovery snapshot interval while dirty (ms); default off. */
  recoverySnapshotMs?: number | null
  /**
   * When the file does not exist: create a new empty document (with this name when a string)
   * and write it on the first save. Default false (a missing file is a failed load).
   */
  createIfMissing?: boolean | string
  /** Options for core-schema `openDocument` (libraries, asset files, migrations, …). */
  open?: OpenOptions
  /** File system implementation. Default {@link nodeFileSystem}. */
  fs?: FileSystem
  /** Three-way merge for external changes with local edits. */
  merge?: DocumentMerge | null
}

/** Persists a {@link DocStore} to a `.kimo` file on the Node file system. */
export class FileProvider extends FileDocumentProvider {
  constructor(options: FileProviderOptions) {
    const path = resolve(options.path)
    const fs = options.fs ?? nodeFileSystem
    const recoveryDir = resolve(options.recoveryDir ?? join(homedir(), ".kimo", "recovery"))
    super({
      path,
      files: nodeAtomicStore(fs),
      recovery: directoryRecoveryStore(recoveryDir, fs),
      recoveryDir,
      autosaveMs: options.autosaveMs ?? 3000,
      recoverySnapshotMs: options.recoverySnapshotMs ?? null,
      merge: options.merge ?? null,
      ...(options.createIfMissing !== undefined
        ? { createIfMissing: options.createIfMissing }
        : {}),
      ...(options.open ? { open: options.open } : {}),
    })
  }
}
