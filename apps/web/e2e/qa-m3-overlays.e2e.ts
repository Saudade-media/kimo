/**
 * M3 canvas DOM overlays (boards 11, 12, 14): CanvasLabel above a selected nested instance
 * (`B70Th`, 18 above), SlotBadge under a slot outline (`LQoWJ`), SlotQuickInsert chips under a
 * selected main (`g9pFd`: 12 from its left, 13 below) that insert into the slot, and the theme
 * pin chip after a pinned frame's label (`EnjCg`). Positions are measured against the layout.
 */
import { openEditor, settle } from "./qa-helpers"
import { apply, Checks, componentsFixture, type QW, select } from "./qa-m3-helpers"
import type { E2EContext, Scenario } from "./run"

const near = (a: number, b: number) => Math.abs(a - b) <= 0.5

async function overlays({ page, url, log }: E2EContext) {
  const c = new Checks(log)
  await openEditor(page, url)
  await componentsFixture(page)
  await apply(page, [
    {
      op: "insert",
      id: "linkmain01",
      parent: null,
      node: { type: "frame", name: "Link", x: 700, y: 40, w: 30, h: 10, component: true },
    },
    {
      op: "update",
      id: "actions001",
      set: { slot: { suggested: ["starmain01", "heartmain1", "linkmain01"] } },
    },
    {
      op: "insert",
      id: "cards00001",
      parent: null,
      node: { type: "frame", name: "Cards", x: 40, y: 400, w: 600, h: 300 },
    },
    {
      op: "insert",
      id: "inst000009",
      parent: "cards00001",
      node: { type: "instance", name: "Card · Pro", of: "main000001", x: 172, y: 0 },
    },
  ])
  await page.evaluate(() =>
    (window as unknown as QW).__kimo.session.ui.getState().setViewport({ x: 0, y: 0, zoom: 1 }),
  )
  const host = await page.locator(".canvas-host").boundingBox()
  const world = (id: string) =>
    page.evaluate(
      (i) => (window as unknown as QW).__kimo.canvas()?.layout()?.nodes.get(i)?.world,
      id,
    )
  const box = (sel: string) => page.locator(sel).first().boundingBox()
  if (!host) throw new Error("no canvas host")

  await select(page, ["main000001"])
  await settle(page)
  const main = await world("main000001")
  const slot = await world("actions001")
  const badge = await box(".canvas-host__slot-badge")
  c.ok(
    !!badge &&
      !!slot &&
      near(badge.x, host.x + slot.x - 4) &&
      near(badge.y, host.y + slot.y + 2 + slot.h + 4),
    `SlotBadge under the slot outline: ${JSON.stringify(badge)} slot ${JSON.stringify(slot)}`,
  )
  c.ok(
    (await page.locator(".canvas-host__slot-badge").first().innerText()) === "Slot · Actions",
    "SlotBadge text",
  )
  const row = await box('[data-testid="slot-quick-insert"]')
  c.ok(
    !!row &&
      !!main &&
      near(row.x, host.x + main.x + 12) &&
      near(row.y, host.y + main.y + main.h + 13),
    `quick insert row 12 / 13 from the main: ${JSON.stringify(row)}`,
  )
  const chips = await page
    .locator('[data-testid="slot-quick-insert"] .kimo-slot-quick-insert')
    .allInnerTexts()
  c.ok(
    JSON.stringify(chips) === JSON.stringify(["Icon/Star", "Icon/Heart", "+1"]),
    `chips: ${chips}`,
  )
  await page.locator('[data-testid="slot-quick-insert"] .kimo-slot-quick-insert').first().click()
  await settle(page)
  const kids = await page.evaluate(() => {
    const s = (window as unknown as QW).__kimo.session.store
    return s.children("actions001").map((id: string) => s.getNode(id)?.of)
  })
  c.ok(JSON.stringify(kids) === '["starmain01"]', `chip inserts into the slot: ${kids}`)

  await select(page, ["inst000009"])
  await settle(page)
  const inst = await world("inst000009")
  const label = await box(".canvas-host__label--nested")
  c.ok(
    !!label && !!inst && near(label.x, host.x + inst.x) && near(label.y, host.y + inst.y - 18),
    `nested instance label 18 above: ${JSON.stringify(label)} ${JSON.stringify(inst)}`,
  )
  c.ok(
    (await page.locator(".canvas-host__label--nested").innerText()) === "Card/Pricing",
    "nested label names the component",
  )

  await apply(page, [
    { op: "setThemes", set: { mode: ["light", "dark"] } },
    {
      op: "insert",
      id: "pricdark01",
      parent: null,
      node: {
        type: "frame",
        name: "Pricing — Dark",
        x: 900,
        y: 400,
        w: 400,
        h: 300,
        theme: { mode: "dark" },
      },
    },
  ])
  await settle(page)
  const chip = await box(".canvas-host__theme-chip")
  c.ok(
    (await page.locator(".canvas-host__theme-chip").innerText()) === "mode: dark" &&
      chip?.height === 15,
    `theme pin chip: ${JSON.stringify(chip)}`,
  )
  await select(page, ["pricdark01"])
  await settle(page)
  const order = await page.$$eval(".design-tab > *", (els) =>
    els.slice(0, 2).map((e) => e.getAttribute("data-testid")),
  )
  c.ok(order[1] === "theme-section", `Theme section right under the header: ${order}`)
  c.done()
}

export const scenarios: Scenario[] = [
  { name: "qa-m3: canvas overlays (labels, slot, pins)", run: overlays },
]
