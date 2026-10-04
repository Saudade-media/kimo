/**
 * M7 Export dialog (board 07 "Export Dialog" AsO2h) on its harness (`e2e/m7-export-harness`:
 * the exporters' layout-matrix fixture on a memory platform). Desktop: one measured
 * getComputedStyle / getBoundingClientRect pass against the node values, format / option /
 * tab switching, Copy code, and Export into the output folder without overwriting a changed
 * file. Web: no output folder, Export downloads a zip.
 */
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import type { Page } from "playwright"
import { build } from "vite"
import { type E2EContext, expect, type Scenario } from "./run"

const here = dirname(fileURLToPath(import.meta.url))
let built: Promise<string> | undefined

async function harnessUrl(ctx: E2EContext): Promise<string> {
  if (process.env.KIMO_E2E_DEV === "1") return `${ctx.url}e2e/m7-export-harness/index.html`
  built ??= build({
    root: join(here, "m7-export-harness"),
    configFile: false,
    base: "./",
    logLevel: "error",
    plugins: [react()],
    build: {
      outDir: join(process.env.KIMO_E2E_OUTDIR ?? join(here, ".dist"), "m7-export"),
      emptyOutDir: true,
      target: "es2022",
    },
  }).then(() => "m7-export/index.html")
  return `${ctx.url}${await built}`
}

type Win = {
  __export: {
    outcomes: Record<string, unknown>[]
    copied: string[]
    downloads: { name: string; size: number }[]
    read(ref: string): Promise<string | null>
    open(): void
  }
}

async function open(ctx: E2EContext, query: string) {
  ctx.page.on("pageerror", (e) => ctx.log(`pageerror: ${e.message}`))
  ctx.page.on("console", (m) => m.type() === "error" && ctx.log(`console: ${m.text()}`))
  await ctx.page.setViewportSize({ width: 1440, height: 900 })
  await ctx.page.goto(`${await harnessUrl(ctx)}?${query}`)
  await ctx.page.waitForFunction(() => !!(window as unknown as Win).__export)
  await ctx.page.evaluate(() => document.fonts.ready)
  // First generation done: the file tabs are filled.
  await ctx.page.locator(".export-tab").first().waitFor()
}

type Box = {
  w: number
  h: number
  pad: string
  gap: number
  fs: number
  fw: string
  ff: string | undefined
  bg: string
  color: string
  radius: number
  ls: number
  shadow: string
  display: string
  dir: string
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
        w: r.width,
        h: r.height,
        pad: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft]
          .map((p) => String(parseFloat(p)))
          .join(" "),
        gap: parseFloat(cs.columnGap) || parseFloat(cs.rowGap) || 0,
        fs: parseFloat(cs.fontSize),
        fw: cs.fontWeight,
        ff: cs.fontFamily.split(",")[0]?.replace(/"/g, "").trim(),
        bg: cs.backgroundColor,
        color: cs.color,
        radius: parseFloat(cs.borderTopLeftRadius),
        ls: parseFloat(cs.letterSpacing) || 0,
        shadow: cs.boxShadow,
        display: cs.display,
        dir: cs.flexDirection,
        align: cs.alignItems,
      }
    }
    return out
  }, selectors) as Promise<Record<string, Box | null>>
}

const tokens = (page: Page, names: string[]) =>
  page.evaluate((ns) => {
    const out: Record<string, string> = {}
    for (const n of ns) {
      const el = document.createElement("div")
      el.style.color = `var(${n})`
      document.body.append(el)
      out[n] = getComputedStyle(el).color
      el.remove()
    }
    return out
  }, names)

function checker(ctx: E2EContext, surface: string) {
  const rows: string[] = []
  const check = (el: string, prop: string, got: unknown, want: number | string, tol = 0.75) => {
    const ok =
      typeof want === "number"
        ? typeof got === "number" && Math.abs(got - want) <= tol
        : got === want
    rows.push(
      `| ${el} | ${prop} | ${want} | ${typeof got === "number" ? Math.round(got * 100) / 100 : got} | ${ok ? "=" : "≠"} |`,
    )
    expect(ok, `${surface} › ${el} ${prop}: want ${want}, got ${got}`)
  }
  const box = (
    el: string,
    b: Box | null | undefined,
    want: Partial<Record<"w" | "h" | "gap" | "fs" | "radius" | "ls", number>> &
      Partial<Record<"pad" | "fw" | "ff" | "bg" | "color" | "dir" | "align", string>>,
  ) => {
    expect(b, `${surface} › ${el} is rendered`)
    if (!b) return
    expect(b.display !== "none" && b.h > 0, `${surface} › ${el} has a box`)
    for (const k of ["w", "h", "gap", "fs", "radius", "ls"] as const)
      if (want[k] !== undefined) check(el, k, b[k], want[k] as number)
    for (const k of ["pad", "fw", "ff", "bg", "color", "dir", "align"] as const)
      if (want[k] !== undefined) check(el, k, b[k], want[k] as string)
  }
  const flush = () =>
    ctx.log(
      `\n    ${surface}\n    | element | property | design | measured | |\n    |---|---|---|---|---|\n${rows.map((r) => `    ${r}`).join("\n")}`,
    )
  return { check, box, flush }
}

export const scenarios: Scenario[] = [
  {
    name: "m7-export: dialog (desktop) — board 07 measured pass, formats, options, tabs, copy, export without overwriting",
    async run(ctx) {
      const { page } = ctx
      await open(ctx, "platform=desktop")
      const t = await tokens(page, [
        "--kimo-bg-app",
        "--kimo-bg-muted",
        "--kimo-bg-subtle",
        "--kimo-accent",
        "--kimo-on-accent",
        "--kimo-text-primary",
        "--kimo-text-secondary",
        "--kimo-text-tertiary",
        "--kimo-agent-2",
        "--kimo-warning",
        "--kimo-success",
      ])
      const m = await measure(page, {
        scrim: ".export-scrim",
        dialog: ".export-dialog",
        header: ".export-header",
        titles: ".export-titles",
        title: ".export-title",
        desc: ".export-desc",
        close: ".export-close",
        body: ".export-body",
        options: ".export-options",
        format: ".export-group--format",
        formatLabel: ".export-group--format .export-label",
        rowOn: ".export-format--on",
        rowOff: '.export-format[data-format="html"]',
        wrapOn: ".export-format--on .export-format__icon-wrap",
        wrapOff: '.export-format[data-format="html"] .export-format__icon-wrap',
        textOn: ".export-format--on .export-format__text",
        titleOn: ".export-format--on .export-format__title",
        subOn: ".export-format--on .export-format__sub",
        check: ".export-format__check",
        settings: ".export-group--settings",
        toggleRow: ".export-toggle-row",
        toggleLabel: ".export-toggle-row__label",
        path: ".export-group--path",
        folder: ".export-folder",
        folderPrefix: ".export-folder__prefix",
        folderValue: ".export-folder__value",
        preview: ".export-preview",
        tabs: ".export-tabs",
        tabActive: ".export-tab.kimo-tab--active",
        tabActiveLabel: ".export-tab.kimo-tab--active .kimo-tab__label",
        copy: ".export-copy",
        code: ".export-code",
        line: ".export-line",
        lineNo: ".export-token--line",
        keyword: ".export-token--keyword",
        attr: ".export-token--attr",
        string: ".export-token--string",
        footer: ".export-footer",
        footerIcon: ".export-footer__icon",
        note: ".export-footer__note",
        copyCode: ".export-footer .kimo-button--secondary",
        submit: ".export-footer .kimo-button--primary",
      })
      const c = checker(ctx, "Export dialog (AsO2h, light, 1440 × 900)")
      c.box("Scrim WWuf4", m.scrim, { w: 1440, h: 900, bg: "rgba(10, 10, 10, 0.3)" })
      // Board 25 (O3Abm) adds the PDF row D7dje (52 + gap 6) to board 07's 597.
      c.box("Dialog m2Oi5", m.dialog, { w: 880, h: 655, radius: 32, bg: t["--kimo-bg-app"] })
      c.box("Header r6NKt7", m.header, { w: 880, h: 84, gap: 12, pad: "24 24 16 28" })
      c.box("Titles uVedp", m.titles, { w: 784, h: 44, gap: 4, dir: "column" })
      c.box("Title TTr17", m.title, {
        fs: 20,
        fw: "500",
        ls: -0.3,
        ff: "Inter",
        color: t["--kimo-text-primary"],
      })
      c.box("Desc OBcKu", m.desc, { fs: 13, color: t["--kimo-text-secondary"] })
      c.box("Close Ax7lX", m.close, { w: 32, h: 32, radius: 999, bg: t["--kimo-bg-muted"] })
      c.box("Body xu5Kq", m.body, { w: 880, h: 495, gap: 20, pad: "0 24 0 24" })
      c.box("Options P50z4", m.options, { w: 264, h: 495, gap: 20, pad: "4 0 0 4" })
      c.box("Format sKgSl", m.format, { w: 260, h: 305, gap: 6 })
      c.box("Format Label T4qdI", m.formatLabel, {
        fs: 12,
        fw: "500",
        color: t["--kimo-text-tertiary"],
      })
      c.box("React + Tailwind v0S2cL", m.rowOn, {
        w: 260,
        h: 52,
        gap: 10,
        pad: "10 12 10 12",
        radius: 16,
        bg: t["--kimo-bg-muted"],
        align: "center",
      })
      c.box("HTML + CSS qsAIn", m.rowOff, { w: 260, h: 52, bg: "rgba(0, 0, 0, 0)" })
      c.box("Icon Wrap c10A1g", m.wrapOn, {
        w: 32,
        h: 32,
        radius: 999,
        bg: t["--kimo-accent"],
        color: t["--kimo-on-accent"],
      })
      c.box("Icon Wrap bs0Mv", m.wrapOff, {
        w: 32,
        h: 32,
        bg: t["--kimo-bg-muted"],
        color: t["--kimo-text-secondary"],
      })
      c.box("Text GSDSq", m.textOn, { w: 168, h: 32, gap: 1 })
      c.box("Title yzXdB", m.titleOn, { fs: 13, fw: "500", color: t["--kimo-text-primary"] })
      c.box("Sub NcV7o", m.subOn, { fs: 12, color: t["--kimo-text-tertiary"] })
      c.box("Check u5jC8", m.check, { w: 16, h: 16, color: t["--kimo-text-primary"] })
      c.box("Settings Q6kGEo", m.settings, { w: 260, h: 93, gap: 10 })
      c.box("Toggle row oYwtp", m.toggleRow, { w: 260, h: 16, gap: 10, align: "center" })
      c.box("Toggle label i5sWv", m.toggleLabel, {
        w: 222,
        fs: 12,
        color: t["--kimo-text-primary"],
      })
      c.box("Path JcyHA", m.path, { w: 260, h: 53, gap: 6 })
      c.box("Folder d0Qg5Y", m.folder, {
        w: 260,
        h: 32,
        gap: 8,
        pad: "0 8 0 8",
        radius: 6,
        bg: t["--kimo-bg-subtle"],
      })
      c.box("Prefix jXquz", m.folderPrefix, {
        fs: 11,
        ff: "JetBrains Mono",
        color: t["--kimo-text-tertiary"],
      })
      c.box("Value vpMpD", m.folderValue, {
        fs: 12,
        ff: "JetBrains Mono",
        color: t["--kimo-text-primary"],
      })
      c.box("Preview g1SaG", m.preview, { w: 548, radius: 16, bg: t["--kimo-bg-subtle"] })
      c.box("File Tabs GU9Jd", m.tabs, { w: 548, h: 36, gap: 2, pad: "8 8 0 8" })
      c.box("Tab/Active iSJdu", m.tabActive, { h: 26, bg: t["--kimo-bg-muted"], radius: 999 })
      c.box("Tab label nREvy", m.tabActiveLabel, { fs: 12, fw: "600", ff: "JetBrains Mono" })
      c.box("Copy a2Pcn", m.copy, { w: 28, h: 28, bg: t["--kimo-bg-subtle"] })
      c.box("Code t1smNB", m.code, { w: 548, gap: 3, pad: "14 16 18 16", dir: "column" })
      c.box("Line oUzap", m.line, { h: 16 })
      c.box("Token (number)", m.lineNo, {
        fs: 12,
        ff: "JetBrains Mono",
        color: t["--kimo-text-tertiary"],
      })
      c.box("Token (keyword)", m.keyword, { color: t["--kimo-agent-2"] })
      c.box("Token (attribute)", m.attr, { color: t["--kimo-warning"] })
      c.box("Token (string)", m.string, { color: t["--kimo-success"] })
      c.box("Footer zeI7q", m.footer, { w: 880, h: 76, gap: 8, pad: "20 24 24 28" })
      c.box("Icon md3Vo", m.footerIcon, { w: 14, h: 14, color: t["--kimo-text-tertiary"] })
      c.box("Note Vg83B", m.note, { fs: 12, color: t["--kimo-text-tertiary"] })
      c.box("Copy zBQM7", m.copyCode, { h: 32, bg: t["--kimo-bg-muted"] })
      c.box("Export ZjvC1", m.submit, { h: 32, bg: t["--kimo-accent"] })
      // Shadows: 0 2 6 $shadow, 0 24 64 $shadow-strong.
      const sh = m.dialog?.shadow ?? ""
      c.check("Dialog m2Oi5", "shadow", /0px 2px 6px 0px.*0px 24px 64px 0px/.test(sh) ? 1 : 0, 1)
      c.flush()

      // Copy, folder, tabs.
      expect((await page.locator(".export-folder").textContent()) === "~/loom", "default folder")
      const firstTab = (await page.locator(".export-tab").first().textContent()) ?? ""
      expect(firstTab.endsWith(".tsx"), `first React file is a .tsx (${firstTab})`)
      await page.locator(".export-footer .kimo-button--secondary").click()
      const copied = await page.evaluate(() => (window as unknown as Win).__export.copied)
      expect(copied.length === 1 && copied[0]?.includes("export function"), "Copy code copies TSX")
      await page.locator('.export-tab[data-path="tokens.css"]').click()
      await page.locator(".export-copy").click()
      const copied2 = await page.evaluate(() => (window as unknown as Win).__export.copied)
      expect(copied2[1]?.includes(":root"), "Copy copies the active tab (tokens.css)")

      // Formats: HTML + CSS → index.html, styles.css, tokens.css.
      await page.locator('.export-format[data-format="html"]').click()
      await page.waitForFunction(
        () => document.querySelector('.export-tab[data-path="index.html"]') !== null,
      )
      expect(
        (await page.locator(".export-format--on").getAttribute("data-format")) === "html",
        "HTML + CSS selected",
      )
      const note = await page.locator(".export-footer__note").textContent()
      expect(
        note === "3 files · existing files are diffed, never overwritten silently",
        `footer note (${note})`,
      )
      expect(
        (await page.locator(".export-submit").textContent()) === "Export 3 files",
        "Export 3 files",
      )
      // Keep layer names toggles the attributes in index.html.
      await page.locator('.export-tab[data-path="index.html"]').click()
      const before = await page.locator(".export-code").textContent()
      await page.locator('.export-toggle-row[data-option="layerNames"] .kimo-toggle').click()
      await page.waitForFunction(
        (b) => document.querySelector(".export-code")?.textContent !== b,
        before,
      )

      // Export: tokens.css already exists with other contents → the review step (board 25
      // P8d2o); a file Kimo never wrote defaults to Keep, "Write 2 files" writes the new ones.
      await page.locator(".export-submit").click()
      await page.locator(".export-review").waitFor()
      expect(
        (await page
          .locator('.kimo-review-row[data-file="tokens.css"] [aria-checked="true"]')
          .getAttribute("data-value")) === "keep",
        "hand-edited tokens.css defaults to Keep",
      )
      expect(
        (await page.locator(".export-write").textContent()) === "Write 2 files",
        "Write 2 files",
      )
      await page.locator(".export-write").click()
      await page.waitForFunction(() => (window as unknown as Win).__export.outcomes.length === 1)
      const outcome = await page.evaluate(() => (window as unknown as Win).__export.outcomes[0])
      ctx.log(`export outcome: ${JSON.stringify(outcome)}`)
      expect(outcome?.kind === "folder" && outcome.folder === "/Users/me/loom", "folder export")
      expect(JSON.stringify(outcome?.kept) === '["tokens.css"]', "tokens.css kept")
      expect(
        JSON.stringify(outcome?.written) === '["index.html","styles.css"]',
        "new files written",
      )
      const kept = await page.evaluate(() =>
        (window as unknown as Win).__export.read("/Users/me/loom/tokens.css"),
      )
      expect(kept === "/* mine */\n", "tokens.css untouched")
      const html = await page.evaluate(() =>
        (window as unknown as Win).__export.read("/Users/me/loom/index.html"),
      )
      expect(html?.includes("<!doctype html>") || html?.includes("<html"), "index.html written")
      expect((await page.locator(".export-dialog").count()) === 0, "dialog closed after export")

      // Re-export: identical files are not rewritten.
      await page.evaluate(() => (window as unknown as Win).__export.open())
      await page.locator(".export-tab").first().waitFor()
      await page.locator(".export-submit").click()
      // tokens.css still differs: the review step again (Keep), nothing else to write.
      await page.locator(".export-write").click()
      await page.waitForFunction(() => (window as unknown as Win).__export.outcomes.length === 2)
      const again = await page.evaluate(() => (window as unknown as Win).__export.outcomes[1])
      expect(
        JSON.stringify(again?.unchanged) === '["index.html","styles.css"]' &&
          JSON.stringify(again?.written) === "[]",
        `second export rewrites nothing (${JSON.stringify(again)})`,
      )
      if (ctx.shots) await page.screenshot({ path: join(ctx.shots, "m7-export-desktop.png") })
    },
  },
  {
    name: "m7-export: dialog (web) — no output folder, Export downloads a zip",
    async run(ctx) {
      const { page } = ctx
      await open(ctx, "platform=web")
      // Board 25 (d): "Output folder" becomes "Download as" on web.
      expect(
        (await page.locator(".export-group--download").count()) === 1 &&
          (await page.locator(".export-folder").count()) === 0,
        "Download as instead of an output folder on web",
      )
      const m = await measure(page, { dialog: ".export-dialog", body: ".export-body" })
      const c = checker(ctx, "Export dialog (web)")
      c.box("Dialog m2Oi5", m.dialog, { w: 880 })
      c.flush()
      await page.locator('.export-format[data-format="tokens"]').click()
      await page.waitForFunction(
        () => document.querySelector('.export-tab[data-path="tokens.json"]') !== null,
      )
      await page.locator(".export-submit").click()
      await page.waitForFunction(() => (window as unknown as Win).__export.downloads.length === 1)
      const d = await page.evaluate(() => (window as unknown as Win).__export.downloads[0])
      expect(
        d?.name === "kimo-export-matrix.zip" && d.size > 100,
        `zip download (${JSON.stringify(d)})`,
      )
    },
  },
]
