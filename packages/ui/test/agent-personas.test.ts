import { describe, expect, test } from "bun:test"
import { assignPersonas, PERSONA_HOLD_MS, PersonaAllocator } from "../src/index"

describe("persona assignment", () => {
  test("lead teal, then Iris, Violet, Rose, Ember, Moss; the 7th wraps to Iris 2", () => {
    const slots = assignPersonas([
      { id: "lead", lead: true },
      ...Array.from({ length: 6 }, (_, i) => ({ id: `a${i}` })),
    ])
    expect(slots.map((s) => `${s.persona}${s.round > 1 ? s.round : ""}`)).toEqual([
      "teal",
      "iris",
      "violet",
      "rose",
      "ember",
      "moss",
      "iris2",
    ])
  })

  test("external CLIs keep teal unless split; a released hue comes back within 10 min", () => {
    let t = 0
    const a = new PersonaAllocator(() => t)
    expect(a.assign({ id: "cc", external: true }).persona).toBe("teal")
    expect(a.assign({ id: "cc", external: true }, { split: true }).persona).toBe("iris")
    expect(a.assign({ id: "x" }).persona).toBe("violet")
    a.release("cc")
    t = PERSONA_HOLD_MS - 1
    expect(a.assign({ id: "cc", external: true }, { split: true }).persona).toBe("iris")
    a.release("x")
    t += PERSONA_HOLD_MS + 1
    expect(a.assign({ id: "y" }).persona).toBe("violet")
    expect(a.assign({ id: "x" }).persona).toBe("rose")
  })
})
