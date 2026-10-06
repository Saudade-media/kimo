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
    build: {
      outDir: join(process.env.KIMO_E2E_OUTDIR ?? join(here, ".dist"), "m4-app"),
      emptyOutDir: true,
      target: "es2022",
    },
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

/** The parts of the app platform these scenarios read or stub. */
type E2EPlatform = {
  recovery: { list(): Promise<{ id: string }[]> }
  dialogs: {
    saveFile(...a: unknown[]): Promise<string | null>
    pickFolder(...a: unknown[]): Promise<unknown>
  }
}

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
  {
    name: "m4-app: launch recovery buttons on Home each act (Discard, Save as, Decide later, Discard all, Restore all)",
    async run(ctx) {
      const { page } = ctx
      const dialog = page.getByRole("dialog", { name: "Recover unsaved changes?" })
      const rows = () => page.locator(".kimo-recovery-item").count()
      const entries = () =>
        page.evaluate(async () => {
          const a = (window as unknown as { __kimoApp: { platform: E2EPlatform } }).__kimoApp
          return (await a.platform.recovery.list()).map((e: { id: string }) => e.id)
        })
      const boot = async (seed: string) => {
        await page.goto("about:blank") // a hash-only change would not reload the memory platform
        await open(ctx, `?recovery=${seed}#/`)
        await dialog.waitFor({ timeout: 10_000 })
      }
      // The dialog must sit above every drag region and take the click itself.
      const topmost = (sel: string) =>
        page.evaluate((q) => {
          const el = document.querySelector(q) as HTMLElement
          const r = el.getBoundingClientRect()
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
          return el.contains(hit)
        }, sel)

      // Discard (row) removes the entry and closes the dialog.
      await boot("untitled")
      expect(await topmost(".kimo-recovery-item button"), "row button is hit-testable")
      await page.getByRole("button", { name: "Discard", exact: true }).first().click()
      await page.waitForFunction(() => !document.querySelector(".kimo-files-recovery"))
      expect((await entries()).length === 0, "discarded")

      // Save as… with a chosen path writes the file, drops the entry and opens it.
      await boot("untitled")
      await page.evaluate(() => {
        const a = (window as unknown as { __kimoApp: { platform: E2EPlatform } }).__kimoApp
        a.platform.dialogs.saveFile = async () => "/Users/me/Work/kimo-site/design/saved.kimo"
      })
      await page.getByRole("button", { name: "Save as…" }).click()
      await page.locator(".kimo-desktop-topbar").waitFor({ timeout: 15_000 })
      expect((await readFile(page, `${SITE}/saved.kimo`)) !== null, "file written")
      expect((await entries()).length === 0, "entry dropped after Save as")

      // Save as… that fails says why and keeps the dialog.
      await boot("untitled")
      await page.evaluate(() => {
        const a = (window as unknown as { __kimoApp: { platform: E2EPlatform } }).__kimoApp
        a.platform.dialogs.saveFile = async () => {
          throw new Error("The save panel could not open")
        }
      })
      await page.getByRole("button", { name: "Save as…" }).click()
      await page.locator('[data-toast="recovery-error"]').waitFor({ timeout: 5000 })
      expect((await rows()) === 1, "entry stays after a failed Save as")

      // Decide later closes and leaves the entry.
      await boot("untitled")
      await page.getByRole("button", { name: "Decide later" }).click()
      await page.waitForFunction(() => !document.querySelector(".kimo-files-recovery"))
      expect((await entries()).length === 1, "kept after Decide later")

      // Discard all clears everything.
      await boot("mixed")
      expect((await rows()) === 2, "two rows")
      await page.getByRole("button", { name: "Discard all" }).click()
      await page.waitForFunction(() => !document.querySelector(".kimo-files-recovery"))
      expect((await entries()).length === 0, "all discarded")

      // Restore all reopens the never-saved document (and the file entry) in the editor.
      await boot("mixed")
      await page.getByRole("button", { name: "Restore all" }).click()
      await page.locator(".kimo-desktop-topbar").waitFor({ timeout: 15_000 })
      await page.waitForFunction(() => !document.querySelector(".kimo-files-recovery"))
      const open_ = await page.evaluate(() =>
        (
          window as unknown as {
            __kimoApp: { manager: { sessions(): { ref: string; untitled: boolean }[] } }
          }
        ).__kimoApp.manager
          .sessions()
          .map((s) => (s.untitled ? "untitled" : s.ref)),
      )
      expect(
        open_.includes("untitled") && open_.some((r) => r.endsWith("home.kimo")),
        `restored sessions: ${open_}`,
      )

      // C3: Restore all with three entries shows the first and lists the other two, each with
      // Open; Open routes to that document and its toast leaves.
      await boot("mixed3")
      await page.getByRole("button", { name: "Restore all" }).click()
      await page.locator(".kimo-desktop-topbar").waitFor({ timeout: 15_000 })
      const restored = page.locator('[data-toast="restored"]')
      await page.waitForFunction(
        () => document.querySelectorAll('[data-toast="restored"]').length === 2,
        undefined,
        { timeout: 10_000 },
      )
      const shownFirst = await page.evaluate(() => location.hash)
      const target = (await restored.first().getAttribute("data-ref")) ?? ""
      expect(!shownFirst.endsWith(encodeURIComponent(target)), "a toast never lists the shown one")
      await restored.first().getByRole("button", { name: "Open" }).click()
      await page.waitForFunction((t) => decodeURIComponent(location.hash).endsWith(t), target, {
        timeout: 10_000,
      })
      await page.waitForFunction(
        () => document.querySelectorAll('[data-toast="restored"]').length === 1,
      )
      const reached = await page.evaluate(
        (t) =>
          (
            window as unknown as {
              __kimoApp: { manager: { get(r: string): { untitled: boolean } | undefined } }
            }
          ).__kimoApp.manager.get(t)?.untitled ?? null,
        target,
      )
      expect(reached === true, `restored untitled reachable: ${reached}`)
    },
  },
  {
    name: "m4-app: Home sidebar rows act (Design systems navigates, + opens the folder picker and reports failures)",
    async run(ctx) {
      const { page } = ctx
      await open(ctx, "#/")
      await page.locator(".kimo-files-folders-header").waitFor({ timeout: 10_000 })
      const hit = (sel: string) =>
        page.evaluate((q) => {
          const el = document.querySelector(q) as HTMLElement
          const r = el.getBoundingClientRect()
          return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
        }, sel)
      for (const sel of [
        ".home-nav--active",
        'a.home-nav[href="#/libraries"]',
        ".kimo-files-folders-header__add",
        ".home-nav--button",
      ])
        expect(await hit(sel), `${sel} is hit-testable (no overlay or drag region on top)`)
      await page.locator(".home-nav--active").click()
      expect((await page.evaluate(() => location.hash)) === "#/", "Recents stays")
      // "+" calls the folder picker; a failure surfaces on Home instead of vanishing.
      await page.locator(".kimo-files-folders-header__add").click()
      const picked = await page.evaluate(() =>
        (
          window as unknown as { __kimoApp: { control: { calls: string[] } } }
        ).__kimoApp.control.calls.includes("dialog pickFolder"),
      )
      expect(picked, "pickFolder called")
      await page.evaluate(() => {
        const a = (window as unknown as { __kimoApp: { platform: E2EPlatform } }).__kimoApp
        a.platform.dialogs.pickFolder = async () => {
          throw new Error("The folder picker could not open")
        }
      })
      await page.locator(".kimo-files-folders-header__add").click()
      await page
        .locator('[data-toast="error"]', { hasText: "folder picker could not open" })
        .waitFor()
      await page.locator('a.home-nav[href="#/libraries"]').click()
      await page.waitForFunction(() => location.hash === "#/libraries")
    },
  },
]
