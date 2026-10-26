/**
 * Board 27 §10 (c) f6LWt + (d) W3CpXw: the Export dialog's Preview | Issues tabs (auto-open on
 * an error, grouped per file, node chip selects, Copy report) and the Tailwind theme option, on
 * the M7 export harness (`&fixture=issues`: core-schema features-all with a missing variable);
 * then File › Export… ⇧⌘E / Copy selection as PNG ⇧⌘C on the integrated app (m4-app harness),
 * including the native-menu event (`kimo://editor-menu` through the memory platform). One
 * measured getComputedStyle / getBoundingClientRect pass per surface vs the node values.
 */
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import type { Page } from "playwright"
import { build } from "vite"
import { checker, measure, tokens } from "./board25-helpers"
import { harnessUrl as appUrl, disk, SITE } from "./m4-app.e2e"
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
      outDir: join(process.env.KIMO_E2E_OUTDIR ?? join(here, ".dist"), "board27-export"),
      emptyOutDir: true,
      target: "es2022",
    },
  }).then(() => "board27-export/index.html")
  return `${ctx.url}${await built}`
}

type Win = { __export: { copied: string[]; selected: string[] } }

async function open(ctx: E2EContext, query: string) {
  ctx.page.on("pageerror", (e) => ctx.log(`pageerror: ${e.message}`))
  await ctx.page.setViewportSize({ width: 1440, height: 900 })
  await ctx.page.goto(`${await harnessUrl(ctx)}?${query}`)
  await ctx.page.evaluate(() => {
    try {
      localStorage.clear()
    } catch {}
  })
  await ctx.page.reload()
  await ctx.page.waitForFunction(() => !!(window as unknown as Win).__export)
  await ctx.page.evaluate(() => document.fonts.ready)
  await ctx.page.locator(".export-dialog").waitFor()
  await ctx.page.waitForFunction(
    () => !/^0 files/.test(document.querySelector(".export-footer__note")?.textContent ?? "0"),
  )
}

const TOKENS = [
  "--kimo-bg-muted",
  "--kimo-border",
  "--kimo-warning",
  "--kimo-warning-soft",
  "--kimo-danger",
  "--kimo-danger-soft",
  "--kimo-text-primary",
  "--kimo-text-secondary",
  "--kimo-text-tertiary",
]

const fileTabs = (page: Page) =>
  page.locator(".export-tabs .export-tab").evaluateAll((els) => els.map((e) => e.textContent))

export const scenarios: Scenario[] = [
  {
    name: "board27 §10 (c) Issues tab: auto-open on error, per-file groups, chip, report (measured)",
    async run(ctx) {
      const { page } = ctx
      await open(ctx, "platform=desktop&fixture=issues&preset=react")
      // Rule AiMJh: the dry run found an error (missing variable) → Issues opened by itself.
      await page.waitForFunction(
        () => document.querySelector(".export-preview")?.getAttribute("data-pane") === "issues",
      )
      const t = await tokens(page, TOKENS)
      const m = await measure(page, {
        tabs: ".export-pane-tabs",
        preview: '.export-pane-tabs [data-pane-tab="preview"]',
        previewLabel: '.export-pane-tabs [data-pane-tab="preview"] .kimo-tab__label',
        issues: ".export-issues-tab",
        issuesLabel: ".export-issues-tab__label",
        count: ".export-issues-count",
        copy: ".export-copy-report",
        file: ".export-issue-file",
        head: ".export-issue-file__head",
        fileIcon: ".export-issue-file__icon svg",
        name: ".export-issue-file__name",
        fileCount: ".export-issue-file__count",
        row: '.export-issue[data-level="error"]',
        errIcon: '.export-issue[data-level="error"] .export-issue__icon',
        errSvg: '.export-issue[data-level="error"] .export-issue__icon svg',
        warnIcon: '.export-issue[data-level="warning"] .export-issue__icon',
        message: ".export-issue__message",
        chip: ".export-issue__node",
        chipIcon: ".export-issue__node-icon svg",
        chipIconColor: ".export-issue__node-icon",
        path: ".export-issue__node-path",
        note: ".export-issues-note",
      })
      const c = checker(ctx, "Export (c) f6LWt Issues")
      c.box("Tabs hCpxA", m.tabs, {
        pad: "6 6 6 6",
        gap: 2,
        align: "center",
      })
      c.box("Preview ZwFA9 (Tab)", m.preview, { pad: "5 12 5 12", radius: 999 })
      c.box("Label vznhI", m.previewLabel, { fs: 12, fw: "500", color: t["--kimo-text-secondary"] })
      c.box("Tab · Issues TY8MD", m.issues, {
        pad: "5 10 5 12",
        gap: 6,
        align: "center",
        bg: t["--kimo-bg-muted"],
        radius: 999,
      })
      c.box("Label L0Dhnv", m.issuesLabel, {
        fs: 12,
        fw: "400",
        h: 15,
        color: t["--kimo-text-primary"],
      })
      c.box("Count Bys6o (error)", m.count, {
        pad: "0 6 0 6",
        h: 15,
        fs: 11,
        ff: "JetBrains Mono",
        bg: t["--kimo-danger-soft"],
        color: t["--kimo-text-primary"],
        radius: 999,
      })
      c.box("Copy SPvBm", m.copy, { fs: 11, fw: "400", color: t["--kimo-text-secondary"] })
      c.box("File JrTXc", m.file, { pad: "8 12 6 12", gap: 2, dir: "column" })
      c.box("Head t7ekg", m.head, { gap: 6, align: "center", h: 15 })
      c.box("Icon zvlqv file-code", m.fileIcon, { w: 14, h: 14 })
      c.box("Name Hn8ak", m.name, {
        fs: 11,
        ff: "JetBrains Mono",
        h: 15,
        color: t["--kimo-text-primary"],
      })
      c.box("Count vp4JX", m.fileCount, { fs: 11, color: t["--kimo-text-tertiary"] })
      c.box("Issue row rsdxP", m.row, { pad: "5 0 5 20", gap: 8 })
      c.box("Icon f5A9qV circle-x", m.errIcon, { color: t["--kimo-danger"] })
      c.box("Icon svg 14", m.errSvg, { w: 14, h: 14 })
      c.box("Icon NUJTW triangle-alert", m.warnIcon, { color: t["--kimo-warning"] })
      c.box("Message YDFaT", m.message, { fs: 11, color: t["--kimo-text-secondary"] })
      c.box("Node X9cmva", m.chip, {
        pad: "1 6 1 6",
        gap: 4,
        align: "center",
        bg: t["--kimo-bg-muted"],
        h: 17,
      })
      c.box("Icon JAITN crosshair", m.chipIcon, { w: 10, h: 10 })
      c.box("Icon color", m.chipIconColor, { color: t["--kimo-text-tertiary"] })
      c.box("Path X9AuK", m.path, {
        fs: 11,
        ff: "JetBrains Mono",
        color: t["--kimo-text-secondary"],
      })
      c.box("Footer note TGW5f", m.note, {
        pad: "8 12 8 12",
        fs: 11,
        color: t["--kimo-text-tertiary"],
      })
      // Strokes: tabs row and file group carry a bottom border only.
      const strokes = await page.evaluate(() =>
        [".export-pane-tabs", ".export-issue-file"].map((s) => {
          const cs = getComputedStyle(document.querySelector(s) as Element)
          return [cs.borderTopWidth, cs.borderBottomWidth, cs.borderBottomColor]
        }),
      )
      for (const [i, s] of strokes.entries()) {
        c.check(i ? "File JrTXc" : "Tabs hCpxA", "stroke top", s[0] as string, "0px")
        c.check(i ? "File JrTXc" : "Tabs hCpxA", "stroke bottom", s[1] as string, "1px")
        c.check(
          i ? "File JrTXc" : "Tabs hCpxA",
          "stroke color",
          s[2] as string,
          t["--kimo-border"] as string,
        )
      }
      // Message line height 1.45 (11 × 1.45 = 15.95).
      const lh = await page.evaluate(
        () =>
          getComputedStyle(document.querySelector(".export-issue__message") as Element).lineHeight,
      )
      c.check("Message YDFaT", "line-height", Number.parseFloat(lh), 15.95, 0.1)
      c.flush()

      // Content: grouped per file, error first in the Grid file, path chips.
      const groups = await page
        .locator(".export-issue-file")
        .evaluateAll((els) =>
          els.map((e) => [
            e.querySelector(".export-issue-file__name")?.textContent,
            e.querySelector(".export-issue-file__count")?.textContent,
            [...e.querySelectorAll(".export-issue")].map(
              (r) =>
                `${r.getAttribute("data-level")}:${r.querySelector(".export-issue__node-path")?.textContent}`,
            ),
          ]),
        )
      ctx.log(`    groups: ${JSON.stringify(groups)}`)
      expect(
        JSON.stringify(groups[0]) ===
          JSON.stringify([
            "Grid.tsx",
            "3 issues",
            ["error:Grid", "warning:Grid › Frame", "warning:Grid › Frame"],
          ]),
        `Grid.tsx group: ${JSON.stringify(groups[0])}`,
      )
      expect((await page.locator(".export-issues-count").textContent()) === "3", "count chip 3")
      expect(
        (await page.locator(".export-issues-note").textContent()) ===
          "Warnings never block export.",
        "footer note",
      )
      if (ctx.shots) await page.screenshot({ path: join(ctx.shots, "board27-export-issues.png") })

      // Copy report: plain text.
      await page.locator(".export-copy-report").click()
      const copied = await page.evaluate(() => (window as unknown as Win).__export.copied.at(-1))
      expect(
        (copied ?? "").startsWith("Kimo export issues: 3 issues (1 error)\n\nGrid.tsx: 3 issues\n"),
        `report: ${copied}`,
      )
      // Never blocks: the Export button stays enabled.
      expect(await page.locator(".export-submit").isEnabled(), "export enabled with issues")

      // Preview tab → the file tabs; Tailwind theme v3 → tailwind.config.ts appears.
      await page.locator('[data-pane-tab="preview"]').click()
      await page.locator(".export-tabs").waitFor()
      const tw = await measure(page, {
        group: ".export-group--tailwind",
        label: ".export-group--tailwind .export-label",
        select: ".export-tailwind-select .kimo-select__trigger",
        value: ".export-tailwind-select .kimo-select__value",
        map: ".export-tailwind-map",
        mapLabel: ".export-tailwind-map__label",
        hint: ".export-tailwind-hint",
      })
      const ct = checker(ctx, "Export (c) f6LWt Tailwind theme")
      ct.box("Options qSQC1 (group)", tw.group, { gap: 10, dir: "column" })
      ct.box("Theme output z6nPv (Select)", tw.select, {
        h: 28,
        pad: "0 8 0 8",
        justify: "space-between",
        align: "center",
      })
      ct.box("Value LWF8n", tw.value, { fs: 12, color: t["--kimo-text-primary"] })
      ct.box("Option · Map variables X8IWvq", tw.map, {
        justify: "space-between",
        align: "center",
        h: 16,
      })
      ct.box("Label CULcr", tw.mapLabel, { fs: 12, fw: "400", color: t["--kimo-text-primary"] })
      ct.box("Hint F5cw4", tw.hint, { fs: 11, color: t["--kimo-text-tertiary"] })
      ct.flush()
      expect(
        (await page.locator(".export-tailwind-select .kimo-select__value").textContent()) ===
          "@theme in tokens.css (v4)",
        "v4 default",
      )
      expect(
        (await page
          .locator('.export-tailwind-map [role="switch"]')
          .getAttribute("aria-checked")) === "true",
        "Map variables on by default",
      )
      expect(!(await fileTabs(page)).includes("tailwind.config.ts"), "v4: no config file")
      await page.locator(".export-tailwind-select .kimo-select__trigger").click()
      await page.getByRole("option", { name: "tailwind.config.ts (v3)" }).click()
      await page.waitForFunction(() =>
        [...document.querySelectorAll(".export-tabs .export-tab")].some(
          (e) => e.textContent === "tailwind.config.ts",
        ),
      )
      await page.locator(".export-tailwind-select .kimo-select__trigger").click()
      await page.getByRole("option", { name: "Don't emit" }).click()
      await page.waitForFunction(
        () =>
          ![...document.querySelectorAll(".export-tabs .export-tab")].some(
            (e) => e.textContent === "tailwind.config.ts",
          ),
      )
      expect(
        (await page
          .locator('.export-tailwind-map [role="switch"]')
          .getAttribute("aria-checked")) === "false",
        "Don't emit: mapping off",
      )

      // Node chip: closes the dialog and selects the node.
      await page.locator('[data-pane-tab="issues"]').click()
      expect(
        (await page.locator(".export-issues").evaluate((e) => e.getBoundingClientRect().height)) >
          0,
        "Issues list has a box after switching tabs",
      )
      await page.locator('.export-issue[data-level="error"] .export-issue__node').click()
      await page.locator(".export-dialog").waitFor({ state: "detached" })
      const selected = await page.evaluate(() => (window as unknown as Win).__export.selected)
      expect(JSON.stringify(selected) === '["Grid000001"]', `selected ${JSON.stringify(selected)}`)
    },
  },
  {
    name: "board27 §10 (c) no issues: Preview stays, Issues tab without a count",
    async run(ctx) {
      const { page } = ctx
      await open(ctx, "platform=desktop&preset=html")
      expect(
        (await page.locator(".export-preview").getAttribute("data-pane")) === "preview",
        "Preview pane",
      )
      expect((await page.locator(".export-issues-count").count()) === 0, "no count chip")
      await page.locator('[data-pane-tab="issues"]').click()
      await page.locator(".export-issues-empty").waitFor()
      expect((await page.locator(".export-copy-report").count()) === 0, "no Copy report")
    },
  },
  {
    name: "board27 §10 (d) File › Export… ⇧⌘E · Copy selection as PNG ⇧⌘C (+ native menu)",
    async run(ctx) {
      const { page } = ctx
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.goto(`${await appUrl(ctx)}${disk(`${SITE}/home.kimo`)}`)
      await page.locator(".card-header--left").waitFor({ timeout: 15_000 })
      await page.waitForFunction(() => !!(window as unknown as { __kimo?: unknown }).__kimo)
      await page.locator(".card-header__file").click()
      const menu = page.getByTestId("file-menu")
      await menu.waitFor()
      const rows = await menu
        .locator(":scope > .kimo-menu-dense__items > .kimo-menu-item-dense")
        .evaluateAll((els) =>
          els.map((e) => ({
            label: e.querySelector(".kimo-menu-item-dense__label")?.textContent,
            meta: e.querySelector(".kimo-menu-item-dense__meta")?.textContent ?? "",
            h: e.getBoundingClientRect().height,
            prevDivider: e.previousElementSibling?.classList.contains("kimo-menu-divider") ?? false,
          })),
        )
      const i = rows.findIndex((r) => r.label === "Export…")
      const exp = rows[i]
      const png = rows[i + 1]
      const save = rows.find((r) => r.label === "Save")
      const c = checker(ctx, "File menu W3CpXw")
      c.check("Export… scD5n", "label", exp?.label ?? "", "Export…")
      c.check("Export… scD5n", "meta", exp?.meta ?? "", "⇧⌘E")
      c.check("Export… scD5n", "height (= MenuItem/Dense)", exp?.h ?? 0, save?.h ?? -1)
      c.check("Copy selection as PNG M9P0Sh", "label", png?.label ?? "", "Copy selection as PNG")
      c.check("Copy selection as PNG M9P0Sh", "meta", png?.meta ?? "", "⇧⌘C")
      c.check("Copy selection as PNG M9P0Sh", "height", png?.h ?? 0, save?.h ?? -1)
      c.check("Divider fvmUP", "before the group", String(exp?.prevDivider), "true")
      c.flush()
      await menu.getByRole("menuitem", { name: /^Export…/ }).click()
      await page.locator(".export-dialog").waitFor()
      await page.keyboard.press("Escape")
      await page.locator(".export-dialog").waitFor({ state: "detached" })

      // ⇧⌘E opens the dialog (canvas focused).
      await page
        .locator("canvas")
        .first()
        .click({ position: { x: 5, y: 5 } })
      await page.keyboard.press("Meta+Shift+KeyE")
      await page.locator(".export-dialog").waitFor()
      await page.keyboard.press("Escape")
      await page.locator(".export-dialog").waitFor({ state: "detached" })

      // Native menu bar (desktop `kimo://editor-menu`): File › Export….
      await page.evaluate(() =>
        (
          window as unknown as { __kimoApp: { control: { editorMenu(a: string): void } } }
        ).__kimoApp.control.editorMenu("export"),
      )
      await page.locator(".export-dialog").waitFor()
      await page.keyboard.press("Escape")
      await page.locator(".export-dialog").waitFor({ state: "detached" })

      // ⇧⌘C with nothing selected: a toast says what to do; nothing is copied.
      await page.evaluate(() =>
        (
          window as unknown as {
            __kimo: { session: { ui: { getState(): { select(ids: string[]): void } } } }
          }
        ).__kimo.session.ui
          .getState()
          .select([]),
      )
      await page.keyboard.press("Meta+Shift+KeyC")
      await page.locator(".m3-toast", { hasText: "Select a layer to copy as PNG" }).waitFor()

      // With a selection: a 2× PNG on the clipboard.
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
      const root = await page.evaluate(() => {
        const k = (
          window as unknown as {
            __kimo: {
              session: {
                store: {
                  toDocument(): { nodes: Record<string, { parent: string | null; type: string }> }
                }
                ui: { getState(): { select(ids: string[]): void } }
              }
            }
          }
        ).__kimo
        const nodes = k.session.store.toDocument().nodes
        const id = Object.keys(nodes).find(
          (n) => nodes[n]?.parent === null && nodes[n]?.type === "frame",
        )
        if (id) k.session.ui.getState().select([id])
        return id ?? null
      })
      expect(!!root, "a top-level frame to copy")
      await page.keyboard.press("Meta+Shift+KeyC")
      const toast = page.locator(".m3-toast", {
        hasText: /Copied as PNG \(2×\)|Couldn't copy as PNG/,
      })
      await toast.waitFor({ timeout: 10_000 })
      const text = await toast.innerText()
      ctx.log(`    copy toast: ${text.replace(/\s+/g, " ")}`)
      expect(text.includes("Copied as PNG (2×)"), `copied (${text})`)
      const clip = await page.evaluate(async () => {
        const items = await navigator.clipboard.read()
        const item = items[0]
        if (!item?.types.includes("image/png")) return null
        const b = await item.getType("image/png")
        const bytes = new Uint8Array(await b.arrayBuffer())
        const v = new DataView(bytes.buffer)
        return { w: v.getUint32(16), h: v.getUint32(20) }
      })
      ctx.log(`    clipboard png: ${JSON.stringify(clip)}`)
      expect(!!clip && clip.w > 0 && clip.h > 0, "clipboard holds a PNG")
    },
  },
]
