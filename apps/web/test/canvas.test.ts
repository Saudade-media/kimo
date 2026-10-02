import { describe, expect, test } from "bun:test"
import { createDocStore, type DocStore, type Op } from "@kimo/editor-state"
import { createLayoutEngine, createResolver, type TextMeasurer } from "@kimo/layout"
import {
  canMove,
  createShapeOp,
  deleteOps,
  dropParent,
  duplicateOps,
  groupOps,
  moveOps,
  moveStart,
  nextName,
  nudgeOps,
  resizeOps,
  resizeStart,
  topLevel,
} from "../src/canvas/commands"
import { startGesture } from "../src/canvas/gesture"
import { fitViewport, handleAt, mapBox, resizeBox, sizeLabel } from "../src/canvas/math"
import { enterTarget, pickTarget } from "../src/canvas/selection"

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

describe("math", () => {
  const S = { x: 0, y: 0, w: 100, h: 50 }
  test("resize handles", () => {
    expect(resizeBox(S, "e", 20, 99)).toEqual({ x: 0, y: 0, w: 120, h: 50 })
    expect(resizeBox(S, "nw", 10, 5)).toEqual({ x: 10, y: 5, w: 90, h: 45 })
    expect(resizeBox(S, "s", 0, -50)).toEqual({ x: 0, y: 0, w: 100, h: 1 })
    // Past the opposite edge the box flips around the fixed edge.
    expect(resizeBox(S, "s", 0, -100)).toEqual({ x: 0, y: -50, w: 100, h: 50 })
    expect(resizeBox(S, "e", -160, 0)).toEqual({ x: -60, y: 0, w: 60, h: 50 })
    expect(resizeBox(S, "nw", 130, 60)).toEqual({ x: 100, y: 50, w: 30, h: 10 })
    expect(resizeBox(S, "se", 100, 0, { aspect: true })).toEqual({ x: 0, y: 0, w: 200, h: 100 })
    expect(resizeBox(S, "e", 100, 0, { aspect: true })).toEqual({ x: 0, y: -25, w: 200, h: 100 })
    expect(resizeBox(S, "w", -10, 0, { center: true })).toEqual({ x: -10, y: 0, w: 120, h: 50 })
  })
  test("handle hit zones (4 corners + 4 edges)", () => {
    const b = { x: 10, y: 10, w: 100, h: 100 }
    expect(handleAt(b, { x: 12, y: 8 })).toBe("nw")
    expect(handleAt(b, { x: 110, y: 110 })).toBe("se")
    expect(handleAt(b, { x: 60, y: 11 })).toBe("n")
    expect(handleAt(b, { x: 108, y: 60 })).toBe("e")
    expect(handleAt(b, { x: 60, y: 60 })).toBeNull()
  })
  test("fit viewport centres the bounds, ≤ 100%", () => {
    const v = fitViewport({ x: 0, y: 0, w: 100, h: 100 }, 400, 300, 50)
    expect(v.zoom).toBe(1)
    expect(v).toEqual({ zoom: 1, x: -150, y: -100 })
    expect(fitViewport({ x: 0, y: 0, w: 2000, h: 100 }, 1000, 500, 0).zoom).toBe(0.5)
  })
  test("mapBox", () => {
    expect(mapBox({ x: 10, y: 10, w: 10, h: 10 }, S, { x: 0, y: 0, w: 200, h: 100 })).toEqual({
      x: 20,
      y: 20,
      w: 20,
      h: 20,
    })
  })
  test("size badge label", () => {
    const box = { x: 0, y: 0, w: 720, h: 366 }
    expect(sizeLabel({ type: "frame", parent: null, order: "a", w: 720 }, box)).toBe(
      "720 × Hug 366",
    )
    expect(
      sizeLabel({ type: "frame", parent: null, order: "a", w: { mode: "fill" }, h: 10 }, box),
    ).toBe("720 × 366")
    expect(sizeLabel(null, { x: 0, y: 0, w: 10.333, h: 2 })).toBe("10.33 × 2")
  })
})

describe("commands", () => {
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

  test("create: drop parent skips auto-layout frames; names count up", async () => {
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

  test("group into frame keeps world positions", async () => {
    const { store, layout } = await fixture()
    const ops = groupOps(store, layout(), ["rect01", "rowFrm"], "group0")
    if (!ops) throw new Error("no ops")
    apply(store, ops)
    expect(store.getNode("group0")).toMatchObject({
      parent: "frameA",
      x: 10,
      y: 20,
      w: 150,
      h: 100,
    })
    expect(store.children("group0")).toEqual(["rect01", "rowFrm"])
    const l2 = layout()
    expect(l2.nodes.get("rect01")?.world).toEqual({ x: 110, y: 70, w: 50, h: 40 })
    expect(l2.nodes.get("rect02")?.world.x).toBe(200)
    expect(groupOps(store, l2, ["rect01", "solo00"])).toBeNull()
  })

  test("a gesture is one undo step; cancel reverts", async () => {
    const { store } = await fixture()
    const g = startGesture(store, "user", "Move")
    for (const x of [1, 2, 3]) g.set([{ op: "update", id: "solo00", set: { x } }])
    g.end()
    expect(store.getNode("solo00")?.x).toBe(3)
    store.undo("user")
    expect(store.getNode("solo00")?.x).toBe(600)
    expect(store.canUndo("user")).toBe(false)
    const c = startGesture(store, "user", "Move")
    c.set([{ op: "update", id: "solo00", set: { x: 9 } }])
    c.cancel()
    expect(store.getNode("solo00")?.x).toBe(600)
  })
})

describe("selection policy", () => {
  test("click picks the child of the root; keeps depth among siblings; ⌘ = deepest", async () => {
    const { store } = await fixture()
    expect(pickTarget(store, "rect02", [], false)).toBe("rowFrm")
    expect(pickTarget(store, "rect02", [], true)).toBe("rect02")
    expect(pickTarget(store, "frameA", [], false)).toBe("frameA")
    expect(pickTarget(store, "rect03", ["rect02"], false)).toBe("rect03")
    expect(pickTarget(store, "rect02", ["rowFrm"], false)).toBe("rowFrm")
    expect(enterTarget(store, "rect02", "rowFrm")).toBe("rect02")
    expect(enterTarget(store, "rect02", "frameA")).toBe("rowFrm")
  })
})
