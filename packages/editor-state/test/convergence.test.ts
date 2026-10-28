import { describe, expect, test } from "bun:test"
import { jsonEqual, validate } from "@kimo/core-schema"
import fc from "fast-check"
import { type LocalOrigin, type Op, YjsDocStore } from "../src/index"
import { emptyStore, frame, ok, rect, rng, syncPair } from "./helpers"

const RUNS = Number(process.env.KIMO_PROPERTY_RUNS ?? 200)

type Action =
  | { kind: "op"; replica: number; pick: number; target: number; what: number; origin: number }
  | { kind: "sync"; a: number; b: number }
  | { kind: "undo"; replica: number; origin: number }

const ORIGINS: LocalOrigin[] = ["user", "agent:a"]

const actionArb: fc.Arbitrary<Action> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.record({
      kind: fc.constant("op" as const),
      replica: fc.nat(2),
      pick: fc.nat(),
      target: fc.nat(),
      what: fc.nat(5),
      origin: fc.nat(1),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({ kind: fc.constant("sync" as const), a: fc.nat(2), b: fc.nat(2) }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant("undo" as const),
      replica: fc.nat(2),
      origin: fc.nat(1),
    }),
  },
)

let counter = 0
function randomOp(s: YjsDocStore, a: Extract<Action, { kind: "op" }>): Op | null {
  const ids = s.nodeIds().sort()
  const frames = ids.filter((id) => s.getNode(id)?.type === "frame")
  const any = ids.length > 0 ? ids[a.pick % ids.length] : undefined
  const parent = frames.length > 0 && a.target % 3 !== 0 ? frames[a.target % frames.length] : null
  const id = `Fz${String(++counter).padStart(8, "0")}`
  switch (a.what) {
    case 0:
      return {
        op: "insert",
        id,
        node: frame(`f${counter}`),
        parent: parent ?? null,
        index: a.target % 4,
      }
    case 1:
      return {
        op: "insert",
        id,
        node: rect(`r${counter}`),
        parent: parent ?? null,
        index: a.target % 4,
      }
    case 2:
      return any ? { op: "move", id: any, parent: parent ?? null, index: a.pick % 3 } : null
    case 3:
      return any ? { op: "update", id: any, set: { name: `n${counter}`, x: a.target % 100 } } : null
    case 4:
      return any ? { op: "delete", id: any } : null
    default:
      return any ? { op: "update", id: any, set: { y: a.pick % 50 } } : null
  }
}

describe("convergence (property)", () => {
  test("replicas with random ops, undos and partial syncs converge to the same valid tree", () => {
    fc.assert(
      fc.property(
        fc.array(actionArb, { minLength: 1, maxLength: 40 }),
        fc.nat(),
        (actions, seed) => {
          let t = 0
          const replicas = [0, 1, 2].map((i) =>
            emptyStore({ now: () => ++t, random: rng(seed + i) }),
          )
          const [r0, r1, r2] = replicas as [YjsDocStore, YjsDocStore, YjsDocStore]
          syncPair(r0, r1)
          syncPair(r0, r2)
          for (const a of actions) {
            if (a.kind === "sync") {
              if (a.a !== a.b) syncPair(replicas[a.a] as YjsDocStore, replicas[a.b] as YjsDocStore)
            } else if (a.kind === "undo") {
              ;(replicas[a.replica] as YjsDocStore).undo(ORIGINS[a.origin] as LocalOrigin)
            } else {
              const s = replicas[a.replica] as YjsDocStore
              const op = randomOp(s, a)
              if (!op) continue
              const r = s.apply(op, { origin: ORIGINS[a.origin] as LocalOrigin })
              // Local ops never produce invalid documents; cycles are refused.
              if (!r.ok) expect(["CYCLE"]).toContain(r.errors[0]?.code as string)
            }
          }
          for (let round = 0; round < 3; round++) {
            syncPair(r0, r1)
            syncPair(r1, r2)
            syncPair(r0, r2)
          }
          const docs = replicas.map((r) => r.toDocument())
          expect(jsonEqual(docs[0], docs[1])).toBe(true)
          expect(jsonEqual(docs[0], docs[2])).toBe(true)
          const v = validate(docs[0])
          expect(v.errors).toEqual([])
        },
      ),
      { numRuns: RUNS },
    )
  })

  test("children lists agree across replicas after concurrent reorders", () => {
    const a = emptyStore({ random: rng(1) })
    const b = emptyStore({ random: rng(2) })
    ok(
      a.apply(
        [
          { op: "insert", id: "Parent0001", node: frame("p") },
          ...[0, 1, 2, 3].map(
            (i): Op => ({
              op: "insert",
              id: `Kid0000${i}00`,
              node: rect(`${i}`),
              parent: "Parent0001",
            }),
          ),
        ],
        { origin: "user" },
      ),
    )
    syncPair(a, b)
    ok(
      a.apply({ op: "move", id: "Kid0000000", parent: "Parent0001", index: 3 }, { origin: "user" }),
    )
    ok(
      b.apply({ op: "move", id: "Kid0000300", parent: "Parent0001", index: 0 }, { origin: "user" }),
    )
    syncPair(a, b)
    expect(a.children("Parent0001")).toEqual(b.children("Parent0001"))
    expect(a.children("Parent0001")[0]).toBe("Kid0000300")
  })

  test("toDocument output does not depend on the order Yjs updates arrived in", () => {
    const source = emptyStore()
    const base = source.encodeStateAsUpdate()
    const replica = () => {
      const r = new YjsDocStore()
      r.applyUpdate(base, "remote:a")
      return r
    }
    const updates: Uint8Array[] = []
    source.onUpdate((u) => updates.push(u))
    for (const name of ["Zeta", "Alpha", "Mid", "Beta"]) {
      ok(source.apply({ op: "insert", node: rect(name) }, { origin: "user" }))
    }
    ok(
      source.apply(
        {
          op: "setVariables",
          set: { zz: { type: "number", value: 1 }, aa: { type: "number", value: 2 } },
        },
        { origin: "user" },
      ),
    )

    const forward = replica()
    for (const u of updates) forward.applyUpdate(u, "remote:a")
    const reversed = replica()
    for (const u of [...updates].reverse()) reversed.applyUpdate(u, "remote:a")

    const expected = JSON.stringify(source.toDocument())
    expect(JSON.stringify(forward.toDocument())).toBe(expected)
    expect(JSON.stringify(reversed.toDocument())).toBe(expected)
    const ids = Object.keys(source.toDocument().nodes)
    expect(ids).toEqual([...ids].sort())
  })
})
