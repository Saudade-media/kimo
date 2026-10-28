import { describe, expect, test } from "bun:test"
import type { Rect } from "@kimo/layout"
import fc from "fast-check"
import { SNAP_THRESHOLD_PX, type SnapBox, type SnapQuery } from "../../src/canvas/contract"
import { measure } from "../../src/canvas/measure"
import { candidatesIn, snap } from "../../src/canvas/snapping"

const ALL = { left: true, right: true, top: true, bottom: true }
const box = (id: string, x: number, y: number, w: number, h: number): SnapBox => ({
  id,
  rect: { x, y, w, h },
})
const q = (moving: Rect, candidates: SnapBox[], extra: Partial<SnapQuery> = {}): SnapQuery => ({
  moving,
  edges: ALL,
  candidates,
  parent: null,
  zoom: 1,
  ...extra,
})

describe("snap", () => {
  // Image at 80,128 (240x160); a 200x160 card dragged near 360,130.
  const image = box("img", 80, 128, 240, 160)

  test("top, center and bottom snap with guides spanning both boxes", () => {
    const r = snap(q({ x: 360, y: 131, w: 200, h: 160 }, [image]))
    expect(r.dx).toBe(0)
    expect(r.dy).toBe(-3)
    const ys = r.snap.lines.filter((l) => l.axis === "y").map((l) => l.at)
    expect(ys).toEqual([128, 208, 288])
    for (const l of r.snap.lines) {
      expect(l.from).toBe(80)
      expect(l.to).toBe(560)
    }
  })

  test("the threshold is in screen px: 6px at zoom 1, 3 world units at zoom 2", () => {
    expect(snap(q({ x: 360, y: 134, w: 200, h: 160 }, [image])).dy).toBe(-6)
    expect(snap(q({ x: 360, y: 135, w: 200, h: 160 }, [image])).dy).toBe(0)
    expect(snap(q({ x: 360, y: 132, w: 200, h: 160 }, [image], { zoom: 2 })).dy).toBe(0)
    expect(snap(q({ x: 360, y: 131, w: 200, h: 160 }, [image], { zoom: 2 })).dy).toBe(-3)
  })

  test("disabled returns a zero delta and nothing to draw", () => {
    const r = snap(q({ x: 360, y: 131, w: 200, h: 160 }, [image], { disabled: true }))
    expect(r).toEqual({ dx: 0, dy: 0, snap: { lines: [], markers: [] }, spacing: [] })
  })

  test("resize: only the dragged edge snaps; the box grows to the line", () => {
    const r = snap(
      q({ x: 360, y: 100, w: 200, h: 186 }, [image], {
        edges: { left: false, right: false, top: false, bottom: true },
      }),
    )
    expect(r.dy).toBe(2) // bottom 286 -> 288
    expect(r.dx).toBe(0)
    expect(r.snap.lines.map((l) => l.at)).toEqual([288])
  })

  test("equal spacing between two neighbours, and extending a pair's gap", () => {
    const c1 = box("c1", 80, 140, 120, 140)
    const c3 = box("c3", 416, 140, 120, 140)
    const r = snap(q({ x: 251, y: 140, w: 120, h: 140 }, [c1, c3]))
    expect(r.dx).toBe(-3)
    expect(r.spacing.map((s) => [s.from, s.to, s.label])).toEqual([
      [200, 248, "48"],
      [368, 416, "48"],
    ])
    // Only the gaps are drawn: no alignment guides on either axis.
    expect(r.snap.lines).toEqual([])
    const a = box("a", 0, 0, 100, 50)
    const b = box("b", 140, 0, 100, 50)
    const ext = snap(q({ x: 282, y: 0, w: 100, h: 50 }, [a, b]))
    expect(ext.dx).toBe(-2) // 240 + 40
    expect(ext.spacing.map((s) => s.label)).toEqual(["40", "40"])
  })

  test("parent edges and center are candidates", () => {
    const parent = box("p", 0, 0, 400, 300)
    const r = snap(q({ x: 148, y: 50, w: 100, h: 20 }, [parent], { parent }))
    expect(r.dx).toBe(2) // center 198 -> 200
  })

  test("property: the snapped box moves at most threshold/zoom on each axis", () => {
    const arbRect = fc.record({
      x: fc.integer({ min: -500, max: 500 }),
      y: fc.integer({ min: -500, max: 500 }),
      w: fc.integer({ min: 0, max: 300 }),
      h: fc.integer({ min: 0, max: 300 }),
    })
    fc.assert(
      fc.property(
        arbRect,
        fc.array(arbRect, { maxLength: 8 }),
        fc.double({ min: 0.05, max: 64, noNaN: true }),
        (m, cs, zoom) => {
          const r = snap(
            q(
              m,
              cs.map((c, i) => ({ id: `n${i}`, rect: c })),
              { zoom },
            ),
          )
          const t = SNAP_THRESHOLD_PX / zoom + 1e-9
          return Math.abs(r.dx) <= t && Math.abs(r.dy) <= t
        },
      ),
    )
  })

  test("candidates are the visible siblings that are not being moved, plus the parent", () => {
    const nodes = new Map([
      ["p", { world: { x: 0, y: 0, w: 100, h: 100 }, visible: true }],
      ["a", { world: { x: 1, y: 1, w: 1, h: 1 }, visible: true }],
      ["b", { world: { x: 2, y: 2, w: 1, h: 1 }, visible: false }],
      ["c", { world: { x: 3, y: 3, w: 1, h: 1 }, visible: true }],
    ])
    const r = candidatesIn({ nodes } as never, "p", ["c"], () => ["a", "b", "c"])
    expect(r.candidates.map((c) => c.id)).toEqual(["a", "p"])
    expect(r.parent?.id).toBe("p")
  })
})

describe("measure", () => {
  const sel = { x: 200, y: 170, w: 160, h: 48 }

  test("only the gap to the hovered sibling, on the overlap's center", () => {
    const r = measure({ selection: sel, target: box("link", 420, 178, 100, 32), parent: null })
    expect(r.outline).toEqual({ id: "link", role: "target" })
    expect(r.measurements).toEqual([{ axis: "x", at: 194, from: 360, to: 420, label: "60" }])
  })

  test("four distances to the parent on the selection's center axes", () => {
    const r = measure({ selection: sel, target: null, parent: box("card", 80, 80, 480, 260) })
    expect(r.outline).toEqual({ id: "card", role: "parent" })
    expect(r.measurements.map((m) => [m.axis, m.at, m.from, m.to, m.label])).toEqual([
      ["x", 194, 80, 200, "120"],
      ["x", 194, 360, 560, "200"],
      ["y", 280, 80, 170, "90"],
      ["y", 280, 218, 340, "122"],
    ])
  })
})
