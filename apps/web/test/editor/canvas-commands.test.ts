import { describe, expect, test } from "bun:test"
import { createDocStore, type DocStore, type Op } from "@kimo/editor-state"
import { createLayoutEngine, createResolver, type TextMeasurer } from "@kimo/layout"
import {
  ARROW_HEAD,
  canMove,
  cloneOps,
  createShapeOp,
  deleteOps,
  dropParent,
  duplicateOps,
  flipOps,
  lineContours,
  moveOps,
  moveStart,
  nextName,
  nudgeOps,
  POLYGON_SIDES,
  resizeOps,
  resizeStart,
  topLevel,
} from "../../src/canvas/commands"
import {
  contentBox,
  type FlowFrame,
  flowSiblingIndex,
  padOf,
  sequentialIndices,
  slotAnchor,
  slotIndex,
} from "../../src/canvas/insertion"
import { resizeBox } from "../../src/canvas/math"

const measure: TextMeasurer = {
  measure: (t) => {
    const text = t.runs.map((r) => r.text).join("")
    return { w: text.length * t.style.fontSize * 0.5, h: t.style.fontSize * 1.2 }
  },
}

/** root frame "frameA" (free) with rect r1 + flow frame "rowFrm" (r2, r3); root rect "solo00". */
async function fixture() {
  const store = createDocStore()
  const ops: Op[] = [
    {
      op: "insert",
      id: "frameA",
      parent: null,
      node: { type: "frame", name: "frameA", x: 100, y: 50, w: 400, h: 300 },
    },
    {
      op: "insert",
      id: "rect01",
      parent: "frameA",
      node: { type: "rect", name: "Rectangle 1", x: 10, y: 20, w: 50, h: 40 },
    },
    {
      op: "insert",
      id: "rowFrm",
      parent: "frameA",
      node: { type: "frame", x: 100, y: 100, layout: { dir: "row", gap: 10 } },
    },
    { op: "insert", id: "rect02", parent: "rowFrm", node: { type: "rect", w: 20, h: 20 } },
    { op: "insert", id: "rect03", parent: "rowFrm", node: { type: "rect", w: 30, h: 20 } },
    {
      op: "insert",
      id: "solo00",
      parent: null,
      node: { type: "rect", name: "Rectangle 4", x: 600, y: 0, w: 10, h: 10 },
    },
  ]
  const r = store.apply(ops, { origin: "user" })
  if (!r.ok) throw new Error(JSON.stringify(r.errors))
  store.clearHistory()
  const engine = createLayoutEngine()
  await engine.init()
  const layout = () =>
    engine.compute({ nodes: store, resolve: createResolver({}, store), measureText: measure })
  return { store, layout }
}

const apply = (store: DocStore, ops: readonly Op[]) => {
  const r = store.apply(ops, { origin: "user" })
  if (!r.ok) throw new Error(JSON.stringify(r.errors))
}

describe("resize math", () => {
  const S = { x: 0, y: 0, w: 100, h: 50 }
  test("handles resize from the fixed edge, flip past it, keep aspect, resize around the center", () => {
    expect(resizeBox(S, "e", 20, 99)).toEqual({ x: 0, y: 0, w: 120, h: 50 })
    expect(resizeBox(S, "nw", 10, 5)).toEqual({ x: 10, y: 5, w: 90, h: 45 })
    expect(resizeBox(S, "s", 0, -50)).toEqual({ x: 0, y: 0, w: 100, h: 1 })
    // Past the opposite edge the box flips around the fixed edge.
    expect(resizeBox(S, "s", 0, -100)).toEqual({ x: 0, y: -50, w: 100, h: 50 })
    expect(resizeBox(S, "e", -160, 0)).toEqual({ x: -60, y: 0, w: 60, h: 50 })
    expect(resizeBox(S, "se", 100, 0, { aspect: true })).toEqual({ x: 0, y: 0, w: 200, h: 100 })
    expect(resizeBox(S, "w", -10, 0, { center: true })).toEqual({ x: -10, y: 0, w: 120, h: 50 })
  })
})

describe("canvas commands", () => {
  test("flow children cannot move; free ones move in parent space", async () => {
    const { store, layout } = await fixture()
    expect(canMove(store, "rect02")).toBe(false)
    expect(canMove(store, "rect01")).toBe(true)
    const l = layout()
    const ops = moveOps(store, l, moveStart(store, ["rect01", "rect02"]), { x: 5, y: -5 })
    expect(ops).toEqual([{ op: "update", id: "rect01", set: { x: 15, y: 15 } }])
    expect(nudgeOps(store, l, ["frameA", "rect01"], 10, 0)).toEqual([
      { op: "update", id: "frameA", set: { x: 110, y: 50 } },
    ])
  })

  test("resize: single, flow child (size only), multi (scaled)", async () => {
    const { store, layout } = await fixture()
    const l = layout()
    const s = resizeStart(store, l, ["rect01"])
    expect(s?.box).toEqual({ x: 110, y: 70, w: 50, h: 40 })
    if (!s) return
    expect(resizeOps(store, l, s, { x: 100, y: 70, w: 60, h: 40 })).toEqual([
      { op: "update", id: "rect01", set: { w: 60, x: 0 } },
    ])
    const f = resizeStart(store, l, ["rect02"])
    if (!f) throw new Error("no snap")
    expect(resizeOps(store, l, f, { ...f.box, x: f.box.x - 10, w: 30 })).toEqual([
      { op: "update", id: "rect02", set: { w: 30 } },
    ])
    const m = resizeStart(store, l, ["frameA", "solo00"])
    if (!m) throw new Error("no snap")
    expect(m.box).toEqual({ x: 100, y: 0, w: 510, h: 350 })
    const ops = resizeOps(store, l, m, { x: 100, y: 0, w: 1020, h: 350 })
    expect(ops).toEqual([
      { op: "update", id: "frameA", set: { w: 800 } },
      { op: "update", id: "solo00", set: { w: 20, x: 1100 } },
    ])
  })

  test("create: drop parent skips auto-layout frames; the shape lands in parent space", async () => {
    const { store, layout } = await fixture()
    const l = layout()
    expect(dropParent(store, ["rect02", "rowFrm", "frameA"])).toBe("frameA")
    expect(dropParent(store, [])).toBeNull()
    expect(nextName(store, "rect")).toBe("Rectangle 5")
    const op = createShapeOp(
      store,
      l,
      "ellipse",
      "frameA",
      { x: 150, y: 60, w: 20, h: 10 },
      "ellip1",
    )
    apply(store, [op])
    expect(store.getNode("ellip1")).toMatchObject({ parent: "frameA", x: 50, y: 10, w: 20, h: 10 })
  })

  test("delete keeps only top-level ids", async () => {
    const { store } = await fixture()
    expect(topLevel(store, ["rect02", "frameA", "solo00"])).toEqual(["frameA", "solo00"])
    apply(store, deleteOps(store, ["rect01", "frameA"]))
    expect(store.hasNode("frameA") || store.hasNode("rect01")).toBe(false)
  })

  test("duplicate copies subtrees with offsets", async () => {
    const { store, layout } = await fixture()
    let n = 0
    const { ops, created } = duplicateOps(
      store,
      layout(),
      ["frameA", "rect02"],
      () => `copy0${n++}`,
    )
    apply(store, ops)
    // rect02 is inside the selected frame: only the frame's subtree is copied.
    expect(created).toEqual(["copy00"])
    expect(store.getNode("copy00")).toMatchObject({ x: 100 + 400 + 32, y: 50, parent: null })
    expect(store.children("copy00")).toHaveLength(2)
    const flow = duplicateOps(store, layout(), ["rect02"], () => "copy09")
    apply(store, flow.ops)
    expect(store.children("rowFrm")).toEqual(["rect02", "copy09", "rect03"])
    expect(store.getNode("copy09")?.x).toBeUndefined()
  })

  test("flip: any unflipped turns all on, all flipped unsets, groups are skipped", () => {
    const s = createDocStore()
    const ops: Op[] = [
      {
        op: "insert",
        id: "rectA1",
        parent: null,
        node: { type: "rect", x: 0, y: 0, w: 10, h: 10 },
      },
      {
        op: "insert",
        id: "rectB1",
        parent: null,
        node: { type: "rect", x: 20, y: 0, w: 10, h: 10, flipX: true },
      },
      { op: "insert", id: "groupG", parent: null, node: { type: "group" } },
    ]
    expect(s.apply(ops, { origin: "user" }).ok).toBe(true)
    expect(flipOps(s, ["rectA1", "rectB1"], "x")).toEqual([
      { op: "update", id: "rectA1", set: { flipX: true } },
      { op: "update", id: "rectB1", set: { flipX: true } },
    ])
    expect(flipOps(s, ["rectB1"], "x")).toEqual([{ op: "update", id: "rectB1", unset: ["flipX"] }])
    expect(s.apply(flipOps(s, ["rectA1"], "x"), { origin: "user" }).ok).toBe(true)
    // The size stays positive: a flip is never a negative width.
    expect(s.getNode("rectA1")?.flipX).toBe(true)
    expect(s.getNode("rectA1")?.w).toBe(10)
    expect(flipOps(s, ["groupG"], "x")).toEqual([])
  })
})

describe("shape tools", () => {
  const doc = {
    nodeIds: () => ["a", "b"],
    getNode: (id: string) => ({ id, name: id === "a" ? "Star 2" : "Polygon 1" }),
    children: () => [],
    hasNode: () => true,
  } as never
  const layout = { nodes: new Map() } as never

  test("polygon tool writes a native polygon; star = polygon + star (default ratio omitted)", () => {
    const r = { x: 10, y: 20, w: 130, h: 130 }
    const p = createShapeOp(doc, layout, "polygon", null, r, "p1", "Polygon 2", 6) as {
      node: Record<string, unknown>
    }
    expect(p.node).toMatchObject({ type: "polygon", sides: 6, x: 10, y: 20, w: 130, h: 130 })
    expect(p.node.star).toBeUndefined()
    const s = createShapeOp(doc, layout, "star", null, r, "s1", "Star 3") as {
      node: Record<string, unknown>
    }
    expect(s.node).toMatchObject({ type: "polygon", sides: 5, star: {} })
    const d = createShapeOp(doc, layout, "polygon", null, r, "p2") as { node: { sides: number } }
    expect(d.node.sides).toBe(POLYGON_SIDES.polygon)
  })

  test("line is one open segment; arrow adds an open two-segment head at the end", () => {
    const a = { x: 0, y: 0 }
    const b = { x: 100, y: 0 }
    expect(lineContours("line", a, b)).toEqual([{ anchors: [a, b], closed: false }])
    const arrow = lineContours("arrow", a, b)
    expect(arrow.length).toBe(2)
    const head = arrow[1]?.anchors ?? []
    expect(head[1]).toEqual(b)
    const wing = head[0] as { x: number; y: number }
    expect(Math.hypot(wing.x - b.x, wing.y - b.y)).toBeCloseTo(ARROW_HEAD.length, 6)
    expect(Math.abs(Math.atan2(wing.y, b.x - wing.x))).toBeCloseTo(ARROW_HEAD.angle, 6)
  })
})

describe("reorder and clone drags", () => {
  const row: FlowFrame = {
    dir: "row",
    content: contentBox({ x: 10, y: 24, w: 288, h: 112 }, padOf(12)),
    gap: 12,
    children: [
      { id: "one", box: { x: 22, y: 36, w: 80, h: 88 } },
      { id: "two", box: { x: 114, y: 36, w: 80, h: 88 } },
      { id: "three", box: { x: 206, y: 36, w: 80, h: 88 } },
    ],
  }

  test("the insertion slot follows the pointer between children, before the first and after the last", () => {
    expect(slotIndex(row, { x: 106, y: 80 })).toBe(1)
    expect(slotIndex(row, { x: 0, y: 80 })).toBe(0)
    expect(slotIndex(row, { x: 400, y: 80 })).toBe(3)
    const col: FlowFrame = {
      dir: "column",
      content: { x: 0, y: 0, w: 200, h: 300 },
      gap: 10,
      children: [
        { id: "a", box: { x: 0, y: 0, w: 200, h: 40 } },
        { id: "b", box: { x: 0, y: 50, w: 200, h: 40 } },
      ],
    }
    expect(slotIndex(col, { x: 100, y: 48 })).toBe(1)
  })

  test("flow slots map to sibling indices past absolute siblings; a multi-selection moves together and in order", () => {
    const siblings = ["a", "abs", "b", "c"]
    const flow = ["a", "b", "c"]
    expect(flowSiblingIndex(siblings, flow, 1)).toBe(2)
    expect(flowSiblingIndex(siblings, flow, 3)).toBe(4)
    expect(flowSiblingIndex(siblings, [], 0)).toBe(4)
    // [a, b, c, d]: move b and c after d.
    const idx = sequentialIndices(["a", "b", "c", "d"], ["b", "c"], null)
    const list = ["a", "b", "c", "d"]
    for (const [i, id] of ["b", "c"].entries()) {
      list.splice(list.indexOf(id), 1)
      list.splice(idx[i] as number, 0, id)
    }
    expect(list).toEqual(["a", "d", "b", "c"])
    // Before an anchor.
    expect(sequentialIndices(["a", "b", "c", "d"], ["d"], "b")).toEqual([1])
    expect(slotAnchor(["a", "b", "x", "c"], ["a", "c"], 2, new Set(["b"]))).toBeNull()
    expect(slotAnchor(["a", "b", "x", "c"], ["a"], 1, new Set(["b"]))).toBe("x")
  })

  test("option-drag copies each subtree right after its original, same fields", () => {
    const s = createDocStore()
    s.apply(
      [
        {
          op: "insert",
          id: "Frame00001",
          parent: null,
          node: { type: "frame", layout: { dir: "row" } },
        },
        {
          op: "insert",
          id: "CardA00001",
          parent: "Frame00001",
          node: { type: "frame", w: 80, h: 88 },
        },
        {
          op: "insert",
          id: "LabelA0001",
          parent: "CardA00001",
          node: { type: "text", content: "One" },
        },
        {
          op: "insert",
          id: "CardB00001",
          parent: "Frame00001",
          node: { type: "frame", w: 80, h: 88 },
        },
      ],
      { origin: "user" },
    )
    let n = 0
    const { ops, created, pairs } = cloneOps(
      s,
      ["CardA00001"],
      () => `Copy${String(++n).padStart(6, "0")}`,
    )
    expect(s.apply(ops, { origin: "user" }).ok).toBe(true)
    expect(created).toEqual(["Copy000001"])
    expect(pairs.get("CardA00001")).toBe("Copy000001")
    expect(s.children("Frame00001")).toEqual(["CardA00001", "Copy000001", "CardB00001"])
    expect(s.getNode("Copy000002")?.content).toBe("One")
  })
})
