/**
 * Board 20 "M4 Gaps" (TsJoM) on the integrated app (`e2e/m4-app-harness`, memory platform):
 * the File menu (desktop A1jsC + Open recent Aw9t8), the Text section (RuAZI) bound to text node
 * fields, the desktop new-file flow (V7ey1Q), the Windows / Linux topbar and window title rule
 * (KcXQz), the "Nothing to clean up" dialog (nsxuR) and the SVG reject toasts (M4Pij9 / fW1JW).
 * Each new surface gets one measured getComputedStyle / getBoundingClientRect pass against the
 * desing.pen node values.
 */
import type { Page } from "playwright"
import { disk, harnessUrl, LOOM, readFile, SITE } from "./m4-app.e2e"
import { type E2EContext, expect, type Scenario } from "./run"

type App = {
  __kimoApp: {
    control: { calls: string[]; readFile(r: string): string | null }
    platform: {
      dialogs: { saveFile: (o: unknown) => Promise<string | null> }
      recents: { noteOpened(ref: string): Promise<void> }
    }
  }
  __kimo?: {
    session: {
      store: {
        getNode(id: string): Record<string, unknown> | undefined
        undo(o: string): unknown
      }
      apply(o: unknown): boolean
      ui: { getState(): { select(ids: string[]): void } }
    }
  }
}
declare const window: App & Window

async function openApp(ctx: E2EContext, hash: string, os?: "windows" | "linux"): Promise<void> {
  await ctx.page.setViewportSize({ width: 1440, height: 900 })
  await ctx.page.goto(`${await harnessUrl(ctx)}${os ? `?os=${os}` : ""}${hash}`)
  await ctx.page.waitForFunction(() => !!(window as unknown as App).__kimoApp)
}

async function editor(ctx: E2EContext, ref = `${SITE}/home.kimo`, os?: "windows" | "linux") {
  await openApp(ctx, disk(ref), os)
  await ctx.page.locator(".kimo-desktop-topbar").waitFor({ timeout: 15_000 })
  await ctx.page.waitForFunction(() => !!(window as unknown as App).__kimo?.session)
}

type Box = {
  x: number
  y: number
  w: number
  h: number
  display: string
  pad: number[]
  gap: number
  fs: number
  fw: string
  ff: string | undefined
  bg: string
  color: string
  radius: number
  shadow: string
  justify: string
  align: string
  style: string
}

/** getBoundingClientRect + getComputedStyle of the first match (null when absent). */
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
        display: cs.display,
        pad: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(parseFloat),
        gap: parseFloat(cs.columnGap) || parseFloat(cs.rowGap) || 0,
        fs: parseFloat(cs.fontSize),
        fw: cs.fontWeight,
        ff: cs.fontFamily.split(",")[0]?.replace(/"/g, "").trim(),
        bg: cs.backgroundColor,
        color: cs.color,
        radius: parseFloat(cs.borderTopLeftRadius),
        shadow: cs.boxShadow,
        justify: cs.justifyContent,
        align: cs.alignItems,
        style: cs.fontStyle,
      }
    }
    return out
  }, selectors) as Promise<Record<string, Box | null>>
}

/** Token value as the browser resolves it (for color comparisons). */
const token = (page: Page, name: string) =>
  page.evaluate((n) => {
    const el = document.createElement("div")
    el.style.color = `var(${n})`
    document.body.append(el)
    const c = getComputedStyle(el).color
    el.remove()
    return c
  }, name)

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

export const scenarios: Scenario[] = [
  {
    name: "board20: desktop File menu — items, anchor, pressed trigger, Open recent (measured)",
    async run(ctx) {
      const { page } = ctx
      await editor(ctx)
      // A second recent file (home.kimo was noted when it opened).
      await page.evaluate(
        (ref) => window.__kimoApp.platform.recents.noteOpened(ref),
        `${LOOM}/marketing.kimo`,
      )
      const trigger = page.locator(".kimo-desktop-breadcrumb__file")
      await trigger.click()
      const menu = page.getByTestId("file-menu")
      await menu.waitFor()
      const labels = await menu
        .locator(
          ":scope > .kimo-menu-dense__items > .kimo-menu-item-dense .kimo-menu-item-dense__label",
        )
        .allInnerTexts()
      expect(
        labels.join("|") ===
          // Board 37 Xq4V0: Back to files leads the menu.
          "Back to files|New file|Open…|Open recent|Save|Save as…|Export…|Copy selection as PNG|Reveal in Finder|Clean up assets…|Settings…",
        `desktop items: ${labels.join("|")}`,
      )
      const metas = await menu
        .locator(
          ":scope > .kimo-menu-dense__items > .kimo-menu-item-dense .kimo-menu-item-dense__meta",
        )
        .allInnerTexts()
      expect(metas.join(" ") === "⌘N ⌘O ⌘S ⇧⌘S ⇧⌘E ⇧⌘C ⌘,", `shortcuts: ${metas.join(" ")}`)
      expect(
        (await trigger.getAttribute("aria-expanded")) === "true",
        "trigger is expanded while open",
      )
      // Open recent: hover opens the submenu after 120 ms.
      await menu.getByRole("menuitem", { name: "Open recent" }).hover()
      const sub = page.getByTestId("file-menu-recent")
      await sub.waitFor({ timeout: 2000 })
      const subLabels = await sub.locator(".kimo-menu-item-dense__label").allInnerTexts()
      expect(subLabels.includes("home.kimo"), `recents: ${subLabels.join("|")}`)
      expect(subLabels[subLabels.length - 1] === "Clear recent", "Clear recent last")
      const m = await measure(page, {
        trigger: ".kimo-desktop-breadcrumb__file",
        menu: '[data-testid="file-menu"]',
        items: '[data-testid="file-menu"] > .kimo-menu-dense__items',
        item: '[data-testid="file-menu"] .kimo-menu-item-dense',
        icon: '[data-testid="file-menu"] .kimo-menu-item-dense__check--icon',
        iconSvg: '[data-testid="file-menu"] .kimo-menu-item-dense__check--icon svg',
        label: '[data-testid="file-menu"] .kimo-menu-item-dense__label',
        meta: '[data-testid="file-menu"] .kimo-menu-item-dense__meta',
        chevron: '[data-testid="file-menu"] .kimo-menu-item-dense__submenu',
        recentItem: '[data-testid="file-menu"] [aria-haspopup="menu"]',
        divider: '[data-testid="file-menu"] .kimo-menu-divider',
        sub: '[data-testid="file-menu-recent"]',
        subMeta: '[data-testid="file-menu-recent"] .kimo-menu-item-dense__meta',
        chevronIcon: ".kimo-desktop-breadcrumb__file .kimo-desktop-breadcrumb__chevron",
      })
      const { check, flush } = checker(ctx)
      const g = (k: string) => m[k] as Box
      check("File Menu A1jsC", "width", g("menu").w, 256)
      check("File Menu A1jsC", "padding", g("menu").pad.join(" "), "4 4 4 4")
      check(
        "File Menu A1jsC",
        "radius (radius-lg)",
        g("menu").radius,
        await page.evaluate(() =>
          parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue("--kimo-radius-lg"),
          ),
        ),
      )
      check("Items tn6QP", "gap", g("items").gap, 1)
      check("Anchor", "left = trigger left", g("menu").x - g("trigger").x, 0)
      check(
        "Anchor",
        "top = trigger bottom + 12",
        g("menu").y - (g("trigger").y + g("trigger").h),
        12,
      )
      check("MenuItem/Dense EAGNC", "height", g("item").h, 28)
      check("MenuItem/Dense EAGNC", "padding-x", g("item").pad[1], 8)
      check("MenuItem/Dense EAGNC", "gap", g("item").gap, 8)
      check("Check Slot Hl922 (icon)", "size", g("icon").w, 14)
      check("Icon RmOTH", "size", g("iconSvg").w, 14)
      check(
        "Icon RmOTH",
        "fill text-secondary",
        g("icon").color,
        await token(page, "--kimo-text-secondary"),
      )
      check("Label BRxvS", "font-size", g("label").fs, 12)
      check("Meta T4CD1", "font-size", g("meta").fs, 11)
      check("Meta T4CD1", "font", g("meta").ff, "JetBrains Mono")
      check("Submenu uNZcy", "size", g("chevron").w, 12)
      check("Divider jhubu", "height", g("divider").h, 9)
      check("Divider jhubu", "padding", g("divider").pad.join(" "), "4 8 4 8")
      check(
        "File gRY55 (open)",
        "fill bg-muted",
        g("trigger").bg,
        await token(page, "--kimo-bg-muted"),
      )
      check(
        "Open recent FvXLK",
        "fill bg-hover",
        g("recentItem").bg,
        await token(page, "--kimo-bg-hover"),
      )
      check("Submenu Aw9t8", "width", g("sub").w, 232)
      check("Submenu Aw9t8", "overlap 4", g("menu").x + g("menu").w - g("sub").x, 4)
      check("Submenu Aw9t8", "top = item top − 10", g("recentItem").y - g("sub").y, 10)
      check("Meta (folder)", "font", g("subMeta").ff, "JetBrains Mono")
      check(
        "Chevron X2kNTm",
        "flips up",
        (await page.locator(".kimo-desktop-breadcrumb__file svg.lucide-chevron-up").count()) === 1
          ? "up"
          : "down",
        "up",
      )
      flush()
      if (ctx.shots) await page.screenshot({ path: `${ctx.shots}/board20-file-menu.png` })
      // Settings… opens Settings (the memory host answers "window").
      await page.keyboard.press("Escape")
      await page.keyboard.press("Escape")
      await trigger.click()
      await page.getByTestId("file-menu").getByRole("menuitem", { name: "Settings…" }).click()
      await page.waitForFunction(() =>
        window.__kimoApp.control.calls.some((c) => c.startsWith("openSettings")),
      )
      // Reveal in Finder reveals the file.
      await trigger.click()
      await page
        .getByTestId("file-menu")
        .getByRole("menuitem", { name: "Reveal in Finder" })
        .click()
      await page.waitForFunction(
        (ref) => window.__kimoApp.control.calls.includes(`reveal ${ref}`),
        `${SITE}/home.kimo`,
      )
    },
  },
  {
    name: "board20: Text section — fields bound to the node, one undo per gesture, Mixed (measured)",
    async run(ctx) {
      const { page } = ctx
      await editor(ctx)
      await page.evaluate(() => window.__kimo?.session.ui.getState().select(["Headline01"]))
      const section = page.getByTestId("text-section")
      await section.waitFor()
      // Order: Layer → Position → Text → Fill (no Auto layout for text).
      const titles = await page.locator(".design-tab .kimo-prop-section__title").allInnerTexts()
      const at = (t: string) => titles.findIndex((x) => x.trim().startsWith(t))
      expect(at("Position") >= 0 && at("Text") === at("Position") + 1, `order ${titles.join(",")}`)
      expect(at("Fill") === at("Text") + 1, `Fill after Text: ${titles.join(",")}`)
      expect(at("Auto layout") < 0, "no Auto layout for text")
      const value = (label: string) =>
        section
          .getByRole("textbox", { name: label })
          .inputValue()
          .catch(() => "")
      expect(
        (await section.getByRole("button", { name: "Font family" }).innerText()).includes("Inter"),
        "font",
      )
      expect(
        (await section.getByRole("button", { name: "Font weight" }).innerText()).includes(
          "Semi Bold",
        ),
        "weight",
      )
      expect((await value("Font size")) === "28", `size ${await value("Font size")}`)
      expect((await value("Line height")) === "110%", `line height ${await value("Line height")}`)
      expect(
        (await value("Letter spacing")) === "-2%",
        `letter spacing ${await value("Letter spacing")}`,
      )
      const node = () =>
        page.evaluate(
          () => window.__kimo?.session.store.getNode("Headline01") as Record<string, unknown>,
        )
      // Case → Uppercase: style.case, content unchanged.
      await section.getByRole("radio", { name: "Uppercase" }).click()
      let n = await node()
      expect((n.style as { case?: string }).case === "upper", "case upper")
      expect(n.content === "Plan less. Ship more together.", "content keeps what was typed")
      // Size typed: one undo step.
      const size = section.getByRole("textbox", { name: "Font size" })
      await size.fill("48")
      await size.press("Enter")
      n = await node()
      expect((n.style as { size?: number }).size === 48, "size 48")
      expect(
        (await value("Letter spacing")) === "-1.17%",
        `letter spacing follows px: ${await value("Letter spacing")}`,
      )
      await page.evaluate(() => window.__kimo?.session.store.undo("user"))
      n = await node()
      expect((n.style as { size?: number }).size === 28, "one undo restores the size")
      // Vertical align is disabled unless Resizing = Fixed size.
      expect(
        await section.getByRole("radio", { name: "Align middle" }).isDisabled(),
        "valign disabled",
      )
      await section.getByRole("radio", { name: "Fixed size" }).click()
      n = await node()
      expect(n.grow === "fixed" && typeof n.h === "number", `grow fixed: ${JSON.stringify(n)}`)
      await section.getByRole("radio", { name: "Align middle" }).click()
      n = await node()
      expect((n.style as { valign?: string }).valign === "middle", "valign middle")
      // Decoration underline; Text align center.
      await section.getByRole("radio", { name: "Underline" }).click()
      await section.getByRole("radio", { name: "Align center" }).click()
      n = await node()
      expect(
        JSON.stringify((n.style as { decoration?: unknown }).decoration) === '["underline"]',
        "underline",
      )
      expect((n.style as { align?: string }).align === "center", "align center")
      // Font family row opens the Font Picker left of the panel, with the open state.
      await section.getByRole("button", { name: "Font family" }).click()
      const picker = page.locator('[data-pen="azBUI"]')
      await picker.waitFor()
      const m = await measure(page, {
        section: '[data-testid="text-section"]',
        body: '[data-testid="text-section"] .rp-body',
        family: '[data-testid="text-section"] [aria-label="Font family"]',
        weight: '[data-testid="text-section"] [aria-label="Font weight"]',
        size: '[data-testid="text-section"] .rp-field--w96',
        alignRow: '[data-testid="text-section"] .rp-text__align-row',
        align: '[data-testid="text-section"] [role="radiogroup"][aria-label="Text align"]',
        valign: '[data-testid="text-section"] [role="radiogroup"][aria-label="Vertical align"]',
        segment:
          '[data-testid="text-section"] [role="radiogroup"][aria-label="Text align"] [role="radio"]',
        caseRow: '[data-testid="text-section"] .rp-toggle-row:last-child',
        caseSeg: '[data-testid="text-section"] [role="radiogroup"][aria-label="Case"]',
        rowLabel: '[data-testid="text-section"] .rp-toggle-row__label',
        panel: ".right-panel",
        picker: '[data-pen="azBUI"]',
      })
      const { check, flush } = checker(ctx)
      const g = (k: string) => m[k] as Box
      check("Text RuAZI", "padding", g("section").pad.join(" "), "12 12 16 12")
      check("Body qgOXF", "gap", g("body").gap, 8)
      check("Font family nvXM0", "height", g("family").h, 28)
      check("Font family nvXM0", "width (fill)", g("family").w, g("body").w)
      check(
        "Font family nvXM0",
        "open fill bg-hover",
        g("family").bg,
        await token(page, "--kimo-bg-hover"),
      )
      check(
        "Font family nvXM0",
        "open stroke (inset 1px)",
        /inset/.test(g("family").shadow) ? "inset" : g("family").shadow,
        "inset",
      )
      check("Size qPc99", "width", g("size").w, 96)
      check("Weight XaZS6", "width (fill)", g("weight").w, g("body").w - 96 - 8)
      check("Align Row Z6F9a9", "justify", g("alignRow").justify, "space-between")
      check("Text align RnqeI", "width (4 × 32 + 3 × 2 + 4)", g("align").w, 138)
      check("Text align RnqeI", "height", g("align").h, 28)
      check("Text align RnqeI", "left edge", g("align").x - g("body").x, 0)
      check(
        "Vertical align rVxqw",
        "right edge",
        g("body").x + g("body").w - (g("valign").x + g("valign").w),
        0,
      )
      check("Segment T1O1N8", "size", `${g("segment").w}×${g("segment").h}`, "32×24")
      check("Case Row a5p1T9", "height", g("caseRow").h, 28)
      check("Case E5X5j7", "width", g("caseSeg").w, 138)
      check("Label bS6EX", "font-size", g("rowLabel").fs, 12)
      check(
        "Label bS6EX",
        "color text-secondary",
        g("rowLabel").color,
        await token(page, "--kimo-text-secondary"),
      )
      check(
        "Font Picker L7ksb",
        "left of the panel (gap 8)",
        g("panel").x - (g("picker").x + g("picker").w),
        8,
        1,
      )
      check("Font Picker L7ksb", "top-aligned to the row", g("picker").y - g("family").y, 0, 1)
      flush()
      if (ctx.shots) await page.screenshot({ path: `${ctx.shots}/board20-text.png` })
      await page.keyboard.press("Escape")
      // Multi-select: Mixed where the two texts differ.
      await page.evaluate(() =>
        window.__kimo?.session.ui.getState().select(["Headline01", "Caption001"]),
      )
      await page.getByTestId("text-section").waitFor()
      expect((await value("Font size")) === "Mixed", `mixed size: ${await value("Font size")}`)
      expect(
        (
          await page
            .getByTestId("text-section")
            .getByRole("button", { name: "Font weight" })
            .innerText()
        ).includes("Mixed"),
        "mixed weight",
      )
    },
  },
  {
    name: "board20: New file → untitled (Not saved, title), first ⌘S opens the save panel",
    async run(ctx) {
      const { page } = ctx
      await openApp(ctx, "#/")
      await page.getByRole("button", { name: "New file" }).first().click()
      await page.locator(".kimo-desktop-topbar").waitFor({ timeout: 15_000 })
      expect(
        decodeURIComponent(await page.evaluate(() => location.hash)).includes("untitled:"),
        "untitled route",
      )
      const crumb = (await page.locator(".kimo-desktop-breadcrumb").innerText())
        .replace(/\s+/g, " ")
        .trim()
      expect(crumb === "Untitled / Page 1", `breadcrumb: ${crumb}`)
      expect((await page.locator(".kimo-desktop-breadcrumb__folder").count()) === 0, "no folder")
      expect((await page.locator(".kimo-branch-chip").count()) === 0, "no branch")
      const status = page.locator(".kimo-save-status")
      expect((await status.getAttribute("data-status")) === "unsaved", "unsaved pill")
      expect((await status.innerText()).trim() === "Not saved", `pill: ${await status.innerText()}`)
      await page.waitForFunction(() =>
        window.__kimoApp.control.calls.includes("setTitle Untitled • not saved"),
      )
      expect((await calls(page)).includes("setDocumentEdited true"), "close-button dot")
      // ⌘S → the native save panel, pre-filled Untitled.kimo; then the file is on disk.
      await page.evaluate((ref) => {
        const d = window.__kimoApp.platform.dialogs
        d.saveFile = async (o) => {
          ;(window as unknown as { __asked?: unknown }).__asked = o
          return ref
        }
      }, `${LOOM}/landing.kimo`)
      await page.locator(".editor__canvas").click({ position: { x: 600, y: 400 } })
      await page.keyboard.press("Meta+s")
      await page.waitForFunction(
        () =>
          (window as unknown as { __asked?: { suggestedName?: string } }).__asked?.suggestedName ===
          "Untitled.kimo",
      )
      await page.waitForFunction(
        () => document.querySelector(".kimo-save-status")?.getAttribute("data-status") === "saved",
        undefined,
        { timeout: 10_000 },
      )
      const crumb2 = (await page.locator(".kimo-desktop-breadcrumb").innerText())
        .replace(/\s+/g, " ")
        .trim()
      expect(crumb2 === "loom / landing.kimo / Page 1", `breadcrumb after save: ${crumb2}`)
      expect(!!(await readFile(page, `${LOOM}/landing.kimo`)), "written to disk")
      await page.waitForFunction(() =>
        window.__kimoApp.control.calls.includes("setTitle landing.kimo — loom"),
      )
    },
  },
  {
    name: "board20: Windows topbar (KimoLogo, padding 12, no lights) + title rule (measured)",
    async run(ctx) {
      const { page } = ctx
      await editor(ctx, `${SITE}/home.kimo`, "windows")
      const topbar = page.locator(".kimo-desktop-topbar")
      expect(
        await topbar.evaluate((e) => e.classList.contains("kimo-desktop-topbar--native")),
        "native variant",
      )
      expect((await page.locator(".kimo-traffic-lights").count()) === 0, "no traffic lights")
      await page.waitForFunction(() =>
        window.__kimoApp.control.calls.includes("setTitle home.kimo — kimo-site - Kimo"),
      )
      await page.evaluate(() =>
        window.__kimo?.session.apply({ op: "update", id: "Frame00001", set: { name: "Edited" } }),
      )
      await page.waitForFunction(() =>
        window.__kimoApp.control.calls.includes("setTitle ● home.kimo — kimo-site - Kimo"),
      )
      const m = await measure(page, {
        topbar: ".kimo-desktop-topbar",
        logo: ".kimo-desktop-topbar > .topbar__logo",
        mark: ".kimo-desktop-topbar > .topbar__logo .kimo-logo",
        crumb: ".kimo-desktop-breadcrumb",
      })
      const { check, flush } = checker(ctx)
      const g = (k: string) => m[k] as Box
      check("Topbar N1mtd", "height", g("topbar").h, 48)
      check("Topbar N1mtd", "padding", `${g("topbar").pad[1]} ${g("topbar").pad[3]}`, "12 12")
      check("Topbar N1mtd", "gap", g("topbar").gap, 8)
      check("Logo uE2vu", "size", `${g("logo").w}×${g("logo").h}`, "28×28")
      check("Logo uE2vu", "left = padding 12", g("logo").x - g("topbar").x, 12)
      // Board 26 §4 KlpS9: KimoLogo 28 (bm1JR), no plate, fill $text-primary.
      check("Logo uE2vu", "no plate", g("logo").bg, "rgba(0, 0, 0, 0)")
      check("KimoLogo bm1JR", "size", `${g("mark").w}×${g("mark").h}`, "28×28")
      check(
        "KimoLogo bm1JR",
        "fill $text-primary",
        g("mark").color,
        await token(page, "--kimo-text-primary"),
      )
      check("Breadcrumb", "after logo + gap 8", g("crumb").x - (g("logo").x + g("logo").w), 8)
      flush()
      // File menu: "Show in Explorer", Ctrl shortcuts.
      await page.locator(".kimo-desktop-breadcrumb__file").click()
      const menu = page.getByTestId("file-menu")
      await menu.getByRole("menuitem", { name: "Show in Explorer" }).waitFor()
      expect(
        (await menu.getByRole("menuitem", { name: /^Save as…/ }).innerText()).includes(
          "Shift+Ctrl+S",
        ),
        "Shift+Ctrl+S",
      )
      if (ctx.shots) await page.screenshot({ path: `${ctx.shots}/board20-windows.png` })
      // Audit G4 (board 20 r3ukd): New window sits right under New file (app-window icon, no
      // shortcut); choosing it opens another window and closes the menu.
      const labels = await menu.locator(".kimo-menu-item-dense__label").allInnerTexts()
      const at = labels.indexOf("New file")
      expect(
        labels.slice(at, at + 3).join("|") === "New file|New window|Open…",
        `order: ${labels.join("|")}`,
      )
      const nw = menu.getByRole("menuitem", { name: "New window" })
      const nwBox = await measure(page, {
        item: '[data-testid="file-menu"] .file-menu__new-window',
        icon: '[data-testid="file-menu"] .file-menu__new-window .kimo-menu-item-dense__check--icon svg',
      })
      const nwc = checker(ctx)
      nwc.check("Item · New window", "height", (nwBox.item as Box).h, 28)
      nwc.check("Item · New window", "icon 14", (nwBox.icon as Box).w, 14)
      nwc.flush()
      expect(
        (await nw.locator(".kimo-menu-item-dense__meta").count()) === 0,
        "New window has no shortcut",
      )
      expect((await nw.locator("svg.lucide-app-window").count()) === 1, "app-window icon")
      await nw.click()
      await page.waitForFunction(() => window.__kimoApp.control.calls.includes("openNewWindow"))
      await menu.waitFor({ state: "detached" })
    },
  },
  {
    name: "board20: Clean up assets with nothing unused → Nothing to clean up (measured)",
    async run(ctx) {
      const { page } = ctx
      await editor(ctx)
      await page.locator(".kimo-desktop-breadcrumb__file").click()
      await page
        .getByTestId("file-menu")
        .getByRole("menuitem", { name: "Clean up assets…" })
        .click()
      const dialog = page.getByRole("dialog", { name: "Nothing to clean up" })
      await dialog.waitFor({ timeout: 5000 })
      expect((await dialog.getByRole("button").allInnerTexts()).join("|") === "Done", "single Done")
      const desc = await dialog.locator(".kimo-dialog__desc").innerText()
      expect(
        desc ===
          "Every asset is in use. Each file in assets/ is referenced by a node, fill, component or variable in home.kimo.",
        `desc: ${desc}`,
      )
      const m = await measure(page, {
        dialog: '[data-pen="nsxuR"]',
        wrap: '[data-pen="nsxuR"] .kimo-dialog__icon-wrap',
        body: '[data-pen="nsxuR"] .gc-nothing',
        icon: '[data-pen="nsxuR"] .gc-nothing__icon',
        summary: '[data-pen="nsxuR"] .gc-nothing__summary',
        state: '[data-pen="nsxuR"] .gc-nothing__state',
      })
      const { check, flush } = checker(ctx)
      const g = (k: string) => m[k] as Box
      check("Dialog nsxuR", "width", g("dialog").w, 520)
      check(
        "Icon Wrap nlNhT",
        "fill success-soft",
        g("wrap").bg,
        await token(page, "--kimo-success-soft"),
      )
      check("Icon rhvD9", "fill success", g("wrap").color, await token(page, "--kimo-success"))
      check("Body n3opt", "height", g("body").h, 36)
      check("Body n3opt", "padding-x", g("body").pad[1], 12)
      check("Body n3opt", "gap", g("body").gap, 10)
      check("Body n3opt", "fill bg-subtle", g("body").bg, await token(page, "--kimo-bg-subtle"))
      check("Icon RlSDk", "size", g("icon").w, 14)
      check("Summary ypJj1", "font-size", g("summary").fs, 11)
      check(
        "State H6GIOG",
        "color text-tertiary",
        g("state").color,
        await token(page, "--kimo-text-tertiary"),
      )
      flush()
      await page.keyboard.press("Escape")
      await dialog.waitFor({ state: "detached" })
    },
  },
  {
    name: "board20: an SVG with a script is not imported silently — Toast/Danger with Details",
    async run(ctx) {
      const { page } = ctx
      await editor(ctx)
      await page.locator(".editor__canvas").click({ position: { x: 900, y: 600 } })
      await page.evaluate(() => {
        const dt = new DataTransfer()
        dt.setData(
          "text/plain",
          '<svg xmlns="http://www.w3.org/2000/svg">\n<path d="M0 0L1 1"/>\n<script>alert(1)</script>\n</svg>',
        )
        window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }))
      })
      const toast = page.locator('[data-testid="svg-rejection-toast"] .kimo-toast', {
        hasText: "Couldn't import",
      })
      await toast.waitFor({ timeout: 5000 })
      const text = (await toast.innerText()).replace(/\s+/g, " ")
      expect(text.includes(": it contains a script"), `toast: ${text}`)
      expect((await toast.getAttribute("data-tone")) === "danger", "Toast/Danger")
      // Board 24 (j): Details grows the toast in place into the removed-items list.
      await toast.getByRole("button", { name: "Details" }).click()
      const row = page.locator(".kimo-svg-rejection__reason").first()
      await row.waitFor({ timeout: 5000 })
      expect(
        (await row.innerText()).replace(/\s+/g, " ").trim() ===
          "L3 <script> scripts are never imported",
        `row: ${await row.innerText()}`,
      )
    },
  },
]
