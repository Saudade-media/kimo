/**
 * Shell scenarios: home, new file → editor, layer tree, property panel, W edit, undo/redo,
 * autosave, theme toggle and tool shortcuts, plus one measured layout pass against desing.pen.
 */
import { join } from "node:path"
import type { Page } from "playwright"
import { type E2EContext, expect, type Scenario } from "./run"

async function openNewFile(page: Page, url: string) {
  await page.goto(url)
  await page.getByRole("button", { name: "New file" }).click()
  await page.waitForURL(/#\/file\/[A-Za-z0-9]+$/)
  await page.getByRole("treeitem", { name: /Home — Desktop/ }).waitFor()
}

const row = (page: Page, name: string) =>
  page
    .getByRole("treeitem")
    .filter({ has: page.locator(".kimo-layer-row__name", { hasText: new RegExp(`^${name}$`) }) })

const field = (page: Page, label: string) => page.getByRole("textbox", { name: label, exact: true })

/** Reads a node field through the dev-only `window.__kimo` hook. */
function nodeField(page: Page, name: string, key: string) {
  return page.evaluate(
    ([n, k]) => {
      const s = (
        window as unknown as {
          __kimo: {
            session: {
              store: { nodeIds(): string[]; getNode(id: string): Record<string, unknown> }
            }
          }
        }
      ).__kimo.session.store
      const id = s.nodeIds().find((i) => s.getNode(i).name === n)
      return id ? s.getNode(id)[k as string] : undefined
    },
    [name, key] as const,
  )
}

async function blur(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
}

async function shot(ctx: E2EContext, name: string) {
  if (ctx.shots) await ctx.page.screenshot({ path: join(ctx.shots, `${name}.png`) })
}

export const scenarios: Scenario[] = [
  {
    name: "home renders",
    async run(ctx) {
      const { page, url } = ctx
      await page.goto(url)
      await page.getByRole("heading", { name: "Recents" }).waitFor()
      await page.getByRole("heading", { name: "What are we designing today?" }).waitFor()
      expect(await page.getByRole("button", { name: "New file" }).isVisible(), "New file button")
      expect(await page.getByRole("button", { name: "Open file" }).isVisible(), "Open file button")
      expect(await page.getByLabel("Message the agent").isDisabled(), "composer is disabled in M1")
      await shot(ctx, "home-empty")
    },
  },
  {
    name: "new file opens the editor and appears in recents",
    async run(ctx) {
      const { page, url } = ctx
      await openNewFile(page, url)
      expect((await page.locator(".topbar__file-name").textContent()) === "Untitled", "file name")
      await page.waitForTimeout(600)
      await page.goto(url)
      await page.locator(".kimo-file-card").first().waitFor()
      const cards = await page.locator(".kimo-file-card__name").allTextContents()
      expect(cards.includes("Untitled"), `recent files list the new file (${cards})`)
      const info = await page.locator(".kimo-file-card__info").first().textContent()
      expect(info?.includes("2 frames"), `card info "${info}"`)
      await shot(ctx, "home")
    },
  },
  {
    name: "layer tree shows the sample nodes",
    async run(ctx) {
      const { page, url } = ctx
      await openNewFile(page, url)
      const names = await page.locator(".layer-tree .kimo-layer-row__name").allTextContents()
      for (const n of ["Home — Desktop", "Navbar", "Hero", "Hero Image Wrap", "Home — Mobile"])
        expect(names.includes(n), `tree has ${n} (${names.join(", ")})`)
      // Collapse and expand the desktop frame.
      await row(page, "Home — Desktop").getByRole("button", { name: "Collapse" }).click()
      expect(!(await row(page, "Navbar").count()), "children hidden after collapse")
      await row(page, "Home — Desktop").getByRole("button", { name: "Expand" }).click()
      await row(page, "Navbar").waitFor()
      // Search filters the tree.
      await page.getByRole("searchbox", { name: "Search layers" }).fill("headline")
      const filtered = await page.locator(".layer-tree .kimo-layer-row__name").allTextContents()
      expect(filtered.includes("Headline") && !filtered.includes("Navbar"), `filtered: ${filtered}`)
    },
  },
  {
    name: "selecting a layer updates the property panel",
    async run(ctx) {
      const { page, url } = ctx
      await openNewFile(page, url)
      expect(await page.getByText("Nothing selected").isVisible(), "empty selection state")
      await row(page, "Hero").click()
      await page.getByTestId("selection-name").filter({ hasText: "Hero" }).waitFor()
      expect((await row(page, "Hero").getAttribute("aria-selected")) === "true", "row selected")
      // M2 SizeField (G6R6IX): the laid-out number plus the sizing mode "Fill".
      const wField = page.locator(".kimo-size-field", { has: field(page, "Width") })
      expect(
        /^\d+(\.\d+)?$/.test(await field(page, "Width").inputValue()) &&
          ((await wField.textContent()) ?? "").includes("Fill"),
        "Hero W = <n> Fill",
      )
      const hField = page.locator(".kimo-size-field", { has: field(page, "Height") })
      expect(((await hField.textContent()) ?? "").includes("Hug"), "Hero H = <n> Hug")
      expect((await field(page, "Gap").inputValue()) === "18", "Hero gap 18")
      // Board 08: 4-sided padding shows the Individual padding fields T R B L.
      const pads = await Promise.all(
        ["top", "right", "bottom", "left"].map((side) =>
          field(page, `Padding ${side}`).inputValue(),
        ),
      )
      expect(pads.join(" ") === "48 40 40 40", `Hero pad ${pads.join(" ")}`)
      // Multi-select with mixed widths.
      await row(page, "Home — Mobile").click({ modifiers: ["Shift"] })
      await page.getByTestId("selection-name").filter({ hasText: "layers" }).waitFor()
      expect((await field(page, "Width").inputValue()) === "Mixed", "mixed width")
      await shot(ctx, "editor-multi")
    },
  },
  {
    name: "editing W changes the node; undo/redo; autosave",
    async run(ctx) {
      const { page, url } = ctx
      await openNewFile(page, url)
      await row(page, "Home — Mobile").click()
      const w = field(page, "Width")
      expect((await w.inputValue()) === "280", "initial W 280")
      await w.click()
      await w.fill("320")
      await w.press("Enter")
      expect((await nodeField(page, "Home — Mobile", "w")) === 320, "node w = 320")
      await blur(page)
      await page.keyboard.press("ControlOrMeta+z")
      expect((await nodeField(page, "Home — Mobile", "w")) === 280, "undo → 280")
      expect((await w.inputValue()) === "280", "field shows 280 after undo")
      await page.keyboard.press("ControlOrMeta+Shift+z")
      expect((await nodeField(page, "Home — Mobile", "w")) === 320, "redo → 320")
      // Keywords: W = fill → { mode: "fill" }.
      await w.click()
      await w.fill("hug")
      await w.press("Enter")
      const fit = await nodeField(page, "Home — Mobile", "w")
      // Hug is a frame's default size (spec defaults): stored canonically as absent.
      expect(
        fit === undefined || JSON.stringify(fit) === '{"mode":"fit"}',
        `W hug → ${JSON.stringify(fit)}`,
      )
      await blur(page)
      await page.keyboard.press("ControlOrMeta+z")
      // Autosave: reload restores 320.
      await page.waitForTimeout(400)
      await page.reload()
      await row(page, "Home — Mobile").click()
      expect((await field(page, "Width").inputValue()) === "320", "W persisted across reload")
    },
  },
  {
    name: "visibility, rename, theme toggle and tool shortcuts",
    async run(ctx) {
      const { page, url } = ctx
      await openNewFile(page, url)
      const navbar = row(page, "Navbar")
      await navbar.hover()
      await navbar.getByRole("button", { name: "Hide layer" }).click()
      expect((await nodeField(page, "Navbar", "visible")) === false, "navbar hidden")
      await navbar.dblclick()
      const input = page.getByRole("textbox", { name: "Layer name" })
      await input.fill("Top bar")
      await input.press("Enter")
      await row(page, "Top bar").waitFor()
      await blur(page)
      await page.keyboard.press("r")
      expect(
        (await page.locator('[data-tool="rectangle"]').getAttribute("aria-pressed")) === "true",
        "R → rectangle",
      )
      await page.keyboard.press("v")
      expect(
        (await page.locator('[data-tool="move"]').getAttribute("aria-pressed")) === "true",
        "V → move",
      )
      // File menu → Rename; Zoom menu → Zoom in.
      await page.locator(".topbar__file").click()
      await page.getByRole("menuitem", { name: "Rename" }).click()
      const fileName = page.getByRole("textbox", { name: "File name" })
      await fileName.fill("Loom site")
      await fileName.press("Enter")
      await page.locator(".topbar__file-name", { hasText: "Loom site" }).waitFor()
      await page.getByRole("button", { name: "Zoom" }).click()
      await page.getByRole("menuitem", { name: "Zoom in" }).click()
      await page.locator(".topbar__zoom-value", { hasText: "200%" }).waitFor()
      await page.getByRole("button", { name: "Toggle theme" }).click()
      expect(
        (await page.evaluate(() => document.documentElement.dataset.theme)) === "dark",
        "dark mode",
      )
      await row(page, "Hero").click()
      await shot(ctx, "editor-dark")
      await page.getByRole("button", { name: "Toggle theme" }).click()
      expect(
        (await page.evaluate(() => document.documentElement.dataset.theme)) === "light",
        "light mode",
      )
    },
  },
  {
    name: "measured layout matches board 03",
    async run(ctx) {
      const { page, url } = ctx
      await openNewFile(page, url)
      await row(page, "Hero").click()
      await page.evaluate(() => document.fonts.ready)
      const m = await page.evaluate(() => {
        const box = (sel: string) => {
          const el = document.querySelector(sel)
          if (!el) return null
          const r = el.getBoundingClientRect()
          const cs = getComputedStyle(el)
          return {
            x: r.x,
            y: r.y,
            w: r.width,
            h: r.height,
            display: cs.display,
            font: cs.fontFamily.split(",")[0],
          }
        }
        return {
          topbar: box(".topbar"),
          left: box(".left-panel"),
          right: box(".right-panel"),
          canvas: box(".editor__canvas"),
          toolbar: box(".floating-toolbar"),
          tool: box(".kimo-tool-button"),
          ask: box(".floating-toolbar__ask"),
          layerRow: box(".layer-tree .kimo-layer-row"),
          search: box(".left-panel__search .kimo-input"),
          propField: box(".kimo-prop-field"),
          tabs: box(".right-panel .kimo-tabs"),
          selection: box(".selection-header"),
          logo: box(".topbar__logo"),
          body: getComputedStyle(document.body).fontFamily,
        }
      })
      ctx.log(JSON.stringify(m))
      const near = (a: number | undefined, b: number, what: string) =>
        expect(a !== undefined && Math.abs(a - b) < 0.6, `${what}: ${a} ≠ ${b}`)
      near(m.topbar?.h, 48, "topbar height")
      near(m.left?.w, 256, "left panel width")
      near(m.right?.w, 280, "right panel width")
      near(m.canvas?.w, 1440 - 256 - 280, "canvas width")
      near(m.toolbar?.h, 48, "toolbar height")
      near(m.tool?.w, 36, "tool button")
      near(m.ask?.h, 36, "ask kimo height")
      near(m.layerRow?.h, 28, "layer row height")
      near(m.search?.h, 30, "search input height")
      near(m.propField?.h, 28, "prop field height")
      near(m.logo?.w, 28, "logo")
      if (m.toolbar && m.canvas) {
        near(m.canvas.y + m.canvas.h - (m.toolbar.y + m.toolbar.h), 24, "toolbar bottom inset")
        near(m.toolbar.x + m.toolbar.w / 2, m.canvas.x + m.canvas.w / 2, "toolbar centered")
      }
      await shot(ctx, "editor-light")
    },
  },
]
