/**
 * The `DocumentHost` core (ADR 0013 §8, ADR 0002): docIds, targeting (never an active-document
 * fallback), no-overwrite file rules, verified saves, renders and file I/O, over a
 * {@link DocumentBackend} that owns the actual documents:
 *
 * - headless / tests: `createMemoryDocumentHost` (FileDocumentProvider + platform leases);
 * - desktop: the hidden document host (`apps/web/src/host`) over the window session manager.
 *
 * Runtime-neutral: the backend supplies file access (a `@kimo/platform` `FilesApi` subset).
 */
import { FORMAT_VERSION, type KimoDocument, SCHEMA_URL, serialize } from "@kimo/core-schema"
import type { DocStore, Revision } from "@kimo/editor-state"
import { resolveAgainstFile } from "@kimo/platform"
import type { DocRef, RevisionToken, ToolImage } from "../envelope"
import type { DocumentHost, HostDocument, HostResult } from "../runtime"
import { formatDocId, parseDocId } from "../topology"
import { journalFor } from "./journal"
import { createSceneService, type SceneService } from "./scene"
import {
  dirname,
  err,
  errorMessage,
  joinPath,
  normalizePath,
  ok,
  pathHash,
  sha256Hex,
  toToken,
} from "./util"

/** Shader sources a `shader` paint may reference (a path relative to the `.kimo`). */
const SHADER_SOURCE = /^\.{1,2}\/(?:[^\\/\s]+\/)*[^\\/\s]+\.(?:glsl|frag|fs|fsh)$/i

/** One document a backend holds. */
export interface BackendDocument {
  /** Canonical absolute path (or `untitled:<id>`). */
  readonly path: string
  readonly store: DocStore
  /** Why edits and saves are refused (newer format, lock, user choice), or null. */
  readOnlyReason(): string | null
  /** File format version of the source. */
  format(): string
  dirty(): boolean
  lastSavedRevision(): Revision | undefined
  /** A UI window shows it (focus works; close only drops the agent's reference). */
  shownInWindow(): boolean
  /** Atomic save with read-back (forced: always writes). */
  save(): Promise<HostResult<{ bytes: number; sha256: string; revision: Revision }>>
  /** Closes it in the backend (flushes unless `discard`). */
  close(options: { discard: boolean }): Promise<void>
}

/** The file operations the core needs (`@kimo/platform` `FilesApi` is assignable). */
export interface HostFiles {
  readText(path: string): Promise<{ text: string; hash: string }>
  readBytes(path: string): Promise<Uint8Array>
  writeTextAtomic(
    path: string,
    text: string,
    options?: { mkdirs?: boolean },
  ): Promise<{ bytes: number; hash: string }>
  writeBytesAtomic(
    path: string,
    bytes: Uint8Array,
    options?: { mkdirs?: boolean },
  ): Promise<{ bytes: number; hash: string }>
  stat(path: string): Promise<{ size: number; mtimeMs: number; kind: "file" | "directory" } | null>
}

export interface DocumentBackend {
  readonly kind: "desktop" | "headless" | "web"
  readonly files: HostFiles
  /** Every open document (windows' and agents'). */
  list(): BackendDocument[]
  /** Opens per `decideOpen` (leases, read-only, LOAD_FAILED). Never writes the file. */
  open(path: string, options: { readOnly: boolean }): Promise<HostResult<BackendDocument>>
  /** Canonical path (symlinks resolved). Default: lexical normalization. */
  canonicalPath?(path: string): Promise<string>
  /** Window view (desktop). */
  focus?(
    path: string,
    ids: string[],
    options: { select: boolean; zoom: "fit" | "keep" | "100" },
  ): Promise<boolean>
  selection?(path: string): string[]
}

export interface CoreHostOptions {
  backend: DocumentBackend
  scene?: SceneService
}

/** The DocRef of a backend document. */
export function docRefFor(d: BackendDocument): DocRef {
  const ref: DocRef = {
    id: formatDocId(pathHash(d.path), d.store.revision.epoch),
    path: d.path,
    dirty: d.dirty(),
    readOnly: d.readOnlyReason() !== null || d.store.readOnly !== null,
  }
  const saved = d.lastSavedRevision()
  if (saved) ref.lastSavedRevision = toToken(saved)
  return ref
}

/** A `DocumentHost` with access to the backend documents (for the runtime and tests). */
export interface CoreDocumentHost extends DocumentHost {
  readonly backend: DocumentBackend
  readonly scene: SceneService
  /** The backend document behind a docId (no staleness check). */
  backendDocument(docId: string): BackendDocument | undefined
  /** The docId currently used for a path, when open. */
  docIdForPath(path: string): string | undefined
  /** Format of a document's source file. */
  formatOf(docId: string): string
  /** Read-only reason, when any. */
  readOnlyReasonOf(docId: string): string | null
}

/** Creates the DocumentHost core over a backend. */
export function createDocumentHost(options: CoreHostOptions): CoreDocumentHost {
  const { backend } = options
  const scene = options.scene ?? createSceneService()

  const toHost = (d: BackendDocument): HostDocument => {
    journalFor(d.store)
    return { ref: docRefFor(d), store: d.store, shownInWindow: d.shownInWindow() }
  }
  const byHash = (h: string) => backend.list().find((d) => pathHash(d.path) === h)
  const find = (docId: string): HostResult<BackendDocument> => {
    const p = parseDocId(docId)
    const d = p ? byHash(p.pathHash) : undefined
    if (!p || !d)
      return err("DOCUMENT_NOT_OPEN", `No open document has id ${docId}.`, {
        suggestion: "Call kimo_get_state for open documents, or kimo_open the file.",
      })
    const current = formatDocId(pathHash(d.path), d.store.revision.epoch)
    if (current !== docId)
      return err("DOCUMENT_NOT_OPEN", `${docId} is stale: the document was reloaded.`, {
        detail: { kind: "stale", currentDocId: current },
        suggestion: `Use docId ${current} (re-read before editing).`,
      })
    return ok(d)
  }
  const canonical = async (path: string) =>
    backend.canonicalPath ? backend.canonicalPath(path) : normalizePath(path)

  const host: CoreDocumentHost = {
    kind: backend.kind,
    backend,
    scene,
    list: () => backend.list().map(toHost),
    get(docId) {
      const r = find(docId)
      return r.ok ? ok(toHost(r.value)) : r
    },
    backendDocument: (docId) => {
      const p = parseDocId(docId)
      return p ? byHash(p.pathHash) : undefined
    },
    docIdForPath(path) {
      const d = backend.list().find((x) => x.path === path)
      return d ? docRefFor(d).id : undefined
    },
    formatOf(docId) {
      return host.backendDocument(docId)?.format() ?? FORMAT_VERSION
    },
    readOnlyReasonOf(docId) {
      const d = host.backendDocument(docId)
      return d ? (d.readOnlyReason() ?? d.store.readOnly?.reason ?? null) : null
    },

    async open(rawPath, opts) {
      const path = await canonical(rawPath)
      const existing = backend.list().find((d) => d.path === path)
      if (existing) return ok({ ...toHost(existing), alreadyOpen: true })
      const r = await backend.open(path, opts)
      if (!r.ok) return r
      return ok({ ...toHost(r.value), alreadyOpen: false })
    },

    async create(rawPath, opts) {
      const path = await canonical(rawPath)
      if (!/\.kimo$/i.test(path))
        return err("INVALID_INPUT", "The path must end in .kimo.", { path: "path" })
      if (backend.list().some((d) => d.path === path) || (await statSafe(backend.files, path)))
        return err("FILE_EXISTS", `${path} already exists; kimo_create never overwrites.`, {
          suggestion: "Open it with kimo_open, or choose another path.",
        })
      const text = serialize(templateDocument(opts.template ?? "blank", opts.name))
      try {
        const w = await backend.files.writeTextAtomic(path, text, { mkdirs: true })
        if (w.hash !== sha256Hex(text))
          return err("INTERNAL", "Read-back of the new file did not match what was written.")
      } catch (e) {
        return err("INTERNAL", `Could not create ${path}: ${errorMessage(e)}`)
      }
      const r = await backend.open(path, { readOnly: false })
      return r.ok ? ok(toHost(r.value)) : r
    },

    async close(docId, opts) {
      const f = find(docId)
      if (!f.ok) return f
      const d = f.value
      let saved = false
      if (d.dirty() && !opts.save && !opts.discard)
        return err("INVALID_INPUT", "The document has unsaved edits.", {
          suggestion: "Pass save=true to save first, or discard=true to drop the edits.",
        })
      if (opts.save && d.dirty()) {
        const s = await host.save(docId)
        if (!s.ok) return s
        saved = true
      }
      if (d.shownInWindow()) return ok({ closed: false, saved })
      await d.close({ discard: opts.discard && !opts.save })
      return ok({ closed: true, saved })
    },

    async save(docId, baseRevision?: RevisionToken) {
      const f = find(docId)
      if (!f.ok) return f
      const d = f.value
      const reason = d.readOnlyReason() ?? d.store.readOnly?.reason ?? null
      if (reason !== null)
        return err("READ_ONLY", `This document is read-only (${reason}); it is never saved.`, {
          suggestion: "Save a copy with kimo_export target=kimo instead.",
        })
      const cur = d.store.revision
      if (baseRevision && (baseRevision.epoch !== cur.epoch || baseRevision.seq !== cur.seq))
        return err(
          "REVISION_CONFLICT",
          `Document is at ${cur.epoch}:${cur.seq}, not ${baseRevision.epoch}:${baseRevision.seq}.`,
          {
            detail: {
              kind: "revision",
              current: toToken(cur),
              changed: journalFor(d.store).changedSince(baseRevision)?.nodes ?? [],
            },
          },
        )
      const s = await d.save()
      if (!s.ok) return s
      // Verified: re-read the file and compare with the reported hash.
      let back: { text: string; hash: string }
      try {
        back = await backend.files.readText(d.path)
      } catch (e) {
        return err("INTERNAL", `Saved, but the read-back failed: ${errorMessage(e)}`, {
          retryable: true,
        })
      }
      if (back.hash !== s.value.sha256)
        return err("INTERNAL", "The file on disk does not match what was written.", {
          retryable: true,
          suggestion: "Another program changed the file; call kimo_save again.",
        })
      const st = await statSafe(backend.files, d.path)
      return ok({
        path: d.path,
        bytes: s.value.bytes,
        sha256: s.value.sha256,
        mtimeMs: st?.mtimeMs ?? Date.now(),
        savedRevision: toToken(s.value.revision),
      })
    },

    async render(docId, ids, opts) {
      const f = find(docId)
      if (!f.ok) return f
      const d = f.value
      const dir = dirname(d.path)
      const r = await scene.render(d.store, ids, opts, async (src) => {
        // Assets, and shader paint sources relative to the document (spec §7.1).
        const shader = SHADER_SOURCE.test(src)
        if (!/^\.\/assets\//.test(src) && !shader) return null
        try {
          return await backend.files.readBytes(
            shader ? resolveAgainstFile(d.path, src) : joinPath(dir, src.slice(2)),
          )
        } catch {
          return null
        }
      })
      if (!r.ok) return r
      return ok(
        r.value.map(({ mimeType, data, nodeId }): ToolImage => ({ mimeType, data, nodeId })),
      )
    },

    async focus(docId, ids, opts) {
      const f = find(docId)
      if (!f.ok) return f
      if (!backend.focus || !f.value.shownInWindow()) return ok({ shown: false })
      return ok({ shown: await backend.focus(f.value.path, ids, opts) })
    },

    selection(docId) {
      const d = host.backendDocument(docId)
      return d && backend.selection ? backend.selection(d.path) : []
    },

    async readFile(path) {
      try {
        return ok(await backend.files.readBytes(await canonical(path)))
      } catch (e) {
        const code = (e as { code?: string }).code
        if (code === "NOT_FOUND" || code === "ENOENT")
          return err("FILE_NOT_FOUND", `${path} does not exist.`)
        return err("INTERNAL", `Cannot read ${path}: ${errorMessage(e)}`)
      }
    },

    async writeFile(rawPath, bytes, overwrite) {
      const path = await canonical(rawPath)
      if (!overwrite && (await statSafe(backend.files, path)))
        return err("FILE_EXISTS", `${path} exists; pass overwrite=true to replace it.`)
      try {
        const w = await backend.files.writeBytesAtomic(path, bytes, { mkdirs: true })
        if (w.hash !== sha256Hex(bytes))
          return err("INTERNAL", `Read-back of ${path} did not match.`, { retryable: true })
        return ok({ bytes: w.bytes, sha256: w.hash })
      } catch (e) {
        return err("INTERNAL", `Cannot write ${path}: ${errorMessage(e)}`)
      }
    },

    canonicalPath: canonical,
  }
  return host
}

async function statSafe(files: HostFiles, path: string) {
  try {
    return await files.stat(path)
  } catch {
    return null
  }
}

// --- Templates ------------------------------------------------------------------------------

/** `kimo_create` starter content (valid documents). */
export function templateDocument(
  template: "blank" | "web" | "mobile" | "design-system" | string,
  name?: string,
): KimoDocument {
  const doc: KimoDocument = { $schema: SCHEMA_URL, format: FORMAT_VERSION, nodes: {} }
  if (name !== undefined) doc.meta = { name }
  const frame = (id: string, label: string, w: number, h: number) => {
    ;(doc.nodes as Record<string, unknown>)[id] = {
      type: "frame",
      parent: null,
      order: "a0",
      name: label,
      x: 0,
      y: 0,
      w,
      h,
      fill: "#FFFFFF",
    }
  }
  if (template === "web") frame("DesktopFrm1", "Desktop", 1440, 1024)
  else if (template === "mobile") frame("MobileFrm01", "Mobile", 390, 844)
  else if (template === "design-system") {
    doc.themes = { mode: ["light", "dark"] }
    doc.variables = {
      "color.bg": {
        type: "color",
        value: [
          { value: "#FFFFFF", when: { mode: "light" } },
          { value: "#0B0B0F", when: { mode: "dark" } },
        ],
      },
      "color.text": {
        type: "color",
        value: [
          { value: "#111111", when: { mode: "light" } },
          { value: "#F5F5F5", when: { mode: "dark" } },
        ],
      },
      "color.primary": { type: "color", value: "#4F46E5" },
      "space.4": { type: "number", value: 16 },
      "radius.md": { type: "number", value: 8 },
    } as KimoDocument["variables"]
    frame("TokensFrm01", "Tokens", 800, 600)
  }
  return doc
}
