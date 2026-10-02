/**
 * Incremental validation (the default) must make the same accept/reject decisions as validating
 * the whole candidate document per op group, through edits, undo/redo and remote updates.
 */
import { describe, expect, test } from "bun:test"
import { jsonEqual, validate } from "@kimo/core-schema"
import fc from "fast-check"
import type { ApplyResult, LocalOrigin, Op } from "../src/index"
import { createDocStore, YjsDocStore } from "../src/index"
import { emptyStore, fixture, frame, rect, rng } from "./helpers"

const RUNS = Number(process.env.KIMO_PROPERTY_RUNS ?? 150)

type Action =
  | { kind: "op"; pick: number; target: number; what: number; value: number }
  | { kind: "undo" | "redo"; origin: number }
  | { kind: "remote"; pick: number; value: number }

const actionArb: fc.Arbitrary<Action> = fc.oneof(
  {
    weight: 8,
    arbitrary: fc.record({
      kind: fc.constant("op" as const),
      pick: fc.nat(),
      target: fc.nat(),
      what: fc.nat(11),
      value: fc.nat(7),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constantFrom("undo" as const, "redo" as const),
      origin: fc.nat(1),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant("remote" as const),
      pick: fc.nat(),
      value: fc.nat(7),
    }),
  },
)

const ORIGINS: LocalOrigin[] = ["user", "agent:a"]

/** Field values, valid and invalid, for `update` ops. */
const VALUES: [string, unknown][] = [
  ["opacity", 0.5],
  ["opacity", 2],
  ["w", 40],
  ["w", { mode: "fill" }],
  ["fill", "#12345678"],
  ["fill", "nope"],
  ["layout", { dir: "row", gap: 8 }],
  ["name", "renamed"],
]

let counter = 0
function randomOp(s: YjsDocStore, a: Extract<Action, { kind: "op" }>): Op | null {
  const ids = s.nodeIds().sort()
  const any = ids.length > 0 ? ids[a.pick % ids.length] : undefined
  const other = ids.length > 0 ? ids[a.target % ids.length] : undefined
  const id = `Iv${String(++counter).padStart(8, "0")}`
  const [key, value] = VALUES[a.value % VALUES.length] as [string, unknown]
  switch (a.what) {
    case 0:
      return { op: "insert", id, node: frame(`f${counter}`), parent: other ?? null }
    case 1:
      return { op: "insert", id, node: rect(`r${counter}`), parent: other ?? null }
    case 2:
      return {
        op: "insert",
        id,
        node: { type: "text", content: "hi", fill: { color: "#00000000", visible: false } },
        parent: other ?? null,
      }
    case 3:
    case 4:
    case 5:
      return any ? { op: "update", id: any, set: { [key]: value } } : null
    case 6:
      return any ? { op: "update", id: any, unset: [key] } : null
    case 7:
      return any ? { op: "move", id: any, parent: other ?? null, index: a.value % 3 } : null
    case 8:
      return any ? { op: "delete", id: any } : null
    case 9:
      return any ? { op: "update", id: any, set: { fill: { $ref: "missing.var" } } } : null
    case 10:
      return any ? { op: "update", id: any, set: { theme: { mode: "dark" } } } : null
    default:
      return any && other ? { op: "update", id: any, set: { of: other } } : null
  }
}

const errorKeys = (r: ApplyResult) =>
  r.ok ? [] : r.errors.map((e) => `${e.code}:${e.issue?.code ?? ""}:${e.issue?.path ?? ""}`).sort()

function run(start: () => YjsDocStore, actions: Action[]): void {
  const inc = start()
  const full = start()
  // A third replica feeds "remote" changes into both.
  const remote = start()
  for (const a of actions) {
    if (a.kind === "op") {
      const op = randomOp(inc, a)
      if (!op) continue
      const origin = ORIGINS[a.value % 2] as LocalOrigin
      const ri = inc.apply(op, { origin })
      const rf = full.apply(op, { origin })
      expect(ri.ok).toBe(rf.ok)
      expect(errorKeys(ri)).toEqual(errorKeys(rf))
    } else if (a.kind === "remote") {
      // Remote edits never touch fields the local ops write: concurrent writes to one field
      // resolve by Yjs client id, which differs between the two local replicas.
      const ids = remote.nodeIds().sort()
      const id = ids[a.pick % Math.max(1, ids.length)]
      if (!id) continue
      const op: Op =
        a.value % 4 === 0
          ? { op: "delete", id }
          : a.value % 4 === 1
            ? {
                op: "insert",
                id: `Rm${String(++counter).padStart(8, "0")}`,
                node: rect("remote"),
                parent: id,
              }
            : { op: "update", id, set: { visible: a.value % 4 === 2 } }
      const r = remote.apply(op, { origin: "user" })
      if (!r.ok) continue
      const u = remote.encodeStateAsUpdate()
      inc.applyUpdate(u, "remote")
      full.applyUpdate(u, "remote")
    } else {
      const origin = ORIGINS[a.origin] as LocalOrigin
      if (a.kind === "undo") {
        inc.undo(origin)
        full.undo(origin)
      } else {
        inc.redo(origin)
        full.redo(origin)
      }
    }
    expect(jsonEqual(inc.toDocument(), full.toDocument())).toBe(true)
  }
  expect(validate(inc.toDocument()).ok).toBe(validate(full.toDocument()).ok)
}

describe("incremental validation", () => {
  const starts: [string, (validation: "incremental" | "full") => YjsDocStore][] = [
    ["empty", (validation) => emptyStore({ validation, jitter: 0 })],
    [
      "components-local",
      (validation) =>
        createDocStore(fixture("components-local.kimo"), { validation, jitter: 0, random: rng(3) }),
    ],
    [
      "themes-multi-axis",
      (validation) =>
        createDocStore(fixture("themes-multi-axis.kimo"), {
          validation,
          jitter: 0,
          random: rng(3),
        }),
    ],
  ]
  for (const [name, make] of starts) {
    test(`same decisions as full validation: ${name}`, () => {
      fc.assert(
        fc.property(fc.array(actionArb, { maxLength: 40 }), (actions) => {
          counter = 0
          let n = 0
          // `inc` and `full` must be identical replicas: share one initial state.
          const update = make("full").encodeStateAsUpdate()
          const start = () => {
            const validation = n++ === 0 ? "incremental" : "full"
            const s = new YjsDocStore({ validation, jitter: 0, random: rng(3) })
            s.applyUpdate(update, "remote")
            return s
          }
          run(start, actions)
        }),
        { numRuns: RUNS },
      )
    })
  }

  test("a single-field edit of a 5,000-node document checks only its neighbourhood", () => {
    const s = emptyStore()
    const ops: Op[] = [{ op: "insert", id: "Root000000", node: frame("root"), parent: null }]
    for (let i = 0; i < 5000; i++)
      ops.push({
        op: "insert",
        id: `N${String(i).padStart(9, "0")}`,
        node: rect(`r${i}`),
        parent: "Root000000",
      })
    expect(s.apply(ops, { origin: "user" }).ok).toBe(true)
    const time = (fn: () => void) => {
      const t = performance.now()
      fn()
      return performance.now() - t
    }
    // Warm up (baseline), then measure single-field edits with undo in between.
    s.apply({ op: "update", id: "N000000001", set: { opacity: 0.5 } }, { origin: "user" })
    const samples: number[] = []
    for (let i = 0; i < 20; i++) {
      samples.push(
        time(() => {
          s.apply({ op: "update", id: "N000000042", set: { opacity: i / 20 } }, { origin: "user" })
          s.undo("user")
        }),
      )
    }
    samples.sort((a, b) => a - b)
    const p50 = samples[10] as number
    console.log(`5k nodes: edit + undo p50 ${p50.toFixed(2)} ms`)
    // Full validation of this document costs tens of ms; incremental stays far below it.
    expect(p50).toBeLessThan(15)
  })
})
