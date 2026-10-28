import { describe, expect, test } from "bun:test"
import {
  applyAllConflicts,
  applyConflictSide,
  attachConflicts,
  type Conflict,
  ConflictError,
  conflictCounts,
  conflictMatchesBody,
  finishMerge,
  isCanonical,
  type KimoDocument,
  listConflicts,
  MERGE_FEATURE,
  markConflictEdited,
  mergeDocuments,
  openDocument,
  parse,
  serialize,
  validate,
} from "../src/index"
import { codes, doc, type Loose, readFixture } from "./helpers"

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

describe("three-way merge: stored conflicts", () => {
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

  test("delete vs edit: the body keeps the edited side and `restored` holds the deleted subtree", () => {
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
  })

  test("edit vs delete keeps theirs and restores the deleted parent with it", () => {
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

  test("output is deterministic and conflict ids can be injected", () => {
    const i = three(
      page(),
      (d) => {
        d.nodes.Hero000001.fill = "#111111"
      },
      (d) => {
        d.nodes.Hero000001.fill = "#222222"
      },
    )
    expect(serialize(mergeDocuments(i).doc)).toBe(serialize(mergeDocuments(clone(i)).doc))
    let n = 0
    const r = mergeDocuments(i, { newId: () => `Conflict${String(++n).padStart(2, "0")}` })
    expect(Object.keys(r.conflicts)).toEqual(["Conflict01"])
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

const conflictsDoc = () => parse(readFixture("lint/CONFLICT_OPEN--board-18.kimo")) as Loose
const everyKind = () => parse(readFixture("lint/CONFLICT_OPEN--every-kind.kimo")) as Loose

describe("stored conflicts: format", () => {
  test("a conflicted file opens writable and only warns CONFLICT_OPEN", () => {
    const r = openDocument(readFixture("lint/CONFLICT_OPEN--board-18.kimo"))
    expect(r.readOnly).toBe(false)
    expect(r.validation?.errors).toEqual([])
    expect(new Set(codes(r.validation?.warnings ?? []))).toEqual(new Set(["CONFLICT_OPEN"]))
  })

  test("conflicts serialize as a table between the header and nodes, merge labels first", () => {
    const text = readFixture("lint/CONFLICT_OPEN--board-18.kimo")
    const lines = text.split("\n")
    const iMerge = lines.findIndex((l) => l.startsWith('"merge": '))
    const iConf = lines.indexOf('"conflicts": {')
    const iNodes = lines.indexOf('"nodes": {')
    expect(iMerge).toBeGreaterThan(0)
    expect(iConf).toBe(iMerge + 1)
    expect(iNodes).toBeGreaterThan(iConf)
    expect(lines[iMerge]).toBe(
      `"merge": {"base":"4e1a9c2","changes":14,"ours":"main","theirs":"feat/pricing-v2"},`,
    )
    // One conflict per line, leading commas, blank line between entries.
    expect(lines[iConf + 1]?.startsWith('"CfBtnLbl01": {"kind":"prop",')).toBe(true)
    expect(lines[iConf + 2]).toBe("")
    expect(lines[iConf + 3]?.startsWith(', "CfCtaGap01": ')).toBe(true)
  })

  test("conflicted documents are canonical and byte-stable whatever the key order", () => {
    for (const f of [
      "lint/CONFLICT_OPEN--board-18.kimo",
      "lint/CONFLICT_OPEN--every-kind.kimo",
      "valid/merge-conflicts-resolved.kimo",
    ]) {
      expect(isCanonical(readFixture(f))).toBe(true)
    }
    const a = conflictsDoc()
    const shuffled = { ...a, conflicts: {} as Loose }
    for (const id of Object.keys(a.conflicts).reverse()) {
      const c = a.conflicts[id]
      shuffled.conflicts[id] = Object.fromEntries(Object.entries(c).reverse())
    }
    expect(serialize(shuffled)).toBe(serialize(a))
  })

  test("every conflict kind validates and its body matches the applied side", () => {
    const d = everyKind()
    const r = validate(d)
    expect(r.errors).toEqual([])
    for (const { conflict } of listConflicts(d)) expect(conflictMatchesBody(d, conflict)).toBe(true)
  })

  test("a prop side whose node is gone is CONFLICT_STALE, not an error", () => {
    const d = conflictsDoc()
    delete d.nodes.Headline01
    const r = validate(d)
    expect(r.errors).toEqual([])
    expect(codes(r.warnings)).toContain("CONFLICT_STALE")
  })

  test("malformed entries are rejected: variable sides must be variables, header paths are limited", () => {
    const badVar = attachConflicts(doc({}), {
      CfVar00001: { kind: "variable", variable: "ink", ours: { type: "color" }, applied: "ours" },
    } as Loose)
    expect(codes(validate(badVar).errors)).toContain("SCHEMA")
    const badPath = attachConflicts(doc({}), {
      CfHdr00001: { kind: "header", path: "/format", ours: "1.0.0", applied: "ours" },
    } as Loose)
    expect(codes(validate(badPath).errors)).toContain("CONFLICT_PATH_INVALID")
  })

  test("incremental validation never reports conflict codes", () => {
    const r = validate(conflictsDoc(), { nodes: ["Hero000001"] })
    expect(r.warnings.filter((w) => w.code.startsWith("CONFLICT"))).toEqual([])
  })
})

describe("stored conflicts: applying sides", () => {
  test("prop: theirs then ours restores the original bytes (apart from resolved flags)", () => {
    const d = conflictsDoc()
    const t = applyConflictSide(d, "CfHeroFil1", "theirs")
    expect(t.nodes.Hero000001.fill).toBe("#FFFFFF")
    expect(t.conflicts.CfHeroFil1).toMatchObject({ applied: "theirs", resolved: true })
    expect(d.nodes.Hero000001.fill).toBe("#FFF4E8") // input untouched
    const back = applyConflictSide(t, "CfHeroFil1", "ours", { resolve: false })
    back.conflicts.CfHeroFil1.resolved = undefined
    expect(serialize(back)).toBe(serialize(d))
  })

  test("prop: an absent side unsets the property, base can be applied", () => {
    const d = attachConflicts(
      doc({ Frame00001: { type: "frame", parent: null, order: "a0", w: 1, h: 1, opacity: 0.5 } }),
      {
        CfProp0001: {
          kind: "prop",
          node: "Frame00001",
          path: "/opacity",
          base: 0.8,
          ours: 0.5,
          applied: "ours",
        },
      } as Loose,
    ) as Loose
    expect("opacity" in applyConflictSide(d, "CfProp0001", "theirs").nodes.Frame00001).toBe(false)
    expect(applyConflictSide(d, "CfProp0001", "base").nodes.Frame00001.opacity).toBe(0.8)
  })

  test("node (delete vs edit): deleting removes the node and its restored subtree; keeping puts them back", () => {
    const d = everyKind()
    const del = applyConflictSide(d, "CfNode0001", "theirs")
    expect(del.nodes.Legal00001).toBeUndefined()
    expect(del.nodes.LegalLink1).toBeUndefined()
    expect(validate(del).errors).toEqual([])
    const kept = applyConflictSide(del, "CfNode0001", "ours", { resolve: false })
    expect(kept.nodes.Legal00001).toEqual(d.nodes.Legal00001)
    expect(kept.nodes.LegalLink1).toEqual(d.nodes.LegalLink1)
    expect(applyConflictSide(d, "CfNode0001", "base").nodes.Legal00001.w).toBe(600)
  })

  test("move, themed variable entry and header pointer apply only their own target", () => {
    const d = everyKind()
    const moved = applyConflictSide(d, "CfMove0001", "theirs")
    expect(moved.nodes.CtaRow0001.parent).toBe("Footer0001")
    expect(validate(moved).errors).toEqual([])
    expect(applyConflictSide(moved, "CfMove0001", "ours").nodes.CtaRow0001.parent).toBe(
      "Hero000001",
    )
    expect(applyConflictSide(d, "CfVarW0001", "theirs").variables.brand.value).toEqual([
      { value: "#D9480F", when: { mode: "light" } },
      { value: "#FF8A3D", when: { mode: "dark" } },
    ])
    expect(applyConflictSide(d, "CfHead0001", "theirs").meta.name).toBe("Marketing site")
  })

  test("take all theirs applies to open conflicts only", () => {
    expect(conflictCounts(conflictsDoc())).toEqual({ total: 5, open: 2, resolved: 3 })
    const d = applyAllConflicts(conflictsDoc(), "theirs")
    expect(d.nodes.Hero000001.fill).toBe("#FFFFFF")
    expect(d.nodes.Headline01.content).toBe("Plan less, ship more.")
    expect(d.nodes.CtaRow0001.layout.gap).toBe(12) // resolved earlier as "kept ours"
    expect(conflictCounts(d).open).toBe(0)
  })

  test("every side of every kind leaves a valid document", () => {
    for (const side of ["ours", "theirs", "base"] as const) {
      const r = validate(applyAllConflicts(everyKind(), side))
      expect(r.errors).toEqual([])
    }
  })

  test("errors: unknown id, missing target", () => {
    expect(() => applyConflictSide(conflictsDoc(), "Nope000000", "ours")).toThrow(ConflictError)
    const d = conflictsDoc()
    delete d.nodes.Headline01
    try {
      applyConflictSide(d, "CfHeadlin1", "theirs")
      throw new Error("expected CANNOT_APPLY")
    } catch (e) {
      expect((e as ConflictError).code).toBe("CANNOT_APPLY")
    }
  })

  test("a hand edit is recorded as edited and stops being stale", () => {
    const d = conflictsDoc()
    d.nodes.Hero000001.fill = "#123456"
    expect(codes(validate(d).warnings)).toContain("CONFLICT_STALE")
    const e = markConflictEdited(d, "CfHeroFil1")
    expect(e.conflicts.CfHeroFil1).toMatchObject({ applied: "edited", resolved: true })
    expect(codes(validate(e).warnings)).not.toContain("CONFLICT_STALE")
  })
})

describe("stored conflicts: finishing", () => {
  test("finishMerge refuses while conflicts are open", () => {
    expect(() => finishMerge(conflictsDoc())).toThrow(ConflictError)
  })

  test("finishing removes conflicts, merge and the feature", () => {
    const done = finishMerge(applyAllConflicts(conflictsDoc(), "ours")) as Loose
    expect(done.conflicts).toBeUndefined()
    expect(done.merge).toBeUndefined()
    expect(done.features).toBeUndefined()
    const r = validate(done)
    expect(r.errors).toEqual([])
    expect(r.warnings).toEqual([])
    expect(serialize(done)).not.toContain("merge/conflicts")
  })

  test("finishing keeps other features", () => {
    const d = attachConflicts(doc({}, { features: ["layout/wrap"] }), {
      CfHdr00001: { kind: "header", path: "/meta/name", ours: "A", theirs: "B", applied: "ours" },
    } as Loose) as Loose
    expect(d.features).toEqual(["layout/wrap", MERGE_FEATURE])
    expect(finishMerge(d, { force: true }).features).toEqual(["layout/wrap"])
  })
})
