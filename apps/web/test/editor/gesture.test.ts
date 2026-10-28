import { describe, expect, test } from "bun:test"
import { createDocStore, createEmptyDocument } from "@kimo/editor-state"
import { startGesture } from "../../src/canvas/gesture"

const rect = { type: "rect", w: 100, h: 100, x: 0, y: 0 } as const

function setup() {
  const store = createDocStore(createEmptyDocument("t"))
  store.apply(
    { op: "insert", id: "Rect000001", parent: null, node: rect as never },
    { origin: "user" },
  )
  // The user's previous, unrelated edit.
  store.apply({ op: "update", id: "Rect000001", set: { w: 150 } }, { origin: "user" })
  const x = () => store.getNode("Rect000001")?.x
  const w = () => store.getNode("Rect000001")?.w
  const move = (v: number) => [{ op: "update" as const, id: "Rect000001", set: { x: v } }]
  return { store, x, w, move }
}

describe("gesture undo grouping", () => {
  test("a step back through the start (no-op) never undoes the previous edit", () => {
    const { store, x, w, move } = setup()
    const g = startGesture(store, "user", "Move")
    g.set(move(40))
    g.set(move(0)) // back at the start: changes nothing, pushes no entry
    g.set(move(20))
    g.end()
    expect(x()).toBe(20)
    expect(w()).toBe(150)
    store.undo("user") // the whole gesture
    expect(x()).toBe(0)
    expect(w()).toBe(150)
  })

  test("an undo or another edit mid-gesture is not collapsed into the gesture", () => {
    const { store, x, w, move } = setup()
    const g = startGesture(store, "user", "Move")
    g.set(move(10))
    store.undo("user") // ⌘Z pops the gesture's own step
    g.set(move(30))
    expect(w()).toBe(150) // the earlier W edit survives
    expect(x()).toBe(30)
    store.apply({ op: "update", id: "Rect000001", set: { h: 120 } }, { origin: "user" })
    g.set(move(50))
    g.end()
    expect(store.getNode("Rect000001")?.h).toBe(120)
    expect(x()).toBe(50)
  })

  test("cancel reverts only the gesture's own step", () => {
    const { store, x, w, move } = setup()
    const g = startGesture(store, "user", "Move")
    g.set(move(10))
    g.cancel()
    expect(x()).toBe(0)
    expect(w()).toBe(150)
    expect(g.applied).toBe(false)
  })
})
