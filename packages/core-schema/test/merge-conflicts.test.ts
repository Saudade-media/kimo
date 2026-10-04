import { describe, expect, test } from "bun:test"
import {
  applyAllConflicts,
  applyConflictSide,
  attachConflicts,
  ConflictError,
  conflictCounts,
  conflictMatchesBody,
  finishMerge,
  hasConflicts,
  isCanonical,
  listConflicts,
  MERGE_FEATURE,
  markConflictEdited,
  mergeInfo,
  openDocument,
  parse,
  serialize,
  validate,
} from "../src/index"
import { codes, doc, type Loose, readFixture } from "./helpers"

const board18 = () => parse(readFixture("lint/CONFLICT_OPEN--board-18.kimo")) as Loose
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

  test("conflicted documents are canonical and round-trip byte-stable", () => {
    for (const f of [
      "lint/CONFLICT_OPEN--board-18.kimo",
      "lint/CONFLICT_OPEN--every-kind.kimo",
      "valid/merge-conflicts-resolved.kimo",
    ]) {
      expect(isCanonical(readFixture(f))).toBe(true)
    }
  })

  test("key order inside entries is stable whatever the input order", () => {
    const a = board18()
    const shuffled = { ...a, conflicts: {} as Loose }
    for (const id of Object.keys(a.conflicts).reverse()) {
      const c = a.conflicts[id]
      shuffled.conflicts[id] = Object.fromEntries(Object.entries(c).reverse())
    }
    expect(serialize(shuffled)).toBe(serialize(a))
  })

  test("mergeInfo, counts and listing", () => {
    const d = board18()
    expect(hasConflicts(d)).toBe(true)
    expect(mergeInfo(d)).toEqual({
      base: "4e1a9c2",
      ours: "main",
      theirs: "feat/pricing-v2",
      changes: 14,
    })
    expect(conflictCounts(d)).toEqual({ total: 5, open: 2, resolved: 3 })
    expect(listConflicts(d).map((e) => e.id)).toEqual([
      "CfBtnLbl01",
      "CfCtaGap01",
      "CfHeadlin1",
      "CfHeroFil1",
      "CfLegal001",
    ])
  })

  test("validator: every conflict kind passes, body matches applied", () => {
    const d = everyKind()
    const r = validate(d)
    expect(r.errors).toEqual([])
    for (const { conflict } of listConflicts(d)) expect(conflictMatchesBody(d, conflict)).toBe(true)
  })

  test("a prop side whose node is gone is CONFLICT_STALE, not an error", () => {
    const d = board18()
    delete d.nodes.Headline01
    const r = validate(d)
    expect(r.errors).toEqual([])
    expect(codes(r.warnings)).toContain("CONFLICT_STALE")
  })

  test("whole-variable sides must be variables", () => {
    const d = attachConflicts(doc({}), {
      CfVar00001: { kind: "variable", variable: "ink", ours: { type: "color" }, applied: "ours" },
    } as Loose)
    expect(codes(validate(d).errors)).toContain("SCHEMA")
  })

  test("header conflicts may only address meta/themes/imports/assets/components", () => {
    const d = attachConflicts(doc({}), {
      CfHdr00001: { kind: "header", path: "/format", ours: "1.0.0", applied: "ours" },
    } as Loose)
    expect(codes(validate(d).errors)).toContain("CONFLICT_PATH_INVALID")
  })

  test("incremental validation never reports conflict codes", () => {
    const r = validate(board18(), { nodes: ["Hero000001"] })
    expect(r.warnings.filter((w) => w.code.startsWith("CONFLICT"))).toEqual([])
  })
})

describe("stored conflicts: applying sides", () => {
  test("prop: theirs then ours restores the original bytes (apart from resolved flags)", () => {
    const d = board18()
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

  test("move: theirs reparents, ours puts it back", () => {
    const d = everyKind()
    const t = applyConflictSide(d, "CfMove0001", "theirs")
    expect(t.nodes.CtaRow0001.parent).toBe("Footer0001")
    expect(validate(t).errors).toEqual([])
    expect(applyConflictSide(t, "CfMove0001", "ours").nodes.CtaRow0001.parent).toBe("Hero000001")
  })

  test("variable themed entry: only the matching `when` entry changes", () => {
    const d = everyKind()
    const t = applyConflictSide(d, "CfVarW0001", "theirs")
    expect(t.variables.brand.value).toEqual([
      { value: "#D9480F", when: { mode: "light" } },
      { value: "#FF8A3D", when: { mode: "dark" } },
    ])
  })

  test("header: pointer into meta", () => {
    expect(applyConflictSide(everyKind(), "CfHead0001", "theirs").meta.name).toBe("Marketing site")
  })

  test("take all theirs applies to open conflicts only", () => {
    const d = applyAllConflicts(board18(), "theirs")
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
    expect(() => applyConflictSide(board18(), "Nope000000", "ours")).toThrow(ConflictError)
    const d = board18()
    delete d.nodes.Headline01
    try {
      applyConflictSide(d, "CfHeadlin1", "theirs")
      throw new Error("expected CANNOT_APPLY")
    } catch (e) {
      expect((e as ConflictError).code).toBe("CANNOT_APPLY")
    }
  })

  test("a hand edit is recorded as edited and stops being stale", () => {
    const d = board18()
    d.nodes.Hero000001.fill = "#123456"
    expect(codes(validate(d).warnings)).toContain("CONFLICT_STALE")
    const e = markConflictEdited(d, "CfHeroFil1")
    expect(e.conflicts.CfHeroFil1).toMatchObject({ applied: "edited", resolved: true })
    expect(codes(validate(e).warnings)).not.toContain("CONFLICT_STALE")
  })
})

describe("stored conflicts: finishing", () => {
  test("finishMerge refuses while conflicts are open", () => {
    expect(() => finishMerge(board18())).toThrow(ConflictError)
  })

  test("mark resolved & save removes conflicts, merge and the feature", () => {
    const done = finishMerge(applyAllConflicts(board18(), "ours")) as Loose
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

  test("attaching no conflicts yields a clean document", () => {
    const d = attachConflicts(doc({}), {}, { ours: "main" }) as Loose
    expect(d.merge).toBeUndefined()
    expect(d.features).toBeUndefined()
  })
})
