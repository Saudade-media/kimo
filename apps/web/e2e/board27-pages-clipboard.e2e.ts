/**
 * Board 27 §1 (pages) and §2 (clipboard & structure, layer drag) in the real editor:
 * - pages strip (lid8E): add + rename, switch (tree / canvas labels / new roots follow the active
 *   page), page menu (Move up, Delete… → 400 px confirm, undo), footer count (wsA6U), ⌘P switcher
 *   (C1rd4) with ↵ and ⌘↵; one measured pass of PageRow / strip / tree header / footer / palette;
 * - ⌘C / ⌘V into the selected frame (offset +16, toast, parent flash), ⇧⌘V in place, ⌘D +16,
 *   ⌘G group, ⇧⌘G ungroup, ⌥⇧A remove auto layout, the context menu's board 27 items;
 * - layer drag (h0cqV3): Into a frame (LayerRow/DropTarget), Invalid over an instance (red
 *   DropIndicator + tooltip), measured.
 */
import type { Page } from "playwright"
import { settle } from "./qa-helpers"
import { type E2EContext, expect, type Scenario } from "./run"

interface Hook {
  session: {
    store: {
      getNode(id: string): Record<string, unknown> | undefined
      children(parent: string | null): string[]
      apply(ops: unknown[], o: { origin: string }): { ok: boolean }
      undo(o: string): void
      toHeader(): Record<string, unknown>
    }
    ui: {
      getState(): {
        selection: string[]
        page: string | null
        setViewport(v: object): void
        select(ids: string[]): void
      }
    }
  }
}
declare const window: Window & { __kimo: Hook }

async function openEditor(page: Page, url: string, nodes: unknown[]) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page
    .context()
    .grantPermissions(["clipboard-read", "clipboard-write"])
    .catch(() => {})
  await page.goto(url)
  await page.getByRole("button", { name: "New file" }).first().click()
  await page.waitForURL(/#\/file\/[A-Za-z0-9]+$/)
  await page.locator('.canvas-host[data-ready="true"]').waitFor({ timeout: 30_000 })
  await settle(page)
  await page.evaluate((ops) => {
    const s = window.__kimo.session
    s.store.apply(
      s.store.children(null).map((id) => ({ op: "delete", id })),
      { origin: "user" },
    )
    s.store.apply(ops as unknown[], { origin: "user" })
    s.ui.getState().setViewport({ x: -100, y: -100, zoom: 1 })
  }, nodes)
  await settle(page)
}

const node = (page: Page, id: string) =>
  page.evaluate((i) => window.__kimo.session.store.getNode(i) ?? null, id)
const kids = (page: Page, id: string | null) =>
  page.evaluate((i) => window.__kimo.session.store.children(i), id)
const selection = (page: Page) => page.evaluate(() => window.__kimo.session.ui.getState().selection)
const select = (page: Page, ids: string[]) =>
  page.evaluate((i) => window.__kimo.session.ui.getState().select(i), ids)

async function focusCanvas(page: Page) {
  await page.locator(".canvas-host").focus()
}

type Row = { what: string; want: unknown; got: unknown; ok: boolean }
const eq = (what: string, got: unknown, want: unknown, tol = 0.6): Row => ({
  what,
  want,
  got,
  ok:
    typeof want === "number" && typeof got === "number"
      ? Math.abs(got - want) <= tol
      : String(got) === String(want),
})
function table(ctx: E2EContext, title: string, rows: Row[]) {
  ctx.log(
    `${title}\n${rows.map((r) => `${r.ok ? "✓" : "✗"} ${r.what}: want ${String(r.want)} got ${String(r.got)}`).join("\n")}`,
  )
  const bad = rows.filter((r) => !r.ok)
  expect(
    bad.length === 0,
    `${title}: ${bad.map((b) => `${b.what} ${String(b.got)}≠${String(b.want)}`).join("; ")}`,
  )
}

/** Computed box + style of the first element matching each selector. */
function measure(page: Page, sels: Record<string, string>) {
  return page.evaluate((s) => {
    const out: Record<string, Record<string, number | string> | null> = {}
    for (const [k, sel] of Object.entries(s)) {
      const e = document.querySelector(sel)
      if (!e) {
        out[k] = null
        continue
      }
      const r = e.getBoundingClientRect()
      const cs = getComputedStyle(e)
      out[k] = {
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
        pt: parseFloat(cs.paddingTop),
        pr: parseFloat(cs.paddingRight),
        pb: parseFloat(cs.paddingBottom),
        pl: parseFloat(cs.paddingLeft),
        gap: parseFloat(cs.columnGap || cs.gap) || 0,
        rowGap: parseFloat(cs.rowGap) || 0,
        bg: cs.backgroundColor,
        color: cs.color,
        fs: parseFloat(cs.fontSize),
        fw: cs.fontWeight,
        ff: cs.fontFamily,
        radius: parseFloat(cs.borderTopLeftRadius),
        border: `${parseFloat(cs.borderTopWidth)} ${cs.borderTopColor}`,
        shadow: cs.boxShadow,
        display: cs.display,
        align: cs.alignItems,
      }
    }
    return out
  }, sels)
}

const tok = (page: Page, name: string, prop: "color" | "fontSize" = "color") =>
  page.evaluate(
    ([n, p]) => {
      const d = document.createElement("div")
      if (p === "color") d.style.color = `var(--kimo-${n})`
      else d.style.fontSize = `var(--kimo-${n})`
      document.body.append(d)
      const cs = getComputedStyle(d)
      const v = p === "color" ? cs.color : cs.fontSize
      d.remove()
      return p === "color" ? v : parseFloat(v)
    },
    [name, prop] as const,
  )

const HERO = [
  {
    op: "insert",
    id: "HeroFrame1",
    parent: null,
    node: { type: "frame", name: "Hero", x: 0, y: 0, w: 336, h: 180, fill: "#FFFFFF" },
  },
  {
    op: "insert",
    id: "CardOne001",
    parent: "HeroFrame1",
    node: {
      type: "frame",
      name: "Card",
      x: 20,
      y: 24,
      w: 136,
      h: 132,
      radius: 10,
      fill: "#F4F1EC",
      layout: { dir: "column", gap: 6, pad: 12 },
    },
  },
  {
    op: "insert",
    id: "CardTitle1",
    parent: "CardOne001",
    node: { type: "text", name: "Title", content: "Starter" },
  },
  {
    op: "insert",
    id: "BtnMain001",
    parent: null,
    node: { type: "frame", name: "Button", x: 500, y: 0, w: 80, h: 32, component: true },
  },
  {
    op: "insert",
    id: "BtnInst001",
    parent: null,
    node: { type: "instance", name: "Button", of: "BtnMain001", x: 500, y: 100 },
  },
]

export const scenarios: Scenario[] = [
  {
    name: "board27 pages: strip, switch, menu, delete confirm, ⌘P, footer, measured",
    async run(ctx) {
      const { page, url } = ctx
      await openEditor(page, url, HERO)
      const footer = page.locator(".pages-footer .left-panel__footer-label")
      expect((await footer.textContent()) === "1 page", "footer: 1 page")
      expect(
        (await page.locator(".layer-tree-header__page").textContent()) === "Page 1",
        "tree header: Page 1",
      )
      // Add page → "Page 2" in rename mode; type a name.
      await page.getByRole("button", { name: "Add page" }).click()
      await settle(page)
      const input = page.getByLabel("Page name")
      expect(await input.isVisible(), "new page enters rename")
      await input.fill("Docs")
      await input.press("Enter")
      await settle(page)
      expect((await footer.textContent()) === "2 pages", "footer: 2 pages")
      const rows = page.locator(".pages-strip .kimo-page-row")
      expect((await rows.count()) === 2, "two page rows")
      expect(
        (await page.locator(".kimo-page-row--current .kimo-page-row__name").textContent()) ===
          "Docs",
        "Docs is current",
      )
      // The new page is empty: no tree rows, no canvas labels; existing roots got Page 1's id.
      expect((await page.locator('.layer-tree [role="treeitem"]').count()) === 0, "empty tree")
      expect((await page.locator(".canvas-host__label").count()) === 0, "no labels on Docs")
      const hero = await node(page, "HeroFrame1")
      expect(typeof hero?.page === "string", "existing roots stamped with Page 1")
      // A frame drawn now lands on Docs.
      await focusCanvas(page)
      await page.keyboard.press("f")
      const box = (await page.locator(".canvas-host").boundingBox()) as { x: number; y: number }
      await page.mouse.move(box.x + 300, box.y + 300)
      await page.mouse.down()
      await page.mouse.move(box.x + 400, box.y + 380, { steps: 5 })
      await page.mouse.up()
      await settle(page)
      const drawn = (await selection(page))[0] as string
      const docsId = await page.evaluate(() => window.__kimo.session.ui.getState().page)
      expect((await node(page, drawn))?.page === docsId, "drawn frame is on Docs")
      // Switch back to Page 1: the tree shows Hero, the drawn frame is gone from the tree.
      await rows.first().click()
      await settle(page)
      const treeNames = await page.locator('.layer-tree [role="treeitem"]').allTextContents()
      ctx.log("Page 1 tree", JSON.stringify(treeNames))
      expect(
        treeNames.some((t) => t.includes("Hero")),
        "Hero on Page 1",
      )
      expect(!treeNames.some((t) => t.includes("Frame")), "Docs frame not listed")

      // Measured pass (lid8E k801nc / vs31B / PageRow w38uQ·JMKMB / hvwbw / wsA6U).
      const m = await measure(page, {
        strip: ".pages-strip",
        header: ".pages-strip__header",
        title: ".pages-strip__title",
        add: ".pages-strip__add",
        current: ".kimo-page-row--current",
        row: ".kimo-page-row:not(.kimo-page-row--current)",
        currentName: ".kimo-page-row--current .kimo-page-row__name",
        rowName: ".kimo-page-row:not(.kimo-page-row--current) .kimo-page-row__name",
        check: ".kimo-page-row--current .kimo-page-row__check",
        treeHeader: ".layer-tree-header",
        treePage: ".layer-tree-header__page",
        treeCount: ".layer-tree-header__count",
        footer: ".pages-footer",
        footerLabel: ".pages-footer .left-panel__footer-label",
      })
      const sm = await tok(page, "text-sm", "fontSize")
      const xs = await tok(page, "text-xs", "fontSize")
      table(ctx, "pages strip", [
        eq("strip padding t", m.strip?.pt, 4),
        eq("strip padding r", m.strip?.pr, 6),
        eq("strip padding b", m.strip?.pb, 8),
        eq("strip padding l", m.strip?.pl, 6),
        eq("strip gap", m.strip?.rowGap, 1),
        eq("strip bottom border", String(m.strip?.shadow).includes("inset"), true),
        eq("header h", m.header?.h, 28),
        eq("header gap", m.header?.gap, 4),
        eq("header padding r", m.header?.pr, 2),
        eq("header padding l", m.header?.pl, 8),
        eq("title size", m.title?.fs, sm),
        eq("title weight", m.title?.fw, "500"),
        eq("add w", m.add?.w, 24),
        eq("add h", m.add?.h, 24),
        eq("row h", m.row?.h, 28),
        eq("row padding l", m.row?.pl, 8),
        eq("row padding r", m.row?.pr, 8),
        eq("row gap", m.row?.gap, 6),
        eq("row bg", m.row?.bg, "rgba(0, 0, 0, 0)"),
        eq("current bg", m.current?.bg, await tok(page, "bg-hover")),
        eq("current name weight", m.currentName?.fw, "500"),
        eq("row name weight", m.rowName?.fw, "400"),
        eq("row name size", m.rowName?.fs, sm),
        eq("check slot", `${m.check?.w}×${m.check?.h}`, "14×14"),
        eq("tree header padding t", m.treeHeader?.pt, 8),
        eq("tree header padding l", m.treeHeader?.pl, 14),
        eq("tree header padding b", m.treeHeader?.pb, 4),
        eq("tree header gap", m.treeHeader?.gap, 6),
        eq("tree page size", m.treePage?.fs, xs),
        eq("tree page weight", m.treePage?.fw, "600"),
        eq("tree count mono", String(m.treeCount?.ff).toLowerCase().includes("mono"), true),
        eq("footer padding t", m.footer?.pt, 10),
        eq("footer padding l", m.footer?.pl, 12),
        eq("footer gap", m.footer?.gap, 8),
        eq("footer label", (await footer.textContent()) ?? "", "2 pages"),
      ])
      // Footer hover: bg-hover + primary text.
      await page.locator(".pages-footer").hover()
      const hov = await measure(page, {
        f: ".pages-footer",
        l: ".pages-footer .left-panel__footer-label",
      })
      table(ctx, "footer hover", [
        eq("bg", hov.f?.bg, await tok(page, "bg-hover")),
        eq("label", hov.l?.color, await tok(page, "text-primary")),
      ])

      // ⌘P: the switcher; "do" + ↵ goes to Docs.
      await focusCanvas(page)
      await page.keyboard.press("ControlOrMeta+p")
      await settle(page)
      const sw = page.locator(".page-switcher")
      expect(await sw.isVisible(), "switcher open")
      const pm = await measure(page, {
        sw: ".page-switcher",
        search: ".page-switcher__search",
        results: ".page-switcher__results",
        active: ".kimo-palette-row--active",
        key: ".kimo-palette-row--active .kimo-palette-row__key",
        hints: ".page-switcher__hints",
      })
      const canvasBox = await page.locator(".canvas-host").boundingBox()
      table(ctx, "⌘P switcher", [
        eq("width", pm.sw?.w, 400),
        eq("top 20 % of canvas", pm.sw?.y, (canvasBox?.y ?? 0) + (canvasBox?.height ?? 0) * 0.2, 1),
        eq(
          "radius xl",
          pm.sw?.radius,
          await page.evaluate(() =>
            parseFloat(
              getComputedStyle(document.documentElement).getPropertyValue("--kimo-radius-xl"),
            ),
          ),
        ),
        eq("search h", pm.search?.h, 44),
        eq("search padding l", pm.search?.pl, 14),
        eq("search gap", pm.search?.gap, 8),
        eq("results padding", pm.results?.pt, 6),
        eq("palette row h", pm.active?.h, 32),
        eq("palette row padding l", pm.active?.pl, 10),
        eq("palette row gap", pm.active?.gap, 8),
        eq("palette active bg", pm.active?.bg, await tok(page, "bg-hover")),
        eq("enter key padding", `${pm.key?.pt} ${pm.key?.pl}`, "1 5"),
        eq("enter key radius", pm.key?.radius, 4),
        eq("hints gap", pm.hints?.gap, 14),
        eq("hints padding", `${pm.hints?.pt} ${pm.hints?.pl}`, "8 14"),
      ])
      await page.keyboard.type("do")
      ctx.log(
        "switcher",
        await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120)),
        JSON.stringify(await page.locator(".page-switcher .kimo-palette-row").allTextContents()),
      )
      await page.keyboard.press("Enter")
      await settle(page)
      expect(
        (await page.evaluate(() => window.__kimo.session.ui.getState().page)) === docsId,
        "↵ switched to Docs",
      )
      // ⌘↵ creates a page named after the query.
      await focusCanvas(page)
      await page.keyboard.press("ControlOrMeta+p")
      await page.keyboard.type("Pricing")
      await page.keyboard.press("ControlOrMeta+Enter")
      await settle(page)
      expect((await footer.textContent()) === "3 pages", "⌘↵ created Pricing")
      expect(
        (await page.locator(".kimo-page-row--current .kimo-page-row__name").textContent()) ===
          "Pricing",
        "Pricing current",
      )
      // Page menu: Move up, then Delete… (confirm 400 px, danger), then undo.
      await page.locator(".kimo-page-row--current").click({ button: "right" })
      await page.getByRole("menuitem", { name: "Move up" }).click()
      await settle(page)
      const names = await page.locator(".pages-strip .kimo-page-row__name").allTextContents()
      expect(
        JSON.stringify(names) === JSON.stringify(["Page 1", "Pricing", "Docs"]),
        `moved up ${names}`,
      )
      await page.locator(".kimo-page-row", { hasText: "Docs" }).click({ button: "right" })
      await page.getByRole("menuitem", { name: "Delete page…" }).click()
      const dialog = page.getByRole("dialog", { name: "Delete “Docs”?" })
      expect(await dialog.isVisible(), "delete confirm")
      const dm = await measure(page, { d: ".kimo-dialog", c: ".kimo-dialog__button--danger" })
      table(ctx, "delete confirm", [
        eq("width", dm.d?.w, 400),
        eq("confirm fill", dm.c?.bg, await tok(page, "danger")),
      ])
      expect(
        ((await dialog.textContent()) ?? "").includes("Its 1 layer is removed from this file"),
        "layer count in the confirm",
      )
      await page.getByRole("button", { name: "Delete page" }).click()
      await settle(page)
      expect((await footer.textContent()) === "2 pages", "deleted")
      expect((await node(page, drawn)) === null, "its roots deleted")
      await page.evaluate(() => window.__kimo.session.store.undo("user"))
      await settle(page)
      expect((await footer.textContent()) === "3 pages", "undo restores the page")
      // The last page can't be deleted.
      await page.evaluate(() => {
        const s = window.__kimo.session
        const pages = s.store.toHeader().pages as Record<string, unknown>
        s.store.apply(
          [
            {
              op: "setHeader",
              set: {
                pages: {
                  [Object.keys(pages)[0] as string]: (pages as Record<string, unknown>)[
                    Object.keys(pages)[0] as string
                  ],
                },
              },
            },
          ],
          { origin: "user" },
        )
      })
      await settle(page)
      await page.locator(".pages-strip .kimo-page-row").first().click({ button: "right" })
      const del = page.getByRole("menuitem", { name: "Delete page…" })
      expect((await del.getAttribute("aria-disabled")) === "true", "last page: delete disabled")
      await page.keyboard.press("Escape")
    },
  },
  {
    name: "board27 clipboard: copy/paste into frame, in place, duplicate, group/ungroup, layout, menu",
    async run(ctx) {
      const { page, url } = ctx
      await openEditor(page, url, HERO)
      await select(page, ["CardOne001"])
      await focusCanvas(page)
      await page.keyboard.press("ControlOrMeta+c")
      await settle(page)
      await select(page, ["HeroFrame1"])
      await page.keyboard.press("ControlOrMeta+v")
      await settle(page)
      await page.waitForTimeout(200)
      const pasted = (await selection(page))[0] as string
      const pn = await node(page, pasted)
      ctx.log("pasted", JSON.stringify(pn))
      expect(pasted !== "CardOne001" && pn?.parent === "HeroFrame1", "pasted into Hero")
      expect(pn?.x === 36 && pn?.y === 40, "nudged +16 off the identical original")
      expect((await kids(page, pasted)).length === 1, "subtree pasted")
      const toast = page.locator(".m3-toast", { hasText: "Pasted “Card” into Hero" })
      expect(await toast.isVisible(), "toast names the target")
      expect(await toast.getByRole("button", { name: "Undo" }).isVisible(), "toast has Undo")
      expect((await page.locator('[data-testid="paste-flash"]').count()) === 1, "parent flash")
      const flash = await measure(page, { f: ".canvas-host__flash" })
      table(ctx, "paste flash (n8mU3e)", [
        eq("border", flash.f?.border, `1 ${await tok(page, "selection")}`),
        eq("w = Hero", flash.f?.w, 336, 1),
      ])
      // ⇧⌘V in place: same parent and x/y as the copied node.
      await select(page, [])
      await page.keyboard.press("ControlOrMeta+Shift+v")
      await settle(page)
      await page.waitForTimeout(200)
      const inPlace = await node(page, (await selection(page))[0] as string)
      expect(inPlace?.parent === "HeroFrame1" && inPlace.x === 20 && inPlace.y === 24, "in place")
      // ⌘D: +16/+16.
      await select(page, ["CardOne001"])
      await page.keyboard.press("ControlOrMeta+d")
      await settle(page)
      const dup = await node(page, (await selection(page))[0] as string)
      expect(dup?.x === 36 && dup?.y === 40, `duplicate +16 ${JSON.stringify(dup)}`)
      // ⌘G: a real group; ⇧⌘G releases it.
      await select(page, ["CardOne001", (await selection(page))[0] as string])
      await page.keyboard.press("ControlOrMeta+g")
      await settle(page)
      const g = (await selection(page))[0] as string
      expect((await node(page, g))?.type === "group", "⌘G group node")
      await page.keyboard.press("ControlOrMeta+Shift+g")
      await settle(page)
      expect((await node(page, g)) === null, "ungrouped")
      expect((await node(page, "CardOne001"))?.parent === "HeroFrame1", "child back in Hero")
      expect((await node(page, "CardOne001"))?.x === 20, "keeps its position")
      // ⌥⇧A on the auto-layout card: layout removed, child frozen at 12/12.
      await select(page, ["CardOne001"])
      await page.keyboard.press("Alt+Shift+KeyA")
      await settle(page)
      expect((await node(page, "CardOne001"))?.layout === undefined, "auto layout removed")
      const title = await node(page, "CardTitle1")
      expect(title?.x === 12 && title?.y === 12, `child frozen ${JSON.stringify(title)}`)
      // Context menu: board 27 items, Ungroup disabled, Add auto layout (swapped).
      const r = await page.locator(".canvas-host").boundingBox()
      await page.mouse.click((r?.x ?? 0) + 100 + 60, (r?.y ?? 0) + 100 + 100, { button: "right" })
      const menu = page.getByTestId("canvas-context-menu")
      await menu.waitFor()
      const labels = await menu.locator('[role="menuitem"]').allTextContents()
      ctx.log("context menu", JSON.stringify(labels))
      for (const want of [
        "Copy",
        "Paste here",
        "Duplicate",
        "Group selection",
        "Ungroup",
        "Wrap in frame",
        "Create component",
        "Bring to front",
        "Send to back",
        "Delete",
      ])
        expect(
          labels.some((l) => l.startsWith(want)),
          `menu has ${want}`,
        )
      expect(
        labels.some((l) => l.startsWith("Add auto layout") || l.startsWith("Remove auto layout")),
        "menu has the auto layout pair",
      )
      await page.keyboard.press("Escape")
    },
  },
  {
    name: "board27 layer drag: into a frame, invalid into its own child, measured",
    async run(ctx) {
      const { page, url } = ctx
      await openEditor(page, url, [
        ...HERO,
        {
          op: "insert",
          id: "LooseRect1",
          parent: null,
          node: { type: "rect", name: "Loose", x: 0, y: 260, w: 40, h: 40, fill: "#D9D9D9" },
        },
      ])
      const row = (id: string) => page.locator(`.layer-tree [data-node-id="${id}"]`).first()
      const from = (await row("LooseRect1").boundingBox()) as {
        x: number
        y: number
        width: number
        height: number
      }
      const hero = (await row("HeroFrame1").boundingBox()) as {
        x: number
        y: number
        width: number
        height: number
      }
      await page.mouse.move(from.x + 60, from.y + 14)
      await page.mouse.down()
      await page.mouse.move(hero.x + 60, hero.y + 14, { steps: 8 })
      await settle(page)
      const target = page.locator('[data-drop-target="into"]')
      expect(await target.isVisible(), "LayerRow/DropTarget shown")
      const tm = await measure(page, {
        t: '[data-drop-target="into"]',
        icon: ".kimo-layer-row-drop-target__into",
      })
      table(ctx, "LayerRow/DropTarget (tvN2q)", [
        eq("h", tm.t?.h, 28),
        eq("fill", tm.t?.bg, await tok(page, "selection-soft")),
        eq("stroke", tm.t?.shadow, `${await tok(page, "selection")} 0px 0px 0px 1.5px inset`),
        eq("gap", tm.t?.gap, 6),
        eq(
          "into icon",
          `${tm.icon?.w}×${tm.icon?.h} ${tm.icon?.color}`,
          `14×14 ${await tok(page, "selection")}`,
        ),
      ])
      await page.mouse.up()
      await settle(page)
      const moved = await node(page, "LooseRect1")
      expect(moved?.parent === "HeroFrame1", "dropped into Hero")
      expect(
        moved?.x === 0 && moved?.y === 260,
        `keeps its canvas position ${JSON.stringify(moved)}`,
      )
      // Invalid: between rows inside an instance's subtree is refused; over the instance row's
      // top quarter (root level) is fine, so drag into the main's child slot instead:
      // dragging Hero into its own child Card is invalid.
      const card = (await row("CardOne001").boundingBox()) as { x: number; y: number }
      const h2 = (await row("HeroFrame1").boundingBox()) as { x: number; y: number }
      await page.mouse.move(h2.x + 60, h2.y + 14)
      await page.mouse.down()
      await page.mouse.move(card.x + 80, card.y + 14, { steps: 8 })
      await settle(page)
      const ind = page.getByTestId("layer-drop-indicator")
      expect(await ind.isVisible(), "indicator shown")
      const im = await measure(page, {
        ring: ".kimo-drop-indicator--invalid .kimo-drop-indicator__ring",
        line: ".kimo-drop-indicator--invalid .kimo-drop-indicator__line",
        tip: '[data-testid="layer-drop-tooltip"]',
      })
      const danger = await tok(page, "danger")
      table(ctx, "DropIndicator/Invalid (nN73G)", [
        eq("ring", `${im.ring?.w}×${im.ring?.h}`, "8×8"),
        eq("ring stroke", im.ring?.border, `2 ${danger}`),
        eq("ring fill", im.ring?.bg, await tok(page, "bg-app")),
        eq("line h", im.line?.h, 2),
        eq("line fill", im.line?.bg, danger),
        eq("tooltip shown", im.tip !== null, true),
      ])
      ctx.log("tooltip", await page.getByTestId("layer-drop-tooltip").textContent())
      await page.mouse.up()
      await settle(page)
      expect((await node(page, "HeroFrame1"))?.parent === null, "invalid drop is a no-op")
    },
  },
]
