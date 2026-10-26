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
 *   KIMO_E2E_RETRIES=0 bun run e2e   # retries per failing scenario (default 1; 0 = none)
 *   KIMO_E2E_SHARD=2/4 bun run e2e   # the 2nd of 4 time-balanced slices (CI runs 4 in parallel)
 *
 * The Playwright driver runs under Node (via tsx), not Bun: under Bun 1.3.5 the pipe to
 * Chromium (child fds 3/4) is intermittently closed mid-session, Chromium exits cleanly and
 * Playwright never notices, so the running scenario hangs until its timeout. Bun stays the
 * package manager and script runner. A lost transport is detected by {@link watchTransport}
 * and reported as "[infra]".
 */
import { readdirSync, readFileSync, realpathSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  chromium,
  type Page,
} from "playwright"
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

/** True when `moduleUrl` is the script node / tsx / bun was started with. */
export function isEntry(moduleUrl: string): boolean {
  const arg = process.argv[1]
  if (!arg) return false
  try {
    return realpathSync(resolve(arg)) === realpathSync(fileURLToPath(moduleUrl))
  } catch {
    return false
  }
}

/**
 * `browser.newContext` for every e2e / perf page. tsx compiles this driver with esbuild's
 * `keepNames`, which wraps named functions in a `__name(fn, "name")` helper; functions passed to
 * `page.evaluate` / `waitForFunction` / `addInitScript` are serialized into the page, where that
 * helper doesn't exist. Define it (as the identity) before any page script runs.
 */
export async function newE2EContext(
  browser: Browser,
  options: BrowserContextOptions = {},
): Promise<BrowserContext> {
  const context = await browser.newContext(options)
  await context.addInitScript({ content: "globalThis.__name ??= (fn) => fn" })
  return context
}

/**
 * `KIMO_E2E_SHARD="k/n"`: the k-th of n slices of the scenario files, so n CI jobs together run
 * every file once. Files are dealt longest first to the slice with the least time so far, using
 * `timings.json` (seconds per file, from a CI log); a file missing there counts as the median.
 * Unset: all files. Throws on a malformed value.
 */
export function shardOf(
  files: readonly string[],
  spec: string | undefined,
  timings: Readonly<Record<string, number>> = {},
): string[] {
  if (!spec) return [...files]
  const m = /^(\d+)\/(\d+)$/.exec(spec.trim())
  const k = Number(m?.[1])
  const n = Number(m?.[2])
  if (!m || n < 1 || k < 1 || k > n) throw new Error(`KIMO_E2E_SHARD must be k/n, got "${spec}"`)
  const known = Object.values(timings).sort((a, b) => a - b)
  const median = known.length ? (known[Math.floor(known.length / 2)] as number) : 1
  const cost = (f: string) => timings[f] ?? median
  const load = new Array<number>(n).fill(0)
  const mine: string[] = []
  const order = [...files].sort((a, b) => cost(b) - cost(a) || a.localeCompare(b))
  for (const f of order) {
    let slot = 0
    for (let i = 1; i < n; i++) if ((load[i] as number) < (load[slot] as number)) slot = i
    load[slot] = (load[slot] as number) + cost(f)
    if (slot === k - 1) mine.push(f)
  }
  return files.filter((f) => mine.includes(f))
}

export function expect(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`Expectation failed: ${message}`)
}

// SwiftShader gives headless Chromium a WebGL context (the canvas uses CanvasKit WebGL).
const launch = () =>
  chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] })

/**
 * Retries per failing scenario (`KIMO_E2E_RETRIES`, default 1; 0 disables). A pass on retry is
 * reported as flaky, never hidden.
 */
const RETRIES = (() => {
  const raw = process.env.KIMO_E2E_RETRIES
  if (raw === undefined || raw === "") return 1
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0) throw new Error(`KIMO_E2E_RETRIES must be an integer ≥ 0`)
  return n
})()

/** Browser liveness probe period and its own deadline (see {@link watchTransport}). */
const HEARTBEAT_MS = 5_000
const HEARTBEAT_TIMEOUT_MS = 10_000

/** A failure of the browser / driver connection, not of the scenario under test. */
class InfraError extends Error {}

/**
 * Rejects when the browser connection dies: a `disconnected` event, a page crash, or a
 * browser-level CDP round trip (`Browser.getVersion`, independent of the page's main thread)
 * that gets no answer. Without this a dead transport leaves every pending Playwright call
 * hanging until the scenario timeout and the failure looks like a test bug.
 */
export function watchTransport(browser: Browser, page: Page) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  const cleanups: (() => void)[] = []
  const dead = new Promise<never>((_, reject) => {
    const fail = (why: string) => reject(new InfraError(`browser transport lost (infra): ${why}`))
    const onDisconnect = () => fail("browser disconnected")
    const onCrash = () => fail("page crashed")
    browser.on("disconnected", onDisconnect)
    page.on("crash", onCrash)
    cleanups.push(() => browser.off("disconnected", onDisconnect))
    cleanups.push(() => page.off("crash", onCrash))
    // One browser-level round trip (session open + Browser.getVersion + detach), bounded as a
    // whole: on a frozen transport even opening the session never settles.
    const probe = async () => {
      const cdp = await browser.newBrowserCDPSession()
      await cdp.send("Browser.getVersion")
      await cdp.detach()
    }
    const beat = async () => {
      if (stopped) return
      let deadline: ReturnType<typeof setTimeout> | undefined
      const ok = await Promise.race([
        probe().then(
          () => true,
          () => false,
        ),
        new Promise<false>((r) => {
          deadline = setTimeout(() => r(false), HEARTBEAT_TIMEOUT_MS)
        }),
      ])
      clearTimeout(deadline)
      if (stopped) return
      if (!ok) return fail(`no browser CDP reply within ${HEARTBEAT_TIMEOUT_MS} ms`)
      timer = setTimeout(beat, HEARTBEAT_MS)
    }
    timer = setTimeout(beat, HEARTBEAT_MS)
  })
  dead.catch(() => {})
  return {
    dead,
    stop() {
      stopped = true
      clearTimeout(timer)
      for (const c of cleanups) c()
    },
  }
}

type Outcome = { error: string | null; infra: boolean; ms: number }

/** Runs one scenario in a fresh context, bounded by {@link SCENARIO_TIMEOUT_MS}. */
async function attempt(browser: Browser, s: Scenario, url: string): Promise<Outcome> {
  const context = await newE2EContext(browser, { viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(e.message))
  if (process.env.KIMO_E2E_CONSOLE)
    page.on("console", (m) => console.log("    [console]", m.type(), m.text()))
  const watch = watchTransport(browser, page)
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
      watch.dead,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`scenario timed out after ${SCENARIO_TIMEOUT_MS} ms`)),
          SCENARIO_TIMEOUT_MS,
        )
      }),
    ])
    if (errors.length) throw new Error(`page errors: ${errors.join(" | ")}`)
    return { error: null, infra: false, ms: Math.round(performance.now() - t0) }
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : String(e),
      infra: e instanceof InfraError,
      ms: Math.round(performance.now() - t0),
    }
  } finally {
    watch.stop()
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
    // KIMO_E2E_OUTDIR: a separate bundle dir so parallel runs don't clobber each other.
    const outDir = process.env.KIMO_E2E_OUTDIR ?? join(here, ".dist")
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
  const infra: string[] = []
  try {
    // KIMO_E2E_FILES="canvas,m4-merge": only these *.e2e.ts files (by basename prefix).
    const only_files = process.env.KIMO_E2E_FILES?.split(",").filter(Boolean)
    const files = shardOf(
      readdirSync(here)
        .filter(
          (f) => f.endsWith(".e2e.ts") && (!only_files || only_files.some((p) => f.startsWith(p))),
        )
        .sort(),
      process.env.KIMO_E2E_SHARD,
      JSON.parse(readFileSync(join(here, "timings.json"), "utf8")) as Record<string, number>,
    )
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
        let result = await attempt(browser, s, url)
        const firstErrors: string[] = []
        for (let retry = 0; result.error && retry < RETRIES; retry++) {
          firstErrors.push(`${result.infra ? "[infra] " : ""}${result.error}`)
          // Each retry in a fresh browser.
          await Promise.race([
            browser.close().catch(() => {}),
            new Promise((r) => setTimeout(r, 5000)),
          ])
          browser = await launch()
          result = await attempt(browser, s, url)
        }
        if (!result.error && firstErrors.length === 0) {
          console.log(`  ✓ ${s.name} (${result.ms} ms)`)
        } else if (!result.error) {
          const onlyInfra = firstErrors.every((e) => e.startsWith("[infra]"))
          ;(onlyInfra ? infra : flaky).push(s.name)
          const kind = onlyInfra ? "infra" : "flaky"
          console.log(
            `  ↻ ${s.name} (${kind}: passed on retry ${firstErrors.length}; earlier: ${firstErrors.join(" / ")})`,
          )
        } else {
          failed++
          console.log(
            `  ✗ ${s.name} (${result.ms} ms)\n    ${result.infra ? "[infra] " : ""}${result.error}`,
          )
          // A dead browser would fail every later scenario in this file too.
          if (result.infra || !browser.isConnected()) {
            await Promise.race([
              browser.close().catch(() => {}),
              new Promise((r) => setTimeout(r, 5000)),
            ])
            browser = await launch()
          }
        }
      }
    }
  } finally {
    await browser?.close()
    await server.close()
  }
  if (infra.length)
    console.log(
      `\n${infra.length} scenario(s) hit a browser transport failure: ${infra.join("; ")}`,
    )
  if (flaky.length) console.log(`\n${flaky.length} flaky scenario(s): ${flaky.join("; ")}`)
  console.log(failed ? `\n${failed} scenario(s) failed` : "\nall scenarios passed")
  process.exit(failed ? 1 : 0)
}

// `import.meta.main` is Bun-only (Node ≥ 24.2); compare the entry script instead. Not awaited:
// the scenario files import this module, and a top-level await here would leave it evaluating,
// so under Node their dynamic import() would wait on it forever (ESM cycle + TLA).
if (isEntry(import.meta.url)) {
  // A promise a failed scenario left behind (a waitForEvent that times out after the scenario
  // gave up) must not crash the driver: log it; the scenario already reported its failure.
  process.on("unhandledRejection", (e) => {
    console.error("e2e: unhandled rejection (ignored):", e instanceof Error ? e.message : e)
  })
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
