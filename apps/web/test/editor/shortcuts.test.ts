/** The SHORTCUTS table: single source for the handlers and the sheet. */
import { describe, expect, test } from "bun:test"
import {
  type Combo,
  matches,
  SHORTCUT_LIST,
  type ShortcutScope,
} from "../../src/shortcuts/shortcuts"

const ev = (o: Partial<KeyboardEvent>) => ({
  key: "",
  code: "",
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...o,
})

/** The `e.key` a `code` produces on a US layout (keys and codes can name the same press). */
const keyOfCode = (code: string): string | null => {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase()
  if (/^Digit\d$/.test(code)) return code.slice(5)
  return ({ Quote: "'", Space: " ", Slash: "/" } as Record<string, string>)[code] ?? null
}
const pressKeys = (c: Combo) =>
  new Set([
    ...(c.keys ?? []),
    ...(c.codes ?? []).map(keyOfCode).filter((k): k is string => k !== null),
  ])
const compatible = (a?: boolean, b?: boolean) => a === undefined || b === undefined || a === b
const overlap = (a: Combo, b: Combo) =>
  !a.pointer &&
  !b.pointer &&
  [...pressKeys(a)].some((k) => pressKeys(b).has(k)) &&
  compatible(a.mod, b.mod) &&
  compatible(a.shift, b.shift) &&
  compatible(a.alt, b.alt)

/** Scopes live at the same time (both are window listeners in the editor). */
const live = (s: ShortcutScope) => (s === "canvas" ? "global" : s)

describe("SHORTCUTS table", () => {
  test("ids are unique and no two bindings in one scope can match the same key press", () => {
    const ids = SHORTCUT_LIST.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    const clashes: string[] = []
    for (const [i, a] of SHORTCUT_LIST.entries())
      for (const b of SHORTCUT_LIST.slice(i + 1)) {
        if (live(a.scope) !== live(b.scope)) continue
        for (const ca of a.combos)
          for (const cb of b.combos)
            if (overlap(ca, cb)) clashes.push(`${a.id} <-> ${b.id} (${ca.label})`)
      }
    expect(clashes).toEqual([])
  })

  test("matching distinguishes shift, option and command variants of the same key", () => {
    expect(matches("undo", ev({ metaKey: true, key: "z" }))).toBe(true)
    expect(matches("undo", ev({ metaKey: true, key: "Z", shiftKey: true }))).toBe(false)
    expect(matches("redo", ev({ metaKey: true, key: "Z", shiftKey: true }))).toBe(true)
    expect(matches("redo", ev({ ctrlKey: true, key: "y" }))).toBe(true)
    // Option changes e.key on macOS: those combos match by code.
    expect(
      matches("createComponent", ev({ metaKey: true, altKey: true, key: "˚", code: "KeyK" })),
    ).toBe(true)
    expect(matches("askKimo", ev({ metaKey: true, altKey: true, key: "k" }))).toBe(false)
    expect(matches("tool.pen", ev({ key: "p" }))).toBe(true)
    expect(matches("tool.pen", ev({ key: "P", shiftKey: true }))).toBe(false)
    expect(matches("tool.prompt", ev({ key: "P", shiftKey: true }))).toBe(true)
    expect(matches("delete", ev({ key: "Backspace" }))).toBe(true)
    expect(matches("delete", ev({ key: "Backspace", metaKey: true }))).toBe(false)
    expect(matches("finishText", ev({ ctrlKey: true, key: "Enter" }))).toBe(true)
    expect(matches("finishText", ev({ key: "Enter" }))).toBe(false)
    expect(() => matches("nope", ev({}))).toThrow()
  })

  test("the conflict key reads getters of a DOM-like event, not own props", async () => {
    const { isNextConflictKey } = await import("../../src/conflicts/shortcut")
    class Ev {
      get key() {
        return "'"
      }
      get code() {
        return "Quote"
      }
      get metaKey() {
        return true
      }
      get ctrlKey() {
        return false
      }
      get altKey() {
        return false
      }
      get shiftKey() {
        return false
      }
    }
    expect(isNextConflictKey(new Ev())).toBe(true)
  })
})
