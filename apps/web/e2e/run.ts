/**
 * E2E runner: builds the app once (production bundle, test hook enabled with VITE_KIMO_DEBUG=1)
 * and serves it with `vite preview` on a free port, then runs every `*.e2e.ts` scenario in
 * headless Chromium (playwright package, not the MCP) and exits non-zero on failure.
 *
 * A production bundle keeps the suite fast and stable: with the dev server every scenario's
 * fresh browser context re-requests hundreds of unbundled modules from one Vite thread, which
 * saturates it on long runs and turns page loads into timeouts.
 *
 *   bun run e2e                      # all scenarios
 *   bun run e2e "qa-m3"              # scenarios whose name contains the filter
 *   KIMO_E2E_SHOTS=dir bun run e2e   # also write screenshots to dir
 *   KIMO_E2E_DEV=1 bun run e2e       # against the Vite dev server instead (slower, for HMR debugging)
 */
import { readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { type Browser, chromium, type Page } from "playwright"
import { build, createServer, type PreviewServer, preview, type ViteDevServer } from "vite"

export interface E2EContext {
  page: Page
  url: string
  /** Screenshot directory, when requested. */
  shots: string | null
  log(...args: unknown[]): void
}
export type Scenario = { name: string; run(ctx: E2EContext): Promise<void> }

/** A hung scenario fails on its own instead of stalling the whole suite. */
const SCENARIO_TIMEOUT_MS = 120_000

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, "..")

export function expect(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`Expectation failed: ${message}`)
}

// SwiftShader gives headless Chromium a WebGL context (the canvas uses CanvasKit WebGL).
const launch = () =>
  chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] })

/** Runs one scenario in a fresh context, bounded by {@link SCENARIO_TIMEOUT_MS}. */
async function attempt(
  browser: Browser,
  s: Scenario,
  url: string,
): Promise<{ error: string | null; ms: number }> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(e.message))
  if (process.env.KIMO_E2E_CONSOLE)
    page.on("console", (m) => console.log("    [console]", m.type(), m.text()))
  const t0 = performance.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      s.run({
        page,
        url,
        shots: process.env.KIMO_E2E_SHOTS ?? null,
        log: (...a) => console.log("   ", ...a),
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`scenario timed out after ${SCENARIO_TIMEOUT_MS} ms`)),
          SCENARIO_TIMEOUT_MS,
        )
      }),
    ])
    if (errors.length) throw new Error(`page errors: ${errors.join(" | ")}`)
    return { error: null, ms: Math.round(performance.now() - t0) }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e), ms: 0 }
  } finally {
    clearTimeout(timer)
    // A hung page can also hang close(); don't let it block the suite.
    await Promise.race([context.close(), new Promise((r) => setTimeout(r, 5000))])
  }
}

async function main() {
  const port = 41000 + Math.floor(Math.random() * 8000)
  const configFile = join(root, "vite.config.ts")
  let server: ViteDevServer | PreviewServer
  if (process.env.KIMO_E2E_DEV === "1") {
    const dev = await createServer({
      root,
      configFile,
      logLevel: "error",
      server: { port, strictPort: false, host: "127.0.0.1" },
    })
    await dev.listen()
    server = dev
  } else {
    const outDir = join(here, ".dist")
    process.env.VITE_KIMO_DEBUG = "1"
    await build({ root, configFile, logLevel: "error", build: { outDir, emptyOutDir: true } })
    server = await preview({
      root,
      configFile,
      logLevel: "error",
      build: { outDir },
      preview: { port, strictPort: false, host: "127.0.0.1" },
    })
  }
  const address = server.httpServer?.address()
  const actual = typeof address === "object" && address ? address.port : port
  const url = `http://127.0.0.1:${actual}/`
  let browser: Browser | null = null
  let failed = 0
  const flaky: string[] = []
  try {
    const files = readdirSync(here).filter((f) => f.endsWith(".e2e.ts"))
    const only = process.argv[2]
    for (const file of files) {
      const mod = (await import(join(here, file))) as { scenarios: Scenario[] }
      const picked = mod.scenarios.filter((s) => !only || s.name.includes(only))
      if (picked.length === 0) continue
      // A fresh browser per file: SwiftShader (software WebGL for CanvasKit) accumulates load in
      // one long-lived browser process across 100+ scenarios even though contexts are closed.
      await browser?.close()
      browser = await launch()
      for (const s of picked) {
        const first = await attempt(browser, s, url)
        if (!first.error) {
          console.log(`  ✓ ${s.name} (${first.ms} ms)`)
          continue
        }
        // One retry in a fresh browser; a pass on retry is reported as flaky, not hidden.
        await Promise.race([
          browser.close().catch(() => {}),
          new Promise((r) => setTimeout(r, 5000)),
        ])
        browser = await launch()
        const second = await attempt(browser, s, url)
        if (!second.error) {
          flaky.push(s.name)
          console.log(`  ↻ ${s.name} (flaky: passed on retry; first run: ${first.error})`)
          continue
        }
        failed++
        console.log(`  ✗ ${s.name}\n    ${second.error}`)
      }
    }
  } finally {
    await browser?.close()
    await server.close()
  }
  if (flaky.length) console.log(`\n${flaky.length} flaky scenario(s): ${flaky.join("; ")}`)
  console.log(failed ? `\n${failed} scenario(s) failed` : "\nall scenarios passed")
  process.exit(failed ? 1 : 0)
}

if (import.meta.main) await main()
