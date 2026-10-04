/**
 * M3 editor scenarios (boards 11–15): layers mirror instances (composite ids), panel edits on
 * instance children become overrides (one undo step), override dots + reset, Instance section
 * (summary, popover, detach confirm), create component (⌥⌘K + toast), Assets tab (groups,
 * insert), Component section (props, description meta key), slot section, rejected-edit
 * toasts, Variables tab / dialog, libraries (inject, missing banner, unlink confirm), and one
 * measured getComputedStyle / getBoundingClientRect pass against the design node values.
 */
import type { Page } from "playwright"
import { docJson, openEditor, settle } from "./qa-helpers"
import { type E2EContext, expect, type Scenario } from "./run"

type Rec = Record<string, unknown>
type W = {
  __kimo: {
    session: {
      store: {
        getNode(id: string): Rec | undefined
        undo(o: string): unknown
        toDocument(): Rec
        nodeIds(): string[]
      }
      apply(ops: unknown[], label?: string): boolean
      ui: { getState(): { selection: string[]; select(ids: string[]): void } }
    }
    m3: {
      view(): {
        children(p: string | null): string[]
        getNode(id: string): Rec | undefined
        isVirtual(id: string): boolean
      }
      libs: { inject(alias: string, path: string, doc: unknown, status?: string): void }
      run(cmd: unknown, label: string): { ok: boolean }
      toasts: { get(): { text: string; tone: string }[] }
    }
  }
}

/** Main `Card/Pricing` (Title text, Badge rect, Actions slot frame) + instance `Card · Pro`. */
async function fixture(page: Page) {
  const ok = await page.evaluate(() => {
    const s = (window as unknown as W).__kimo.session
    return s.apply(
      [
        {
          op: "insert",
          id: "main000001",
          parent: null,
          node: {
            type: "frame",
            name: "Card/Pricing",
            x: 40,
            y: 40,
            w: 220,
            h: 200,
            fill: "#FFFFFF",
            component: true,
            layout: { dir: "column", gap: 10, pad: 16 },
          },
        },
        {
          op: "insert",
          id: "title00001",
          parent: "main000001",
          node: { type: "text", name: "Title", content: "Plan name", fill: "#2A1E14" },
        },
        {
          op: "insert",
          id: "badge00001",
          parent: "main000001",
          node: { type: "rect", name: "Badge", w: 40, h: 16, fill: "#F6DFC6" },
        },
        {
          op: "insert",
          id: "actions001",
          parent: "main000001",
          node: { type: "frame", name: "Actions", w: 188, h: 40, slot: {} },
        },
        {
          op: "insert",
          id: "inst000001",
          parent: null,
          node: { type: "instance", name: "Card · Pro", of: "main000001", x: 320, y: 40 },
        },
      ],
      "fixture",
    )
  })
  expect(ok, "fixture applied")
  await settle(page)
}

const w = (page: Page) =>
  page.evaluate(() => (window as unknown as W).__kimo.session.ui.getState().selection)
const select = (page: Page, ids: string[]) =>
  page.evaluate((i) => (window as unknown as W).__kimo.session.ui.getState().select(i), ids)
const undo = (page: Page) =>
  page.evaluate(() => (window as unknown as W).__kimo.session.store.undo("user"))
const getNode = (page: Page, id: string) =>
  page.evaluate((i) => (window as unknown as W).__kimo.session.store.getNode(i) ?? null, id)
const toasts = (page: Page) =>
  page.evaluate(() => (window as unknown as W).__kimo.m3.toasts.get().map((t) => t.text))

async function oneStep(page: Page, before: string, what: string) {
  expect((await docJson(page)) !== before, `${what}: changed the document`)
  await undo(page)
  await settle(page)
  expect((await docJson(page)) === before, `${what}: one undo step restores it`)
}

async function layersMirrorInstance({ page, url }: E2EContext) {
  await openEditor(page, url)
  await fixture(page)
  const instRow = page.locator('.layer-tree [data-node-id="inst000001"]')
  await instRow.waitFor()
  expect(
    (await instRow.getAttribute("data-kind")) === "instance",
    "instance row uses LayerRow/Instance",
  )
  const mainRow = page.locator('.layer-tree [data-node-id="main000001"]')
  expect(
    (await mainRow.getAttribute("data-kind")) === "component",
    "main row uses LayerRow/Component",
  )
  // Expand the instance: its children are the main's, with composite ids.
  await instRow.locator(".kimo-layer-row-m3__disclosure").click()
  const titleRow = page.locator('.layer-tree [data-node-id="inst000001/title00001"]')
  await titleRow.waitFor()
  const slotRow = page.locator('.layer-tree [data-node-id="inst000001/actions001"]')
  expect((await slotRow.getAttribute("data-kind")) === "slot", "slot frame shows LayerRow/Slot")
  expect(
    (await slotRow.locator(".kimo-layer-row-m3__tag-label").textContent()) === "slot",
    "Slot Tag 'slot'",
  )
  await titleRow.click()
  expect((await w(page))[0] === "inst000001/title00001", "row selects the composite id")
  await page.locator(".selection-header__name", { hasText: "Title" }).waitFor()
}

async function childEditBecomesOverride({ page, url }: E2EContext) {
  await openEditor(page, url)
  await fixture(page)
  await select(page, ["inst000001/badge00001"])
  await settle(page)
  const before = await docJson(page)
  // Hide via the layers row eye → `overrides.badge00001.set.visible = false` on the instance.
  const ok = await page.evaluate(() =>
    (window as unknown as W).__kimo.session.apply(
      [{ op: "update", id: "inst000001/badge00001", set: { fill: "#E2683A" } }],
      "Fill",
    ),
  )
  expect(ok, "routed edit applied")
  const inst = await getNode(page, "inst000001")
  const ov = (inst?.overrides as Rec | undefined)?.badge00001 as Rec | undefined
  expect((ov?.set as Rec | undefined)?.fill === "#E2683A", "edit became an override set")
  expect((await getNode(page, "badge00001"))?.fill === "#F6DFC6", "the main is untouched")
  await settle(page)
  // Override dot on the Fill section title; click resets that field.
  const dot = page.locator('.design-tab .m3-section-title [data-testid="override-dot"]').first()
  await dot.waitFor()
  await dot.click()
  await settle(page)
  const after = await getNode(page, "inst000001")
  expect(!after?.overrides, "dot click reset the override")
  await undo(page) // undo the reset
  await settle(page)
  await oneStep(page, before, "override edit")
}

async function deleteBecomesHide({ page, url }: E2EContext) {
  await openEditor(page, url)
  await fixture(page)
  const before = await docJson(page)
  await page.evaluate(() =>
    (window as unknown as W).__kimo.session.apply(
      [{ op: "delete", id: "inst000001/title00001" }],
      "Delete",
    ),
  )
  const inst = await getNode(page, "inst000001")
  const ov = (inst?.overrides as Rec | undefined)?.title00001 as Rec | undefined
  expect((ov?.set as Rec | undefined)?.visible === false, "delete inside an instance hides")
  await page.locator('.m3-toast[data-tone="danger"]', { hasText: "hidden instead" }).waitFor()
  expect(
    (await toasts(page)).some(
      (t) => t === "Can't delete Title inside an instance — hidden instead",
    ),
    "board 15 toast copy",
  )
  await oneStep(page, before, "hide instead of delete")
}

async function instanceSection({ page, url }: E2EContext) {
  await openEditor(page, url)
  await fixture(page)
  await page.evaluate(() =>
    (window as unknown as W).__kimo.session.apply(
      [
        {
          op: "update",
          id: "inst000001",
          set: {
            props: { fill: "#2A1E14" },
            overrides: { title00001: { set: { content: "Pro" } } },
          },
        },
      ],
      "seed overrides",
    ),
  )
  await select(page, ["inst000001"])
  const sec = page.locator('[data-testid="instance-section"]')
  await sec.waitFor()
  expect((await page.locator(".m3-kind-pill__label").textContent()) === "Instance", "Kind pill")
  const summary = page.locator('[data-testid="overrides-summary"]')
  expect(
    (await summary.locator(".m3-overrides-summary__breakdown").textContent()) ===
      "props 1 · args 0 · overrides 1",
    "summary counts each store",
  )
  await summary.click()
  const pop = page.locator('[data-testid="overrides-popover"]')
  await pop.waitFor()
  expect((await pop.locator(".m3-override-entry").count()) === 2, "one row per entry")
  // Per-row reset (the props fill).
  const before = await docJson(page)
  await pop.locator('.m3-override-entry[data-entry="fill"] button').click()
  await settle(page)
  expect(!(await getNode(page, "inst000001"))?.props, "row reset removed props.fill")
  await oneStep(page, before, "row reset")
  // Detach with the board 15 confirm.
  await page.keyboard.press("Escape")
  await select(page, ["inst000001"])
  await settle(page)
  const beforeDetach = await docJson(page)
  await page.locator(".m3-action-pill", { hasText: "Detach" }).click()
  const confirm = page.locator(".m3-confirm")
  await confirm.waitFor()
  expect(
    (await confirm.locator(".kimo-confirm-dialog__title").textContent()) === "Detach Card · Pro?",
    "confirm title",
  )
  await confirm.locator(".kimo-confirm-dialog__confirm").click()
  await settle(page)
  const sel = await w(page)
  const detached = await getNode(page, sel[0] as string)
  expect(detached?.type === "frame" && !detached.component, "detached root is a plain frame")
  await oneStep(page, beforeDetach, "detach")
}

async function createComponentShortcut({ page, url }: E2EContext) {
  await openEditor(page, url)
  await page.evaluate(() =>
    (window as unknown as W).__kimo.session.apply(
      [
        {
          op: "insert",
          id: "plain00001",
          parent: null,
          node: { type: "frame", name: "Hero", x: 0, y: 0, w: 100, h: 80 },
        },
      ],
      "fixture",
    ),
  )
  await select(page, ["plain00001"])
  const before = await docJson(page)
  await page
    .locator(".editor__canvas")
    .click({ position: { x: 600, y: 600 } })
    .catch(() => undefined)
  await select(page, ["plain00001"])
  await page.keyboard.press("Alt+Meta+KeyK")
  await settle(page)
  expect((await getNode(page, "plain00001"))?.component === true, "⌥⌘K marks the main")
  await page.locator(".m3-toast", { hasText: "Created component Hero" }).waitFor()
  await oneStep(page, before, "create component")
  // Toolbar Component button (enabled one-shot action).
  await select(page, ["plain00001"])
  await page.locator('[data-tool="component"]').click()
  await settle(page)
  expect((await getNode(page, "plain00001"))?.component === true, "toolbar ◇ creates a component")
}

async function assetsTab({ page, url }: E2EContext) {
  await openEditor(page, url)
  await page.locator(".left-panel .kimo-tab", { hasText: "Assets" }).click()
  await page.locator('[data-testid="assets-tab"]').waitFor()
  await page.locator(".m3-assets .kimo-empty-state", { hasText: "No components yet" }).waitFor()
  await fixture(page)
  await page.locator(".m3-asset-group__path", { hasText: "Card" }).waitFor()
  const tile = page.locator('.kimo-asset-tile[data-asset="Card/Pricing"]')
  await tile.waitFor()
  const before = await page.evaluate(
    () => (window as unknown as W).__kimo.session.store.nodeIds().length,
  )
  await tile.dblclick()
  await settle(page)
  const after = await page.evaluate(
    () => (window as unknown as W).__kimo.session.store.nodeIds().length,
  )
  expect(after === before + 1, "double-click inserts one instance")
  const sel = await w(page)
  expect(
    (await getNode(page, sel[0] as string))?.of === "main000001",
    "the new node instantiates the main",
  )
}

async function componentSection({ page, url }: E2EContext) {
  await openEditor(page, url)
  await fixture(page)
  await select(page, ["main000001"])
  const sec = page.locator('[data-testid="component-section"]')
  await sec.waitFor()
  // Description → meta key kimo.component.description.
  const box = sec.locator(".m3-description__box")
  await box.fill("Pricing tier card")
  await box.blur()
  await settle(page)
  const meta = (await getNode(page, "main000001"))?.meta as Rec | undefined
  expect(meta?.["kimo.component.description"] === "Pricing tier card", "description meta key")
  // Add a text prop.
  const before = await docJson(page)
  await sec.locator(".m3-add-prop").click()
  await page.locator('[data-testid="add-prop-menu"] .m3-menu-item', { hasText: "Text" }).click()
  await settle(page)
  const comp = (await getNode(page, "main000001"))?.component as Rec
  const label = (comp?.props as Rec | undefined)?.label as Rec | undefined
  expect(
    label?.type === "text" && label.target === "title00001",
    "text prop targets the text layer",
  )
  await sec.locator('[data-prop="label"]').waitFor()
  await oneStep(page, before, "declare prop")
  // Instance Properties shows the declared prop; setting it writes args.
  await page.evaluate(() =>
    (window as unknown as W).__kimo.m3.run(
      {
        cmd: "declareProp",
        component: "main000001",
        name: "label",
        def: { type: "text", target: "title00001", field: "content" },
      },
      "declare",
    ),
  )
  await select(page, ["inst000001"])
  const row = page.locator('[data-testid="properties-section"] [data-prop="label"]')
  await row.waitFor()
  const input = row.locator(".kimo-instance-prop-row__value")
  await input.fill("Start free trial")
  await input.press("Enter")
  await settle(page)
  const args = (await getNode(page, "inst000001"))?.args as Rec | undefined
  expect(args?.label === "Start free trial", "prop row writes args")
}

async function slotSection({ page, url }: E2EContext) {
  await openEditor(page, url)
  await fixture(page)
  await select(page, ["actions001"])
  const sec = page.locator('[data-testid="slot-section"]')
  await sec.waitFor()
  // Fill the instance slot, then try to turn the slot off → board 15 confirm.
  await page.evaluate(() =>
    (window as unknown as W).__kimo.m3.run(
      {
        cmd: "setOverride",
        instance: "inst000001",
        path: "actions001",
        change: {
          kind: "slot",
          content: [{ node: { type: "rect", name: "Button", w: 80, h: 28 } }],
        },
      },
      "fill slot",
    ),
  )
  await select(page, ["actions001"])
  await sec.locator(".kimo-toggle").first().click()
  const confirm = page.locator(".m3-confirm")
  await confirm.waitFor()
  expect(
    (await confirm.locator(".kimo-confirm-dialog__title").textContent())?.startsWith(
      "Turn off slot",
    ),
    "slot-off confirm",
  )
  await confirm.locator("button", { hasText: "Cancel" }).click()
  expect(!!(await getNode(page, "actions001"))?.slot, "cancel keeps the slot")
}

async function variables({ page, url }: E2EContext) {
  await openEditor(page, url)
  await page.locator(".left-panel .kimo-tab", { hasText: "Variables" }).click()
  await page
    .locator('[data-testid="variables-tab"] .kimo-empty-state', { hasText: "No variables yet" })
    .waitFor()
  await page.evaluate(() =>
    (window as unknown as W).__kimo.session.apply(
      [
        { op: "setThemes", set: { mode: ["light", "dark"] } },
        {
          op: "setVariables",
          set: {
            "surface/page": {
              type: "color",
              group: "color",
              value: [
                { value: "#FFF7EE", when: { mode: "light" } },
                { value: "#1A120C", when: { mode: "dark" } },
              ],
            },
            "space/gap": { type: "number", group: "space", value: 12 },
          },
        },
      ],
      "seed variables",
    ),
  )
  await page.locator('[data-variable="surface/page"]').waitFor()
  await page.keyboard.press("Meta+Alt+Shift+KeyV")
  const dialog = page.locator('[data-testid="variables-dialog"]')
  await dialog.waitFor()
  expect(
    (await dialog.locator(".kimo-mode-column-header").count()) === 2,
    "one column per axis value",
  )
  expect(
    (await dialog.locator(".kimo-mode-column-header__default").count()) === 1,
    "default tag on the first value",
  )
  // New variable → Number.
  const before = await docJson(page)
  await dialog.locator(".m3-vd__new").click()
  await page
    .locator('[data-testid="new-variable-menu"] .m3-menu-item', { hasText: "Number" })
    .click()
  await settle(page)
  const vars = (await page.evaluate(
    () => (window as unknown as W).__kimo.session.store.toDocument().variables,
  )) as Rec
  expect(Object.keys(vars).length === 3, "one variable created")
  await page.keyboard.press("Escape")
  await oneStep(page, before, "new variable")
  // Alias cycle refused with the board 15 copy.
  await page.evaluate(() =>
    (window as unknown as W).__kimo.m3.run(
      { cmd: "updateVariable", name: "space/gap", patch: { value: { $ref: "space/gap" } } },
      "alias",
    ),
  )
  expect(
    (await toasts(page)).some((t) => t.startsWith("Can't alias space/gap to itself")),
    "alias cycle toast",
  )
}

async function libraries({ page, url }: E2EContext) {
  await openEditor(page, url)
  const lib = {
    format: "1.0.0",
    meta: { name: "Kimo UI" },
    nodes: {
      button01: {
        type: "frame",
        name: "Button",
        parent: null,
        order: "a0",
        w: 80,
        h: 28,
        component: true,
      },
    },
  }
  await page.evaluate((doc) => {
    const k = (window as unknown as W).__kimo
    k.m3.libs.inject("ui", "./ui.kimo", doc)
    k.m3.run({ cmd: "linkLibrary", alias: "ui", path: "./ui.kimo" }, "Link library")
    k.m3.run(
      {
        cmd: "createInstance",
        of: "ui:button01",
        placement: { parent: null, x: 0, y: 0, id: "libinst001" },
      },
      "insert",
    )
  }, lib)
  await page.locator(".left-panel .kimo-tab", { hasText: "Assets" }).click()
  const libRow = page.locator('.m3-library-item[data-library="ui"]')
  await libRow.waitFor()
  await libRow.click()
  await page.locator('.kimo-asset-row[data-asset="Button"]').waitFor()
  // Missing state: banner + unlink confirm (detach all with the cached copy).
  await page.evaluate(
    (doc) => (window as unknown as W).__kimo.m3.libs.inject("ui", "./ui.kimo", doc, "missing"),
    lib,
  )
  await page.locator('[data-testid="missing-banner"]').waitFor()
  const before = await docJson(page)
  await page.locator(".m3-missing-banner__unlink").click()
  const confirm = page.locator(".m3-confirm")
  await confirm.waitFor()
  expect(
    (await confirm.locator(".kimo-confirm-dialog__title").textContent()) ===
      "Unlink the Kimo UI library?",
    "unlink confirm",
  )
  await confirm.locator(".kimo-confirm-dialog__confirm").click()
  await settle(page)
  const doc = (await page.evaluate(() =>
    (window as unknown as W).__kimo.session.store.toDocument(),
  )) as Rec
  expect(!(doc.imports as Rec | undefined)?.ui, "import removed")
  const nodes = Object.values(doc.nodes as Record<string, Rec>)
  expect(!nodes.some((n) => n.type === "instance"), "no instance left")
  expect(
    nodes.some((n) => n.type === "frame" && n.w === 80 && n.h === 28),
    `instance detached from the cache: ${JSON.stringify(nodes)}`,
  )
  await oneStep(page, before, "unlink")
}

/** One measured pass against the design node values (board 02c / 11). */
async function measured({ page, url }: E2EContext) {
  await openEditor(page, url)
  await fixture(page)
  await select(page, ["inst000001"])
  await page.locator('[data-testid="instance-section"]').waitFor()
  const m = await page.evaluate(() => {
    const px = (v: string) => Number.parseFloat(v)
    const read = (sel: string) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return {
        w: r.width,
        h: r.height,
        pad: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(px),
        gap: px(cs.columnGap) || 0,
        bg: cs.backgroundColor,
        color: cs.color,
        font: `${cs.fontSize} ${cs.fontWeight}`,
        display: cs.display,
      }
    }
    return {
      instRow: read('.layer-tree [data-node-id="inst000001"]'),
      instIcon: read('.layer-tree [data-node-id="inst000001"] .kimo-layer-row-m3__icon'),
      chip: read(".m3-component-chip"),
      goMain: read(".m3-go-main"),
      pill: read(".m3-action-pill"),
      summary: read(".m3-overrides-summary"),
      kind: read(".m3-kind-pill"),
      token: getComputedStyle(document.documentElement).getPropertyValue("--kimo-component").trim(),
    }
  })
  const near = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) < 0.6
  expect(
    m.instRow && near(m.instRow.h, 28) && m.instRow.gap === 6,
    `LayerRow/Instance 28, gap 6: ${JSON.stringify(m.instRow)}`,
  )
  expect(
    m.instRow && m.instRow.bg !== "rgba(0, 0, 0, 0)",
    "selected instance row has component-soft fill",
  )
  expect(m.instIcon && near(m.instIcon.w, 14), "type icon 14")
  expect(m.token.toUpperCase() === "#7C3AED", `component token violet: ${m.token}`)
  expect(m.instIcon?.color === "rgb(124, 58, 237)", `type icon in component: ${m.instIcon?.color}`)
  expect(
    m.chip && near(m.chip.h, 28) && m.chip.gap === 6 && m.chip.pad[1] === 8,
    `Component Chip: ${JSON.stringify(m.chip)}`,
  )
  expect(m.goMain && near(m.goMain.w, 28) && near(m.goMain.h, 28), "Go to main 28 × 28")
  expect(
    m.pill && near(m.pill.h, 28) && m.pill.gap === 5 && m.pill.pad[1] === 8,
    `action pill: ${JSON.stringify(m.pill)}`,
  )
  expect(
    m.summary && near(m.summary.h, 28) && m.summary.gap === 6,
    `Overrides Summary: ${JSON.stringify(m.summary)}`,
  )
  expect(
    m.kind && m.kind.pad[0] === 2 && m.kind.pad[1] === 8,
    `Kind pill padding [2, 8]: ${JSON.stringify(m.kind)}`,
  )
}

export const scenarios: Scenario[] = [
  { name: "m3: layers mirror instances (composite ids, slot row)", run: layersMirrorInstance },
  {
    name: "m3: panel edit on an instance child → override (one undo) + dot reset",
    run: childEditBecomesOverride,
  },
  { name: "m3: delete inside an instance → hide + board 15 toast", run: deleteBecomesHide },
  { name: "m3: Instance section summary, popover reset, detach confirm", run: instanceSection },
  { name: "m3: ⌥⌘K / toolbar create component + toast", run: createComponentShortcut },
  { name: "m3: Assets tab groups + insert instance", run: assetsTab },
  { name: "m3: Component section description + props + instance args", run: componentSection },
  { name: "m3: slot section off → confirm", run: slotSection },
  { name: "m3: variables tab + dialog + alias cycle toast", run: variables },
  { name: "m3: libraries link / missing banner / unlink confirm", run: libraries },
  { name: "m3: measured pass (LayerRow/Instance, Instance section)", run: measured },
]
