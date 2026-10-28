import { describe, expect, test } from "bun:test"
import { validate } from "@kimo/core-schema"
import type { DocStore } from "@kimo/editor-state"
import {
  addAutoLayoutOps,
  canUngroup,
  duplicateNodesOps,
  groupNodesOps,
  removeAutoLayoutOps,
  repeatDelta,
  ungroupOps,
  wrapInFrameOps,
} from "../../src/editor/clipboard/structure"
import { computeTreeDrop, treeDropOps } from "../../src/editor/clipboard/tree-drop"
import { ids, layoutOf, setup } from "./doc-fixture"

describe("structure commands", () => {
  test("duplicate: free nodes +16/+16, flow children next sibling; a repeat after a move keeps the delta", () => {
    const { store } = setup()
    const r = duplicateNodesOps(store, ["CardOne001", "RowA000001"], undefined, ids)
    store.apply(r.ops, { origin: "user" })
    const [card, flow] = r.created
    expect([store.getNode(card as string)?.x, store.getNode(card as string)?.y]).toEqual([36, 40])
    expect(store.children("Row0000001").indexOf(flow as string)).toBe(1)
    store.apply({ op: "update", id: card as string, set: { x: 60, y: 24 } }, { origin: "user" })
    expect(
      repeatDelta(store, { pairs: [["CardOne001", card as string]] }, [card as string]),
    ).toEqual({
      x: 40,
      y: 0,
    })
    expect(repeatDelta(store, null, [card as string])).toEqual({ x: 16, y: 16 })
  })

  test("group makes a real group; ungroup releases it keeping canvas positions", () => {
    const { store, layout } = setup()
    const ops = groupNodesOps(store, layout, ["CardOne001", "BtnInst001"], "GroupNode1")
    expect(store.apply(ops ?? [], { origin: "user" }).ok).toBe(true)
    const g = store.getNode("GroupNode1")
    expect(g?.type).toBe("group")
    expect(g?.w).toBeUndefined()
    expect([g?.x, g?.y]).toEqual([20, 24])
    expect(store.getNode("CardOne001")?.x).toBe(0)
    expect(canUngroup(store, "GroupNode1")).toBe(true)
    const l2 = layoutOf(store)
    ;(l2.nodes as Map<string, unknown>).set("GroupNode1", {
      world: { x: 20, y: 24, w: 260, h: 132 },
      local: { x: 20, y: 24, w: 260, h: 132 },
      transform: [1, 0, 0, 1, 20, 24],
      visible: true,
    })
    const u = ungroupOps(store, l2, ["GroupNode1"])
    expect(u?.freed.sort()).toEqual(["BtnInst001", "CardOne001"])
    expect(store.apply(u?.ops ?? [], { origin: "user" }).ok).toBe(true)
    expect(store.hasNode("GroupNode1")).toBe(false)
    expect(store.getNode("CardOne001")?.parent).toBe("HeroFrame1")
    expect(validate(store.toDocument()).ok).toBe(true)
  })

  test("wrap in frame lands at the first selected node's slot; mains and painted frames don't ungroup", () => {
    const { store, layout } = setup()
    const ops = wrapInFrameOps(store, layout, ["RowB000001"], "WrapFrame1")
    store.apply(ops ?? [], { origin: "user" })
    expect(store.children("Row0000001")).toEqual(["RowA000001", "WrapFrame1"])
    expect(store.getNode("WrapFrame1")?.type).toBe("frame")
    expect(canUngroup(store, "BtnMain001")).toBe(false)
    expect(canUngroup(store, "CardOne001")).toBe(false)
  })

  test("removing auto layout freezes children at their x/y and keeps the frame size; adding infers row, gap and padding", () => {
    const { store, layout } = setup()
    store.apply(removeAutoLayoutOps(store, layout, "Row0000001"), { origin: "user" })
    const row = store.getNode("Row0000001")
    expect(row?.layout).toBeUndefined()
    expect([store.getNode("RowA000001")?.x, store.getNode("RowA000001")?.y]).toEqual([12, 12])
    expect(store.getNode("RowB000001")?.h).toBe(88)
    store.apply(addAutoLayoutOps(store, layoutOf(store), "Row0000001"), { origin: "user" })
    expect(store.getNode("Row0000001")?.layout).toEqual({ dir: "row", gap: 12, pad: 12 })
  })
})

describe("layer drag", () => {
  const rows = [
    { id: "HeroFrame1", depth: 0, parent: null },
    { id: "CardOne001", depth: 1, parent: "HeroFrame1" },
    { id: "BtnInst001", depth: 1, parent: "HeroFrame1" },
    { id: "Row0000001", depth: 0, parent: null },
  ]
  const reader = (store: DocStore) => ({
    getNode: (id: string) => store.getNode(id),
    children: (p: string | null, at?: string | null) => store.children(p, at),
    isVirtual: (id: string) => id.includes("/"),
  })

  test("top quarter = between, middle half of a container = into, instances and descendants refuse", () => {
    const { store } = setup()
    const open = () => true
    const before = computeTreeDrop(rows, 2, 0.1, 1, ["RowA000001"], reader(store), open)
    expect(before).toMatchObject({ kind: "between", parent: "HeroFrame1", index: 1, slot: 2 })
    const into = computeTreeDrop(rows, 1, 0.5, 1, ["RowA000001"], reader(store), open)
    expect(into).toMatchObject({ kind: "into", target: "CardOne001" })
    const inst = computeTreeDrop(rows, 2, 0.5, 1, ["RowA000001"], reader(store), open)
    expect(inst).toMatchObject({ kind: "between" }) // an instance is no container: nearest gap
    const self = computeTreeDrop(rows, 1, 0.5, 1, ["HeroFrame1"], reader(store), open)
    expect(self).toMatchObject({ kind: "invalid" })
    // After the last child of an open group, the pointer's x picks the level.
    const up = computeTreeDrop(rows, 2, 0.9, 0, ["RowA000001"], reader(store), open)
    expect(up).toMatchObject({ kind: "between", parent: null, index: 1, depth: 0 })
  })

  test("dropping into a free frame keeps the canvas position (one undo step)", () => {
    const { store, layout } = setup()
    const drop = computeTreeDrop(rows, 0, 0.5, 0, ["RowA000001"], reader(store), () => true)
    const ops = treeDropOps(reader(store), ["RowA000001"], drop as never, {
      worldOf: (id) => layout.nodes.get(id)?.world ?? null,
      originOf: (p) => (p ? (layout.nodes.get(p)?.world ?? null) : { x: 0, y: 0 }),
    })
    expect(store.apply(ops, { origin: "user" }).ok).toBe(true)
    expect(store.getNode("RowA000001")?.parent).toBe("HeroFrame1")
    expect([store.getNode("RowA000001")?.x, store.getNode("RowA000001")?.y]).toEqual([12, 312])
  })
})
