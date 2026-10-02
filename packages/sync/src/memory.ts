/**
 * In-process transport for tests and same-process replicas (e.g. a worker-less preview):
 * every {@link MemoryProvider} attached to the same {@link MemoryHub} receives the others'
 * binary updates. Delivery can be paused to simulate concurrent, offline edits.
 */
import type { DocStore, Origin, RemoteOrigin } from "@kimo/editor-state"
import { BaseProvider } from "./provider"

let nextPeer = 0

/** A relay between {@link MemoryProvider}s. */
export class MemoryHub {
  private readonly peers = new Set<MemoryProvider>()
  private readonly queue: { from: MemoryProvider; update: Uint8Array }[] = []
  private paused = false
  private draining = false

  /** Number of attached providers. */
  get size(): number {
    return this.peers.size
  }

  /** Number of updates waiting while paused. */
  get pending(): number {
    return this.queue.length
  }

  /** Holds updates until {@link resume} (peers keep editing "offline"). */
  pause(): void {
    this.paused = true
  }

  /** Delivers held updates in order and resumes live delivery. */
  resume(): void {
    this.paused = false
    this.drain()
  }

  /** @internal */
  join(p: MemoryProvider): void {
    this.peers.add(p)
  }

  /** @internal */
  leave(p: MemoryProvider): void {
    this.peers.delete(p)
  }

  /** @internal */
  others(p: MemoryProvider): MemoryProvider[] {
    return [...this.peers].filter((q) => q !== p)
  }

  /** @internal Queues an update from `from` for every other peer. */
  broadcast(from: MemoryProvider, update: Uint8Array): void {
    this.queue.push({ from, update })
    this.drain()
  }

  // Iterative delivery: updates produced while delivering (e.g. automatic repairs) are queued,
  // never delivered re-entrantly.
  private drain(): void {
    if (this.paused || this.draining) return
    this.draining = true
    try {
      while (!this.paused && this.queue.length > 0) {
        const { from, update } = this.queue.shift() as { from: MemoryProvider; update: Uint8Array }
        for (const p of this.others(from)) p.receive(update)
      }
    } finally {
      this.draining = false
    }
  }
}

/** Syncs a store with every other store on the same {@link MemoryHub}. */
export class MemoryProvider extends BaseProvider {
  private off: (() => void) | null = null
  readonly origin: RemoteOrigin

  constructor(
    private readonly hub: MemoryHub,
    id = `memory-${++nextPeer}`,
  ) {
    super(id)
    this.origin = `remote:${id}`
  }

  async attach(store: DocStore): Promise<void> {
    this.assertDetached()
    this._store = store
    this.setStatus("connecting")
    // Initial exchange with every peer (sync step 1 + 2 in both directions).
    for (const peer of this.hub.others(this)) {
      const theirs = peer.store
      if (!theirs) continue
      store.applyUpdate(theirs.encodeStateAsUpdate(store.encodeStateVector()), this.origin)
      theirs.applyUpdate(store.encodeStateAsUpdate(theirs.encodeStateVector()), peer.origin)
    }
    this.off = store.onUpdate((update: Uint8Array, origin: Origin) => {
      if (origin !== this.origin) this.hub.broadcast(this, update)
    })
    this.hub.join(this)
    this.setStatus("synced")
  }

  async detach(): Promise<void> {
    this.off?.()
    this.off = null
    this.hub.leave(this)
    this._store = null
    this.setStatus("detached")
  }

  /** @internal Applies a peer's update. */
  receive(update: Uint8Array): void {
    this._store?.applyUpdate(update, this.origin)
  }
}
