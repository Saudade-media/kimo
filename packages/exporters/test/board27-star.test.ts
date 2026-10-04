/** Board 27 §5 (ICb89): stars export as a path (polygon + `star.ratio`, spec §5.5). */
import { describe, expect, test } from "bun:test"
import { polygonPath } from "../src/emit/geometry"

describe("star geometry", () => {
  test("2n vertices, first up, inner ones midway on the ratio ellipse", () => {
    const d = polygonPath(130, 130, 5, 0, 0.38)
    const pts = d
      .replace(/^M|Z$/g, "")
      .split("L")
      .map((p) => p.split(" ").map(Number) as [number, number])
    expect(pts.length).toBe(10)
    expect(pts[0]).toEqual([65, 0])
    const inner = pts[1] as [number, number]
    expect(Math.hypot(inner[0] - 65, inner[1] - 65)).toBeCloseTo(65 * 0.38, 1)
    expect(Math.atan2(inner[1] - 65, inner[0] - 65)).toBeCloseTo(-Math.PI / 2 + Math.PI / 5, 2)
  })

  test("radius rounds every vertex (outer and inner)", () => {
    expect((polygonPath(130, 130, 5, 4, 0.38).match(/A/g) ?? []).length).toBe(10)
    expect((polygonPath(130, 130, 6, 4).match(/A/g) ?? []).length).toBe(6)
  })
})
