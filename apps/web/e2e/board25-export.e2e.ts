/**
 * Board 25 "v1 Polish" § 2 Export dialog additions (O3Abm, rules JHqZL) on the M7 export
 * harness (layout-matrix fixture, memory platform): one measured getComputedStyle /
 * getBoundingClientRect pass per surface — (a) PDF row + PNG preview, (b) progress, (c) error +
 * Retry, (d) web "Download as", (e) untitled desktop folder field, (g) review with diff — and the
 * toast copy of each outcome (f).
 */
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import type { Page } from "playwright"
import { build } from "vite"
import { checker, measure, tokens } from "./board25-helpers"
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
      outDir: join(process.env.KIMO_E2E_OUTDIR ?? join(here, ".dist"), "board25-export"),
      emptyOutDir: true,
      target: "es2022",
    },
  }).then(() => "board25-export/index.html")
  return `${ctx.url}${await built}`
}

type Win = {
  __export: {
    outcomes: Record<string, unknown>[]
    copied: string[]
    downloads: { name: string; size: number }[]
    read(ref: string): Promise<string | null>
    open(): void
    memory: {
      control: { failNextWrite(code: string, errno?: string, ref?: string): void }
      files: { writeTextAtomic(ref: string, text: string, o?: object): Promise<unknown> }
    }
    nextFolder: string | null
    toasts: string[]
    delay: number
  }
}
const win = (page: Page) => page.evaluate(() => (window as unknown as Win).__export.outcomes.length)

async function open(ctx: E2EContext, query: string) {
  ctx.page.on("pageerror", (e) => ctx.log(`pageerror: ${e.message}`))
  ctx.page.on("console", (m) => m.type() === "error" && ctx.log(`console: ${m.text()}`))
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
  // First generation done: the footer counts files.
  await ctx.page.waitForFunction(
    () => !/^0 files/.test(document.querySelector(".export-footer__note")?.textContent ?? "0"),
  )
}

const TOKENS = [
  "--kimo-bg-app",
  "--kimo-bg-subtle",
  "--kimo-bg-muted",
  "--kimo-bg-canvas",
  "--kimo-border",
  "--kimo-border-strong",
  "--kimo-accent",
  "--kimo-success",
  "--kimo-success-soft",
  "--kimo-danger",
  "--kimo-danger-soft",
  "--kimo-text-primary",
  "--kimo-text-secondary",
  "--kimo-text-tertiary",
]

export const scenarios: Scenario[] = [
  {
    name: "board25 §2 (a) PDF row + SVG|PNG preview (measured), PDF options and export",
    async run(ctx) {
      const { page } = ctx
      await open(ctx, "platform=desktop&renderer=1")
      const t = await tokens(page, TOKENS)
      await page.locator('.export-format[data-format="assets"]').click()
      await page.locator('.export-preview-bar [data-value="png"]').click()
      await page.locator(".export-image").waitFor()
      await page.waitForFunction(() =>
        /^matrix@2x\.png$/.test(
          document.querySelector(".export-preview-meta__file")?.textContent ?? "",
        ),
      )
      const m = await measure(page, {
        pdfRow: '.export-format[data-format="pdf"]',
        pdfIcon: '.export-format[data-format="pdf"] .export-format__icon-wrap',
        pdfSub: '.export-format[data-format="pdf"] .export-format__sub',
        preview: ".export-preview",
        bar: ".export-preview-bar",
        image: ".export-preview-bar .export-seg:not(.export-seg--scale)",
        scale: ".export-seg--scale",
        scaleOn: ".export-seg--scale .kimo-seg-text__segment--on",
        segLabel: ".export-seg--scale .kimo-seg-text__label",
        fit: ".export-fit",
        area: ".export-image-area",
        img: ".export-image",
        meta: ".export-preview-meta",
        file: ".export-preview-meta__file",
        size: ".export-preview-meta__size",
      })
      const c = checker(ctx, "Export (a) PDF row D7dje + Preview · PNG KeMal")
      c.box("PDF D7dje", m.pdfRow, { h: 52, pad: "10 12 10 12", gap: 10, radius: 16 })
      c.box("Icon Wrap WkXnD", m.pdfIcon, {
        w: 32,
        h: 32,
        bg: t["--kimo-bg-muted"],
        color: t["--kimo-text-secondary"],
      })
      c.box("Sub TPJ6a", m.pdfSub, { fs: 12, color: t["--kimo-text-tertiary"] })
      c.box("Preview · PNG KeMal", m.preview, { bg: t["--kimo-bg-subtle"], radius: 16 })
      c.box("Preview Bar R7Ypoo", m.bar, { h: 44, pad: "8 8 8 12", gap: 8, align: "center" })
      c.box("Image Format plpsW", m.image, { h: 28, bg: t["--kimo-bg-muted"] })
      c.box("Scale k7fVi5", m.scale, { h: 28 })
      c.box("Segment 2× (on)", m.scaleOn, { bg: t["--kimo-bg-app"] })
      c.box("Label Sga4Y", m.segLabel, { fs: 11 })
      c.box("Zoom to fit l2y9N", m.fit, { w: 28, h: 28 })
      c.box("Image Area Im0LX", m.area, {
        h: 244,
        pad: "20 20 20 20",
        bg: t["--kimo-bg-canvas"],
        justify: "center",
        align: "center",
        shadowHas: t["--kimo-border"] as string,
      })
      c.box("Rendered PNG s9I3dH", m.img, { border: `1px ${t["--kimo-border"]}` })
      c.box("Preview Meta c5Fg1", m.meta, { h: 31, pad: "8 12 8 12", gap: 8 })
      c.box("File JPDon", m.file, {
        fs: 11,
        fw: "500",
        ff: "JetBrains Mono",
        color: t["--kimo-text-primary"],
      })
      c.box("Size USqMR", m.size, { fs: 11, color: t["--kimo-text-tertiary"] })
      c.flush()
      // Fixture root Matrix is 900 × 300 in the fake renderer → 2× = 1800 × 600.
      const size = await page.locator(".export-preview-meta__size").textContent()
      expect(/^900 × 300 → 1800 × 600 · ≈ \d+ KB$/.test(size ?? ""), `size line (${size})`)
      await page.locator('.export-seg--scale [data-value="3"]').click()
      await page.waitForFunction(
        () => document.querySelector(".export-preview-meta__file")?.textContent === "matrix@3x.png",
      )
      expect(
        (await page.locator(".export-submit").textContent()) === "Export 1 file",
        "PNG: one file per frame",
      )
      if (ctx.shots) await page.screenshot({ path: join(ctx.shots, "board25-export-png.png") })

      // PDF: Embed fonts on / Include bleed off; preview page 1 + "1 page"; export writes it.
      await page.locator('.export-format[data-format="pdf"]').click()
      await page.locator('.export-toggle-row[data-option="embedFonts"]').waitFor()
      expect(
        (await page
          .locator('.export-toggle-row[data-option="embedFonts"] [role="switch"]')
          .getAttribute("aria-checked")) === "true" &&
          (await page
            .locator('.export-toggle-row[data-option="bleed"] [role="switch"]')
            .getAttribute("aria-checked")) === "false",
        "PDF options: Embed fonts on, Include bleed off",
      )
      await page.waitForFunction(
        () => document.querySelector(".export-preview-meta__size")?.textContent === "1 page",
      )
      expect(
        (await page.locator(".export-preview-meta__file").textContent()) === "export.pdf",
        "export.pdf",
      )
      await page.locator(".export-submit").click()
      await page.waitForFunction(
        () =>
          (window as unknown as Win).__export.outcomes.length === 1 ||
          document.querySelector(".export-error") !== null,
      )
      const err = await page
        .locator(".export-error")
        .textContent()
        .catch(() => null)
      expect(!err, `PDF generated (${err})`)
      const o = await page.evaluate(() => (window as unknown as Win).__export.outcomes[0])
      expect(JSON.stringify(o?.written) === '["export.pdf"]', `pdf written (${JSON.stringify(o)})`)
      const toast = await page.evaluate(() => (window as unknown as Win).__export.toasts[0])
      expect(toast === "Exported 1 file to ~/loom", `toast (${toast})`)
    },
  },
  {
    name: "board25 §2 (b) progress, (c) error + Retry, (f) toasts (measured)",
    async run(ctx) {
      const { page } = ctx
      await open(ctx, "platform=desktop")
      const t = await tokens(page, TOKENS)
      await page.locator('.export-format[data-format="react"]').click()
      await page.waitForFunction(
        () => document.querySelector(".export-submit")?.textContent === "Export 2 files",
      )
      // (b) Slow writes keep the progress state on screen.
      await page.evaluate(() => {
        ;(window as unknown as Win).__export.delay = 600
      })
      await page.locator(".export-submit").click()
      // tokens.css exists with other contents: review first, overwrite it.
      await page.locator(".export-review").waitFor()
      await page.locator(".export-overwrite-all").click()
      await page.locator(".export-write").click()
      await page.locator(".kimo-progress").waitFor()
      await page.waitForFunction(
        () => document.querySelector('.kimo-file-status[data-status="writing"]') !== null,
      )
      {
        const m = await measure(page, {
          run: ".export-run",
          row: ".kimo-file-status",
          icon: ".kimo-file-status--writing .kimo-file-status__icon",
          name: ".kimo-file-status__name",
          status: ".kimo-file-status--writing .kimo-file-status__status",
          queued: ".kimo-file-status--queued .kimo-file-status__icon",
          progress: ".kimo-progress",
          track: ".kimo-progress__track",
          fill: ".kimo-progress__fill",
          label: ".kimo-progress__label",
          cancel: ".export-cancel",
          running: ".export-submit--running",
        })
        const c = checker(ctx, "Export (b) Progress WnLfR")
        c.box("Dialog · Writing WnLfR (body)", m.run, { gap: 14 })
        c.box("File OJUH8", m.row, { h: 27, pad: "6 0 6 0", gap: 8, align: "center" })
        c.box("Icon kQpQP (writing)", m.icon, { w: 14, h: 14, color: t["--kimo-text-primary"] })
        c.box("Name WLd4c", m.name, {
          fs: 11,
          fw: "500",
          ff: "JetBrains Mono",
          color: t["--kimo-text-primary"],
        })
        c.box("Status GihIa (writing…)", m.status, { fs: 11, color: t["--kimo-text-secondary"] })
        if (m.queued) c.box("Icon DLDm1 (queued)", m.queued, { color: t["--kimo-text-tertiary"] })
        c.box("Progress ZxZlz", m.progress, { gap: 6 })
        c.box("Track gJqt8", m.track, { h: 4, bg: t["--kimo-bg-muted"] })
        c.box("Fill oSC9C", m.fill, { h: 4, bg: t["--kimo-accent"] })
        c.box("Label h5COWe", m.label, { fs: 11, color: t["--kimo-text-secondary"] })
        c.box("Cancel f6ZfO", m.cancel, { h: 32 })
        c.box("Exporting… U1D5f", m.running, { h: 32, opacity: "0.6" })
        c.flush()
        const label = await page.locator(".kimo-progress__label").textContent()
        expect(/^Writing \d of 2 · ~\/loom$/.test(label ?? ""), `progress label (${label})`)
      }
      if (ctx.shots) await page.screenshot({ path: join(ctx.shots, "board25-export-progress.png") })
      await page.waitForFunction(() => (window as unknown as Win).__export.outcomes.length === 1)
      const t1 = await page.evaluate(() => (window as unknown as Win).__export.toasts[0])
      expect(t1 === "Exported 2 files to ~/loom", `success toast (${t1})`)

      // (c) A permission error on the first file: the dialog stays, Retry re-runs failed + skipped.
      await page.evaluate(() => {
        const w = (window as unknown as Win).__export
        w.delay = 0
        w.open()
      })
      await page.locator('.export-format[data-format="html"]').click()
      await page.waitForFunction(
        () => document.querySelector(".export-submit")?.textContent === "Export 3 files",
      )
      await page.evaluate(() =>
        (window as unknown as Win).__export.memory.control.failNextWrite(
          "PERMISSION",
          "EACCES",
          "/Users/me/loom/index.html",
        ),
      )
      await page.locator(".export-submit").click()
      // A review only when a target differs (tokens.css may now equal the React run's).
      await page.locator(".export-review, .export-error").first().waitFor()
      if ((await page.locator(".export-review").count()) > 0)
        await page.locator(".export-write").click()
      await page.locator(".export-error").waitFor()
      {
        const m = await measure(page, {
          card: ".export-error",
          icon: ".export-error .kimo-error-card__icon",
          title: ".export-error .kimo-error-card__title",
          desc: ".export-error .kimo-error-card__desc",
          failed: ".kimo-file-status--failed .kimo-file-status__icon",
          failedStatus: ".kimo-file-status--failed .kimo-file-status__status",
          skipped: ".kimo-file-status--skipped .kimo-file-status__status",
          retry: ".export-retry",
        })
        const c = checker(ctx, "Export (c) Error ixYdn")
        c.box("Export error u5xjVk", m.card, {
          pad: "10 12 10 12",
          gap: 8,
          bg: t["--kimo-danger-soft"],
          radius: 16,
        })
        c.box("Icon Q3ljkL (folder-x)", m.icon, { w: 14, h: 14, color: t["--kimo-danger"] })
        c.box("Title d8jH5P", m.title, { fs: 12, fw: "600" })
        c.box("Desc k92b6e", m.desc, { fs: 11, color: t["--kimo-text-secondary"] })
        c.box("Icon W0AxB (failed)", m.failed, { color: t["--kimo-danger"] })
        c.box("Status oxGeo (failed)", m.failedStatus, { color: t["--kimo-danger"] })
        c.box("Status z5a6eL (skipped)", m.skipped, { color: t["--kimo-text-tertiary"] })
        c.box("Retry Wqwu8", m.retry, { h: 32 })
        c.flush()
        expect(
          (await page.locator(".export-error .kimo-error-card__title").textContent()) ===
            "Couldn't write index.html",
          "error title",
        )
        const d = await page.locator(".export-error .kimo-error-card__desc").textContent()
        expect(
          d?.startsWith("Permission denied (EACCES) — ~/loom is read-only."),
          `error desc (${d})`,
        )
        const retry = await page.locator(".export-retry").textContent()
        expect(/^Retry [1-3] files?$/.test(retry ?? ""), `Retry label (${retry})`)
        expect((await win(page)) === 1, "no outcome while failed (dialog never auto-closes)")
      }
      if (ctx.shots) await page.screenshot({ path: join(ctx.shots, "board25-export-error.png") })
      await page.locator(".export-retry").click()
      await page.waitForFunction(() => (window as unknown as Win).__export.outcomes.length === 2)
      const o = await page.evaluate(() => (window as unknown as Win).__export.outcomes[1])
      const written = o?.written as string[]
      const kept = o?.kept as string[]
      expect(
        written.includes("index.html") && written.includes("styles.css"),
        `retry wrote the rest (${JSON.stringify(o)})`,
      )
      const t2 = await page.evaluate(() => (window as unknown as Win).__export.toasts[1])
      const want2 = kept.length
        ? `${written.length} written · ${kept.length} kept as-is`
        : `Exported ${written.length} files to ~/loom`
      expect(t2 === want2, `toast after retry (${t2}, want ${want2})`)

      // Cancel: stops after the current file, the toast counts what was written.
      await page.evaluate(() => {
        const w = (window as unknown as Win).__export
        w.delay = 400
        w.open()
      })
      await page.locator('.export-format[data-format="html"]').click()
      await page.evaluate(async () => {
        const f = (window as unknown as Win).__export.memory.files
        await f.writeTextAtomic("/Users/me/loom/index.html", "<!-- mine -->\n")
        await f.writeTextAtomic("/Users/me/loom/styles.css", "/* mine */\n")
      })
      await page.waitForFunction(
        () => document.querySelector(".export-submit")?.textContent === "Export 3 files",
      )
      await page.locator(".export-submit").click()
      await page.locator(".export-review").waitFor()
      await page.locator(".export-overwrite-all").click()
      await page.locator(".export-write").click()
      await page.locator(".export-cancel").click()
      await page.waitForFunction(() => (window as unknown as Win).__export.outcomes.length === 3)
      const t3 = await page.evaluate(() => (window as unknown as Win).__export.toasts[2])
      expect(/^Export cancelled · 1 of [23] written$/.test(t3 ?? ""), `cancel toast (${t3})`)
    },
  },
  {
    name: "board25 §2 (g) review: Keep | Overwrite, diff, Keep all / Overwrite all (measured)",
    async run(ctx) {
      const { page } = ctx
      await open(ctx, "platform=desktop")
      const t = await tokens(page, TOKENS)
      await page.locator('.export-format[data-format="html"]').click()
      await page.waitForFunction(
        () => document.querySelector(".export-submit")?.textContent === "Export 3 files",
      )
      // A first export writes index.html + styles.css (tokens.css kept).
      await page.locator(".export-submit").click()
      await page.locator(".export-write").click()
      await page.waitForFunction(() => (window as unknown as Win).__export.outcomes.length === 1)
      // index.html edited by hand since; styles.css changed by the export (layer names on).
      await page.evaluate(async () => {
        const w = (window as unknown as Win).__export
        const html = (await w.read("/Users/me/loom/index.html")) ?? ""
        await w.memory.files.writeTextAtomic(
          "/Users/me/loom/index.html",
          html.replace("<body", "<!-- mine -->\n<body"),
        )
        w.open()
      })
      await page.locator('.export-format[data-format="html"]').waitFor()
      await page.locator('.export-toggle-row[data-option="layerNames"] .kimo-toggle').click()
      await page.waitForTimeout(150)
      await page.locator(".export-submit").click()
      await page.locator(".export-review").waitFor()
      const choice = (f: string) =>
        page
          .locator(`.kimo-review-row[data-file="${f}"] [aria-checked="true"]`)
          .getAttribute("data-value")
      expect((await choice("index.html")) === "keep", "hand-edited index.html → Keep")
      expect((await choice("tokens.css")) === "keep", "never-written tokens.css → Keep")
      const m = await measure(page, {
        header: ".export-header--review",
        back: ".export-back",
        title: ".export-header--review .export-title",
        desc: ".export-header--review .export-desc",
        body: ".export-review",
        files: ".export-review__files",
        row: ".kimo-review-row--selected",
        name: ".kimo-review-row--selected .kimo-review-row__name",
        added: ".kimo-review-row--selected .kimo-review-row__added",
        removed: ".kimo-review-row--selected .kimo-review-row__removed",
        kind: ".kimo-review-row--selected .kimo-review-row__kind",
        seg: ".kimo-review-row--selected .kimo-seg-text__segment",
        diff: ".export-diff",
        diffHeader: ".export-diff__header",
        diffFile: ".export-diff__file",
        diffDir: ".export-diff__dir",
        lines: ".export-diff__lines",
        add: ".kimo-diff-line--add",
        addSign: ".kimo-diff-line--add .kimo-diff-line__sign",
        remove: ".kimo-diff-line--remove",
        no: ".kimo-diff-line .kimo-diff-line__no",
        footer: ".export-footer--review",
        keepAll: ".export-keep-all",
        overwriteAll: ".export-overwrite-all",
        write: ".export-write",
      })
      const c = checker(ctx, "Export (g) Review P8d2o")
      c.box("Header ixvG9", m.header, { pad: "20 20 14 24", gap: 12 })
      c.box("Back UURNz", m.back, { w: 32, h: 32, bg: t["--kimo-bg-muted"] })
      c.box("Title jRVsI", m.title, { fs: 20, fw: "500" })
      c.box("Desc x250y", m.desc, { fs: 13, color: t["--kimo-text-secondary"] })
      c.box("Body SAawQ", m.body, { pad: "0 20 0 20", gap: 16 })
      c.box("Files mex2e", m.files, { w: 300, gap: 2 })
      c.box("File L888zt (selected)", m.row, {
        h: 48,
        pad: "8 8 8 10",
        gap: 8,
        bg: t["--kimo-bg-muted"],
        radius: 10,
      })
      c.box("Name oztc7", m.name, { fs: 11, fw: "500", ff: "JetBrains Mono" })
      c.box("Added x349a", m.added, { fs: 11, color: t["--kimo-success"] })
      c.box("Removed rkYft", m.removed, { fs: 11, color: t["--kimo-danger"] })
      c.box("Kind eKisW", m.kind, { fs: 11, color: t["--kimo-text-tertiary"] })
      c.box("Keep / Overwrite segment", m.seg, { h: 22 })
      c.box("Diff rAfV3", m.diff, { bg: t["--kimo-bg-subtle"], radius: 16 })
      c.box("Diff Header Bvfsp", m.diffHeader, {
        h: 31,
        pad: "8 12 8 12",
        gap: 8,
        shadowHas: t["--kimo-border"] as string,
      })
      c.box("File sdHKl", m.diffFile, { fs: 11, fw: "600" })
      c.box("Dir istjI", m.diffDir, { fs: 11, color: t["--kimo-text-tertiary"] })
      c.box("Diff Lines eD4fV", m.lines, { pad: "6 0 6 0" })
      c.box("Line +4 C3uVK6", m.add, {
        h: 19,
        pad: "2 12 2 12",
        gap: 8,
        bg: t["--kimo-success-soft"],
      })
      c.box("Sign PnNc3", m.addSign, { color: t["--kimo-success"] })
      c.box("Line -4 a5fCCx", m.remove, { bg: t["--kimo-danger-soft"] })
      c.box("No t1wHI", m.no, { w: 18, ta: "right", color: t["--kimo-text-tertiary"] })
      c.box("Footer Ao5Tp", m.footer, { pad: "16 20 20 24", gap: 8 })
      c.box("Keep all mv0vV", m.keepAll, { h: 32 })
      c.box("Overwrite all AAF1p", m.overwriteAll, { h: 32 })
      c.box("Write dUJUL", m.write, { h: 32 })
      c.flush()
      if (ctx.shots) await page.screenshot({ path: join(ctx.shots, "board25-export-review.png") })
      // Keep all → only new files (none) are written; Overwrite all → every changed file.
      await page.locator(".export-keep-all").click()
      expect((await page.locator(".export-write").textContent()) === "Write 0 files", "Keep all")
      await page.locator(".export-overwrite-all").click()
      const summary = await page
        .locator(".export-footer--review .export-footer__note")
        .textContent()
      expect(/^\d overwrites? · 0 kept · 0 new$/.test(summary ?? ""), `summary (${summary})`)
      // Back returns to options without writing.
      await page.locator(".export-back").click()
      await page.locator(".export-body").waitFor()
      expect((await win(page)) === 1, "Back wrote nothing")
    },
  },
  {
    name: "board25 §2 (d) web Download as + (e) untitled desktop folder (measured)",
    async run(ctx) {
      const { page } = ctx
      await open(ctx, "platform=web")
      const t = await tokens(page, TOKENS)
      await page.locator('.export-format[data-format="tokens"]').click()
      await page.waitForFunction(
        () => document.querySelector(".export-footer__note")?.textContent === "2 files",
      )
      {
        const m = await measure(page, {
          path: ".export-group--download",
          label: ".export-group--download .export-label",
          zip: ".export-zip",
          prefix: ".export-zip__prefix",
          value: ".export-zip__value",
          hint: ".export-group--download .export-hint",
          hintIcon: ".export-group--download .export-hint__icon",
          hintText: ".export-group--download .export-hint__text",
          footer: ".export-footer--web",
          note: ".export-footer--web .export-footer__note",
          copy: ".export-footer--web .kimo-button--secondary",
          submit: ".export-footer--web .export-submit",
        })
        const c = checker(ctx, "Export (d) web xa561")
        c.box("Path m2be2", m.path, { gap: 6 })
        c.box("Label DCzuN", m.label, { fs: 12, fw: "500", color: t["--kimo-text-tertiary"] })
        c.box("Zip name OMYHv", m.zip, {
          h: 32,
          pad: "0 8 0 8",
          gap: 8,
          bg: t["--kimo-bg-subtle"],
          radius: 6,
        })
        c.box("Prefix jXquz", m.prefix, {
          fs: 11,
          ff: "JetBrains Mono",
          color: t["--kimo-text-tertiary"],
        })
        c.box("Value vpMpD", m.value, {
          fs: 12,
          ff: "JetBrains Mono",
          color: t["--kimo-text-primary"],
        })
        c.box("Hint dZzfD", m.hint, { gap: 6 })
        c.box("Icon i2fKeH", m.hintIcon, { w: 12, h: 12, color: t["--kimo-text-tertiary"] })
        c.box("Text pa7Nz", m.hintText, { fs: 11, color: t["--kimo-text-tertiary"] })
        c.box("Footer p1I8RQ", m.footer, { gap: 8 })
        c.box("Note jufHA", m.note, { fs: 12, color: t["--kimo-text-tertiary"] })
        c.box("Copy code BJHs2", m.copy, { h: 28, pad: "0 12 0 12", fs: 12 })
        c.box("Download .zip Q6ipn", m.submit, { h: 28, pad: "0 12 0 12" })
        c.flush()
      }
      expect(
        (await page.locator(".export-zip__value").inputValue()) === "kimo-export-matrix.zip",
        "default zip name",
      )
      expect(
        (await page.locator(".export-submit").textContent()) === "Download .zip",
        "Download .zip",
      )
      await page.locator(".export-zip__value").fill("hero tokens")
      await page.locator(".export-submit").click()
      await page.waitForFunction(() => (window as unknown as Win).__export.downloads.length === 1)
      const d = await page.evaluate(() => (window as unknown as Win).__export.downloads[0])
      expect(d?.name === "hero tokens.zip", `edited zip name (${JSON.stringify(d)})`)
      const toast = await page.evaluate(() => (window as unknown as Win).__export.toasts[0])
      expect(toast === "Downloaded hero tokens.zip", `web toast (${toast})`)

      // (e) Untitled desktop file.
      await open(ctx, "platform=desktop&untitled=1")
      {
        const m = await measure(page, {
          desc: ".export-desc",
          row: ".export-folder-row",
          field: ".export-folder-field",
          icon: ".export-folder-field__icon",
          text: ".export-folder-field__text",
          choose: ".export-choose",
          chooseIcon: ".export-choose .kimo-button__icon",
          hint: ".export-group--untitled .export-hint",
          submit: ".export-submit",
          copy: ".export-footer .kimo-button--secondary",
        })
        const c = checker(ctx, "Export (e) untitled RhMfR")
        c.box("Folder Row W2BJk", m.row, { gap: 6 })
        c.box("Folder Field lVRRr", m.field, {
          h: 32,
          pad: "0 10 0 10",
          gap: 8,
          bg: t["--kimo-bg-subtle"],
          radius: 6,
          border: `1px ${t["--kimo-border-strong"]}`,
        })
        c.box("Icon e525l", m.icon, { w: 14, h: 14, color: t["--kimo-text-tertiary"] })
        c.box("Placeholder EUr0Q", m.text, { fs: 12, color: t["--kimo-text-tertiary"] })
        c.box("Choose hB829", m.choose, { h: 32, pad: "0 12 0 12", fs: 12 })
        c.box("Choose icon", m.chooseIcon, { w: 14, h: 14 })
        c.box("Hint RcYcb", m.hint, { gap: 6 })
        c.box("Export X8qvM", m.submit, { opacity: "0.4" })
        c.flush()
        expect(
          /· not saved yet · \d+ frames?$/.test(
            (await page.locator(".export-desc").textContent()) ?? "",
          ),
          "untitled desc",
        )
        expect(
          await page.locator(".export-submit").isDisabled(),
          "Export disabled until a folder is set",
        )
        expect(
          !(await page.locator(".export-footer .kimo-button--secondary").isDisabled()),
          "Copy code enabled",
        )
      }
      if (ctx.shots) await page.screenshot({ path: join(ctx.shots, "board25-export-untitled.png") })
      await page.evaluate(() => {
        ;(window as unknown as Win).__export.nextFolder = "/Users/me/new-site"
      })
      await page.locator(".export-choose").click()
      await page.waitForFunction(
        () => document.querySelector(".export-folder-field__text")?.textContent === "~/new-site",
      )
      expect(!(await page.locator(".export-submit").isDisabled()), "Export enabled after Choose…")
      await page.locator(".export-submit").click()
      await page.waitForFunction(() => (window as unknown as Win).__export.outcomes.length === 1)
    },
  },
]
