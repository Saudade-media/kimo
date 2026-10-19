import { describe, expect, test } from "bun:test"
import { YjsDocStore } from "@kimo/editor-state"
import { deriveRoomKeys, parseRoomId, sealSnapshot } from "../src/mp"
import type { NetworkEnvironment, NetworkEvent, PresenceState } from "../src/network"
import { emptyStore, rect } from "./helpers"
import { FakeRelay, makeRoom, providerFor, waitFor } from "./network-provider-fake-relay"

const ok = <T extends { ok: boolean }>(r: T) => {
  if (!r.ok) throw new Error(JSON.stringify(r))
  return r
}

async function room(seed: YjsDocStore = emptyStore()) {
  const { room, roomKey } = makeRoom()
  const relay = new FakeRelay(room)
  relay.grant("edit", { role: "edit" })
  relay.grant("agent", { role: "edit", origin: "agent:bot" })
  relay.grant("view", { role: "view" })
  const keys = await deriveRoomKeys(roomKey, parseRoomId(room))
  relay.putSnapshot(0, false, await sealSnapshot(keys, 0, seed.encodeStateAsUpdate()))
  return { relay, roomKey, seed }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const ana = { user: { id: "u1", name: "Ana", color: "#3366ff" } }

describe("network provider: presence", () => {
  test("presence round trips sealed; the relay-stamped origin wins", async () => {
    const { relay, roomKey, seed } = await room()
    const pa = providerFor(relay, roomKey, "agent")
    const pb = providerFor(relay, roomKey, "view")
    await pa.attach(seed)
    await pb.attach(new YjsDocStore())
    // The payload claims `user`; the relay says the token is `agent:bot`.
    pa.awareness.setLocalState({
      ...ana,
      origin: "user",
      cursor: { x: 1, y: 2 },
      selection: ["Node000001"],
      page: "Page000001",
    } as Omit<PresenceState, "origin">)
    const peer = pa.peer as number
    await waitFor(() => pb.awareness.getStates().has(peer))
    expect(pb.awareness.getStates().get(peer)).toEqual({
      ...ana,
      origin: "agent:bot",
      cursor: { x: 1, y: 2 },
      selection: ["Node000001"],
      page: "Page000001",
    })
    expect(pa.awareness.getLocalState()?.origin).toBe("agent:bot")
    const frames = relay.allSockets.flatMap((s) => s.sent.filter((m) => m.type === "awareness"))
    const text = new TextDecoder()
    for (const f of frames)
      if (f.type === "awareness") expect(text.decode(f.env)).not.toContain("Ana")
    await pa.detach()
    await pb.detach()
  })

  test("sends are throttled to awarenessHz with a trailing send of the latest state", async () => {
    const { relay, roomKey, seed } = await room()
    relay.limits = { ...relay.limits, awarenessHz: 10 }
    const pa = providerFor(relay, roomKey, "edit")
    const pb = providerFor(relay, roomKey, "edit")
    await pa.attach(seed)
    await pb.attach(new YjsDocStore())
    for (let i = 0; i < 20; i++) pa.awareness.setLocalState({ ...ana, cursor: { x: i, y: 0 } })
    const socket = relay.peers.find((s) => s.peer === pa.peer)
    const count = () => socket?.sent.filter((m) => m.type === "awareness").length ?? 0
    await sleep(40)
    expect(count()).toBe(1)
    await waitFor(() => count() === 2)
    await sleep(150)
    expect(count()).toBe(2)
    await waitFor(() => pb.awareness.getStates().get(pa.peer as number)?.cursor?.x === 19)
    await pa.detach()
    await pb.detach()
  })

  test("states go on peer-left and on close, and come back after a reconnect", async () => {
    const { relay, roomKey, seed } = await room()
    const pa = providerFor(relay, roomKey, "edit")
    const pb = providerFor(relay, roomKey, "edit")
    const pc = providerFor(relay, roomKey, "edit")
    await pa.attach(seed)
    await pb.attach(new YjsDocStore())
    await pc.attach(new YjsDocStore())
    pa.awareness.setLocalState(ana)
    pc.awareness.setLocalState({ user: { id: "u3", name: "Cy", color: "#000" } })
    await waitFor(() => pb.awareness.getStates().size === 2)
    const removed: number[] = []
    pb.awareness.onChange((c) => removed.push(...c.removed))
    const cPeer = pc.peer as number
    await pc.detach()
    await waitFor(() => removed.includes(cPeer))
    expect(pb.awareness.getStates().size).toBe(1)

    pb.awareness.setLocalState({ user: { id: "u2", name: "Bo", color: "#111" } })
    relay.closeAll(1012)
    await waitFor(() => !pb.connected)
    // Remote states are gone; the local one is kept.
    expect([...pb.awareness.getStates().values()].map((s) => s.user.name)).toEqual(["Bo"])
    await waitFor(() => pa.connected && pb.connected)
    await waitFor(
      () =>
        pb.awareness.getStates().get(pa.peer as number)?.user.name === "Ana" &&
        pa.awareness.getStates().get(pb.peer as number)?.user.name === "Bo",
    )
    expect(pb.awareness.clientId).toBe(pb.peer as number)
    await pa.detach()
    await pb.detach()
  })

  test("a late joiner gets cached presence; a bad envelope is dropped without closing", async () => {
    const { relay, roomKey, seed } = await room()
    const pa = providerFor(relay, roomKey, "edit")
    await pa.attach(seed)
    pa.awareness.setLocalState(ana)
    await waitFor(() => relay.allSockets.some((s) => s.sent.some((m) => m.type === "awareness")))
    const pb = providerFor(relay, roomKey, "view")
    const closed: NetworkEvent[] = []
    pb.onEvent((e) => e.type === "closed" && closed.push(e))
    await pb.attach(new YjsDocStore())
    await waitFor(() => pb.awareness.getStates().has(pa.peer as number))
    const socket = relay.peers.find((s) => s.peer === pb.peer)
    socket?.deliver({
      type: "awareness",
      peer: pa.peer as number,
      clock: 99,
      env: new Uint8Array(64),
    })
    await sleep(20)
    expect(closed).toHaveLength(0)
    expect(pb.awareness.getStates().get(pa.peer as number)?.user.name).toBe("Ana")
    expect(pb.connected).toBe(true)
    await pa.detach()
    await pb.detach()
  })
})

describe("network provider: reconnect", () => {
  test("back-off grows with full jitter within its bounds", async () => {
    const { relay, roomKey, seed } = await room()
    relay.refuse = true
    const pa = providerFor(relay, roomKey, "edit", { backoff: [10, 40], random: () => 1 })
    const delays: number[] = []
    pa.onEvent((e) => e.type === "closed" && e.retryInMs !== undefined && delays.push(e.retryInMs))
    await pa.attach(seed)
    await waitFor(() => delays.length >= 5)
    expect(delays.slice(0, 5)).toEqual([10, 20, 40, 40, 40])
    relay.refuse = false
    await waitFor(() => pa.connected)
    await pa.detach()

    const half = providerFor(relay, roomKey, "edit", { backoff: [100, 1000], random: () => 0.5 })
    const halfDelays: number[] = []
    half.onEvent(
      (e) => e.type === "closed" && e.retryInMs !== undefined && halfDelays.push(e.retryInMs),
    )
    await half.attach(new YjsDocStore())
    relay.refuse = true
    relay.closeAll(1012)
    await waitFor(() => halfDelays.length === 1)
    expect(halfDelays[0]).toBe(50)
    await half.detach()
  })

  test("fatal codes stop retries", async () => {
    const { relay, roomKey, seed } = await room()
    relay.grant("revoked", { role: "edit", refuse: "TOKEN_REVOKED" })
    const pa = providerFor(relay, roomKey, "revoked")
    const closed: NetworkEvent[] = []
    pa.onEvent((e) => e.type === "closed" && closed.push(e))
    await expect(pa.attach(seed)).rejects.toMatchObject({ code: "TOKEN_REVOKED" })
    await sleep(80)
    expect(relay.allSockets).toHaveLength(1)
    expect(closed).toHaveLength(1)
    expect(closed[0]).toMatchObject({ willRetry: false })
    // Closed by the relay mid-session: same.
    const pb = providerFor(relay, roomKey, "edit")
    await pb.attach(new YjsDocStore())
    relay.closeAll(4410, "ROOM_CLOSED")
    await waitFor(() => pb.status === "error")
    await sleep(80)
    expect(pb.connected).toBe(false)
    expect(relay.live.size).toBe(0)
    await pa.detach()
    await pb.detach()
  })

  test("setToken after TOKEN_EXPIRED reconnects; while open it refreshes", async () => {
    const { relay, roomKey, seed } = await room()
    relay.grant("old", { role: "edit", refuse: "TOKEN_EXPIRED" })
    relay.grant("new", { role: "edit", exp: 2_000_000_000 })
    relay.grant("newer", { role: "edit", exp: 2_100_000_000 })
    const pa = providerFor(relay, roomKey, "old")
    await expect(pa.attach(seed)).rejects.toMatchObject({ code: "TOKEN_EXPIRED" })
    pa.setToken("new")
    await waitFor(() => pa.connected)
    expect(pa.exp).toBe(2_000_000_000)
    pa.setToken("newer")
    await waitFor(() => pa.exp === 2_100_000_000)
    expect(relay.peers[0]?.token).toBe("newer")
    await pa.detach()
  })

  test("a silent relay is detected by the liveness check and the provider reconnects", async () => {
    const { relay, roomKey, seed } = await room()
    const pa = providerFor(relay, roomKey, "edit")
    const closed: NetworkEvent[] = []
    pa.onEvent((e) => e.type === "closed" && closed.push(e))
    await pa.attach(seed)
    await sleep(120)
    const socket = relay.peers[0]
    expect(socket?.sent.some((m) => m.type === "ping")).toBe(true)
    expect(closed).toHaveLength(0) // pongs keep it alive
    relay.mute = true
    await waitFor(() => closed.length === 1, 1_000)
    expect(closed[0]).toMatchObject({ willRetry: true })
    expect((closed[0] as { error: { code: string } }).error.code).toBe("RELAY_UNREACHABLE")
    relay.mute = false
    ok(seed.apply({ op: "insert", id: "Later00001", node: rect("l") }, { origin: "user" }))
    await waitFor(() => pa.connected && relay.head === 1)
    await pa.detach()
  })

  test("an offline environment holds attempts until it reports online", async () => {
    const { relay, roomKey, seed } = await room()
    let online = false
    const listeners = new Set<() => void>()
    const environment: NetworkEnvironment = {
      online: () => online,
      onOnline: (l) => {
        listeners.add(l)
        return () => listeners.delete(l)
      },
    }
    const pa = providerFor(relay, roomKey, "edit", { environment })
    await pa.attach(seed)
    await sleep(60)
    expect(relay.allSockets).toHaveLength(0)
    expect(pa.status).toBe("error")
    online = true
    for (const l of listeners) l()
    await waitFor(() => pa.connected)
    expect(relay.allSockets).toHaveLength(1)
    await pa.detach()
    expect(listeners.size).toBe(0)
  })
})
