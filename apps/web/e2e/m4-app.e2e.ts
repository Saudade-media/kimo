/**
 * M4 integration (ADR 0012): the real `App` over a macOS memory platform (`e2e/m4-app-harness`).
 * Covers the shell wiring rather than the hosts themselves (those have their own suites):
 * - a `.kimo` on disk opens through the session manager into the editor with board 16's desktop
 *   topbar (traffic lights, breadcrumb, branch chip, SaveStatus pill) and ⌘S writes the file;
 * - a file with stored conflicts shows the merge banner, auto-opens "Conflicts N", decorates the
 *   layer rows and the canvas, and ⌘' steps through the conflicts;
 * - the desktop Home lists recent files on disk and the watched folders.
 */
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import type { Page } from "playwright"
import { build } from "vite"
import { type E2EContext, expect, type Scenario } from "./run"

const here = fileURLToPath(new URL(".", import.meta.url))
const harnessDir = join(here, "m4-app-harness")
let built: Promise<string> | null = null

export async function harnessUrl(ctx: E2EContext): Promise<string> {
  if (process.env.KIMO_E2E_DEV === "1") return `${ctx.url}e2e/m4-app-harness/index.html`
  built ??= build({
    root: harnessDir,
    configFile: false,
    base: "./",
    logLevel: "error",
    plugins: [react()],
    build: { outDir: join(here, ".dist", "m4-app"), emptyOutDir: true, target: "es2022" },
  }).then(() => "m4-app/index.html")
  return `${ctx.url}${await built}`
}

export const SITE = "/Users/me/Work/kimo-site/design"
export const LOOM = "/Users/me/Projects/loom"
export const disk = (ref: string) => `#/disk/${encodeURIComponent(ref)}`

export async function open(ctx: E2EContext, hash: string): Promise<void> {
  await ctx.page.setViewportSize({ width: 1440, height: 900 })
  await ctx.page.goto(`${await harnessUrl(ctx)}${hash}`)
  await ctx.page.waitForFunction(() => !!(window as unknown as { __kimoApp?: unknown }).__kimoApp)
}

export const readFile = (page: Page, ref: string) =>
  page.evaluate(
    (r) =>
      (
        window as unknown as { __kimoApp: { control: { readFile(r: string): string | null } } }
      ).__kimoApp.control.readFile(r),
    ref,
  )

export const scenarios: Scenario[] = [
  {
    name: "m4-app: a file on disk opens in the desktop editor; ⌘S saves to disk",
    async run(ctx) {
      const { page } = ctx
      await open(ctx, disk(`${SITE}/home.kimo`))
      const topbar = page.locator(".kimo-desktop-topbar")
      await topbar.waitFor({ timeout: 15_000 })
      expect((await page.locator(".topbar").count()) === 0, "board 03 topbar is not shown")
      await page.locator(".canvas-host canvas").first().waitFor({ timeout: 15_000 })
      const crumb = (await page.locator(".kimo-desktop-breadcrumb").innerText()).replace(
        /\s+/g,
        " ",
      )
      expect(crumb.includes("design") && crumb.includes("home.kimo"), `breadcrumb: ${crumb}`)
      expect(await page.locator(".kimo-branch-chip").isVisible(), "branch chip in a repo")
      const status = page.locator(".kimo-save-status")
      expect((await status.getAttribute("data-status")) === "saved", "Saved to disk on open")
      expect((await page.locator(".kimo-traffic-lights").count()) > 0, "traffic-light inset")

      // An edit, then ⌘S writes the file (atomic write through platform.files).
      const before = await readFile(page, `${SITE}/home.kimo`)
      await page.evaluate(() => {
        const k = (window as unknown as { __kimo: { session: { apply(o: unknown): boolean } } })
          .__kimo
        k.session.apply({ op: "update", id: "Frame00001", set: { name: "Renamed" } })
      })
      await page.waitForFunction(
        () => document.querySelector(".kimo-save-status")?.getAttribute("data-status") !== "saved",
      )
      await page.locator(".canvas-host").click({ position: { x: 20, y: 20 } })
      await page.keyboard.press("Meta+s")
      await page.waitForFunction(
        () => document.querySelector(".kimo-save-status")?.getAttribute("data-status") === "saved",
        undefined,
        { timeout: 10_000 },
      )
      const after = await readFile(page, `${SITE}/home.kimo`)
      expect(after !== before && !!after?.includes('"Renamed"'), "the file on disk was written")
    },
  },
  {
    name: "m4-app: stored conflicts → banner, Conflicts tab, layer + canvas markers, ⌘'",
    async run(ctx) {
      const { page } = ctx
      await open(ctx, disk(`${LOOM}/marketing.kimo`))
      await page.locator(".kimo-desktop-topbar").waitFor({ timeout: 15_000 })
      const banner = page.locator(".kimo-banner")
      await banner.waitFor({ timeout: 10_000 })
      const bannerText = await banner.innerText()
      expect(/conflict/i.test(bannerText), `merge banner: ${bannerText}`)
      const tab = page.getByRole("tab", { name: /^Conflicts \d+$/ })
      await tab.waitFor({ timeout: 10_000 })
      expect((await tab.getAttribute("aria-selected")) === "true", "Conflicts tab auto-opened")
      expect(
        (await page.locator(".kimo-layer-row--conflict").count()) > 0,
        "LayerRow/Conflict rows",
      )
      await page.locator(".kimo-canvas-conflict-marker").first().waitFor({ timeout: 15_000 })
      const status = await page.locator(".kimo-save-status").getAttribute("data-status")
      expect(status === "paused", `autosave paused while conflicts are open (${status})`)
      // ⌘' selects the next conflicting node.
      await page.locator(".canvas-host").click({ position: { x: 5, y: 5 } })
      await page.keyboard.press("Meta+'")
      await page.waitForFunction(() => {
        const k = (
          window as unknown as {
            __kimo?: { session: { ui: { getState(): { selection: string[] } } } }
          }
        ).__kimo
        return (k?.session.ui.getState().selection.length ?? 0) > 0
      })
    },
  },
  {
    name: "m4-app: desktop Home lists files on disk and watched folders",
    async run(ctx) {
      const { page } = ctx
      // Open (and leave) a file so it is a recent file.
      await open(ctx, disk(`${SITE}/home.kimo`))
      await page.locator(".kimo-desktop-topbar").waitFor({ timeout: 15_000 })
      await page.evaluate(() => {
        location.hash = "#/"
      })
      await page.locator(".kimo-files-folders-header").waitFor({ timeout: 10_000 })
      expect((await page.locator(".kimo-files-folder").count()) === 2, "two watched folders")
      await page.locator(".kimo-files-recent-header").waitFor()
      await page.locator('[data-file$="home.kimo"]').waitFor({ timeout: 10_000 })
      await page.locator('[data-file$="home.kimo"]').click()
      await page.locator(".kimo-desktop-topbar").waitFor({ timeout: 15_000 })
    },
  },
]
