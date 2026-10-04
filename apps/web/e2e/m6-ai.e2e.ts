/**
 * M6 Settings › AI providers (board 23 g6AqH, web variant board 22 BWkRR) and the Home
 * composer (board 22 fYVvl / XsZVb, board 24 o8YoQ) on the M6 harness (`e2e/m6-ai-harness`:
 * memory secrets, fake CLI host, routed mock fetch). Each surface gets one measured
 * getComputedStyle / getBoundingClientRect pass against the desing.pen node values.
 */
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import type { Page } from "playwright"
import { build } from "vite"
import { type E2EContext, expect, type Scenario } from "./run"

const here = dirname(fileURLToPath(import.meta.url))
let built: Promise<string> | undefined

async function harnessUrl(ctx: E2EContext): Promise<string> {
  if (process.env.KIMO_E2E_DEV === "1") return `${ctx.url}e2e/m6-ai-harness/index.html`
  built ??= build({
    root: join(here, "m6-ai-harness"),
    configFile: false,
    base: "./",
    logLevel: "error",
    plugins: [react()],
    build: { outDir: join(here, ".dist", "m6-ai"), emptyOutDir: true, target: "es2022" },
  }).then(() => "m6-ai/index.html")
  return `${ctx.url}${await built}`
}

type Ai = {
  __ai: {
    ctl: {
      state: Record<string, unknown> & {
        providers: { id: string; status: string; isDefault: boolean }[]
        defaultSelection: { provider: string; model: string } | null
        noProvider: boolean
      }
      test(id: string): Promise<{ ok: boolean }>
    }
    fetch: { calls: { url: string; key: string | null }[] }
    opened: { kind: string; ref?: string; id?: string }[]
    handoff(path: string): Record<string, unknown> | null
    KEY: string
  }
}

async function open(ctx: E2EContext, query: string) {
  ctx.page.on("pageerror", (e) => ctx.log(`pageerror: ${e.message}`))
  ctx.page.on("console", (m) => m.type() === "error" && ctx.log(`console: ${m.text()}`))
  await ctx.page.setViewportSize({ width: 1100, height: 1640 })
  await ctx.page.goto(`${await harnessUrl(ctx)}?${query}`)
  await ctx.page.waitForFunction(() => !!(window as unknown as Ai).__ai)
  await ctx.page.evaluate(() => document.fonts.ready)
}

type Box = {
  x: number
  y: number
  w: number
  h: number
  pad: number[]
  gap: number
  fs: number
  fw: string
  ff: string | undefined
  lh: number
  bg: string
  color: string
  radius: number
  shadow: string
  opacity: string
  justify: string
  align: string
  display: string
  ls: number
}

function measure(page: Page, selectors: Record<string, string>) {
  return page.evaluate((sels) => {
    const out: Record<string, unknown> = {}
    for (const [k, sel] of Object.entries(sels)) {
      const e = document.querySelector(sel)
      if (!e) {
        out[k] = null
        continue
      }
      const r = e.getBoundingClientRect()
      const cs = getComputedStyle(e)
      out[k] = {
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
        pad: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(parseFloat),
        gap: parseFloat(cs.columnGap) || parseFloat(cs.rowGap) || 0,
        fs: parseFloat(cs.fontSize),
        fw: cs.fontWeight,
        ff: cs.fontFamily.split(",")[0]?.replace(/"/g, "").trim(),
        lh: parseFloat(cs.lineHeight),
        bg: cs.backgroundColor,
        color: cs.color,
        radius: parseFloat(cs.borderTopLeftRadius),
        shadow: cs.boxShadow,
        opacity: cs.opacity,
        justify: cs.justifyContent,
        align: cs.alignItems,
        display: cs.display,
        ls: parseFloat(cs.letterSpacing) || 0,
      }
    }
    return out
  }, selectors) as Promise<Record<string, Box | null>>
}

const token = (page: Page, name: string) =>
  page.evaluate((n) => {
    const el = document.createElement("div")
    el.style.color = `var(${n})`
    document.body.append(el)
    const c = getComputedStyle(el).color
    el.remove()
    return c
  }, name)

function checker(ctx: E2EContext, surface: string) {
  const rows: string[] = []
  const check = (
    el: string,
    prop: string,
    got: number | string | undefined | null,
    want: number | string,
    tol = 0.75,
  ) => {
    const ok =
      typeof want === "number"
        ? typeof got === "number" && Math.abs(got - want) <= tol
        : got === want
    rows.push(
      `| ${el} | ${prop} | ${want} | ${typeof got === "number" ? Math.round(got * 100) / 100 : got} | ${ok ? "=" : "≠"} |`,
    )
    expect(ok, `${surface} › ${el} ${prop}: want ${want}, got ${got}`)
  }
  const box = (
    el: string,
    b: Box | null | undefined,
    want: Partial<Record<"w" | "h" | "gap" | "fs" | "lh" | "radius" | "ls", number>> & {
      pad?: number[]
      fw?: string
      ff?: string
      bg?: string
      color?: string
      align?: string
      opacity?: string
    },
  ) => {
    expect(b, `${surface} › ${el} is rendered`)
    if (!b) return
    expect(b.display !== "none" && b.h > 0, `${surface} › ${el} has a box`)
    for (const k of ["w", "h", "gap", "fs", "lh", "radius", "ls"] as const)
      if (want[k] !== undefined) check(el, k, b[k], want[k] as number)
    if (want.pad) check(el, "padding", b.pad.join(" "), want.pad.join(" "))
    if (want.fw) check(el, "font-weight", b.fw, want.fw)
    if (want.ff) check(el, "font-family", b.ff, want.ff)
    if (want.bg) check(el, "background", b.bg, want.bg)
    if (want.color) check(el, "color", b.color, want.color)
    if (want.align) check(el, "align-items", b.align, want.align)
    if (want.opacity) check(el, "opacity", b.opacity, want.opacity)
  }
  const flush = () =>
    ctx.log(
      `\n    ${surface}\n    | element | property | design | measured | |\n    |---|---|---|---|---|\n${rows.map((r) => `    ${r}`).join("\n")}`,
    )
  return { check, box, flush }
}

const state = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as Ai).__ai.ctl.state
    return {
      providers: s.providers.map((p) => ({ id: p.id, status: p.status, isDefault: p.isDefault })),
      defaultSelection: s.defaultSelection,
      noProvider: s.noProvider,
    }
  })

export const scenarios: Scenario[] = [
  {
    name: "m6-ai: Settings › AI providers (desktop) — local agents, precedence, providers, Anthropic detail, usage; measured",
    async run(ctx) {
      const { page } = ctx
      await open(ctx, "scene=settings-desktop")
      // Detection ran on open: Claude Code signed in (Default), Codex not signed in, Gemini missing.
      await page.locator('.ai-cli-row[data-cli="gemini-cli"]').waitFor()
      expect(
        (await page.locator('.ai-cli-row[data-cli="claude-code"] .ai-default-badge').count()) === 1,
        "Claude Code is Default",
      )
      expect(
        (await page.locator(".ai-agent-status").textContent()) ===
          "Agent ready · Claude Code (subscription)",
        "status pill",
      )
      expect(
        (await page
          .locator('.ai-cli-row[data-cli="codex"] .ai-cli-row__hint-text')
          .textContent()) === "Sign in in terminal: run “codex login”",
        "codex hint",
      )
      expect(
        (await page.locator(".settings-nav-item--active").getAttribute("data-pane")) ===
          "ai-providers",
        "nav item active",
      )
      // Anthropic: run Test, then expand (Edit) → Detail with Connection OK.
      const t0 = await page.evaluate(() => (window as unknown as Ai).__ai.ctl.test("anthropic"))
      ctx.log(`anthropic test: ${JSON.stringify(t0)}`)
      await page
        .locator('.ai-provider-row[data-provider="anthropic"]')
        .getByRole("button", { name: "Edit" })
        .click()
      await page.locator(".ai-test--ok").waitFor()
      const st = await state(page)
      expect(
        st.providers.find((p) => p.id === "anthropic")?.status === "connected",
        "Anthropic Connected",
      )
      expect(st.defaultSelection?.provider === "cli:claude-code", "CLI wins precedence")
      const keys = await page.evaluate(() => {
        const a = (window as unknown as Ai).__ai
        return a.fetch.calls.map((c) => c.key === a.KEY)
      })
      expect(keys.length > 0 && keys.every(Boolean), "the relay injected the stored key")

      const sel = {
        content: ".settings-content",
        titleBar: ".ai-title-bar",
        title: ".ai-title",
        intro: ".ai-intro",
        local: ".ai-group--local",
        localTitleRow: ".ai-group--local .ai-group__title-row",
        localTitle: ".ai-group--local .ai-group__title",
        subtitle: ".ai-group__subtitle",
        recheckAll: '.ai-group--local [data-pen="euQQn"]',
        prec: ".ai-precedence",
        precKey: ".ai-precedence__key",
        precStep1: ".ai-precedence__step.is-active",
        precStep2: ".ai-precedence__step:not(.is-active)",
        claude: '.ai-cli-row[data-cli="claude-code"]',
        claudeTile: '.ai-cli-row[data-cli="claude-code"] .ai-cli-row__tile',
        claudeName: '.ai-cli-row[data-cli="claude-code"] .ai-cli-row__name',
        claudeMeta: '.ai-cli-row[data-cli="claude-code"] .ai-cli-row__meta',
        badge: ".ai-default-badge",
        badgeLabel: ".ai-default-badge__label",
        codex: '.ai-cli-row[data-cli="codex"]',
        hint: ".ai-cli-row__hint",
        hintText: ".ai-cli-row__hint-text",
        gemini: '.ai-cli-row[data-cli="gemini-cli"]',
        providersGroup: ".ai-group--providers",
        anthropic: '.ai-provider-row[data-provider="anthropic"]',
        anthropicTile: '.ai-provider-row[data-provider="anthropic"] .kimo-agent-host-row__tile',
        detail: '.ai-detail[data-provider="anthropic"]',
        keyField: '.ai-detail[data-provider="anthropic"] .ai-value-field',
        keyLabel: '.ai-detail[data-provider="anthropic"] .ai-field__label',
        keyValue: '.ai-detail[data-provider="anthropic"] .ai-value',
        fieldIcon: '.ai-detail[data-provider="anthropic"] .ai-field-icon',
        modelRole: '.ai-detail[data-provider="anthropic"] .ai-model__role',
        select: '.ai-detail[data-provider="anthropic"] .kimo-select__trigger',
        storage: '.ai-detail[data-provider="anthropic"] .ai-storage__label',
        test: ".ai-test",
        testLabel: ".ai-test__label",
        openai: '.ai-provider-row[data-provider="openai"]',
        cloud: '.ai-provider-row[data-provider="bedrock"]',
        usageGroup: ".ai-group--usage",
        usage: ".ai-usage",
        spent: ".ai-usage__spent",
        meter: ".ai-usage__meter",
        breakdown: ".ai-usage__breakdown",
        limit: '[data-pen="RNTFy"]',
        warn: '[data-pen="VgFYb"]',
        cost: '[data-pen="UtSey"]',
        amount: ".ai-amount",
      }
      const m = await measure(page, sel)
      const top = m.content?.y ?? 0
      const c = checker(ctx, "Settings › AI providers (g6AqH)")
      const y = (el: string, b: Box | null | undefined, want: number) =>
        c.check(el, "y (in Content)", b ? b.y - top : null, want, 1.5)
      const [secondary, tertiary, primary, success, warning, agent, agentSoft, subtle, app] =
        await Promise.all(
          [
            "--kimo-text-secondary",
            "--kimo-text-tertiary",
            "--kimo-text-primary",
            "--kimo-success",
            "--kimo-warning",
            "--kimo-agent",
            "--kimo-agent-soft",
            "--kimo-bg-subtle",
            "--kimo-bg-app",
          ].map((t) => token(page, t)),
        )
      c.box("Content (EGVxF)", m.content, { w: 624, pad: [0, 32, 24, 32] })
      c.box("Title Bar (oXKjz)", m.titleBar, { h: 56, w: 560 })
      c.box("Title (p6nHC)", m.title, { fs: 14, fw: "600", color: primary })
      c.box("Intro (L56aX)", m.intro, { h: 48, fs: 11, lh: 15.95, color: secondary })
      y("Intro", m.intro, 56)
      c.box("Group · Local agents (j5dTH)", m.local, { h: 153, gap: 2, pad: [24, 0, 8, 0] })
      y("Group · Local agents", m.local, 104)
      c.box("Title Row (qLbia)", m.localTitleRow, { h: 28, gap: 8 })
      c.box("Title (v8Wyds)", m.localTitle, { fs: 13, fw: "600" })
      c.box("Subtitle (A7pOV)", m.subtitle, { fs: 12, color: tertiary })
      c.box("Re-check all (euQQn)", m.recheckAll, {
        h: 28,
        pad: [0, 12, 0, 12],
        fs: 12,
        color: primary,
      })
      c.box("Precedence (Y84n9)", m.prec, { h: 31, gap: 8, pad: [8, 12, 8, 12], bg: subtle })
      c.box("Key (XVRHE)", m.precKey, { fs: 11, fw: "500", color: secondary })
      c.box("Step 1 (aBeiC)", m.precStep1, { fs: 11, ff: "JetBrains Mono", color: primary })
      c.box("Step 2 (D1xhC)", m.precStep2, { color: secondary })
      c.box("Local · Claude Code CLI (eJZeF)", m.claude, { h: 58, gap: 12, pad: [12, 0, 12, 0] })
      y("Local · Claude Code CLI", m.claude, 257)
      c.box("Host Tile (z1Uqv3)", m.claudeTile, { w: 32, h: 32 })
      c.box("Name (PLCim)", m.claudeName, { fs: 12, fw: "500" })
      c.box("Meta (mOc0k)", m.claudeMeta, { fs: 11, ff: "JetBrains Mono", color: tertiary })
      c.box("Default Badge (dPHWu)", m.badge, { h: 15, pad: [1, 7, 1, 7] })
      c.box("Default label (X9gFv5)", m.badgeLabel, { fs: 11, fw: "500", color: secondary })
      c.box("Local · Codex CLI (s6Tc2O)", m.codex, { h: 75 })
      y("Local · Codex CLI", m.codex, 315)
      c.box("Hint (kERUT)", m.hint, { gap: 5, pad: [2, 0, 0, 0] })
      c.box("Hint text (HgpbS)", m.hintText, { fs: 11, color: warning })
      c.box("Local · Gemini CLI (DkrLb)", m.gemini, { h: 58 })
      y("Local · Gemini CLI", m.gemini, 390)
      c.box("Group · Providers (rXLN6)", m.providersGroup, { h: 90, pad: [24, 0, 4, 0] })
      y("Group · Providers", m.providersGroup, 448)
      c.box("Provider · Anthropic (ZjshN)", m.anthropic, { h: 58 })
      y("Provider · Anthropic", m.anthropic, 538)
      c.box("Anthropic Host Tile (TUMTu)", m.anthropicTile, { bg: agentSoft, color: agent })
      c.box("Anthropic · Detail (cDi2t)", m.detail, {
        h: 198,
        gap: 10,
        pad: [16, 16, 16, 16],
        bg: subtle,
      })
      y("Anthropic · Detail", m.detail, 596)
      c.box("Value Field (purB3)", m.keyField, { h: 28, gap: 6, pad: [0, 4, 0, 8], bg: app })
      c.box("Label (dfPEv)", m.keyLabel, { w: 88, fs: 12, color: secondary })
      c.box("Value (o1wfg)", m.keyValue, { fs: 11, ff: "JetBrains Mono", color: primary })
      c.box("Reveal (u7omGi)", m.fieldIcon, { w: 22, h: 22 })
      c.box("Role (EgJdz)", m.modelRole, { fs: 11, color: tertiary })
      c.box("Select (mnEYU)", m.select, { h: 28, bg: app })
      c.box("Storage (QVK53)", m.storage, { fs: 11, color: tertiary })
      c.box("Test Result (TUwHz)", m.test, { h: 27, gap: 8, pad: [6, 10, 6, 10] })
      c.box("Connection OK (V6uV2)", m.testLabel, { fs: 11, fw: "600", color: success })
      c.box("Provider · OpenAI-compatible (HNxdv)", m.openai, { h: 58 })
      y("Provider · OpenAI-compatible", m.openai, 794)
      y("Provider · Bedrock · Vertex · Foundry", m.cloud, 1026)
      c.box("Group · Usage & limits (tAaTK)", m.usageGroup, { h: 78, pad: [24, 0, 4, 0] })
      y("Group · Usage & limits", m.usageGroup, 1084)
      c.box("Usage Card (DCGkU)", m.usage, { h: 111, gap: 12, pad: [16, 16, 16, 16] })
      y("Usage Card", m.usage, 1162)
      c.box("Spent (vOwJ8)", m.spent, { fs: 28, fw: "600", ls: -0.6, h: 34 })
      c.box("Meter (GIpCW)", m.meter, { h: 6, w: 528 })
      c.box("Breakdown (b8OQv)", m.breakdown, { gap: 16, h: 15 })
      c.box("Setting · Monthly limit (RNTFy)", m.limit, { h: 73 })
      y("Setting · Monthly limit", m.limit, 1273)
      c.box("Setting · Warn per turn (VgFYb)", m.warn, { h: 73 })
      c.box("Setting · Show cost (UtSey)", m.cost, { h: 57 })
      y("Setting · Show cost", m.cost, 1419)
      c.box("Amount Field (pdL0w)", m.amount, { w: 96, h: 28, gap: 4, pad: [0, 8, 0, 8] })
      c.flush()
      expect(
        (await page.locator(".ai-usage__spent").textContent()) === "$18.42",
        "usage to date $18.42",
      )
      expect(
        (await page.locator(".ai-usage__tokens").textContent()) === "2.31M tokens · 64 sessions",
        "tokens · sessions",
      )
      if (ctx.shots)
        await page
          .locator(".settings-window")
          .screenshot({ path: join(ctx.shots, "m6-ai-settings.png") })

      // Monthly limit edits persist (no Save button).
      const amount = page.locator('[data-pen="RNTFy"] .ai-amount__value')
      await amount.fill("75")
      await amount.press("Enter")
      await page.waitForFunction(
        () =>
          (window as unknown as Ai).__ai.ctl.state.settings &&
          ((window as unknown as Ai).__ai.ctl.state.settings as { monthlyLimitUsd: number })
            .monthlyLimitUsd === 75,
      )
      // Remove the key → Not set.
      await page.getByRole("button", { name: "Remove key" }).click()
      await page.waitForFunction(
        () =>
          (window as unknown as Ai).__ai.ctl.state.providers.find((p) => p.id === "anthropic")
            ?.status === "not-set",
      )
    },
  },
  {
    name: "m6-ai: Settings › AI providers (web) — no CLIs, BWkRR key field, paste → auto Test, opt-in; measured",
    async run(ctx) {
      const { page } = ctx
      await open(ctx, "scene=settings-web&providers=none")
      expect((await page.locator(".ai-group--local").count()) === 0, "no Local agents on web")
      await page
        .locator('.ai-provider-row[data-provider="anthropic"]')
        .getByRole("button", { name: "Add key" })
        .click()
      const input = page.locator('.ai-detail[data-provider="anthropic"] input[type="password"]')
      await input.focus()
      // Paste → auto Test.
      await page.evaluate((key) => {
        const el = document.querySelector(
          '.ai-detail[data-provider="anthropic"] input[type="password"]',
        ) as HTMLInputElement
        const dt = new DataTransfer()
        dt.setData("text", key)
        el.dispatchEvent(
          new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
        )
      }, "sk-ant-api03-test-3f9a")
      // Without the browser opt-in the Test explains why (Anthropic requires it on web).
      await page.locator(".ai-test--fail").waitFor()
      expect((await state(page)).noProvider, "web Anthropic without the opt-in is unavailable")
      await page.getByRole("switch", { name: "Allow Anthropic calls from the browser" }).click()
      await page.locator(".ai-test--ok").waitFor()
      await page.waitForFunction(() => !(window as unknown as Ai).__ai.ctl.state.noProvider)
      const st = await state(page)
      expect(st.defaultSelection?.provider === "anthropic", "Anthropic is the default on web")
      const m = await measure(page, {
        card: ".ai-detail--web",
        banner: ".ai-detail--web .kimo-banner",
        body: ".ai-detail__body",
        field: ".ai-detail__body .ai-value-field",
        optin: ".ai-detail__body .ai-optin",
        optinLabel: ".ai-optin__label",
        optinDesc: ".ai-optin__desc",
        storage: ".ai-detail__body .ai-storage__label",
      })
      const c = checker(ctx, "Settings › AI providers web variant (BWkRR)")
      const [app, warnSoft] = await Promise.all([
        token(page, "--kimo-bg-app"),
        page.evaluate(() => {
          const el = document.createElement("div")
          el.style.background = "var(--kimo-warning-soft)"
          document.body.append(el)
          const v = getComputedStyle(el).backgroundColor
          el.remove()
          return v
        }),
      ])
      c.box("Web Variant (BWkRR)", m.card, { radius: 16, bg: app })
      c.box("Banner · Browser key (z4bEgw)", m.banner, { bg: warnSoft })
      c.box("Body (Fkjob)", m.body, { gap: 10, pad: [16, 16, 16, 16] })
      c.box("Value Field (cPPeT)", m.field, { h: 28 })
      c.box("Opt-in (N0dsja)", m.optin, { gap: 10, h: 49 })
      c.box("Label (M6jMjY)", m.optinLabel, { fs: 12, fw: "500" })
      c.box("Desc (EGsxi)", m.optinDesc, { fs: 11, lh: 15.95 })
      c.box("Storage (APhlk)", m.storage, { fs: 11, ff: "JetBrains Mono" })
      c.flush()
      expect(
        (await page.locator(".ai-detail__body .ai-storage__label").textContent()) ===
          "localStorage · kimo.providers (this origin only)",
        "web storage copy",
      )
      if (ctx.shots)
        await page
          .locator(".settings-window")
          .screenshot({ path: join(ctx.shots, "m6-ai-web.png") })
    },
  },
  {
    name: "m6-ai: Home composer submit → <title>.kimo (never overwriting), progress, hand-off; measured",
    async run(ctx) {
      const { page } = ctx
      await open(ctx, "scene=home&providers=key")
      await page.locator(".home-ai__composer").waitFor()
      const ta = page.getByRole("textbox", { name: "Describe what to design" })
      await ta.click()
      await page
        .locator(".home-ai__title-row .kimo-agent-mark, .home-ai__title-row [class*='agent-mark']")
        .first()
        .waitFor()
      await ta.fill("A pricing page for a calm budgeting app, three tiers, soft greens")
      await page.getByRole("button", { name: "Send" }).click()
      await page.locator(".home-ai__progress").waitFor()
      await page.getByText("Created Pricing page.kimo").waitFor()
      const m = await measure(page, {
        main: ".m6-home-main",
        section: ".home-ai",
        heading: ".home-ai__heading",
        titleRow: ".home-ai__title-row",
        title: ".home-ai__title",
        composer: ".home-ai__composer",
        send: ".home-ai__send",
        progress: ".home-ai__progress",
        step: ".home-ai__step",
        stepLabel: ".home-ai__step--active .home-ai__step-label",
        meta: ".home-ai__step-meta",
      })
      const c = checker(ctx, "Home composer · submitted (fYVvl / o8YoQ)")
      const agent = await page.evaluate(() => {
        const el = document.createElement("div")
        el.style.background = "var(--kimo-agent)"
        document.body.append(el)
        const v = getComputedStyle(el).backgroundColor
        el.remove()
        return v
      })
      c.box("Home Main (xHCjM)", m.main, { w: 636, gap: 16, pad: [24, 24, 24, 24] })
      c.box("Start With AI (qJahe)", m.section, {
        w: 588,
        gap: 16,
        pad: [28, 28, 28, 28],
        radius: 32,
      })
      c.box("Heading (F3IAW)", m.heading, { gap: 4, w: 532 })
      c.box("Title Row (r8BkUL)", m.titleRow, { gap: 12, h: 34 })
      c.box("Title (q6RZmV)", m.title, { fs: 28, fw: "500", ls: -0.6 })
      c.box("Composer (a4BQlX)", m.composer, { h: 76, w: 532, gap: 10, pad: [12, 12, 10, 16] })
      c.box("Send (J7Jf1)", m.send, { w: 28, h: 28, bg: agent })
      c.box("Progress (uEl8e)", m.progress, { gap: 8, h: 61, w: 532 })
      c.box("Step (ZQ43R)", m.step, { gap: 8, h: 15 })
      c.box("Label (TcI5Y)", m.stepLabel, { fs: 12, fw: "500" })
      c.box("Meta (Y970ym)", m.meta, { fs: 11, ff: "JetBrains Mono" })
      c.flush()
      if (ctx.shots)
        await page
          .locator(".m6-home-main")
          .screenshot({ path: join(ctx.shots, "m6-home-submitted.png") })
      await page.waitForFunction(() => (window as unknown as Ai).__ai.opened.length === 1)
      const openedRef = await page.evaluate(() => (window as unknown as Ai).__ai.opened[0])
      expect(openedRef?.ref === "/Users/me/Kimo/Pricing page.kimo", `opened ${openedRef?.ref}`)
      const h = await page.evaluate(
        (ref) => (window as unknown as Ai).__ai.handoff(ref),
        openedRef?.ref ?? "",
      )
      expect(
        h?.prompt === "A pricing page for a calm budgeting app, three tiers, soft greens",
        "hand-off prompt",
      )
      expect(typeof h?.owner === "string" && String(h?.owner).startsWith("agent:kimo."), "owner")
    },
  },
  {
    name: "m6-ai: Home first run (no provider) → card, blocked composer, Test & save sends the queued prompt; measured",
    async run(ctx) {
      const { page } = ctx
      await open(ctx, "scene=home&providers=none")
      await page.locator(".home-ai-card").waitFor()
      expect(await page.getByRole("button", { name: "Send" }).isDisabled(), "send disabled")
      expect((await page.locator(".home-ai__chips").count()) === 0, "card replaces the chips")
      const m = await measure(page, {
        section: ".home-ai",
        title: ".home-ai__title",
        card: ".home-ai-card",
        head: ".home-ai-card__head",
        tile: ".home-ai-card__tile",
        cardTitle: ".home-ai-card__title",
        cardDesc: ".home-ai-card__desc",
        providers: ".home-ai-card__providers",
        primary: ".home-ai-card__provider.is-selected",
        secondary: ".home-ai-card__provider:not(.is-selected)",
        keyRow: ".home-ai-card__key-row",
        keyField: ".home-ai-card__key-field",
        connect: ".home-ai-card__connect",
        footer: ".home-ai-card__footer",
        link: ".home-ai-card__link",
        skip: ".home-ai-card__skip",
        composer: ".home-ai__composer",
      })
      const c = checker(ctx, "Home composer · first run (XsZVb)")
      const top = m.section?.y ?? 0
      const y = (el: string, b: Box | null | undefined, want: number) =>
        c.check(el, "y (in Start With AI)", b ? b.y - top : null, want, 1.5)
      c.box("Start With AI · No provider (CRnOE)", m.section, { w: 588, h: 407 })
      c.box("Title (RZgmJ)", m.title, { fs: 28, fw: "600", ls: -0.5, h: 34 })
      c.box("Empty State (H33gp)", m.card, {
        w: 532,
        h: 209,
        gap: 14,
        pad: [20, 20, 20, 20],
        radius: 24,
      })
      y("Empty State", m.card, 78)
      c.box("Head (FVt9Y)", m.head, { gap: 12, h: 52 })
      c.box("Tile (WGqeg)", m.tile, { w: 36, h: 36 })
      c.box("Title (Q3Bxz)", m.cardTitle, { fs: 14, fw: "600" })
      c.box("Desc (g8zoaG)", m.cardDesc, { fs: 11, lh: 15.95 })
      c.box("Provider Buttons (TVv9O)", m.providers, { gap: 6, h: 30 })
      c.box("Anthropic (DN1Hw)", m.primary, { h: 30, pad: [0, 12, 0, 12], fs: 12 })
      c.box("OpenAI (L3Vj8)", m.secondary, { h: 30, pad: [0, 10, 0, 10] })
      c.box("Key Row (bCoL9)", m.keyRow, { gap: 8, h: 32 })
      c.box("Key Field (yrAll)", m.keyField, { h: 32, gap: 6, pad: [0, 10, 0, 10] })
      c.box("Connect (o9mR4)", m.connect, { h: 32, pad: [0, 14, 0, 14] })
      c.box("Footer (oHxwJ)", m.footer, { gap: 12, h: 13 })
      c.box("Get key (op3mJ)", m.link, { fs: 11 })
      c.box("Skip (k5dV3Y)", m.skip, { fs: 11, fw: "500" })
      c.box("Composer · blocked (cObts)", m.composer, { h: 76, opacity: "0.5" })
      y("Composer · blocked", m.composer, 303)
      c.flush()
      if (ctx.shots)
        await page
          .locator(".m6-home-main")
          .screenshot({ path: join(ctx.shots, "m6-home-first-run.png") })
      // Queue a prompt, add a key → Test & save → the queued prompt is sent.
      await page.getByRole("textbox", { name: "Describe what to design" }).fill("A pricing page")
      await page.getByRole("textbox", { name: "Anthropic API key" }).fill("sk-ant-api03-test-3f9a")
      await page.getByRole("button", { name: "Test & save" }).click()
      await page.waitForFunction(() => (window as unknown as Ai).__ai.opened.length === 1)
      expect(!(await state(page)).noProvider, "provider added")
    },
  },
  {
    name: "m6-ai: Home first run — wrong key shows the error; Design by hand dismisses the card",
    async run(ctx) {
      const { page } = ctx
      await open(ctx, "scene=home&providers=none")
      await page.getByRole("textbox", { name: "Anthropic API key" }).fill("sk-ant-wrong")
      await page.getByRole("button", { name: "Test & save" }).click()
      await page.locator(".home-ai-card__error").waitFor()
      await page.getByRole("button", { name: "Design by hand instead" }).click()
      await page.waitForFunction(() => (window as unknown as Ai).__ai.opened.length === 1)
      await page.locator(".home-ai-card").waitFor({ state: "detached" })
      expect((await page.locator(".home-ai__chips").count()) === 1, "chips back")
    },
  },
]
