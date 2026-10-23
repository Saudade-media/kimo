/**
 * Board 42 "This computer": bundles apps/server's relay into one file the desktop app runs with
 * the person's installed Bun, staged as the Tauri resource `src-tauri/resources/relay/
 * kimo-relay.js` (`relay/kimo-relay.js` in the app's resource dir, where relay_host.rs looks).
 * `tauri build --config src-tauri/tauri.bundle.conf.json` ships it. Dev builds run
 * apps/server/src/main.ts directly.
 *
 * Usage: bun scripts/build-relay.ts
 */
import { mkdirSync } from "node:fs"
import { join } from "node:path"

const entry = join(import.meta.dir, "..", "..", "server", "src", "main.ts")
const outdir = join(import.meta.dir, "..", "src-tauri", "resources", "relay")
mkdirSync(outdir, { recursive: true })
const result = await Bun.build({
  entrypoints: [entry],
  target: "bun",
  outdir,
  naming: "kimo-relay.js",
  minify: false,
})
if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
console.log(`relay bundled: ${join(outdir, "kimo-relay.js")}`)
