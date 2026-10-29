/**
 * The headless in-memory document host (ADR 0013 §8): `kimo mcp --headless` and tests. Each
 * open file is a `DocStore` attached to a `FileDocumentProvider` (atomic save + read-back,
 * recovery, 2 s idle autosave) over a `@kimo/platform` host (memory, or the CLI's Node-backed
 * one), with the per-file lease. Failed loads are terminal (never saved); a newer format opens
 * read-only; a lease held by another live process is DOCUMENT_LOCKED unless `readOnly`.
 * Approvals are denied (no UI). Runs in Bun, Node and browsers.
 */
import {
  createDocStore,
  type DocStore,
  type OpenOptions,
  openDocument,
  type Revision,
} from "@kimo/editor-state"
import type { KimoPlatform, Lease, LeaseHolder } from "@kimo/platform"
import { FileDocumentProvider, SaveRefusedError } from "@kimo/sync"
import type { ActivityEntry, ClientPolicy } from "../policy"
import type { DispatchOptions, HostResult } from "../runtime"
import { decideOpen, type LeaseView } from "../topology"
import type { ActivityStore } from "./activity"
import {
  type BackendDocument,
  type CoreDocumentHost,
  createDocumentHost,
  type DocumentBackend,
  type HostFiles,
} from "./core-host"
import { createMcpHostRuntime, type McpHostRuntime } from "./host-runtime"
import { journalFor } from "./journal"
import { createSceneService, type SceneService, type SceneServiceOptions } from "./scene"
import type { ToolHandlerOptions } from "./tools"
import { err, errorMessage, normalizePath, ok } from "./util"
import type { BackendView } from "./views"

export interface MemoryDocumentHostOptions {
  /** Files, leases and recovery (`createMemoryPlatform()` in tests; the CLI's Node platform). */
  platform: KimoPlatform
  /** Reported host kind. Default `headless`. */
  kind?: "headless" | "desktop" | "web"
  /** Idle autosave in ms; 0 = only `kimo_save` writes. Default 2000. */
  autosaveMs?: number
  /** Canonical path (symlinks resolved; the CLI passes `fs.realpath`). Default lexical. */
  canonicalPath?: (path: string) => Promise<string>
  /** Layout/raster service or its options. */
  scene?: SceneService | SceneServiceOptions
  /** `openDocument` options (libraries, migrations). */
  openOptions?: OpenOptions
  /** Policy for every client (default HEADLESS_POLICY; `--files` globs go in `files`). */
  clientPolicy?: ClientPolicy
  /** Activity persistence (default memory). */
  activity?: ActivityStore
  onActivity?: (fileId: string, entry: ActivityEntry) => void
  /** Approvals: default `deny` (no UI). */
  approvals?: "ask" | "deny"
  handlerOptions?: ToolHandlerOptions
  /** Input validation for `runtime` calls (pass `validateInput` from `@kimo/mcp-server/server`). */
  validate?: DispatchOptions["validate"]
  now?: () => number
}

/** The headless host: a `DocumentHost` plus its runtime and lifecycle helpers. */
export interface MemoryDocumentHost extends CoreDocumentHost {
  /** Connections, approvals (denied), activity, presence. */
  readonly runtime: McpHostRuntime
  /** Test hook (#78): the editor windows' records, as the desktop host keeps them. */
  setViews(views: BackendView[]): void
  /** Saves every dirty document; failures write a recovery file instead. */
  flushAll(): Promise<{ saved: string[]; recovered: string[]; failed: string[] }>
  /** Flushes, closes every document and releases leases (stdin EOF / SIGTERM). */
  dispose(): Promise<void>
}

const leaseView = (h: LeaseHolder): LeaseView => ({
  pid: h.pid,
  app: h.app,
  appLabel: h.appLabel,
  alive: h.alive,
  self: h.self,
})

interface Entry extends BackendDocument {
  provider: FileDocumentProvider | null
  lease: Lease | null
}

/** Creates the headless in-memory document host. */
export function createMemoryDocumentHost(options: MemoryDocumentHostOptions): MemoryDocumentHost {
  const { platform } = options
  const kind = options.kind ?? "headless"
  const autosaveMs = options.autosaveMs ?? 2000
  const docs = new Map<string, Entry>()
  const files = platform.files as unknown as HostFiles

  const makeEntry = (
    path: string,
    store: DocStore,
    provider: FileDocumentProvider | null,
    lease: Lease | null,
    readOnlyReason: string | null,
    format: string,
  ): Entry => {
    let lastSaved: Revision | undefined = store.revision
    provider?.onChange(() => {
      if (!provider.dirty) lastSaved = store.revision
    })
    const entry: Entry = {
      path,
      store,
      provider,
      lease,
      readOnlyReason: () => readOnlyReason,
      format: () => format,
      dirty: () => provider?.dirty ?? false,
      lastSavedRevision: () => lastSaved,
      shownInWindow: () => false,
      async save() {
        if (!provider?.canSave) return err("READ_ONLY", "This document cannot be saved.")
        try {
          const r = await provider.saveFile({ force: true })
          if (!r) return err("INTERNAL", "Nothing was written.")
          lastSaved = r.revision
          return ok({ bytes: r.bytes, sha256: r.hash, revision: r.revision })
        } catch (e) {
          if (e instanceof SaveRefusedError) return err("READ_ONLY", e.message)
          return err("INTERNAL", `Save failed: ${errorMessage(e)}`, {
            retryable: true,
            detail: { kind: "save", code: (e as { code?: string }).code ?? "UNKNOWN" },
          })
        }
      },
      async close({ discard }) {
        docs.delete(path)
        try {
          await provider?.detach({ flush: !discard })
        } catch {
          if (provider?.canSave && provider.dirty)
            await provider.writeRecovery("save-failed").catch(() => {})
        }
        if (lease) await platform.leases.release(lease).catch(() => {})
        journalFor(store).dispose()
        store.destroy()
      },
    }
    docs.set(path, entry)
    return entry
  }

  let views: BackendView[] = []
  const backend: DocumentBackend = {
    kind,
    files,
    list: () => [...docs.values()],
    views: () => views,
    canonicalPath: async (p) =>
      normalizePath(options.canonicalPath ? await options.canonicalPath(p) : p),
    async open(path, { readOnly }): Promise<HostResult<BackendDocument>> {
      if (readOnly) {
        let text: string
        try {
          text = (await platform.files.readText(path)).text
        } catch (e) {
          const code = (e as { code?: string }).code
          if (code === "NOT_FOUND" || code === "ENOENT")
            return err("FILE_NOT_FOUND", `${path} does not exist.`)
          return err("LOAD_FAILED", `Cannot read ${path}: ${errorMessage(e)}`)
        }
        try {
          const r = openDocument(text, options.openOptions)
          const store = createDocStore()
          store.loadDocument(r.doc, { origin: "file", validate: false })
          store.setReadOnly("Opened read-only")
          return ok(
            makeEntry(path, store, null, null, "opened read-only", r.sourceFormat ?? r.doc.format),
          )
        } catch (e) {
          return err("LOAD_FAILED", `Cannot parse ${path}: ${errorMessage(e)}`, {
            suggestion: "Fix the file in a text editor (it was not changed).",
          })
        }
      }
      // Lease (single writer per file).
      let lease: Lease | null = null
      if (platform.capabilities.leases !== "none") {
        let r: Awaited<ReturnType<KimoPlatform["leases"]["acquire"]>>
        try {
          r = await platform.leases.acquire(path, { reclaimStale: true })
        } catch (e) {
          return err("INTERNAL", `Cannot take the file lease: ${errorMessage(e)}`)
        }
        if (!r.ok) {
          const d = decideOpen({
            host: kind === "desktop" ? "desktop" : "headless",
            alreadyOpen: false,
            readOnly: false,
            holder: leaseView(r.holder),
          })
          if (d.action === "refuse")
            return err(
              "DOCUMENT_LOCKED",
              `${path} is open in ${r.holder.appLabel} (pid ${r.holder.pid}).`,
              {
                detail: {
                  kind: "lock",
                  holder: {
                    ...leaseView(r.holder),
                    host: r.holder.host,
                    sinceIso: r.holder.sinceIso,
                  },
                },
                suggestion: d.suggestion,
              },
            )
        } else lease = r.lease
      }
      const exists = await platform.files.stat(path).catch(() => null)
      if (!exists) {
        if (lease) await platform.leases.release(lease).catch(() => {})
        return err("FILE_NOT_FOUND", `${path} does not exist.`, {
          suggestion: "Create it with kimo_create.",
        })
      }
      const store = createDocStore()
      const provider = new FileDocumentProvider({
        path,
        files: platform.files,
        recovery: platform.recovery,
        autosaveMs: autosaveMs > 0 ? autosaveMs : 2000,
        ...(options.openOptions ? { open: options.openOptions } : {}),
        ...(options.now ? { now: options.now } : {}),
      })
      await provider.attach(store)
      const le = provider.loadError
      if (le) {
        const newer = le.reasons.filter(
          (r) => r.code === "FORMAT_NEWER" || r.code === "FEATURE_UNSUPPORTED",
        )
        if (le.code === "READ_ONLY" && newer.length > 0 && newer.length === le.reasons.length) {
          return ok(
            makeEntry(
              path,
              store,
              provider,
              lease,
              `newer format: ${le.message}`,
              provider.openResult?.sourceFormat ?? "unknown",
            ),
          )
        }
        await provider.detach({ flush: false }).catch(() => {})
        if (lease) await platform.leases.release(lease).catch(() => {})
        store.destroy()
        return err("LOAD_FAILED", le.message, {
          detail: {
            kind: "load",
            reasons: le.reasons.map((r) => ({ code: r.code, message: r.message })),
          },
          suggestion:
            "The file was not changed. Fix it in a text editor (or resolve git conflict markers), then kimo_open again.",
        })
      }
      if (autosaveMs <= 0) provider.pauseAutosave("setting")
      return ok(
        makeEntry(
          path,
          store,
          provider,
          lease,
          null,
          provider.openResult?.sourceFormat ?? store.toHeader().format,
        ),
      )
    },
  }

  const scene =
    options.scene && "render" in options.scene
      ? options.scene
      : createSceneService(options.scene as SceneServiceOptions | undefined)
  const core = createDocumentHost({ backend, scene })
  const runtime = createMcpHostRuntime({
    host: core,
    ...(options.clientPolicy ? { clientPolicy: options.clientPolicy } : {}),
    ...(options.activity ? { activity: options.activity } : {}),
    ...(options.onActivity ? { onActivity: options.onActivity } : {}),
    approvals: options.approvals ?? "deny",
    ...(options.handlerOptions ? { handlerOptions: options.handlerOptions } : {}),
    ...(options.validate ? { validate: options.validate } : {}),
    ...(options.now ? { now: options.now } : {}),
  })

  const flushAll = async () => {
    const saved: string[] = []
    const recovered: string[] = []
    const failed: string[] = []
    for (const e of docs.values()) {
      const p = e.provider
      if (!p?.canSave || !p.dirty) continue
      try {
        await p.flush({ ignorePauses: true })
        saved.push(e.path)
      } catch {
        try {
          await p.writeRecovery("save-failed")
          recovered.push(e.path)
        } catch {
          failed.push(e.path)
        }
      }
    }
    return { saved, recovered, failed }
  }

  return Object.assign(core, {
    runtime,
    flushAll,
    setViews(next: BackendView[]) {
      views = next.map((v) => ({ ...v, selection: [...v.selection] }))
    },
    async dispose() {
      runtime.dispose()
      await flushAll()
      for (const e of [...docs.values()]) await e.close({ discard: true })
      scene.dispose()
    },
  })
}
