/**
 * Headless sharing for the app (docs/spec/multiplayer.md §16, ADR 0016): what the Share panel
 * and the join route call, with no UI of their own. It binds the share service to the window's
 * platform: the relay URL comes from the `multiplayer.relayUrl` setting (there is no default
 * relay), the owner's room keys live in the local registry, and a session's file stays the
 * owner's, with room and file meeting only as CRDT replicas.
 */

import type { KimoDocument } from "@kimo/core-schema"
import { claimsFor, createDocStore, type DocStore } from "@kimo/editor-state"
import { type FileRef, type KimoPlatform, resolveAgainstFile } from "@kimo/platform"
import { bindClaimsToPresence, type PresenceState, type SyncStatusEvent } from "@kimo/sync"
import {
  type MpOrigin,
  MultiplayerError,
  normalizeRelayUrl,
  parseJoinLink,
  type Role,
} from "@kimo/sync/mp"
import { type AssetStore, createAssetStore, createFolderAssetStore } from "../lib/assets"
import {
  createRegistry,
  createShareService,
  fileRegistryBackend,
  type IssuedLink,
  type PresenceChange,
  type Registry,
  type SharedSession,
  type ShareService,
  type ShareServiceDeps,
  type StopSharingResult,
  type SweepResult,
} from "../multiplayer"
import { deviceKeysFor, deviceNameFor } from "../multiplayer/device"
import { libraryFileOfKey } from "../multiplayer/library"
import { pickPresenceColor } from "../multiplayer/presence"
import type { ShareTarget, TokenRoom } from "../multiplayer/share"

/** What sharing needs of an open document: the file it came from and its store. */
export interface ShareableSession {
  readonly ref: FileRef
  readonly store: DocStore
}

export interface ShareOptions {
  /** Seconds the first view and edit links stay valid; null (default) never expires. */
  ttlSeconds?: number | null
  /** The asset store of this document. Default: the `assets/` folder beside the file. */
  assets?: AssetStore
}

/**
 * Local files bound to Kimo Cloud workspace rooms (ADR 0019): the workspace store installs these so
 * a bound file reopens in its room like a file this device shares (`cloud/workspaces.ts`).
 */
export interface CloudFileHooks {
  /** Whether `ref` is bound to a workspace room (open or not). */
  isBound(ref: FileRef): Promise<boolean>
  /**
   * Reopens a bound file: its room session, or null to load the file as usual (the workspace store
   * may have made the store read-only first: a deleted workspace, a member removed).
   */
  reopen(
    session: ShareableSession,
    target: ShareTarget,
    file: KimoDocument | null,
  ): Promise<SharedSession | null>
  /** The bound file `from` now lives at `to` (Save As). */
  moved(from: FileRef, to: FileRef): Promise<void>
}

export interface SharedRoomLinks {
  room: string
  relayUrl: string
  view: IssuedLink
  edit: IssuedLink
}

export interface InviteOptions {
  /** The room to invite to. Default: the active room. */
  room?: string
  label?: string
  origin?: MpOrigin
}

/** Links minted with a TTL are reused only while more than this remains (seconds). */
const REUSE_MARGIN_S = 60

/**
 * The desktop webview's CSP (`connect-src`, apps/desktop/src-tauri/tauri.conf.json) is static:
 * it allows https and wss anywhere, and plain http and ws only for localhost, 127.0.0.1 and
 * `*.local`. A relay the CSP would block fails here with the real reason instead of as an
 * unreachable relay after the fact.
 */
export function assertRelayReachable(platform: Pick<KimoPlatform, "kind">, relayUrl: string): void {
  if (platform.kind !== "desktop") return
  const url = new URL(normalizeRelayUrl(relayUrl))
  if (url.protocol !== "http:") return
  const host = url.hostname
  if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".local")) return
  throw new MultiplayerError(
    "BAD_RELAY_URL",
    "the desktop app reaches plain http relays only on localhost, 127.0.0.1 and .local hosts: put the relay behind https (a private IP address needs TLS here)",
  )
}

/** Where the desktop keeps the owner's room registry: `${kimoHome}/multiplayer/rooms.json`. */
export function desktopRegistryPath(kimoHome: string): string {
  return `${kimoHome.replace(/[\\/]+$/, "")}/multiplayer/rooms.json`
}

/**
 * The owner's registry on `platform`: on desktop a JSON file under the Kimo home (the document
 * host owns the shared files there, and only it writes this file); elsewhere undefined, so the
 * share service keeps it in IndexedDB.
 */
function registryFor(platform: Pick<KimoPlatform, "kind" | "kimoHome" | "files">) {
  if (platform.kind !== "desktop" || !platform.kimoHome) return undefined
  return createRegistry(fileRegistryBackend(platform.files, desktopRegistryPath(platform.kimoHome)))
}

/** What a client publishes about its pointer and view (the user part is filled in). */
export type LocalPresence = Omit<PresenceState, "origin" | "user" | "claims" | "working">

const USER_ID_KEY = "kimo.multiplayer.userId"

/** A random id that names this person in presence, kept in local storage when it can be. */
function deviceUserId(): string {
  const fresh = () =>
    Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 16)
  try {
    const store = (globalThis as { localStorage?: Storage }).localStorage
    if (!store) return fresh()
    const known = store.getItem(USER_ID_KEY)
    if (known && /^[0-9a-f]{16}$/.test(known)) return known
    const id = fresh()
    store.setItem(USER_ID_KEY, id)
    return id
  } catch {
    return fresh()
  }
}

interface PlatformShareDeps {
  platform: KimoPlatform
  /** Test seam: the underlying service. Default: built from `platform`. */
  service?: ShareService
  /** Extra service deps (registry, fetch, WebSocket, replica, timing). */
  serviceDeps?: Partial<ShareServiceDeps>
  /** The asset store of a session being shared. Default: `assets/` beside the file. */
  assetsFor?(session: ShareableSession): AssetStore
  /**
   * The owner's registry. Default {@link registryFor}: the JSON file under the Kimo home on
   * desktop, IndexedDB elsewhere. Desktop editor windows (guests only) pass `"indexeddb"`, so
   * just the document host writes the file.
   */
  registry?: Registry | "indexeddb"
  /** This person's presence id. Default: a random id kept in local storage. */
  userId?: string
}

export interface PlatformShare {
  /** The configured relay URL, or null (there is no default). */
  relayUrl(): string | null
  /** Saves the relay URL setting (normalized); null clears it. */
  setRelayUrl(url: string | null): Promise<string | null>
  /** Shares the open document: creates the room, seeds it, returns view and edit links. */
  shareSession(
    session: ShareableSession,
    relayUrl?: string,
    options?: ShareOptions,
  ): Promise<SharedRoomLinks>
  /**
   * Records that `doc` was just written to the shared file of `session` (call it with the
   * document that was serialized, right when it is). Keeps a later reopen from treating the file
   * as newer than the room.
   */
  noteSaved(session: ShareableSession, doc: KimoDocument): Promise<void>
  /**
   * {@link ShareService.captureSaved} for a session: call it with the document being written to
   * the shared file; run the returned function once the write landed.
   */
  captureSaved(session: ShareableSession, doc: KimoDocument): () => Promise<void>
  /** Reopens a document that was shared before; null when it was not. */
  reopenShared(
    session: ShareableSession,
    file: KimoDocument,
    assets?: AssetStore,
  ): Promise<SharedSession | null>
  /**
   * Reconnects a shared document whose own persistence is a CRDT replica of the room (a browser
   * library file, `kimo-lib:<id>`): the store already holds what the room had when it was last
   * open here, so the room attaches with no file delta. Null when the document is not shared.
   */
  reconnectReplica(session: ShareableSession, assets?: AssetStore): Promise<SharedSession | null>
  /**
   * The document `from` now lives at `to` (Save As): its room follows it, here and in the owner's
   * registry, so the new file stays shared. A no-op for a document that is not shared.
   */
  fileMoved(from: FileRef, to: FileRef): Promise<void>
  /** Joins from a link (the fragment of `https://<web-origin>/join#...`). */
  joinLink(link: string): Promise<SharedSession>
  /**
   * Opens a Kimo Cloud workspace room with a token from Kimo Cloud: in `session`'s document (a
   * local file bound to the room, `file` adding what it changed since its last save), or without
   * one in a Kimo-managed replica. The session is tracked like any other (presence, status).
   */
  openCloudRoom(
    room: TokenRoom,
    options?: { session?: ShareableSession; file?: KimoDocument | null; assets?: AssetStore },
  ): Promise<SharedSession>
  /** The upload target of an open document (its store and asset store), for seeding a room. */
  targetOf(session: ShareableSession, assets?: AssetStore): ShareTarget
  /** Installs the workspace store's hooks for bound files (null removes them). */
  setCloudFiles(hooks: CloudFileHooks | null): void
  /** Whether `ref` reopens in a room: shared by this device or bound to a workspace room. */
  isShared(ref: FileRef): Promise<boolean>
  /** Mints a link for `role` that expires at `exp` (unix seconds; 0 or null never). */
  createInvite(role: Role, exp: number | null, options?: InviteOptions): Promise<IssuedLink>
  links(room?: string): Promise<IssuedLink[]>
  revoke(jti: string, room?: string): Promise<void>
  resetLinks(room?: string): Promise<{ kid: number }>
  sweepBlobs(room?: string, options?: { graceDays?: number }): Promise<SweepResult>
  stopSharing(room?: string): Promise<StopSharingResult>
  leave(room?: string): Promise<void>
  /** The room commands act on when none is named: the last one shared or joined. */
  activeRoom(): string | null
  session(room?: string): SharedSession | null
  presence(room?: string): ReturnType<SharedSession["presence"]>
  onPresence(listener: (room: string, change: PresenceChange) => void): () => void
  status(room?: string): SyncStatusEvent["status"] | null
  onStatus(listener: (room: string, event: SyncStatusEvent) => void): () => void
  onFontNotShared: ShareService["onFontNotShared"]
  /**
   * Publishes this person's pointer, selection, page and viewport in `room` (default: the active
   * one). The user part (id, display name or empty for Guest N, presence color) is filled in.
   */
  setLocalPresence(fields: LocalPresence, room?: string): void
  /** This person's presence user in `room` as published (the color is per room). */
  localUser(room?: string): PresenceState["user"]
  /** The room open for a file, if any. */
  roomOfFile(ref: FileRef): string | null
  /** Fires when a room session opens or closes here (share, reopen, join, leave, stop). */
  onSessionsChange(listener: () => void): () => void
  readonly service: ShareService
}

export function createPlatformShare(deps: PlatformShareDeps): PlatformShare {
  const { platform } = deps
  const registry =
    deps.serviceDeps?.registry ??
    (deps.registry === "indexeddb" ? undefined : (deps.registry ?? registryFor(platform)))
  const service =
    deps.service ??
    createShareService({
      openGuestDocument: async (room, binding) => ({
        store: createDocStore(),
        assets: createAssetStore(`room-${room}-${binding}`),
      }),
      autoFetchAssets: () => platform.settings.get("multiplayer.fetchAssets") !== false,
      deviceKeys: deviceKeysFor(platform),
      deviceName: () => deviceNameFor(platform),
      ...(registry ? { registry } : {}),
      ...deps.serviceDeps,
    })

  const userId = deps.userId ?? deviceUserId()
  /** Per room: the presence color picked and the fields last published. */
  const local = new Map<string, { color: string; fields: LocalPresence }>()
  const displayName = () => {
    const name = platform.settings.get("multiplayer.displayName")
    return typeof name === "string" ? name.trim().slice(0, 80) : ""
  }
  const userIn = (session: SharedSession): PresenceState["user"] => {
    const mine = local.get(session.room)
    const self = session.provider.awareness.clientId
    // People who joined before this replica (lower peer ids) keep their colors.
    const earlier = [...session.presence()]
      .filter(([peer, state]) => peer !== self && peer < self && state.origin === "user")
      .map(([, state]) => state.user.color)
    const color = pickPresenceColor(mine?.color, self === 0 ? [] : earlier)
    return { id: userId, name: displayName(), color }
  }
  const publish = (session: SharedSession) => {
    const user = userIn(session)
    const entry = local.get(session.room) ?? { color: user.color, fields: {} }
    entry.color = user.color
    local.set(session.room, entry)
    const current = session.provider.awareness.getLocalState()
    const { origin: _o, ...rest } = current ?? ({} as Partial<PresenceState>)
    const next = {
      ...rest,
      ...entry.fields,
      user,
      ...(owners.has(session.room) ? { owner: true } : {}),
    } as Omit<PresenceState, "origin">
    // A field this publish leaves out is gone (the pointer left, the text edit ended).
    for (const key of ["cursor", "selection", "page", "viewport", "text"] as const)
      if (!(key in entry.fields)) delete next[key]
    session.setPresence(next)
  }

  const sessions = new Map<string, SharedSession>()
  /** Rooms this device owns (their presence says so: the people list puts the owner first). */
  const owners = new Set<string>()
  const targets = new Map<string, ShareableSession>()
  /** One `shareSession` run per file at a time (see there). */
  const sharing = new Map<string, Promise<unknown>>()
  const presenceListeners = new Set<(room: string, change: PresenceChange) => void>()
  const statusListeners = new Set<(room: string, event: SyncStatusEvent) => void>()
  const sessionListeners = new Set<() => void>()
  const sessionsChanged = () => {
    for (const l of [...sessionListeners]) l()
  }
  let active: string | null = null
  let cloudFiles: CloudFileHooks | null = null

  const track = (session: SharedSession, owner = false): SharedSession => {
    const previous = sessions.get(session.room)
    if (previous === session) {
      active = session.room
      return session
    }
    if (previous) void previous.leave()
    sessions.set(session.room, session)
    if (owner) owners.add(session.room)
    else owners.delete(session.room)
    active = session.room
    // Agent area claims travel in presence: this client's agents publish theirs, and peers'
    // claims gate the agents here (spec §15.11). One binding per shared document.
    const unbindClaims = bindClaimsToPresence(
      claimsFor(session.store),
      session.provider.awareness,
      { user: userIn(session) },
    )
    publish(session)
    // Only presence this layer published is kept in step (a caller that set its own user through
    // `session.setPresence` keeps it).
    const ours = () => {
      const cur = session.provider.awareness.getLocalState()
      return !cur || cur.user.id === userId
    }
    const offs = [
      unbindClaims,
      session.onStatus((event) => {
        for (const l of [...statusListeners]) l(session.room, event)
      }),
      session.onPresence((change) => {
        // An earlier joiner took this replica's color: pick again.
        const mine = local.get(session.room)?.color
        if (mine !== undefined && ours() && userIn(session).color !== mine) publish(session)
        for (const l of [...presenceListeners]) l(session.room, change)
      }),
      session.onEvent((event) => {
        // The relay assigns the peer id on welcome: the color is settled against it.
        if (event.type === "welcome" && ours()) publish(session)
      }),
      platform.settings.onChange((key) => {
        if (key === "multiplayer.displayName" && ours()) publish(session)
      }),
    ]
    queueMicrotask(sessionsChanged)
    const leave = session.leave.bind(session)
    // Leaving forgets the session here too.
    ;(session as { leave: () => Promise<void> }).leave = async () => {
      for (const off of offs) off()
      local.delete(session.room)
      if (sessions.get(session.room) === session) sessions.delete(session.room)
      if (active === session.room) active = null
      sessionsChanged()
      await leave()
    }
    return session
  }

  const roomOf = (room?: string): string => {
    const id = room ?? active
    if (!id) throw new MultiplayerError("ROOM_NOT_FOUND", "no room is shared or joined")
    return id
  }

  const targetOf = (room: string) => {
    const session = sessions.get(room)
    if (!session) throw new MultiplayerError("ROOM_NOT_FOUND", "the room is not open here")
    return { fileKey: targets.get(room)?.ref ?? room, store: session.store, assets: session.assets }
  }

  const targetFor = (session: ShareableSession, assets?: AssetStore) => {
    // A browser library file: its assets live in IndexedDB, and it has no folder to read from.
    const libraryFile = libraryFileOfKey(session.ref)
    if (libraryFile !== null)
      return {
        fileKey: session.ref,
        store: session.store,
        assets: assets ?? deps.assetsFor?.(session) ?? createAssetStore(libraryFile),
      }
    return {
      fileKey: session.ref,
      store: session.store,
      assets: assets ?? deps.assetsFor?.(session) ?? createFolderAssetStore(platform, session.ref),
      readRelative: (path: string) =>
        platform.files.readBytes(resolveAgainstFile(session.ref, path)).catch(() => null),
    }
  }

  const shareOnce: PlatformShare["shareSession"] = async (session, relayUrl, options = {}) => {
    const url = relayUrl ?? self.relayUrl()
    if (!url)
      throw new MultiplayerError(
        "BAD_RELAY_URL",
        "set a relay URL first: Kimo has no default relay",
      )
    assertRelayReachable(platform, url)
    const target = targetFor(session, options.assets)
    const summary = await service.startSharing(target, { relayUrl: url })
    // `startSharing` connected a session; the registry-backed `connect` returns the tracked one.
    const live =
      sessions.get(summary.room) ?? track(await service.connect(target, summary.room), true)
    targets.set(live.room, session)
    const ttl = options.ttlSeconds ?? null
    // Reuse only links the relay still takes: this key generation and not expired.
    const nowS = Math.floor(Date.now() / 1000)
    const existing = summary.links.filter(
      (l) =>
        !l.self &&
        !l.revoked &&
        l.kid === summary.kid &&
        (l.exp === 0 || l.exp > nowS + REUSE_MARGIN_S),
    )
    const view =
      existing.find((l) => l.role === "view") ??
      (await service.mintLink(summary.room, { role: "view", ttlSeconds: ttl }))
    const edit =
      existing.find((l) => l.role === "edit") ??
      (await service.mintLink(summary.room, { role: "edit", ttlSeconds: ttl }))
    return { room: summary.room, relayUrl: summary.relayUrl, view, edit }
  }

  const self: PlatformShare = {
    service,

    relayUrl: () => platform.settings.get("multiplayer.relayUrl"),

    async setRelayUrl(url) {
      const next = url === null || url.trim() === "" ? null : normalizeRelayUrl(url)
      if (next !== null) assertRelayReachable(platform, next)
      await platform.settings.set("multiplayer.relayUrl", next)
      return next
    },

    shareSession(session, relayUrl, options = {}) {
      // Serialized per file, links included: a second Start sharing (a double click, or the
      // popover and the wizard both starting) reuses the first run's view and edit links instead
      // of each run finding none yet and minting its own pair.
      const prev = sharing.get(session.ref) ?? Promise.resolve()
      const run = prev.then(
        () => shareOnce(session, relayUrl, options),
        () => shareOnce(session, relayUrl, options),
      )
      const tail = run.catch(() => undefined)
      sharing.set(session.ref, tail)
      void tail.then(() => {
        if (sharing.get(session.ref) === tail) sharing.delete(session.ref)
      })
      return run
    },

    noteSaved: (session, doc) =>
      service.noteSaved({ fileKey: session.ref, store: session.store }, doc),

    captureSaved: (session, doc) =>
      service.captureSaved({ fileKey: session.ref, store: session.store }, doc),

    async reopenShared(session, file, assets) {
      const target = targetFor(session, assets)
      const shared = await service.reopenShared(target, file)
      if (!shared) {
        const bound = await cloudFiles?.reopen(session, target, file)
        if (!bound) return null
        targets.set(bound.room, session)
        return track(bound)
      }
      targets.set(shared.room, session)
      return track(shared, true)
    },

    async reconnectReplica(session, assets) {
      const owned = await service.roomForFile(session.ref)
      if (!owned) {
        const bound = await cloudFiles?.reopen(session, targetFor(session, assets), null)
        if (!bound) return null
        targets.set(bound.room, session)
        return track(bound)
      }
      const shared = await service.connect(targetFor(session, assets), owned.room)
      targets.set(shared.room, session)
      return track(shared, true)
    },

    async fileMoved(from, to) {
      if (from === to) return
      // Targets saved as plain objects keep the old ref; a live session already reads the new one.
      for (const [room, target] of targets)
        if (target.ref === from) targets.set(room, { ref: to, store: target.store })
      await service.moveFile(from, to)
      await cloudFiles?.moved(from, to)
      sessionsChanged()
    },

    async openCloudRoom(room, options = {}) {
      assertRelayReachable(platform, room.relayUrl)
      const { session } = options
      const shared = await service.openWithToken({
        ...room,
        ...(session ? { target: targetFor(session, options.assets) } : {}),
        file: options.file ?? null,
      })
      if (session) targets.set(shared.room, session)
      return track(shared)
    },

    targetOf: (session, assets) => targetFor(session, assets),

    setCloudFiles(hooks) {
      cloudFiles = hooks
    },

    async isShared(ref) {
      if (await service.roomForFile(ref).catch(() => null)) return true
      return (await cloudFiles?.isBound(ref).catch(() => false)) ?? false
    },

    async joinLink(link) {
      assertRelayReachable(platform, parseJoinLink(link).relayUrl)
      return track(await service.join(link))
    },

    createInvite(role, exp, options = {}) {
      const room = roomOf(options.room)
      const left = exp === null || exp === 0 ? null : exp - Math.floor(Date.now() / 1000)
      if (left !== null && left <= 0)
        return Promise.reject(
          new MultiplayerError("BAD_REQUEST", "the invite expiry is not in the future"),
        )
      const ttlSeconds = left
      return service.mintLink(room, {
        role,
        ttlSeconds,
        ...(options.label !== undefined ? { label: options.label } : {}),
        ...(options.origin ? { origin: options.origin } : {}),
      })
    },

    links: (room) => service.listLinks(roomOf(room)),
    revoke: (jti, room) => service.revokeLink(roomOf(room), jti),
    resetLinks: (room) => service.resetAllLinks(roomOf(room)),
    sweepBlobs(room, options) {
      const id = roomOf(room)
      return service.sweepBlobs(id, targetOf(id), options)
    },

    async stopSharing(room) {
      const id = roomOf(room)
      // Through the tracked leave, so this layer's bindings (claims, presence) go with it.
      await sessions.get(id)?.leave()
      const result = await service.stopSharing(id)
      sessions.delete(id)
      targets.delete(id)
      owners.delete(id)
      if (active === id) active = null
      sessionsChanged()
      return result
    },

    async leave(room) {
      await sessions.get(roomOf(room))?.leave()
    },

    activeRoom: () => active,
    session: (room) => sessions.get(room ?? active ?? "") ?? null,
    presence: (room) => sessions.get(roomOf(room))?.presence() ?? new Map(),
    onPresence(listener) {
      presenceListeners.add(listener)
      return () => presenceListeners.delete(listener)
    },
    status: (room) => sessions.get(room ?? active ?? "")?.status ?? null,
    onStatus(listener) {
      statusListeners.add(listener)
      return () => statusListeners.delete(listener)
    },
    onFontNotShared: (listener) => service.onFontNotShared(listener),

    setLocalPresence(fields, room) {
      const session = sessions.get(room ?? active ?? "")
      if (!session) return
      const entry = local.get(session.room) ?? { color: userIn(session).color, fields: {} }
      entry.fields = { ...fields }
      local.set(session.room, entry)
      publish(session)
    },

    localUser(room) {
      const session = sessions.get(room ?? active ?? "")
      if (!session) return { id: userId, name: displayName(), color: "presence-clay" }
      return userIn(session)
    },

    onSessionsChange(listener) {
      sessionListeners.add(listener)
      return () => sessionListeners.delete(listener)
    },

    roomOfFile(ref) {
      for (const [room, target] of targets)
        if (target.ref === ref && sessions.has(room)) return room
      return null
    },
  }
  return self
}
