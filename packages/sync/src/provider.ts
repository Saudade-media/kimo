/**
 * The `SyncProvider` interface (teardown 9.1, ADR 0001 §4): persistence and transport attach
 * to a {@link DocStore} through this one seam. Providers only use the `DocStore` interface
 * (binary updates, `toDocument` / `loadDocument`, change events), never CRDT internals.
 */
import type { DocStore } from "@kimo/editor-state"

/**
 * Provider lifecycle:
 * - `detached`: not attached to a store;
 * - `connecting` / `loading`: attaching (network handshake / reading persisted state);
 * - `synced`: attached, nothing pending;
 * - `dirty`: local changes not yet persisted (file autosave pending);
 * - `saving`: a write is in flight;
 * - `read-only`: attached, but the provider will never write (failed load, newer format);
 * - `error`: the last operation failed (see the event's `error`); the provider keeps retrying
 *   where that makes sense (the next autosave, a reconnect).
 */
export type SyncStatus =
  | "detached"
  | "connecting"
  | "loading"
  | "synced"
  | "dirty"
  | "saving"
  | "read-only"
  | "error"

/** A status transition. */
export interface SyncStatusEvent {
  status: SyncStatus
  previous: SyncStatus
  /** The failure, for `error` and `read-only`. */
  error?: Error
}

/** A persistence or transport adapter for one {@link DocStore}. */
export interface SyncProvider {
  /** Stable identifier, used as the remote origin of updates this provider applies. */
  readonly id: string
  readonly status: SyncStatus
  /** The attached store, if any. */
  readonly store: DocStore | null
  /**
   * Attaches to a store and performs the initial exchange (load, handshake). Resolves once the
   * store holds the provider's state. A provider attaches to at most one store at a time.
   */
  attach(store: DocStore): Promise<void>
  /** Stops syncing (flushing pending writes first where applicable) and releases resources. */
  detach(): Promise<void>
  /** Subscribes to status transitions. Returns an unsubscribe function. */
  onStatus(listener: (event: SyncStatusEvent) => void): () => void
}

/** Shared status plumbing for providers. */
export abstract class BaseProvider implements SyncProvider {
  private _status: SyncStatus = "detached"
  private readonly statusListeners = new Set<(e: SyncStatusEvent) => void>()
  protected _store: DocStore | null = null

  constructor(readonly id: string) {}

  get status(): SyncStatus {
    return this._status
  }

  get store(): DocStore | null {
    return this._store
  }

  abstract attach(store: DocStore): Promise<void>
  abstract detach(): Promise<void>

  onStatus(listener: (event: SyncStatusEvent) => void): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  /** Sets the status and notifies listeners (also on a repeated `error`). */
  protected setStatus(status: SyncStatus, error?: Error): void {
    const previous = this._status
    if (previous === status && status !== "error") return
    this._status = status
    const event: SyncStatusEvent = { status, previous }
    if (error) event.error = error
    for (const l of [...this.statusListeners]) l(event)
  }

  protected assertDetached(): void {
    if (this._store) throw new Error(`Provider ${this.id} is already attached`)
  }
}
