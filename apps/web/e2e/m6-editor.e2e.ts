/**
 * M6/M7 integration in the real editor (m4-app harness: the real `App` over a macOS memory
 * platform): the Agent tab mounts the panel (board 22 first run, panel 360 wide), ⌘K / "Ask
 * Kimo" opens it, ⇧P inserts a prompt while P stays the Pen, N inserts a note whose context
 * menu converts it to a prompt, the topbar Export opens the board 07 dialog, and Home on an
 * untitled document asks first (board 24 (i)).
 */
import { disk, harnessUrl, SITE } from "./m4-app.e2e"
import { checker, measure, token } from "./m6-helpers"
import { type E2EContext, expect, type Scenario } from "./run"

type Kimo = {
  __kimoApp?: unknown
  __kimo?: {
    session: {
      store: {
        getNode(id: string): Record<string, unknown> | undefined
        nodeIds(): string[]
      }
      ui: { getState(): { tool: string; selection: string[] } }
    }
    canvas(): {
      renderer: unknown
      layout(): { nodes: Map<string, { world: { x: number; y: number; w: number; h: number } }> }
      worldToScreen(p: { x: number; y: number }): { x: number; y: number }
    } | null
  }
}
declare const window: Kimo & Window

async function editor(ctx: E2EContext, hash = disk(`${SITE}/home.kimo`), os?: "windows") {
  await ctx.page.setViewportSize({ width: 1440, height: 900 })
  await ctx.page.goto(`${await harnessUrl(ctx)}${os ? `?os=${os}` : ""}${hash}`)
  await ctx.page.waitForFunction(() => !!(window as unknown as Kimo).__kimoApp)
  if (hash === "#/") return
  await ctx.page.locator(".kimo-desktop-topbar").waitFor({ timeout: 15_000 })
  // The canvas takes tool keys once its renderer drew the first frame (onReady).
  await ctx.page.waitForFunction(
    () => !!window.__kimo?.session && !!window.__kimo.canvas()?.renderer,
    undefined,
    { timeout: 15_000 },
  )
}

const idsOfType = (ctx: E2EContext, type: string) =>
  ctx.page.evaluate(
    (t) =>
      window.__kimo?.session.store
        .nodeIds()
        .filter((id) => window.__kimo?.session.store.getNode(id)?.type === t) ?? [],
    type,
  )

export const scenarios: Scenario[] = [
  {
    name: "m6 editor: Agent tab mounts the panel (first run), ⌘K opens it, panel 360 wide",
    async run(ctx) {
      const { page } = ctx
      await editor(ctx)
      await page.locator(".editor__canvas").click({ position: { x: 900, y: 600 } })
      await page.keyboard.press("Meta+k")
      await page.locator("[data-testid=agent-first-run-key]").waitFor({ timeout: 10_000 })
      const w = await page.locator(".right-panel").evaluate((e) => e.getBoundingClientRect().width)
      expect(Math.abs(w - 360) < 0.75, `right panel width ${w}`)
      // Board 25 D8covN (nothing found): Body WJCW5, Key Card rPDtX, Key Field WxxLI, the
      // composer kept at 50 % with "Connect a model to start".
      const m = await measure(page, {
        body: '[data-pen="WJCW5"]',
        title: ".agent-first-run__title",
        card: '[data-pen="rPDtX"]',
        field: '[data-pen="WxxLI"]',
        connect: '[data-pen="kBBgE"]',
      })
      const c = checker(ctx, "Editor Agent tab · first run (D8covN)")
      c.box("Body WJCW5", m.body, { pad: [16, 24, 16, 24], gap: 12 })
      c.box("Title", m.title, { fs: 16, fw: "600", h: 19 })
      c.box("Key Card rPDtX", m.card, {
        pad: [12, 12, 12, 12],
        gap: 8,
        radius: 16,
        bg: await token(page, "--kimo-bg-subtle"),
      })
      c.box("Key Field WxxLI", m.field, { h: 32, pad: [0, 10, 0, 10], radius: 6 })
      c.box("Connect", m.connect, { h: 32 })
      c.check(
        "Composer",
        "placeholder",
        await page.locator("[data-testid=agent-composer] textarea").getAttribute("placeholder"),
        "Connect a model to start",
      )
      c.check(
        "Composer",
        "opacity",
        await page
          .locator("[data-testid=agent-composer]")
          .evaluate((e) => getComputedStyle(e).opacity),
        "0.5",
      )
      c.flush()
      // Back to Design, then the floating toolbar's Ask Kimo.
      await page.getByRole("tab", { name: "Design" }).click()
      expect((await page.locator("[data-testid=agent-first-run-key]").count()) === 0, "design tab")
      await page.getByRole("button", { name: /Ask Kimo/ }).click()
      await page.locator("[data-testid=agent-first-run-key]").waitFor()
    },
  },
  {
    name: "m6 editor: ⇧P inserts a prompt, P arms the pen, N + context menu converts a note",
    async run(ctx) {
      const { page } = ctx
      await editor(ctx)
      const canvas = page.locator(".editor__canvas")
      await canvas.click({ position: { x: 900, y: 700 } })
      await page.keyboard.press("p")
      await page.waitForFunction(() => window.__kimo?.session.ui.getState().tool === "path")
      await page.keyboard.press("Escape")
      await page.keyboard.press("Escape")
      expect((await idsOfType(ctx, "prompt")).length === 0, "no prompt yet")
      await page.keyboard.press("Shift+P")
      await page.waitForFunction(
        () =>
          (window.__kimo?.session.store.nodeIds() ?? []).some(
            (id) => window.__kimo?.session.store.getNode(id)?.type === "prompt",
          ),
        undefined,
        { timeout: 5_000 },
      )
      // Leave the prompt body, then insert a note.
      await page.keyboard.press("Escape")
      await canvas.click({ position: { x: 60, y: 760 } })
      await page.keyboard.press("n")
      await page.waitForFunction(() =>
        (window.__kimo?.session.store.nodeIds() ?? []).some(
          (id) => window.__kimo?.session.store.getNode(id)?.type === "note",
        ),
      )
      // An empty note is dropped on Escape: give it a body first.
      await page.keyboard.type("Keep the CTA black")
      await page.keyboard.press("Escape")
      const [note] = await idsOfType(ctx, "note")
      expect(!!note, "note inserted")
      // Right-click the note's centre on the canvas → "Convert to prompt".
      await page.waitForFunction(
        (id) => !!window.__kimo?.canvas()?.layout()?.nodes.get(id),
        note as string,
      )
      const at = await page.evaluate((id) => {
        const c = window.__kimo?.canvas()
        const b = c?.layout().nodes.get(id)?.world
        if (!c || !b) return null
        const p = c.worldToScreen({ x: b.x + b.w / 2, y: b.y + Math.min(b.h / 2, 30) })
        const host = document.querySelector(".editor__canvas")?.getBoundingClientRect()
        return host ? { x: p.x, y: p.y, hx: host.left, hy: host.top } : null
      }, note as string)
      expect(!!at, "note on screen")
      if (!at) return
      await canvas.click({ button: "right", position: { x: at.x, y: at.y } })
      const menu = page.getByTestId("canvas-context-menu")
      await menu.waitFor({ timeout: 5_000 })
      await menu.getByRole("menuitem", { name: "Convert to prompt" }).click()
      await page.waitForFunction(
        (id) => window.__kimo?.session.store.getNode(id)?.type === "prompt",
        note as string,
      )
    },
  },
  {
    name: "m7 editor: topbar Export opens the board 07 dialog; Esc closes it",
    async run(ctx) {
      const { page } = ctx
      await editor(ctx)
      await page.getByRole("button", { name: "Export", exact: true }).click()
      const dialog = page.locator('[role="dialog"][aria-labelledby="export-title"]')
      await dialog.waitFor({ timeout: 10_000 })
      await page.keyboard.press("Escape")
      await dialog.waitFor({ state: "detached" })
    },
  },
  {
    name: "m6 editor: Home on an untitled document asks first (Cancel stays, Don't save leaves)",
    async run(ctx) {
      const { page } = ctx
      // Windows / Linux topbar: the k logo is the way Home (board 20 KcXQz).
      await editor(ctx, "#/", "windows")
      await page.getByRole("button", { name: "New file" }).first().click()
      await page.locator(".kimo-desktop-topbar").waitFor({ timeout: 15_000 })
      await page.waitForFunction(() => !!window.__kimo?.canvas()?.renderer, undefined, {
        timeout: 15_000,
      })
      await page.locator(".editor__canvas").click({ position: { x: 600, y: 400 } })
      await page.keyboard.press("n")
      await page.waitForFunction(() =>
        (window.__kimo?.session.store.nodeIds() ?? []).some(
          (id) => window.__kimo?.session.store.getNode(id)?.type === "note",
        ),
      )
      await page.keyboard.type("Draft")
      await page.keyboard.press("Escape")
      const home = page.getByRole("button", { name: "Kimo home" }).first()
      await home.click()
      const prompt = page.getByTestId("close-prompt")
      await prompt.waitFor({ timeout: 5_000 })
      await prompt.getByRole("button", { name: "Cancel" }).click()
      await prompt.waitFor({ state: "detached" })
      expect(decodeURIComponent(page.url()).includes("untitled:"), "still in the editor")
      await home.click()
      await prompt.waitFor()
      await prompt.getByRole("button", { name: "Don't save" }).click()
      await page.waitForFunction(() => location.hash === "#/" || location.hash === "")
    },
  },
]
