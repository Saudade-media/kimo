/**
 * Board 21 "Text section · “…” menu" (N6MWL) on the integrated app (`e2e/m4-app-harness`):
 * the pressed header action, Menu/Dense ndO4D (Italic ⌘I, Link… ⌘K, OpenType features, Stylistic
 * sets submenu, Custom tag…, Reset text style), the Italic row (G0AWh7) and the Features chips row
 * (SE1Ap), each bound to the text node's `style` fields. One measured pass against the nodes.
 */
import type { Page } from "playwright"
import { disk, harnessUrl, SITE } from "./m4-app.e2e"
import { type E2EContext, expect, type Scenario } from "./run"

type K = {
  __kimo?: {
    session: {
      store: { getNode(id: string): Record<string, unknown> | undefined }
      ui: { getState(): { select(ids: string[]): void } }
    }
  }
}
declare const window: K & Window

async function editor(ctx: E2EContext) {
  await ctx.page.setViewportSize({ width: 1440, height: 900 })
  await ctx.page.goto(`${await harnessUrl(ctx)}${disk(`${SITE}/home.kimo`)}`)
  await ctx.page.locator(".kimo-desktop-topbar").waitFor({ timeout: 15_000 })
  await ctx.page.waitForFunction(() => !!(window as unknown as K).__kimo?.session)
  await ctx.page.evaluate(() =>
    (window as unknown as K).__kimo?.session.ui.getState().select(["Headline01"]),
  )
  await ctx.page.getByTestId("text-section").waitFor()
  await ctx.page.evaluate(() => document.fonts.ready)
}

const style = (page: Page) =>
  page.evaluate(
    () =>
      ((window as unknown as K).__kimo?.session.store.getNode("Headline01")?.style ?? {}) as Record<
        string,
        unknown
      >,
  )

function measure(page: Page, sels: Record<string, string>) {
  return page.evaluate((s) => {
    const out: Record<
      string,
      {
        x: number
        y: number
        w: number
        h: number
        pad: string
        gap: number
        fs: number
        ff: string
        bg: string
        color: string
        radius: number
        fw: string
      } | null
    > = {}
    for (const [k, sel] of Object.entries(s)) {
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
        pad: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft]
          .map((v) => parseFloat(v))
          .join(" "),
        gap: parseFloat(cs.columnGap) || 0,
        fs: parseFloat(cs.fontSize),
        ff: cs.fontFamily.split(",")[0]?.replace(/"/g, "").trim() ?? "",
        bg: cs.backgroundColor,
        color: cs.color,
        radius: parseFloat(cs.borderTopLeftRadius),
        fw: cs.fontWeight,
      }
    }
    return out
  }, sels)
}

const token = (page: Page, name: string, prop: "color" | "backgroundColor" = "color") =>
  page.evaluate(
    ([n, p]) => {
      const el = document.createElement("div")
      el.style[p as "color"] = `var(${n})`
      document.body.append(el)
      const c = getComputedStyle(el)[p as "color"]
      el.remove()
      return c
    },
    [name, prop] as const,
  )

function table(ctx: E2EContext, surface: string) {
  const rows: string[] = []
  const check = (el: string, prop: string, got: unknown, want: number | string, tol = 0.75) => {
    const ok =
      typeof want === "number"
        ? typeof got === "number" && Math.abs(got - want) <= tol
        : got === want
    rows.push(
      `    | ${el} | ${prop} | ${want} | ${typeof got === "number" ? Math.round(got * 100) / 100 : got} | ${ok ? "=" : "≠"} |`,
    )
    expect(ok, `${surface} › ${el} ${prop}: want ${want}, got ${got}`)
  }
  const flush = () =>
    ctx.log(
      `\n    ${surface}\n    | element | property | design | measured | |\n    |---|---|---|---|---|\n${rows.join("\n")}`,
    )
  return { check, flush }
}

const openMenu = async (page: Page) => {
  await page.getByTestId("text-section").getByRole("button", { name: "More text options" }).click()
  await page.getByTestId("text-more-menu").waitFor()
}

export const scenarios: Scenario[] = [
  {
    name: "m5-text: “…” menu (ndO4D) layout, features toggles, chips row, stylistic sets, custom tag; measured",
    async run(ctx) {
      const { page } = ctx
      await editor(ctx)
      await openMenu(page)
      const menu = page.getByTestId("text-more-menu")
      const labels = await menu.locator(".kimo-menu-item-dense__label").allInnerTexts()
      expect(
        labels.join("|") ===
          "Italic|Link…|Standard ligatures|Contextual alternates|Tabular numbers|Slashed zero|Small caps|Fractions|Stylistic sets|Custom tag…|Reset text style",
        labels.join("|"),
      )
      const metas = await menu.locator(".kimo-menu-item-dense__meta").allInnerTexts()
      expect(
        metas.join("|") === "⌘I|⌘K|liga|calt|tnum|zero|smcp|frac|ss01–20 ›|tag = n",
        metas.join("|"),
      )
      const groups = await menu.locator(".rp-text-menu__group-label").allInnerTexts()
      expect(groups.join("|") === "Style|OpenType features", "group labels")
      const checked = await menu
        .locator("[aria-checked=true] .kimo-menu-item-dense__label")
        .allInnerTexts()
      expect(
        checked.join("|") === "Standard ligatures|Contextual alternates",
        `defaults checked: ${checked}`,
      )

      const muted = await token(page, "--kimo-bg-muted", "backgroundColor")
      const primary = await token(page, "--kimo-text-primary")
      const tertiary = await token(page, "--kimo-text-tertiary")
      const t = table(ctx, "Text “…” menu (n2stOD › ndO4D, COwZb)")
      // Hover-free state for the measured pass: focus the first item (Italic) like the vignette.
      const m = await measure(page, {
        action: '[data-testid="text-section"] .kimo-prop-section__action',
        menu: '[data-testid="text-more-menu"]',
        group: '[data-testid="text-more-menu"] .rp-text-menu__group',
        groupLabel: '[data-testid="text-more-menu"] .rp-text-menu__group-label',
        item: '[data-testid="text-more-menu"] .kimo-menu-item-dense',
        liga: '[data-testid="text-more-menu"] [data-tag="liga"]',
        ligaCheck:
          '[data-testid="text-more-menu"] [data-tag="liga"] .kimo-menu-item-dense__check svg',
        ligaLabel: '[data-testid="text-more-menu"] [data-tag="liga"] .kimo-menu-item-dense__label',
        meta: '[data-testid="text-more-menu"] [data-tag="liga"] .kimo-menu-item-dense__meta',
        divider: '[data-testid="text-more-menu"] .kimo-menu-divider',
      })
      t.check("Action (COwZb) pressed", "w", m.action?.w, 20)
      t.check("Action (COwZb) pressed", "h", m.action?.h, 20)
      t.check("Action (COwZb) pressed", "background", m.action?.bg, muted)
      t.check("Action (COwZb) pressed", "radius", m.action?.radius, 6)
      t.check("Action (COwZb) pressed", "color", m.action?.color, primary)
      t.check("Menu (ndO4D)", "w", m.menu?.w, 256)
      t.check(
        "Menu (ndO4D)",
        "right = action right",
        (m.menu?.x ?? 0) + (m.menu?.w ?? 0),
        (m.action?.x ?? 0) + (m.action?.w ?? 0),
        1,
      )
      t.check("Menu (ndO4D)", "padding", m.menu?.pad, "4 4 4 4")
      t.check("Group Label · Style (b22Odo)", "padding", m.group?.pad, "6 8 2 30")
      t.check(
        "Label (M9xs3)",
        "font",
        `${m.groupLabel?.ff} ${m.groupLabel?.fs}`,
        "JetBrains Mono 11",
      )
      t.check("Label (M9xs3)", "color", m.groupLabel?.color, tertiary)
      t.check("MenuItem/Dense (EAGNC)", "h", m.item?.h, 28)
      t.check("liga (u0As6w)", "check visible", m.ligaCheck?.w, 14)
      t.check("liga (u0As6w)", "background (no fill)", m.liga?.bg, "rgba(0, 0, 0, 0)")
      t.check("liga label", "weight", m.ligaLabel?.fw, "400")
      t.check("Meta (T4CD1)", "font", `${m.meta?.ff} ${m.meta?.fs}`, "JetBrains Mono 11")
      t.check("Menu/Divider (b4qJb)", "padding", m.divider?.pad, "4 8 4 8")
      t.flush()

      // Toggle tnum on, liga off (writes false).
      await menu.locator('[data-tag="tnum"]').click()
      await page.waitForFunction(
        () =>
          (
            (window as unknown as K).__kimo?.session.store.getNode("Headline01")?.style as {
              features?: { tnum?: boolean }
            }
          )?.features?.tnum === true,
      )
      await menu.locator('[data-tag="liga"]').click()
      await page.waitForFunction(
        () =>
          (
            (window as unknown as K).__kimo?.session.store.getNode("Headline01")?.style as {
              features?: { liga?: boolean }
            }
          )?.features?.liga === false,
      )
      // Stylistic sets submenu → ss01.
      await menu.getByRole("menuitemradio", { name: /Stylistic sets/ }).click()
      const sets = page.getByTestId("text-sets-menu")
      await sets.waitFor()
      expect((await sets.locator("[role=menuitemradio]").count()) === 20, "ss01–ss20")
      await sets.getByRole("menuitemradio", { name: "ss01" }).click()
      await page.waitForFunction(
        () =>
          (
            (window as unknown as K).__kimo?.session.store.getNode("Headline01")?.style as {
              features?: { ss01?: boolean }
            }
          )?.features?.ss01 === true,
      )
      await page.keyboard.press("Escape")
      // Custom tag… (board 24 b Ehror: expands inline) → salt = 2.
      await menu.getByRole("menuitemradio", { name: /Custom tag/ }).click()
      await page.getByRole("textbox", { name: "OpenType tag" }).fill("salt")
      await page.getByRole("textbox", { name: "Feature value" }).fill("2")
      await page.keyboard.press("Enter")
      await page.waitForFunction(
        () =>
          (
            (window as unknown as K).__kimo?.session.store.getNode("Headline01")?.style as {
              features?: { salt?: number }
            }
          )?.features?.salt === 2,
      )
      await page.keyboard.press("Escape")
      await page.waitForFunction(() => !document.querySelector('[data-testid="text-more-menu"]'))

      // Features row (SE1Ap) chips: tnum, liga off, ss01, salt = 2.
      const row = page.getByTestId("text-features-row")
      await row.waitFor()
      const chips = await row.locator(".rp-feature-chip__tag").allInnerTexts()
      expect(chips.join("|") === "tnum|liga off|ss01|salt = 2", chips.join("|"))
      const f = table(ctx, "Features Row (SE1Ap)")
      const fm = await measure(page, {
        row: '[data-testid="text-features-row"]',
        label: '[data-testid="text-features-row"] .rp-toggle-row__label',
        chip: '[data-testid="text-features-row"] .rp-feature-chip',
        tag: '[data-testid="text-features-row"] .rp-feature-chip__tag',
        x: '[data-testid="text-features-row"] .rp-feature-chip__remove',
        add: '[data-testid="text-features-row"] .rp-feature-add',
        addIcon: '[data-testid="text-features-row"] .rp-feature-add .kimo-icon-button__icon',
      })
      f.check("Features Row", "h", fm.row?.h, 28)
      f.check("Features Row", "gap", fm.row?.gap, 8)
      f.check("Label (Y1igA)", "font size", fm.label?.fs, 12)
      f.check("Feature · tnum (dp2ps)", "h", fm.chip?.h, 22)
      f.check("Feature · tnum (dp2ps)", "padding", fm.chip?.pad, "0 6 0 8")
      f.check("Feature · tnum (dp2ps)", "gap", fm.chip?.gap, 4)
      f.check("Feature · tnum (dp2ps)", "background", fm.chip?.bg, muted)
      f.check("Tag (uVPFj)", "font", `${fm.tag?.ff} ${fm.tag?.fs}`, "JetBrains Mono 11")
      f.check("Remove (se9FC)", "w", fm.x?.w, 10)
      f.check("Add feature (BYcRE)", "w", fm.add?.w, 22)
      f.check("Add feature (BYcRE)", "background", fm.add?.bg, "rgba(0, 0, 0, 0)")
      f.check("Add icon", "w", fm.addIcon?.w, 12)
      f.flush()
      // Remove a chip.
      await row.getByRole("button", { name: "Remove ss01" }).click()
      await page.waitForFunction(
        () =>
          !(
            "ss01" in
            ((
              (window as unknown as K).__kimo?.session.store.getNode("Headline01")?.style as {
                features?: object
              }
            )?.features ?? {})
          ),
      )
    },
  },
  {
    name: "m5-text: Italic (menu, ⌘I, Italic row toggle), Link… (⌘K inline field), Reset text style",
    async run(ctx) {
      const { page } = ctx
      await editor(ctx)
      expect((await page.getByTestId("text-italic-row").count()) === 0, "no Italic row while off")
      await openMenu(page)
      await page
        .getByTestId("text-more-menu")
        .getByRole("menuitemradio", { name: /Italic/ })
        .click()
      await page.waitForFunction(
        () =>
          (
            (window as unknown as K).__kimo?.session.store.getNode("Headline01")?.style as
              | { italic?: boolean }
              | undefined
          )?.italic === true,
      )
      const italicRow = page.getByTestId("text-italic-row")
      await italicRow.waitFor()
      const on = await token(page, "--kimo-accent", "backgroundColor")
      const t = table(ctx, "Italic Row (G0AWh7)")
      const m = await measure(page, {
        row: '[data-testid="text-italic-row"]',
        label: '[data-testid="text-italic-row"] .rp-toggle-row__label',
        toggle: '[data-testid="text-italic-row"] [role="switch"]',
        caseRow: '[data-testid="text-section"] .rp-toggle-row:has([aria-label="Case"])',
      })
      t.check("Italic Row", "h", m.row?.h, 28)
      t.check("Italic Row", "gap", m.row?.gap, 8)
      t.check("Italic Row", "y = Case row bottom + 8", m.row?.y, (m.caseRow?.y ?? 0) + 28 + 8)
      t.check("Label (loG5y)", "font size", m.label?.fs, 12)
      t.check("Toggle (V2GeIW)", "w × h", `${m.toggle?.w}×${m.toggle?.h}`, "28×16")
      t.check("Toggle/On", "background", m.toggle?.bg, on)
      t.check(
        "Toggle",
        "right = row right",
        (m.toggle?.x ?? 0) + (m.toggle?.w ?? 0),
        (m.row?.x ?? 0) + (m.row?.w ?? 0),
      )
      t.flush()
      // Toggle off in the row removes it; ⌘I turns it back on.
      await italicRow.getByRole("switch").click()
      await page.waitForFunction(() => !document.querySelector('[data-testid="text-italic-row"]'))
      expect((await style(page)).italic === undefined, "italic removed")
      await page
        .locator("body")
        .click({ position: { x: 700, y: 870 } })
        .catch(() => {})
      await page.evaluate(() =>
        (window as unknown as K).__kimo?.session.ui.getState().select(["Headline01"]),
      )
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
      await page.keyboard.press("Meta+i")
      await italicRow.waitFor()
      // ⌘K opens the Link… popover (board 24 a NpwJS); Enter sets href.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
      await page.keyboard.press("Meta+k")
      const link = page.getByRole("textbox", { name: "Link URL" })
      await link.waitFor()
      await link.fill("https://kimo.design/pricing")
      await page.keyboard.press("Enter")
      await page.waitForFunction(() => !document.querySelector('[data-testid="text-link-popover"]'))
      expect((await style(page)).href === "https://kimo.design/pricing", "href set")
      await openMenu(page)
      const linkItem = page
        .getByTestId("text-more-menu")
        .getByRole("menuitemradio", { name: /Link/ })
      expect(
        (await linkItem.getAttribute("aria-checked")) === "true",
        "Link… checked when href is set",
      )
      // Reset text style keeps font / size / weight / spacing.
      await page
        .getByTestId("text-more-menu")
        .getByRole("menuitemradio", { name: "Reset text style" })
        .click()
      await page.waitForFunction(() => !document.querySelector('[data-testid="text-italic-row"]'))
      const s = await style(page)
      expect(
        s.italic === undefined && s.href === undefined && s.features === undefined,
        JSON.stringify(s),
      )
      expect(s.font === "Inter" && s.size === 28 && s.weight === 600, `kept: ${JSON.stringify(s)}`)
    },
  },
]
