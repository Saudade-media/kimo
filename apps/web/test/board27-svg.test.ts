/**
 * Board 27 §6 (e) r6nLx "SVG import · Outline strokes enabled": the stroked-path count from the
 * parse, the popover toggle state + sub line, and the CanvasKit outliner (caps, joins, miter
 * limit, dashes) producing filled paths sized to their own bounds.
 */
import { beforeAll, describe, expect, test } from "bun:test"
import { createDocStore, createEmptyDocument, generateId } from "@kimo/editor-state"
import { type CanvasKit, loadCanvasKit } from "@kimo/renderer"
import { createElement as h } from "react"
import { renderToString } from "react-dom/server"
import {
  convertSvg,
  createStrokeOutliner,
  DEFAULT_SVG_OPTIONS,
  dashIntervals,
  outlineStrokesSub,
  parsePath,
  prepareSvg,
  type StrokeOutliner,
  SvgImportPopover,
  sanitizeSvg,
} from "../src/svg-import"
import { segmentBounds } from "../src/svg-import/geometry"

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

describe("stroked path count", () => {
  test("counts visible strokes only (none, 0 width, 0 opacity, inherited)", async () => {
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
    expect(p.vectorDescription).toBe(
      "Editable paths in a frame. 6 paths · 1 group · 2 stroked paths.",
    )
  })

  test("sub line copy (G3tQz) and the disabled copy", () => {
    expect(outlineStrokesSub(6)).toBe(
      "6 stroked paths become filled shapes, so they scale without changing weight. Dashes are kept as segments.",
    )
    expect(outlineStrokesSub(1)).toBe(
      "1 stroked path becomes a filled shape, so it scales without changing weight. Dashes are kept as segments.",
    )
    expect(outlineStrokesSub(0)).toBe("No strokes in this file")
  })

  test("popover: enabled with ≥ 1 stroked path, disabled with 0", () => {
    const render = (strokedPaths: number, on: boolean) =>
      renderToString(
        h(SvgImportPopover, {
          fileName: "logo-mark.svg",
          vectorDescription: "Editable paths in a frame. 14 paths · 3 groups · 6 stroked paths.",
          imageDescription: "",
          strokedPaths,
          initial: { mode: "vector", options: { ...DEFAULT_SVG_OPTIONS, outlineStrokes: on } },
          inline: true,
          onImport: () => {},
          onCancel: () => {},
        }),
      )
    const on = render(6, true)
    expect(on).toContain("svg-import__option-group")
    expect(on).toContain("6 stroked paths become filled shapes")
    const sw = /<button[^>]*role="switch"[^>]*>/g
    const switches = on.match(sw) ?? []
    expect(switches.length).toBe(3)
    expect(switches[2]).toContain('aria-checked="true"')
    expect(switches[2]).not.toContain("disabled")
    const off = render(0, true)
    expect(off).toContain("No strokes in this file")
    const offSwitches = off.match(sw) ?? []
    expect(offSwitches[2]).toContain('aria-checked="false"')
    expect(offSwitches[2]).toContain("disabled")
  })
})

describe("outliner (CanvasKit Path.stroke)", () => {
  const base = { width: 10, cap: "butt", join: "miter", miterLimit: 4 }

  test("butt / round / square caps extend the ends by 0 / w/2 / w/2", () => {
    const d = "M0 0L100 0"
    const butt = box(outline(d, base))
    expect(butt.x).toBeCloseTo(0, 1)
    expect(butt.w).toBeCloseTo(100, 1)
    expect(butt.y).toBeCloseTo(-5, 1)
    expect(butt.h).toBeCloseTo(10, 1)
    const square = box(outline(d, { ...base, cap: "square" }))
    expect(square.x).toBeCloseTo(-5, 1)
    expect(square.w).toBeCloseTo(110, 1)
    const round = box(outline(d, { ...base, cap: "round" }))
    expect(round.x).toBeLessThan(-4)
    expect(round.w).toBeGreaterThan(108)
  })

  test("joins: miter reaches the corner tip, bevel / round do not, miter limit bevels", () => {
    // Right angle at (100, 0): the outer miter tip sits at (105, -5).
    const d = "M0 0L100 0L100 100"
    const miter = box(outline(d, base))
    expect(miter.x + miter.w).toBeCloseTo(105, 1)
    expect(miter.y).toBeCloseTo(-5, 1)
    const bevel = box(outline(d, { ...base, join: "bevel" }))
    expect(bevel.x + bevel.w).toBeCloseTo(105, 1) // vertical leg's outer edge
    const bevelPts = parsePath(outline(d, { ...base, join: "bevel" }) ?? "")
    expect(
      bevelPts.some((s) => s.c !== "Z" && Math.abs(s.x - 105) < 0.01 && Math.abs(s.y + 5) < 0.01),
    ).toBe(false)
    const miterPts = parsePath(outline(d, base) ?? "")
    expect(
      miterPts.some((s) => s.c !== "Z" && Math.abs(s.x - 105) < 0.01 && Math.abs(s.y + 5) < 0.01),
    ).toBe(true)
    // A sharp angle with miterLimit 1 → beveled (no long spike).
    const sharp = "M0 0L100 10L0 20"
    const spike = box(outline(sharp, { ...base, miterLimit: 100 }))
    const clipped = box(outline(sharp, { ...base, miterLimit: 1 }))
    expect(spike.x + spike.w).toBeGreaterThan(clipped.x + clipped.w + 20)
  })

  test("dashes become separate segments (odd lists repeat, offset shifts)", () => {
    expect(dashIntervals([5])).toEqual([5, 5])
    expect(dashIntervals([4, 2, 1])).toEqual([4, 2, 1, 4, 2, 1])
    expect(dashIntervals([0, 0])).toBeNull()
    expect(dashIntervals([])).toBeNull()
    const d = "M0 0L100 0"
    const solid = outline(d, base)
    expect(contours(solid)).toBe(1)
    const dashed = outline(d, { ...base, dash: [10, 10] })
    expect(contours(dashed)).toBe(5) // 0–10, 20–30, … 80–90
    expect(box(dashed).w).toBeCloseTo(90, 1)
    const shifted = outline(d, { ...base, dash: [10, 10], dashOffset: 5 })
    expect(contours(shifted)).toBe(5 + 1) // 0–5, 15–25, …, 95–100
    expect(box(shifted).w).toBeCloseTo(100, 1)
  })

  test("zero width / empty → null", () => {
    expect(outline("M0 0L10 0", { ...base, width: 0 })).toBeNull()
    expect(outline("", base)).toBeNull()
  })
})

describe("convertSvg with Outline strokes on", () => {
  test("strokes become filled outline paths sized to their bounds; fill stays its own path", () => {
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
    expect(nodes.find((n) => n.name === "Rule")).toBeUndefined() // no fill → only the outline
    expect(r.stats.strokesKept).toBe(0)
  })

  test("no outliner: strokes are kept as strokes", () => {
    const r = convertSvg(
      sanitizeSvg(svg(`<path d="M0 0L10 0" stroke="#000"/>`)),
      { ...DEFAULT_SVG_OPTIONS, outlineStrokes: true },
      { name: "x", newId: generateId },
    )
    expect(r.stats.strokesKept).toBe(1)
  })
})
