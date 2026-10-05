/**
 * kimo_script (ADR 0013 addendum 7) in the browser: on the M6 harness (real `@kimo/ai-agent`
 * loop, in-window M5 tools, real DocStore), a mocked provider streams a `kimo_script` call. The
 * script runs in the QuickJS worker; each top-level statement's layers land while the call is
 * still being written, the call commits them as one undo step, and the result carries the
 * script's printed lines.
 */
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import { build } from "vite"
import { type E2EContext, expect, type Scenario } from "./run"

const here = dirname(fileURLToPath(import.meta.url))
let built: Promise<string> | undefined

async function harnessUrl(ctx: E2EContext): Promise<string> {
  if (process.env.KIMO_E2E_DEV === "1") return `${ctx.url}e2e/m6-agent-harness/index.html`
  built ??= build({
    root: join(here, "m6-agent-harness"),
    configFile: false,
    base: "./",
    logLevel: "error",
    plugins: [react()],
    worker: { format: "es" },
    build: {
      outDir: join(process.env.KIMO_E2E_OUTDIR ?? join(here, ".dist"), "m6-agent-script"),
      emptyOutDir: true,
      target: "es2022",
    },
  }).then(() => "m6-agent-script/index.html")
  return `${ctx.url}${await built}`
}

type Probe = {
  firstLayer: number | null
  allLayers: number | null
  stepShown: number | null
  turnEnd: number | null
  statuses: string[]
  workers: string[]
  summary: string | null
}

type W = {
  __m6: {
    controller: {
      state: {
        busy: boolean
        messages: {
          kind: string
          steps?: { tool: string; state?: string; summary?: string }[]
          progress?: { status: string }
        }[]
      }
      send(text: string): Promise<void>
    }
    store: {
      nodeIds(): string[]
      getNode(id: string): { name?: string; parent?: string } | undefined
    }
  }
}

export const scenarios: Scenario[] = [
  {
    name: "agent-script: a streamed script's layers land statement by statement in the worker; one undo step",
    async run(ctx) {
      const { page } = ctx
      const errors: string[] = []
      page.on("pageerror", (e) => errors.push(e.message))
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.goto(`${await harnessUrl(ctx)}?scene=panel`)
      await page.waitForFunction(() => !!(window as unknown as W).__m6)
      const probe = (await page.evaluate(async () => {
        const w = window as unknown as W
        const c = w.__m6.controller
        const names = () =>
          w.__m6.store
            .nodeIds()
            .map((id) => w.__m6.store.getNode(id)?.name ?? "")
            .filter((n) => n === "Pro card" || n.startsWith("Line "))
        const p: Probe = {
          firstLayer: null,
          allLayers: null,
          stepShown: null,
          turnEnd: null,
          statuses: [],
          workers: [],
          summary: null,
        }
        const t0 = performance.now()
        const sample = () => {
          const t = Math.round(performance.now() - t0)
          const n = names().length
          if (n > 0 && p.firstLayer === null) p.firstLayer = t
          if (n === 5 && p.allLayers === null) p.allLayers = t
          const msg = c.state.messages.at(-1)
          if (msg?.kind === "agent") {
            if (p.stepShown === null && msg.steps?.some((s) => s.tool === "kimo_script"))
              p.stepShown = t
            const st = msg.progress?.status
            if (st && p.statuses.at(-1) !== st) p.statuses.push(st)
          }
        }
        const timer = setInterval(sample, 5)
        await c.send("Script a pricing card")
        while (c.state.busy) await new Promise((r) => setTimeout(r, 10))
        clearInterval(timer)
        sample()
        p.turnEnd = Math.round(performance.now() - t0)
        p.workers = performance
          .getEntriesByType("resource")
          .map((e) => e.name.split("/").pop() ?? "")
          .filter((n) => /worker/i.test(n))
        const step = c.state.messages.at(-1)?.steps?.find((s) => s.tool === "kimo_script")
        p.summary = step?.summary ?? step?.state ?? null
        return p
      })) as Probe
      ctx.log(`agent-script probe ${JSON.stringify(probe)}`)
      expect(errors.length === 0, `no page errors (${errors.join(" | ")})`)
      expect(probe.workers.length > 0, `the script ran in the sandbox worker (${probe.workers})`)
      expect(probe.firstLayer !== null, "streamed layers landed")
      expect(
        probe.stepShown !== null && (probe.firstLayer as number) < probe.stepShown,
        `the first layer (${probe.firstLayer} ms) lands before the call's step exists (${probe.stepShown} ms)`,
      )
      expect(
        probe.allLayers !== null && probe.allLayers <= (probe.stepShown as number) + 50,
        `all five layers land while the call streams (${probe.allLayers} ms)`,
      )
      const after = await page.evaluate(() => {
        const s = (window as unknown as W).__m6.store as unknown as {
          nodeIds(): string[]
          getNode(id: string): { name?: string; parent?: string } | undefined
          log(): { kind: string; origin?: string }[]
          undo(origin: string): { ok: boolean }
        }
        const ours = () =>
          s.nodeIds().filter((id) => {
            const n = s.getNode(id)?.name ?? ""
            return n === "Pro card" || n.startsWith("Line ")
          })
        const card = ours().find((id) => s.getNode(id)?.name === "Pro card")
        const parent = card ? s.getNode(card)?.parent : null
        const before = ours().length
        const origin = [...s.log()]
          .reverse()
          .find((e) => e.kind === "ops" && e.origin?.startsWith("agent:"))?.origin as string
        const undone = s.undo(origin).ok
        return { before, parent, undone, after: ours().length }
      })
      expect(after.before === 5, `5 layers after the turn (${after.before})`)
      expect(after.parent === "Pricing0001", `the card is inside Pricing (${after.parent})`)
      expect(after.undone && after.after === 0, `one undo removes all of them (${after.after})`)
    },
  },
]
