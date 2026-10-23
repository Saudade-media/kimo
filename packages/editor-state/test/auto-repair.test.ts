import { describe, expect, test } from "bun:test"
import { jsonEqual } from "@kimo/core-schema"
import { YjsDocStore } from "../src/index"
import { emptyStore, frame, ok, rng, syncPair } from "./helpers"

/** Two replicas with a concurrent cross-move: the merge makes a cycle only repair resolves. */
function cyclic(autoA: boolean, autoB: boolean) {
  let t = 1000
  const a = emptyStore({ now: () => (t += 10), random: rng(1), autoRepair: autoA })
  const b = emptyStore({ now: () => (t += 10), random: rng(2), autoRepair: autoB })
  ok(
    a.apply(
      [
        { op: "insert", id: "Root000001", node: frame("root") },
        { op: "insert", id: "Xxxxxxxxx1", node: frame("X"), parent: "Root000001" },
        { op: "insert", id: "Yyyyyyyyy1", node: frame("Y"), parent: "Root000001" },
      ],
      { origin: "user" },
    ),
  )
  syncPair(a, b)
  ok(a.apply({ op: "move", id: "Xxxxxxxxx1", parent: "Yyyyyyyyy1" }, { origin: "user" }))
  ok(b.apply({ op: "move", id: "Yyyyyyyyy1", parent: "Xxxxxxxxx1" }, { origin: "user" }))
  return { a, b }
}

const repairs = (s: YjsDocStore) => s.log().filter((e) => e.kind === "repair").length

describe("auto-repair switch", () => {
  test("defaults to on and follows setAutoRepair", () => {
    const store = emptyStore()
    expect(store.autoRepair).toBe(true)
    store.setAutoRepair(false)
    expect(store.autoRepair).toBe(false)
    expect(new YjsDocStore({ autoRepair: false }).autoRepair).toBe(false)
  })

  test("a replica with repair off merges the cycle but leaves repair to the other", () => {
    const { a, b } = cyclic(true, false)
    syncPair(a, b)
    syncPair(a, b)
    expect(repairs(a)).toBeGreaterThan(0)
    expect(repairs(b)).toBe(0)
    expect(jsonEqual(a.toDocument(), b.toDocument())).toBe(true)
  })

  test("with both off the cycle stays until repair() is called", () => {
    const { a, b } = cyclic(false, false)
    syncPair(a, b)
    expect(repairs(a) + repairs(b)).toBe(0)
    expect(a.repair().length).toBeGreaterThan(0)
    syncPair(a, b)
    expect(jsonEqual(a.toDocument(), b.toDocument())).toBe(true)
  })

  test("reloading an identical document emits no update", () => {
    const store = emptyStore()
    const doc = store.toDocument()
    const updates: Uint8Array[] = []
    store.onUpdate((u) => updates.push(u))
    store.loadDocument(doc, { origin: "file", newEpoch: false })
    expect(updates).toEqual([])
  })
})
