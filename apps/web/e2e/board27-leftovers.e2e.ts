/**
 * Board 27 §8 Components (desing.pen d7gkR) / §2 Clipboard (AJmT8) leftovers in the real editor:
 * - rule WYOjQ "Duplicate a main": ⌥-drag of a main asks like ⌘D (dialog on release; the answer
 *   lands where the drag dropped, one undo step; cancel changes nothing);
 * - BX6C3 "copy/paste of a main always pastes an instance in the same file";
 * - rule Kpf1o "layer rows get the warning dot": LayerRow/Instance's Override slot (OverrideDot
 *   rqoRv 12 × 12, Dot 6 × 6) with the Broken strip's `warning` fill — measured pass.
 */
import type { Page } from "playwright"
import { checker, measure, tokens } from "./board25-helpers"
import { openEditor, settle } from "./qa-helpers"
import { applyOps, type M2Hook } from "./qa-m2-helpers"
import { type E2EContext, expect, type Scenario } from "./run"

type W = { __kimo: M2Hook }
type N = Record<string, unknown>

const sel = (page: Page, ids: string[]) =>
  page.evaluate((x) => (window as unknown as W).__kimo.session.ui.getState().select(x), ids)
const nodes = (page: Page) =>
  page.evaluate(
    () =>
      (
        (window as unknown as W).__kimo.session.store as unknown as {
          toDocument(): { nodes: unknown }
        }
      ).toDocument().nodes as Record<string, N>,
  )
const undo = (page: Page) =>
  page.evaluate(() =>
    ((window as unknown as W).__kimo.session.store as unknown as { undo(o: string): void }).undo(
      "user",
    ),
  )

const MAIN = [
  {
    op: "insert",
    id: "Button0001",
    parent: null,
    node: {
      type: "frame",
      name: "Button",
      x: 40,
      y: 40,
      w: 80,
      h: 32,
      fill: "#111111",
      component: { props: { label: { type: "text", target: "BtnLabel01", field: "content" } } },
    },
  },
  {
    op: "insert",
    id: "BtnLabel01",
    parent: "Button0001",
    node: { type: "text", name: "Label", content: "Go", fill: "#FFFFFF", x: 8, y: 8 },
  },
]

/** World → page point (viewport pinned at -100/-100, zoom 1). */
async function toPage(page: Page, p: { x: number; y: number }) {
  const r = await page.locator(".canvas-host").boundingBox()
  if (!r) throw new Error("no canvas")
  return { x: r.x + p.x + 100, y: r.y + p.y + 100 }
}

/** Opens a new file with only `ops` in it (the starter content removed). */
async function freshFile(ctx: E2EContext, ops: unknown[]) {
  const { page } = ctx
  await page.setViewportSize({ width: 1440, height: 900 })
  await openEditor(page, ctx.url)
  await page.evaluate(() => {
    const s = (window as unknown as W).__kimo.session.store as unknown as {
      children(p: null): string[]
      apply(ops: unknown[], o: { origin: string }): unknown
    }
    s.apply(
      s.children(null).map((id) => ({ op: "delete", id })),
      { origin: "user" },
    )
  })
  await applyOps(page, ops as never)
  await settle(page)
}

async function pinViewport(page: Page) {
  await page.evaluate(() => {
    const ui = (window as unknown as W).__kimo.session.ui.getState() as unknown as {
      setViewport(v: { x: number; y: number; zoom: number }): void
    }
    ui.setViewport({ x: -100, y: -100, zoom: 1 })
  })
  await settle(page)
}

async function altDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const a = await toPage(page, from)
  const b = await toPage(page, to)
  await page.mouse.move(a.x, a.y)
  await page.keyboard.down("Alt")
  await page.mouse.down()
  for (let i = 1; i <= 10; i++)
    await page.mouse.move(a.x + ((b.x - a.x) * i) / 10, a.y + ((b.y - a.y) * i) / 10)
  await settle(page)
  await page.mouse.up()
  await page.keyboard.up("Alt")
  await settle(page)
}

export const scenarios: Scenario[] = [
  {
    name: "board27 leftovers: ⌥-drag of a main asks like ⌘D (WYOjQ)",
    async run(ctx: E2EContext) {
      const { page } = ctx
      await freshFile(ctx, MAIN)
      await pinViewport(page)
      const before = Object.keys(await nodes(page)).length
      const dlg = page.locator("[data-testid=duplicate-main-dialog] .kimo-dialog")

      // 1. Release → the dialog; the previewed copy is gone until the answer.
      await sel(page, ["Button0001"])
      await altDrag(page, { x: 104, y: 64 }, { x: 104, y: 164 })
      await dlg.waitFor({ timeout: 5000 })
      expect(
        Object.keys(await nodes(page)).length === before,
        "the preview is reverted while the dialog asks",
      )
      // Cancel → nothing changes.
      await dlg.getByRole("button", { name: "Cancel" }).click()
      await settle(page)
      expect(Object.keys(await nodes(page)).length === before, "cancel: no copy")
      const main = (await nodes(page)).Button0001
      expect(main?.x === 40 && main?.y === 40, "the main never moved")

      // 2. "As a new component" → "Button 2" where the drag dropped, one undo step.
      await sel(page, ["Button0001"])
      await altDrag(page, { x: 104, y: 64 }, { x: 104, y: 164 })
      await dlg.waitFor()
      await dlg.getByRole("radio", { name: /As a new component/ }).click()
      await dlg.getByRole("button", { name: "Duplicate" }).click()
      await settle(page)
      const all = await nodes(page)
      const comp = Object.entries(all).find(([, n]) => n.name === "Button 2")
      ctx.log("component copy", JSON.stringify(comp))
      expect(comp?.[1].component, "a new main “Button 2”")
      expect(comp?.[1].x === 40 && comp?.[1].y === 140, "dropped at the drag's place (+100 y)")
      const def = comp?.[1].component as { props?: { label?: { target?: string } } } | undefined
      const target = def?.props?.label?.target ?? ""
      expect(all[target]?.parent === comp?.[0], "its prop targets its own label")
      const selection = await page.evaluate(
        () => (window as unknown as W).__kimo.session.ui.getState().selection,
      )
      expect(selection.join() === comp?.[0], "the copy is selected")
      await undo(page)
      await settle(page)
      expect(Object.keys(await nodes(page)).length === before, "one undo step removes it")

      // 3. Default (↵ "As an instance") → an instance of the main at the drop.
      await sel(page, ["Button0001"])
      await altDrag(page, { x: 104, y: 64 }, { x: 304, y: 64 })
      await dlg.waitFor()
      await page.keyboard.press("Enter")
      await settle(page)
      const inst = Object.values(await nodes(page)).find(
        (n) => n.type === "instance" && n.of === "Button0001",
      )
      ctx.log("instance copy", JSON.stringify(inst))
      expect(inst?.x === 240 && inst?.y === 40, "instance at the drop (+200 x)")

      // 4. Settings "instance" → no dialog, the instance follows the pointer.
      await page.evaluate(() => {
        const k = (window as unknown as W).__kimo as unknown as {
          m3: { prefs: { duplicateMain(): string } | null }
        }
        if (k.m3.prefs) k.m3.prefs.duplicateMain = () => "instance"
      })
      await sel(page, ["Button0001"])
      await altDrag(page, { x: 104, y: 64 }, { x: 104, y: 264 })
      expect((await dlg.count()) === 0, "remembered choice: no dialog")
      const twice = Object.values(await nodes(page)).filter(
        (n) => n.type === "instance" && n.of === "Button0001",
      )
      expect(
        twice.length === 2 && twice.some((n) => n.x === 40 && n.y === 240),
        `second instance dropped live (${JSON.stringify(twice)})`,
      )
    },
  },
  {
    name: "board27 leftovers: copy/paste of a main pastes an instance (BX6C3)",
    async run(ctx: E2EContext) {
      const { page } = ctx
      await page.setViewportSize({ width: 1440, height: 900 })
      await page
        .context()
        .grantPermissions(["clipboard-read", "clipboard-write"])
        .catch(() => {})
      await openEditor(page, ctx.url)
      await applyOps(page, MAIN)
      await sel(page, ["Button0001"])
      await page.locator(".canvas-host").focus()
      await page.keyboard.press("ControlOrMeta+c")
      await settle(page)
      await sel(page, [])
      await page.keyboard.press("ControlOrMeta+v")
      await settle(page)
      await page.waitForTimeout(200)
      const selection = await page.evaluate(
        () => (window as unknown as W).__kimo.session.ui.getState().selection,
      )
      const all = await nodes(page)
      const pasted = all[selection[0] as string]
      ctx.log("pasted", JSON.stringify(pasted))
      expect(pasted?.type === "instance" && pasted.of === "Button0001", "an instance of the main")
      const mains = Object.values(all).filter((n) => n.component !== undefined)
      expect(mains.length === 1, "no second main")
    },
  },
  {
    name: "board27 leftovers: broken-override warning dot on layer rows (Kpf1o) + measured",
    async run(ctx: E2EContext) {
      const { page } = ctx
      await page.setViewportSize({ width: 1440, height: 900 })
      await openEditor(page, ctx.url)
      await applyOps(page, [
        ...MAIN,
        {
          op: "insert",
          id: "InstBroke1",
          parent: null,
          node: {
            type: "instance",
            name: "Pricing Card",
            of: "Button0001",
            x: 40,
            y: 140,
            meta: {
              "kimo.overrides.broken": [
                { key: "GoneBadge1", override: { set: { content: "New" } }, path: "Badge/Label" },
              ],
            },
          },
        },
        {
          op: "insert",
          id: "InstFine01",
          parent: null,
          node: { type: "instance", name: "Fine", of: "Button0001", x: 40, y: 240 },
        },
      ])
      await settle(page)
      const row = '.kimo-layer-row-m3[data-node-id="InstBroke1"]'
      await page.locator(row).waitFor()
      expect(
        (await page.locator(`${row} .kimo-layer-row-m3__broken`).count()) === 1,
        "the broken instance's row has the warning dot",
      )
      expect(
        (await page
          .locator('.kimo-layer-row-m3[data-node-id="InstFine01"] .kimo-layer-row-m3__broken')
          .count()) === 0,
        "a clean instance has none",
      )
      // The dot sits in the Override slot: after the Spacer, before Visibility.
      const order = await page.evaluate((r) => {
        const d = document.querySelector(`${r} .kimo-layer-row-m3__broken`)
        return [d?.previousElementSibling?.className ?? "", d?.nextElementSibling?.className ?? ""]
      }, row)
      expect(order[0]?.includes("kimo-layer-row-m3__spacer"), `after the Spacer (${order[0]})`)
      expect(order[1]?.includes("kimo-layer-row-m3__visibility"), `before Visibility (${order[1]})`)
      const T = await tokens(page, ["--kimo-warning"])
      const m = await measure(page, {
        row,
        dot: `${row} .kimo-layer-row-m3__broken`,
        fill: `${row} .kimo-layer-row-m3__broken .kimo-override-dot__dot`,
      })
      const c = checker(ctx, "LayerRow/Instance · broken (oHsXi + OverrideDot rqoRv)")
      c.box("Row oHsXi", m.row, { h: 28, gap: 6, align: "center" })
      c.box("Override V8mIg (rqoRv)", m.dot, { w: 12, h: 12, align: "center", justify: "center" })
      c.box("Dot T0yxdd", m.fill, { w: 6, h: 6, bg: T["--kimo-warning"] })
      c.flush()
      // Centred in its slot.
      const dx = (m.fill?.x ?? 0) - (m.dot?.x ?? 0)
      const dy = (m.fill?.y ?? 0) - (m.dot?.y ?? 0)
      expect(Math.abs(dx - 3) < 0.6 && Math.abs(dy - 3) < 0.6, `dot centred (${dx}, ${dy})`)
      // Fixing the overrides (stash cleared) removes the dot.
      await applyOps(page, [{ op: "update", id: "InstBroke1", unset: ["meta"] }])
      await settle(page)
      expect(
        (await page.locator(`${row} .kimo-layer-row-m3__broken`).count()) === 0,
        "the dot goes once nothing is broken",
      )
    },
  },
]
