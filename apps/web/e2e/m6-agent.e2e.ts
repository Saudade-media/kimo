/**
 * Board 22 "Built-in Agent (M6)" › Agent panel (s4pGz0) and modes (ZFOQf), board 24 AgentMark
 * (ZkIvw), on the M6 harness (`e2e/m6-agent-harness`): the real `@kimo/ai-agent` loop over a
 * mocked provider, the in-window M5 tool host and a real DocStore. Each surface gets one
 * measured getComputedStyle / getBoundingClientRect pass against the desing.pen node values.
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
  if (process.env.KIMO_E2E_DEV === "1") return `${ctx.url}e2e/m6-agent-harness/index.html`
  built ??= build({
    root: join(here, "m6-agent-harness"),
    configFile: false,
    base: "./",
    logLevel: "error",
    plugins: [react()],
    build: {
      outDir: join(process.env.KIMO_E2E_OUTDIR ?? join(here, ".dist"), "m6-agent"),
      emptyOutDir: true,
      target: "es2022",
    },
  }).then(() => "m6-agent/index.html")
  return `${ctx.url}${await built}`
}

type M6 = {
  __m6: {
    controller: {
      state: {
        busy: boolean
        messages: { kind: string; text: string; streaming?: boolean; card?: { kind: string } }[]
        menu: string | null
        sessionsOpen: boolean
      }
      setSelection(items: { id: string; name: string }[]): void
      setMode(m: Record<string, unknown>): void
      state_mode?: unknown
    }
    store: { getNode(id: string): { name?: string } | undefined }
    stats(): {
      marks: number
      animated: number
      contexts: number
      frames: number
      webgl: boolean
      reducedMotion: boolean
    }
    copied: string[]
  }
}
declare const window: M6 & Window

async function open(ctx: E2EContext, scene = "panel") {
  await ctx.page.setViewportSize({ width: 1440, height: 900 })
  await ctx.page.goto(`${await harnessUrl(ctx)}?scene=${scene}`)
  await ctx.page.waitForFunction(() => !!(window as unknown as M6).__m6)
  await ctx.page.evaluate(() => document.fonts.ready)
}

const composer = (page: Page) => page.locator("[data-testid=agent-composer] textarea")
async function send(page: Page, text: string) {
  await composer(page).fill(text)
  await composer(page).press("Enter")
}
const idle = (page: Page) =>
  page.waitForFunction(() => !(window as unknown as M6).__m6.controller.state.busy, null, {
    timeout: 20_000,
  })

export const scenarios: Scenario[] = [
  {
    name: "m6-agent: panel A — streaming, steps, meta, stop/queue + measured",
    async run(ctx) {
      const { page } = ctx
      await open(ctx)
      await send(page, "Make the hero warm")
      await idle(page)
      await page.locator("[data-testid=agent-message-meta]").first().waitFor()
      // Second turn streams slowly: the composer turns into Stop and typing queues.
      await send(page, "Now a slow waitlist reply")
      // Board 31: one live status line (the agent's note), no streamed text, no token meta.
      await page.waitForFunction(
        () =>
          document.querySelector("[data-testid=agent-status] .kimo-agent-status__text")
            ?.textContent === "Adding the waitlist form",
      )
      await page.locator("[data-testid=agent-status] .kimo-agent-status__follow").waitFor()
      expect(
        (await page.locator(".kimo-composer-agent__send--stop").count()) === 1,
        "Send becomes Stop while streaming",
      )
      expect(
        (await composer(page).getAttribute("placeholder")) ===
          "Queue a follow-up for when this turn ends",
        "streaming placeholder",
      )
      expect(
        (await page.locator("[data-testid=agent-streaming-meta]").count()) === 0 &&
          (await page.locator(".kimo-message__caret").count()) === 0,
        "no streaming meta, no caret",
      )
      // The running turn shows no message bubble (the reply lands when the turn ends).
      expect(
        (await page
          .locator("[data-testid=agent-message]")
          .last()
          .locator(".kimo-message")
          .count()) === 0,
        "no streamed bubble while running",
      )
      const agent = await token(page, "--kimo-agent")
      const agentSoft = await token(page, "--kimo-agent-soft")
      const accent = await token(page, "--kimo-accent")
      const bgMuted = await token(page, "--kimo-bg-muted")
      const tertiary = await token(page, "--kimo-text-tertiary")
      const secondary = await token(page, "--kimo-text-secondary")
      const primary = await token(page, "--kimo-text-primary")
      const c = checker(ctx, "Agent panel A (RH3G0) + board 31 AgentStatus (qi4M9)")
      const m = await measure(page, {
        panel: "[data-testid=right-panel]",
        header: ".agent-panel__header",
        title: ".agent-panel__title",
        cost: ".agent-panel__cost",
        costLabel: ".agent-panel__cost-label",
        hist: ".agent-panel__header .kimo-icon-button",
        thread: "[data-testid=agent-thread]",
        userBubble: ".kimo-message--user .kimo-message__bubble",
        userText: ".kimo-message--user .kimo-message__text",
        turn: "[data-testid=agent-message]",
        agentRow: ".kimo-message--agent",
        mark: ".kimo-message--agent .kimo-agent-mark",
        agentBubble: ".kimo-message--agent .kimo-message__bubble",
        agentText: ".kimo-message--agent .kimo-message__text",
        toggle: "[data-testid=agent-steps-toggle]",
        toggleChevron: "[data-testid=agent-steps-toggle] .kimo-steps-toggle__chevron",
        toggleLabel: "[data-testid=agent-steps-toggle] .kimo-steps-toggle__label",
        meta: "[data-testid=agent-message-meta]",
        metaText: "[data-testid=agent-message-meta] .kimo-msg-meta__text",
        status: "[data-testid=agent-status]",
        statusMark: "[data-testid=agent-status] .kimo-agent-mark",
        statusBody: "[data-testid=agent-status] .kimo-agent-status__body",
        statusText: "[data-testid=agent-status] .kimo-agent-status__text",
        statusMeta: "[data-testid=agent-status] .kimo-agent-status__meta",
        elapsed: "[data-testid=agent-status] .kimo-agent-status__elapsed",
        sep: "[data-testid=agent-status] .kimo-agent-status__sep",
        steps: "[data-testid=agent-status] .kimo-agent-status__steps",
        follow: "[data-testid=agent-status] .kimo-agent-status__follow",
        followIcon: "[data-testid=agent-status] .kimo-agent-status__follow-icon",
        followLabel: "[data-testid=agent-status] .kimo-agent-status__follow-label",
        wrap: ".agent-panel__composer-wrap",
        comp: "[data-testid=agent-composer]",
        input: "[data-testid=agent-composer] textarea",
        bar: ".kimo-composer-agent__bar",
        attach: ".kimo-composer-agent__attach",
        skills: ".kimo-composer-agent__skills",
        mode: ".kimo-mode-chip",
        model: ".kimo-composer-agent__model",
        modelMark: ".kimo-composer-agent__model .kimo-agent-mark",
        modelLabel: ".kimo-composer-agent__model-label",
        send: ".kimo-composer-agent__send",
      })
      c.box("Right Panel", m.panel, { w: 360, h: 800 })
      c.box("Thread Header (w1BjvW)", m.header, { h: 44, gap: 8, pad: [0, 8, 0, 12] })
      c.check("Thread Header", "y = Tabs bottom", (m.header?.y ?? 0) - (m.panel?.y ?? 0), 37)
      c.box("Thread Title (fZQQo)", m.title, { fs: 12, fw: "600", lh: 15 })
      c.box("Session Cost (gPIkj)", m.cost, { h: 20, pad: [0, 7, 0, 7], radius: 999, bg: bgMuted })
      c.box("Session Cost › Label (OqgR2)", m.costLabel, { fs: 11, ff: "JetBrains Mono" })
      c.box("History (sVOXG)", m.hist, { w: 28, h: 28 })
      c.box("Thread (aCRfC)", m.thread, { gap: 12, pad: [16, 16, 16, 16], w: 360 })
      c.check("Thread", "y", (m.thread?.y ?? 0) - (m.panel?.y ?? 0), 81)
      c.box("Message/User › Bubble (s9lNfk)", m.userBubble, {
        w: 260,
        pad: [10, 14, 10, 14],
        radius: 16,
        bg: accent,
      })
      c.check(
        "Message/User",
        "right = thread right − 16",
        (m.userBubble?.x ?? 0) + (m.userBubble?.w ?? 0),
        (m.thread?.x ?? 0) + 360 - 16,
      )
      c.box("Message/User › Text (U0ugt)", m.userText, { fs: 13, lh: 19 })
      c.box("Agent Turn (O6NIQe)", m.turn, { gap: 8, w: 328 })
      c.box("Message/Agent (QqwyN)", m.agentRow, { gap: 10, w: 328 })
      c.box("Mark → AgentMark/24 (I3H68)", m.mark, { w: 24, h: 24 })
      c.box("Message/Agent › Bubble (Q285wt)", m.agentBubble, {
        pad: [10, 14, 10, 14],
        radius: 16,
        bg: bgMuted,
        w: 294,
      })
      c.box("Message/Agent › Text (U8u5Kz)", m.agentText, { fs: 13, lh: 20 })
      c.box("StepsToggle (RWTLi)", m.toggle, { gap: 4, pad: [0, 0, 0, 34] })
      c.box("StepsToggle › Chevron (pCl6G)", m.toggleChevron, { w: 12, h: 12, color: tertiary })
      c.box("StepsToggle › Label (q4g2Im)", m.toggleLabel, {
        fs: 11,
        fw: "500",
        lh: 13,
        color: tertiary,
      })
      c.check(
        "StepsToggle",
        "y = bubble bottom + 8",
        m.toggle?.y ?? 0,
        (m.agentBubble?.y ?? 0) + (m.agentBubble?.h ?? 0) + 8,
      )
      c.box("MessageMeta (S0S1S)", m.meta, { gap: 8, pad: [0, 0, 0, 34] })
      c.box("MessageMeta › Tokens (T5Zhsf)", m.metaText, {
        fs: 11,
        ff: "JetBrains Mono",
        color: tertiary,
      })
      c.box("AgentStatus (qi4M9)", m.status, { gap: 10, w: 328 })
      c.box("AgentStatus › Mark (C6V1t)", m.statusMark, { w: 24, h: 24 })
      c.box("AgentStatus › Body (XEBMm)", m.statusBody, { gap: 2 })
      c.box("AgentStatus › Status (fCmi9)", m.statusText, {
        fs: 13,
        fw: "500",
        lh: 16,
        color: primary,
      })
      c.box("AgentStatus › Meta (aQEF6)", m.statusMeta, { gap: 6 })
      c.box("AgentStatus › Elapsed (hKuC6)", m.elapsed, {
        fs: 11,
        ff: "JetBrains Mono",
        lh: 15,
        color: tertiary,
      })
      c.box("AgentStatus › Sep (RYf5K)", m.sep, { w: 3, h: 3, bg: tertiary })
      c.box("AgentStatus › Steps (lzQvF)", m.steps, { fs: 11, lh: 13, color: tertiary })
      c.box("AgentStatus › Follow (U7Zfmz)", m.follow, {
        h: 22,
        gap: 4,
        pad: [0, 8, 0, 6],
        radius: 999,
        bg: agentSoft,
      })
      c.box("Follow › Icon (PODho)", m.followIcon, { w: 12, h: 12, color: agent })
      c.box("Follow › Label (VODpi)", m.followLabel, { fs: 11, fw: "500", lh: 13, color: agent })
      c.check(
        "AgentStatus",
        "body width = 328 − 24 − follow − 2 × 10",
        m.statusBody?.w ?? 0,
        328 - 24 - (m.follow?.w ?? 0) - 20,
      )
      const statusText = await page
        .locator("[data-testid=agent-status] .kimo-agent-status__elapsed")
        .innerText()
      expect(/^\d+:\d\d$/.test(statusText), `elapsed clock m:ss, got ${statusText}`)
      // Hover meta: invisible (space kept) until the finished turn is hovered.
      const metaOpacity = () =>
        page.evaluate(
          () =>
            getComputedStyle(document.querySelector("[data-testid=agent-message-meta]") as Element)
              .opacity,
        )
      // The 120 ms opacity transition runs late on a loaded machine: wait for it to settle (up to
      // 2 s) instead of a fixed delay, then check the settled value.
      const metaSettles = (want: string) =>
        page
          .waitForFunction(
            (v) =>
              getComputedStyle(
                document.querySelector("[data-testid=agent-message-meta]") as Element,
              ).opacity === v,
            want,
            { timeout: 2000 },
          )
          .catch(() => undefined)
      await page.mouse.move(1200, 880)
      await metaSettles("0")
      c.check("MessageMeta", "opacity (not hovered)", await metaOpacity(), "0")
      await page.locator("[data-testid=agent-message]").first().hover()
      await metaSettles("1")
      c.check("MessageMeta", "opacity (turn hovered)", await metaOpacity(), "1")
      // Steps toggle: folded by default, opens on click (chevron-down, text-secondary).
      expect((await page.locator("[data-testid=agent-steps]").count()) === 0, "steps folded")
      await page.locator("[data-testid=agent-steps-toggle]").first().click()
      await page.locator("[data-testid=agent-steps]").first().waitFor()
      const opened = await measure(page, {
        label: "[data-testid=agent-steps-toggle] .kimo-steps-toggle__label",
        steps: "[data-testid=agent-steps]",
      })
      c.box("StepsToggle/Open › Label (fLKQc)", opened.label, { color: secondary })
      c.box("Steps", opened.steps, { gap: 8 })
      // Follow: one jump to the last landed layers.
      await page.locator("[data-testid=agent-status] .kimo-agent-status__follow").click()
      expect(
        await page.evaluate(
          () =>
            JSON.stringify(
              (window as unknown as { __m6: { followed: string[][] } }).__m6.followed,
            ) === JSON.stringify([["CtaRow0001"]]),
        ),
        "Follow zooms to the landed layer",
      )
      c.box("Composer Wrap (mt5k9)", m.wrap, { pad: [0, 12, 12, 12], w: 360 })
      c.check(
        "Composer Wrap",
        "bottom = panel bottom",
        (m.wrap?.y ?? 0) + (m.wrap?.h ?? 0),
        (m.panel?.y ?? 0) + 800,
      )
      c.box("Composer/Agent (Bry8p)", m.comp, {
        w: 336,
        gap: 10,
        pad: [12, 12, 10, 16],
        radius: 24,
      })
      c.box("Input (Jfb3E)", m.input, { fs: 13, lh: 16 })
      c.box("Bar (IYc3u)", m.bar, { gap: 4, w: 308 })
      c.box("Attach (x4agy)", m.attach, { w: 24, h: 24, radius: 6 })
      c.box("Skills (X2Uuj)", m.skills, { h: 24, gap: 4, pad: [0, 6, 0, 6] })
      c.box("Mode (SzC72)", m.mode, { h: 24, gap: 4, pad: [0, 8, 0, 6], bg: bgMuted })
      c.box("Model (KnAC9)", m.model, { gap: 4, pad: [2, 6, 2, 6] })
      c.box("Model › AgentMark/12 (P9Dzzb)", m.modelMark, { w: 12, h: 12 })
      c.box("Model › Label (H5ZJ9)", m.modelLabel, { fs: 11, color: tertiary })
      c.box("Send (fh2Ry)", m.send, { w: 28, h: 28, radius: 999, bg: accent })
      c.flush()
      if (ctx.shots) await page.screenshot({ path: join(ctx.shots, "m6-panel-a.png") })

      // Typing while streaming queues a follow-up; Stop aborts → Stopped card, queue dropped.
      await composer(page).fill("follow-up")
      await composer(page).press("Enter")
      // Board 33 §2: the queued message shows at once, muted, at the bottom of the thread.
      const queuedMsg = page.locator("[data-testid=agent-queued-message]")
      await queuedMsg.waitFor()
      expect((await queuedMsg.innerText()).startsWith("follow-up"), "queued text")
      await page.locator(".kimo-composer-agent__send--stop").click()
      await idle(page)
      expect((await queuedMsg.count()) === 0, "Stop drops the queue")
      const card = page.locator("[data-testid=agent-error-card]")
      await card.waitFor()
      expect((await card.getAttribute("data-kind")) === "stopped", "Stopped card")
      expect(
        (await card.locator(".kimo-button__label").allInnerTexts()).join("|") ===
          "Undo turn|Continue",
        "Stopped actions",
      )
      // Meta under turn 1, regenerate only on the last finished turn, steps of the live turn.
      // Board 31: new tokens only; the split is the tokens cell's tooltip.
      const metaTokens = page.locator("[data-testid=agent-message-meta] [data-part=tokens]").first()
      expect((await metaTokens.innerText()).endsWith(" new tokens"), "meta tokens")
      expect(
        ((await metaTokens.getAttribute("title")) ?? "").includes("new input +"),
        "meta tokens tooltip",
      )
      await page.locator("[data-testid=agent-message-meta]").first().hover()
      await page.getByRole("button", { name: "Copy" }).first().click()
      expect(await page.evaluate(() => (window as unknown as M6).__m6.copied.length === 1), "copy")
      const title = await page.locator("[data-testid=agent-thread-title]").innerText()
      expect(title === "Warm up the hero", `title named by the fast model: ${title}`)
    },
  },
  {
    name: "m6-agent: panel B — sessions list + measured",
    async run(ctx) {
      const { page } = ctx
      await open(ctx)
      await send(page, "Make the hero warm")
      await idle(page)
      await page.getByRole("button", { name: "New session" }).click()
      await send(page, "Rewrite the hero copy")
      await idle(page)
      await page.getByRole("button", { name: "History" }).click()
      await page.locator("[data-testid=agent-sessions]").waitFor()
      await page.waitForFunction(() => document.querySelectorAll(".kimo-session-row").length === 2)
      const bgMuted = await token(page, "--kimo-bg-muted")
      const tertiary = await token(page, "--kimo-text-tertiary")
      const border = await token(page, "--kimo-border")
      const c = checker(ctx, "Session history B (J7bfOc)")
      const m = await measure(page, {
        panel: "[data-testid=right-panel]",
        title: ".agent-panel__title",
        active: ".agent-panel__header .kimo-icon-button--active",
        list: "[data-testid=agent-sessions]",
        search: ".agent-sessions__search",
        input: ".agent-sessions__search .kimo-input",
        group: ".agent-sessions__group",
        row: ".kimo-session-row--current",
        rowTop: ".kimo-session-row--current .kimo-session-row__top",
        rowTitle: ".kimo-session-row--current .kimo-session-row__title",
        rowTime: ".kimo-session-row--current .kimo-session-row__time",
        rowMeta: ".kimo-session-row--current .kimo-session-row__meta",
        footer: ".agent-sessions__footer",
        footerIcon: ".agent-sessions__footer-icon",
        footerLabel: ".agent-sessions__footer-label",
      })
      expect((await page.locator(".agent-panel__title").innerText()) === "Sessions", "title")
      c.box("History (EMuFX IconButton/Active)", m.active, { w: 28, h: 28 })
      c.box("Session List (zJTW2)", m.list, { gap: 2, pad: [4, 8, 8, 8], w: 360 })
      c.check(
        "Session List",
        "bottom = panel bottom",
        (m.list?.y ?? 0) + (m.list?.h ?? 0),
        (m.panel?.y ?? 0) + 800,
      )
      c.box("Search Wrap (yO7ir)", m.search, { pad: [0, 4, 8, 4], w: 344 })
      c.box("Search (iSaHq Input)", m.input, { h: 32, w: 336 })
      c.box("Group (EnXFb)", m.group, { fs: 11, fw: "500", lh: 13, color: tertiary })
      c.box("SessionRow current (uCPJ5)", m.row, {
        gap: 2,
        pad: [8, 10, 8, 10],
        radius: 10,
        bg: bgMuted,
        w: 344,
      })
      c.box("Top (txgCM)", m.rowTop, { gap: 8, w: 324 })
      c.box("Title (T8AH3h)", m.rowTitle, { fs: 12, fw: "500", lh: 15 })
      c.box("Time (oBUYd)", m.rowTime, { fs: 11, color: tertiary })
      c.box("Meta (D6w4a)", m.rowMeta, { fs: 11, ff: "JetBrains Mono", color: tertiary })
      c.box("Footer (LMBEG)", m.footer, { gap: 6, pad: [8, 4, 0, 4] })
      c.check("Footer", "top stroke", m.footer?.border, `1px ${border}`)
      c.box("Footer › Icon (V4hp6) hard-drive", m.footerIcon, { w: 12, h: 12 })
      c.box("Footer › Label (m0ECp)", m.footerLabel, { fs: 11, color: tertiary })
      c.flush()
      if (ctx.shots) await page.screenshot({ path: join(ctx.shots, "m6-panel-b.png") })
      const metas = await page.locator(".kimo-session-row__meta").allInnerTexts()
      expect(
        metas.every((t) => /^Opus 5\.5 · \d+ messages · \$/.test(t)),
        `row meta: ${metas.join(" / ")}`,
      )
      // Search by content, then open the older session.
      await page.getByRole("textbox", { name: "Search sessions" }).fill("warm")
      await page.waitForFunction(() => document.querySelectorAll(".kimo-session-row").length === 1)
      await page.locator(".kimo-session-row").first().click()
      await page.locator("[data-testid=agent-thread]").waitFor()
      expect(
        (await page.locator("[data-testid=agent-thread-title]").innerText()) === "Warm up the hero",
        "opened session",
      )
    },
  },
  {
    name: "m6-agent: panel C — model picker + measured",
    async run(ctx) {
      const { page } = ctx
      await open(ctx)
      await page.locator(".kimo-composer-agent__model").click()
      const menu = page.locator("[data-testid=agent-model-menu]")
      await menu.waitFor()
      const overlay = await token(page, "--kimo-bg-overlay")
      const hover = await token(page, "--kimo-bg-hover")
      const tertiary = await token(page, "--kimo-text-tertiary")
      const c = checker(ctx, "Model picker C (r6eAFo › XxdJv)")
      const m = await measure(page, {
        panel: "[data-testid=right-panel]",
        wrap: ".agent-panel__composer-wrap",
        comp: "[data-testid=agent-composer]",
        menu: "[data-testid=agent-model-menu]",
        group: "[data-testid=agent-model-menu] .agent-menu__group",
        groupLabel: "[data-testid=agent-model-menu] .agent-menu__group-label",
        status: "[data-testid=agent-model-menu] .agent-menu__group-status",
        checked: "[data-testid=agent-model-menu] [aria-checked=true]",
        meta: "[data-testid=agent-model-menu] [aria-checked=true] .kimo-menu-item-dense__meta",
        effort: ".agent-menu__effort",
        effortLabel: ".agent-menu__effort-label",
        seg: ".agent-menu__effort .kimo-seg-text__segment",
        segLabel: ".agent-menu__effort .kimo-seg-text__label",
        modelOpen: ".kimo-composer-agent__model--open",
        modelOpenLabel: ".kimo-composer-agent__model--open .kimo-composer-agent__model-label",
      })
      c.box("Model Menu (XxdJv)", m.menu, {
        w: 280,
        gap: 1,
        pad: [4, 4, 4, 4],
        radius: 16,
        bg: overlay,
      })
      c.check("Model Menu", "x = panel x + 68", (m.menu?.x ?? 0) - (m.panel?.x ?? 0), 68)
      c.check(
        "Model Menu",
        "bottom = composer wrap top − 4",
        (m.menu?.y ?? 0) + (m.menu?.h ?? 0),
        (m.wrap?.y ?? 0) - 4,
      )
      c.box("Group · Anthropic (zMLnz)", m.group, { gap: 6, pad: [6, 8, 2, 8] })
      c.box("Group label (PvAr4)", m.groupLabel, { fs: 11, fw: "500", color: tertiary })
      c.box("Status 'default' (y0GYY)", m.status, { fs: 11, color: tertiary })
      c.box("Model · Claude Opus 5.5 (zTZCq)", m.checked, { h: 28, bg: hover })
      c.box("role tag 'agent' (T4CD1)", m.meta, { fs: 11, ff: "JetBrains Mono" })
      c.box("Effort (e9Njhu)", m.effort, { gap: 8, pad: [4, 8, 4, 8] })
      c.box("Thinking (h5wcjY)", m.effortLabel, { fs: 12 })
      c.box("Effort segment (mgJRy override)", m.seg, { h: 20, pad: [0, 8, 0, 8] })
      c.box("Effort label", m.segLabel, { fs: 11 })
      c.box("Composer Model open (U4mrI KnAC9)", m.modelOpen, { radius: 999 })
      c.flush()
      if (ctx.shots) await page.screenshot({ path: join(ctx.shots, "m6-panel-c.png") })
      const groups = await menu.locator(".agent-menu__group-label").allInnerTexts()
      expect(groups.join("|") === "Anthropic|Google Gemini", `groups: ${groups.join("|")}`)
      expect(
        (await menu.locator(".agent-menu__add").innerText()).includes("Add a key to use Gemini…"),
        "add-a-key row",
      )
      await menu.getByRole("menuitemradio", { name: /Claude Haiku 4.5/ }).click()
      expect(
        (await page.locator(".kimo-composer-agent__model-label").innerText()) === "Haiku 4.5",
        "picked",
      )
    },
  },
  {
    name: "m6-agent: panel D — skills menu, attachments, skill used + measured",
    async run(ctx) {
      const { page } = ctx
      await open(ctx)
      await page.evaluate(() =>
        (window as unknown as M6).__m6.controller.setSelection([
          { id: "Hero000001", name: "Hero" },
          { id: "CtaRow0001", name: "CTA Row" },
        ]),
      )
      await composer(page).fill("/")
      const menu = page.locator("[data-testid=agent-skills-menu]")
      await menu.waitFor()
      const bgMuted = await token(page, "--kimo-bg-muted")
      const c = checker(ctx, "Skills & attachments D (gVw5S › e2cwq)")
      const m = await measure(page, {
        panel: "[data-testid=right-panel]",
        wrap: ".agent-panel__composer-wrap",
        menu: "[data-testid=agent-skills-menu]",
        row: "[data-testid=agent-skills-menu] .kimo-skill-row",
        tile: "[data-testid=agent-skills-menu] .kimo-skill-row__tile",
        name: "[data-testid=agent-skills-menu] .kimo-skill-row__name",
        source: "[data-testid=agent-skills-menu] .kimo-skill-row__source",
        toggle: "[data-testid=agent-skills-menu] .kimo-toggle",
        footer: ".agent-menu__footer",
        hint: ".agent-menu__hint",
        skillsOpen: ".kimo-composer-agent__skills--open",
        chips: ".kimo-composer-agent__attachments",
        chip: ".kimo-attach-chip",
        chipLabel: ".kimo-attach-chip__label",
      })
      c.box("Skills Menu (e2cwq)", m.menu, { w: 336, gap: 1, pad: [4, 4, 4, 4], radius: 16 })
      c.check("Skills Menu", "x = panel x + 12", (m.menu?.x ?? 0) - (m.panel?.x ?? 0), 12)
      c.check(
        "Skills Menu",
        "bottom = composer wrap top − 4",
        (m.menu?.y ?? 0) + (m.menu?.h ?? 0),
        (m.wrap?.y ?? 0) - 4,
      )
      c.box("SkillRow (TEEsL)", m.row, { gap: 10, pad: [6, 8, 6, 8], radius: 6 })
      c.box("Tile (EAVaJ)", m.tile, { w: 28, h: 28, bg: bgMuted, radius: 6 })
      c.box("Name (z3KtI1)", m.name, { fs: 12, fw: "500" })
      c.box("Source (sOw2b)", m.source, { fs: 11, ff: "JetBrains Mono" })
      c.box("Toggle (E7PJk)", m.toggle, { w: 28, h: 16 })
      c.box("Footer (OIg0k)", m.footer, { gap: 4, pad: [2, 4, 2, 4] })
      c.box("Hint (bw2tP)", m.hint, { fs: 11, ff: "JetBrains Mono" })
      c.box("Skills open (X2Uuj override)", m.skillsOpen, { bg: bgMuted })
      c.box("Attachments (FLTbw)", m.chips, { gap: 6 })
      c.box("AttachmentChip (DwwpT)", m.chip, {
        pad: [2, 6, 2, 8],
        gap: 4,
        radius: 999,
        bg: bgMuted,
      })
      c.box("Label (UfluG)", m.chipLabel, { fs: 11, fw: "500" })
      c.flush()
      if (ctx.shots) await page.screenshot({ path: join(ctx.shots, "m6-panel-d.png") })
      // Enter inserts the first match; the user message keeps chips; "Using …" shows the skills.
      await composer(page).fill("/brand")
      await composer(page).fill("/kimo-lay")
      await composer(page).press("Enter")
      expect((await composer(page).inputValue()) === "/kimo-layout ", "inserted /name")
      await composer(page).type("rewrite the hero copy")
      await composer(page).press("Enter")
      await idle(page)
      const used = page.locator("[data-testid=agent-skill-used]")
      expect(
        (await used.innerText()) === "Using kimo-design · kimo-layout",
        `skill used: ${await used.innerText()}`,
      )
      const s = checker(ctx, "Thread D (w9jPO8): attachments + Skill Used (f7ZEFP)")
      const sm = await measure(page, {
        att: ".agent-panel__user-attachments",
        used: "[data-testid=agent-skill-used]",
        usedIcon: ".agent-panel__skill-used-icon",
        usedLabel: ".agent-panel__skill-used-label",
      })
      s.box("User Attachments (Y3Px0)", sm.att, { gap: 6 })
      s.box("Skill Used (f7ZEFP)", sm.used, { gap: 6, pad: [6, 0, 0, 34] })
      s.box("Icon (KUwap) book-open 12", sm.usedIcon, { w: 12, h: 12 })
      s.box("Label (IJruc)", sm.usedLabel, {
        fs: 11,
        fw: "500",
        color: await token(page, "--kimo-agent"),
      })
      s.flush()
      expect(
        (await page.locator(".agent-panel__user-attachments .kimo-attach-chip").count()) === 2,
        "chips persist on the user message",
      )
    },
  },
  {
    name: "m6-agent: E — error cards inline (auth, rate limit) + measured",
    async run(ctx) {
      const { page } = ctx
      await open(ctx)
      await send(page, "auth please")
      await idle(page)
      const card = page.locator("[data-testid=agent-error-card]")
      await card.waitFor()
      const dangerSoft = await token(page, "--kimo-danger-soft")
      const danger = await token(page, "--kimo-danger")
      const c = checker(ctx, "AgentErrorCard (Ny3kQ) · Invalid key (pVrK4)")
      const m = await measure(page, {
        indent: ".agent-panel__indent",
        card: "[data-testid=agent-error-card]",
        head: ".kimo-error-card__head",
        icon: ".kimo-error-card__icon",
        title: ".kimo-error-card__title",
        desc: ".kimo-error-card__desc",
        actions: ".kimo-error-card__actions",
        primary: ".kimo-error-card__actions .kimo-button--secondary",
        ghost: ".kimo-error-card__actions .kimo-button--ghost",
      })
      c.box("Indent (M9tWS)", m.indent, { pad: [0, 0, 0, 34] })
      c.box("AgentErrorCard", m.card, { gap: 8, pad: [10, 12, 10, 12], radius: 16, bg: dangerSoft })
      c.box("Head (mRIVx)", m.head, { gap: 8 })
      c.box("Icon (Q3ljkL) key-round", m.icon, { w: 14, h: 14, color: danger })
      c.box("Title (d8jH5P)", m.title, { fs: 12, fw: "600" })
      c.box("Desc (k92b6e)", m.desc, { fs: 11, lh: 16 })
      c.box("Actions (NJWqF)", m.actions, { gap: 6 })
      c.box("Primary (Y6rYtR Button/Secondary)", m.primary, { h: 26, pad: [0, 10, 0, 10], fs: 12 })
      c.box("Secondary (KvKC7 Button/Ghost)", m.ghost, { h: 26, pad: [0, 10, 0, 10] })
      c.flush()
      expect(
        (await card.locator(".kimo-error-card__title").innerText()) ===
          "Anthropic rejected the API key",
        "auth title",
      )
      expect(
        (await card.locator(".kimo-button__label").allInnerTexts()).join("|") ===
          "Open settings|Retry",
        "auth actions",
      )
      // Rate limit: warning card while backing off, then the turn finishes and it clears.
      await send(page, "rate me")
      const rl = page.locator("[data-testid=agent-error-card][data-kind=rate_limit]")
      await rl.waitFor()
      const warningSoft = await token(page, "--kimo-warning-soft")
      const w = checker(ctx, "AgentErrorCard · Rate limited (vu4y7)")
      const wm = await measure(page, {
        card: "[data-testid=agent-error-card][data-kind=rate_limit]",
        icon: "[data-kind=rate_limit] .kimo-error-card__icon",
      })
      w.box("Rate limited card", wm.card, { bg: warningSoft })
      w.box("Icon timer", wm.icon, { color: await token(page, "--kimo-warning") })
      w.flush()
      expect(
        (await rl.locator(".kimo-error-card__title").innerText()).startsWith(
          "Rate limited · retrying in",
        ),
        "retry title",
      )
      await idle(page)
      expect((await rl.count()) === 0, "card clears after the retry succeeds")
      if (ctx.shots) await page.screenshot({ path: join(ctx.shots, "m6-errors.png") })
    },
  },
  {
    name: "m6-agent: modes — mode menu + measured",
    async run(ctx) {
      const { page } = ctx
      await open(ctx)
      await page.locator(".kimo-mode-chip").click()
      const menu = page.locator("[data-testid=agent-mode-menu]")
      await menu.waitFor()
      await menu.locator('[data-mode="side-by-side"]').click()
      const agentSoft = await token(page, "--kimo-agent-soft")
      const c = checker(ctx, "Mode Menu (d5X1eG) + ModeChip (qBbwC)")
      const m = await measure(page, {
        wrap: ".agent-panel__composer-wrap",
        menu: "[data-testid=agent-mode-menu]",
        opt: '[data-testid=agent-mode-menu] [data-mode="side-by-side"]',
        tile: '[data-mode="side-by-side"] .kimo-mode-option__tile',
        name: '[data-mode="side-by-side"] .kimo-mode-option__name',
        desc: '[data-mode="side-by-side"] .kimo-mode-option__desc',
        check: '[data-mode="side-by-side"] .kimo-mode-option__check',
        config: ".agent-menu__config",
        stepper: ".agent-stepper",
        value: ".agent-stepper__value",
        cap: ".agent-menu__cap",
        select: ".agent-menu__select",
        chip: ".kimo-mode-chip",
      })
      c.box("Mode Menu", m.menu, { gap: 1, pad: [4, 4, 4, 4], radius: 16, w: 336 })
      c.check(
        "Mode Menu",
        "bottom = composer wrap top − 6",
        (m.menu?.y ?? 0) + (m.menu?.h ?? 0),
        (m.wrap?.y ?? 0) - 6,
      )
      c.box("ModeOption (NIIY8)", m.opt, { gap: 10, pad: [8, 8, 8, 8], radius: 6 })
      c.box("Tile (xhNUb)", m.tile, { w: 28, h: 28, bg: agentSoft })
      c.box("Name (MTHEE)", m.name, { fs: 12, fw: "500" })
      c.box("Desc (qyR7W)", m.desc, { fs: 11, lh: 15 })
      c.box("Check (F9baR)", m.check, { w: 14, h: 14 })
      c.box("Config · Agents (sefVX)", m.config, { h: 32, gap: 8, pad: [0, 8, 0, 8] })
      c.box("Stepper (jDnWz)", m.stepper, { h: 24, gap: 2, pad: [0, 4, 0, 4], radius: 999 })
      c.box("Value (hqvvu)", m.value, { fs: 11, fw: "600", ff: "JetBrains Mono" })
      c.box("Cap (wYdvG)", m.cap, { fs: 11 })
      c.box("Select (pBhFA)", m.select, { w: 140 })
      c.box("ModeChip side by side (qBbwC)", m.chip, { h: 24, bg: agentSoft })
      c.flush()
      expect(
        (await page.locator(".kimo-mode-chip__label").innerText()) === "Side by side · 3",
        "chip copy",
      )
      if (ctx.shots) await page.screenshot({ path: join(ctx.shots, "m6-mode-menu.png") })
    },
  },
  {
    name: "m6-agent: AgentMark — one WebGL context, animated shader, reduced motion static + measured",
    async run(ctx) {
      const { page } = ctx
      await open(ctx, "marks")
      await page.waitForFunction(() => (window as unknown as M6).__m6.stats().frames > 20)
      const stats = await page.evaluate(() => (window as unknown as M6).__m6.stats())
      expect(stats.webgl, "WebGL available (SwiftShader)")
      expect(stats.contexts === 1, `one GL context for all marks: ${stats.contexts}`)
      expect(stats.marks >= 30, `marks registered: ${stats.marks}`)
      // Body pixels: the centre is opaque, the corner transparent, and a working mark moves.
      const sample = () =>
        page.evaluate(() => {
          const c = document.querySelector(
            "[data-testid=mark-32-working] .kimo-agent-mark__body",
          ) as HTMLCanvasElement
          const ctx = c.getContext("2d") as CanvasRenderingContext2D
          const mid = ctx.getImageData(
            Math.floor(c.width * 0.3),
            Math.floor(c.height * 0.3),
            1,
            1,
          ).data
          const corner = ctx.getImageData(0, 0, 1, 1).data
          return { mid: Array.from(mid), corner: Array.from(corner), w: c.width }
        })
      const a = await sample()
      await page.waitForTimeout(700)
      const b = await sample()
      expect((a.mid[3] ?? 0) > 200, `centre opaque: ${a.mid}`)
      expect(a.corner[3] === 0, `corner transparent: ${a.corner}`)
      expect(a.mid.join() !== b.mid.join(), `working body drifts: ${a.mid} → ${b.mid}`)
      const c = checker(ctx, "AgentMark (ZkIvw) geometry")
      const m = await measure(page, {
        m32: "[data-testid=mark-32-idle]",
        eyeL32: "[data-testid=mark-32-idle] .kimo-agent-mark__eye",
        m24: "[data-testid=mark-24-working]",
        m12: "[data-testid=mark-12-idle]",
        eye12: "[data-testid=mark-12-idle] .kimo-agent-mark__eye",
        disc: "[data-testid=mark-32-disconnected]",
        summary: "[data-testid=agent-mode-summary]",
        pass: ".agent-pass-chip",
        scope: ".kimo-scope-tag",
        cursorPill: ".agent-cursor__pill",
        rejected: ".agent-rejected",
      })
      c.box("AgentMark 32 (QofdJ)", m.m32, { w: 32, h: 32 })
      c.check("Eye L (F6TCU)", "x", (m.eyeL32?.x ?? 0) - (m.m32?.x ?? 0), 9.92, 0.1)
      c.check("Eye L (F6TCU)", "y", (m.eyeL32?.y ?? 0) - (m.m32?.y ?? 0), 11.2, 0.1)
      c.check("Eye L (F6TCU)", "w", m.eyeL32?.w ?? 0, 3.84, 0.1)
      c.check("Eye L (F6TCU)", "h", m.eyeL32?.h ?? 0, 7.68, 0.1)
      c.box("AgentMark/24/Working (whSu1)", m.m24, { w: 24, h: 24 })
      c.box("AgentMark/12/Idle (ull8K)", m.m12, { w: 12, h: 12 })
      c.check("Eye L (tr6Rv) dot", "w", m.eye12?.w ?? 0, 2.5, 0.1)
      c.check(
        "Disconnected",
        "opacity",
        await page.evaluate(
          () =>
            getComputedStyle(
              document.querySelector("[data-testid=mark-32-disconnected]") as Element,
            ).opacity,
        ),
        "0.5",
      )
      c.box("Mode Summary (jDKaM)", m.summary, { h: 28, gap: 8, pad: [0, 10, 0, 6], radius: 999 })
      c.box("Pass Chip (NCElh)", m.pass, { h: 22, gap: 5, pad: [0, 8, 0, 6] })
      c.box("ScopeTag (NKE7Z)", m.scope, {
        h: 20,
        gap: 4,
        pad: [0, 7, 0, 5],
        radius: 4,
        bg: await token(page, "--kimo-agent-iris"),
      })
      c.box("Cursor Pill (kKdIW)", m.cursorPill, {
        gap: 6,
        pad: [4, 10, 4, 4],
        bg: await token(page, "--kimo-agent-iris"),
      })
      c.box("Rejected Op (O2Whh)", m.rejected, {
        h: 24,
        gap: 6,
        pad: [0, 10, 0, 8],
        bg: await token(page, "--kimo-danger"),
      })
      c.flush()
      if (ctx.shots) await page.screenshot({ path: join(ctx.shots, "m6-marks.png") })
      // Reduced motion: every body is the static mesh; nothing animates.
      await page.emulateMedia({ reducedMotion: "reduce" })
      await page.reload()
      await page.waitForFunction(() => !!(window as unknown as M6).__m6)
      await page.waitForTimeout(300)
      const rm = await page.evaluate(() => (window as unknown as M6).__m6.stats())
      expect(rm.reducedMotion && rm.animated === 0, `reduced motion static: ${JSON.stringify(rm)}`)
      const px = await page.evaluate(() => {
        const c = document.querySelector(
          "[data-testid=mark-32-idle] .kimo-agent-mark__body",
        ) as HTMLCanvasElement
        return Array.from(
          (c.getContext("2d") as CanvasRenderingContext2D).getImageData(
            c.width / 2,
            c.height / 2,
            1,
            1,
          ).data,
        )
      })
      expect((px[3] ?? 0) === 255, `static mesh painted: ${px}`)
    },
  },
  {
    name: "m6-agent: modes run — side by side plan, split rejection, iterate review + measured",
    async run(ctx) {
      const { page } = ctx
      await open(ctx)
      const ctl = () => (window as unknown as M6).__m6.controller
      // Side by side · 2 next to Pricing.
      await page.evaluate(() => {
        const c = (window as unknown as M6).__m6.controller as unknown as {
          setSelection(i: { id: string; name: string }[]): void
          setMode(m: Record<string, unknown>): void
          state: { composer: { mode: Record<string, unknown> } }
        }
        c.setSelection([{ id: "Pricing0001", name: "Pricing" }])
        c.setMode({ ...c.state.composer.mode, mode: "side-by-side", agents: 2 })
      })
      void ctl
      await send(page, "Pricing section, 3 tiers")
      await idle(page)
      const plan = page.locator("[data-testid=agent-plan]")
      await plan.waitFor()
      const irisSoft = await token(page, "--kimo-agent-iris-soft")
      const iris = await token(page, "--kimo-agent-iris")
      const border = await token(page, "--kimo-border")
      const c = checker(ctx, "Plan card (board 24 GmEAl tiORC) · side by side")
      const m = await measure(page, {
        plan: "[data-testid=agent-plan]",
        head: ".agent-plan__head",
        icon: ".agent-plan__icon",
        title: ".agent-plan__title",
        cost: ".agent-plan__cost",
        row: ".agent-plan__agent[data-persona=iris]",
        mark: ".agent-plan__agent[data-persona=iris] .kimo-agent-mark",
        text: ".agent-plan__agent[data-persona=iris] .agent-plan__text",
        nameRow: ".agent-plan__agent[data-persona=iris] .agent-plan__name-row",
        name: ".agent-plan__agent[data-persona=iris] .agent-plan__name",
        scope: ".agent-plan__agent[data-persona=iris] .agent-plan__scope",
        scopeIcon: ".agent-plan__agent[data-persona=iris] .agent-plan__scope-icon",
        meta: ".agent-plan__agent[data-persona=iris] .agent-plan__meta",
        keep: ".agent-plan__agent[data-persona=iris] .kimo-button--primary",
        log: ".agent-plan__log",
        op: ".agent-op-log",
        chip: ".agent-op-log__chip",
      })
      c.box("Split Plan frame (tiORC)", m.plan, { radius: 16, w: 328 })
      c.box("Head (N1Shb)", m.head, { gap: 8, pad: [12, 14, 12, 14] })
      c.check("Head", "bottom stroke", m.head?.borderB, `1px ${border}`)
      c.box("Icon (dGQe8) layout-grid", m.icon, { w: 14, h: 14 })
      c.box("Title (X8Rlq)", m.title, { fs: 12, fw: "600" })
      c.box("Cost (fJRaJ)", m.cost, { fs: 11, ff: "JetBrains Mono" })
      c.box("Agent row (Q5v37)", m.row, { gap: 10, pad: [10, 14, 10, 14] })
      c.box("AgentMark 24 · Iris (jg5yg)", m.mark, { w: 24, h: 24 })
      c.box("Text (fKcsf)", m.text, { gap: 2 })
      c.box("Name Row (U3GHT)", m.nameRow, { gap: 6 })
      c.box("Name (oVTvZ)", m.name, { fs: 12, fw: "500" })
      c.box("Scope Badge (ayzVT)", m.scope, {
        h: 18,
        gap: 3,
        pad: [0, 6, 0, 4],
        radius: 4,
        bg: irisSoft,
        color: iris,
      })
      c.box("Scope icon (YoCkJ) lock", m.scopeIcon, { w: 10, h: 10 })
      c.box("Meta (p1TH9)", m.meta, { fs: 11, ff: "JetBrains Mono" })
      c.box("Keep (v4e6g Button/Primary h 26)", m.keep, { h: 26, pad: [0, 10, 0, 10] })
      c.box("Log (bZSsS)", m.log, { pad: [6, 0, 6, 0] })
      c.box("Op row (B6L1P)", m.op, { gap: 8, pad: [5, 12, 5, 12] })
      c.box("Op chip (NopAC)", m.chip, { w: 52, h: 18, radius: 4, bg: irisSoft })
      c.flush()
      expect(
        (await plan.locator(".agent-plan__name").allInnerTexts()).join("|") === "Agent 1|Agent 2",
        "two variant agents",
      )
      if (ctx.shots) await page.screenshot({ path: join(ctx.shots, "m6-side-by-side.png") })
      await plan
        .locator(".agent-plan__agent[data-persona=violet]")
        .getByRole("button", { name: "Discard" })
        .click()
      await page.waitForFunction(
        () =>
          document.querySelector(".agent-plan__agent[data-persona=violet] .agent-status__label")
            ?.textContent === "Discarded",
      )

      // Split: the lead spawns 2 children; Agent 1 leaves its scope → rejected, logged in iris.
      await page.getByRole("button", { name: "New session" }).click()
      await page.evaluate(() => {
        const c = (window as unknown as M6).__m6.controller as unknown as {
          setSelection(i: { id: string; name: string }[]): void
          setMode(m: Record<string, unknown>): void
          state: { composer: { mode: Record<string, unknown> } }
        }
        c.setSelection([])
        c.setMode({ ...c.state.composer.mode, mode: "split", agents: 3 })
      })
      await send(page, "Build the landing page")
      await idle(page)
      const reject = page.locator(".agent-op-log--reject")
      await reject.waitFor()
      const dangerSoft = await token(page, "--kimo-danger-soft")
      const r = checker(ctx, "Split · rejected op row (R9Q8AS)")
      const rm = await measure(page, { chip: ".agent-op-log--reject .agent-op-log__chip" })
      r.box("Op chip reject (p8pPis)", rm.chip, { w: 52, h: 18, bg: dangerSoft })
      r.flush()
      expect(
        await page.evaluate(
          () => (window as unknown as M6).__m6.store.getNode("Navbar0001")?.name === "Navbar",
        ),
        "out-of-scope edit rolled back",
      )
      expect(
        (await page.locator(".agent-plan__name").allInnerTexts()).join("|") ===
          "Lead|Agent 1|Agent 2",
        "lead + children",
      )
      if (ctx.shots) await page.screenshot({ path: join(ctx.shots, "m6-split.png") })

      // Iterate: pass 1 → review card.
      await page.getByRole("button", { name: "New session" }).click()
      await page.evaluate(() => {
        const c = (window as unknown as M6).__m6.controller as unknown as {
          setSelection(i: { id: string; name: string }[]): void
          setMode(m: Record<string, unknown>): void
          state: { composer: { mode: Record<string, unknown> } }
        }
        c.setSelection([{ id: "Pricing0001", name: "Pricing" }])
        c.setMode({ ...c.state.composer.mode, mode: "iterate", passes: 3 })
      })
      await send(page, "Make Team feel premium")
      await idle(page)
      const review = page.locator("[data-testid=agent-review]")
      await review.waitFor()
      const agentSoft = await token(page, "--kimo-agent-soft")
      const bgSubtle = await token(page, "--kimo-bg-subtle")
      const v = checker(ctx, "Review Card (Vacqa)")
      const vm = await measure(page, {
        card: "[data-testid=agent-review]",
        head: ".agent-review__head",
        title: ".agent-review__title",
        sub: ".agent-review__sub",
        passes: ".agent-review__passes",
        current: ".agent-pass--current",
        future: ".agent-pass--future",
        changes: ".agent-review__changes",
        next: ".agent-review__next",
        steer: ".agent-review__steer",
        actions: ".agent-review__actions",
        run: ".agent-review__actions .kimo-button--primary",
      })
      v.box("Review Card", vm.card, { radius: 16 })
      v.box("Head (xKhWe)", vm.head, { gap: 10, pad: [12, 14, 12, 14] })
      v.box("Title (PByUm)", vm.title, { fs: 12, fw: "600" })
      v.box("Sub (n32JaR)", vm.sub, { fs: 11 })
      v.box("Passes (bB4Vd)", vm.passes, { gap: 8, pad: [10, 14, 10, 14] })
      v.box("Pass · current (FGXC0)", vm.current, {
        h: 24,
        gap: 5,
        pad: [0, 9, 0, 9],
        bg: agentSoft,
      })
      v.box("Pass · future (Pnx6G)", vm.future, { h: 24 })
      v.box("Changes (W1aLy)", vm.changes, { pad: [6, 0, 6, 0] })
      v.box("Next Pass (sQqnY)", vm.next, { gap: 8, pad: [10, 14, 14, 14] })
      v.box("Steer Field (dE1td)", vm.steer, {
        h: 32,
        pad: [0, 10, 0, 10],
        radius: 10,
        bg: bgSubtle,
        fs: 11,
      })
      v.box("Actions (aTicX)", vm.actions, { gap: 8 })
      v.box("Run pass 3 (Iq1ky Button/Primary h 30)", vm.run, { h: 30, pad: [0, 14, 0, 14] })
      v.flush()
      expect(
        (await review.locator(".agent-review__title").innerText()) === "Pass 1 ready for review",
        "review title",
      )
      expect((await review.locator(".agent-op-log").count()) === 2, "changes rows")
      if (ctx.shots) await page.screenshot({ path: join(ctx.shots, "m6-iterate.png") })
      await review.locator(".agent-review__steer").fill("less contrast on the button")
      await review.getByRole("button", { name: "Run pass 2" }).click()
      await page.waitForFunction(
        () =>
          document.querySelector(".agent-review__title")?.textContent === "Pass 2 ready for review",
        null,
        { timeout: 15_000 },
      )
      await review.getByRole("button", { name: "Original" }).click()
      await page.waitForFunction(
        () => (window as unknown as M6).__m6.store.getNode("Hero000001")?.name === "Hero",
      )
    },
  },
]
