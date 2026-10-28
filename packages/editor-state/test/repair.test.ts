import { describe, expect, test } from "bun:test"
import { jsonEqual, validate } from "@kimo/core-schema"
import fc from "fast-check"
import { type MoveRecord, planTreeRepairs, type TreeFields, type YjsDocStore } from "../src/index"
import { emptyStore, frame, ok, rect, rng, syncPair } from "./helpers"

const RUNS = Number(process.env.KIMO_PROPERTY_RUNS ?? 200)

const tree = (entries: [string, string | null][]) =>
  new Map<string, TreeFields>(entries.map(([id, parent]) => [id, { parent, order: "a0" }]))

function hasCycle(nodes: Map<string, TreeFields>): boolean {
  for (const id of nodes.keys()) {
    const seen = new Set<string>()
    for (let p: string | null = id; p !== null; p = nodes.get(p)?.parent ?? null) {
      if (seen.has(p)) return true
      seen.add(p)
    }
  }
  return false
}

describe("planTreeRepairs", () => {
  test("a forest needs no repairs; orphans go to the root", () => {
    expect(
      planTreeRepairs(
        tree([
          ["a", null],
          ["b", "a"],
          ["c", "b"],
        ]),
      ),
    ).toEqual([])
    expect(planTreeRepairs(tree([["a", "gone"]]))).toEqual([
      { id: "a", kind: "orphan", parent: null, order: "a0" },
    ])
  })

  test("the later move is reverted to its previous parent", () => {
    const nodes = tree([
      ["r", null],
      ["x", "y"],
      ["y", "x"],
    ])
    const moves = new Map<string, MoveRecord>([
      ["x", { t: 1, prevParent: "r", prevOrder: "a1" }],
      ["y", { t: 2, prevParent: "r", prevOrder: "a2" }],
    ])
    expect(planTreeRepairs(nodes, moves)).toEqual([
      { id: "y", kind: "cycle", parent: "r", order: "a2" },
    ])
  })

  test("ties break by larger id; a previous parent inside or below the cycle falls back to the root", () => {
    const tied = tree([
      ["x", "y"],
      ["y", "x"],
    ])
    const tiedMoves = new Map<string, MoveRecord>([
      ["x", { t: 5, prevParent: null, prevOrder: "a0" }],
      ["y", { t: 5, prevParent: "x", prevOrder: "a0" }],
    ])
    expect(planTreeRepairs(tied, tiedMoves)).toEqual([
      { id: "y", kind: "cycle", parent: null, order: "a0" },
    ])
    // z hangs off the cycle x <-> y; y's previous parent was z.
    const below = tree([
      ["x", "y"],
      ["y", "x"],
      ["z", "x"],
    ])
    const belowMoves = new Map<string, MoveRecord>([
      ["y", { t: 9, prevParent: "z", prevOrder: "a0" }],
    ])
    expect(planTreeRepairs(below, belowMoves)).toEqual([
      { id: "y", kind: "cycle", parent: null, order: "a0" },
    ])
  })

  test("property: repairs always yield a forest, deterministically", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }).chain((n) =>
          fc.tuple(
            fc.array(fc.option(fc.integer({ min: 0, max: n + 1 }), { nil: null }), {
              minLength: n,
              maxLength: n,
            }),
            fc.array(
              fc.tuple(fc.nat(5), fc.option(fc.integer({ min: 0, max: n }), { nil: null })),
              {
                minLength: n,
                maxLength: n,
              },
            ),
          ),
        ),
        ([parents, moveSpec]) => {
          const id = (i: number) => `n${i}`
          const nodes = new Map<string, TreeFields>(
            parents.map((p, i) => [id(i), { parent: p === null ? null : id(p), order: "a0" }]),
          )
          const moves = new Map<string, MoveRecord>(
            moveSpec.map(([t, prev], i) => [
              id(i),
              { t, prevParent: prev === null ? null : id(prev), prevOrder: "a1" },
            ]),
          )
          const repairs = planTreeRepairs(nodes, moves)
          const after = new Map(nodes)
          for (const r of repairs) after.set(r.id, { parent: r.parent, order: r.order })
          expect(hasCycle(after)).toBe(false)
          for (const n of after.values())
            expect(n.parent === null || after.has(n.parent)).toBe(true)
          expect(planTreeRepairs(nodes, moves)).toEqual(repairs)
        },
      ),
      { numRuns: RUNS * 2 },
    )
  })
})

describe("post-merge repair on Yjs", () => {
  function setup(autoRepair: [boolean, boolean] = [true, true]) {
    let t = 0
    const a = emptyStore({ now: () => (t += 10), random: rng(1), autoRepair: autoRepair[0] })
    const b = emptyStore({ now: () => (t += 10), random: rng(2), autoRepair: autoRepair[1] })
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
    return { a, b }
  }

  /** X under Y on `a` (earlier), Y under X on `b` (later): together a cycle. */
  const crossMove = (a: YjsDocStore, b: YjsDocStore) => {
    ok(a.apply({ op: "move", id: "Xxxxxxxxx1", parent: "Yyyyyyyyy1" }, { origin: "user" }))
    ok(b.apply({ op: "move", id: "Yyyyyyyyy1", parent: "Xxxxxxxxx1" }, { origin: "user" }))
  }

  test("concurrent cross-moves converge to an acyclic, valid tree", () => {
    const { a, b } = setup()
    crossMove(a, b)
    syncPair(a, b)
    syncPair(a, b)
    expect(jsonEqual(a.toDocument(), b.toDocument())).toBe(true)
    const doc = a.toDocument()
    expect(validate(doc).ok).toBe(true)
    // The later move (Y under X) was reverted: Y is back under Root, X stays under Y.
    expect(doc.nodes.Yyyyyyyyy1?.parent).toBe("Root000001")
    expect(doc.nodes.Xxxxxxxxx1?.parent).toBe("Yyyyyyyyy1")
    expect([...a.log(), ...b.log()].some((e) => e.kind === "repair")).toBe(true)
  })

  test("insert under a concurrently deleted parent is rescued to the root", () => {
    const { a, b } = setup()
    ok(a.apply({ op: "delete", id: "Xxxxxxxxx1" }, { origin: "user" }))
    ok(
      b.apply(
        { op: "insert", id: "Child00001", node: rect("c"), parent: "Xxxxxxxxx1" },
        { origin: "user" },
      ),
    )
    syncPair(a, b)
    syncPair(a, b)
    expect(jsonEqual(a.toDocument(), b.toDocument())).toBe(true)
    expect(a.getNode("Child00001")?.parent).toBeNull()
    expect(validate(a.toDocument()).ok).toBe(true)
  })

  test("concurrent edits of different fields of one node both survive", () => {
    const { a, b } = setup()
    ok(a.apply({ op: "update", id: "Xxxxxxxxx1", set: { name: "from A" } }, { origin: "user" }))
    ok(b.apply({ op: "update", id: "Xxxxxxxxx1", set: { x: 42 } }, { origin: "user" }))
    syncPair(a, b)
    expect(a.getNode("Xxxxxxxxx1")).toMatchObject({ name: "from A", x: 42 })
    expect(jsonEqual(a.toDocument(), b.toDocument())).toBe(true)
  })

  test("concurrent inserts at the same index get distinct jittered keys", () => {
    const { a, b } = setup()
    ok(
      a.apply(
        { op: "insert", id: "InsA000001", node: rect("a"), parent: "Root000001", index: 1 },
        { origin: "user" },
      ),
    )
    ok(
      b.apply(
        { op: "insert", id: "InsB000001", node: rect("b"), parent: "Root000001", index: 1 },
        { origin: "user" },
      ),
    )
    syncPair(a, b)
    expect(a.getNode("InsA000001")?.order).not.toBe(a.getNode("InsB000001")?.order)
    expect(a.children("Root000001")).toEqual(b.children("Root000001"))
  })

  describe("auto-repair switch", () => {
    const repairs = (s: YjsDocStore) => s.log().filter((e) => e.kind === "repair").length

    test("a replica with repair off merges the cycle but leaves repair to the other", () => {
      const { a, b } = setup([true, false])
      crossMove(a, b)
      syncPair(a, b)
      syncPair(a, b)
      expect(repairs(a)).toBeGreaterThan(0)
      expect(repairs(b)).toBe(0)
      expect(jsonEqual(a.toDocument(), b.toDocument())).toBe(true)
    })

    test("with both off the cycle stays until repair() is called", () => {
      const { a, b } = setup([false, false])
      crossMove(a, b)
      syncPair(a, b)
      expect(repairs(a) + repairs(b)).toBe(0)
      expect(a.repair().length).toBeGreaterThan(0)
      syncPair(a, b)
      expect(jsonEqual(a.toDocument(), b.toDocument())).toBe(true)
    })
  })
})
