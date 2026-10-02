/**
 * Writes `schema/kimo-0.1.schema.json` from the TypeBox schemas.
 *
 *   bun scripts/build-schema.ts          write the file
 *   bun scripts/build-schema.ts --check  exit 1 if the committed file is stale
 *
 * The output is passed through the repository's Biome formatter so `biome check` and
 * `check:generated` agree on the bytes.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { jsonSchemaText } from "../src/json-schema"

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..")
const repoRoot = join(pkgDir, "..", "..")
const outFile = join(pkgDir, "schema", "kimo-0.1.schema.json")

function format(text: string): string {
  const proc = Bun.spawnSync(
    ["bunx", "biome", "format", `--stdin-file-path=${relative(repoRoot, outFile)}`],
    { cwd: repoRoot, stdin: new TextEncoder().encode(text), stdout: "pipe", stderr: "pipe" },
  )
  if (proc.exitCode !== 0) {
    throw new Error(`biome format failed: ${proc.stderr.toString()}`)
  }
  return proc.stdout.toString()
}

const generated = format(jsonSchemaText())

if (process.argv.includes("--check")) {
  let current = ""
  try {
    current = readFileSync(outFile, "utf8")
  } catch {
    // missing file is stale
  }
  if (current !== generated) {
    console.error(
      `${relative(repoRoot, outFile)} is stale. Run: bun run --filter @kimo/core-schema build:schema`,
    )
    process.exit(1)
  }
  console.log(`${relative(repoRoot, outFile)} is up to date.`)
} else {
  writeFileSync(outFile, generated)
  console.log(`wrote ${relative(repoRoot, outFile)}`)
}
