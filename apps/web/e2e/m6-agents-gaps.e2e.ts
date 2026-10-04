/**
 * Board 24 › 5 · agent gap vignettes on the M5 surfaces (M5 agents harness, scripted McpHostApi
 * + real DocStore): (c) config diff preview, (d) session popover with 2+ agents, (e) approval
 * queue badge + popover, (f) empty Activity, (h) undone activity entry. One measured pass each.
 */
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import type { Page } from "playwright"
import { build } from "vite"
import { checker, measure, token } from "./m6-helpers"
import { type E2EContext, expect, type Scenario } from "./run"

const here = dirname(fileURLToPath(import.meta.url))
let built: Promise<string> | undefined

async function harnessUrl(ctx: E2EContext): Promise<string> {
  if (process.env.KIMO_E2E_DEV === "1") return `${ctx.url}e2e/m5-agents-harness/index.html`
  built ??= build({
    root: join(here, "m5-agents-harness"),
    configFile: false,
    base: "./",
    logLevel: "error",
    plugins: [react()],
    build: {
      outDir: join(process.env.KIMO_E2E_OUTDIR ?? join(here, ".dist"), "m6-agents-gaps"),
      emptyOutDir: true,
      target: "es2022",
    },
  }).then(() => "m6-agents-gaps/index.html")
  return `${ctx.url}${await built}`
}

type Agents = {
  __agents: {
    host: { calls: string[] }
    connect(over?: Record<string, unknown>): { connectionId: string; origin: string }
    apply(ops: unknown, origin?: string): boolean
    entry(e: Record<string, unknown>): unknown
    request(over?: Record<string, unknown>): void
  }
}
declare const window: Agents & Window

async function open(ctx: E2EContext, scene = "editor") {
  await ctx.page.setViewportSize({ width: 1440, height: 900 })
  await ctx.page.goto(`${await harnessUrl(ctx)}?scene=${scene}`)
  await ctx.page.waitForFunction(() => !!(window as unknown as Agents).__agents)
  await ctx.page.evaluate(() => document.fonts.ready)
}

async function edits(page: Page) {
  await page.evaluate(() => {
    const a = (window as unknown as Agents).__agents
    a.connect({ state: "editing" })
    a.apply({ op: "update", id: "Card000002", set: { fill: "#E9DFCF" } })
    a.entry({ summary: "Restyle pricing cards", nodeIds: ["Card000002"] })
  })
  await page.locator(".kimo-agent-chip").waitFor()
}

export const scenarios: Scenario[] = [
  {
    name: "m6-agents-gaps: (f) empty Activity + (h) undone entry; measured",
    async run(ctx) {
      const { page } = ctx
      await open(ctx)
      const empty = page.locator("[data-testid=agent-activity-empty]")
      await empty.waitFor()
      const c = checker(ctx, "(f) Activity log · empty (KzugB › utuM4)")
      const m = await measure(page, {
        panel: "[data-testid=right-panel]",
        body: "[data-testid=agent-activity-empty]",
        state: ".agents-activity__empty-state",
        wrap: ".agents-activity__empty-state .kimo-empty-state__icon-wrap",
        title: ".agents-activity__empty-state .kimo-empty-state__title",
        desc: ".agents-activity__empty-state .kimo-empty-state__desc",
        connect: "[data-testid=agent-activity-empty] .kimo-button",
      })
      c.box("Body (utuM4)", m.body, { gap: 12, pad: [16, 16, 16, 16] })
      c.box("EmptyState (CCGxw)", m.state, { w: (m.body?.w ?? 0) - 32 })
      c.box("Icon Wrap", m.wrap, { w: 40, h: 40 })
      c.box("Title (DlzmW)", m.title, { fs: 13, fw: "600" })
      c.box("Desc (sGDcC)", m.desc, { fs: 12 })
      c.box("Connect an agent… (bRU6S Button/Secondary h 28)", m.connect, {
        h: 28,
        pad: [0, 10, 0, 10],
        fs: 12,
      })
      c.check(
        "Connect an agent…",
        "centred",
        (m.connect?.x ?? 0) + (m.connect?.w ?? 0) / 2,
        (m.body?.x ?? 0) + (m.body?.w ?? 0) / 2,
      )
      c.flush()
      expect(
        (await empty.locator(".kimo-empty-state__title").innerText()) === "No agent activity yet",
        "copy",
      )
      await empty.getByRole("button", { name: "Connect an agent…" }).click()
      expect(
        await page.evaluate(() =>
          (window as unknown as Agents).__agents.host.calls.includes("connect-agent"),
        ),
        "opens Agents & MCP",
      )

      // (h) Undo the entry: it stays, struck through, "Undone by you · time", Redo.
      await edits(page)
      const row = page.locator("[data-testid=agent-activity] .kimo-activity-row").first()
      await row.locator(".kimo-activity-row__undo").click()
      const undone = page.locator(".kimo-activity-row--undone")
      await undone.waitFor()
      const h = checker(ctx, "(h) ActivityRow · undone (d8Vjj1)")
      const um = await measure(page, {
        row: ".kimo-activity-row--undone",
        label: ".kimo-activity-row--undone .kimo-activity-row__label",
        target: ".kimo-activity-row--undone .kimo-activity-row__target",
        redo: ".kimo-activity-row--undone .kimo-activity-row__undo",
      })
      const tertiary = await token(page, "--kimo-text-tertiary")
      h.box("ActivityRow · undone", um.row, { bg: await token(page, "--kimo-bg-subtle") })
      h.box("Label (lQxhQ)", um.label, { color: tertiary })
      h.box("Target (aegZN)", um.target, { color: tertiary })
      h.box("Redo (ECru2 redo-2)", um.redo, { w: 24, h: 24 })
      h.check(
        "Label",
        "text-decoration",
        await undone
          .locator(".kimo-activity-row__label")
          .evaluate((e) => getComputedStyle(e).textDecorationLine),
        "line-through",
      )
      h.flush()
      expect(
        (await undone.locator(".kimo-activity-row__tool").innerText()).startsWith(
          "Undone by you · ",
        ),
        "tool line",
      )
      expect((await undone.getByRole("button", { name: "Redo" }).count()) === 1, "Redo action")
      await undone.getByRole("button", { name: "Redo" }).click()
      await page.waitForFunction(() => !document.querySelector(".kimo-activity-row--undone"))
    },
  },
  {
    name: "m6-agents-gaps: (e) approval queue badge + popover, (d) 2+ agents popover; measured",
    async run(ctx) {
      const { page } = ctx
      await open(ctx)
      await edits(page)
      await page.evaluate(() => {
        const a = (window as unknown as Agents).__agents
        a.request({ summary: "Delete 3 layers" })
        a.request({ summary: "Replace image" })
      })
      const chip = page.locator(".kimo-agent-chip")
      await page.waitForFunction(
        () => document.querySelector(".kimo-agent-chip__queue-count")?.textContent === "2",
      )
      // The first request's prompt opens by itself; Esc denies it, then use the queue popover.
      await page.keyboard.press("Escape")
      await page.waitForFunction(
        () => document.querySelector(".kimo-agent-chip__queue-count")?.textContent === "1",
      )
      await page.evaluate(() =>
        (window as unknown as Agents).__agents.request({ summary: "Delete 3 layers" }),
      )
      await chip.click()
      const pop = page.locator("[data-testid=agents-queue-popover]")
      await pop.waitFor()
      const e = checker(ctx, "(e) Popover · Waiting for approval (XCENV)")
      const m = await measure(page, {
        pop: "[data-testid=agents-queue-popover]",
        header: "[data-testid=agents-queue-popover] .agents-pop__header",
        title: "[data-testid=agents-queue-popover] .agents-pop__title",
        body: "[data-testid=agents-queue-popover] .agents-pop__body",
        req: "[data-testid=agents-queue-popover] .agents-pop__request",
        name: "[data-testid=agents-queue-popover] .agents-pop__name",
        meta: "[data-testid=agents-queue-popover] .agents-pop__meta",
        deny: "[data-testid=agents-queue-popover] .kimo-button--ghost",
        approve: "[data-testid=agents-queue-popover] .kimo-button--primary",
      })
      e.box("Popover (XCENV)", m.pop, { w: 320, radius: 16 })
      e.box("Header (sPqUz)", m.header, { h: 40, pad: [0, 6, 0, 12] })
      e.box("Title (RTv8P)", m.title, { fs: 12, fw: "500" })
      e.box("Body (cPG1M)", m.body, { pad: [4, 0, 4, 0] })
      e.box("Request (mywhw)", m.req, { gap: 8, pad: [8, 12, 8, 12] })
      e.box("Title (U5gTg)", m.name, { fs: 12, fw: "500" })
      e.box("Detail (g6XIuW)", m.meta, { fs: 11 })
      e.box("Deny (B21Bw ghost h 24)", m.deny, { h: 24, pad: [0, 8, 0, 8], fs: 11 })
      e.box("Approve (g67Pgw primary h 24)", m.approve, { h: 24, pad: [0, 8, 0, 8], fs: 11 })
      e.flush()
      expect(
        (await pop.locator(".agents-pop__title").innerText()) === "Waiting for approval · 2",
        "title count",
      )
      // ⌘↩ approves the top item.
      await page.keyboard.press("Meta+Enter")
      await page.waitForFunction(() =>
        (window as unknown as Agents).__agents.host.calls.some((x) => / once$/.test(x)),
      )
      await page.keyboard.press("Escape")

      // (d) A second agent connects: chip = lead + "+1"; the popover lists both.
      await page.evaluate(() => {
        const a = (window as unknown as Agents).__agents
        a.connect({
          client: "codex",
          label: "Codex",
          session: "q7w2er",
          state: "editing",
          identity: { client: "codex", label: "Codex", session: "q7w2er", transport: "http" },
        })
      })
      await page.evaluate(() => {
        // Clear the remaining queue so the chip opens the agents list.
        const btns = [...document.querySelectorAll("[data-choice=deny]")] as HTMLButtonElement[]
        for (const b of btns) b.click()
      })
      await page.waitForFunction(() => !document.querySelector(".kimo-agent-chip__queue"))
      expect(
        (await page.locator(".kimo-agent-chip__meta").innerText()) === "+1",
        `lead + "+N": ${await page.locator(".kimo-agent-chip__meta").innerText()}`,
      )
      await chip.click()
      const list = page.locator("[data-testid=agents-session-list]")
      await list.waitFor()
      const d = checker(ctx, "(d) Popover · Session (N4cx0)")
      const dm = await measure(page, {
        pop: "[data-testid=agents-session-list]",
        header: "[data-testid=agents-session-list] .agents-pop__header",
        row: "[data-testid=agents-session-list] .agents-pop__agent",
        mark: "[data-testid=agents-session-list] .agents-pop__agent .kimo-agent-mark",
        text: "[data-testid=agents-session-list] .agents-pop__text",
        footer: "[data-testid=agents-session-list] .agents-pop__footer",
        pause: "[data-testid=agents-session-list] .agents-pop__agent .kimo-button--ghost",
      })
      d.box("Popover (N4cx0)", dm.pop, { w: 340, radius: 16 })
      d.box("Header (he0SM)", dm.header, { h: 40, pad: [0, 6, 0, 12] })
      d.box("Agent row (SVpRa)", dm.row, { gap: 10, pad: [8, 12, 8, 12] })
      d.box("AgentMark 24 (LDwsP)", dm.mark, { w: 24, h: 24 })
      d.box("Text (VlVZF)", dm.text, { gap: 2 })
      d.box("Footer (PwFn6)", dm.footer, { gap: 6, pad: [8, 12, 4, 12] })
      d.box("Pause (dEr1r ghost h 24)", dm.pause, { h: 24, pad: [0, 8, 0, 8] })
      d.flush()
      expect(
        (await list.locator(".agents-pop__title").innerText()) === "Session · home.kimo",
        "title",
      )
      expect((await list.locator(".agents-pop__agent").count()) === 2, "two agents")
      expect(
        (await list.getByRole("button", { name: "Stop all" }).count()) === 1,
        "Stop all with ≥ 2 active",
      )
      if (ctx.shots) await page.screenshot({ path: join(ctx.shots, "m6-gaps-d.png") })
    },
  },
  {
    name: "m6-agents-gaps: (c) MCP config diff preview; measured",
    async run(ctx) {
      const { page } = ctx
      await open(ctx, "settings-running")
      await page.locator("[data-host=gemini-cli]").getByRole("button", { name: "Install" }).click()
      const dlg = page.locator("[data-testid=agents-config-diff]")
      await dlg.waitFor()
      const c = checker(ctx, "(c) Dialog · Update config (K5Dnf)")
      const m = await measure(page, {
        dlg: "[data-testid=agents-config-diff]",
        head: ".agents-config-diff__head",
        wrap: ".agents-config-diff__icon-wrap",
        text: ".agents-config-diff__text",
        title: ".agents-config-diff__title",
        desc: ".agents-config-diff__desc",
        diff: ".agents-config-diff__diff",
        line: ".agents-config-diff__line",
        add: ".agents-config-diff__line--add",
        footer: ".agents-config-diff__footer",
        copy: ".agents-config-diff__footer .kimo-button--ghost",
        write: ".agents-config-diff__footer .kimo-button--primary",
        note: ".agents-config-diff__footnote",
      })
      c.box("Dialog (K5Dnf)", m.dlg, { gap: 14, pad: [20, 20, 20, 20], radius: 24 })
      c.box("Head (EVccw)", m.head, { gap: 12 })
      c.box("Icon Wrap (BPzO7)", m.wrap, { w: 32, h: 32, bg: await token(page, "--kimo-bg-muted") })
      c.box("Text (f6xpG)", m.text, { gap: 4 })
      c.box("Title (TVhJO)", m.title, { fs: 13, fw: "600" })
      c.box("Desc (Ik7Ti)", m.desc, { fs: 11, ff: "JetBrains Mono" })
      c.box("Diff (MFEi0)", m.diff, {
        pad: [8, 0, 8, 0],
        radius: 10,
        bg: await token(page, "--kimo-bg-subtle"),
      })
      c.box("Line (xcMvc)", m.line, { gap: 8, pad: [1, 12, 1, 12] })
      c.box("Line + (C56Xn)", m.add, { bg: await token(page, "--kimo-success-soft") })
      c.box("Footer (hdWkt)", m.footer, { gap: 8 })
      c.box("Copy diff (N9bYm ghost h 28)", m.copy, { h: 28, pad: [0, 10, 0, 10], fs: 12 })
      c.box("Write config (uDAWd primary h 28)", m.write, { h: 28, pad: [0, 10, 0, 10] })
      c.box("Footnote (v3QurW)", m.note, { fs: 11 })
      c.flush()
      if (ctx.shots) await page.screenshot({ path: join(ctx.shots, "m6-gaps-c.png") })
      expect(
        (await dlg.locator(".agents-config-diff__footnote").innerText()).startsWith("Backup → "),
        "backup footnote",
      )
      await dlg.getByRole("button", { name: "Copy diff" }).click()
      expect(
        await page.evaluate(() =>
          (window as unknown as Agents).__agents.host.calls.some((x) => x.startsWith("copy ")),
        ),
        "copy diff",
      )
      await dlg.getByRole("button", { name: "Cancel" }).click()
      expect((await dlg.count()) === 0, "Cancel writes nothing")
      expect(
        !(await page.evaluate(() =>
          (window as unknown as Agents).__agents.host.calls.some((x) =>
            x.startsWith("installer.install"),
          ),
        )),
        "nothing written on Cancel",
      )
    },
  },
]
