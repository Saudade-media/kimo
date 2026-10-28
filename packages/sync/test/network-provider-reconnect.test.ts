import { describe, expect, test } from "bun:test"
import { YjsDocStore } from "@kimo/editor-state"
import type { NetworkEnvironment, NetworkEvent } from "../src/network"
import { FAST, ok, providerFor, seededRoom, waitFor } from "./fake-relay"
import { rect, sleep } from "./helpers"

describe("network provider: reconnect", () => {
  test("back-off grows with full jitter within its bounds", async () => {
    const { relay, roomKey, seed } = await seededRoom()
    relay.refuse = true
    const pa = providerFor(relay, roomKey, "edit", { backoff: [4, 16], random: () => 1 })
    const delays: number[] = []
    pa.onEvent((e) => e.type === "closed" && e.retryInMs !== undefined && delays.push(e.retryInMs))
    await pa.attach(seed)
    await waitFor(() => delays.length >= 5)
    expect(delays.slice(0, 5)).toEqual([4, 8, 16, 16, 16])
    relay.refuse = false
    await waitFor(() => pa.connected)
    await pa.detach()

    const half = providerFor(relay, roomKey, "edit", { backoff: [20, 200], random: () => 0.5 })
    const halfDelays: number[] = []
    half.onEvent(
      (e) => e.type === "closed" && e.retryInMs !== undefined && halfDelays.push(e.retryInMs),
    )
    await half.attach(new YjsDocStore())
    relay.refuse = true
    relay.closeAll(1012)
    await waitFor(() => halfDelays.length === 1)
    expect(halfDelays[0]).toBe(10)
    await half.detach()
  })

  test("fatal codes stop retries", async () => {
    const { relay, roomKey, seed } = await seededRoom()
    relay.grant("revoked", { role: "edit", refuse: "TOKEN_REVOKED" })
    const pa = providerFor(relay, roomKey, "revoked")
    const closed: NetworkEvent[] = []
    pa.onEvent((e) => e.type === "closed" && closed.push(e))
    await expect(pa.attach(seed)).rejects.toMatchObject({ code: "TOKEN_REVOKED" })
    await sleep(30)
    expect(relay.allSockets).toHaveLength(1)
    expect(closed).toHaveLength(1)
    expect(closed[0]).toMatchObject({ willRetry: false })
    // Closed by the relay mid-session: same.
    const pb = providerFor(relay, roomKey, "edit")
    await pb.attach(new YjsDocStore())
    relay.closeAll(4410, "ROOM_CLOSED")
    await waitFor(() => pb.status === "error")
    await sleep(30)
    expect(pb.connected).toBe(false)
    expect(relay.live.size).toBe(0)
    await pa.detach()
    await pb.detach()
  })

  test("setToken after TOKEN_EXPIRED reconnects; while open it refreshes", async () => {
    const { relay, roomKey, seed } = await seededRoom()
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
    const { relay, roomKey, seed } = await seededRoom()
    const pa = providerFor(relay, roomKey, "edit", {
      timing: { ...FAST, pingIntervalMs: 20, idleTimeoutMs: 100 },
    })
    const closed: NetworkEvent[] = []
    pa.onEvent((e) => e.type === "closed" && closed.push(e))
    await pa.attach(seed)
    await sleep(60)
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
    const { relay, roomKey, seed } = await seededRoom()
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
    await sleep(30)
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
