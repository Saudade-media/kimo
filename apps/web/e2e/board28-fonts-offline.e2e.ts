/**
 * Board 28 "Fonts & offline" (FZRZN): the offline font pack row in Settings › Fonts & privacy
 * (xW7Mh; states rCcF5 downloading, TEciq downloaded, UN6YR blocked), the Missing fonts dialog's
 * blocked banner (X1mr3 › zzcpD) on the board 19 harness (memory platform), and "store on first
 * use" in the real web editor (Google routed to local bytes: no real network; the manifest entry
 * appears only in what a save writes, never in the live document). Each surface gets
 * one measured getComputedStyle / getBoundingClientRect pass against the node values.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import type { Page } from "playwright"
import { build } from "vite"
import { checker, measure, tokens } from "./board25-helpers"
import { openEditor, settle } from "./qa-helpers"
import { type E2EContext, expect, type Scenario } from "./run"

const here = dirname(fileURLToPath(import.meta.url))
let built: Promise<string> | null = null

/** The board 19 fonts harness, built into its own folder (m4-fonts.e2e builds another copy). */
async function harnessUrl(ctx: E2EContext): Promise<string> {
  if (process.env.KIMO_E2E_DEV === "1") return `${ctx.url}e2e/m4-fonts-harness/index.html`
  built ??= build({
    root: join(here, "m4-fonts-harness"),
    configFile: false,
    base: "./",
    logLevel: "error",
    plugins: [react()],
    build: {
      outDir: join(process.env.KIMO_E2E_OUTDIR ?? join(here, ".dist"), "board28-fonts"),
      emptyOutDir: true,
      target: "es2022",
    },
  }).then(() => "board28-fonts/index.html")
  return `${ctx.url}${await built}`
}

type Hook = {
  platform: { settings: { set(k: string, v: unknown): Promise<void>; ready: Promise<void> } }
  show(v: unknown): Promise<void>
  servePack(hold: boolean): void
  releasePack(): void
}
const hook = <T>(page: Page, fn: (k: Hook) => T | Promise<T>): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.__kimoM4)`) as Promise<T>

async function open(ctx: E2EContext) {
  await ctx.page.goto(await harnessUrl(ctx))
  await ctx.page.waitForFunction(() => !!(window as unknown as { __kimoM4?: unknown }).__kimoM4)
  await hook(ctx.page, (k) => k.platform.settings.ready)
}

const ROW = '[data-setting="font-pack"]'
const TOKENS = [
  "--kimo-text-primary",
  "--kimo-text-secondary",
  "--kimo-accent",
  "--kimo-bg-muted",
  "--kimo-warning-soft",
  "--kimo-warning",
]

export const scenarios: Scenario[] = [
  {
    name: "board28 settings: Offline font pack row — not downloaded / downloading / downloaded / blocked",
    async run(ctx: E2EContext) {
      const { page } = ctx
      await open(ctx)
      await hook(page, (k) => k.show({ kind: "settings", pane: "fonts" }))
      await page.locator(ROW).waitFor()
      const T = await tokens(page, TOKENS)
      // Row order: the pack sits right under Google Fonts (JGcJw).
      const labels = await page
        .locator('.settings-content[data-pane="fonts"] .kimo-setting-row__label')
        .allTextContents()
      expect(
        labels.slice(0, 4).join("|") ===
          "No third-party fetch|Google Fonts|Offline font pack|Font cache",
        `pane order (${labels.join("|")})`,
      )
      // (1) Not downloaded (xW7Mh): Value + Button/Secondary "Download".
      let m = await measure(page, {
        row: ROW,
        text: `${ROW} .kimo-setting-row__text`,
        label: `${ROW} .kimo-setting-row__label`,
        desc: `${ROW} .kimo-setting-row__desc`,
        control: `${ROW} .kimo-setting-row__control`,
        value: `${ROW} .settings-value`,
        button: `${ROW} .settings-button`,
      })
      const c = checker(ctx, "Offline font pack · not downloaded (xW7Mh)")
      c.box("SettingRow MuoTX", m.row, { pad: "12 0 12 0", gap: 16, align: "center" })
      c.box("Text PRXt4", m.text, { gap: 2, dir: "column" })
      c.box("Label NcrOC", m.label, { fs: 12, fw: "500", color: T["--kimo-text-primary"] })
      c.box("Desc LMxOY", m.desc, { fs: 11, fw: "400", color: T["--kimo-text-secondary"] })
      c.box("Control J4s83", m.control, { gap: 8, justify: "flex-end", align: "center" })
      c.box("Value", m.value, {
        fs: 11,
        ff: "JetBrains Mono",
        color: T["--kimo-text-secondary"],
      })
      c.box("Button/Secondary kv3Fk", m.button, { h: 28, pad: "0 12 0 12", fs: 12 })
      c.flush()
      expect(
        (await page.locator(`${ROW} .settings-button`).textContent()) === "Download",
        "Download",
      )
      // (2) Downloading (rCcF5): Progress 160 (track 4 + label) + Button/Ghost "Cancel".
      await hook(page, (k) => k.servePack(true))
      await page.locator(`${ROW} .settings-button`).click()
      await page.locator(`${ROW} .settings-pack-progress`).waitFor()
      await page.waitForFunction(
        (sel) =>
          /Downloading \d+ of \d+ faces/.test(document.querySelector(sel)?.textContent ?? ""),
        `${ROW} .kimo-setting-row__desc`,
      )
      m = await measure(page, {
        progress: `${ROW} .settings-pack-progress`,
        track: `${ROW} .kimo-progress__track`,
        fill: `${ROW} .kimo-progress__fill`,
        plabel: `${ROW} .kimo-progress__label`,
        cancel: `${ROW} .settings-button`,
      })
      const d = checker(ctx, "Offline font pack · downloading (rCcF5)")
      d.box("Progress", m.progress, { w: 160, gap: 6, dir: "column" })
      d.box("Track", m.track, { w: 160, h: 4, radius: 999, bg: T["--kimo-bg-muted"] })
      d.box("Label", m.plabel, { fs: 11, color: T["--kimo-text-secondary"] })
      d.box("Button/Ghost sqJv4 · Cancel", m.cancel, { h: 28, pad: "0 12 0 12", fs: 12 })
      d.check("Fill", "bg", m.fill?.bg, T["--kimo-accent"] as string)
      d.check("Fill", "h", m.fill?.h, 4)
      d.flush()
      const desc = await page.locator(`${ROW} .kimo-setting-row__desc`).textContent()
      ctx.log("downloading:", desc)
      // (3) Downloaded (TEciq): size + Button/Ghost "Remove".
      await hook(page, (k) => k.releasePack())
      await page.locator(`${ROW} .settings-button`, { hasText: "Remove" }).waitFor()
      m = await measure(page, {
        value: `${ROW} .settings-value`,
        remove: `${ROW} .settings-button`,
        desc: `${ROW} .kimo-setting-row__desc`,
      })
      const r = checker(ctx, "Offline font pack · downloaded (TEciq)")
      r.box("Value", m.value, { fs: 11, ff: "JetBrains Mono" })
      r.box("Button/Ghost sqJv4 · Remove", m.remove, { h: 28, pad: "0 12 0 12", fs: 12 })
      r.flush()
      const ready = (await page.locator(`${ROW} .kimo-setting-row__desc`).textContent()) ?? ""
      ctx.log("downloaded:", ready)
      expect(/^16 families · 16 faces · /.test(ready), `ready copy (${ready})`)
      // (4) Remove → not downloaded; No third-party fetch on → blocked (UN6YR): 45 %, disabled.
      await page.locator(`${ROW} .settings-button`).click()
      await page.locator(`${ROW} .settings-button`, { hasText: "Download" }).waitFor()
      await hook(page, (k) => k.platform.settings.set("privacy.noThirdPartyFetch", true))
      await page.locator(`${ROW}.kimo-setting-row--dimmed`).waitFor()
      m = await measure(page, { row: ROW })
      const b = checker(ctx, "Offline font pack · blocked (UN6YR)")
      b.box("SettingRow MuoTX", m.row, { opacity: "0.45" })
      b.flush()
      expect(await page.locator(`${ROW} .settings-button`).isDisabled(), "Download disabled")
      expect(
        (await page.locator(`${ROW} .kimo-setting-row__desc`).textContent()) ===
          "Off while No third-party fetch is on. A pack already downloaded keeps working.",
        "blocked copy",
      )
      if (ctx.shots) await page.screenshot({ path: join(ctx.shots, "board28-settings.png") })
    },
  },
  {
    name: "board28 missing fonts: Banner/Warning when No third-party fetch blocks Google (zzcpD)",
    async run(ctx: E2EContext) {
      const { page } = ctx
      await open(ctx)
      await hook(page, (k) => k.platform.settings.set("privacy.noThirdPartyFetch", true))
      await hook(page, (k) => k.show({ kind: "missing" }))
      await page.locator(".fonts-missing__banner").waitFor()
      const T = await tokens(page, TOKENS)
      const m = await measure(page, {
        banner: ".fonts-missing__banner",
        icon: ".fonts-missing__banner .kimo-banner__icon",
        message: ".fonts-missing__banner .kimo-banner__message",
        title: ".fonts-missing__banner .kimo-banner__title",
        body: ".fonts-missing__banner .kimo-banner__body",
        actions: ".fonts-missing__banner .kimo-banner__actions",
        action: ".fonts-missing__banner .kimo-banner__actions .kimo-button",
        bodyFrame: ".fonts-missing__body",
        firstRow: ".fonts-missing__body > .kimo-font-row",
      })
      const c = checker(ctx, "Missing fonts · blocked banner (zzcpD)")
      c.box("Banner/Warning KPgcF", m.banner, {
        pad: "8 8 8 16",
        gap: 10,
        align: "center",
        bg: T["--kimo-warning-soft"],
      })
      c.box("Icon AClzz", m.icon, { w: 16, h: 16, color: T["--kimo-warning"] })
      c.box("Message uBHpk", m.message, { gap: 6, align: "center" })
      c.box("Title HRUqU", m.title, { fs: 12, fw: "600", color: T["--kimo-text-primary"] })
      c.box("Body x6Z0vQ", m.body, { fs: 12, fw: "400", color: T["--kimo-text-secondary"] })
      c.box("Actions jU2dJ", m.actions, { gap: 6 })
      c.box("Secondary Action DW6X8 · Open settings", m.action, { h: 28, pad: "0 12 0 12" })
      // The banner is the Body's first child, full width, rows follow it.
      c.check("Banner", "w = Body w", m.banner?.w, m.bodyFrame?.w ?? -1)
      c.check("Banner", "x = Body x", m.banner?.x, m.bodyFrame?.x ?? -1)
      c.check(
        "First row",
        "y = banner bottom",
        m.firstRow?.y,
        (m.banner?.y ?? 0) + (m.banner?.h ?? 0),
      )
      c.flush()
      expect(
        (await page.locator(".fonts-missing__banner .kimo-banner__title").textContent()) ===
          "Google Fonts are blocked",
        "title copy",
      )
      // Open settings → Settings › Fonts & privacy.
      await page.locator(".fonts-missing__banner .kimo-banner__actions .kimo-button").click()
      await page.locator('.settings-content[data-pane="fonts"]').waitFor()
      if (ctx.shots) await page.screenshot({ path: join(ctx.shots, "board28-missing.png") })
    },
  },
  {
    name: "board28 store on first use: a fetched Google face lands in assets/, listed only when written",
    async run(ctx: E2EContext) {
      const { page } = ctx
      // A real TTF whose name table says "lucide" (Inter is bundled, so never fetched).
      const ttf = readFileSync(
        join(here, "../../../packages/renderer/node_modules/lucide-static/font/lucide.ttf"),
      )
      const requests: string[] = []
      await page.route("https://fonts.googleapis.com/**", (route) => {
        requests.push(route.request().url())
        const fam = decodeURIComponent(/family=([^:&]+)/.exec(route.request().url())?.[1] ?? "")
        if (fam !== "lucide") return route.fulfill({ status: 400, body: "" })
        return route.fulfill({
          status: 200,
          contentType: "text/css",
          body: "@font-face { font-family: 'lucide'; font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/s/lucide/v1/lucide-400.ttf) format('truetype'); }",
        })
      })
      await page.route("https://fonts.gstatic.com/**", (route) => {
        requests.push(route.request().url())
        return route.fulfill({ status: 200, contentType: "font/ttf", body: ttf })
      })
      await openEditor(page, ctx.url)
      const ok = await page.evaluate(() => {
        const k = (window as unknown as { __kimo: { session: { apply(o: unknown[]): boolean } } })
          .__kimo
        return k.session.apply([
          {
            op: "insert",
            id: "loraText01",
            parent: null,
            node: {
              type: "text",
              name: "Lora",
              x: 0,
              y: 0,
              content: "Stored on first use",
              style: { font: "lucide", size: 32 },
            },
          },
        ])
      })
      expect(ok, "text inserted")
      // The face lands in the file's asset store (it resolves as a document font) …
      await page.waitForFunction(
        () => {
          const k = (
            window as unknown as {
              __kimo: {
                fonts: { availability(f: unknown): Promise<string> }
                __font?: string
              }
            }
          ).__kimo
          void k.fonts
            .availability({ family: "lucide", weight: 400, style: "normal" })
            .then((a) => {
              k.__font = a
            })
          return k.__font === "document"
        },
        undefined,
        { timeout: 15_000, polling: 200 },
      )
      const state = await page.evaluate(() => {
        type Assets = Record<string, { mime: string; name?: string }>
        const k = (
          window as unknown as {
            __kimo: {
              session: {
                store: {
                  toHeader(): { assets?: Assets }
                  toDocument(): object
                  undo(o: string): unknown
                  hasNode(id: string): boolean
                  canUndo(o: string): boolean
                }
              }
              prepareWrite(d: object): { assets?: Assets }
            }
          }
        ).__kimo
        const live = k.session.store.toHeader().assets ?? null
        const written = k.prepareWrite(k.session.store.toDocument()).assets ?? {}
        k.session.store.undo("user")
        return {
          live,
          written: Object.entries(written),
          textGone: !k.session.store.hasNode("loraText01"),
          moreUndo: k.session.store.canUndo("user"),
        }
      })
      ctx.log("written manifest", JSON.stringify(state.written))
      // … never in the live document; a save lists it in the manifest.
      expect(state.live === null, `live manifest untouched (${JSON.stringify(state.live)})`)
      const font = state.written.find(([k]) => k.endsWith(".ttf"))
      expect(/^[0-9a-f]{16}\.ttf$/.test(font?.[0] ?? ""), "content-addressed key")
      expect(font?.[1].mime === "font/ttf", "mime font/ttf")
      expect(font?.[1].name === "lucide-Regular.ttf", `name (${font?.[1].name})`)
      // One ⌘Z undoes the user's edit (the text); nothing else is on the stack.
      expect(state.textGone, "undo removed the text")
      expect(!state.moreUndo, "no other undo step")
      expect(
        requests.some((u) => u.includes("gstatic")),
        "one face fetched",
      )
      await settle(page)
    },
  },
]
