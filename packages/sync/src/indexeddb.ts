/**
 * `IndexedDbProvider`: browser persistence (web editor autosave, teardown 12 M1) built on
 * `y-indexeddb`. Import from `@kimo/sync/indexeddb`. Browser/worker only: attaching where
 * `indexedDB` is missing rejects.
 *
 * The provider talks to the store only through the {@link DocStore} binary-update seam: it keeps a
 * private bridge Y.Doc that `y-indexeddb` persists, and relays updates between that doc and the
 * store. This keeps CRDT types out of the provider interface (ADR 0003) at the cost of a second
 * in-memory replica.
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
    // Persisted state → store.
    store.applyUpdate(Y.encodeStateAsUpdate(bridge, store.encodeStateVector()), this.origin)
    bridge.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin !== BRIDGE) store.applyUpdate(update, this.origin)
    })
    // Store → bridge (persisted by y-indexeddb).
    this.off = store.onUpdate((update: Uint8Array, origin: Origin) => {
      if (origin !== this.origin) Y.applyUpdate(bridge, update, BRIDGE)
    })
    this.setStatus("synced")
  }

  async detach(): Promise<void> {
    this.off?.()
    this.off = null
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
