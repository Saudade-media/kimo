/**
 * Headless sharing for the app (docs/spec/multiplayer.md §16, ADR 0016): what the Share panel
 * and the join route call, with no UI of their own. It binds the share service to the window's
 * platform: the relay URL comes from the `multiplayer.relayUrl` setting (there is no default
 * relay), the owner's room keys live in the local registry, and a session's file stays the
 * owner's, with room and file meeting only as CRDT replicas.
 */

import type { KimoDocument } from "@kimo/core-schema"
import { createDocStore, type DocStore } from "@kimo/editor-state"
import { type FileRef, type KimoPlatform, resolveAgainstFile } from "@kimo/platform"
import type { SyncStatusEvent } from "@kimo/sync"
import {
  type MpOrigin,
  MultiplayerError,
  normalizeRelayUrl,
  parseJoinLink,
  type Role,
} from "@kimo/sync/mp"
import { type AssetStore, createAssetStore, createFolderAssetStore } from "../lib/assets"
import {
  createShareService,
  type IssuedLink,
  type PresenceChange,
  type SharedSession,
  type ShareService,
  type ShareServiceDeps,
  type StopSharingResult,
  type SweepResult,
} from "../multiplayer"

/** What sharing needs of an open document: the file it came from and its store. */
export interface ShareableSession {
  readonly ref: FileRef
  readonly store: DocStore
}

export interface ShareOptions {
  /** Seconds the first view and edit links stay valid; null (default) never expires. */
  ttlSeconds?: number | null
  /** The relay's create secret, when it asks for one. */
  createSecret?: string
  /** The asset store of this document. Default: the `assets/` folder beside the file. */
  assets?: AssetStore
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

export interface PlatformShareDeps {
  platform: KimoPlatform
  /** Test seam: the underlying service. Default: built from `platform`. */
  service?: ShareService
  /** Extra service deps (registry, fetch, WebSocket, replica, timing). */
  serviceDeps?: Partial<ShareServiceDeps>
  /** The asset store of a session being shared. Default: `assets/` beside the file. */
  assetsFor?(session: ShareableSession): AssetStore
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
  /** Reopens a document that was shared before; null when it was not. */
  reopenShared(
    session: ShareableSession,
    file: KimoDocument,
    assets?: AssetStore,
  ): Promise<SharedSession | null>
  /** Joins from a link (the fragment of `https://<web-origin>/join#...`). */
  joinLink(link: string): Promise<SharedSession>
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
  readonly service: ShareService
}

export function createPlatformShare(deps: PlatformShareDeps): PlatformShare {
  const { platform } = deps
  const origin =
    deps.serviceDeps?.webOrigin ??
    (platform.kind === "desktop" ? "kimo:" : typeof location === "object" ? location.origin : "")
  const service =
    deps.service ??
    createShareService({
      webOrigin: origin,
      openGuestDocument: async (room, binding) => ({
        store: createDocStore(),
        assets: createAssetStore(`room-${room}-${binding}`),
      }),
      ...deps.serviceDeps,
    })

  const sessions = new Map<string, SharedSession>()
  const targets = new Map<string, ShareableSession>()
  const presenceListeners = new Set<(room: string, change: PresenceChange) => void>()
  const statusListeners = new Set<(room: string, event: SyncStatusEvent) => void>()
  let active: string | null = null

  const track = (session: SharedSession): SharedSession => {
    const previous = sessions.get(session.room)
    if (previous === session) {
      active = session.room
      return session
    }
    if (previous) void previous.leave()
    sessions.set(session.room, session)
    active = session.room
    const offs = [
      session.onStatus((event) => {
        for (const l of [...statusListeners]) l(session.room, event)
      }),
      session.onPresence((change) => {
        for (const l of [...presenceListeners]) l(session.room, change)
      }),
    ]
    const leave = session.leave.bind(session)
    // Leaving forgets the session here too.
    ;(session as { leave: () => Promise<void> }).leave = async () => {
      for (const off of offs) off()
      if (sessions.get(session.room) === session) sessions.delete(session.room)
      if (active === session.room) active = null
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

  const targetFor = (session: ShareableSession, assets?: AssetStore) => ({
    fileKey: session.ref,
    store: session.store,
    assets: assets ?? deps.assetsFor?.(session) ?? createFolderAssetStore(platform, session.ref),
    readRelative: (path: string) =>
      platform.files.readBytes(resolveAgainstFile(session.ref, path)).catch(() => null),
  })

  const self: PlatformShare = {
    service,

    relayUrl: () => platform.settings.get("multiplayer.relayUrl"),

    async setRelayUrl(url) {
      const next = url === null || url.trim() === "" ? null : normalizeRelayUrl(url)
      if (next !== null) assertRelayReachable(platform, next)
      await platform.settings.set("multiplayer.relayUrl", next)
      return next
    },

    async shareSession(session, relayUrl, options = {}) {
      const url = relayUrl ?? self.relayUrl()
      if (!url)
        throw new MultiplayerError(
          "BAD_RELAY_URL",
          "set a relay URL first: Kimo has no default relay",
        )
      assertRelayReachable(platform, url)
      const target = targetFor(session, options.assets)
      const summary = await service.startSharing(target, {
        relayUrl: url,
        ...(options.createSecret ? { createSecret: options.createSecret } : {}),
      })
      // `startSharing` connected a session; the registry-backed `connect` returns the tracked one.
      const live = sessions.get(summary.room) ?? track(await service.connect(target, summary.room))
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
    },

    noteSaved: (session, doc) =>
      service.noteSaved({ fileKey: session.ref, store: session.store }, doc),

    async reopenShared(session, file, assets) {
      const shared = await service.reopenShared(targetFor(session, assets), file)
      if (!shared) return null
      targets.set(shared.room, session)
      return track(shared)
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
      const result = await service.stopSharing(id)
      sessions.delete(id)
      targets.delete(id)
      if (active === id) active = null
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
  }
  return self
}
