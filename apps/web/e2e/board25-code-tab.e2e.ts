/**
 * Board 25 "v1 Polish" § 1 Code tab (nkVxr) in the real editor: (d) nothing selected, (a) React
 * + Tailwind with a selected child highlighted (one measured getComputedStyle /
 * getBoundingClientRect pass against hc6wk's node values), line click selects the layer,
 * framework switch remembered, (c) tokens, (b) > 400 lines truncated, (e) unsupported prompt,
 * and "Open export…" opening the Export dialog with the framework preselected.
 */
import { join } from "node:path"
import type { Page } from "playwright"
import { checker, measure, tokens } from "./board25-helpers"
import { openEditor, settle } from "./qa-helpers"
import { type E2EContext, expect, type Scenario } from "./run"

type W = {
  __kimo: {
    session: {
      apply(ops: unknown[], label?: string): boolean
      ui: { getState(): { selection: string[]; select(ids: string[]): void } }
    }
  }
}

const select = (page: Page, ids: string[]) =>
  page.evaluate((i) => (window as unknown as W).__kimo.session.ui.getState().select(i), ids)
const selection = (page: Page) =>
  page.evaluate(() => (window as unknown as W).__kimo.session.ui.getState().selection)

async function fixture(page: Page) {
  const ok = await page.evaluate(() => {
    const s = (window as unknown as W).__kimo.session
    const ops: unknown[] = [
      {
        op: "insert",
        id: "hero000001",
        parent: null,
        node: {
          type: "frame",
          name: "Hero",
          x: 80,
          y: 80,
          w: 720,
          h: 366,
          fill: "#FBF7F2",
          layout: { dir: "column", gap: 16, pad: 40 },
        },
      },
      {
        op: "insert",
        id: "headline01",
        parent: "hero000001",
        node: { type: "text", name: "Headline", content: "Plan less. Ship more together." },
      },
      {
        op: "insert",
        id: "sub0000001",
        parent: "hero000001",
        node: { type: "text", name: "Sub", content: "Loom turns messy roadmaps into calm plans." },
      },
      {
        op: "insert",
        id: "prompt0001",
        parent: null,
        node: {
          type: "prompt",
          name: "Pricing brief",
          content: "Draft 3 cards",
          x: 900,
          y: 80,
          w: 260,
        },
      },
      {
        op: "insert",
        id: "big0000001",
        parent: null,
        node: {
          type: "frame",
          name: "Home — Desktop",
          x: 80,
          y: 600,
          w: 400,
          h: 400,
          layout: { dir: "column", gap: 2, pad: 4 },
        },
      },
    ]
    for (let i = 0; i < 420; i++)
      ops.push({
        op: "insert",
        id: `bigrow${String(i).padStart(4, "0")}`,
        parent: "big0000001",
        node: { type: "rect", name: `Row ${i}`, w: 40, h: 1, fill: "#C9B8A6" },
      })
    return s.apply(ops, "board25 code tab fixture")
  })
  expect(ok, "fixture applied")
  await settle(page)
}

async function openCodeTab(page: Page) {
  await page.getByRole("tab", { name: "Code" }).click()
  await page.locator(".code-tab").waitFor()
}

const codeReady = (page: Page) =>
  page.waitForFunction(
    () => document.querySelectorAll(".code-tab__view .kimo-code-line").length > 3,
  )

export const scenarios: Scenario[] = [
  {
    name: "board25 §1 Code tab: empty, React + highlight (measured), line click, switch memory, tokens, truncation, unsupported, Open export…",
    async run(ctx: E2EContext) {
      const { page } = ctx
      page.on("pageerror", (e) => ctx.log(`pageerror: ${e.message}`))
      await page.setViewportSize({ width: 1440, height: 900 })
      try {
        await page.evaluate(() => localStorage.clear())
      } catch {}
      await openEditor(page, ctx.url)
      await fixture(page)
      await select(page, [])
      await openCodeTab(page)
      const t = await tokens(page, [
        "--kimo-bg-app",
        "--kimo-bg-subtle",
        "--kimo-bg-muted",
        "--kimo-border",
        "--kimo-selection",
        "--kimo-selection-soft",
        "--kimo-success",
        "--kimo-text-primary",
        "--kimo-text-secondary",
        "--kimo-text-tertiary",
      ])

      // (d) Nothing selected (kNMph).
      {
        const m = await measure(page, {
          divider: ".code-tab__divider",
          body: ".code-tab__empty",
          icon: ".code-tab__empty-icon",
          title: ".code-tab__empty-title",
          desc: ".code-tab__empty-desc",
          button: ".code-tab__empty .kimo-button",
        })
        const c = checker(ctx, "Code tab (d) empty kNMph")
        c.box("Divider LTeqc", m.divider, { h: 1, bg: t["--kimo-border"] })
        c.box("Empty Body kNMph", m.body, {
          gap: 10,
          pad: "0 32 0 32",
          justify: "center",
          align: "center",
        })
        c.box("Icon Wrap a6BE6N", m.icon, {
          w: 40,
          h: 40,
          bg: t["--kimo-bg-muted"],
          color: t["--kimo-text-secondary"],
        })
        c.box("Title WQXLZ", m.title, { fs: 13, fw: "600", color: t["--kimo-text-primary"] })
        c.box("Desc dJJzw", m.desc, { fs: 12, color: t["--kimo-text-secondary"], ta: "center" })
        c.box("Export page Z1evi", m.button, { h: 28, pad: "0 12 0 12" })
        c.flush()
        expect(
          (await page.locator(".code-tab__empty-title").textContent()) ===
            "Select a layer to see its code",
          "empty title",
        )
        expect((await page.locator(".code-tab__bar").count()) === 0, "switch hidden when empty")
      }

      // (a) React + Tailwind: Hero selected, then the child Headline highlighted.
      await select(page, ["hero000001"])
      await codeReady(page)
      await select(page, ["headline01"])
      await page.waitForFunction(
        () => document.querySelectorAll(".kimo-code-line--highlighted").length > 0,
      )
      expect(
        (await page.getByTestId("code-selection-name").textContent()) === "Hero",
        "selection row keeps the root (Hero) while a child is selected",
      )
      const chips = await page.locator(".kimo-file-chip").allTextContents()
      expect(chips[0] === "Hero.tsx", `root file first (${chips.join(", ")})`)
      {
        const m = await measure(page, {
          panel: ".right-panel",
          selection: ".code-tab__selection",
          bar: ".code-tab__bar",
          seg: ".code-tab__switch",
          segOn: ".code-tab__switch .kimo-seg-text__segment--on",
          segLabel: ".code-tab__switch .kimo-seg-text__segment--on .kimo-seg-text__label",
          copy: ".code-tab__copy",
          files: ".code-tab__files",
          chip: ".kimo-file-chip--active",
          chipLabel: ".kimo-file-chip--active .kimo-file-chip__label",
          chipOff: ".kimo-file-chip:not(.kimo-file-chip--active) .kimo-file-chip__label",
          meta: ".code-tab__meta",
          view: ".code-tab__view",
          line: ".code-tab__view .kimo-code-line:not(.kimo-code-line--highlighted)",
          no: ".code-tab__view .kimo-code-line .kimo-code-line__no",
          hl: ".kimo-code-line--highlighted",
          hlNo: ".kimo-code-line--highlighted .kimo-code-line__no",
          strong: ".code-tab__view .kimo-code-line__token--strong",
          attr: ".code-tab__view .kimo-code-line__token--attr",
          punct: ".code-tab__view .kimo-code-line__token--punct",
          footer: ".code-tab__footer",
          dot: ".code-tab__dot",
          status: ".code-tab__status",
          link: ".code-tab__open-export",
          linkLabel: ".code-tab__open-export-label",
        })
        const c = checker(ctx, "Code tab (a) React + Tailwind hc6wk")
        c.box("Right Panel · Code hc6wk", m.panel, { w: 280, bg: t["--kimo-bg-app"] })
        c.box("Selection CChLA", m.selection, { pad: "8 12 12 12", gap: 8 })
        c.box("Framework Bar WLqjf", m.bar, { h: 46, pad: "10 12 8 12", gap: 8, align: "center" })
        c.box("Framework Switch ebO2s", m.seg, { h: 28, pad: "2 2 2 2", bg: t["--kimo-bg-muted"] })
        c.box("Segment sK1Gg (on)", m.segOn, { h: 24, pad: "0 10 0 10", bg: t["--kimo-bg-app"] })
        c.box("Label Sga4Y", m.segLabel, { fs: 11, fw: "500", color: t["--kimo-text-primary"] })
        c.box("Copy file AM6ea", m.copy, { w: 28, h: 28, color: t["--kimo-text-secondary"] })
        c.box("File Tabs vQgF3", m.files, { h: 32, pad: "0 12 8 12", gap: 2 })
        c.box("File · Hero.tsx CHvca", m.chip, {
          h: 24,
          pad: "0 8 0 8",
          bg: t["--kimo-bg-muted"],
          radius: 6,
        })
        c.box("Label V6WcIB", m.chipLabel, {
          fs: 11,
          fw: "500",
          ff: "JetBrains Mono",
          color: t["--kimo-text-primary"],
        })
        if (m.chipOff)
          c.box("Label T27Uz3", m.chipOff, { fs: 11, fw: "400", color: t["--kimo-text-tertiary"] })
        c.box("Meta x2C0GA", m.meta, {
          fs: 11,
          ff: "JetBrains Mono",
          color: t["--kimo-text-tertiary"],
        })
        c.box("Code View deO9F", m.view, {
          pad: "10 0 10 0",
          gap: 2,
          bg: t["--kimo-bg-subtle"],
          shadowHas: t["--kimo-border"] as string,
        })
        c.box("Line zwdHw", m.line, { pad: "1 12 1 10", h: 17 })
        c.box("No dILXj", m.no, { w: 22, fs: 11, ta: "right", color: t["--kimo-text-tertiary"] })
        c.box("Line 5 Fd5Zh (highlight)", m.hl, {
          bg: t["--kimo-selection-soft"],
          shadowHas: t["--kimo-selection"] as string,
        })
        c.box("No P93wB4 (highlight)", m.hlNo, { color: t["--kimo-selection"] })
        c.box("Token strong ebU7B", m.strong, {
          fw: "600",
          color: t["--kimo-text-primary"],
          fs: 11,
        })
        c.box("Token attr j9FsKJ", m.attr, { fw: "400", color: t["--kimo-text-secondary"] })
        c.box("Token punct PCwwp", m.punct, { color: t["--kimo-text-tertiary"] })
        c.box("Footer uyAuG", m.footer, { h: 33, pad: "10 12 10 12", gap: 6 })
        c.box("Live Dot zSdQk", m.dot, { w: 6, h: 6, bg: t["--kimo-success"] })
        c.box("Status CyKZV", m.status, { fs: 11, color: t["--kimo-text-tertiary"] })
        c.box("Open export link M3CVSl", m.link, { gap: 4, color: t["--kimo-text-primary"] })
        c.box("Label fAIoM", m.linkLabel, { fs: 11, fw: "500" })
        // The view fills the panel between the file tabs and the footer.
        expect(
          !!m.view && !!m.footer && Math.abs(m.view.y + m.view.h - m.footer.y) < 1,
          "code view fills down to the footer",
        )
        c.flush()
      }
      if (ctx.shots) await page.screenshot({ path: join(ctx.shots, "board25-code-tab-react.png") })

      // Line click selects the layer (the root stays).
      const subLine = await page.evaluate(() => {
        const lines = [...document.querySelectorAll(".code-tab__view .kimo-code-line")]
        return lines.findIndex((l) => l.textContent?.includes("Loom turns"))
      })
      expect(subLine > 0, "Sub's text is in the code")
      await page.locator(".code-tab__view .kimo-code-line").nth(subLine).click()
      await page.waitForFunction(() => {
        const s = (window as unknown as W).__kimo.session.ui.getState().selection
        return s.length === 1 && s[0] === "sub0000001"
      })
      expect(JSON.stringify(await selection(page)) === '["sub0000001"]', "line click selects Sub")
      expect((await page.getByTestId("code-selection-name").textContent()) === "Hero", "root kept")

      // Live: an edit regenerates (debounced 150 ms).
      await page.evaluate(() =>
        (window as unknown as W).__kimo.session.apply(
          [{ op: "update", id: "headline01", set: { content: "Plan much less." } }],
          "edit",
        ),
      )
      await page.waitForFunction(() =>
        document.querySelector(".code-tab__view")?.textContent?.includes("Plan much less."),
      )

      // (c) Tokens, remembered per file.
      await page.locator('.code-tab__switch [data-value="tokens"]').click()
      await page.waitForFunction(
        () => document.querySelector(".kimo-file-chip")?.textContent === "tokens.json",
      )
      const meta = await page.locator(".code-tab__meta").textContent()
      expect(/^\d+ used · \d+ total$/.test(meta ?? ""), `tokens meta (${meta})`)
      const remembered = await page.evaluate(() =>
        Object.entries(localStorage).find(([k]) => k.startsWith("kimo.codeTab.framework.")),
      )
      expect(
        remembered?.[1] === "tokens",
        `framework remembered per file (${JSON.stringify(remembered)})`,
      )
      await page.locator('.code-tab__switch [data-value="react"]').click()

      // (b) > 400 lines: truncated with the bar, live paused.
      await select(page, ["big0000001"])
      await page.locator(".code-tab__truncation").waitFor()
      {
        const lines = await page.locator(".code-tab__view .kimo-code-line").count()
        expect(lines === 400, `renders 400 lines (${lines})`)
        const title = await page.locator(".code-tab__truncation-title").textContent()
        expect(/^Showing 400 of [\d,]+ lines$/.test(title ?? ""), `truncation title (${title})`)
        expect(
          (await page.locator(".code-tab__status").textContent()) ===
            "Live · paused while > 400 lines",
          "live paused",
        )
        const m = await measure(page, {
          bar: ".code-tab__truncation",
          row: ".code-tab__truncation-row",
          title: ".code-tab__truncation-title",
          desc: ".code-tab__truncation-desc",
          actions: ".code-tab__truncation-actions",
          copyAll: ".code-tab__copy-all",
          copyIcon: ".code-tab__copy-all .kimo-button__icon",
          open: ".code-tab__open-export-button",
          dot: ".code-tab__dot",
        })
        const c = checker(ctx, "Code tab (b) truncation PhPBM")
        c.box("Truncation Bar PhPBM", m.bar, {
          pad: "10 12 10 12",
          gap: 8,
          bg: t["--kimo-bg-muted"],
          shadowHas: t["--kimo-border"] as string,
        })
        c.box("Row MAkcp", m.row, { gap: 8 })
        c.box("Title zsmQI", m.title, { fs: 11, fw: "600", color: t["--kimo-text-primary"] })
        c.box("Desc FPix2", m.desc, { fs: 11, color: t["--kimo-text-secondary"] })
        c.box("Actions c2iBn4", m.actions, { gap: 6 })
        c.box("Copy all SunOY", m.copyAll, { h: 24, pad: "0 10 0 10", fs: 11 })
        c.box("Copy icon hfife", m.copyIcon, { w: 12, h: 12 })
        c.box("Open export OczoZ", m.open, {
          h: 24,
          pad: "0 10 0 10",
          color: t["--kimo-text-primary"],
        })
        c.box("Live Dot n7CHs4 (paused)", m.dot, { bg: t["--kimo-text-tertiary"] })
        c.flush()
      }
      if (ctx.shots)
        await page.screenshot({ path: join(ctx.shots, "board25-code-tab-truncated.png") })

      // (e) Unsupported: a prompt.
      await select(page, ["prompt0001"])
      await page.locator(".kimo-notice").waitFor()
      {
        expect(
          (await page.locator(".kimo-notice__title").textContent()) === "Prompt nodes have no code",
          "notice title",
        )
        expect((await page.locator(".code-tab__bar").count()) === 0, "switch hidden")
        const m = await measure(page, {
          body: ".code-tab__unsupported",
          notice: ".kimo-notice",
          icon: ".kimo-notice__icon",
          title: ".kimo-notice__title",
          desc: ".kimo-notice__desc",
        })
        const c = checker(ctx, "Code tab (e) unsupported xHvmD")
        c.box("Unsupported Body SQJFF", m.body, { pad: "12 12 12 12", gap: 12 })
        c.box("Notice xHvmD", m.notice, {
          pad: "10 12 10 12",
          gap: 6,
          bg: t["--kimo-bg-subtle"],
          radius: 10,
          shadowHas: t["--kimo-border"] as string,
        })
        c.box("Icon KvAhK", m.icon, { w: 14, h: 14, color: t["--kimo-text-secondary"] })
        c.box("Title yaNnz", m.title, { fs: 12, fw: "600" })
        c.box("Desc mR95e", m.desc, { fs: 11, color: t["--kimo-text-secondary"] })
        c.flush()
      }

      // Mixed selection: the prompt leaves a one-line comment.
      await select(page, ["hero000001", "prompt0001"])
      await page.waitForFunction(() =>
        document
          .querySelector(".code-tab__view")
          ?.textContent?.includes("skipped: Prompt “Pricing brief”"),
      )

      // Open export…: the dialog opens with the framework preselected.
      await select(page, ["hero000001"])
      await page.locator('.code-tab__switch [data-value="html"]').click()
      await codeReady(page)
      await page.locator(".code-tab__open-export").click()
      await page.locator(".export-dialog").waitFor()
      expect(
        (await page.locator('.export-format[aria-checked="true"]').getAttribute("data-format")) ===
          "html",
        "Export dialog opens on HTML + CSS",
      )
      await page.keyboard.press("Escape")
    },
  },
]
