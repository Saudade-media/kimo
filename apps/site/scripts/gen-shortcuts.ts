/** Writes (or with --check, verifies) docs/guide/editor/shortcuts.md from the app's SHORTCUTS. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { REPO_ROOT } from "../src/config"
import { SHORTCUTS_PAGE, shortcutsMarkdown } from "../src/docs/shortcuts"

const path = join(REPO_ROOT, SHORTCUTS_PAGE)
const md = shortcutsMarkdown()
if (process.argv.includes("--check")) {
  if (!existsSync(path) || readFileSync(path, "utf8") !== md) {
    console.error(`${SHORTCUTS_PAGE} is stale: run bun scripts/gen-shortcuts.ts in apps/site`)
    process.exit(1)
  }
} else {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, md)
  console.log(`wrote ${SHORTCUTS_PAGE}`)
}
