/**
 * M3 commands under concurrency (property): two replicas apply random component, instance,
 * variable and theme commands (through `applyCommand`), undo, and sync at random points; after
 * a final sync they hold the same document, byte for byte, and it validates.
 *
 * The validating property draws from commands whose concurrent composition the format keeps
 * valid (per-field last-writer-wins on nodes, per-name variables, base-only references).
 * A second property adds the commands with semantic cross-replica conflicts (slot / replace
 * content vs a concurrent `overrides` write, declared props vs concurrent args, deletes of
 * referenced variables, detach): replicas still converge byte for byte, and the only errors are
 * the known conflict codes listed there (a post-merge semantic repair is future work).
 */
import { describe, expect, test } from "bun:test"
import { type KimoDocument, serialize, validate } from "@kimo/core-schema"
import fc from "fast-check"
import { applyCommand, type M3Command, YjsDocStore } from "../src/index"
import { rng, syncPair } from "./helpers"

const RUNS = Number(process.env.KIMO_PROPERTY_RUNS ?? 100)

const base = (): KimoDocument =>
  ({
    $schema: "https://getkimo.design/schema/kimo-1.0.json",
    format: "1.0.0",
    themes: { density: ["comfortable", "compact"], mode: ["light", "dark"] },
    variables: {
      ink: { type: "color", value: "#111111" },
      surface: { type: "color", value: "#FFFFFF" },
    },
    nodes: {
      page000001: { type: "frame", parent: null, order: "a0", name: "Page" },
      other00001: { type: "rect", parent: null, order: "a1", component: true, w: 8, h: 8 },
      other00002: { type: "ellipse", parent: null, order: "a2", component: true, w: 9, h: 9 },
      card000001: {
        type: "frame",
        parent: null,
        order: "a3",
        component: {
          props: {
            label: { type: "text", target: "title00001", field: "content", order: "a0" },
            dim: {
              type: "enum",
              target: "card000001",
              field: "opacity",
              options: { half: 0.5, full: 1 },
              order: "a1",
            },
            icon: { type: "instance", target: "icon000001", order: "a2" },
          },
        },
        layout: { dir: "column" },
      },
      title00001: { type: "text", parent: "card000001", order: "a0", content: "T" },
      price00001: { type: "text", parent: "card000001", order: "a1", content: "$" },
      icon000001: { type: "instance", parent: "card000001", order: "a2", of: "other00001" },
      slot000001: { type: "frame", parent: "card000001", order: "a3", slot: {} },
      instA00001: { type: "instance", parent: "page000001", order: "a0", of: "card000001" },
      instB00001: { type: "instance", parent: "page000001", order: "a1", of: "card000001" },
    },
  }) as unknown as KimoDocument

type Draw = { replica: number; what: number; a: number; b: number }
type Action = ({ kind: "cmd" } & Draw) | { kind: "sync" } | { kind: "undo"; replica: number }

const actionArb = (kinds: number): fc.Arbitrary<Action> =>
  fc.oneof(
    {
      weight: 8,
      arbitrary: fc.record({
        kind: fc.constant("cmd" as const),
        replica: fc.nat(1),
        what: fc.nat(kinds - 1),
        a: fc.nat(),
        b: fc.nat(),
      }),
    },
    { weight: 2, arbitrary: fc.constant({ kind: "sync" as const }) },
    { weight: 1, arbitrary: fc.record({ kind: fc.constant("undo" as const), replica: fc.nat(1) }) },
  )

const pick = <T>(xs: readonly T[], i: number): T => xs[i % xs.length] as T

/** Instances of the card (base ones plus any created), sorted for determinism. */
const cardInstances = (s: YjsDocStore) =>
  s
    .nodeIds()
    .filter((id) => s.getNode(id)?.type === "instance" && s.getNode(id)?.of === "card000001")
    .sort()
const otherInstances = (s: YjsDocStore) =>
  s
    .nodeIds()
    .filter((id) => {
      const of = s.getNode(id)?.of
      return s.getNode(id)?.type === "instance" && (of === "other00001" || of === "other00002")
    })
    .sort()

let uid = 0

/** Commands whose concurrent composition stays valid. */
function safeCommand(s: YjsDocStore, d: Draw): M3Command | null {
  const tag = `${d.replica}${String(++uid).padStart(6, "0")}`
  const inst = pick(cardInstances(s), d.a)
  const others = otherInstances(s)
  const modes = ["light", "dark"]
  const density = ["comfortable", "compact"]
  // Variables may have been deleted or renamed by the conflicting commands.
  const vars = Object.keys(s.toDocument().variables ?? {})
  const colors = vars.filter((n) => n === "ink" || n.startsWith("surface"))
  const surface = vars.find((n) => n.startsWith("surface"))
  const hasInk = vars.includes("ink")
  switch (d.what) {
    case 0:
      return {
        cmd: "setOverride",
        instance: inst,
        path: "title00001",
        change: { kind: "set", set: { content: `t${d.b % 50}` } },
      }
    case 1:
      return {
        cmd: "setOverride",
        instance: inst,
        path: "price00001",
        change: {
          kind: "set",
          set: { fill: colors.length ? { $ref: pick(colors, d.b) } : "#000000" },
        },
      }
    case 2:
      return { cmd: "setArgs", instance: inst, args: { label: `L${d.b % 9}` } }
    case 3:
      return { cmd: "setArgs", instance: inst, args: { dim: pick(["half", "full"], d.b) } }
    case 4:
      return {
        cmd: "setArgs",
        instance: inst,
        args: { icon: pick(["other00001", "other00002"], d.b) },
      }
    case 5:
      return {
        cmd: "setOverride",
        instance: inst,
        path: "",
        change: { kind: "set", set: { opacity: (d.b % 10) / 10 } },
      }
    case 6:
      return {
        cmd: "hideInInstance",
        instance: inst,
        path: pick(["price00001", "icon000001"], d.b),
      }
    case 7:
      return {
        cmd: "resetOverride",
        instance: inst,
        path: pick(["title00001", "price00001", ""], d.b),
      }
    case 8:
      return { cmd: "resetAllOverrides", instance: inst }
    case 9:
      return {
        cmd: "setOverride",
        instance: inst,
        path: "icon000001",
        change: { kind: "set", set: { of: pick(["other00001", "other00002"], d.b) } },
      }
    case 10:
      return {
        cmd: "setThemePin",
        node: pick(["page000001", "instA00001", "instB00001", "title00001"], d.a),
        axis: pick(["mode", "density"], d.b),
        value: d.b % 3 === 0 ? null : pick(d.b % 2 ? modes : density, d.a),
      }
    case 11:
      if (!surface) return null
      return {
        cmd: "setCell",
        name: surface,
        axis: pick(["mode", "density"], d.a),
        value: pick(d.a % 2 ? density : modes, d.b),
        cell: d.b % 4 === 0 ? undefined : d.b % 4 === 1 && hasInk ? { $ref: "ink" } : "#EEEEEE",
      }
    case 12:
      return {
        cmd: "createVariable",
        name: `v${tag}`,
        variable: { type: "number", value: d.b % 64 },
      }
    case 13:
      return {
        cmd: "createInstance",
        of: pick(["other00001", "other00002", "card000001"], d.b),
        placement: { parent: "page000001", id: `New${tag}`, index: d.a % 3 },
      }
    case 14:
      return others.length
        ? {
            cmd: "swapInstance",
            instance: pick(others, d.a),
            of: pick(["other00001", "other00002"], d.b),
          }
        : null
    case 15:
      return {
        cmd: "setComponentDescription",
        component: "card000001",
        text: d.b % 3 === 0 ? null : `about ${d.b % 7}`,
      }
    case 16:
      return { cmd: "addAxisValue", axis: "density", value: `x${tag}` }
    default:
      return {
        cmd: "setOverride",
        instance: inst,
        path: "title00001",
        change: { kind: "set", set: { theme: { mode: pick(modes, d.b) } } },
      }
  }
}
const SAFE_KINDS = 18

/** Adds commands with known cross-replica semantic conflicts. */
function anyCommand(s: YjsDocStore, d: Draw): M3Command | null {
  if (d.what < SAFE_KINDS) return safeCommand(s, d)
  const tag = `${d.replica}${String(++uid).padStart(6, "0")}`
  const inst = pick(cardInstances(s), d.a)
  switch (d.what - SAFE_KINDS) {
    case 0:
      return {
        cmd: "setOverride",
        instance: inst,
        path: "slot000001",
        change: {
          kind: "slot",
          content: [{ id: `Slt${tag}`, node: { type: "text", content: "s" } }],
        },
      }
    case 1:
      return {
        cmd: "setOverride",
        instance: inst,
        path: "price00001",
        change: { kind: "replace", id: `Rep${tag}`, node: { type: "text", content: "r" } },
      }
    case 2:
      return {
        cmd: "declareProp",
        component: "card000001",
        name: `p${tag}`,
        def: { type: "boolean", target: "price00001", field: "visible" },
      }
    case 3:
      return { cmd: "detachInstance", id: inst }
    case 4:
      return { cmd: "deleteVariable", name: "ink", detach: true }
    default: {
      const surface = Object.keys(s.toDocument().variables ?? {}).find((n) =>
        n.startsWith("surface"),
      )
      return surface ? { cmd: "renameVariable", from: surface, to: `surface${tag}` } : null
    }
  }
}

/** Semantic conflicts concurrent edits can produce (no post-merge semantic repair yet). */
const CONFLICT_CODES = new Set([
  "AT_WITHOUT_OVERRIDE",
  "REPLACE_COUNT",
  "ARG_UNKNOWN",
  "VARIABLE_MISSING",
  "OVERRIDE_PATH_UNRESOLVED",
  "OVERRIDE_INVALID",
])

function run(actions: Action[], seed: number, gen: typeof safeCommand) {
  let t = 0
  const a = new YjsDocStore({ now: () => ++t, random: rng(seed) })
  a.loadDocument(base())
  const b = new YjsDocStore({ now: () => ++t, random: rng(seed + 1) })
  syncPair(a, b)
  const replicas = [a, b]
  const rngs = [rng(seed + 2), rng(seed + 3)]
  let applied = 0
  for (const act of actions) {
    if (act.kind === "sync") syncPair(a, b)
    else if (act.kind === "undo") (replicas[act.replica] as YjsDocStore).undo("user")
    else {
      const s = replicas[act.replica] as YjsDocStore
      const cmd = gen(s, act)
      if (!cmd) continue
      const next = rngs[act.replica] as () => number
      const r = applyCommand(s, cmd, {
        origin: "user",
        newId: () =>
          `G${act.replica}${Math.floor(next() * 1e8)
            .toString(36)
            .padStart(8, "0")}`,
      })
      // A command either applies or is refused by its planner; local validation never rejects.
      if (!r.ok && "rejected" in r) throw new Error(`${cmd.cmd}: ${JSON.stringify(r.rejected)}`)
      if (r.ok) applied++
    }
  }
  for (let i = 0; i < 2; i++) syncPair(a, b)
  const da = serialize(a.toDocument())
  const db = serialize(b.toDocument())
  return { da, db, doc: a.toDocument(), applied }
}

describe("M3 convergence (property)", () => {
  test("random safe commands, undos and syncs: replicas converge and validate", () => {
    let total = 0
    fc.assert(
      fc.property(
        fc.array(actionArb(SAFE_KINDS), { minLength: 1, maxLength: 40 }),
        fc.nat(),
        (actions, seed) => {
          const r = run(actions, seed, safeCommand)
          total += r.applied
          expect(r.da).toBe(r.db)
          expect(validate(r.doc).errors).toEqual([])
        },
      ),
      { numRuns: RUNS },
    )
    expect(total).toBeGreaterThan(RUNS)
  })

  test("with conflicting commands: replicas still converge; errors are known conflicts", () => {
    fc.assert(
      fc.property(
        fc.array(actionArb(SAFE_KINDS + 6), { minLength: 1, maxLength: 40 }),
        fc.nat(),
        (actions, seed) => {
          const r = run(actions, seed, anyCommand)
          expect(r.da).toBe(r.db)
          const unknown = validate(r.doc).errors.filter((e) => !CONFLICT_CODES.has(e.code))
          expect(unknown).toEqual([])
        },
      ),
      { numRuns: RUNS },
    )
  })
})

describe("detach after a concurrent variable delete", () => {
  // Found by the property test (seed 622316994): a component fill bound to a variable another
  // replica deleted; detaching an instance must drop the dangling binding, not fail validation.
  test("replicas converge and the detach applies", () => {
    const actions = [
      { kind: "cmd", replica: 1, what: 1, a: 0, b: 13 },
      { kind: "cmd", replica: 0, what: 23, a: 0, b: 0 },
      { kind: "sync" },
      { kind: "cmd", replica: 0, what: 21, a: 0, b: 0 },
      { kind: "cmd", replica: 0, what: 0, a: 0, b: 0 },
    ] as never
    const r = run(actions, 0, anyCommand)
    expect(r.da).toBe(r.db)
    const unknown = validate(r.doc).errors.filter((e) => !CONFLICT_CODES.has(e.code))
    expect(unknown).toEqual([])
  })
})

describe("undo after a concurrent set of the same variable", () => {
  // Found by the property test: both replicas rewrote a variable's value (setCell); the loser's
  // undo deleted the winner's value instead of restoring the previous one, so the variable
  // vanished and bindings to it dangled.
  test("the variable survives and replicas converge", () => {
    const actions = [
      { kind: "cmd", replica: 1, what: 11, a: 0, b: 0 },
      { kind: "cmd", replica: 0, what: 11, a: 0, b: 0 },
      { kind: "cmd", replica: 0, what: 1, a: 15083110, b: 471514655 },
      { kind: "sync" },
      { kind: "undo", replica: 1 },
    ] as never
    const r = run(actions, 0, safeCommand)
    expect(r.da).toBe(r.db)
    expect(validate(r.doc).errors).toEqual([])
  })
})

describe("rename of a variable with a concurrently orphaned alias", () => {
  // Found by the property test: a cell aliasing a variable another replica deleted; renaming
  // moved the dangling alias to a new key, which local validation counted as a new error.
  test("the rename applies, dropping the dangling entry", () => {
    const actions = [
      { kind: "cmd", replica: 0, what: 11, a: 0, b: 1351932425 },
      { kind: "cmd", replica: 1, what: 22, a: 0, b: 0 },
      { kind: "sync" },
      { kind: "cmd", replica: 0, what: 23, a: 0, b: 0 },
      { kind: "cmd", replica: 0, what: 0, a: 0, b: 0 },
    ] as never
    const r = run(actions, 0, anyCommand)
    expect(r.da).toBe(r.db)
    const unknown = validate(r.doc).errors.filter((e) => !CONFLICT_CODES.has(e.code))
    expect(unknown).toEqual([])
  })
})

describe("independent record keys survive a merge", () => {
  const pair = () => {
    const a = new YjsDocStore({ random: rng(1) })
    a.loadDocument(base())
    const b = new YjsDocStore({ random: rng(2) })
    b.applyUpdate(a.encodeStateAsUpdate(), "remote:a")
    return [a, b] as const
  }
  const run = (s: YjsDocStore, command: M3Command) => {
    const r = applyCommand(s, command, { origin: "user", newId: () => "Zz00000001" })
    expect(r.ok).toBe(true)
  }
  test("concurrent overrides of different paths of one instance both survive", () => {
    const [a, b] = pair()
    run(a, {
      cmd: "setOverride",
      instance: "instA00001",
      path: "title00001",
      change: { kind: "set", set: { content: "A" } },
    })
    run(b, {
      cmd: "setOverride",
      instance: "instA00001",
      path: "price00001",
      change: { kind: "set", set: { content: "B" } },
    })
    syncPair(a, b)
    const ov = (a.toDocument().nodes as Record<string, { overrides?: object }>).instA00001
      ?.overrides
    expect(ov).toEqual({
      price00001: { set: { content: "B" } },
      title00001: { set: { content: "A" } },
    })
    expect(serialize(a.toDocument())).toBe(serialize(b.toDocument()))
    // Resetting one keeps the other; resetting both removes the field.
    run(a, { cmd: "resetOverride", instance: "instA00001", path: "title00001" })
    run(b, { cmd: "resetOverride", instance: "instA00001", path: "price00001" })
    syncPair(a, b)
    const after = (a.toDocument().nodes as Record<string, Record<string, unknown>>).instA00001
    expect(after && "overrides" in after).toBe(false)
  })
  test("concurrent args of different props and two library links both survive", () => {
    const [a, b] = pair()
    run(a, { cmd: "setArgs", instance: "instB00001", args: { label: "Hi" } })
    run(b, { cmd: "setArgs", instance: "instB00001", args: { dim: "half" } })
    a.apply([{ op: "setHeader", set: { imports: { ui: "./ui.kimo" } } }], { origin: "user" })
    b.apply([{ op: "setHeader", set: { imports: { mkt: "./mkt.kimo" } } }], { origin: "user" })
    syncPair(a, b)
    const d = a.toDocument()
    expect((d.nodes as Record<string, { args?: object }>).instB00001?.args).toEqual({
      dim: "half",
      label: "Hi",
    })
    expect(d.imports).toEqual({ mkt: "./mkt.kimo", ui: "./ui.kimo" })
    expect(serialize(d)).toBe(serialize(b.toDocument()))
  })
})

describe("known semantic conflict: concurrent aliases forming a cycle", () => {
  test("each side is acyclic; the merge converges and reports VARIABLE_CYCLE (documented)", () => {
    const a = new YjsDocStore({ random: rng(3) })
    a.loadDocument(base())
    const b = new YjsDocStore({ random: rng(4) })
    b.applyUpdate(a.encodeStateAsUpdate(), "remote:a")
    const opts = { origin: "user" as const }
    expect(
      applyCommand(a, { cmd: "setVariableValue", name: "ink", value: { $ref: "surface" } }, opts)
        .ok,
    ).toBe(true)
    expect(
      applyCommand(b, { cmd: "setVariableValue", name: "surface", value: { $ref: "ink" } }, opts)
        .ok,
    ).toBe(true)
    syncPair(a, b)
    expect(serialize(a.toDocument())).toBe(serialize(b.toDocument()))
    // Spec §18: a post-merge alias cycle is a known conflict, not repaired automatically; the
    // resolver guards it (VARIABLE_CYCLE) and the editor keeps accepting other edits.
    expect(validate(a.toDocument()).errors.map((e) => e.code)).toContain("VARIABLE_CYCLE")
    expect(a.apply([{ op: "update", id: "page000001", set: { name: "P" } }], opts).ok).toBe(true)
  })
})
