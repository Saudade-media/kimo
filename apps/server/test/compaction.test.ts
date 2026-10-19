import { afterEach, describe, expect, test } from "bun:test"
import { sealUpdate } from "@kimo/sync/mp"
import {
  type Harness,
  joinAs,
  markCaughtUp,
  putSnapshotRaw,
  registered,
  startRelay,
  token,
  update,
} from "./helpers"

let h: Harness
afterEach(() => h.stop())

async function appendN(
  client: Awaited<ReturnType<typeof joinAs>>["client"],
  owner: Parameters<typeof update>[0],
  n: number,
  from = 1,
) {
  for (let i = 0; i < n; i++)
    client.send({ type: "append", cid: from + i, env: await update(owner, `u${from + i}`) })
}

describe("compaction scheduling (section 14.3)", () => {
  test("triggered by entry count, sent to the lowest caught-up edit peer", async () => {
    h = startRelay({ compactEntries: 3 })
    const owner = await registered(h)
    const a = await joinAs(h, owner, "edit")
    const b = await joinAs(h, owner, "edit")
    const viewer = await joinAs(h, owner, "view")
    await markCaughtUp(b.client)
    await markCaughtUp(viewer.client)
    await appendN(b.client, owner, 2)
    expect(await b.client.drain("compact")).toHaveLength(0)
    // a has not sent caught-up yet, so b (peer 2) is the lowest eligible peer.
    await appendN(b.client, owner, 1, 3)
    expect(await b.client.next("compact")).toEqual({ type: "compact", upTo: 3 })
    expect(await a.client.drain("compact")).toHaveLength(0)
    expect(await viewer.client.drain("compact")).toHaveLength(0)
    // Only one request is outstanding at a time.
    await appendN(b.client, owner, 2, 4)
    expect(await b.client.drain("compact")).toHaveLength(0)
    for (const p of [a, b, viewer]) p.client.close()
  })

  test("the lowest peer wins once it is caught up", async () => {
    h = startRelay({ compactEntries: 2 })
    const owner = await registered(h)
    const a = await joinAs(h, owner, "edit")
    const b = await joinAs(h, owner, "edit")
    await markCaughtUp(a.client)
    await markCaughtUp(b.client)
    await appendN(b.client, owner, 2)
    expect(await a.client.next("compact")).toMatchObject({ upTo: 2 })
    a.client.close()
    b.client.close()
  })

  test("triggered by bytes", async () => {
    h = startRelay({ compactEntries: 1000, compactBytes: 2000 })
    const owner = await registered(h)
    const a = await joinAs(h, owner, "edit")
    await markCaughtUp(a.client)
    a.client.send({
      type: "append",
      cid: 1,
      env: await sealUpdate(owner.keys, new Uint8Array(2500)),
    })
    expect(await a.client.next("compact")).toEqual({ type: "compact", upTo: 1 })
    a.client.close()
  })

  test("moves on to the next peer after 60 s without a snapshot", async () => {
    h = startRelay({ compactEntries: 1 })
    const owner = await registered(h)
    const a = await joinAs(h, owner, "edit")
    const b = await joinAs(h, owner, "edit")
    await markCaughtUp(a.client)
    await markCaughtUp(b.client)
    await appendN(a.client, owner, 1)
    await a.client.next("compact")
    h.clock.now += 59_000
    h.relay.tick()
    expect(await b.client.drain("compact")).toHaveLength(0)
    h.clock.now += 2_000
    h.relay.tick()
    expect(await b.client.next("compact")).toMatchObject({ upTo: 1 })
    // Everyone has been asked: the request is dropped until the next trigger.
    h.clock.now += 61_000
    h.relay.tick()
    expect(await a.client.drain("compact")).toHaveLength(0)
    await appendN(a.client, owner, 1, 2)
    expect(await a.client.next("compact")).toMatchObject({ upTo: 2 })
    a.client.close()
    b.client.close()
  })

  test("an accepted snapshot clears the request so the next trigger asks again", async () => {
    h = startRelay({ compactEntries: 2 })
    const owner = await registered(h)
    const a = await joinAs(h, owner, "edit")
    await markCaughtUp(a.client)
    await appendN(a.client, owner, 2)
    await a.client.next("compact")
    const res = await putSnapshotRaw(h, owner, await token(owner, "edit"), 2)
    expect(res.status).toBe(201)
    await a.client.next("snapshot")
    await appendN(a.client, owner, 1, 3)
    expect(await a.client.drain("compact")).toHaveLength(0)
    await appendN(a.client, owner, 1, 4)
    expect(await a.client.next("compact")).toMatchObject({ upTo: 4 })
    a.client.close()
  })

  test("a departing compactor hands the request to another peer", async () => {
    h = startRelay({ compactEntries: 1 })
    const owner = await registered(h)
    const a = await joinAs(h, owner, "edit")
    const b = await joinAs(h, owner, "edit")
    await markCaughtUp(a.client)
    await markCaughtUp(b.client)
    await appendN(a.client, owner, 1)
    await a.client.next("compact")
    a.client.close()
    expect(await b.client.next("compact")).toMatchObject({ upTo: 1 })
    b.client.close()
  })

  test("LOG_FULL past the hard cap until a snapshot lets retention shrink the log", async () => {
    h = startRelay({ logMaxBytes: 300, logRetainMs: 0, compactEntries: 1000 })
    const owner = await registered(h)
    const a = await joinAs(h, owner, "edit")
    await appendN(a.client, owner, 14)
    expect((await a.client.closeInfo()).reason).toBe("LOG_FULL")
    const row = h.relay.db.getRoom(owner.room.id)
    expect(row?.log_bytes).toBeGreaterThan(300)
    const t = await token(owner, "edit")
    expect((await putSnapshotRaw(h, owner, t, row?.head ?? 0)).status).toBe(201)
    h.clock.now += 61_000
    h.relay.tick()
    expect(h.relay.db.getRoom(owner.room.id)?.log_bytes).toBe(0)
    const again = await joinAs(h, owner, "edit")
    again.client.send({ type: "append", cid: 1, env: await update(owner, "fits") })
    await again.client.next("ack")
    again.client.close()
  })
})
