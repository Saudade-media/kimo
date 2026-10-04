/**
 * M4 files e2e (boards 16 and 17) on the memory platform. The scenarios run against a small
 * harness page (`src/files/harness`, the real hosts over `createMemoryPlatform`) that this file
 * builds and serves itself, so they need no app route; `window.__kimoFiles` drives the outside
 * world (external edits, git, leases, failures, crashes). The last scenario is the measured
 * getComputedStyle / getBoundingClientRect pass against the desing.pen node values.
 */
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import type { Page } from "playwright"
import { build, type PreviewServer, preview } from "vite"
import { type E2EContext, expect, type Scenario } from "./run"

const here = fileURLToPath(new URL(".", import.meta.url))
const root = join(here, "..")
const FILE = "/Users/me/Projects/loom/marketing.kimo"
const ROOT = "/Users/me/Projects/loom"

let served: Promise<{ url: string; server: PreviewServer }> | null = null

/** Builds and serves the harness once per run. */
function harnessUrl(): Promise<string> {
  served ??= (async () => {
    // Outside the repo: nothing for git or biome to pick up.
    const outDir = join(tmpdir(), "kimo-e2e-m4-files")
    const shared = { root, configFile: false as const, logLevel: "error" as const, base: "./" }
    await build({
      ...shared,
      plugins: [react()],
      build: {
        outDir,
        emptyOutDir: true,
        target: "es2022",
        rollupOptions: { input: join(root, "src/files/harness/index.html") },
      },
    })
    const server = await preview({
      ...shared,
      build: { outDir },
      preview: {
        port: 49000 + Math.floor(Math.random() * 900),
        strictPort: false,
        host: "127.0.0.1",
      },
    })
    const address = server.httpServer?.address()
    const port = typeof address === "object" && address ? address.port : 0
    return { url: `http://127.0.0.1:${port}/src/files/harness/index.html`, server }
  })()
  return served.then((s) => s.url)
}

type Api = {
  open(ref: string, o?: { readOnly?: boolean }): Promise<unknown>
  edit(id: string): boolean
  rename(id: string, name: string): boolean
  home(view?: "list" | "grid"): void
  showRecovery(): void
  state(ref?: string): {
    phase: string
    saveStatus: { kind: string }
    banner: { kind: string } | null
    toasts: { kind: string }[]
  } | null
  control: {
    writeExternal(ref: string, text: string): void
    readFile(ref: string): string | null
    failNextWrite(code: string, errno?: string, ref?: string): void
    corruptNextReadBack(ref?: string): void
    setReadOnly(ref: string, ro: boolean): void
    setForeignLease(ref: string, h: { pid: number }): void
    clearForeignLease(ref: string): void
    killPid(pid: number): void
    setGit(root: string, state: unknown, change: unknown): void
    setFocused(f: boolean): void
    setFullscreen(f: boolean): void
    calls: string[]
    tick(ms: number): void
    now(): number
  }
  platform: { recovery: { write(input: unknown): Promise<unknown> } }
  parse(t: string): { nodes: Record<string, { name?: string }>; format: string }
  serialize(d: unknown): string
}
declare const window: { __kimoFiles: Api }

async function load(page: Page): Promise<void> {
  await page.goto(await harnessUrl())
  await page.waitForFunction(() => !!(window as unknown as { __kimoFiles?: unknown }).__kimoFiles)
}

const open = (page: Page, ref = FILE) =>
  page.evaluate((r) => window.__kimoFiles.open(r).then(() => {}), ref)
const pill = (page: Page) => page.locator(".kimo-save-status")
const banner = (page: Page) => page.locator(".kimo-banner")
const text = async (page: Page, sel: string) => (await page.locator(sel).first().innerText()).trim()

async function waitText(page: Page, sel: string, expected: string | RegExp, ms = 5000) {
  const end = Date.now() + ms
  let last = ""
  while (Date.now() < end) {
    last = (
      await page
        .locator(sel)
        .first()
        .innerText()
        .catch(() => "")
    ).trim()
    if (typeof expected === "string" ? last === expected : expected.test(last)) return
    await page.waitForTimeout(50)
  }
  throw new Error(`Expected ${sel} to read ${expected}, got "${last}"`)
}

async function shot(ctx: E2EContext, name: string) {
  if (ctx.shots) await ctx.page.screenshot({ path: join(ctx.shots, `m4-files-${name}.png`) })
}

export const scenarios: Scenario[] = [
  {
    name: "m4-files: desktop Home lists files, folders with branch + changes, grid view",
    async run(ctx) {
      const { page } = ctx
      await load(page)
      await page.locator(".kimo-file-row").first().waitFor()
      const headers = await page.locator(".kimo-file-row-header__label").allInnerTexts()
      expect(headers.join(",") === "NAME,LOCATION,MODIFIED,GIT", `headers ${headers}`)
      const loom = page.locator(`.kimo-files-folder[data-folder="${ROOT}"]`)
      expect((await loom.locator(".kimo-files-folder__count").innerText()) === "3", "loom · 3")
      expect(
        (await loom.locator(".kimo-files-folder__branch").innerText()) === "feat/onboarding",
        "loom branch",
      )
      const specs = page.locator('.kimo-files-folder[data-folder="/Users/me/Desktop/specs"]')
      expect(
        (await specs.locator(".kimo-files-folder__branch").count()) === 0,
        "no repo → no branch",
      )
      const row = page.locator(`.kimo-file-row[data-file="${FILE}"]`)
      expect(
        (await row.locator(".kimo-file-row__git").innerText()) === "feat/onboarding · modified",
        "git label",
      )
      expect((await row.getAttribute("data-git")) === "modified", "modified dot")
      const brand = page.locator(
        '.kimo-file-row[data-file="/Users/me/Desktop/specs/brand-kit.kimo"]',
      )
      expect(
        (await brand.locator(".kimo-file-row__git").innerText()) === "not a repo",
        "not a repo",
      )
      await shot(ctx, "home-list")
      await page.getByRole("radio", { name: "Grid view" }).click()
      await page.locator(".kimo-files-grid .kimo-file-card").first().waitFor()
      const info = await page
        .locator(`.kimo-files-grid [data-file="${ROOT}/design-system/components.kimo"]`)
        .innerText()
      expect(info.includes("loom/design-system · feat/onboarding"), `grid info: ${info}`)
      await shot(ctx, "home-grid")
      await page.getByRole("radio", { name: "List view" }).click()
      await row.click()
      await waitText(page, ".kimo-save-status__label", "Saved to disk")
    },
  },
  {
    name: "m4-files: topbar inset, breadcrumb, branch, unfocused and fullscreen",
    async run(ctx) {
      const { page } = ctx
      await load(page)
      await open(page)
      await waitText(page, ".kimo-save-status__label", "Saved to disk")
      expect((await text(page, ".kimo-desktop-breadcrumb__folder-name")) === "loom", "folder")
      expect((await text(page, ".kimo-desktop-breadcrumb__file-name")) === "marketing.kimo", "file")
      expect((await text(page, ".kimo-desktop-breadcrumb__page")) === "Home", "page")
      expect((await text(page, ".kimo-branch-chip__name")) === "feat/onboarding", "branch")
      expect((await page.locator(".kimo-traffic-lights").boundingBox())?.width === 68, "inset 68")
      await page.evaluate(() => window.__kimoFiles.control.setFocused(false))
      await page.locator(".kimo-traffic-lights--inactive").waitFor()
      const weight = await page
        .locator(".kimo-desktop-breadcrumb__file-name")
        .evaluate((e) => getComputedStyle(e).fontWeight)
      expect(weight === "500", `unfocused weight ${weight}`)
      await shot(ctx, "topbar-unfocused")
      await page.evaluate(() => {
        window.__kimoFiles.control.setFocused(true)
        window.__kimoFiles.control.setFullscreen(true)
      })
      await page.waitForFunction(
        () => document.querySelector(".kimo-traffic-lights")?.getBoundingClientRect().width === 4,
      )
      expect((await page.locator(".kimo-traffic-lights__light").count()) === 0, "lights hidden")
      const icon = await page.locator(".kimo-desktop-breadcrumb__folder-icon").boundingBox()
      expect(icon?.x === 16, `fullscreen breadcrumb edge 16, got ${icon?.x}`)
    },
  },
  {
    name: "m4-files: unsaved → autosave after 2 s idle → saved, tooltip",
    async run(ctx) {
      const { page } = ctx
      await load(page)
      await open(page)
      await page.evaluate(() => window.__kimoFiles.edit("Edit000001"))
      await waitText(page, ".kimo-save-status__label", "Unsaved changes")
      expect((await pill(page).getAttribute("data-status")) === "unsaved", "unsaved pill")
      await shot(ctx, "unsaved")
      await waitText(page, ".kimo-save-status__label", "Saved to disk", 6000)
      const disk = await page.evaluate((f) => window.__kimoFiles.control.readFile(f), FILE)
      expect(disk?.includes("Edit000001"), "written to disk")
      await pill(page).hover()
      const tip = page.getByRole("tooltip")
      await tip.waitFor()
      expect(
        /^Saved \d\d:\d\d:\d\d · ~\/Projects\/loom\/marketing\.kimo/.test(await tip.innerText()),
        "tooltip",
      )
    },
  },
  {
    name: "m4-files: launch recovery dialog (Restore / Save as / Discard, Decide later)",
    async run(ctx) {
      const { page } = ctx
      await load(page)
      await page.evaluate(async (file) => {
        const k = window.__kimoFiles
        const now = k.control.now()
        const base = k.control.readFile(file) as string
        const d = k.parse(base)
        d.nodes.Recovered1 = { ...(d.nodes.Rect000001 as object), name: "Recovered" }
        await k.platform.recovery.write({
          id: "aaaaaaaaaaaaaaaa",
          sourceRef: file,
          name: "marketing.kimo",
          reason: "snapshot",
          text: k.serialize(d),
          edits: 14,
          lastAutosaveAt: now - 60_000,
        })
        await k.platform.recovery.write({
          id: "bbbbbbbbbbbbbbbb",
          sourceRef: "/Users/me/Projects/loom/onboarding.kimo",
          name: "onboarding.kimo",
          reason: "snapshot",
          text: base,
          edits: 3,
          lastAutosaveAt: now - 120_000,
        })
        await k.platform.recovery.write({
          id: "untitled-2",
          sourceRef: null,
          name: "Untitled 2",
          reason: "untitled",
          text: base,
          edits: 1,
          layers: 22,
        })
        k.control.killPid(1000)
        k.showRecovery()
      }, FILE)
      const dialog = page.getByRole("dialog", { name: "Recover unsaved changes?" })
      await dialog.waitFor()
      expect((await page.locator(".kimo-recovery-item").count()) === 3, "three items")
      const desc = await text(page, ".kimo-dialog__desc")
      expect(desc.startsWith("Kimo quit unexpectedly while 3 files had edits"), desc)
      const marketing = page.locator('[data-recovery="aaaaaaaaaaaaaaaa"]')
      expect((await marketing.locator(".kimo-badge").innerText()) === "14 edits", "badge")
      expect(
        /^Last autosave \d\d:\d\d · quit unexpectedly \d\d:\d\d$/.test(
          await marketing.locator(".kimo-recovery-item__meta").innerText(),
        ),
        "meta",
      )
      const untitled = page.locator('[data-recovery="untitled-2"]')
      expect(
        (await untitled.locator(".kimo-recovery-item__path").innerText()) === "not on disk yet",
        "untitled path",
      )
      const untitledButtons = await untitled.locator("button").allInnerTexts()
      expect(
        untitledButtons.join(",") === "Discard,Save as…",
        `untitled actions ${untitledButtons}`,
      )
      expect((await text(page, ".kimo-dialog__footnote")) === "Kept for 30 days", "footnote")
      await shot(ctx, "recovery")
      await untitled.getByRole("button", { name: "Discard" }).click()
      await page.waitForFunction(
        () => document.querySelectorAll(".kimo-recovery-item").length === 2,
      )
      await marketing.getByRole("button", { name: "Restore" }).click()
      await waitText(page, ".kimo-save-status__label", "Unsaved changes")
      const restored = await page.evaluate(() => {
        const s = (
          window.__kimoFiles as unknown as {
            session(): { store: { hasNode(id: string): boolean } }
          }
        ).session()
        return s.store.hasNode("Recovered1")
      })
      expect(restored, "recovered content loaded")
      // The other entry is still offered; Escape = Decide later.
      await page.keyboard.press("Escape")
      await page.waitForFunction(() => !document.querySelector(".kimo-files-recovery"))
    },
  },
  {
    name: "m4-files: migration consent (Esc = read-only, Upgrade and save writes 1.0)",
    async run(ctx) {
      const { page } = ctx
      const legacy = `${ROOT}/legacy.kimo`
      await load(page)
      await open(page, legacy)
      const dialog = page.getByRole("dialog", { name: /^Upgrade legacy\.kimo to format 1\.0\?$/ })
      await dialog.waitFor()
      expect((await text(page, ".kimo-files-migration__format-from")) === '"0.1"', "from")
      expect((await text(page, ".kimo-files-migration__format-to")) === '"1.0"', "to")
      expect(
        (await text(page, ".kimo-dialog__footnote")) === "⌘S also counts as consent",
        "footnote",
      )
      await shot(ctx, "migration")
      await page.evaluate(() => window.__kimoFiles.edit("Pending001"))
      await page.getByRole("button", { name: "Upgrade and save" }).click()
      await page.waitForFunction(() => !document.querySelector(".kimo-files-migration"))
      const disk = await page.evaluate((f) => window.__kimoFiles.control.readFile(f), legacy)
      expect(disk?.includes('"format": "1.0.0"') && disk.includes("Pending001"), "upgraded on disk")
      await waitText(page, ".kimo-save-status__label", "Saved to disk")
      // A fresh window, Escape: read-only, never written.
      await load(page)
      await open(page, legacy)
      await page.locator(".kimo-files-migration").waitFor()
      await page.keyboard.press("Escape")
      await waitText(page, ".kimo-save-status__label", "Read-only")
    },
  },
  {
    name: "m4-files: newer format → read-only + info banner",
    async run(ctx) {
      const { page } = ctx
      await load(page)
      await open(page, "/Users/me/Desktop/specs/brand-kit.kimo")
      await waitText(page, ".kimo-save-status__label", "Read-only")
      expect((await banner(page).getAttribute("data-tone")) === "info", "info banner")
      expect(
        (await text(page, ".kimo-banner__title")) === "Read-only — made with a newer Kimo",
        "title",
      )
      expect((await text(page, ".kimo-banner__body")).includes('"layout/grid"'), "feature named")
      const actions = await page.locator(".kimo-banner__action").allInnerTexts()
      expect(actions.join(",") === "What's new,Update Kimo", `actions ${actions}`)
      expect((await page.locator(".kimo-banner__dismiss").count()) === 0, "no dismiss")
      await shot(ctx, "newer-format")
    },
  },
  {
    name: "m4-files: locked by another process, lease details, Retry",
    async run(ctx) {
      const { page } = ctx
      await load(page)
      await page.evaluate(
        (f) => window.__kimoFiles.control.setForeignLease(f, { pid: 48213 }),
        FILE,
      )
      await open(page)
      await waitText(page, ".kimo-save-status__label", "Locked by another app")
      expect((await banner(page).getAttribute("data-tone")) === "warning", "warning")
      expect((await text(page, ".kimo-banner__title")) === "Locked by another process", "title")
      expect(
        /^kimo mcp \(pid 48213\) has had marketing\.kimo open for writing since \d\d:\d\d\.$/.test(
          await text(page, ".kimo-banner__body"),
        ),
        "body",
      )
      await pill(page).click()
      const pop = page.getByRole("dialog", { name: "Lease on marketing.kimo" })
      await pop.waitFor()
      const keys = await pop.locator(".kimo-files-lease__key").allInnerTexts()
      expect(keys.join(",") === "Holder,PID,Since,Lock", `rows ${keys}`)
      expect(
        (await pop.locator(".kimo-files-lease__value").nth(1).innerText()) === "48213 · alive",
        "pid",
      )
      await shot(ctx, "locked")
      await page.evaluate((f) => window.__kimoFiles.control.clearForeignLease(f), FILE)
      await pop.getByRole("button", { name: "Retry" }).click()
      await waitText(page, ".kimo-save-status__label", "Saved to disk")
      expect((await banner(page).count()) === 0, "banner gone")
    },
  },
  {
    name: "m4-files: changes on disk — reloaded (Undo), merged, conflicts",
    async run(ctx) {
      const { page } = ctx
      await load(page)
      await open(page)
      await page.evaluate((f) => {
        const k = window.__kimoFiles
        const d = k.parse(k.control.readFile(f) as string)
        ;(d.nodes.Rect000001 as { name: string }).name = "From git"
        k.control.writeExternal(f, k.serialize(d))
      }, FILE)
      await waitText(
        page,
        '[data-toast="external-reloaded"] .kimo-toast__label',
        "marketing.kimo changed on disk — reloaded",
      )
      await shot(ctx, "toast-reloaded")
      await page.locator('[data-toast="external-reloaded"] .kimo-toast__action').click()
      await waitText(page, ".kimo-save-status__label", "Unsaved changes")
      // Undo restores memory only: the file keeps "From git".
      const disk = await page.evaluate((f) => window.__kimoFiles.control.readFile(f), FILE)
      expect(disk?.includes("From git"), "file not rewritten by undo")

      await load(page)
      await open(page)
      await page.evaluate((f) => {
        const k = window.__kimoFiles
        k.edit("Local00001")
        const d = k.parse(k.control.readFile(f) as string)
        d.nodes.Disk000001 = { ...(d.nodes.Rect000002 as object), name: "Disk" }
        k.control.writeExternal(f, k.serialize(d))
      }, FILE)
      await waitText(
        page,
        '[data-toast="external-merged"] .kimo-toast__label',
        /^Merged \d+ changes? from disk with your 1 edit$/,
      )
      await shot(ctx, "toast-merged")

      await load(page)
      await open(page)
      await page.evaluate((f) => {
        const k = window.__kimoFiles
        k.rename("Rect000001", "Mine")
        const d = k.parse(k.control.readFile(f) as string)
        ;(d.nodes.Rect000001 as { name: string }).name = "Theirs"
        k.control.writeExternal(f, k.serialize(d))
      }, FILE)
      await waitText(
        page,
        '[data-toast="external-conflicts"] .kimo-toast__label',
        /^Changed on disk while you were editing — \d+ conflicts?$/,
      )
      expect(
        (await text(page, '[data-toast="external-conflicts"] .kimo-toast__action')) === "Review",
        "Review",
      )
      await waitText(page, ".kimo-save-status__label", /^\d+ conflicts? · autosave paused$/)
      await shot(ctx, "toast-conflicts")
    },
  },
  {
    name: "m4-files: git rebase → autosave paused, banner choices, Keep → merge after",
    async run(ctx) {
      const { page } = ctx
      await load(page)
      await open(page)
      await page.evaluate((r) => {
        const k = window.__kimoFiles
        k.control.setGit(
          r,
          {
            branch: "feat/onboarding",
            head: "4f1c2ab",
            operation: "rebase",
            indexLocked: false,
            fileStatus: "modified",
            changedCount: 3,
          },
          { kind: "operation-started", operation: "rebase" },
        )
        for (let i = 0; i < 6; i++) k.edit(`Rebase000${i}`)
      }, ROOT)
      await waitText(page, ".kimo-save-status__label", "Autosave paused · rebase")
      expect(
        (await text(page, ".kimo-banner__title")) === "Rebase in progress — autosave paused",
        "title",
      )
      expect(
        (await text(page, ".kimo-banner__body")) === "Your 6 unsaved edits are kept in memory.",
        "body",
      )
      const actions = await page.locator(".kimo-banner__action").allInnerTexts()
      expect(
        actions.join(",") === "Discard,Stash as recovery file,Keep my edits",
        `actions ${actions}`,
      )
      await shot(ctx, "git-rebase")
      await page.getByRole("button", { name: "Keep my edits" }).click()
      await page.waitForFunction(() => !document.querySelector(".kimo-banner"))
      await page.evaluate((r) => {
        const k = window.__kimoFiles
        const f = `${r}/marketing.kimo`
        const d = k.parse(k.control.readFile(f) as string)
        d.nodes.Upstream01 = { ...(d.nodes.Rect000002 as object), name: "Upstream" }
        k.control.writeExternal(f, k.serialize(d))
        k.control.setGit(
          r,
          {
            branch: "feat/onboarding",
            head: "9a0b1cd",
            operation: null,
            indexLocked: false,
            fileStatus: "modified",
            changedCount: 3,
          },
          { kind: "operation-finished", operation: "rebase" },
        )
      }, ROOT)
      await page.locator('[data-toast="external-merged"]').waitFor()
      await waitText(page, ".kimo-save-status__label", "Saved to disk", 6000)
    },
  },
  {
    name: "m4-files: save failures — disk full, permission, read-back mismatch",
    async run(ctx) {
      const { page } = ctx
      await load(page)
      await open(page)
      await page.evaluate((f) => {
        const k = window.__kimoFiles
        k.control.failNextWrite("DISK_FULL", "ENOSPC", f)
        k.edit("Full000001")
      }, FILE)
      await waitText(page, ".kimo-save-status__label", "Save failed", 6000)
      expect((await banner(page).getAttribute("data-tone")) === "danger", "danger")
      expect((await text(page, ".kimo-banner__title")) === "Couldn't save marketing.kimo", "title")
      expect(
        (await text(page, ".kimo-banner__body")) ===
          "The disk is full (ENOSPC). Your edits are safe in a recovery file; retrying every 30 s.",
        "body",
      )
      await shot(ctx, "save-failed-disk-full")
      await page.getByRole("button", { name: "Retry" }).click()
      await waitText(page, ".kimo-save-status__label", "Saved to disk")

      await page.evaluate((f) => {
        const k = window.__kimoFiles
        k.control.setReadOnly(f, true)
        k.edit("Perm000001")
      }, FILE)
      await waitText(page, ".kimo-banner__title", "Couldn't save — permission denied", 6000)
      expect(
        (await text(page, ".kimo-banner__body")) ===
          "~/Projects/loom is read-only for your user (EACCES). Save a copy somewhere else.",
        "permission body",
      )
      const permActions = await page.locator(".kimo-banner__action").allInnerTexts()
      expect(permActions.join(",") === "Save as…", `permission actions ${permActions}`)
      await page.evaluate((f) => window.__kimoFiles.control.setReadOnly(f, false), FILE)
      await page.getByRole("button", { name: "Save as…" }).waitFor()

      await load(page)
      await open(page)
      await page.evaluate((f) => {
        const k = window.__kimoFiles
        k.control.corruptNextReadBack(f)
        k.edit("Mismatch01")
      }, FILE)
      await waitText(page, ".kimo-banner__title", "Saved, but the read-back didn't match", 6000)
      const mm = await page.locator(".kimo-banner__action").allInnerTexts()
      expect(mm.join(",") === "Show diff,Save as…", `mismatch actions ${mm}`)
      await shot(ctx, "save-failed-mismatch")
    },
  },
  {
    name: "m4-files: failed load is terminal (git markers card, no banner actions)",
    async run(ctx) {
      const { page } = ctx
      await load(page)
      await open(page, `${ROOT}/checkout.kimo`)
      await waitText(page, ".kimo-save-status__label", "Read-only · couldn't load")
      expect((await text(page, ".kimo-banner__title")) === "Couldn't open checkout.kimo", "title")
      expect(
        (await text(page, ".kimo-banner__body")) ===
          "The file is untouched. Kimo won't write to it from this window.",
        "body",
      )
      expect((await page.locator(".kimo-banner__action").count()) === 0, "no banner actions")
      expect(
        (await text(page, ".kimo-files-failed__title")) === "This file can't be parsed",
        "headline",
      )
      expect(
        (await text(page, ".kimo-files-failed__desc")).startsWith(
          "It still contains git conflict markers",
        ),
        "explanation",
      )
      expect(
        /^SyntaxError · line \d+/.test(await text(page, ".kimo-files-failed__error")),
        "error line",
      )
      expect(
        (await text(page, ".kimo-files-failed__line--error")).endsWith("<<<<<<< HEAD"),
        "marker line",
      )
      expect(
        (await text(page, ".kimo-files-failed__path")) === "~/Projects/loom/checkout.kimo",
        "path",
      )
      await shot(ctx, "failed-load")
      await page.getByRole("button", { name: "Reveal in Finder" }).click()
      await page.getByRole("button", { name: "Open as text" }).click()
      const calls = await page.evaluate(() => window.__kimoFiles.control.calls.slice())
      expect(calls.includes(`reveal ${ROOT}/checkout.kimo`), "reveal")
      expect(calls.includes(`openWithDefaultApp ${ROOT}/checkout.kimo`), "open as text")
    },
  },
  {
    name: "m4-files: measured pass (getComputedStyle / getBoundingClientRect vs desing.pen)",
    async run(ctx) {
      const { page } = ctx
      const rows: string[] = []
      let fails = 0
      const check = (
        el: string,
        prop: string,
        expected: string | number,
        actual: string | number,
      ) => {
        const ok =
          typeof expected === "number"
            ? Math.abs(Number(actual) - expected) <= 0.5
            : expected === actual
        if (!ok) fails++
        rows.push(`${ok ? "✓" : "✗"} ${el} | ${prop} | ${expected} | ${actual}`)
      }
      type M = { w: number; h: number; x: number; y: number; cs: Record<string, string> }
      const measure = (sel: string, props: string[]) =>
        page.evaluate(
          ([s, p]) => {
            const el = document.querySelector(s as string)
            if (!el) return null
            const r = el.getBoundingClientRect()
            const cs = getComputedStyle(el)
            const o: Record<string, string> = {}
            for (const k of p as string[]) o[k] = cs.getPropertyValue(k)
            return { w: r.width, h: r.height, x: r.x, y: r.y, cs: o }
          },
          [sel, props] as const,
        ) as Promise<M | null>
      const spec = async (
        sel: string,
        name: string,
        box: { w?: number; h?: number },
        css: Record<string, string>,
      ) => {
        const m = await measure(sel, Object.keys(css))
        if (!m) {
          fails++
          rows.push(`✗ ${name} | present | yes | missing`)
          return
        }
        if (box.w !== undefined) check(name, "width", box.w, m.w)
        if (box.h !== undefined) check(name, "height", box.h, m.h)
        for (const [k, v] of Object.entries(css)) check(name, k, v, m.cs[k] ?? "")
      }

      // Home (board 16 hnvDX)
      await load(page)
      await page.locator(".kimo-file-row").first().waitFor()
      await spec(
        ".kimo-file-row-header",
        "FileRow/Header ZyDkD",
        { h: 32 },
        { "column-gap": "12px", "padding-left": "12px", "padding-right": "12px" },
      )
      await spec(
        ".kimo-file-row",
        "FileRow K4gLI",
        { h: 48 },
        { "column-gap": "12px", "padding-left": "12px", "align-items": "center" },
      )
      await spec(
        ".kimo-file-row__icon-tile",
        "FileRow Icon Tile NZI3R",
        { w: 28, h: 28 },
        { "border-top-left-radius": "6px", "background-color": "rgb(242, 241, 239)" },
      )
      await spec(".kimo-file-row__name-cell", "FileRow Name Cell AqWas", { w: 200 }, {})
      await spec(".kimo-file-row__modified-cell", "FileRow Modified Cell y0yyn4", { w: 112 }, {})
      await spec(
        ".kimo-file-row__git-cell",
        "FileRow Git Cell SaDUv",
        { w: 168 },
        { "column-gap": "6px" },
      )
      await spec(".kimo-file-row__dot", "FileRow Dot HOsXm", { w: 6, h: 6 }, {})
      await spec(
        ".kimo-file-row__name",
        "FileRow Name mau7W",
        { h: 16 },
        { "font-size": "13px", "font-weight": "500" },
      )
      await spec(
        ".kimo-file-row__path",
        "FileRow Path wUUcz",
        { h: 15 },
        { "font-size": "11px", "font-family": '"JetBrains Mono", ui-monospace, monospace' },
      )
      await spec(".kimo-file-row__menu", "FileRow Menu Xm59h", { w: 28, h: 28 }, {})
      await spec(
        ".kimo-file-row-header__label",
        "FileRow/Header Label Q5iN8",
        { h: 13 },
        { "letter-spacing": "0.6px", "font-weight": "600" },
      )
      await spec(
        ".kimo-files-folders-header",
        "Folders Header fgqWk",
        {},
        {
          "padding-top": "20px",
          "padding-right": "4px",
          "padding-bottom": "6px",
          "padding-left": "10px",
          "justify-content": "space-between",
        },
      )
      await spec(".kimo-files-folders-header__add", "Add Folder vKzcY", { w: 20, h: 20 }, {})
      await spec(
        ".kimo-files-folder",
        "Folder row yjABh",
        { h: 32 },
        { "column-gap": "10px", "padding-left": "10px", "border-top-left-radius": "10px" },
      )
      await spec(".kimo-files-folder__dot", "Folder Changes Dot kVCb2", { w: 6, h: 6 }, {})
      await spec(".kimo-files-folder__changes", "Folder Changes jnqXe", {}, { "column-gap": "4px" })
      await spec(
        ".harness-sidebar .kimo-traffic-lights",
        "Sidebar Traffic Lights G17HiQ",
        { w: 68, h: 48 },
        { "padding-left": "4px" },
      )
      await spec(
        ".kimo-files-recent-header",
        "Files Header Xp6lo",
        { h: 28 },
        { "column-gap": "8px" },
      )
      await spec(
        ".kimo-files-recent-header__title",
        "Files Header Title MeKb9",
        { h: 19 },
        { "font-size": "16px", "font-weight": "600" },
      )

      // Editor topbar (02d XDqrb, board 16 f6gZ3)
      await open(page)
      await page.locator(".kimo-save-status").waitFor()
      await spec(
        ".kimo-desktop-topbar",
        "Topbar/Desktop XDqrb",
        { h: 48 },
        { "column-gap": "8px", "padding-right": "12px", "padding-left": "0px" },
      )
      await spec(
        ".kimo-desktop-topbar .kimo-traffic-lights",
        "TrafficLights L2zCG",
        { w: 68, h: 48 },
        { "column-gap": "8px", "padding-left": "16px" },
      )
      await spec(
        ".kimo-traffic-lights__light--close",
        "Close iZuYx",
        { w: 12, h: 12 },
        { "background-color": "rgb(255, 95, 87)" },
      )
      await spec(
        ".kimo-traffic-lights__light--zoom",
        "Zoom TfB54",
        { w: 12, h: 12 },
        { "background-color": "rgb(40, 200, 64)" },
      )
      const folderIcon = await measure(".kimo-desktop-breadcrumb__folder-icon", [])
      check("Breadcrumb icon NMTrP", "x (02d: 80)", 80, folderIcon?.x ?? -1)
      await spec(".kimo-desktop-breadcrumb", "Breadcrumb RuRhK", {}, { "column-gap": "6px" })
      await spec(
        ".kimo-desktop-breadcrumb__folder",
        "Folder MPFjV",
        {},
        { "column-gap": "6px", "padding-left": "4px", "padding-right": "4px" },
      )
      await spec(
        ".kimo-desktop-breadcrumb__file-name",
        "File Name ITncY",
        { h: 16 },
        { "font-size": "13px", "font-weight": "600" },
      )
      await spec(
        ".kimo-branch-chip",
        "Branch Fyxb9",
        { h: 22 },
        {
          "column-gap": "4px",
          "padding-left": "6px",
          "padding-right": "8px",
          "background-color": "rgb(242, 241, 239)",
        },
      )
      await spec(".kimo-branch-chip__icon", "Branch Icon i8vnu", { w: 12, h: 12 }, {})
      await spec(
        ".kimo-save-status",
        "SaveStatus EdNXU",
        { h: 24 },
        {
          "column-gap": "6px",
          "padding-left": "8px",
          "padding-right": "10px",
          "border-top-left-radius": "999px",
        },
      )
      await spec(
        ".kimo-save-status__icon",
        "SaveStatus Icon Hkdir",
        { w: 14, h: 14 },
        { color: "rgb(154, 157, 162)" },
      )
      await spec(
        ".kimo-save-status__label",
        "SaveStatus Label nHNeX",
        { h: 15 },
        { "font-size": "12px", "font-weight": "500" },
      )

      // Banner (02d R6VHG) on the locked state, Lease popover
      await load(page)
      await page.evaluate(
        (f) => window.__kimoFiles.control.setForeignLease(f, { pid: 48213 }),
        FILE,
      )
      await open(page)
      await page.locator(".kimo-banner").waitFor()
      await spec(
        ".kimo-banner",
        "Banner/Warning KPgcF",
        { h: 44 },
        {
          "column-gap": "10px",
          "padding-top": "8px",
          "padding-right": "8px",
          "padding-bottom": "8px",
          "padding-left": "16px",
        },
      )
      await spec(
        ".kimo-banner__icon",
        "Banner Icon AClzz",
        { w: 16, h: 16 },
        { color: "rgb(178, 106, 0)" },
      )
      await spec(".kimo-banner__message", "Banner Message uBHpk", {}, { "column-gap": "6px" })
      await spec(
        ".kimo-banner__title",
        "Banner Title HRUqU",
        { h: 15 },
        { "font-size": "12px", "font-weight": "600" },
      )
      await spec(".kimo-banner__actions", "Banner Actions jU2dJ", {}, { "column-gap": "6px" })
      await spec(
        ".kimo-banner__action",
        "Banner Action DW6X8",
        { h: 28 },
        {
          "padding-left": "12px",
          "padding-right": "12px",
          "font-size": "12px",
          color: "rgb(10, 10, 10)",
        },
      )
      await spec(
        ".kimo-save-status--locked",
        "SaveStatus/Locked Nn6l8",
        { h: 24 },
        { color: "rgb(178, 106, 0)" },
      )
      await page.locator(".kimo-save-status").click()
      await page.locator(".kimo-files-lease__row").first().waitFor()
      await spec(".kimo-popover--wide", "Popover/Wide u0aiz", { w: 296 }, {})
      await spec(
        ".kimo-files-lease__body",
        "Lease Body PybNF",
        {},
        { "row-gap": "8px", "padding-top": "12px" },
      )
      await spec(".kimo-files-lease__key", "Lease Key b5M2hd", { w: 56, h: 13 }, {})
      await spec(
        ".kimo-files-lease__value",
        "Lease Value y6XMl",
        { h: 15 },
        { "font-size": "11px" },
      )
      await spec(
        ".kimo-files-lease__actions",
        "Lease Actions QLE8c",
        {},
        { "column-gap": "6px", "padding-top": "4px", "justify-content": "flex-end" },
      )
      await spec(
        ".kimo-files-lease__reveal",
        "Lease Reveal JzBk0",
        { h: 28 },
        { "padding-left": "10px" },
      )
      await spec(
        ".kimo-files-lease__retry",
        "Lease Retry nqkDB",
        { h: 28 },
        { "padding-left": "12px" },
      )

      // Recovery dialog (Fyy0m)
      await load(page)
      await page.evaluate(async () => {
        const k = window.__kimoFiles
        await k.platform.recovery.write({
          id: "r1",
          sourceRef: "/Users/me/Projects/loom/marketing.kimo",
          name: "marketing.kimo",
          reason: "snapshot",
          text: k.control.readFile("/Users/me/Projects/loom/marketing.kimo"),
          edits: 14,
          lastAutosaveAt: 0,
        })
        k.control.killPid(1000)
        k.showRecovery()
      })
      await page.locator(".kimo-recovery-item").waitFor()
      await spec(
        ".kimo-dialog",
        "Recovery Dialog Fyy0m",
        { w: 600 },
        { "row-gap": "14px", "padding-top": "20px", "border-top-left-radius": "24px" },
      )
      await spec(
        ".kimo-dialog__icon-wrap",
        "Dialog Icon Wrap nlNhT",
        { w: 32, h: 32 },
        { "background-color": "rgb(242, 241, 239)" },
      )
      await spec(
        ".kimo-dialog__title",
        "Dialog Title j7914",
        { h: 17 },
        { "font-size": "14px", "font-weight": "600" },
      )
      await spec(".kimo-dialog__text", "Dialog Text g9Ml9", {}, { "row-gap": "4px" })
      await spec(".kimo-dialog__footer", "Dialog Footer zI9zf", {}, { "column-gap": "8px" })
      await spec(
        ".kimo-dialog__button",
        "Dialog Tertiary gDY4y",
        { h: 30 },
        { "padding-left": "12px", "font-size": "12px" },
      )
      await spec(
        ".kimo-dialog__button--confirm",
        "Dialog Confirm qqpfr",
        { h: 30 },
        { "padding-left": "14px" },
      )
      await spec(
        ".kimo-recovery-item",
        "RecoveryItem arWPH",
        {},
        { "column-gap": "12px", "padding-top": "12px", "padding-bottom": "12px" },
      )
      await spec(
        ".kimo-recovery-item__icon-tile",
        "RecoveryItem Icon Tile gx852",
        { w: 32, h: 32 },
        { "border-top-left-radius": "10px" },
      )
      await spec(".kimo-recovery-item__info", "RecoveryItem Info ydP0t", {}, { "row-gap": "2px" })
      await spec(
        ".kimo-recovery-item__title-row",
        "RecoveryItem Title Row nDHlF",
        {},
        { "column-gap": "8px" },
      )
      await spec(
        ".kimo-recovery-item__name",
        "RecoveryItem Name C38M1e",
        { h: 16 },
        { "font-weight": "600" },
      )
      await spec(".kimo-recovery-item__path", "RecoveryItem Path IVNFf", { h: 15 }, {})
      await spec(".kimo-recovery-item__meta", "RecoveryItem Meta cheUZ", { h: 13 }, {})
      await spec(
        ".kimo-recovery-item__actions",
        "RecoveryItem Actions d5Yuk",
        {},
        { "column-gap": "4px" },
      )
      await spec(
        ".kimo-recovery-item__ghost",
        "RecoveryItem Save As QGeSS",
        { h: 28 },
        { "padding-left": "10px" },
      )
      await spec(
        ".kimo-recovery-item__restore",
        "RecoveryItem Restore XLKC8",
        { h: 28 },
        { "padding-left": "12px" },
      )
      await spec(
        ".kimo-files-recovery__body",
        "Recovery Body CrBSg",
        {},
        { "box-shadow": "rgb(236, 235, 232) 0px 1px 0px 0px inset" },
      )

      // Migration (UuonK)
      await load(page)
      await open(page, `${ROOT}/legacy.kimo`)
      await page.locator(".kimo-files-migration").waitFor()
      await spec(".kimo-files-migration", "Migration Dialog UuonK", { w: 672 }, {})
      await spec(".kimo-files-migration__body", "Migration Body ciVuJ", {}, { "row-gap": "8px" })
      await spec(
        ".kimo-files-migration__impact",
        "Impact EDDii",
        {},
        {
          "row-gap": "8px",
          "padding-top": "10px",
          "padding-left": "12px",
          "border-top-left-radius": "10px",
        },
      )
      await spec(".kimo-files-migration__icon", "Impact Icon hrACP", { w: 14, h: 14 }, {})
      await spec(
        ".kimo-files-migration__format",
        "Format Line GTLQL",
        { h: 15 },
        { "column-gap": "8px", "padding-left": "4px" },
      )
      await spec(".kimo-files-migration__arrow", "Format Arrow gPZMA", { w: 12, h: 12 }, {})

      // Failed load (TrOIn)
      await load(page)
      await open(page, `${ROOT}/checkout.kimo`)
      await page.locator(".kimo-files-failed__card").waitFor()
      await spec(
        ".kimo-files-failed__card",
        "Error Card HtVIp",
        { w: 520 },
        { "row-gap": "16px", "padding-top": "24px", "border-top-left-radius": "24px" },
      )
      await spec(
        ".kimo-files-failed__icon-wrap",
        "Error Icon Wrap GXgcF",
        { w: 32, h: 32 },
        { "background-color": "rgb(253, 232, 232)" },
      )
      await spec(
        ".kimo-files-failed__detail",
        "Error Detail iOG4v",
        {},
        { "row-gap": "4px", "padding-top": "10px", "padding-left": "12px" },
      )
      await spec(
        ".kimo-files-failed__error",
        "Error aEax5",
        { h: 15 },
        { color: "rgb(221, 34, 41)" },
      )
      await spec(
        ".kimo-files-failed__reveal",
        "Reveal Ovx9X",
        { h: 30 },
        { "padding-left": "12px" },
      )
      await spec(
        ".kimo-files-failed__open-text",
        "Open as Text UA6fq",
        { h: 30 },
        { "padding-left": "14px" },
      )
      await spec(
        ".kimo-banner--danger",
        "Banner/Danger Gq3Fs (failed load)",
        {},
        { "background-color": "rgb(253, 232, 232)" },
      )

      ctx.log(`measured ${rows.length} values, ${fails} off:`)
      for (const r of rows) ctx.log(r)
      expect(fails === 0, `${fails} measured value(s) differ from desing.pen`)
    },
  },
]
