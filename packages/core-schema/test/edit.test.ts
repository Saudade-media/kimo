import { describe, expect, test } from "bun:test"
import {
  applyPlan,
  axisDisplayOrder,
  createExpandedView,
  documentLookup,
  type KimoDocument,
  type Plan,
  type PlanContext,
  planAddAxisValue,
  planCreateAxis,
  planCreateComponent,
  planCreateInstance,
  planCreateVariable,
  planDeclareProp,
  planDeleteAxis,
  planDeleteVariable,
  planDetachInstance,
  planHideInInstance,
  planLinkLibrary,
  planMoveAxisValue,
  planRemoveAxisValue,
  planRemoveProp,
  planRenameAxisValue,
  planRenameVariable,
  planReorderProp,
  planResetAll,
  planResetOverride,
  planSetArgs,
  planSetCell,
  planSetComponentDescription,
  planSetOverride,
  planSetSlot,
  planSetThemePin,
  planSwapInstance,
  planUnlinkLibrary,
  planUpdateProp,
  planUpdateVariable,
  serialize,
  validate,
} from "../src/index"
import { doc, loadFixture, uiLibrary } from "./helpers"

let seq = 0
const ctxOf = (d: KimoDocument, libraries = {}): PlanContext => ({
  doc: d,
  libraries,
  newId: () => `new${String(seq++).padStart(7, "0")}`,
})

/** Applies a plan and asserts the result validates (errors only). */
function apply(d: KimoDocument, p: Plan, libraries = {}): KimoDocument {
  if (!p.ok) throw new Error(`${p.error.code}: ${p.error.message}`)
  const out = applyPlan(d, p.ops)
  const r = validate(out, { libraries })
  if (r.errors.length) throw new Error(JSON.stringify(r.errors, null, 1))
  expect(() => serialize(out)).not.toThrow()
  return out
}

const base = () =>
  doc(
    {
      page000001: { type: "frame", parent: null, order: "a0", name: "Page" },
      card000001: {
        type: "frame",
        parent: "page000001",
        order: "a0",
        name: "Card",
        layout: { dir: "column" },
      },
      title00001: { type: "text", parent: "card000001", order: "a0", content: "Plan name" },
      price00001: { type: "text", parent: "card000001", order: "a1", content: "$0" },
      actions001: { type: "frame", parent: "card000001", order: "a2", layout: { dir: "column" } },
      cta0000001: { type: "text", parent: "actions001", order: "a0", content: "Call to action" },
      other00001: { type: "rect", parent: "page000001", order: "a1", w: 10, h: 10 },
    },
    { themes: { mode: ["light", "dark"], density: ["comfortable", "compact"] } },
  )

describe("components: create, instance, overrides (boards 11/12)", () => {
  test("create component in place, then instances with overrides of every kind", () => {
    let d = base()
    d = apply(d, planCreateComponent(ctxOf(d), ["card000001"]))
    expect((d.nodes.card000001 as { component?: unknown }).component).toBe(true)
    d = apply(d, planSetSlot(ctxOf(d), "actions001", { suggested: ["card000001"] }))
    d = apply(
      d,
      planDeclareProp(ctxOf(d), "card000001", "label", {
        type: "text",
        target: "title00001",
        field: "content",
      }),
    )
    d = apply(
      d,
      planDeclareProp(ctxOf(d), "card000001", "dim", {
        type: "enum",
        target: "card000001",
        field: "opacity",
        options: { half: 0.5 },
      }),
    )
    d = apply(
      d,
      planDeclareProp(ctxOf(d), "card000001", "actions", { type: "slot", target: "actions001" }),
    )
    d = apply(
      d,
      planCreateInstance(ctxOf(d), "card000001", { parent: "page000001", id: "inst000001" }),
    )
    d = apply(d, planSetArgs(ctxOf(d), "inst000001", { label: "Pro", dim: "half" }))
    d = apply(
      d,
      planSetOverride(ctxOf(d), "inst000001", "", { kind: "set", set: { fill: "#FFFFFF" } }),
    )
    d = apply(
      d,
      planSetOverride(ctxOf(d), "inst000001", "price00001", {
        kind: "replace",
        id: "rep0000001",
        node: { type: "text", content: "$49" },
      }),
    )
    d = apply(
      d,
      planSetOverride(ctxOf(d), "inst000001", "actions001", {
        kind: "slot",
        content: [{ id: "slot000001", node: { type: "text", content: "Buy" } }],
      }),
    )
    d = apply(d, planHideInInstance(ctxOf(d), "inst000001", "cta0000001"))
    const v = createExpandedView(documentLookup(d), { header: () => d })
    expect(v.getNode("inst000001")).toMatchObject({ fill: "#FFFFFF", opacity: 0.5 })
    expect(v.getNode("inst000001/title00001")?.content).toBe("Pro")
    expect(v.children("inst000001")).toEqual([
      "inst000001/title00001",
      "rep0000001",
      "inst000001/actions001",
    ])
    expect(v.children("inst000001/actions001")).toEqual(["slot000001"])

    // Declaration order is creation order; reorder moves `actions` first.
    d = apply(d, planReorderProp(ctxOf(d), "card000001", "actions", "label"))
    const props = (
      d.nodes.card000001 as { component: { props: Record<string, { order: string }> } }
    ).component.props
    const order = Object.entries(props)
      .sort((a, b) => (a[1].order < b[1].order ? -1 : 1))
      .map(([k]) => k)
    expect(order).toEqual(["actions", "label", "dim"])

    // Rename a prop: instance args follow.
    d = apply(d, planUpdateProp(ctxOf(d), "card000001", "label", { rename: "title" }))
    expect((d.nodes.inst000001 as { args: Record<string, unknown> }).args).toEqual({
      title: "Pro",
      dim: "half",
    })
    // Resets.
    d = apply(d, planResetOverride(ctxOf(d), "inst000001", "price00001"))
    expect(d.nodes.rep0000001).toBeUndefined()
    d = apply(d, planResetOverride(ctxOf(d), "inst000001", "", { fields: ["fill"] }))
    expect((d.nodes.inst000001 as { props?: unknown }).props).toBeUndefined()
    d = apply(d, planRemoveProp(ctxOf(d), "card000001", "dim"))
    expect((d.nodes.inst000001 as { args: Record<string, unknown> }).args).toEqual({ title: "Pro" })
    d = apply(d, planSetComponentDescription(ctxOf(d), "card000001", "Pricing tier card"))
    expect((d.nodes.card000001 as { meta: Record<string, unknown> }).meta).toEqual({
      "kimo.component.description": "Pricing tier card",
    })
    // Turning the slot off needs consent while instances hold content.
    const refused = planSetSlot(ctxOf(d), "actions001", null)
    expect(refused.ok === false && refused.error.code).toBe("IN_USE")
    d = apply(d, planSetSlot(ctxOf(d), "actions001", null, { deleteContent: true }))
    expect(d.nodes.slot000001).toBeUndefined()
    d = apply(d, planResetAll(ctxOf(d), "inst000001"))
    expect(Object.keys(d.nodes.inst000001 as object).sort()).toEqual([
      "of",
      "order",
      "parent",
      "type",
    ])
  })

  test("several siblings are wrapped in a new main", () => {
    const d = base()
    const p = planCreateComponent(ctxOf(d), ["title00001", "price00001"], {
      wrap: { x: 0, y: 0, w: 100, h: 40, name: "Header" },
    })
    const out = apply(d, p)
    const id = p.ok ? (p.select?.[0] as string) : ""
    expect(out.nodes[id]).toMatchObject({ type: "frame", component: true, name: "Header" })
    expect(out.nodes.title00001?.parent).toBe(id)
  })

  test("swap keeps what still resolves and drops the rest", () => {
    let d = base()
    d = apply(d, planCreateComponent(ctxOf(d), ["card000001"]))
    d = apply(d, planCreateComponent(ctxOf(d), ["other00001"]))
    d = apply(d, planCreateInstance(ctxOf(d), "card000001", { parent: null, id: "inst000002" }))
    d = apply(
      d,
      planSetOverride(ctxOf(d), "inst000002", "title00001", { kind: "set", set: { content: "x" } }),
    )
    const p = planSwapInstance(ctxOf(d), "inst000002", "other00001")
    d = apply(d, p)
    expect(p.ok && p.notes.map((n) => n.code)).toEqual(["OVERRIDE_DROPPED"])
    expect(d.nodes.inst000002).toMatchObject({ of: "other00001" })
  })
})

describe("detach (one level, provenance-preserving)", () => {
  test("a local instance becomes plain layers; owned nodes are moved, not copied", () => {
    let d = base()
    d = apply(d, planCreateComponent(ctxOf(d), ["card000001"]))
    d = apply(d, planSetSlot(ctxOf(d), "actions001", {}))
    d = apply(d, planCreateInstance(ctxOf(d), "card000001", { parent: null, id: "inst000003" }))
    d = apply(
      d,
      planSetOverride(ctxOf(d), "inst000003", "title00001", {
        kind: "set",
        set: { content: "Team" },
      }),
    )
    d = apply(
      d,
      planSetOverride(ctxOf(d), "inst000003", "actions001", {
        kind: "slot",
        content: [{ id: "slot000002", node: { type: "text", content: "Talk" } }],
      }),
    )
    const before = createExpandedView(documentLookup(d), { header: () => d })
    const p = planDetachInstance(ctxOf(d), "inst000003")
    d = apply(d, p)
    const root = p.ok ? (p.select?.[0] as string) : ""
    expect(d.nodes.inst000003).toBeUndefined()
    expect(d.nodes[root]).toMatchObject({ type: "frame", name: "Card", parent: null })
    const kids = Object.entries(d.nodes).filter(([, n]) => n.parent === root)
    const title = kids.find(
      ([, n]) => n.type === "text" && (n as { content?: string }).content === "Team",
    )
    expect(title).toBeDefined()
    const slotFrame = kids.find(([, n]) => n.type === "frame")?.[0] as string
    expect(d.nodes.slot000002?.parent).toBe(slotFrame)
    expect((d.nodes.slot000002 as { at?: string }).at).toBeUndefined()
    expect((d.nodes[slotFrame] as { slot?: unknown }).slot).toBeUndefined()
    expect(before.getNode("inst000003/title00001")?.content).toBe("Team")
  })

  test("library instances (10.5 example) detach into the consumer's namespace", () => {
    const libraries = { ui: uiLibrary() }
    let d = loadFixture("valid/example-10-5.kimo")
    const v = createExpandedView(documentLookup(d), { header: () => d, libraries })
    const label = v.getNode("D4cta00001/ui:BtnLabel01")?.content
    const p = planDetachInstance(ctxOf(d, libraries), "D4cta00001")
    d = apply(d, p, libraries)
    const root = p.ok ? (p.select?.[0] as string) : ""
    const texts = Object.values(d.nodes).filter((n) => n.type === "text" && n.parent === root)
    expect(texts.map((t) => (t as { content?: unknown }).content)).toContain(label)
    // Bindings from library content point into the library.
    expect(JSON.stringify(d.nodes[root])).not.toMatch(/"\$ref":"(?!ui:)[^"]*"(?=.*)/)
  })

  test("unlink detaches every library instance and removes the import", () => {
    const libraries = { ui: uiLibrary() }
    const d = loadFixture("valid/example-10-5.kimo")
    const p = planUnlinkLibrary(ctxOf(d, libraries), "ui")
    const out = apply(d, p, libraries)
    expect(out.imports).toBeUndefined()
    expect(serialize(out)).not.toContain('"ui:')
    expect(validate(out).ok).toBe(true)
    const refused = planUnlinkLibrary(ctxOf(d), "ui")
    expect(refused.ok === false && refused.error.code).toBe("LIBRARY_NOT_LOADED")
  })

  test("link / relink validate the alias and path", () => {
    const d = base()
    const out = apply(d, planLinkLibrary(ctxOf(d), "mkt", "../brand/marketing.kimo"))
    expect(out.imports).toEqual({ mkt: "../brand/marketing.kimo" })
    const bad = planLinkLibrary(ctxOf(out), "mkt", "/abs/path.kimo")
    expect(bad.ok).toBe(false)
  })
})

describe("variables and themes (board 14)", () => {
  const withVars = () => {
    let d = base()
    d = apply(d, planCreateVariable(ctxOf(d), "ink-900", { type: "color", value: "#2A1E14" }))
    d = apply(d, planCreateVariable(ctxOf(d), "surface/card", { type: "color", value: "#FFFFFF" }))
    d = apply(d, planSetCell(ctxOf(d), "surface/card", "mode", "dark", { $ref: "ink-900" }))
    d = apply(d, planSetCell(ctxOf(d), "surface/card", "density", "compact", "#EEEEEE"))
    return apply(
      d,
      planUpdateVariable(ctxOf(d), "surface/card", {
        group: "color.surface",
        description: "Cards",
      }),
    )
  }

  test("cells become themed entries; clearing collapses back", () => {
    const d = withVars()
    expect(d.variables?.["surface/card"]).toEqual({
      type: "color",
      value: [
        { value: "#FFFFFF" },
        { value: { $ref: "ink-900" }, when: { mode: "dark" } },
        { value: "#EEEEEE", when: { density: "compact" } },
      ],
      group: "color.surface",
      description: "Cards",
    })
    let e = apply(d, planSetCell(ctxOf(d), "surface/card", "mode", "dark", undefined))
    e = apply(e, planSetCell(ctxOf(e), "surface/card", "density", "compact", undefined))
    expect(e.variables?.["surface/card"]?.value).toBe("#FFFFFF")
  })

  test("alias cycles are refused", () => {
    const d = withVars()
    const p = planUpdateVariable(ctxOf(d), "ink-900", { value: { $ref: "surface/card" } })
    expect(p.ok === false && p.error.code).toBe("CYCLE")
  })

  test("rename rewrites bindings; delete needs detach while bound", () => {
    let d = withVars()
    d = {
      ...d,
      nodes: { ...d.nodes, other00001: { ...d.nodes.other00001, fill: { $ref: "ink-900" } } },
    } as KimoDocument
    d = apply(d, planRenameVariable(ctxOf(d), "ink-900", "ink/900"))
    expect((d.nodes.other00001 as { fill?: unknown }).fill).toEqual({ $ref: "ink/900" })
    expect(JSON.stringify(d.variables)).toContain('"$ref":"ink/900"')
    expect(planDeleteVariable(ctxOf(d), "ink/900").ok).toBe(false)
    d = apply(d, planDeleteVariable(ctxOf(d), "ink/900", { detach: true }))
    expect((d.nodes.other00001 as { fill?: unknown }).fill).toBe("#2A1E14")
  })

  test("axis values: add, rename, make default, remove; axes: create, delete; pins", () => {
    let d = withVars()
    d = apply(d, planSetThemePin(ctxOf(d), "page000001", "mode", "dark"))
    d = apply(d, planRenameAxisValue(ctxOf(d), "mode", "dark", "night"))
    expect(d.nodes.page000001?.theme).toEqual({ mode: "night" })
    expect(JSON.stringify(d.variables)).toContain('"mode":"night"')
    d = apply(d, planAddAxisValue(ctxOf(d), "mode", "dim"))
    d = apply(d, planMoveAxisValue(ctxOf(d), "mode", "dim", 0))
    expect(d.themes?.mode).toEqual(["dim", "light", "night"])
    expect(planRemoveAxisValue(ctxOf(d), "mode", "night").ok).toBe(false)
    d = apply(d, planRemoveAxisValue(ctxOf(d), "mode", "night", { force: true }))
    expect(d.nodes.page000001?.theme).toBeUndefined()
    d = apply(d, planCreateAxis(ctxOf(d), "brand", ["kimo", "acme"]))
    expect(axisDisplayOrder(d)).toEqual(["density", "mode", "brand"])
    expect((d.meta as Record<string, unknown>)["kimo.themes.order"]).toEqual([
      "density",
      "mode",
      "brand",
    ])
    d = apply(d, planDeleteAxis(ctxOf(d), "density"))
    expect(d.variables?.["surface/card"]?.value).toBe("#FFFFFF")
    expect(planSetThemePin(ctxOf(d), "page000001", "brand", "nope").ok).toBe(false)
  })
})
