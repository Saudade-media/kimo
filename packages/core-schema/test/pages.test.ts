import { describe, expect, test } from "bun:test"
import {
  DEFAULT_PAGE_NAME,
  isOnPage,
  listPages,
  pageOfRoot,
  parse,
  rootsByPage,
} from "../src/index"
import { readFixture } from "./helpers"

describe("pages", () => {
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
})
