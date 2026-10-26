/**
 * Board 25 "v1 Polish" §4 AI providers (bM295) and §5 Agent tab (p55vU) on the M6 harnesses
 * (`e2e/m6-ai-harness`, `e2e/m6-agent-harness`). One measured getComputedStyle /
 * getBoundingClientRect pass per surface against the desing.pen node values: Add provider
 * dialog (uOwr0), failed test strip + Details (MrP5Y / FhxWF), cloud cards (YewZG), first run
 * with a CLI (FrS9y) and with nothing (D8covN), approval card (OlhpU), refusal (dIkT6), generic
 * error (u8mh7l).
 */
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import type { Page } from "playwright"
import { build } from "vite"
import { checker, measure, token } from "./m6-helpers"
import { type E2EContext, expect, type Scenario } from "./run"

const here = dirname(fileURLToPath(import.meta.url))
const builds: Record<string, Promise<string>> = {}

function harness(ctx: E2EContext, name: "m6-ai-harness" | "m6-agent-harness"): Promise<string> {
  if (process.env.KIMO_E2E_DEV === "1") return Promise.resolve(`${ctx.url}e2e/${name}/index.html`)
  const out = `board25-${name}`
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

const shadowHas = (page: Page, sel: string, color: string) =>
  page.evaluate(
    ([s, c]) =>
      getComputedStyle(document.querySelector(s as string) as Element).boxShadow.includes(
        c as string,
      ),
    [sel, color],
  )

const ACME_KEY = "acme_live_test_7c21"

export const scenarios: Scenario[] = [
  {
    name: "board25: Add provider dialog (uOwr0) + measured",
    async run(ctx) {
      const { page } = ctx
      await open(ctx, "m6-ai-harness", "scene=settings-desktop&providers=key")
      await page.locator('.ai-group--providers button:has-text("Add provider")').click()
      const dlg = page.locator("[data-testid=add-provider-dialog]")
      await dlg.waitFor()
      await page.fill("#add-name", "Acme gateway")
      await page.fill("#add-url", "https://llm.acme.internal/v1")
      await page.fill("#add-key", ACME_KEY)
      await dlg.locator("button:has-text('Fetch /models')").click()
      await dlg.locator(".ai-add__chip").nth(1).waitFor()
      const m = await measure(page, {
        dialog: ".ai-add",
        head: ".ai-add__head",
        iconWrap: ".ai-add__icon-wrap",
        title: ".ai-add__title",
        desc: ".ai-add__desc",
        body: ".ai-add__body",
        field: '.ai-add__field[data-pen="mjxjz"]',
        label: '.ai-add__field[data-pen="mjxjz"] .ai-add__label',
        value: '[data-pen="p8jZmn"]',
        url: '[data-pen="VMdpU"] input',
        auth: '[data-pen="q7PGg"]',
        preview: '[data-pen="bwOPU"]',
        chip: ".ai-add__chip",
        chipLabel: ".ai-add__chip-label",
        fetch: ".ai-add__fetch",
        pin: '[data-pen="W2ERTF"]',
        pinText: ".ai-add__pin-text",
        storage: '[data-pen="F1hbeP"]',
        footer: '[data-pen="ThgQE"]',
        test: '[data-pen="Opv6O"]',
        cancel: '[data-pen="snjit"]',
        add: '[data-pen="AHKbr"]',
      })
      const c = checker(ctx, "Add provider (uOwr0)")
      const overlay = await token(page, "--kimo-bg-overlay")
      const secondary = await token(page, "--kimo-text-secondary")
      const tertiary = await token(page, "--kimo-text-tertiary")
      const muted = await token(page, "--kimo-bg-muted")
      const subtle = await token(page, "--kimo-bg-subtle")
      c.box("Dialog uOwr0", m.dialog, {
        w: 520,
        pad: [20, 20, 20, 20],
        gap: 14,
        radius: 24,
        bg: overlay,
      })
      c.box("Head x8Lc26", m.head, { gap: 12 })
      c.box("Icon Wrap", m.iconWrap, { w: 32, h: 32, bg: muted })
      c.box("Title", m.title, { fs: 14, fw: "600", h: 17 })
      c.box("Desc", m.desc, { fs: 12, color: secondary })
      c.box("Body kumFs", m.body, { gap: 10, w: 480 })
      c.box("Field · Name", m.field, { gap: 8, h: 28 })
      c.box("Label", m.label, { w: 96, fs: 12, color: secondary })
      c.box("Value Field p8jZmn", m.value, { h: 28, w: 376, pad: [0, 4, 0, 8], radius: 6 })
      c.box("Base URL value (mono)", m.url, { fs: 11, ff: "JetBrains Mono" })
      c.box("Auth Scheme q7PGg", m.auth, { gap: 6, w: 376 })
      c.box("Preview bwOPU", m.preview, { fs: 11, color: tertiary, h: 15 })
      c.box("Chip nFXEe", m.chip, { h: 24, pad: [0, 6, 0, 10], gap: 4, bg: muted, radius: 999 })
      c.box("Chip label", m.chipLabel, { fs: 11, h: 15 })
      c.box("Fetch avnRN", m.fetch, { h: 24, pad: [0, 10, 0, 8], gap: 4, fs: 11, color: secondary })
      c.box("Origin Pin Note W2ERTF", m.pin, {
        pad: [8, 10, 8, 10],
        gap: 8,
        radius: 10,
        bg: subtle,
        w: 480,
      })
      c.box("Pin text", m.pinText, { fs: 11, color: secondary })
      c.box("Storage F1hbeP", m.storage, { gap: 6, h: 15 })
      c.box("Footer ThgQE", m.footer, { gap: 8, h: 28 })
      c.box("Test connection", m.test, { h: 28, pad: [0, 12, 0, 12] })
      c.box("Cancel", m.cancel, { h: 28, pad: [0, 12, 0, 12] })
      c.box("Add provider", m.add, { h: 28, pad: [0, 12, 0, 12] })
      c.flush()
      expect(
        (await page.locator(".ai-add__chip-label").allTextContents()).join() ===
          "llama-3.3-70b,qwen2.5-coder",
        "Fetch /models fills the chips",
      )
      await dlg.locator('[data-pen="AHKbr"]').click()
      await dlg.waitFor({ state: "detached" })
      await page
        .locator('.ai-provider-row[data-provider="custom:acme-gateway"][data-status="connected"]')
        .waitFor()
      await page.locator('.ai-detail[data-provider="custom:acme-gateway"] .ai-test--ok').waitFor()
    },
  },
  {
    name: "board25: failed test strip + Details (MrP5Y / FhxWF) + measured",
    async run(ctx) {
      const { page } = ctx
      await open(ctx, "m6-ai-harness", "scene=settings-desktop&providers=key")
      await page.locator('.ai-group--providers button:has-text("Add provider")').click()
      await page.fill("#add-name", "Acme gateway")
      await page.fill("#add-url", "https://llm.acme.internal/v1")
      await page.fill("#add-key", "acme_live_wrong_9999")
      await page.fill(".ai-add__chip-input", "llama-3.3-70b")
      await page.locator('[data-pen="AHKbr"]').click()
      const strip = page.locator(
        '.ai-detail[data-provider="custom:acme-gateway"] [data-pen="MrP5Y"]',
      )
      await strip.waitFor()
      expect(
        (
          await page.locator('.ai-provider-row[data-provider="custom:acme-gateway"]').textContent()
        )?.includes("Not verified"),
        "a failing first Test leaves it Not verified",
      )
      const danger = await token(page, "--kimo-danger")
      const dangerSoft = await token(page, "--kimo-danger-soft")
      const m = await measure(page, {
        strip: '[data-pen="MrP5Y"]',
        icon: '[data-pen="MrP5Y"] .ai-test__icon',
        label: '[data-pen="MrP5Y"] .ai-test__label',
        detail: '[data-pen="MrP5Y"] .ai-test__detail',
        action: '[data-pen="MrP5Y"] .ai-test__action',
      })
      const c = checker(ctx, "Failed test (MrP5Y)")
      c.box("Strip", m.strip, { pad: [6, 10, 6, 10], gap: 8, radius: 6, bg: dangerSoft, h: 27 })
      c.box("Icon circle-x", m.icon, { w: 14, h: 14, color: danger })
      c.box("Label", m.label, { fs: 11, fw: "600", color: danger, h: 13 })
      c.box("Detail", m.detail, { fs: 11, ff: "JetBrains Mono", h: 15 })
      c.box("Action Details", m.action, { fs: 11, fw: "500", h: 13 })
      c.check(
        "Label text",
        "value",
        await page.locator('[data-pen="MrP5Y"] .ai-test__label').textContent(),
        "Connection failed",
      )
      c.check(
        "Detail text",
        "value",
        await page.locator('[data-pen="MrP5Y"] .ai-test__detail').textContent(),
        "401 · invalid api key",
      )
      c.check(
        "API key field danger stroke",
        "value",
        String(
          await shadowHas(
            page,
            '.ai-detail[data-provider="custom:acme-gateway"] [data-pen="purB3"]',
            danger,
          ),
        ),
        "true",
      )
      await strip.locator(".ai-test__action").click()
      await page.locator('[data-pen="FhxWF"]').waitFor()
      const e = await measure(page, {
        exp: '[data-pen="FhxWF"]',
        head: '[data-pen="tsAzG"]',
        details: '[data-pen="bWSl9"]',
        line: '[data-pen="bWSl9"] .ai-test__line',
        actions: '[data-pen="KTl6a"]',
        retry: '[data-pen="KTl6a"] .kimo-button:first-child',
        retryIcon: '[data-pen="KTl6a"] .kimo-button:first-child .kimo-button__icon',
      })
      c.box("Expanded FhxWF", e.exp, { pad: [8, 10, 8, 10], gap: 8, radius: 6, bg: dangerSoft })
      c.box("Head tsAzG", e.head, { gap: 8, h: 15 })
      c.box("Details bWSl9", e.details, {
        pad: [6, 8, 6, 8],
        gap: 2,
        radius: 4,
        bg: await token(page, "--kimo-bg-app"),
      })
      c.box("Line", e.line, { fs: 11, h: 15, ff: "JetBrains Mono" })
      c.box("Actions KTl6a", e.actions, { gap: 6, h: 24 })
      c.box("Retry test", e.retry, { h: 24, pad: [0, 10, 0, 10], fs: 11 })
      c.box("Retry icon", e.retryIcon, { w: 12, h: 12 })
      c.flush()
      const lines = await page.locator('[data-pen="bWSl9"] .ai-test__line').allTextContents()
      expect(lines[0] === "GET https://llm.acme.internal/v1/models", `request line: ${lines[0]}`)
      expect(/^← 401 Unauthorized · \d+ ms$/.test(lines[1] ?? ""), `status line: ${lines[1]}`)
      expect(lines[2] === '{"error":{"code":"invalid_api_key"}}', `body: ${lines[2]}`)
      expect(lines[3] === "auth: Authorization: Bearer …9999", `auth: ${lines[3]}`)
    },
  },
  {
    name: "board25: cloud set-up cards (YewZG / bSx6y / g7Uzta) + measured",
    async run(ctx) {
      const { page } = ctx
      await open(ctx, "m6-ai-harness", "scene=settings-desktop&providers=key")
      await page
        .locator('.ai-provider-row[data-provider="bedrock"] button:has-text("Set up")')
        .click()
      await page.locator('[data-pen="g7Uzta"]').waitFor()
      const m = await measure(page, {
        stage: '[data-pen="HPWcv"]',
        card: '[data-pen="YewZG"]',
        head: '[data-pen="da1Bb"]',
        tile: '[data-pen="YewZG"] .ai-cloud__tile',
        title: '[data-pen="YewZG"] .ai-cloud__title',
        pill: '[data-pen="YewZG"] .ai-cloud__pill',
        field: '[data-pen="Wqt1R"]',
        label: '[data-pen="Wqt1R"] .ai-add__label',
        select: '[data-pen="Wqt1R"] .kimo-select__trigger',
        hint: '[data-pen="Y0owv"]',
        hintText: '[data-pen="Y0owv"] .ai-cloud__hint-text',
        profile: '[data-pen="VSebY"]',
      })
      const c = checker(ctx, "Cloud cards (gpmey)")
      const app = await token(page, "--kimo-bg-app")
      c.box("Stage gap", m.stage, { gap: 12 })
      c.box("Detail · Amazon Bedrock", m.card, {
        pad: [16, 16, 16, 16],
        gap: 10,
        radius: 16,
        bg: app,
      })
      c.box("Head da1Bb", m.head, { gap: 8, h: 24 })
      c.box("Tile", m.tile, { w: 24, h: 24, radius: 6, bg: await token(page, "--kimo-bg-muted") })
      c.box("Title", m.title, { fs: 12, fw: "600", h: 15 })
      c.box("Desktop only pill", m.pill, { h: 17 })
      c.box("Field · Region", m.field, { gap: 8, h: 28 })
      c.box("Label", m.label, { w: 96, fs: 12 })
      c.box("Select", m.select, { h: 28, bg: app })
      c.box("Profile value field", m.profile, { h: 28, pad: [0, 4, 0, 8] })
      c.box("Hint Y0owv", m.hint, { gap: 6 })
      c.box("Hint text", m.hintText, { fs: 11, color: await token(page, "--kimo-text-tertiary") })
      c.flush()
      // Vertex: the project id is stored on its card; the other clouds keep theirs.
      await page.fill("#vertex-project", "acme-design-prod")
      await page.press("#vertex-project", "Enter")
      await page.waitForFunction(
        () =>
          (
            window as unknown as {
              __ai: { ctl: { storedOf(id: string): { project?: string } | undefined } }
            }
          ).__ai.ctl.storedOf("vertex")?.project === "acme-design-prod",
      )
    },
  },
  {
    name: "board25: Agent tab first run — CLI found (FrS9y) + measured",
    async run(ctx) {
      const { page } = ctx
      await open(ctx, "m6-agent-harness", "runtime=first-cli")
      await page.locator("[data-testid=agent-first-run-cli]").waitFor()
      const m = await measure(page, {
        body: '[data-pen="E3icY"]',
        mark: '[data-pen="E3icY"] .kimo-agent-mark',
        title: ".agent-first-run__title",
        desc: ".agent-first-run__desc",
        card: '[data-pen="fFG6G"]',
        row: '[data-pen="K8IHwR"]',
        tile: ".agent-first-run__tile",
        name: ".agent-first-run__name",
        path: ".agent-first-run__path",
        use: '[data-pen="jfK4g"]',
        note: ".agent-first-run__note",
        link: ".agent-first-run__link",
        composer: "[data-testid=agent-composer]",
      })
      const c = checker(ctx, "First run · CLI (FrS9y)")
      c.box("Body E3icY", m.body, { pad: [16, 24, 16, 24], gap: 12 })
      c.box("AgentMark/32/Listening", m.mark, { w: 32, h: 32 })
      c.box("Title", m.title, { fs: 16, fw: "600", h: 19 })
      c.box("Desc", m.desc, { fs: 12, w: (m.body?.w ?? 0) - 48 })
      c.box("Detected fFG6G", m.card, {
        pad: [12, 12, 12, 12],
        gap: 10,
        radius: 16,
        bg: await token(page, "--kimo-bg-subtle"),
      })
      c.box("Row", m.row, { gap: 10, h: 34 })
      c.box("Host Tile", m.tile, { w: 32, h: 32, radius: 10 })
      c.box("Name", m.name, { fs: 12, fw: "500" })
      c.box("Path", m.path, { fs: 11, h: 15, ff: "JetBrains Mono" })
      c.box("Use Claude Code", m.use, { h: 32, pad: [0, 12, 0, 12], w: (m.card?.w ?? 0) - 24 })
      c.box("Note", m.note, { fs: 11 })
      c.box("Alt link", m.link, { fs: 11, fw: "500", h: 13, gap: 4 })
      c.check(
        "Composer opacity",
        "value",
        await page.evaluate(
          () =>
            getComputedStyle(document.querySelector("[data-testid=agent-composer]") as Element)
              .opacity,
        ),
        "0.5",
      )
      c.flush()
      expect(
        (await page
          .locator("[data-testid=agent-composer] textarea")
          .getAttribute("placeholder")) === "Connect a model to start",
        "composer copy",
      )
      await page.locator('[data-pen="jfK4g"]').click()
      await page.locator("[data-testid=agent-thread-title]").waitFor()
      expect(
        !(await page.locator("[data-testid=agent-composer] textarea").isDisabled()),
        "composer enabled after Use Claude Code",
      )
    },
  },
  {
    name: "board25: Agent tab first run — nothing found (D8covN) + measured",
    async run(ctx) {
      const { page } = ctx
      await open(ctx, "m6-agent-harness", "runtime=first-key")
      await page.locator("[data-testid=agent-first-run-key]").waitFor()
      const m = await measure(page, {
        card: '[data-pen="rPDtX"]',
        labelRow: ".agent-first-run__label-row",
        keyIcon: ".agent-first-run__key-icon",
        field: '[data-pen="WxxLI"]',
        input: ".agent-first-run__input",
        connect: '[data-pen="kBBgE"]',
        other: '[data-pen="tp7XM"]',
        hint: ".agent-first-run__hint",
      })
      const c = checker(ctx, "First run · none (D8covN)")
      c.box("Key Card rPDtX", m.card, { pad: [12, 12, 12, 12], gap: 8, radius: 16 })
      c.box("Label Row", m.labelRow, { gap: 6, h: 15 })
      c.box("key-round", m.keyIcon, { w: 14, h: 14, color: await token(page, "--kimo-agent") })
      c.box("Key Field", m.field, { h: 32, pad: [0, 10, 0, 10], radius: 6 })
      c.box("Input mono", m.input, { fs: 11, ff: "JetBrains Mono" })
      c.box("Connect", m.connect, { h: 32 })
      c.box("Other", m.other, { gap: 6 })
      c.box("CLI hint", m.hint, { fs: 11, h: 13 })
      c.flush()
      await page.fill("#agent-first-run-key", "sk-ant-wrong-0000")
      await page.locator('[data-pen="kBBgE"]').click()
      await page.locator(".agent-first-run__error").waitFor()
      await page.fill("#agent-first-run-key", "sk-ant-api03-test-3f9a")
      await page.locator('[data-pen="kBBgE"]').click()
      await page.locator("[data-testid=agent-thread-title]").waitFor()
    },
  },
  {
    name: "board25: approval card (OlhpU), refusal (dIkT6), generic error (u8mh7l) + measured",
    async run(ctx) {
      const { page } = ctx
      await open(ctx, "m6-agent-harness", "scene=panel")
      await page.evaluate(() => {
        const c = (
          window as unknown as {
            __m6: {
              controller: { setSelection(x: unknown[]): void; setAutoApprove(on: boolean): void }
            }
          }
        ).__m6.controller
        c.setSelection([{ id: "Hero000001", name: "Hero" }])
        c.setAutoApprove(false) // "Ask before changes" on: the card shows
      })
      const ta = page.locator("[data-testid=agent-composer] textarea")
      await ta.fill("Clean up the legacy cards")
      await ta.press("Enter")
      await page.locator('[data-pen="OlhpU"]').waitFor()
      const agent = await token(page, "--kimo-agent")
      const m = await measure(page, {
        card: '[data-pen="OlhpU"]',
        head: ".kimo-approval-card__head",
        mark: ".kimo-approval-card__head .kimo-agent-mark",
        title: ".kimo-approval-card__title",
        waiting: ".kimo-approval-card__waiting",
        ops: ".kimo-approval-card__ops",
        op: ".kimo-approval-card__op",
        opLabel: ".kimo-approval-card__op-label",
        opMeta: ".kimo-approval-card__op-meta",
        actions: ".kimo-approval-card__actions",
        allow: '.kimo-approval-card__actions [data-choice="once"]',
      })
      const c = checker(ctx, "Approval card (OlhpU)")
      c.box("Card", m.card, {
        pad: [12, 12, 12, 12],
        gap: 10,
        radius: 16,
        bg: await token(page, "--kimo-bg-app"),
      })
      c.check(
        "Card stroke $agent",
        "value",
        String(await shadowHas(page, '[data-pen="OlhpU"]', agent)),
        "true",
      )
      c.box("Head", m.head, { gap: 8, h: 15 })
      c.box("AgentMark/12", m.mark, { w: 12, h: 12 })
      c.box("Title", m.title, { fs: 12, fw: "600", h: 15 })
      c.box("Waiting", m.waiting, {
        gap: 4,
        fs: 11,
        color: await token(page, "--kimo-text-tertiary"),
      })
      c.box("Ops G9V6Kf", m.ops, {
        pad: [8, 10, 8, 10],
        gap: 6,
        radius: 10,
        bg: await token(page, "--kimo-bg-subtle"),
      })
      c.box("Op row", m.op, { gap: 8, h: 14 })
      c.box("Op label", m.opLabel, { fs: 11, fw: "500", h: 13 })
      c.box("Op meta", m.opMeta, { fs: 11, h: 13 })
      c.box("Actions v26S3I", m.actions, { gap: 4, h: 28 })
      c.box("Allow once", m.allow, { h: 28, pad: [0, 10, 0, 10], fs: 12 })
      c.flush()
      const ops = await page.locator(".kimo-approval-card__op").allTextContents()
      ctx.log(`approval ops: ${ops.join(" | ")}`)
      expect(ops.length > 0 && ops.every((o) => o.trim() !== ""), `op rows: ${ops.join(" | ")}`)
      expect(
        (await ta.getAttribute("placeholder")) === "Kimo is waiting for your approval…",
        "composer waits for the approval",
      )
      await page.locator('.kimo-approval-card__actions [data-choice="deny"]').click()
      await page.locator('[data-pen="OlhpU"]').waitFor({ state: "detached" })
      await page.waitForFunction(
        () =>
          !(window as unknown as { __m6: { controller: { state: { busy: boolean } } } }).__m6
            .controller.state.busy,
      )

      await ta.fill("Draw the Stripe logo exactly")
      await ta.press("Enter")
      await page.locator('[data-pen="dIkT6"]').waitFor()
      const r = await measure(page, {
        card: '[data-pen="dIkT6"]',
        icon: '[data-pen="dIkT6"] .kimo-error-card__icon',
        title: '[data-pen="dIkT6"] .kimo-error-card__title',
        desc: '[data-pen="dIkT6"] .kimo-error-card__desc',
        edit: '[data-pen="dIkT6"] [data-action="edit_request"]',
        indent: '.agent-panel__indent:has([data-pen="dIkT6"])',
      })
      const cr = checker(ctx, "Refusal (dIkT6)")
      cr.box("Card", r.card, {
        pad: [10, 12, 10, 12],
        gap: 8,
        radius: 16,
        bg: await token(page, "--kimo-bg-subtle"),
      })
      cr.box("hand icon", r.icon, {
        w: 14,
        h: 14,
        color: await token(page, "--kimo-text-secondary"),
      })
      cr.box("Title", r.title, { fs: 12, fw: "600" })
      cr.box("Desc", r.desc, { fs: 11, color: await token(page, "--kimo-text-secondary") })
      cr.box("Edit request", r.edit, { h: 26, pad: [0, 10, 0, 10] })
      cr.box("Indent FcFFi", r.indent, { pad: [0, 0, 0, 34] })
      cr.flush()
      await page.locator('[data-pen="dIkT6"] [data-action="edit_request"]').click()
      expect((await ta.inputValue()) === "Draw the Stripe logo exactly", "Edit request prefills")

      await ta.fill("This one is broken")
      await ta.press("Enter")
      await page.locator('[data-pen="u8mh7l"]').waitFor()
      const g = await measure(page, {
        card: '[data-pen="u8mh7l"]',
        icon: '[data-pen="u8mh7l"] .kimo-error-card__icon',
      })
      const cg = checker(ctx, "Generic error (u8mh7l)")
      cg.box("Card", g.card, {
        pad: [10, 12, 10, 12],
        gap: 8,
        radius: 16,
        bg: await token(page, "--kimo-danger-soft"),
      })
      cg.box("circle-x", g.icon, { w: 14, h: 14, color: await token(page, "--kimo-danger") })
      cg.check(
        "Title",
        "value",
        await page.locator('[data-pen="u8mh7l"] .kimo-error-card__title').textContent(),
        "Something went wrong",
      )
      cg.check(
        "icon is circle-x",
        "value",
        String(await page.locator('[data-pen="u8mh7l"] svg.lucide-circle-x').count()),
        "1",
      )
      cg.check(
        "Actions",
        "value",
        (await page.locator('[data-pen="u8mh7l"] .kimo-button__label').allTextContents()).join(
          " · ",
        ),
        "Retry · Copy error",
      )
      cg.flush()
    },
  },
]
