/** Shared-canvas image placeholders (apps/web/src/multiplayer-canvas/AssetLayer.tsx). */
import { describe, expect, test } from "bun:test"
import { chipScale } from "../src/multiplayer-canvas/AssetLayer"

describe("asset placeholder chip", () => {
  test("full size on boxes that hold it, smaller on small boxes, hidden on tiny ones", () => {
    expect(chipScale(400, 300)).toBe(1)
    expect(chipScale(80, 300)).toBe(0.5)
    expect(chipScale(400, 32)).toBe(0.5)
    expect(chipScale(40, 40)).toBe(0)
  })
})
