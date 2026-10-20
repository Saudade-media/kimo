/**
 * The share service: the headless API the Share panel and the join route call
 * (docs/spec/multiplayer.md §16.1, ADR 0016). It owns everything the UI must not know about:
 * the room keys, signed capability links, the blind relay's admin commands, the local registry
 * and the attach order of a shared session.
 *
 * The `.kimo` file stays the owner's. A shared room and the file meet only as CRDT replicas:
 * sharing seeds the room from the open document, and reopening a shared file applies only what
 * changed in the file since the owner last saved it (a delta over the saved state), so edits
 * collaborators made in the meantime are never reverted by an older file.
 */

import type { KimoDocument } from "@kimo/core-schema"
import { referencedAssets, usedFontFamilies } from "@kimo/core-schema"
import { createDocStore, type DocStore } from "@kimo/editor-state"
import {
  createNetworkProvider,
  type NetworkEvent,
  type NetworkProvider,
  type NetworkProviderOptions,
  type PresenceState,
  type RoomStateStore,
  type SyncProvider,
  type SyncStatusEvent,
  VIEW_ONLY_REASON,
} from "@kimo/sync"
import { hasIndexedDb, IndexedDbProvider } from "@kimo/sync/indexeddb"
import {
  blobIdFor,
  createFontGuard,
  deriveRoomId,
  deriveRoomKeys,
  embedShaders,
  exportPublicKey,
  formatJoinLink,
  fromHex,
  generateRoomKey,
  generateSigningKeyPair,
  isRetryable,
  type MpOrigin,
  MultiplayerError,
  mintToken,
  normalizeRelayUrl,
  parseJoinLink,
  parseRoomId,
  parseToken,
  RelayHttpClient,
  type RelayInfo,
  type Role,
  randomBytes,
  sealSnapshot,
  shippedFontSource,
  signAdminCommand,
  signLinkCert,
  toBase64Url,
  toHex,
} from "@kimo/sync/mp"
import { isFontAsset, loadDocumentFontFaces } from "../fonts/document-fonts"
import {
  type AssetStore,
  contentDigest,
  deleteAssetDb,
  type ManifestEntry,
  manifestEntry,
} from "../lib/assets"
import { type AssetSync, createAssetSync, withRemoteAssets } from "./asset-sync"
import {
  createMemoryRegistry,
  createRegistry,
  type IssuedLink,
  indexedDbRegistryBackend,
  type JoinedRoom,
  type OwnedRoom,
  type Registry,
} from "./registry"

export type { AssetSync, AssetSyncState } from "./asset-sync"
export type { IssuedLink, JoinedRoom, OwnedRoom } from "./registry"

export interface ShareTarget {
  /** Stable local key of the document: the file path on desktop, the file id on web. */
  fileKey: string
  store: DocStore
  assets: AssetStore
  /** Reads a file relative to the document (shader sources); null when unavailable. */
  readRelative?(path: string): Promise<Uint8Array | null>
}

export interface StopSharingResult {
  /** False when the relay's close failed with a retryable error: the room lives on there. */
  relayNotified: boolean
  /** Why the relay was not told. */
  relayError?: MultiplayerError
}

export interface OwnedRoomSummary {
  room: string
  relayUrl: string
  fileKey: string
  kid: number
  createdAt: number
  links: IssuedLink[]
}

export interface JoinedRoomSummary {
  room: string
  relayUrl: string
  role: Role
  joinedAt: number
}

export interface MintLinkOptions {
  role: Role
  /** Seconds the link stays valid; null never expires. */
  ttlSeconds: number | null
  label?: string
  origin?: MpOrigin
}

export interface SweepResult {
  marked: number
  deleted: number
  kept: number
  bytesFreed: number
}

/** What preparing the document for a room changed (spec §16.1 step 3). */
export interface PrepareResult {
  /** Manifest entries that gained a `sha256`. */
  hashed: number
  /** Shader sources rewritten to hash-named assets. */
  shaders: number
  /** Shader sources that could not be read; left unchanged. */
  missingShaders: string[]
}

export type PresenceChange = { added: number[]; updated: number[]; removed: number[] }

export interface SharedSession {
  readonly room: string
  readonly role: Role
  readonly store: DocStore
  readonly provider: NetworkProvider
  /** Wrapped with {@link withRemoteAssets}: a miss asks the relay. */
  readonly assets: AssetStore
  readonly assetSync: AssetSync
  /** Connection status (`connecting`, `synced`, `saving`, `read-only`, `error`, ...). */
  readonly status: SyncStatusEvent["status"]
  onStatus(listener: (event: SyncStatusEvent) => void): () => void
  onEvent(listener: (event: NetworkEvent) => void): () => void
  /** Everyone in the room, this replica included, keyed by peer id. */
  presence(): ReadonlyMap<number, PresenceState>
  onPresence(listener: (change: PresenceChange) => void): () => void
  setPresence(state: Omit<PresenceState, "origin"> | null): void
  leave(): Promise<void>
}

export interface ShareServiceDeps {
  registry?: Registry
  fetch?: typeof fetch
  WebSocket?: NetworkProviderOptions["WebSocket"]
  /** Base for join links. Default `location.origin` on web, `kimo:` on desktop. */
  webOrigin: string
  /**
   * Creates the store and asset store a guest room lives in. `binding` ties them to the relay
   * and room key they were joined with (see {@link roomBinding}): name the asset store with it.
   */
  openGuestDocument(room: string, binding: string): Promise<{ store: DocStore; assets: AssetStore }>
  /**
   * The persisted replica of a room's CRDT state (attached before the network provider).
   * Default: IndexedDB `kimo-room-<room>-<binding>` where IndexedDB exists, else none. The
   * binding keeps a link that names the same room on another relay or key out of this replica.
   */
  replica?(room: string, binding: string): SyncProvider | null
  /** Deletes a room's replica (stop sharing, forget). Default: drops the IndexedDB database. */
  deleteReplica?(room: string, binding: string): Promise<void>
  /**
   * Deletes a guest's decrypted asset store (forget). Default: drops the IndexedDB database
   * `openGuestDocument` named `room-<room>-<binding>` through the asset store helpers.
   */
  deleteGuestAssets?(room: string, binding: string): Promise<void>
  /** Provider and asset sync tuning (tests shorten the back-off). */
  backoff?: [min: number, max: number]
  /** Wait bounds before asking again for a blob that was not on the relay yet (tests shorten). */
  missingRetry?: [min: number, max: number]
  timing?: NetworkProviderOptions["timing"]
  now?: () => number
  /** Timers for the owner's token renewal (tests pass a fake clock). Default the globals. */
  timers?: ShareTimers
  /**
   * Settings › Multiplayer "Fetch images and fonts": when it returns false, a missing asset is
   * not fetched on its own (an explicit `assetSync.ensure` still is). Default always.
   */
  autoFetchAssets?: () => boolean
}

/** The timer functions the share service schedules with. */
export interface ShareTimers {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export interface ShareService {
  probeRelay(relayUrl: string): Promise<RelayInfo>
  startSharing(
    target: ShareTarget,
    options: { relayUrl: string; createSecret?: string },
  ): Promise<OwnedRoomSummary>
  roomForFile(fileKey: string): Promise<OwnedRoomSummary | null>
  connect(target: ShareTarget, room: string): Promise<SharedSession>
  /**
   * Reopens a shared file (spec §16.3). The room state comes first (the replica, or the catch-up
   * when there is none); `file` then contributes only what it changed since the owner last saved
   * it (see {@link ShareService.noteSaved}). The file is never applied as the newer version of
   * the room. Resolves null when the file is not shared (the caller loads it as usual).
   */
  reopenShared(target: ShareTarget, file: KimoDocument): Promise<SharedSession | null>
  /**
   * Records that `doc` was just written to the shared file of `target`. Call it synchronously
   * with the document that was serialized (before any await), so the recorded state is the one
   * the file holds. Until the first call the file is assumed to equal the document as shared.
   */
  noteSaved(target: Pick<ShareTarget, "fileKey" | "store">, doc: KimoDocument): Promise<void>
  /**
   * {@link ShareService.noteSaved} in two steps for writers that may fail: call it synchronously
   * with the document being written (it captures the store state then), and run the function it
   * returns once the file holds that document.
   */
  captureSaved(
    target: Pick<ShareTarget, "fileKey" | "store">,
    doc: KimoDocument,
  ): () => Promise<void>
  mintLink(room: string, options: MintLinkOptions): Promise<IssuedLink>
  listLinks(room: string): Promise<IssuedLink[]>
  revokeLink(room: string, jti: string): Promise<void>
  resetAllLinks(room: string): Promise<{ kid: number }>
  sweepBlobs(
    room: string,
    target: ShareTarget,
    options?: { graceDays?: number },
  ): Promise<SweepResult>
  /**
   * Closes the room at the relay, detaches the sessions and forgets the room locally. When the
   * relay cannot be reached (the owner took their own deploy down), the local state is still
   * cleared and the result says the relay was not told.
   */
  stopSharing(room: string): Promise<StopSharingResult>
  /**
   * Forgets an owned room on this device without telling the relay: its sessions end and the
   * registry record, cursor, saved state and replica go. For a room whose document is gone (a
   * deleted library file) when {@link ShareService.stopSharing} could not close it at the relay.
   */
  forgetOwnedRoom(room: string): Promise<void>
  /**
   * The shared document of `from` now lives at `to` (Save As): its owned room follows it, so the
   * new file reopens shared and its saves are recorded. Resolves false when `from` is not shared.
   */
  moveFile(from: string, to: string): Promise<boolean>
  join(link: string): Promise<SharedSession>
  listJoinedRooms(): Promise<JoinedRoomSummary[]>
  forgetJoinedRoom(room: string): Promise<void>
  /** Fires with family names that were not shared (§16.5). */
  onFontNotShared(listener: (event: { room: string; families: string[] }) => void): () => void
}

const DAY_S = 86_400
/** The owner's own connection token lives 30 days and is re-minted with a day left. */
const SELF_TTL_S = 30 * DAY_S
/**
 * How often an open owner session checks its token, at most. A timer set for the whole 29 days
 * can fire late (a machine asleep, a throttled background tab), so it wakes at least hourly and
 * re-mints as soon as less than a day is left.
 */
export const SELF_RENEW_CHECK_MS = 60 * 60_000

/** The role a token grants; the reserved `comment` role reads as `view`. */
function roleOfToken(token: string): Role {
  return parseToken(token).role === "edit" ? "edit" : "view"
}

const summarize = (owned: OwnedRoom): OwnedRoomSummary => ({
  room: owned.room,
  relayUrl: owned.relayUrl,
  fileKey: owned.fileKey,
  kid: owned.kid,
  createdAt: owned.createdAt,
  links: owned.links.map((l) => ({ ...l })),
})

/**
 * Font families a document's text names, with the case the document uses: `font` and `fontFamily`
 * strings anywhere in nodes and variables, and families set through a variable (`{ $ref }`).
 * {@link usedFontFamilies} is the authority on which families count.
 */
function fontFamilies(doc: KimoDocument): string[] {
  const names = new Map<string, string>()
  const variables = ((doc as { variables?: unknown }).variables ?? {}) as Record<
    string,
    { value?: unknown }
  >
  const add = (value: unknown) => {
    let name: unknown = value
    if (
      value &&
      typeof value === "object" &&
      typeof (value as { $ref?: unknown }).$ref === "string"
    ) {
      name = variables[(value as { $ref: string }).$ref]?.value
      if (Array.isArray(name)) name = (name[0] as { value?: unknown } | undefined)?.value
    }
    if (typeof name === "string" && name !== "" && !names.has(name.toLowerCase()))
      names.set(name.toLowerCase(), name)
  }
  const walk = (value: unknown, depth: number) => {
    if (depth > 14 || !value || typeof value !== "object") return
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1)
      return
    }
    for (const [k, v] of Object.entries(value))
      if (k === "font" || k === "fontFamily") add(v)
      else walk(v, depth + 1)
  }
  walk(doc.nodes, 0)
  walk(variables, 0)
  for (const lower of usedFontFamilies(doc as unknown as Record<string, unknown>))
    if (!names.has(lower)) names.set(lower, lower)
  return [...names.values()]
}

/**
 * What a room's local state is bound to: the relay and the room key. The replica, the sync
 * cursor and a guest's asset store are named with it, so a link that carries the same room id
 * with another relay or key can never read or push a replica that belongs to the real room.
 */
export async function roomBinding(relayUrl: string, roomKey: Uint8Array): Promise<string> {
  const text = new TextEncoder().encode(`${relayUrl}\0`)
  const joined = new Uint8Array(text.length + roomKey.length)
  joined.set(text)
  joined.set(roomKey, text.length)
  const digest = await crypto.subtle.digest("SHA-256", joined)
  return toHex(new Uint8Array(digest)).slice(0, 16)
}

/** The sync-cursor key of a room under a binding. */
export const cursorKey = (room: string, binding: string) => `${room}.${binding}`

/** `JSON.stringify` with object keys sorted, so equal documents hash equally. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>
    const parts: string[] = []
    for (const k of Object.keys(record).sort())
      if (record[k] !== undefined) parts.push(`${JSON.stringify(k)}:${stableJson(record[k])}`)
    return `{${parts.join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

/** Hash of a document's content, for telling whether the file changed since it was saved. */
export async function documentHash(doc: KimoDocument): Promise<string> {
  const bytes = new TextEncoder().encode(stableJson(doc))
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
}

/** An open (or opening) session of a room, found by `connect`, `join` and `reopenShared`. */
interface OpenEntry {
  /** relay and room key the session was opened with. */
  id: string
  owned: boolean
  store: DocStore | null
  token: string
  provider: NetworkProvider | null
  promise: Promise<SharedSession>
  /** A view session being reconnected with an edit token. */
  upgrading: Promise<SharedSession> | null
  close(): Promise<void>
}

interface Live {
  owned: boolean
  setToken(token: string): void
  close(): Promise<void>
}

export function createShareService(deps: ShareServiceDeps): ShareService {
  const registry =
    deps.registry ??
    (typeof indexedDB === "undefined"
      ? createMemoryRegistry()
      : createRegistry(indexedDbRegistryBackend()))
  const now = deps.now ?? Date.now
  const nowS = () => Math.floor(now() / 1000)
  const timers: ShareTimers = deps.timers ?? {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  }
  const live = new Map<string, Set<Live>>()
  /**
   * The open session of each room, registered before the first await so concurrent callers share
   * it: `connect` and `join` hand out the same one twice.
   */
  const open_ = new Map<string, OpenEntry>()
  /** Per-key promise chains: read-modify-write of a registry record never interleaves. */
  const chains = new Map<string, Promise<unknown>>()
  function locked<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const run = (chains.get(key) ?? Promise.resolve()).then(fn)
    const tail = run.then(
      () => undefined,
      () => undefined,
    )
    chains.set(key, tail)
    void tail.then(() => {
      if (chains.get(key) === tail) chains.delete(key)
    })
    return run
  }
  const fontListeners = new Set<(event: { room: string; families: string[] }) => void>()
  const guards = new Map<string, ReturnType<typeof createFontGuard>>()

  const client = (relayUrl: string) =>
    new RelayHttpClient({ relayUrl, ...(deps.fetch ? { fetch: deps.fetch } : {}) })

  const replicaFor = (room: string, binding: string): SyncProvider | null => {
    if (deps.replica) return deps.replica(room, binding)
    return hasIndexedDb() ? new IndexedDbProvider(`kimo-room-${room}-${binding}`) : null
  }
  const dropReplica = async (room: string, binding: string) => {
    if (deps.deleteReplica) return deps.deleteReplica(room, binding)
    if (!hasIndexedDb()) return
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(`kimo-room-${room}-${binding}`)
      request.onsuccess = request.onerror = request.onblocked = () => resolve()
    })
  }
  const dropGuestAssets = async (room: string, binding: string) => {
    if (deps.deleteGuestAssets) return deps.deleteGuestAssets(room, binding)
    if (hasIndexedDb()) await deleteAssetDb(`room-${room}-${binding}`)
  }
  /** The sync cursors of one binding: the provider asks by room, the registry stores by binding. */
  const cursorsFor = (binding: string): RoomStateStore => ({
    load: (room) => registry.cursors.load(cursorKey(room, binding)),
    save: (room, cursor) => registry.cursors.save(cursorKey(room, binding), cursor),
    clear: (room) => registry.cursors.clear(cursorKey(room, binding)),
  })

  const guardFor = (room: string) => {
    let guard = guards.get(room)
    if (!guard) {
      guard = createFontGuard((families) => {
        for (const listener of [...fontListeners]) listener({ room, families })
      })
      guards.set(room, guard)
    }
    return guard
  }

  const register = (room: string, entry: Live) => {
    const set = live.get(room) ?? new Set<Live>()
    live.set(room, set)
    set.add(entry)
    return () => {
      set.delete(entry)
      if (set.size === 0) live.delete(room)
    }
  }

  const requireOwned = async (room: string): Promise<OwnedRoom> => {
    const owned = await registry.getOwned(room)
    if (!owned) throw new MultiplayerError("ROOM_NOT_FOUND", "this device does not own that room")
    return owned
  }
  /** Runs `fn` on a fresh copy of the owned room, one at a time per room. */
  const withOwned = <T>(room: string, fn: (owned: OwnedRoom) => Promise<T>): Promise<T> =>
    locked(`owned:${room}`, async () => fn(await requireOwned(room)))

  /** Mints and records a token (not persisted; callers save the room). */
  async function mint(
    owned: OwnedRoom,
    options: MintLinkOptions & { self?: boolean },
  ): Promise<IssuedLink> {
    const room = parseRoomId(owned.room)
    const iat = nowS()
    const exp = options.ttlSeconds === null ? 0 : iat + Math.max(1, Math.floor(options.ttlSeconds))
    const jti = randomBytes(16)
    const origin = options.origin ?? "user"
    const token = await mintToken(owned.linkKeys.privateKey, {
      room,
      role: options.role,
      kid: owned.kid,
      iat,
      exp,
      jti,
      origin,
    })
    const link: IssuedLink = {
      jti: toHex(jti),
      role: options.role,
      exp,
      iat,
      kid: owned.kid,
      origin,
      revoked: false,
      ...(options.label !== undefined ? { label: options.label } : {}),
      ...(options.self ? { self: true } : {}),
      link: formatJoinLink({
        webOrigin: deps.webOrigin,
        relayUrl: owned.relayUrl,
        room: owned.room,
        token,
        roomKey: owned.roomKey,
      }),
    }
    owned.links.push(link)
    return link
  }

  const tokenOf = (link: IssuedLink) => parseJoinLink(link.link).token

  /**
   * The owner's own edit token, re-minted when less than a day remains. Callers hold the room's
   * lock (`withOwned`), or own the record alone (a room being created).
   */
  async function selfToken(owned: OwnedRoom, persist = true): Promise<string> {
    const current = owned.links.find(
      (l) => l.self && !l.revoked && l.kid === owned.kid && (l.exp === 0 || l.exp - nowS() > DAY_S),
    )
    if (current) return tokenOf(current)
    owned.links = owned.links.filter((l) => !l.self)
    const link = await mint(owned, { role: "edit", ttlSeconds: SELF_TTL_S, self: true })
    if (persist) await registry.putOwned(owned)
    return tokenOf(link)
  }

  async function admin(
    owned: OwnedRoom,
    body: Parameters<typeof signAdminCommand>[2],
    createSecret?: string,
  ) {
    const command = await signAdminCommand(owned.rootKeys.privateKey, parseRoomId(owned.room), body)
    return client(owned.relayUrl).admin(owned.room, command, createSecret ? { createSecret } : {})
  }

  // Document preparation (§16.1 step 3) ------------------------------------------------------

  /**
   * The font faces in the asset store that the document's text uses, with the manifest entry each
   * would get. Provenance decides what may be shared: the asset store records the faces Kimo
   * fetched itself (`fontSource`), so those count as `google` (or `bundled`/`pack` by family).
   * Every other font file, such as one the user picked or an imported package carried, is `user`
   * and stays name-only.
   */
  async function localFontFaces(
    assets: AssetStore,
    manifest: Record<string, ManifestEntry>,
    used: ReadonlySet<string>,
  ) {
    const keys = ((await assets.keys().catch(() => [])) as string[]).filter((key) =>
      isFontAsset(key, manifest[key]?.mime),
    )
    const known: Record<string, ManifestEntry> = { ...manifest }
    const fetched = new Set<string>()
    for (const key of keys) {
      const info = await assets.info(`./assets/${key}`).catch(() => null)
      if (info?.fontSource) fetched.add(key)
      if (info && !known[key]) known[key] = manifestEntry(info)
    }
    const faces: {
      family: string
      source: "bundled" | "pack" | "google" | "user"
      key: string
      entry: ManifestEntry
    }[] = []
    for (const face of await loadDocumentFontFaces(known, keys, (key) => assets.bytes(key))) {
      if (!used.has(face.family.toLowerCase())) continue
      const bytes = await face.load()
      if (!bytes) continue
      const sha256 = await contentDigest(bytes)
      if (sha256.slice(0, 16) !== face.key.slice(0, 16)) continue
      faces.push({
        family: face.family,
        source: fetched.has(face.key) ? (shippedFontSource(face.family) ?? "google") : "user",
        key: face.key,
        entry: { ...face.entry, sha256 },
      })
    }
    return faces
  }

  async function prepareDocument(target: ShareTarget, room: string): Promise<PrepareResult> {
    const { store, assets } = target
    // The editor is not locked while this runs (hashing and file reads await). The document read
    // here only decides what to add; the write at the end re-reads the store, so an edit made
    // meanwhile is never reverted by the whole-document load.
    const doc = store.toDocument()
    const manifest: Record<string, ManifestEntry> = { ...(doc.assets as object) }
    const result: PrepareResult = { hashed: 0, shaders: 0, missingShaders: [] }
    let nodes = doc.nodes
    /** Relative shader path to the `./assets/<hash16>.glsl` reference it was embedded as. */
    const shaderRefs = new Map<string, string>()
    const shaderEntries: Record<string, ManifestEntry> = {}

    if (target.readRelative) {
      const read = target.readRelative
      const reads = new Map<string, Uint8Array>()
      const embedded = await embedShaders(
        doc as unknown as Record<string, unknown>,
        async (path) => {
          const bytes = await read(path)
          if (bytes) reads.set(path, bytes)
          return bytes
        },
        assets,
      )
      result.shaders = embedded.embedded
      result.missingShaders = embedded.missing
      if (embedded.embedded > 0) {
        nodes = (embedded.doc as { nodes: KimoDocument["nodes"] }).nodes
        for (const [key, entry] of Object.entries(embedded.entries)) {
          manifest[key] = { ...manifest[key], ...(entry as ManifestEntry) }
          shaderEntries[key] = entry as ManifestEntry
        }
        for (const [path, bytes] of reads) {
          const key = `${(await contentDigest(bytes)).slice(0, 16)}.glsl`
          if (embedded.entries[key]) shaderRefs.set(path, `./assets/${key}`)
        }
      }
    }

    const referenced = referencedAssets(nodeOnly(doc, nodes))
    const keys = new Set([...Object.keys(manifest), ...referenced])
    let complete = true
    const added: Record<string, ManifestEntry> = {}
    for (const key of keys) {
      const known = manifest[key]
      if (known?.sha256) continue
      // Font files get their `sha256` only through the font policy below.
      if (isFontAsset(key, known?.mime)) continue
      const bytes = await assets.bytes(key).catch(() => null)
      if (!bytes) {
        if (!known) complete = false
        continue
      }
      const sha256 = await contentDigest(bytes)
      if (sha256.slice(0, 16) !== key.slice(0, 16)) continue
      let entry = known
      if (!entry) {
        const info = await assets.info(`./assets/${key}`).catch(() => null)
        if (!info) {
          complete = false
          continue
        }
        entry = manifestEntry(info)
      }
      added[key] = { ...entry, sha256 }
    }

    // Fonts (§16.5): the faces the text uses that are in the asset store join the manifest when
    // the policy shares them; families with no local face, and faces the policy refuses, are
    // name-only and warn once per family.
    const used = usedFontFamilies(doc as unknown as Record<string, unknown>)
    const faces = await localFontFaces(assets, manifest, used)
    const local = new Set(faces.map((face) => face.family.toLowerCase()))
    const nameOnly = fontFamilies(doc)
      .filter((family) => !local.has(family.toLowerCase()))
      .map((family) => {
        const source = shippedFontSource(family)
        return source ? { family, source } : { family }
      })
    const fontEntries: Record<string, ManifestEntry> = {}
    for (const face of guardFor(room).filter([...faces, ...nameOnly]))
      if ("key" in face && !manifest[face.key]?.sha256) fontEntries[face.key] = face.entry

    // Everything async is done: re-read the document and apply only the rewrites to that copy,
    // in this tick.
    const fresh = store.toDocument()
    // A manifest that lists only some referenced assets would read as ASSET_MISSING: when the
    // document has none and some reference is not local, it keeps having none. Shader sources are
    // then left as the file has them (a relative path still works locally), and reported.
    const writeManifest = fresh.assets !== undefined || complete
    if (!writeManifest && shaderRefs.size > 0) {
      result.missingShaders = [...result.missingShaders, ...shaderRefs.keys()]
      result.shaders = 0
      shaderRefs.clear()
    }
    const base = (fresh.assets ?? {}) as Record<string, ManifestEntry>
    const next: Record<string, ManifestEntry> = { ...base }
    let hashed = 0
    if (writeManifest) {
      for (const [key, entry] of Object.entries({ ...shaderEntries, ...added, ...fontEntries })) {
        if (next[key]?.sha256) continue
        next[key] = { ...entry, ...next[key], sha256: entry.sha256 as string }
        if (!shaderEntries[key]) hashed++
      }
      result.hashed = hashed
    }
    const rewritten = shaderRefs.size > 0 ? rewriteShaders(fresh.nodes, shaderRefs) : fresh.nodes
    if ((writeManifest && hashed > 0) || shaderRefs.size > 0) {
      const out = {
        ...fresh,
        nodes: rewritten,
        ...(writeManifest ? { assets: next } : {}),
      } as KimoDocument
      store.loadDocument(out, { origin: "system", newEpoch: false, validate: false })
    }
    return result
  }

  // Session assembly --------------------------------------------------------------------------

  interface OpenOptions {
    room: string
    relayUrl: string
    roomKey: Uint8Array
    token: string
    isOwner: boolean
    /** The caller's store and assets (the owner's open document). */
    store?: DocStore
    assets?: AssetStore
    /** Creates the store and assets when the room is not open yet (a guest's room). */
    openDocument?(binding: string): Promise<{ store: DocStore; assets: AssetStore }>
    /** Called after the replica attached and before the network provider does. */
    beforeNetwork?: (replicaHadState: boolean) => void
    /** Called once the provider attached; it may not be caught up (a retryable failure). */
    afterNetwork?: (replicaHadState: boolean, provider: NetworkProvider) => void
  }

  /**
   * Opens the room's session, or returns the one already open (or opening) for the same relay,
   * key and store. A caller with another store replaces the old session. A guest whose view
   * session gets an edit link upgrades its token.
   */
  function open(options: OpenOptions): Promise<SharedSession> {
    const { room } = options
    const id = `${options.relayUrl}\0${toHex(options.roomKey)}`
    const prior = open_.get(room)
    if (
      prior &&
      prior.id === id &&
      prior.owned === options.isOwner &&
      (!options.store || prior.store === options.store)
    ) {
      if (prior.owned) {
        // The owner's token is re-minted over time: an open session takes the fresh one.
        if (options.token !== prior.token) {
          prior.token = options.token
          prior.provider?.setToken(options.token)
        }
        return prior.promise
      }
      if (roleOfToken(options.token) === "edit" && roleOfToken(prior.token) === "view") {
        if (!prior.upgrading)
          prior.upgrading = upgrade(prior, options.token).finally(() => {
            prior.upgrading = null
          })
        return prior.upgrading
      }
      return prior.upgrading ?? prior.promise
    }
    const entry: OpenEntry = {
      id,
      owned: options.isOwner,
      store: options.store ?? null,
      token: options.token,
      provider: null,
      promise: null as unknown as Promise<SharedSession>,
      upgrading: null,
      close: async () => {
        const session = await entry.promise.catch(() => null)
        await session?.leave()
      },
    }
    // Registered before any await: a second caller finds this entry instead of building another.
    open_.set(room, entry)
    entry.promise = (async () => {
      if (prior) await prior.close()
      return build(options, entry)
    })()
    entry.promise.catch(() => {
      if (open_.get(room) === entry) open_.delete(room)
    })
    return entry.promise
  }

  /**
   * Gives an open view session an edit token. The relay refuses a refresh that changes the role,
   * so the connection is reopened with the new token; the session keeps its store, replica and
   * asset sync. The entry takes the token only once the relay welcomes it as an editor. When it
   * does not (a revoked or expired link, the relay down), the view token is restored and the
   * caller gets the reason.
   */
  async function upgrade(prior: OpenEntry, token: string): Promise<SharedSession> {
    const session = await prior.promise
    const provider = prior.provider
    if (!provider || roleOfToken(prior.token) === "edit") return session
    const previous = prior.token
    const failed = (message: string) => new MultiplayerError("AUTH_INVALID", message)
    provider.disconnect()
    provider.setToken(token)
    const outcome = new Promise<MultiplayerError | null>((resolve) => {
      const off = provider.onEvent((event) => {
        if (event.type === "welcome") resolve(event.role === "edit" ? null : failed("not edit"))
        else if (event.type === "denied") resolve(new MultiplayerError(event.code, event.message))
        else if (event.type === "closed") resolve(event.error ?? failed("connection closed"))
        else return
        off()
      })
    })
    provider.connect()
    const error = await outcome
    if (!error) {
      prior.token = token
      return session
    }
    provider.disconnect()
    provider.setToken(previous)
    provider.connect()
    throw error
  }

  async function build(options: OpenOptions, entry: OpenEntry): Promise<SharedSession> {
    const { room } = options
    const binding = await roomBinding(options.relayUrl, options.roomKey)
    let store = options.store
    let assetStore = options.assets
    if (!store || !assetStore) {
      if (!options.openDocument) throw new MultiplayerError("INTERNAL", "no document to open")
      const document = await options.openDocument(binding)
      store = document.store
      assetStore = document.assets
    }
    entry.store = store
    // A view link is read-only from the start, not only after the relay's welcome: a guest whose
    // relay is down must not collect edits that the room would never take.
    if (roleOfToken(entry.token) === "view" && !store.readOnly) store.setReadOnly(VIEW_ONLY_REASON)
    const replica = replicaFor(room, binding)
    let replicaHadState = false
    if (replica) {
      await replica.attach(store)
      replicaHadState = store.encodeStateVector().length > 1
    }
    options.beforeNetwork?.(replicaHadState)
    const provider = createNetworkProvider({
      relayUrl: options.relayUrl,
      room,
      token: entry.token,
      roomKey: options.roomKey,
      state: cursorsFor(binding),
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
      ...(deps.WebSocket ? { WebSocket: deps.WebSocket } : {}),
      ...(deps.backoff ? { backoff: deps.backoff } : {}),
      ...(deps.timing ? { timing: deps.timing } : {}),
      ...(deps.now ? { now: deps.now } : {}),
    })
    entry.provider = provider
    // The relay decides: an edit welcome (a view session upgraded) lifts the view lock.
    const lockedStore = store
    const offWelcome = provider.onEvent((event) => {
      if (
        event.type === "welcome" &&
        event.role === "edit" &&
        lockedStore.readOnly?.reason === VIEW_ONLY_REASON
      )
        lockedStore.setReadOnly(null)
    })
    // The owner's token is re-minted a day before it expires, so a window left open past the
    // 30 days (or asleep across the expiry) never loses its connection. The relay closes an
    // expired token for good, and the provider does not retry a fatal close. The timer runs from
    // the moment the session opens (a relay that is down never sends the welcome that would
    // otherwise arm it) and wakes at least every SELF_RENEW_CHECK_MS.
    let left = false
    let renewTimer: unknown = null
    const scheduleRenewal = (exp: number) => {
      if (renewTimer !== null) timers.clearTimeout(renewTimer)
      renewTimer = null
      if (!options.isOwner || exp === 0 || left) return
      const due = (exp - DAY_S - nowS() + 1) * 1000
      const wait = Math.min(Math.max(due, 1000), SELF_RENEW_CHECK_MS)
      renewTimer = timers.setTimeout(() => {
        renewTimer = null
        if (left) return
        // Still more than a day left: check again later, without touching the registry.
        if (exp - nowS() > DAY_S) return scheduleRenewal(exp)
        void withOwned(room, selfToken).then(
          (next) => {
            if (left) return
            if (next !== entry.token) {
              entry.token = next
              provider.setToken(next)
            }
            scheduleRenewal(parseToken(next).exp)
          },
          // The registry could not be read: try again on the next check.
          () => scheduleRenewal(exp),
        )
      }, wait)
      ;(renewTimer as { unref?: () => void } | null)?.unref?.()
    }
    const offRenew = provider.onEvent((event) => {
      if (event.type === "welcome") scheduleRenewal(event.exp)
    })
    if (options.isOwner) scheduleRenewal(parseToken(entry.token).exp)
    const sync = createAssetSync({
      room,
      relayUrl: options.relayUrl,
      token: () => entry.token,
      roomKey: options.roomKey,
      provider,
      store,
      assets: assetStore,
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
      ...(deps.backoff ? { backoff: deps.backoff } : {}),
      ...(deps.missingRetry ? { missingRetry: deps.missingRetry } : {}),
    })
    const leave = async () => {
      if (left) return
      left = true
      if (open_.get(room) === entry) open_.delete(room)
      unregister()
      offWelcome()
      offRenew()
      if (renewTimer !== null) timers.clearTimeout(renewTimer)
      renewTimer = null
      sync.stop()
      await provider.detach().catch(() => undefined)
      await replica?.detach().catch(() => undefined)
    }
    const unregister = register(room, {
      owned: options.isOwner,
      setToken(next) {
        entry.token = next
        provider.setToken(next)
      },
      close: leave,
    })
    try {
      await provider.attach(store)
    } catch (error) {
      await leave()
      throw error
    }
    // A handshake the browser could not read (closed or unknown room) looks like a dropped
    // connection; ask over HTTP so the caller gets the real reason.
    if (provider.status === "error" && provider.role === null) {
      const reason = await client(options.relayUrl)
        .roomInfo(room, entry.token)
        .then(
          () => null,
          (error: unknown) => error,
        )
      if (reason instanceof MultiplayerError && !isRetryable(reason)) {
        await leave()
        throw reason
      }
    }
    options.afterNetwork?.(replicaHadState, provider)
    sync.start()
    const assets = withRemoteAssets(
      assetStore,
      sync,
      deps.autoFetchAssets ? { autoFetch: deps.autoFetchAssets } : {},
    )
    const session: SharedSession = {
      room,
      get role() {
        return provider.role ?? roleOfToken(entry.token)
      },
      store,
      provider,
      assets,
      assetSync: sync,
      get status() {
        return provider.status
      },
      onStatus: (listener) => provider.onStatus(listener),
      onEvent: (listener) => provider.onEvent(listener),
      presence: () => provider.awareness.getStates(),
      onPresence: (listener) => provider.awareness.onChange(listener),
      setPresence: (state) => provider.awareness.setLocalState(state),
      leave,
    }
    return session
  }

  async function connectOwned(
    target: ShareTarget,
    owned: OwnedRoom,
    hooks?: Pick<OpenOptions, "beforeNetwork" | "afterNetwork">,
  ): Promise<SharedSession> {
    return open({
      room: owned.room,
      relayUrl: owned.relayUrl,
      roomKey: owned.roomKey,
      token: await withOwned(owned.room, selfToken),
      store: target.store,
      assets: target.assets,
      isOwner: true,
      ...hooks,
    })
  }

  /**
   * What `file` changed relative to the state saved with it, as a Yjs update; null when it
   * changed nothing. The file is loaded into a copy of the saved state, so the update holds only
   * the file's own differences and merges into the room's current state without touching what
   * others did since.
   */
  async function fileDelta(
    owned: OwnedRoom,
    file: KimoDocument,
  ): Promise<{ update: Uint8Array; record: () => Promise<void> } | null> {
    const { room } = owned
    const saved = await registry.saves.load(room)
    if (!saved) return null
    const fileHash = await documentHash(file)
    if (saved.fileHash !== null && saved.fileHash === fileHash) return null
    const base = createDocStore()
    base.applyUpdate(saved.state, "remote:saved")
    let changed = false
    base.onUpdate(() => {
      changed = true
    })
    const before = base.encodeStateVector()
    base.loadDocument(file, { origin: "file", newEpoch: false, validate: false })
    const update = changed ? base.encodeStateAsUpdate(before) : null
    const state = base.encodeStateAsUpdate()
    base.destroy()
    if (!update) return null
    return {
      update,
      // Once the update is in the room, this file counts as saved: the next reopen of it, still
      // unsaved, contributes nothing (a fresh store would write the same values again, with a new
      // client id, and could beat what collaborators did since).
      record: () =>
        locked(`file:${owned.fileKey}`, async () => {
          const now = await registry.saves.load(room)
          if (now && now.fileHash !== saved.fileHash) return
          await registry.saves.save(room, { state, fileHash })
        }),
    }
  }

  const captureSaved: ShareService["captureSaved"] = (target, doc) => {
    // Captured before any await: the state the written document corresponds to.
    const state = target.store.encodeStateAsUpdate()
    return () =>
      locked(`file:${target.fileKey}`, async () => {
        const owned = await registry.ownedForFile(target.fileKey)
        if (!owned) return
        await registry.saves.save(owned.room, { state, fileHash: await documentHash(doc) })
      })
  }

  /** Ends the room's sessions here and deletes everything this device kept about it. */
  async function dropOwned(owned: OwnedRoom): Promise<void> {
    const { room } = owned
    for (const entry of [...(live.get(room) ?? [])]) await entry.close()
    const binding = await roomBinding(owned.relayUrl, owned.roomKey)
    await registry.deleteOwned(room)
    await registry.cursors.clear(cursorKey(room, binding))
    await registry.saves.clear(room)
    await dropReplica(room, binding)
    guards.delete(room)
  }

  // Service -----------------------------------------------------------------------------------

  return {
    probeRelay: (relayUrl) => client(normalizeRelayUrl(relayUrl)).probe(),

    startSharing(target, options) {
      // One sharing run per file: a double click finds the room the first call made.
      return locked(`file:${target.fileKey}`, async () => {
        const existing = await registry.ownedForFile(target.fileKey)
        if (existing) return summarize(existing)
        const relayUrl = normalizeRelayUrl(options.relayUrl)
        await client(relayUrl).probe()

        // Non-extractable wherever the registry can store CryptoKeys (script in the app origin
        // can then use the keys through the registry but never copy them out).
        const rootKeys = await generateSigningKeyPair(registry.keysExtractable)
        const linkKeys = await generateSigningKeyPair(registry.keysExtractable)
        const rootPub = await exportPublicKey(rootKeys.publicKey)
        const roomId = await deriveRoomId(rootPub)
        const roomKey = generateRoomKey()
        const cert = await signLinkCert(rootKeys.privateKey, {
          kid: 1,
          iat: nowS(),
          room: roomId,
          linkPub: await exportPublicKey(linkKeys.publicKey),
        })
        const owned: OwnedRoom = {
          room: roomId.id,
          relayUrl,
          fileKey: target.fileKey,
          roomKey,
          rootKeys,
          linkKeys,
          kid: 1,
          createdAt: now(),
          links: [],
        }

        // What the file on disk holds: the document before preparation, which only the owner's
        // next save writes out. Reopening without a save then finds the file equal to this.
        const fileState = target.store.encodeStateAsUpdate()
        await prepareDocument(target, owned.room)
        await admin(
          owned,
          { op: "register", rootPub: toBase64Url(rootPub), cert: toBase64Url(cert.bytes) },
          options.createSecret,
        )
        // Not persisted yet: the room is recorded only once it is fully seeded, so a failed
        // attempt never leaves a registered room without its saved state.
        const token = await selfToken(owned, false)

        // Seed: state and vector are captured in one synchronous step, so the cursor never claims
        // more than the snapshot holds.
        const state = target.store.encodeStateAsUpdate()
        const sv = target.store.encodeStateVector()
        const keys = await deriveRoomKeys(roomKey, roomId)
        await client(relayUrl).putSnapshot(owned.room, token, 0, await sealSnapshot(keys, 0, state))
        const binding = await roomBinding(relayUrl, roomKey)
        await registry.cursors.save(cursorKey(owned.room, binding), { ackedSv: sv })
        await registry.saves.save(owned.room, { state: fileState, fileHash: null })
        await registry.putOwned(owned)
        await connectOwned(target, owned)
        return summarize(owned)
      })
    },

    async roomForFile(fileKey) {
      const owned = await registry.ownedForFile(fileKey)
      return owned ? summarize(owned) : null
    },

    async connect(target, room) {
      return connectOwned(target, await requireOwned(room))
    },

    async reopenShared(target, file) {
      const owned = await registry.ownedForFile(target.fileKey)
      if (!owned) return null
      // What the file changed since the owner saved it; the rest of the file is the room's
      // already. Computed before the store changes, applied once the room state is in the store.
      const delta = await fileDelta(owned, file)
      const applyFile = () => {
        if (!delta) return
        target.store.applyUpdate(delta.update, "remote:file")
        void delta.record()
      }
      return connectOwned(target, owned, {
        // With a replica the room state is already here.
        beforeNetwork: (hadState) => {
          if (hadState) applyFile()
        },
        // Without one, wait for the catch-up: the delta refers to items the room has to supply,
        // and a relay that is down must not make the file look newer than the room.
        afterNetwork: (hadState, provider) => {
          if (hadState) return
          if (provider.connected) return applyFile()
          const off = provider.onEvent((event) => {
            if (event.type !== "caught-up") return
            off()
            applyFile()
          })
        },
      })
    },

    noteSaved: (target, doc) => captureSaved(target, doc)(),
    captureSaved,

    async mintLink(room, options) {
      return withOwned(room, async (owned) => {
        const link = await mint(owned, options)
        await registry.putOwned(owned)
        return { ...link }
      })
    },

    async listLinks(room) {
      const owned = await requireOwned(room)
      return owned.links.filter((l) => !l.self).map((l) => ({ ...l }))
    },

    async revokeLink(room, jti) {
      await withOwned(room, async (owned) => {
        const link = owned.links.find((l) => l.jti === jti && !l.self)
        if (!link) throw new MultiplayerError("NOT_FOUND", "no such link")
        await admin(owned, { op: "revoke", jti, exp: link.exp })
        link.revoked = true
        await registry.putOwned(owned)
      })
    },

    async resetAllLinks(room) {
      return withOwned(room, async (owned) => {
        const linkKeys = await generateSigningKeyPair(registry.keysExtractable)
        const kid = owned.kid + 1
        const cert = await signLinkCert(owned.rootKeys.privateKey, {
          kid,
          iat: nowS(),
          room: parseRoomId(owned.room),
          linkPub: await exportPublicKey(linkKeys.publicKey),
        })
        await admin(owned, { op: "rotate", cert: toBase64Url(cert.bytes) })
        owned.kid = kid
        owned.linkKeys = linkKeys
        for (const link of owned.links) link.revoked = true
        const token = await selfToken(owned)
        await registry.putOwned(owned)
        for (const entry of live.get(room) ?? []) if (entry.owned) entry.setToken(token)
        return { kid }
      })
    },

    async sweepBlobs(room, target, options) {
      const owned = await requireOwned(room)
      const keys = await deriveRoomKeys(owned.roomKey, parseRoomId(room))
      const assets = (target.store.toHeader() as { assets?: Record<string, ManifestEntry> }).assets
      const keep: string[] = []
      for (const entry of Object.values(assets ?? {}))
        if (entry.sha256) keep.push(await blobIdFor(keys, fromHex(entry.sha256)))
      const body = await admin(owned, {
        op: "sweep",
        keep,
        ...(options?.graceDays !== undefined ? { graceDays: options.graceDays } : {}),
      })
      const count = (name: string) => (typeof body[name] === "number" ? (body[name] as number) : 0)
      return {
        marked: count("marked"),
        deleted: count("deleted"),
        kept: count("kept"),
        bytesFreed: count("bytesFreed"),
      }
    },

    async stopSharing(room) {
      return withOwned(room, async (owned): Promise<StopSharingResult> => {
        let relayError: MultiplayerError | undefined
        try {
          await admin(owned, { op: "close" })
        } catch (error) {
          // A relay that is gone must not keep the room (and its reopen path) alive here.
          if (!(error instanceof MultiplayerError) || !isRetryable(error)) throw error
          relayError = error
        }
        await dropOwned(owned)
        return relayError ? { relayNotified: false, relayError } : { relayNotified: true }
      })
    },

    async forgetOwnedRoom(room) {
      await locked(`owned:${room}`, async () => {
        const owned = await registry.getOwned(room)
        if (owned) await dropOwned(owned)
      })
    },

    moveFile(from, to) {
      // After any save of `from` still being recorded (same lock as `captureSaved`).
      return locked(`file:${from}`, async () => {
        const found = await registry.ownedForFile(from)
        if (!found) return false
        if (from === to) return true
        await withOwned(found.room, async (owned) => {
          owned.fileKey = to
          await registry.putOwned(owned)
        })
        return true
      })
    },

    async join(link) {
      const parsed = parseJoinLink(link)
      // A room this device owns is opened from its file, with the owner's own keys.
      if (await registry.getOwned(parsed.room))
        throw new MultiplayerError("BAD_LINK", "this device owns that room: open its file instead")
      // A link that names a joined room through another relay or key is not the same room.
      const known = await registry.getJoined(parsed.room)
      if (
        known &&
        (known.relayUrl !== parsed.relayUrl || toHex(known.roomKey) !== toHex(parsed.roomKey))
      )
        throw new MultiplayerError(
          "BAD_LINK",
          "that room was joined through another relay or key: forget it first",
        )
      const session = await open({
        room: parsed.room,
        relayUrl: parsed.relayUrl,
        roomKey: parsed.roomKey,
        token: parsed.token,
        isOwner: false,
        openDocument: (binding) => deps.openGuestDocument(parsed.room, binding),
      })
      // Record what the session really holds: an open view session keeps its token unless this
      // link upgrades it.
      const token = open_.get(parsed.room)?.token ?? parsed.token
      const joined: JoinedRoom = {
        room: parsed.room,
        relayUrl: parsed.relayUrl,
        token,
        roomKey: parsed.roomKey,
        role: roleOfToken(token),
        joinedAt: known?.joinedAt ?? now(),
      }
      await registry.putJoined(joined)
      return session
    },

    async listJoinedRooms() {
      return (await registry.listJoined()).map(({ room, relayUrl, role, joinedAt }) => ({
        room,
        relayUrl,
        role,
        joinedAt,
      }))
    },

    async forgetJoinedRoom(room) {
      for (const entry of [...(live.get(room) ?? [])]) if (!entry.owned) await entry.close()
      const joined = await registry.getJoined(room)
      await registry.deleteJoined(room)
      if (!joined) return
      const binding = await roomBinding(joined.relayUrl, joined.roomKey)
      await registry.cursors.clear(cursorKey(room, binding))
      await dropReplica(room, binding)
      await dropGuestAssets(room, binding)
    },

    onFontNotShared(listener) {
      fontListeners.add(listener)
      return () => fontListeners.delete(listener)
    },
  }
}

/** A document view with only what asset references are scanned in. */
function nodeOnly(doc: KimoDocument, nodes: KimoDocument["nodes"]): Record<string, unknown> {
  return { ...(doc as unknown as Record<string, unknown>), nodes }
}

/** A copy of `nodes` whose `shader` paints name the embedded asset of their relative path. */
function rewriteShaders(nodes: KimoDocument["nodes"], refs: ReadonlyMap<string, string>) {
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk)
    if (typeof value !== "object" || value === null) return value
    const record = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(record)) out[k] = walk(v)
    if (record.kind === "shader" && typeof record.src === "string") {
      const ref = refs.get(record.src)
      if (ref) out.src = ref
    }
    return out
  }
  return walk(nodes) as KimoDocument["nodes"]
}
