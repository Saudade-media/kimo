/**
 * Board 20 Text section "Case" (E5X5j7): `style.case` is render-time only (spec §8.2), so the
 * typed content stays as is and the renderer transforms it when it builds (and measures) the
 * paragraph.
 */
import { describe, expect, test } from "bun:test"
import { applyCase } from "../src/text"

describe("applyCase (style.case)", () => {
  test("upper / lower / title / as typed", () => {
    expect(applyCase("Plan less. Ship more together.", "upper")).toBe(
      "PLAN LESS. SHIP MORE TOGETHER.",
    )
    expect(applyCase("Plan Less", "lower")).toBe("plan less")
    expect(applyCase("plan less. ship more-together (now)", "title")).toBe(
      "Plan Less. Ship More-Together (Now)",
    )
    expect(applyCase("Plan less", null)).toBe("Plan less")
  })
  test("title case keeps letters already capitalised and works beyond ASCII", () => {
    expect(applyCase("éclair à la crème", "title")).toBe("Éclair À La Crème")
    expect(applyCase("iPhone app", "title")).toBe("IPhone App")
  })
})
