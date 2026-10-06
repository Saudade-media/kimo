/**
 * Board 38 "Web access" (desing.pen qPPXu): §1 the Allow web access row in Settings › AI
 * providers (on by default, dimmed and off while No third-party fetch is on), §2 the composer's
 * globe (on, off for the session, blocked with its reason), §3 the web steps and the reply's
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

const W = "[data-testid=agent-web-access]"
const composer = (page: Page) => page.locator("[data-testid=agent-composer] textarea")

/** Hovers the globe and reads the tooltip it shows. */
async function tooltip(page: Page): Promise<string> {
  await page.mouse.move(0, 0)
  await page.locator(W).hover()
  const tip = page.locator(
    ".kimo-tooltip-anchor:has([data-testid=agent-web-access]) [role=tooltip]",
  )
  await tip.waitFor({ timeout: 3000 })
  return tip.innerText()
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
    name: "board38: composer globe — on by default, off for the session, blocked with a reason + measured",
    async run(ctx) {
      const { page } = ctx
      await openPanel(ctx)
      const secondary = await token(page, "--kimo-text-secondary")
      const tertiary = await token(page, "--kimo-text-tertiary")
      expect((await page.locator(W).getAttribute("aria-pressed")) === "true", "on by default")
      expect((await page.locator(W).getAttribute("data-state")) === "on", "state on")
      let m = await measure(page, {
        web: W,
        icon: `${W} svg`,
        auto: "[data-testid=agent-auto-approve]",
      })
      let c = checker(ctx, "Board 38 §2 Composer · A on (v41pS)")
      c.box("Web access (v41pS)", m.web, { w: 24, h: 24, radius: 6, color: secondary })
      c.box("Icon globe (kQBm7)", m.icon, { w: 14, h: 14 })
      if (m.auto && m.web)
        c.check("Bar", "Auto-approve → Web access gap", m.web.x - (m.auto.x + m.auto.w), 4)
      c.flush()
      expect(
        (await tooltip(page)) === "Turn off web access for this session",
        "on: tooltip names the action",
      )

      // Off for this session: globe-x in text-tertiary.
      await page.locator(W).click()
      await page.waitForFunction(
        () => !(window as unknown as M6).__m6.controller.state.webAccess.on,
      )
      m = await measure(page, { web: W })
      c = checker(ctx, "Board 38 §2 Composer · B off (vfhgZ)")
      c.box("Web access (vfhgZ)", m.web, { w: 24, h: 24, color: tertiary })
      c.flush()
      expect((await page.locator(W).getAttribute("aria-pressed")) === "false", "off: not pressed")
      expect(
        (await tooltip(page)) === "Turn on web access for this session",
        "off: tooltip names the action",
      )

      // No third-party fetch: disabled at 0.45 with the reason; a click changes nothing.
      await setWeb(page, { blocked: true })
      await page.locator(`${W}[data-state=privacy]`).waitFor()
      const op = await page.evaluate(
        (s) => getComputedStyle(document.querySelector(s) as Element).opacity,
        W,
      )
      c = checker(ctx, "Board 38 §2 Composer · C No third-party fetch (vcbyI)")
      c.check("Web access (vcbyI)", "opacity", Number(op), 0.45, 0.01)
      c.flush()
      expect(
        (await page.locator(W).getAttribute("aria-disabled")) === "true",
        "blocked: aria-disabled",
      )
      expect(
        (await tooltip(page)) === "Web access is off: No third-party fetch is on",
        "blocked: tooltip says why",
      )
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
