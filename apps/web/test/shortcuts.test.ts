/** Board 25 §7 (c): the SHORTCUTS table — single source for the handlers and the sheet. */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { CANVAS_TOOLS } from "../src/canvas/contract"
import {
  type Combo,
  currentPlatform,
  formatCombo,
  matches,
  SHORTCUT_GROUPS,
  SHORTCUT_LIST,
  type ShortcutScope,
  sheetGroups,
  shortcut,
} from "../src/shortcuts/shortcuts"

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

/** How Editor.tsx names a toolbar tool's row. */
const TOOL_MATCH = ["`tool.", "$", "{t.id}`"].join("")

/** Scopes live at the same time (both are window listeners in the editor). */
const live = (s: ShortcutScope) => (s === "canvas" ? "global" : s)

describe("SHORTCUTS table", () => {
  test("ids are unique", () => {
    const ids = SHORTCUT_LIST.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test("no two bindings in one scope can match the same key press", () => {
    const clashes: string[] = []
    for (const [i, a] of SHORTCUT_LIST.entries())
      for (const b of SHORTCUT_LIST.slice(i + 1)) {
        if (live(a.scope) !== live(b.scope)) continue
        for (const ca of a.combos)
          for (const cb of b.combos)
            if (overlap(ca, cb)) clashes.push(`${a.id} ↔ ${b.id} (${ca.label})`)
      }
    expect(clashes).toEqual([])
  })

  test("every listed row is matched by a handler (its id appears in handler code)", () => {
    const src = [
      "src/editor/Editor.tsx",
      "src/canvas/controller.ts",
      "src/canvas/CanvasHost.tsx",
      "src/editor/LeftPanel.tsx",
      "src/editor/sections/TextSection.tsx",
      "src/conflicts/shortcut.ts",
      "src/settings/SettingsDialog.tsx",
      "src/shortcuts/ShortcutsSheetHost.tsx",
      "src/editor/clipboard/useEditorCommands.ts",
    ]
      .map((f) => readFileSync(join(import.meta.dir, "..", f), "utf8"))
      .join("\n")
    const missing = SHORTCUT_LIST.filter((s) => {
      // Single-key tools are matched as `tool.${id}` over CANVAS_TOOLS in Editor.tsx.
      if (s.id.startsWith("tool.") && s.id !== "tool.image" && s.id !== "tool.hand")
        return !CANVAS_TOOLS.some((t) => `tool.${t.id}` === s.id) || !src.includes(TOOL_MATCH)
      return !src.includes(`"${s.id}"`)
    }).map((s) => s.id)
    expect(missing).toEqual([])
  })

  test("toolbar tooltips (CANVAS_TOOLS.shortcut) agree with the table", () => {
    for (const t of CANVAS_TOOLS) {
      // Polygon has no key (the design's ⇧P stays Prompt's).
      if (!t.shortcut) continue
      const id = t.id === "component" ? "createComponent" : `tool.${t.id}`
      const c = shortcut(id).combos[0] as Combo
      expect(`${t.id} ${formatCombo(c, "mac")}`).toBe(`${t.id} ${t.shortcut}`)
    }
  })

  test("matching keeps the old handler semantics", () => {
    expect(matches("undo", ev({ metaKey: true, key: "z" }))).toBe(true)
    expect(matches("undo", ev({ metaKey: true, key: "Z", shiftKey: true }))).toBe(false)
    expect(matches("redo", ev({ metaKey: true, key: "Z", shiftKey: true }))).toBe(true)
    expect(matches("redo", ev({ ctrlKey: true, key: "y" }))).toBe(true)
    expect(matches("save", ev({ ctrlKey: true, key: "s" }))).toBe(true)
    expect(matches("saveAs", ev({ metaKey: true, shiftKey: true, key: "S" }))).toBe(true)
    // ⌥ changes e.key on macOS: the M3 combos match by code.
    expect(
      matches("createComponent", ev({ metaKey: true, altKey: true, key: "˚", code: "KeyK" })),
    ).toBe(true)
    expect(matches("askKimo", ev({ metaKey: true, key: "k" }))).toBe(true)
    expect(matches("askKimo", ev({ metaKey: true, altKey: true, key: "k" }))).toBe(false)
    expect(matches("tool.image", ev({ metaKey: true, shiftKey: true, key: "K" }))).toBe(true)
    expect(matches("tool.pen", ev({ key: "p" }))).toBe(true)
    expect(matches("tool.pen", ev({ key: "P", shiftKey: true }))).toBe(false)
    expect(matches("tool.prompt", ev({ key: "P", shiftKey: true }))).toBe(true)
    expect(matches("tool.arrow", ev({ key: "L", shiftKey: true }))).toBe(true)
    expect(matches("tool.line", ev({ key: "l" }))).toBe(true)
    expect(matches("tool.star", ev({ key: "S", shiftKey: true }))).toBe(true)
    expect(matches("tool.star", ev({ key: "S", shiftKey: true, metaKey: true }))).toBe(false)
    expect(matches("zoomIn", ev({ key: "+", shiftKey: true }))).toBe(true)
    expect(matches("zoomIn", ev({ key: "=", altKey: true }))).toBe(false)
    expect(matches("zoomOut", ev({ metaKey: true, key: "-" }))).toBe(true)
    expect(matches("zoomOut", ev({ metaKey: true, key: "_" }))).toBe(false)
    expect(matches("zoomToFit", ev({ key: "!", code: "Digit1", shiftKey: true }))).toBe(true)
    expect(matches("nudge", ev({ key: "ArrowLeft", shiftKey: true }))).toBe(true)
    expect(matches("delete", ev({ key: "Backspace" }))).toBe(true)
    expect(matches("delete", ev({ key: "Backspace", metaKey: true }))).toBe(false)
    expect(matches("nextConflict", ev({ metaKey: true, key: "'", code: "Quote" }))).toBe(true)
    expect(
      matches("previousConflict", ev({ metaKey: true, shiftKey: true, key: '"', code: "Quote" })),
    ).toBe(true)
    expect(matches("settings", ev({ metaKey: true, key: "," }))).toBe(true)
    expect(matches("finishText", ev({ key: "Escape" }))).toBe(true)
    expect(matches("finishText", ev({ ctrlKey: true, key: "Enter" }))).toBe(true)
    expect(matches("finishText", ev({ key: "Enter" }))).toBe(false)
    expect(matches("shortcuts", ev({ metaKey: true, key: "/" }))).toBe(true)
    expect(() => matches("nope", ev({}))).toThrow()
  })
})

describe("conflicts ⌘' with a DOM-like event (prototype getters)", () => {
  test("isNextConflictKey reads getters, not own props", async () => {
    const { isNextConflictKey } = await import("../src/conflicts/shortcut")
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

describe("sheet", () => {
  test("macOS glyphs in Apple order; Windows · Linux spells Ctrl / Alt / Shift", () => {
    const f = (id: string, p: "mac" | "other") =>
      sheetGroups(p)
        .flatMap((g) => g.rows)
        .find((r) => r.id === id)?.combos
    expect(f("saveAs", "mac")).toEqual(["⇧⌘S"])
    expect(f("saveAs", "other")).toEqual(["Ctrl+Shift+S"])
    expect(f("createComponent", "mac")).toEqual(["⌥⌘K"])
    expect(f("createComponent", "other")).toEqual(["Ctrl+Alt+K"])
    expect(f("redo", "mac")).toEqual(["⇧⌘Z", "⌘Y"])
    expect(f("nudge", "mac")).toEqual(["←↑→↓", "⇧←"])
    expect(f("goToMain", "other")).toEqual(["Alt+↵"])
    expect(f("addToSelection", "mac")).toEqual(["⇧ click"])
    expect(f("selectInside", "other")).toEqual(["Ctrl click"])
    expect(f("zoom100", "mac")).toEqual(["⌘0", "⇧0"])
    expect(f("pan", "other")).toEqual(["Space drag"])
    expect(f("shortcuts", "mac")).toEqual(["⌘/"])
  })

  test("groups in design order and columns; mode-local bindings aren't listed; ⌘/ is 'new'", () => {
    const g = sheetGroups("mac")
    expect(g.map((x) => [x.title, x.column])).toEqual(
      SHORTCUT_GROUPS.map((x) => [x.title, x.column]),
    )
    const ids = g.flatMap((x) => x.rows.map((r) => r.id))
    expect(ids).not.toContain("pen.finish")
    expect(
      g
        .flatMap((x) => x.rows)
        .filter((r) => r.isNew)
        .map((r) => r.id),
    ).toEqual(["shortcuts"])
    expect(g.find((x) => x.id === "tools")?.rows.map((r) => r.label)).toEqual([
      "Move",
      "Frame",
      "Rectangle",
      "Ellipse",
      "Line",
      "Arrow",
      "Star",
      "Text",
      "Pen",
      "Note",
      "Prompt",
      "Image",
      "Icon picker",
      "Hand",
    ])
  })

  test("filter matches action names and formatted keys; empty groups drop", () => {
    expect(sheetGroups("mac", "zoom").map((g) => g.id)).toEqual(["view"])
    expect(sheetGroups("mac", "⌥⌘").flatMap((g) => g.rows.map((r) => r.id))).toEqual([
      "copyProperties",
      "pasteProperties",
      "wrapInFrame",
      "createComponent",
      "detachInstance",
    ])
    expect(sheetGroups("other", "ctrl+shift+s").flatMap((g) => g.rows.map((r) => r.id))).toEqual([
      "saveAs",
    ])
    expect(sheetGroups("mac", "zzzz")).toEqual([])
  })

  test("current platform", () => {
    expect(currentPlatform({ platform: "MacIntel" })).toBe("mac")
    expect(currentPlatform({ platform: "Win32", userAgent: "Windows NT" })).toBe("other")
    expect(currentPlatform({ platform: "Linux x86_64" })).toBe("other")
  })
})
