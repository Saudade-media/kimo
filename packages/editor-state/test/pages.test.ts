import { describe, expect, test } from "bun:test"
import { serialize, validate } from "@kimo/core-schema"
import {
  addPageOps,
  deletePageOps,
  duplicatePageOps,
  materializePageOps,
  movePageOps,
  moveToPageOps,
  pageOfNode,
  pageRoots,
  pagesOf,
  renamePageOps,
  YjsDocStore,
} from "../src/index"
import { emptyStore, rng, syncPair } from "./helpers"

const frame = (id: string, name: string) => ({
  op: "insert" as const,
  id,
  parent: null,
  node: { type: "frame", name, w: 100, h: 100 },
})

function seeded() {
  const s = emptyStore()
  s.apply([frame("FrameA0001", "A"), frame("FrameB0001", "B")], { origin: "user" })
  s.apply(
    { op: "insert", id: "ChildA0001", parent: "FrameA0001", node: { type: "rect", w: 1, h: 1 } },
    { origin: "user" },
  )
  return s
}

describe("page ops (spec §5.6)", () => {
  test("a document without pages has one implicit page holding every root", () => {
    const s = seeded()
    expect(pagesOf(s)).toEqual([{ id: null, name: "Page 1", order: "" }])
    expect(pageRoots(s, null)).toEqual(["FrameA0001", "FrameB0001"])
    expect(pageOfNode(s, "ChildA0001")).toBeNull()
  })

  test("adding the first page materializes Page 1 and stamps the existing roots", () => {
    const s = seeded()
    const { ops, pageId } = addPageOps(s)
    const r = s.apply(ops, { origin: "user", label: "Add page" })
    expect(r.ok).toBe(true)
    const pages = pagesOf(s)
    expect(pages.map((p) => p.name)).toEqual(["Page 1", "Page 2"])
    expect(pages[1]?.id).toBe(pageId)
    const first = pages[0]?.id as string
    expect(s.getNode("FrameA0001")?.page).toBe(first)
    expect(pageOfNode(s, "ChildA0001")).toBe(first)
    expect(pageRoots(s, pageId)).toEqual([])
    // One undo step removes the page and the stamps.
    s.undo("user")
    expect(s.toHeader().pages).toBeUndefined()
    expect(s.getNode("FrameA0001")?.page).toBeUndefined()
    expect(validate(s.toDocument()).warnings).toEqual([])
  })

  test("rename, move and delete; the last page cannot be deleted", () => {
    const s = seeded()
    const a = addPageOps(s, { name: "Checkout" })
    s.apply(a.ops, { origin: "user" })
    s.apply(
      { op: "insert", id: "CartFrame1", parent: null, node: { type: "frame", page: a.pageId } },
      { origin: "user" },
    )
    s.apply(renamePageOps(s, a.pageId, "Cart"), { origin: "user" })
    expect(renamePageOps(s, a.pageId, "  ")).toEqual([])
    expect(pagesOf(s).map((p) => p.name)).toEqual(["Page 1", "Cart"])
    s.apply(movePageOps(s, a.pageId, 0), { origin: "user" })
    expect(pagesOf(s).map((p) => p.name)).toEqual(["Cart", "Page 1"])
    // Roots of the former first page stay on it.
    expect(pageRoots(s, pagesOf(s)[1]?.id ?? null)).toEqual(["FrameA0001", "FrameB0001"])
    s.apply(deletePageOps(s, a.pageId), { origin: "user" })
    expect(s.hasNode("CartFrame1")).toBe(false)
    expect(pagesOf(s).map((p) => p.name)).toEqual(["Page 1"])
    expect(deletePageOps(s, pagesOf(s)[0]?.id as string)).toEqual([])
  })

  test("moving to the first position stamps roots that relied on the fallback", () => {
    const s = seeded()
    const a = addPageOps(s)
    s.apply(a.ops, { origin: "user" })
    // An agent that knows nothing about pages inserts a root: it lands on the first page.
    s.apply(frame("AgentRoot1", "From agent"), { origin: "user" })
    const first = pagesOf(s)[0]?.id as string
    expect(pageOfNode(s, "AgentRoot1")).toBe(first)
    s.apply(movePageOps(s, a.pageId, 0), { origin: "user" })
    expect(pageOfNode(s, "AgentRoot1")).toBe(first)
    expect(s.getNode("AgentRoot1")?.page).toBe(first)
  })

  test("moveToPage reparents to the root and sets page", () => {
    const s = seeded()
    const a = addPageOps(s)
    s.apply(a.ops, { origin: "user" })
    s.apply(moveToPageOps(s, ["ChildA0001", "FrameB0001"], a.pageId), { origin: "user" })
    expect(pageRoots(s, a.pageId)).toEqual(["FrameB0001", "ChildA0001"])
    expect(s.getNode("ChildA0001")?.parent).toBeNull()
  })

  test("concurrent page additions on two replicas both survive", () => {
    const a = new YjsDocStore({ random: rng(1) })
    a.loadDocument(seeded().toDocument())
    const b = new YjsDocStore({ random: rng(2) })
    b.applyUpdate(a.encodeStateAsUpdate(), "remote:a")
    const first = addPageOps(a, { name: "Shared" })
    a.apply(first.ops, { origin: "user" })
    syncPair(a, b)
    a.apply(addPageOps(a, { name: "From A" }).ops, { origin: "user" })
    b.apply(addPageOps(b, { name: "From B" }).ops, { origin: "user" })
    syncPair(a, b)
    expect(new Set(pagesOf(a).map((p) => p.name))).toEqual(
      new Set(["Page 1", "Shared", "From A", "From B"]),
    )
    expect(serialize(a.toDocument())).toBe(serialize(b.toDocument()))
  })
})

describe("duplicate page", () => {
  test("copies every root subtree onto a new page right after the source", () => {
    const s = seeded()
    const a = addPageOps(s, { name: "Other" })
    s.apply(a.ops, { origin: "user" })
    const first = pagesOf(s)[0]?.id as string
    let n = 0
    const d = duplicatePageOps(s, first, { newId: () => `CopyNode${String(++n).padStart(2, "0")}` })
    expect(s.apply(d.ops, { origin: "user" }).ok).toBe(true)
    expect(pagesOf(s).map((p) => p.name)).toEqual(["Page 1", "Page 1 copy", "Other"])
    const copies = pageRoots(s, d.pageId)
    expect(copies).toHaveLength(2)
    const child = s.children(copies[0] as string)
    expect(child).toHaveLength(1)
    expect(s.getNode(child[0] as string)?.page).toBeUndefined()
    expect(validate(s.toDocument()).ok).toBe(true)
  })
})

test("materializePage names the implicit page in one step", () => {
  const s = seeded()
  const m = materializePageOps(s, "Home")
  s.apply(m.ops, { origin: "user" })
  expect(pagesOf(s)).toEqual([{ id: m.pageId, name: "Home", order: expect.any(String) }])
  expect(pageRoots(s, m.pageId)).toEqual(["FrameA0001", "FrameB0001"])
  expect(materializePageOps(s).ops).toEqual([])
})
