import { describe, expect, test } from "bun:test"
import { jsonEqual, validate } from "@kimo/core-schema"
import { createEmptyDocument, YjsDocStore } from "@kimo/editor-state"
import { deriveRoomKeys, parseRoomId, sealSnapshot } from "../src/mp"
import type { NetworkEvent } from "../src/network"
import { emptyStore, rect } from "./helpers"
import {
  FakeRelay,
  makeRoom,
  providerFor,
  SwitchableStore,
  waitFor,
} from "./network-provider-fake-relay"

const ok = <T extends { ok: boolean }>(r: T) => {
  if (!r.ok) throw new Error(JSON.stringify(r))
  return r
}

async function room(seed: YjsDocStore = emptyStore()) {
  const { room, roomKey } = makeRoom()
  const relay = new FakeRelay(room)
  relay.grant("edit", { role: "edit" })
  relay.grant("view", { role: "view" })
  const keys = await deriveRoomKeys(roomKey, parseRoomId(room))
  relay.putSnapshot(0, false, await sealSnapshot(keys, 0, seed.encodeStateAsUpdate()))
  return { relay, roomKey, seed, keys }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe("network provider: compaction", () => {
  test("compact uploads a snapshot covering exactly since", async () => {
    const { relay, roomKey, seed } = await room()
    const pa = providerFor(relay, roomKey, "edit")
    const events: NetworkEvent[] = []
    pa.onEvent((e) => e.type === "compacted" && events.push(e))
    await pa.attach(seed)
    for (let i = 0; i < 3; i++)
      ok(seed.apply({ op: "insert", id: `Node00000${i}`, node: rect("n") }, { origin: "user" }))
    await waitFor(() => relay.head === 3 && pa.status === "synced")
    relay.requestCompaction()
    await waitFor(() => events.length === 1)
    expect(events[0]).toEqual({ type: "compacted", upTo: 3, gen: 2 })
    expect(relay.snapshotPuts.at(-1)).toEqual({ upTo: 3, carries: false })
    // A joiner after pruning gets everything from the client-made snapshot.
    relay.prune()
    const b = new YjsDocStore()
    const pb = providerFor(relay, roomKey, "view")
    await pb.attach(b)
    expect(jsonEqual(b.toDocument(), seed.toDocument())).toBe(true)
    await pa.detach()
    await pb.detach()
  })

  test("the relay triggers compaction past its threshold", async () => {
    const { relay, roomKey, seed } = await room()
    relay.compactEntries = 4
    const pa = providerFor(relay, roomKey, "edit")
    await pa.attach(seed)
    for (let i = 0; i < 5; i++)
      ok(seed.apply({ op: "insert", id: `Node00000${i}`, node: rect("n") }, { origin: "user" }))
    await waitFor(() => (relay.latest?.upTo ?? 0) >= 4)
    await pa.detach()
  })

  test("a client that is not clean declines until it is clean", async () => {
    const { relay, roomKey, seed } = await room()
    const pa = providerFor(relay, roomKey, "edit")
    await pa.attach(seed)
    ok(seed.apply({ op: "insert", id: "Acked00001", node: rect("a") }, { origin: "user" }))
    await waitFor(() => relay.head === 1 && pa.status === "synced")
    // The second append is stored but never acknowledged: since (1) covers upTo (1), yet the
    // client is unclean, so only the clean check can make it decline.
    relay.holdAcks = true
    ok(seed.apply({ op: "insert", id: "Pending001", node: rect("p") }, { origin: "user" }))
    await waitFor(() => relay.head === 2)
    expect(pa.status).toBe("saving")
    const socket = relay.peers.find((s) => s.peer === pa.peer)
    const puts = relay.snapshotPuts.length
    socket?.deliver({ type: "compact", upTo: 1 })
    await sleep(400) // compactWaitMs is 300 in tests
    expect(relay.snapshotPuts.length).toBe(puts)
    // The ack arrives: the same request now succeeds.
    const append = relay.appends().at(-1)
    if (append?.type !== "append") throw new Error("no append")
    socket?.deliver({ type: "ack", cid: append.cid, seq: 2 })
    await waitFor(() => pa.status === "synced")
    socket?.deliver({ type: "compact", upTo: 1 })
    await waitFor(() => relay.snapshotPuts.length === puts + 1)
    expect(relay.snapshotPuts.at(-1)).toEqual({ upTo: 2, carries: false })
    await pa.detach()
  })

  test("the oversize fallback uploads a carries snapshot that the other peer applies", async () => {
    const { relay, roomKey, seed } = await room()
    relay.limits = { ...relay.limits, maxEntryBytes: 400 }
    const pa = providerFor(relay, roomKey, "edit")
    const b = new YjsDocStore()
    const pb = providerFor(relay, roomKey, "edit")
    const applied: NetworkEvent[] = []
    pb.onEvent((e) => e.type === "snapshot-applied" && applied.push(e))
    await pa.attach(seed)
    await pb.attach(b)
    applied.length = 0
    ok(
      seed.apply(
        { op: "insert", id: "Huge000001", node: rect("x".repeat(2000)) },
        { origin: "user" },
      ),
    )
    await waitFor(() => b.hasNode("Huge000001"))
    expect(relay.snapshotPuts.at(-1)).toEqual({ upTo: 0, carries: true })
    expect(applied).toHaveLength(1)
    expect(relay.head).toBe(0)
    // Small updates still go through the log.
    ok(seed.apply({ op: "update", id: "Huge000001", set: { x: 1 } }, { origin: "user" }))
    await waitFor(() => b.getNode("Huge000001")?.x === 1)
    expect(relay.head).toBe(1)
    await waitFor(() => pa.status === "synced")
    await pa.detach()
    await pb.detach()
  })

  test("a peer offline while a carries snapshot is published still merges it", async () => {
    const { relay, roomKey, seed } = await room()
    relay.limits = { ...relay.limits, maxEntryBytes: 400 }
    const pa = providerFor(relay, roomKey, "edit")
    const b = new YjsDocStore()
    const pb = providerFor(relay, roomKey, "edit")
    await pa.attach(seed)
    await pb.attach(b)
    ok(seed.apply({ op: "insert", id: "Small00001", node: rect("s") }, { origin: "user" }))
    await waitFor(() => b.hasNode("Small00001") && pb.status === "synced")
    pb.disconnect()
    ok(
      seed.apply(
        { op: "insert", id: "Huge000001", node: rect("x".repeat(2000)) },
        { origin: "user" },
      ),
    )
    await waitFor(() => relay.snapshotPuts.at(-1)?.carries === true)
    pb.connect()
    await waitFor(() => b.hasNode("Huge000001"))
    // A later small update that depends on the huge node applies instead of staying pending.
    ok(seed.apply({ op: "update", id: "Huge000001", set: { x: 7 } }, { origin: "user" }))
    await waitFor(() => b.getNode("Huge000001")?.x === 7)
    await pa.detach()
    await pb.detach()
  })

  test("after a relay data-loss reset, a lower carries generation is still merged", async () => {
    const { relay, roomKey, seed, keys } = await room()
    relay.limits = { ...relay.limits, maxEntryBytes: 400 }
    const pa = providerFor(relay, roomKey, "edit")
    const b = new YjsDocStore()
    const pb = providerFor(relay, roomKey, "edit")
    await pa.attach(seed)
    await pb.attach(b)
    // Push b's generation up.
    for (let i = 0; i < 2; i++) {
      ok(seed.apply({ op: "insert", id: `Small0000${i}`, node: rect("s") }, { origin: "user" }))
      await waitFor(() => relay.head === i + 1 && b.hasNode(`Small0000${i}`))
      relay.putSnapshot(i + 1, false, await sealSnapshot(keys, i + 1, seed.encodeStateAsUpdate()))
    }
    await waitFor(() => pb.status === "synced")
    relay.wipe()
    relay.closeAll(1012)
    await waitFor(
      () =>
        (relay.head >= 1 || relay.latest !== null) &&
        pa.status === "synced" &&
        pb.status === "synced",
    )
    ok(
      seed.apply(
        { op: "insert", id: "Huge000001", node: rect("x".repeat(2000)) },
        { origin: "user" },
      ),
    )
    await waitFor(() => b.hasNode("Huge000001"))
    await pa.detach()
    await pb.detach()
  })

  test("SNAPSHOT_STALE is not an error", async () => {
    const { relay, roomKey, seed, keys } = await room()
    const pa = providerFor(relay, roomKey, "edit")
    const closed: NetworkEvent[] = []
    pa.onEvent((e) => e.type === "closed" && closed.push(e))
    await pa.attach(seed)
    ok(seed.apply({ op: "insert", id: "Node000001", node: rect("n") }, { origin: "user" }))
    await waitFor(() => relay.head === 1 && pa.status === "synced")
    // Someone else wins the race to upTo 1.
    relay.putSnapshot(1, false, await sealSnapshot(keys, 1, seed.encodeStateAsUpdate()))
    const puts = relay.snapshotPuts.length
    const attempts = relay.snapshotAttempts.length
    relay.requestCompaction()
    await waitFor(() => relay.snapshotAttempts.length === attempts + 1)
    await sleep(50)
    expect(relay.snapshotAttempts.at(-1)).toEqual({ upTo: 1, carries: false, status: 409 })
    expect(relay.snapshotPuts.length).toBe(puts)
    expect(closed).toHaveLength(0)
    expect(pa.status).toBe("synced")
    await pa.detach()
  })
})

describe("network provider: repairer election", () => {
  test("the lowest edit peer is the repairer; view peers never are", async () => {
    const { relay, roomKey, seed } = await room()
    const pv = providerFor(relay, roomKey, "view")
    await pv.attach(new YjsDocStore())
    const pa = providerFor(relay, roomKey, "edit")
    const pb = providerFor(relay, roomKey, "edit")
    const events: NetworkEvent[] = []
    pa.onEvent((e) => e.type === "repairer" && events.push(e))
    await pa.attach(seed)
    await pb.attach(new YjsDocStore())
    await waitFor(() => pv.repairer === pa.peer && pb.repairer === pa.peer)
    expect(pa.peer).toBeGreaterThan(pv.peer as number)
    expect(pa.repairer).toBe(pa.peer)
    expect(events.at(-1)).toEqual({ type: "repairer", peer: pa.peer, self: true })
    await pa.detach()
    await waitFor(() => pb.repairer === pb.peer && pv.repairer === pb.peer)
    await pb.detach()
    await waitFor(() => pv.repairer === null)
    await pv.detach()
  })

  test("autoRepair follows the §15.8 table", async () => {
    const { relay, roomKey, seed } = await room()
    const a = new SwitchableStore()
    a.loadDocument(createEmptyDocument("A"))
    const b = new SwitchableStore()
    const pa = providerFor(relay, roomKey, "edit")
    const pb = providerFor(relay, roomKey, "edit")
    await pa.attach(seed)
    await pb.attach(a)
    // pa (with the seed) is the repairer; a's provider is not.
    expect(a.autoRepair).toBe(false)
    await pa.detach()
    await waitFor(() => a.autoRepair === true)
    // Offline: every replica repairs locally.
    relay.refuse = true
    relay.closeAll(1012)
    await waitFor(() => pb.status === "error")
    expect(a.autoRepair).toBe(true)
    relay.refuse = false
    await waitFor(() => pb.connected)
    expect(a.autoRepair).toBe(true)
    // View: never.
    const pv = providerFor(relay, roomKey, "view")
    await pv.attach(b)
    expect(b.autoRepair).toBe(false)
    await pv.detach()
    expect(b.autoRepair).toBe(true)
    await pb.detach()
  })

  test("a concurrent reparent cycle is repaired by exactly one replica", async () => {
    const { relay, roomKey } = await room()
    const a = new SwitchableStore()
    a.loadDocument(createEmptyDocument("A"))
    ok(
      a.apply(
        [
          { op: "insert", id: "Xxxxxxxxx1", node: { type: "frame", name: "X" } },
          { op: "insert", id: "Yyyyyyyyy1", node: { type: "frame", name: "Y" } },
        ],
        { origin: "user" },
      ),
    )
    const b = new SwitchableStore()
    const pa = providerFor(relay, roomKey, "edit")
    const pb = providerFor(relay, roomKey, "edit")
    await pa.attach(a)
    await pb.attach(b)
    await waitFor(() => b.hasNode("Yyyyyyyyy1") && pa.status === "synced")
    pa.disconnect()
    pb.disconnect()
    ok(a.apply({ op: "move", id: "Xxxxxxxxx1", parent: "Yyyyyyyyy1" }, { origin: "user" }))
    ok(b.apply({ op: "move", id: "Yyyyyyyyy1", parent: "Xxxxxxxxx1" }, { origin: "user" }))
    const repairs = (s: YjsDocStore) => s.log().filter((e) => e.kind === "repair").length
    const before = [repairs(a), repairs(b)]
    pa.connect()
    await waitFor(() => pa.connected)
    pb.connect()
    await waitFor(
      () =>
        pb.connected &&
        pa.status === "synced" &&
        pb.status === "synced" &&
        jsonEqual(a.toDocument(), b.toDocument()),
    )
    await sleep(20)
    expect(validate(a.toDocument()).ok).toBe(true)
    expect(jsonEqual(a.toDocument(), b.toDocument())).toBe(true)
    expect(pa.repairer).toBe(pa.peer)
    expect(repairs(a) - (before[0] as number)).toBe(1)
    expect(repairs(b) - (before[1] as number)).toBe(0)
    await pa.detach()
    await pb.detach()
  })
})
