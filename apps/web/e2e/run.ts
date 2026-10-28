/**
 * E2E smoke runner: builds the app once (production bundle, test hook on via VITE_KIMO_DEBUG=1),
 * serves it with `vite preview`, and runs every `*.e2e.ts` scenario in headless Chromium. Exits
 * non-zero when a scenario fails.
 *
 *   bun run e2e                      # all scenarios
 *   bun run e2e "pen"                # scenarios whose name contains the filter
 *   KIMO_E2E_SHOTS=dir bun run e2e   # write a screenshot of every failed scenario to dir
 *   KIMO_E2E_CONSOLE=1 bun run e2e   # echo the page console
 *   KIMO_E2E_RETRIES=0 bun run e2e   # retries per failing scenario (default 1; 0 = none)
 *
 * The scenarios are the core flows only (canvas, text and pen, share and join); they assert
 * document state and visible elements, never pixels or design values, so they run the same on
 * macOS and Linux. The Playwright driver runs under Node (via tsx), not Bun: under Bun 1.3.5 the
 * pipe to Chromium is intermittently closed mid-session and the running scenario hangs.
 */
import { mkdirSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { type Browser, type BrowserContext, chromium, type Page } from "playwright"
import { build, preview } from "vite"
import type { E2EContext, Scenario } from "./helpers"

/** A hung scenario fails on its own instead of stalling the whole run. */
const SCENARIO_TIMEOUT_MS = 90_000

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, "..")

// SwiftShader gives headless Chromium a WebGL context (the canvas uses CanvasKit WebGL).
const launch = () =>
  chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] })

const RETRIES = (() => {
  const raw = process.env.KIMO_E2E_RETRIES
  if (raw === undefined || raw === "") return 1
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0) throw new Error("KIMO_E2E_RETRIES must be an integer >= 0")
  return n
})()

/**
 * A fresh, isolated browser context. tsx compiles the scenarios with esbuild's `keepNames`,
 * which wraps named functions in a `__name(fn, "name")` helper; functions passed to
 * `page.evaluate` are serialized into the page, where that helper doesn't exist. Define it (as the
 * identity) before any page script runs.
 */
async function newContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addInitScript({ content: "globalThis.__name ??= (fn) => fn" })
  return context
}

type Outcome = { error: string | null; ms: number }

/** Runs one scenario in fresh contexts, bounded by {@link SCENARIO_TIMEOUT_MS}. */
async function attempt(browser: Browser, s: Scenario, url: string): Promise<Outcome> {
  const contexts: BrowserContext[] = []
  const errors: string[] = []
  const track = async () => {
    const context = await newContext(browser)
    contexts.push(context)
    const page = await context.newPage()
    page.on("pageerror", (e) => errors.push(e.message))
    if (process.env.KIMO_E2E_CONSOLE)
      page.on("console", (m) => console.log("    [console]", m.type(), m.text()))
    return page
  }
  const page = await track()
  const pages: Page[] = [page]
  const ctx: E2EContext = {
    page,
    url,
    log: (...a) => console.log("   ", ...a),
    newPage: async () => {
      const p = await track()
      pages.push(p)
      return p
    },
  }
  // A dead browser or a crashed page would otherwise hang every pending call until the timeout.
  let onDead: (e: Error) => void = () => {}
  const dead = new Promise<never>((_, reject) => {
    onDead = reject
  })
  dead.catch(() => {})
  const onDisconnect = () => onDead(new Error("browser disconnected"))
  browser.on("disconnected", onDisconnect)
  page.on("crash", () => onDead(new Error("page crashed")))
  const t0 = performance.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  const ms = () => Math.round(performance.now() - t0)
  try {
    await Promise.race([
      s.run(ctx),
      dead,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`scenario timed out after ${SCENARIO_TIMEOUT_MS} ms`)),
          SCENARIO_TIMEOUT_MS,
        )
      }),
    ])
    if (errors.length) throw new Error(`page errors: ${errors.join(" | ")}`)
    return { error: null, ms: ms() }
  } catch (e) {
    const shots = process.env.KIMO_E2E_SHOTS
    if (shots) {
      mkdirSync(shots, { recursive: true })
      for (const [i, p] of pages.entries())
        await p
          .screenshot({
            path: join(shots, `${s.name.replace(/\W+/g, "-")}-${i}.png`),
            timeout: 3000,
          })
          .catch(() => {})
    }
    return { error: e instanceof Error ? e.message : String(e), ms: ms() }
  } finally {
    browser.off("disconnected", onDisconnect)
    clearTimeout(timer)
    // A hung page can also hang close(); don't let it block the run.
    await Promise.race([
      Promise.all(contexts.map((c) => c.close().catch(() => {}))),
      new Promise((r) => setTimeout(r, 5000)),
    ])
  }
}

/** A GitHub Actions annotation, so a flaky or failed scenario shows on the pull request. */
function annotate(level: "warning" | "error", title: string, message: string) {
  if (!process.env.GITHUB_ACTIONS) return
  const text = message.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")
  console.log(`::${level} title=${title}::${text}`)
}

async function main() {
  const outDir = join(here, ".dist")
  process.env.VITE_KIMO_DEBUG = "1"
  // Kimo Cloud hidden: the Share popover offers the self-hosted relay and the run never calls the
  // hosted service.
  process.env.VITE_KIMO_CLOUD_API_URL = ""
  const configFile = join(root, "vite.config.ts")
  await build({ root, configFile, logLevel: "error", build: { outDir, emptyOutDir: true } })
  const server = await preview({
    root,
    configFile,
    logLevel: "error",
    build: { outDir },
    preview: {
      port: 41000 + Math.floor(Math.random() * 8000),
      strictPort: false,
      host: "127.0.0.1",
    },
  })
  const address = server.httpServer?.address()
  if (typeof address !== "object" || !address) throw new Error("preview server has no port")
  const url = `http://127.0.0.1:${address.port}/`
  let browser: Browser | null = null
  let failed = 0
  const flaky: string[] = []
  try {
    const only = process.argv[2]
    browser = await launch()
    for (const file of readdirSync(here)
      .filter((f) => f.endsWith(".e2e.ts"))
      .sort()) {
      const mod = (await import(join(here, file))) as { scenarios: Scenario[] }
      for (const s of mod.scenarios.filter((x) => !only || x.name.includes(only))) {
        let result = await attempt(browser, s, url)
        const earlier: string[] = []
        for (let retry = 0; result.error && retry < RETRIES; retry++) {
          earlier.push(result.error)
          // Each retry in a fresh browser.
          await Promise.race([
            browser.close().catch(() => {}),
            new Promise((r) => setTimeout(r, 5000)),
          ])
          browser = await launch()
          result = await attempt(browser, s, url)
        }
        if (!result.error && earlier.length === 0) {
          console.log(`  ok ${s.name} (${result.ms} ms)`)
        } else if (!result.error) {
          flaky.push(s.name)
          console.log(`  flaky ${s.name} (passed on retry; earlier: ${earlier.join(" / ")})`)
          annotate("warning", "flaky e2e scenario", `${s.name}: ${earlier.join(" / ")}`)
        } else {
          failed++
          console.log(`  FAIL ${s.name} (${result.ms} ms)\n    ${result.error}`)
          annotate("error", "e2e scenario failed", `${s.name}: ${result.error}`)
          if (!browser.isConnected()) browser = await launch()
        }
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

// A promise a failed scenario left behind (a waitForEvent that times out after the scenario gave
// up) must not crash the driver: log it; the scenario already reported its failure.
process.on("unhandledRejection", (e) => {
  console.error("e2e: unhandled rejection (ignored):", e instanceof Error ? e.message : e)
})
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
