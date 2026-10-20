import { describe, expect, test } from "bun:test"
import {
  DEFAULT_PAGE_NAME,
  isOnPage,
  listPages,
  pageOfRoot,
  parse,
  rootsByPage,
  serialize,
  stripDefaults,
  validate,
} from "../src/index"
import { readFixture } from "./helpers"

const base = { $schema: "https://getkimo.design/schema/kimo-1.0.json", format: "1.0.0" } as const

describe("pages (spec §5.6)", () => {
  const doc = parse(readFixture("valid/pages.kimo"))

  test("listPages sorts by (order, id)", () => {
    expect(listPages(doc).map((p) => p.name)).toEqual(["Home", "Checkout", "Archive"])
  })

  test("a document without pages has one implicit page", () => {
    expect(listPages({ nodes: {} })).toEqual([{ id: null, name: DEFAULT_PAGE_NAME, order: "" }])
    expect(listPages({ pages: {}, nodes: {} })[0]?.id).toBeNull()
    expect(pageOfRoot({ nodes: {} }, { parent: null })).toBeNull()
  })

  test("roots without page (or with an unknown page) are on the first page", () => {
    const by = rootsByPage(doc)
    expect(by.get("PageHome01")?.sort()).toEqual(["HomeFrame1", "Unpaged001"])
    expect(by.get("PageCheck1")).toEqual(["CartFrame1"])
    expect(by.get("PageArch01")).toEqual(["ArchNote01"])
    expect(pageOfRoot(doc, { parent: null, page: "Nope000001" })).toBe("PageHome01")
    expect(isOnPage(doc, doc.nodes.Unpaged001, "PageHome01")).toBe(true)
    expect(isOnPage(doc, doc.nodes.CartFrame1, "PageHome01")).toBe(false)
  })

  test("pages serialize on one line, after components and before nodes", () => {
    const text = serialize({
      ...base,
      components: [],
      pages: { BBBBBB: { name: "B", order: "a1" }, AAAAAA: { name: "A", order: "a0" } },
      nodes: {},
    } as never)
    expect(text).toContain(
      `"components": [],\n"pages": {"AAAAAA":{"order":"a0","name":"A"},"BBBBBB":{"order":"a1","name":"B"}},\n"nodes": {}`,
    )
  })

  test("page on an instance's props or in a set override is not allowed", () => {
    const r = validate(parse(readFixture("invalid/OVERRIDE_INVALID--set-page.kimo")))
    expect(r.errors.map((e) => e.code)).toContain("OVERRIDE_INVALID")
  })
})

describe("polygon star and image crop fit", () => {
  test("star.ratio 0.38 is the default and is stripped", () => {
    const d: { nodes: Record<string, unknown> } = stripDefaults({
      ...base,
      nodes: {
        S: {
          type: "polygon",
          parent: null,
          order: "a0",
          w: 1,
          h: 1,
          sides: 5,
          star: { ratio: 0.38 },
        },
      },
    } as never)
    expect((d.nodes.S as { star: unknown }).star).toEqual({})
  })

  test("fit crop validates; ratio 0 does not", () => {
    expect(validate(parse(readFixture("valid/polygon-star-image-crop.kimo"))).ok).toBe(true)
    const bad = validate({
      ...base,
      nodes: {
        Star000001: {
          type: "polygon",
          parent: null,
          order: "a0",
          w: 1,
          h: 1,
          sides: 5,
          star: { ratio: 0 },
        },
      },
    })
    expect(bad.ok).toBe(false)
  })
})
