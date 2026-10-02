/**
 * Browser smoke test for the WebGL path: serves this folder with Vite (resolving
 * `@kimo/renderer/browser`, the `?url` wasm import and the bundled font URLs), loads it in
 * Playwright Chromium, checks the WebGL backend and saves a screenshot.
 * Run: `bun run e2e:browser` (in packages/renderer). Screenshot → $SCREENSHOT or ./smoke.png.
 */
import { join } from "node:path"
import { chromium } from "playwright"
import { createServer } from "vite"

const root = import.meta.dir
const server = await createServer({
  root,
  configFile: false,
  logLevel: "error",
  server: { port: 0, fs: { allow: [join(root, "../../../..")] } },
})
await server.listen()
const url = server.resolvedUrls?.local[0] ?? ""
const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
})
let failed = false
try {
  const page = await browser.newPage({
    viewport: { width: 760, height: 520 },
    deviceScaleFactor: 2,
  })
  page.on("pageerror", (e) => console.error("pageerror:", e.message))
  await page.goto(url)
  await page.waitForFunction(
    () =>
      (window as never as { __result?: unknown; __error?: string }).__result ||
      (window as never as { __error?: string }).__error,
    null,
    { timeout: 30_000 },
  )
  const out = await page.evaluate(() => {
    const w = window as never as { __result?: unknown; __error?: string }
    return { result: w.__result, error: w.__error }
  })
  console.log(JSON.stringify(out, null, 2))
  await page.screenshot({ path: process.env.SCREENSHOT ?? join(root, "smoke.png") })
  const res = out.result as { stats?: { backend?: string; frames?: number } } | undefined
  failed = !!out.error || res?.stats?.backend !== "webgl" || !res?.stats?.frames
} finally {
  await browser.close()
  await server.close()
}
if (failed) {
  console.error("browser smoke FAILED")
  process.exit(1)
}
console.log("browser smoke ok")
