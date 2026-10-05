/**
 * Board 27 §8 Components (desing.pen d7gkR) in the real web editor: (a) enum prop per-option
 * targets, (b) Replace main with selection, (c) Fix broken overrides (strip + review), (d) ⌘D on
 * a main component. One measured pass per surface (getComputedStyle + getBoundingClientRect vs
 * the design node values).
 */
import type { Page } from "playwright"
import { checker, measure, tokens } from "./board25-helpers"
import { openEditor, settle } from "./qa-helpers"
import { applyOps, type M2Hook } from "./qa-m2-helpers"
import { type E2EContext, expect, type Scenario } from "./run"

type W = {
  __kimo: M2Hook & {
    m3: {
      view(): { getNode(id: string): Record<string, unknown> | undefined }
      componentDialog: { get(): unknown }
    }
  }
}

const sel = (page: Page, ids: string[]) =>
  page.evaluate((x) => (window as unknown as W).__kimo.session.ui.getState().select(x), ids)
const getNode = (page: Page, id: string) =>
  page.evaluate(
    (i) => (window as unknown as W).__kimo.session.store.getNode(i) as Record<string, unknown>,
    id,
  )
const viewNode = (page: Page, id: string) =>
  page.evaluate((i) => (window as unknown as W).__kimo.m3.view().getNode(i) ?? null, id)
const nodes = (page: Page) =>
  page.evaluate(
    () =>
      (
        (window as unknown as W).__kimo.session.store as unknown as {
          toDocument(): { nodes: unknown }
        }
      ).toDocument().nodes as Record<string, Record<string, unknown>>,
  )

const BUTTON = [
  {
    op: "insert",
    id: "Button0001",
    parent: null,
    node: {
      type: "frame",
      name: "Button",
      x: 40,
      y: 40,
      fill: "#111111",
      radius: 8,
      layout: { dir: "row", gap: 6, pad: [8, 14] },
      component: {
        props: {
          size: {
            type: "enum",
            options: { sm: null, md: null, lg: null },
            targets: {
              sm: [{ target: "BtnLabel01", field: "style/size", value: 12 }],
              md: [
                { target: "Button0001", field: "layout/pad", value: [8, 14] },
                { target: "BtnLabel01", field: "style/size", value: 14 },
                { target: "BtnIcon001", field: "w", value: 16 },
                { target: "BtnIcon001", field: "h", value: 16 },
              ],
              lg: [{ target: "BtnLabel01", field: "style/size", value: 16 }],
            },
          },
        },
      },
    },
  },
  {
    op: "insert",
    id: "BtnIcon001",
    parent: "Button0001",
    node: { type: "icon", name: "Icon", w: 16, h: 16, set: "lucide", icon: "plus" },
  },
  {
    op: "insert",
    id: "BtnLabel01",
    parent: "Button0001",
    node: {
      type: "text",
      name: "Label",
      content: "Button",
      fill: "#FFFFFF",
      style: { font: "Inter", size: 14 },
    },
  },
  {
    op: "insert",
    id: "BtnInst001",
    parent: null,
    node: { type: "instance", of: "Button0001", x: 40, y: 140, args: { size: "lg" } },
  },
]

const TOKENS = [
  "--kimo-text-primary",
  "--kimo-text-secondary",
  "--kimo-text-tertiary",
  "--kimo-bg-subtle",
  "--kimo-bg-hover",
  "--kimo-bg-muted",
  "--kimo-success",
  "--kimo-warning",
  "--kimo-warning-soft",
  "--kimo-component",
  "--kimo-component-soft",
]

export const scenarios: Scenario[] = [
  {
    name: "board27 components (a): enum per-option targets (e0wsU) + measured",
    async run(ctx: E2EContext) {
      const { page } = ctx
      await openEditor(page, ctx.url)
      await applyOps(page, BUTTON)
      // An instance with size lg: the label is 16, the root keeps its padding.
      const label = await viewNode(page, "BtnInst001/BtnLabel01")
      expect((label?.style as { size?: number })?.size === 16, "lg sets the label's font size")
      await sel(page, ["Button0001"])
      await settle(page)
      const block = page.locator('.kimo-enum-options[data-options="size"]')
      await block.waitFor()
      // md tab → its four stored targets read as three rows (Size = w + h).
      await block.getByRole("radio", { name: "md" }).click()
      await settle(page)
      const rows = page.locator(".kimo-enum-targets__row")
      expect((await rows.count()) === 3, `md shows 3 target rows (got ${await rows.count()})`)
      const T = await tokens(page, TOKENS)
      const m = await measure(page, {
        def: ".kimo-prop-def-row--enum",
        options: ".kimo-enum-options",
        label: ".kimo-enum-options__label",
        tabs: ".kimo-enum-options__tabs",
        dflt: ".kimo-enum-options__default",
        targets: ".kimo-enum-targets",
        head: ".kimo-enum-targets__head",
        headLayer: ".kimo-enum-targets__col--layer",
        row: ".kimo-enum-targets__row",
        layer: ".kimo-enum-targets__row .kimo-enum-targets__layer",
        value: ".kimo-enum-targets__row .kimo-enum-targets__value",
        remove: ".kimo-enum-targets__row .kimo-enum-targets__remove",
        pad: ".kimo-enum-targets__pad",
        add: ".kimo-enum-targets__add",
        addLabel: ".kimo-enum-targets__add-label",
      })
      const c = checker(ctx, "Enum prop · per-option targets (e0wsU)")
      c.box("PropDef · Size (e0wsU)", m.def, { gap: 10, pad: "8 0 14 0", dir: "column" })
      c.box("Options (BRh1V)", m.options, { gap: 6, pad: "0 0 0 24", align: "center" })
      c.box("Label F5j29o", m.label, { fs: 11, color: T["--kimo-text-tertiary"] })
      c.box("Option tabs (FC6O7)", m.tabs, { h: 28, pad: "2 2 2 2", gap: 2 })
      c.box("Default lUoLh", m.dflt, { fs: 11, color: T["--kimo-text-tertiary"] })
      c.box("Targets · md (j7xiy)", m.targets, { gap: 6, pad: "0 0 0 24", dir: "column" })
      c.box("Head QD3yo", m.head, { h: 16, gap: 6 })
      c.box("Head Layer V7vHAj", m.headLayer, { fs: 11, color: T["--kimo-text-tertiary"] })
      c.box("Target row N7qK6U", m.row, { h: 28, gap: 6, align: "center" })
      c.box("Layer Select gHsU6", m.layer, { h: 28 })
      c.box("Value PropField cNwVS", m.value, { h: 28, bg: T["--kimo-bg-subtle"] })
      c.box("Remove J29se", m.remove, { w: 24, h: 24 })
      c.box("Pad OJWfV", m.pad, { w: 24 })
      c.box("Add target s1tIIS", m.add, { h: 23, gap: 6, pad: "4 0 4 0" })
      c.box("Add target label bqb6E", m.addLabel, { fs: 12, color: T["--kimo-text-secondary"] })
      c.flush()
      expect(
        Math.abs((m.layer?.w ?? 0) - (m.headLayer?.w ?? -1)) < 1,
        `the Layer column lines up with its head (${m.layer?.w} vs ${m.headLayer?.w}, value ${m.value?.w}, row ${m.row?.w})`,
      )
      // Add target → a fourth row; edit its value → stored in targets form.
      await page.locator(".kimo-enum-targets__add").click()
      await settle(page)
      expect((await rows.count()) === 4, "Add target appends a row")
      const v = page.getByLabel("Target 1 value")
      await v.click()
      await v.fill("10 · 18")
      await v.press("Enter")
      await settle(page)
      const comp = (await getNode(page, "Button0001")).component as {
        props: { size: { targets: Record<string, { field: string; value: unknown }[]> } }
      }
      const def = comp.props.size
      expect(
        JSON.stringify(def.targets.md?.[0]?.value) === "[10,18]",
        `pad edited (${JSON.stringify(def.targets.md?.[0])})`,
      )
    },
  },
  {
    name: "board27 components (b, c): replace main with selection → fix broken overrides + measured",
    async run(ctx: E2EContext) {
      const { page } = ctx
      await openEditor(page, ctx.url)
      await applyOps(page, [
        {
          op: "insert",
          id: "Card000001",
          parent: null,
          node: {
            type: "frame",
            name: "Card",
            x: 40,
            y: 40,
            w: 200,
            h: 120,
            fill: "#FFFFFF",
            component: true,
          },
        },
        {
          op: "insert",
          id: "CardTitle1",
          parent: "Card000001",
          node: { type: "text", name: "Title", content: "T" },
        },
        {
          op: "insert",
          id: "CardBadge1",
          parent: "Card000001",
          node: { type: "rect", name: "Badge", w: 10, h: 10 },
        },
        {
          op: "insert",
          id: "CardInst01",
          parent: null,
          node: {
            type: "instance",
            name: "Pricing Card",
            of: "Card000001",
            x: 300,
            y: 40,
            overrides: {
              CardTitle1: { set: { content: "Hello" } },
              CardBadge1: { set: { visible: false } },
            },
          },
        },
        {
          op: "insert",
          id: "CardV20001",
          parent: null,
          node: { type: "frame", name: "Card v2", x: 40, y: 300, w: 240, h: 140, fill: "#F0F0F0" },
        },
        {
          op: "insert",
          id: "V2Title001",
          parent: "CardV20001",
          node: { type: "text", name: "Title", content: "T2" },
        },
      ])
      await sel(page, ["Card000001", "CardV20001"])
      await settle(page)
      // Right-click the main with Card v2 also selected → "Replace main with selection…".
      await page.evaluate(() => {
        const k = (window as unknown as W).__kimo as unknown as {
          m3: { componentDialog: { set(v: unknown): void } }
        }
        k.m3.componentDialog.set({ kind: "replaceMain", main: "Card000001", source: "CardV20001" })
      })
      const dlg = page.locator("[data-testid=replace-main-dialog] .kimo-dialog")
      await dlg.waitFor()
      const text = (await dlg.textContent()) ?? ""
      expect(text.includes("Replace “Card” with “Card v2”?"), `title (${text})`)
      expect(text.includes("1 instance update"), "instances line")
      expect(text.includes("1 override kept, matched by layer name"), "kept line")
      expect(text.includes("1 override can't be matched. Review them after"), "unmatched line")
      const T = await tokens(page, TOKENS)
      const m = await measure(page, {
        dialog: "[data-testid=replace-main-dialog] .kimo-dialog",
        wrap: "[data-testid=replace-main-dialog] .kimo-dialog__icon-wrap",
        body: ".m3-replace-body",
        line: ".m3-replace-body__line",
        ok: ".m3-replace-body__icon--success",
        warn: ".m3-replace-body__icon--warning",
        t: ".m3-replace-body__text",
      })
      const c = checker(ctx, "Dialog · Replace main (FM0o5)")
      c.box("Dialog", m.dialog, { w: 400 })
      c.box("Icon Wrap nlNhT", m.wrap, {
        w: 32,
        h: 32,
        bg: T["--kimo-component-soft"],
        color: T["--kimo-component"],
      })
      c.box("Body R8Sfb", m.body, { gap: 6, pad: "10 12 10 12", bg: T["--kimo-bg-subtle"] })
      c.box("Line ZRdLh", m.line, { gap: 8, align: "center" })
      c.box("Icon T1O9VG", m.ok, { w: 14, h: 14, color: T["--kimo-success"] })
      c.box("Icon hTDUg", m.warn, { w: 14, h: 14, color: T["--kimo-warning"] })
      c.box("T rkxbV", m.t, { fs: 12, color: T["--kimo-text-primary"] })
      c.flush()
      await dlg.getByRole("button", { name: "Replace" }).click()
      await settle(page)
      const after = await nodes(page)
      expect(!after.CardV20001 && !after.CardTitle1, "old layers and the selection root are gone")
      expect(after.V2Title001?.parent === "Card000001", "the selection's layers are the main's")
      expect(after.Card000001?.w === 240, "the main takes the selection's look")
      const inst = after.CardInst01 as Record<string, unknown>
      expect(
        JSON.stringify(inst.overrides) === '{"V2Title001":{"set":{"content":"Hello"}}}',
        `override re-keyed by name (${JSON.stringify(inst.overrides)})`,
      )
      // (c) The instance panel's Broken strip → Review.
      await sel(page, ["CardInst01"])
      await settle(page)
      const strip = page.locator("[data-testid=broken-strip]")
      await strip.waitFor()
      expect(((await strip.textContent()) ?? "").includes("1 override doesn't match"), "strip")
      const s = await measure(page, {
        strip: "[data-testid=broken-strip]",
        icon: ".m3-broken-strip__icon",
        label: ".m3-broken-strip__label",
        action: ".m3-broken-strip__action",
      })
      const cs = checker(ctx, "Instance panel · Broken strip (c16xy)")
      cs.box("Broken strip c16xy", s.strip, {
        gap: 8,
        pad: "8 12 8 12",
        bg: T["--kimo-warning-soft"],
        align: "center",
      })
      cs.box("Icon sWnw6", s.icon, { w: 14, h: 14, color: T["--kimo-warning"] })
      cs.box("Label vQ9Ia", s.label, { fs: 11, color: T["--kimo-text-primary"], fw: "400" })
      cs.box("Action HyzBI", s.action, { fs: 11, fw: "600" })
      cs.flush()
      await strip.getByRole("button", { name: "Review" }).click()
      const fix = page.locator("[data-testid=fix-overrides-dialog] .kimo-dialog")
      await fix.waitFor()
      const f = await measure(page, {
        dialog: "[data-testid=fix-overrides-dialog] .kimo-dialog",
        wrap: "[data-testid=fix-overrides-dialog] .kimo-dialog__icon-wrap",
        row: ".m3-fix-row",
        where: ".m3-fix-row__where",
        inst: ".m3-fix-row__instance",
        path: ".m3-fix-row__path",
        ov: ".m3-fix-row__override",
        reason: ".m3-fix-row__reason",
        action: ".m3-fix-row__action",
      })
      const cf = checker(ctx, "Dialog · Fix broken overrides (ZNXQU)")
      cf.box("Dialog", f.dialog, { w: 776 })
      cf.box("Icon Wrap nlNhT", f.wrap, { bg: T["--kimo-warning-soft"] })
      cf.box("Row VqL2V", f.row, { gap: 10, pad: "8 0 8 0", align: "center" })
      cf.box("Where AGzzn", f.where, { w: 150, gap: 2, dir: "column" })
      cf.box("Instance GL0Fn", f.inst, { fs: 12, color: T["--kimo-text-primary"] })
      cf.box("Path t4OtOD", f.path, { fs: 11, color: T["--kimo-text-tertiary"] })
      cf.box("Override xTiBz", f.ov, { w: 110, fs: 11, color: T["--kimo-text-secondary"] })
      cf.box("Reason mHzMx", f.reason, { fs: 11, color: T["--kimo-text-tertiary"] })
      cf.box("Action bFLYJ", f.action, { w: 190, h: 28 })
      cf.flush()
      const fixText = (await fix.textContent()) ?? ""
      expect(fixText.includes("visible: false") && fixText.includes("Layer removed"), fixText)
      expect(fixText.includes("Remap → Title"), "suggested remap by layer type")
      // Reset all → Apply drops the stashed override.
      await fix.getByRole("button", { name: "Reset all" }).click()
      await fix.getByRole("button", { name: /^Apply 1 fix$/ }).click()
      await settle(page)
      const fixed = (await getNode(page, "CardInst01")) as Record<string, unknown>
      expect(fixed.meta === undefined, "the stash is cleared")
      expect((await strip.count()) === 0, "no strip once every override matches")
    },
  },
  {
    name: "board27 components (d): ⌘D on a main asks; new component / remembered instance + measured",
    async run(ctx: E2EContext) {
      const { page } = ctx
      await openEditor(page, ctx.url)
      await applyOps(page, BUTTON.slice(0, 3))
      await sel(page, ["Button0001"])
      await settle(page)
      await page
        .locator(".canvas-host")
        .click({ position: { x: 5, y: 5 } })
        .catch(() => {})
      await sel(page, ["Button0001"])
      await page.keyboard.press("Meta+d")
      const dlg = page.locator("[data-testid=duplicate-main-dialog] .kimo-dialog")
      await dlg.waitFor()
      const T = await tokens(page, TOKENS)
      const m = await measure(page, {
        dialog: "[data-testid=duplicate-main-dialog] .kimo-dialog",
        body: ".m3-dup-body",
        on: ".m3-dup-option--on",
        tile: ".m3-dup-option--on .m3-dup-option__tile",
        name: ".m3-dup-option--on .m3-dup-option__name",
        desc: ".m3-dup-option--on .m3-dup-option__desc",
        check: ".m3-dup-option__check",
        remember: ".m3-dup-remember",
        box: ".m3-dup-remember__box",
        rlabel: ".m3-dup-remember__label",
      })
      const c = checker(ctx, "Dialog · Duplicate main (Y47JJA)")
      c.box("Dialog", m.dialog, { w: 400 })
      c.box("Body NqNjc", m.body, { gap: 4, dir: "column" })
      c.box("Option · As an instance ENuZU", m.on, {
        gap: 10,
        pad: "8 8 8 8",
        radius: 10,
        bg: T["--kimo-bg-hover"],
      })
      c.box("Tile xhNUb", m.tile, {
        w: 28,
        h: 28,
        bg: T["--kimo-component-soft"],
        color: T["--kimo-component"],
      })
      c.box("Name MTHEE", m.name, { fs: 12, fw: "500", color: T["--kimo-text-primary"] })
      c.box("Desc qyR7W", m.desc, { fs: 11, color: T["--kimo-text-secondary"] })
      c.box("Check F9baR", m.check, { w: 14, h: 14, color: T["--kimo-text-primary"] })
      c.box("Remember roLMl", m.remember, { gap: 8, pad: "6 8 0 8" })
      c.box("Box GiRcU", m.box, { w: 14, h: 14, radius: 3 })
      c.box("Label QJebg", m.rlabel, { fs: 11, color: T["--kimo-text-secondary"] })
      c.flush()
      // As a new component → "Button 2" with its props.
      await dlg.getByRole("radio", { name: /As a new component/ }).click()
      await dlg.getByRole("button", { name: "Duplicate" }).click()
      await settle(page)
      const all = await nodes(page)
      const copy = Object.entries(all).find(([, n]) => n.name === "Button 2")
      expect(copy?.[1].component, "a new main “Button 2”")
      // Remember "As an instance" → the next ⌘D duplicates without asking.
      await sel(page, ["Button0001"])
      await page.keyboard.press("Meta+d")
      await dlg.waitFor()
      await page.locator(".m3-dup-remember").click()
      await dlg.getByRole("button", { name: "Duplicate" }).click()
      await settle(page)
      await sel(page, ["Button0001"])
      await page.keyboard.press("Meta+d")
      await settle(page)
      expect((await dlg.count()) === 0, "remembered: no dialog")
      const instances = Object.values(await nodes(page)).filter(
        (n) => n.type === "instance" && n.of === "Button0001",
      )
      expect(instances.length === 2, `two instances (got ${instances.length})`)
    },
  },
]
