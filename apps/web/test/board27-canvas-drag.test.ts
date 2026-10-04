import { describe, expect, test } from "bun:test"
import { createDocStore } from "@kimo/editor-state"
import { cloneOps } from "../src/canvas/commands"
import {
  contentBox,
  type FlowFrame,
  flowSiblingIndex,
  padOf,
  sequentialIndices,
  slotAnchor,
  slotBar,
  slotIndex,
} from "../src/canvas/insertion"

// Board 27 §2 c2o3u "Feature Row": x 10 y 24, 288×112, padding 12, gap 12, three 80×88 cards.
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

describe("insertion slot math (board 27 §2)", () => {
  test("the design's bar: slot 1 sits at x 105…111, y 36, 88 long (sKpaJ at 105, 36)", () => {
    expect(slotIndex(row, { x: 106, y: 80 })).toBe(1)
    const bar = slotBar(row, 1)
    expect(bar).toEqual({ x: 108, y: 36, length: 88, axis: "v" })
    // The DOM bar is 6 wide centred on x: left 105 as in the design node.
    expect(bar.x - 3).toBe(105)
  })

  test("slots before the first and after the last child sit half a gap outside", () => {
    expect(slotIndex(row, { x: 0, y: 80 })).toBe(0)
    expect(slotBar(row, 0).x).toBe(16)
    expect(slotIndex(row, { x: 400, y: 80 })).toBe(3)
    expect(slotBar(row, 3).x).toBe(292)
  })

  test("column layouts give horizontal bars across the content width", () => {
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
    expect(slotBar(col, 1)).toEqual({ x: 0, y: 45, length: 200, axis: "h" })
    expect(slotBar({ ...col, children: [] }, 0)).toEqual({ x: 0, y: 0, length: 200, axis: "h" })
  })

  test("padding forms and flow → sibling indices with absolute siblings", () => {
    expect(padOf([4, 8])).toEqual([4, 8, 4, 8])
    expect(padOf([1, 2, 3, 4])).toEqual([1, 2, 3, 4])
    const siblings = ["a", "abs", "b", "c"]
    const flow = ["a", "b", "c"]
    expect(flowSiblingIndex(siblings, flow, 1)).toBe(2)
    expect(flowSiblingIndex(siblings, flow, 3)).toBe(4)
    expect(flowSiblingIndex(siblings, [], 0)).toBe(4)
  })

  test("sequential move indices keep a multi-selection together and in order", () => {
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
})

describe("cloneOps (⌥-drag)", () => {
  test("copies each subtree right after its original, same fields", () => {
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
