import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { YjsDocStore } from "@kimo/editor-state"
import { IDBDatabase as FakeDatabase, IDBFactory, IDBKeyRange } from "fake-indexeddb"
import { IndexedDbProvider } from "../src/indexeddb"
import { emptyStore, rect } from "./helpers"

const g = globalThis as Record<string, unknown>
const journal = new Map<string, string>()

beforeAll(() => {
  g.indexedDB = new IDBFactory()
  g.IDBKeyRange = IDBKeyRange
  g.localStorage = {
    getItem: (k: string) => journal.get(k) ?? null,
    setItem: (k: string, v: string) => void journal.set(k, v),
    removeItem: (k: string) => void journal.delete(k),
  }
})
afterAll(() => {
  delete g.indexedDB
  delete g.IDBKeyRange
  delete g.localStorage
})

let dbs = 0
const dbName = () => `kimo-test-${++dbs}`
const id = (prefix: string, i: number) => `${prefix}${String(i).padStart(4, "0")}`

function add(store: YjsDocStore, prefix: string, count: number): void {
  for (let i = 0; i < count; i++) {
    const r = store.apply(
      { op: "insert", id: id(prefix, i), parent: null, node: rect(id(prefix, i)) },
      { origin: "user" },
    )
    if (!r.ok) throw new Error(JSON.stringify(r))
  }
}

/** What a page that opens the document later gets. */
async function reopen(name: string): Promise<YjsDocStore> {
  const store = new YjsDocStore()
  const provider = new IndexedDbProvider(name)
  await provider.attach(store)
  await provider.detach()
  return store
}

const request = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })

async function entries(name: string): Promise<number> {
  const db = await request(indexedDB.open(name))
  const n = await request(db.transaction(["updates"], "readonly").objectStore("updates").count())
  db.close()
  return n
}

/** Makes the next write transaction fail to open (a full disk, a closed database). */
function failNextWrite(): () => void {
  const proto = FakeDatabase.prototype as { transaction: (...args: unknown[]) => unknown }
  const real = proto.transaction
  let failed = false
  proto.transaction = function (this: unknown, ...args: unknown[]) {
    if (!failed && args[1] === "readwrite") {
      failed = true
      throw new Error("write refused")
    }
    return real.apply(this, args)
  }
  return () => {
    proto.transaction = real
  }
}

describe("IndexedDbProvider", () => {
  test("opens a database in the y-indexeddb layout (one entry per update)", async () => {
    const source = emptyStore()
    const updates = [source.encodeStateAsUpdate()]
    source.onUpdate((u) => updates.push(u))
    add(source, "old", 12)
    const name = dbName()
    const open = indexedDB.open(name)
    open.onupgradeneeded = () => {
      open.result.createObjectStore("updates", { autoIncrement: true })
      open.result.createObjectStore("custom")
    }
    const db = await request(open)
    const tx = db.transaction(["updates"], "readwrite")
    for (const u of updates) tx.objectStore("updates").add(u)
    await new Promise((resolve) => {
      tx.oncomplete = resolve
    })
    db.close()

    expect((await reopen(name)).toDocument()).toEqual(source.toDocument())
  })

  test("edits are there on the next open", async () => {
    const name = dbName()
    const store = emptyStore()
    const provider = new IndexedDbProvider(name)
    await provider.attach(store)
    add(store, "node", 25)
    await provider.detach()

    expect((await reopen(name)).toDocument()).toEqual(store.toDocument())
  })

  test("compaction keeps every edit of two open tabs", async () => {
    const name = dbName()
    const a = emptyStore()
    const tabA = new IndexedDbProvider(name, { trimSize: Number.MAX_SAFE_INTEGER })
    await tabA.attach(a)
    add(a, "first", 200)
    await tabA.flush()
    const b = new YjsDocStore()
    const tabB = new IndexedDbProvider(name, { trimSize: Number.MAX_SAFE_INTEGER })
    await tabB.attach(b)
    add(b, "other", 10)
    await tabB.flush()

    // Everything is replaced by one state: the other tab's edits are read first.
    await tabA.compact()
    expect(await entries(name)).toBe(1)
    expect(a.nodeIds()).toContain(id("other", 9))

    // A few edits after a large first entry: only they are merged.
    add(a, "more", 3)
    add(b, "late", 3)
    await Promise.all([tabA.flush(), tabB.flush()])
    await tabA.compact()
    expect(await entries(name)).toBe(2)

    // The other tab compacts a database the first one rewrote.
    add(b, "last", 1)
    await tabB.flush()
    await tabB.compact()
    await tabA.compact()

    const opened = await reopen(name)
    expect(opened.nodeIds().length).toBe(200 + 10 + 3 + 3 + 1)
    expect(opened.toDocument()).toEqual(a.toDocument())
    expect(opened.toDocument()).toEqual(b.toDocument())
    await Promise.all([tabA.detach(), tabB.detach()])
  })

  test("compacts by itself once enough entries pile up", async () => {
    const name = dbName()
    const store = emptyStore()
    const provider = new IndexedDbProvider(name, { trimSize: 8, trimDelayMs: 0 })
    await provider.attach(store)
    add(store, "node", 40)
    await provider.flush()
    // 41 entries so far; the timer's compaction leaves one or two.
    for (let i = 0; i < 200 && (await entries(name)) > 2; i++)
      await new Promise((r) => setTimeout(r, 0))

    expect(await entries(name)).toBeLessThanOrEqual(2)
    expect((await reopen(name)).toDocument()).toEqual(store.toDocument())
    await provider.detach()
  })

  test("an update too large for one value is stored in parts and read back whole", async () => {
    const name = dbName()
    const store = emptyStore()
    add(store, "big", 300)
    // The document goes in as one update, split in parts of 1 KB.
    const options = { partBytes: 1024, trimSize: Number.MAX_SAFE_INTEGER }
    const provider = new IndexedDbProvider(name, options)
    await provider.attach(store)
    await provider.flush()
    expect(await entries(name)).toBeGreaterThan(10)

    const readAll = async () => {
      const other = new YjsDocStore()
      const p = new IndexedDbProvider(name, options)
      await p.attach(other)
      await p.detach()
      return other.toDocument()
    }
    expect(await readAll()).toEqual(store.toDocument())

    // Compaction around a first update made of parts: a merge of the rest, then a full rewrite.
    add(store, "then", 4)
    await provider.flush()
    await provider.compact()
    expect(await readAll()).toEqual(store.toDocument())
    add(store, "many", 400)
    await provider.flush()
    await provider.compact()
    expect(await readAll()).toEqual(store.toDocument())
    await provider.detach()
    expect(await readAll()).toEqual(store.toDocument())
  })

  test("random edits and compactions in two tabs never lose a node", async () => {
    const name = dbName()
    // Small parts and merges of every size: each path of the compaction runs many times.
    const options = { partBytes: 700, trimSize: Number.MAX_SAFE_INTEGER }
    let seed = 12345
    const random = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return (seed >>> 9) % n
    }
    const stores = [emptyStore(), new YjsDocStore()]
    const tabs = stores.map(() => new IndexedDbProvider(name, options))
    for (let i = 0; i < 2; i++) await tabs[i]?.attach(stores[i] as YjsDocStore)
    const expected: string[] = []
    for (let round = 0; round < 60; round++) {
      const t = random(2)
      const prefix = `r${String(round).padStart(2, "0")}n`
      const count = random(10) === 0 ? 80 : 1 + random(6)
      add(stores[t] as YjsDocStore, prefix, count)
      for (let i = 0; i < count; i++) expected.push(id(prefix, i))
      await tabs[t]?.flush()
      if (random(3) === 0) await tabs[random(2)]?.compact()
      if (round % 10 === 9)
        expect((await reopen(name)).nodeIds().sort()).toEqual([...expected].sort())
    }
    for (let i = 0; i < 4; i++) await tabs[i % 2]?.compact()
    const opened = await reopen(name)
    expect(opened.nodeIds().sort()).toEqual([...expected].sort())
    expect(opened.toDocument()).toEqual((stores[0] as YjsDocStore).toDocument())
    expect(opened.toDocument()).toEqual((stores[1] as YjsDocStore).toDocument())
    await Promise.all(tabs.map((t) => t.detach()))
  })

  test("a write that fails is reported and written with the next one", async () => {
    const name = dbName()
    const store = emptyStore()
    const provider = new IndexedDbProvider(name)
    await provider.attach(store)
    const restore = failNextWrite()
    try {
      add(store, "lost", 1)
      expect(provider.status).toBe("error")
      add(store, "next", 1)
      await provider.flush()
    } finally {
      restore()
    }
    expect(provider.status).toBe("synced")
    await provider.detach()

    expect((await reopen(name)).toDocument()).toEqual(store.toDocument())
  })

  test("an edit not written when the page closes is replayed from the journal", async () => {
    const name = dbName()
    const store = emptyStore()
    const provider = new IndexedDbProvider(name)
    await provider.attach(store)
    add(store, "kept", 3)
    await provider.flush()
    const restore = failNextWrite()
    try {
      add(store, "unsaved", 1)
    } finally {
      restore()
    }
    globalThis.dispatchEvent(new Event("pagehide"))
    expect(journal.size).toBe(1)
    // The page is gone: nothing more reaches the database from it.

    const opened = await reopen(name)
    expect(opened.nodeIds()).toContain(id("unsaved", 0))
    expect(opened.toDocument()).toEqual(store.toDocument())
    expect(journal.size).toBe(0)
    // Written to the database too: there without the journal.
    expect((await reopen(name)).nodeIds()).toContain(id("unsaved", 0))
  })
})
