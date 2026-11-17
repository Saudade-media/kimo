/**
 * `IndexedDbProvider`: browser persistence (web editor autosave, teardown 12 M1). Import from
 * `@kimo/sync/indexeddb`. Browser/worker only: attaching where `indexedDB` is missing rejects.
 *
 * The database is the one `y-indexeddb` writes (an `updates` store of Yjs updates under
 * auto-increment keys, and an unused `custom` store), so databases written before this file
 * stopped using that library open unchanged. The provider talks to the store only through the
 * {@link DocStore} binary-update seam (ADR 0003) and keeps no replica of the document: a
 * second in-memory copy cost 1.7 KB per node, which is what kept a 1M-node document from
 * opening.
 *
 * Order of operations:
 * - Open: in one transaction, read every entry, write the store's own state as a new entry,
 *   then apply what was read to the store.
 * - Edit: append the update. Every {@link TRIM_SIZE} appends, a second after the last edit,
 *   the database is compacted (see `compact`).
 *
 * Compaction costs what the edits weigh, not what the document weighs. The largest update
 * (a large document's bulk) is left alone; the newest entries are replaced by their merge,
 * taking in each older merge that is not more than twice their size, so an update is merged
 * again only a logarithmic number of times. Once the entries beside the largest one weigh half
 * of it, the store's whole state replaces everything. All of it happens in one transaction,
 * after the entries another tab wrote were applied to the store: nothing is deleted that the
 * entry written does not hold.
 *
 * One value cannot be arbitrarily large (Chromium refuses one above 127 MiB, and a 1M-node
 * document is a single update of about 180 MB), so an update above {@link PART_BYTES} is
 * stored as consecutive `{ part, of, bytes }` entries, written in one transaction and joined
 * when read. Smaller updates, all that earlier versions could store, stay plain entries.
 *
 * Unload safety: IndexedDB writes still in flight when the page unloads can be aborted, losing
 * the last edit. An update is therefore kept until the transaction that wrote it completes (a
 * failed write sets the `error` status and is retried with the next one); on `pagehide` the
 * unconfirmed ones are written synchronously to a localStorage journal, which the next `attach`
 * replays into the database and then removes.
 */
import type { DocStore, Origin, RemoteOrigin } from "@kimo/editor-state"
import * as Y from "yjs"
import { BaseProvider } from "./provider"

/** True when IndexedDB is available in this runtime. */
export function hasIndexedDb(): boolean {
  return typeof (globalThis as { indexedDB?: unknown }).indexedDB !== "undefined"
}

const UPDATES = "updates"
const CUSTOM = "custom"
/** Appends after which the database is compacted. */
export const TRIM_SIZE = 500
const TRIM_DELAY_MS = 1000
/** Updates above this size are stored in parts of this size. */
export const PART_BYTES = 16 * 1024 * 1024
/** Entries up to this size are always merged with the newer ones when compacting. */
const SMALL_BYTES = 64 * 1024
/** Updates from this size on are applied on their own instead of merged with the others. */
export const LARGE_BYTES = 4 * 1024 * 1024
/** Unconfirmed updates above this size are not journaled (localStorage holds about 5 MB). */
const JOURNAL_MAX_BYTES = 3 * 1024 * 1024

export interface IndexedDbOptions {
  /** Appends after which the database is compacted (default {@link TRIM_SIZE}). */
  trimSize?: number
  /** Quiet time after the last edit before compacting, in ms (default 1000). */
  trimDelayMs?: number
  /** Size above which an update is stored in parts (default {@link PART_BYTES}). */
  partBytes?: number
  /** Size from which an update read is applied on its own (default {@link LARGE_BYTES}). */
  largeBytes?: number
}

/** One piece of an update too large for a single value. */
interface Part {
  part: number
  of: number
  bytes: Uint8Array
}
type Entry = Uint8Array | Part

/** Where one update sits in the database: its first key, the entries it takes, its size. */
interface Group {
  first: number
  parts: number
  bytes: number
}

/**
 * Settles when `tx` commits, or rejects when it aborts. A request can succeed in a transaction
 * that then fails to commit, so what a write changes is published only after this.
 */
function committed(tx: IDBTransaction): Promise<void> {
  const p = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"))
  })
  // Handled: a run that stops early does not wait for its transaction.
  p.catch(() => undefined)
  return p
}

const done = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })

const merge = (updates: Uint8Array[]): Uint8Array =>
  updates.length === 1 ? (updates[0] as Uint8Array) : Y.mergeUpdates(updates)

const isPart = (e: Entry): e is Part => !(e instanceof Uint8Array)

/** Number of entries `update` takes. */
const partsOf = (update: Uint8Array, partBytes: number): number =>
  update.byteLength <= partBytes ? 1 : Math.ceil(update.byteLength / partBytes)

/** Adds `update` as one entry, or as consecutive parts; the request of the last entry. */
function put(os: IDBObjectStore, update: Uint8Array, partBytes: number): IDBRequest<IDBValidKey> {
  const of = partsOf(update, partBytes)
  if (of === 1) return os.add(update)
  let last: IDBRequest<IDBValidKey> | null = null
  // Copies, not views: a view is stored with the whole buffer behind it.
  for (let i = 0; i < of; i++)
    last = os.add({ part: i, of, bytes: update.slice(i * partBytes, (i + 1) * partBytes) })
  return last as IDBRequest<IDBValidKey>
}

/** Reads a key range: the updates it holds (parts joined), each with its place. */
async function read(
  os: IDBObjectStore,
  range: IDBKeyRange | null,
): Promise<{ group: Group; update: Uint8Array }[]> {
  const [keys, entries] = (await Promise.all([
    done(os.getAllKeys(range)),
    done(os.getAll(range)),
  ])) as [number[], Entry[]]
  const out: { group: Group; update: Uint8Array }[] = []
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i] as Entry
    const first = keys[i] as number
    if (!isPart(e)) {
      out.push({ group: { first, parts: 1, bytes: e.byteLength }, update: e })
      continue
    }
    const pieces = entries.slice(i, i + e.of) as Part[]
    i += pieces.length - 1
    // Parts are written in one transaction: a group that is not whole is not an update.
    if (e.part !== 0 || pieces.length !== e.of || pieces.some((p, k) => !isPart(p) || p.part !== k))
      continue
    let size = 0
    for (const p of pieces) size += p.bytes.byteLength
    const update = new Uint8Array(size)
    let at = 0
    for (const p of pieces) {
      update.set(p.bytes, at)
      at += p.bytes.byteLength
    }
    out.push({ group: { first, parts: e.of, bytes: size }, update })
  }
  return out
}

/**
 * Applies updates read from the database in key order: large ones on their own, each run of
 * smaller ones merged. Order matters: another tab's update can add children to a frame an
 * earlier entry created, and a store that sees them first repairs them to the canvas.
 */
function applyAll(
  store: DocStore,
  updates: Uint8Array[],
  origin: RemoteOrigin,
  largeBytes: number,
): void {
  let small: Uint8Array[] = []
  const applySmall = () => {
    if (small.length > 0) store.applyUpdate(merge(small), origin)
    small = []
  }
  for (const u of updates) {
    if (u.byteLength < largeBytes) {
      small.push(u)
      continue
    }
    applySmall()
    store.applyUpdate(u, origin)
  }
  applySmall()
}

/** Key ranges covering `groups` (sorted by key), neighbours joined. */
function ranges(groups: Group[]): IDBKeyRange[] {
  const out: [number, number][] = []
  for (const g of groups) {
    const last = out[out.length - 1]
    if (last && last[1] + 1 === g.first) last[1] = g.first + g.parts - 1
    else out.push([g.first, g.first + g.parts - 1])
  }
  return out.map(([a, b]) => IDBKeyRange.bound(a, b))
}

function openDb(name: string): Promise<IDBDatabase> {
  const r = indexedDB.open(name)
  r.onupgradeneeded = () => {
    const db = r.result
    if (!db.objectStoreNames.contains(UPDATES))
      db.createObjectStore(UPDATES, { autoIncrement: true })
    if (!db.objectStoreNames.contains(CUSTOM)) db.createObjectStore(CUSTOM)
  }
  return done(r).then((db) => {
    db.onversionchange = () => db.close()
    return db
  })
}

/** An update on its way to the database. */
interface Pending {
  update: Uint8Array
  /** In a transaction that has not settled yet (false again after a failed write). */
  sent: boolean
}

/** Persists a store into an IndexedDB database named after the document. */
export class IndexedDbProvider extends BaseProvider {
  readonly origin: RemoteOrigin = "remote:indexeddb"
  private db: IDBDatabase | null = null
  /**
   * The updates in the database that the store holds, by first key: those read on open or
   * when compacting, and those this provider wrote. What another tab writes is not in here
   * until the next compaction reads it.
   */
  private readonly index = new Map<number, Group>()
  /** Appends since the last compaction. */
  private fresh = 0
  private trimTimer: ReturnType<typeof setTimeout> | null = null
  private off: (() => void) | null = null
  /** Updates the database has not confirmed yet (oldest first). */
  private pending: Pending[] = []
  /** Write transactions that have not settled yet. */
  private readonly writes = new Set<Promise<void>>()
  private offPageHide: (() => void) | null = null
  private readonly trimSize: number
  private readonly trimDelayMs: number
  private readonly partBytes: number
  private readonly largeBytes: number

  /** @param name IndexedDB database name (one per document). */
  constructor(
    readonly name: string,
    options: IndexedDbOptions = {},
  ) {
    super(`indexeddb:${name}`)
    this.trimSize = options.trimSize ?? TRIM_SIZE
    this.trimDelayMs = options.trimDelayMs ?? TRIM_DELAY_MS
    this.partBytes = options.partBytes ?? PART_BYTES
    this.largeBytes = options.largeBytes ?? LARGE_BYTES
  }

  async attach(store: DocStore): Promise<void> {
    this.assertDetached()
    if (!hasIndexedDb()) {
      throw new Error("IndexedDbProvider needs IndexedDB (browser or worker runtime)")
    }
    this._store = store
    this.setStatus("loading")
    try {
      this.db = await openDb(this.name)
      // Persisted state → store (and the store's own state → database).
      await this.open(store)
    } catch (e) {
      this.setStatus("error", e instanceof Error ? e : new Error(String(e)))
      throw e
    }
    // Edits a previous page wrote to the unload journal → store and database.
    const journal = readJournal(this.name)
    if (journal) {
      let valid = false
      try {
        // Decoded first: a corrupt journal is dropped before the store sees any of it.
        Y.decodeUpdate(journal)
        store.applyUpdate(journal, this.origin)
        valid = true
      } catch {
        // The database state stands.
      }
      if (valid) {
        this.append(journal)
        await this.flush()
      }
      // Kept when the write failed: the next attach replays it again.
      if (this.pending.length === 0) clearJournal(this.name)
    }
    // Store → database.
    this.off = store.onUpdate((update: Uint8Array, origin: Origin) => {
      if (origin === this.origin) return
      this.append(update)
    })
    const onPageHide = () => this.writeJournal()
    globalThis.addEventListener?.("pagehide", onPageHide)
    this.offPageHide = () => globalThis.removeEventListener?.("pagehide", onPageHide)
    if (this.status !== "error") this.setStatus("synced")
  }

  /** Open: every entry → store, after the store's own state went in as a new entry. */
  private async open(store: DocStore): Promise<void> {
    const db = this.db
    if (!db) return
    const tx = db.transaction([UPDATES], "readwrite")
    const commit = committed(tx)
    const os = tx.objectStore(UPDATES)
    const stored = await read(os, null)
    const seed = store.encodeStateAsUpdate()
    const parts = partsOf(seed, this.partBytes)
    const last = (await done(put(os, seed, this.partBytes))) as number
    let seeded = true
    try {
      await commit
    } catch (e) {
      // Read, but the store's own state was not stored: it waits with the edits (status error).
      seeded = false
      this.pending.push({ update: seed, sent: false })
      this.setStatus("error", e instanceof Error ? e : new Error(String(e)))
    }
    this.index.clear()
    for (const s of stored) this.index.set(s.group.first, s.group)
    if (seeded)
      this.index.set(last - parts + 1, { first: last - parts + 1, parts, bytes: seed.byteLength })
    // A database left with many entries (an older version's, a closed tab's) is compacted soon.
    this.fresh = stored.length
    applyAll(
      store,
      stored.map((s) => s.update),
      this.origin,
      this.largeBytes,
    )
  }

  private append(update: Uint8Array): void {
    this.pending.push({ update, sent: false })
    this.send()
    if (++this.fresh < this.trimSize) return
    if (this.trimTimer !== null) clearTimeout(this.trimTimer)
    this.trimTimer = setTimeout(() => {
      this.trimTimer = null
      // A failed compaction leaves every entry in place: nothing is lost, the next one retries.
      void this.compact().catch(() => undefined)
    }, this.trimDelayMs)
  }

  /** Writes the updates no transaction holds (new ones, and those a failed write left). */
  private send(): void {
    const db = this.db
    const batch = this.pending.filter((p) => !p.sent)
    if (!db || batch.length === 0) return
    for (const p of batch) p.sent = true
    const write = new Promise<void>((resolve) => {
      const fail = (e: unknown) => {
        for (const p of batch) p.sent = false
        this.setStatus("error", e instanceof Error ? e : new Error(String(e ?? "write failed")))
        resolve()
      }
      try {
        const tx = db.transaction([UPDATES], "readwrite")
        const os = tx.objectStore(UPDATES)
        const written: Group[] = []
        for (const p of batch) {
          const parts = partsOf(p.update, this.partBytes)
          const request = put(os, p.update, this.partBytes)
          request.onsuccess = () => {
            const first = (request.result as number) - parts + 1
            written.push({ first, parts, bytes: p.update.byteLength })
          }
        }
        tx.oncomplete = () => {
          for (const g of written) this.index.set(g.first, g)
          const sent = new Set(batch)
          this.pending = this.pending.filter((p) => !sent.has(p))
          if (this.status === "error" && this.pending.every((p) => p.sent)) this.setStatus("synced")
          resolve()
        }
        tx.onabort = () => fail(tx.error)
      } catch (e) {
        fail(e)
      }
    })
    this.writes.add(write)
    void write.then(() => this.writes.delete(write))
  }

  /**
   * Compacts the database in one transaction (see the file comment): applies the entries
   * another tab wrote to the store, then replaces the newest entries by their merge, or
   * everything by the store's state once the entries beside the largest weigh half of it.
   */
  async compact(): Promise<void> {
    const store = this._store
    const db = this.db
    if (!store || !db) return
    // Queued behind the writes already sent: their entries are indexed before the reads below.
    const tx = db.transaction([UPDATES], "readwrite")
    const commit = committed(tx)
    const os = tx.objectStore(UPDATES)
    const keys = (await done(os.getAllKeys())) as number[]
    if (this.db !== db) return
    this.fresh = 0
    // Entries another tab deleted: its compaction holds them in an entry read just below.
    const present = new Set(keys)
    for (const g of [...this.index.values()]) if (!present.has(g.first)) this.index.delete(g.first)
    // Entries this provider has not read: another tab's. They go into the store first.
    const known = new Set<number>()
    for (const g of this.index.values()) for (let k = 0; k < g.parts; k++) known.add(g.first + k)
    const foreign = keys.filter((k) => !known.has(k))
    if (foreign.length > 0) {
      const unread = (await read(os, IDBKeyRange.lowerBound(foreign[0] as number))).filter(
        (r) => !this.index.has(r.group.first),
      )
      if (this.db !== db) return
      applyAll(
        store,
        unread.map((r) => r.update),
        this.origin,
        this.largeBytes,
      )
      for (const r of unread) this.index.set(r.group.first, r.group)
    }

    const all = [...this.index.values()].sort((a, b) => a.first - b.first)
    let base: Group | null = null
    for (const g of all) if (!base || g.bytes > base.bytes) base = g
    if (!base) return
    const largest = base
    // Merged: what sits before the largest update, and the newest entries after it, back to
    // the first one more than twice their size.
    const picked = all.filter((g) => g.first < largest.first)
    const newer = all.filter((g) => g.first > largest.first)
    let size = 0
    let from = newer.length
    while (from > 0) {
      const g = newer[from - 1] as Group
      if (g.bytes > Math.max(2 * size, SMALL_BYTES)) break
      size += g.bytes
      from--
    }
    picked.push(...newer.slice(from))
    if (picked.length < 2) return
    let kept = 0
    for (let i = 0; i < from; i++) kept += (newer[i] as Group).bytes
    const sources: Uint8Array[] = []
    for (const range of ranges(picked))
      for (const r of await read(os, range)) sources.push(r.update)
    if (this.db !== db) return
    const merged = Y.mergeUpdates(sources)
    const full = (kept + merged.byteLength) * 2 >= largest.bytes
    // Same transaction as the reads: the update written holds every entry deleted after it.
    const update = full ? store.encodeStateAsUpdate() : merged
    const parts = partsOf(update, this.partBytes)
    const last = (await done(put(os, update, this.partBytes))) as number
    const first = last - parts + 1
    if (full) await done(os.delete(IDBKeyRange.upperBound(first, true)))
    else for (const range of ranges(picked)) await done(os.delete(range))
    // Indexed once committed: an aborted compaction leaves every entry, and its key can go to
    // another tab's update.
    await commit
    if (this.db !== db) return
    if (full) this.index.clear()
    else for (const g of picked) this.index.delete(g.first)
    this.index.set(first, { first, parts, bytes: update.byteLength })
  }

  /**
   * Resolves once every update sent so far is committed to IndexedDB, or its write failed
   * (the status is then `error`). Retries the writes that failed before.
   */
  async flush(): Promise<void> {
    this.send()
    while (this.writes.size > 0) await Promise.all([...this.writes])
  }

  /** Synchronously journals the unconfirmed updates (page unload). */
  private writeJournal(): void {
    if (this.pending.length === 0) return
    let bytes = 0
    for (const p of this.pending) bytes += p.update.byteLength
    // Too large for localStorage (a whole document still on its way): nothing to do at unload.
    if (bytes > JOURNAL_MAX_BYTES) return
    const prev = readJournal(this.name)
    const updates = this.pending.map((p) => p.update)
    const merged = Y.mergeUpdates(prev ? [prev, ...updates] : updates)
    try {
      globalThis.localStorage?.setItem(journalKey(this.name), toBase64(merged))
    } catch {
      // Storage full or blocked: nothing more can be done during unload.
    }
  }

  private close(): void {
    if (this.trimTimer !== null) clearTimeout(this.trimTimer)
    this.trimTimer = null
    this.db?.close()
    this.db = null
    this.index.clear()
  }

  async detach(): Promise<void> {
    this.off?.()
    this.off = null
    this.offPageHide?.()
    this.offPageHide = null
    await this.flush()
    // A write that failed again: the edits go to the journal, which the next attach replays.
    if (this.pending.length > 0) this.writeJournal()
    this.pending = []
    this.close()
    this._store = null
    this.setStatus("detached")
  }

  /** Deletes the persisted database (e.g. after the document was saved elsewhere). */
  async clearData(): Promise<void> {
    if (!this.db) return
    this.close()
    await done(indexedDB.deleteDatabase(this.name)).catch(() => undefined)
  }
}

const journalKey = (name: string) => `kimo.journal.${name}`

function readJournal(name: string): Uint8Array | null {
  try {
    const v = globalThis.localStorage?.getItem(journalKey(name))
    return v ? fromBase64(v) : null
  } catch {
    return null
  }
}

function clearJournal(name: string): void {
  try {
    globalThis.localStorage?.removeItem(journalKey(name))
  } catch {
    // ignore
  }
}

function toBase64(bytes: Uint8Array): string {
  let s = ""
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

function fromBase64(text: string): Uint8Array {
  const s = atob(text)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}
