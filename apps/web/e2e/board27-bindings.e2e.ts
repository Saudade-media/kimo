/**
 * Board 27 §7 "Variable binding everywhere" (H7PYY) in the real web editor: PropField/Bindable
 * (LFrgQ) hover affordance, the type-filtered picker (xec6v), PropField/Bound (egdNP) chips with
 * Detach, the missing-variable state, Visible / Content rows (kRMBZ, EYpeL), mixed selections,
 * bound-text editing ("Detach copy/cta?") and "Detach all variables" in the layer menu. One
 * measured pass per surface (getComputedStyle + getBoundingClientRect vs the node values).
 */
import type { Page } from "playwright"
import { checker, measure, tokens } from "./board25-helpers"
import { centerOf, node, openEditor, settle } from "./qa-helpers"
import { applyOps, board, type M2Hook, section } from "./qa-m2-helpers"
import { type E2EContext, expect, type Scenario } from "./run"

const VARS = {
  op: "setVariables",
  set: {
    "space/2": { type: "number", value: 8 },
    "space/4": { type: "number", value: 16 },
    "space/6": { type: "number", value: 24 },
    "space/gutter": { type: "number", value: { $ref: "space/6" } },
    "opacity/muted": { type: "number", value: 0.64 },
    "copy/cta": { type: "string", value: "Start free" },
    "show/badge": { type: "boolean", value: true },
  },
}

const sel = (page: Page, ids: string[]) =>
  page.evaluate(
    (x) => (window as unknown as { __kimo: M2Hook }).__kimo.session.ui.getState().select(x),
    ids,
  )

async function fixture(page: Page) {
  await applyOps(page, [VARS])
  await board(page, [
    {
      id: "frameBind001",
      node: {
        type: "frame",
        name: "Stack",
        x: 40,
        y: 40,
        w: 240,
        h: 120,
        fill: "#EEEEEE",
        layout: { dir: "row", gap: 16, pad: [16, 24] },
      },
    },
    {
      id: "frameBind002",
      node: {
        type: "frame",
        name: "Stack 2",
        x: 320,
        y: 40,
        w: 200,
        h: 120,
        fill: "#EEEEEE",
        layout: { dir: "row", gap: 16 },
      },
    },
    {
      id: "textBind0001",
      node: { type: "text", name: "CTA", x: 40, y: 220, content: "Hello" },
    },
  ])
}

const gapField = (page: Page) => section(page, "Auto layout").locator(".rp-gap-hover .rp-bind")

export const scenarios: Scenario[] = [
  {
    name: "board27 bindings: Bindable hover (LFrgQ) → picker (xec6v) → Bound chip (egdNP) → Detach",
    async run(ctx: E2EContext) {
      const { page } = ctx
      await openEditor(page, ctx.url)
      await fixture(page)
      await sel(page, ["frameBind001"])
      await settle(page)
      const T = await tokens(page, [
        "--kimo-bg-subtle",
        "--kimo-bg-hover",
        "--kimo-bg-app",
        "--kimo-bg-overlay",
        "--kimo-border-strong",
        "--kimo-border",
        "--kimo-text-primary",
        "--kimo-text-secondary",
        "--kimo-text-tertiary",
        "--kimo-danger",
        "--kimo-selection",
      ])

      // (a) Hover: stroke border-strong, padding [0, 4, 0, 8], Bind Button 20 / radius-xs.
      await gapField(page).hover()
      const hover = await measure(page, {
        frame: ".rp-gap-hover .kimo-prop-field--bindable",
        button: ".rp-gap-hover .kimo-bind-button",
        icon: ".rp-gap-hover .kimo-bind-button svg",
      })
      const a = checker(ctx, "PropField/Bindable (LFrgQ) · hover")
      a.box("Frame LFrgQ", hover.frame, {
        h: 28,
        pad: "0 4 0 8",
        gap: 8,
        radius: 6,
        bg: T["--kimo-bg-subtle"],
        shadowHas: T["--kimo-border-strong"],
      })
      a.box("Bind Button fBIJF", hover.button, {
        w: 20,
        h: 20,
        radius: 4,
        bg: T["--kimo-bg-hover"],
        justify: "center",
        align: "center",
      })
      a.box("Icon x2Sf8m (variable)", hover.icon, { w: 12, h: 12, color: T["--kimo-text-primary"] })
      a.flush()
      // The button sits at the frame's right edge (padding-right 4).
      const edge =
        hover.frame && hover.button
          ? hover.frame.x + hover.frame.w - (hover.button.x + hover.button.w)
          : -1
      expect(Math.abs(edge - 4) < 0.75, `bind button 4 px from the right edge (got ${edge})`)

      // Not hovered: no button, no stroke (plain PropField A9DDs).
      await page.mouse.move(5, 5)
      const idle = await page.evaluate(
        () =>
          getComputedStyle(document.querySelector(".rp-gap-hover .kimo-bind-button") as Element)
            .display,
      )
      expect(idle === "none", `bind button hidden at rest (${idle})`)

      // (b) Picker.
      await gapField(page).hover()
      await page.locator(".rp-gap-hover .kimo-bind-button").click()
      await page.locator(".kimo-variable-picker").waitFor()
      const pk = await measure(page, {
        pop: ".kimo-variable-picker",
        header: ".kimo-variable-picker .kimo-popover__header",
        title: ".kimo-variable-picker .kimo-popover__title",
        body: ".kimo-variable-picker__body",
        search: ".kimo-variable-picker__search",
        searchIcon: ".kimo-variable-picker__search .kimo-input__icon",
        searchField: ".kimo-variable-picker__search input",
        group: ".kimo-variable-picker__group",
        groupTitle: ".kimo-variable-picker__group-title",
        groupMeta: ".kimo-variable-picker__group-meta",
        row: ".kimo-variable-picker .kimo-variable-list-row",
        rowName: ".kimo-variable-picker .kimo-variable-list-row__name",
        rowValue: ".kimo-variable-picker .kimo-variable-list-row__value",
        current: ".kimo-variable-picker .kimo-variable-list-row--selected",
        footer: ".kimo-variable-picker__footer",
        plus: ".kimo-variable-picker__plus",
        create: ".kimo-variable-picker__create",
      })
      const b = checker(ctx, "Variable Picker (xec6v)")
      b.box("Popover xvOvm (w 320)", pk.pop, { w: 320, radius: 16, bg: T["--kimo-bg-overlay"] })
      b.box("Header Am1eq", pk.header, { h: 40, pad: "0 6 0 12" })
      b.box("Title cNBKW", pk.title, { fs: 12, fw: "600", color: T["--kimo-text-primary"] })
      b.box("Body oDd1B", pk.body, { gap: 2, pad: "8 6 6 6", dir: "column" })
      b.box("Search VyoHA", pk.search, { h: 28, pad: "0 10 0 10", gap: 8 })
      b.box("Search icon mU4b8", pk.searchIcon, { w: 16, h: 16 })
      b.box("Search text BwYzP", pk.searchField, { fs: 12 })
      b.box("Group · This file rPIXV", pk.group, { pad: "8 8 4 8", gap: 6, align: "center" })
      b.box("Group title t96Qm", pk.groupTitle, {
        fs: 11,
        fw: "600",
        color: T["--kimo-text-tertiary"],
      })
      b.box("Group meta DVd0x", pk.groupMeta, {
        fs: 11,
        ff: "JetBrains Mono",
        color: T["--kimo-text-tertiary"],
      })
      b.box("VariableListRow yB4CN", pk.row, { h: 28, pad: "0 8 0 8", gap: 8, radius: 6 })
      b.box("Row name iP6bu", pk.rowName, { fs: 11, ff: "JetBrains Mono" })
      b.box("Row value WJLUV", pk.rowValue, { fs: 11, color: T["--kimo-text-tertiary"] })
      b.box("Footer phtV6", pk.footer, {
        pad: "8 8 2 8",
        gap: 8,
        shadowHas: T["--kimo-border"],
      })
      b.box("Plus u0flD", pk.plus, { w: 14, h: 14, color: T["--kimo-text-secondary"] })
      b.box("Create Mx6PN", pk.create, { fs: 12, color: T["--kimo-text-secondary"] })
      b.flush()
      const names = await page
        .locator(".kimo-variable-picker .kimo-variable-list-row__name")
        .allTextContents()
      // Number-only (no copy/cta, show/badge), sorted; the alias shows → target.
      expect(
        names.join("|") === "opacity/muted|space/2|space/4|space/6|space/gutter",
        `number variables only (${names.join("|")})`,
      )
      const alias = await page
        .locator('.kimo-variable-picker [data-ref="space/gutter"] .kimo-variable-list-row__value')
        .textContent()
      expect(alias === "→ space/6", `alias row value (${alias})`)
      if (ctx.shots) await page.screenshot({ path: `${ctx.shots}/board27-bindings-picker.png` })
      const create = await page.locator(".kimo-variable-picker__create").textContent()
      expect(create === "Create variable from 16", `create label (${create})`)
      // Search filters; ↓ ↵ binds the first match.
      await page.keyboard.type("gutter")
      await page.keyboard.press("Enter")
      await page.locator(".kimo-variable-picker").waitFor({ state: "detached" })
      let n = await node(page, "frameBind001")
      expect(
        JSON.stringify((n?.layout as Record<string, unknown>)?.gap) === '{"$ref":"space/gutter"}',
        `gap bound via search + Enter (${JSON.stringify(n?.layout)})`,
      )

      // (c) Bound field (egdNP) at rest: chip, resolved value hidden in the half-width field.
      await page.mouse.move(5, 5)
      const bound = await measure(page, {
        frame: ".rp-gap-hover .kimo-prop-field-bound",
        prefix: ".rp-gap-hover .kimo-prop-field-bound__prefix",
        chip: ".rp-gap-hover .kimo-prop-field-bound__chip",
        glyph: ".rp-gap-hover .kimo-prop-field-bound__glyph",
        name: ".rp-gap-hover .kimo-prop-field-bound__name",
      })
      const c = checker(ctx, "PropField/Bound (egdNP)")
      c.box("Frame egdNP", bound.frame, {
        h: 28,
        pad: "0 4 0 8",
        gap: 6,
        radius: 6,
        bg: T["--kimo-bg-subtle"],
      })
      c.box("Prefix m2mZXW", bound.prefix, {
        fs: 11,
        ff: "Inter",
        color: T["--kimo-text-tertiary"],
      })
      c.box("Variable Chip ZtFyB", bound.chip, {
        pad: "2 6 2 5",
        gap: 4,
        radius: 4,
        bg: T["--kimo-bg-app"],
        shadowHas: T["--kimo-border-strong"],
      })
      c.box("Glyph r6ZAyc (hash)", bound.glyph, {
        w: 10,
        h: 10,
        color: T["--kimo-text-tertiary"],
      })
      c.box("Name D4Hy8R", bound.name, {
        fs: 11,
        ff: "JetBrains Mono",
        color: T["--kimo-text-primary"],
      })
      c.flush()
      const hidden = await page.evaluate(() => {
        const r = document.querySelector(".rp-gap-hover .kimo-prop-field-bound__resolved")
        return r ? getComputedStyle(r).display : "absent"
      })
      expect(hidden === "none", `resolved value hidden < 140 px (${hidden})`)
      const tip = await page
        .locator(".rp-gap-hover .kimo-prop-field-bound__chip")
        .getAttribute("title")
      expect(tip === "space/gutter = 24", `chip tooltip carries the value (${tip})`)

      // Hover → Detach (TwQNv): stroke + unlink button; click writes the resolved literal.
      await page.locator(".rp-gap-hover .kimo-prop-field-bound").hover()
      const det = await measure(page, {
        frame: ".rp-gap-hover .kimo-prop-field-bound",
        detach: ".rp-gap-hover .kimo-prop-field-bound__detach",
        icon: ".rp-gap-hover .kimo-prop-field-bound__detach svg",
      })
      const d = checker(ctx, "PropField/Bound · hover → detach (TwQNv)")
      d.box("Frame", det.frame, { shadowHas: T["--kimo-border-strong"] })
      d.box("Detach Button c21X7y", det.detach, { w: 20, h: 20, radius: 4 })
      d.box("Icon E7RYAK (unlink)", det.icon, { w: 12, h: 12, color: T["--kimo-text-secondary"] })
      d.flush()
      await page.locator(".rp-gap-hover .kimo-prop-field-bound__detach").click()
      await settle(page)
      n = await node(page, "frameBind001")
      expect(
        (n?.layout as Record<string, unknown>)?.gap === 24,
        `detach keeps the resolved value (${JSON.stringify(n?.layout)})`,
      )
      // One undo step brings the binding back.
      await page.locator(".canvas-host").focus()
      await page.keyboard.press("ControlOrMeta+z")
      await settle(page)
      n = await node(page, "frameBind001")
      expect(
        JSON.stringify((n?.layout as Record<string, unknown>)?.gap) === '{"$ref":"space/gutter"}',
        "undo restores the binding",
      )
    },
  },
  {
    name: "board27 bindings: create from value, ⌥-click label, padding sides, missing (gD832)",
    async run(ctx: E2EContext) {
      const { page } = ctx
      await openEditor(page, ctx.url)
      await fixture(page)
      await sel(page, ["frameBind001"])
      await settle(page)
      // ⌥-click the Gap prefix opens the picker directly; Create variable from 16 binds it.
      const prefix = page.locator(".rp-gap-hover .kimo-prop-field__prefix")
      await prefix.click({ modifiers: ["Alt"] })
      await page.locator(".kimo-variable-picker").waitFor()
      await page.locator(".kimo-variable-picker__create").click()
      await settle(page)
      const n = await node(page, "frameBind001")
      expect(
        JSON.stringify((n?.layout as Record<string, unknown>)?.gap) === '{"$ref":"space/16"}',
        `created + bound (${JSON.stringify(n?.layout)})`,
      )
      const v = await page.evaluate(
        () =>
          (
            (window as unknown as { __kimo: M2Hook }).__kimo.session.store.toDocument() as {
              variables?: Record<string, unknown>
            }
          ).variables?.["space/16"],
      )
      expect(
        JSON.stringify(v) === '{"type":"number","value":16}',
        `variable (${JSON.stringify(v)})`,
      )

      // Horizontal padding (Px) binds both sides; the vertical sides stay literal.
      const pad = section(page, "Auto layout").locator(".rp-row .rp-bind").first()
      await pad.hover()
      await pad.locator(".kimo-bind-button").click()
      await page.locator('.kimo-variable-picker [data-ref="space/4"]').click()
      await settle(page)
      let m = await node(page, "frameBind001")
      expect(
        JSON.stringify((m?.layout as Record<string, unknown>)?.pad) === '[16,{"$ref":"space/4"}]',
        `pad [v, $h] (${JSON.stringify(m?.layout)})`,
      )
      const chip = await pad.locator(".kimo-prop-field-bound__prefix").textContent()
      expect(chip === "Px", `Padding H chip prefix Px (${chip})`)
      // Individual padding keeps each side's binding; T edits leave R / L bound.
      await page.getByRole("switch", { name: "Individual padding" }).click()
      await settle(page)
      const sides = await section(page, "Auto layout")
        .locator(".rp-sides .kimo-prop-field-bound__name")
        .allTextContents()
      expect(sides.join("|") === "space/4|space/4", `R / L chips (${sides.join("|")})`)
      await page.getByRole("textbox", { name: "Padding top", exact: true }).fill("12")
      await page.keyboard.press("Enter")
      await settle(page)
      m = await node(page, "frameBind001")
      expect(
        JSON.stringify((m?.layout as Record<string, unknown>)?.pad) ===
          '[12,{"$ref":"space/4"},16,{"$ref":"space/4"}]',
        `side edit keeps bindings (${JSON.stringify(m?.layout)})`,
      )

      // Missing variable (gD832): the store refuses to delete a variable in use, so a missing
      // binding only arises from a library change; measure the state's styles on a probe.
      await page.mouse.move(5, 5)
      await page.evaluate(() => {
        const host = document.querySelector(".design-tab") as HTMLElement
        const probe = document.createElement("div")
        probe.id = "missing-probe"
        probe.className = "kimo-prop-field-bound kimo-prop-field-bound--missing"
        probe.innerHTML =
          '<button class="kimo-prop-field-bound__chip"><span class="kimo-prop-field-bound__name">space/legacy</span></button>'
        host.append(probe)
      })
      const T = await tokens(page, ["--kimo-danger"])
      const miss = await measure(page, {
        chip: "#missing-probe .kimo-prop-field-bound__chip",
        name: "#missing-probe .kimo-prop-field-bound__name",
      })
      const c = checker(ctx, "PropField/Bound · missing (gD832)")
      c.box("Chip ZtFyB stroke danger", miss.chip, { shadowHas: T["--kimo-danger"] })
      c.box("Name D4Hy8R danger", miss.name, { color: T["--kimo-danger"] })
      c.flush()
    },
  },
  {
    name: "board27 bindings: opacity chip, Visible + Content rows, mixed selection",
    async run(ctx: E2EContext) {
      const { page } = ctx
      await openEditor(page, ctx.url)
      await fixture(page)
      await applyOps(page, [
        {
          op: "update",
          id: "frameBind001",
          set: { opacity: { $ref: "opacity/muted" }, visible: { $ref: "show/badge" } },
        },
        { op: "update", id: "frameBind002", set: { opacity: { $ref: "opacity/muted" } } },
        { op: "update", id: "textBind0001", set: { content: { $ref: "copy/cta" } } },
      ])
      await sel(page, ["frameBind001"])
      await settle(page)
      const T = await tokens(page, ["--kimo-text-tertiary"])
      const layer = section(page, "Layer")
      const op = await layer.locator(".kimo-prop-field-bound__name").first().textContent()
      expect(op === "opacity/muted", `opacity chip (${op})`)
      const vis = await measure(page, {
        row: ".design-tab .rp-bind-row",
        label: ".design-tab .rp-bind-row .rp-bind-label",
        field: ".design-tab .rp-bind-row .kimo-prop-field-bound",
        glyph: ".design-tab .rp-bind-row .kimo-prop-field-bound__glyph",
        resolved: ".design-tab .rp-bind-row .kimo-prop-field-bound__resolved",
      })
      const c = checker(ctx, "Visible row (kRMBZ)")
      c.box("Visible kRMBZ", vis.row, { gap: 8, align: "center", dir: "row" })
      c.box("Label zZyoY", vis.label, { fs: 11, ff: "Inter", color: T["--kimo-text-tertiary"] })
      c.box("Visibility IEOmv", vis.field, { h: 28 })
      c.box("Resolved r1TUXL", vis.resolved, { fs: 11, ff: "JetBrains Mono" })
      c.flush()
      const vtext = await page
        .locator(".design-tab .rp-bind-row .kimo-prop-field-bound__resolved")
        .textContent()
      expect(vtext === "true", `visibility resolved (${vtext})`)
      expect(
        (await page.locator(".design-tab .rp-bind-row .lucide-toggle-left").count()) === 1,
        "boolean glyph toggle-left",
      )

      if (ctx.shots)
        await page
          .locator(".right-panel")
          .screenshot({ path: `${ctx.shots}/board27-bindings-panel.png` })
      // Mixed selection: both frames share opacity/muted → chip; visibility differs → no row.
      await sel(page, ["frameBind001", "frameBind002"])
      await settle(page)
      expect(
        (await section(page, "Layer").locator(".kimo-prop-field-bound").count()) === 1,
        "shared binding shows the chip",
      )
      expect((await page.locator(".design-tab .rp-bind-row").count()) === 0, "no Visible row")
      // Gap: 16 vs 16 literal → value; binding applies to both.
      await section(page, "Auto layout").locator(".rp-gap-hover .rp-bind").hover()
      await page.locator(".rp-gap-hover .kimo-bind-button").click()
      await page.locator('.kimo-variable-picker [data-ref="space/2"]').click()
      await settle(page)
      for (const id of ["frameBind001", "frameBind002"]) {
        const n = await node(page, id)
        expect(
          JSON.stringify((n?.layout as Record<string, unknown>)?.gap) === '{"$ref":"space/2"}',
          `${id} gap bound`,
        )
      }

      // Text content (EYpeL): chip at the top of the Text section, quoted value.
      await sel(page, ["textBind0001"])
      await settle(page)
      const text = section(page, "Text")
      const name = await text.locator(".kimo-prop-field-bound__name").first().textContent()
      const val = await text.locator(".kimo-prop-field-bound__resolved").first().textContent()
      expect(name === "copy/cta" && val === "“Start free”", `content chip (${name} ${val})`)
      // Editing bound text on canvas asks "Detach copy/cta?" first.
      const p = await centerOf(page, "textBind0001")
      await page.mouse.dblclick(p.x, p.y)
      const dialog = page.getByRole("alertdialog", { name: /Detach copy\/cta\?/ })
      await dialog.waitFor()
      await dialog.getByRole("button", { name: "Detach & edit" }).click()
      await settle(page)
      const t = await node(page, "textBind0001")
      expect(t?.content === "Start free", `content detached (${JSON.stringify(t?.content)})`)
      await page.keyboard.press("Escape")
    },
  },
  {
    name: "board27 bindings: layer menu Detach all variables · Bind visibility…",
    async run(ctx: E2EContext) {
      const { page } = ctx
      await openEditor(page, ctx.url)
      await fixture(page)
      await applyOps(page, [
        {
          op: "update",
          id: "frameBind001",
          set: {
            opacity: { $ref: "opacity/muted" },
            layout: { dir: "row", gap: { $ref: "space/4" }, pad: [{ $ref: "space/2" }, 24] },
          },
        },
      ])
      await sel(page, ["frameBind001"])
      await settle(page)
      const p = await centerOf(page, "frameBind001")
      await page.mouse.click(p.x, p.y, { button: "right" })
      const menu = page.getByTestId("canvas-context-menu")
      await menu.waitFor()
      const labels = await menu.locator(".kimo-menu-item-dense__label").allTextContents()
      expect(
        labels.includes("Detach all variables") && labels.includes("Bind visibility to variable…"),
        `variable items (${labels.join("|")})`,
      )
      expect(!labels.includes("Bind text to variable…"), "no text item for a frame")
      await menu.getByText("Detach all variables").click()
      await settle(page)
      const n = await node(page, "frameBind001")
      expect(
        n?.opacity === 0.64 && JSON.stringify(n?.layout) === '{"dir":"row","gap":16,"pad":[8,24]}',
        `all literal (${JSON.stringify([n?.opacity, n?.layout])})`,
      )
      // Bind visibility…: the Visible row appears with the picker open (boolean variables).
      await page.mouse.click(p.x, p.y, { button: "right" })
      await menu.waitFor()
      await menu.getByText("Bind visibility to variable…").click()
      await page.locator(".kimo-variable-picker").waitFor()
      const rows = await page
        .locator(".kimo-variable-picker .kimo-variable-list-row__name")
        .allTextContents()
      expect(rows.join("|") === "show/badge", `boolean only (${rows.join("|")})`)
      await page.locator('.kimo-variable-picker [data-ref="show/badge"]').click()
      await settle(page)
      const v = await node(page, "frameBind001")
      expect(JSON.stringify(v?.visible) === '{"$ref":"show/badge"}', "visibility bound")
    },
  },
]
