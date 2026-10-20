/**
 * Board 36 "Agent on canvas" (desing.pen XDVdg) in the real editor over an in-page document
 * host (`e2e/m5-host-harness`):
 *
 * - a built-in agent turn whose engine is Claude Code: the CLI's kimo-mcp relay connects from
 *   its session workspace (`~/.kimo/cli-workspaces/<session>`) and edits a small layer inside
 *   the Article section while the agent panel's state points at it. The canvas shows exactly one
 *   cursor ("Kimo", never also "Claude Code"), a 1 px outline equal to the Article box, the
 *   pointer tip on the section center (± the 3 px float), one ring on the section only;
 * - moving to another section glides 600 ms; panning and zooming never drift it;
 * - an external Claude Code connected on its own gets the same cursor + section outline with
 *   its own name.
 */
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import type { Page } from "playwright"
import { build } from "vite"
import { settle } from "./qa-helpers"
import { type E2EContext, expect, type Scenario } from "./run"

const here = fileURLToPath(new URL(".", import.meta.url))
let built: Promise<string> | null = null

async function harnessUrl(ctx: E2EContext): Promise<string> {
  if (process.env.KIMO_E2E_DEV === "1") return `${ctx.url}e2e/m5-host-harness/index.html`
  built ??= build({
    root: join(here, "m5-host-harness"),
    configFile: false,
    base: "./",
    logLevel: "error",
    plugins: [react()],
    build: {
      outDir: join(process.env.KIMO_E2E_OUTDIR ?? join(here, ".dist"), "board36-host"),
      emptyOutDir: true,
      target: "es2022",
    },
  }).then(() => "board36-host/index.html")
  return `${ctx.url}${await built}`
}

type Box = { x: number; y: number; w: number; h: number }
type Hook = {
  FILE: string
  call(tool: string, input: unknown): Promise<{ ok: boolean; summary: string; data?: unknown }>
  relayOpen(connectionId: string, client: string, cwd: string): Promise<void>
  relayCall(connectionId: string, name: string, args: unknown): Promise<unknown>
  platform: {
    mcp: { connections(): Promise<{ origin: string; cwd?: string; state: string }[]> }
  }
}
type Kimo = {
  session: {
    apply(ops: unknown): boolean
    ui: { getState(): { setViewport(v: unknown): void } }
  }
  canvas(): {
    layout(): { nodes: Map<string, { world: Box }> } | null
    renderer: { render(): void; viewport: { x: number; y: number; zoom: number } }
    setAgentCanvas(p: unknown): void
  }
}

const PAGE = "Frame00001"
const NAV = "Nav0000001"
const HERO = "Hero000001"
const ARTICLE = "Article001"
const TOC = "TocLabel01"
const CLI_WS = "/Users/me/.kimo/cli-workspaces/e2ecli"
const ORIGIN = "agent:kimo.e2ecli.0"

/** Sets the built-in agent's canvas state (what the agent panel passes during a turn). */
async function builtIn(
  page: Page,
  o: { area: string[]; pointer?: string; landed?: { key: string; ids: string[] }[] } | null,
) {
  await page.evaluate(
    ([origin, x]) => {
      const k = (window as unknown as { __kimo: Kimo }).__kimo
      if (!x) {
        k.canvas().setAgentCanvas(null)
        return
      }
      k.canvas().setAgentCanvas({
        liveOrigins: new Set([origin]),
        agent: () => ({ label: "Kimo", persona: "agent", ops: 1 }),
        cursors: [
          {
            origin,
            nodeId: x.area[0],
            nodeIds: x.area,
            ...(x.pointer ? { pointerId: x.pointer } : {}),
            text: "",
            state: "working",
          },
        ],
        landed: (x.landed ?? []).map((l) => ({ ...l, origin })),
        reducedMotion: false,
      })
    },
    [ORIGIN, o] as const,
  )
}

/** Screen boxes (relative to the canvas host) of the cursors, outlines and flashes. */
function measure(page: Page) {
  return page.evaluate(() => {
    const host = (document.querySelector(".canvas-host") as HTMLElement).getBoundingClientRect()
    const rel = (e: Element) => {
      const r = e.getBoundingClientRect()
      return { x: r.x - host.x, y: r.y - host.y, w: r.width, h: r.height }
    }
    return {
      cursors: [...document.querySelectorAll('[data-testid="agent-cursor"]')].map((e) => ({
        box: rel(e),
        float: rel(e.querySelector(".agent-section__float") as Element),
        label: e.querySelector(".agent-section__label")?.textContent ?? "",
        kind: e.getAttribute("data-kind"),
        display: getComputedStyle(e).display,
      })),
      outlines: [...document.querySelectorAll('[data-testid="agent-section-outline"]')].map(
        (e) => ({
          box: rel(e),
          node: e.getAttribute("data-node-id"),
          kind: e.getAttribute("data-kind"),
          shadow: getComputedStyle(e).boxShadow,
        }),
      ),
      flashes: [...document.querySelectorAll('[data-testid="agent-section-flash"]')].map((e) =>
        rel(e),
      ),
      labels: [
        ...document.querySelectorAll(
          ".canvas-host .agent-canvas, .canvas-host .agents-canvas-layer",
        ),
      ]
        .map((e) => (e as HTMLElement).innerText)
        .join(" | "),
    }
  })
}

/** A node's box on screen (relative to the canvas host) from the drawn viewport. */
const screenBox = (page: Page, id: string) =>
  page.evaluate((nid) => {
    const c = (window as unknown as { __kimo: Kimo }).__kimo.canvas()
    const v = c.renderer.viewport
    const b = c.layout()?.nodes.get(nid)?.world as Box
    return { x: (b.x - v.x) * v.zoom, y: (b.y - v.y) * v.zoom, w: b.w * v.zoom, h: b.h * v.zoom }
  }, id)

const near = (a: Box, b: Box, tol = 0.5) =>
  Math.abs(a.x - b.x) <= tol &&
  Math.abs(a.y - b.y) <= tol &&
  Math.abs(a.w - b.w) <= tol &&
  Math.abs(a.h - b.h) <= tol

export const scenarios: Scenario[] = [
  {
    name: "board36: a built-in CLI turn shows one cursor (Kimo) centered in its section, section outline and ring, 600 ms glide, no drift; an external client follows the same rules",
    async run(ctx) {
      const { page, log } = ctx
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.goto(`${await harnessUrl(ctx)}?kimo-debug`)
      await page.waitForFunction(() => !!(window as unknown as { __kimoHost?: unknown }).__kimoHost)
      const file = await page.evaluate(
        () => (window as unknown as { __kimoHost: Hook }).__kimoHost.FILE,
      )
      await page.evaluate((f) => {
        location.hash = `#/disk/${encodeURIComponent(f)}`
      }, file)
      await page.locator('.canvas-host[data-ready="true"]').waitFor({ timeout: 30_000 })
      await page.waitForFunction(() => !!(window as unknown as { __kimo?: Kimo }).__kimo?.canvas())

      // Fixture: Home (720 × 480) › Nav, Hero, Article › Contents label ("ON THIS PAGE").
      const ok = await page.evaluate(
        ([p, n, h, a, t]) =>
          (window as unknown as { __kimo: Kimo }).__kimo.session.apply([
            { op: "update", id: p, set: { h: 600 } },
            {
              op: "insert",
              id: n,
              parent: p,
              node: { type: "frame", name: "Nav", x: 0, y: 0, w: 720, h: 60, fill: "#FFFFFF" },
            },
            {
              op: "insert",
              id: h,
              parent: p,
              node: { type: "frame", name: "Hero", x: 0, y: 60, w: 720, h: 220, fill: "#F4F6F8" },
            },
            {
              op: "insert",
              id: a,
              parent: p,
              node: {
                type: "frame",
                name: "Article",
                x: 0,
                y: 280,
                w: 720,
                h: 320,
                fill: "#FFFFFF",
              },
            },
            {
              op: "insert",
              id: t,
              parent: a,
              node: {
                type: "frame",
                name: "ON THIS PAGE",
                x: 40,
                y: 24,
                w: 96,
                h: 10,
                fill: "#6B7480",
              },
            },
          ]),
        [PAGE, NAV, HERO, ARTICLE, TOC] as const,
      )
      expect(ok, "fixture applied")
      await page.evaluate(() =>
        (window as unknown as { __kimo: Kimo }).__kimo.session.ui
          .getState()
          .setViewport({ x: -200, y: -80, zoom: 1 }),
      )
      await settle(page)

      // The CLI engine's MCP relay (Claude Code from the session workspace) edits the label.
      const docId = await page.evaluate(
        async ([ws, f]) => {
          const h = (window as unknown as { __kimoHost: Hook }).__kimoHost
          await h.relayOpen("c_e2ecli", "claude-code", ws)
          const opened = (await h.relayCall("c_e2ecli", "kimo_open", { path: f })) as {
            data: { doc: { id: string } }
          }
          return opened.data.doc.id
        },
        [CLI_WS, file] as const,
      )
      const edited = (await page.evaluate(
        ([d, t]) =>
          (window as unknown as { __kimoHost: Hook }).__kimoHost.relayCall(
            "c_e2ecli",
            "kimo_apply_ops",
            { docId: d, ops: [{ op: "update", id: t, set: { fill: "#0093A3" } }] },
          ),
        [docId, TOC] as const,
      )) as { ok?: boolean }
      expect(edited?.ok === true, `CLI relay edit: ${JSON.stringify(edited)}`)
      // The window sees the CLI connection (with its workspace cwd) as an MCP client.
      await page.waitForFunction(
        async (ws) =>
          (
            await (window as unknown as { __kimoHost: Hook }).__kimoHost.platform.mcp.connections()
          ).some((c) => c.cwd === ws),
        CLI_WS,
        { timeout: 10_000 },
      )
      // The agent panel's state during that turn: the label, landed.
      await builtIn(page, { area: [TOC], pointer: TOC, landed: [{ key: "l1", ids: [TOC] }] })
      await page.locator('[data-testid="agent-cursor"]').first().waitFor({ timeout: 10_000 })
      await page.waitForTimeout(700)
      await settle(page)

      const m1 = await measure(page)
      const article = await screenBox(page, ARTICLE)
      log(`  built-in CLI turn: ${JSON.stringify(m1)} · Article ${JSON.stringify(article)}`)
      expect(m1.cursors.length === 1, `exactly one cursor (${m1.cursors.length})`)
      expect(m1.cursors[0]?.label === "Kimo", `label Kimo (${m1.cursors[0]?.label})`)
      expect(!/Claude Code/.test(m1.labels), `no "Claude Code" label on the canvas: ${m1.labels}`)
      expect(m1.outlines.length === 1, `one section outline (${m1.outlines.length})`)
      const o1 = m1.outlines[0]
      expect(o1?.node === ARTICLE, `outline on Article (${o1?.node})`)
      expect(!!o1 && near(o1.box, article), `outline = Article box ${JSON.stringify(o1?.box)}`)
      expect(/0px 0px 0px 1px inset/.test(o1?.shadow ?? ""), `1 px inside (${o1?.shadow})`)
      const c1 = m1.cursors[0]
      const cx = article.x + article.w / 2
      const cy = article.y + article.h / 2
      expect(
        !!c1 && Math.abs(c1.box.x + 3 - cx) <= 0.5 && Math.abs(c1.box.y + 3 - cy) <= 0.5,
        `cursor tip on the Article center: ${JSON.stringify(c1?.box)} vs ${cx},${cy}`,
      )
      expect(c1?.display !== "none" && (c1?.float.h ?? 0) > 0, "cursor rendered")
      // No outline on the small label; no placeholder / attribution tags.
      expect(
        (await page
          .locator('[data-testid="placeholder-tag"], [data-testid="agent-tag"]')
          .count()) === 0,
        "no tags",
      )

      // Float: the inner element bobs within [−3, 0] px over 2.4 s.
      const float = await page.evaluate(async () => {
        const out: number[] = []
        const el = document.querySelector('[data-testid="agent-cursor"]') as HTMLElement
        const inner = el.querySelector(".agent-section__float") as HTMLElement
        const t0 = performance.now()
        while (performance.now() - t0 < 2600) {
          out.push(inner.getBoundingClientRect().y - el.getBoundingClientRect().y)
          await new Promise((r) => requestAnimationFrame(r))
        }
        return { min: Math.min(...out), max: Math.max(...out), n: out.length }
      })
      log(`  float: ${JSON.stringify(float)}`)
      expect(
        float.min >= -3.05 && float.min <= -2.5 && float.max <= 0.05 && float.max >= -0.5,
        `float 0 → −3 px: ${JSON.stringify(float)}`,
      )

      // Section flash: one ring, on the section only (opacity fading), gone after 1.2 s.
      expect(m1.flashes.length <= 1, `one flash at most (${m1.flashes.length})`)
      await builtIn(page, {
        area: [TOC],
        pointer: TOC,
        landed: [
          { key: "l1", ids: [TOC] },
          { key: "l2", ids: [TOC, ARTICLE] },
        ],
      })
      await settle(page)
      const m2 = await measure(page)
      expect(
        m2.flashes.length === 1 && near(m2.flashes[0] as Box, article),
        `one ring on the Article box: ${JSON.stringify(m2.flashes)}`,
      )

      // Glide to Hero: 600 ms, ease-in-out cubic, sampled per frame.
      const hero = await screenBox(page, HERO)
      const glide = await page.evaluate(
        async ([origin, heroId, area]) => {
          const k = (window as unknown as { __kimo: Kimo }).__kimo
          const el = () => document.querySelector('[data-testid="agent-cursor"]') as HTMLElement
          const host = (
            document.querySelector(".canvas-host") as HTMLElement
          ).getBoundingClientRect()
          const pos = () => {
            const r = el().getBoundingClientRect()
            return { x: r.x - host.x, y: r.y - host.y }
          }
          const from = pos()
          const samples: { t: number; y: number }[] = []
          const t0 = performance.now()
          k.canvas().setAgentCanvas({
            liveOrigins: new Set([origin]),
            agent: () => ({ label: "Kimo", persona: "agent", ops: 2 }),
            cursors: [{ origin, nodeId: heroId, nodeIds: [heroId], text: "", state: "working" }],
            reducedMotion: false,
          })
          while (performance.now() - t0 < 1000) {
            await new Promise((r) => requestAnimationFrame(r))
            samples.push({ t: performance.now() - t0, y: pos().y })
          }
          void area
          return { from, samples }
        },
        [ORIGIN, HERO, ARTICLE] as const,
      )
      const toY = hero.y + hero.h / 2 - 3
      const total = toY - glide.from.y
      // Times count from the frame the glide started in (the last one before the cursor moves):
      // on a busy runner that frame can come well after setAgentCanvas returned.
      const moved = glide.samples.findIndex((s) => Math.abs(s.y - glide.from.y) > 0.001)
      const start = moved > 0 ? (glide.samples[moved - 1]?.t ?? 0) : 0
      for (const s of glide.samples) s.t -= start
      // Ended: at rest on its final position (the eased tail is within 0.5 px of it some 40 ms
      // early), and that position is the Hero center.
      const end = glide.samples[glide.samples.length - 1]?.y ?? Number.NaN
      const done =
        Math.abs(end - toY) <= 0.5
          ? (glide.samples.find((s) => Math.abs(s.y - end) <= 0.05)?.t ?? Infinity)
          : Infinity
      const mid = glide.samples.reduce((a, b) =>
        Math.abs(b.t - 300) < Math.abs(a.t - 300) ? b : a,
      )
      const midK = (mid.y - glide.from.y) / total
      log(
        `  glide: ${glide.samples.length} frames, reached at ${done.toFixed(0)} ms, at ${mid.t.toFixed(0)} ms k=${midK.toFixed(3)}`,
      )
      expect(done >= 560 && done <= 700, `glide ends ≈ 600 ms (${done.toFixed(0)} ms)`)
      expect(midK > 0.3 && midK < 0.7, `halfway ≈ 300 ms (k ${midK.toFixed(3)})`)
      const early = glide.samples.find((s) => s.t >= 100)
      expect(
        !!early && (early.y - glide.from.y) / total < 0.15,
        `soft start (ease-in-out) ${JSON.stringify(early)}`,
      )
      const m3 = await measure(page)
      expect(
        m3.outlines.length === 1 && near(m3.outlines[0]?.box as Box, hero),
        `outline moved to Hero: ${JSON.stringify(m3.outlines)}`,
      )

      // Position lock: every drawn frame while panning / zooming, cursor = Hero center − 3.
      await page.evaluate((heroId) => {
        const w = window as unknown as {
          __kimo: Kimo
          __lock: { rx: number; ry: number; z: number }[]
        }
        const c = w.__kimo.canvas()
        const r = c.renderer
        const host = document.querySelector(".canvas-host") as HTMLElement
        w.__lock = []
        const draw = r.render.bind(r)
        r.render = () => {
          draw()
          const v = r.viewport
          const el = document.querySelector('[data-testid="agent-cursor"]')
          const b = c.layout()?.nodes.get(heroId)?.world
          if (!el || !b) return
          const h = host.getBoundingClientRect()
          const e = el.getBoundingClientRect()
          w.__lock.push({
            rx: e.x - h.x - ((b.x + b.w / 2 - v.x) * v.zoom - 3),
            ry: e.y - h.y - ((b.y + b.h / 2 - v.y) * v.zoom - 3),
            z: v.zoom,
          })
        }
      }, HERO)
      const hostBox = await page.locator(".canvas-host").boundingBox()
      await page.mouse.move((hostBox?.x ?? 0) + 500, (hostBox?.y ?? 0) + 300)
      for (let i = 0; i < 10; i++) {
        await page.mouse.wheel(18, 12)
        await page.waitForTimeout(16)
      }
      await page.keyboard.down("Control")
      for (let i = 0; i < 4; i++) {
        await page.mouse.wheel(0, i < 2 ? -20 : 10)
        await page.waitForTimeout(16)
      }
      await page.keyboard.up("Control")
      await settle(page)
      const rows = await page.evaluate(
        () => (window as unknown as { __lock: { rx: number; ry: number; z: number }[] }).__lock,
      )
      const worst = Math.max(...rows.map((r) => Math.max(Math.abs(r.rx), Math.abs(r.ry))))
      const zooms = new Set(rows.map((r) => r.z.toFixed(3)))
      log(
        `  position lock: ${rows.length} frames, ${zooms.size} zooms, worst ${worst.toFixed(2)} px`,
      )
      expect(
        rows.length >= 8 && zooms.size >= 2,
        `sampled ${rows.length} frames, ${zooms.size} zooms`,
      )
      expect(worst <= 0.5, `cursor drift ${worst.toFixed(2)} px while panning / zooming`)

      // An external Claude Code (its own connection, no CLI workspace) edits the Nav: the same
      // rules with its own name.
      await page.evaluate(
        ([d, n]) =>
          (window as unknown as { __kimoHost: Hook }).__kimoHost.call("kimo_apply_ops", {
            docId: d,
            ops: [{ op: "update", id: n, set: { fill: "#FAFAFA" } }],
          }),
        [docId, NAV] as const,
      )
      await page
        .locator('[data-testid="agent-cursor"][data-kind="mcp"]')
        .waitFor({ timeout: 10_000 })
      await page.waitForTimeout(700)
      await settle(page)
      const m4 = await measure(page)
      const nav = await screenBox(page, NAV)
      log(`  external client: ${JSON.stringify(m4)}`)
      const ext = m4.cursors.filter((c) => c.kind === "mcp")
      expect(ext.length === 1, `one external cursor (${ext.length})`)
      expect(ext[0]?.label === "Claude Code", `external label (${ext[0]?.label})`)
      const extOutline = m4.outlines.find((o) => o.kind === "mcp")
      expect(
        extOutline?.node === NAV && near(extOutline.box, nav),
        `external outline = Nav box ${JSON.stringify(extOutline)} vs ${JSON.stringify(nav)}`,
      )
      const e0 = ext[0]
      expect(
        !!e0 &&
          Math.abs(e0.box.x + 3 - (nav.x + nav.w / 2)) <= 0.5 &&
          Math.abs(e0.box.y + 3 - (nav.y + nav.h / 2)) <= 0.5,
        `external cursor on the Nav center ${JSON.stringify(e0?.box)}`,
      )
      expect(m4.cursors.length === 2, `built-in + external = 2 cursors (${m4.cursors.length})`)

      // The turn ends: the built-in cursor goes; the CLI relay never drew one.
      await builtIn(page, null)
      await settle(page)
      const m5 = await measure(page)
      expect(
        m5.cursors.every((c) => c.kind === "mcp" && c.label === "Claude Code"),
        `only the external client remains: ${JSON.stringify(m5.cursors)}`,
      )
    },
  },
]
