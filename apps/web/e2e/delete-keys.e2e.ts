/**
 * Delete / Backspace delete the selection from every focus state the editor can leave behind
 * (canvas, text edit, ctrl-click context menu, layer row, inputs), and never inside text fields.
 */
import { centerOf, idOf, node, nodeCount, openEditor, select, settle, world } from "./qa-helpers"
import { expect, type Scenario } from "./run"

type W = { __kimo: { session: { apply(ops: unknown[], label?: string): boolean } } }

async function fixture(page: import("playwright").Page) {
  await page.evaluate(() => {
    ;(window as unknown as W).__kimo.session.apply(
      [
        {
          op: "insert",
          id: "delA0001",
          parent: null,
          node: { type: "rect", name: "DelA", x: 0, y: 0, w: 120, h: 80 },
        },
        {
          op: "insert",
          id: "delB0001",
          parent: null,
          node: { type: "rect", name: "DelB", x: 200, y: 0, w: 120, h: 80 },
        },
        {
          op: "insert",
          id: "delT0001",
          parent: null,
          node: { type: "text", name: "DelT", x: 0, y: 200, content: "hello" },
        },
      ],
      "Fixture",
    )
  })
  await page.evaluate(() => {
    const k = (
      window as unknown as { __kimo: { canvas(): { zoomToFit(ids?: string[]): void } | null } }
    ).__kimo
    k.canvas()?.zoomToFit(["delA0001", "delB0001", "delT0001"])
  })
  await settle(page)
}

const KEYS = ["Delete", "Backspace"] as const

export const scenarios: Scenario[] = [
  {
    name: "delete keys: delete the selection after a ctrl-click context menu with no pointerup",
    async run({ page, url }) {
      await page.setViewportSize({ width: 1280, height: 800 })
      await openEditor(page, url)
      await fixture(page)
      for (const key of KEYS) {
        const id = key === "Delete" ? "delA0001" : "delB0001"
        const n0 = await nodeCount(page)
        await select(page, [id])
        const c = await centerOf(page, id)
        // macOS ctrl-click: pointerdown (button 0, ctrl) then contextmenu; the release never
        // reaches the canvas, so the press must not leave a gesture running.
        await page.mouse.move(c.x, c.y)
        await page.keyboard.down("Control")
        await page.mouse.down()
        await page.evaluate(
          ([x, y]) =>
            document.querySelector(".canvas-host")?.dispatchEvent(
              new MouseEvent("contextmenu", {
                bubbles: true,
                cancelable: true,
                clientX: x,
                clientY: y,
                button: 0,
                ctrlKey: true,
              }),
            ),
          [c.x, c.y],
        )
        await page.keyboard.up("Control")
        await page.keyboard.press("Escape")
        await settle(page)
        await select(page, [id])
        await page.locator(".canvas-host").focus()
        await page.keyboard.press(key)
        await settle(page)
        expect((await nodeCount(page)) === n0 - 1, `${key} deletes after ctrl-click menu`)
      }
    },
  },
  {
    name: "delete keys: delete the selection after text editing and from a layer row",
    async run({ page, url }) {
      await page.setViewportSize({ width: 1280, height: 800 })
      await openEditor(page, url)
      await fixture(page)
      // Text edit then Escape.
      await select(page, ["delT0001"])
      const b = await world(page, "delT0001")
      if (!b) throw new Error("no layout")
      const c = await centerOf(page, "delT0001")
      await page.mouse.dblclick(c.x, c.y)
      await page.locator(".canvas-host__text-editor").waitFor()
      await page.keyboard.press("Escape")
      await settle(page)
      let n = await nodeCount(page)
      await select(page, ["delA0001"])
      await page.keyboard.press("Delete")
      await settle(page)
      expect((await nodeCount(page)) === n - 1, "Delete after text edit + Esc")
      // Layer row focus.
      n = await nodeCount(page)
      await page.locator('[role="treeitem"]', { hasText: "DelB" }).first().click()
      await page.keyboard.press("Backspace")
      await settle(page)
      expect((await nodeCount(page)) === n - 1, "Backspace from a focused layer row")
      expect((await idOf(page, "DelB")) === null, "DelB gone")
    },
  },
  {
    name: "delete keys: multi-selection (shift-click, select all, marquee) is deleted",
    async run({ page, url }) {
      await page.setViewportSize({ width: 1280, height: 800 })
      await openEditor(page, url)
      await fixture(page)
      const a = await centerOf(page, "delA0001")
      const b = await centerOf(page, "delB0001")
      await page.mouse.click(a.x, a.y)
      await page.keyboard.down("Shift")
      await page.mouse.click(b.x, b.y)
      await page.keyboard.up("Shift")
      await settle(page)
      let n = await nodeCount(page)
      await page.keyboard.press("Backspace")
      await settle(page)
      expect((await nodeCount(page)) === n - 2, "Backspace deletes shift-click multi-selection")
      await page.locator(".canvas-host").click({ position: { x: 5, y: 5 } })
      await page.keyboard.press("ControlOrMeta+a")
      await settle(page)
      n = await nodeCount(page)
      await page.keyboard.press("Delete")
      await settle(page)
      expect((await nodeCount(page)) < n, "Delete removes the select-all selection")
    },
  },
  {
    name: "delete keys: deleting a frame that holds a component used elsewhere detaches those instances",
    async run({ page, url }) {
      await page.setViewportSize({ width: 1280, height: 800 })
      await openEditor(page, url)
      await page.evaluate(() => {
        ;(window as unknown as W).__kimo.session.apply(
          [
            {
              op: "insert",
              id: "pgA00001",
              parent: null,
              node: { type: "frame", name: "PageA", x: 0, y: 0, w: 400, h: 300 },
            },
            {
              op: "insert",
              id: "cmpNav01",
              parent: "pgA00001",
              node: { type: "frame", name: "Nav", component: true, x: 0, y: 0, w: 100, h: 40 },
            },
            {
              op: "insert",
              id: "pgB00001",
              parent: null,
              node: { type: "frame", name: "PageB", x: 500, y: 0, w: 400, h: 300 },
            },
            {
              op: "insert",
              id: "insNav01",
              parent: "pgB00001",
              node: { type: "instance", name: "NavInst", of: "cmpNav01", x: 0, y: 0 },
            },
          ],
          "Fixture",
        )
      })
      await settle(page)
      await select(page, ["pgA00001"])
      await page.locator(".canvas-host").focus()
      await page.keyboard.press("Delete")
      await settle(page)
      expect((await idOf(page, "PageA")) === null, "PageA is deleted (the delete is not refused)")
      const detached = await page.evaluate(() => {
        const st = (
          window as unknown as {
            __kimo: {
              session: {
                store: {
                  nodeIds(): string[]
                  getNode(i: string): { type?: string; of?: string } | undefined
                }
              }
            }
          }
        ).__kimo.session.store
        return st.nodeIds().filter((i) => st.getNode(i)?.of === "cmpNav01").length
      })
      expect(detached === 0, `no instance points at the deleted component (${detached})`)
      expect((await idOf(page, "NavInst")) !== null, "the detached copy keeps its layer")
      await page.keyboard.press("ControlOrMeta+z")
      await settle(page)
      expect((await idOf(page, "PageA")) !== null, "one undo restores PageA")
      expect(
        (await node(page, "insNav01"))?.of === "cmpNav01",
        "the instance points at its component again",
      )
    },
  },
  {
    name: "delete keys: Backspace and Delete in text inputs edit the text and never delete layers",
    async run({ page, url }) {
      await page.setViewportSize({ width: 1280, height: 800 })
      await openEditor(page, url)
      await fixture(page)
      await select(page, ["delA0001"])
      await settle(page)
      const n = await nodeCount(page)
      const input = page.getByRole("textbox").first()
      await input.waitFor()
      await input.focus()
      await input.fill("abc")
      await page.keyboard.press("Backspace")
      expect((await input.inputValue()) === "ab", `input edited (${await input.inputValue()})`)
      expect((await nodeCount(page)) === n, "no layer deleted from inside the input")
    },
  },
]
