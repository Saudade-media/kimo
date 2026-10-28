import { describe, expect, test } from "bun:test"
import { isOrphanPlaceholder, PlaceholderTracker } from "../src/placeholder"

describe("placeholders", () => {
  test("orphans: a placeholder outlasts neither its agent nor an unowned `true`", () => {
    const live = new Set(["agent:kimo.s.1"])
    expect(isOrphanPlaceholder({ by: "agent:kimo.s.1" }, live)).toBe(false)
    expect(isOrphanPlaceholder({ by: "agent:kimo.old.1" }, live)).toBe(true)
    expect(isOrphanPlaceholder(true, live)).toBe(false)
    // A bare `true` has no owner: it never outlasts every agent.
    expect(isOrphanPlaceholder(true, new Set())).toBe(true)
  })

  test("tracker: set by insert/update, released by unset/delete", () => {
    const t = new PlaceholderTracker("agent:kimo.s.0")
    t.observe(
      {
        docId: "d",
        ops: [
          { op: "insert", key: "a", parent: "root", node: { type: "frame", placeholder: true } },
          { op: "update", id: "B000000001", set: { placeholder: true } },
        ],
      },
      [{ key: "a", id: "A000000001" }],
    )
    expect(t.size).toBe(2)
    t.observe({ docId: "d", ops: [{ op: "update", id: "B000000001", unset: ["placeholder"] }] })
    expect(t.clearingCalls()).toEqual([
      {
        docId: "d",
        ops: [{ op: "update", id: "A000000001", unset: ["placeholder"] }],
        label: "Clear placeholders",
      } as never,
    ])
  })
})
