/**
 * The share backend: what the multiplayer view model (`model.ts`) reads and calls per document,
 * as plain JSON snapshots, so the same model runs over a share layer in the window (web) and over
 * the desktop document host's `mp.*` RPC (docs/spec/multiplayer.md §16.8, where the owner's
 * authoritative store lives in the host).
 *
 * A document is named by a key: a file's ref, `kimo-lib:<fileId>` for a browser library file
 * (`./library`), or `kimo-room:<room>` for a room joined from a link (a guest's document has no
 * file).
 */
import type { ClaimView, DocStore } from "@kimo/editor-state"
import { claimsFor } from "@kimo/editor-state"
import type { FileRef } from "@kimo/platform"
import type { PresenceState, SyncStatus } from "@kimo/sync"
import { MultiplayerError, type Role } from "@kimo/sync/mp"
import type { AssetStore } from "../lib/assets"
import type { LocalPresence, PlatformShare } from "../platform/share"
import { type AgentPausesOptions, type AgentPauseView, pausesFor } from "./agent-pause"
import type { IssuedLink } from "./registry"
import type { SharedSession, StopSharingResult } from "./share"

/** The key of a room joined from a link. */
export const roomKeyOf = (room: string) => `kimo-room:${room}`
/** The room of a joined room's key, or null for a file key. */
export const roomOfKey = (key: string) =>
  key.startsWith("kimo-room:") ? key.slice("kimo-room:".length) : null

/** One other client in the room. */
export interface PeerSnapshot {
  peer: number
  /** From the relay (`peers`); null before it said. */
  role: Role | null
  /** The relay-stamped origin of its token (`user`, `agent:<id>`, `mcp:<client>`). */
  origin: string
  /** Its presence, or null while it has published none. */
  state: PresenceState | null
  /** When its cursor, selection, page or viewport last changed (ms, backend clock). */
  changedAt: number
}

/** Assets moving between this client and the relay (§16.4). */
export interface AssetTransfers {
  /** Keys this client is uploading ("Sharing 2 images"). */
  uploading: readonly string[]
  /** Keys being fetched, with the size the manifest lists (null when unknown). */
  fetching: readonly { key: string; bytes: number | null }[]
  /** Keys nobody online holds yet (the relay answered 404); retried when someone joins. */
  unavailable: readonly string[]
  /** Keys whose fetch failed (integrity, network); retried later. */
  failed: readonly string[]
}

export interface ShareErrorSnapshot {
  code: string
  message: string
  /** False while the provider retries; true when nothing more happens until the user acts. */
  fatal: boolean
}

/** Everything the view model needs about one document, as JSON. */
export interface ShareSnapshot {
  key: string
  /** Null while the document is not shared (or its room is not open). */
  room: string | null
  relayUrl: string | null
  /** True when this device owns the room (it shared the file). */
  owner: boolean
  role: Role | null
  /** The network provider's status (spec §15.2); null when not shared. */
  status: SyncStatus | null
  /** True while `startSharing` runs. */
  starting: boolean
  error: ShareErrorSnapshot | null
  /** Since when the relay connection is down (ms, backend clock); null while connected. */
  downSince: number | null
  /** This replica's relay peer id (0 or null before the first welcome). */
  self: number | null
  /** This replica's published presence. */
  selfState: PresenceState | null
  /** Every other client, ascending peer id. */
  peers: readonly PeerSnapshot[]
  assets: AssetTransfers
  /** Font families sent by name only (not shared). */
  fontsNameOnly: readonly string[]
  /** Agent area claims of the document, local and remote (spec §15.11). */
  claims: readonly ClaimView[]
  /** Local agents paused because a person edited inside their claim. */
  paused: readonly AgentPauseView[]
}

export interface MintOptions {
  role: Role
  /** Seconds the link stays valid; null never expires. */
  ttlSeconds: number | null
  label?: string
}

export interface StartOptions {
  /** Default: the `multiplayer.relayUrl` setting. */
  relayUrl?: string
  createSecret?: string
}

/** The operations behind the Share UI, per document key. */
export interface ShareBackend {
  /** The current snapshot (a stable object until something changes). */
  snapshot(key: string): ShareSnapshot
  /** Notifies after the snapshot of `key` changed. */
  subscribe(key: string, listener: () => void): () => void
  start(key: string, options?: StartOptions): Promise<void>
  stop(key: string): Promise<Pick<StopSharingResult, "relayNotified">>
  links(key: string): Promise<IssuedLink[]>
  mintLink(key: string, options: MintOptions): Promise<IssuedLink>
  revokeLink(key: string, jti: string): Promise<void>
  resetAllLinks(key: string): Promise<{ kid: number }>
  setPresence(key: string, fields: LocalPresence): void
  ensureAsset(key: string, asset: string): Promise<boolean>
  resumeAgent(key: string, holder: string): void
  stopAgent(key: string, holder: string): void
}

export const EMPTY_TRANSFERS: AssetTransfers = Object.freeze({
  uploading: [],
  fetching: [],
  unavailable: [],
  failed: [],
}) as AssetTransfers

/** The snapshot of a document that is not shared. */
export function emptySnapshot(key: string): ShareSnapshot {
  return {
    key,
    room: null,
    relayUrl: null,
    owner: false,
    role: null,
    status: null,
    starting: false,
    error: null,
    downSince: null,
    self: null,
    selfState: null,
    peers: [],
    assets: EMPTY_TRANSFERS,
    fontsNameOnly: [],
    claims: [],
    paused: [],
  }
}

const errorOf = (error: unknown, fatal: boolean): ShareErrorSnapshot => ({
  code: error instanceof MultiplayerError ? error.code : "INTERNAL",
  message: error instanceof Error ? error.message : String(error),
  fatal,
})

/** What changed in a presence state that counts as activity (not a heartbeat or a claim). */
const activityOf = (s: PresenceState | null | undefined) =>
  s
    ? JSON.stringify([s.cursor ?? null, s.selection ?? null, s.page ?? null, s.viewport ?? null])
    : ""

export interface LocalShareBackendOptions {
  share: PlatformShare
  /** The open session's store of a file (claims and pauses also exist for unshared files). */
  storeFor(ref: FileRef): DocStore | null
  /**
   * The session of a file, for `start` (the share layer needs its ref and store, and the asset
   * store when it is not the folder beside the file: a browser library file's).
   */
  sessionFor(ref: FileRef): { ref: FileRef; store: DocStore; assets?: AssetStore } | null
  now?: () => number
  /** Agent pause timing and Stop (the window's agent controller or the host's connection). */
  pauses?: AgentPausesOptions
}

/** Per room: what the backend collects from the session's events. */
interface RoomTrack {
  session: SharedSession
  error: ShareErrorSnapshot | null
  downSince: number | null
  changedAt: Map<number, { activity: string; at: number }>
  uploading: Set<string>
  fetching: Set<string>
  watched: Set<string>
  fonts: Set<string>
  offs: (() => void)[]
}

/**
 * The backend over a {@link PlatformShare} in this webview: the web app's windows, and the desktop
 * document host (which serves it to editor windows over `mp.*`).
 */
export function createLocalShareBackend(options: LocalShareBackendOptions): ShareBackend & {
  /** Recompute and notify (the host calls it when a session opens or closes). */
  refresh(key?: string): void
  dispose(): void
} {
  const { share } = options
  const now = options.now ?? Date.now
  const listeners = new Map<string, Set<() => void>>()
  const cache = new Map<string, ShareSnapshot>()
  const rooms = new Map<string, RoomTrack>()
  const starting = new Set<string>()
  const startErrors = new Map<string, ShareErrorSnapshot>()
  /** Stores whose claims and pauses are watched, with the keys that read them. */
  const watchedStores = new Map<DocStore, { keys: Set<string>; offs: (() => void)[] }>()
  const fontsByRoom = new Map<string, Set<string>>()

  const sessionOf = (key: string): SharedSession | null => {
    const joined = roomOfKey(key)
    if (joined) return share.session(joined)
    const room = share.roomOfFile(key)
    return room ? share.session(room) : null
  }
  const storeOf = (key: string): DocStore | null =>
    sessionOf(key)?.store ?? (roomOfKey(key) ? null : options.storeFor(key))

  const notify = (key: string) => {
    cache.delete(key)
    for (const l of [...(listeners.get(key) ?? [])]) l()
  }
  const notifyRoom = (room: string) => {
    for (const key of listeners.keys())
      if (roomOfKey(key) === room || share.roomOfFile(key) === room) notify(key)
  }

  const watchStore = (key: string, store: DocStore) => {
    let w = watchedStores.get(store)
    if (!w) {
      const registry = claimsFor(store)
      const pauses = pausesFor(registry, options.pauses)
      const entry = { keys: new Set<string>(), offs: [] as (() => void)[] }
      const ping = () => {
        for (const k of entry.keys) notify(k)
      }
      entry.offs.push(registry.subscribe(ping), pauses.subscribe(ping))
      watchedStores.set(store, entry)
      w = entry
    }
    w.keys.add(key)
  }

  const track = (session: SharedSession): RoomTrack => {
    const known = rooms.get(session.room)
    if (known && known.session === session) return known
    if (known) for (const off of known.offs.splice(0)) off()
    const t: RoomTrack = {
      session,
      error: null,
      downSince: session.provider.connected ? null : now(),
      changedAt: new Map(),
      uploading: new Set(),
      fetching: new Set(),
      watched: new Set(),
      fonts: fontsByRoom.get(session.room) ?? new Set(),
      offs: [],
    }
    fontsByRoom.set(session.room, t.fonts)
    rooms.set(session.room, t)
    const room = session.room
    const settle = () => {
      const connected = session.provider.connected
      if (connected) t.downSince = null
      else t.downSince ??= now()
    }
    t.offs.push(
      session.onStatus(() => {
        settle()
        notifyRoom(room)
      }),
      session.onEvent((event) => {
        if (event.type === "closed")
          t.error = event.error ? errorOf(event.error, !event.willRetry) : t.error
        else if (event.type === "denied")
          t.error = errorOf(new MultiplayerError(event.code, event.message), true)
        else if (event.type === "welcome" || event.type === "caught-up") t.error = null
        else if (event.type !== "peers") return
        settle()
        notifyRoom(room)
      }),
      session.onPresence(() => notifyRoom(room)),
      session.assetSync.onProgress((event) => {
        const set = event.kind === "upload" ? t.uploading : t.fetching
        if (event.status === "start") set.add(event.key)
        else set.delete(event.key)
        if (event.kind === "fetch") t.watched.add(event.key)
        notifyRoom(room)
      }),
      session.assetSync.subscribe(() => notifyRoom(room)),
    )
    return t
  }

  const offSessions = share.onSessionsChange(() => {
    for (const [room, t] of [...rooms])
      if (share.session(room) !== t.session) {
        for (const off of t.offs.splice(0)) off()
        rooms.delete(room)
      }
    for (const k of [...listeners.keys()]) notify(k)
  })

  const offFonts = share.onFontNotShared(({ room, families }) => {
    let set = fontsByRoom.get(room)
    if (!set) {
      set = new Set()
      fontsByRoom.set(room, set)
    }
    for (const f of families) set.add(f)
    notifyRoom(room)
  })

  const build = (key: string): ShareSnapshot => {
    const store = storeOf(key)
    if (store) watchStore(key, store)
    const claims = store ? claimsFor(store).list() : []
    const paused = store ? pausesFor(claimsFor(store), options.pauses).list() : []
    const session = sessionOf(key)
    const base = emptySnapshot(key)
    if (!session) {
      return {
        ...base,
        starting: starting.has(key),
        error: startErrors.get(key) ?? null,
        claims,
        paused,
      }
    }
    const t = track(session)
    const provider = session.provider
    const self = provider.awareness.clientId
    const states = session.presence()
    const at = now()
    const ids = new Set<number>([...provider.peers.keys(), ...states.keys()])
    ids.delete(self)
    const peers: PeerSnapshot[] = [...ids]
      .sort((a, b) => a - b)
      .map((peer) => {
        const info = provider.peers.get(peer)
        const state = states.get(peer) ?? null
        const activity = activityOf(state)
        const seen = t.changedAt.get(peer)
        if (!seen || seen.activity !== activity) t.changedAt.set(peer, { activity, at })
        return {
          peer,
          role: info?.role ?? null,
          origin: info?.origin ?? state?.origin ?? "user",
          state,
          changedAt: t.changedAt.get(peer)?.at ?? at,
        }
      })
    for (const peer of [...t.changedAt.keys()]) if (!ids.has(peer)) t.changedAt.delete(peer)
    const manifest = (session.store.toHeader() as { assets?: Record<string, { bytes?: number }> })
      .assets
    const unavailable: string[] = []
    const failed: string[] = []
    for (const k of t.watched) {
      const state = session.assetSync.state(k)
      if (state === "missing") unavailable.push(k)
      else if (state === "failed") failed.push(k)
      else if (state === "local") t.watched.delete(k)
    }
    const owned = roomOfKey(key) === null
    return {
      ...base,
      room: session.room,
      relayUrl: provider.relayUrl,
      owner: owned,
      role: session.role,
      status: session.status,
      error: t.error,
      downSince: t.downSince,
      self: self || null,
      selfState: provider.awareness.getLocalState(),
      peers,
      assets: {
        uploading: [...t.uploading],
        fetching: [...t.fetching].map((k) => ({
          key: k,
          bytes: typeof manifest?.[k]?.bytes === "number" ? (manifest[k]?.bytes as number) : null,
        })),
        unavailable,
        failed,
      },
      fontsNameOnly: [...t.fonts],
      claims,
      paused,
    }
  }

  const fileRef = (key: string): FileRef => {
    if (roomOfKey(key)) throw new MultiplayerError("BAD_REQUEST", "a joined room has no file")
    return key
  }
  const roomFor = (key: string): string => {
    const room = sessionOf(key)?.room ?? share.roomOfFile(key)
    if (!room) throw new MultiplayerError("ROOM_NOT_FOUND", "this document is not shared")
    return room
  }
  const pausesOf = (key: string) => {
    const store = storeOf(key)
    return store ? pausesFor(claimsFor(store), options.pauses) : null
  }

  return {
    snapshot(key) {
      let snap = cache.get(key)
      if (!snap) {
        snap = build(key)
        cache.set(key, snap)
      }
      return snap
    },
    subscribe(key, listener) {
      let set = listeners.get(key)
      if (!set) {
        set = new Set()
        listeners.set(key, set)
      }
      set.add(listener)
      return () => {
        set.delete(listener)
        if (set.size === 0) listeners.delete(key)
      }
    },
    async start(key, start = {}) {
      const ref = fileRef(key)
      const session = options.sessionFor(ref)
      if (!session) throw new MultiplayerError("NOT_FOUND", "the file is not open")
      starting.add(key)
      startErrors.delete(key)
      notify(key)
      try {
        await share.shareSession(session, start.relayUrl, {
          ...(start.createSecret ? { createSecret: start.createSecret } : {}),
          ...(session.assets ? { assets: session.assets } : {}),
        })
      } catch (error) {
        startErrors.set(key, errorOf(error, true))
        throw error
      } finally {
        starting.delete(key)
        notify(key)
      }
    },
    async stop(key) {
      const room = roomFor(key)
      const result = await share.stopSharing(room)
      const t = rooms.get(room)
      if (t) for (const off of t.offs.splice(0)) off()
      rooms.delete(room)
      fontsByRoom.delete(room)
      notify(key)
      return { relayNotified: result.relayNotified }
    },
    links: (key) => share.links(roomFor(key)),
    mintLink: (key, mint) =>
      share.createInvite(
        mint.role,
        mint.ttlSeconds === null ? null : Math.floor(now() / 1000) + mint.ttlSeconds,
        { room: roomFor(key), ...(mint.label !== undefined ? { label: mint.label } : {}) },
      ),
    revokeLink: (key, jti) => share.revoke(jti, roomFor(key)),
    resetAllLinks: (key) => share.resetLinks(roomFor(key)),
    setPresence(key, fields) {
      const session = sessionOf(key)
      if (session) share.setLocalPresence(fields, session.room)
    },
    async ensureAsset(key, asset) {
      const session = sessionOf(key)
      if (!session) return false
      return session.assetSync.ensure(asset)
    },
    resumeAgent(key, holder) {
      pausesOf(key)?.resumeNow(holder)
    },
    stopAgent(key, holder) {
      pausesOf(key)?.stop(holder)
    },
    refresh(key) {
      if (key !== undefined) notify(key)
      else for (const k of [...listeners.keys()]) notify(k)
    },
    dispose() {
      offFonts()
      offSessions()
      for (const t of rooms.values()) for (const off of t.offs.splice(0)) off()
      rooms.clear()
      for (const w of watchedStores.values()) for (const off of w.offs.splice(0)) off()
      watchedStores.clear()
      listeners.clear()
      cache.clear()
    },
  }
}

/**
 * A backend that delegates to `initial` until `next` resolves, then to what it resolved with
 * (desktop editor windows: the document host's backend once the host answered). Subscribers
 * stay subscribed across the switch and are told to read again.
 */
export function switchingShareBackend(
  initial: ShareBackend,
  next: Promise<ShareBackend | null>,
): ShareBackend {
  let current = initial
  const subs = new Map<() => void, { key: string; off: () => void }>()
  void next.then(
    (resolved) => {
      if (!resolved || resolved === current) return
      current = resolved
      for (const [listener, sub] of subs) {
        sub.off()
        sub.off = current.subscribe(sub.key, listener)
        listener()
      }
    },
    () => undefined,
  )
  return {
    snapshot: (key) => current.snapshot(key),
    subscribe(key, listener) {
      // One entry per subscription, keyed by a wrapper so the same listener can watch two keys.
      const wrapper = () => listener()
      subs.set(wrapper, { key, off: current.subscribe(key, wrapper) })
      return () => {
        subs.get(wrapper)?.off()
        subs.delete(wrapper)
      }
    },
    start: (key, options) => current.start(key, options),
    stop: (key) => current.stop(key),
    links: (key) => current.links(key),
    mintLink: (key, options) => current.mintLink(key, options),
    revokeLink: (key, jti) => current.revokeLink(key, jti),
    resetAllLinks: (key) => current.resetAllLinks(key),
    setPresence: (key, fields) => current.setPresence(key, fields),
    ensureAsset: (key, asset) => current.ensureAsset(key, asset),
    resumeAgent: (key, holder) => current.resumeAgent(key, holder),
    stopAgent: (key, holder) => current.stopAgent(key, holder),
  }
}
