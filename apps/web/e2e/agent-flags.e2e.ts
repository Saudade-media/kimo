/**
 * An agent flag never outlives its agent (ADR 0014 §9). A turn that was running when the window
 * reloaded (or the app quit) leaves `placeholder` flags in the saved file; on the next open
 * nothing owns them, so they are released: no lock row, no tag, no shimmer, and the frame is
 * editable. A bare `placeholder: true` (what models and CLIs write) is covered too.
 */
import type { Page } from "playwright"
import { openEditor, settle } from "./qa-helpers"
import { expect, type Scenario } from "./run"

type Rec = Record<string, unknown>
type W = {
  __kimo: {
    session: {
      store: {
        getNode(id: string): Rec | undefined
        nodeIds(): string[]
        canUndo(o: string): boolean
      }
      apply(ops: unknown[], label?: string): boolean
      ui: { getState(): { select(ids: string[]): void } }
    }
  }
}

const idOf = (page: Page, name: string) =>
  page.evaluate((n) => {
    const s = (window as unknown as W).__kimo.session.store
    return s.nodeIds().find((id) => s.getNode(id)?.name === n) ?? null
  }, name)

const flagged = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as W).__kimo.session.store
    return s.nodeIds().filter((id) => s.getNode(id)?.placeholder !== undefined)
  })

export const scenarios: Scenario[] = [
  {
    name: "agent flags: reload mid-turn releases the layer (no lock, tag or shimmer; editable)",
    async run(ctx) {
      const { page, url } = ctx
      await openEditor(page, url)
      const mobile = await idOf(page, "Home — Mobile")
      const desktop = await idOf(page, "Home — Desktop")
      expect(!!mobile && !!desktop, "sample frames")
      // A turn is "running": its flag is on the frame (an owner that dies with the window) and a
      // bare flag a CLI wrote through MCP.
      const ok = await page.evaluate(
        ({ mobile, desktop }) =>
          (window as unknown as W).__kimo.session.apply(
            [
              {
                op: "update",
                id: mobile,
                set: {
                  placeholder: { by: "agent:kimo.gone1.0", since: "2026-10-05T10:00:00.000Z" },
                },
              },
              { op: "update", id: desktop, set: { placeholder: true } },
            ],
            "Flag layers",
          ),
        { mobile, desktop },
      )
      expect(ok, "flags applied")
      await settle(page)
      expect(
        (await page.locator('[data-agent-row="placeholder"]').count()) === 2,
        "two placeholder rows before the reload",
      )
      // Autosave to IndexedDB, then the window goes away mid-turn.
      await page.waitForTimeout(800)
      await page.reload()
      await page.locator('.canvas-host[data-ready="true"]').waitFor({ timeout: 30_000 })
      await settle(page)
      await page.waitForTimeout(300)

      expect(
        (await flagged(page)).length === 0,
        `flags released: ${JSON.stringify(await flagged(page))}`,
      )
      expect(
        (await page.locator('[data-agent-row="placeholder"]').count()) === 0,
        "no placeholder (lock) rows",
      )
      expect(
        (await page.locator('[data-testid="placeholder-tag"]').count()) === 0,
        "no placeholder tag on the canvas",
      )
      // Frames and children stay; the rows are normal rows with the eye and lock toggles.
      const row = page.locator(`.layer-tree [data-node-id="${mobile}"]`)
      await row.waitFor()
      expect((await row.locator(".kimo-layer-row__visibility").count()) === 1, "eye toggle is back")
      // Editable: select it, change its width, undo works as a normal edit.
      await row.click()
      const done = await page.evaluate((id) => {
        const w = window as unknown as W
        w.__kimo.session.ui.getState().select([id])
        return w.__kimo.session.apply([{ op: "update", id, set: { w: 333 } }], "Resize")
      }, mobile as string)
      expect(done, "edit accepted")
      const w = await page.evaluate(
        (id) => (window as unknown as W).__kimo.session.store.getNode(id)?.w,
        mobile as string,
      )
      expect(w === 333, `width ${w}`)
      // The release left no undo step behind: the only undoable edit is the resize.
      await page.keyboard.press("ControlOrMeta+z")
      const back = await page.evaluate(
        (id) => (window as unknown as W).__kimo.session.store.getNode(id)?.w,
        mobile as string,
      )
      expect(back !== 333, "resize undone")
      expect((await flagged(page)).length === 0, "undo does not bring the flag back")
    },
  },
]
