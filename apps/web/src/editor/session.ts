/**
 * One open file: a DocStore, a UI store and its persistence.
 * - Browser library (`#/file/:id`): IndexedDB autosave through `@kimo/sync`'s IndexedDbProvider;
 *   the file index entry (name, updatedAt, frame count) is kept current from store changes.
 * - A `.kimo` on disk (`#/disk/<ref>`): the window's session manager (ADR 0012 §4) owns the
 *   store, lease, autosave, watching and merges; {@link FileSession.document} is that session.
 */
import {
  bindUiToDocument,
  createDocStore,
  createUiStore,
  type DocStore,
  type Op,
} from "@kimo/editor-state"
import type { SyncStatus } from "@kimo/sync"
import { IndexedDbProvider } from "@kimo/sync/indexeddb"
import { useEffect, useState } from "react"
import type { UiStore } from "../canvas/contract"
import { startGesture } from "../canvas/gesture"
import { manifestOps } from "../lib/asset-manifest"
import type { ManifestEntry } from "../lib/assets"
import {
  countFrames,
  docDbName,
  type FileMeta,
  getFile,
  libraryStats,
  patchFile,
} from "../lib/files"
import { currentHeader } from "../lib/header"
import type { SharedSession } from "../multiplayer/share"
import type { FileDocumentSession, FileSessionManager } from "../platform/session"
import { withActivePage } from "./pages/model"

export interface FileSession {
  id: string
  store: DocStore
  ui: UiStore
  /** IndexedDB autosave (browser library); null for a file on disk. */
  provider: IndexedDbProvider | null
  /** The document session of a file on disk; null for the browser library. */
  document: FileDocumentSession | null
  meta: FileMeta
  /** Applies `ops` as the user (one undo step) and reports a failure to the console. */
  apply(ops: Op | readonly Op[], label?: string): boolean
  /** Undo grouping for continuous gestures (scrubbing): see {@link Gesture}. */
  gesture(): Gesture
  /**
   * Manifest entries of assets known to this session (the editor's asset store). With a
   * document manifest, edits that add an asset reference also add its entry (spec §12).
   */
  assetEntry: (src: string) => ManifestEntry | null
  /** Rejected edits (the shell may surface them; they are always logged). */
  onReject: Set<(message: string) => void>
  /**
   * M3: rewrites an op group before it is applied (edits on composite instance ids become
   * overrides, see `m3/route.ts`). Null refuses the edit (the router reports why).
   */
  route?: (ops: readonly Op[]) => readonly Op[] | null
  /**
   * A room joined from a link (board 41 section 5): the store is the room's guest document and
   * nothing is written to the browser library or to a file.
   */
  shared?: SharedSession
}

export type SessionState =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "error"; message: string }
  | { status: "ready"; session: FileSession }

/**
 * Collapses the op groups of one gesture into a single undo step (see `startGesture`: a step
 * only collapses the entry it pushed itself, so no-op steps and edits made mid-gesture are safe).
 */
export interface Gesture {
  apply(ops: readonly Op[], label?: string): boolean
  end(): void
  /** True after `end`. */
  readonly done: boolean
}

function makeSession(
  id: string,
  store: DocStore,
  provider: IndexedDbProvider | null,
  meta: FileMeta,
  document: FileDocumentSession | null = null,
  ui: UiStore = createUiStore(),
) {
  const reject = (message: string) => {
    console.warn("Kimo: edit rejected", message)
    for (const l of [...session.onReject]) l(message)
  }
  /** `ops` plus the manifest entries for asset references they add (same undo step). */
  const withManifest = (ops: Op | readonly Op[]): Op | readonly Op[] => {
    const extra = manifestOps(currentHeader(store).assets, ops, (src) => session.assetEntry(src))
    return extra.length ? [...extra, ...(Array.isArray(ops) ? ops : [ops as Op])] : ops
  }
  /** `ops` through the M3 router (instances), kept on the active page; null = refused. */
  const routed = (ops: Op | readonly Op[]): readonly Op[] | null => {
    const list: readonly Op[] = Array.isArray(ops) ? ops : [ops as Op]
    const r = session.route ? session.route(list) : list
    // Board 27 §1: new roots land on the active page (spec §5.6).
    return r && withActivePage(store, session.ui, r)
  }
  const apply = (ops: Op | readonly Op[], label?: string) => {
    const list = routed(ops)
    if (!list) return false
    if (list.length === 0) return true
    const r = store.apply(
      withManifest(list),
      label ? { origin: "user", label } : { origin: "user" },
    )
    if (!r.ok) reject(r.errors.map((e) => e.message).join("; "))
    return r.ok
  }
  const session: FileSession = {
    id,
    store,
    ui,
    provider,
    document,
    meta,
    apply,
    assetEntry: () => null,
    onReject: new Set(),
    gesture() {
      const g = startGesture(store, "user", "Edit", reject)
      return {
        apply: (ops, label) => {
          const list = routed(ops)
          return list ? g.set(withManifest(list) as readonly Op[], label) : false
        },
        end: () => g.end(),
        get done() {
          return g.done
        },
      }
    },
  }
  return session
}

/** The editor session of a joined room: its guest store, named `name` (the owner's file name). */
export function createRoomSession(shared: SharedSession, name: string): FileSession {
  const now = Date.now()
  const session = makeSession(shared.room, shared.store, null, {
    id: shared.room,
    name,
    createdAt: now,
    updatedAt: now,
    frames: 0,
  })
  session.shared = shared
  return session
}

/** The owner's file name of a joined room (`meta.name` of the document), or null. */
export function roomFileName(store: DocStore): string | null {
  const name = (store.toHeader() as { meta?: { name?: unknown } }).meta?.name
  return typeof name === "string" && name.trim() ? name.trim() : null
}

/** Opens file `id` for the lifetime of the calling component. */
export function useFileSession(id: string): SessionState {
  const [state, setState] = useState<SessionState>({ status: "loading" })

  useEffect(() => {
    let disposed = false
    const cleanups: (() => void)[] = []
    const store = createDocStore()
    const provider = new IndexedDbProvider(docDbName(id))
    setState({ status: "loading" })

    void (async () => {
      try {
        const meta = await getFile(id)
        if (disposed) return
        if (!meta) {
          setState({ status: "missing" })
          return
        }
        await provider.attach(store)
        if (disposed) return
        store.clearHistory()
        const session = makeSession(id, store, provider, meta)
        cleanups.push(bindUiToDocument(session.ui, store))
        let timer: ReturnType<typeof setTimeout> | null = null
        cleanups.push(
          store.onChange((change) => {
            if (change.origin === provider.origin) return
            if (timer) clearTimeout(timer)
            timer = setTimeout(() => {
              void patchFile(id, {
                updatedAt: Date.now(),
                frames: countFrames(store),
                ...libraryStats(store),
              })
            }, 400)
          }),
        )
        cleanups.push(() => {
          if (timer) clearTimeout(timer)
        })
        setState({ status: "ready", session })
      } catch (e) {
        if (!disposed)
          setState({ status: "error", message: e instanceof Error ? e.message : String(e) })
      }
    })()

    return () => {
      disposed = true
      for (const c of cleanups) c()
      void provider
        .detach()
        .catch(() => undefined)
        .finally(() => store.destroy())
    }
  }, [id])

  return state
}

/** Provider status, kept current ("synced" without an IndexedDB provider). */
export function useSyncStatus(provider: IndexedDbProvider | null): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>(provider?.status ?? "synced")
  useEffect(() => {
    if (!provider) return
    setStatus(provider.status)
    return provider.onStatus((e) => setStatus(e.status))
  }, [provider])
  return status
}

export type DiskSessionState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; session: FileSession }

/**
 * Opens the `.kimo` at `ref` through the window's session manager for the lifetime of the
 * calling component. The document session's store is the editor's store; closing the editor
 * flushes and closes the document session.
 */
export function useDiskSession(manager: FileSessionManager, ref: string): DiskSessionState {
  const [state, setState] = useState<DiskSessionState>({ status: "loading" })
  useEffect(() => {
    retained.set(ref, (retained.get(ref) ?? 0) + 1)
    let disposed = false
    const cleanups: (() => void)[] = []
    let doc: FileDocumentSession | null = null
    setState({ status: "loading" })
    void (async () => {
      try {
        doc = await manager.open(ref, { source: "open-dialog" })
        if (disposed) return
        const now = Date.now()
        const meta: FileMeta = {
          id: doc.ref,
          name: doc.fileName,
          createdAt: now,
          updatedAt: now,
          frames: 0,
        }
        const session = makeSession(doc.ref, doc.store, null, meta, doc, uiOf(doc))
        cleanups.push(bindUiToDocument(session.ui, doc.store))
        setState({ status: "ready", session })
      } catch (e) {
        if (!disposed)
          setState({ status: "error", message: e instanceof Error ? e.message : String(e) })
      }
    })()
    return () => {
      disposed = true
      for (const c of cleanups) c()
      // Flush and release the lease (the store belongs to the document session). Deferred so a
      // remount of the same file (StrictMode, route re-entry) keeps the session open.
      release(manager, ref, doc)
    }
  }, [manager, ref])
  return state
}

/**
 * Editors and tabs currently holding each file on disk (see {@link useDiskSession} and
 * {@link retainDiskFile}). A file closes once nothing holds it.
 */
const retained = new Map<string, number>()

function release(manager: FileSessionManager, ref: string, doc: FileDocumentSession | null): void {
  const left = (retained.get(ref) ?? 1) - 1
  if (left > 0) retained.set(ref, left)
  else retained.delete(ref)
  setTimeout(() => {
    if (retained.has(ref)) return
    const s = doc ?? manager.get(ref)
    // Save as (and an untitled document's first save) moves the session to a new ref that
    // the next editor already holds: keep it open.
    if (s && !retained.has(s.ref)) void s.close().catch(() => undefined)
  }, 0)
}

/**
 * Board 44 §5 "Tabs": an open tab keeps its file's session (lease, store, undo, selection) while
 * another tab shows, so switching tabs only remounts the editor. The returned function lets go;
 * the file closes when no editor or tab holds it anymore.
 */
export function retainDiskFile(manager: FileSessionManager, ref: string): () => void {
  retained.set(ref, (retained.get(ref) ?? 0) + 1)
  let held = true
  return () => {
    if (!held) return
    held = false
    release(manager, ref, null)
  }
}

/** Board 44 §5: one UI store per document session, so selection and page survive a tab switch. */
const uiStores = new WeakMap<FileDocumentSession, UiStore>()

function uiOf(doc: FileDocumentSession): UiStore {
  let ui = uiStores.get(doc)
  if (!ui) {
    ui = createUiStore()
    uiStores.set(doc, ui)
  }
  return ui
}
