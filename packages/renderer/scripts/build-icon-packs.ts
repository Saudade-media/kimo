/**
 * Builds the browser icon packs (ADR 0010 "Icons"): every glyph of every set, normalized
 * once, spread over `PACK_SHARDS[pack]` shard files by name hash, plus a catalog per pack.
 *
 *   bun run --filter @kimo/renderer icons
 *
 * Output: `packages/renderer/assets/icons/<pack>/<shard>.json`, `<pack>/catalog.json` and
 * `<pack>/LICENSE.txt` (the source package's licence file, verbatim: ISC/MIT require the
 * notice in copies, Apache-2.0 §4 a copy of the licence). The browser entry emits the licence
 * files with the shards.
 * The browser entry (`src/browser.ts`) turns them into lazily fetched Vite assets.
 */
import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { type PackedGlyph, packageIconSource, packGlyph } from "../src/icons/provider"
import { PACK_SHARDS, PHOSPHOR_WEIGHTS, shardOf } from "../src/icons/sets"

const OUT = join(import.meta.dir, "..", "assets", "icons")
const source = packageIconSource()

/** Source package of each set (its LICENSE file is copied next to the pack). */
const PACKAGE: Record<string, string> = {
  lucide: "lucide-static",
  feather: "feather-icons",
  phosphor: "@phosphor-icons/core",
  "material-outlined": "@material-symbols/svg-400",
  "material-rounded": "@material-symbols/svg-400",
  "material-sharp": "@material-symbols/svg-400",
}
const require = createRequire(import.meta.url)
const licenseOf = (set: string) =>
  join(dirname(require.resolve(`${PACKAGE[set]}/package.json`)), "LICENSE")

const packs: [pack: string, set: string, weight: number | undefined][] = [
  ["lucide", "lucide", undefined],
  ["feather", "feather", undefined],
  ...PHOSPHOR_WEIGHTS.map(([w, s]) => [`phosphor-${s}`, "phosphor", w] as [string, string, number]),
  ["material-outlined", "material-outlined", undefined],
  ["material-rounded", "material-rounded", undefined],
  ["material-sharp", "material-sharp", undefined],
]

await rm(OUT, { recursive: true, force: true })
let total = 0
for (const [pack, set, weight] of packs) {
  const dir = join(OUT, pack)
  await mkdir(dir, { recursive: true })
  const catalog = await source.catalog(set)
  const n = PACK_SHARDS[pack] ?? 1
  const shards: Record<string, PackedGlyph>[] = Array.from({ length: n }, () => ({}))
  let count = 0
  for (const { name } of catalog) {
    const g = await source.glyph(set, name, weight)
    if (!g) continue
    ;(shards[shardOf(name, n)] as Record<string, PackedGlyph>)[name] = packGlyph(g)
    count++
  }
  for (let i = 0; i < n; i++) await writeFile(join(dir, `${i}.json`), JSON.stringify(shards[i]))
  await writeFile(join(dir, "catalog.json"), JSON.stringify(catalog))
  await copyFile(licenseOf(set), join(dir, "LICENSE.txt"))
  const bytes = (await readdir(dir)).length
  console.log(`${pack}: ${count} glyphs in ${n} shards (${bytes} files)`)
  total += count
}
console.log(`total ${total} glyphs → ${OUT}`)
