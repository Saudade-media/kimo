import { describe, expect, test } from "bun:test"
import { jsonEqual, validate } from "@kimo/core-schema"
import type { SyncStatusEvent } from "../src/index"
import { MemoryHub, MemoryProvider } from "../src/index"
import { emptyStore, rect } from "./helpers"

const ok = <T extends { ok: boolean }>(r: T) => {
  if (!r.ok) throw new Error(JSON.stringify(r))
  return r
}

async function replicas(n: number) {
  const hub = new MemoryHub()
  const stores = Array.from({ length: n }, () => emptyStore())
  const providers = stores.map((_, i) => new MemoryProvider(hub, `peer${i}`))
  for (let i = 0; i < n; i++)
    await (providers[i] as MemoryProvider).attach(stores[i] as ReturnType<typeof emptyStore>)
  return { hub, stores, providers }
}

describe("MemoryProvider", () => {
  test("two stores syncing through Yjs updates converge", async () => {
    const { stores } = await replicas(2)
    const [a, b] = stores as [ReturnType<typeof emptyStore>, ReturnType<typeof emptyStore>]
    ok(
      a.apply(
        { op: "insert", id: "Frame00001", node: { type: "frame", name: "F" } },
        { origin: "user" },
      ),
    )
    expect(b.getNode("Frame00001")?.name).toBe("F")
    ok(
      b.apply(
        { op: "insert", id: "Child00001", node: rect("c"), parent: "Frame00001" },
        { origin: "agent:b" },
      ),
    )
    ok(a.apply({ op: "update", id: "Frame00001", set: { name: "Renamed" } }, { origin: "user" }))
    expect(jsonEqual(a.toDocument(), b.toDocument())).toBe(true)
    expect(a.children("Frame00001")).toEqual(["Child00001"])
  })

  test("a late joiner receives the full state; three replicas converge", async () => {
    const hub = new MemoryHub()
    const a = emptyStore()
    ok(a.apply({ op: "insert", id: "Early00001", node: rect("early") }, { origin: "user" }))
    await new MemoryProvider(hub).attach(a)
    const b = emptyStore()
    ok(b.apply({ op: "insert", id: "Offline001", node: rect("offline") }, { origin: "user" }))
    await new MemoryProvider(hub).attach(b)
    const c = emptyStore()
    await new MemoryProvider(hub).attach(c)
    for (const s of [a, b, c]) {
      expect(s.hasNode("Early00001") && s.hasNode("Offline001")).toBe(true)
    }
    expect(jsonEqual(a.toDocument(), c.toDocument())).toBe(true)
  })

  test("concurrent offline edits (paused hub) converge, cycles repaired", async () => {
    const { hub, stores } = await replicas(2)
    const [a, b] = stores as [ReturnType<typeof emptyStore>, ReturnType<typeof emptyStore>]
    ok(
      a.apply(
        [
          { op: "insert", id: "Xxxxxxxxx1", node: { type: "frame", name: "X" } },
          { op: "insert", id: "Yyyyyyyyy1", node: { type: "frame", name: "Y" } },
        ],
        { origin: "user" },
      ),
    )
    hub.pause()
    ok(a.apply({ op: "move", id: "Xxxxxxxxx1", parent: "Yyyyyyyyy1" }, { origin: "user" }))
    ok(b.apply({ op: "move", id: "Yyyyyyyyy1", parent: "Xxxxxxxxx1" }, { origin: "user" }))
    ok(a.apply({ op: "update", id: "Xxxxxxxxx1", set: { x: 5 } }, { origin: "user" }))
    ok(b.apply({ op: "update", id: "Xxxxxxxxx1", set: { y: 7 } }, { origin: "agent:z" }))
    expect(hub.pending).toBeGreaterThan(0)
    hub.resume()
    expect(jsonEqual(a.toDocument(), b.toDocument())).toBe(true)
    expect(validate(a.toDocument()).ok).toBe(true)
    expect(a.getNode("Xxxxxxxxx1")).toMatchObject({ x: 5, y: 7 })
  })

  test("undo is per origin and per replica", async () => {
    const { stores } = await replicas(2)
    const [a, b] = stores as [ReturnType<typeof emptyStore>, ReturnType<typeof emptyStore>]
    ok(a.apply({ op: "insert", id: "UserA00001", node: rect("a") }, { origin: "user" }))
    ok(b.apply({ op: "insert", id: "UserB00001", node: rect("b") }, { origin: "user" }))
    ok(a.apply({ op: "insert", id: "AgentA0001", node: rect("agent") }, { origin: "agent:x" }))
    // Replica b's user cannot undo replica a's edits.
    expect(b.undo("user").ok).toBe(true)
    expect(a.hasNode("UserB00001")).toBe(false)
    expect(b.undo("user").ok).toBe(false)
    expect(b.hasNode("UserA00001")).toBe(true)
    // On a, the user's undo leaves the agent's node alone.
    expect(a.undo("user").ok).toBe(true)
    expect(b.hasNode("UserA00001")).toBe(false)
    expect(b.hasNode("AgentA0001")).toBe(true)
    expect(a.undo("agent:x").ok).toBe(true)
    expect(b.size).toBe(0)
    expect(a.redo("agent:x").ok).toBe(true)
    expect(b.hasNode("AgentA0001")).toBe(true)
  })

  test("detach stops sync; status events", async () => {
    const hub = new MemoryHub()
    const a = emptyStore()
    const b = emptyStore()
    const pa = new MemoryProvider(hub)
    const events: SyncStatusEvent[] = []
    pa.onStatus((e) => events.push(e))
    await pa.attach(a)
    await new MemoryProvider(hub).attach(b)
    expect(events.map((e) => e.status)).toEqual(["connecting", "synced"])
    await pa.detach()
    expect(pa.status).toBe("detached")
    ok(b.apply({ op: "insert", id: "After00001", node: rect("x") }, { origin: "user" }))
    expect(a.hasNode("After00001")).toBe(false)
    await expect(pa.attach(a)).resolves.toBeUndefined()
    expect(a.hasNode("After00001")).toBe(true)
    await expect(pa.attach(a)).rejects.toThrow(/already attached/)
  })
})
