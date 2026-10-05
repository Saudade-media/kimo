/**
 * Board 27 "Completeness (v1)" §10 (a) q2UAb Default provider / Default model and (b) EP0Ir
 * per-turn cost warning + Show cost, on the M6 harnesses (`e2e/m6-ai-harness`,
 * `e2e/m6-agent-harness`). One measured getComputedStyle / getBoundingClientRect pass per
 * surface against the desing.pen node values (AseJa / WmFb2 / A61KV / lxvvC, qtTiZ and its
 * children), plus the behaviour rules q07tZ / THx2k / r9hTk.
 */
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import { build } from "vite"
import { checker, measure, token } from "./m6-helpers"
import { type E2EContext, expect, type Scenario } from "./run"

const here = dirname(fileURLToPath(import.meta.url))
const builds: Record<string, Promise<string>> = {}

function harness(ctx: E2EContext, name: "m6-ai-harness" | "m6-agent-harness"): Promise<string> {
  if (process.env.KIMO_E2E_DEV === "1") return Promise.resolve(`${ctx.url}e2e/${name}/index.html`)
  const out = `board27-${name}`
  builds[name] ??= build({
    root: join(here, name),
    configFile: false,
    base: "./",
    logLevel: "error",
    plugins: [react()],
    build: {
      outDir: join(process.env.KIMO_E2E_OUTDIR ?? join(here, ".dist"), out),
      emptyOutDir: true,
      target: "es2022",
    },
  }).then(() => `${ctx.url}${out}/index.html`)
  return builds[name]
}

async function open(ctx: E2EContext, name: "m6-ai-harness" | "m6-agent-harness", q: string) {
  ctx.page.on("pageerror", (e) => ctx.log(`pageerror: ${e.message}`))
  await ctx.page.setViewportSize({ width: 1100, height: 1640 })
  await ctx.page.goto(`${await harness(ctx, name)}?${q}`)
  await ctx.page.waitForFunction(
    (n) =>
      !!(window as unknown as Record<string, unknown>)[n === "m6-ai-harness" ? "__ai" : "__m6"],
    name,
  )
  await ctx.page.evaluate(() => document.fonts.ready)
}

type AiWindow = {
  __ai: {
    ctl: {
      setKey(id: string, key: string): Promise<unknown>
      addCustom(c: unknown): Promise<string>
      removeProvider(id: string): Promise<void>
      state: { defaultSelection: { provider: string; model: string } | null }
    }
  }
}

type M6Window = {
  __m6: {
    controller: {
      refresh(): Promise<void>
      state: { messages: unknown[]; costWarning: { text: string } | null; busy: boolean }
    }
    usage: { showCost: boolean; warnPerTurnUsd: number }
  }
}

export const scenarios: Scenario[] = [
  {
    name: "board27: Settings › AI providers default provider / model (q2UAb) + measured",
    async run(ctx) {
      const { page } = ctx
      await open(ctx, "m6-ai-harness", "scene=settings-desktop&providers=none")
      // Nothing connected yet: disabled with "Connect a provider first".
      const provider = page.locator("[data-testid=ai-default-provider]")
      await provider.waitFor()
      expect(
        (await provider.textContent())?.includes("Connect a provider first"),
        "no connected provider → 'Connect a provider first'",
      )
      expect(
        await provider.locator("button").first().isDisabled(),
        "the Default provider Select is disabled",
      )
      // Anthropic passes its Test; a keyless local endpoint joins (status local).
      await page.evaluate(async () => {
        const ai = (window as unknown as AiWindow).__ai
        await ai.ctl.setKey("anthropic", "sk-ant-api03-test-3f9a")
        await ai.ctl.addCustom({
          label: "LM Studio",
          baseURL: "http://localhost:1234/v1",
          wire: "openai-chat",
          models: { agent: "qwen2.5-coder", fast: "qwen2.5-coder" },
          free: true,
        })
      })
      await page
        .locator('.ai-provider-row[data-provider="anthropic"] [data-testid=ai-default-action]')
        .waitFor()
      expect((await provider.textContent())?.includes("Anthropic"), "Anthropic is the default")
      expect(
        (await page.locator("[data-testid=ai-default-model]").textContent())?.includes(
          "Claude Opus 5.5",
        ),
        "Default model shows the provider's agent model",
      )

      const m = await measure(page, {
        row: '[data-pen="AseJa"]',
        label: '[data-pen="AseJa"] .kimo-setting-row__label',
        desc: '[data-pen="AseJa"] .kimo-setting-row__desc',
        rowModel: '[data-pen="WmFb2"]',
        select: '[data-pen="AseJa"] .kimo-select__trigger',
        value: '[data-pen="AseJa"] .kimo-select__value',
        chevron: '[data-pen="AseJa"] .kimo-select__trigger svg',
        def: '.ai-provider-row[data-provider="anthropic"] [data-testid=ai-default-action]',
        defIcon: '.ai-provider-row[data-provider="anthropic"] [data-testid=ai-default-action] svg',
        make: '.ai-provider-row:not([data-provider="anthropic"]) [data-testid=ai-default-action]',
        makeIcon:
          '.ai-provider-row:not([data-provider="anthropic"]) [data-testid=ai-default-action] svg',
      })
      const primary = await token(page, "--kimo-text-primary")
      const secondary = await token(page, "--kimo-text-secondary")
      const tertiary = await token(page, "--kimo-text-tertiary")
      const subtle = await token(page, "--kimo-bg-subtle")
      const c = checker(ctx, "Default provider / model (q2UAb)")
      // Row height follows the pane width (the board's excerpt is 544 wide, so AseJa's desc
      // wraps to 2 lines / 73; the 840 window keeps it on one). Default model fits 1 line in both.
      c.box("Setting · Default provider AseJa", m.row, { pad: [12, 0, 12, 0], gap: 16 })
      c.box("Label NcrOC", m.label, { fs: 12, fw: "500", h: 15, color: primary })
      c.box("Desc LMxOY", m.desc, { fs: 11, lh: 15.95, color: secondary })
      c.box("Setting · Default model WmFb2", m.rowModel, { pad: [12, 0, 12, 0], gap: 16, h: 57 })
      c.box("Select A61KV", m.select, {
        w: 180,
        h: 28,
        pad: [0, 8, 0, 8],
        gap: 8,
        radius: 6,
        bg: subtle,
      })
      c.box("Value LWF8n", m.value, { fs: 12, color: primary })
      c.box("Chevron VLDHF", m.chevron, { w: 14, h: 14, color: tertiary })
      c.box("Action · Default lxvvC", m.def, { h: 28, pad: [0, 12, 0, 12], gap: 6, radius: 999 })
      c.box("Icon star", m.defIcon, { w: 14, h: 14, color: primary })
      c.check("Default label color", "color", m.def?.color, primary)
      c.box("Action · Make default", m.make, { h: 28, pad: [0, 12, 0, 12], gap: 6 })
      c.box("Icon star-off", m.makeIcon, { w: 14, h: 14, color: tertiary })
      c.check("Make default label color", "color", m.make?.color, secondary)
      c.flush()

      // Make default → the local endpoint; removing it falls back to the next connected one.
      await page
        .locator(
          '.ai-provider-row:not([data-provider="anthropic"]) [data-testid=ai-default-action]',
        )
        .click()
      await page.waitForFunction(
        () =>
          (window as unknown as AiWindow).__ai.ctl.state.defaultSelection?.provider.startsWith(
            "custom:",
          ) === true,
      )
      expect((await provider.textContent())?.includes("LM Studio"), "LM Studio is the default")
      await page.evaluate(async () => {
        const ai = (window as unknown as AiWindow).__ai
        const id = ai.ctl.state.defaultSelection?.provider ?? ""
        await ai.ctl.removeProvider(id)
      })
      await page.waitForFunction(
        () =>
          (window as unknown as AiWindow).__ai.ctl.state.defaultSelection?.provider === "anthropic",
      )
      // Picking from the Select writes the default.
      await provider.locator("button").first().click()
      expect(
        (await page.locator("[role=option]").allTextContents()).join() === "Anthropic",
        "only connected providers are listed",
      )
      await page.keyboard.press("Escape")
    },
  },
  {
    name: "board27: per-turn cost warning (EP0Ir) held send + Show cost + measured",
    async run(ctx) {
      const { page } = ctx
      await open(ctx, "m6-agent-harness", "warn=0.05")
      const textarea = page.locator("[data-testid=agent-composer] textarea")
      await textarea.fill("Make the hero warmer")
      await textarea.press("Enter")
      const card = page.locator("[data-testid=agent-cost-warning]")
      await card.waitFor()
      expect(
        (await page.evaluate(() => (window as unknown as M6Window).__m6.controller.state.messages))
          .length === 0,
        "nothing is sent while the warning is up",
      )
      const title = (await card.locator(".kimo-cost-warning__title").textContent()) ?? ""
      expect(/^This turn may cost about \$\d+\.\d+$/.test(title), `title with $: ${title}`)
      expect(
        (await card.locator(".kimo-cost-warning__desc").textContent())?.startsWith(
          "Above your $0.05 per-turn warning — ",
        ),
        "desc names the threshold",
      )

      const m = await measure(page, {
        card: "[data-testid=agent-cost-warning]",
        head: ".kimo-cost-warning__head",
        icon: ".kimo-cost-warning__icon",
        title: ".kimo-cost-warning__title",
        desc: ".kimo-cost-warning__desc",
        actions: ".kimo-cost-warning__actions",
        send: ".kimo-cost-warning__button--send",
        sendLabel: ".kimo-cost-warning__button--send .kimo-cost-warning__label",
        edit: ".kimo-cost-warning__button--edit",
        editLabel: ".kimo-cost-warning__button--edit .kimo-cost-warning__label",
        link: ".kimo-cost-warning__link",
        composer: "[data-testid=agent-composer]",
      })
      const warningSoft = await token(page, "--kimo-warning-soft")
      const warning = await token(page, "--kimo-warning")
      const primary = await token(page, "--kimo-text-primary")
      const secondary = await token(page, "--kimo-text-secondary")
      const tertiary = await token(page, "--kimo-text-tertiary")
      const muted = await token(page, "--kimo-bg-muted")
      const strong = await token(page, "--kimo-border-strong")
      const c = checker(ctx, "Cost Warning Card (qtTiZ)")
      c.box("Card qtTiZ", m.card, { pad: [10, 12, 10, 12], gap: 8, radius: 10, bg: warningSoft })
      c.box("Head npqDG", m.head, { gap: 8, h: 15 })
      c.box("Icon circle-dollar-sign", m.icon, { w: 14, h: 14, color: warning })
      c.box("Title rIngQ", m.title, { fs: 12, fw: "400", h: 15, color: primary })
      c.box("Desc iHQMS", m.desc, { fs: 11, lh: 15.95, color: secondary })
      c.box("Actions RvSkG", m.actions, { gap: 6, h: 26 })
      c.box("Send anyway QOGhX", m.send, { h: 26, pad: [0, 10, 0, 10], radius: 999, bg: muted })
      c.check(
        "Send anyway stroke",
        "box-shadow",
        String(m.send?.shadow.includes(strong) ?? false),
        "true",
      )
      c.box("Send anyway label", m.sendLabel, { fs: 12, fw: "500", h: 15, color: primary })
      c.box("Edit message jGwMp", m.edit, { h: 26, pad: [0, 10, 0, 10], radius: 999 })
      c.box("Edit message label", m.editLabel, { fs: 12, fw: "500", color: secondary })
      c.box("Link Settings XlDRH", m.link, { fs: 11, fw: "400", h: 13, color: tertiary })
      c.check(
        "Card → composer gap (column gap 10)",
        "px",
        m.card && m.composer ? m.composer.y - (m.card.y + m.card.h) : null,
        10,
      )
      c.flush()

      // Edit message: hold dropped, text stays, nothing sent.
      await card.locator("button:has-text('Edit message')").click()
      await card.waitFor({ state: "detached" })
      expect((await textarea.inputValue()) === "Make the hero warmer", "text stays")
      // Show cost off → the card speaks tokens.
      await page.evaluate(async () => {
        const w = (window as unknown as M6Window).__m6
        w.usage.showCost = false
        await w.controller.refresh()
      })
      await textarea.press("Enter")
      await card.waitFor()
      const off = (await card.textContent()) ?? ""
      expect(/This turn is large — ~\d+(\.\d)?k tokens/.test(off), `tokens wording: ${off}`)
      expect(!off.includes("$"), "no $ in the card when Show cost is off")
      // Send anyway → sent; meta and header keep tokens, no $.
      await card.locator("button:has-text('Send anyway')").click()
      await page.locator("[data-testid=agent-message-meta]").first().waitFor()
      expect(
        (await page.locator("[data-testid=agent-message-meta] [data-part=cost]").count()) === 0,
        "MessageMeta has no cost cell when Show cost is off",
      )
      const meta =
        (await page.locator("[data-testid=agent-message-meta]").first().textContent()) ?? ""
      expect(/new tokens/.test(meta) && !meta.includes("$"), `meta keeps tokens: ${meta}`)
      const header = (await page.locator("[data-testid=agent-session-cost]").textContent()) ?? ""
      expect(/tok$/.test(header) && !header.includes("$"), `header keeps tokens: ${header}`)
      // Show cost back on → $ returns.
      await page.evaluate(async () => {
        const w = (window as unknown as M6Window).__m6
        w.usage.showCost = true
        await w.controller.refresh()
      })
      await page.locator("[data-testid=agent-message-meta] [data-part=cost]").first().waitFor()
      expect(
        (await page.locator("[data-testid=agent-session-cost]").textContent())?.includes("$") ===
          true,
        "header shows $ again",
      )
    },
  },
]
