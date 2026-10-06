/**
 * Board 37 audit, agent scope: every control is clicked and its effect asserted.
 *
 * On the M5 agents harness (`e2e/m5-agents-harness`, scripted McpHostApi + real DocStore):
 * - A8 / F1: a hosted window (`?scene=hosted`) lists the agent's logged edits in the session
 *   popover; Undo all is enabled and replays them through the document host, newest first;
 * - F14 / A5: Pause with the host down rolls the chip back and shows "Couldn't pause …";
 * - F9: a stale entry's Undo is disabled (with a tooltip) and a click does nothing; hovering a
 *   row outlines every target on the canvas layer;
 * - F4 / F10: "Agents & MCP…" and "Connect an agent…" reach their handlers.
 *
 * On the M6 agent harness (`e2e/m6-agent-harness`, real agent loop over a mocked provider):
 * - F3: iterate Before / After flips the pass on the canvas;
 * - F13: ⌥↵ in the skills menu toggles the top row instead of inserting it.
 */
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import type { Page } from "playwright"
import { build } from "vite"
import { type E2EContext, expect, type Scenario } from "./run"

const here = dirname(fileURLToPath(import.meta.url))
const builds = new Map<string, Promise<string>>()

async function harnessUrl(ctx: E2EContext, harness: "m5-agents" | "m6-agent"): Promise<string> {
  if (process.env.KIMO_E2E_DEV === "1") return `${ctx.url}e2e/${harness}-harness/index.html`
  const out = `b37-${harness}`
  let b = builds.get(harness)
  if (!b) {
    b = build({
      root: join(here, `${harness}-harness`),
      configFile: false,
      base: "./",
      logLevel: "error",
      plugins: [react()],
      build: {
        outDir: join(process.env.KIMO_E2E_OUTDIR ?? join(here, ".dist"), out),
        emptyOutDir: true,
        target: "es2022",
      },
    }).then(() => `${out}/index.html`)
    builds.set(harness, b)
  }
  return `${ctx.url}${await b}`
}

type Agents = {
  __agents: {
    ORIGIN: string
    notices: { text: string; action?: string }[]
    host: {
      calls: string[]
      clients: { pause(client: string): Promise<void> }
    }
    connect(over?: Record<string, unknown>): { connectionId: string; origin: string }
    entry(e: Record<string, unknown>): unknown
  }
}

async function openAgents(ctx: E2EContext, scene: "editor" | "hosted") {
  await ctx.page.setViewportSize({ width: 1440, height: 900 })
  await ctx.page.goto(`${await harnessUrl(ctx, "m5-agents")}?scene=${scene}`)
  await ctx.page.waitForFunction(() => !!(window as unknown as Agents).__agents)
}

const calls = (page: Page) =>
  page.evaluate(() => [...(window as unknown as Agents).__agents.host.calls])

type M6 = {
  __m6: {
    controller: {
      state: { busy: boolean; skills: { enabled: string[] }; composer: { mode: object } }
      setSelection(items: { id: string; name: string }[]): void
      setMode(m: Record<string, unknown>): void
    }
    store: { getNode(id: string): { name?: string } | undefined }
  }
}

async function openPanel(ctx: E2EContext) {
  await ctx.page.setViewportSize({ width: 1440, height: 900 })
  await ctx.page.goto(`${await harnessUrl(ctx, "m6-agent")}?scene=panel`)
  await ctx.page.waitForFunction(() => !!(window as unknown as M6).__m6)
}
const composer = (page: Page) => page.locator("[data-testid=agent-composer] textarea")
const heroName = (page: Page) =>
  page.evaluate(() => (window as unknown as M6).__m6.store.getNode("Hero000001")?.name ?? "")

export const scenarios: Scenario[] = [
  {
    name: "board37-agent: hosted session popover lists logged edits; Undo all goes through the host",
    async run(ctx) {
      const { page } = ctx
      await openAgents(ctx, "hosted")
      await page.evaluate(() => {
        const a = (window as unknown as Agents).__agents
        a.connect({ state: "editing" })
        // Hosted: the replica's op log has no group of the agent, only the activity entries.
        a.entry({ summary: "Restyle", label: "Update Card 2", undoToken: "h1" })
        a.entry({
          summary: "Remove hero",
          label: "Delete Old Hero",
          nodeIds: ["OldHero001"],
          undoToken: "h2",
        })
      })
      await page.locator(".kimo-agent-chip").click()
      const pop = page.locator("[data-testid=agent-session-popover]")
      await pop.waitFor()
      await page.waitForFunction(
        () => document.querySelectorAll(".agents-session__ops .kimo-agent-op-row").length === 2,
      )
      const undoAll = pop.getByRole("button", { name: "Undo all" })
      expect(await undoAll.isEnabled(), "Undo all enabled for a hosted session")
      expect(await pop.getByRole("button", { name: "Keep" }).isEnabled(), "Keep enabled")
      await undoAll.click()
      await page.waitForFunction(
        () =>
          (window as unknown as Agents).__agents.host.calls.filter((c) => c.startsWith("undo "))
            .length === 2,
      )
      const undos = (await calls(page)).filter((c) => c.startsWith("undo "))
      expect(
        undos.join("|") === "undo mcp:claude-code.k3x9qa h2|undo mcp:claude-code.k3x9qa h1",
        `host undo newest first: ${undos.join("|")}`,
      )
      await page.waitForFunction(
        () => document.querySelectorAll(".agents-session__ops .kimo-agent-op-row").length === 0,
      )
    },
  },
  {
    name: "board37-agent: Pause with the host down rolls back and shows Couldn't pause …",
    async run(ctx) {
      const { page } = ctx
      await openAgents(ctx, "hosted")
      await page.evaluate(() => {
        const a = (window as unknown as Agents).__agents
        a.connect({ state: "editing" })
        a.entry({ summary: "Restyle", undoToken: "h1" })
        a.host.clients.pause = async () => {
          throw new Error("the document host is not running")
        }
      })
      await page.locator(".kimo-agent-chip").click()
      const pop = page.locator("[data-testid=agent-session-popover]")
      await pop.getByRole("button", { name: "Pause Claude Code" }).click()
      const notice = page.locator("[data-testid=agent-notice]")
      await notice.waitFor()
      expect(
        (await notice.innerText()) ===
          "Couldn't pause Claude Code. The document host is not running.",
        `notice: ${await notice.innerText()}`,
      )
      const action = await page.evaluate(
        () => (window as unknown as Agents).__agents.notices[0]?.action,
      )
      expect(action === "Retry", "Retry action")
      expect(
        (await page.locator(".kimo-agent-chip").getAttribute("data-state")) !== "paused",
        "chip rolled back from Paused",
      )
    },
  },
  {
    name: "board37-agent: stale Undo is disabled with a tooltip; hover outlines every target",
    async run(ctx) {
      const { page } = ctx
      await openAgents(ctx, "editor")
      await page.evaluate(() => {
        const a = (window as unknown as Agents).__agents
        a.connect({ state: "idle" })
        // No op group on the store's stack: the guarded replay finds nothing (stale).
        a.entry({ summary: "Rename layers", nodeIds: ["Card000001", "Card000003"] })
      })
      const row = page.locator(".kimo-activity-row").first()
      await row.locator(".kimo-activity-row__undo").click()
      await page.waitForFunction(() => !!document.querySelector(".kimo-activity-row[data-stale]"))
      const undo = page.locator(".kimo-activity-row[data-stale] .kimo-activity-row__undo")
      expect(await undo.isDisabled(), "stale Undo is disabled")
      expect(
        (await undo.getAttribute("title")) ===
          "Nothing to undo. The layers changed after this edit.",
        "stale tooltip",
      )
      const before = (await calls(page)).length
      await undo.click({ force: true })
      expect((await calls(page)).length === before, "a click on a stale Undo calls nothing")
      // The guarded replay's failure is reported once (Toast/Danger in the editor).
      const notice = page.locator("[data-testid=agent-notice]")
      expect(
        (await notice.innerText()).startsWith("Couldn't undo"),
        `stale undo reported: ${await notice.innerText()}`,
      )

      await row.hover()
      await page.waitForFunction(
        () => document.querySelectorAll("[data-testid=agent-highlight]").length === 2,
      )
      const ids = await page
        .locator("[data-testid=agent-highlight]")
        .evaluateAll((els) => els.map((e) => e.getAttribute("data-node")))
      expect(ids.join(",") === "Card000001,Card000003", `outlined: ${ids.join(",")}`)
      // One measured pass: each outline sits on its node's projected box.
      const m = await page.evaluate(() => {
        const r = (sel: string) => {
          const b = document.querySelector(sel)?.getBoundingClientRect()
          return b ? [b.x, b.y, b.width, b.height].map(Math.round).join(",") : ""
        }
        const el = document.querySelector("[data-testid=agent-highlight][data-node=Card000003]")
        return {
          outline: r("[data-testid=agent-highlight][data-node=Card000003]"),
          node: r("[data-node=Card000003].h-node"),
          shadow: el ? getComputedStyle(el).boxShadow : "",
        }
      })
      expect(m.outline === m.node, `outline box ${m.outline} = node box ${m.node}`)
      expect(m.shadow.includes("inset") && m.shadow.includes("1.5px"), `stroke: ${m.shadow}`)
      await page.mouse.move(700, 600)
      await page.waitForFunction(
        () => document.querySelectorAll("[data-testid=agent-highlight]").length === 0,
      )
    },
  },
  {
    name: "board37-agent: Agents & MCP… and Connect an agent… reach their handlers",
    async run(ctx) {
      const { page } = ctx
      await openAgents(ctx, "editor")
      await page.getByRole("button", { name: "Connect an agent…" }).click()
      expect((await calls(page)).includes("connect-agent"), "Connect an agent… opens Settings")
      // Two agents: the presence popover's footer has "Agents & MCP…".
      await page.evaluate(() => {
        const a = (window as unknown as Agents).__agents
        a.connect({ state: "editing" })
        a.connect({
          client: "codex",
          label: "Codex",
          session: "q7w2er",
          origin: "mcp:codex.q7w2er",
          state: "editing",
        })
        a.entry({ summary: "Restyle" })
        a.entry({ summary: "Copy", origin: "mcp:codex.q7w2er", actor: "Codex" })
      })
      await page.locator(".kimo-agent-chip").first().click()
      const settings = page.getByRole("button", { name: "Agents & MCP…" })
      await settings.waitFor()
      await settings.click()
      expect((await calls(page)).includes("open-agents-settings"), "Agents & MCP… opens Settings")
    },
  },
  {
    name: "board37-agent: iterate Before / After flips the pass on the canvas",
    async run(ctx) {
      const { page } = ctx
      await openPanel(ctx)
      const original = await heroName(page)
      await page.evaluate(() => {
        const c = (window as unknown as M6).__m6.controller
        c.setSelection([{ id: "Pricing0001", name: "Pricing" }])
        c.setMode({ ...c.state.composer.mode, mode: "iterate", passes: 3 })
      })
      await composer(page).fill("Make Team feel premium")
      await composer(page).press("Enter")
      const review = page.locator("[data-testid=agent-review]")
      await review.waitFor({ timeout: 20_000 })
      await page.waitForFunction(() => !(window as unknown as M6).__m6.controller.state.busy)
      expect((await heroName(page)) === "Hero premium", "pass 1 applied")
      await review.getByRole("radio", { name: "Before" }).click()
      await page.waitForFunction(
        (o) => (window as unknown as M6).__m6.store.getNode("Hero000001")?.name === o,
        original,
      )
      await review.getByRole("radio", { name: "After" }).click()
      await page.waitForFunction(
        () => (window as unknown as M6).__m6.store.getNode("Hero000001")?.name === "Hero premium",
      )
      expect((await page.locator("[data-testid=agent-review-issue]").count()) === 0, "no issue")
    },
  },
  {
    name: "board37-agent: ⌥↵ in the skills menu toggles the top row; ↵ inserts it",
    async run(ctx) {
      const { page } = ctx
      await openPanel(ctx)
      const enabled = () =>
        page.evaluate(() => [...(window as unknown as M6).__m6.controller.state.skills.enabled])
      const before = (await enabled()).includes("kimo-layout")
      await composer(page).fill("/kimo-lay")
      await page.locator("[data-testid=agent-skills-menu]").waitFor()
      await composer(page).press("Alt+Enter")
      const after = (await enabled()).includes("kimo-layout")
      expect(after === !before, `⌥↵ toggled kimo-layout (${before} → ${after})`)
      expect((await composer(page).inputValue()) === "/kimo-lay", "⌥↵ inserted nothing")
      await composer(page).press("Enter")
      expect((await composer(page).inputValue()) === "/kimo-layout ", "↵ inserts the top row")
    },
  },
]
