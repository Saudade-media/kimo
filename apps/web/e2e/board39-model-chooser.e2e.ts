/**
 * Board 39 "Model chooser" (desing.pen qNrfY) on the M6 agent harness: states A (VlWzE) and
 * its dark twin (gku5h), B hover (xbS8Q), C search (kL7Pm), D no provider (Ch0tG), E CLI signed
 * out (kacSL), F Local (NLNii) and G the collapsed composer chip (Q2sql). Each state gets one
 * measured getComputedStyle / getBoundingClientRect pass against the node values, plus the
 * keyboard (type to filter, ←/→ providers, ↑/↓, Enter, Tab to Effort, Esc).
 */
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import type { Page } from "playwright"
import { build } from "vite"
import { checker, measure, token } from "./m6-helpers"
import { type E2EContext, expect, type Scenario } from "./run"

const here = dirname(fileURLToPath(import.meta.url))
let built: Promise<string> | undefined

async function harnessUrl(ctx: E2EContext): Promise<string> {
  if (process.env.KIMO_E2E_DEV === "1") return `${ctx.url}e2e/m6-agent-harness/index.html`
  built ??= build({
    root: join(here, "m6-agent-harness"),
    configFile: false,
    base: "./",
    logLevel: "error",
    plugins: [react()],
    build: {
      outDir: join(process.env.KIMO_E2E_OUTDIR ?? join(here, ".dist"), "m6-agent-chooser"),
      emptyOutDir: true,
      target: "es2022",
    },
  }).then(() => "m6-agent-chooser/index.html")
  return `${ctx.url}${await built}`
}

type Ctl = {
  __m6: {
    controller: {
      state: {
        menu: string | null
        composer: { model: { provider: string; model: string } | null; thinking: string }
        recentModels: { provider: string; model: string }[]
      }
      openMenu(m: string | null): void
    }
  }
}
declare const window: Ctl & Window

const MENU = "[data-testid=agent-model-menu]"

async function open(ctx: E2EContext, chooser: string, theme?: "dark") {
  await ctx.page.setViewportSize({ width: 1440, height: 900 })
  await ctx.page.goto(`${await harnessUrl(ctx)}?scene=panel&chooser=${chooser}`)
  await ctx.page.waitForFunction(() => !!(window as unknown as Ctl).__m6)
  await ctx.page.evaluate(() => document.fonts.ready)
  if (theme)
    await ctx.page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme)
  // Providers load on mount (refresh); the chooser lists them once they are in.
  await ctx.page.waitForFunction(
    () => (window as unknown as Ctl).__m6.controller.state.composer.model !== undefined,
  )
}

async function openMenu(page: Page, viaChip = true) {
  if (viaChip) await page.locator(".kimo-composer-agent__model").click()
  else await page.evaluate(() => (window as unknown as Ctl).__m6.controller.openMenu("model"))
  await page.locator(MENU).waitFor()
}

const rowSel = (provider: string, model: string) =>
  `${MENU} [data-provider="${provider}"][data-model="${model}"]`

/** Shared Menu frame (VlWzE et al.): 304 wide, gap 1, padding 4, radius-lg, bg-overlay. */
async function frameChecks(
  page: Page,
  c: ReturnType<typeof checker>,
  name: string,
  height: number,
) {
  const overlay = await token(page, "--kimo-bg-overlay")
  const m = await measure(page, {
    panel: "[data-testid=right-panel]",
    wrap: ".agent-panel__composer-wrap",
    menu: MENU,
  })
  c.box(`Model Menu (${name})`, m.menu, {
    w: 304,
    h: height,
    gap: 1,
    pad: [4, 4, 4, 4],
    radius: 16,
    bg: overlay,
  })
  // Right-aligned: right edge 12 inside the composer wrap's (panel 360 → x = panel x + 44).
  c.check(`Model Menu (${name})`, "x = panel x + 44", (m.menu?.x ?? 0) - (m.panel?.x ?? 0), 44)
  c.check(
    `Model Menu (${name})`,
    "bottom = composer wrap top − 4",
    (m.menu?.y ?? 0) + (m.menu?.h ?? 0),
    (m.wrap?.y ?? 0) - 4,
  )
}

export const scenarios: Scenario[] = [
  {
    name: "board39: A — Recent, providers, models, Effort + measured (light and dark)",
    async run(ctx) {
      for (const theme of [undefined, "dark"] as const) {
        const { page } = ctx
        await open(ctx, "a", theme)
        await openMenu(page)
        const tertiary = await token(page, "--kimo-text-tertiary")
        const secondary = await token(page, "--kimo-text-secondary")
        const primary = await token(page, "--kimo-text-primary")
        const muted = await token(page, "--kimo-bg-muted")
        const app = await token(page, "--kimo-bg-app")
        const clear = "rgba(0, 0, 0, 0)"
        const c = checker(ctx, theme ? "Board 39 A dark (gku5h)" : "Board 39 A (VlWzE)")
        await frameChecks(page, c, theme ? "gku5h" : "VlWzE", 393)
        const m = await measure(page, {
          recentGroup: `${MENU} > .agent-menu__group`,
          recentLabel: `${MENU} > .agent-menu__group .agent-menu__group-label`,
          recent0: `${MENU} > [data-row-key]:nth-of-type(1)`,
          recent0Label: `${MENU} > [data-row-key] .kimo-menu-item-dense__label`,
          recent0Meta: `${MENU} > [data-row-key] .kimo-menu-item-dense__meta`,
          dividerR: `${MENU} > .kimo-menu-divider`,
          providers: `${MENU} .agent-chooser__providers`,
          cliRow: `${MENU} .agent-chooser__chip-row`,
          chipOn: `${MENU} .agent-chooser__chip--on`,
          chipOnLabel: `${MENU} .agent-chooser__chip--on .agent-chooser__chip-label`,
          chipOff: `${MENU} .agent-chooser__chip[data-provider="cli:codex"]`,
          chipOffLabel: `${MENU} .agent-chooser__chip[data-provider="cli:codex"] .agent-chooser__chip-label`,
          checked: `${rowSel("cli:claude-code", "claude-sonnet-5-5")}[aria-checked=true]`,
          checkedLabel: `${rowSel("cli:claude-code", "claude-sonnet-5-5")}[aria-checked=true] .kimo-menu-item-dense__label`,
          checkIcon: `${rowSel("cli:claude-code", "claude-sonnet-5-5")}[aria-checked=true] .kimo-menu-item-dense__check svg`,
          opus: rowSel("cli:claude-code", "claude-opus-5-5"),
          opusLabel: `${rowSel("cli:claude-code", "claude-opus-5-5")} .kimo-menu-item-dense__label`,
          best: `${rowSel("cli:claude-code", "claude-opus-5-5")} .kimo-menu-item-dense__meta`,
          effort: `${MENU} .agent-chooser__effort`,
          effortLabel: `${MENU} .agent-chooser__effort .agent-menu__effort-label`,
          seg: `${MENU} .agent-chooser__effort .kimo-seg-text`,
          segOn: `${MENU} .agent-chooser__effort .kimo-seg-text__segment--on`,
          segOff: `${MENU} .agent-chooser__effort .kimo-seg-text__segment:not(.kimo-seg-text__segment--on)`,
          segOnLabel: `${MENU} .agent-chooser__effort .kimo-seg-text__segment--on .kimo-seg-text__label`,
          segOffLabel: `${MENU} .agent-chooser__effort .kimo-seg-text__segment:not(.kimo-seg-text__segment--on) .kimo-seg-text__label`,
          connect: `${MENU} .agent-menu__manage`,
          connectIcon: `${MENU} .agent-menu__manage .kimo-menu-item-dense__check`,
          connectLabel: `${MENU} .agent-menu__manage .kimo-menu-item-dense__label`,
          connectMeta: `${MENU} .agent-menu__manage .kimo-menu-item-dense__meta`,
        })
        c.box("Group · Recent (Tmwae)", m.recentGroup, { h: 21, pad: [6, 8, 2, 8], w: 296 })
        c.box("Recent label (D81cW)", m.recentLabel, {
          fs: 11,
          fw: "500",
          lh: 13,
          color: tertiary,
        })
        c.box("Model · Sonnet 5.5 recent (iJqqf)", m.recent0, {
          h: 28,
          w: 296,
          gap: 8,
          pad: [0, 8, 0, 8],
          radius: 6,
        })
        c.box("Recent Label (BRxvS)", m.recent0Label, { fs: 12, fw: "400", color: primary })
        c.box("Recent Meta 'Claude Code' (T4CD1)", m.recent0Meta, {
          fs: 11,
          ff: "Inter",
          color: tertiary,
        })
        c.box("Divider R (WsFRU)", m.dividerR, { h: 9, pad: [4, 8, 4, 8] })
        c.box("Providers (Rr81H)", m.providers, { w: 296, h: 58, gap: 2, pad: [4, 4, 4, 4] })
        c.box("CLI Row (o0dBeN)", m.cliRow, { w: 288, h: 24, gap: 2 })
        c.box("Provider · Claude Code (mRxOq)", m.chipOn, {
          h: 24,
          gap: 5,
          pad: [0, 8, 0, 8],
          radius: 6,
          bg: muted,
        })
        c.box("Claude Code label (t1ed8J)", m.chipOnLabel, {
          fs: 11,
          fw: "500",
          lh: 13,
          color: primary,
        })
        c.box("Provider · Codex (jfb6H)", m.chipOff, { h: 24, pad: [0, 8, 0, 8], bg: clear })
        c.box("Codex label (D0bri)", m.chipOffLabel, { fs: 11, fw: "500", color: secondary })
        c.box("Model · Sonnet 5.5 checked (o4YRr)", m.checked, { h: 28, w: 296, bg: clear })
        c.box("Sonnet label (BRxvS) 500", m.checkedLabel, { fs: 12, fw: "500" })
        c.box("Check (RmOTH)", m.checkIcon, { w: 14, h: 14 })
        c.box("Model · Opus 5.5 (I9Yvt)", m.opus, { h: 28, bg: clear })
        c.box("Opus label (BRxvS)", m.opusLabel, { fs: 12, fw: "400" })
        c.box("Meta 'Best' (T4CD1)", m.best, { fs: 11, ff: "Inter", color: tertiary })
        c.box("Effort (j6ZMj)", m.effort, { w: 296, h: 32, gap: 8, pad: [4, 8, 4, 8] })
        c.box("Effort label (i5vLr4)", m.effortLabel, { fs: 12, color: primary })
        c.box("Effort Segmented (CTh66)", m.seg, {
          h: 24,
          gap: 2,
          pad: [2, 2, 2, 2],
          radius: 999,
          bg: muted,
        })
        c.box("Segment · High (Mx9Oz)", m.segOn, { h: 20, pad: [0, 8, 0, 8], bg: app })
        c.box("Segment · Low (V8EykG)", m.segOff, { h: 20, pad: [0, 8, 0, 8], bg: clear })
        c.box("High label (eLw7e)", m.segOnLabel, { fs: 11, fw: "500", color: primary })
        c.box("Low label (Wlh8a)", m.segOffLabel, { fs: 11, fw: "500", color: tertiary })
        c.box("Connect a provider (vpzl6)", m.connect, { h: 28, w: 296 })
        c.box("Connect icon plus (RmOTH)", m.connectIcon, { w: 14, h: 14, color: secondary })
        c.box("Connect label (BRxvS)", m.connectLabel, { fs: 12 })
        c.box("Connect meta ⌘, (T4CD1)", m.connectMeta, {
          fs: 11,
          ff: "JetBrains Mono",
          color: tertiary,
        })
        c.flush()
        // Isomorphic order: Recent › Divider › Providers › Divider › models › Divider › Effort ›
        // Divider › Connect.
        const order = await page.evaluate((sel) => {
          const menu = document.querySelector(sel) as HTMLElement
          return [...menu.children].map((e) =>
            e.classList.contains("agent-menu__group")
              ? "group"
              : e.classList.contains("kimo-menu-divider")
                ? "divider"
                : e.classList.contains("agent-chooser__providers")
                  ? "providers"
                  : e.classList.contains("agent-chooser__effort")
                    ? "effort"
                    : e.classList.contains("agent-menu__manage")
                      ? "connect"
                      : "row",
          )
        }, MENU)
        expect(
          order.join(",") ===
            "group,row,row,divider,providers,divider,row,row,row,row,row,divider,effort,divider,connect",
          `A order: ${order.join(",")}`,
        )
        const chips = await page.locator(`${MENU} .agent-chooser__chip`).allInnerTexts()
        expect(
          chips.join("|") === "Claude Code|Codex|Gemini CLI|Anthropic|OpenAI|Gemini|Local",
          `chips: ${chips.join("|")}`,
        )
        const labels = await page
          .locator(`${MENU} > .kimo-menu-item-dense .kimo-menu-item-dense__label`)
          .allInnerTexts()
        expect(
          labels.join("|") ===
            "Sonnet 5.5|Haiku 4.5|Default (CLI decides)|Opus 5.5|Sonnet 5.5|Haiku 4.5|Fable 5.1|Connect a provider…",
          `rows: ${labels.join("|")}`,
        )
        const segs = await page.locator(`${MENU} .kimo-seg-text__label`).allInnerTexts()
        expect(segs.join("|") === "Low|Medium|High|Max", `effort: ${segs.join("|")}`)
        if (ctx.shots)
          await page
            .locator(MENU)
            .screenshot({ path: join(ctx.shots, `board39-a${theme ? "-dark" : ""}.png`) })
      }
      // One click on a Recent row picks provider and model.
      const { page } = ctx
      await page.locator(rowSel("anthropic", "claude-haiku-4-5-20251001")).first().click()
      const sel = await page.evaluate(
        () => (window as unknown as Ctl).__m6.controller.state.composer.model,
      )
      expect(
        sel?.provider === "anthropic" && sel.model === "claude-haiku-4-5-20251001",
        `recent pick: ${JSON.stringify(sel)}`,
      )
      expect(
        (await page.locator(".kimo-composer-agent__model-label").innerText()) === "Haiku 4.5",
        "chip after the recent pick",
      )
    },
  },
  {
    name: "board39: B — hover shows one detail line + measured",
    async run(ctx) {
      const { page } = ctx
      await open(ctx, "b")
      await openMenu(page)
      await page.locator(rowSel("cli:claude-code", "claude-opus-5-5")).hover()
      await page.locator("[data-testid=agent-model-detail]").waitFor()
      const hover = await token(page, "--kimo-bg-hover")
      const tertiary = await token(page, "--kimo-text-tertiary")
      const c = checker(ctx, "Board 39 B (xbS8Q)")
      await frameChecks(page, c, "xbS8Q", 321)
      const m = await measure(page, {
        row: rowSel("cli:claude-code", "claude-opus-5-5"),
        detail: "[data-testid=agent-model-detail]",
        text: "[data-testid=agent-model-detail] .agent-chooser__detail-text",
      })
      c.box("Model · Opus 5.5 hover (g2Bbf)", m.row, { h: 28, bg: hover })
      c.box("Hover Detail (PXNa8)", m.detail, { w: 296, h: 17, pad: [0, 8, 4, 30] })
      c.box("Detail (It64X)", m.text, { fs: 11, lh: 13, color: tertiary })
      c.check("Detail", "y = row bottom + 1 (gap)", (m.detail?.y ?? 0) - ((m.row?.y ?? 0) + 28), 1)
      c.flush()
      const text = await page.locator("[data-testid=agent-model-detail]").innerText()
      expect(text === "1M context · 128K output · always thinks", `detail: ${text}`)
      expect(
        (await page.locator("[data-testid=agent-model-detail]").count()) === 1,
        "one detail line",
      )
      if (ctx.shots) await page.locator(MENU).screenshot({ path: join(ctx.shots, "board39-b.png") })
    },
  },
  {
    name: "board39: C — search (9+ models), grouped results, keyboard + measured",
    async run(ctx) {
      const { page } = ctx
      await open(ctx, "c")
      await openMenu(page)
      const muted = await token(page, "--kimo-bg-muted")
      const tertiary = await token(page, "--kimo-text-tertiary")
      // Type to filter (the field has focus).
      await page.keyboard.type("son")
      await page.locator(`${MENU}[data-state=search]`).waitFor()
      const c = checker(ctx, "Board 39 C (kL7Pm)")
      await frameChecks(page, c, "kL7Pm", 232)
      const m = await measure(page, {
        search: `${MENU} .agent-chooser__search`,
        icon: `${MENU} .agent-chooser__search-icon`,
        input: `${MENU} .agent-chooser__search-input`,
        group: `${MENU} > .agent-menu__group`,
        groupLabel: `${MENU} > .agent-menu__group .agent-menu__group-label`,
        first: `${MENU} [data-row-key]`,
      })
      c.box("Search (O6JGzY)", m.search, {
        w: 296,
        h: 32,
        gap: 8,
        pad: [0, 10, 0, 10],
        radius: 10,
        bg: muted,
      })
      c.box("Icon search (mU4b8)", m.icon, { w: 16, h: 16, color: tertiary })
      c.box("Text (BwYzP)", m.input, { fs: 13 })
      c.box("Group · Claude Code (SUQbc)", m.group, { h: 21, pad: [6, 8, 2, 8] })
      c.box("Group label (eLHHt)", m.groupLabel, { fs: 11, fw: "500", color: tertiary })
      c.box("Model · Sonnet 5.5 first match (r8UvyD)", m.first, {
        h: 28,
        bg: await token(page, "--kimo-bg-hover"),
      })
      c.flush()
      const groups = await page.locator(`${MENU} > .agent-menu__group`).allInnerTexts()
      expect(groups.join("|") === "Claude Code|Anthropic|OpenRouter", `groups: ${groups.join("|")}`)
      expect((await page.locator(`${MENU} .agent-chooser__chip`).count()) === 0, "chips hidden")
      expect((await page.locator(`${MENU} .agent-chooser__effort`).count()) === 0, "effort hidden")
      if (ctx.shots) await page.locator(MENU).screenshot({ path: join(ctx.shots, "board39-c.png") })
      // The first match is active (Enter would pick it); ↓ moves to the second, Enter picks it.
      await page.keyboard.press("ArrowDown")
      await page.keyboard.press("Enter")
      const sel = await page.evaluate(
        () => (window as unknown as Ctl).__m6.controller.state.composer.model,
      )
      expect(
        sel?.provider === "anthropic" && sel.model === "claude-sonnet-5-5",
        `keyboard pick: ${JSON.stringify(sel)}`,
      )
      expect(
        (await page.evaluate(() => (window as unknown as Ctl).__m6.controller.state.menu)) === null,
        "closed after the pick",
      )
    },
  },
  {
    name: "board39: D — no provider connected + measured",
    async run(ctx) {
      const { page } = ctx
      await open(ctx, "d")
      await openMenu(page, false)
      const tertiary = await token(page, "--kimo-text-tertiary")
      const primary = await token(page, "--kimo-text-primary")
      const c = checker(ctx, "Board 39 D (Ch0tG)")
      await frameChecks(page, c, "Ch0tG", 131)
      const m = await measure(page, {
        empty: `${MENU} .agent-chooser__empty`,
        icon: `${MENU} .agent-chooser__empty-icon`,
        title: `${MENU} .agent-chooser__empty-title`,
        hint: `${MENU} .agent-chooser__empty-hint`,
      })
      c.box("Empty (d37as)", m.empty, { w: 296, h: 84, gap: 4, pad: [16, 12, 12, 12] })
      c.box("Icon plug (Z2DYb)", m.icon, { w: 20, h: 20, color: tertiary })
      c.box("Title (Y5nu7)", m.title, { fs: 12, fw: "500", lh: 15, color: primary })
      c.box("Hint (QOp8A)", m.hint, { fs: 11, lh: 13, color: tertiary })
      c.flush()
      if (ctx.shots) await page.locator(MENU).screenshot({ path: join(ctx.shots, "board39-d.png") })
    },
  },
  {
    name: "board39: E — signed-out CLI keeps its chip + measured",
    async run(ctx) {
      const { page } = ctx
      await open(ctx, "e")
      await openMenu(page)
      await page.locator(`${MENU} .agent-chooser__chip[data-provider="cli:claude-code"]`).click()
      await page.locator(`${MENU}[data-state=signed-out]`).waitFor()
      const warning = await token(page, "--kimo-warning")
      const c = checker(ctx, "Board 39 E (kacSL)")
      await frameChecks(page, c, "kacSL", 180)
      const m = await measure(page, {
        chip: `${MENU} .agent-chooser__chip--on`,
        dot: `${MENU} .agent-chooser__dot`,
        block: `${MENU} .agent-chooser__signed-out`,
        title: `${MENU} .agent-chooser__signed-out-title`,
        signIn: `${MENU} .agent-chooser__sign-in`,
      })
      c.box("Provider · Claude Code (A63cq)", m.chip, { h: 24, gap: 5, pad: [0, 8, 0, 8] })
      c.box("Signed-out dot (gL5Bd)", m.dot, { w: 6, h: 6, radius: 999, bg: warning })
      c.box("Signed Out (w2OSk7)", m.block, { w: 296, h: 35, gap: 4, pad: [12, 8, 8, 8] })
      c.box("Title (i9hnY)", m.title, { fs: 12, fw: "400", lh: 15 })
      c.box("Model · Sign in… (sLobq)", m.signIn, { h: 28, w: 296 })
      c.flush()
      const title = await page.locator(`${MENU} .agent-chooser__signed-out-title`).innerText()
      expect(title === "Claude Code is signed out", `title: ${title}`)
      if (ctx.shots) await page.locator(MENU).screenshot({ path: join(ctx.shots, "board39-e.png") })
    },
  },
  {
    name: "board39: F — Local, no Effort row; ←/→ providers, Tab to Effort, Esc + measured",
    async run(ctx) {
      const { page } = ctx
      await open(ctx, "f")
      await openMenu(page)
      const muted = await token(page, "--kimo-bg-muted")
      const tertiary = await token(page, "--kimo-text-tertiary")
      const c = checker(ctx, "Board 39 F (NLNii)")
      await frameChecks(page, c, "NLNii", 173)
      const m = await measure(page, {
        chip: `${MENU} .agent-chooser__chip--on`,
        row: rowSel("custom:ollama", "llama3.3:70b"),
        meta: `${rowSel("custom:ollama", "llama3.3:70b")} .kimo-menu-item-dense__meta`,
      })
      c.box("Provider · Local (oxP88)", m.chip, { h: 24, bg: muted })
      c.box("Model · llama3.3:70b (s0prPp)", m.row, { h: 28, w: 296 })
      c.box("Meta 'Local' (T4CD1)", m.meta, { fs: 11, ff: "Inter", color: tertiary })
      c.flush()
      expect((await page.locator(`${MENU} .agent-chooser__effort`).count()) === 0, "no Effort")
      if (ctx.shots) await page.locator(MENU).screenshot({ path: join(ctx.shots, "board39-f.png") })
      // ← moves to Gemini (the chip before Local), → back; then to Claude Code via clicks.
      await page.keyboard.press("ArrowLeft")
      expect(
        (await page.locator(`${MENU} .agent-chooser__chip--on`).innerText()) === "Gemini",
        "← switched provider",
      )
      await page.keyboard.press("ArrowRight")
      expect(
        (await page.locator(`${MENU} .agent-chooser__chip--on`).innerText()) === "Local",
        "→ switched back",
      )
      // Pick a model with Effort, reopen, Tab to Effort, → raises the level.
      await page.locator(`${MENU} .agent-chooser__chip[data-provider="anthropic"]`).click()
      await page.locator(rowSel("anthropic", "claude-opus-5-5")).click()
      await openMenu(page)
      await page.keyboard.press("Tab")
      await page.keyboard.press("ArrowRight")
      const t = await page.evaluate(
        () => (window as unknown as Ctl).__m6.controller.state.composer.thinking,
      )
      expect(t === "max", `effort after → : ${t}`)
      await page.keyboard.press("Escape")
      expect(
        (await page.evaluate(() => (window as unknown as Ctl).__m6.controller.state.menu)) === null,
        "Esc closes",
      )
    },
  },
  {
    name: "board39: G — collapsed chip: model name and 12 px provider mark + measured",
    async run(ctx) {
      const { page } = ctx
      await open(ctx, "a")
      const tertiary = await token(page, "--kimo-text-tertiary")
      const c = checker(ctx, "Board 39 G (Q2sql)")
      const m = await measure(page, {
        chip: ".kimo-composer-agent__model",
        mark: ".kimo-composer-agent__model-mark",
        markSvg: ".kimo-composer-agent__model-mark svg",
        label: ".kimo-composer-agent__model-label",
        chevron: ".kimo-composer-agent__model-chevron",
      })
      c.box("Model Chip (OZDQN)", m.chip, { h: 17, gap: 4, pad: [2, 6, 2, 6], color: tertiary })
      c.box("Provider Mark (agr1b) terminal", m.markSvg, { w: 12, h: 12, color: tertiary })
      c.box("Label (VooW1)", m.label, { fs: 11, lh: 13, color: tertiary })
      c.box("Chevron (vSgZX)", m.chevron, { w: 12, h: 12 })
      c.flush()
      const label = await page.locator(".kimo-composer-agent__model-label").innerText()
      expect(label === "Sonnet 5.5", `chip label: ${label}`)
      // Board 40: the full name shows at the 360 panel (no ellipsis).
      const cut = await page.evaluate(() => {
        const el = document.querySelector(".kimo-composer-agent__model-label") as HTMLElement
        return el.scrollWidth - el.clientWidth
      })
      expect(cut <= 0, `chip label is not truncated (overflow ${cut})`)
      const icon = await page.locator(".kimo-composer-agent__model-mark svg").getAttribute("class")
      expect(/terminal/.test(icon ?? ""), `terminal mark: ${icon}`)
      if (ctx.shots)
        await page
          .locator("[data-testid=agent-composer]")
          .screenshot({ path: join(ctx.shots, "board39-g.png") })
      // Local → hard-drive, API → cloud.
      await openMenu(page)
      await page.locator(`${MENU} .agent-chooser__chip[data-provider="custom:ollama"]`).click()
      await page.locator(rowSel("custom:ollama", "llama3.3:70b")).click()
      expect(
        /hard-drive/.test(
          (await page.locator(".kimo-composer-agent__model-mark svg").getAttribute("class")) ?? "",
        ),
        "hard-drive mark",
      )
      await openMenu(page)
      await page.locator(`${MENU} .agent-chooser__chip[data-provider="openai"]`).click()
      await page.locator(rowSel("openai", "gpt-4.1")).click()
      expect(
        /cloud/.test(
          (await page.locator(".kimo-composer-agent__model-mark svg").getAttribute("class")) ?? "",
        ),
        "cloud mark",
      )
    },
  },
]
