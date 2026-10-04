/**
 * Board 27 §5 "Tools" (NkFBd): shape slot (rkFut), polygon & star (ICb89), line / arrow, and
 * the path-edit toolbar operations (J5Vng). Pure pieces; the canvas flows are e2e
 * (`e2e/board27-tools.e2e.ts`).
 */
import { describe, expect, test } from "bun:test"
import { createUiStore } from "@kimo/editor-state"
import type { PathContour } from "@kimo/renderer"
import {
  ARROW_HEAD,
  clampRatio,
  clampSides,
  createShapeOp,
  lineContours,
  nextName,
  POLYGON_SIDES,
  STAR_RATIO,
} from "../src/canvas/commands"
import { CANVAS_TOOLS, SHAPE_SLOT_TOOLS } from "../src/canvas/contract"
import { contoursToD } from "../src/canvas/path-geometry"
import {
  anchorKindOf,
  bendSegment,
  cutAtAnchors,
  deleteSegment,
  RADIUS_HANDLE_INSET,
  radiusFromLocal,
  ratioFromLocal,
  selectedAnchorKind,
  setAnchorKind,
  starHandles,
  toggleAnchorKind,
} from "../src/canvas/path-tools"
import { canvasToolStore, slotToolId } from "../src/canvas/tool-state"
import { matches, shortcut } from "../src/shortcuts/shortcuts"

const doc = {
  nodeIds: () => ["a", "b"],
  getNode: (id: string) => ({ id, name: id === "a" ? "Star 2" : "Polygon 1" }),
  children: () => [],
  hasNode: () => true,
} as never
const layout = { nodes: new Map() } as never
const ev = (o: Partial<KeyboardEvent>) =>
  ({
    key: "",
    code: "",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...o,
  }) as KeyboardEvent

describe("shape slot (rkFut)", () => {
  test("six tools share one slot in flyout order with the design's icons and shortcuts", () => {
    expect(SHAPE_SLOT_TOOLS.map((t) => [t.label, t.icon, t.shortcut])).toEqual([
      ["Rectangle", "square", "R"],
      ["Ellipse", "circle", "O"],
      ["Line", "minus", "L"],
      ["Arrow", "move-up-right", "⇧L"],
      ["Polygon", "pentagon", ""],
      ["Star", "star", "⇧S"],
    ])
    // The slot sits where Rectangle was: Move, Frame, slot, Text… (board 03 width kept).
    const firstSlot = CANVAS_TOOLS.findIndex((t) => t.slot === "shape")
    expect(CANVAS_TOOLS.slice(0, firstSlot).map((t) => t.id)).toEqual(["move", "frame"])
    expect(CANVAS_TOOLS[firstSlot + SHAPE_SLOT_TOOLS.length]?.id).toBe("text")
  })

  test("shortcuts work regardless of the slot (⇧P stays Prompt; Polygon has no key)", () => {
    expect(matches("tool.line", ev({ key: "l" }))).toBe(true)
    expect(matches("tool.arrow", ev({ key: "L", shiftKey: true }))).toBe(true)
    expect(matches("tool.prompt", ev({ key: "P", shiftKey: true }))).toBe(true)
    expect(matches("tool.star", ev({ key: "S", shiftKey: true }))).toBe(true)
    expect(() => shortcut("tool.polygon")).toThrow()
    expect(CANVAS_TOOLS.find((t) => t.id === "prompt")?.shortcut).toBe("⇧P")
    expect(CANVAS_TOOLS.find((t) => t.id === "polygon")?.shortcut).toBe("")
  })

  test("the slot remembers the last-used shape; other tools keep it", () => {
    const ui = createUiStore()
    const tools = canvasToolStore(ui)
    expect(tools.get().shape).toBe("rectangle")
    ui.getState().setTool("star")
    expect(tools.get().shape).toBe("star")
    ui.getState().setTool("text")
    ui.getState().setTool("select")
    expect(tools.get().shape).toBe("star")
    ui.getState().setTool("arrow")
    expect(tools.get().shape).toBe("arrow")
    expect(slotToolId("polygon")).toBe("polygon")
    expect(slotToolId("rect")).toBe("rectangle")
    expect(slotToolId("frame")).toBeNull()
  })

  test("session defaults: polygon 3 sides, star 5 points", () => {
    const t = canvasToolStore(createUiStore()).get()
    expect([t.polygonSides, t.starPoints]).toEqual([3, 5])
  })
})

describe("polygon & star (ICb89)", () => {
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
    expect(nextName(doc, "star")).toBe("Star 3")
  })

  test("sides 3–60, ratio 1–99 %", () => {
    expect([clampSides(1), clampSides(7.4), clampSides(99)]).toEqual([3, 7, 60])
    expect([clampRatio(0), clampRatio(0.384), clampRatio(1)]).toEqual([0.01, 0.38, 0.99])
    expect(STAR_RATIO.default).toBe(0.38)
  })

  test("canvas handles: ratio on the top axis at the inner radius, radius 13 px under the point", () => {
    // ICb89: star 130 × 130 at 200, 50 → ratio handle centre 265, 90; radius handle 265, 63.
    const h = starHandles(130, 130, 0.38, 0, 1)
    expect(h.ratio.x).toBe(65)
    expect(Math.round(50 + h.ratio.y)).toBe(90)
    expect(50 + h.radius.y).toBe(63)
    expect(RADIUS_HANDLE_INSET).toBe(13)
    expect(ratioFromLocal(130, { x: 65, y: 65 - 65 * 0.5 })).toBe(0.5)
    expect(ratioFromLocal(130, { x: 65, y: 200 })).toBe(0.01)
    expect(radiusFromLocal(130, { x: 65, y: 13 + 4 }, 1)).toBe(4)
    expect(radiusFromLocal(130, { x: 65, y: 2 }, 1)).toBe(0)
  })
})

describe("line / arrow", () => {
  test("line = one open segment; arrow adds an open two-segment head at the end", () => {
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

describe("path edit toolbar (J5Vng)", () => {
  const open: PathContour[] = [
    {
      closed: false,
      anchors: [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 100, y: 0 },
      ],
    },
  ]
  const square: PathContour[] = [
    {
      closed: true,
      anchors: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
    },
  ]

  test("Smooth gives mirrored handles; Sharp drops them; mixed selection shows neither", () => {
    const s = setAnchorKind(open, [{ contour: 0, index: 1 }], "smooth")
    const m = s[0]?.anchors[1]
    expect(m?.in).toEqual({ x: 50 - 50 / 3, y: 0 })
    expect(m?.out).toEqual({ x: 50 + 50 / 3, y: 0 })
    expect(anchorKindOf(m as never)).toBe("smooth")
    const refs = [
      { contour: 0, index: 0 },
      { contour: 0, index: 1 },
    ]
    expect(selectedAnchorKind(s, refs)).toBeNull()
    expect(selectedAnchorKind(s, [{ contour: 0, index: 1 }])).toBe("smooth")
    expect(selectedAnchorKind(open, [])).toBeNull()
    const back = toggleAnchorKind(s, { contour: 0, index: 1 })
    expect(back[0]?.anchors[1]).toEqual({ x: 50, y: 0 })
  })

  test("cut: open path at an interior anchor → two paths; closed → opened", () => {
    const r = cutAtAnchors(open, [{ contour: 0, index: 1 }])
    expect(r?.keep.map((c) => c.anchors.length)).toEqual([2])
    expect(r?.extra.map((c) => c.anchors.map((a) => a.x))).toEqual([[50, 100]])
    expect(cutAtAnchors(open, [{ contour: 0, index: 0 }])).toBeNull()
    const c = cutAtAnchors(square, [{ contour: 0, index: 2 }])
    expect(c?.extra).toEqual([])
    expect(c?.keep[0]?.closed).toBe(false)
    expect(contoursToD(c?.keep ?? [])).toBe("M10 10L0 10L0 0L10 0L10 10")
  })

  test("delete segment: open → two pieces in the same path; closed → opened", () => {
    expect(deleteSegment(open, { contour: 0, index: 0 }).map((c) => c.anchors.length)).toEqual([2])
    const four: PathContour[] = [
      {
        closed: false,
        anchors: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 2, y: 0 },
          { x: 3, y: 0 },
        ],
      },
    ]
    expect(deleteSegment(four, { contour: 0, index: 1 }).map((c) => c.anchors.length)).toEqual([
      2, 2,
    ])
    const sq = deleteSegment(square, { contour: 0, index: 3 })
    expect(sq.length).toBe(1)
    expect(sq[0]?.closed).toBe(false)
    expect(contoursToD(sq)).toBe("M0 0L10 0L10 10L0 10")
  })

  test("bend: the curve passes through the pointer at t", () => {
    const b = bendSegment(open, { contour: 0, index: 0 }, 0.5, { x: 25, y: 20 })
    const a0 = b[0]?.anchors[0]
    const a1 = b[0]?.anchors[1]
    // B(0.5) = (P0 + 3C1 + 3C2 + P3) / 8
    const y = (0 + 3 * (a0?.out?.y ?? 0) + 3 * (a1?.in?.y ?? 0) + 0) / 8
    expect(y).toBeCloseTo(20, 6)
  })
})
