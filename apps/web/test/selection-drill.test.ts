import { describe, expect, test } from "bun:test"
import type { DocReader } from "../src/canvas/commands"
import { drillStep, enterTarget, pickTarget } from "../src/canvas/selection"

/** page > hero > shot > card > row > label (+ an instance-style composite child id). */
const chain = ["page", "hero", "shot", "card", "row", "label", "label/inner"]
const doc = {
  getNode: (id: string) => {
    const i = chain.indexOf(id)
    return i < 0 ? undefined : { id, type: "frame", parent: i === 0 ? null : chain[i - 1] }
  },
} as unknown as DocReader

describe("drill-down selection chain", () => {
  test("a click selects the top-level layer, ⌘-click the deepest", () => {
    expect(pickTarget(doc, "label/inner", [], false)).toBe("hero")
    expect(pickTarget(doc, "label/inner", [], true)).toBe("label/inner")
  })
  test("each double-click goes exactly one level deeper, down to the leaf and no further", () => {
    let cur: string | undefined = pickTarget(doc, "label/inner", [], false)
    const seen = [cur]
    for (let i = 0; i < 10; i++) {
      // The press of every double-click keeps the current depth.
      expect(pickTarget(doc, "label/inner", [cur as string], false)).toBe(cur as string)
      const next = enterTarget(doc, "label/inner", cur)
      if (next === cur) break
      seen.push(next)
      cur = next
    }
    expect(seen).toEqual(chain.slice(1))
  })
})

describe("multi-click drilling", () => {
  test("every click after the first goes exactly one level deeper on the fixed path", () => {
    const path = [...chain]
    let level = path.indexOf(pickTarget(doc, "label/inner", [], false))
    const seen = [path[level]]
    for (let click = 2; click <= 9; click++) {
      const s = drillStep(path, level)
      level = s.level
      seen.push(s.id)
      // Stays on the leaf and reports it (a text leaf enters edit then).
      if (click > path.length - 1) expect(s.atLeaf).toBe(true)
    }
    expect(seen.slice(0, 6)).toEqual(chain.slice(1))
    expect(seen[seen.length - 1]).toBe("label/inner")
  })
})
