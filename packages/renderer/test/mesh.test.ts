import { describe, expect, test } from "bun:test"
import type { RGBA } from "../src/color"
import { meshColorAt, meshVertices, tessellateMesh } from "../src/mesh"

const RED: RGBA = [1, 0, 0, 1]
const BLUE: RGBA = [0, 0, 1, 1]

describe("mesh", () => {
  test("auto handles keep a regular grid straight and edges on the box", () => {
    const v = meshVertices(3, 3, [
      [0, 0],
      [0.5, 0],
      [1, 0],
      [0, 0.5],
      [0.5, 0.5],
      [1, 0.5],
      [0, 1],
      [0.5, 1],
      [1, 1],
    ])
    // Interior: Catmull-Rom / 3 toward the neighbours.
    expect(v[4]?.right[0]).toBeCloseTo(1 / 6)
    expect(v[4]?.right[1]).toBeCloseTo(0)
    expect(v[4]?.left[0]).toBeCloseTo(-1 / 6)
    // Top-left corner: one-sided handles along the edges.
    expect(v[0]?.right).toEqual([1 / 6, 0])
    expect(v[0]?.bottom).toEqual([0, 1 / 6])
    const t = tessellateMesh(3, 3, [], Array(9).fill(RED))
    for (let i = 0; i < t.positions.length; i++) {
      const p = t.positions[i] as number
      expect(p).toBeGreaterThanOrEqual(-1e-6)
      expect(p).toBeLessThanOrEqual(1 + 1e-6)
    }
  })

  test("explicit handles: a missing one mirrors its opposite", () => {
    const v = meshVertices(2, 1, [{ position: [0, 0.5], rightHandle: [0.2, 0.1] }, [1, 0.5]])
    expect(v[0]?.right).toEqual([0.2, 0.1])
    expect(v[0]?.left).toEqual([-0.2, -0.1])
    // Malformed points fall back to the regular grid.
    expect(meshVertices(2, 2, ["x", null])[1]?.p).toEqual([1, 0])
  })

  test("a displaced vertex moves the tessellated interior, not the edges", () => {
    const pts = [
      [0, 0],
      [0.5, 0],
      [1, 0],
      [0, 0.5],
      [0.4, 0.42],
      [1, 0.5],
      [0, 1],
      [0.5, 1],
      [1, 1],
    ]
    const t = tessellateMesh(3, 3, pts, Array(9).fill(RED), 4)
    // Patch 0 is 5×5 vertices; its last vertex is the shared interior one.
    expect(t.positions[24 * 2]).toBeCloseTo(0.4)
    expect(t.positions[24 * 2 + 1]).toBeCloseTo(0.42)
    // Its first row lies on the top edge.
    for (let i = 0; i < 5; i++) expect(t.positions[i * 2 + 1]).toBeCloseTo(0)
  })

  test("colors: corners exact, smooth (zero slope) at vertices, symmetric midway", () => {
    const cs = [RED, BLUE, BLUE, RED]
    expect(meshColorAt(2, 2, cs, 0, 0)).toEqual(RED)
    expect(meshColorAt(2, 2, cs, 1, 0)).toEqual(BLUE)
    const mid = meshColorAt(2, 2, cs, 0.5, 0)
    expect(mid[0]).toBeCloseTo(0.5)
    expect(mid[2]).toBeCloseTo(0.5)
    // Smoothstep: at 10% of the way the color has moved only ~2.8%.
    expect(meshColorAt(2, 2, cs, 0.1, 0)[2]).toBeCloseTo(0.028)
  })

  test("triangles index every patch vertex, within 16 bits for big grids", () => {
    const t = tessellateMesh(3, 2, [], Array(6).fill(RED), 6)
    expect(t.positions.length / 2).toBe(2 * 7 * 7)
    expect(t.indices.length).toBe(2 * 6 * 6 * 6)
    expect(Math.max(...t.indices)).toBe(2 * 49 - 1)
    const big = tessellateMesh(40, 40, [], Array(1600).fill(RED))
    expect(big.positions.length / 2).toBeLessThanOrEqual(65535)
    // A single row stretches over the box.
    const row = tessellateMesh(3, 1, [], [RED, BLUE, RED], 2)
    expect(row.positions.length).toBeGreaterThan(0)
  })
})
