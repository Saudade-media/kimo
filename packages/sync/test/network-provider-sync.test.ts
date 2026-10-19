import { describe, expect, test } from "bun:test"
import { jsonEqual } from "@kimo/core-schema"
import { YjsDocStore } from "@kimo/editor-state"
import pkg from "../package.json"
import { deriveRoomKeys, parseRoomId, sealSnapshot } from "../src/mp"
import type { NetworkEvent } from "../src/network"
import { CLIENT_VERSION } from "../src/network-provider"
import { emptyStore, rect } from "./helpers"
import { FakeRelay, makeRoom, providerFor, waitFor } from "./network-provider-fake-relay"

const ok = <T extends { ok: boolean }>(r: T) => {
  if (!r.ok) throw new Error(JSON.stringify(r))
  return r
}

/** A relay with an edit and a view token, seeded with `seed`'s state as the genesis snapshot. */
async function room(seed = emptyStore()) {
  const { room, roomKey } = makeRoom()
  const relay = new FakeRelay(room)
  relay.grant("edit", { role: "edit" })
  relay.grant("edit-agent", { role: "edit", origin: "agent:bot" })
  relay.grant("view", { role: "view" })
  const keys = await deriveRoomKeys(roomKey, parseRoomId(room))
  relay.putSnapshot(0, false, await sealSnapshot(keys, 0, seed.encodeStateAsUpdate()))
  return { relay, roomKey, seed }
}

const same = (a: YjsDocStore, b: YjsDocStore) => jsonEqual(a.toDocument(), b.toDocument())

describe("network provider: sync", () => {
  test("two stores converge (insert, update, delete, concurrent edits) without echo", async () => {
    const { relay, roomKey, seed } = await room()
    const a = seed
    const b = new YjsDocStore()
    const pa = providerFor(relay, roomKey, "edit")
    const pb = providerFor(relay, roomKey, "edit")
    await pa.attach(a)
    await pb.attach(b)
    expect(pa.status).toBe("synced")
    expect(same(a, b)).toBe(true)

    ok(
      a.apply(
        { op: "insert", id: "Frame00001", node: { type: "frame", name: "F" } },
        { origin: "user" },
      ),
    )
    await waitFor(() => b.hasNode("Frame00001"))
    ok(
      b.apply(
        { op: "insert", id: "Child00001", node: rect("c"), parent: "Frame00001" },
        { origin: "agent:b" },
      ),
    )
    await waitFor(() => a.hasNode("Child00001"))
    // Concurrent edits on both sides.
    ok(a.apply({ op: "update", id: "Frame00001", set: { name: "A" } }, { origin: "user" }))
    ok(b.apply({ op: "update", id: "Child00001", set: { x: 4 } }, { origin: "user" }))
    await waitFor(() => same(a, b) && a.getNode("Child00001")?.x === 4)
    ok(b.apply({ op: "delete", id: "Child00001" }, { origin: "user" }))
    await waitFor(() => !a.hasNode("Child00001"))
    await waitFor(() => pa.status === "synced" && pb.status === "synced")
    expect(same(a, b)).toBe(true)

    // No echo: every append is a local change (4 by a: insert, update; 3 by b), never a re-send.
    const appends = relay.appends().length
    expect(appends).toBe(relay.head)
    expect(appends).toBe(5)
    await pa.detach()
    await pb.detach()
  })

  test("three peers converge; the relay only stores ciphertext", async () => {
    const { relay, roomKey, seed } = await room()
    const stores = [seed, new YjsDocStore(), new YjsDocStore()]
    const providers = stores.map(() => providerFor(relay, roomKey, "edit"))
    for (let i = 0; i < 3; i++) await providers[i]?.attach(stores[i] as YjsDocStore)
    for (const [i, s] of stores.entries())
      ok(
        s.apply(
          { op: "insert", id: `Secret000${i}`, node: rect(`TOPSECRET-${i}`) },
          { origin: "user" },
        ),
      )
    await waitFor(() => stores.every((s) => s.size === 3))
    expect(same(stores[0] as YjsDocStore, stores[2] as YjsDocStore)).toBe(true)
    const text = new TextDecoder()
    for (const entry of relay.log) expect(text.decode(entry.env)).not.toContain("TOPSECRET")
    for (const p of providers) await p.detach()
  })

  test("hello carries the protocol version and kimo/<package version>", async () => {
    expect(CLIENT_VERSION).toBe(pkg.version)
    const { relay, roomKey, seed } = await room()
    const pa = providerFor(relay, roomKey, "edit")
    await pa.attach(seed)
    expect(relay.allSockets[0]?.sent[0]).toMatchObject({
      type: "hello",
      proto: 1,
      token: "edit",
      since: 0,
      client: `kimo/${pkg.version}`,
    })
    expect(relay.allSockets[0]?.url).toBe(`wss://relay.test/sync/${relay.room}`)
    await pa.detach()
  })

  test("the relay-stamped origin is reported for peers", async () => {
    const { relay, roomKey, seed } = await room()
    const pa = providerFor(relay, roomKey, "edit")
    const pb = providerFor(relay, roomKey, "edit-agent")
    await pa.attach(seed)
    await pb.attach(new YjsDocStore())
    await waitFor(() => pa.peers.size === 1)
    expect([...pa.peers.values()][0]?.origin).toBe("agent:bot")
    expect(pa.connected && pb.connected).toBe(true)
    await pa.detach()
    await pb.detach()
  })
})

describe("network provider: catch-up", () => {
  test("a late joiner catches up from the snapshot plus the tail", async () => {
    const { relay, roomKey, seed } = await room()
    const pa = providerFor(relay, roomKey, "edit")
    await pa.attach(seed)
    for (let i = 0; i < 5; i++)
      ok(seed.apply({ op: "insert", id: `Early0000${i}`, node: rect("e") }, { origin: "user" }))
    await waitFor(() => relay.head === 5 && pa.status === "synced")
    // A compaction covers the first entries; the rest is tail.
    relay.requestCompaction()
    await waitFor(() => relay.latest?.upTo === 5)
    ok(seed.apply({ op: "insert", id: "Late000001", node: rect("late") }, { origin: "user" }))
    await waitFor(() => relay.head === 6)
    relay.prune()

    const events: NetworkEvent[] = []
    const b = new YjsDocStore()
    const pb = providerFor(relay, roomKey, "view")
    pb.onEvent((e) => events.push(e))
    await pb.attach(b)
    expect(same(seed, b)).toBe(true)
    expect(events.find((e) => e.type === "snapshot-applied")).toMatchObject({ upTo: 5 })
    expect(events.find((e) => e.type === "caught-up")).toEqual({ type: "caught-up", since: 6 })
    await pa.detach()
    await pb.detach()
  })

  test("entries that arrive before the snapshot is applied wait for it", async () => {
    const { relay, roomKey, seed } = await room()
    ok(seed.apply({ op: "insert", id: "Seeded0001", node: rect("s") }, { origin: "user" }))
    const pa = providerFor(relay, roomKey, "edit")
    await pa.attach(seed)
    await waitFor(() => relay.head === 1 && pa.status === "synced")

    let release = () => {}
    relay.snapshotGate = new Promise<void>((r) => {
      release = r
    })
    const b = new YjsDocStore()
    const pb = providerFor(relay, roomKey, "edit")
    const attached = pb.attach(b)
    await waitFor(() => relay.peers.length === 2)
    // Live entries reach b while its snapshot download is held.
    ok(seed.apply({ op: "insert", id: "During0001", node: rect("d") }, { origin: "user" }))
    await waitFor(() => relay.head === 2)
    await new Promise((r) => setTimeout(r, 20))
    expect(b.hasNode("During0001")).toBe(false)
    release()
    await attached
    await waitFor(() => b.hasNode("During0001"))
    expect(same(seed, b)).toBe(true)
    await pa.detach()
    await pb.detach()
  })

  test("a drop within retention resumes from since without a snapshot download", async () => {
    const { relay, roomKey, seed } = await room()
    const pa = providerFor(relay, roomKey, "edit")
    const b = new YjsDocStore()
    const pb = providerFor(relay, roomKey, "edit")
    await pa.attach(seed)
    await pb.attach(b)
    ok(seed.apply({ op: "insert", id: "Online0001", node: rect("o") }, { origin: "user" }))
    await waitFor(() => b.hasNode("Online0001"))
    const gets = relay.snapshotGets
    relay.closeAll(1012)
    ok(seed.apply({ op: "insert", id: "Offline001", node: rect("o") }, { origin: "user" }))
    await waitFor(() => pa.connected && pb.connected && b.hasNode("Offline001"))
    expect(relay.snapshotGets).toBe(gets)
    // The resumed hello carried since (the relay sent only the tail).
    const hellos = relay.allSockets.flatMap((s) => s.sent.filter((m) => m.type === "hello"))
    expect(hellos.some((m) => m.type === "hello" && m.since > 0)).toBe(true)
    await pa.detach()
    await pb.detach()
  })

  test("a gap in the log closes the connection and the provider recovers", async () => {
    const { relay, roomKey, seed } = await room()
    const pa = providerFor(relay, roomKey, "edit")
    const b = new YjsDocStore()
    const pb = providerFor(relay, roomKey, "edit")
    await pa.attach(seed)
    await pb.attach(b)
    ok(seed.apply({ op: "insert", id: "Real000001", node: rect("r") }, { origin: "user" }))
    await waitFor(() => b.hasNode("Real000001"))
    const closed: NetworkEvent[] = []
    pb.onEvent((e) => e.type === "closed" && closed.push(e))
    // A forged frame that skips seq numbers.
    const socket = relay.peers.find((s) => s.peer === pb.peer)
    socket?.deliver({
      type: "entries",
      entries: [{ seq: 99, origin: "user", env: new Uint8Array(40) }],
    })
    await waitFor(() => closed.length === 1)
    expect(closed[0]).toMatchObject({ willRetry: true })
    ok(seed.apply({ op: "insert", id: "After00001", node: rect("a") }, { origin: "user" }))
    await waitFor(() => pb.connected && b.hasNode("After00001"))
    await pa.detach()
    await pb.detach()
  })

  test("a relay that lost data (head < since) gets a full push", async () => {
    const { relay, roomKey, seed } = await room()
    const pa = providerFor(relay, roomKey, "edit")
    await pa.attach(seed)
    ok(seed.apply({ op: "insert", id: "Kept000001", node: rect("k") }, { origin: "user" }))
    ok(seed.apply({ op: "insert", id: "Kept000002", node: rect("k") }, { origin: "user" }))
    await waitFor(() => relay.head === 2 && pa.status === "synced")
    relay.wipe()
    relay.closeAll(1012)
    await waitFor(() => relay.head === 1 && pa.status === "synced")
    // A fresh joiner gets everything from the full push.
    const b = new YjsDocStore()
    const pb = providerFor(relay, roomKey, "view")
    await pb.attach(b)
    expect(b.hasNode("Kept000001") && b.hasNode("Kept000002")).toBe(true)
    await pa.detach()
    await pb.detach()
  })
})
