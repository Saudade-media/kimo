import { describe, expect, test } from "bun:test"
import fc from "fast-check"
import {
  screenRectToWorld,
  screenToWorld,
  visibleWorldRect,
  worldRectToScreen,
  worldToScreen,
} from "../src"

const vp = fc.record({
  x: fc.double({ min: -1e5, max: 1e5, noNaN: true }),
  y: fc.double({ min: -1e5, max: 1e5, noNaN: true }),
  zoom: fc.double({ min: 0.01, max: 256, noNaN: true }),
})
const pt = fc.record({
  x: fc.double({ min: -1e5, max: 1e5, noNaN: true }),
  y: fc.double({ min: -1e5, max: 1e5, noNaN: true }),
})

describe("viewport math", () => {
  test("screen = (world - origin) * zoom", () => {
    expect(worldToScreen({ x: 100, y: 50, zoom: 2 }, { x: 110, y: 60 })).toEqual({ x: 20, y: 20 })
    expect(screenToWorld({ x: 100, y: 50, zoom: 2 }, { x: 20, y: 20 })).toEqual({ x: 110, y: 60 })
  })

  test("worldToScreen ∘ screenToWorld = id (property)", () => {
    fc.assert(
      fc.property(vp, pt, (v, p) => {
        const q = worldToScreen(v, screenToWorld(v, p))
        expect(q.x).toBeCloseTo(p.x, 4)
        expect(q.y).toBeCloseTo(p.y, 4)
      }),
    )
  })

  test("rect mapping agrees with point mapping (property)", () => {
    fc.assert(
      fc.property(vp, pt, fc.double({ min: 0, max: 1e4, noNaN: true }), (v, p, s) => {
        const r = worldRectToScreen(v, { x: p.x, y: p.y, w: s, h: s / 2 })
        const tl = worldToScreen(v, p)
        expect(r.x).toBeCloseTo(tl.x, 4)
        expect(r.w).toBeCloseTo(s * v.zoom, 4)
        const back = screenRectToWorld(v, r)
        expect(back.x).toBeCloseTo(p.x, 3)
        expect(back.h).toBeCloseTo(s / 2, 3)
      }),
    )
  })

  test("visibleWorldRect", () => {
    expect(visibleWorldRect({ x: 10, y: 20, zoom: 4 }, 800, 400)).toEqual({
      x: 10,
      y: 20,
      w: 200,
      h: 100,
    })
  })
})
