/**
 * Generate src/generated/* from src/tokens.json.
 *
 *   bun run build:tokens       write the generated files
 *   bun run check:generated    exit 1 if any generated file is stale
 */
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { buildTokens } from "../src/build"

const srcDir = join(import.meta.dir, "..", "src")
const outDir = join(srcDir, "generated")
const check = process.argv.includes("--check")

const tree = (await Bun.file(join(srcDir, "tokens.json")).json()) as Record<string, unknown>
const files = buildTokens(tree)

if (!check) await mkdir(outDir, { recursive: true })
const stale: string[] = []
for (const [name, contents] of Object.entries(files)) {
  const path = join(outDir, name)
  const file = Bun.file(path)
  const current = (await file.exists()) ? await file.text() : undefined
  if (current === contents) continue
  if (check) stale.push(name)
  else {
    await Bun.write(path, contents)
    console.log(`wrote src/generated/${name}`)
  }
}

if (stale.length > 0) {
  console.error(
    `@kimo/design-tokens: stale generated files: ${stale.join(", ")}. Run \`bun run build:tokens\`.`,
  )
  process.exit(1)
}
if (check) console.log("@kimo/design-tokens: generated files are up to date")
