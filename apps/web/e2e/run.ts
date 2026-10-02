/**
 * E2E runner: starts the Vite dev server on a free port, runs every `*.e2e.ts` scenario in
 * headless Chromium (playwright package, not the MCP) and exits non-zero on failure.
 *
 *   bun run e2e                 # all scenarios
 *   KIMO_E2E_SHOTS=dir bun run e2e   # also write screenshots to dir
 */
import { readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { type Browser, chromium, type Page } from "playwright"
import { createServer } from "vite"

export interface E2EContext {
  page: Page
  url: string
  /** Screenshot directory, when requested. */
  shots: string | null
  log(...args: unknown[]): void
}
export type Scenario = { name: string; run(ctx: E2EContext): Promise<void> }

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, "..")

export function expect(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`Expectation failed: ${message}`)
}

async function main() {
  const port = 41000 + Math.floor(Math.random() * 8000)
  const server = await createServer({
    root,
    configFile: join(root, "vite.config.ts"),
    logLevel: "error",
    server: { port, strictPort: false, host: "127.0.0.1" },
  })
  await server.listen()
  const address = server.httpServer?.address()
  const actual = typeof address === "object" && address ? address.port : port
  const url = `http://127.0.0.1:${actual}/`
  let browser: Browser | null = null
  let failed = 0
  try {
    // SwiftShader gives headless Chromium a WebGL context (the canvas uses CanvasKit WebGL).
    browser = await chromium.launch({
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    })
    const files = readdirSync(here).filter((f) => f.endsWith(".e2e.ts"))
    const only = process.argv[2]
    for (const file of files) {
      const mod = (await import(join(here, file))) as { scenarios: Scenario[] }
      for (const s of mod.scenarios) {
        if (only && !s.name.includes(only)) continue
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
        const page = await context.newPage()
        const errors: string[] = []
        page.on("pageerror", (e) => errors.push(e.message))
        const t0 = performance.now()
        try {
          await s.run({
            page,
            url,
            shots: process.env.KIMO_E2E_SHOTS ?? null,
            log: (...a) => console.log("   ", ...a),
          })
          if (errors.length) throw new Error(`page errors: ${errors.join(" | ")}`)
          console.log(`  ✓ ${s.name} (${Math.round(performance.now() - t0)} ms)`)
        } catch (e) {
          failed++
          console.log(`  ✗ ${s.name}\n    ${e instanceof Error ? e.message : e}`)
        } finally {
          await context.close()
        }
      }
    }
  } finally {
    await browser?.close()
    await server.close()
  }
  console.log(failed ? `\n${failed} scenario(s) failed` : "\nall scenarios passed")
  process.exit(failed ? 1 : 0)
}

if (import.meta.main) await main()
