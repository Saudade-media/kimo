/**
 * Board 25 "v1 Polish" §6 small states (GF9SG) on the integrated app (`e2e/m4-app-harness`,
 * memory platform): (a) close prompt 400 (AyYDq), (b) link popover invalid URL (u0adcp),
 * (c) SVG rejection "+N more" at 360 (J30Nk / fj8Nh), (d) OpenType font support — "not in font"
 * row (LFdEa) + hint (x9tphT), (e) "Ready to commit" success banner → "Copied" (tzFIU / LsjRG),
 * (f) no "Abort merge" (aEUZq). One measured getComputedStyle / getBoundingClientRect pass per
 * surface against the desing.pen node values.
 */
import {
  type App,
  checker,
  editor,
  measure,
  openApp,
  selectHeadline,
  style,
  token,
} from "./board24-gaps.e2e"
import { LOOM } from "./m4-app.e2e"
import { type E2EContext, expect, type Scenario } from "./run"

declare const window: App & Window

async function shot(ctx: E2EContext, name: string) {
  if (ctx.shots) await ctx.page.screenshot({ path: `${ctx.shots}/board25-${name}.png` })
}

export const scenarios: Scenario[] = [
  {
    name: "board25-small (a): close prompt — 400 px quick confirm, one-line title (measured)",
    async run(ctx) {
      const { page } = ctx
      await openApp(ctx, "#/")
      const ref = await page.evaluate(
        async () => (await window.__kimoApp.manager.newUntitled()).ref,
      )
      await page.evaluate((r) => {
        location.hash = `#/disk/${encodeURIComponent(r)}`
      }, ref)
      await page.locator(".kimo-desktop-topbar").waitFor({ timeout: 15_000 })
      await page.waitForFunction(() => !!(window as unknown as App).__kimo?.session)
      await page.evaluate(() =>
        (window as unknown as App).__kimo?.session.store.apply(
          { op: "insert", id: "Frame00001", node: { type: "frame", name: "A", w: 10, h: 10 } },
          { origin: "user" },
        ),
      )
      await page.evaluate(() => {
        void window.__kimoApp.control.requestClose()
      })
      await page.getByTestId("close-prompt").waitFor()
      const m = await measure(page, {
        dialog: ".kimo-close-prompt",
        title: ".kimo-close-prompt__title",
        icon: ".kimo-close-prompt__icon-wrap svg",
      })
      const ws = await page.evaluate(
        () =>
          getComputedStyle(document.querySelector(".kimo-close-prompt__title") as Element)
            .whiteSpace,
      )
      const { check, flush } = checker(ctx, "Dialog · Close untitled · 400 (AyYDq)")
      check("Dialog AyYDq", "width", m.dialog?.w, 400)
      check("Dialog AyYDq", "padding", m.dialog?.pad[0], 20)
      check("Dialog AyYDq", "gap", m.dialog?.gap, 14)
      check("Title Dvraw", "one line (height)", m.title?.h, 16)
      check("Title Dvraw", "white-space", ws, "nowrap")
      check("Title Dvraw", "font", `${m.title?.ff} ${m.title?.fs} ${m.title?.fw}`, "Inter 13 600")
      check("Icon CUoPS", "size", m.icon?.w, 16)
      flush()
      await shot(ctx, "close-prompt")
      await page.keyboard.press("Escape")
    },
  },
  {
    name: "board25-small (b): link popover — invalid URL error in place, Open + Apply 40 %, Enter ignored (measured)",
    async run(ctx) {
      const { page } = ctx
      await editor(ctx)
      await selectHeadline(page)
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
      await page.keyboard.press("Meta+k")
      const pop = page.getByTestId("text-link-popover")
      await pop.waitFor()
      const field = page.getByRole("textbox", { name: "Link URL" })
      // Valid state first: the hint's position (no layout jump when it turns into the error).
      await field.fill("https://kimo.design")
      await page.waitForTimeout(300)
      const before = await measure(page, { hint: ".kimo-link-popover__hint" })
      await field.fill("javascript:alert(1)")
      // Validation runs 250 ms after input.
      const t0 = Date.now()
      await pop.locator(".kimo-link-popover__hint--error").waitFor()
      const waited = Date.now() - t0
      const m = await measure(page, {
        field: ".kimo-link-popover__field",
        fieldIcon: ".kimo-link-popover__field .kimo-input__icon",
        hint: ".kimo-link-popover__hint",
        hintIcon: ".kimo-link-popover__hint-icon",
        hintText: ".kimo-link-popover__hint-text",
        open: ".kimo-link-popover__actions .kimo-button--ghost",
        apply: ".kimo-link-popover__actions .kimo-button--primary",
      })
      const align = await page.evaluate(
        () =>
          getComputedStyle(document.querySelector(".kimo-link-popover__hint") as Element)
            .alignItems,
      )
      const text = await pop.locator(".kimo-link-popover__hint-text").innerText()
      const danger = await token(page, "--kimo-danger")
      const { check, flush } = checker(ctx, "Popover · Link · invalid (u0adcp)")
      check("validation", "delay ≥ ~250 ms", waited >= 150 ? 1 : 0, 1)
      check("Field rWPuM", "fill bg-app", m.field?.bg, await token(page, "--kimo-bg-app"))
      check("Field rWPuM", "stroke danger", m.field?.shadow.includes(danger) ? 1 : 0, 1)
      check("Field icon mU4b8", "color danger", m.fieldIcon?.color, danger)
      check("Field rWPuM", "height", m.field?.h, 30)
      check("Hint UuqA2", "same y (no jump)", m.hint?.y, before.hint?.y ?? -1)
      check("Hint UuqA2", "gap", m.hint?.gap, 6)
      check("Hint UuqA2", "align (top)", align, "flex-start")
      check("Hint icon noWDA", "circle-alert 12", m.hintIcon?.w, 12)
      check("Hint icon noWDA", "color danger", m.hintIcon?.color, danger)
      check(
        "Hint text gSRzU",
        "copy",
        text,
        "Not a supported link. Use http(s), mailto:, tel: or a #frame anchor.",
      )
      check("Hint text gSRzU", "color danger", m.hintText?.color, danger)
      check("Hint text gSRzU", "font-size", m.hintText?.fs, 11)
      check("Hint text gSRzU", "line-height 1.4", m.hintText?.lh, 15.4)
      check("Hint text gSRzU", "width (fill)", m.hintText?.w, 258)
      check("Hint text gSRzU", "2 lines", m.hintText?.h, 30.8, 1)
      check("Open qY3dm", "opacity", m.open?.opacity, 0.4, 0.01)
      check("Apply GlEuf", "opacity", m.apply?.opacity, 0.4, 0.01)
      flush()
      expect(await pop.getByRole("button", { name: "Apply" }).isDisabled(), "Apply disabled")
      expect(await pop.getByRole("button", { name: "Open" }).isDisabled(), "Open disabled")
      await shot(ctx, "link-invalid")
      // Enter is ignored: the popover stays, nothing applied.
      await field.press("Enter")
      await page.waitForTimeout(100)
      expect((await pop.count()) === 1, "popover stays on Enter")
      expect((await style(page)).href === undefined, "no href applied")
      // No scheme is not an error: auto-prefixed https:// on apply.
      await field.fill("pricing.com")
      await pop.locator(".kimo-link-popover__hint--error").waitFor({ state: "detached" })
      await field.press("Enter")
      await pop.waitFor({ state: "detached" })
      expect((await style(page)).href === "https://pricing.com", "prefixed https://")
    },
  },
  {
    name: "board25-small (c): SVG rejection — 360 px, 5 rows + '+N more' (measured)",
    async run(ctx) {
      const { page } = ctx
      await editor(ctx)
      await page.locator(".editor__canvas").click({ position: { x: 900, y: 600 } })
      await page.evaluate(() => {
        const dt = new DataTransfer()
        const lines = ['<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">']
        for (let i = 0; i < 8; i++) lines.push(`<script>a${i}()</script>`)
        lines.push("</svg>")
        dt.setData("text/plain", lines.join("\n"))
        window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }))
      })
      const host = page.getByTestId("svg-rejection-toast")
      await host.locator(".kimo-toast").waitFor({ timeout: 5000 })
      const collapsed = await host.locator(".kimo-toast").boundingBox()
      await host.getByRole("button", { name: "Details" }).click()
      const panel = host.locator(".kimo-svg-rejection")
      await panel.waitFor()
      const rows = await panel.locator(".kimo-svg-rejection__code").count()
      const more = (await panel.locator(".kimo-svg-rejection__more").innerText()).replace(
        /\s+/g,
        " ",
      )
      const m = await measure(page, {
        panel: ".kimo-svg-rejection",
        reason: ".kimo-svg-rejection__reason",
        code: ".kimo-svg-rejection__code",
        more: ".kimo-svg-rejection__more",
        indent: ".kimo-svg-rejection__indent",
        count: ".kimo-svg-rejection__more-count",
        why: ".kimo-svg-rejection__more-why",
      })
      const links = await panel
        .locator(".kimo-svg-rejection__more a, .kimo-svg-rejection__more button")
        .count()
      const { check, flush } = checker(ctx, "Toast · expanded · 360 (J30Nk)")
      check("Toast J30Nk", "width", m.panel?.w, 360)
      check("Toast (collapsed)", "max 360", (collapsed?.width ?? 999) <= 360 ? 1 : 0, 1)
      check("Reasons i32Xb", "rows (MAX_REASON_ROWS)", rows, 5)
      check("More fj8Nh", "text", more.trim(), "+3 more in the copied report")
      check("More fj8Nh", "not a link", links, 0)
      check("More fj8Nh", "height", m.more?.h, 21)
      check("More fj8Nh", "padding", `${m.more?.pad[0]} ${m.more?.pad[3]}`, "4 12")
      check("More fj8Nh", "gap", m.more?.gap, 8)
      check("Indent p9n3w", "width", m.indent?.w, 24)
      check("Count S2qmIK", "x = code column", m.count?.x, m.code?.x ?? -1)
      check("Count S2qmIK", "font", `${m.count?.ff} ${m.count?.fs} ${m.count?.fw}`, "Inter 11 500")
      check("Count S2qmIK", "color", m.count?.color, await token(page, "--kimo-text-primary"))
      check("Why RycdF", "font", `${m.why?.ff} ${m.why?.fs} ${m.why?.fw}`, "Inter 11 400")
      check("Why RycdF", "color", m.why?.color, await token(page, "--kimo-text-tertiary"))
      check("Toast J30Nk", "height", m.panel?.h, 224, 1)
      flush()
      await shot(ctx, "svg-more")
      await panel.getByRole("button", { name: "Cancel" }).click()
    },
  },
  {
    name: "board25-small (d): OpenType — 'not in font' row and font-support hint from the face's GSUB/GPOS (measured)",
    async run(ctx) {
      const { page } = ctx
      await editor(ctx)
      // Headline01 is Inter 600 (bundled Inter SemiBold: has tnum, lacks ss02 / zero).
      await page.evaluate(() => {
        const s = (window as unknown as App).__kimo?.session
        const st = (s?.store.getNode("Headline01")?.style ?? {}) as Record<string, unknown>
        s?.store.apply(
          { op: "update", id: "Headline01", set: { style: { ...st, features: { ss02: true } } } },
          { origin: "user" },
        )
      })
      await selectHeadline(page)
      await page.getByRole("button", { name: "More text options" }).click()
      const menu = page.getByTestId("text-more-menu")
      await menu.waitFor()
      const row = menu.locator('.kimo-ot-feature-row[data-tag="ss02"]')
      await row.locator(".kimo-ot-feature-row__support").waitFor({ timeout: 5000 })
      const m = await measure(page, {
        row: '.kimo-ot-feature-row[data-tag="ss02"]',
        check: '.kimo-ot-feature-row[data-tag="ss02"] .kimo-ot-feature-row__check',
        tag: '.kimo-ot-feature-row[data-tag="ss02"] .kimo-ot-feature-row__tag',
        support: '.kimo-ot-feature-row[data-tag="ss02"] .kimo-ot-feature-row__support',
        remove: '.kimo-ot-feature-row[data-tag="ss02"] .kimo-ot-feature-row__remove',
        item: '[data-testid="text-more-menu"] .kimo-menu-item-dense[data-tag="liga"]',
        itemCheck: '[data-testid="text-more-menu"] .kimo-menu-item-dense[data-tag="liga"] svg',
      })
      const supportText = await row.locator(".kimo-ot-feature-row__support").innerText()
      const tertiary = await token(page, "--kimo-text-tertiary")
      const { check, flush } = checker(ctx, "Feature · ss02 (custom, not in font) (LFdEa)")
      check("Row LFdEa", "gap", m.row?.gap, 8)
      check("Row LFdEa", "height (menu item box)", m.row?.h, 28)
      check("Check FVAKK", "size", m.check?.w, 14)
      check("Check FVAKK", "x = items' check column", m.check?.x, m.itemCheck?.x ?? -1)
      check("Check FVAKK", "color", m.check?.color, await token(page, "--kimo-text-primary"))
      check("Tag G7TNL", "font", `${m.tag?.ff} ${m.tag?.fs} ${m.tag?.fw}`, "JetBrains Mono 11 500")
      check("Tag G7TNL", "x (check + 8)", (m.tag?.x ?? 0) - ((m.check?.x ?? 0) + 14), 8)
      check("Support uM7QP", "copy", supportText, "not in font")
      check(
        "Support uM7QP",
        "font",
        `${m.support?.ff} ${m.support?.fs} ${m.support?.fw}`,
        "Inter 11 400",
      )
      check("Support uM7QP", "color tertiary", m.support?.color, tertiary)
      check("Remove ercGd", "size", m.remove?.w, 12)
      check("Remove ercGd", "color", m.remove?.color, tertiary)
      check(
        "Remove ercGd",
        "right edge = item right − 8",
        (m.row?.x ?? 0) + (m.row?.w ?? 0) - ((m.remove?.x ?? 0) + (m.remove?.w ?? 0)),
        8,
      )
      // Custom tag hint (x9tphT): checked against the resolved font.
      await menu.getByRole("menuitemradio", { name: /Custom tag/ }).click()
      const block = page.getByTestId("text-custom-tag")
      await block.waitFor()
      const tagField = page.getByRole("textbox", { name: "OpenType tag" })
      const hint = block.locator(".kimo-custom-tag__hint")
      await tagField.fill("zero")
      const zero = await hint.innerText()
      const hm = await measure(page, { hint: ".kimo-custom-tag__hint", block: ".kimo-custom-tag" })
      check(
        "Hint x9tphT",
        "not in font copy",
        zero,
        "zero isn't in Inter. It's saved but has no effect",
      )
      check("Hint x9tphT", "color tertiary (never warning)", hm.hint?.color, tertiary)
      check("Hint x9tphT", "font-size", hm.hint?.fs, 11)
      check("Hint x9tphT", "line-height 1.4", hm.hint?.lh, 15.4)
      check("Hint x9tphT", "width fill", hm.hint?.w, hm.block?.w ?? -1)
      await tagField.fill("tnum")
      check("Hint", "in font copy", await hint.innerText(), "tnum is in Inter")
      flush()
      await shot(ctx, "opentype-not-in-font")
      // Not in font → still allowed and saved.
      await tagField.fill("zero")
      await block.getByRole("button", { name: "Add" }).click()
      await page.waitForFunction(
        () =>
          (
            (window as unknown as App).__kimo?.session.store.getNode("Headline01")?.style as {
              features?: { zero?: boolean }
            }
          )?.features?.zero === true,
      )
    },
  },
  {
    name: "board25-small (e)(f): 'Ready to commit' on success-soft → Copied, stays; × hides; no Abort merge (measured)",
    async run(ctx) {
      const { page } = ctx
      await editor(ctx, `${LOOM}/marketing.kimo`)
      await page.evaluate((root) => {
        window.__kimoApp.control.setGit(
          root,
          {
            branch: "feature/pricing",
            head: "abc",
            operation: "merge",
            indexLocked: false,
            fileStatus: "conflict",
            changedCount: 1,
          },
          { kind: "operation-started", operation: "merge" },
        )
      }, LOOM)
      const banner = page.locator(".kimo-banner")
      await page.waitForFunction(
        () =>
          document.querySelector(".kimo-banner")?.getAttribute("data-banner") === "merge-conflicts",
        undefined,
        { timeout: 10_000 },
      )
      // (f) aEUZq: no Abort merge — not even disabled.
      expect(
        (await page.getByRole("button", { name: /Abort merge/i }).count()) === 0,
        "no Abort merge",
      )
      await page.evaluate(
        (r) => window.__kimoApp.manager.get(r)?.conflicts?.chooseAll("ours"),
        `${LOOM}/marketing.kimo`,
      )
      await banner.getByRole("button", { name: "Save", exact: true }).click()
      await page.waitForFunction(
        () => document.querySelector(".kimo-banner")?.getAttribute("data-banner") === "merge-ready",
        undefined,
        { timeout: 10_000 },
      )
      expect(
        (await page.getByRole("button", { name: /Abort merge/i }).count()) === 0,
        "no Abort merge",
      )
      const body = await banner.locator(".kimo-banner__body").innerText()
      expect(/^\d+ conflicts? resolved and saved to marketing\.kimo\.$/.test(body), body)
      const m = await measure(page, {
        banner: ".kimo-banner",
        icon: ".kimo-banner__icon",
        title: ".kimo-banner__title",
        secondary: '.kimo-banner__action[data-action="review-changes"]',
        primary: '.kimo-banner__action[data-action="copy-commit-command"]',
        dismiss: ".kimo-banner__dismiss",
      })
      const { check, flush } = checker(ctx, "Banner · Ready to commit (tzFIU / LsjRG)")
      check(
        "Banner tzFIU",
        "fill success-soft",
        m.banner?.bg,
        await token(page, "--kimo-success-soft"),
      )
      check("Banner tzFIU", "padding", m.banner?.pad.join(" "), "8 8 8 16")
      check("Banner tzFIU", "gap", m.banner?.gap, 10)
      check("Icon AClzz", "size", m.icon?.w, 16)
      check("Icon AClzz", "color success", m.icon?.color, await token(page, "--kimo-success"))
      check("Title HRUqU", "font", `${m.title?.fs} ${m.title?.fw}`, "12 600")
      check(
        "Secondary DW6X8",
        "label",
        await banner.locator('[data-action="review-changes"]').innerText(),
        "Review changes",
      )
      check("Secondary DW6X8", "height", m.secondary?.h, 28)
      check(
        "Secondary DW6X8",
        "color text-primary",
        m.secondary?.color,
        await token(page, "--kimo-text-primary"),
      )
      check(
        "Primary wGTB1",
        "label",
        await banner.locator('[data-action="copy-commit-command"]').innerText(),
        "Commit in terminal…",
      )
      check("Primary wGTB1", "height", m.primary?.h, 28)
      check("Primary wGTB1", "padding-x", m.primary?.pad[1], 12)
      check("Dismiss tXBEc", "size", m.dismiss?.w, 24)
      await shot(ctx, "ready-to-commit")
      await page
        .context()
        .grantPermissions(["clipboard-read", "clipboard-write"])
        .catch(() => {})
      await banner.locator('[data-action="copy-commit-command"]').click()
      await page.waitForFunction(() =>
        document
          .querySelector('[data-action="copy-commit-command"]')
          ?.textContent?.includes("Copied"),
      )
      const copied = await measure(page, {
        icon: '.kimo-banner__action[data-action="copy-commit-command"] .kimo-button__icon',
        primary: '.kimo-banner__action[data-action="copy-commit-command"]',
      })
      check("Primary wGTB1 (copied)", "check icon", copied.icon?.w, 14)
      check(
        "Primary wGTB1 (copied)",
        "icon color on-accent",
        copied.icon?.color,
        await token(page, "--kimo-on-accent"),
      )
      check(
        "Body x6Z0vQ (copied)",
        "copy",
        await banner.locator(".kimo-banner__body").innerText(),
        "Copied 'git add marketing.kimo && git commit'. Run it in your terminal.",
      )
      flush()
      await shot(ctx, "ready-to-commit-copied")
      expect((await page.locator('.kimo-banner[data-banner="merge-ready"]').count()) === 1, "stays")
      // × hides until the next git change.
      await banner.getByRole("button", { name: "Dismiss" }).click()
      await page.locator('.kimo-banner[data-banner="merge-ready"]').waitFor({ state: "detached" })
      await page.evaluate((root) => {
        window.__kimoApp.control.setGit(
          root,
          {
            branch: "feature/pricing",
            head: "abc",
            operation: "merge",
            indexLocked: false,
            fileStatus: "modified",
            changedCount: 2,
          },
          { kind: "index-changed" } as never,
        )
      }, LOOM)
      await page.locator('.kimo-banner[data-banner="merge-ready"]').waitFor({ timeout: 5000 })
    },
  },
]
