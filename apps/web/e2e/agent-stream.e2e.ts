/**
 * Streamed edits (ADR 0013 §4.7) in the browser: on the M6 harness (real `@kimo/ai-agent` loop,
 * in-window M5 tools, real DocStore), a mocked provider streams a `kimo_apply_ops` call's input
 * slowly. Its layers must land one by one while the call is still being written (before the
 * call's step exists and well before the turn ends), the status reads "Adding <layer>…", and
 * the call then commits them as one undo step.
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
    build: {
      outDir: join(process.env.KIMO_E2E_OUTDIR ?? join(here, ".dist"), "m6-agent-stream"),
      emptyOutDir: true,
      target: "es2022",
    },
  }).then(() => "m6-agent-stream/index.html")
  return `${ctx.url}${await built}`
}

type Probe = {
  /** ms since send → first streamed layer, the apply step's first appearance, turn end. */
  firstLayer: number | null
  allLayers: number | null
  stepShown: number | null
  turnEnd: number | null
  statuses: string[]
  groups: number
}

type W = {
  __m6: {
    controller: {
      state: {
        busy: boolean
        messages: {
          kind: string
          steps?: { tool: string }[]
          progress?: { status: string }
        }[]
      }
      send(text: string): Promise<void>
    }
    store: { nodeIds(): string[]; getNode(id: string): { name?: string } | undefined }
  }
  __probe?: Probe
}

export const scenarios: Scenario[] = [
  {
    name: "agent-stream: streamed layers land before the call ends; one undo step",
    async run(ctx) {
      const { page } = ctx
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
          groups: 0,
        }
        const t0 = performance.now()
        const sample = () => {
          const t = Math.round(performance.now() - t0)
          const n = names().length
          if (n > 0 && p.firstLayer === null) p.firstLayer = t
          if (n === 5 && p.allLayers === null) p.allLayers = t
          const msg = c.state.messages.at(-1)
          if (msg?.kind === "agent") {
            if (p.stepShown === null && msg.steps?.some((s) => s.tool === "kimo_apply_ops"))
              p.stepShown = t
            const st = msg.progress?.status
            if (st && p.statuses.at(-1) !== st) p.statuses.push(st)
          }
        }
        const timer = setInterval(sample, 5)
        await c.send("Stream a pricing card")
        while (c.state.busy) await new Promise((r) => setTimeout(r, 10))
        clearInterval(timer)
        sample()
        p.turnEnd = Math.round(performance.now() - t0)
        return p
      })) as Probe
      ctx.log(`agent-stream probe ${JSON.stringify(probe)}`)
      expect(probe.firstLayer !== null, "streamed layers landed")
      expect(
        probe.stepShown !== null && (probe.firstLayer as number) < probe.stepShown,
        `the first layer (${probe.firstLayer} ms) lands before the call's step exists (${probe.stepShown} ms)`,
      )
      expect(
        probe.allLayers !== null && probe.allLayers <= (probe.stepShown as number) + 50,
        `all five layers land while the call streams (${probe.allLayers} ms)`,
      )
      expect(
        probe.statuses.some((s) => /^Adding (Pro card|Line \d)…$/.test(s)),
        `status names the streamed layer (${probe.statuses.join(" | ")})`,
      )
      // One undo step: the agent's top undo entry removes all five layers.
      const after = await page.evaluate(() => {
        const s = (window as unknown as W).__m6.store as unknown as {
          nodeIds(): string[]
          getNode(id: string): { name?: string } | undefined
          log(): { kind: string; origin?: string }[]
          undo(origin: string): { ok: boolean }
        }
        const count = () =>
          s.nodeIds().filter((id) => {
            const n = s.getNode(id)?.name ?? ""
            return n === "Pro card" || n.startsWith("Line ")
          }).length
        const before = count()
        const origin = [...s.log()]
          .reverse()
          .find((e) => e.kind === "ops" && e.origin?.startsWith("agent:"))?.origin as string
        const undone = s.undo(origin).ok
        return { before, undone, after: count() }
      })
      expect(after.before === 5, `5 layers after the turn (${after.before})`)
      expect(after.undone && after.after === 0, `one undo removes all of them (${after.after})`)
    },
  },
]
