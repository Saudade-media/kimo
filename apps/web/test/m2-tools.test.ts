import { describe, expect, test } from "bun:test"
import type { Rect } from "@kimo/layout"
import type { PathContour } from "@kimo/renderer"
import fc from "fast-check"
import { SNAP_THRESHOLD_PX, type SnapBox, type SnapQuery } from "../src/canvas/contract"
import { measure } from "../src/canvas/measure"
import {
  constrain45,
  contoursBounds,
  contoursToD,
  cubicAt,
  moveAnchors,
  nearestOnCubic,
  parsePath,
  pathGeometry,
  removeAnchors,
  segmentOf,
  setHandle,
  splitSegment,
} from "../src/canvas/path-geometry"
import { candidatesIn, fmtUnits, snap, snapPoint } from "../src/canvas/snapping"

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
  // Board 10 #1: image 80,128 240×160; card dragged near 360,130 200×160.
  const image = box("img", 80, 128, 240, 160)

  test("board 10 #1: top, center and bottom snap with guides spanning both + markers", () => {
    const r = snap(q({ x: 360, y: 131, w: 200, h: 160 }, [image]))
    expect(r.dx).toBe(0)
    expect(r.dy).toBe(-3)
    const ys = r.snap.lines.filter((l) => l.axis === "y").map((l) => l.at)
    expect(ys).toEqual([128, 208, 288])
    for (const l of r.snap.lines) {
      expect(l.from).toBe(80)
      expect(l.to).toBe(560)
    }
    // Markers at x 80, 320, 360, 560 on each of the three lines (board: Snap × at 76.5+3.5…).
    const at128 = r.snap.markers.filter((m) => m.y === 128).map((m) => m.x)
    expect(at128.sort((a, b) => a - b)).toEqual([80, 320, 360, 560])
    expect(r.snap.markers.length).toBe(12)
  })

  test("threshold is in screen px (board 27 i6rbIi): 6px at zoom 1, 3 world units at zoom 2", () => {
    expect(snap(q({ x: 360, y: 134, w: 200, h: 160 }, [image])).dy).toBe(-6)
    expect(snap(q({ x: 360, y: 135, w: 200, h: 160 }, [image])).dy).toBe(0)
    expect(snap(q({ x: 360, y: 132, w: 200, h: 160 }, [image], { zoom: 2 })).dy).toBe(0)
    expect(snap(q({ x: 360, y: 131, w: 200, h: 160 }, [image], { zoom: 2 })).dy).toBe(-3)
  })

  test("⌘ (disabled) returns a zero delta and nothing to draw", () => {
    const r = snap(q({ x: 360, y: 131, w: 200, h: 160 }, [image], { disabled: true }))
    expect(r).toEqual({ dx: 0, dy: 0, snap: { lines: [], markers: [] }, spacing: [] })
  })

  test("resize: only the dragged edge snaps; the box grows to the line", () => {
    const r = snap(
      q({ x: 360, y: 100, w: 200, h: 186 }, [image], {
        edges: { left: false, right: false, top: false, bottom: true },
      }),
    )
    expect(r.dy).toBe(2) // bottom 286 → 288
    expect(r.dx).toBe(0)
    expect(r.snap.lines.map((l) => l.at)).toEqual([288])
  })

  test("board 10 #2: equal spacing between two neighbours (48 / 48)", () => {
    const c1 = box("c1", 80, 140, 120, 140)
    const c3 = box("c3", 416, 140, 120, 140)
    const r = snap(q({ x: 251, y: 140, w: 120, h: 140 }, [c1, c3]))
    expect(r.dx).toBe(-3)
    expect(r.spacing.map((s) => [s.from, s.to, s.label])).toEqual([
      [200, 248, "48"],
      [368, 416, "48"],
    ])
    expect(r.spacing[0]?.crossFrom).toBe(140)
    expect(r.spacing[0]?.crossTo).toBe(280)
    // V6rSVv draws only the gaps, ticks and pills: no alignment guides on either axis.
    expect(r.snap.lines).toEqual([])
    expect(r.snap.markers).toEqual([])
  })

  test("equal spacing keeps cross-axis guides when that axis snapped itself", () => {
    const c1 = box("c1", 80, 140, 120, 140)
    const c3 = box("c3", 416, 140, 120, 140)
    const r = snap(q({ x: 251, y: 143, w: 120, h: 140 }, [c1, c3]))
    expect(r.dy).toBe(-3)
    expect(r.snap.lines.every((l) => l.axis === "y")).toBe(true)
    expect(r.snap.lines.map((l) => l.at)).toEqual([140, 210, 280])
  })

  test("equal spacing extends a pair's gap", () => {
    const a = box("a", 0, 0, 100, 50)
    const b = box("b", 140, 0, 100, 50)
    const r = snap(q({ x: 282, y: 0, w: 100, h: 50 }, [a, b]))
    expect(r.dx).toBe(-2) // 240 + 40
    expect(r.spacing.map((s) => s.label)).toEqual(["40", "40"])
  })

  test("parent edges and center are candidates", () => {
    const parent = box("p", 0, 0, 400, 300)
    const r = snap(q({ x: 148, y: 50, w: 100, h: 20 }, [parent], { parent }))
    expect(r.dx).toBe(2) // center 198 → 200
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

  test("property: after snapping, every drawn line coincides with a moving line", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -50, max: 50 }),
        fc.integer({ min: -50, max: 50 }),
        (ox, oy) => {
          const m = { x: 360 + ox / 10, y: 128 + oy / 10, w: 200, h: 160 }
          const r = snap(q(m, [image]))
          const fx = m.x + r.dx
          const fy = m.y + r.dy
          return r.snap.lines.every((l) =>
            (l.axis === "x" ? [fx, fx + 100, fx + 200] : [fy, fy + 80, fy + 160]).some(
              (v) => Math.abs(v - l.at) < 1e-6,
            ),
          )
        },
      ),
    )
  })

  test("snapPoint snaps a pen anchor to edges", () => {
    const r = snapPoint({ x: 83, y: 300 }, [image], null, 1)
    expect(r.dx).toBe(-3)
    expect(r.spacing).toEqual([])
  })

  test("candidatesIn: siblings (visible, not excluded) + parent", () => {
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

  test("fmtUnits", () => {
    expect(fmtUnits(48)).toBe("48")
    expect(fmtUnits(12.345)).toBe("12.35")
    expect(fmtUnits(-0.001)).toBe("0")
  })
})

describe("measure", () => {
  const sel = { x: 200, y: 170, w: 160, h: 48 }
  test("board 10 #3a: only the gap to the hovered sibling, on the overlap's center", () => {
    const r = measure({ selection: sel, target: box("link", 420, 178, 100, 32), parent: null })
    expect(r.outline).toEqual({ id: "link", role: "target" })
    expect(r.measurements).toEqual([{ axis: "x", at: 194, from: 360, to: 420, label: "60" }])
  })

  test("board 10 #3b: four distances to the parent on the selection's center axes", () => {
    const r = measure({ selection: sel, target: null, parent: box("card", 80, 80, 480, 260) })
    expect(r.outline).toEqual({ id: "card", role: "parent" })
    expect(r.measurements.map((m) => [m.axis, m.at, m.from, m.to, m.label])).toEqual([
      ["x", 194, 80, 200, "120"],
      ["x", 194, 360, 560, "200"],
      ["y", 280, 80, 170, "90"],
      ["y", 280, 218, 340, "122"],
    ])
  })

  test("diagonal target: one line per axis at the selection's center", () => {
    const r = measure({ selection: sel, target: box("t", 400, 300, 10, 10), parent: null })
    expect(r.measurements.map((m) => [m.axis, m.at, m.from, m.to])).toEqual([
      ["x", 194, 360, 400],
      ["y", 280, 218, 300],
    ])
  })

  test("no target, no parent: nothing", () => {
    expect(measure({ selection: sel, target: null, parent: null })).toEqual({
      measurements: [],
      outline: null,
    })
  })

  test("property: every distance is positive and its label matches", () => {
    const arb = fc.record({
      x: fc.integer({ min: -300, max: 300 }),
      y: fc.integer({ min: -300, max: 300 }),
      w: fc.integer({ min: 1, max: 200 }),
      h: fc.integer({ min: 1, max: 200 }),
    })
    fc.assert(
      fc.property(arb, arb, fc.boolean(), (s, t, asParent) => {
        const r = measure({
          selection: s,
          target: asParent ? null : { id: "t", rect: t },
          parent: asParent ? { id: "p", rect: t } : null,
        })
        return r.measurements.every((m) => m.to > m.from && m.label === fmtUnits(m.to - m.from))
      }),
    )
  })
})

describe("path geometry", () => {
  test("parses every command kind into contours", () => {
    const c = parsePath(
      "M10 10 L20 10 H30 V20 C30 30 20 30 20 20 S10 10 10 20 Q5 25 0 20 T-10 20 Z",
    )
    expect(c.length).toBe(1)
    expect(c[0]?.closed).toBe(true)
    expect(c[0]?.anchors.length).toBe(8)
    expect(c[0]?.anchors[3]).toEqual({ x: 30, y: 20, out: { x: 30, y: 30 } })
  })

  test("relative commands, implicit line-tos and multiple subpaths", () => {
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
  })

  test("arcs (with packed flags) become cubics through the end point", () => {
    const c = parsePath("M0 0a10 10 0 0110 10")
    const last = c[0]?.anchors.at(-1)
    expect(last?.x).toBeCloseTo(10, 9)
    expect(last?.y).toBeCloseTo(10, 9)
    const b = contoursBounds(c) as Rect
    expect(b.w).toBeCloseTo(10, 3)
    expect(b.h).toBeCloseTo(10, 3)
  })

  test("closing on the first anchor merges the duplicate vertex", () => {
    const c = parsePath("M0 0C10 0 10 10 0 10C-10 10 -10 0 0 0Z")
    expect(c[0]?.anchors.length).toBe(2)
    expect(c[0]?.anchors[0]?.in).toEqual({ x: -10, y: 0 })
  })

  test("round trip: contoursToD → parsePath is the identity on contours", () => {
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

  test("toNode: bounds in the parent's space, d relative to the box, viewBox = size", () => {
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
    // Curve peak: y = 220 - 0.75*… → quadratic-like extremum at t where dy/dt = 0.
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
  })

  test("fromNode scales the viewBox to the node size", () => {
    const c = pathGeometry.fromNode(
      { d: "M0 0L10 10", viewBox: [0, 0, 10, 10], w: 100, h: 50 },
      [1, 0, 0, 1, 5, 5],
    )
    expect(c[0]?.anchors.map((a) => [a.x, a.y])).toEqual([
      [5, 5],
      [105, 55],
    ])
  })

  test("constrain45 snaps to 0/45/90° rays", () => {
    expect(constrain45({ x: 0, y: 0 }, { x: 10, y: 1 })).toEqual({ x: 10, y: 0 })
    expect(constrain45({ x: 0, y: 0 }, { x: 1, y: -10 })).toEqual({ x: 0, y: -10 })
    const d = constrain45({ x: 0, y: 0 }, { x: 10, y: 9 })
    expect(d.x).toBeCloseTo(d.y, 9)
    fc.assert(
      fc.property(
        fc.integer({ min: -500, max: 500 }),
        fc.integer({ min: -500, max: 500 }),
        (x, y) => {
          const p = constrain45({ x: 0, y: 0 }, { x, y })
          const ang = Math.atan2(p.y, p.x) / (Math.PI / 4)
          return (p.x === 0 && p.y === 0) || Math.abs(ang - Math.round(ang)) < 1e-9
        },
      ),
    )
  })

  test("splitSegment keeps the curve shape", () => {
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

  test("nearestOnCubic finds the closest point", () => {
    const s = segmentOf(
      {
        anchors: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        closed: false,
      },
      0,
    )
    const r = nearestOnCubic(s, { x: 40, y: 7 })
    expect(r.point.x).toBeCloseTo(40, 3)
    expect(r.dist).toBeCloseTo(7, 4)
  })

  test("setHandle mirrors the opposite handle unless symmetry is broken", () => {
    const c: PathContour[] = [
      {
        anchors: [
          { x: 0, y: 0 },
          { x: 50, y: 50 },
        ],
        closed: false,
      },
    ]
    const m = setHandle(c, { contour: 0, index: 1 }, "out", { x: 60, y: 50 })
    expect(m[0]?.anchors[1]?.in).toEqual({ x: 40, y: 50 })
    const b = setHandle(m, { contour: 0, index: 1 }, "out", { x: 50, y: 70 }, true)
    expect(b[0]?.anchors[1]?.in).toEqual({ x: 40, y: 50 })
    expect(b[0]?.anchors[1]?.out).toEqual({ x: 50, y: 70 })
  })

  test("removeAnchors drops degenerate contours; moveAnchors moves handles too", () => {
    const c: PathContour[] = [
      {
        anchors: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
        ],
        closed: true,
      },
    ]
    const r = removeAnchors(c, [{ contour: 0, index: 2 }])
    expect(r[0]?.anchors.length).toBe(2)
    expect(r[0]?.closed).toBe(false)
    expect(removeAnchors(r, [{ contour: 0, index: 0 }])).toEqual([])
    const m = moveAnchors(
      [
        {
          anchors: [
            { x: 0, y: 0, out: { x: 5, y: 0 } },
            { x: 9, y: 9 },
          ],
          closed: false,
        },
      ],
      [{ contour: 0, index: 0 }],
      { x: 1, y: 2 },
    )
    expect(m[0]?.anchors[0]).toEqual({ x: 1, y: 2, out: { x: 6, y: 2 } })
  })
})
