/** Window ↔ document-host sync provider (ADR 0002 §2): convergence, origins, per-origin undo. */
import { describe, expect, test } from "bun:test"
import { createDocStore, createEmptyDocument, type Origin } from "@kimo/editor-state"
import { createTransportPair, HostSyncHub, WindowSyncProvider } from "../src"

const frame = (name: string) => ({ type: "frame", name, x: 0, y: 0, w: 10, h: 10 })

function setup() {
  const host = createDocStore(createEmptyDocument("Doc"))
  host.apply(
    { op: "insert", id: "Frame00001", parent: null, node: frame("Host frame") },
    { origin: "user" },
  )
  const [win, hostSide] = createTransportPair()
  const hub = new HostSyncHub(hostSide)
  hub.register("/a.kimo", host)
  return { host, win, hub }
}

describe("WindowSyncProvider + HostSyncHub", () => {
  test("a replica receives the host state, and edits flow both ways with their origins", async () => {
    const { host, win, hub } = setup()
    const replica = createDocStore()
    const p = new WindowSyncProvider({ transport: win, doc: "/a.kimo" })
    await p.attach(replica)
    expect(replica.getNode("Frame00001")?.name).toBe("Host frame")
    expect(hub.peers("/a.kimo")).toBe(1)

    const seenByWindow: Origin[] = []
    replica.onChange((c) => seenByWindow.push(c.origin))
    const seenByHost: Origin[] = []
    host.onChange((c) => seenByHost.push(c.origin))

    // Agent edit on the host → window, tagged remote:mcp:…
    const r = host.apply(
      { op: "update", id: "Frame00001", set: { name: "Agent" } },
      { origin: "mcp:claude-code.abc123" },
    )
    expect(r.ok).toBe(true)
    expect(replica.getNode("Frame00001")?.name).toBe("Agent")
    expect(seenByWindow).toContain("remote:mcp:claude-code.abc123")

    // User edit in the window → host, tagged remote:user
    replica.apply(
      { op: "insert", id: "Frame00002", parent: null, node: frame("User") },
      { origin: "user" },
    )
    expect(host.getNode("Frame00002")?.name).toBe("User")
    expect(seenByHost).toContain("remote:user")
    expect(replica.toDocument()).toEqual(host.toDocument())
  })

  test("user undo in the window never undoes agent ops; agent undo on the host never undoes user edits", async () => {
    const { host, win } = setup()
    const replica = createDocStore()
    await new WindowSyncProvider({ transport: win, doc: "/a.kimo" }).attach(replica)
    replica.apply({ op: "update", id: "Frame00001", set: { name: "User 1" } }, { origin: "user" })
    host.apply(
      { op: "insert", id: "Agent00001", parent: null, node: frame("Agent") },
      { origin: "mcp:codex.k1" },
    )
    replica.apply({ op: "update", id: "Frame00001", set: { x: 50 } }, { origin: "user" })
    // User undo twice: both user edits revert, the agent's frame stays.
    replica.undo("user")
    replica.undo("user")
    expect(replica.hasNode("Agent00001")).toBe(true)
    expect(host.hasNode("Agent00001")).toBe(true)
    expect(host.getNode("Frame00001")?.name).toBe("Host frame")
    // Agent undo on the host removes only its frame.
    replica.apply({ op: "update", id: "Frame00001", set: { name: "User 2" } }, { origin: "user" })
    const u = host.undo("mcp:codex.k1")
    expect(u.ok).toBe(true)
    expect(replica.hasNode("Agent00001")).toBe(false)
    expect(replica.getNode("Frame00001")?.name).toBe("User 2")
    expect(host.toDocument()).toEqual(replica.toDocument())
  })

  test("two windows converge; edits made before the host answered are not lost; bye/missing", async () => {
    const host = createDocStore(createEmptyDocument())
    const [w, h] = createTransportPair({ async: true })
    const hub = new HostSyncHub(h, (doc) => (doc === "/lazy.kimo" ? host : null))
    const a = createDocStore()
    const b = createDocStore()
    const pa = new WindowSyncProvider({ transport: w, doc: "/lazy.kimo" })
    const attachA = pa.attach(a)
    a.apply(
      { op: "insert", id: "Early00001", parent: null, node: frame("Early") },
      { origin: "user" },
    )
    await attachA
    await new WindowSyncProvider({ transport: w, doc: "/lazy.kimo" }).attach(b)
    await new Promise((r) => setTimeout(r, 5))
    expect(host.hasNode("Early00001")).toBe(true)
    expect(b.hasNode("Early00001")).toBe(true)
    b.apply({ op: "update", id: "Early00001", set: { name: "From B" } }, { origin: "user" })
    await new Promise((r) => setTimeout(r, 5))
    expect(a.getNode("Early00001")?.name).toBe("From B")
    expect(hub.peers("/lazy.kimo")).toBe(2)
    await pa.detach()
    await new Promise((r) => setTimeout(r, 5))
    expect(hub.peers("/lazy.kimo")).toBe(1)
    await expect(
      new WindowSyncProvider({ transport: w, doc: "/nope.kimo" }).attach(createDocStore()),
    ).rejects.toThrow("not open")
    hub.dispose()
  })
})
