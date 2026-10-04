/**
 * docs/guide/editor/shortcuts.md, generated from the app's single shortcut table
 * (apps/web/src/shortcuts/shortcuts.ts: SHORTCUT_LIST, the same rows the in-app Keyboard
 * shortcuts sheet renders), so the docs can't drift from the bindings.
 *
 *   bun scripts/gen-shortcuts.ts           # rewrite the page
 *   bun scripts/gen-shortcuts.ts --check   # fail when it is stale (the site test does this too)
 */
import {
  formatShortcut,
  SHORTCUT_GROUPS,
  SHORTCUT_LIST,
  type Shortcut,
} from "../../../web/src/shortcuts/shortcuts"

export const SHORTCUTS_SOURCE = "apps/web/src/shortcuts/shortcuts.ts"
export const SHORTCUTS_PAGE = "docs/guide/editor/shortcuts.md"

const MODE_TITLES: Record<string, string> = {
  pen: "Pen",
  "path-edit": "Path editing",
  placement: "Image placement",
  gesture: "While dragging",
}

const kbd = (combos: string[]) => combos.map((c) => `\`${c.replace(/\|/g, "\\|")}\``).join(" or ")

function rows(list: readonly Shortcut[]): string {
  const out = ["| Action | macOS | Windows · Linux |", "|---|---|---|"]
  for (const s of list) {
    out.push(
      `| ${s.label.replace(/\|/g, "\\|")} | ${kbd(formatShortcut(s, "mac"))} | ${kbd(formatShortcut(s, "other"))} |`,
    )
  }
  return out.join("\n")
}

export function shortcutsMarkdown(): string {
  const parts = [
    `<!-- Generated from ${SHORTCUTS_SOURCE} by apps/site/scripts/gen-shortcuts.ts. Do not edit by hand. -->`,
    "",
    "# Keyboard shortcuts",
    "",
    "Every binding in Kimo, from the same table the app's **Keyboard shortcuts** sheet renders (open it with `⌘/` on macOS, `Ctrl+/` elsewhere, from **File › Help** in the app, or from the desktop app's native **Help** menu). On Windows and Linux, `Ctrl` replaces `⌘` and `Alt` replaces `⌥`; both modifiers are accepted on every platform. `⌫` is Backspace or Delete.",
    "",
    "> [!NOTE]",
    "> Single-key tool shortcuts (`V`, `F`, `R` …) and canvas commands need the canvas focused: they don't fire while you type in a field or in the agent composer.",
  ]
  for (const g of SHORTCUT_GROUPS) {
    const list = SHORTCUT_LIST.filter((s) => s.group === g.id)
    if (list.length === 0) continue
    parts.push("", `## ${g.title}`, "", rows(list))
  }
  const local = SHORTCUT_LIST.filter((s) => !s.group)
  if (local.length) {
    parts.push(
      "",
      "## In a mode",
      "",
      "These keys only apply while the mode is active, so the sheet doesn't list them.",
    )
    for (const [scope, title] of Object.entries(MODE_TITLES)) {
      const list = local.filter((s) => s.scope === scope)
      if (list.length) parts.push("", `### ${title}`, "", rows(list))
    }
  }
  return `${parts.join("\n")}\n`
}
