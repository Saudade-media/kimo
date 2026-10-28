import { describe, expect, test } from "bun:test"
import type { Rect } from "@kimo/layout"
import type { PathContour } from "@kimo/renderer"
import fc from "fast-check"
import {
  contoursBounds,
  contoursToD,
  cubicAt,
  parsePath,
  pathGeometry,
  segmentOf,
  splitSegment,
} from "../../src/canvas/path-geometry"
import { cutAtAnchors, deleteSegment } from "../../src/canvas/path-tools"

describe("path data", () => {
  test("parses every command kind into contours", () => {
    const c = parsePath(
      "M10 10 L20 10 H30 V20 C30 30 20 30 20 20 S10 10 10 20 Q5 25 0 20 T-10 20 Z",
    )
    expect(c.length).toBe(1)
    expect(c[0]?.closed).toBe(true)
    expect(c[0]?.anchors.length).toBe(8)
    expect(c[0]?.anchors[3]).toEqual({ x: 30, y: 20, out: { x: 30, y: 30 } })
  })

  test("relative commands, implicit line-tos, multiple subpaths and packed arc flags", () => {
    const c = parsePath("m0 0 10 0 0 10z m20 0 h5")
    expect(c.length).toBe(2)
    expect(c[0]?.anchors.map((a) => [a.x, a.y])).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
    ])
    expect(c[1]?.anchors.map((a) => [a.x, a.y])).toEqual([
      [20, 0],
      [25, 0],
    ])
    // Arcs become cubics through the end point.
    const arc = parsePath("M0 0a10 10 0 0110 10")
    const last = arc[0]?.anchors.at(-1)
    expect(last?.x).toBeCloseTo(10, 9)
    expect(last?.y).toBeCloseTo(10, 9)
    const b = contoursBounds(arc) as Rect
    expect(b.w).toBeCloseTo(10, 3)
    expect(b.h).toBeCloseTo(10, 3)
  })

  test("closing on the first anchor merges the duplicate vertex", () => {
    const c = parsePath("M0 0C10 0 10 10 0 10C-10 10 -10 0 0 0Z")
    expect(c[0]?.anchors.length).toBe(2)
    expect(c[0]?.anchors[0]?.in).toEqual({ x: -10, y: 0 })
  })

  test("round trip: contoursToD then parsePath is the identity on contours", () => {
    const pt = fc.record({
      x: fc.integer({ min: -1000, max: 1000 }),
      y: fc.integer({ min: -1000, max: 1000 }),
    })
    const anchor = fc.record(
      {
        x: fc.integer({ min: -1000, max: 1000 }),
        y: fc.integer({ min: -1000, max: 1000 }),
        in: pt,
        out: pt,
      },
      { requiredKeys: ["x", "y"] },
    )
    fc.assert(
      fc.property(
        fc.array(anchor, { minLength: 2, maxLength: 8 }),
        fc.boolean(),
        (anchors, closed) => {
          // Handles equal to their anchor are not handles.
          const clean = anchors.map((a) => {
            const o: Record<string, unknown> = { x: a.x, y: a.y }
            if (a.in && (a.in.x !== a.x || a.in.y !== a.y)) o.in = a.in
            if (a.out && (a.out.x !== a.x || a.out.y !== a.y)) o.out = a.out
            return o
          })
          // Distinct first/last anchors (a coincident pair is legitimately merged on close).
          // An open contour's outer handles do not exist in path data.
          if (!closed) {
            delete (clean[0] as Record<string, unknown>).in
            delete (clean.at(-1) as Record<string, unknown>).out
          }
          const f = clean[0] as { x: number; y: number }
          const l = clean.at(-1) as { x: number; y: number }
          if (f.x === l.x && f.y === l.y) return true
          const c: PathContour[] = [{ anchors: clean as never, closed }]
          const back = parsePath(contoursToD(c))
          expect(back).toEqual(c)
          return true
        },
      ),
    )
  })

  test("a path node maps to world contours and back: tight bounds, d relative to the box, viewBox scaled to the size", () => {
    const contours: PathContour[] = [
      {
        anchors: [
          { x: 110, y: 220 },
          { x: 210, y: 220, in: { x: 160, y: 170 } },
        ],
        closed: false,
      },
    ]
    const n = pathGeometry.toNode(contours, [1, 0, 0, 1, 100, 200])
    expect(n.x).toBe(10)
    expect(n.w).toBe(100)
    expect(n.viewBox).toEqual([0, 0, n.w, n.h])
    expect(n.h).toBeGreaterThan(0)
    expect(n.h).toBeLessThan(50) // tight bounds, not the control point (50 above)
    expect(n.d.startsWith(`M0 ${n.h}`)).toBe(true)
    // fromNode(toNode(x)) maps back to the same world contours.
    const back = pathGeometry.fromNode(n, [1, 0, 0, 1, 100 + n.x, 200 + n.y])
    expect(back[0]?.anchors[1]?.x).toBeCloseTo(210, 1)
    expect(back[0]?.anchors[1]?.in?.y).toBeCloseTo(170, 1)
    const scaled = pathGeometry.fromNode(
      { d: "M0 0L10 10", viewBox: [0, 0, 10, 10], w: 100, h: 50 },
      [1, 0, 0, 1, 5, 5],
    )
    expect(scaled[0]?.anchors.map((a) => [a.x, a.y])).toEqual([
      [5, 5],
      [105, 55],
    ])
  })
})

describe("path editing", () => {
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

  test("splitting a segment keeps the curve shape", () => {
    const c: PathContour[] = [
      {
        anchors: [
          { x: 0, y: 0, out: { x: 0, y: 50 } },
          { x: 100, y: 0, in: { x: 100, y: 50 } },
        ],
        closed: false,
      },
    ]
    const before = segmentOf(c[0] as PathContour, 0)
    const { contours, anchor } = splitSegment(c, 0, 0, 0.3)
    expect(anchor).toEqual({ contour: 0, index: 1 })
    const k = contours[0] as PathContour
    expect(k.anchors.length).toBe(3)
    const mid = cubicAt(before, 0.3)
    expect(k.anchors[1]?.x).toBeCloseTo(mid.x, 9)
    // A point on the second half equals the original curve at the mapped t.
    const p = cubicAt(segmentOf(k, 1), 0.5)
    const o = cubicAt(before, 0.3 + 0.7 * 0.5)
    expect(p.x).toBeCloseTo(o.x, 9)
    expect(p.y).toBeCloseTo(o.y, 9)
  })

  test("cut: an open path at an interior anchor becomes two paths; a closed one is opened", () => {
    const r = cutAtAnchors(open, [{ contour: 0, index: 1 }])
    expect(r?.keep.map((c) => c.anchors.length)).toEqual([2])
    expect(r?.extra.map((c) => c.anchors.map((a) => a.x))).toEqual([[50, 100]])
    expect(cutAtAnchors(open, [{ contour: 0, index: 0 }])).toBeNull()
    const c = cutAtAnchors(square, [{ contour: 0, index: 2 }])
    expect(c?.extra).toEqual([])
    expect(c?.keep[0]?.closed).toBe(false)
    expect(contoursToD(c?.keep ?? [])).toBe("M10 10L0 10L0 0L10 0L10 10")
  })

  test("delete segment: an open path splits in two pieces; a closed one is opened", () => {
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
})
