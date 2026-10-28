/** Component workflows: enum targets, Replace main with selection, fixing broken overrides. */
import { describe, expect, test } from "bun:test"
import {
  applyPlan,
  BROKEN_OVERRIDES_META_KEY,
  brokenOverrides,
  createExpandedView,
  documentLookup,
  type KimoDocument,
  type OverrideFix,
  type OverrideFixRequest,
  parse,
  planDetachInstance,
  planFixOverrides,
  planReplaceMain,
  remapCandidates,
  replaceMainPreview,
  validate,
} from "../src/index"
import { doc, readFixture } from "./helpers"

const ctxOf = (d: KimoDocument) => {
  let i = 0
  return { doc: d, newId: () => `NewNode${String(++i).padStart(3, "0")}` }
}

describe("enum targets", () => {
  const d = parse(readFixture("valid/components-enum-targets.kimo"))

  test("one option sets several properties on several layers (struct keys keep the rest)", () => {
    const v = createExpandedView(documentLookup(d))
    const root = v.getNode("BtnLarge01") as Record<string, unknown>
    expect(root.layout).toEqual({ dir: "row", gap: 6, pad: [12, 20] })
    expect((v.getNode("BtnLarge01/BtnLabel01") as Record<string, unknown>).style).toEqual({
      size: 16,
      weight: 500,
    })
    const icon = v.getNode("BtnLarge01/BtnIcon001") as Record<string, unknown>
    expect([icon.w, icon.h]).toEqual([20, 20])
    // tone: legacy opacity target, then its own target on the label.
    expect(root.opacity).toBe(0.5)
    expect((v.getNode("BtnLarge01/BtnLabel01") as Record<string, unknown>).fill).toBe("#888888")
  })

  test("detach bakes the option's targets into plain layers", () => {
    const plan = planDetachInstance(ctxOf(d), "BtnLarge01")
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const out = applyPlan(d, plan.ops)
    expect(validate(out).errors).toEqual([])
    const nodes = Object.values(out.nodes as Record<string, Record<string, unknown>>)
    const label = nodes.find((n) => n.name === "Label" && n.parent !== "Button0001")
    expect(label?.style).toEqual({ size: 16, weight: 500 })
    const root = nodes.find((n) => n.name === "Button large")
    expect(root?.layout).toEqual({ dir: "row", gap: 6, pad: [12, 20] })
  })

  test("a target for an option the prop does not declare is PROP_TARGET_INVALID", () => {
    const n = structuredClone(d) as unknown as {
      nodes: Record<
        string,
        { component: { props: { size: { targets: Record<string, unknown> } } } }
      >
    }
    const size = n.nodes.Button0001?.component.props.size
    if (!size) throw new Error("fixture changed")
    size.targets.xl = []
    expect(validate(n as never).errors.map((e) => e.code)).toContain("PROP_TARGET_INVALID")
  })
})

describe("replace main with selection", () => {
  const base = () =>
    doc({
      Card000001: {
        type: "frame",
        parent: null,
        order: "a0",
        name: "Card",
        x: 0,
        y: 0,
        w: 200,
        fill: "#FFFFFF",
        component: { props: { title: { type: "text", target: "CardTitle1", field: "content" } } },
      },
      CardTitle1: { type: "text", parent: "Card000001", order: "a0", name: "Title", content: "T" },
      CardBadge1: { type: "text", parent: "Card000001", order: "a1", name: "Badge", content: "B" },
      CardIcon01: { type: "rect", parent: "Card000001", order: "a2", name: "Icon", w: 8, h: 8 },
      CardInst01: {
        type: "instance",
        parent: null,
        order: "a1",
        of: "Card000001",
        x: 300,
        args: { title: "Hello" },
        overrides: {
          CardBadge1: { set: { content: "New" } },
          CardIcon01: { set: { visible: false } },
        },
      },
      CardV20001: {
        type: "frame",
        parent: null,
        order: "a2",
        name: "Card v2",
        x: 600,
        w: 240,
        fill: "#000000",
      },
      V2Title001: { type: "text", parent: "CardV20001", order: "a0", name: "Title", content: "T2" },
      V2Badge001: { type: "text", parent: "CardV20001", order: "a1", name: "Label", content: "L" },
    })

  test("main keeps id, name, props and position; overrides re-keyed; unmatched stashed", () => {
    const d = base()
    // Layers are kept by name, else by type + order; the rest cannot follow.
    expect(replaceMainPreview(ctxOf(d), "Card000001", "CardV20001")).toEqual({
      instances: 1,
      kept: 1,
      unmatched: 1,
    })
    const plan = planReplaceMain(ctxOf(d), "Card000001", "CardV20001")
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const out = applyPlan(d, plan.ops)
    expect(validate(out).errors).toEqual([])
    const nodes = out.nodes as Record<string, Record<string, unknown>>
    expect(nodes.CardV20001).toBeUndefined()
    expect(nodes.CardTitle1).toBeUndefined()
    const main = nodes.Card000001 as Record<string, unknown>
    expect([main.name, main.x, main.y, main.w, main.fill]).toEqual(["Card", 0, 0, 240, "#000000"])
    expect(nodes.V2Title001?.parent).toBe("Card000001")
    // The prop target follows the title (name match).
    expect((main.component as { props: { title: { target: string } } }).props.title.target).toBe(
      "V2Title001",
    )
    const inst = nodes.CardInst01 as Record<string, unknown>
    // Badge (text, 2nd text) maps to Label (2nd text) by type + order.
    expect(inst.overrides).toEqual({ V2Badge001: { set: { content: "New" } } })
    const stash = (inst.meta as Record<string, unknown>)[BROKEN_OVERRIDES_META_KEY] as unknown[]
    expect(stash).toEqual([
      { key: "CardIcon01", override: { set: { visible: false } }, path: "Icon", type: "rect" },
    ])
    const broken = brokenOverrides(ctxOf(out), "Card000001")
    expect(broken.map((b) => `${b.instance}:${b.key}:${b.source}`)).toEqual([
      "CardInst01:CardIcon01:stash",
    ])
  })

  test("refuses an instance, the main itself and content of the main", () => {
    const d = base()
    expect(planReplaceMain(ctxOf(d), "Card000001", "CardInst01").ok).toBe(false)
    expect(planReplaceMain(ctxOf(d), "Card000001", "Card000001").ok).toBe(false)
    expect(planReplaceMain(ctxOf(d), "Card000001", "CardTitle1").ok).toBe(false)
    expect(planReplaceMain(ctxOf(d), "CardTitle1", "CardV20001").ok).toBe(false)
  })
})

describe("fix broken overrides", () => {
  const d = () =>
    doc(
      {
        Card000001: { type: "frame", parent: null, order: "a0", name: "Card", component: true },
        CardTag001: { type: "text", parent: "Card000001", order: "a0", name: "Tag", content: "x" },
        CardInst01: {
          type: "instance",
          parent: null,
          order: "a1",
          of: "Card000001",
          overrides: { CardTag001: { set: { fill: { $ref: "brand/cta" } } } },
          meta: {
            [BROKEN_OVERRIDES_META_KEY]: [
              {
                key: "GoneLabel1",
                override: { set: { content: "New" } },
                path: "Tag",
                type: "text",
              },
            ],
          },
        },
      },
      { variables: { "brand/accent": { type: "color", value: "#FF0000" } } },
    )

  /** The two broken rows of `d()`: a stashed layer override and a missing variable. */
  const rows = (layerFix: OverrideFix, variableFix: OverrideFix): OverrideFixRequest[] => [
    { instance: "CardInst01", key: "GoneLabel1", kind: "layer", source: "stash", fix: layerFix },
    {
      instance: "CardInst01",
      key: "CardTag001",
      kind: "variable",
      source: "live",
      field: "fill",
      fix: variableFix,
    },
  ]

  test("lists stashed layers and missing variables, with remap suggestions", () => {
    const ctx = ctxOf(d())
    const b = brokenOverrides(ctx, "Card000001")
    expect(b.map((x) => `${x.kind}:${x.key}:${x.variable ?? ""}`)).toEqual([
      "layer:GoneLabel1:",
      "variable:CardTag001:brand/cta",
    ])
    expect(remapCandidates(ctx, b[0] as never)[0]?.value).toBe("CardTag001")
    expect(remapCandidates(ctx, b[1] as never)[0]?.value).toBe("brand/accent")
  })

  test("Remap fixes layer and variable in one op group; Keep leaves the row", () => {
    const ctx = ctxOf(d())
    const plan = planFixOverrides(
      ctx,
      rows({ action: "remap", to: "CardTag001" }, { action: "remap", to: "brand/accent" }),
    )
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const out = applyPlan(ctx.doc, plan.ops)
    const inst = (out.nodes as Record<string, Record<string, unknown>>).CardInst01 as Record<
      string,
      unknown
    >
    expect(inst.overrides).toEqual({
      CardTag001: { set: { fill: { $ref: "brand/accent" }, content: "New" } },
    })
    expect(inst.meta).toBeUndefined()
    expect(brokenOverrides(ctxOf(out), "Card000001")).toEqual([])
    const keep = planFixOverrides(ctx, rows({ action: "keep" }, { action: "keep" }))
    expect(keep.ok && keep.ops.length).toBe(0)
  })

  test("Reset drops the override (and the binding's field)", () => {
    const ctx = ctxOf(d())
    const plan = planFixOverrides(ctx, rows({ action: "reset" }, { action: "reset" }))
    if (!plan.ok) throw new Error("plan")
    const inst = (applyPlan(ctx.doc, plan.ops).nodes as Record<string, Record<string, unknown>>)
      .CardInst01 as Record<string, unknown>
    expect(inst.overrides).toBeUndefined()
    expect(inst.meta).toBeUndefined()
  })
})
