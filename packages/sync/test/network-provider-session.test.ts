import { describe, expect, test } from "bun:test"
import { YjsDocStore } from "@kimo/editor-state"
import {
  deriveRoomKeys,
  generateRoomKey,
  MultiplayerError,
  parseRoomId,
  sealSnapshot,
  sealUpdate,
} from "../src/mp"
import type { NetworkEvent, NetworkProviderOptions } from "../src/network"
import { VIEW_ONLY_REASON } from "../src/network-provider"
import { MemoryRoomStateStore } from "../src/room-state"
import { emptyStore, rect } from "./helpers"
import {
  FakeRelay,
  FakeSocket,
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
  return { relay, roomKey, seed }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe("network provider: offline edits", () => {
  test("edits made while disconnected are sent as one delta on reconnect", async () => {
    const { relay, roomKey, seed } = await room()
    const pa = providerFor(relay, roomKey, "edit")
    const b = new YjsDocStore()
    const pb = providerFor(relay, roomKey, "edit")
    await pa.attach(seed)
    await pb.attach(b)
    pa.disconnect()
    expect(pa.connected).toBe(false)
    expect(pa.status).toBe("error")
    for (let i = 0; i < 4; i++)
      ok(seed.apply({ op: "insert", id: `Offline00${i}`, node: rect("o") }, { origin: "user" }))
    await new Promise((r) => setTimeout(r, 30))
    expect(relay.appends()).toHaveLength(0)
    pa.connect()
    await waitFor(() => b.size === 4)
    expect(relay.appends()).toHaveLength(1)
    await pa.detach()
    await pb.detach()
  })

  test("ackedSv survives provider instances: only what is new is pushed", async () => {
    const { relay, roomKey, seed } = await room()
    const state = new MemoryRoomStateStore()
    const p1 = providerFor(relay, roomKey, "edit", { state })
    await p1.attach(seed)
    ok(seed.apply({ op: "insert", id: "Online0001", node: rect("on") }, { origin: "user" }))
    await waitFor(() => p1.status === "synced" && relay.head === 1)
    await p1.detach()
    expect((await state.load(relay.room))?.ackedSv).toBeInstanceOf(Uint8Array)

    // A new session with nothing new pushes nothing.
    const p2 = providerFor(relay, roomKey, "edit", { state })
    await p2.attach(seed)
    await new Promise((r) => setTimeout(r, 20))
    expect(relay.head).toBe(1)
    await p2.detach()

    // An offline edit between sessions is the only thing pushed.
    ok(seed.apply({ op: "insert", id: "Between001", node: rect("b") }, { origin: "user" }))
    const p3 = providerFor(relay, roomKey, "edit", { state })
    await p3.attach(seed)
    await waitFor(() => relay.head === 2 && p3.status === "synced")
    const fresh = new YjsDocStore()
    const pv = providerFor(relay, roomKey, "view")
    await pv.attach(fresh)
    expect(fresh.hasNode("Online0001") && fresh.hasNode("Between001")).toBe(true)
    await p3.detach()
    await pv.detach()
  })

  test("a pristine guest sends nothing on its first join", async () => {
    const { relay, roomKey, seed } = await room()
    ok(seed.apply({ op: "insert", id: "Owner00001", node: rect("o") }, { origin: "user" }))
    const pa = providerFor(relay, roomKey, "edit")
    await pa.attach(seed)
    await waitFor(() => relay.head === 1)
    const guest = new YjsDocStore()
    const pg = providerFor(relay, roomKey, "edit")
    await pg.attach(guest)
    await new Promise((r) => setTimeout(r, 20))
    expect(guest.hasNode("Owner00001")).toBe(true)
    expect(relay.head).toBe(1)
    const guestSocket = relay.peers.find((s) => s.peer === pg.peer)
    expect(guestSocket?.sent.filter((m) => m.type === "append")).toHaveLength(0)
    await pa.detach()
    await pg.detach()
  })
})

describe("network provider: roles", () => {
  test("a view link makes the store read-only and never appends", async () => {
    const { relay, roomKey, seed } = await room()
    const pa = providerFor(relay, roomKey, "edit")
    await pa.attach(seed)
    const v = new YjsDocStore()
    const pv = providerFor(relay, roomKey, "view")
    await pv.attach(v)
    expect(pv.role).toBe("view")
    expect(pv.status).toBe("read-only")
    expect(v.readOnly?.reason).toBe(VIEW_ONLY_REASON)
    expect(
      v.apply({ op: "insert", id: "Nope000001", node: rect("n") }, { origin: "user" }).ok,
    ).toBe(false)
    // Remote changes still arrive.
    ok(seed.apply({ op: "insert", id: "Owner00001", node: rect("o") }, { origin: "user" }))
    await waitFor(() => v.hasNode("Owner00001"))
    const viewSocket = relay.peers.find((s) => s.peer === pv.peer)
    expect(viewSocket?.sent.filter((m) => m.type === "append")).toHaveLength(0)
    await pv.detach()
    expect(v.readOnly).toBeNull()
    await pa.detach()
  })

  test("a denied VIEW_ONLY switches to read-only", async () => {
    const { relay, roomKey, seed } = await room()
    const pa = providerFor(relay, roomKey, "edit")
    const denied: NetworkEvent[] = []
    pa.onEvent((e) => e.type === "denied" && denied.push(e))
    await pa.attach(seed)
    // The relay downgrades the connection (as if the link changed role).
    const socket = relay.peers.find((s) => s.peer === pa.peer)
    if (socket) socket.role = "view"
    ok(seed.apply({ op: "insert", id: "Denied0001", node: rect("d") }, { origin: "user" }))
    await waitFor(() => pa.status === "read-only")
    expect(denied).toEqual([{ type: "denied", code: "VIEW_ONLY", message: "view-only link" }])
    expect(pa.role).toBe("view")
    expect(seed.readOnly?.reason).toBe(VIEW_ONLY_REASON)
    expect(relay.head).toBe(0)
    await pa.detach()
  })
})

describe("network provider: robustness", () => {
  test("HTTP calls present the refreshed token, not the one from hello", async () => {
    const { relay, roomKey, seed } = await room()
    relay.grant("edit2", { role: "edit" })
    const pa = providerFor(relay, roomKey, "edit")
    await pa.attach(seed)
    ok(seed.apply({ op: "insert", id: "Node000001", node: rect("n") }, { origin: "user" }))
    await waitFor(() => relay.head === 1 && pa.status === "synced")
    pa.setToken("edit2")
    await sleep(20)
    relay.grant("edit", { role: "edit", refuse: "TOKEN_EXPIRED" })
    const puts = relay.snapshotPuts.length
    relay.requestCompaction()
    await waitFor(() => relay.snapshotPuts.length === puts + 1)
    await pa.detach()
  })

  test("a view replica is locked again when another owner clears read-only", async () => {
    const { relay, roomKey } = await room()
    const v = new YjsDocStore()
    v.setReadOnly("Opened read-only")
    const pv = providerFor(relay, roomKey, "view")
    await pv.attach(v)
    v.setReadOnly(null)
    v.apply({ op: "insert", id: "Leak000001", node: rect("l") }, { origin: "user" })
    expect(v.readOnly?.reason).toBe(VIEW_ONLY_REASON)
    expect(
      v.apply({ op: "insert", id: "Leak000002", node: rect("l") }, { origin: "user" }).ok,
    ).toBe(false)
    await pv.detach()
  })

  test("an entry that does not open is skipped, not fatal", async () => {
    const { relay, roomKey, seed } = await room()
    const pa = providerFor(relay, roomKey, "edit")
    await pa.attach(seed)
    ok(seed.apply({ op: "insert", id: "Good000001", node: rect("g") }, { origin: "user" }))
    await waitFor(() => relay.head === 1 && pa.status === "synced")
    const junk = { seq: 2, origin: "user" as const, env: new Uint8Array(64).fill(7) }
    relay.log.push(junk)
    relay.head = 2
    for (const s of relay.peers) s.deliver({ type: "entries", entries: [junk] })
    ok(seed.apply({ op: "insert", id: "Good000002", node: rect("g") }, { origin: "user" }))
    await waitFor(() => relay.head === 3 && pa.status === "synced")
    const b = new YjsDocStore()
    const pb = providerFor(relay, roomKey, "edit")
    const corrupt: NetworkEvent[] = []
    pb.onEvent((e) => e.type === "corrupt-entry" && corrupt.push(e))
    await pb.attach(b)
    expect(pb.status).toBe("synced")
    expect(b.hasNode("Good000001") && b.hasNode("Good000002")).toBe(true)
    expect(corrupt).toEqual([{ type: "corrupt-entry", seq: 2 }])
    await pa.detach()
    await pb.detach()
  })
})

describe("network provider: attach and detach", () => {
  test("attach resolves while the relay is unreachable and connects later", async () => {
    const { relay, roomKey, seed } = await room()
    relay.refuse = true
    const pa = providerFor(relay, roomKey, "edit")
    const closed: NetworkEvent[] = []
    pa.onEvent((e) => e.type === "closed" && closed.push(e))
    await pa.attach(seed)
    expect(pa.connected).toBe(false)
    expect(pa.status).toBe("error")
    expect(closed[0]).toMatchObject({ willRetry: true })
    ok(seed.apply({ op: "insert", id: "Offline001", node: rect("o") }, { origin: "user" }))
    relay.refuse = false
    await waitFor(() => pa.connected && relay.head === 1)
    await pa.detach()
  })

  test("attach rejects on a fatal error before the first catch-up", async () => {
    const { relay, roomKey } = await room()
    const pa = providerFor(relay, roomKey, "forged")
    const error = await pa.attach(new YjsDocStore()).catch((e) => e)
    expect(error).toBeInstanceOf(MultiplayerError)
    expect((error as MultiplayerError).code).toBe("AUTH_INVALID")
    expect(pa.status).toBe("error")
    await new Promise((r) => setTimeout(r, 50))
    expect(relay.allSockets).toHaveLength(1)
    await pa.detach()
    expect(pa.status).toBe("detached")
  })

  test("detach restores autoRepair and read-only, and withdraws presence", async () => {
    const { relay, roomKey, seed } = await room()
    const pa = providerFor(relay, roomKey, "edit")
    await pa.attach(seed)
    const v = new SwitchableStore()
    expect(v.autoRepair).toBe(true)
    const pv = providerFor(relay, roomKey, "view")
    await pv.attach(v)
    expect(v.autoRepair).toBe(false)
    expect(v.readOnly?.reason).toBe(VIEW_ONLY_REASON)
    pv.awareness.setLocalState({ user: { id: "v", name: "Viewer", color: "#00f" } })
    const viewer = pv.peer as number
    await waitFor(() => pa.awareness.getStates().has(viewer))
    await pv.detach()
    expect(v.autoRepair).toBe(true)
    expect(v.readOnly).toBeNull()
    expect(pv.status).toBe("detached")
    await waitFor(() => !pa.awareness.getStates().has(viewer))
    await pa.detach()
  })

  test("a read-only state the provider did not set is left alone", async () => {
    const { relay, roomKey } = await room()
    const v = new YjsDocStore()
    v.setReadOnly("newer format")
    const pv = providerFor(relay, roomKey, "view")
    await pv.attach(v)
    await pv.detach()
    expect(v.readOnly?.reason).toBe("newer format")
  })
})

describe("network provider: review fixes", () => {
  test("a refused append (QUOTA_EXCEEDED) leaves pending, errors, keeps compaction, and resends", async () => {
    const { relay, roomKey, seed } = await room()
    const pa = providerFor(relay, roomKey, "edit")
    const denied: NetworkEvent[] = []
    pa.onEvent((e) => e.type === "denied" && denied.push(e))
    await pa.attach(seed)
    ok(seed.apply({ op: "insert", id: "Acked00001", node: rect("a") }, { origin: "user" }))
    await waitFor(() => relay.head === 1 && pa.status === "synced")
    relay.denyAppends = "QUOTA_EXCEEDED"
    ok(seed.apply({ op: "insert", id: "Refused001", node: rect("r") }, { origin: "user" }))
    await waitFor(() => pa.status === "error")
    expect(denied).toHaveLength(1)
    expect(relay.head).toBe(1)
    // Not stuck: the client is still clean enough to compact, which is what shrinks the log.
    const puts = relay.snapshotPuts.length
    relay.requestCompaction()
    await waitFor(() => relay.snapshotPuts.length === puts + 1)
    // The refused content was not marked acknowledged: the next reconnect delta resends it.
    relay.denyAppends = null
    relay.closeAll(1012)
    await waitFor(() => relay.head === 2 && pa.status === "synced")
    await pa.detach()
  })

  test("oversize that keeps losing the snapshot race resyncs instead of going fatal", async () => {
    const { relay, roomKey, seed } = await room()
    relay.limits = { ...relay.limits, maxEntryBytes: 400 }
    const pa = providerFor(relay, roomKey, "edit")
    const closed: NetworkEvent[] = []
    pa.onEvent((e) => e.type === "closed" && closed.push(e))
    await pa.attach(seed)
    relay.staleSnapshots = 3
    ok(
      seed.apply(
        { op: "insert", id: "Huge000001", node: rect("x".repeat(2000)) },
        { origin: "user" },
      ),
    )
    await waitFor(() => relay.snapshotPuts.at(-1)?.carries === true, 8_000)
    expect(closed.length).toBeGreaterThan(0)
    for (const e of closed) expect(e.type === "closed" && e.willRetry).toBe(true)
    await waitFor(() => pa.status === "synced")
    await pa.detach()
  }, 12_000)

  test("a token set while the connection is handshaking is refreshed after welcome", async () => {
    const { relay, roomKey, seed } = await room()
    relay.grant("edit2", { role: "edit" })
    let hook: (() => void) | null = null
    const Hooked = class extends FakeSocket {
      constructor(url: string, protocols?: string | string[]) {
        super(relay, url, protocols)
      }
      override send(data: Uint8Array | ArrayBuffer): void {
        super.send(data)
        const h = hook
        hook = null
        h?.()
      }
    } as unknown as NonNullable<NetworkProviderOptions["WebSocket"]>
    const pa = providerFor(relay, roomKey, "edit", { WebSocket: Hooked })
    hook = () => pa.setToken("edit2") // After hello went out with "edit", before welcome.
    await pa.attach(seed)
    await waitFor(() => relay.peers.some((s) => s.token === "edit2"))
    await pa.detach()
  })

  test("a snapshot that does not open is not fatal once the key is proven", async () => {
    const { relay, roomKey, seed } = await room()
    const pa = providerFor(relay, roomKey, "edit")
    const events: NetworkEvent[] = []
    pa.onEvent((e) => (e.type === "corrupt-snapshot" || e.type === "closed") && events.push(e))
    await pa.attach(seed)
    ok(seed.apply({ op: "insert", id: "Node000001", node: rect("n") }, { origin: "user" }))
    await waitFor(() => relay.head === 1 && pa.status === "synced")
    relay.putSnapshot(1, true, new Uint8Array(64).fill(9))
    await waitFor(() => events.some((e) => e.type === "corrupt-snapshot"))
    // The replica supersedes the bad generation with its own state.
    await waitFor(() => relay.snapshotPuts.length === 3)
    expect(relay.snapshotPuts.at(-1)).toEqual({ upTo: 1, carries: true })
    expect(events.filter((e) => e.type === "closed")).toHaveLength(0)
    relay.prune()
    const b = new YjsDocStore()
    const pb = providerFor(relay, roomKey, "view")
    await pb.attach(b)
    expect(b.hasNode("Node000001")).toBe(true)
    await pa.detach()
    await pb.detach()
  })

  test("an ack does not prove the key: a foreign entry that does not open stays fatal", async () => {
    const { room: roomId, roomKey } = makeRoom()
    const relay = new FakeRelay(roomId)
    relay.grant("edit", { role: "edit" })
    const wrong = emptyStore()
    const pa = providerFor(relay, generateRoomKey(), "edit")
    const corrupt: NetworkEvent[] = []
    pa.onEvent((e) => e.type === "corrupt-entry" && corrupt.push(e))
    await pa.attach(wrong)
    ok(wrong.apply({ op: "insert", id: "Node000001", node: rect("n") }, { origin: "user" }))
    await waitFor(() => relay.head === 1 && pa.status === "synced")
    // Someone holding the real key appends.
    const keys = await deriveRoomKeys(roomKey, parseRoomId(roomId))
    const theirs = emptyStore()
    ok(theirs.apply({ op: "insert", id: "Other00001", node: rect("o") }, { origin: "user" }))
    const env = await sealUpdate(keys, theirs.encodeStateAsUpdate())
    const entry = { seq: 2, origin: "user" as const, env }
    relay.log.push(entry)
    relay.head = 2
    for (const s of relay.peers) s.deliver({ type: "entries", entries: [entry] })
    await waitFor(() => pa.status === "error")
    expect(corrupt).toHaveLength(0)
    await pa.detach()
  })
})
