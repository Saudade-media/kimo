/**
 * Board 20 Text section "Case": the control writes `style.case` (spec §8.2), already part of
 * format 0.1 — no new field. Valid values validate and round-trip; anything else is an error.
 */
import { describe, expect, test } from "bun:test"
import { parse, serialize, validate } from "../src"

const doc = (style: Record<string, unknown>) => ({
  $schema: "https://kimo.design/schema/kimo-0.1.json",
  format: "0.1.0",
  nodes: {
    Text000001: { type: "text", parent: null, order: "a0", content: "Plan less.", style },
  },
})

describe("style.case", () => {
  test("upper / lower / title validate and round-trip byte-stably", () => {
    for (const c of ["upper", "lower", "title"]) {
      const d = doc({ case: c, size: 28 })
      expect(validate(d).ok).toBe(true)
      const text = serialize(d as never)
      expect(serialize(parse(text))).toBe(text)
    }
  })
  test("unknown values are rejected", () => {
    expect(validate(doc({ case: "smallcaps" })).ok).toBe(false)
  })
})
