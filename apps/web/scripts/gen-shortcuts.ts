/**
 * docs/guide/editor/shortcuts.md, generated from the app's single shortcut table
 * (src/shortcuts/shortcuts.ts: SHORTCUT_LIST, the same rows the in-app Keyboard shortcuts sheet
 * renders), so the docs can't drift from the bindings. The website renders the page like any
 * other doc.
 *
 *   bun scripts/gen-shortcuts.ts           rewrite the page
 *   bun scripts/gen-shortcuts.ts --check   exit 1 when it is stale (CI, check:generated)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import {
  formatShortcut,
  SHORTCUT_GROUPS,
  SHORTCUT_LIST,
  type Shortcut,
} from "../src/shortcuts/shortcuts"

const ROOT = join(import.meta.dir, "..", "..", "..")

const SHORTCUTS_SOURCE = "apps/web/src/shortcuts/shortcuts.ts"
const SHORTCUTS_PAGE = "docs/guide/editor/shortcuts.md"

const MODE_TITLES: Record<string, string> = {
  pen: "Pen",
  "path-edit": "Path editing",
  placement: "Image placement",
  crop: "Image crop",
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

function shortcutsMarkdown(): string {
  const parts = [
    `<!-- Generated from ${SHORTCUTS_SOURCE} by apps/web/scripts/gen-shortcuts.ts. Do not edit by hand. -->`,
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

const path = join(ROOT, SHORTCUTS_PAGE)
const md = shortcutsMarkdown()
if (process.argv.includes("--check")) {
  if (!existsSync(path) || readFileSync(path, "utf8") !== md) {
    console.error(`${SHORTCUTS_PAGE} is stale: run bun run gen:shortcuts in apps/web`)
    process.exit(1)
  }
} else {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, md)
  console.log(`wrote ${SHORTCUTS_PAGE}`)
}
