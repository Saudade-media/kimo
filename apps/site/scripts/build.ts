/** `bun run build`: writes the static site to apps/site/dist. */
import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { build } from "../src/build"

const t0 = performance.now()
const r = await build()
const size = (dir: string): number =>
  readdirSync(dir).reduce((n, f) => {
    const p = join(dir, f)
    const s = statSync(p)
    return n + (s.isDirectory() ? size(p) : s.size)
  }, 0)
const kb = (n: number) => `${(n / 1024).toFixed(0)} kB`
console.log(
  `site: ${r.pages.length} pages → ${r.outDir} (${kb(size(r.outDir))}) in ${Math.round(performance.now() - t0)} ms; contributors: ${r.contributors ?? "omitted (no network or repo)"}`,
)
