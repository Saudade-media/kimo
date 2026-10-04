/**
 * Window ↔ document-host sync (ADR 0002 §2, ADR 0013 §12 item 2). In the desktop app one hidden
 * webview (the document host) holds the authoritative store of every open document; each editor
 * window holds a replica and syncs with the standard Yjs exchange (state vector → missing
 * update, then incremental updates) over a message transport (Tauri events in the app, an
 * in-memory pair in tests and in the browser build).
 *
 * Origin-preserving: every update carries the origin of the transaction that produced it
 * (`user`, `mcp:<client>.<session>`, `file`, `system`), and the receiver applies it as
 * `remote:<origin>`. So per-origin undo keeps working (a replica's `Y.UndoManager` only tracks
 * its own local origin: a user undo in a window never undoes an agent's ops, and an agent's
 * `kimo_history undo` on the host never undoes the user's edits), and the UI can tell agent
 * edits apart (`change.origin.startsWith("remote:mcp:")`).
 *
 * Messages are JSON with base64 payloads, so any string/JSON channel works.
 */
import type { DocStore, Origin, RemoteOrigin } from "@kimo/editor-state"
import { BaseProvider } from "./provider"

/** One message on the window ↔ host channel. `doc` names the document (its path). */
export type HostSyncMessage =
  /** Window → host: attach to `doc` with the replica's state vector. */
  | { t: "hello"; doc: string; peer: string; sv: string }
  /** Host → window: what the replica is missing, plus the host's state vector. */
  | { t: "sync"; doc: string; peer: string; update: string; sv: string }
  /** Either direction: an incremental update with the origin that produced it. */
  | { t: "update"; doc: string; peer: string; update: string; origin: string }
  /** Window → host: detach. Host → window: the document closed in the host. */
  | { t: "bye"; doc: string; peer: string }
  /** Host → window: `doc` is not open in the host. */
  | { t: "missing"; doc: string; peer: string }

/** A bidirectional message channel. */
export interface HostSyncTransport {
  send(message: HostSyncMessage): void
  onMessage(listener: (message: HostSyncMessage) => void): () => void
}

// --- base64 (no Buffer: browser + Bun + Node) ----------------------------------------------

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = ""
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** The origin a received update is applied with: `remote:<original origin>`. */
export function remoteOriginFor(origin: string): RemoteOrigin {
  if (origin.startsWith("remote:") || origin === "remote") return origin as RemoteOrigin
  return `remote:${origin}`
}

/** The original origin of a change applied by this channel (`remote:mcp:x.y` → `mcp:x.y`). */
export function originalOrigin(origin: Origin): string {
  return origin.startsWith("remote:") ? origin.slice(7) : origin
}

/** In-memory transport pair (tests, same-context host). Delivery is synchronous by default. */
export function createTransportPair(
  options: { async?: boolean } = {},
): [HostSyncTransport, HostSyncTransport] {
  const a = new Set<(m: HostSyncMessage) => void>()
  const b = new Set<(m: HostSyncMessage) => void>()
  const deliver = (to: Set<(m: HostSyncMessage) => void>, m: HostSyncMessage) => {
    // Round-trip through JSON like a real channel.
    const copy = JSON.parse(JSON.stringify(m)) as HostSyncMessage
    const run = () => {
      for (const l of [...to]) l(copy)
    }
    if (options.async) queueMicrotask(run)
    else run()
  }
  const subscribe =
    (set: Set<(m: HostSyncMessage) => void>) => (l: (m: HostSyncMessage) => void) => {
      set.add(l)
      return () => {
        set.delete(l)
      }
    }
  return [
    { send: (m) => deliver(b, m), onMessage: subscribe(a) },
    { send: (m) => deliver(a, m), onMessage: subscribe(b) },
  ]
}

let peerSeq = 0

// --- Window side -----------------------------------------------------------------------------

export interface WindowSyncProviderOptions {
  transport: HostSyncTransport
  /** Document key (canonical path) in the host. */
  doc: string
  /** This window's peer id (default a random one). */
  peer?: string
  /** Resolve `attach` after this many ms even without the host's answer (default 10 000: reject). */
  timeoutMs?: number
}

/**
 * The editor window's provider: keeps a replica store in sync with the host's store. Local
 * edits (origin `user`) are sent with their origin; host updates are applied as
 * `remote:<origin>`.
 */
export class WindowSyncProvider extends BaseProvider {
  readonly doc: string
  readonly peer: string
  private readonly transport: HostSyncTransport
  private readonly timeoutMs: number
  private offs: (() => void)[] = []
  private applying = false
  /** True after the host announced the document closed or missing. */
  closedByHost = false

  constructor(options: WindowSyncProviderOptions) {
    const peer =
      options.peer ?? `w${(++peerSeq).toString(36)}${Math.random().toString(36).slice(2, 7)}`
    super(`host-sync:${peer}`)
    this.doc = options.doc
    this.peer = peer
    this.transport = options.transport
    this.timeoutMs = options.timeoutMs ?? 10_000
  }

  attach(store: DocStore): Promise<void> {
    this.assertDetached()
    this._store = store
    this.setStatus("connecting")
    return new Promise<void>((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        this.setStatus("error", new Error("The document host did not answer."))
        reject(new Error(`Document host did not answer for ${this.doc}`))
      }, this.timeoutMs)
      this.offs.push(
        this.transport.onMessage((m) => {
          if (m.doc !== this.doc || m.peer !== this.peer) return
          if (m.t === "sync") {
            this.apply(base64ToBytes(m.update), "remote:host")
            // Send what the host is missing (edits made before the answer arrived).
            const mine = store.encodeStateAsUpdate(base64ToBytes(m.sv))
            if (mine.length > 2)
              this.transport.send({
                t: "update",
                doc: this.doc,
                peer: this.peer,
                update: bytesToBase64(mine),
                origin: "user",
              })
            if (!settled) {
              settled = true
              clearTimeout(timer)
              this.setStatus("synced")
              resolve()
            }
          } else if (m.t === "update") {
            this.apply(base64ToBytes(m.update), remoteOriginFor(m.origin))
          } else if (m.t === "bye" || m.t === "missing") {
            this.closedByHost = true
            this.setStatus(
              "read-only",
              new Error(
                m.t === "missing"
                  ? "Not open in the document host."
                  : "Closed in the document host.",
              ),
            )
            if (!settled) {
              settled = true
              clearTimeout(timer)
              reject(new Error(`${this.doc} is not open in the document host`))
            }
          }
        }),
        store.onUpdate((update, origin) => {
          if (this.applying) return
          this.transport.send({
            t: "update",
            doc: this.doc,
            peer: this.peer,
            update: bytesToBase64(update),
            origin: originalOrigin(origin),
          })
        }),
      )
      this.transport.send({
        t: "hello",
        doc: this.doc,
        peer: this.peer,
        sv: bytesToBase64(store.encodeStateVector()),
      })
    })
  }

  private apply(update: Uint8Array, origin: RemoteOrigin): void {
    const s = this._store
    if (!s) return
    this.applying = true
    try {
      s.applyUpdate(update, origin)
    } finally {
      this.applying = false
    }
  }

  async detach(): Promise<void> {
    for (const o of this.offs.splice(0)) o()
    if (this._store && !this.closedByHost)
      this.transport.send({ t: "bye", doc: this.doc, peer: this.peer })
    this._store = null
    this.setStatus("detached")
  }
}

// --- Host side -------------------------------------------------------------------------------

/**
 * The document host's side: serves every window peer of every document it holds. Updates
 * from a peer are applied to the host store as `remote:<origin>` and forwarded to the other
 * peers; the host store's own updates (agent ops, file reloads, repairs) go to every peer.
 */
export class HostSyncHub {
  private readonly docs = new Map<
    string,
    { store: DocStore; off: () => void; peers: Set<string> }
  >()
  private readonly offTransport: () => void
  /** Peer whose update the host store is applying right now (echo suppression). */
  private applyingFrom: string | null = null
  private readonly peerListeners = new Set<(doc: string, peers: number) => void>()

  constructor(
    private readonly transport: HostSyncTransport,
    private readonly resolve?: (doc: string) => DocStore | null | Promise<DocStore | null>,
  ) {
    this.offTransport = transport.onMessage((m) => void this.onMessage(m))
  }

  /** Serves `store` under `doc` (call when the host opens a document). */
  register(doc: string, store: DocStore): void {
    if (this.docs.get(doc)?.store === store) return
    this.unregister(doc)
    const entry = {
      store,
      peers: new Set<string>(),
      off: store.onUpdate((update, origin) => {
        const from = this.applyingFrom
        const b64 = bytesToBase64(update)
        for (const p of entry.peers)
          if (p !== from)
            this.transport.send({
              t: "update",
              doc,
              peer: p,
              update: b64,
              origin: originalOrigin(origin),
            })
      }),
    }
    this.docs.set(doc, entry)
  }

  /** Stops serving `doc` and tells its peers. */
  unregister(doc: string): void {
    const e = this.docs.get(doc)
    if (!e) return
    e.off()
    for (const p of e.peers) this.transport.send({ t: "bye", doc, peer: p })
    this.docs.delete(doc)
    this.emitPeers(doc, 0)
  }

  /** Number of window peers attached to `doc` (a window shows it). */
  peers(doc: string): number {
    return this.docs.get(doc)?.peers.size ?? 0
  }

  onPeersChange(l: (doc: string, peers: number) => void): () => void {
    this.peerListeners.add(l)
    return () => this.peerListeners.delete(l)
  }

  private emitPeers(doc: string, n: number): void {
    for (const l of [...this.peerListeners]) l(doc, n)
  }

  private async onMessage(m: HostSyncMessage): Promise<void> {
    if (m.t === "hello") {
      let e = this.docs.get(m.doc)
      if (!e && this.resolve) {
        const store = await this.resolve(m.doc)
        if (store) this.register(m.doc, store)
        e = this.docs.get(m.doc)
      }
      if (!e) {
        this.transport.send({ t: "missing", doc: m.doc, peer: m.peer })
        return
      }
      e.peers.add(m.peer)
      this.transport.send({
        t: "sync",
        doc: m.doc,
        peer: m.peer,
        update: bytesToBase64(e.store.encodeStateAsUpdate(base64ToBytes(m.sv))),
        sv: bytesToBase64(e.store.encodeStateVector()),
      })
      this.emitPeers(m.doc, e.peers.size)
    } else if (m.t === "update") {
      const e = this.docs.get(m.doc)
      if (!e) return
      this.applyingFrom = m.peer
      try {
        e.store.applyUpdate(base64ToBytes(m.update), remoteOriginFor(m.origin))
      } finally {
        this.applyingFrom = null
      }
    } else if (m.t === "bye") {
      const e = this.docs.get(m.doc)
      if (e?.peers.delete(m.peer)) this.emitPeers(m.doc, e.peers.size)
    }
  }

  dispose(): void {
    for (const d of [...this.docs.keys()]) this.unregister(d)
    this.offTransport()
  }
}
