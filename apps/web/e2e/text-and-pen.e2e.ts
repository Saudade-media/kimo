/**
 * Text and pen smoke: style a range of text while editing it in place, draw open and closed
 * paths with the pen, and edit a path's anchors. Assertions are on the document (content runs,
 * path data, bounds, undo steps), never on pixels or text metrics.
 */
import type { Page } from "playwright"
import {
  type Box,
  clearStage,
  drag,
  editingPath,
  expect,
  focusCanvas,
  insert,
  newIds,
  node,
  nodeIds,
  openEditor,
  type Pt,
  type Scenario,
  select,
  settle,
  stage,
  toPage,
  ui,
  undo,
  world,
} from "./helpers"

const TEXT = "smokeText001"

/** Selects characters [a, b) of the text editor by offsets (through the DOM selection). */
async function selectRange(page: Page, a: number, b: number) {
  await page.evaluate(
    ([from, to]) => {
      const ed = document.querySelector(".canvas-host__text-editor") as HTMLElement
      const texts: Text[] = []
      const walk = (n: Node) => {
        if (n instanceof Text) texts.push(n)
        else for (const c of n.childNodes) walk(c)
      }
      walk(ed)
      const at = (o: number): [Node, number] => {
        let pos = 0
        for (const t of texts) {
          if (o <= pos + t.data.length) return [t, o - pos]
          pos += t.data.length
        }
        const last = texts[texts.length - 1] as Text
        return [last, last.data.length]
      }
      const [an, ao] = at(from as number)
      const [fn, fo] = at(to as number)
      document.getSelection()?.setBaseAndExtent(an, ao, fn, fo)
    },
    [a, b],
  )
  await settle(page)
}

/** Pen: click each point (stage pixels) with the pen tool armed; leaves the path uncommitted. */
async function penClicks(page: Page, pts: Pt[]) {
  await focusCanvas(page)
  await page.keyboard.press("p")
  for (const p of pts) {
    const at = await toPage(page, stage(p.x, p.y))
    await page.mouse.click(at.x, at.y)
    await settle(page)
  }
}

const TRIANGLE: Pt[] = [
  { x: 300, y: 600 },
  { x: 380, y: 450 },
  { x: 460, y: 600 },
]

type PathNode = { type: string; d: string; x: number; y: number; w: number; h: number }

export const scenarios: Scenario[] = [
  {
    name: "text: style a range while editing in place, one undo step",
    async run({ page, url }) {
      await openEditor(page, url)
      await clearStage(page)
      const at = stage(300, 200)
      const plain = "Hello brave new world"
      await insert(page, [
        [
          TEXT,
          null,
          {
            type: "text",
            name: "Rich",
            x: at.x,
            y: at.y,
            w: 360,
            grow: "fixed-width",
            content: plain,
            style: { font: "Inter", size: 18 },
            fill: "#111111",
          },
        ],
      ])
      await select(page, [TEXT])
      await settle(page)

      // Double-click edits in place.
      const b = (await world(page, TEXT)) as Box
      const into = await toPage(page, { x: b.x + 8, y: b.y + b.h / 2 })
      await page.mouse.dblclick(into.x, into.y)
      await page.locator(".canvas-host__text-editor").waitFor()
      await settle(page)

      // Bold the word "brave" ([6, 11)), then type at the end.
      await selectRange(page, 6, 11)
      await page.keyboard.press("ControlOrMeta+b")
      await settle(page)
      await selectRange(page, plain.length, plain.length)
      await page.keyboard.type("!")
      await page.keyboard.press("Escape")
      await settle(page)
      await page.locator(".canvas-host__text-editor").waitFor({ state: "detached" })

      const content = (await node(page, TEXT))?.content as {
        text: string
        style?: { weight?: number }
      }[]
      expect(Array.isArray(content), "styled text is stored as runs")
      expect(content.map((s) => s.text).join("") === `${plain}!`, "typed text kept")
      expect(content.find((s) => s.text === "brave")?.style?.weight === 700, "brave is bold")
      expect(
        content.filter((s) => s.style?.weight === 700).length === 1,
        "only the selected range is bold",
      )
      const features = await page.evaluate(
        () =>
          (
            (
              window as unknown as { __kimo: { session: { store: { toDocument(): unknown } } } }
            ).__kimo.session.store.toDocument() as { features?: string[] }
          ).features,
      )
      expect(features?.includes("text/runs") === true, "the document declares text/runs")

      // The whole edit is one undo step.
      await undo(page)
      expect((await node(page, TEXT))?.content === plain, "one undo restores the plain text")
    },
  },
  {
    name: "pen: draw an open path with a curve and a closed path",
    async run({ page, url }) {
      await openEditor(page, url)
      await clearStage(page)
      const before = await nodeIds(page)

      // Open path: click, click-drag (a curve), click, Enter commits.
      await focusCanvas(page)
      await page.keyboard.press("p")
      const a = await toPage(page, stage(300, 300))
      const b = await toPage(page, stage(420, 260))
      const c = await toPage(page, stage(540, 360))
      await page.mouse.click(a.x, a.y)
      await drag(page, b, { x: b.x + 40, y: b.y })
      await page.mouse.click(c.x, c.y)
      await settle(page)
      expect((await newIds(page, before)).length === 0, "nothing is written while drawing")
      await page.keyboard.press("Enter")
      await settle(page)
      const added = await newIds(page, before)
      expect(added.length === 1, `one path written (${added.length})`)
      const open = (await node(page, added[0] as string)) as PathNode
      expect(open.type === "path", "a path node")
      expect(/C/.test(open.d), "the dragged anchor made a curve")
      expect(!/Z/.test(open.d), "the path is open")
      const s = await ui(page)
      expect(s.tool === "select" && s.selection[0] === added[0], "back on Move, path selected")
      await undo(page)
      expect((await newIds(page, before)).length === 0, "one undo removes the path")

      // Closed path: clicking the first anchor again closes it.
      await penClicks(page, [...TRIANGLE, TRIANGLE[0] as Pt])
      const closed = await newIds(page, before)
      expect(closed.length === 1, `one closed path written (${closed.length})`)
      const tri = (await node(page, closed[0] as string)) as PathNode
      expect(/Z$/.test(tri.d), "the path is closed")
    },
  },
  {
    name: "pen: edit a path, dragging an anchor is one undo step",
    async run({ page, url }) {
      await openEditor(page, url)
      await clearStage(page)
      const before = await nodeIds(page)
      await penClicks(page, [...TRIANGLE, TRIANGLE[0] as Pt])
      const id = (await newIds(page, before))[0] as string
      expect(id, "the pen drew a path")
      const drawn = (await node(page, id)) as PathNode

      // Enter edits the selected path.
      await focusCanvas(page)
      await page.keyboard.press("Enter")
      await settle(page)
      expect((await editingPath(page)) === id, "Enter starts editing the path")

      // Drag the apex anchor up by 40.
      const apex = await toPage(page, stage((TRIANGLE[1] as Pt).x, (TRIANGLE[1] as Pt).y))
      await drag(page, apex, { x: apex.x, y: apex.y - 40 })
      const edited = (await node(page, id)) as PathNode
      expect(
        edited.y === drawn.y - 40 && edited.h === drawn.h + 40,
        `the apex moved up 40 (y ${edited.y}, h ${edited.h})`,
      )
      expect(edited.d !== drawn.d, "the path data changed")
      await undo(page)
      const restored = (await node(page, id)) as PathNode
      expect(restored.y === drawn.y && restored.d === drawn.d, "one undo restores the path")

      // Escape leaves path editing and keeps the path.
      await page.keyboard.press("Escape")
      await settle(page)
      expect((await editingPath(page)) === null, "Escape exits path editing")
      expect((await nodeIds(page)).includes(id), "the path stays")
    },
  },
]
