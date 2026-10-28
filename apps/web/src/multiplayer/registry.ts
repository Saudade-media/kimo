/**
 * Local registry of owned and joined rooms (docs/spec/multiplayer.md §16.2). It is the only place
 * the owner's room secrets live: the Ed25519 root and link keys, the room key and the issued
 * links. Records are JSON-safe (keys as JWK, bytes as base64url) so one codec serves every
 * backend: IndexedDB (web and the desktop webview), a JSON file under the platform's files API
 * (desktop, when the host passes a path) and a map (tests).
 */
import type { FilesApi } from "@kimo/platform"
import { isPlatformError } from "@kimo/platform"
import type { RoomCursor, RoomStateStore } from "@kimo/sync"
import { fromBase64Url, type MpOrigin, type Role, toBase64Url } from "@kimo/sync/mp"

/** One link the owner minted (or the owner's own connection token when `self`). */
export interface IssuedLink {
  jti: string // hex
  role: Role
  /** Unix s; 0 = never. */
  exp: number
  iat: number
  kid: number
  origin: MpOrigin
  label?: string
  revoked: boolean
  /** The owner's own connection token; not shown as a share link. */
  self?: boolean
  link: string
}

export interface OwnedRoom {
  room: string
  relayUrl: string
  fileKey: string
  roomKey: Uint8Array
  rootKeys: CryptoKeyPair
  linkKeys: CryptoKeyPair
  kid: number
  createdAt: number
  links: IssuedLink[]
}

export interface JoinedRoom {
  room: string
  relayUrl: string
  token: string
  roomKey: Uint8Array
  role: Role
  joinedAt: number
}

/**
 * `cloud` holds what Kimo Cloud handed this device for workspace files (ADR 0019): file lists with
 * their room keys, tokens and which local file each room is bound to (`cloud/cache.ts`).
 */
export type RegistryStore = "owned" | "joined" | "cursors" | "cloud"

/** A plain key-value view of one registry store (JSON values). */
export interface RegistryRecords {
  get(key: string): Promise<unknown | undefined>
  put(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  list(): Promise<unknown[]>
}

/** Where records are kept. Values are plain JSON, or structured-cloneable when `structuredKeys`. */
export interface RegistryBackend {
  /**
   * True when the backend stores `CryptoKey` objects natively (IndexedDB, structured clone), so
   * the owner's private keys can be non-extractable. Otherwise they are stored as JWK, which
   * needs extractable keys and leaves the secret in the store as plain text.
   */
  readonly structuredKeys?: boolean
  get(store: RegistryStore, key: string): Promise<unknown | undefined>
  put(store: RegistryStore, key: string, value: unknown): Promise<void>
  delete(store: RegistryStore, key: string): Promise<void>
  list(store: RegistryStore): Promise<unknown[]>
}

export interface Registry {
  getOwned(room: string): Promise<OwnedRoom | null>
  ownedForFile(fileKey: string): Promise<OwnedRoom | null>
  listOwned(): Promise<OwnedRoom[]>
  putOwned(room: OwnedRoom): Promise<void>
  deleteOwned(room: string): Promise<void>
  getJoined(room: string): Promise<JoinedRoom | null>
  listJoined(): Promise<JoinedRoom[]>
  putJoined(room: JoinedRoom): Promise<void>
  deleteJoined(room: string): Promise<void>
  /** The network provider's per-room cursor (`ackedSv`). */
  readonly cursors: RoomStateStore
  /** What the owner's file held when it was last written (see {@link SavedState}). */
  readonly saves: SaveStore
  /** Kimo Cloud's records for workspace files (see {@link RegistryStore}). */
  readonly cloud: RegistryRecords
  /** Whether room keys must be generated extractable (the backend cannot store CryptoKeys). */
  readonly keysExtractable: boolean
}

/**
 * The document as of the owner's last save of the shared file, kept next to the sync cursor.
 * Reopening diffs the file against `state` and applies only that delta, so collaborators' edits
 * made since are never reverted by an older file (spec §16.3).
 */
interface SavedState {
  /** `encodeStateAsUpdate()` of the owner's store when the file was written. */
  state: Uint8Array
  /** Hash of the document that was written; null until the first save after sharing began. */
  fileHash: string | null
}

interface SaveStore {
  load(room: string): Promise<SavedState | null>
  save(room: string, saved: SavedState): Promise<void>
  clear(room: string): Promise<void>
}

// Codec -----------------------------------------------------------------------------------------

type Jwk = JsonWebKey

interface OwnedRecord {
  room: string
  relayUrl: string
  fileKey: string
  roomKey: string
  /** Private keys as JWK (extractable keys; backends without structured clone). */
  rootPrivate?: Jwk
  linkPrivate?: Jwk
  /** Key pairs as CryptoKeys (structured-clone backends; the private keys stay non-extractable). */
  rootPair?: CryptoKeyPair
  linkPair?: CryptoKeyPair
  kid: number
  createdAt: number
  links: IssuedLink[]
}

interface JoinedRecord extends Omit<JoinedRoom, "roomKey"> {
  roomKey: string
}

interface CursorRecord {
  ackedSv: string | null
}

interface SaveRecord {
  state: string
  fileHash: string | null
}

/** Cursor-store key of a room's {@link SavedState}. */
const saveKey = (room: string) => `save:${room}`

const ED25519 = { name: "Ed25519" } as const

/** The private key as JWK; the key must be extractable (the registry generates them so). */
async function exportPair(pair: CryptoKeyPair): Promise<Jwk> {
  return crypto.subtle.exportKey("jwk", pair.privateKey)
}

async function importPair(jwk: Jwk): Promise<CryptoKeyPair> {
  const privateKey = await crypto.subtle.importKey("jwk", jwk, ED25519, true, ["sign"])
  const { d: _d, key_ops: _ops, ...pub } = jwk
  const publicKey = await crypto.subtle.importKey("jwk", pub, ED25519, true, ["verify"])
  return { privateKey, publicKey }
}

async function encodeOwned(room: OwnedRoom, structured: boolean): Promise<OwnedRecord> {
  const keys: Partial<OwnedRecord> = structured
    ? {
        rootPair: { privateKey: room.rootKeys.privateKey, publicKey: room.rootKeys.publicKey },
        linkPair: { privateKey: room.linkKeys.privateKey, publicKey: room.linkKeys.publicKey },
      }
    : {
        rootPrivate: await exportPair(room.rootKeys),
        linkPrivate: await exportPair(room.linkKeys),
      }
  return {
    room: room.room,
    relayUrl: room.relayUrl,
    fileKey: room.fileKey,
    roomKey: toBase64Url(room.roomKey),
    ...keys,
    kid: room.kid,
    createdAt: room.createdAt,
    links: room.links.map((l) => ({ ...l })),
  }
}

async function decodeOwned(record: OwnedRecord): Promise<OwnedRoom> {
  return {
    room: record.room,
    relayUrl: record.relayUrl,
    fileKey: record.fileKey,
    roomKey: fromBase64Url(record.roomKey),
    rootKeys: record.rootPair ?? (await importPair(record.rootPrivate as Jwk)),
    linkKeys: record.linkPair ?? (await importPair(record.linkPrivate as Jwk)),
    kid: record.kid,
    createdAt: record.createdAt,
    links: record.links.map((l) => ({ ...l })),
  }
}

/** The registry over `backend`. */
export function createRegistry(backend: RegistryBackend): Registry {
  const cursors: RoomStateStore = {
    async load(room) {
      const record = (await backend.get("cursors", room)) as CursorRecord | undefined
      if (!record) return null
      return { ackedSv: record.ackedSv === null ? null : fromBase64Url(record.ackedSv) }
    },
    async save(room, cursor: RoomCursor) {
      const record: CursorRecord = {
        ackedSv: cursor.ackedSv === null ? null : toBase64Url(cursor.ackedSv),
      }
      await backend.put("cursors", room, record)
    },
    async clear(room) {
      await backend.delete("cursors", room)
    },
  }
  const saves: SaveStore = {
    async load(room) {
      const record = (await backend.get("cursors", saveKey(room))) as SaveRecord | undefined
      return record ? { state: fromBase64Url(record.state), fileHash: record.fileHash } : null
    },
    async save(room, saved) {
      const record: SaveRecord = { state: toBase64Url(saved.state), fileHash: saved.fileHash }
      await backend.put("cursors", saveKey(room), record)
    },
    async clear(room) {
      await backend.delete("cursors", saveKey(room))
    },
  }
  const structured = backend.structuredKeys === true
  const joined = (record: JoinedRecord): JoinedRoom => ({
    ...record,
    roomKey: fromBase64Url(record.roomKey),
  })
  return {
    async getOwned(room) {
      const record = (await backend.get("owned", room)) as OwnedRecord | undefined
      return record ? decodeOwned(record) : null
    },
    async ownedForFile(fileKey) {
      const records = (await backend.list("owned")) as OwnedRecord[]
      const record = records.find((r) => r.fileKey === fileKey)
      return record ? decodeOwned(record) : null
    },
    async listOwned() {
      return Promise.all(((await backend.list("owned")) as OwnedRecord[]).map(decodeOwned))
    },
    async putOwned(room) {
      await backend.put("owned", room.room, await encodeOwned(room, structured))
    },
    async deleteOwned(room) {
      await backend.delete("owned", room)
    },
    async getJoined(room) {
      const record = (await backend.get("joined", room)) as JoinedRecord | undefined
      return record ? joined(record) : null
    },
    async listJoined() {
      return ((await backend.list("joined")) as JoinedRecord[]).map(joined)
    },
    async putJoined(room) {
      const record: JoinedRecord = { ...room, roomKey: toBase64Url(room.roomKey) }
      await backend.put("joined", room.room, record)
    },
    async deleteJoined(room) {
      await backend.delete("joined", room)
    },
    cursors,
    saves,
    cloud: {
      get: (key) => backend.get("cloud", key),
      put: (key, value) => backend.put("cloud", key, value),
      delete: (key) => backend.delete("cloud", key),
      list: () => backend.list("cloud"),
    },
    keysExtractable: !structured,
  }
}

// Backends --------------------------------------------------------------------------------------

/**
 * In-memory backend (tests; also the fallback where nothing persistent exists). By default
 * records round-trip through JSON, exactly like the file backend; `structured` clones them like
 * IndexedDB does, so `CryptoKey`s survive and the owner's keys can be non-extractable.
 */
export function memoryRegistryBackend(options: { structured?: boolean } = {}): RegistryBackend {
  const stores: Record<RegistryStore, Map<string, unknown>> = {
    owned: new Map(),
    joined: new Map(),
    cursors: new Map(),
    cloud: new Map(),
  }
  // Round-trip through JSON (or structured clone) so a test sees what a persistent backend returns.
  const copy = <T>(value: T): T =>
    options.structured ? structuredClone(value) : (JSON.parse(JSON.stringify(value)) as T)
  return {
    structuredKeys: options.structured === true,
    async get(store, key) {
      const value = stores[store].get(key)
      return value === undefined ? undefined : copy(value)
    },
    async put(store, key, value) {
      stores[store].set(key, copy(value))
    },
    async delete(store, key) {
      stores[store].delete(key)
    },
    async list(store) {
      return [...stores[store].values()].map(copy)
    },
  }
}

export const REGISTRY_DB = "kimo-multiplayer"

/**
 * Opens database `kimo-multiplayer` v3: the three registry stores of §16.2, `device`, the
 * install's device key (§16.9, `device-key.ts`), and `cloud` (v3, Kimo Cloud workspace files).
 * Every opener goes through here, so the version and its stores are declared once. An upgrade
 * only adds missing stores: nothing kept in an older version is touched.
 */
export function openMultiplayerDb(name = REGISTRY_DB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 3)
    req.onupgradeneeded = () => {
      for (const store of ["owned", "joined", "cursors", "device", "cloud"] as const)
        if (!req.result.objectStoreNames.contains(store)) req.result.createObjectStore(store)
    }
    req.onsuccess = () => {
      // A newer version opening in another window waits for this connection: let it go (the
      // next call here opens the new version).
      req.result.onversionchange = () => req.result.close()
      resolve(req.result)
    }
    req.onerror = () => reject(req.error)
  })
}

/**
 * IndexedDB backend: database `kimo-multiplayer` with the three stores of §16.2. Records are
 * structured-cloned, so the owner's Ed25519 keys are stored as non-extractable CryptoKeys: script
 * running in the origin can use them through this database but never read the key bytes.
 */
export function indexedDbRegistryBackend(name = REGISTRY_DB): RegistryBackend {
  let dbp: Promise<IDBDatabase> | null = null
  const db = () => (dbp ??= openMultiplayerDb(name))
  const once = <T>(
    d: IDBDatabase,
    store: RegistryStore,
    mode: IDBTransactionMode,
    f: (s: IDBObjectStore) => IDBRequest<T>,
  ) =>
    new Promise<T>((resolve, reject) => {
      const t = d.transaction(store, mode)
      const req = f(t.objectStore(store))
      t.oncomplete = () => resolve(req.result)
      t.onerror = () => reject(t.error)
      t.onabort = () => reject(t.error)
    })
  const run = async <T>(
    store: RegistryStore,
    mode: IDBTransactionMode,
    f: (s: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> => {
    const d = await db()
    try {
      return await once(d, store, mode, f)
    } catch (error) {
      // The connection was closed for a newer version in another window: open again, once.
      if (!(error instanceof DOMException && error.name === "InvalidStateError")) throw error
      dbp = null
      return once(await db(), store, mode, f)
    }
  }
  return {
    structuredKeys: true,
    get: (store, key) => run<unknown>(store, "readonly", (s) => s.get(key)),
    async put(store, key, value) {
      await run(store, "readwrite", (s) => s.put(value, key))
    },
    async delete(store, key) {
      await run(store, "readwrite", (s) => s.delete(key))
    },
    list: (store) => run<unknown[]>(store, "readonly", (s) => s.getAll()),
  }
}

/** The files the desktop backend needs. */
export type RegistryFiles = Pick<FilesApi, "readText" | "writeTextAtomic">

/**
 * Fallback backend: one JSON file (for example `~/.kimo/multiplayer/rooms.json`) written through
 * the platform's atomic files API. Writes are serialized so concurrent puts never lose data.
 *
 * A JSON file cannot hold CryptoKeys, so here the owner's private keys and the room keys are
 * plain text on disk. Writes ask for `ownerOnly`: on desktop the file is 0600 and its directory
 * 0700 (Unix), so other accounts on the machine cannot read it. Prefer {@link indexedDbRegistryBackend}
 * wherever IndexedDB exists (the desktop webview has it); use this one only when it cannot.
 */
export function fileRegistryBackend(files: RegistryFiles, ref: string): RegistryBackend {
  type Data = Record<RegistryStore, Record<string, unknown>>
  let cache: Promise<Data> | null = null
  let queue: Promise<unknown> = Promise.resolve()
  const load = (): Promise<Data> =>
    (cache ??= files
      .readText(ref)
      .then(({ text }): Data => {
        const parsed = JSON.parse(text) as Partial<Data>
        return {
          owned: parsed.owned ?? {},
          joined: parsed.joined ?? {},
          cursors: parsed.cursors ?? {},
          cloud: parsed.cloud ?? {},
        }
      })
      .catch((error: unknown): Data => {
        if (isPlatformError(error) && error.code === "NOT_FOUND")
          return { owned: {}, joined: {}, cursors: {}, cloud: {} }
        cache = null
        throw error
      }))
  const write = (data: Data) =>
    (queue = queue
      .catch(() => undefined)
      .then(() =>
        files.writeTextAtomic(ref, JSON.stringify(data), { mkdirs: true, ownerOnly: true }),
      ))
  return {
    async get(store, key) {
      return (await load())[store][key]
    },
    async put(store, key, value) {
      const data = await load()
      data[store][key] = value
      await write(data)
    },
    async delete(store, key) {
      const data = await load()
      delete data[store][key]
      await write(data)
    },
    async list(store) {
      return Object.values((await load())[store])
    },
  }
}

/** Shorthand used by tests and hosts without persistence (keys stay non-extractable). */
export function createMemoryRegistry(): Registry {
  return createRegistry(memoryRegistryBackend({ structured: true }))
}
