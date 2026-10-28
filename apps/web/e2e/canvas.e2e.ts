/**
 * Canvas smoke: open a file, select, move and resize, draw a frame, rectangle and text, undo and
 * redo, save the file and open it again. Assertions are on the document (position, size, type,
 * undo steps), never on pixels.
 */
import {
  centerOf,
  clearStage,
  docJson,
  drag,
  draw,
  expect,
  focusCanvas,
  insert,
  newIds,
  nextFileChooser,
  node,
  nodeIds,
  noPickers,
  openEditor,
  type Pt,
  redo,
  type Scenario,
  select,
  settle,
  stage,
  toPage,
  ui,
  undo,
  waitCanvas,
  waitFor,
  world,
} from "./helpers"

type Geometry = { x: number; y: number; w: number; h: number }
const geometry = async (page: Parameters<typeof node>[0], id: string) => {
  const n = (await node(page, id)) as Geometry | null
  expect(n, `node ${id} exists`)
  return { x: n.x, y: n.y, w: n.w, h: n.h }
}

const RECT_A = "smokeRectA01"
const RECT_B = "smokeRectB01"

async function twoRects(page: Parameters<typeof node>[0]) {
  await clearStage(page)
  const a = stage(300, 150)
  const b = stage(700, 400)
  await insert(page, [
    [RECT_A, null, { type: "rect", name: "A", x: a.x, y: a.y, w: 200, h: 120, fill: "#F4A261" }],
    [RECT_B, null, { type: "rect", name: "B", x: b.x, y: b.y, w: 160, h: 100, fill: "#2A9D8F" }],
  ])
}

export const scenarios: Scenario[] = [
  {
    name: "canvas: open a file, select with click, shift-click, empty click",
    async run({ page, url }) {
      await openEditor(page, url)
      expect((await nodeIds(page)).length > 0, "the new file has content")
      await twoRects(page)
      await page.mouse.click(...xy(await centerOf(page, RECT_A)))
      await settle(page)
      expect((await ui(page)).selection.join() === RECT_A, "click selects A")
      await page.keyboard.down("Shift")
      await page.mouse.click(...xy(await centerOf(page, RECT_B)))
      await page.keyboard.up("Shift")
      await settle(page)
      const both = (await ui(page)).selection
      expect(both.length === 2 && both.includes(RECT_A) && both.includes(RECT_B), "shift adds B")
      const empty = await toPage(page, stage(900, 150))
      await page.mouse.click(empty.x, empty.y)
      await settle(page)
      expect((await ui(page)).selection.length === 0, "empty click clears")
    },
  },
  {
    name: "canvas: move and resize, one undo step each, redo",
    async run({ page, url }) {
      await openEditor(page, url)
      await twoRects(page)
      await select(page, [RECT_A])
      await settle(page)
      const start = await geometry(page, RECT_A)

      // Move: press on the body, drag by (+60, +40).
      const c = await centerOf(page, RECT_A)
      await drag(page, c, { x: c.x + 60, y: c.y + 40 })
      const moved = await geometry(page, RECT_A)
      expect(moved.x === start.x + 60 && moved.y === start.y + 40, "moved by the drag")
      expect(moved.w === start.w && moved.h === start.h, "move keeps the size")
      await undo(page)
      expect(JSON.stringify(await geometry(page, RECT_A)) === JSON.stringify(start), "one undo")
      await redo(page)
      expect(JSON.stringify(await geometry(page, RECT_A)) === JSON.stringify(moved), "redo")
      await undo(page)

      // Resize: the bottom-right corner handle, by (+40, +30).
      const b = await world(page, RECT_A)
      expect(b, "layout")
      const corner = await toPage(page, { x: b.x + b.w, y: b.y + b.h })
      await drag(page, corner, { x: corner.x + 40, y: corner.y + 30 })
      const resized = await geometry(page, RECT_A)
      expect(
        resized.w === start.w + 40 && resized.h === start.h + 30,
        `resized by the handle (${resized.w}x${resized.h})`,
      )
      expect(resized.x === start.x && resized.y === start.y, "resize keeps the top-left")
      await undo(page)
      expect(JSON.stringify(await geometry(page, RECT_A)) === JSON.stringify(start), "one undo")
    },
  },
  {
    name: "canvas: draw a frame, a rectangle and text; undo and redo",
    async run({ page, url }) {
      await openEditor(page, url)
      await clearStage(page)
      const before = await nodeIds(page)
      const beforeDoc = await docJson(page)

      const frame = await draw(page, "f", { x: 300, y: 150 }, { x: 500, y: 300 })
      const f = (await node(page, frame)) as Geometry & { type: string }
      expect(f.type === "frame" && f.w === 200 && f.h === 150, "frame drawn by drag")

      const rect = await draw(page, "r", { x: 600, y: 150 }, { x: 760, y: 250 })
      const r = (await node(page, rect)) as Geometry & { type: string }
      expect(r.type === "rect" && r.w === 160 && r.h === 100, "rectangle drawn by drag")
      expect((await ui(page)).tool === "select", "tool returns to select")

      // Text: click, type, Escape commits.
      await focusCanvas(page)
      await page.keyboard.press("t")
      const at = await toPage(page, stage(850, 200))
      await page.mouse.click(at.x, at.y)
      await page.getByRole("textbox", { name: "Edit text" }).waitFor()
      await page.keyboard.type("Hello Kimo")
      await page.keyboard.press("Escape")
      await settle(page)
      const text = (await ui(page)).selection[0] as string
      const t = await node(page, text)
      expect(t?.type === "text" && t.content === "Hello Kimo", "text typed in place")
      expect((await newIds(page, before)).length === 3, "three new nodes")
      const afterDoc = await docJson(page)

      // Each draw is one undo step; undoing all three restores the document, redo brings it back.
      await undo(page)
      expect(!(await nodeIds(page)).includes(text), "undo removes the text")
      await undo(page)
      expect(!(await nodeIds(page)).includes(rect), "undo removes the rectangle")
      await undo(page)
      expect(!(await nodeIds(page)).includes(frame), "undo removes the frame")
      expect((await docJson(page)) === beforeDoc, "back to the document before drawing")
      await redo(page)
      await redo(page)
      await redo(page)
      expect((await docJson(page)) === afterDoc, "redo restores all three")
    },
  },
  {
    name: "canvas: save to a .kimo file and open it again",
    async run({ page, url }) {
      await noPickers(page)
      await openEditor(page, url)
      await clearStage(page)
      const rect = await draw(page, "r", { x: 400, y: 200 }, { x: 560, y: 300 })
      const drawn = await geometry(page, rect)

      // Save: the browser downloads Untitled.kimo.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 10_000 }),
        page.keyboard.press("ControlOrMeta+s"),
      ])
      const stream = await download.createReadStream()
      const chunks: Buffer[] = []
      for await (const chunk of stream) chunks.push(chunk as Buffer)
      const file = Buffer.concat(chunks)
      const saved = JSON.parse(file.toString("utf8")) as {
        nodes: Record<string, Geometry & { type: string }>
      }
      const savedRect = saved.nodes[rect]
      expect(savedRect?.type === "rect", "the saved file holds the rectangle")
      expect(
        savedRect.x === drawn.x && savedRect.w === drawn.w && savedRect.h === drawn.h,
        "with its geometry",
      )

      // Open the saved file again (a new file opens from it).
      const from = page.url()
      const chooser = nextFileChooser(page)
      await page.keyboard.press("ControlOrMeta+o")
      await (await chooser).setFiles({
        name: download.suggestedFilename(),
        mimeType: "application/json",
        buffer: file,
      })
      await page.waitForURL((u) => u.toString() !== from && /#\/file\//.test(u.toString()))
      await waitCanvas(page)
      expect((await nodeIds(page)).length === Object.keys(saved.nodes).length, "same node count")
      expect(
        JSON.stringify(await geometry(page, rect)) === JSON.stringify(drawn),
        "the rectangle comes back as drawn",
      )
    },
  },
  {
    name: "canvas: edits autosave and survive a reload",
    async run({ page, url }) {
      await openEditor(page, url)
      await clearStage(page)
      const rect = await draw(page, "r", { x: 400, y: 200 }, { x: 560, y: 300 })
      const drawn = await geometry(page, rect)
      const count = (await nodeIds(page)).length
      const fileId = /#\/file\/([A-Za-z0-9]+)$/.exec(page.url())?.[1] as string

      // Wait until the document in IndexedDB has the edit, then reload.
      await waitFor(
        page,
        "the edit in IndexedDB",
        async ([id, n]) => {
          const files = (window as unknown as { __kimoModules: Record<string, unknown> })
            .__kimoModules["/src/lib/files.ts"] as {
            loadFileStore(id: string): Promise<{ nodeIds(): string[]; destroy(): void }>
          }
          const store = await files.loadFileStore(id as string)
          const have = store.nodeIds().length
          store.destroy()
          return have === n
        },
        [fileId, count] as const,
      )
      await page.reload()
      await waitCanvas(page)
      expect((await nodeIds(page)).length === count, "same node count after reload")
      expect(
        JSON.stringify(await geometry(page, rect)) === JSON.stringify(drawn),
        "the rectangle is where it was",
      )
    },
  },
]

const xy = (p: Pt): [number, number] => [p.x, p.y]
