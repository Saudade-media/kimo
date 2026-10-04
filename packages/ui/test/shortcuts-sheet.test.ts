/** Board 25 §7 (c) ShortcutsSheet (WcWPY): DOM isomorphic to the node tree. */
import { describe, expect, test } from "bun:test"
import { createElement as h } from "react"
import { renderToString } from "react-dom/server"
import { ShortcutsSheet } from "../src/index"

const order = (html: string, parts: string[]) => {
  let at = -1
  for (const p of parts) {
    const i = html.indexOf(p, at + 1)
    expect(i, `${p} after index ${at}`).toBeGreaterThan(at)
    at = i
  }
}

describe("ShortcutsSheet (WcWPY)", () => {
  const html = renderToString(
    h(ShortcutsSheet, {
      inline: true,
      groups: [
        {
          id: "edit",
          title: "Edit",
          column: 2,
          rows: [{ id: "redo", label: "Redo", combos: ["⇧⌘Z", "⌘Y"] }],
        },
        {
          id: "tools",
          title: "Tools",
          column: 1,
          rows: [{ id: "move", label: "Move", combos: ["V"] }],
        },
        {
          id: "help",
          title: "Help",
          column: 3,
          rows: [{ id: "shortcuts", label: "Keyboard shortcuts", combos: ["⌘/"], isNew: true }],
        },
      ],
      filter: "",
      onFilterChange() {},
      platforms: [
        { value: "mac", label: "macOS" },
        { value: "other", label: "Windows · Linux" },
      ],
      platform: "mac",
      onPlatformChange() {},
      onClose() {},
    }),
  )
  test("Header › Titles · Filter · Platform · Close; Body › Column 1–3; Footer › Icon · Note", () => {
    order(html, [
      "kimo-shortcuts-sheet__header",
      ">Keyboard shortcuts<",
      "Every binding in Kimo. Single keys work when the canvas has focus.",
      'placeholder="Filter shortcuts"',
      ">macOS<",
      ">Windows · Linux<",
      'aria-label="Close"',
      "kimo-shortcuts-sheet__body",
      'data-column="1"',
      ">Tools<",
      "kimo-shortcuts-sheet__gap",
      ">Move<",
      "kimo-shortcuts-sheet__spacer",
      ">V<",
      'data-column="2"',
      ">Redo<",
      ">⇧⌘Z<",
      ">or<",
      ">⌘Y<",
      'data-column="3"',
      ">Keyboard shortcuts<",
      ">new<",
      ">⌘/<",
      "kimo-shortcuts-sheet__footer",
      "Windows · Linux: ⌘ → Ctrl, ⌥ → Alt. Single-key tools are ignored while typing in a field.",
    ])
  })
})
