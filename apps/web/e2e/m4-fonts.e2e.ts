/**
 * Board 19 (builder 4) scenarios on the in-memory platform through the `window.__kimoM4` debug
 * hook of the m4-fonts harness (`e2e/m4-fonts-harness`, built here on its own so it runs before
 * the app integrates these pieces): Settings bound to platform.settings, Missing fonts dialog
 * (one undo step, once per session, no requests when blocked), font picker sources, Clean up
 * assets (same rules as kimo gc), SVG import (vector paths, hostile input), updater toasts
 * (never restart before flushAll), and one measured getComputedStyle / getBoundingClientRect
 * pass against the desing.pen node values.
 */
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import type { Page } from "playwright"
import { build } from "vite"
import { type E2EContext, expect, type Scenario } from "./run"

const here = dirname(fileURLToPath(import.meta.url))
const harnessDir = join(here, "m4-fonts-harness")
let built: Promise<string> | null = null

/** URL of the harness: built once into `.dist/m4-fonts` (served by the suite's preview server). */
async function harnessUrl(ctx: E2EContext): Promise<string> {
  if (process.env.KIMO_E2E_DEV === "1") return `${ctx.url}e2e/m4-fonts-harness/index.html`
  built ??= build({
    root: harnessDir,
    configFile: false,
    base: "./",
    logLevel: "error",
    plugins: [react()],
    build: { outDir: join(here, ".dist", "m4-fonts"), emptyOutDir: true, target: "es2022" },
  }).then(() => "m4-fonts/index.html")
  return `${ctx.url}${await built}`
}

type Hook = {
  platform: {
    settings: {
      get(k: string): unknown
      set(k: string, v: unknown): Promise<void>
      ready: Promise<void>
    }
    control: {
      readFile(r: string): string | null
      calls: string[]
      publishUpdate(i: unknown): void
    }
    updater: { check(): Promise<unknown>; download(): Promise<void> }
  }
  doc(): { nodes: Record<string, { style?: { font?: string } }>; assets?: Record<string, unknown> }
  remote: string[]
  picked: string[]
  svgState: { description?: string; error?: string; imported?: number }
  flushLog: string[]
  gcResult(): number
  setFlush(r: { ok: boolean; failed: string[] }): void
  updater: { start(): void }
  show(v: unknown): Promise<void>
  learnGoogle(f: string): Promise<string>
  undo(): void
}
/** Runs `fn` in the page with the `window.__kimoM4` hook (the function's source is evaluated
 * there as an expression, so it may only use its argument). */
const hook = <T>(page: Page, fn: (k: Hook) => T | Promise<T>): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.__kimoM4)`) as Promise<T>

async function open(ctx: E2EContext) {
  await ctx.page.goto(await harnessUrl(ctx))
  await ctx.page.waitForFunction(() => !!(window as unknown as { __kimoM4?: unknown }).__kimoM4)
  await hook(ctx.page, (k) => k.platform.settings.ready)
}

const shot = async (ctx: E2EContext, name: string) => {
  if (ctx.shots) await ctx.page.screenshot({ path: join(ctx.shots, `m4-fonts-${name}.png`) })
}

// --- Measured pass ------------------------------------------------------------------------------

interface Row {
  node: string
  prop: string
  design: number | string
  measured: number | string
  ok: boolean
}

async function measure(page: Page, selector: string, nth = 0) {
  return page.evaluate(
    ([sel, i]) => {
      const el = document.querySelectorAll(sel as string)[i as number] as HTMLElement | undefined
      if (!el) return null
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return {
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
        padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(parseFloat),
        gap: parseFloat(cs.columnGap || cs.gap) || 0,
        rowGap: parseFloat(cs.rowGap) || 0,
        radius: parseFloat(cs.borderTopLeftRadius),
        fontSize: parseFloat(cs.fontSize),
        fontWeight: cs.fontWeight,
        letterSpacing: cs.letterSpacing,
        display: cs.display,
        opacity: cs.opacity,
        bg: cs.backgroundColor,
        shadow: cs.boxShadow,
      }
    },
    [selector, nth] as const,
  )
}

function check(
  rows: Row[],
  node: string,
  prop: string,
  design: number | string,
  measured: unknown,
) {
  const ok =
    typeof design === "number" && typeof measured === "number"
      ? Math.abs(design - measured) <= 0.5
      : String(design) === String(measured)
  rows.push({ node, prop, design, measured: measured as number | string, ok })
}

function table(rows: Row[]): string {
  const lines = rows.map(
    (r) => `| ${r.node} | ${r.prop} | ${r.design} | ${r.measured} | ${r.ok ? "✓" : "✗"} |`,
  )
  return ["| node | prop | design | measured | |", "|---|---|---|---|---|", ...lines].join("\n")
}

// --- Scenarios ----------------------------------------------------------------------------------

export const scenarios: Scenario[] = [
  {
    name: "m4-fonts: settings dialog binds every pane to platform.settings",
    async run(ctx) {
      const { page } = ctx
      await open(ctx)
      await hook(page, (k) => k.show({ kind: "settings", pane: "files" }))
      await page.waitForSelector(".settings-window")
      expect((await page.locator(".settings-nav-item").count()) === 5, "five panes")
      expect(
        (await page.locator(".settings-title").textContent()) === "Files & autosave",
        "opens on Files & autosave",
      )
      // Select → typed value (validated by the platform).
      await page.getByRole("combobox", { name: "Autosave interval" }).click()
      await page.getByRole("option", { name: "5 seconds" }).click()
      expect(
        (await hook(page, (k) => k.platform.settings.get("files.autosaveIntervalMs"))) === 5000,
        "autosave interval written",
      )
      expect(
        (await page.locator(".kimo-setting-row__desc").first().textContent())?.startsWith(
          "Writes 5 s",
        ),
        "autosave description follows the interval",
      )
      // Fonts & privacy: No third-party fetch dims and disables Google Fonts.
      await page.locator('.settings-nav-item[data-pane="fonts"]').click()
      const ntpf = page.getByRole("switch", { name: "No third-party fetch" })
      await ntpf.click()
      expect(
        (await hook(page, (k) => k.platform.settings.get("privacy.noThirdPartyFetch"))) === true,
        "No third-party fetch on",
      )
      expect((await page.locator(".kimo-setting-row--dimmed").count()) === 1, "Google Fonts dimmed")
      expect(
        await page.getByRole("switch", { name: "Google Fonts" }).isDisabled(),
        "Google Fonts toggle disabled",
      )
      await shot(ctx, "settings-fonts")
      // A change made elsewhere (another window) shows up live.
      await hook(page, (k) => k.platform.settings.set("privacy.noThirdPartyFetch", false))
      await page.waitForFunction(
        () => !document.querySelector(".kimo-setting-row--dimmed"),
        undefined,
        { timeout: 2000 },
      )
      // ↓ moves between panes; Escape closes.
      await page.locator('.settings-nav-item[data-pane="fonts"]').focus()
      await page.keyboard.press("ArrowDown")
      expect((await page.locator(".settings-title").textContent()) === "Updates", "arrow nav")
      await page.keyboard.press("Escape")
      await page.waitForSelector(".settings-window", { state: "detached" })
    },
  },
  {
    name: "m4-fonts: missing fonts dialog — replace is one undo step, once per session, BLOCKED",
    async run(ctx) {
      const { page } = ctx
      await open(ctx)
      expect(
        (await hook(page, (k) => k.learnGoogle("Space Grotesk"))) === "google",
        "Space Grotesk learned as a Google family",
      )
      await hook(page, (k) => k.platform.settings.set("privacy.noThirdPartyFetch", true))
      const before = await hook(page, (k) => k.remote.length)
      await hook(page, (k) => k.show({ kind: "missing" }))
      const dialog = page.locator('[data-pen="hQunF"]')
      await dialog.waitFor()
      expect(
        (await dialog.locator(".kimo-dialog__title").textContent()) === "3 fonts aren't available",
        "title",
      )
      expect((await dialog.locator(".kimo-font-row").count()) === 3, "three rows")
      expect(
        await dialog
          .locator(".kimo-font-row--not-cached")
          .getByRole("button", { name: "Fetch" })
          .isDisabled(),
        "Fetch disabled while blocked",
      )
      // Change one replacement through the Replace-with menu.
      await dialog.getByRole("button", { name: "Replace Söhne with" }).click()
      const menu = page.getByRole("menu", { name: "Replace Söhne with" })
      await menu.waitFor()
      expect((await menu.getByText("Choose font file…").count()) === 1, "menu actions")
      await menu.getByRole("menuitemradio", { name: /^JetBrains Mono/ }).click()
      await shot(ctx, "missing-fonts")
      await dialog.getByRole("button", { name: "Replace 2 fonts" }).click()
      await dialog.waitFor({ state: "detached" })
      const fontsAfter = await hook(page, (k) =>
        ["txt0000001", "txt0000002", "txt0000003", "txt0000004"].map(
          (id) => k.doc().nodes[id]?.style?.font,
        ),
      )
      expect(
        JSON.stringify(fontsAfter) ===
          JSON.stringify(["JetBrains Mono", "JetBrains Mono", "JetBrains Mono", "Space Grotesk"]),
        `replaced: ${JSON.stringify(fontsAfter)}`,
      )
      await hook(page, (k) => k.undo())
      const restored = await hook(page, (k) => k.doc().nodes.txt0000003?.style?.font)
      expect(restored === "GT America Mono", "one undo restores every replacement")
      // Once per file per session.
      await hook(page, (k) => k.show({ kind: "none" }))
      await hook(page, (k) => k.show({ kind: "missing" }))
      await page.waitForTimeout(300)
      expect((await dialog.count()) === 0, "not shown twice in a session")
      expect(
        (await hook(page, (k) => k.remote.length)) === before,
        "no remote request while blocked",
      )
    },
  },
  {
    name: "m4-fonts: font picker sources, blocked note, typed Google family",
    async run(ctx) {
      const { page } = ctx
      await open(ctx)
      await hook(page, (k) => k.platform.settings.set("privacy.noThirdPartyFetch", true))
      await hook(page, (k) => k.show({ kind: "picker" }))
      const picker = page.locator('[data-pen="azBUI"]')
      await picker.waitFor()
      for (const label of ["IN THIS DOCUMENT"])
        expect((await picker.getByText(label).count()) === 1, label)
      expect(
        (await picker.locator('[data-pen="ljh5h"]').count()) === 1,
        "No third-party fetch note",
      )
      await picker.getByRole("textbox", { name: "Search fonts" }).fill("Lora")
      expect((await picker.getByText("Lora").count()) === 0, "no Google offer while blocked")
      await picker.getByRole("tab", { name: "Document" }).click()
      await picker.getByRole("textbox", { name: "Search fonts" }).fill("")
      expect((await picker.getByRole("menuitemradio").count()) === 4, "four document families")
      await picker.getByRole("menuitemradio", { name: /^Söhne/ }).click()
      expect((await hook(page, (k) => k.picked)).includes("Söhne"), "pick reported")
      expect((await hook(page, (k) => k.remote.length)) === 0, "no remote request while blocked")
      // Allowed again: the typed family is offered from Google.
      await hook(page, (k) => k.platform.settings.set("privacy.noThirdPartyFetch", false))
      await hook(page, (k) => k.show({ kind: "none" }))
      await picker.waitFor({ state: "detached" })
      await hook(page, (k) => k.show({ kind: "picker" }))
      await picker.waitFor()
      expect(
        (await picker.getByRole("tab", { name: "All" }).getAttribute("aria-selected")) === "true",
        "a fresh picker starts on All",
      )
      await picker.getByRole("textbox", { name: "Search fonts" }).fill("Lora")
      expect(
        (await picker.getByRole("menuitemradio", { name: /^Lora/ }).textContent()) ===
          "Loranot cached",
        "typed Google family offered",
      )
      await shot(ctx, "font-picker")
    },
  },
  {
    name: "m4-fonts: clean up assets removes exactly the unused files (kimo gc rules)",
    async run(ctx) {
      const { page } = ctx
      await open(ctx)
      await hook(page, (k) => k.show({ kind: "gc" }))
      const dialog = page.locator('[data-pen="Vqeu7"]')
      await dialog.waitFor()
      expect(
        (await dialog.locator(".kimo-dialog__title").textContent()) === "Remove 7 unused assets?",
        "title",
      )
      expect((await dialog.locator(".gc-row").count()) === 4, "four rows")
      expect((await dialog.locator(".gc-more").textContent())?.startsWith("+ 3 more"), "more row")
      expect(
        (await dialog.locator(".kimo-dialog__footnote").textContent()) ===
          "kimo gc ./marketing.kimo",
        "footnote",
      )
      await shot(ctx, "clean-up")
      await dialog.getByRole("button", { name: "Remove 7 files" }).click()
      await page.waitForFunction(
        () => (window as unknown as { __kimoM4: { gcResult(): number } }).__kimoM4.gcResult() === 7,
      )
      const files = await hook(page, (k) => ({
        used: k.platform.control.readFile("/Users/me/loom/assets/aaaaaaaaaaaaaaaa.png"),
        gone: k.platform.control.readFile("/Users/me/loom/assets/9f2c41ab03d1e7a2.png"),
        manifest: k.doc().assets ?? null,
      }))
      expect(files.used === "used", "referenced asset kept")
      expect(files.gone === null, "unused asset removed")
      expect(
        JSON.stringify(files.manifest) === '{"aaaaaaaaaaaaaaaa.png":{"mime":"image/png"}}',
        `manifest entry pruned: ${JSON.stringify(files.manifest)}`,
      )
    },
  },
  {
    name: "m4-fonts: SVG import — vector paths, image, hostile input",
    async run(ctx) {
      const { page } = ctx
      const dialogs: string[] = []
      page.on("dialog", (d) => {
        dialogs.push(d.message())
        void d.dismiss()
      })
      await open(ctx)
      const logo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><defs><linearGradient id="g"><stop offset="0" stop-color="#E8590C"/><stop offset="1" stop-color="#0A0A0A"/></linearGradient><filter id="f"/></defs><g><rect width="20" height="20" fill="url(#g)"/><circle cx="40" cy="10" r="8"/></g><path d="M0 60L64 60" stroke="#000" stroke-width="2"/></svg>`
      await page.evaluate((text) => {
        const k = (window as unknown as { __kimoM4: { show(v: unknown): Promise<void> } }).__kimoM4
        return k.show({ kind: "svg", text, name: "logo-mark.svg" })
      }, logo)
      const pop = page.locator('[data-pen="mevh8"]')
      await pop.waitFor()
      const desc = await pop.locator(".svg-import__desc").textContent()
      expect(
        desc ===
          "Editable paths in a frame. 3 paths · 1 group · 1 gradient. Unsupported: 1 filter (dropped).",
        `description: ${desc}`,
      )
      await shot(ctx, "svg-import")
      await pop.getByRole("button", { name: "Import" }).click()
      await pop.waitFor({ state: "detached" })
      const names = await hook(page, (k) =>
        Object.values(k.doc().nodes).map((n) => (n as { name?: string }).name),
      )
      expect(names.includes("logo-mark"), "root frame inserted")
      // Hostile SVG: rejected whole (board 20 M4Pij9: never silently stripped); no script runs,
      // nothing reaches the DOM, no popover.
      const scriptsBefore = await page.evaluate(() => document.scripts.length)
      const evil = `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><foreignObject><iframe src="javascript:alert(3)"/></foreignObject><image href="https://evil.example/x.png"/><path d="M0 0L10 10" onclick="alert(4)"/></svg>`
      await page.evaluate((text) => {
        const k = (window as unknown as { __kimoM4: { show(v: unknown): Promise<void> } }).__kimoM4
        return k.show({ kind: "svg", text, name: "evil.svg" })
      }, evil)
      await page.waitForFunction(
        () =>
          !!(window as unknown as { __kimoM4: { svgState: { error?: string } } }).__kimoM4.svgState
            .error,
      )
      const rejected = await hook(page, (k) => k.svgState.error)
      expect(
        rejected === "Couldn't import evil.svg — it contains a script",
        `rejected: ${rejected}`,
      )
      expect((await pop.count()) === 0, "no import popover for a rejected SVG")
      await page.waitForTimeout(200)
      expect(dialogs.length === 0, `no script ran: ${dialogs.join(",")}`)
      expect(
        (await page.evaluate(() => document.scripts.length)) === scriptsBefore,
        "no script element",
      )
      expect((await page.locator("iframe").count()) === 0, "no iframe")
      // DOCTYPE / entities are refused before any parsing.
      await page.evaluate(() => {
        const k = (
          window as unknown as {
            __kimoM4: { show(v: unknown): Promise<void>; svgState: { error?: string } }
          }
        ).__kimoM4
        k.svgState.error = undefined
        return k.show({
          kind: "svg",
          name: "xxe.svg",
          text: '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>',
        })
      })
      await page.waitForFunction(
        () =>
          !!(window as unknown as { __kimoM4: { svgState: { error?: string } } }).__kimoM4.svgState
            .error,
      )
      const err = await hook(page, (k) => k.svgState.error)
      expect(err?.includes("DOCTYPE"), `refused: ${err}`)
    },
  },
  {
    name: "m4-fonts: updater toast never restarts before flushAll",
    async run(ctx) {
      const { page } = ctx
      await open(ctx)
      await hook(page, async (k) => {
        k.platform.control.publishUpdate({
          version: "0.5",
          channel: "stable",
          notesUrl: null,
          publishedIso: null,
        })
        k.updater.start()
        await k.platform.updater.check()
      })
      const toast = page.locator('[data-pen="wsHiA"]')
      await toast.waitFor()
      expect((await toast.textContent())?.includes("Kimo 0.5 is ready"), "ready toast")
      await shot(ctx, "update-ready")
      await hook(page, (k) => k.setFlush({ ok: false, failed: ["/a.kimo", "/b.kimo"] }))
      await toast.getByRole("button", { name: "Restart" }).click()
      const save = page.locator('[data-pen="aF0vX"]')
      await save.waitFor()
      expect(
        (await save.textContent())?.includes("Restart after saving 2 files?"),
        "save-first toast",
      )
      expect(
        !(await hook(page, (k) => k.platform.control.calls)).includes("updater restart"),
        "no restart while a file can't save",
      )
      await hook(page, (k) => k.setFlush({ ok: true, failed: [] }))
      await save.getByRole("button", { name: "Save & restart" }).click()
      await page.waitForFunction(() =>
        (
          window as unknown as { __kimoM4: { platform: { control: { calls: string[] } } } }
        ).__kimoM4.platform.control.calls.includes("updater restart"),
      )
      expect(
        (await hook(page, (k) => k.flushLog.length)) === 2,
        "flushAll before each restart attempt",
      )
    },
  },
  {
    name: "m4-fonts: measured pass vs desing.pen (board 19 / 02d node values)",
    async run(ctx) {
      const { page } = ctx
      await open(ctx)
      const rows: Row[] = []
      const m = async (sel: string, nth = 0) => {
        const r = await measure(page, sel, nth)
        expect(r, `missing ${sel}`)
        return r as NonNullable<typeof r>
      }

      // Settings window XmeDB (dialog variant).
      await hook(page, (k) => k.show({ kind: "settings", pane: "files" }))
      await page.waitForSelector(".settings-window")
      const scrim = await m(".settings-scrim")
      check(rows, "settings scrim", "display", "flex", scrim.display)
      check(rows, "settings scrim", "height>0", "true", String(scrim.h > 0))
      const win = await m(".settings-window")
      check(rows, "XmeDB", "width", 840, win.w)
      check(rows, "XmeDB", "height", 536, win.h)
      check(rows, "XmeDB", "radius", 10, win.radius)
      const side = await m(".settings-sidebar")
      check(rows, "h7qQD Sidebar", "width", 216, side.w)
      check(
        rows,
        "h7qQD Sidebar",
        "padding l/r/b",
        "12,12,12",
        [side.padding[3], side.padding[1], side.padding[2]].join(","),
      )
      check(rows, "h7qQD Sidebar", "gap", 2, side.rowGap)
      const lights = await m(".settings-lights")
      check(rows, "L2zCG Traffic Lights", "w×h", "68×48", `${lights.w}×${lights.h}`)
      const close = await m(".settings-light--close")
      check(rows, "iZuYx Close", "x from window", 16, close.x - win.x)
      check(rows, "iZuYx Close", "y from window", 18, close.y - win.y)
      check(rows, "iZuYx Close", "size", 12, close.w)
      const nav = await m(".settings-nav-item")
      check(rows, "FN6V7 Nav", "height", 32, nav.h)
      check(rows, "FN6V7 Nav", "gap", 10, nav.gap)
      check(rows, "FN6V7 Nav", "padding-x", 10, nav.padding[3])
      check(rows, "FN6V7 Nav", "radius", 10, nav.radius)
      const active = await m(".settings-nav-item--active")
      check(rows, "GDXwe Nav (active)", "radius", 999, active.radius)
      const label = await m(".settings-nav-item--active .settings-nav-item__label")
      check(rows, "AK4pM Label", "font", "13/600", `${label.fontSize}/${label.fontWeight}`)
      const content = await m(".settings-content")
      check(rows, "EHSmX Content", "padding", "0,32,24,32", content.padding.join(","))
      const bar = await m(".settings-title-bar")
      check(rows, "ahnDS Title Bar", "height", 56, bar.h)
      check(rows, "ahnDS Title Bar", "width", 560, bar.w)
      const title = await m(".settings-title")
      check(rows, "Oh3I7 Title", "font", "16/600", `${title.fontSize}/${title.fontWeight}`)
      const row0 = await m(".settings-content .kimo-setting-row")
      check(rows, "k9RQFr SettingRow", "height", 57, row0.h)
      check(
        rows,
        "k9RQFr SettingRow",
        "padding-y",
        "12,12",
        `${row0.padding[0]},${row0.padding[2]}`,
      )
      check(rows, "k9RQFr SettingRow", "gap", 16, row0.gap)
      const lab = await m(".settings-content .kimo-setting-row__label")
      check(rows, "NcrOC Label", "font", "12/500", `${lab.fontSize}/${lab.fontWeight}`)
      const desc = await m(".settings-content .kimo-setting-row__desc")
      check(rows, "LMxOY Desc", "font-size", 11, desc.fontSize)
      check(rows, "LMxOY Desc", "height (1 line × 1.45)", 16, Math.round(desc.h))
      for (const [i, w] of [
        [0, 120],
        [1, 120],
        [2, 148],
      ] as const) {
        const sel = await m(".settings-content .settings-select", i)
        check(rows, `Select #${i + 1}`, "width", w, sel.w)
        check(rows, `Select #${i + 1}`, "height", 28, sel.h)
      }
      const toggle = await m(".settings-content .kimo-toggle")
      check(rows, "y893S Toggle", "w×h", "28×16", `${toggle.w}×${toggle.h}`)
      const btn = await m(".settings-content .settings-button")
      check(rows, "s0cL7 Button", "height", 28, btn.h)
      check(rows, "s0cL7 Button", "padding-x", 12, btn.padding[3])
      const value = await m(".settings-content .settings-value")
      check(rows, "aRsQQ Value", "font-size", 11, value.fontSize)
      await shot(ctx, "measure-settings")
      await page.keyboard.press("Escape")

      // Missing fonts dialog hQunF (Space Grotesk known from Google, then blocked → Offline row).
      await hook(page, (k) => k.learnGoogle("Space Grotesk"))
      await hook(page, (k) => k.platform.settings.set("privacy.noThirdPartyFetch", true))
      await hook(page, (k) => k.show({ kind: "missing" }))
      await page.waitForSelector('[data-pen="hQunF"]')
      const md = await m('[data-pen="hQunF"]')
      check(rows, "hQunF Dialog", "width", 640, md.w)
      check(rows, "hQunF Dialog", "padding", "20,20,20,20", md.padding.join(","))
      check(rows, "hQunF Dialog", "gap", 14, md.rowGap)
      check(rows, "hQunF Dialog", "radius", 24, md.radius)
      const fr = await m('[data-pen="hQunF"] .kimo-font-row')
      check(rows, "Rwsdn FontRow", "height", 53, fr.h)
      check(rows, "Rwsdn FontRow", "padding", "10,12,10,12", fr.padding.join(","))
      check(rows, "Rwsdn FontRow", "gap", 12, fr.gap)
      check(rows, "Rwsdn FontRow", "width", 600, fr.w)
      const spec = await m('[data-pen="hQunF"] .kimo-font-row__specimen')
      check(rows, "LvAkZ Specimen", "w×h", "32×32", `${spec.w}×${spec.h}`)
      check(rows, "LvAkZ Specimen", "radius", 10, spec.radius)
      const aa = await m('[data-pen="hQunF"] .kimo-font-row__aa')
      check(rows, "MKjlE Aa", "font", "14/600", `${aa.fontSize}/${aa.fontWeight}`)
      const fam = await m('[data-pen="hQunF"] .kimo-font-row__family')
      check(rows, "KcoKp Family", "font", "13/500", `${fam.fontSize}/${fam.fontWeight}`)
      const meta = await m('[data-pen="hQunF"] .kimo-font-row__meta')
      check(rows, "Uvvwl Weights", "font-size", 11, meta.fontSize)
      const rsel = await m('[data-pen="hQunF"] .fonts-replace-select')
      check(rows, "JoOkA Select", "width", 148, rsel.w)
      check(rows, "JoOkA Select", "height", 28, rsel.h)
      const fetch = await m('[data-pen="hQunF"] .fonts-fetch')
      check(rows, "a4hbZC Fetch", "height", 28, fetch.h)
      check(rows, "a4hbZC Fetch", "padding-x", 10, fetch.padding[3])
      const pill = await m('[data-pen="hQunF"] .kimo-font-row__status')
      check(rows, "zgfs5 Status", "padding", "2,8,2,6", pill.padding.join(","))
      const confirm = await m('[data-pen="hQunF"] .kimo-dialog__button--confirm')
      check(rows, "qqpfr Confirm", "height", 30, confirm.h)
      check(rows, "qqpfr Confirm", "padding-x", 14, confirm.padding[3])
      await shot(ctx, "measure-missing")
      await page.keyboard.press("Escape")

      // Clean up assets Vqeu7.
      await hook(page, (k) => k.show({ kind: "gc" }))
      await page.waitForSelector('[data-pen="Vqeu7"]')
      const gc = await m('[data-pen="Vqeu7"]')
      check(rows, "Vqeu7 Dialog", "width", 520, gc.w)
      const gb = await m(".gc-body")
      check(rows, "Q0AE8 Body", "padding", "4,12,4,12", gb.padding.join(","))
      check(rows, "Q0AE8 Body", "radius", 10, gb.radius)
      const gr = await m(".gc-row")
      check(rows, "tsd5P Asset row", "height", 36, gr.h)
      check(rows, "tsd5P Asset row", "gap", 10, gr.gap)
      const th = await m(".gc-row__thumb")
      check(rows, "ByAeL Thumb", "w×h", "24×24", `${th.w}×${th.h}`)
      check(rows, "ByAeL Thumb", "radius", 4, th.radius)
      const more = await m(".gc-more")
      check(rows, "SxKZ0 More", "height", 32, more.h)
      const iw = await m('[data-pen="Vqeu7"] .kimo-dialog__icon-wrap')
      check(rows, "nlNhT Icon Wrap", "w×h", "32×32", `${iw.w}×${iw.h}`)
      await page.keyboard.press("Escape")

      // Font picker azBUI.
      await hook(page, (k) => k.platform.settings.set("privacy.noThirdPartyFetch", true))
      await hook(page, (k) => k.show({ kind: "picker" }))
      await page.waitForSelector('[data-pen="azBUI"]')
      const pk = await m('[data-pen="azBUI"]')
      check(rows, "azBUI Popover/Wide", "width", 296, pk.w)
      const body = await m(".fonts-picker__body")
      check(rows, "JlUHF Body", "padding", "8,8,6,8", body.padding.join(","))
      check(rows, "JlUHF Body", "gap", 8, body.rowGap)
      const search = await m(".fonts-picker__search")
      check(rows, "KtLZF Search", "height", 28, search.h)
      check(rows, "KtLZF Search", "radius", 10, search.radius)
      const srcs = await m(".fonts-picker__sources")
      check(rows, "y8QmGh Sources", "gap", 2, srcs.gap)
      const grp = await m(".fonts-picker__group")
      check(rows, "ZzWvb Group", "padding", "8,8,4,8", grp.padding.join(","))
      const gl = await m(".fonts-picker__group-label")
      check(
        rows,
        "HPLDr Label",
        "font",
        "11/600/0.6px",
        `${gl.fontSize}/${gl.fontWeight}/${gl.letterSpacing}`,
      )
      const item = await m(".fonts-picker__item")
      check(rows, "i0oVS MenuItem/Dense", "height", 28, item.h)
      const note = await m('[data-pen="ljh5h"]')
      check(rows, "ljh5h Note", "padding", "8,10,8,10", note.padding.join(","))
      check(rows, "ljh5h Note", "gap", 8, note.gap)
      check(rows, "ljh5h Note", "radius", 10, note.radius)
      await page.keyboard.press("Escape")

      // SVG import popover mevh8.
      await page.evaluate(() => {
        const k = (window as unknown as { __kimoM4: { show(v: unknown): Promise<void> } }).__kimoM4
        return k.show({
          kind: "svg",
          name: "logo-mark.svg",
          text: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0L10 10"/></svg>',
        })
      })
      await page.waitForSelector('[data-pen="mevh8"]')
      const sp = await m('[data-pen="mevh8"]')
      check(rows, "mevh8 Popover/Wide", "width", 296, sp.w)
      const as = await m(".svg-import__as")
      check(rows, "E3zTd Import As", "padding", "2,2,2,2", as.padding.join(","))
      check(rows, "E3zTd Import As", "height", 30, as.h)
      check(rows, "E3zTd Import As", "gap", 2, as.gap)
      const opt = await m(".svg-import__as-option--active")
      check(rows, "rF2bf As Vector", "height", 26, opt.h)
      check(rows, "rF2bf As Vector", "gap", 6, opt.gap)
      const acts = await m(".svg-import__actions")
      check(rows, "VM4GH Actions", "padding-top", 4, acts.padding[0])
      check(rows, "VM4GH Actions", "gap", 6, acts.gap)
      const imp = await m(".svg-import__import")
      check(rows, "g9uGD Import", "height", 28, imp.h)
      check(rows, "g9uGD Import", "padding-x", 12, imp.padding[3])
      const cancel = await m(".svg-import__cancel")
      check(rows, "XbCVx Cancel", "padding-x", 10, cancel.padding[3])

      // Updater toast wsHiA.
      await hook(page, async (k) => {
        k.platform.control.publishUpdate({
          version: "0.5",
          channel: "stable",
          notesUrl: null,
          publishedIso: null,
        })
        k.updater.start()
        await k.platform.updater.check()
      })
      await page.waitForSelector('[data-pen="wsHiA"]')
      const t = await m('[data-pen="wsHiA"]')
      check(rows, "wsHiA Toast", "height", 36, t.h)
      check(rows, "wsHiA Toast", "padding", "10,12,10,12", t.padding.join(","))
      check(rows, "wsHiA Toast", "gap", 10, t.gap)

      ctx.log(`\n${table(rows)}`)
      const bad = rows.filter((r) => !r.ok)
      expect(bad.length === 0, `measured ≠ design:\n${table(bad)}`)
    },
  },
]
