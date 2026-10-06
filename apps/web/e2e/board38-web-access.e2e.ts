/**
 * Board 38 "Web access" (desing.pen qPPXu): §1 the Allow web access row in Settings › AI
 * providers (on by default, dimmed and off while No third-party fetch is on), §2 the composer's
 * switch, now a row in the board 40 "…" menu (on, off for the session, blocked with its reason), §3 the web steps and the reply's
 * sources in the thread. One measured getComputedStyle / getBoundingClientRect pass per surface
 * against the node values.
 */
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import type { Page } from "playwright"
import { build } from "vite"
import { open } from "./m4-app.e2e"
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
    build: { outDir: join(out, "board38-m6-agent-harness"), emptyOutDir: true, target: "es2022" },
  }).then(() => "board38-m6-agent-harness/index.html")
  return built.then((p) => `${ctx.url}${p}`)
}

type M6 = {
  __m6: {
    controller: {
      state: {
        busy: boolean
        webAccess: { on: boolean; disabled: string | null }
        messages: { kind: string; steps?: { label: string; state: string }[] }[]
      }
      refresh(): Promise<void>
      setSelection(items: { id: string; name: string; type: string }[]): void
    }
    web: { enabled: boolean; blocked: boolean }
  }
}

async function openPanel(ctx: E2EContext) {
  await ctx.page.setViewportSize({ width: 1440, height: 900 })
  await ctx.page.goto(`${await harness(ctx)}?scene=panel`)
  await ctx.page.waitForFunction(() => !!(window as unknown as M6).__m6)
  await ctx.page.evaluate(() => document.fonts.ready)
}

/** Board 40: Web access is a switch row in the composer's "…" menu. */
const MORE = "[data-testid=agent-more]"
const W = "[data-testid=agent-more-web]"
const composer = (page: Page) => page.locator("[data-testid=agent-composer] textarea")

async function openMore(page: Page) {
  if ((await page.locator(W).count()) === 0) await page.locator(MORE).click()
  await page.locator(W).waitFor()
}

async function setWeb(page: Page, v: { enabled?: boolean; blocked?: boolean }) {
  await page.evaluate(async (next) => {
    const m = (window as unknown as M6).__m6
    Object.assign(m.web, next)
    await m.controller.refresh()
  }, v)
}

export const scenarios: Scenario[] = [
  {
    name: "board38: composer web access (board 40 “…” menu) — on by default, off for the session, blocked with a reason + measured",
    async run(ctx) {
      const { page } = ctx
      await openPanel(ctx)
      const secondary = await token(page, "--kimo-text-secondary")
      const tertiary = await token(page, "--kimo-text-tertiary")
      await openMore(page)
      expect((await page.locator(W).getAttribute("aria-checked")) === "true", "on by default")
      expect((await page.locator(W).getAttribute("data-state")) === "on", "state on")
      let m = await measure(page, {
        web: W,
        icon: `${W} .kimo-menu-item-dense__check svg`,
        toggle: `${W} .kimo-toggle`,
        auto: "[data-testid=agent-more-auto]",
      })
      let c = checker(ctx, "Board 38 §2 → board 40 “…” menu · A on")
      c.box("Item · Web access", m.web, { h: 28, gap: 8, pad: [0, 8, 0, 8], radius: 6 })
      c.box("Icon globe", m.icon, { w: 14, h: 14, color: secondary })
      c.box("Toggle/On (y893S)", m.toggle, { w: 28, h: 16 })
      if (m.auto && m.web)
        c.check("Items", "Auto-approve → Web access gap", m.web.y - (m.auto.y + m.auto.h), 1)
      c.flush()
      expect(
        (await page.locator("[data-testid=agent-more-dot]").count()) === 0,
        "on: no dot on “…”",
      )

      // Off for this session: globe-x, the menu stays open, a text-secondary dot on "…".
      await page.locator(W).click()
      await page.waitForFunction(
        () => !(window as unknown as M6).__m6.controller.state.webAccess.on,
      )
      expect((await page.locator(W).getAttribute("aria-checked")) === "false", "off: unchecked")
      expect((await page.locator(W).getAttribute("data-state")) === "off", "off: state off")
      m = await measure(page, { dot: "[data-testid=agent-more-dot]" })
      c = checker(ctx, "Board 38 §2 → board 40 · B off")
      c.box("“…” Dot (L2xww)", m.dot, { w: 6, h: 6, bg: secondary })
      c.flush()

      // No third-party fetch: the row is disabled with its reason; a click changes nothing.
      await setWeb(page, { blocked: true })
      await page.locator(`${W}[data-state=privacy]`).waitFor()
      const op = await page.evaluate(
        (s) => getComputedStyle(document.querySelector(`${s} .kimo-toggle`) as Element).opacity,
        W,
      )
      m = await measure(page, {
        label: `${W} .kimo-menu-item-dense__label`,
        reason: "[data-testid=agent-more-reason]",
      })
      c = checker(ctx, "Board 38 §2 → board 40 · F No third-party fetch")
      c.check("Toggle", "opacity", Number(op), 0.45, 0.01)
      c.box("Label", m.label, { color: tertiary })
      c.box("Reason", m.reason, { fs: 11, pad: [0, 8, 6, 30], color: tertiary })
      c.flush()
      expect(
        (await page.locator(W).getAttribute("aria-disabled")) === "true",
        "blocked: aria-disabled",
      )
      expect(
        (await page.locator("[data-testid=agent-more-reason]").innerText()) ===
          "No third-party fetch is on",
        "blocked: the reason is under the row",
      )
      expect((await page.locator("[data-testid=agent-more-dot]").count()) === 0, "blocked: no dot")
      await page.locator(W).click({ force: true })
      const after = await page.evaluate(
        () => (window as unknown as M6).__m6.controller.state.webAccess,
      )
      expect(!after.on && after.disabled === "privacy", "blocked: the click is ignored")
      await setWeb(page, { blocked: false })
    },
  },
  {
    name: "board38: thread — a search and a page read are steps; the reply lists its sources",
    async run(ctx) {
      const { page } = ctx
      await openPanel(ctx)
      await composer(page).fill("Find the current Tailwind v4 default font stack and use it")
      await composer(page).press("Enter")
      // Running: the step and the status line name the query.
      await page
        .getByText("Searching the web for “tailwind v4 fonts”", { exact: true })
        .first()
        .waitFor({ timeout: 5000 })
      await page.waitForFunction(
        () => !(window as unknown as M6).__m6.controller.state.busy,
        null,
        {
          timeout: 20_000,
        },
      )
      const steps = await page.evaluate(() =>
        (window as unknown as M6).__m6.controller.state.messages
          .filter((m) => m.kind === "agent")
          .flatMap((m) => m.steps ?? [])
          .map((s) => `${s.state} ${s.label}`),
      )
      expect(
        JSON.stringify(steps) ===
          JSON.stringify([
            "done Searched the web for “tailwind v4 fonts”",
            "done Read tailwindcss.com",
          ]),
        `steps: ${JSON.stringify(steps)}`,
      )
      const link = page.locator("a[href='https://tailwindcss.com/docs/font-family']").first()
      await link.waitFor()
      expect((await page.getByText("Sources:").count()) > 0, "the reply ends with its sources")
    },
  },
  {
    name: "board38: Settings › AI providers › Allow web access — on by default; No third-party fetch dims it + measured",
    async run(ctx) {
      const { page } = ctx
      await open(ctx, "#/settings/ai-providers")
      const R = "[data-testid=ai-web-access]"
      await page.locator(R).waitFor({ timeout: 10_000 })
      const sw = page.locator(`${R} [role=switch]`)
      expect((await sw.getAttribute("aria-checked")) === "true", "on by default")
      const primary = await token(page, "--kimo-text-primary")
      const secondary = await token(page, "--kimo-text-secondary")
      const m = await measure(page, {
        row: R,
        label: `${R} .kimo-setting-row__label`,
        desc: `${R} .kimo-setting-row__desc`,
        model: "[data-pen=WmFb2]",
      })
      const c = checker(ctx, "Board 38 §1 Setting · Allow web access (u2r7bC)")
      c.box("SettingRow (MuoTX)", m.row, { gap: 16, pad: [12, 0, 12, 0] })
      c.box("Label (NcrOC)", m.label, { fs: 12, fw: "500", color: primary })
      c.box("Desc (LMxOY)", m.desc, { fs: 11, color: secondary })
      if (m.model && m.row)
        c.check("Pane", "Default model → Allow web access", m.row.y - (m.model.y + m.model.h), 0)
      c.flush()

      // Turn it off, then back on: the setting is saved.
      await sw.click()
      await page.waitForFunction(() => {
        const k = (
          window as unknown as {
            __kimoApp: { platform: { settings: { get(k: string): unknown } } }
          }
        ).__kimoApp
        return k.platform.settings.get("ai.webAccess") === false
      })
      await sw.click()

      // No third-party fetch: dimmed 0.45, toggle off and disabled, the reason in the description.
      await page.evaluate(() =>
        (
          window as unknown as {
            __kimoApp: { platform: { settings: { set(k: string, v: unknown): Promise<void> } } }
          }
        ).__kimoApp.platform.settings.set("privacy.noThirdPartyFetch", true),
      )
      await page
        .getByText("Off while No third-party fetch is on in Settings › Fonts & privacy.")
        .waitFor()
      const blocked = await page.evaluate((s) => {
        const row = document.querySelector(s) as HTMLElement
        const sw = row.querySelector("[role=switch]") as HTMLButtonElement
        return {
          opacity: Number(getComputedStyle(row).opacity),
          checked: sw.getAttribute("aria-checked"),
          disabled: sw.disabled,
        }
      }, R)
      const b = checker(ctx, "Board 38 §1 Setting · blocked (P4OH2T)")
      b.check("SettingRow", "opacity", blocked.opacity, 0.45, 0.01)
      b.flush()
      expect(
        blocked.checked === "false" && blocked.disabled,
        `blocked: off and disabled ${JSON.stringify(blocked)}`,
      )
      await page.evaluate(() =>
        (
          window as unknown as {
            __kimoApp: { platform: { settings: { set(k: string, v: unknown): Promise<void> } } }
          }
        ).__kimoApp.platform.settings.set("privacy.noThirdPartyFetch", false),
      )
    },
  },
]
