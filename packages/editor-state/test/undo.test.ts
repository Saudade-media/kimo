import { describe, expect, test } from "bun:test"
import { jsonEqual } from "@kimo/core-schema"
import { emptyStore, frame, ok, rect, syncPair } from "./helpers"

describe("per-origin undo/redo", () => {
  test("each origin undoes only its own groups", () => {
    const s = emptyStore()
    ok(s.apply({ op: "insert", id: "Frame00001", node: frame("F") }, { origin: "user" }))
    ok(
      s.apply(
        { op: "insert", id: "Agent00001", node: rect("by agent"), parent: "Frame00001" },
        { origin: "agent:a1" },
      ),
    )
    ok(
      s.apply(
        { op: "update", id: "Frame00001", set: { name: "Renamed by user" } },
        { origin: "user" },
      ),
    )

    expect(s.undo("user").ok).toBe(true)
    expect(s.getNode("Frame00001")?.name).toBe("F")
    expect(s.hasNode("Agent00001")).toBe(true)

    expect(s.undo("agent:a1").ok).toBe(true)
    expect(s.hasNode("Agent00001")).toBe(false)
    expect(s.hasNode("Frame00001")).toBe(true)

    expect(s.canUndo("agent:a1")).toBe(false)
    expect(s.undo("agent:a1").ok).toBe(false)
    expect(s.undo("mcp:nobody").ok).toBe(false)

    expect(s.redo("agent:a1").ok).toBe(true)
    expect(s.getNode("Agent00001")?.name).toBe("by agent")
  })

  test("one apply = one undo step (no time-based merging)", () => {
    const s = emptyStore()
    for (let i = 0; i < 3; i++) {
      ok(s.apply({ op: "insert", id: `Step00000${i}`, node: rect(`r${i}`) }, { origin: "user" }))
    }
    s.undo("user")
    expect(s.size).toBe(2)
    s.undo("user")
    s.undo("user")
    expect(s.size).toBe(0)
    s.redo("user")
    expect(s.nodeIds()).toEqual(["Step000000"])
  })

  test("a batch with many ops undoes atomically", () => {
    const s = emptyStore()
    const before = s.toDocument()
    ok(
      s.apply(
        [
          { op: "insert", id: "Batch00001", node: frame("B") },
          { op: "insert", node: rect("1"), parent: "Batch00001" },
          { op: "setThemes", set: { mode: ["light", "dark"] } },
        ],
        { origin: "user" },
      ),
    )
    s.undo("user")
    expect(jsonEqual(s.toDocument(), before)).toBe(true)
  })

  test("user undo does not overwrite a later agent edit of the same field", () => {
    const s = emptyStore()
    ok(s.apply({ op: "insert", id: "Shared0001", node: rect("orig") }, { origin: "user" }))
    ok(s.apply({ op: "update", id: "Shared0001", set: { name: "user" } }, { origin: "user" }))
    ok(s.apply({ op: "update", id: "Shared0001", set: { name: "agent" } }, { origin: "agent:a" }))
    const r = s.undo("user")
    expect(r).toMatchObject({ ok: false, stale: true })
    expect(s.getNode("Shared0001")?.name).toBe("agent")
    // The next undo is the user's insert.
    expect(s.undo("user").ok).toBe(true)
    expect(s.hasNode("Shared0001")).toBe(false)
  })

  test("undo of a node deleted by another origin is a guarded no-op", () => {
    const s = emptyStore()
    ok(s.apply({ op: "insert", id: "Gone000001", node: rect("g") }, { origin: "agent:a" }))
    ok(s.apply({ op: "update", id: "Gone000001", set: { name: "edited" } }, { origin: "user" }))
    ok(s.apply({ op: "delete", id: "Gone000001" }, { origin: "agent:a" }))
    expect(s.undo("user")).toMatchObject({ ok: false, stale: true })
    expect(s.hasNode("Gone000001")).toBe(false)
    expect(s.canUndo("user")).toBe(false)
  })

  test("remote updates are never undone locally", () => {
    const a = emptyStore()
    const b = emptyStore()
    syncPair(a, b)
    ok(a.apply({ op: "insert", id: "FromA00001", node: rect("a") }, { origin: "user" }))
    syncPair(a, b)
    ok(b.apply({ op: "insert", id: "FromB00001", node: rect("b") }, { origin: "user" }))
    syncPair(a, b)
    expect(b.hasNode("FromA00001")).toBe(true)
    b.undo("user")
    expect(b.hasNode("FromB00001")).toBe(false)
    expect(b.hasNode("FromA00001")).toBe(true)
    expect(b.canUndo("user")).toBe(false)
  })

  test("undo that would recreate a cycle is repaired", () => {
    let t = 0
    const s = emptyStore({ now: () => ++t })
    ok(
      s.apply(
        [
          { op: "insert", id: "PPPPPPPPPP", node: frame("P") },
          { op: "insert", id: "AAAAAAAAAA", node: frame("A"), parent: "PPPPPPPPPP" },
          { op: "insert", id: "XXXXXXXXXX", node: frame("X") },
        ],
        { origin: "agent:setup" },
      ),
    )
    // User moves A out of P into X; the agent then moves P under A (legal at that point).
    ok(s.apply({ op: "move", id: "AAAAAAAAAA", parent: "XXXXXXXXXX" }, { origin: "user" }))
    ok(s.apply({ op: "move", id: "PPPPPPPPPP", parent: "AAAAAAAAAA" }, { origin: "agent:a" }))
    // Undoing the user's move would put A back under P, which is under A.
    const r = s.undo("user")
    expect(r.ok).toBe(true)
    expect(r.repairs.length).toBe(1)
    // The later move (the agent's P → A) is reverted: P goes back to the root.
    expect(r.repairs[0]).toMatchObject({ id: "PPPPPPPPPP", kind: "cycle", parent: null })
    expect(s.getNode("AAAAAAAAAA")?.parent).toBe("PPPPPPPPPP")
    expect(s.getNode("PPPPPPPPPP")?.parent).toBeNull()
  })

  test("clearHistory empties stacks", () => {
    const s = emptyStore()
    ok(s.apply({ op: "insert", node: rect("x") }, { origin: "user" }))
    s.clearHistory("user")
    expect(s.canUndo("user")).toBe(false)
  })
})
