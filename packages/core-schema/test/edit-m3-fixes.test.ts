/**
 * Regression tests for the M3 QA findings on components: cycles through nested swaps and
 * instance-prop args, stale deep overrides after a nested swap, linked-library read-only.
 */
import { describe, expect, test } from "bun:test"
import {
  applyPlan,
  createExpandedView,
  documentLookup,
  type KimoDocument,
  type Plan,
  type PlanContext,
  planDeclareProp,
  planDetachInstance,
  planSetArgs,
  planSetComponentDescription,
  planSetOverride,
  planSetSlot,
  planSwapInstance,
  planUnlinkLibrary,
  validate,
} from "../src/index"
import { codes, doc } from "./helpers"

let seq = 0
const ctxOf = (d: KimoDocument, libraries: PlanContext["libraries"] = {}): PlanContext => ({
  doc: d,
  libraries,
  newId: () => `fix${String(seq++).padStart(7, "0")}`,
})

function apply(d: KimoDocument, p: Plan): KimoDocument {
  if (!p.ok) throw new Error(`${p.error.code}: ${p.error.message}`)
  const out = applyPlan(d, p.ops)
  const r = validate(out)
  if (r.errors.length) throw new Error(JSON.stringify(r.errors, null, 1))
  return out
}

/** Star / Heart icons, a Card main nesting a Star icon, and one card instance. */
const fixture = () =>
  doc({
    starmain01: { type: "frame", parent: null, order: "a0", w: 24, h: 24, component: true },
    starglyph1: { type: "rect", parent: "starmain01", order: "a0", w: 16, h: 16 },
    heartmain1: { type: "frame", parent: null, order: "a1", w: 24, h: 24, component: true },
    main000001: {
      type: "frame",
      parent: null,
      order: "a2",
      name: "Card/Pricing",
      component: { props: { icon: { type: "instance", target: "icon000001", order: "a0" } } },
    },
    title00001: { type: "text", parent: "main000001", order: "a0", content: "Plan" },
    icon000001: { type: "instance", parent: "main000001", order: "a1", of: "starmain01" },
    inst000001: { type: "instance", parent: null, order: "a3", of: "main000001" },
  })

describe("cycles through nested swaps and instance props (§9.1)", () => {
  test("a nested swap to the card's own main is refused, and the validator reports it", () => {
    const d = fixture()
    const p = planSwapInstance(ctxOf(d), "inst000001", "main000001", "icon000001")
    expect(p.ok).toBe(false)
    if (!p.ok) expect(p.error.code).toBe("CYCLE")
    const bad = applyPlan(d, [
      {
        op: "update",
        id: "inst000001",
        set: { overrides: { icon000001: { set: { of: "main000001" } } } },
      },
    ])
    expect(codes(validate(bad).errors)).toContain("INSTANCE_CYCLE")
  })

  test("an instance arg nesting the card in itself is refused, and the validator reports it", () => {
    const d = fixture()
    const p = planSetArgs(ctxOf(d), "inst000001", { icon: "main000001" })
    expect(p.ok).toBe(false)
    if (!p.ok) expect(p.error.code).toBe("CYCLE")
    const bad = applyPlan(d, [
      { op: "update", id: "inst000001", set: { args: { icon: "main000001" } } },
    ])
    expect(codes(validate(bad).errors)).toContain("INSTANCE_CYCLE")
    // A harmless swap stays valid.
    expect(() =>
      apply(d, planSetArgs(ctxOf(d), "inst000001", { icon: "heartmain1" })),
    ).not.toThrow()
  })
})

describe("nested swap drops deep overrides that no longer resolve", () => {
  test("swap → OVERRIDE_DROPPED note, valid document, detach still works", () => {
    let d = fixture()
    d = apply(
      d,
      planSetOverride(ctxOf(d), "inst000001", "icon000001/starglyph1", {
        kind: "set",
        set: { fill: "#FF0000" },
      }),
    )
    const swap = planSwapInstance(ctxOf(d), "inst000001", "heartmain1", "icon000001")
    expect(swap.ok).toBe(true)
    if (!swap.ok) return
    expect(swap.notes.map((n) => [n.code, n.key])).toEqual([
      ["OVERRIDE_DROPPED", "icon000001/starglyph1"],
    ])
    d = apply(d, swap)
    const ov = (d.nodes as Record<string, { overrides?: object }>).inst000001?.overrides
    expect(Object.keys(ov ?? {})).toEqual(["icon000001"])
    // Detach after the swap.
    expect(() => apply(d, planDetachInstance(ctxOf(d), "inst000001"))).not.toThrow()
  })

  test("validator resolves deep override keys through set.of", () => {
    const stale = applyPlan(fixture(), [
      {
        op: "update",
        id: "inst000001",
        set: {
          overrides: {
            icon000001: { set: { of: "heartmain1" } },
            "icon000001/starglyph1": { set: { fill: "#FF0000" } },
          },
        },
      },
    ])
    expect(codes(validate(stale).errors)).toContain("OVERRIDE_PATH_UNRESOLVED")
  })

  test("deep overrides into the swapped component resolve (planner and validator)", () => {
    let d = fixture()
    d = applyPlan(d, [
      { op: "insert", id: "heartglyp1", parent: "heartmain1", node: { type: "rect", w: 8, h: 8 } },
    ])
    d = apply(d, planSwapInstance(ctxOf(d), "inst000001", "heartmain1", "icon000001"))
    d = apply(
      d,
      planSetOverride(ctxOf(d), "inst000001", "icon000001/heartglyp1", {
        kind: "set",
        set: { fill: "#00FF00" },
      }),
    )
    const view = createExpandedView(documentLookup(d))
    expect(view.getNode("inst000001/icon000001/heartglyp1")?.fill).toBe("#00FF00")
    expect(view.issues("inst000001")).toEqual([])
  })

  test("a detach whose deep override went stale drops it instead of failing", () => {
    const stale = applyPlan(fixture(), [
      {
        op: "update",
        id: "inst000001",
        set: {
          overrides: {
            icon000001: { set: { of: "heartmain1" } },
            "icon000001/starglyph1": { set: { fill: "#FF0000" } },
          },
        },
      },
    ])
    const p = planDetachInstance(ctxOf(stale), "inst000001")
    expect(p.ok).toBe(true)
    if (!p.ok) return
    const out = applyPlan(stale, p.ops)
    expect(validate(out).errors).toEqual([])
    expect(p.notes.some((n) => n.code === "OVERRIDE_DROPPED")).toBe(true)
  })
})

describe("linked-library components are read-only", () => {
  test("prop / slot / description edits on alias-qualified ids → LIBRARY_READ_ONLY", () => {
    const d = fixture()
    const ctx = ctxOf(d)
    const plans = [
      planDeclareProp(ctx, "ui:button01", "x", { type: "text", target: "t", field: "content" }),
      planSetSlot(ctx, "ui:frame0001", { suggested: [] }),
      planSetComponentDescription(ctx, "ui:button01", "x"),
    ]
    for (const p of plans) {
      expect(p.ok).toBe(false)
      if (!p.ok) expect(p.error.code).toBe("LIBRARY_READ_ONLY")
    }
  })
})

describe("expansion: precedence and budget", () => {
  test("an outer slot on a deep path wins over the nested instance's own replace", () => {
    const d = doc({
      btn0000001: { type: "frame", parent: null, order: "a0", component: true },
      slotframe1: { type: "frame", parent: "btn0000001", order: "a0", slot: {} },
      card000001: { type: "frame", parent: null, order: "a1", component: true },
      nested0001: {
        type: "instance",
        parent: "card000001",
        order: "a0",
        of: "btn0000001",
        overrides: { slotframe1: { replace: true } },
      },
      innerrep01: {
        type: "text",
        parent: "nested0001",
        at: "slotframe1",
        order: "a0",
        content: "inner",
      },
      inst000001: {
        type: "instance",
        parent: null,
        order: "a2",
        of: "card000001",
        overrides: { "nested0001/slotframe1": { slot: true } },
      },
      outerslt01: {
        type: "text",
        parent: "inst000001",
        at: "nested0001/slotframe1",
        order: "a0",
        content: "outer",
      },
    })
    expect(validate(d).errors).toEqual([])
    const view = createExpandedView(documentLookup(d))
    const nested = "inst000001/nested0001"
    const kids = view.children(nested)
    expect(kids).toEqual([`${nested}/slotframe1`])
    expect(view.children(`${nested}/slotframe1`)).toEqual(["outerslt01"])
    expect(view.issues("inst000001")).toEqual([])
  })

  test("exponential fan-out is cut at the budget with INSTANCE_TOO_LARGE", () => {
    const nodes: Record<string, unknown> = {}
    const N = 18
    for (let i = 0; i < N; i++) {
      const id = `comp${String(i).padStart(6, "0")}`
      nodes[id] = { type: "frame", parent: null, order: `a${i}`, component: true }
      if (i > 0)
        for (const k of [0, 1])
          nodes[`in${i}x${k}`.padEnd(10, "0")] = {
            type: "instance",
            parent: id,
            order: `a${k}`,
            of: `comp${String(i - 1).padStart(6, "0")}`,
          }
    }
    nodes.top0000001 = { type: "instance", parent: null, order: "b0", of: "comp000017" }
    const d = doc(nodes)
    expect(validate(d).errors).toEqual([])
    const view = createExpandedView(documentLookup(d))
    let count = 0
    const walk = (id: string) => {
      count++
      for (const c of view.children(id)) walk(c)
    }
    const t0 = performance.now()
    walk("top0000001")
    expect(performance.now() - t0).toBeLessThan(2000)
    expect(count).toBeLessThan(60_000)
    expect(view.issues("top0000001").map((i) => i.code)).toContain("INSTANCE_TOO_LARGE")
  })
})

describe("unlink at scale", () => {
  test("unlinking a library with 1k instances among 5k nodes plans in well under a second per 1k", () => {
    const lib = doc(
      {
        button0001: { type: "frame", parent: null, order: "a0", component: true, w: 80, h: 32 },
        label00001: { type: "text", parent: "button0001", order: "a0", content: "OK" },
        glyph00001: { type: "rect", parent: "button0001", order: "a1", w: 8, h: 8 },
      },
      { meta: { library: true } },
    )
    const nodes: Record<string, unknown> = {}
    for (let i = 0; i < 5000; i++)
      nodes[`r${String(i).padStart(9, "0")}`] = {
        type: "rect",
        parent: null,
        order: `a${String(i).padStart(5, "0")}`,
        w: 10,
        h: 10,
      }
    for (let i = 0; i < 1000; i++)
      nodes[`i${String(i).padStart(9, "0")}`] = {
        type: "instance",
        parent: null,
        order: `b${String(i).padStart(5, "0")}`,
        of: "ui:button0001",
      }
    const d = doc(nodes, { imports: { ui: "./ui.kimo" } })
    const t0 = performance.now()
    const p = planUnlinkLibrary(ctxOf(d, { ui: lib }), "ui")
    const ms = performance.now() - t0
    console.log(`unlink 1k instances / 6k nodes: ${ms.toFixed(0)} ms`)
    expect(p.ok).toBe(true)
    expect(ms).toBeLessThan(2000)
    if (!p.ok) return
    const out = applyPlan(d, p.ops)
    expect(Object.values(out.nodes).some((n) => (n as { type: string }).type === "instance")).toBe(
      false,
    )
  })
})
