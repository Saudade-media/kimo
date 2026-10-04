/**
 * Incremental validation (the default) must make the same accept/reject decisions as validating
 * the whole candidate document per op group, through edits, undo/redo and remote updates.
 */
import { describe, expect, test } from "bun:test"
import { jsonEqual, type KimoDocument, SCHEMA_URL, validate } from "@kimo/core-schema"
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
      what: fc.nat(16),
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
  ["x", 12],
  ["visible", false],
  ["h", { mode: "fill" }],
  ["theme", { mode: "light" }],
  // Overrides (themed-components ids): a set, a slot, a replace without content, a swap.
  ["overrides", { Rect000001: { set: { fill: "#00FF00" } } }],
  ["overrides", { Slot000001: { slot: true } }],
  ["overrides", { Text000001: { replace: true } }],
  ["overrides", { Rect000001: { set: { w: { mode: "fill" } } }, Slot000001: { slot: true } }],
  ["overrides", { Slot000001: { set: { of: "Main000001" } } }],
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
    case 11:
      return any && other ? { op: "update", id: any, set: { of: other } } : null
    default:
      return headerOp(s, a)
  }
}

/** Same-type values per variable type (variable edits that keep names, types and aliases). */
const SAME_TYPE: Record<string, unknown[]> = {
  color: [
    "#123456",
    [{ value: "#000000", when: { mode: "light" } }],
    [
      { value: "#FFFFFF", when: { mode: "dark" } },
      { value: "#000000", when: { mode: "nope" } },
    ],
  ],
  number: [4, [{ value: 2, when: { density: "compact" } }, { value: 6 }]],
  string: ["x", [{ value: "y", when: { brand: "acme" } }]],
  boolean: [true, [{ value: false, when: { mode: "dark" } }]],
}

/** Header ops: theme reorders, same-type variable values, and edits that need a full check. */
function headerOp(s: YjsDocStore, a: Extract<Action, { kind: "op" }>): Op | null {
  const h = s.toHeader()
  const axes = Object.entries(h.themes ?? {})
  const vars = Object.entries(h.variables ?? {}) as [string, { type?: string; value?: unknown }][]
  switch (a.what) {
    case 12: {
      // Default-mode switch: an axis reordered (rotated).
      const ax = axes[a.pick % Math.max(1, axes.length)]
      if (!ax) return null
      const [axis, values] = ax as [string, string[]]
      return { op: "setThemes", set: { [axis]: [...values.slice(1), ...values.slice(0, 1)] } }
    }
    case 13:
    case 14: {
      const v = vars[a.pick % Math.max(1, vars.length)]
      if (!v) return null
      const [name, def] = v
      const options = SAME_TYPE[String(def.type)] ?? []
      const value = options[a.value % Math.max(1, options.length)]
      if (value === undefined) return null
      return { op: "setVariables", set: { [name]: { ...def, value } } } as unknown as Op
    }
    case 15: {
      // A type change, an alias, or a new variable: full validation.
      const v = vars[a.pick % Math.max(1, vars.length)]
      const other = vars[a.target % Math.max(1, vars.length)]
      if (!v || !other) return null
      const [name, def] = v
      return a.value % 3 === 0
        ? { op: "setVariables", set: { [name]: { ...def, type: "number", value: 1 } } }
        : a.value % 3 === 1
          ? ({
              op: "setVariables",
              set: { [name]: { ...def, value: { $ref: other[0] } } },
            } as unknown as Op)
          : { op: "setVariables", set: { [`new${counter}`]: { type: "color", value: "#000" } } }
    }
    default: {
      // An axis value added (full validation).
      const ax = axes[a.pick % Math.max(1, axes.length)]
      if (!ax) return null
      const [axis, values] = ax as [string, string[]]
      return { op: "setThemes", set: { [axis]: [...values, `v${counter}`] } }
    }
  }
}

const errorKeys = (r: ApplyResult) =>
  r.ok ? [] : r.errors.map((e) => `${e.code}:${e.issue?.code ?? ""}:${e.issue?.path ?? ""}`).sort()
/** Usage lints are document-level: incremental runs skip them by design (see ValidateOptions). */
const DOCUMENT_LINTS = new Set(["VARIABLE_UNUSED", "ASSET_UNUSED"])
const warningKeys = (r: ApplyResult) =>
  r.ok
    ? r.warnings
        .filter((w) => !DOCUMENT_LINTS.has(w.code))
        .map((w) => `${w.code}:${w.path}`)
        .sort()
    : []

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
      expect(warningKeys(ri)).toEqual(warningKeys(rf))
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

/**
 * Instances of a main inside a fit auto-layout (the fit lint reads the main root's sizes),
 * overrides into the main, and bindings to a variable with no `dark` entry under frames that
 * random ops pin (THEME_NO_MATCH below a pin).
 */
const themedComponents = (): KimoDocument =>
  ({
    $schema: SCHEMA_URL,
    format: "1.0.0",
    themes: { mode: ["light", "dark"] },
    variables: {
      ink: { type: "color", value: [{ value: "#000000", when: { mode: "light" } }] },
    },
    nodes: {
      Page000001: {
        type: "frame",
        name: "Row",
        parent: null,
        order: "a0",
        layout: { dir: "row" },
      },
      Main000001: {
        type: "frame",
        name: "Main",
        parent: null,
        order: "a1",
        component: true,
        w: 40,
        h: 20,
        layout: { dir: "column" },
      },
      Text000001: {
        type: "text",
        parent: "Main000001",
        order: "a0",
        content: "Hi",
        fill: { $ref: "ink" },
      },
      Rect000001: {
        type: "rect",
        parent: "Main000001",
        order: "a1",
        w: 10,
        h: 10,
        fill: { $ref: "ink" },
      },
      Slot000001: { type: "frame", parent: "Main000001", order: "a2", slot: {} },
      Inst000001: {
        type: "instance",
        parent: "Page000001",
        order: "a0",
        of: "Main000001",
        overrides: { Rect000001: { set: { fill: "#FF0000" } } },
      },
      Inst000002: { type: "instance", parent: "Page000001", order: "a1", of: "Main000001" },
      Grp0000001: { type: "frame", name: "Group", parent: null, order: "a2" },
      Rect000002: {
        type: "rect",
        parent: "Grp0000001",
        order: "a0",
        w: 10,
        h: 10,
        fill: { $ref: "ink" },
      },
      Inst000003: { type: "instance", parent: "Grp0000001", order: "a1", of: "Main000001" },
    },
  }) as unknown as KimoDocument

describe("incremental validation", () => {
  test("the themed components start is a valid document", () => {
    expect(validate(themedComponents()).errors).toEqual([])
  })
  const starts: [string, (validation: "incremental" | "full") => YjsDocStore][] = [
    ["empty", (validation) => emptyStore({ validation, jitter: 0 })],
    [
      "components-local",
      (validation) =>
        createDocStore(fixture("components-local.kimo"), { validation, jitter: 0, random: rng(3) }),
    ],
    [
      "themed-components",
      (validation) => createDocStore(themedComponents(), { validation, jitter: 0, random: rng(3) }),
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

  test("document-level lints survive a scoped header edit (no new warnings on the next full run)", () => {
    const doc = themedComponents() as unknown as { variables: Record<string, unknown> }
    doc.variables.unused = { type: "color", value: "#111111" }
    const update = createDocStore(doc as unknown as KimoDocument, {
      validation: "full",
      jitter: 0,
      random: rng(3),
    }).encodeStateAsUpdate()
    const [inc, full] = (["incremental", "full"] as const).map((validation) => {
      const s = new YjsDocStore({ validation, jitter: 0, random: rng(3) })
      s.applyUpdate(update, "remote")
      return s
    }) as [YjsDocStore, YjsDocStore]
    const ops: Op[] = [
      { op: "update", id: "Page000001", set: { w: 5 } },
      // Keeps names, types and aliases: validated as a scoped header edit.
      { op: "setVariables", set: { unused: { type: "color", value: "#222222" } } },
      // Structure inside a main: a full validation.
      { op: "insert", id: "IvLint0001", node: rect("lint"), parent: "Main000001" },
    ]
    // All warnings, document-level lints included (unlike `warningKeys`).
    const all = (r: ApplyResult) =>
      r.ok ? r.warnings.map((w) => `${w.code}:${w.path}`).sort() : []
    const fullRuns = inc.validationRuns.full
    for (const op of ops) {
      const a = inc.apply(op, { origin: "user" })
      const b = full.apply(op, { origin: "user" })
      expect(a.ok).toBe(true)
      expect(b.ok).toBe(true)
      expect(all(a)).toEqual(all(b))
    }
    // The setVariables step really was scoped, and the insert really was a full run.
    expect(inc.validationRuns.scoped).toBeGreaterThan(0)
    expect(inc.validationRuns.full).toBeGreaterThan(fullRuns)
  })

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

describe("incremental validation reach (M3 perf: 1k instances)", () => {
  /** A 30-node main, 1,000 instances (500 in one group), 2,000 plain rects. */
  const big = () => {
    const nodes: Record<string, Record<string, unknown>> = {
      MainRoot01: {
        type: "frame",
        name: "Main",
        parent: null,
        order: "a0",
        component: true,
        layout: { dir: "column" },
      },
      GroupA0001: { type: "frame", name: "A", parent: null, order: "a1" },
      GroupB0001: { type: "frame", name: "B", parent: null, order: "a2" },
    }
    for (let i = 0; i < 29; i++)
      nodes[`MainKid${String(i).padStart(3, "0")}`] = {
        type: "rect",
        parent: "MainRoot01",
        order: `a${String(i).padStart(3, "0")}`,
        w: 10,
        h: 10,
        fill: { $ref: "ink" },
      }
    for (let i = 0; i < 1000; i++)
      nodes[`Inst${String(i).padStart(6, "0")}`] = {
        type: "instance",
        parent: i < 500 ? "GroupA0001" : "GroupB0001",
        order: `a${String(i).padStart(4, "0")}`,
        of: "MainRoot01",
        x: i,
      }
    for (let i = 0; i < 2000; i++)
      nodes[`Plain${String(i).padStart(5, "0")}`] = {
        type: "rect",
        parent: "GroupB0001",
        order: `b${String(i).padStart(4, "0")}`,
        w: 4,
        h: 4,
      }
    return {
      $schema: SCHEMA_URL,
      format: "1.0.0",
      themes: { mode: ["light", "dark"] },
      variables: {
        ink: {
          type: "color",
          value: [
            { value: "#000000", when: { mode: "light" } },
            { value: "#FFFFFF", when: { mode: "dark" } },
          ],
        },
      },
      nodes,
    } as unknown as KimoDocument
  }

  test("visual edits inside a main, instance moves and theme pins validate their reach only", () => {
    const s = createDocStore(big(), { jitter: 0, random: rng(3) })
    const runs = s.validationRuns
    // Warm-up: the first apply builds the baseline (one full run).
    expect(s.apply({ op: "update", id: "Plain00000", set: { w: 5 } }, { origin: "user" }).ok).toBe(
      true,
    )
    const full0 = runs.full
    const edits: Op[] = [
      { op: "update", id: "MainKid005", set: { fill: "#FF0000" } },
      { op: "update", id: "MainKid002", set: { w: 16 } },
      { op: "update", id: "Inst000013", set: { x: -37 } },
      { op: "update", id: "GroupA0001", set: { theme: { mode: "dark" } } },
      { op: "update", id: "GroupA0001", unset: ["theme"] },
      // Variables dialog: a value edited, the default mode switched.
      {
        op: "setVariables",
        set: {
          ink: {
            type: "color",
            value: [
              { value: "#111111", when: { mode: "light" } },
              { value: "#EEEEEE", when: { mode: "dark" } },
            ],
          },
        },
      },
      { op: "setThemes", set: { mode: ["dark", "light"] } },
    ]
    for (const op of edits) {
      expect(s.apply(op, { origin: "user" }).ok).toBe(true)
      expect(s.undo("user").ok).toBe(true)
      expect(s.redo("user").ok).toBe(true)
    }
    // No whole-document validation for the edits themselves. Undoing / redoing a header edit
    // re-checks the baseline in full once (the header observer cannot tell what changed).
    expect(runs.full - full0).toBeLessThanOrEqual(4)
    // The last redo was a header edit: the next apply re-checks the baseline once, then edits
    // (header edits included) validate their reach only.
    expect(s.apply(edits[0] as Op, { origin: "user" }).ok).toBe(true)
    const full1 = runs.full
    for (const op of edits) expect(s.apply(op, { origin: "user" }).ok).toBe(true)
    expect(runs.full).toBe(full1)
    // A theme pin re-checks its subtree (500 instances); the rest a handful of nodes.
    expect(runs.scopedNodes).toBeLessThan(25 * 600)
    // Structure inside a main still reaches across the tree.
    expect(
      s.apply({ op: "move", id: "MainKid004", parent: null, index: 0 }, { origin: "user" }).ok,
    ).toBe(true)
    expect(runs.full).toBeGreaterThan(full0)
  })
})

describe("incremental validation of override edits", () => {
  const both = () => {
    const update = createDocStore(fixture("components-local.kimo"), {
      validation: "full",
      jitter: 0,
      random: rng(3),
    }).encodeStateAsUpdate()
    return (["incremental", "full"] as const).map((validation) => {
      const s = new YjsDocStore({ validation, jitter: 0, random: rng(3) })
      s.applyUpdate(update, "remote")
      return s
    })
  }
  const same = (op: Op) => {
    const [inc, full] = both() as [YjsDocStore, YjsDocStore]
    const a = inc.apply(op, { origin: "user" })
    const b = full.apply(op, { origin: "user" })
    expect(errorKeys(a)).toEqual(errorKeys(b))
    expect(warningKeys(a)).toEqual(warningKeys(b))
    return a
  }
  const overrides = () =>
    (fixture("components-local.kimo").nodes as Record<string, { overrides?: object }>).UseTb00001
      ?.overrides as Record<string, unknown>

  test("dropping the slot override its content sits in is caught on the content", () => {
    const rest = { ...overrides() }
    delete rest.TbSlot0001
    const r = same({ op: "update", id: "UseTb00001", set: { overrides: rest } })
    expect(r.ok).toBe(false)
    expect(errorKeys(r).some((k) => k.includes("AT_WITHOUT_OVERRIDE"))).toBe(true)
  })

  test("a swap that makes a component contain itself is caught (instance cycles)", () => {
    // Swap the toolbar's first button for the toolbar itself, inside the toolbar's own main.
    const r = same({
      op: "update",
      id: "TbFirst001",
      set: { overrides: { IconGlyph1: { set: { visible: false } } } },
    })
    expect(r.ok).toBe(true)
    const swap = same({
      op: "update",
      id: "UseTb00001",
      set: { overrides: { ...overrides(), TbFirst001: { set: { of: "Toolbar001" } } } },
    })
    expect(swap.ok).toBe(false)
  })

  test("a plain override set validates the instance and its content only", () => {
    const [inc] = both() as [YjsDocStore]
    expect(
      inc.apply({ op: "update", id: "Screen0001", set: { x: 1 } }, { origin: "user" }).ok,
    ).toBe(true)
    const full0 = inc.validationRuns.full
    const r = inc.apply(
      {
        op: "update",
        id: "UseTb00001",
        set: { overrides: { ...overrides(), "TbFirst001/Badge00001": { set: { visible: true } } } },
      },
      { origin: "user" },
    )
    expect(r.ok).toBe(true)
    expect(inc.validationRuns.full).toBe(full0)
  })
})
