/**
 * Board 40 "Composer bar and “…” menu" (desing.pen d5ZDH): §1 the bar at the 280 panel (board 44) (the
 * only width) with typical and longest content, §2 the "…" menu's rows and states, §3 the dot,
 * plus keyboard (menu roles, Escape returns focus). One measured getComputedStyle /
 * getBoundingClientRect pass per surface against the node values.
 */
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import type { Page } from "playwright"
import { build } from "vite"
import { checker, measure, token } from "./m6-helpers"
import { type E2EContext, expect, type Scenario } from "./run"

const here = dirname(fileURLToPath(import.meta.url))
const out = process.env.KIMO_E2E_OUTDIR ?? join(here, ".dist")
let built: Promise<string> | null = null

function harness(ctx: E2EContext) {
  if (process.env.KIMO_E2E_DEV === "1")
    return Promise.resolve(`${ctx.url}e2e/m6-agent-harness/index.html`)
  built ??= build({
    root: join(here, "m6-agent-harness"),
    configFile: false,
    base: "./",
    logLevel: "error",
    plugins: [react()],
    build: { outDir: join(out, "board40-m6"), emptyOutDir: true, target: "es2022" },
  }).then(() => "board40-m6/index.html")
  return built.then((p) => `${ctx.url}${p}`)
}

type M6 = {
  __m6: {
    controller: {
      state: {
        menu: string | null
        autoApprove: boolean
        webAccess: { on: boolean; disabled: string | null }
        modelLabel: string
      }
      refresh(): Promise<void>
      setModel(sel: { provider: string; model: string }): void
      setMode(cfg: Record<string, unknown>): void
    }
    web: { enabled: boolean; blocked: boolean }
  }
}

const MORE = "[data-testid=agent-more]"
const MENU = "[data-testid=agent-more-menu]"
const DOT = "[data-testid=agent-more-dot]"
const SKILLS = "[data-testid=agent-more-skills]"
const AUTO = "[data-testid=agent-more-auto]"
const WEB = "[data-testid=agent-more-web]"

/** `?chooser=a`: Claude Code (Sonnet 5.5) plus Anthropic, OpenAI, Gemini and Local connected. */
async function openPanel(ctx: E2EContext) {
  await ctx.page.setViewportSize({ width: 1440, height: 900 })
  await ctx.page.goto(`${await harness(ctx)}?scene=panel&chooser=a`)
  await ctx.page.waitForFunction(() => !!(window as unknown as M6).__m6)
  await ctx.page.evaluate(() => document.fonts.ready)
  await ctx.page.waitForFunction(
    () => (window as unknown as M6).__m6.controller.state.modelLabel === "Sonnet 5.5",
  )
}

const activeTestId = (page: Page) =>
  page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? null)

/** Overflow (scrollWidth − clientWidth) of the model and mode labels and of the bar. */
const overflow = (page: Page) =>
  page.evaluate(() => {
    const o = (s: string) => {
      const el = document.querySelector(s) as HTMLElement | null
      return el ? el.scrollWidth - el.clientWidth : Number.NaN
    }
    return {
      model: o(".kimo-composer-agent__model-label"),
      mode: o(".kimo-composer-agent__bar .kimo-mode-chip__label"),
      bar: o(".kimo-composer-agent__bar"),
    }
  })

const BAR = {
  panel: "[data-testid=right-panel]",
  comp: "[data-testid=agent-composer]",
  bar: ".kimo-composer-agent__bar",
  attach: ".kimo-composer-agent__attach",
  mode: ".kimo-composer-agent__bar .kimo-mode-chip",
  more: MORE,
  moreIcon: `${MORE} .kimo-icon-button__icon`,
  spacer: ".kimo-composer-agent__spacer",
  model: ".kimo-composer-agent__model",
  modelLabel: ".kimo-composer-agent__model-label",
  send: ".kimo-composer-agent__send",
}

export const scenarios: Scenario[] = [
  {
    name: "board40: bar at the 280 panel (board 44): typical and longest content, model name never cut + measured",
    async run(ctx) {
      const { page } = ctx
      await openPanel(ctx)
      const secondary = await token(page, "--kimo-text-secondary")
      const tertiary = await token(page, "--kimo-text-tertiary")

      // A · typical: Single, Sonnet 5.5.
      let m = await measure(page, BAR)
      let c = checker(ctx, "Board 40 §1 A · typical (l7ePQ)")
      c.box("Right Panel", m.panel, { w: 280 })
      c.box("Composer/Agent (QUDbw)", m.comp, { w: 256, pad: [12, 12, 10, 16] })
      c.box("Bar (zxfJw)", m.bar, { w: 228, gap: 4 })
      c.box("Attach (n2MGl)", m.attach, { w: 24, h: 24, radius: 6 })
      c.box("Mode (k2blfg)", m.mode, { w: 79, h: 24, pad: [0, 8, 0, 6] })
      c.box("IconButton · More (univs)", m.more, {
        w: 24,
        h: 24,
        radius: 6,
        bg: "rgba(0, 0, 0, 0)",
        color: secondary,
      })
      c.box("ellipsis (nd1MZ)", m.moreIcon, { w: 14, h: 14 })
      c.box("Model (bI3Qx)", m.model, { w: 100, gap: 4, pad: [2, 6, 2, 6], color: tertiary })
      c.box("Send (f4Gp1)", m.send, { w: 28, h: 28, radius: 999 })
      if (m.mode && m.more && m.attach && m.spacer && m.model && m.send && m.bar) {
        c.check("Bar", "Attach → Mode gap", m.mode.x - (m.attach.x + m.attach.w), 4)
        c.check("Bar", "Mode → More gap", m.more.x - (m.mode.x + m.mode.w), 4)
        c.check("Spacer (tkdmU)", "w", m.spacer.w, 33, 1.5)
        c.check("Bar", "Send right = bar right", m.send.x + m.send.w, m.bar.x + m.bar.w)
      }
      let o = await overflow(page)
      c.check("Model › Label", "overflow", o.model, 0)
      c.check("Mode › Label", "overflow", o.mode, 0)
      c.flush()
      if (ctx.shots)
        await page.locator(BAR.comp).screenshot({ path: join(ctx.shots, "board40-bar-a.png") })

      // B · longest in the catalog: Side by side · 3 with Gemini 2.5 Flash. The Mode label
      // gives way; the model name stays whole and nothing overflows the bar.
      await page.evaluate(() => {
        const ctl = (window as unknown as M6).__m6.controller
        ctl.setModel({ provider: "gemini", model: "gemini-2.5-flash" })
        ctl.setMode({ mode: "side-by-side", agents: 3, models: "same", explore: "both", passes: 3 })
      })
      await page.waitForFunction(
        () => (window as unknown as M6).__m6.controller.state.modelLabel === "Gemini 2.5 Flash",
      )
      m = await measure(page, BAR)
      o = await overflow(page)
      c = checker(ctx, "Board 40 §1 B · longest (qdOOP)")
      c.box("Bar (kJGh0)", m.bar, { w: 228 })
      c.box("IconButton · More (b6klYf)", m.more, { w: 24, h: 24 })
      c.box("Send (bayb3)", m.send, { w: 28, h: 28 })
      c.check("Model › Label", "overflow", o.model, 0)
      c.check("Bar", "overflow", o.bar, 0)
      expect(o.mode > 0, `the Mode label is the one cut (overflow ${o.mode})`)
      expect((m.mode?.w ?? 0) >= 46, `Mode keeps icon + chevron (w ${m.mode?.w})`)
      expect((m.model?.w ?? 0) >= 125, `Model chip keeps its full width (w ${m.model?.w})`)
      if (m.send && m.bar)
        c.check("Bar", "Send right = bar right", m.send.x + m.send.w, m.bar.x + m.bar.w)
      c.flush()
      ctx.log(
        `    B: mode ${Math.round(m.mode?.w ?? 0)}, model ${Math.round(m.model?.w ?? 0)}, spacer ${Math.round(m.spacer?.w ?? 0)}`,
      )
      if (ctx.shots)
        await page.locator(BAR.comp).screenshot({ path: join(ctx.shots, "board40-bar-b.png") })

      // A custom Local id past 120 px: the only case the model label gets an ellipsis.
      const long = "qwen2.5-coder:32b-instruct-q8_0-local"
      await page.evaluate(
        (id) =>
          (window as unknown as M6).__m6.controller.setModel({
            provider: "custom:ollama",
            model: id,
          }),
        long,
      )
      await page.waitForFunction(
        (id) => (window as unknown as M6).__m6.controller.state.modelLabel === id,
        long,
      )
      m = await measure(page, BAR)
      o = await overflow(page)
      c = checker(ctx, "Board 40 rule · Model chip cap")
      c.box("Model › Label", m.modelLabel, { w: 120 })
      c.check("Bar", "overflow", o.bar, 0)
      c.flush()
      expect(o.model > 0, "a long Local id is cut")
      expect(
        (await page.locator(BAR.model).getAttribute("title")) === long,
        "the full id is in the tooltip",
      )
    },
  },
  {
    name: "board40: “…” menu — rows reflect the session, dots, confirm, keyboard + measured",
    async run(ctx) {
      const { page } = ctx
      await openPanel(ctx)
      const primary = await token(page, "--kimo-text-primary")
      const secondary = await token(page, "--kimo-text-secondary")
      const tertiary = await token(page, "--kimo-text-tertiary")
      const bgMuted = await token(page, "--kimo-bg-muted")
      expect((await page.locator(DOT).count()) === 0, "defaults: no dot")
      expect((await page.locator(MORE).getAttribute("aria-expanded")) === "false", "closed")

      // Keyboard: Enter on "…" opens the menu and focuses Skills.
      await page.locator(MORE).focus()
      await page.keyboard.press("Enter")
      await page.locator(MENU).waitFor()
      expect((await activeTestId(page)) === "agent-more-skills", "opening focuses the first row")
      expect((await page.locator(MORE).getAttribute("aria-expanded")) === "true", "expanded")

      // C · default, measured.
      const m = await measure(page, {
        panel: "[data-testid=right-panel]",
        wrap: ".agent-panel__composer-wrap",
        comp: "[data-testid=agent-composer]",
        menu: MENU,
        skills: SKILLS,
        skillsIcon: `${SKILLS} .kimo-menu-item-dense__check svg`,
        skillsLabel: `${SKILLS} .kimo-menu-item-dense__label`,
        skillsMeta: `${SKILLS} .kimo-menu-item-dense__meta`,
        divider: `${MENU} .kimo-menu-divider`,
        auto: AUTO,
        autoIcon: `${AUTO} .kimo-menu-item-dense__check svg`,
        autoToggle: `${AUTO} .kimo-toggle`,
        web: WEB,
        webToggle: `${WEB} .kimo-toggle`,
        more: MORE,
      })
      let c = checker(ctx, "Board 40 §2 C · default (c79jYX)")
      c.box("More Menu (c79jYX)", m.menu, { w: 232, pad: [4, 4, 4, 4], gap: 1, radius: 16 })
      if (m.menu && m.panel && m.wrap && m.comp) {
        c.check("More Menu", "x = composer x", m.menu.x, m.comp.x)
        c.check("More Menu", "x = panel x + 12", m.menu.x - m.panel.x, 12)
        c.check("More Menu", "bottom = composer wrap top − 4", m.menu.y + m.menu.h, m.wrap.y - 4)
      }
      c.box("Item · Skills", m.skills, { w: 224, h: 28, gap: 8, pad: [0, 8, 0, 8], radius: 6 })
      c.box("Skills › book-open", m.skillsIcon, { w: 14, h: 14, color: secondary })
      c.box("Skills › Label", m.skillsLabel, { fs: 12, color: primary })
      c.box("Skills › Meta", m.skillsMeta, { fs: 11, ff: "JetBrains Mono", color: tertiary })
      c.box("Divider", m.divider, { h: 9, pad: [4, 8, 4, 8] })
      c.box("Item · Ask before changes", m.auto, { h: 28, gap: 8, pad: [0, 8, 0, 8] })
      c.box("Ask before changes › shield", m.autoIcon, { w: 14, h: 14, color: secondary })
      c.box("Toggle/Off (CSYQj)", m.autoToggle, { w: 28, h: 16 })
      c.box("Item · Web access", m.web, { h: 28 })
      c.box("Toggle/On (y893S)", m.webToggle, { w: 28, h: 16 })
      c.box("“…” open (z7Tv4)", m.more, { bg: bgMuted, color: primary })
      if (m.skillsMeta && m.skills)
        c.check(
          "Skills › Meta",
          "right inset",
          m.skills.x + m.skills.w - (m.skillsMeta.x + m.skillsMeta.w),
          8,
        )
      c.flush()
      const enabled = await page.evaluate(
        () =>
          (
            window as unknown as {
              __m6: { controller: { state: { skills: { enabled: string[] } } } }
            }
          ).__m6.controller.state.skills.enabled.length,
      )
      expect(
        (await page.locator(`${SKILLS} .kimo-menu-item-dense__meta`).innerText()) ===
          String(enabled),
        "Skills shows the enabled count",
      )
      if (ctx.shots) await page.screenshot({ path: join(ctx.shots, "board40-menu-c.png") })

      // ↑ ↓ Home End move through the enabled rows and wrap.
      await page.keyboard.press("ArrowDown")
      expect((await activeTestId(page)) === "agent-more-auto", "↓ → Ask before changes")
      await page.keyboard.press("ArrowDown")
      expect((await activeTestId(page)) === "agent-more-web", "↓ → Web access")
      await page.keyboard.press("ArrowDown")
      expect((await activeTestId(page)) === "agent-more-skills", "↓ wraps to Skills")
      await page.keyboard.press("End")
      expect((await activeTestId(page)) === "agent-more-web", "End → Web access")
      await page.keyboard.press("Home")
      expect((await activeTestId(page)) === "agent-more-skills", "Home → Skills")

      // E · Web access off with Enter: the menu stays, a text-secondary dot shows.
      await page.keyboard.press("End")
      await page.keyboard.press("Enter")
      await page.waitForFunction(
        () => !(window as unknown as M6).__m6.controller.state.webAccess.on,
      )
      expect((await page.locator(MENU).count()) === 1, "the menu stays open")
      expect((await page.locator(WEB).getAttribute("aria-checked")) === "false", "web off")
      let d = await measure(page, {
        dot: DOT,
        more: MORE,
        icon: `${WEB} .kimo-menu-item-dense__check svg`,
      })
      c = checker(ctx, "Board 40 §2 E · web access off / §3 Dot (L2xww)")
      c.box("Dot", d.dot, { w: 6, h: 6, bg: secondary })
      if (d.dot && d.more) {
        c.check("Dot", "x in “…”", d.dot.x - d.more.x, 16)
        c.check("Dot", "y in “…”", d.dot.y - d.more.y, 2)
      }
      c.flush()
      expect(
        /globe-x/.test((await page.locator(`${WEB} svg`).first().getAttribute("class")) ?? ""),
        "globe-x",
      )
      expect(
        (await page.locator(MORE).getAttribute("aria-label")) ===
          "More options (web access is off)",
        "“…” names the dot",
      )
      // Space turns it back on; the dot goes.
      await page.keyboard.press(" ")
      await page.waitForFunction(() => (window as unknown as M6).__m6.controller.state.webAccess.on)
      expect((await page.locator(DOT).count()) === 0, "web on again: no dot")

      // Escape closes and hands focus back to "…".
      await page.keyboard.press("Escape")
      expect((await page.locator(MENU).count()) === 0, "Escape closes")
      expect((await activeTestId(page)) === "agent-more", "focus returns to “…”")

      // D · Ask before changes on is immediate, the menu stays and it carries no dot.
      await page.locator(MORE).click()
      await page.locator(AUTO).click()
      await page.waitForFunction(() => !(window as unknown as M6).__m6.controller.state.autoApprove)
      expect((await page.locator(MENU).count()) === 1, "on: the menu stays open")
      d = await measure(page, { icon: `${AUTO} .kimo-menu-item-dense__check svg` })
      c = checker(ctx, "Board 40 §2 D · Ask before changes on (u0Zdm5)")
      c.box("Ask before changes › shield-check", d.icon, { w: 14, h: 14, color: secondary })
      c.flush()
      expect((await page.locator(AUTO).getAttribute("aria-checked")) === "true", "asking on")
      expect((await page.locator(DOT).count()) === 0, "no dot while asking")
      // Web off: the secondary dot.
      await page.locator(WEB).click()
      await page.waitForFunction(
        () => !(window as unknown as M6).__m6.controller.state.webAccess.on,
      )
      expect((await page.locator(DOT).getAttribute("data-dot")) === "secondary", "web off dot")
      if (ctx.shots) await page.screenshot({ path: join(ctx.shots, "board40-menu-d.png") })
      // Off again: trusted.
      await page.locator(AUTO).click()
      await page.waitForFunction(() => (window as unknown as M6).__m6.controller.state.autoApprove)
      await page.locator(WEB).click()
      await page.waitForFunction(() => (window as unknown as M6).__m6.controller.state.webAccess.on)

      // F · No third-party fetch: disabled row with its reason, no dot, skipped by the keyboard.
      await page.evaluate(async () => {
        const m6 = (window as unknown as M6).__m6
        m6.web.blocked = true
        await m6.controller.refresh()
      })
      await page.locator(`${WEB}[data-state=privacy]`).waitFor()
      const f = await measure(page, {
        label: `${WEB} .kimo-menu-item-dense__label`,
        icon: `${WEB} .kimo-menu-item-dense__check`,
        reason: "[data-testid=agent-more-reason]",
      })
      const op = await page.evaluate(
        (s) => Number(getComputedStyle(document.querySelector(s) as Element).opacity),
        `${WEB} .kimo-toggle`,
      )
      c = checker(ctx, "Board 40 §2 F · No third-party fetch (Cus7X)")
      c.box("Label", f.label, { color: tertiary })
      c.box("Icon Slot", f.icon, { color: tertiary })
      c.check("Toggle", "opacity", op, 0.45, 0.01)
      c.box("Reason", f.reason, { pad: [0, 8, 6, 30], fs: 11, color: tertiary })
      c.flush()
      expect(
        (await page.locator("[data-testid=agent-more-reason]").innerText()) ===
          "No third-party fetch is on",
        "the reason",
      )
      expect(
        /globe-lock/.test((await page.locator(`${WEB} svg`).first().getAttribute("class")) ?? ""),
        "globe-lock",
      )
      expect((await page.locator(DOT).count()) === 0, "blocked: no dot")
      await page.locator(SKILLS).focus()
      await page.keyboard.press("End")
      expect((await activeTestId(page)) === "agent-more-auto", "the disabled row is skipped")
      if (ctx.shots) await page.screenshot({ path: join(ctx.shots, "board40-menu-f.png") })
      await page.evaluate(async () => {
        const m6 = (window as unknown as M6).__m6
        m6.web.blocked = false
        await m6.controller.refresh()
      })

      // Skills opens the skills menu in place of this one; "…" stays open.
      await page.locator(SKILLS).click()
      await page.locator("[data-testid=agent-skills-menu]").waitFor()
      expect((await page.locator(MENU).count()) === 0, "the “…” menu gave way")
      expect((await page.locator(MORE).getAttribute("aria-expanded")) === "true", "“…” open")
      // "…" again closes the skills menu.
      await page.locator(MORE).click()
      await page.waitForFunction(
        () => (window as unknown as M6).__m6.controller.state.menu === null,
      )
    },
  },
]
