import { describe, expect, test } from "bun:test"
import fc from "fast-check"
import {
  applyConflictSide,
  type Conflict,
  canonicalize,
  type KimoDocument,
  listConflicts,
  MERGE_FEATURE,
  mergeDocuments,
  serialize,
  validate,
} from "../src/index"
import { doc, type Loose } from "./helpers"

const RUNS = Number(process.env.KIMO_PROPERTY_RUNS ?? 200)
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
const errorsOf = (d: unknown) => validate(d as KimoDocument, { lints: false }).errors
const kinds = (r: { conflicts: Record<string, Conflict> }) =>
  Object.values(r.conflicts)
    .map((c) => c.kind)
    .sort()

/** base/ours/theirs from a base and two mutators. */
function three(base: KimoDocument, o: (d: Loose) => void, t: (d: Loose) => void) {
  const ours = clone(base) as Loose
  const theirs = clone(base) as Loose
  o(ours)
  t(theirs)
  expect(errorsOf(ours)).toEqual([])
  expect(errorsOf(theirs)).toEqual([])
  return { base, ours: ours as KimoDocument, theirs: theirs as KimoDocument }
}

const page = (): KimoDocument =>
  doc(
    {
      Page000001: { type: "frame", parent: null, order: "a0", name: "Home", w: 1440, h: 900 },
      Hero000001: {
        type: "frame",
        parent: "Page000001",
        order: "a0",
        name: "Hero",
        fill: "#FFF7EE",
        layout: { dir: "column", gap: 8 },
      },
      Headline01: { type: "text", parent: "Hero000001", order: "a0", content: "Plan less." },
      Footer0001: { type: "frame", parent: "Page000001", order: "a1", name: "Footer" },
      Legal00001: { type: "frame", parent: "Footer0001", order: "a0", name: "Legal", w: 600 },
      LegalText1: { type: "text", parent: "Legal00001", order: "a0", content: "© Kimo" },
      BtnPrim001: {
        type: "frame",
        parent: null,
        order: "a2",
        name: "Button",
        component: {
          props: {
            label: { type: "text", target: "BtnLabel01", field: "content", default: "Button" },
          },
        },
        w: 120,
        h: 40,
      },
      BtnLabel01: { type: "text", parent: "BtnPrim001", order: "a0", content: "Button" },
      CtaBtn0001: {
        type: "instance",
        parent: "Hero000001",
        order: "a1",
        of: "BtnPrim001",
        args: { label: "Get started" },
      },
    },
    {
      meta: { name: "Marketing" },
      themes: { mode: ["light", "dark"] },
      variables: {
        brand: {
          type: "color",
          value: [
            { value: "#E8590C", when: { mode: "light" } },
            { value: "#FF8A3D", when: { mode: "dark" } },
          ],
        },
        space: { type: "number", value: 8 },
      },
    },
  )

describe("three-way merge: clean merges", () => {
  test("the page fixture is valid", () => {
    expect(errorsOf(page())).toEqual([])
  })

  test("identical sides are the identity", () => {
    const b = page()
    const r = mergeDocuments({ base: b, ours: b, theirs: b })
    expect(r.conflicts).toEqual({})
    expect(r.changes).toBe(0)
    expect(serialize(r.doc)).toBe(serialize(b))
  })

  test("one side's edits win; both sides' disjoint edits combine", () => {
    const i = three(
      page(),
      (d) => {
        d.nodes.Hero000001.fill = "#FFF4E8"
        d.nodes.CtaBtn0001.args.label = "Start now"
      },
      (d) => {
        d.nodes.Hero000001.layout.gap = 16
        d.nodes.Headline01.content = "Plan less, ship more."
        d.meta["acme.author"] = "gui"
      },
    )
    const r = mergeDocuments(i)
    expect(r.conflicts).toEqual({})
    expect(r.changes).toBe(5)
    const n = (r.doc as Loose).nodes
    expect(n.Hero000001.fill).toBe("#FFF4E8")
    expect(n.Hero000001.layout).toEqual({ dir: "column", gap: 16 })
    expect(n.CtaBtn0001.args.label).toBe("Start now")
    expect(n.Headline01.content).toBe("Plan less, ship more.")
    expect((r.doc as Loose).meta).toEqual({ name: "Marketing", "acme.author": "gui" })
    expect((r.doc as Loose).features).toBeUndefined()
    expect((r.doc as Loose).merge).toBeUndefined()
  })

  test("equal changes on both sides are not conflicts", () => {
    const i = three(
      page(),
      (d) => {
        d.nodes.Hero000001.fill = "#000000"
      },
      (d) => {
        d.nodes.Hero000001.fill = "#000000"
      },
    )
    const r = mergeDocuments(i)
    expect(r.conflicts).toEqual({})
    expect((r.doc as Loose).nodes.Hero000001.fill).toBe("#000000")
  })

  test("records merge per key: args, overrides, theme pins", () => {
    const i = three(
      page(),
      (d) => {
        d.nodes.CtaBtn0001.args = { label: "A" }
        d.nodes.CtaBtn0001.overrides = { BtnLabel01: { set: { opacity: 0.5 } } }
      },
      (d) => {
        d.nodes.CtaBtn0001.theme = { mode: "dark" }
        d.nodes.CtaBtn0001.overrides = { BtnLabel01: { set: { name: "Label" } } }
      },
    )
    const r = mergeDocuments(i)
    expect(r.conflicts).toEqual({})
    expect((r.doc as Loose).nodes.CtaBtn0001).toMatchObject({
      args: { label: "A" },
      theme: { mode: "dark" },
      overrides: { BtnLabel01: { set: { opacity: 0.5, name: "Label" } } },
    })
  })

  test("a node added on each side, and a deletion of an untouched subtree", () => {
    const i = three(
      page(),
      (d) => {
        d.nodes.NewOurs001 = { type: "rect", parent: "Hero000001", order: "a5", w: 10, h: 10 }
      },
      (d) => {
        delete d.nodes.Legal00001
        delete d.nodes.LegalText1
        d.nodes.NewTheirs1 = { type: "rect", parent: "Footer0001", order: "a1", w: 4, h: 4 }
      },
    )
    const r = mergeDocuments(i)
    expect(r.conflicts).toEqual({})
    const n = (r.doc as Loose).nodes
    expect(n.NewOurs001).toBeDefined()
    expect(n.NewTheirs1).toBeDefined()
    expect(n.Legal00001).toBeUndefined()
    expect(n.LegalText1).toBeUndefined()
  })

  test("setting a property to its default equals unsetting it", () => {
    const i = three(
      page(),
      (d) => {
        d.nodes.Hero000001.opacity = 1
      },
      (d) => {
        d.nodes.Hero000001.name = "Hero section"
      },
    )
    const r = mergeDocuments(i)
    expect(r.conflicts).toEqual({})
  })

  test("asset manifests merge add-only", () => {
    const b = page() as Loose
    b.assets = { "aaaaaaaaaaaaaaaa.png": { mime: "image/png" } }
    const i = three(
      b,
      (d) => {
        delete d.assets["aaaaaaaaaaaaaaaa.png"]
        d.assets["bbbbbbbbbbbbbbbb.png"] = { mime: "image/png" }
      },
      (d) => {
        d.assets["cccccccccccccccc.svg"] = { mime: "image/svg+xml" }
      },
    )
    const r = mergeDocuments(i)
    expect(Object.keys((r.doc as Loose).assets).sort()).toEqual([
      "aaaaaaaaaaaaaaaa.png",
      "bbbbbbbbbbbbbbbb.png",
      "cccccccccccccccc.svg",
    ])
  })
})

describe("three-way merge: stored conflicts (§21.4)", () => {
  test("both changed a property: a prop conflict, the body holds ours", () => {
    const i = three(
      page(),
      (d) => {
        d.nodes.Hero000001.fill = "#FFF4E8"
        d.nodes.Hero000001.layout.gap = 12
      },
      (d) => {
        d.nodes.Hero000001.fill = "#FFFFFF"
        d.nodes.Hero000001.layout.gap = 16
      },
    )
    const r = mergeDocuments(i, {})
    expect(kinds(r)).toEqual(["prop", "prop"])
    const byPath = Object.fromEntries(
      Object.values(r.conflicts).map((c) => [(c as Loose).path, c]),
    ) as Loose
    expect(byPath["/fill"]).toEqual({
      kind: "prop",
      node: "Hero000001",
      path: "/fill",
      base: "#FFF7EE",
      ours: "#FFF4E8",
      theirs: "#FFFFFF",
      applied: "ours",
    })
    expect(byPath["/layout/gap"]).toMatchObject({ base: 8, ours: 12, theirs: 16 })
    const d = r.doc as Loose
    expect(d.nodes.Hero000001.fill).toBe("#FFF4E8")
    expect(d.features).toEqual([MERGE_FEATURE])
    expect(d.merge).toEqual({ changes: 0 })
    expect(errorsOf(d)).toEqual([])
    // Applying theirs then ours restores exactly.
    const [first] = listConflicts(d)
    const a = applyConflictSide(d, first?.id as string, "theirs")
    const back = applyConflictSide(a, first?.id as string, "ours", { resolve: false })
    expect(back.nodes).toEqual(d.nodes)
  })

  test("labels and changes are written to `merge`", () => {
    const i = three(
      page(),
      (d) => {
        d.nodes.Headline01.content = "A"
        d.nodes.Hero000001.name = "Top"
      },
      (d) => {
        d.nodes.Headline01.content = "B"
      },
    )
    const r = mergeDocuments({
      ...i,
      labels: { base: "4e1a9c2", ours: "main", theirs: "feat/pricing-v2" },
    })
    expect((r.doc as Loose).merge).toEqual({
      base: "4e1a9c2",
      ours: "main",
      theirs: "feat/pricing-v2",
      changes: 1,
    })
    expect(r.changes).toBe(1)
  })

  test("delete vs edit: the body keeps the edited side and `restored` makes picks reversible", () => {
    const i = three(
      page(),
      (d) => {
        d.nodes.Legal00001.fill = "#F4F4F2"
        d.nodes.Legal00001.w = 640
      },
      (d) => {
        delete d.nodes.Legal00001
        delete d.nodes.LegalText1
      },
    )
    const r = mergeDocuments(i)
    expect(kinds(r)).toEqual(["node"])
    const [entry] = listConflicts(r.doc)
    const c = entry?.conflict as Loose
    expect(c).toMatchObject({ kind: "node", node: "Legal00001", applied: "ours" })
    expect(c.theirs).toBeUndefined()
    expect(Object.keys(c.restored)).toEqual(["LegalText1"])
    const d = r.doc as Loose
    expect(d.nodes.Legal00001.w).toBe(640)
    expect(d.nodes.LegalText1).toBeDefined()
    expect(errorsOf(d)).toEqual([])
    const deleted = applyConflictSide(d, entry?.id as string, "theirs")
    expect(deleted.nodes.Legal00001).toBeUndefined()
    expect(deleted.nodes.LegalText1).toBeUndefined()
    const kept = applyConflictSide(deleted, entry?.id as string, "ours", { resolve: false })
    expect(kept.nodes).toEqual(d.nodes)
  })

  test("edit vs delete keeps theirs (applied: theirs)", () => {
    const i = three(
      page(),
      (d) => {
        delete d.nodes.Legal00001
        delete d.nodes.LegalText1
      },
      (d) => {
        d.nodes.LegalText1.content = "© 2026 Kimo"
      },
    )
    const r = mergeDocuments(i)
    const all = listConflicts(r.doc).map((e) => e.conflict as Loose)
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ kind: "node", node: "LegalText1", applied: "theirs" })
    // Its parent, deleted by ours, is restored with it.
    expect(Object.keys(all[0].restored)).toEqual(["Legal00001"])
    expect(errorsOf(r.doc)).toEqual([])
  })

  test("orphans of a deleted parent become a node conflict on the parent", () => {
    const i = three(
      page(),
      (d) => {
        delete d.nodes.Footer0001
        delete d.nodes.Legal00001
        delete d.nodes.LegalText1
      },
      (d) => {
        d.nodes.Social0001 = { type: "frame", parent: "Footer0001", order: "a1", name: "Social" }
      },
    )
    const r = mergeDocuments(i)
    const all = listConflicts(r.doc).map((e) => e.conflict as Loose)
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ kind: "node", node: "Footer0001", applied: "theirs" })
    expect(Object.keys(all[0].restored).sort()).toEqual(["Legal00001", "LegalText1", "Social0001"])
    expect(errorsOf(r.doc)).toEqual([])
    const gone = applyConflictSide(r.doc, listConflicts(r.doc)[0]?.id as string, "ours")
    expect(Object.keys(gone.nodes).sort()).toEqual([
      "BtnLabel01",
      "BtnPrim001",
      "CtaBtn0001",
      "Headline01",
      "Hero000001",
      "Page000001",
    ])
    expect(errorsOf(gone)).toEqual([])
  })

  test("moved twice: a move conflict with all three placements", () => {
    const i = three(
      page(),
      (d) => {
        d.nodes.Headline01.parent = "Footer0001"
        d.nodes.Headline01.order = "a5"
      },
      (d) => {
        d.nodes.Headline01.parent = "Page000001"
        d.nodes.Headline01.order = "a9"
      },
    )
    const r = mergeDocuments(i)
    const [c] = Object.values(r.conflicts) as Loose[]
    expect(c).toEqual({
      kind: "move",
      node: "Headline01",
      base: { parent: "Hero000001", order: "a0" },
      ours: { parent: "Footer0001", order: "a5" },
      theirs: { parent: "Page000001", order: "a9" },
      applied: "ours",
    })
  })

  test("a parent cycle from two moves is repaired and stored", () => {
    const i = three(
      page(),
      (d) => {
        d.nodes.Hero000001.parent = "Legal00001"
      },
      (d) => {
        d.nodes.Footer0001.parent = "Hero000001"
      },
    )
    expect(errorsOf(i.ours)).toEqual([])
    expect(errorsOf(i.theirs)).toEqual([])
    const r = mergeDocuments(i)
    // Hero000001 > Footer0001 (ids tie on time; the larger id moves back).
    expect(r.repairs).toEqual([{ node: "Hero000001", parent: "Page000001" }])
    expect(errorsOf(r.doc)).toEqual([])
    const [c] = Object.values(r.conflicts) as Loose[]
    expect(c).toMatchObject({ kind: "move", node: "Hero000001", applied: "base" })
  })

  test("a type change on one side and an edit on the other is a node conflict", () => {
    const i = three(
      page(),
      (d) => {
        d.nodes.LegalText1 = { type: "rect", parent: "Legal00001", order: "a0", w: 1, h: 1 }
      },
      (d) => {
        d.nodes.LegalText1.content = "x"
      },
    )
    const r = mergeDocuments(i)
    expect(kinds(r)).toEqual(["node"])
    expect((r.doc as Loose).nodes.LegalText1.type).toBe("rect")
  })

  test("themed variables merge per entry; a clash is a `variable` conflict with `when`", () => {
    const i = three(
      page(),
      (d) => {
        d.variables.brand.value[0].value = "#D9480F"
        d.variables.brand.description = "Brand"
      },
      (d) => {
        d.variables.brand.value[0].value = "#F76707"
        d.variables.brand.value[1].value = "#FFA94D"
      },
    )
    const r = mergeDocuments(i)
    const [c] = Object.values(r.conflicts) as Loose[]
    expect(c).toEqual({
      kind: "variable",
      variable: "brand",
      when: { mode: "light" },
      base: "#E8590C",
      ours: "#D9480F",
      theirs: "#F76707",
      applied: "ours",
    })
    expect((r.doc as Loose).variables.brand).toEqual({
      type: "color",
      description: "Brand",
      value: [
        { value: "#D9480F", when: { mode: "light" } },
        { value: "#FFA94D", when: { mode: "dark" } },
      ],
    })
  })

  test("a variable deleted on one side but bound by the other is kept as a conflict", () => {
    const i = three(
      page(),
      (d) => {
        delete d.variables.space
      },
      (d) => {
        d.nodes.Hero000001.layout.gap = { $ref: "space" }
      },
    )
    const r = mergeDocuments(i)
    const [c] = Object.values(r.conflicts) as Loose[]
    expect(c).toMatchObject({ kind: "variable", variable: "space", applied: "theirs" })
    expect(c.ours).toBeUndefined()
    expect(errorsOf(r.doc)).toEqual([])
  })

  test("a component deleted on one side but instantiated by the other is kept", () => {
    const i = three(
      page(),
      (d) => {
        delete d.nodes.CtaBtn0001
        delete d.nodes.BtnPrim001
        delete d.nodes.BtnLabel01
      },
      (d) => {
        d.nodes.CtaBtn0002 = {
          type: "instance",
          parent: "Footer0001",
          order: "a9",
          of: "BtnPrim001",
        }
      },
    )
    const r = mergeDocuments(i)
    expect(errorsOf(r.doc)).toEqual([])
    const node = Object.values(r.conflicts).find(
      (c) => c.kind === "node" && c.node === "BtnPrim001",
    ) as Loose
    expect(node).toMatchObject({ applied: "theirs" })
    expect(Object.keys(node.restored)).toEqual(["BtnLabel01"])
  })

  test("header: meta per key, theme axes atomic", () => {
    const i = three(
      page(),
      (d) => {
        d.meta.name = "Ours"
        d.themes.mode = ["light", "dark", "sepia"]
      },
      (d) => {
        d.meta.name = "Theirs"
        d.themes.mode = ["dark", "light"]
      },
    )
    const r = mergeDocuments(i)
    const paths = Object.values(r.conflicts)
      .map((c) => (c as Loose).path)
      .sort()
    expect(paths).toEqual(["/meta/name", "/themes/mode"])
    expect((r.doc as Loose).themes.mode).toEqual(["light", "dark", "sepia"])
  })

  test("output is deterministic, ids are derived from targets or injected", () => {
    const i = three(
      page(),
      (d) => {
        d.nodes.Hero000001.fill = "#111111"
      },
      (d) => {
        d.nodes.Hero000001.fill = "#222222"
      },
    )
    const a = serialize(mergeDocuments(i).doc)
    const b = serialize(mergeDocuments(clone(i)).doc)
    expect(a).toBe(b)
    expect(Object.keys(mergeDocuments(i).conflicts)[0]).toMatch(/^Cf[0-9A-Za-z]{8}$/)
    let n = 0
    const r = mergeDocuments(i, { newId: () => `Conflict${String(++n).padStart(2, "0")}` })
    expect(Object.keys(r.conflicts)).toEqual(["Conflict01"])
  })

  test("reproduces board 18's five conflicts", () => {
    const b = page() as Loose
    b.nodes.CtaRow0001 = {
      type: "frame",
      parent: "Hero000001",
      order: "a1",
      name: "CTA Row",
      layout: { dir: "row", gap: 8 },
    }
    b.nodes.CtaBtn0001.parent = "CtaRow0001"
    b.nodes.Headline01.content = "Plan less. Ship more."
    const i = three(
      b,
      (d) => {
        d.nodes.CtaBtn0001.args.label = "Start now"
        d.nodes.CtaRow0001.layout.gap = 12
        d.nodes.Headline01.content = "Plan less. Ship more together."
        d.nodes.Hero000001.fill = "#FFF4E8"
        d.nodes.Legal00001.fill = "#F4F4F2"
        d.nodes.Legal00001.w = 640
      },
      (d) => {
        d.nodes.CtaBtn0001.args.label = "Start free"
        d.nodes.CtaRow0001.layout.gap = 16
        d.nodes.Headline01.content = "Plan less, ship more."
        d.nodes.Hero000001.fill = "#FFFFFF"
        delete d.nodes.Legal00001
        delete d.nodes.LegalText1
      },
    )
    const r = mergeDocuments(i, {})
    expect(kinds(r)).toEqual(["node", "prop", "prop", "prop", "prop"])
    expect(errorsOf(r.doc)).toEqual([])
  })

  test("stored conflicts of an input survive unless a new conflict covers them", () => {
    const b = page()
    const ours = clone(b) as Loose
    ours.features = [MERGE_FEATURE]
    ours.merge = { changes: 1 }
    ours.conflicts = {
      OldConf001: {
        kind: "prop",
        node: "Headline01",
        path: "/content",
        base: "x",
        ours: "Plan less.",
        theirs: "y",
        applied: "ours",
      },
    }
    const theirs = clone(b) as Loose
    theirs.nodes.Hero000001.name = "Top"
    const r = mergeDocuments({ base: b, ours, theirs })
    expect(Object.keys(r.conflicts)).toEqual(["OldConf001"])
    expect(errorsOf(r.doc)).toEqual([])
  })
})

// --- Property tests -------------------------------------------------------------------------------

const POOL = [
  "Node000001",
  "Node000002",
  "Node000003",
  "Node000004",
  "Node000005",
  "Node000006",
  "Node000007",
  "Node000008",
  "Node000009",
  "Node000010",
]
const NEW_IDS = ["Add0000001", "Add0000002", "Add0000003", "Add0000004"]
const COLORS = ["#111111", "#222222", "#333333", "#FFFFFF", "#E8590C"]

type Kind = "frame" | "rect" | "text"
const isContainer = (n: Loose) => n.type === "frame"

const baseArb: fc.Arbitrary<KimoDocument> = fc
  .record({
    n: fc.integer({ min: 2, max: POOL.length }),
    kinds: fc.array(fc.constantFrom<Kind>("frame", "frame", "rect", "text"), {
      minLength: POOL.length,
      maxLength: POOL.length,
    }),
    parents: fc.array(fc.nat(), { minLength: POOL.length, maxLength: POOL.length }),
    fills: fc.array(fc.constantFrom(...COLORS, "brand"), {
      minLength: POOL.length,
      maxLength: POOL.length,
    }),
    gaps: fc.array(fc.option(fc.integer({ min: 0, max: 32 }), { nil: undefined }), {
      minLength: POOL.length,
      maxLength: POOL.length,
    }),
  })
  .map((g) => {
    const nodes: Record<string, Loose> = {}
    const ids = POOL.slice(0, g.n)
    ids.forEach((id, i) => {
      const kind = i === 0 ? "frame" : (g.kinds[i] as Kind)
      const containers = ids.slice(0, i).filter((x) => isContainer(nodes[x]))
      const pick = g.parents[i] as number
      const parent =
        containers.length > 0 && pick % 4 !== 0 ? containers[pick % containers.length] : null
      const fillV = g.fills[i] as string
      const fill = fillV === "brand" ? { $ref: "brand" } : fillV
      const n: Loose = { type: kind, parent, order: `a${i}` }
      if (kind === "frame") {
        n.fill = fill
        if (g.gaps[i] !== undefined) n.layout = { dir: "row", gap: g.gaps[i] }
      } else if (kind === "rect") Object.assign(n, { w: 10 + i, h: 10, fill })
      else n.content = `Text ${i}`
      nodes[id] = n
    })
    return doc(nodes, {
      meta: { name: "Doc" },
      themes: { mode: ["light", "dark"] },
      variables: {
        brand: {
          type: "color",
          value: [
            { value: "#E8590C", when: { mode: "light" } },
            { value: "#FF8A3D", when: { mode: "dark" } },
          ],
        },
        space: { type: "number", value: 8 },
      },
    })
  })

type Edit =
  | { k: "fill"; i: number; c: number }
  | { k: "gap"; i: number; v: number }
  | { k: "name"; i: number; v: string }
  | { k: "content"; i: number; v: string }
  | { k: "delete"; i: number }
  | { k: "add"; i: number; id: number; kind: Kind }
  | { k: "move"; i: number; to: number; order: string }
  | { k: "brand"; entry: number; c: number }
  | { k: "space"; v: number }
  | { k: "meta"; v: string }

const editArb: fc.Arbitrary<Edit> = fc.oneof(
  fc.record({ k: fc.constant("fill" as const), i: fc.nat(), c: fc.nat() }),
  fc.record({ k: fc.constant("gap" as const), i: fc.nat(), v: fc.integer({ min: 0, max: 40 }) }),
  fc.record({ k: fc.constant("name" as const), i: fc.nat(), v: fc.constantFrom("A", "B", "C") }),
  fc.record({ k: fc.constant("content" as const), i: fc.nat(), v: fc.constantFrom("x", "y") }),
  fc.record({ k: fc.constant("delete" as const), i: fc.nat() }),
  fc.record({
    k: fc.constant("add" as const),
    i: fc.nat(),
    id: fc.nat(),
    kind: fc.constantFrom<Kind>("frame", "rect", "text"),
  }),
  fc.record({
    k: fc.constant("move" as const),
    i: fc.nat(),
    to: fc.nat(),
    order: fc.constantFrom("a0", "b5", "z"),
  }),
  fc.record({ k: fc.constant("brand" as const), entry: fc.nat(), c: fc.nat() }),
  fc.record({ k: fc.constant("space" as const), v: fc.integer({ min: 0, max: 20 }) }),
  fc.record({ k: fc.constant("meta" as const), v: fc.constantFrom("X", "Y") }),
)

const subtree = (nodes: Record<string, Loose>, root: string): string[] => {
  const out = [root]
  for (let i = 0; i < out.length; i++)
    for (const [id, n] of Object.entries(nodes)) if (n.parent === out[i]) out.push(id)
  return out
}

/**
 * Applies edits to a copy of `d`, touching only `scope` (node ids it may edit, or null = any)
 * and the variables/meta when `header` is set. Keeps the document valid.
 */
function applyEdits(
  d: KimoDocument,
  edits: Edit[],
  scope: Set<string> | null,
  header: boolean,
  addIds: string[],
): KimoDocument {
  const out = clone(d) as Loose
  const nodes = out.nodes as Record<string, Loose>
  const ids = () => Object.keys(nodes).filter((id) => scope === null || scope.has(id))
  for (const e of edits) {
    const list = ids()
    const pick = (i: number) => (list.length > 0 ? list[i % list.length] : undefined)
    switch (e.k) {
      case "fill": {
        const id = pick(e.i)
        if (id && nodes[id].type !== "text") nodes[id].fill = COLORS[e.c % COLORS.length]
        break
      }
      case "gap": {
        const id = pick(e.i)
        if (id && nodes[id].type === "frame")
          nodes[id].layout = { ...(nodes[id].layout ?? { dir: "row" }), gap: e.v }
        break
      }
      case "name": {
        const id = pick(e.i)
        if (id) nodes[id].name = e.v
        break
      }
      case "content": {
        const id = pick(e.i)
        if (id && nodes[id].type === "text") nodes[id].content = e.v
        break
      }
      case "delete": {
        const id = pick(e.i)
        if (!id) break
        const sub = subtree(nodes, id)
        if (scope && sub.some((x) => !scope.has(x))) break
        for (const x of sub) delete nodes[x]
        break
      }
      case "add": {
        const id = addIds[e.id % addIds.length] as string
        if (nodes[id]) break
        const containers = list.filter((x) => nodes[x].type === "frame")
        const parent = containers.length > 0 ? containers[e.i % containers.length] : null
        if (scope && parent === null) break
        nodes[id] =
          e.kind === "frame"
            ? { type: "frame", parent, order: "m0" }
            : e.kind === "rect"
              ? { type: "rect", parent, order: "m0", w: 3, h: 3 }
              : { type: "text", parent, order: "m0", content: "new" }
        scope?.add(id)
        break
      }
      case "move": {
        const id = pick(e.i)
        if (!id) break
        const targets = list.filter((x) => nodes[x].type === "frame")
        const to = targets.length > 0 ? targets[e.to % targets.length] : undefined
        if (!to || subtree(nodes, id).includes(to)) break
        nodes[id].parent = to
        nodes[id].order = e.order
        break
      }
      case "brand":
        if (header) out.variables.brand.value[e.entry % 2].value = COLORS[e.c % COLORS.length]
        break
      case "space":
        if (header) out.variables.space.value = e.v
        break
      case "meta":
        if (header) out.meta.name = e.v
        break
    }
  }
  return out as KimoDocument
}

const editsArb = fc.array(editArb, { maxLength: 6 })

describe("property: three-way merge", () => {
  test("random base + two edit sequences → the result validates", () => {
    fc.assert(
      fc.property(baseArb, editsArb, editsArb, (base, ea, eb) => {
        const ours = applyEdits(base, ea, null, true, NEW_IDS.slice(0, 2))
        const theirs = applyEdits(base, eb, null, true, NEW_IDS.slice(1))
        fc.pre(errorsOf(ours).length === 0 && errorsOf(theirs).length === 0)
        const r = mergeDocuments({ base, ours, theirs })
        const errors = errorsOf(r.doc)
        if (errors.length > 0) throw new Error(JSON.stringify(errors.slice(0, 3)))
        // The canonical text round-trips.
        expect(serialize(canonicalize(r.doc))).toBe(serialize(r.doc))
        // Every stored side can be applied, and the result still parses as a document.
        for (const { id } of listConflicts(r.doc)) {
          for (const side of ["ours", "theirs", "base"] as const) {
            try {
              applyConflictSide(r.doc, id, side)
            } catch (e) {
              if ((e as { code?: string }).code !== "CANNOT_APPLY") throw e
            }
          }
        }
      }),
      { numRuns: RUNS },
    )
  })

  test("merging identical sides is the identity", () => {
    fc.assert(
      fc.property(baseArb, editsArb, (base, ea) => {
        const a = applyEdits(base, ea, null, true, NEW_IDS)
        fc.pre(errorsOf(a).length === 0)
        const same = (r: { doc: KimoDocument; conflicts: object }) => {
          expect(r.conflicts).toEqual({})
          expect(serialize(r.doc)).toBe(serialize(a))
        }
        same(mergeDocuments({ base, ours: a, theirs: a }))
        same(mergeDocuments({ base, ours: a, theirs: base }))
        same(mergeDocuments({ base, ours: base, theirs: a }))
        same(mergeDocuments({ base: a, ours: a, theirs: a }))
      }),
      { numRuns: RUNS },
    )
  })

  test("clean merges of disjoint edits commute (and equal applying both)", () => {
    fc.assert(
      fc.property(baseArb, editsArb, editsArb, fc.boolean(), (base, ea, eb, headerToA) => {
        const nodes = (base as Loose).nodes as Record<string, Loose>
        // Partition by root subtree.
        const roots = Object.keys(nodes)
          .filter((id) => nodes[id].parent === null)
          .sort()
        const sa = new Set<string>()
        const sb = new Set<string>()
        roots.forEach((r, i) => {
          for (const x of subtree(nodes, r)) (i % 2 === 0 ? sa : sb).add(x)
        })
        const sbFirst = new Set(sb)
        const ours = applyEdits(base, ea, sa, headerToA, NEW_IDS.slice(0, 2))
        const theirs = applyEdits(base, eb, sb, !headerToA, NEW_IDS.slice(2))
        fc.pre(errorsOf(ours).length === 0 && errorsOf(theirs).length === 0)
        const ab = mergeDocuments({ base, ours, theirs })
        const ba = mergeDocuments({ base, ours: theirs, theirs: ours })
        expect(ab.conflicts).toEqual({})
        expect(ba.conflicts).toEqual({})
        expect(serialize(ab.doc)).toBe(serialize(ba.doc))
        expect(ab.changes).toBe(ba.changes)
        // Applying both edit sequences one after the other gives the same document.
        const both = applyEdits(ours, eb, sbFirst, !headerToA, NEW_IDS.slice(2))
        expect(serialize(ab.doc)).toBe(serialize(both))
      }),
      { numRuns: RUNS },
    )
  })
})
