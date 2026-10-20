/**
 * Dragging whole sections on the canvas (board 27 §2 Y4vVe): between siblings by default, into a
 * container only when clearly intended (it fits, pointer well inside, or a hover dwell).
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { Page } from "playwright"
import { settle } from "./qa-helpers"
import { type E2EContext, expect, type Scenario } from "./run"

type Box = { x: number; y: number; w: number; h: number }
interface Hook {
  session: {
    store: {
      loadDocument(d: unknown): void
      getNode(id: string): Record<string, unknown> | undefined
      children(p: string | null): string[]
    }
    ui: {
      getState(): {
        selection: string[]
        setViewport(v: object): void
        select(ids: string[]): void
      }
    }
  }
  canvas(): { layout(): { nodes: Map<string, { world: Box }> } | null } | null
}
declare const window: Window & { __kimo: Hook }

const EXAMPLES = join(import.meta.dirname, "..", "..", "..", "examples")
const PAGE = "lpPageDesk"
const [NAV, HERO, FEATURES, FOOTER] = ["lp0001", "lp0012", "lp0049", "lp0067"]

async function open(page: Page, url: string, doc: unknown, root: string, zoomMax = 1) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(url)
  await page.getByRole("button", { name: "New file" }).first().click()
  await page.waitForURL(/#\/file\/[A-Za-z0-9]+$/)
  await page.locator('.canvas-host[data-ready="true"]').waitFor({ timeout: 30_000 })
  await settle(page)
  await page.evaluate(
    (d) => window.__kimo.session.store.loadDocument(JSON.parse(d)),
    JSON.stringify(doc),
  )
  await settle(page)
  await page.evaluate(
    ({ id, zoomMax }) => {
      const b = window.__kimo.canvas()?.layout()?.nodes.get(id)?.world as Box
      const z = Math.min(zoomMax, 800 / b.w, 700 / b.h)
      window.__kimo.session.ui.getState().setViewport({ x: b.x - 20 / z, y: b.y - 20 / z, zoom: z })
    },
    { id: root, zoomMax },
  )
  await settle(page)
}

const world = (page: Page, id: string) =>
  page.evaluate((i) => window.__kimo.canvas()?.layout()?.nodes.get(i)?.world as Box, id)

/** Page point of a world point. */
async function pt(page: Page, x: number, y: number) {
  const r = await page.locator(".canvas-host").boundingBox()
  const v = await page.evaluate(() => {
    const s = window.__kimo.session.ui.getState() as unknown as {
      viewport: { x: number; y: number; zoom: number }
    }
    return s.viewport
  })
  if (!r) throw new Error("no canvas")
  return { x: r.x + (x - v.x) * v.zoom, y: r.y + (y - v.y) * v.zoom }
}

const kids = (page: Page, id: string) =>
  page.evaluate((i) => window.__kimo.session.store.children(i), id)
const parentOf = (page: Page, id: string) =>
  page.evaluate((i) => window.__kimo.session.store.getNode(i)?.parent ?? null, id)

/** Press on `from` (world), drag to `to` (world), optionally rest, then release (or Esc). */
async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  o: { rest?: number; cancel?: boolean; mods?: string[] } = {},
) {
  const a = await pt(page, from.x, from.y)
  const b = await pt(page, to.x, to.y)
  await page.mouse.move(a.x, a.y)
  for (const m of o.mods ?? []) await page.keyboard.down(m)
  await page.mouse.down()
  for (let i = 1; i <= 12; i++)
    await page.mouse.move(a.x + ((b.x - a.x) * i) / 12, a.y + ((b.y - a.y) * i) / 12)
  await settle(page)
  if (o.rest) await page.waitForTimeout(o.rest)
  if (o.cancel) await page.keyboard.press("Escape")
  await page.mouse.up()
  for (const m of o.mods ?? []) await page.keyboard.up(m)
  await settle(page)
}

const center = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })
const landing = () => JSON.parse(readFileSync(join(EXAMPLES, "landing-page/landing.kimo"), "utf8"))

/** Row of three equal cards, each an auto-layout column holding a chip; inside a column wrapper. */
function cardsDoc() {
  const nodes: Record<string, unknown> = {
    wrapRoot1: {
      type: "frame",
      parent: null,
      order: "a0",
      name: "Wrap",
      x: 0,
      y: 0,
      w: 760,
      h: 520,
      fill: "#F4F4F4",
      layout: { dir: "column", gap: 20, pad: 20 },
    },
    rowFrame1: {
      type: "frame",
      parent: "wrapRoot1",
      order: "a0",
      name: "Row",
      w: { mode: "fill" },
      layout: { dir: "row", gap: 16, pad: 16 },
      fill: "#FFFFFF",
    },
    footFrame: {
      type: "frame",
      parent: "wrapRoot1",
      order: "a1",
      name: "Foot",
      w: { mode: "fill" },
      h: 120,
      fill: "#DDDDDD",
    },
  }
  for (let i = 1; i <= 3; i++) {
    nodes[`cardNode${i}`] = {
      type: "frame",
      parent: "rowFrame1",
      order: `a${i}`,
      name: `Card ${i}`,
      w: 220,
      h: 260,
      fill: "#E8F0FF",
      layout: { dir: "column", gap: 8, pad: 16 },
    }
    nodes[`chipNode${i}`] = {
      type: "rect",
      parent: `cardNode${i}`,
      order: "a0",
      name: `Chip ${i}`,
      w: 60,
      h: 28,
      fill: "#E4572E",
    }
    nodes[`bodyNode${i}`] = {
      type: "rect",
      parent: `cardNode${i}`,
      order: "a1",
      name: `Body ${i}`,
      w: 150,
      h: 140,
      fill: "#FFFFFF",
    }
  }
  return {
    $schema: "https://getkimo.design/schema/kimo-1.0.json",
    format: "1.0.0",
    meta: { name: "cards" },
    nodes,
  }
}

export const scenarios: Scenario[] = [
  {
    name: "section drag: a section dropped over another section reorders, never nests",
    async run(ctx: E2EContext) {
      const { page, url } = ctx
      await open(page, url, landing(), PAGE, 0.5)
      const hero = await world(page, HERO)
      const foot = await world(page, FOOTER)
      // Footer dragged onto the upper part of Hero's interior (pointer over its inner frames).
      await drag(page, center(foot), { x: hero.x + hero.w / 2, y: hero.y + hero.h * 0.4 })
      expect((await parentOf(page, FOOTER)) === PAGE, "Footer stays a page child")
      expect(
        (await kids(page, PAGE)).join() === [NAV, FOOTER, HERO, FEATURES].join(),
        `order ${(await kids(page, PAGE)).join()}`,
      )
      // Then over the lower half of Features: lands after it.
      const f2 = await world(page, FEATURES)
      const foot2 = await world(page, FOOTER)
      await drag(page, center(foot2), { x: f2.x + f2.w / 2, y: f2.y + f2.h * 0.75 })
      expect((await parentOf(page, FOOTER)) === PAGE, "still a page child")
      expect(
        (await kids(page, PAGE)).join() === [NAV, HERO, FEATURES, FOOTER].join(),
        `order ${(await kids(page, PAGE)).join()}`,
      )
    },
  },
  {
    name: "section drag: resting over a section enters it; Esc cancels",
    async run(ctx: E2EContext) {
      const { page, url } = ctx
      await open(page, url, landing(), PAGE, 0.5)
      const feat = await world(page, FEATURES)
      const foot = await world(page, FOOTER)
      const before = (await kids(page, PAGE)).join()
      await drag(page, center(foot), center(feat), { cancel: true })
      expect((await kids(page, PAGE)).join() === before, "Esc cancels")
      await drag(page, center(foot), center(feat), { rest: 800 })
      expect(
        (await parentOf(page, FOOTER)) !== PAGE,
        `dwell enters, parent ${await parentOf(page, FOOTER)}`,
      )
    },
  },
  {
    name: "section drag: row of equal cards reorders; a small chip enters a card; ⌘ stays absolute",
    async run(ctx: E2EContext) {
      const { page, url } = ctx
      await open(page, url, cardsDoc(), "wrapRoot1")
      const c1 = await world(page, "cardNode1")
      const c3 = await world(page, "cardNode3")
      await page.evaluate(() => window.__kimo.session.ui.getState().select(["cardNode3"]))
      // Card 3 over the middle of card 1: equal size, so it goes before card 1, not into it.
      await drag(page, { x: c3.x + c3.w / 2, y: c3.y + 10 }, { x: c1.x + 20, y: c1.y + c1.h / 2 })
      expect((await parentOf(page, "cardNode3")) === "rowFrame1", "card stays in the row")
      expect(
        (await kids(page, "rowFrame1"))[0] === "cardNode3",
        `order ${(await kids(page, "rowFrame1")).join()}`,
      )
      // The chip of card 2 into the body area of card 1 (small, well inside): enters card 1.
      const chip = await world(page, "chipNode2")
      const c1b = await world(page, "cardNode1")
      await page.evaluate(() => window.__kimo.session.ui.getState().select(["chipNode2"]))
      await drag(page, center(chip), { x: c1b.x + c1b.w / 2, y: c1b.y + c1b.h * 0.7 })
      expect(
        (await parentOf(page, "chipNode2")) === "cardNode1",
        `chip parent ${await parentOf(page, "chipNode2")}`,
      )
      // ⌘ keeps a flow child absolute in its own parent, even over a sibling container.
      await page.evaluate(() => window.__kimo.session.ui.getState().select(["bodyNode3"]))
      const body = await world(page, "bodyNode3")
      await drag(
        page,
        center(body),
        { x: body.x + body.w / 2 + 30, y: body.y + body.h / 2 + 12 },
        { mods: ["ControlOrMeta"] },
      )
      const b3 = await page.evaluate(() => window.__kimo.session.store.getNode("bodyNode3"))
      expect(
        b3?.position === "absolute" && b3?.parent === "cardNode3",
        `⌘ absolute ${JSON.stringify(b3)}`,
      )
      // The whole row (as wide as its container) dropped over the Foot frame's middle stays a Wrap child.
      await page.evaluate(() => window.__kimo.session.ui.getState().select(["rowFrame1"]))
      const row = await world(page, "rowFrame1")
      const foot = await world(page, "footFrame")
      await drag(page, center(row), { x: foot.x + foot.w / 2, y: foot.y + foot.h * 0.8 })
      expect((await parentOf(page, "rowFrame1")) === "wrapRoot1", "row stays in Wrap")
      expect(
        (await kids(page, "wrapRoot1"))[1] === "rowFrame1",
        `wrap order ${(await kids(page, "wrapRoot1")).join()}`,
      )
    },
  },
]
