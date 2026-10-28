/** SVG import's "Outline strokes": the stroked-path count and the CanvasKit stroke outliner. */
import { beforeAll, describe, expect, test } from "bun:test"
import { createDocStore, createEmptyDocument, generateId } from "@kimo/editor-state"
import { type CanvasKit, loadCanvasKit } from "@kimo/renderer"
import { prepareSvg } from "../../src/svg-import"
import { convertSvg, DEFAULT_SVG_OPTIONS, type StrokeOutliner } from "../../src/svg-import/convert"
import { parsePath, segmentBounds } from "../../src/svg-import/geometry"
import { createStrokeOutliner, dashIntervals } from "../../src/svg-import/outline"
import { sanitizeSvg } from "../../src/svg-import/sanitize"

const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">${body}</svg>`

let ck: CanvasKit
let outline: StrokeOutliner
beforeAll(async () => {
  ck = await loadCanvasKit()
  outline = createStrokeOutliner(ck)
})

const box = (d: string | null) => segmentBounds(parsePath(d ?? "")) ?? { x: 0, y: 0, w: 0, h: 0 }
/** Number of closed contours (M commands) in path data. */
const contours = (d: string | null) => (d ?? "").match(/M/g)?.length ?? 0

describe("stroke outlining", () => {
  test("the stroked path count covers visible strokes only (none, 0 width, 0 opacity, inherited)", async () => {
    const p = await prepareSvg(
      svg(
        `<g stroke="#000" stroke-width="2"><path d="M0 0L10 10"/><rect width="5" height="5" stroke="none"/></g>` +
          `<path d="M0 50L50 50" stroke="red" stroke-width="0"/>` +
          `<path d="M0 60L50 60" stroke="red" stroke-opacity="0"/>` +
          `<circle cx="50" cy="50" r="10" fill="#123"/>` +
          `<line x1="0" y1="90" x2="90" y2="90" style="stroke: blue"/>`,
      ),
      "logo-mark.svg",
    )
    expect(p.stats.stroked).toBe(2)
  })

  const base = { width: 10, cap: "butt", join: "miter", miterLimit: 4 }

  test("caps extend the ends by 0 / w/2 / w/2; miter reaches the corner tip, bevel does not, the miter limit bevels", () => {
    const d = "M0 0L100 0"
    const butt = box(outline(d, base))
    expect(butt.x).toBeCloseTo(0, 1)
    expect(butt.w).toBeCloseTo(100, 1)
    expect(butt.h).toBeCloseTo(10, 1)
    const square = box(outline(d, { ...base, cap: "square" }))
    expect(square.x).toBeCloseTo(-5, 1)
    expect(square.w).toBeCloseTo(110, 1)
    const round = box(outline(d, { ...base, cap: "round" }))
    expect(round.x).toBeLessThan(-4)
    // Right angle at (100, 0): the outer miter tip sits at (105, -5).
    const corner = "M0 0L100 0L100 100"
    const tip = (path: string | null) =>
      parsePath(path ?? "").some(
        (s) => s.c !== "Z" && Math.abs(s.x - 105) < 0.01 && Math.abs(s.y + 5) < 0.01,
      )
    expect(tip(outline(corner, base))).toBe(true)
    expect(tip(outline(corner, { ...base, join: "bevel" }))).toBe(false)
    // A sharp angle with miterLimit 1 is beveled (no long spike).
    const sharp = "M0 0L100 10L0 20"
    const spike = box(outline(sharp, { ...base, miterLimit: 100 }))
    const clipped = box(outline(sharp, { ...base, miterLimit: 1 }))
    expect(spike.x + spike.w).toBeGreaterThan(clipped.x + clipped.w + 20)
    expect(outline("M0 0L10 0", { ...base, width: 0 })).toBeNull()
  })

  test("dashes become separate segments (odd lists repeat, offset shifts)", () => {
    expect(dashIntervals([5])).toEqual([5, 5])
    expect(dashIntervals([0, 0])).toBeNull()
    const d = "M0 0L100 0"
    expect(contours(outline(d, base))).toBe(1)
    const dashed = outline(d, { ...base, dash: [10, 10] })
    expect(contours(dashed)).toBe(5) // 0-10, 20-30, ... 80-90
    expect(box(dashed).w).toBeCloseTo(90, 1)
    const shifted = outline(d, { ...base, dash: [10, 10], dashOffset: 5 })
    expect(contours(shifted)).toBe(5 + 1) // 0-5, 15-25, ..., 95-100
    expect(box(shifted).w).toBeCloseTo(100, 1)
  })

  test("convertSvg with outlining on: strokes become filled outline paths sized to their bounds; the fill stays its own path", () => {
    const s = sanitizeSvg(
      svg(
        `<rect id="Box" x="10" y="10" width="40" height="40" fill="#123456" stroke="#E8590C" stroke-width="4" fill-rule="evenodd"/>` +
          `<path id="Rule" d="M0 90L100 90" fill="none" stroke="#0A0A0A" stroke-width="2" stroke-dasharray="10 10"/>`,
      ),
    )
    const r = convertSvg(
      s,
      { ...DEFAULT_SVG_OPTIONS, outlineStrokes: true },
      { name: "x", newId: generateId, outline },
    )
    const store = createDocStore(createEmptyDocument("x"))
    expect(store.apply(r.ops, { origin: "user" }).ok).toBe(true)
    const nodes = Object.values(store.toDocument().nodes) as Record<string, unknown>[]
    const fill = nodes.find((n) => n.name === "Box") as Record<string, unknown>
    expect(fill).toMatchObject({ type: "path", x: 10, y: 10, w: 40, h: 40, fill: ["#123456"] })
    expect(fill.stroke).toBeUndefined()
    const ring = nodes.find((n) => n.name === "Box stroke") as Record<string, unknown>
    expect(ring).toMatchObject({ type: "path", x: 8, y: 8, w: 44, h: 44, fill: ["#E8590C"] })
    expect(ring.viewBox).toEqual([0, 0, 44, 44])
    expect(ring.stroke).toBeUndefined()
    expect(ring.fillRule).toBeUndefined() // the outline is nonzero, never evenodd
    const rule = nodes.find((n) => n.name === "Rule stroke") as {
      d: string
      x: number
      y: number
      w: number
      h: number
    }
    expect([rule.x, rule.y, rule.w, rule.h]).toEqual([0, 89, 90, 2])
    expect(contours(rule.d)).toBe(5)
    expect(nodes.find((n) => n.name === "Rule")).toBeUndefined() // no fill: only the outline
    expect(r.stats.strokesKept).toBe(0)
  })
})
