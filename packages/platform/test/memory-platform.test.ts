import { describe, expect, test } from "bun:test"
import { isPlatformError } from "../src/index"
import { createMemoryPlatform } from "../src/memory"

// The in-memory platform stands in for the desktop one in every host test, so its failure
// codes, lease semantics and never-overwrite rules have to match the real contract.
describe("memory platform", () => {
  test("injected write failures surface with codes the sync classifier understands", async () => {
    const p = createMemoryPlatform({ files: { "/w/a.kimo": "{}\n" } })
    p.control.failNextWrite("DISK_FULL", "ENOSPC")
    const e1 = await p.files.writeTextAtomic("/w/a.kimo", "x").catch((e) => e)
    expect(isPlatformError(e1, "DISK_FULL")).toBe(true)
    expect(e1.errno).toBe("ENOSPC")
    expect(p.control.readFile("/w/a.kimo")).toBe("{}\n")
    p.control.corruptNextReadBack()
    const e2 = await p.files.writeTextAtomic("/w/a.kimo", "y").catch((e) => e)
    expect(isPlatformError(e2, "READ_BACK_MISMATCH")).toBe(true)
    p.control.setReadOnly("/w/a.kimo", true)
    const e3 = await p.files.writeTextAtomic("/w/a.kimo", "z").catch((e) => e)
    expect(isPlatformError(e3, "PERMISSION")).toBe(true)
  })

  test("leases: foreign holder blocks, dead pid is reclaimed, self re-acquire is idempotent", async () => {
    const p = createMemoryPlatform({ files: { "/w/a.kimo": "{}" } })
    p.control.setForeignLease("/w/a.kimo", { pid: 48213 })
    const blocked = await p.leases.acquire("/w/a.kimo")
    expect(blocked.ok).toBe(false)
    if (!blocked.ok)
      expect(blocked.holder).toMatchObject({ pid: 48213, app: "kimo-mcp", alive: true })
    p.control.killPid(48213)
    const got = await p.leases.acquire("/w/a.kimo")
    expect(got.ok && got.reclaimed?.pid).toBe(48213)
    const again = await p.leases.acquire("/w/a.kimo")
    expect(again.ok).toBe(true)
    if (got.ok) await p.leases.release(got.lease)
    expect(await p.leases.inspect("/w/a.kimo")).toBeNull()
  })

  test("rename and copy never overwrite; a trash restore onto a taken path fails with EXISTS", async () => {
    const p = createMemoryPlatform({ files: { "/w/a.kimo": "A", "/w/b.kimo": "B" } })
    await expect(p.files.rename("/w/a.kimo", "/w/b.kimo")).rejects.toMatchObject({
      code: "EXISTS",
    })
    await expect(p.files.copy("/w/a.kimo", "/w/b.kimo")).rejects.toMatchObject({ code: "EXISTS" })
    const t = await p.trash.move("/w/b.kimo")
    p.control.writeExternal("/w/b.kimo", "new")
    await expect(p.trash.restore(t.id)).rejects.toMatchObject({ code: "EXISTS" })
    expect(await p.trash.restore(t.id, "/w/b copy.kimo")).toBe("/w/b copy.kimo")
    expect(p.control.readFile("/w/b.kimo")).toBe("new")
  })
})
