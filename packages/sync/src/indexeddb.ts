/**
 * `IndexedDbProvider`: browser persistence (web editor autosave, teardown 12 M1) built on
 * `y-indexeddb`. Import from `@kimo/sync/indexeddb`. Browser/worker only: attaching where
 * `indexedDB` is missing rejects.
 *
 * The provider talks to the store only through the {@link DocStore} binary-update seam: it keeps a
 * private bridge Y.Doc that `y-indexeddb` persists, and relays updates between that doc and the
 * store. This keeps CRDT types out of the provider interface (ADR 0003) at the cost of a second
 * in-memory replica.
 *
 * Unload safety: IndexedDB writes still in flight when the page unloads can be aborted, losing
 * the last edit. Updates are therefore tracked until IndexedDB confirms them; on `pagehide` the
 * unconfirmed ones are written synchronously to a localStorage journal, which the next `attach`
 * replays into the database and then removes.
 */
import type { DocStore, Origin, RemoteOrigin } from "@kimo/editor-state"
import { IndexeddbPersistence } from "y-indexeddb"
import * as Y from "yjs"
import { BaseProvider } from "./provider"

/** True when IndexedDB is available in this runtime. */
export function hasIndexedDb(): boolean {
  return typeof (globalThis as { indexedDB?: unknown }).indexedDB !== "undefined"
}

const BRIDGE = Symbol("kimo-indexeddb-bridge")

/** Persists a store into an IndexedDB database named after the document. */
export class IndexedDbProvider extends BaseProvider {
  readonly origin: RemoteOrigin = "remote:indexeddb"
  private bridge: Y.Doc | null = null
  private persistence: IndexeddbPersistence | null = null
  private off: (() => void) | null = null
  /** Updates sent to IndexedDB that it has not confirmed yet (oldest first). */
  private unconfirmed: Uint8Array[] = []
  private confirming = false
  private offPageHide: (() => void) | null = null

  /** @param name IndexedDB database name (one per document). */
  constructor(readonly name: string) {
    super(`indexeddb:${name}`)
  }

  async attach(store: DocStore): Promise<void> {
    this.assertDetached()
    if (!hasIndexedDb()) {
      throw new Error("IndexedDbProvider needs IndexedDB (browser or worker runtime)")
    }
    this._store = store
    this.setStatus("loading")
    const bridge = new Y.Doc()
    this.bridge = bridge
    // Seed the bridge with the store's current state; y-indexeddb stores it on open.
    Y.applyUpdate(bridge, store.encodeStateAsUpdate(), BRIDGE)
    const persistence = new IndexeddbPersistence(this.name, bridge)
    this.persistence = persistence
    try {
      await persistence.whenSynced
    } catch (e) {
      this.setStatus("error", e instanceof Error ? e : new Error(String(e)))
      throw e
    }
    // Edits a previous page wrote to the unload journal → database (and on into the store).
    const journal = readJournal(this.name)
    if (journal) {
      try {
        Y.applyUpdate(bridge, journal, "journal")
      } catch {
        // A corrupt journal is dropped; the database state stands.
      }
      clearJournal(this.name)
    }
    // Persisted state → store.
    store.applyUpdate(Y.encodeStateAsUpdate(bridge, store.encodeStateVector()), this.origin)
    bridge.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin !== BRIDGE) store.applyUpdate(update, this.origin)
    })
    // Store → bridge (persisted by y-indexeddb).
    this.off = store.onUpdate((update: Uint8Array, origin: Origin) => {
      if (origin === this.origin) return
      Y.applyUpdate(bridge, update, BRIDGE)
      this.unconfirmed.push(update)
      this.confirm()
    })
    const onPageHide = () => this.writeJournal()
    globalThis.addEventListener?.("pagehide", onPageHide)
    this.offPageHide = () => globalThis.removeEventListener?.("pagehide", onPageHide)
    this.setStatus("synced")
  }

  /** Resolves once every update sent so far is committed to IndexedDB. */
  async flush(): Promise<void> {
    const db = (this.persistence as { db?: IDBDatabase | null } | null)?.db
    if (!db || this.unconfirmed.length === 0) return
    const n = this.unconfirmed.length
    // A transaction on the same store completes after every earlier readwrite one did.
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(["updates"], "readonly")
        tx.oncomplete = () => resolve()
        tx.onerror = () => resolve()
        tx.onabort = () => resolve()
      } catch {
        resolve()
      }
    })
    if (this.persistence) this.unconfirmed.splice(0, n)
  }

  private confirm(): void {
    if (this.confirming) return
    this.confirming = true
    void this.flush().finally(() => {
      this.confirming = false
      if (this.unconfirmed.length > 0 && this.persistence) this.confirm()
    })
  }

  /** Synchronously journals the unconfirmed updates (page unload). */
  private writeJournal(): void {
    if (this.unconfirmed.length === 0) return
    const prev = readJournal(this.name)
    const merged = Y.mergeUpdates(prev ? [prev, ...this.unconfirmed] : this.unconfirmed)
    try {
      globalThis.localStorage?.setItem(journalKey(this.name), toBase64(merged))
    } catch {
      // Storage full or blocked: nothing more can be done during unload.
    }
  }

  async detach(): Promise<void> {
    this.off?.()
    this.off = null
    this.offPageHide?.()
    this.offPageHide = null
    await this.flush()
    this.unconfirmed = []
    await this.persistence?.destroy()
    this.bridge?.destroy()
    this.persistence = null
    this.bridge = null
    this._store = null
    this.setStatus("detached")
  }

  /** Deletes the persisted database (e.g. after the document was saved elsewhere). */
  async clearData(): Promise<void> {
    if (this.persistence) await this.persistence.clearData()
  }
}

const journalKey = (name: string) => `kimo.journal.${name}`

function readJournal(name: string): Uint8Array | null {
  try {
    const v = globalThis.localStorage?.getItem(journalKey(name))
    return v ? fromBase64(v) : null
  } catch {
    return null
  }
}

function clearJournal(name: string): void {
  try {
    globalThis.localStorage?.removeItem(journalKey(name))
  } catch {
    // ignore
  }
}

function toBase64(bytes: Uint8Array): string {
  let s = ""
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

function fromBase64(text: string): Uint8Array {
  const s = atob(text)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}
