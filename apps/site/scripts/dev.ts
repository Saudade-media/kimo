/**
 * `bun run dev`: builds into dist, serves it on http://localhost:4321 (PORT to change) and
 * rebuilds when the site sources, the docs markdown or the design tokens change (restart it after
 * re-exporting product shots into public/).
 */
import { watch } from "node:fs"
import { join } from "node:path"
import { build } from "../src/build"
import { REPO_ROOT } from "../src/config"
import { serveDir } from "./serve"

const out = join(import.meta.dir, "..", "dist")
let building: Promise<unknown> = build(out).then((r) =>
  console.log(`built ${r.pages.length} pages`),
)
await building
const server = serveDir(out, Number(process.env.PORT ?? 4321))
console.log(`kimo site: http://localhost:${server.port}`)

let timer: ReturnType<typeof setTimeout> | undefined
const rebuild = (why: string) => {
  clearTimeout(timer)
  timer = setTimeout(() => {
    building = building
      .then(() => build(out))
      .then((r) => console.log(`rebuilt (${why}): ${r.pages.length} pages`))
      .catch((e) => console.error(e))
  }, 120)
}
for (const dir of [
  join(import.meta.dir, "..", "src"),
  join(REPO_ROOT, "docs"),
  join(REPO_ROOT, "packages/cli/README.md"),
  join(REPO_ROOT, "examples/README.md"),
  join(REPO_ROOT, "CONTRIBUTING.md"),
  join(REPO_ROOT, "packages/design-tokens/src/generated"),
])
  watch(dir, { recursive: true }, (_e, f) => rebuild(String(f ?? dir)))
