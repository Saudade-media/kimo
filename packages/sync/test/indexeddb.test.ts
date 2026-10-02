import { describe, expect, test } from "bun:test"
import { hasIndexedDb, IndexedDbProvider } from "../src/indexeddb"
import { emptyStore, rect } from "./helpers"

describe("IndexedDbProvider", () => {
  test.skipIf(hasIndexedDb())("attach rejects clearly where IndexedDB is missing", async () => {
    const p = new IndexedDbProvider("kimo-test")
    await expect(p.attach(emptyStore())).rejects.toThrow(/IndexedDB/)
    expect(p.store).toBeNull()
  })

  test.skipIf(!hasIndexedDb())("persists and restores a store", async () => {
    const name = `kimo-test-${Math.random().toString(36).slice(2)}`
    const a = emptyStore()
    const pa = new IndexedDbProvider(name)
    await pa.attach(a)
    const r = a.apply({ op: "insert", id: "Persist001", node: rect("p") }, { origin: "user" })
    expect(r.ok).toBe(true)
    await pa.detach()

    const b = emptyStore()
    const pb = new IndexedDbProvider(name)
    await pb.attach(b)
    expect(b.getNode("Persist001")?.name).toBe("p")
    await pb.clearData()
    await pb.detach()
  })
})
