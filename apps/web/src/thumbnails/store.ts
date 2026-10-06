/**
 * Where previews live (board 37 §9):
 * - files on disk (desktop): `platform.thumbnails` (`~/.kimo/thumbs`, keyed by path);
 * - the browser library: IndexedDB database `kimo-thumbs` (keyed by file id), beside the
 *   `kimo-files` index so the index entries stay small.
 * Both are a `ThumbnailsApi`. {@link notifyThumbnail} tells every Home (this window and others
 * of the app, over a BroadcastChannel) that a preview changed.
 */
import type { KimoPlatform, ThumbnailInfo, ThumbnailsApi } from "@kimo/platform"

const DB = "kimo-thumbs"
const STORE = "thumbs"

interface Row extends ThumbnailInfo {
  png: Uint8Array
}

let dbPromise: Promise<IDBDatabase> | null = null
function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE))
        req.result.createObjectStore(STORE, { keyPath: "ref" })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const t = d.transaction(STORE, mode)
        const req = run(t.objectStore(STORE))
        t.oncomplete = () => resolve(req.result)
        t.onerror = () => reject(t.error)
      }),
  )
}

const getRow = (id: string) =>
  tx<Row | undefined>("readonly", (s) => s.get(id) as IDBRequest<Row | undefined>)

/** The browser library's previews (key: file id). */
export const libraryThumbnails: ThumbnailsApi = {
  dir: `indexeddb:${DB}`,
  read: async (id) => (await getRow(id))?.png ?? null,
  async info(id) {
    const r = await getRow(id)
    return r ? { ref: r.ref, hash: r.hash, updatedAt: r.updatedAt } : null
  },
  async write(id, hash, png) {
    const row: Row = { ref: id, hash, updatedAt: Date.now(), png }
    await tx("readwrite", (s) => s.put(row))
    notifyThumbnail(id)
  },
  async remove(id) {
    await tx("readwrite", (s) => s.delete(id))
    notifyThumbnail(id)
  },
  async move(from, to) {
    const r = await getRow(from)
    if (!r || from === to) return
    await libraryThumbnails.write(to, r.hash, r.png)
    await libraryThumbnails.remove(from)
  },
}

/** The store of disk files on this host (null: no app-data cache, e.g. the browser). */
export function diskThumbnails(platform: KimoPlatform): ThumbnailsApi | null {
  const t = platform.thumbnails
  if (!t) return null
  return {
    dir: t.dir,
    read: (ref) => t.read(ref),
    info: (ref) => t.info(ref),
    async write(ref, hash, png) {
      await t.write(ref, hash, png)
      notifyThumbnail(ref)
    },
    async remove(ref) {
      await t.remove(ref)
      notifyThumbnail(ref)
    },
    async move(from, to) {
      await t.move(from, to)
      notifyThumbnail(from)
      notifyThumbnail(to)
    },
  }
}

/** A copy (Duplicate, Restore as copy) starts with its original's preview (same content). */
export async function copyThumbnail(
  store: ThumbnailsApi | null,
  from: string,
  to: string,
): Promise<void> {
  if (!store || from === to) return
  try {
    const [png, info] = await Promise.all([store.read(from), store.info(from)])
    if (png) await store.write(to, info?.hash ?? "", png)
  } catch {
    // The copy exists; it gets a preview the first time it is saved.
  }
}

/** Drops the previews of files deleted for good (Delete forever, Empty trash). */
export async function forgetThumbnails(
  store: ThumbnailsApi | null,
  keys: readonly string[],
): Promise<void> {
  if (!store) return
  for (const k of keys) await store.remove(k).catch(() => {})
}

// --- change notifications --------------------------------------------------------------------

type Listener = (key: string) => void
const listeners = new Set<Listener>()
let channel: BroadcastChannel | null | undefined

function bus(): BroadcastChannel | null {
  if (channel !== undefined) return channel
  try {
    channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("kimo-thumbs") : null
    if (channel)
      channel.onmessage = (e: MessageEvent) => {
        if (typeof e.data === "string") for (const l of [...listeners]) l(e.data)
      }
  } catch {
    channel = null
  }
  return channel
}

/** Tells every Home (this window and the app's other windows) that `key`'s preview changed. */
export function notifyThumbnail(key: string): void {
  for (const l of [...listeners]) l(key)
  try {
    bus()?.postMessage(key)
  } catch {
    // Closed channel (window teardown): this window's listeners already ran.
  }
}

/** Subscribes to preview changes (the file id or path whose preview changed). */
export function onThumbnail(listener: Listener): () => void {
  bus()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
