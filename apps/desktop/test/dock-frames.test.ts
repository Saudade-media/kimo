import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { KIMO_LOGO_PATH } from "../../../packages/ui/src/kimo-logo/paths"
import {
  beatAngle,
  buildFrames,
  checkCommitted,
  cubicBezier,
  deviation,
  distanceToOutline,
  EASE_IN,
  EASE_OUT,
  encodePng,
  MOTION,
  markSubpaths,
  motionParams,
  pngPayload,
  REDUCED,
  reducedParams,
  renderFrame,
  rotate,
  unfilterScanlines,
} from "../scripts/dock-frames"

const [outer, inner] = markSubpaths() as [[number, number][], [number, number][]]

describe("dock frames · geometry (board 32)", () => {
  test("renders the exact mark: KIMO_LOGO_PATH, the same path as the app icon source.svg", () => {
    expect(markSubpaths(KIMO_LOGO_PATH)).toEqual([outer, inner])
    expect(outer.length).toBe(288)
    expect(inner.length).toBe(96)
    const svg = readFileSync(join(import.meta.dir, "../src-tauri/icons/source.svg"), "utf8")
    expect(svg).toContain(`d="${KIMO_LOGO_PATH}"`)
    expect(svg).toContain('rx="185.4" fill="#0A0A0A"')
  })

  test("outer and opening are each 6-fold symmetric: 60° is the smallest seamless step", () => {
    for (const shape of [outer, inner]) {
      expect(deviation(rotate(shape, 60), shape)).toBeLessThan(0.02)
      expect(deviation(rotate(shape, 120), shape)).toBeLessThan(0.02)
      // No smaller step that divides 60° maps the shape onto itself.
      for (const step of [30, 20, 15, 12, 10, 6, 5])
        expect(deviation(rotate(shape, step), shape)).toBeGreaterThan(1)
    }
  })

  test("the opening never touches the outer shape while they counter-rotate", () => {
    let min = Number.POSITIVE_INFINITY
    for (let i = 0; i <= MOTION.frames; i++) {
      const p = motionParams(i)
      const o = rotate(outer, p.outer)
      for (const pt of rotate(inner, -p.inner)) min = Math.min(min, distanceToOutline(pt, o))
    }
    expect(min).toBeGreaterThan(10)
    const r = (s: [number, number][]) => s.map(([x, y]) => Math.hypot(x - 50, y - 50))
    expect(Math.max(...r(inner))).toBeLessThan(Math.min(...r(outer)))
  })
})

describe("dock frames · timing", () => {
  test("eases like the launch loader and turns one 60° step per loop", () => {
    expect(cubicBezier(...EASE_IN, 0)).toBe(0)
    expect(cubicBezier(...EASE_OUT, 1)).toBe(1)
    expect(beatAngle(0)).toBe(0)
    expect(beatAngle(MOTION.turnInMs)).toBeCloseTo(30, 6)
    expect(beatAngle(MOTION.turnOutEndMs)).toBeCloseTo(60, 6)
    expect(beatAngle(MOTION.loopMs)).toBe(60)
    let prev = -1
    for (let i = 0; i <= MOTION.frames; i++) {
      const a = motionParams(i).outer
      expect(a).toBeGreaterThanOrEqual(prev)
      prev = a
    }
  })

  test("bloom peaks at the beat midpoint and is off at rest", () => {
    expect(motionParams(0).bloom).toBe(0)
    expect(motionParams(21).bloom).toBeCloseTo(MOTION.bloomPeak, 6) // t = 700 ms
    for (let i = 42; i <= MOTION.frames; i++) expect(motionParams(i).bloom).toBe(0)
    expect(reducedParams(15).bloom).toBeCloseTo(REDUCED.bloomPeak, 6)
    for (let i = 0; i < REDUCED.frames; i++) expect(reducedParams(i).outer).toBe(0)
  })

  test("frame N equals frame 0 (seamless loop) and frame 0 is the static icon", () => {
    const f0 = renderFrame(motionParams(0), 64)
    expect(renderFrame(motionParams(MOTION.frames), 64)).toEqual(f0)
    expect(renderFrame(reducedParams(REDUCED.frames), 64)).toEqual(f0)
    expect(renderFrame({ outer: 0, inner: 0, bloom: 0 }, 64)).toEqual(f0)
    expect(renderFrame(motionParams(21), 64)).not.toEqual(f0)
  })
})

describe("dock frames · output", () => {
  test("PNG payload round-trips to the same pixels", () => {
    const rgba = renderFrame(motionParams(10), 32)
    const { data } = pngPayload(encodePng(rgba, 32, 32))
    expect(unfilterScanlines(data, 32, 32)).toEqual(rgba)
  })

  test("the committed frames and include_bytes! table are up to date", () => {
    const set = buildFrames()
    expect(set.motion.length).toBe(MOTION.frames)
    expect(set.reduced.length).toBe(REDUCED.frames)
    expect(set.motion[0]).toBe(0)
    expect(set.reduced[0]).toBe(0)
    expect(checkCommitted(set)).toEqual([])
  })
})
