/**
 * Layers panel overflow: with more rows than fit, the tree scrolls and every row keeps its 28 px
 * height (rows used to shrink to fit the panel).
 */
import { openEditor, settle } from "./qa-helpers"
import { expect, type Scenario } from "./run"

type W = { __kimo: { session: { apply(ops: unknown[], label?: string): boolean } } }

export const scenarios: Scenario[] = [
  {
    name: "layers panel: many layers scroll, rows keep their height",
    async run({ page, url, log }) {
      await page.setViewportSize({ width: 1280, height: 800 })
      await openEditor(page, url)
      await page.evaluate(() => {
        const ops = Array.from({ length: 150 }, (_, i) => ({
          op: "insert",
          id: `scrollrow${String(i).padStart(4, "0")}`,
          parent: null,
          node: { type: "rect", name: `Row ${i}`, x: i * 4, y: 0, w: 4, h: 4 },
        }))
        ;(window as unknown as W).__kimo.session.apply(ops, "Add rows")
      })
      await settle(page)
      const m = await page.evaluate(() => {
        const tree = document.querySelector(".layer-tree") as HTMLElement
        const panel = document.querySelector(".left-panel") as HTMLElement
        const rows = [...tree.querySelectorAll('[role="treeitem"]')].map(
          (r) => r.getBoundingClientRect().height,
        )
        const t = tree.getBoundingClientRect()
        const p = panel.getBoundingClientRect()
        return {
          rows: rows.length,
          minH: Math.min(...rows),
          maxH: Math.max(...rows),
          scroll: tree.scrollHeight,
          client: tree.clientHeight,
          treeBottom: t.bottom,
          panelBottom: p.bottom,
        }
      })
      log(JSON.stringify(m))
      expect(m.rows > 0, "rows rendered")
      expect(m.minH === 28 && m.maxH === 28, `every row is 28 px (${m.minH}–${m.maxH})`)
      expect(m.scroll > m.client, "tree overflows and scrolls")
      expect(m.treeBottom <= m.panelBottom, "tree stays inside the panel")
      const before = await page.evaluate(() => document.querySelector(".layer-tree")?.scrollTop)
      await page.locator(".layer-tree").hover()
      await page.mouse.wheel(0, 600)
      await settle(page)
      const after = await page.evaluate(() => document.querySelector(".layer-tree")?.scrollTop)
      expect((after ?? 0) > (before ?? 0), `wheel scrolls the tree (${before} → ${after})`)
    },
  },
]
