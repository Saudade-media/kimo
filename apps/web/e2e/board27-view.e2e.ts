/**
 * Board 27 §4 "View menu & settings" (jFztN) and §6 (a)–(c) "Properties panel additions"
 * (tnlUt) in the real web editor: the View menu (rmQMe › F5DXf), Settings › Canvas (Lwg6P), rulers
 * / pixel grid / snapping / nudge (Iaqcg, rules UjtV5), Flip H / V + Clip content (l4pryR),
 * Wrap + Row gap with the canvas gap preview (lQ9JF), and per-paint blend (gKIo0). Each surface
 * gets one measured pass (getComputedStyle + getBoundingClientRect vs the node values).
 */
import type { Page } from "playwright"
import { checker, measure, tokens } from "./board25-helpers"
import { centerOf, drag, node, openEditor, settle, toPage, ui } from "./qa-helpers"
import { applyOps, board, type M2Hook, overlay, spyOverlay } from "./qa-m2-helpers"
import { type E2EContext, expect, type Scenario } from "./run"

type Ov = Awaited<ReturnType<typeof overlay>> & {
  rulers?: { selection: { x: number; y: number; w: number; h: number } | null } | null
}
const ov = async (page: Page) => (await overlay(page)) as Ov | null

const vp = async (page: Page, v: { x?: number; y?: number; zoom: number }) => {
  await page.evaluate(
    (x) => (window as unknown as { __kimo: M2Hook }).__kimo.session.ui.getState().setViewport(x),
    v,
  )
  await settle(page)
}

const sel = (page: Page, ids: string[]) =>
  page.evaluate(
    (x) => (window as unknown as { __kimo: M2Hook }).__kimo.session.ui.getState().select(x),
    ids,
  )

async function openView(page: Page) {
  await page.getByRole("button", { name: "Zoom" }).click()
  await page.locator(".view-menu").waitFor()
}

const viewItem = (page: Page, name: string) =>
  page.locator('.view-menu [role="menuitemcheckbox"]', {
    has: page.locator(".kimo-menu-item-dense__label", { hasText: new RegExp(`^${name}$`) }),
  })

async function openCanvasSettings(page: Page) {
  await page.locator(".canvas-host").focus()
  await page.keyboard.press("ControlOrMeta+,")
  await page.locator(".settings-window").waitFor()
  await page.locator('.settings-nav-item[data-pane="canvas"]').click()
  await page.locator('.settings-content[data-pane="canvas"]').waitFor()
}

async function closeSettings(page: Page) {
  await page.keyboard.press("Escape")
  await page.locator(".settings-window").waitFor({ state: "detached" })
}

export const scenarios: Scenario[] = [
  {
    name: "board27 view: View menu (F5DXf) toggles, ⇧R / ⇧' keys, rulers overlay",
    async run(ctx: E2EContext) {
      const { page } = ctx
      await openEditor(page, ctx.url)
      await board(page, [
        { id: "rectView0001", node: { type: "rect", name: "A", x: 40, y: 40, w: 80, h: 60 } },
      ])
      await spyOverlay(page)
      await openView(page)
      const T = await tokens(page, [
        "--kimo-bg-overlay",
        "--kimo-text-primary",
        "--kimo-text-tertiary",
      ])
      const m = await measure(page, {
        menu: ".view-menu",
        items: ".view-menu .kimo-menu-dense__items",
        item: ".view-menu .kimo-menu-item-dense",
        check:
          '.view-menu [role="menuitemcheckbox"][aria-checked="true"] .kimo-menu-item-dense__check',
        label: ".view-menu .kimo-menu-item-dense__label",
        meta: ".view-menu .kimo-menu-item-dense__meta",
        divider: ".view-menu .kimo-menu-divider",
      })
      const c = checker(ctx, "View menu (F5DXf)")
      c.box("Menu/Dense", m.menu, {
        w: 244,
        pad: "4 4 4 4",
        radius: 16,
        bg: T["--kimo-bg-overlay"],
      })
      c.box("Items ksc3x", m.items, { gap: 1, dir: "column" })
      c.box("MenuItem/Dense EAGNC", m.item, { h: 28, gap: 8, pad: "0 8 0 8", radius: 6 })
      c.box("Check RmOTH slot", m.check, { w: 14, h: 14 })
      c.box("Label BRxvS", m.label, { fs: 12, fw: "400", color: T["--kimo-text-primary"] })
      c.box("Meta T4CD1", m.meta, {
        fs: 11,
        ff: "JetBrains Mono",
        color: T["--kimo-text-tertiary"],
      })
      c.box("Menu/Divider fYNDQ", m.divider, { h: 9, pad: "4 8 4 8" })
      c.flush()
      const labels = await page.locator(".view-menu .kimo-menu-item-dense__label").allTextContents()
      expect(
        labels.join("|") ===
          "Zoom in|Zoom out|Zoom to 100 %|Zoom to fit|Zoom to selection|Pixel grid|Snap to pixel grid|Snap to objects|Rulers|Show layer names on canvas|Preview",
        `item order (${labels.join("|")})`,
      )
      for (const [name, on] of [
        ["Pixel grid", "true"],
        ["Snap to pixel grid", "true"],
        ["Snap to objects", "true"],
        ["Rulers", "false"],
        ["Show layer names on canvas", "true"],
      ] as const)
        expect(
          (await viewItem(page, name).getAttribute("aria-checked")) === on,
          `${name} default ${on}`,
        )
      // Rulers on from the menu → the overlay carries rulers with the selection extent.
      await viewItem(page, "Rulers").click()
      await sel(page, ["rectView0001"])
      await page.waitForFunction(() => {
        const o = (window as unknown as { __ov?: { rulers?: { selection: unknown } | null } }).__ov
        return !!o?.rulers?.selection
      })
      const r = (await ov(page))?.rulers
      ctx.log("rulers", JSON.stringify(r))
      expect(r?.selection?.x === 40 && r.selection.w === 80, "range = selection world extent")
      await openView(page)
      expect((await viewItem(page, "Rulers").getAttribute("aria-checked")) === "true", "checked")
      await page.keyboard.press("Escape")
      // ⇧R toggles the same preference off; ⇧' toggles the pixel grid.
      await page.locator(".canvas-host").focus()
      await page.keyboard.press("Shift+R")
      await page.waitForFunction(
        () => !(window as unknown as { __ov?: { rulers?: unknown } }).__ov?.rulers,
      )
      await vp(page, { x: 0, y: 0, zoom: 8 })
      await page.keyboard.press("Shift+Quote")
      await page.waitForTimeout(250)
      expect(!(await ov(page))?.pixelGrid, "⇧' turned the pixel grid off at 800 %")
      await page.keyboard.press("Shift+Quote")
      await page.waitForTimeout(250)
      expect((await ov(page))?.pixelGrid === 1, "⇧' back on")
      // Rulers screenshot at 1600 % (Ko6aO).
      await page.keyboard.press("Shift+R")
      await vp(page, { x: 38.75, y: 38.75, zoom: 16 })
      const hostBox = await page.locator(".canvas-host").boundingBox()
      if (ctx.shots && hostBox)
        await page.screenshot({
          path: `${ctx.shots}/board27-rulers.png`,
          clip: { x: hostBox.x, y: hostBox.y, width: 468, height: 330 },
        })
      // Layer names off hides the artboard labels.
      await openView(page)
      await viewItem(page, "Show layer names on canvas").click()
      expect(
        (await page
          .locator(".canvas-host__labels")
          .evaluate((e) => getComputedStyle(e).display)) === "none",
        "labels hidden",
      )
    },
  },
  {
    name: "board27 view: Settings › Canvas (Lwg6P) mirrors the View menu; nudge preset; snap to pixel grid",
    async run(ctx: E2EContext) {
      const { page } = ctx
      await openEditor(page, ctx.url)
      await board(page, [
        { id: "rectNudge001", node: { type: "rect", name: "N", x: 100, y: 100, w: 40, h: 40 } },
      ])
      await openCanvasSettings(page)
      const T = await tokens(page, ["--kimo-text-primary", "--kimo-text-secondary"])
      const m = await measure(page, {
        title: '.settings-content[data-pane="canvas"] .settings-title',
        row: '.settings-content[data-pane="canvas"] .kimo-setting-row',
        select: '.settings-content[data-pane="canvas"] .settings-select',
      })
      const c = checker(ctx, "Settings › Canvas (xg9X8)")
      c.box("Title O83UT9", m.title, { fs: 16, fw: "600", color: T["--kimo-text-primary"] })
      c.box("Select iv6cR", m.select, { w: 136 })
      c.flush()
      void m.row
      const labels = await page
        .locator('.settings-content[data-pane="canvas"] .kimo-setting-row__label')
        .allTextContents()
      expect(
        labels.join("|") === "Snap to objects|Snap to pixel grid|Pixel grid|Rulers|Nudge",
        `rows (${labels.join("|")})`,
      )
      const toggles = await page
        .locator('.settings-content[data-pane="canvas"] [role="switch"]')
        .evaluateAll((els) => els.map((e) => e.getAttribute("aria-checked")))
      expect(toggles.join() === "true,true,true,false", `toggle defaults ${toggles.join()}`)
      expect(
        (
          await page.locator('.settings-content[data-pane="canvas"] .settings-select').textContent()
        )?.includes("1 px · ⇧ 10 px"),
        "nudge 1 px · ⇧ 10 px",
      )
      // Turn Snap to pixel grid off here → the View menu shows it off (one source of truth).
      await page.locator('.settings-content[data-pane="canvas"] [role="switch"]').nth(1).click()
      // Nudge 8 / 16.
      await page.locator('.settings-content[data-pane="canvas"] .settings-select').click()
      await page.getByRole("option", { name: "8 px · ⇧ 16 px" }).click()
      await closeSettings(page)
      await openView(page)
      expect(
        (await viewItem(page, "Snap to pixel grid").getAttribute("aria-checked")) === "false",
        "View menu reflects Settings",
      )
      await page.keyboard.press("Escape")
      await sel(page, ["rectNudge001"])
      await page.locator(".canvas-host").focus()
      await page.keyboard.press("ArrowRight")
      await page.keyboard.press("Shift+ArrowDown")
      await settle(page)
      let n = await node(page, "rectNudge001")
      expect(n?.x === 108 && n?.y === 116, `nudge 8 / ⇧16 (${n?.x}, ${n?.y})`)
      // ⌥ arrow resizes by the step (rule bFozp).
      await page.keyboard.press("Alt+ArrowRight")
      await settle(page)
      n = await node(page, "rectNudge001")
      expect(n?.w === 48, `⌥→ resize by 8 (${n?.w})`)
      // Snap to pixel grid off at 200 %: a 3 px drag = 1.5 world units stays fractional.
      await vp(page, { x: 0, y: 0, zoom: 2 })
      const from = await centerOf(page, "rectNudge001")
      await drag(page, from, { x: from.x + 3, y: from.y })
      n = await node(page, "rectNudge001")
      ctx.log("snap px off", n?.x)
      expect(n?.x === 109.5, `fractional move with snap to pixel grid off (${n?.x})`)
      // Back on → whole px.
      await openView(page)
      await viewItem(page, "Snap to pixel grid").click()
      const from2 = await centerOf(page, "rectNudge001")
      await drag(page, from2, { x: from2.x + 3, y: from2.y })
      n = await node(page, "rectNudge001")
      expect(Number.isInteger(n?.x), `whole px with snap to pixel grid on (${n?.x})`)
    },
  },
  {
    name: "board27 props: Flip H / V + Clip content (l4pryR)",
    async run(ctx: E2EContext) {
      const { page } = ctx
      await openEditor(page, ctx.url)
      await board(page, [
        { id: "rectFlip0001", node: { type: "rect", name: "F", x: 40, y: 40, w: 80, h: 60 } },
      ])
      await sel(page, ["rectFlip0001"])
      await page.locator(".canvas-host").focus()
      await page.keyboard.press("Shift+H")
      await settle(page)
      expect((await node(page, "rectFlip0001"))?.flipX === true, "⇧H sets flipX")
      expect((await node(page, "rectFlip0001"))?.w === 80, "W stays positive")
      const T = await tokens(page, [
        "--kimo-bg-muted",
        "--kimo-bg-subtle",
        "--kimo-text-primary",
        "--kimo-text-secondary",
        "--kimo-accent",
        "--kimo-on-accent",
      ])
      const m = await measure(page, {
        row: ".design-tab .rp-rotate-flip",
        rot: ".design-tab .rp-rotate-flip .rp-field",
        fh: '.design-tab [aria-label="Flip horizontal"]',
        fhIcon: '.design-tab [aria-label="Flip horizontal"] .kimo-panel-icon-toggle__icon',
        fv: '.design-tab [aria-label="Flip vertical"]',
      })
      const c = checker(ctx, "Rotate · flip (LN4Tc)")
      c.box("Row LN4Tc", m.row, { gap: 6, align: "center", h: 28 })
      c.box("Flip horizontal IFtI5 (on)", m.fh, {
        w: 28,
        h: 28,
        radius: 10,
        bg: T["--kimo-bg-muted"],
        color: T["--kimo-text-primary"],
      })
      c.box("Icon nd1MZ", m.fhIcon, { w: 14, h: 14 })
      c.box("Flip vertical T4K2F (off)", m.fv, {
        w: 28,
        h: 28,
        bg: T["--kimo-bg-subtle"],
        color: T["--kimo-text-secondary"],
      })
      c.flush()
      // Rotation fills the rest: 256 − 6 − 28 − 6 − 28 = 188.
      const rowW = m.row?.w ?? 0
      expect(Math.abs((m.rot?.w ?? 0) - (rowW - 68)) < 1, `rotation fills (${m.rot?.w})`)
      await page.locator('.design-tab [aria-label="Flip vertical"]').click()
      await settle(page)
      expect((await node(page, "rectFlip0001"))?.flipY === true, "panel flips V")
      await page.locator('.design-tab [aria-label="Flip horizontal"]').click()
      await settle(page)
      expect((await node(page, "rectFlip0001"))?.flipX === undefined, "flip H off → unset")

      // Clip content: frames only, last row of the section.
      await sel(page, ["board0000001"])
      await settle(page)
      const cb = page.locator('.design-tab .kimo-panel-checkbox input[type="checkbox"]')
      expect((await cb.count()) === 1, "Clip content row for a frame")
      expect(!(await cb.isChecked()), "board fixture: clip off")
      await page.locator(".design-tab .kimo-panel-checkbox__label").click()
      await settle(page)
      expect((await node(page, "board0000001"))?.clip === true, "clip on")
      const mc = await measure(page, {
        row: ".design-tab .kimo-panel-checkbox",
        box: ".design-tab .kimo-panel-checkbox__box",
        label: ".design-tab .kimo-panel-checkbox__label",
      })
      const cc = checker(ctx, "Checkbox · Clip content (atlT6)")
      cc.box("Row atlT6", mc.row, { gap: 8, align: "center" })
      cc.box("Box V3Zqy", mc.box, { w: 14, h: 14, radius: 3, bg: T["--kimo-accent"] })
      cc.box("Label H3rh3", mc.label, { fs: 12, fw: "400", h: 15, color: T["--kimo-text-primary"] })
      cc.flush()
      const last = await page.evaluate(() => {
        // Board 27 §7: the checkbox sits in its bindable row (with the hover Bind Button).
        const c = document.querySelector(".design-tab .kimo-panel-checkbox")
        const b = c?.closest(".rp-clip-row") ?? c
        return b?.parentElement?.lastElementChild === b
      })
      expect(last, "Clip content is the section's last row")
      await sel(page, ["rectFlip0001"])
      await settle(page)
      expect(
        (await page.locator(".design-tab .kimo-panel-checkbox").count()) === 0,
        "not for rects",
      )
      // New top-level frame: clip on by default.
      await vp(page, { x: 0, y: 0, zoom: 1 })
      await page.locator(".canvas-host").focus()
      await page.keyboard.press("f")
      const a = await toPage(page, { x: 800, y: 100 })
      await drag(page, a, { x: a.x + 120, y: a.y + 80 })
      const made = (await ui(page)).selection[0] as string
      const f = await node(page, made)
      expect(f?.type === "frame" && f.clip === true && f.parent === null, "new root frame clips")
    },
  },
  {
    name: "board27 props: Wrap + Row gap + gap preview (lQ9JF)",
    async run(ctx: E2EContext) {
      const { page } = ctx
      await openEditor(page, ctx.url)
      await board(page, [
        {
          id: "wrapFrame001",
          node: { type: "frame", x: 40, y: 40, w: 124, layout: { dir: "row", gap: 8, pad: 10 } },
        },
        ...[1, 2, 3, 4].map((i) => ({
          id: `wrapItem000${i}`,
          parent: "wrapFrame001",
          node: { type: "rect", w: 48, h: 46, fill: "#E4E7EC" },
        })),
      ])
      await spyOverlay(page)
      await sel(page, ["wrapFrame001"])
      await settle(page)
      const wrapBtn = page.locator('.design-tab [aria-label="Wrap"]')
      expect((await wrapBtn.getAttribute("aria-pressed")) === "false", "wrap off")
      expect(
        (await page.locator('.design-tab [aria-label="Set Row gap"]').count()) === 0,
        "no row gap",
      )
      await wrapBtn.click()
      await settle(page)
      const lay = (await node(page, "wrapFrame001"))?.layout as Record<string, unknown>
      expect(lay?.wrap === true, "layout.wrap")
      await applyOps(
        page,
        [{ op: "update", id: "wrapFrame001", set: { layout: { ...lay, crossGap: 24 } } }],
        ["wrapFrame001"],
      )
      const T = await tokens(page, ["--kimo-bg-muted", "--kimo-text-primary"])
      const m = await measure(page, {
        dir: ".design-tab .rp-direction-row--wrap",
        wrap: '.design-tab [aria-label="Wrap"]',
      })
      const c = checker(ctx, "Auto layout · Wrap (nUHiL)")
      c.box("Direction nUHiL", m.dir, { gap: 6, h: 28, align: "center" })
      c.box("Wrap JIb4r (on)", m.wrap, {
        w: 28,
        h: 28,
        radius: 10,
        bg: T["--kimo-bg-muted"],
        color: T["--kimo-text-primary"],
      })
      c.flush()
      const prefixes = await page
        .locator(".design-tab .rp-gap-hover .kimo-prop-field__prefix")
        .allTextContents()
      expect(prefixes.join() === "↔,↕", `Gap ↔ · Row gap ↕ (${prefixes.join()})`)
      // Hover Row gap → measure mark between the wrapped rows labelled 24.
      await page.locator(".design-tab .rp-gap-hover").nth(1).hover()
      await page.waitForFunction(
        () =>
          !!(window as unknown as { __ov?: { measurements?: { label: string }[] } }).__ov
            ?.measurements?.length,
      )
      const meas = (await ov(page))?.measurements ?? []
      ctx.log("row gap marks", JSON.stringify(meas))
      expect(meas.length === 1 && meas[0]?.label === "24" && meas[0].axis === "y", "row gap 24")
      await page.locator(".design-tab .rp-gap-hover").nth(0).hover()
      await page.waitForFunction(
        () =>
          (window as unknown as { __ov?: { measurements?: { label: string }[] } }).__ov
            ?.measurements?.[0]?.label === "8",
      )
      await page.mouse.move(5, 5)
      await page.waitForFunction(
        () =>
          !(window as unknown as { __ov?: { measurements?: unknown[] } }).__ov?.measurements
            ?.length,
      )
      // Column: no wrap toggle (horizontal only); crossGap stays in data.
      await page.locator(".design-tab").getByRole("radio", { name: "Vertical" }).click()
      await settle(page)
      expect((await wrapBtn.count()) === 0, "wrap hidden for column layouts")
      const after = (await node(page, "wrapFrame001"))?.layout as Record<string, unknown>
      expect(after?.crossGap === 24, "crossGap kept")
    },
  },
  {
    name: "board27 props: per-paint blend button, menu and chip (gKIo0)",
    async run(ctx: E2EContext) {
      const { page } = ctx
      await openEditor(page, ctx.url)
      await board(page, [
        {
          id: "rectBlend001",
          node: { type: "rect", x: 40, y: 40, w: 80, h: 60, fill: "#F4F1EC" },
        },
      ])
      await sel(page, ["rectBlend001"])
      await settle(page)
      const T = await tokens(page, [
        "--kimo-text-tertiary",
        "--kimo-bg-muted",
        "--kimo-text-primary",
        "--kimo-text-secondary",
      ])
      const blend = page.locator(".design-tab .kimo-fill-row__blend").first()
      let m = await measure(page, { blend: ".design-tab .kimo-fill-row__blend" })
      const c = checker(ctx, "Paint row · Blend (gKIo0)")
      c.box("Blend r7ZOxn (normal)", m.blend, {
        w: 24,
        h: 24,
        radius: 10,
        bg: "rgba(0, 0, 0, 0)",
        color: T["--kimo-text-tertiary"],
      })
      // Order: field · blend · eye.
      const order = await page
        .locator(".design-tab .kimo-fill-row")
        .first()
        .evaluate((r) => [...r.children].map((e) => e.className.split(" ")[0]))
      ctx.log("row order", order.join(" · "))
      expect(
        order.indexOf("kimo-panel-icon-toggle") === 1 && (order[2] ?? "").includes("icon-button"),
        "blend sits between the field and the eye",
      )
      await blend.click()
      const menu = page.getByRole("menu", { name: "Blend mode" })
      await menu.waitFor()
      const mm = await measure(page, { menu: '[role="menu"][aria-label="Blend mode"]' })
      c.box("Blend menu kNrNc", mm.menu, { w: 128 })
      const count = await menu.getByRole("menuitemradio").count()
      expect(count === 18, `paint modes (${count})`)
      await menu.getByRole("menuitemradio", { name: "Multiply" }).click()
      await settle(page)
      const fill = (await node(page, "rectBlend001"))?.fill as Record<string, unknown>
      expect(
        fill?.kind === "solid" && fill.color === "#F4F1EC" && fill.blend === "multiply",
        `fill blend (${JSON.stringify(fill)})`,
      )
      m = await measure(page, {
        blend: ".design-tab .kimo-fill-row__blend",
        chipRow: ".design-tab .kimo-paint-blend-chip",
        chip: ".design-tab .kimo-paint-blend-chip__chip",
      })
      c.box("Blend F1NkuB (multiply)", m.blend, {
        bg: T["--kimo-bg-muted"],
        color: T["--kimo-text-primary"],
      })
      c.box("Blend chip FC2in", m.chipRow, { pad: "0 0 0 24" })
      c.box("Chip I5CR0", m.chip, {
        pad: "1 6 1 6",
        radius: 4,
        bg: T["--kimo-bg-muted"],
        fs: 11,
        fw: "400",
        color: T["--kimo-text-secondary"],
        h: 15,
      })
      c.flush()
      expect(
        (await page.locator(".design-tab .kimo-paint-blend-chip__chip").first().textContent()) ===
          "Multiply",
        "chip label",
      )
      // Normal again collapses back to the bare color and removes the chip.
      await blend.click()
      await page
        .getByRole("menu", { name: "Blend mode" })
        .getByRole("menuitemradio", { name: "Normal" })
        .click()
      await settle(page)
      expect((await node(page, "rectBlend001"))?.fill === "#F4F1EC", "normal → bare color")
      expect((await page.locator(".design-tab .kimo-paint-blend-chip").count()) === 0, "no chip")
    },
  },
]
