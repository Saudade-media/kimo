/**
 * Board 37 settings scope (audit A3, A5, D1–D18) in the real app: each control is clicked and its
 * effect asserted. The web build covers Canvas zoom and the web-only rules; the M4 app harness (a
 * macOS memory host) covers the desktop panes: the refused-write banner (CT1wv), Updates states
 * (D10), extra font folders (D16 YXF40), the MCP config write (F7 T0J64 / DwSsz), deep links
 * (D17 / D18) and "Ask first" on external changes (D2). Surfaces with a design node get one
 * measured pass (getComputedStyle + getBoundingClientRect vs the node values).
 */
import type { Page } from "playwright"
import { checker, measure, tokens } from "./board25-helpers"
import { disk, open, readFile, SITE } from "./m4-app.e2e"
import { settle, waitCanvas } from "./qa-helpers"
import { type E2EContext, expect, type Scenario } from "./run"

type App = {
  __kimoApp: {
    platform: {
      settings: { set(k: string, v: unknown): Promise<void>; get(k: string): unknown }
      updater: { download(): Promise<void> }
      mcp: {
        control: { setHosts(h: unknown[]): void; setConnections(c: unknown[]): void }
        installer: { install: (...a: unknown[]) => Promise<unknown> }
      }
    }
    control: {
      failNextSettingsWrite(m: string): void
      setDefaultApp(status: string, failMessage?: string): void
      publishUpdate(i: unknown): void
      writeExternal(ref: string, text: string): void
      calls: string[]
    }
  }
}

const zoomOf = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          __kimo: { session: { ui: { getState(): { viewport: { zoom: number; x: number } } } } }
        }
      ).__kimo.session.ui.getState().viewport,
  )

async function pick(page: Page, combobox: string, option: string) {
  await page.getByRole("combobox", { name: combobox }).click()
  await page.getByRole("option", { name: option }).click()
}

export const scenarios: Scenario[] = [
  {
    name: "board37 settings: Canvas zoom = Mouse zooms on a plain scroll (A3 D3); no On launch on the web (D1)",
    async run(ctx: E2EContext) {
      const { page } = ctx
      // A new browser file (Home's header New file; the empty state has one too).
      await page.goto(ctx.url)
      await page.getByRole("button", { name: "New file" }).first().click()
      await page.waitForURL(/#\/file\/[A-Za-z0-9]+$/)
      await waitCanvas(page)
      const host = page.locator(".canvas-host")
      const box = await host.boundingBox()
      expect(box, "canvas host")
      if (!box) return
      const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      // Trackpad (default): a plain scroll pans.
      let v0 = await zoomOf(page)
      await page.mouse.move(at.x, at.y)
      await page.mouse.wheel(0, 120)
      await settle(page)
      let v1 = await zoomOf(page)
      expect(v1.zoom === v0.zoom, `trackpad: scroll keeps the zoom (${v0.zoom} → ${v1.zoom})`)
      // Settings › General › Canvas zoom → Mouse.
      await host.focus()
      await page.keyboard.press("ControlOrMeta+,")
      await page.locator(".settings-window").waitFor()
      await page.locator('.settings-nav-item[data-pane="general"]').click()
      const labels = await page
        .locator('.settings-content[data-pane="general"] .kimo-setting-row__label')
        .allInnerTexts()
      expect(!labels.includes("On launch"), `web: no On launch row (${labels.join(", ")})`)
      await pick(page, "Canvas zoom", "Mouse")
      await page.getByText("Scroll to zoom; ⇧ + scroll pans.").waitFor({ timeout: 2000 })
      await page.keyboard.press("Escape")
      await page.locator(".settings-window").waitFor({ state: "detached" })
      v0 = await zoomOf(page)
      await page.mouse.move(at.x, at.y)
      await page.mouse.wheel(0, -120)
      await settle(page)
      v1 = await zoomOf(page)
      expect(v1.zoom > v0.zoom, `mouse: scroll up zooms in (${v0.zoom} → ${v1.zoom})`)
      // ⇧ + scroll pans.
      await page.keyboard.down("Shift")
      await page.mouse.wheel(0, 120)
      await page.keyboard.up("Shift")
      await settle(page)
      const v2 = await zoomOf(page)
      expect(v2.zoom === v1.zoom && v2.x !== v1.x, "mouse: ⇧ + scroll pans")
    },
  },
  {
    name: "board37 settings: a refused write shows CT1wv, the control keeps the stored value, Retry saves (D13)",
    async run(ctx: E2EContext) {
      const { page } = ctx
      await open(ctx, "#/settings/general")
      await page.locator('.settings-content[data-pane="general"]').waitFor()
      await page.evaluate(() =>
        (window as unknown as App).__kimoApp.control.failNextSettingsWrite(
          "~/.kimo/settings.json is read-only",
        ),
      )
      await pick(page, "Canvas zoom", "Mouse")
      const banner = page.getByTestId("settings-write-error")
      await banner.waitFor()
      expect(
        (await banner.locator(".kimo-banner__title").innerText()) === "Couldn't save Canvas zoom",
        "banner title",
      )
      expect(
        (await banner.locator(".kimo-banner__body").innerText()) ===
          "~/.kimo/settings.json is read-only.",
        "banner body",
      )
      const shown = await page.getByRole("combobox", { name: "Canvas zoom" }).innerText()
      expect(shown.includes("Trackpad"), `control re-reads the stored value (${shown})`)
      // Measured pass: Banner/Danger at index 1 under the Title Bar, radius-md, danger-soft
      // stroke, the master's padding [8, 8, 8, 16] and gap 10.
      const T = await tokens(page, ["--kimo-danger-soft"])
      const m = await measure(page, {
        title: '.settings-content[data-pane="general"] .settings-title-bar',
        banner: '[data-testid="settings-write-error"]',
      })
      const c = checker(ctx, "D13 CT1wv")
      c.box("Banner", m.banner, {
        radius: 10,
        pad: "8 8 8 16",
        gap: 10,
        shadowHas: T["--kimo-danger-soft"] as string,
      })
      c.check(
        "Banner",
        "y = Title Bar bottom",
        m.banner?.y,
        (m.title?.y ?? 0) + (m.title?.h ?? 0),
        0.5,
      )
      c.check("Banner", "w (512 = pane − 48)", m.banner?.w, m.title?.w ?? 0, 0.5)
      c.flush()
      await banner.getByRole("button", { name: "Retry" }).click()
      await banner.waitFor({ state: "detached" })
      expect(
        (await page.getByRole("combobox", { name: "Canvas zoom" }).innerText()).includes("Mouse"),
        "Retry saved Mouse",
      )
      const stored = await page.evaluate(() =>
        (window as unknown as App).__kimoApp.platform.settings.get("general.canvasZoom"),
      )
      expect(stored === "mouse", `stored ${String(stored)}`)
    },
  },
  {
    name: "board37 settings: Updates · Available → Download → Ready → Restart to update; a failed download says so (D10)",
    async run(ctx: E2EContext) {
      const { page } = ctx
      await open(ctx, "#/settings/updates")
      await page.evaluate(async () => {
        const k = (window as unknown as App).__kimoApp
        await k.platform.settings.set("updates.download", false)
        k.control.publishUpdate({
          version: "0.4.3",
          channel: "stable",
          notesUrl: "https://example.com/notes",
          publishedIso: null,
        })
      })
      const version = page.locator("[data-update-state]")
      await page.getByRole("button", { name: "Check now" }).click()
      await page.getByText("Kimo 0.4.3 is available").waitFor()
      expect((await version.getAttribute("data-update-state")) === "available", "available row")
      // Y5w77Y control: ghost "Release notes" + primary "Download", h28, padding [0, 12], sm.
      const m = await measure(page, {
        notes: "[data-update-state] .settings-button:nth-of-type(1)",
        download: "[data-update-state] .settings-button:nth-of-type(2)",
      })
      const c = checker(ctx, "D10 Y5w77Y")
      c.box("Release notes", m.notes, { h: 28, pad: "0 12 0 12", fs: 12 })
      c.box("Download", m.download, { h: 28, pad: "0 12 0 12", fs: 12 })
      c.flush()
      await page.getByRole("button", { name: "Release notes" }).click()
      // A failed download: the banner says which step failed, with Retry.
      await page.evaluate(() => {
        const k = (window as unknown as App).__kimoApp
        const real = k.platform.updater.download.bind(k.platform.updater)
        let failed = false
        k.platform.updater.download = async () => {
          if (!failed) {
            failed = true
            throw new Error("The connection was lost")
          }
          return real()
        }
      })
      await page.getByRole("button", { name: "Download", exact: true }).click()
      const err = page.getByTestId("settings-write-error")
      await err.waitFor()
      expect(
        (await err.locator(".kimo-banner__title").innerText()) === "Couldn't download the update",
        "download failure banner",
      )
      await err.getByRole("button", { name: "Retry" }).click()
      await page.getByText("Kimo 0.4.3 is ready").waitFor()
      await page.getByText("Restart Kimo to finish. Open files are saved first.").waitFor()
      await page.getByRole("button", { name: "Restart to update" }).click()
      await page.waitForFunction(() =>
        (window as unknown as App).__kimoApp.control.calls.includes("updater restart"),
      )
      const calls = await page.evaluate(() => (window as unknown as App).__kimoApp.control.calls)
      expect(
        calls.some((x) => x.includes("https://example.com/notes")),
        `release notes opened: ${calls.join(" | ")}`,
      )
    },
  },
  {
    name: "board37 settings: extra font folders list with Remove (D16 YXF40)",
    async run(ctx: E2EContext) {
      const { page } = ctx
      await open(ctx, "#/settings/fonts")
      await page.evaluate(() =>
        (window as unknown as App).__kimoApp.platform.settings.set("fonts.extraFolders", [
          "/Users/me/Design/Fonts",
          "/Users/me/Work/kimo-site/brand/fonts",
        ]),
      )
      const list = page.locator('[data-pen="YXF40"]')
      await list.waitFor()
      expect((await list.locator(".settings-folder").count()) === 2, "two folder rows")
      const T = await tokens(page, [
        "--kimo-text-secondary",
        "--kimo-text-tertiary",
        "--kimo-bg-hover",
        "--kimo-border",
        "--kimo-text-primary",
      ])
      const first = '[data-pen="YXF40"] .settings-folder:nth-child(1)'
      const m = await measure(page, {
        list: '[data-pen="YXF40"]',
        row: first,
        icon: `${first} .settings-folder__icon`,
        path: `${first} .settings-folder__path`,
        remove: `${first} .settings-folder__remove`,
      })
      const c = checker(ctx, "D16 YXF40")
      c.box("Folder List", m.list, {
        gap: 2,
        pad: "0 0 12 0",
        dir: "column",
        shadowHas: T["--kimo-border"] as string,
      })
      c.box("Folder row", m.row, { h: 28, radius: 6, gap: 8, pad: "0 4 0 8", align: "center" })
      c.box("Icon", m.icon, { w: 14, h: 14, color: T["--kimo-text-tertiary"] as string })
      c.box("Path", m.path, { fs: 11, color: T["--kimo-text-secondary"] as string })
      c.box("Remove", m.remove, { w: 24, h: 24, color: T["--kimo-text-tertiary"] as string })
      expect(m.path?.ff?.toLowerCase().includes("mono"), `path font ${m.path?.ff}`)
      c.flush()
      // Hover (ST5mr): row bg-hover, icon text-primary.
      await page.locator(first).hover()
      const h = await measure(page, { row: first, remove: `${first} .settings-folder__remove` })
      expect(h.row?.bg === T["--kimo-bg-hover"], `hover fill ${h.row?.bg}`)
      expect(h.remove?.color === T["--kimo-text-primary"], `hover icon ${h.remove?.color}`)
      await page.getByRole("button", { name: /^Remove .*\/Design\/Fonts$/ }).click()
      await page.waitForFunction(
        () => document.querySelectorAll('[data-pen="YXF40"] .settings-folder').length === 1,
      )
      const left = await page.evaluate(() =>
        (window as unknown as App).__kimoApp.platform.settings.get("fonts.extraFolders"),
      )
      expect(
        JSON.stringify(left) === '["/Users/me/Work/kimo-site/brand/fonts"]',
        `stored ${JSON.stringify(left)}`,
      )
    },
  },
  {
    name: "board37 settings: MCP config write stays open, shows DwSsz on failure, Try again writes (F7)",
    async run(ctx: E2EContext) {
      const { page } = ctx
      await open(ctx, "#/settings/agents-mcp")
      await page.evaluate(() => {
        const mcp = (window as unknown as App).__kimoApp.platform.mcp
        mcp.control.setHosts([
          {
            host: "claude-code",
            label: "Claude Code",
            icon: "terminal",
            scope: "user",
            path: "/Users/me/.claude.json",
            configExists: true,
            installed: false,
            current: false,
          },
        ])
        const real = mcp.installer.install
        let n = 0
        mcp.installer.install = async (...a: unknown[]) => {
          n++
          await new Promise((r) => setTimeout(r, 300))
          if (n === 1) throw new Error("Permission denied")
          return real(...a)
        }
      })
      // The pane re-reads hosts on Rescan or on open: reopen the pane.
      await page.locator('.settings-nav-item[data-pane="general"]').click()
      await page.locator('.settings-nav-item[data-pane="agents-mcp"]').click()
      await page
        .locator('[data-host="claude-code"]')
        .getByRole("button", { name: "Install" })
        .click()
      const dialog = page.getByTestId("agents-config-diff")
      await dialog.waitFor()
      await dialog.getByRole("button", { name: "Write config" }).click()
      await dialog.getByRole("button", { name: "Writing…" }).waitFor()
      expect(
        await dialog.getByRole("button", { name: "Writing…" }).isDisabled(),
        "disabled while writing",
      )
      const banner = page.getByTestId("agents-config-write-error")
      await banner.waitFor()
      expect(
        (await banner.locator(".kimo-banner__title").innerText()) ===
          "Couldn't write ~/.claude.json",
        "DwSsz title",
      )
      expect(
        (await banner.locator(".kimo-banner__body").innerText()) ===
          "Permission denied. Nothing was changed.",
        "DwSsz body",
      )
      const T = await tokens(page, ["--kimo-danger-soft"])
      const m = await measure(page, {
        banner: '[data-testid="agents-config-write-error"]',
        message: '[data-testid="agents-config-write-error"] .kimo-banner__message',
        footer: ".agents-config-diff__footer",
      })
      const c = checker(ctx, "F7 DwSsz")
      c.box("Banner", m.banner, {
        pad: "8 12 8 12",
        radius: 10,
        align: "flex-start",
        shadowHas: T["--kimo-danger-soft"] as string,
      })
      c.box("Message", m.message, { dir: "column", gap: 2, align: "flex-start" })
      c.check(
        "Banner",
        "above the footer (gap 14)",
        (m.footer?.y ?? 0) - ((m.banner?.y ?? 0) + (m.banner?.h ?? 0)),
        14,
        0.5,
      )
      c.flush()
      expect((await banner.locator(".kimo-banner__actions").count()) === 0, "no actions")
      await dialog.getByRole("button", { name: "Try again" }).click()
      await dialog.waitFor({ state: "detached" })
      await page.locator('[data-host="claude-code"][data-state="installed"]').waitFor()
    },
  },
  {
    name: "board37 settings: deep links open Agents & MCP on a client (D17) and AI providers on Usage (D18)",
    async run(ctx: E2EContext) {
      const { page } = ctx
      await open(ctx, "#/settings/general")
      await page.evaluate(() =>
        (window as unknown as App).__kimoApp.platform.mcp.control.setConnections([
          {
            connectionId: "c1",
            identity: {
              client: "claude-code",
              label: "Claude Code",
              version: "2.0",
              session: "s1",
              transport: "socket",
            },
            origin: "mcp:claude-code",
            cwd: "/Users/me/Work/kimo-site",
            connectedAt: Date.now(),
            lastActivityAt: Date.now(),
            state: "idle",
            docs: [],
          },
        ]),
      )
      await page.evaluate(() => {
        location.hash = "#/settings/agents-mcp/claude-code"
      })
      await page.getByTestId("agents-permissions").waitFor()
      await page.evaluate(() => {
        location.hash = "#/settings/ai-providers/usage"
      })
      const usage = page.locator("#settings-usage")
      await usage.waitFor()
      const r = await page.evaluate(() => {
        const u = document.querySelector("#settings-usage")?.getBoundingClientRect()
        const pane = document.querySelector(".settings-content")?.getBoundingClientRect()
        return u && pane ? { top: u.top - pane.top, h: pane.height } : null
      })
      expect(r && r.top >= -1 && r.top < r.h, `Usage group in view (${JSON.stringify(r)})`)
    },
  },
  {
    name: "board37 settings: When a file changes on disk = Ask first keeps the edits until Merge (D2)",
    async run(ctx: E2EContext) {
      const { page } = ctx
      await open(ctx, disk(`${SITE}/home.kimo`))
      await page.locator(".canvas-host canvas").first().waitFor({ timeout: 15_000 })
      await page.evaluate(async () => {
        await (window as unknown as App).__kimoApp.platform.settings.set(
          "files.onExternalChange",
          "ask",
        )
        const k = (window as unknown as { __kimo: { session: { apply(o: unknown): boolean } } })
          .__kimo
        k.session.apply({ op: "update", id: "Frame00001", set: { name: "Mine" } })
      })
      const ref = `${SITE}/home.kimo`
      const disk0 = (await readFile(page, ref)) as string
      const theirs = disk0.replace('"Caption"', '"Theirs"')
      await page.evaluate(
        ([r, t]) =>
          (window as unknown as App).__kimoApp.control.writeExternal(r as string, t as string),
        [ref, theirs],
      )
      const banner = page.locator(".kimo-banner", { hasText: "home.kimo changed on disk" })
      await banner.waitFor()
      await page.waitForTimeout(600)
      expect((await readFile(page, ref)) === theirs, "nothing written while asking")
      await banner.getByRole("button", { name: "Merge" }).click()
      await banner.waitFor({ state: "detached" })
      await page.waitForFunction(
        (r) => {
          const t = (
            window as unknown as { __kimoApp: { control: { readFile(r: string): string | null } } }
          ).__kimoApp.control.readFile(r)
          return !!t && t.includes('"Mine"') && t.includes('"Theirs"')
        },
        ref,
        { timeout: 10_000 },
      )
    },
  },
  {
    name: "board37 settings: Default app shows Kimo ✓ or Make default from the OS answer (D15)",
    async run(ctx: E2EContext) {
      const { page } = ctx
      await open(ctx, "#/settings/general")
      await page.locator('.settings-content[data-pane="general"]').waitFor()
      const control = (status: string, failMessage?: string) =>
        page.evaluate(
          ([s, f]) => (window as unknown as App).__kimoApp.control.setDefaultApp(s as string, f),
          [status, failMessage] as const,
        )
      const row = page.locator(".kimo-setting-row", { hasText: "Default app for .kimo and .kimoz" })
      const files = async () => {
        await page.locator('.settings-nav-item[data-pane="general"]').click()
        await page.locator('.settings-nav-item[data-pane="files"]').click()
        await page.locator('.settings-content[data-pane="files"]').waitFor()
      }
      // Another app opens .kimo: Make default; the OS refuses → the banner names it; Retry works.
      await control("other", "Launch Services refused the change")
      await files()
      const button = row.getByRole("button", { name: "Make default" })
      await button.waitFor()
      await button.click()
      const banner = page.getByTestId("settings-write-error")
      await banner.waitFor()
      const title = await banner.locator(".kimo-banner__title").innerText()
      expect(title === "Couldn't make Kimo the default app", `banner (${title})`)
      expect(await button.isVisible(), "still Make default after the refusal")
      await control("other")
      await banner.getByRole("button", { name: "Retry" }).click()
      await row.getByText("Kimo ✓").waitFor()
      const calls = await page.evaluate(() =>
        (window as unknown as App).__kimoApp.control.calls.filter((c) => c === "makeDefaultApp"),
      )
      expect(calls.length === 2, `makeDefault called twice (${calls.length})`)
      // The OS has no answer (Windows / Linux): no row.
      await control("unknown")
      await files()
      await page.locator('.settings-content[data-pane="files"] .kimo-setting-row').first().waitFor()
      await page.waitForTimeout(100)
      expect((await row.count()) === 0, "no Default app row when the OS can't tell")
    },
  },
]
