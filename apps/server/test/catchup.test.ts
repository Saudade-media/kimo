import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import {
  type Client,
  type Harness,
  joinAs,
  putSnapshotRaw,
  registered,
  seedLog,
  startRelay,
  token,
  until,
  update,
} from "./helpers"

let h: Harness
beforeAll(() => {
  h = startRelay({ logRetainMs: 0 })
})
afterAll(() => h.stop())

function entrySeqs(client: Client): number[] {
  return client.messages.flatMap((m) => (m.type === "entries" ? m.entries.map((e) => e.seq) : []))
}

describe("catch-up (section 11.4)", () => {
  test("without a snapshot: since 0 replays everything, since n resumes after n", async () => {
    const owner = await registered(h)
    seedLog(h, owner, 5)
    const full = await joinAs(h, owner, "view")
    expect(full.welcome).toMatchObject({ head: 5, base: 0, from: 1, needSnapshot: false })
    await until(() => entrySeqs(full.client).length === 5)
    expect(entrySeqs(full.client)).toEqual([1, 2, 3, 4, 5])
    const resumed = await joinAs(h, owner, "view", { since: 3 })
    expect(resumed.welcome).toMatchObject({ from: 4, needSnapshot: false })
    await until(() => entrySeqs(resumed.client).length === 2)
    expect(entrySeqs(resumed.client)).toEqual([4, 5])
    const current = await joinAs(h, owner, "view", { since: 5 })
    expect(current.welcome.from).toBe(6)
    expect(await current.client.drain("entries")).toHaveLength(0)
    for (const p of [full, resumed, current]) p.client.close()
  })

  test("with a snapshot: since 0 and since below base need it, since inside retention does not", async () => {
    const owner = await registered(h)
    seedLog(h, owner, 5)
    const editor = await token(owner, "edit")
    expect((await putSnapshotRaw(h, owner, editor, 3)).status).toBe(201)
    h.clock.now += 1000
    h.relay.retain()

    const fresh = await joinAs(h, owner, "view")
    expect(fresh.welcome).toMatchObject({
      base: 3,
      from: 4,
      needSnapshot: true,
      snapshot: { upTo: 3, gen: 1 },
    })
    await until(() => entrySeqs(fresh.client).length === 2)
    expect(entrySeqs(fresh.client)).toEqual([4, 5])

    const behind = await joinAs(h, owner, "view", { since: 2 })
    expect(behind.welcome).toMatchObject({ needSnapshot: true, from: 4 })
    const inside = await joinAs(h, owner, "view", { since: 3 })
    expect(inside.welcome).toMatchObject({ needSnapshot: false, from: 4 })
    const ahead = await joinAs(h, owner, "view", { since: 99 })
    expect(ahead.welcome).toMatchObject({ needSnapshot: true, from: 4 })
    for (const p of [fresh, behind, inside, ahead]) p.client.close()
  })

  test("without a snapshot, since above head is treated as 0", async () => {
    const owner = await registered(h)
    seedLog(h, owner, 2)
    const { client, welcome } = await joinAs(h, owner, "view", { since: 50 })
    expect(welcome).toMatchObject({ from: 1, needSnapshot: false })
    await until(() => entrySeqs(client).length === 2)
    client.close()
  })

  test("entries are paged at 512 per frame", async () => {
    const owner = await registered(h)
    seedLog(h, owner, 1100)
    const { client } = await joinAs(h, owner, "view")
    await until(() => entrySeqs(client).length === 1100)
    const sizes = client.messages.flatMap((m) => (m.type === "entries" ? [m.entries.length] : []))
    expect(sizes).toEqual([512, 512, 76])
    expect(entrySeqs(client)).toEqual(Array.from({ length: 1100 }, (_, i) => i + 1))
    client.close()
  })

  test("entries are paged at 1 MiB of envelopes per frame", async () => {
    const owner = await registered(h)
    seedLog(h, owner, 5, 400_000)
    const { client } = await joinAs(h, owner, "view")
    await until(() => entrySeqs(client).length === 5)
    const sizes = client.messages.flatMap((m) => (m.type === "entries" ? [m.entries.length] : []))
    expect(sizes).toEqual([2, 2, 1])
    client.close()
  })

  test("a live append after catch-up is not repeated", async () => {
    const owner = await registered(h)
    seedLog(h, owner, 1)
    const editor = await joinAs(h, owner, "edit")
    const viewer = await joinAs(h, owner, "view")
    await until(() => entrySeqs(viewer.client).length === 1)
    editor.client.send({ type: "append", cid: 1, env: await update(owner, "live") })
    await until(() => entrySeqs(viewer.client).length === 2)
    expect(entrySeqs(viewer.client)).toEqual([1, 2])
    editor.client.close()
    viewer.client.close()
  })
})
