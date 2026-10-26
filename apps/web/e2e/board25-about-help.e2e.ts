/**
 * Board 25 §7 (a) About & licenses (cKZbq / Hpfqb) and (b) Help menu (A0qRF) on the integrated
 * app (`e2e/m4-app-harness`, memory platform). One measured getComputedStyle /
 * getBoundingClientRect pass per surface against the desing.pen node values, plus behaviour:
 * real version + licence list, filter, licence sheet, outbound links, File › Help (Windows /
 * web), the native Help menu event (macOS), Report an issue confirm (400), Copy diagnostics,
 * Show logs.
 */
import type { Page } from "playwright"
import { disk, harnessUrl, SITE } from "./m4-app.e2e"
import { type E2EContext, expect, type Scenario } from "./run"

type App = {
  __kimoApp: {
    control: { calls: string[]; helpMenu(a: string): void; clipboardText(): string | null }
  }
  __kimo?: unknown
  __copied?: string[]
}
declare const window: App & Window

async function openApp(ctx: E2EContext, hash: string, query = "", size = { w: 1440, h: 900 }) {
  await ctx.page.setViewportSize({ width: size.w, height: size.h })
  await ctx.page.goto(`${await harnessUrl(ctx)}${query}${hash}`)
  await ctx.page.waitForFunction(() => !!(window as unknown as App).__kimoApp)
  // Clipboard: recorded instead of the OS clipboard (headless has none).
  await ctx.page.evaluate(() => {
    window.__copied = []
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (t: string) => {
          window.__copied?.push(t)
        },
      },
    })
  })
}

async function editor(ctx: E2EContext, query = "") {
  await openApp(ctx, disk(`${SITE}/home.kimo`), query)
  await ctx.page.locator(".card-header--left").waitFor({ timeout: 15_000 })
  await ctx.page.waitForFunction(() => !!(window as unknown as App).__kimo)
}

type Box = {
  x: number
  y: number
  w: number
  h: number
  pad: number[]
  gap: number
  fs: number
  fw: string
  ff: string | undefined
  lh: string
  ls: string
  bg: string
  color: string
  radius: number
  shadow: string
  align: string
}

function measure(page: Page, selectors: Record<string, string>) {
  return page.evaluate((sels) => {
    const out: Record<string, unknown> = {}
    for (const [k, sel] of Object.entries(sels)) {
      const e = document.querySelector(sel)
      if (!e) {
        out[k] = null
        continue
      }
      const r = e.getBoundingClientRect()
      const cs = getComputedStyle(e)
      out[k] = {
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
        pad: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(parseFloat),
        gap: parseFloat(cs.columnGap) || parseFloat(cs.rowGap) || 0,
        fs: parseFloat(cs.fontSize),
        fw: cs.fontWeight,
        ff: cs.fontFamily.split(",")[0]?.replace(/"/g, "").trim(),
        lh: cs.lineHeight,
        ls: cs.letterSpacing,
        bg: cs.backgroundColor,
        color: cs.color,
        radius: parseFloat(cs.borderTopLeftRadius),
        shadow: cs.boxShadow,
        align: cs.alignItems,
      }
    }
    return out
  }, selectors) as Promise<Record<string, Box | null>>
}

const token = (page: Page, name: string) =>
  page.evaluate((n) => {
    const el = document.createElement("div")
    el.style.color = `var(${n})`
    document.body.append(el)
    const c = getComputedStyle(el).color
    el.remove()
    return c
  }, name)

const fontOf = (page: Page, name: string) =>
  page.evaluate(
    (n) =>
      getComputedStyle(document.documentElement)
        .getPropertyValue(n)
        .split(",")[0]
        ?.replace(/["']/g, "")
        .trim(),
    name,
  )

function checker(ctx: E2EContext) {
  const rows: string[] = []
  const check = (
    el: string,
    prop: string,
    got: number | string | undefined | null,
    want: number | string,
    tol = 0.75,
  ) => {
    const ok =
      typeof want === "number"
        ? typeof got === "number" && Math.abs(got - want) <= tol
        : got === want
    rows.push(
      `| ${el} | ${prop} | ${want} | ${typeof got === "number" ? Math.round(got * 100) / 100 : got} |`,
    )
    expect(ok, `${el} ${prop}: want ${want}, got ${got}`)
  }
  const flush = () =>
    ctx.log(
      `\n    | element | property | design | measured |\n    |---|---|---|---|\n${rows.join("\n")}`,
    )
  return { check, flush }
}

const calls = (page: Page) => page.evaluate(() => window.__kimoApp.control.calls.slice())
const copied = (page: Page) => page.evaluate(() => window.__copied?.slice() ?? [])

export const scenarios: Scenario[] = [
  {
    name: "board25 §7 (a): About & licenses pane — identity, links, generated licences (measured)",
    async run(ctx) {
      const { page } = ctx
      // The desktop Settings window (840 × 536), as `#/settings/about` opens it.
      await openApp(ctx, "#/settings/about", "", { w: 840, h: 536 })
      const pane = page.locator('.settings-content[data-pane="about"]')
      await pane.waitFor({ timeout: 15_000 })
      const version = await page.getByTestId("about-version").innerText()
      expect(/^Version 0\.0\.0 \((\d+|dev)\) · macOS · arm64$/.test(version), `version: ${version}`)
      const count = await page.getByTestId("about-license-count").innerText()
      const rows = await page.locator(".about-license").count()
      expect(count === `${rows} packages` && rows > 100, `count ${count} vs ${rows} rows`)

      const m = await measure(page, {
        content: ".settings-content",
        title: ".settings-title--about",
        titleBar: ".settings-title-bar",
        identity: ".about-identity",
        icon: ".about-identity__icon",
        mark: ".about-identity__mark",
        text: ".about-identity__text",
        name: ".about-identity__name",
        version: ".about-identity__version",
        tagline: ".about-identity__tagline",
        actions: ".about-identity__actions",
        copy: ".about-button--ghost",
        copyIcon: ".about-button--ghost .kimo-button__icon",
        copyLabel: ".about-button--ghost .kimo-button__label",
        check: ".about-button:not(.about-button--ghost)",
        checkLabel: ".about-button:not(.about-button--ghost) .kimo-button__label",
        links: ".about-links",
        link: ".about-link",
        linkIcon: ".about-link__icon",
        linkLabel: ".about-link__label",
        linkMeta: ".about-link__meta",
        linkOut: ".about-link__out",
        header: ".about-licenses-header",
        headerTitle: ".about-licenses-header__title",
        badge: ".about-count",
        filter: ".about-filter",
        filterIcon: ".about-filter .kimo-input__icon",
        filterField: ".about-filter .kimo-input__field",
        list: ".about-license-list",
        row: ".about-license",
        pkg: ".about-license__name",
        ver: ".about-license__version",
        spdx: ".about-license__spdx",
        chevron: ".about-license__chevron",
        footer: ".about-licenses-footer",
        footerIcon: ".about-licenses-footer__icon",
        footerNote: ".about-licenses-footer__note",
        footerLink: ".about-licenses-footer__link",
        navIcon: '.settings-nav-item--active[data-pane="about"] .settings-nav-item__icon',
        navLabel: '.settings-nav-item--active[data-pane="about"] .settings-nav-item__label',
      })
      const g = (k: string) => m[k] as Box
      const t = {
        primary: await token(page, "--kimo-text-primary"),
        secondary: await token(page, "--kimo-text-secondary"),
        tertiary: await token(page, "--kimo-text-tertiary"),
        accent: await token(page, "--kimo-accent"),
        onAccent: await token(page, "--kimo-on-accent"),
        subtle: await token(page, "--kimo-bg-subtle"),
        app: await token(page, "--kimo-bg-app"),
        muted: await token(page, "--kimo-bg-muted"),
        border: await token(page, "--kimo-border"),
      }
      const sans = await fontOf(page, "--kimo-font-sans")
      const mono = await fontOf(page, "--kimo-font-mono")
      const { check, flush } = checker(ctx)
      check(
        "Content Hpfqb",
        "padding top/right/bottom/left",
        g("content").pad.join(" "),
        "0 32 24 32",
      )
      check("Title Bar j9qn2", "height", g("titleBar").h, 56)
      check("Title huP2K", "font-size ($text-md)", g("title").fs, 14)
      check("Title huP2K", "font-weight", g("title").fw, "600")
      check("Identity urFVA", "gap", g("identity").gap, 16)
      check("Identity urFVA", "padding", g("identity").pad.join(" "), "8 0 20 0")
      check(
        "Identity urFVA",
        "bottom stroke 1 border",
        g("identity").shadow,
        `${t.border} 0px -1px 0px 0px inset`,
      )
      check("Identity urFVA", "align", g("identity").align, "center")
      check("App Icon mWCUl", "width", g("icon").w, 56)
      check("App Icon mWCUl", "height", g("icon").h, 56)
      check("App Icon mWCUl", "radius", g("icon").radius, 14)
      // Board 26 §4 KlpS9: the app icon — ink plate (#0A0A0A, gTG4w) + white KimoLogo.
      check("App Icon mWCUl", "fill ink plate", g("icon").bg, "rgb(10, 10, 10)")
      check("KimoLogo", "size (60% of the plate)", `${g("mark").w}×${g("mark").h}`, "34×34")
      check("KimoLogo", "fill white", g("mark").color, "rgb(255, 255, 255)")
      check("KimoLogo", "centered x", g("mark").x - g("icon").x, (56 - 34) / 2)
      check("KimoLogo", "centered y", g("mark").y - g("icon").y, (56 - 34) / 2)
      check("Text kynKB", "gap", g("text").gap, 3)
      check("Name fTmJH", "font-size ($text-xl)", g("name").fs, 20)
      check("Name fTmJH", "font-weight", g("name").fw, "600")
      check("Name fTmJH", "letter-spacing", g("name").ls, "-0.3px")
      check("Version Rv2df", "font ($font-mono)", g("version").ff, mono ?? "")
      check("Version Rv2df", "font-size", g("version").fs, 11)
      check("Version Rv2df", "fill $text-secondary", g("version").color, t.secondary)
      check("Tagline QLADg", "font-size", g("tagline").fs, 11)
      check("Tagline QLADg", "fill $text-tertiary", g("tagline").color, t.tertiary)
      check("Actions ipXh7", "gap", g("actions").gap, 6)
      check("Copy version info C9KZx", "height", g("copy").h, 28)
      check("Copy version info C9KZx", "padding x", g("copy").pad[1], 12)
      check("Copy version info C9KZx", "icon 14", g("copyIcon").w, 14)
      check("Copy version info C9KZx", "icon $text-secondary", g("copyIcon").color, t.secondary)
      check(
        "Copy version info C9KZx",
        "label 12 / 500",
        `${g("copyLabel").fs}/${g("copyLabel").fw}`,
        "12/500",
      )
      check("Copy version info C9KZx", "label $text-primary", g("copyLabel").color, t.primary)
      check("Check for updates… wPaMN", "height", g("check").h, 28)
      check("Check for updates… wPaMN", "padding x", g("check").pad[1], 12)
      check("Check for updates… wPaMN", "fill $bg-muted", g("check").bg, t.muted)
      check("Check for updates… wPaMN", "label $text-primary", g("checkLabel").color, t.primary)
      check("Links t4H8L", "padding", g("links").pad.join(" "), "8 0 8 0")
      check("Links t4H8L", "bottom stroke", g("links").shadow, `${t.border} 0px -1px 0px 0px inset`)
      check("Link el78H", "height", g("link").h, 36)
      check("Link el78H", "gap", g("link").gap, 10)
      check("Link el78H", "width = content 560", g("link").w, 560)
      check("Link icon wyCpL", "size", g("linkIcon").w, 16)
      check("Link icon wyCpL", "fill $text-secondary", g("linkIcon").color, t.secondary)
      check("Link label zsYTz", "12 / 500", `${g("linkLabel").fs}/${g("linkLabel").fw}`, "12/500")
      check("Link meta w2UrS", "font-size", g("linkMeta").fs, 11)
      check("Link meta w2UrS", "fill $text-tertiary", g("linkMeta").color, t.tertiary)
      check("Link arrow rZkNX", "size 14", g("linkOut").w, 14)
      check(
        "Link arrow rZkNX",
        "right edge = row end",
        g("linkOut").x + g("linkOut").w,
        g("link").x + g("link").w,
      )
      check("Licenses Header sdWA6", "padding", g("header").pad.join(" "), "20 0 10 0")
      check("Licenses Header sdWA6", "gap", g("header").gap, 8)
      check(
        "Header title kN3cH",
        "13 / 600",
        `${g("headerTitle").fs}/${g("headerTitle").fw}`,
        "13/600",
      )
      check("Count ifabF", "fill $bg-muted", g("badge").bg, t.muted)
      check("Count ifabF", "padding", g("badge").pad.join(" "), "2 8 2 8")
      check("Filter sUdQd", "width", g("filter").w, 180)
      check("Filter sUdQd", "height", g("filter").h, 28)
      check("Filter sUdQd", "radius-md", g("filter").radius, 10)
      check("Filter sUdQd", "icon 14", g("filterIcon").w, 14)
      check("Filter sUdQd", "text 12", g("filterField").fs, 12)
      check("License List QmPSy", "padding", g("list").pad.join(" "), "4 14 4 14")
      check("License List QmPSy", "fill $bg-subtle", g("list").bg, t.subtle)
      check("License List QmPSy", "radius-lg", g("list").radius, 16)
      check(
        "License List QmPSy",
        "stroke 1 border",
        g("list").shadow,
        `${t.border} 0px 0px 0px 1px inset`,
      )
      check("License row DjsBm", "height", g("row").h, 34)
      check("License row DjsBm", "gap", g("row").gap, 10)
      check("License row DjsBm", "width = 560 − 28", g("row").w, 532)
      check(
        "Package qayEa",
        "mono 11 / 500",
        `${g("pkg").ff}/${g("pkg").fs}/${g("pkg").fw}`,
        `${mono}/11/500`,
      )
      check("Version m5PND", "fill $text-tertiary", g("ver").color, t.tertiary)
      check("License pill iYULE", "padding", g("spdx").pad.join(" "), "1 8 1 8")
      check("License pill iYULE", "fill $bg-app", g("spdx").bg, t.app)
      check("License pill iYULE", "label $text-secondary", g("spdx").color, t.secondary)
      check("License pill iYULE", "height", g("spdx").h, 17)
      check("Chevron aiNni", "size 14", g("chevron").w, 14)
      check("Footer ILW2H", "padding", g("footer").pad.join(" "), "10 0 0 0")
      check("Footer ILW2H", "gap", g("footer").gap, 6)
      check("Footer icon aSG6H", "size 12", g("footerIcon").w, 12)
      check("Footer note drDtm", "font-size", g("footerNote").fs, 11)
      check("Open file jTOwk", "11 / 500", `${g("footerLink").fs}/${g("footerLink").fw}`, "11/500")
      check("Open file jTOwk", "fill $text-primary", g("footerLink").color, t.primary)
      check("Nav icon m2r7p", "fill $text-primary", g("navIcon").color, t.primary)
      check("Nav label MFn1e", "font-weight 600", g("navLabel").fw, "600")
      check("Name fTmJH", "font ($font-sans)", g("name").ff, sans ?? "")
      flush()
      if (ctx.shots) await page.screenshot({ path: `${ctx.shots}/board25-about.png` })

      // Filter → one row → the licence sheet with the real MIT text.
      await page.getByRole("textbox", { name: "Filter packages" }).fill("react-dom")
      expect((await page.locator(".about-license").count()) === 1, "filter react-dom → 1 row")
      await page.locator(".about-license").click()
      const sheet = page.getByTestId("license-sheet")
      await sheet.waitFor()
      await page.waitForFunction(() =>
        document
          .querySelector('[data-testid="license-text"]')
          ?.textContent?.includes("MIT License"),
      )
      await page.keyboard.press("Escape")
      await sheet.waitFor({ state: "detached" })
      // Copy version info → the version string; the label confirms.
      await page.getByRole("button", { name: "Copy version info" }).click()
      await page.getByRole("button", { name: "Copied" }).waitFor()
      const c = await copied(page)
      expect(c[0] === `Kimo ${version.replace(/^Version /, "")}`, `copied ${c[0]}`)
      // Outbound links and Check for updates….
      await page.locator('.about-link[data-link="docs"]').click()
      await page.locator('.about-link[data-link="release-notes"]').click()
      await page.getByRole("button", { name: "Check for updates…" }).click()
      const k = await calls(page)
      expect(k.includes("openExternalUrl https://getkimo.design/docs/"), `calls ${k.join(", ")}`)
      expect(
        k.includes("openExternalUrl https://github.com/Saudade-media/kimo/releases/tag/v0.0.0"),
        "release notes",
      )
    },
  },
  {
    name: "board25 §7 (b): File › Help (Windows) — items, ⌘/ as Ctrl+/, confirm, diagnostics, logs (measured)",
    async run(ctx) {
      const { page } = ctx
      await editor(ctx, "?os=windows")
      const trigger = page.locator(".card-header__file")
      await trigger.click()
      const menu = page.getByTestId("file-menu")
      await menu.getByRole("menuitem", { name: "Help" }).hover()
      const help = page.getByTestId("file-menu-help")
      await help.waitFor({ timeout: 2000 })
      const labels = await help.locator(".kimo-menu-item-dense__label").allInnerTexts()
      expect(
        labels.join("|") ===
          "Kimo documentation|Keyboard shortcuts|What's new in 0.0|Report an issue…|Copy diagnostics|Show logs in Explorer",
        `help items: ${labels.join("|")}`,
      )
      const meta = await help.locator(".kimo-menu-item-dense__meta").allInnerTexts()
      expect(meta.join(" ") === "Ctrl+/", `meta ${meta.join(" ")}`)
      expect((await help.locator(".kimo-menu-divider").count()) === 2, "two dividers")
      const m = await measure(page, {
        menu: '[data-testid="file-menu-help"]',
        item: '[data-testid="file-menu-help"] .kimo-menu-item-dense',
        slot: '[data-testid="file-menu-help"] .kimo-menu-item-dense__check--icon',
        label: '[data-testid="file-menu-help"] .kimo-menu-item-dense__label',
        meta: '[data-testid="file-menu-help"] .kimo-menu-item-dense__meta',
        divider: '[data-testid="file-menu-help"] .kimo-menu-divider',
      })
      const g = (k: string) => m[k] as Box
      const t = {
        primary: await token(page, "--kimo-text-primary"),
        secondary: await token(page, "--kimo-text-secondary"),
        tertiary: await token(page, "--kimo-text-tertiary"),
        overlay: await token(page, "--kimo-bg-overlay"),
      }
      const mono = await fontOf(page, "--kimo-font-mono")
      const { check, flush } = checker(ctx)
      check("Help Menu A0qRF", "width", g("menu").w, 256)
      check("Help Menu A0qRF", "fill $bg-overlay", g("menu").bg, t.overlay)
      check("Help Menu A0qRF", "radius-lg", g("menu").radius, 16)
      check("MenuItem kY346", "height", g("item").h, 28)
      check("MenuItem kY346", "padding x", g("item").pad[1], 8)
      check("MenuItem kY346", "gap", g("item").gap, 8)
      check("Check Slot Hl922", "size 14", g("slot").w, 14)
      check("Check RmOTH", "fill $text-secondary", g("slot").color, t.secondary)
      check("Label BRxvS", "font-size 12", g("label").fs, 12)
      check("Label BRxvS", "fill $text-primary", g("label").color, t.primary)
      check("Meta T4CD1", "mono 11", `${g("meta").ff}/${g("meta").fs}`, `${mono}/11`)
      check("Meta T4CD1", "fill $text-tertiary", g("meta").color, t.tertiary)
      check("Divider Xf9Kp", "height 9 (4 + 1 + 4)", g("divider").h, 9)
      flush()
      if (ctx.shots) await page.screenshot({ path: `${ctx.shots}/board25-file-help.png` })

      // Report an issue… → the 400 px quick confirm → prefilled issue (version block only).
      await help.getByRole("menuitem", { name: "Report an issue…" }).click()
      const confirm = page.getByTestId("report-issue-confirm")
      await confirm.waitFor()
      const box = await confirm.boundingBox()
      expect(Math.abs((box?.width ?? 0) - 400) < 0.75, `confirm width ${box?.width}`)
      await confirm.getByRole("button", { name: "Open GitHub" }).click()
      await confirm.waitFor({ state: "detached" })
      const issue = (await calls(page)).find((c) =>
        c.startsWith("openExternalUrl https://github.com/Saudade-media/kimo/issues/new?"),
      )
      expect(issue, "issue URL opened")
      const body =
        new URL((issue as string).slice("openExternalUrl ".length)).searchParams.get("body") ?? ""
      expect(/Kimo 0\.0\.0 \((\d+|dev)\) · Windows · arm64/.test(body), `body: ${body}`)
      expect(!body.includes("home.kimo") && !body.includes(SITE), "no file names or paths")
      // Copy diagnostics → the same block on the clipboard.
      await trigger.click()
      await menu.getByRole("menuitem", { name: "Help" }).hover()
      await help.getByRole("menuitem", { name: "Copy diagnostics" }).click()
      // The host writes through platform.clipboard (Rust on desktop), recorded by the memory platform.
      const c = await page.evaluate(() => window.__kimoApp.control.clipboardText())
      expect(c !== null && body.includes(c), `diagnostics ${c}`)
      // Show logs (desktop only).
      await trigger.click()
      await menu.getByRole("menuitem", { name: "Help" }).hover()
      await help.getByRole("menuitem", { name: "Show logs in Explorer" }).click()
      expect((await calls(page)).includes("showLogs"), "showLogs")
      // Keyboard shortcuts → the shortcuts sheet.
      await trigger.click()
      await menu.getByRole("menuitem", { name: "Help" }).hover()
      await help.getByRole("menuitem", { name: "Keyboard shortcuts" }).click()
      await page.getByRole("dialog", { name: "Keyboard shortcuts" }).waitFor({ timeout: 5000 })
    },
  },
  {
    name: "board25 §7 (b): macOS — no File › Help; the native Help menu runs in the editor",
    async run(ctx) {
      const { page } = ctx
      await editor(ctx)
      await page.locator(".card-header__file").click()
      const labels = await page
        .getByTestId("file-menu")
        .locator(".kimo-menu-item-dense__label")
        .allInnerTexts()
      expect(!labels.includes("Help"), `macOS File menu: ${labels.join("|")}`)
      await page.keyboard.press("Escape")
      // menu.rs → kimo://help-menu → platform.help.onMenu.
      await page.evaluate(() => window.__kimoApp.control.helpMenu("report-issue"))
      const confirm = page.getByTestId("report-issue-confirm")
      await confirm.waitFor()
      await page.keyboard.press("Escape")
      await confirm.waitFor({ state: "detached" })
      expect(!(await calls(page)).some((c) => c.includes("/issues/new")), "Cancel opens nothing")
      await page.evaluate(() => window.__kimoApp.control.helpMenu("docs"))
      await page.evaluate(() => window.__kimoApp.control.helpMenu("whats-new"))
      const k = await calls(page)
      expect(k.includes("openExternalUrl https://getkimo.design/docs/"), "docs")
      expect(
        k.includes("openExternalUrl https://github.com/Saudade-media/kimo/releases/tag/v0.0.0"),
        "what's new",
      )
    },
  },
]
