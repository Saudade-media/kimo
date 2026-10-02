/**
 * Regression scenarios for the M2 review findings: move badge + handles (board 10 #1), pixel
 * readout (#4), pen drawing overlay (#5), Escape mid-drag in a popover, and a plain `.kimo`
 * reopened in the same browser finding its images.
 */
import type { Page } from "playwright"
import { node, openEditor, settle, toPage } from "./qa-helpers"
import {
  board,
  type M2Hook,
  overlay,
  PNG_2x2,
  section,
  spyOverlay,
  typeField,
} from "./qa-m2-helpers"
import { expect, type Scenario } from "./run"

type Ov = Awaited<ReturnType<typeof overlay>> & {
  sizeLabel?: string | null
  handles?: boolean
  pen?: {
    stroke?: { color: string; width: number } | null
    handlesFor: number[]
    preview: { c1?: unknown } | null
    contour: { anchors: { x: number; y: number }[] }
  } | null
}
const ov = async (page: Page) => (await overlay(page)) as Ov | null

const sel = async (page: Page, s: string[]) => {
  await page.evaluate(
    (x) => (window as unknown as { __kimo: M2Hook }).__kimo.session.ui.getState().select(x),
    s,
  )
  await settle(page)
}

const MODULES = { files: "/src/lib/files.ts", assets: "/src/lib/assets.ts" }

export const scenarios: Scenario[] = [
  {
    name: "qa-m2 fix: moving shows `X … Y …` in the badge and keeps the corner handles (O68JG1)",
    async run({ page, url, log }) {
      await openEditor(page, url)
      await board(page, [
        {
          id: "moveRect0001",
          node: { type: "rect", name: "M", x: 40, y: 40, w: 100, h: 80, fill: "#F4A261" },
        },
      ])
      await sel(page, ["moveRect0001"])
      await spyOverlay(page)
      const a = await toPage(page, { x: 90, y: 80 })
      await page.mouse.move(a.x, a.y)
      await page.mouse.down()
      for (let i = 1; i <= 6; i++) await page.mouse.move(a.x + i * 5, a.y + i * 3)
      await settle(page)
      const o = await ov(page)
      log("badge", o?.sizeLabel, "handles", o?.handles)
      expect(o?.sizeLabel === "X 70  Y 58", `position badge (${o?.sizeLabel})`)
      expect(o?.handles !== false, "corner handles stay while moving")
      await page.mouse.up()
      await settle(page)
      const after = await ov(page)
      expect(after?.sizeLabel === "100 × 80", `size badge after the move (${after?.sizeLabel})`)
    },
  },
  {
    name: "qa-m2 fix: pixel readout above 400% (P36BbY lxk8M)",
    async run({ page, url, log }) {
      await openEditor(page, url)
      await board(page, [
        {
          id: "pxRect000001",
          node: { type: "rect", name: "P", x: 20, y: 10, w: 10, h: 10, fill: "#E76F51A8" },
        },
      ])
      await sel(page, [])
      await page.evaluate(() =>
        (window as unknown as { __kimo: M2Hook }).__kimo.session.ui
          .getState()
          .setViewport({ x: 0, y: 0, zoom: 8 }),
      )
      await settle(page)
      await spyOverlay(page)
      const p = await toPage(page, { x: 22.5, y: 14.5 })
      await page.mouse.move(p.x - 3, p.y)
      await page.mouse.move(p.x, p.y)
      await settle(page)
      const o = await ov(page)
      log("readout", o?.cursorBadge?.text)
      // #E76F51 at 0xA8 over the white board: composited in the document, 100% opaque.
      expect(
        /^x 22 · y 14 · [0-9A-F]{6} 100%$/.test(o?.cursorBadge?.text ?? ""),
        `readout text (${o?.cursorBadge?.text})`,
      )
      // Outside the board: the document pixel is transparent.
      const q = await toPage(page, { x: 30.5, y: 60.5 })
      await page.evaluate(() =>
        (window as unknown as { __kimo: M2Hook }).__kimo.session.ui
          .getState()
          .setViewport({ x: 0, y: 40, zoom: 8 }),
      )
      await page.mouse.move(q.x, q.y + 1)
      await settle(page)
      log("readout 2", (await ov(page))?.cursorBadge?.text)
      // Below the grid zoom: no readout.
      await page.evaluate(() =>
        (window as unknown as { __kimo: M2Hook }).__kimo.session.ui
          .getState()
          .setViewport({ x: 0, y: 0, zoom: 2 }),
      )
      await page.mouse.move(p.x + 2, p.y + 2)
      await settle(page)
      expect(!(await ov(page))?.cursorBadge, "no readout at 200%")
    },
  },
  {
    name: "qa-m2 fix: pen draws the path with its stroke, handles on every curve anchor, curved rubber band (cXWyk)",
    async run({ page, url, log }) {
      await openEditor(page, url)
      await board(page, [])
      await spyOverlay(page)
      await page.keyboard.press("p")
      const at = (x: number, y: number) => toPage(page, { x, y })
      const click = async (x: number, y: number) => {
        const q = await at(x, y)
        await page.mouse.click(q.x, q.y)
        await page.waitForTimeout(350)
      }
      const dragFrom = async (x: number, y: number, x2: number, y2: number) => {
        const a = await at(x, y)
        const b = await at(x2, y2)
        await page.mouse.move(a.x, a.y)
        await page.mouse.down()
        for (let i = 1; i <= 6; i++)
          await page.mouse.move(a.x + ((b.x - a.x) * i) / 6, a.y + ((b.y - a.y) * i) / 6)
        await page.mouse.up()
        await page.waitForTimeout(350)
      }
      await click(80, 250)
      await dragFrom(200, 100, 260, 100)
      await dragFrom(340, 210, 390, 210)
      const h = await at(300, 300)
      await page.mouse.move(h.x, h.y)
      await settle(page)
      const pen = (await ov(page))?.pen
      log("pen", JSON.stringify({ stroke: pen?.stroke, handlesFor: pen?.handlesFor }))
      expect(pen?.stroke?.width === 1, "in-progress path drawn with its 1px stroke")
      expect(
        JSON.stringify(pen?.handlesFor) === "[1,2]",
        `handles on both curve anchors (${JSON.stringify(pen?.handlesFor)})`,
      )
      expect(!!pen?.preview?.c1, "rubber band is a cubic from the last out handle")
      await page.keyboard.press("Escape")
      await settle(page)
    },
  },
  {
    name: "qa-m2 fix: Escape mid color drag ends the gesture; the next edit is its own step",
    async run({ page, url, log }) {
      await openEditor(page, url)
      await board(page, [
        {
          id: "escDrag00001",
          node: { type: "rect", name: "E", x: 40, y: 40, w: 100, h: 100, fill: "#F4A261" },
        },
      ])
      await sel(page, ["escDrag00001"])
      await section(page, "Fill")
        .locator(".kimo-fill-row")
        .first()
        .locator(".kimo-color-field")
        .first()
        .click()
      const area = page.locator(".kimo-color-picker .kimo-color-area").first()
      await area.waitFor()
      const b = await area.boundingBox()
      if (!b) throw new Error("no color area")
      await page.mouse.move(b.x + b.width * 0.2, b.y + b.height * 0.2)
      await page.mouse.down()
      for (let i = 1; i <= 5; i++)
        await page.mouse.move(b.x + b.width * (0.2 + i * 0.1), b.y + b.height * 0.3)
      await settle(page)
      const dragged = (await node(page, "escDrag00001"))?.fill
      await page.keyboard.press("Escape")
      await page.mouse.up()
      await settle(page)
      expect((await page.locator(".kimo-color-picker").count()) === 0, "picker closed")
      await typeField(page, section(page, "Layer"), "Opacity", "50")
      const n = await node(page, "escDrag00001")
      log("fill", dragged, "→", n?.fill, "opacity", n?.opacity)
      expect(n?.fill === dragged && n?.fill !== "#F4A261", `drag result kept (${n?.fill})`)
      expect(n?.opacity === 0.5, `opacity applied (${n?.opacity})`)
      // One undo reverts only the opacity edit.
      await page.evaluate(() =>
        (window as unknown as { __kimo: M2Hook }).__kimo.session.store.undo("user"),
      )
      await settle(page)
      const u = await node(page, "escDrag00001")
      expect(u?.opacity === undefined && u?.fill === dragged, `undo reverts opacity only`)
    },
  },
  {
    name: "qa-m2 fix: a plain .kimo reopened in the same browser finds its images",
    async run({ page, url, log }) {
      await openEditor(page, url)
      await board(page, [
        { id: "plainImg0001", node: { type: "rect", name: "I", x: 40, y: 40, w: 100, h: 100 } },
      ])
      await sel(page, ["plainImg0001"])
      const chooser = page.waitForEvent("filechooser")
      await section(page, "Fill").getByRole("button", { name: "Add fill" }).click()
      await page.getByRole("menuitem", { name: "Image…" }).click()
      await (await chooser).setFiles({ name: "dot.png", mimeType: "image/png", buffer: PNG_2x2 })
      await page.waitForFunction(() =>
        JSON.stringify(
          (window as unknown as { __kimo: M2Hook }).__kimo.session.store.getNode("plainImg0001"),
        ).includes("./assets/"),
      )
      const r = await page.evaluate(async (m) => {
        const files = (await import(/* @vite-ignore */ m.files)) as {
          exportKimo(s: unknown, n: string): string
          importKimoFile(t: string, n: string): Promise<{ id: string; missingAssets: string[] }>
        }
        const assets = (await import(/* @vite-ignore */ m.assets)) as {
          createAssetStore(id: string): { keys(): Promise<string[]>; dispose(): void }
        }
        const k = (window as unknown as { __kimo: M2Hook }).__kimo
        const text = files.exportKimo(k.session.store, "Plain")
        const res = await files.importKimoFile(text, "Plain.kimo")
        const s = assets.createAssetStore(res.id)
        const keys = await s.keys()
        s.dispose()
        return { ...res, keys }
      }, MODULES)
      log(JSON.stringify(r))
      expect(r.missingAssets.length === 0, `no missing images (${r.missingAssets})`)
      expect(r.keys.length === 1, "the image was copied into the new file's asset store")
    },
  },
]
