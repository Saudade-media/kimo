import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sealSnapshot } from "@kimo/sync/mp"
import {
  bearer,
  type Harness,
  joinAs,
  putSnapshotRaw,
  registered,
  seedLog,
  startRelay,
  token,
} from "./helpers"

let h: Harness
beforeAll(() => {
  h = startRelay()
})
afterAll(() => h.stop())

const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error

describe("snapshot upload and acceptance", () => {
  test("the genesis seed has upTo 0, and a repeat needs carries", async () => {
    const owner = await registered(h)
    const t = await token(owner, "edit")
    const first = await putSnapshotRaw(h, owner, t, 0)
    expect(first.status).toBe(201)
    expect(await first.json()).toEqual({ gen: 1, upTo: 0 })
    const again = await putSnapshotRaw(h, owner, t, 0)
    expect(again.status).toBe(409)
    expect(await errorOf(again)).toBe("SNAPSHOT_STALE")
    const carrying = await putSnapshotRaw(h, owner, t, 0, { carries: true })
    expect(carrying.status).toBe(201)
    expect(await carrying.json()).toEqual({ gen: 2, upTo: 0 })
  })

  test("upTo beyond head is SNAPSHOT_AHEAD, behind the current one is SNAPSHOT_STALE", async () => {
    const owner = await registered(h)
    const t = await token(owner, "edit")
    seedLog(h, owner, 3)
    const ahead = await putSnapshotRaw(h, owner, t, 4)
    expect(ahead.status).toBe(422)
    expect(await errorOf(ahead)).toBe("SNAPSHOT_AHEAD")
    expect((await putSnapshotRaw(h, owner, t, 2)).status).toBe(201)
    const stale = await putSnapshotRaw(h, owner, t, 1)
    expect(stale.status).toBe(409)
    expect(await errorOf(stale)).toBe("SNAPSHOT_STALE")
    expect((await putSnapshotRaw(h, owner, t, 2, { carries: true })).status).toBe(201)
    expect((await putSnapshotRaw(h, owner, t, 3)).status).toBe(201)
  })

  test("only the latest two generations are kept", async () => {
    const owner = await registered(h)
    const t = await token(owner, "edit")
    seedLog(h, owner, 4)
    for (let upTo = 1; upTo <= 4; upTo++) await putSnapshotRaw(h, owner, t, upTo)
    const rows = h.relay.db.sqlite
      .query("SELECT gen FROM snapshots WHERE room = ? ORDER BY gen")
      .all(owner.room.id)
    expect(rows).toEqual([{ gen: 3 }, { gen: 4 }])
    const row = h.relay.db.getRoom(owner.room.id)
    expect(row?.snapshot_bytes).toBeGreaterThan(0)
  })

  test("GET returns the latest envelope with kimo-up-to and kimo-gen; 404 when none", async () => {
    const owner = await registered(h)
    const t = await token(owner, "view")
    const none = await fetch(`${h.base}/room/${owner.room.id}/snapshot`, { headers: bearer(t) })
    expect(none.status).toBe(404)
    seedLog(h, owner, 2)
    const body = await sealSnapshot(owner.keys, 2, new TextEncoder().encode("state"))
    await putSnapshotRaw(h, owner, await token(owner, "edit"), 2, { body })
    const res = await fetch(`${h.base}/room/${owner.room.id}/snapshot`, { headers: bearer(t) })
    expect(res.status).toBe(200)
    expect(res.headers.get("kimo-up-to")).toBe("2")
    expect(res.headers.get("kimo-gen")).toBe("1")
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual(Array.from(body))
  })

  test("view tokens cannot upload, junk bodies are 400, oversize is 413", async () => {
    const owner = await registered(h)
    const view = await token(owner, "view")
    const denied = await putSnapshotRaw(h, owner, view, 0)
    expect(denied.status).toBe(403)
    expect(await errorOf(denied)).toBe("VIEW_ONLY")
    const edit = await token(owner, "edit")
    expect((await putSnapshotRaw(h, owner, edit, 0, { body: new Uint8Array(50) })).status).toBe(400)
    const small = startRelay({ snapshotMaxBytes: 500 })
    const other = await registered(small)
    const big = await sealSnapshot(other.keys, 0, new Uint8Array(1000))
    const res = await putSnapshotRaw(small, other, await token(other, "edit"), 0, { body: big })
    expect(res.status).toBe(413)
    await small.stop()
  })

  test("an accepted snapshot is published to every socket", async () => {
    const owner = await registered(h)
    const a = await joinAs(h, owner, "edit")
    const b = await joinAs(h, owner, "view")
    const t = await token(owner, "edit")
    const res = await putSnapshotRaw(h, owner, t, 0, {})
    expect(res.status).toBe(201)
    const seen = await b.client.next("snapshot")
    expect(seen.carriesNew).toBe(false)
    expect(seen.info).toMatchObject({ upTo: 0, gen: 1 })
    await putSnapshotRaw(h, owner, t, 0, { carries: true })
    expect((await a.client.next("snapshot")).info.gen).toBe(1)
    expect((await a.client.next("snapshot")).carriesNew).toBe(true)
    a.client.close()
    b.client.close()
  })
})

describe("retention", () => {
  test("covered entries older than the retention window are pruned and base moves", async () => {
    const owner = await registered(h)
    seedLog(h, owner, 5)
    const t = await token(owner, "edit")
    await putSnapshotRaw(h, owner, t, 3)
    h.relay.tick()
    expect(h.relay.db.getRoom(owner.room.id)).toMatchObject({ base: 0 })
    h.clock.now += 599_000
    h.relay.tick()
    expect(h.relay.db.getRoom(owner.room.id)).toMatchObject({ base: 0 })
    // The job runs once a minute, so the next run after the window is within one more minute.
    h.clock.now += 61_000
    h.relay.tick()
    const row = h.relay.db.getRoom(owner.room.id)
    expect(row?.base).toBe(3)
    expect(row?.log_bytes).toBe(80)
    expect(h.relay.db.entriesFrom(owner.room.id, 1).map((e) => e.seq)).toEqual([4, 5])
  })
})
