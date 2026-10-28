import { describe, expect, test } from "bun:test"
import { YjsDocStore } from "@kimo/editor-state"
import type { NetworkEvent, PresenceState } from "../src/network"
import { providerFor, seededRoom, waitFor } from "./fake-relay"
import { sleep } from "./helpers"

const ana = { user: { id: "u1", name: "Ana", color: "#3366ff" } }

describe("network provider: presence", () => {
  test("presence round trips sealed; the relay-stamped origin wins", async () => {
    const { relay, roomKey, seed } = await seededRoom()
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
      text: { node: "Node000001", anchor: "rAQID", focus: "o3" },
    } as Omit<PresenceState, "origin">)
    const peer = pa.peer as number
    await waitFor(() => pb.awareness.getStates().has(peer))
    expect(pb.awareness.getStates().get(peer)).toEqual({
      ...ana,
      origin: "agent:bot",
      cursor: { x: 1, y: 2 },
      selection: ["Node000001"],
      page: "Page000001",
      text: { node: "Node000001", anchor: "rAQID", focus: "o3" },
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
    const { relay, roomKey, seed } = await seededRoom()
    relay.limits = { ...relay.limits, awarenessHz: 20 }
    const pa = providerFor(relay, roomKey, "edit")
    const pb = providerFor(relay, roomKey, "edit")
    await pa.attach(seed)
    await pb.attach(new YjsDocStore())
    for (let i = 0; i < 20; i++) pa.awareness.setLocalState({ ...ana, cursor: { x: i, y: 0 } })
    const socket = relay.peers.find((s) => s.peer === pa.peer)
    const count = () => socket?.sent.filter((m) => m.type === "awareness").length ?? 0
    await sleep(15)
    expect(count()).toBe(1)
    await waitFor(() => count() === 2)
    await sleep(60)
    expect(count()).toBe(2)
    await waitFor(() => pb.awareness.getStates().get(pa.peer as number)?.cursor?.x === 19)
    await pa.detach()
    await pb.detach()
  })

  test("states go on peer-left and on close, and come back after a reconnect", async () => {
    const { relay, roomKey, seed } = await seededRoom()
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
    const { relay, roomKey, seed } = await seededRoom()
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
