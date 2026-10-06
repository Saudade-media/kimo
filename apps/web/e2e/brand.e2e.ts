/**
 * Board 26 §4 "Logo rollout" (KlpS9 / hhyT5): every old "k" mark is now KimoLogo (bm1JR) or
 * KimoLogo/Lockup (HmXpT). One measured pass per surface (getComputedStyle +
 * getBoundingClientRect vs the node values), light and dark.
 *
 *   KimoLogo (bm1JR) 32 × 32 frame › Mark path (HTfes) fill_container, viewBox 0 0 100 100,
 *     even-odd, fill $text-primary. Topbar Logo HOU7D → KimoLogo 28.
 *   KimoLogo/Lockup (HmXpT): row, gap 10, align center; KimoLogo 28 (MvKrj) + Wordmark (nEfPM)
 *     "Kimo" sans 18 / 600, ls -0.3, $text-primary. Home Brand (G6nz2I) padding [4, 8, 16, 8].
 */

import type { Page } from "playwright"
import { KIMO_LOGO_PATH } from "../../../packages/ui/src/kimo-logo/paths"
import { type Box, checker, measure, tokens } from "./board25-helpers"
import { expect, type Scenario } from "./run"

/** The rendered path's geometry, fill rule and the svg's viewBox. */
const svgOf = (page: Page, sel: string) =>
  page.evaluate((s) => {
    const svg = document.querySelector(s)
    const path = svg?.querySelector("path")
    return {
      viewBox: svg?.getAttribute("viewBox"),
      d: path?.getAttribute("d"),
      rule: path ? getComputedStyle(path).fillRule : null,
      fill: path ? getComputedStyle(path).fill : null,
    }
  }, sel)

export const scenarios: Scenario[] = [
  {
    name: "board26 §4: Home lockup + editor topbar KimoLogo, light and dark (measured)",
    async run(ctx) {
      const { page, url } = ctx
      for (const theme of ["light", "dark"] as const) {
        await page.goto(url)
        await page.getByRole("heading", { name: "Recents" }).waitFor()
        // editor.css switches every --kimo-* color on <html data-theme> (lib/theme.ts).
        const applyTheme = () =>
          page.evaluate((t) => {
            document.documentElement.dataset.theme = t
          }, theme)
        await applyTheme()
        const t = await tokens(page, ["--kimo-text-primary"])
        const primary = t["--kimo-text-primary"] as string
        // Board 05 (dark): the $text-primary token flips to near-white (hhyT5 row lqQOT).
        expect(
          (theme === "dark") === (primary !== "rgb(10, 10, 10)"),
          `${theme}: text-primary ${primary}`,
        )
        const { check, box, flush } = checker(ctx, `Home (${theme})`)
        const h = await measure(page, {
          brand: ".home-sidebar__brand",
          lockup: ".home-sidebar__brand .kimo-lockup",
          mark: ".home-sidebar__brand .kimo-logo",
          word: ".home-sidebar__brand .kimo-lockup__wordmark",
        })
        const g = (k: string) => h[k] as Box
        box("Brand G6nz2I", g("brand"), { pad: "4 8 16 8", gap: 10, align: "center" })
        box("KimoLogo/Lockup HmXpT", g("lockup"), { gap: 10, align: "center", dir: "row" })
        box("KimoLogo MvKrj", g("mark"), { w: 28, h: 28, color: primary })
        box("Wordmark nEfPM", g("word"), { fs: 18, fw: "600", ff: "Inter", color: primary })
        check(
          "Wordmark nEfPM",
          "letter-spacing",
          await page
            .locator(".kimo-lockup__wordmark")
            .evaluate((e) => getComputedStyle(e).letterSpacing),
          "-0.3px",
        )
        check("Lockup", "mark → wordmark gap", g("word").x - (g("mark").x + g("mark").w), 10)
        check(
          "Lockup",
          "mark centered on wordmark",
          g("mark").y + g("mark").h / 2,
          g("word").y + g("word").h / 2,
          0.75,
        )
        const hs = await svgOf(page, ".home-sidebar__brand .kimo-logo")
        check("Mark HTfes", "viewBox", hs.viewBox ?? "", "0 0 100 100")
        check("Mark HTfes", "fill-rule", hs.rule ?? "", "evenodd")
        check("Mark HTfes", "fill", hs.fill ?? "", primary)
        expect(hs.d === KIMO_LOGO_PATH, "Home mark uses the KimoLogo (bm1JR) geometry")
        flush()

        await page.getByRole("button", { name: "New file" }).first().click()
        await page.waitForURL(/#\/file\/[A-Za-z0-9]+$/)
        await page.locator(".topbar__logo .kimo-logo").first().waitFor()
        await applyTheme()
        const top = checker(ctx, `Editor topbar (${theme})`)
        const m = await measure(page, {
          topbar: ".topbar",
          logo: ".topbar > .topbar__logo",
          mark: ".topbar > .topbar__logo .kimo-logo",
        })
        const b = (k: string) => m[k] as Box
        top.box("Logo HOU7D (button)", b("logo"), { w: 28, h: 28, bg: "rgba(0, 0, 0, 0)" })
        top.box("KimoLogo bm1JR", b("mark"), { w: 28, h: 28, color: primary })
        top.check("KimoLogo bm1JR", "left = topbar padding 12", b("mark").x - b("topbar").x, 12)
        top.check("KimoLogo bm1JR", "centered in 48", b("mark").y - b("topbar").y, 10)
        const ts = await svgOf(page, ".topbar > .topbar__logo .kimo-logo")
        top.check("Mark HTfes", "fill", ts.fill ?? "", primary)
        top.check("Mark HTfes", "fill-rule", ts.rule ?? "", "evenodd")
        expect(ts.d === KIMO_LOGO_PATH, "topbar mark uses the KimoLogo (bm1JR) geometry")
        expect(
          (await page.locator(".topbar__mark, .home-sidebar__mark").count()) === 0,
          "no old 'k' marks left",
        )
        top.flush()
        if (ctx.shots) await page.screenshot({ path: `${ctx.shots}/brand-topbar-${theme}.png` })
      }
    },
  },
]
