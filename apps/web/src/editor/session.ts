/**
 * One open file: a DocStore (createDocStore), a UI store, and IndexedDB autosave through
 * `@kimo/sync`'s IndexedDbProvider. The file index entry (name, updatedAt, frame count) is
 * kept current from store changes.
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
import { countFrames, docDbName, type FileMeta, getFile, patchFile } from "../lib/files"

export interface FileSession {
  id: string
  store: DocStore
  ui: UiStore
  provider: IndexedDbProvider
  meta: FileMeta
  /** Applies `ops` as the user (one undo step) and reports a failure to the console. */
  apply(ops: Op | readonly Op[], label?: string): boolean
  /** Undo grouping for continuous gestures (scrubbing): see {@link Gesture}. */
  gesture(): Gesture
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

function makeSession(id: string, store: DocStore, provider: IndexedDbProvider, meta: FileMeta) {
  const apply = (ops: Op | readonly Op[], label?: string) => {
    const r = store.apply(ops, label ? { origin: "user", label } : { origin: "user" })
    if (!r.ok) console.warn("Kimo: edit rejected", r.errors)
    return r.ok
  }
  const session: FileSession = {
    id,
    store,
    ui: createUiStore(),
    provider,
    meta,
    apply,
    gesture() {
      const g = startGesture(store, "user", "Edit", (message) =>
        console.warn("Kimo: edit rejected", message),
      )
      return {
        apply: (ops, label) => g.set(ops, label),
        end: () => g.end(),
        get done() {
          return g.done
        },
      }
    },
  }
  return session
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
              void patchFile(id, { updatedAt: Date.now(), frames: countFrames(store) })
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

/** Provider status, kept current. */
export function useSyncStatus(provider: IndexedDbProvider): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>(provider.status)
  useEffect(() => {
    setStatus(provider.status)
    return provider.onStatus((e) => setStatus(e.status))
  }, [provider])
  return status
}
