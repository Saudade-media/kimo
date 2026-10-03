/**
 * M2 Design tab (board 08 right panel `hgQkJ`, popovers board 09): section order, one measured
 * getComputedStyle / getBoundingClientRect pass against the node values, and the editing
 * contract (ops through the store, one undo step per gesture, Mixed, variable binding, image
 * assets, scrolling).
 */
import type { Page } from "playwright"
import {
  armFileChooser,
  docJson,
  type Hook,
  nextFileChooser,
  node,
  openEditor,
  settle,
} from "./qa-helpers"
import { type E2EContext, expect, type Scenario } from "./run"

type Store = Hook["session"]["store"] & {
  undo(o: string): unknown
}
type W = {
  __kimo: {
    session: {
      store: Store
      apply(ops: unknown[], label?: string): boolean
      ui: Hook["session"]["ui"]
    }
  }
}

/** Inserts a fixture: Card (frame, auto layout, fill, stroke) with Photo (rect) and Star (icon). */
async function fixture(page: Page) {
  const ok = await page.evaluate(() => {
    const s = (window as unknown as W).__kimo.session
    const applied = s.apply(
      [
        {
          op: "setVariables",
          set: { "brand/sand": { type: "color", value: "#F4A261" } },
        },
        {
          op: "insert",
          id: "card000001",
          parent: null,
          node: {
            type: "frame",
            name: "Card",
            x: 80,
            y: 80,
            w: 320,
            h: 220,
            fill: "#FFFFFF",
            layout: { dir: "row", gap: 12, pad: 16 },
          },
        },
        {
          op: "insert",
          id: "photo00001",
          parent: "card000001",
          node: { type: "rect", name: "Photo", w: 120, h: 80, fill: "#C9B8A6" },
        },
        {
          op: "insert",
          id: "star000001",
          parent: null,
          node: {
            type: "icon",
            name: "Star",
            set: "lucide",
            icon: "star",
            x: 480,
            y: 80,
            w: 24,
            h: 24,
          },
        },
      ],
      "fixture",
    )
    s.ui.getState().select(["card000001"])
    return applied
  })
  expect(ok, "fixture applied")
  await settle(page)
}

const select = (page: Page, ids: string[]) =>
  page.evaluate((i) => (window as unknown as W).__kimo.session.ui.getState().select(i), ids)

const undo = (page: Page) =>
  page.evaluate(() => (window as unknown as W).__kimo.session.store.undo("user"))

const section = (page: Page, title: string) =>
  page.locator(".design-tab .kimo-prop-section", {
    has: page.locator(".kimo-prop-section__title", { hasText: new RegExp(`^${title}$`) }),
  })

/** Asserts one undo step reverts the document to `before`. */
async function oneStep(page: Page, before: string, what: string) {
  expect((await docJson(page)) !== before, `${what}: changed the document`)
  await undo(page)
  await settle(page)
  expect((await docJson(page)) === before, `${what}: one undo step restores it`)
}

async function measure(ctx: E2EContext) {
  const { page } = ctx
  const m = await page.evaluate(() => {
    const px = (v: string) => Number.parseFloat(v)
    const box = (el: Element | null) => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return {
        w: Math.round(r.width * 100) / 100,
        h: Math.round(r.height * 100) / 100,
        x: r.x,
        y: r.y,
        pad: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(px),
        gap: cs.rowGap === "normal" ? 0 : px(cs.rowGap),
        cgap: cs.columnGap === "normal" ? 0 : px(cs.columnGap),
        dir: cs.flexDirection,
        display: cs.display,
        font: `${cs.fontFamily.split(",")[0]} ${cs.fontSize} ${cs.fontWeight}`,
        color: cs.color,
        bg: cs.backgroundColor,
        overflowY: cs.overflowY,
        borderL: cs.borderLeftWidth,
        borderB: cs.borderBottomWidth,
        shadow: cs.boxShadow,
      }
    }
    const q = (s: string) => document.querySelector(s)
    const sections = [...document.querySelectorAll(".design-tab .kimo-prop-section")]
    const sec = (t: string) =>
      sections.find((s) => s.querySelector(".kimo-prop-section__title")?.textContent === t) ?? null
    const pos = sec("Position")
    const auto = sec("Auto layout")
    return {
      titles: sections.map((s) => s.querySelector(".kimo-prop-section__title")?.textContent),
      panel: box(q(".right-panel")),
      designTab: box(q(".design-tab")),
      scroll: (() => {
        const d = q(".design-tab") as HTMLElement | null
        return d ? { sh: d.scrollHeight, ch: d.clientHeight } : null
      })(),
      selection: box(q(".selection-header")),
      selectionName: box(q(".selection-header__name")),
      layer: box(sec("Layer")),
      body: box(sec("Layer")?.querySelector(".rp-body") ?? null),
      blend: box(sec("Layer")?.querySelector(".rp-select") ?? null),
      opacity: box(sec("Layer")?.querySelector(".rp-field--w96 .kimo-prop-field") ?? null),
      row: box(pos?.querySelector(".rp-row") ?? null),
      x: box(pos?.querySelector(".kimo-prop-field") ?? null),
      sizeField: box(pos?.querySelector(".kimo-size-field") ?? null),
      directionRow: box(auto?.querySelector(".rp-direction-row") ?? null),
      alignRow: box(auto?.querySelector(".rp-align-row") ?? null),
      grid: box(auto?.querySelector(".kimo-alignment-grid") ?? null),
      spacing: box(auto?.querySelector(".rp-align-row__spacing") ?? null),
      toggleRow: box(auto?.querySelector(".rp-toggle-row") ?? null),
      toggleLabel: box(auto?.querySelector(".rp-toggle-row__label") ?? null),
      fillRow: box(sec("Fill")?.querySelector(".kimo-fill-row") ?? null),
    }
  })
  ctx.log("measure", JSON.stringify(m))
  return m
}

export const scenarios: Scenario[] = [
  {
    name: "m2 panel: board 08 sections, measured pass",
    async run(ctx) {
      const { page, url } = ctx
      await openEditor(page, url)
      await fixture(page)
      const m = await measure(ctx)
      expect(
        JSON.stringify(m.titles) ===
          JSON.stringify(["Layer", "Position", "Auto layout", "Fill", "Stroke", "Effects"]),
        `section order ${m.titles}`,
      )
      // hgQkJ: 280 wide, left stroke 1 (M1 shell: inset box-shadow, no layout shift).
      expect(
        m.panel?.w === 280 && /1px 0px 0px 0px inset/.test(m.panel.shadow),
        `panel ${JSON.stringify(m.panel)}`,
      )
      // eZbgB: padding [8, 12, 12, 12], gap 8, bottom stroke 1; Name 13/600.
      expect(
        JSON.stringify(m.selection?.pad) === "[8,12,12,12]" && m.selection?.cgap === 8,
        `selection ${JSON.stringify(m.selection)}`,
      )
      expect(/ 13px 600$/.test(m.selectionName?.font ?? ""), `name font ${m.selectionName?.font}`)
      // PropSection: padding [12, 12, 16, 12], gap 8; Body column gap 8.
      expect(JSON.stringify(m.layer?.pad) === "[12,12,16,12]", `section pad ${m.layer?.pad}`)
      expect(m.body?.dir === "column" && m.body.gap === 8, `body ${JSON.stringify(m.body)}`)
      // Layer Row: Blend fill × 28, Opacity 96 × 28.
      expect(m.blend?.h === 28 && m.opacity?.w === 96 && m.opacity.h === 28, "layer row sizes")
      expect(
        Math.abs((m.blend?.w ?? 0) - (256 - 96 - 8)) < 0.5,
        `blend fills the row: ${m.blend?.w}`,
      )
      // Row gap 8, X field fill (half of 256 − 8).
      expect(m.row?.cgap === 8 && m.x?.w === 124 && m.x.h === 28, `row ${JSON.stringify(m.x)}`)
      expect(m.sizeField?.w === 124 && m.sizeField.h === 28, "size field 124 × 28")
      // Direction Row h 28; Align Row gap 8, grid fill × 64, spacing column fill.
      expect(m.directionRow?.h === 28 && m.directionRow.cgap === 8, "direction row")
      expect(
        m.alignRow?.cgap === 8 && m.grid?.h === 64 && m.grid.w === 124,
        `align ${JSON.stringify(m.grid)}`,
      )
      expect(m.spacing?.w === 124 && m.spacing.gap === 8, "spacing column")
      expect(m.toggleRow?.h === 28 && m.toggleRow.cgap === 8, "toggle row")
      expect(/ 12px 400$/.test(m.toggleLabel?.font ?? ""), `toggle label ${m.toggleLabel?.font}`)
      // The Design tab scrolls inside the panel when taller than the viewport; tabs stay.
      expect(m.designTab?.overflowY === "auto", "design tab scrolls")
      await page.setViewportSize({ width: 1440, height: 600 })
      await settle(page)
      const sc = await page.locator(".design-tab").evaluate((el) => {
        const before = el.scrollHeight > el.clientHeight
        el.scrollTop = el.scrollHeight
        const tabs = document.querySelector(".right-panel [role=tablist]")?.getBoundingClientRect()
        return { before, top: el.scrollTop, tabsTop: tabs?.top ?? -1 }
      })
      ctx.log("scroll", JSON.stringify(sc))
      expect(sc.before && sc.top > 0 && sc.tabsTop === 48, "scrolls under fixed tabs")
      await page.setViewportSize({ width: 1440, height: 900 })
      if (ctx.shots)
        await page.locator(".right-panel").screenshot({ path: `${ctx.shots}/m2-panel.png` })
    },
  },
  {
    name: "m2 panel: blend preview / revert / commit, opacity, mixed",
    async run(ctx) {
      const { page, url } = ctx
      await openEditor(page, url)
      await fixture(page)
      const before = await docJson(page)
      const blend = section(page, "Layer").getByRole("button", { name: "Blend mode" })
      await blend.click()
      const menu = page.getByRole("menu", { name: "Blend mode" })
      await menu.waitFor()
      // Pass through is offered for frames.
      expect(await menu.getByText("Pass through").isVisible(), "pass-through for frames")
      await menu.getByText("Multiply").hover()
      await settle(page)
      expect((await node(page, "card000001"))?.blend === "multiply", "hover previews")
      await page.keyboard.press("Escape")
      await settle(page)
      expect((await node(page, "card000001"))?.blend === undefined, "Escape reverts")
      expect((await docJson(page)) === before, "revert leaves the document as it was")
      await blend.click()
      await page.getByRole("menu", { name: "Blend mode" }).getByText("Screen").click()
      await settle(page)
      expect((await node(page, "card000001"))?.blend === "screen", "select commits")
      await oneStep(page, before, "blend commit")
      // Opacity: type 50 → 0.5.
      const op = section(page, "Layer").getByRole("textbox", { name: "Opacity" })
      await op.fill("50")
      await op.press("Enter")
      await settle(page)
      expect((await node(page, "card000001"))?.opacity === 0.5, "opacity 50%")
      await oneStep(page, before, "opacity")
      // Mixed: Card (frame) + Photo (rect) with different fills.
      await select(page, ["card000001", "photo00001"])
      await settle(page)
      const fillRows = section(page, "Fill").locator(".kimo-fill-row")
      expect((await fillRows.count()) === 1, "one mixed fill row")
      expect(((await fillRows.first().textContent()) ?? "").includes("Mixed"), "fill Mixed")
      const menu2 = section(page, "Layer").getByRole("button", { name: "Blend mode" })
      await menu2.click()
      expect(
        !(await page.getByRole("menu", { name: "Blend mode" }).getByText("Pass through").count()),
        "no pass-through for a rect",
      )
      await page.keyboard.press("Escape")
    },
  },
  {
    name: "m2 panel: fill list, color picker drag = one step, variables bind $ref",
    async run(ctx) {
      const { page, url } = ctx
      await openEditor(page, url)
      await fixture(page)
      const before = await docJson(page)
      // + adds a solid on top.
      await section(page, "Fill").getByRole("button", { name: "Add fill" }).click()
      await page.getByRole("menuitem", { name: "Solid" }).click()
      await settle(page)
      const fill = (await node(page, "card000001"))?.fill as unknown[]
      expect(
        Array.isArray(fill) && fill.length === 2 && fill[1] === "#D9D9D9",
        `added ${JSON.stringify(fill)}`,
      )
      // Top paint first.
      const rows = section(page, "Fill").locator(".kimo-fill-row")
      expect(((await rows.nth(0).textContent()) ?? "").includes("D9D9D9"), "top paint first")
      await oneStep(page, before, "add fill")

      // Open the solid row → color picker left of the panel, top on the row.
      const row = section(page, "Fill").locator(".kimo-fill-row").first()
      await row.locator(".kimo-color-field").click()
      const picker = page.locator(".kimo-color-picker")
      await picker.waitFor()
      await settle(page)
      const geo = await page.evaluate(() => {
        const p = document.querySelector(".kimo-color-picker")?.getBoundingClientRect()
        const r = document.querySelector(".design-tab .kimo-fill-row")?.getBoundingClientRect()
        const panel = document.querySelector(".right-panel")?.getBoundingClientRect()
        return p && r && panel
          ? {
              right: p.right,
              top: p.top,
              rowTop: r.top,
              panelLeft: panel.left,
              w: p.width,
              h: p.height,
            }
          : null
      })
      ctx.log("picker", JSON.stringify(geo))
      expect(geo && Math.abs(geo.panelLeft - geo.right - 8) < 0.5, "8px left of the panel")
      // Top on the row, clamped to the viewport (8px padding).
      const vh = page.viewportSize()?.height ?? 900
      expect(
        geo && Math.abs(geo.top - Math.min(geo.rowTop, vh - 8 - (geo.h ?? 0))) < 0.5,
        "top on the row (clamped)",
      )
      expect(geo?.w === 248, "248 wide")

      // Drag across the color area: one undo step.
      const area = picker.locator(".kimo-color-area")
      const b = await area.boundingBox()
      if (!b) throw new Error("no color area")
      await page.mouse.move(b.x + 10, b.y + 10)
      await page.mouse.down()
      for (let i = 1; i <= 6; i++) await page.mouse.move(b.x + 10 + i * 20, b.y + 10 + i * 15)
      await page.mouse.up()
      await settle(page)
      const dragged = (await node(page, "card000001"))?.fill
      expect(typeof dragged === "string" && dragged !== "#FFFFFF", `drag recolors: ${dragged}`)
      await oneStep(page, before, "color area drag")

      // Variables tab: binds { $ref }.
      await picker.getByRole("tab", { name: "Variables" }).click()
      await picker.getByRole("option", { name: /sand/ }).click()
      await settle(page)
      const bound = (await node(page, "card000001"))?.fill as { $ref?: string }
      expect(bound?.$ref === "brand/sand", `bound ${JSON.stringify(bound)}`)
      expect(
        (
          (await section(page, "Fill").locator(".kimo-fill-row").first().textContent()) ?? ""
        ).includes("brand/sand"),
        "row shows the variable",
      )
      await oneStep(page, before, "bind variable")
      await page.keyboard.press("Escape")
      await settle(page)
      expect((await picker.count()) === 0, "Escape closes the picker")
      expect(
        JSON.stringify(
          await page.evaluate(
            () => (window as unknown as W).__kimo.session.ui.getState().selection,
          ),
        ) === '["card000001"]',
        "Escape in a popover keeps the selection",
      )
    },
  },
  {
    name: "m2 panel: stroke dashed / sides / cap, effects, gradient, image asset",
    async run(ctx) {
      const { page, url } = ctx
      armFileChooser(page)
      await openEditor(page, url)
      await fixture(page)
      const before = await docJson(page)
      const stroke = section(page, "Stroke")
      await stroke.getByRole("button", { name: "Add stroke" }).click()
      await page.getByRole("menuitem", { name: "Solid" }).click()
      await settle(page)
      expect(
        JSON.stringify((await node(page, "card000001"))?.stroke) === '{"paint":"#0A0A0A"}',
        "stroke added",
      )
      await stroke.getByRole("switch", { name: "Dashed" }).click()
      await settle(page)
      expect(
        JSON.stringify(
          (((await node(page, "card000001"))?.stroke ?? {}) as { dash?: unknown }).dash,
        ) === "[4,2]",
        "dash 4/2",
      )
      await stroke.getByRole("switch", { name: "Individual sides" }).click()
      await settle(page)
      const w = (((await node(page, "card000001"))?.stroke ?? {}) as { width?: unknown }).width
      expect(JSON.stringify(w) === '{"t":1,"r":1,"b":1,"l":1}', `sides ${JSON.stringify(w)}`)
      await stroke.getByRole("radio", { name: "Round" }).first().click()
      await settle(page)
      expect(
        (((await node(page, "card000001"))?.stroke ?? {}) as { cap?: string }).cap === "round",
        "cap round",
      )

      // Effects: + adds the board 08 drop shadow; details show X/Y/Blur/Spread + color.
      const effects = section(page, "Effects")
      await effects.getByRole("button", { name: "Add effect" }).click()
      await settle(page)
      const fx = (await node(page, "card000001"))?.effects as Record<string, unknown>[]
      expect(
        fx?.[0]?.kind === "shadow" && fx[0].y === 8 && fx[0].blur === 24,
        `effect ${JSON.stringify(fx)}`,
      )
      for (const name of ["Shadow X", "Shadow Y", "Shadow blur", "Shadow spread"])
        expect(await effects.getByRole("textbox", { name }).isVisible(), `${name} visible`)

      // Gradient: + Gradient opens nothing yet; open its row → gradient editor.
      await section(page, "Fill").getByRole("button", { name: "Add fill" }).click()
      await page.getByRole("menuitem", { name: "Gradient" }).click()
      await settle(page)
      await section(page, "Fill")
        .locator(".kimo-fill-row")
        .first()
        .locator(".kimo-color-field")
        .click()
      const ge = page.locator(".kimo-gradient-editor")
      await ge.waitFor()
      const g0 = await docJson(page)
      await ge.getByRole("radio", { name: "Radial" }).click()
      await settle(page)
      const fills = (await node(page, "card000001"))?.fill as { kind?: string }[]
      expect(fills.at(-1)?.kind === "radial", "radial")
      await oneStep(page, g0, "gradient kind")
      await page.keyboard.press("Escape")
      await settle(page)

      // Image fill: + Image… → file → content-addressed asset ref.
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGN4nh+4AoQZYAwAVOQJPdIwj3IAAAAASUVORK5CYII=",
        "base64",
      )
      const chooser = nextFileChooser(page)
      await section(page, "Fill").getByRole("button", { name: "Add fill" }).click()
      await page.getByRole("menuitem", { name: "Image…" }).click()
      await (await chooser).setFiles({ name: "dot.png", mimeType: "image/png", buffer: png })
      await page.waitForFunction(() => {
        const n = (window as unknown as W).__kimo.session.store.getNode("card000001") as {
          fill?: unknown
        }
        return (
          Array.isArray(n.fill) && n.fill.some((p) => (p as { kind?: string }).kind === "image")
        )
      })
      const img = (
        ((await node(page, "card000001"))?.fill ?? []) as { kind?: string; src?: string }[]
      ).find((p) => p.kind === "image")
      expect(/^\.\/assets\/[0-9a-f]{16}\.png$/.test(img?.src ?? ""), `asset ref ${img?.src}`)
      const row0 = section(page, "Fill").locator(".kimo-fill-row").first()
      expect(((await row0.textContent()) ?? "").includes("Image · Cover"), "image row label")
      await row0.locator(".kimo-color-field").click()
      await page.getByText("2 × 2").waitFor()
      await page.keyboard.press("Escape")
      await settle(page)
      expect(
        (await page.evaluate(() => (window as unknown as W).__kimo.session.ui.getState().selection))
          .length === 1,
        "Escape in the image popover keeps the selection",
      )
      void before
      if (ctx.shots)
        await page.locator(".right-panel").screenshot({ path: `${ctx.shots}/m2-panel-styled.png` })
    },
  },
  {
    name: "m2 panel: icon section, empty auto layout",
    async run(ctx) {
      const { page, url } = ctx
      await openEditor(page, url)
      await fixture(page)
      await select(page, ["star000001"])
      await settle(page)
      const titles = await page.locator(".design-tab .kimo-prop-section__title").allTextContents()
      ctx.log("icon titles", titles.join(" · "))
      expect(titles.includes("Icon"), "icon section")
      const icon = section(page, "Icon")
      expect(((await icon.textContent()) ?? "").includes("Lucide"), "library label")
      expect(await icon.getByRole("textbox", { name: "Icon stroke" }).isVisible(), "Stroke field")
      // Auto layout on a non-frame: header-only with +.
      const auto = section(page, "Auto layout")
      expect((await auto.locator(".rp-body").count()) === 0, "empty auto layout section")
      expect(await auto.getByRole("button", { name: "Add auto layout" }).isVisible(), "+ action")
      await icon.getByRole("button", { name: /^Icon:/ }).click()
      await page.locator(".kimo-icon-picker").waitFor()
      if (ctx.shots) await page.screenshot({ path: `${ctx.shots}/m2-icon-picker.png` })
      await page.keyboard.press("Escape")
    },
  },
]
