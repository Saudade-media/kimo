/**
 * Board 43 "Kimo Cloud" (desing.pen yj64A), end to end over the board 43 harness and an in-page
 * fake Kimo Cloud (signed requests verified): Choose with Kimo Cloud first and Host your own
 * collapsed, opening it; Sign in with an email link (2 A, 2 B polling, 2 C when the link is
 * opened, 2 E); Subscribe (3 A, 3 B checkout opened and polled, 3 C ready, 3 D failed); the Share
 * popover (4 A, 4 A2, 4 B, 4 C, 6 A); Settings › Multiplayer (5 A, Manage billing toast, sign out
 * dialogs 5 B, 5 C); the fragments (6 D, E, F) and banners (6 B, C).
 *
 * One measured pass per surface (getComputedStyle + getBoundingClientRect vs the node values),
 * light and dark.
 */
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import type { Page } from "playwright"
import { build } from "vite"
import { checker, measure, tokens } from "./board25-helpers"
import { type E2EContext, expect, type Scenario } from "./run"

const here = fileURLToPath(new URL(".", import.meta.url))
let built: Promise<string> | null = null

async function harnessUrl(ctx: E2EContext): Promise<string> {
  if (process.env.KIMO_E2E_DEV === "1") return `${ctx.url}e2e/board43-harness/index.html`
  built ??= build({
    root: join(here, "board43-harness"),
    configFile: false,
    base: "./",
    logLevel: "error",
    plugins: [react()],
    build: {
      outDir: join(process.env.KIMO_E2E_OUTDIR ?? join(here, ".dist"), "board43"),
      emptyOutDir: true,
      target: "es2022",
    },
  }).then(() => "board43/index.html")
  return `${ctx.url}${await built}`
}

type Theme = "light" | "dark"

async function open(ctx: E2EContext, surface: string, state: string, theme: Theme, extra = "") {
  await ctx.page.setViewportSize({ width: 1280, height: 1000 })
  const errors: string[] = []
  ctx.page.on("pageerror", (e) => errors.push(e.message))
  await ctx.page.goto(
    `${await harnessUrl(ctx)}?run=${Date.now()}&surface=${surface}&state=${state}&theme=${theme}${extra}`,
  )
  await ctx.page
    .waitForFunction(() => document.documentElement.dataset.ready === "1", undefined, {
      timeout: 15_000,
    })
    .catch((e: unknown) => {
      throw new Error(
        `harness ${surface}/${state} (${theme}) did not start: ${errors.join(" | ") || e}`,
      )
    })
  await ctx.page.waitForTimeout(100)
}

const COLORS = [
  "--kimo-bg-app",
  "--kimo-bg-muted",
  "--kimo-bg-subtle",
  "--kimo-bg-overlay",
  "--kimo-text-primary",
  "--kimo-text-secondary",
  "--kimo-text-tertiary",
  "--kimo-text-inverse",
  "--kimo-accent",
  "--kimo-accent-soft",
  "--kimo-accent-text",
  "--kimo-on-accent",
  "--kimo-success",
  "--kimo-success-soft",
  "--kimo-warning",
  "--kimo-warning-soft",
  "--kimo-danger",
  "--kimo-danger-soft",
  "--kimo-border",
  "--kimo-border-strong",
]

const R = { md: 10, lg: 16, xl: 24, pill: 999 }

async function T(page: Page) {
  return (await tokens(page, COLORS)) as Record<string, string>
}

/** Wizard chrome (f4OYFV / ceEr5 / VhJwA / UZAY5 / IqSJT) with board 43's values. */
async function measureWizard(ctx: E2EContext, label: string, bodyGap: number) {
  // No hover state in the measure (the pointer may rest where the last button was).
  await ctx.page.mouse.move(1, 1)
  const t = await T(ctx.page)
  const m = await measure(ctx.page, {
    shell: ".rw-shell",
    head: ".rw-head",
    headIcon: ".rw-head .rw-icon-wrap",
    title: ".rw-head__title",
    sub: ".rw-head__sub",
    stepper: ".rw-stepper",
    dotCurrent: '.rw-step[data-state="current"] .rw-step__dot',
    labelCurrent: '.rw-step[data-state="current"] .rw-step__label',
    dotDone: '.rw-step[data-state="done"] .rw-step__dot',
    connector: ".rw-connector",
    body: ".rw-body",
    footer: ".rw-footer",
    footnote: ".rw-footer .rw-footnote",
    primary: ".rw-footer .kimo-button--primary",
  })
  const c = checker(ctx, label)
  c.box("Wizard (y3RSFV)", m.shell, {
    w: 600,
    radius: R.xl,
    bg: t["--kimo-bg-overlay"],
    border: `1px ${t["--kimo-border"]}`,
    shadowHas: "0px 16px 48px",
    dir: "column",
  })
  c.box("Head (XF7xU)", m.head, { pad: "16 12 12 20", gap: 12, align: "center", dir: "row" })
  c.box("Icon Wrap (u5s7j7)", m.headIcon, {
    w: 32,
    h: 32,
    radius: R.pill,
    bg: t["--kimo-bg-muted"],
    color: t["--kimo-text-primary"],
  })
  c.box("Title (NZ3mA)", m.title, { fs: 14, fw: "600", color: t["--kimo-text-primary"] })
  c.box("Sub (pzSnu)", m.sub, { fs: 11, fw: "400", color: t["--kimo-text-secondary"] })
  c.box("Stepper (kuZs8)", m.stepper, { pad: "0 20 14 20", gap: 8, align: "center" })
  c.box("Dot · current (bl3c7)", m.dotCurrent, {
    w: 18,
    h: 18,
    bg: t["--kimo-accent"],
    color: t["--kimo-on-accent"],
    fs: 10,
    fw: "600",
  })
  c.box("Label · current (NYKAZ)", m.labelCurrent, {
    fs: 12,
    fw: "600",
    color: t["--kimo-text-primary"],
  })
  if (m.dotDone)
    c.box("Dot · done (hZEVG)", m.dotDone, {
      w: 18,
      h: 18,
      bg: t["--kimo-success-soft"],
      color: t["--kimo-success"],
    })
  c.box("Connector (EkRCC)", m.connector, { w: 24, h: 1, bg: t["--kimo-border-strong"] })
  c.box("Body (Qr617)", m.body, { pad: "20 20 20 20", gap: bodyGap, dir: "column" })
  c.box("Footer (p7rbgj)", m.footer, { pad: "12 20 12 20", gap: 8, align: "center" })
  if (m.footnote)
    c.box("Footnote (DgPIX)", m.footnote, { fs: 11, color: t["--kimo-text-tertiary"] })
  if (m.primary)
    c.box("Primary (I8Cabk)", m.primary, {
      h: 30,
      pad: "0 12 0 12",
      bg: t["--kimo-accent"],
      radius: R.pill,
    })
  return { c, t }
}

// --- Section 1 ------------------------------------------------------------------------------------

async function choose(ctx: E2EContext, theme: Theme) {
  const { page } = ctx
  await open(ctx, "wizard", "signed-out", theme)
  const { c, t } = await measureWizard(ctx, `§1 A Choose (${theme})`, 8)
  const m = await measure(page, {
    card: '.rw-option[data-value="cloud"]',
    radio: '.rw-option[data-value="cloud"] .rw-radio',
    icon: '.rw-option[data-value="cloud"] .rw-option__icon',
    titleOpt: '.rw-option[data-value="cloud"] .rw-option__title',
    desc: '.rw-option[data-value="cloud"] .rw-option__desc',
    badge: '.rw-option[data-value="cloud"] .kimo-badge',
    badgeLabel: '.rw-option[data-value="cloud"] .kimo-badge__label',
    disclosure: ".rw-disclosure",
    chevron: ".rw-disclosure__chevron",
    dTitle: ".rw-disclosure .rw-option__title",
    dHint: ".rw-disclosure .rw-option__desc",
  })
  c.box("Option · Kimo Cloud (TxhxO)", m.card, {
    w: 558,
    pad: "12 14 12 14",
    gap: 12,
    align: "center",
    radius: R.md,
    bg: t["--kimo-bg-subtle"],
    shadowHas: `${t["--kimo-accent"]} 0px 0px 0px 1.5px inset`,
  })
  c.box("Radio (uOT1N)", m.radio, {
    w: 16,
    h: 16,
    radius: R.pill,
    bg: t["--kimo-bg-app"],
    shadowHas: `${t["--kimo-accent"]} 0px 0px 0px 5px inset`,
  })
  c.box("Icon Wrap (yAp7P)", m.icon, { w: 32, h: 32, radius: R.md, bg: t["--kimo-bg-muted"] })
  c.box("Title (QNcZO)", m.titleOpt, { fs: 12, fw: "500", color: t["--kimo-text-primary"] })
  c.box("Desc (IXaVH)", m.desc, { fs: 11, color: t["--kimo-text-secondary"] })
  c.box("Badge (t1HSx)", m.badge, { pad: "2 8 2 8", radius: R.pill, bg: t["--kimo-bg-muted"] })
  c.box("Label (C5gcz)", m.badgeLabel, { fs: 11, fw: "500", color: t["--kimo-text-secondary"] })
  c.box("Disclosure · closed (xxZJW)", m.disclosure, {
    w: 558,
    pad: "12 14 12 14",
    gap: 12,
    align: "center",
    radius: R.md,
    bg: "rgba(0, 0, 0, 0)",
    shadowHas: `${t["--kimo-border"]} 0px 0px 0px 1px inset`,
  })
  c.box("Chevron (q5illD)", m.chevron, { w: 16, h: 16, color: t["--kimo-text-secondary"] })
  c.box("Title (ikOCa)", m.dTitle, { fs: 12, fw: "500" })
  c.box("Hint (JLNkj)", m.dHint, { fs: 11, color: t["--kimo-text-secondary"] })
  expect(
    (await page.locator(".rw-option").count()) === 1,
    "Host your own starts collapsed: only Kimo Cloud is listed",
  )
  expect(
    (await page.locator(".rw-footnote").innerText()) === "Self-hosting is always free",
    "footnote",
  )
  const labels = await page.locator(".rw-step__label").allInnerTexts()
  expect(labels.join(",") === "Choose,Sign in,Subscribe", `stepper ${labels}`)
  c.flush()

  // A2: open it. Five paths; Kimo Cloud stays selected until one is picked; then it stays open.
  await page.click(".rw-disclosure")
  const c2 = checker(ctx, `§1 A2 Host your own open (${theme})`)
  const m2 = await measure(page, {
    disclosure: ".rw-disclosure",
    local: '.rw-option[data-value="local"]',
    localRadio: '.rw-option[data-value="local"] .rw-radio',
  })
  c2.box("Disclosure · open (v9lVfI)", m2.disclosure, { bg: t["--kimo-bg-subtle"] })
  c2.box("Option · This computer (usOXn)", m2.local, {
    pad: "12 14 12 14",
    gap: 12,
    bg: "rgba(0, 0, 0, 0)",
    shadowHas: `${t["--kimo-border"]} 0px 0px 0px 1px inset`,
  })
  c2.box("Radio (F4QRr6)", m2.localRadio, {
    shadowHas: `${t["--kimo-border-strong"]} 0px 0px 0px 1.5px inset`,
  })
  c2.flush()
  expect((await page.locator(".rw-option").count()) === 6, "five self-host paths under it")
  expect(
    (await page.getAttribute('.rw-option[data-value="cloud"]', "aria-checked")) === "true",
    "Kimo Cloud stays selected",
  )
  await page.click('.rw-option[data-value="docker"]')
  await page.click(".rw-disclosure")
  expect(
    (await page.getAttribute(".rw-disclosure", "aria-expanded")) === "true",
    "stays open once a self-host path is chosen",
  )
  expect(
    (await page.locator(".rw-step__label").allInnerTexts()).join(",") === "Choose,Set up,Test",
    "self-host stepper",
  )
}

async function chooseSignedIn(ctx: E2EContext, theme: Theme) {
  const { page } = ctx
  await open(ctx, "wizard", "active", theme)
  await page.locator('[data-action="use-cloud"]').waitFor()
  expect(
    (await page.locator('.rw-option[data-value="cloud"] .rw-option__desc').innerText()) ===
      "Signed in as maya@studio.design. Your plan is active.",
    "B desc",
  )
  expect((await page.locator(".rw-footnote").innerText()) === "Nothing to set up", "B footnote")
  const icons = await page.locator('[data-action="use-cloud"] .kimo-button__icon').count()
  expect(icons === 0, "Use Kimo Cloud has no icon")
  await page.click('[data-action="use-cloud"]')
  await page.locator('.rw-shell[data-step="ready"]').waitFor()
  const t = await T(page)
  const m = await measure(page, {
    saved: ".rw-saved",
    icon: ".rw-saved__icon",
    meta: ".rw-saved .rw-mono",
    actions: ".rw-actions--ready",
    close: '.rw-actions--ready [data-action="close"]',
    start: '.rw-actions--ready [data-action="start-sharing"]',
  })
  const c = checker(ctx, `§3 C ready (${theme})`)
  c.box("Wizard · Ready (N3Fw7)", m.saved, { pad: "32 24 24 24", gap: 14, align: "center" })
  c.box("Icon Wrap (Mygze)", m.icon, { w: 40, h: 40, bg: t["--kimo-success-soft"] })
  c.box("Meta (nYrmf)", m.meta, { fs: 11, color: t["--kimo-text-tertiary"] })
  c.box("Actions (uFLph)", m.actions, { gap: 8, align: "center" })
  c.box("Close (jzkFr)", m.close, { h: 30, pad: "0 12 0 12", color: t["--kimo-text-secondary"] })
  c.box("Start sharing (SRxeR)", m.start, { h: 30, pad: "0 12 0 12", bg: t["--kimo-accent"] })
  c.flush()
  const meta = await page.locator(".rw-saved .rw-mono").innerText()
  expect(/^maya@studio\.design · Monthly · renews \w{3} \d+$/.test(meta), `ready meta ${meta}`)
  await page.click('[data-action="start-sharing"]')
  await page.waitForFunction(() => (window as unknown as { __started?: unknown }).__started)
  const relay = await page.evaluate(
    () => (window as unknown as { __started: { relayUrl: string } }).__started.relayUrl,
  )
  expect(relay === "https://relay.cloud.test", `starts on the Kimo Cloud relay (${relay})`)
}

// --- Section 2 and 3 --------------------------------------------------------------------------------

async function signInAndSubscribe(ctx: E2EContext, theme: Theme) {
  const { page } = ctx
  await open(ctx, "wizard", "signed-out", theme)
  await page.click('[data-action="continue"]')
  await page.locator(".rw-email").waitFor()
  {
    const { c, t } = await measureWizard(ctx, `§2 A enter email (${theme})`, 16)
    const m = await measure(page, {
      intro: ".rw-intro",
      wrap: ".rw-intro .rw-icon-wrap",
      text: ".rw-intro .rw-text",
      title: ".rw-intro .rw-title",
      desc: ".rw-intro .rw-desc",
      field: ".rw-email",
      label: ".rw-email .rw-label",
      input: ".rw-email .kimo-input",
      back: '.rw-footer [data-action="back"]',
    })
    c.box("Intro (YKm4P)", m.intro, { gap: 12, dir: "row", align: "normal" })
    c.box("Icon Wrap (L2jPaJ)", m.wrap, { w: 32, h: 32, radius: R.pill, bg: t["--kimo-bg-muted"] })
    c.box("Text (qQ7Te)", m.text, { gap: 4, dir: "column" })
    c.box("Title (Pvuq8)", m.title, { fs: 12, fw: "600" })
    c.box("Desc (WfMeM)", m.desc, { fs: 11, color: t["--kimo-text-secondary"] })
    c.box("Field · Email (jxPa7)", m.field, { gap: 6, dir: "column", w: 558 })
    c.box("Label (DdM7a)", m.label, { fs: 11, fw: "500", color: t["--kimo-text-secondary"] })
    c.box("Input (fMW1b)", m.input, { w: 558 })
    c.box("Back (e2TyA)", m.back, { h: 30, pad: "0 12 0 12" })
    c.flush()
    expect(
      (await page.locator('[data-action="send-link"]').isDisabled()) === true,
      "Email me a link waits for an email",
    )
  }
  await page.fill(".rw-email input", "maya@studio.design")
  await page.keyboard.press("Enter")
  await page.locator(".rw-center").waitFor()
  {
    const { c, t } = await measureWizard(ctx, `§2 B check your inbox (${theme})`, 16)
    const m = await measure(page, {
      center: ".rw-center",
      icon: ".rw-center__icon",
      text: ".rw-center__text",
      title: ".rw-center__title",
      desc: ".rw-center__desc",
      waiting: ".rw-waiting",
      wLabel: ".rw-waiting__label",
      resend: '[data-action="resend"]',
    })
    c.box("Center (m9egRl)", m.center, {
      pad: "12 0 4 0",
      gap: 14,
      align: "center",
      dir: "column",
    })
    c.box("Icon Wrap (mkPRB)", m.icon, {
      w: 40,
      h: 40,
      bg: t["--kimo-accent-soft"],
      color: t["--kimo-accent-text"],
    })
    c.box("Text (sZSWs)", m.text, { gap: 6, align: "center", w: 558 })
    c.box("Title (KIkwA)", m.title, { fs: 14, fw: "600" })
    c.box("Desc (Nk5zL)", m.desc, { fs: 12, ta: "center", color: t["--kimo-text-secondary"] })
    c.box("Waiting (xutUA)", m.waiting, { gap: 6, align: "center" })
    c.box("Label (p9a8e3)", m.wLabel, { fs: 11, color: t["--kimo-text-tertiary"] })
    c.box("Resend (pTAOk)", m.resend, { h: 30, pad: "0 12 0 12", opacity: "0.4" })
    c.flush()
    const resend = await page.locator('[data-action="resend"]').innerText()
    expect(/^Resend in [01]:\d\d$/.test(resend), `resend countdown ${resend}`)
  }
  // The link is opened on another device: the wizard moves on by itself (polls every 2 s).
  await page.evaluate(() =>
    (
      window as unknown as { __board43: { fake: { verifyLink(): boolean } } }
    ).__board43.fake.verifyLink(),
  )
  await page.locator(".rw-intro .rw-icon-wrap--success").waitFor({ timeout: 8000 })
  {
    const { c, t } = await measureWizard(ctx, `§2 C signed in (${theme})`, 16)
    const m = await measure(page, {
      wrap: ".rw-intro .rw-icon-wrap--success",
      list: ".rw-body .mp-device-list",
      row: ".rw-body .mp-device",
      rowIcon: ".rw-body .mp-device__icon",
      name: ".rw-body .mp-device__name",
      meta: ".rw-body .mp-device__meta",
    })
    c.box("Icon Wrap (sz8iT)", m.wrap, { bg: t["--kimo-success-soft"], color: t["--kimo-success"] })
    c.box("List (HOAjL)", m.list, {
      radius: R.md,
      shadowHas: `${t["--kimo-border"]} 0px 0px 0px 1px inset`,
    })
    c.box("Device · Mac (PziNJ)", m.row, { pad: "8 8 8 10", gap: 10, align: "center" })
    c.box("Icon Wrap (fEs66)", m.rowIcon, { w: 28, h: 28, bg: t["--kimo-bg-muted"] })
    c.box("Name (JEo0e)", m.name, { fs: 12, fw: "500" })
    c.box("Meta (wU3Qy)", m.meta, { fs: 11, color: t["--kimo-text-tertiary"] })
    c.flush()
    expect(
      (await page.locator(".rw-body .mp-device__meta").innerText()) === "Linked just now",
      "linked just now",
    )
  }
  await page.click('[data-action="continue"]')
  await page.locator(".rw-billing").waitFor()
  {
    const { c, t } = await measureWizard(ctx, `§3 A choose billing (${theme})`, 16)
    const m = await measure(page, {
      billing: ".rw-billing",
      month: '.rw-billing .rw-option[data-value="month"]',
      year: '.rw-billing .rw-option[data-value="year"]',
      price: '.rw-billing .rw-option[data-value="month"] .rw-option__desc',
      includes: ".rw-includes",
      item: ".rw-include",
      check: ".rw-include__icon",
      label: ".rw-include__label",
    })
    c.box("Billing (ev4k1)", m.billing, { gap: 8, dir: "row" })
    c.box("Option · Monthly (vjTCo)", m.month, {
      pad: "12 14 12 14",
      gap: 12,
      bg: t["--kimo-bg-subtle"],
      shadowHas: `${t["--kimo-accent"]} 0px 0px 0px 1.5px inset`,
    })
    c.box("Option · Yearly (zlq4g)", m.year, {
      shadowHas: `${t["--kimo-border"]} 0px 0px 0px 1px inset`,
    })
    c.box("Price (M7g4Zm)", m.price, { fs: 11, color: t["--kimo-text-secondary"] })
    // M7g4Zm has no lineHeight: normal, not the option description's 1.45.
    expect(
      (await page.evaluate(
        () =>
          getComputedStyle(
            document.querySelector(
              '.rw-billing .rw-option[data-value="month"] .rw-option__desc',
            ) as Element,
          ).lineHeight,
      )) === "normal",
      "3 A price line height",
    )
    c.box("Includes (J8NxK)", m.includes, { gap: 8, dir: "column" })
    c.box("Item (FTYnH)", m.item, { gap: 8, align: "center" })
    c.box("Check (QWlfr)", m.check, { color: t["--kimo-success"] })
    c.box("Label (Ge1Bx)", m.label, { fs: 12, fw: "400", color: t["--kimo-text-primary"] })
    expect(Math.abs((m.month?.w ?? 0) - (m.year?.w ?? 1)) < 1, "Monthly and Yearly share the row")
    c.flush()
  }
  await page.click('.rw-billing .rw-option[data-value="year"]')
  await page.click('[data-action="checkout"]')
  await page.locator(".rw-center__icon").waitFor()
  const opened = await page.evaluate(
    () => (window as unknown as { __board43: { opened: string[] } }).__board43.opened,
  )
  expect(
    opened.some((u) => u.includes("/checkout/")),
    `checkout opened in the browser ${opened}`,
  )
  expect(
    (await page.locator(".rw-center__title").innerText()) === "Finish in your browser",
    "3 B title",
  )
  {
    const { c } = await measureWizard(ctx, `§3 B waiting (${theme})`, 16)
    c.flush()
  }
  // Declined: 3 D, then try again and pay.
  await page.evaluate(() =>
    (
      window as unknown as { __board43: { fake: { finishCheckout(o: string): boolean } } }
    ).__board43.fake.finishCheckout("failed"),
  )
  await page.locator(".rw-intro .rw-icon-wrap--warning").waitFor({ timeout: 8000 })
  {
    const { c, t } = await measureWizard(ctx, `§3 D not finished (${theme})`, 16)
    const m = await measure(page, { wrap: ".rw-intro .rw-icon-wrap--warning" })
    c.box("Icon Wrap (k9UI0)", m.wrap, { bg: t["--kimo-warning-soft"], color: t["--kimo-warning"] })
    c.flush()
  }
  await page.click('[data-action="checkout"]')
  await page.locator(".rw-center__icon").waitFor()
  await page.evaluate(() =>
    (
      window as unknown as { __board43: { fake: { finishCheckout(o: string): boolean } } }
    ).__board43.fake.finishCheckout("succeeded"),
  )
  await page.locator('.rw-shell[data-step="ready"]').waitFor({ timeout: 10_000 })
  const meta = await page.locator(".rw-saved .rw-mono").innerText()
  expect(meta.includes("Yearly"), `ready shows the yearly plan (${meta})`)
}

async function expiredLink(ctx: E2EContext, theme: Theme) {
  const { page } = ctx
  await open(ctx, "wizard", "signed-out", theme, "&start=sign-in")
  await page.fill(".rw-email input", "maya@studio.design")
  await page.click('[data-action="send-link"]')
  await page.locator(".rw-center").waitFor()
  await page.evaluate(() =>
    (
      window as unknown as { __board43: { fake: { expireLinks(): void } } }
    ).__board43.fake.expireLinks(),
  )
  await page.locator('[data-action="send-new-link"]').waitFor({ timeout: 8000 })
  const { c, t } = await measureWizard(ctx, `§2 E link expired (${theme})`, 16)
  const m = await measure(page, { wrap: ".rw-intro .rw-icon-wrap--warning" })
  c.box("Icon Wrap (Idfsa)", m.wrap, { bg: t["--kimo-warning-soft"], color: t["--kimo-warning"] })
  c.flush()
  expect(
    (await page.locator(".rw-intro .rw-title").innerText()) === "That link no longer works",
    "2 E title",
  )
  await page.click('[data-action="other-email"]')
  await page.locator(".rw-email").waitFor()
}

// --- Section 4 and 6 A ------------------------------------------------------------------------------

async function popover(ctx: E2EContext, theme: Theme) {
  const { page } = ctx
  await open(ctx, "share", "signed-out", theme)
  await page.click(".b43-share")
  await page.locator('.mp-body[data-cloud="sign-in"]').waitFor()
  const t = await T(page)
  {
    const m = await measure(page, {
      popover: ".mp-popover",
      body: ".mp-popover .mp-body",
      intro: ".mp-popover .mp-intro",
      wrap: ".mp-popover .mp-icon-wrap",
      text: ".mp-popover .mp-intro .mp-text",
      title: ".mp-popover .mp-title",
      use: '[data-action="use-cloud"]',
      price: ".mp-price",
      disclosure: ".mp-disclosure",
      dTitle: ".mp-disclosure__title",
      footer: ".mp-popover .mp-footer",
      footnote: ".mp-popover .mp-footnote",
      start: ".mp-start",
    })
    const c = checker(ctx, `§4 A first run (${theme})`)
    c.box("Share Popover (KFxbw)", m.popover, { w: 360, radius: R.lg })
    c.box("Body (SY5LO)", m.body, { pad: "12 12 12 12", gap: 12, dir: "column" })
    c.box("Intro (pAhOI)", m.intro, { gap: 12 })
    c.box("Icon Wrap (xf5th)", m.wrap, { w: 32, h: 32, bg: t["--kimo-bg-muted"] })
    c.box("Text (mfMWi)", m.text, { gap: 4 })
    c.box("Title (S61Lxi)", m.title, { fs: 12, fw: "600" })
    c.box("Use Kimo Cloud (rFTNe)", m.use, {
      w: 336,
      h: 30,
      pad: "0 12 0 12",
      justify: "center",
      bg: t["--kimo-accent"],
    })
    c.box("Price (Izt0F)", m.price, { fs: 11, color: t["--kimo-text-tertiary"] })
    c.box("Disclosure (pHrwB)", m.disclosure, {
      w: 336,
      pad: "10 12 10 12",
      gap: 10,
      align: "center",
      radius: R.md,
      shadowHas: `${t["--kimo-border"]} 0px 0px 0px 1px inset`,
    })
    c.box("Title (jHsKH)", m.dTitle, { fs: 12, fw: "500" })
    c.box("Footer (x9YUh)", m.footer, { pad: "10 12 10 12", gap: 8 })
    c.box("Footnote (AyhCg)", m.footnote, { fs: 11, color: t["--kimo-text-tertiary"] })
    c.box("Start sharing (VbvUi)", m.start, { h: 28, pad: "0 12 0 12", opacity: "0.4" })
    c.flush()
  }
  // A2: open it; Set up a relay and the Relay URL field, as before.
  await page.click(".mp-disclosure")
  {
    const m = await measure(page, {
      disclosure: ".mp-disclosure",
      setUp: '[data-action="set-up-relay"]',
      field: '.mp-field[data-pen="mHqqj"]',
    })
    const c = checker(ctx, `§4 A2 Host your own open (${theme})`)
    c.box("Disclosure · open (A3yUU)", m.disclosure, { bg: t["--kimo-bg-subtle"] })
    c.box("Set up a relay (f8hmy)", m.setUp, {
      w: 336,
      h: 30,
      pad: "0 12 0 12",
      justify: "center",
      bg: t["--kimo-bg-muted"],
    })
    c.box("Field · Relay URL (xCRXM)", m.field, { gap: 6, dir: "column" })
    c.flush()
  }
  await page.click(".mp-disclosure")
  await page.click('[data-action="use-cloud"]')
  await page.locator(".rw-email").waitFor()
  expect(
    (await page.evaluate(() => (window as unknown as { __wizardStart: string }).__wizardStart)) ===
      "sign-in",
    "Use Kimo Cloud opens the wizard at Sign in",
  )
}

async function popoverStates(ctx: E2EContext, theme: Theme) {
  const { page } = ctx
  for (const [state, stage] of [
    ["active", "ready"],
    ["none", "subscribe"],
    ["grace", "lapsed"],
  ] as const) {
    await open(ctx, "share", state, theme)
    await page.click(".b43-share")
    await page.locator(`.mp-body[data-cloud="${stage}"]`).waitFor()
    const t = await T(page)
    const c = checker(ctx, `§4 / 6 A popover · ${stage} (${theme})`)
    if (stage === "ready") {
      const m = await measure(page, {
        account: ".mp-account",
        icon: ".mp-account__icon",
        email: ".mp-account__email",
        pill: ".mp-account .kimo-status-pill",
        start: ".mp-start",
      })
      c.box("Account (UGZqi)", m.account, { gap: 8, align: "center" })
      c.box("Icon (xs8Fw)", m.icon, { color: t["--kimo-text-tertiary"] })
      c.box("Email (oqnQC)", m.email, { fs: 11, color: t["--kimo-text-primary"] })
      c.box("Status · Active (IVkUX)", m.pill, {
        pad: "2 8 2 6",
        bg: t["--kimo-success-soft"],
        color: t["--kimo-success"],
      })
      c.box("Start sharing (Q9Tt8)", m.start, { h: 28, opacity: "1" })
      expect(
        (await page.locator(".mp-popover .mp-footnote").innerText()) ===
          "Monthly · 1.2 GB of 10 GB",
        "4 B footnote",
      )
    } else if (stage === "subscribe") {
      const m = await measure(page, { button: '[data-action="subscribe"]', start: ".mp-start" })
      c.box("Subscribe (duIH2)", m.button, { w: 336, h: 30, justify: "center" })
      c.box("Start sharing (tubA8)", m.start, { opacity: "0.4" })
    } else {
      const m = await measure(page, {
        wrap: ".mp-icon-wrap--warning",
        renew: '[data-action="renew"]',
      })
      c.box("Icon Wrap (WdNIW)", m.wrap, {
        bg: t["--kimo-warning-soft"],
        color: t["--kimo-warning"],
      })
      c.box("Renew plan (IgbQW)", m.renew, { w: 336, h: 30, justify: "center" })
      expect(
        (await page.locator(".mp-popover .mp-footnote").innerText()) === "Guests are not affected",
        "6 A footnote",
      )
    }
    c.flush()
  }
}

// --- Section 5 ----------------------------------------------------------------------------------------

async function settings(ctx: E2EContext, theme: Theme) {
  const { page } = ctx
  await open(ctx, "settings", "active", theme)
  await page.locator('[data-setting="devices"]').waitFor()
  const t = await T(page)
  const m = await measure(page, {
    relay: '[data-setting="relay"]',
    box: ".mp-cloud-relay",
    boxIcon: ".mp-cloud-relay__icon",
    value: ".mp-cloud-relay__value",
    change: ".mp-cloud-change",
    account: '[data-setting="account"]',
    kv: '.mp-kv[data-row="email"]',
    key: '.mp-kv[data-row="email"] .mp-kv__key',
    val: '.mp-kv[data-row="email"] .mp-kv__value',
    meta: '.mp-kv[data-row="plan"] .mp-kv__meta',
    bar: ".mp-storage",
    used: ".mp-storage__used",
    storage: '.mp-kv[data-row="storage"] .mp-kv__value',
    actions: ".mp-account-actions",
    billing: ".mp-billing",
    signOut: ".mp-sign-out",
    devices: '[data-setting="devices"] .mp-device-list',
    hint: ".mp-cloud-hint",
    hintText: ".mp-cloud-hint__text",
  })
  const c = checker(ctx, `§5 A Settings › Multiplayer (${theme})`)
  c.box("Setting · Relay (F3zlz)", m.relay, { pad: "12 0 12 0", gap: 8, w: 510 })
  c.box("Relay · Kimo Cloud (uXwF3)", m.box, {
    h: 32,
    pad: "0 10 0 10",
    gap: 8,
    radius: R.md,
    bg: t["--kimo-bg-subtle"],
  })
  c.box("Icon (pB3Em)", m.boxIcon, { color: t["--kimo-text-secondary"] })
  c.box("Value (Z3z4n)", m.value, { fs: 12, fw: "400" })
  c.box("Change (mxOH0)", m.change, { h: 32, pad: "0 14 0 14", fs: 12 })
  c.box("Setting · Account (vltUY)", m.account, { pad: "12 0 12 0", gap: 8 })
  c.box("Row · Email (IYFvi)", m.kv, { gap: 8, align: "center" })
  c.box("Key (brETk)", m.key, { w: 72, fs: 11, color: t["--kimo-text-tertiary"] })
  c.box("Value (jfYuL)", m.val, { fs: 12, color: t["--kimo-text-primary"] })
  c.box("Meta (L3hDbD)", m.meta, { fs: 11, color: t["--kimo-text-tertiary"] })
  c.box("Bar (rWXeH)", m.bar, { h: 6, radius: R.pill, bg: t["--kimo-bg-muted"] })
  c.box("Used (uHezd)", m.used, { h: 6, bg: t["--kimo-accent"] })
  c.box("Value (VRkn1)", m.storage, { fs: 11, ff: "JetBrains Mono" })
  c.box("Actions (U7MgTk)", m.actions, { pad: "4 0 0 0", gap: 8 })
  c.box("Manage billing (z0TAXp)", m.billing, { h: 28, pad: "0 12 0 12", fs: 12 })
  c.box("Sign out (ivdaF)", m.signOut, { h: 28, pad: "0 10 0 10" })
  c.box("List (KfjyR)", m.devices, { radius: R.md })
  c.box("Footer (gn7mM)", m.hint, { gap: 8, align: "center" })
  c.box("Hint (BMMPq)", m.hintText, { fs: 11, color: t["--kimo-text-tertiary"] })
  const ratio = (m.used?.w ?? 0) / (m.bar?.w ?? 1)
  expect(Math.abs(ratio - 0.12) < 0.01, `storage bar at 12 % (${ratio})`)
  // Hover the other device: Rename and Sign out (danger).
  await page.hover(".mp-device:not([data-self]) .mp-device__name")
  const h = await measure(page, {
    row: ".mp-device:not([data-self])",
    signOut: ".mp-device__sign-out",
  })
  c.box("Device · hover (I5VPa)", h.row, { bg: t["--kimo-bg-subtle"], pad: "8 8 8 10" })
  c.box("Sign out (ti3HR)", h.signOut, { w: 24, h: 24, color: t["--kimo-danger"] })
  c.flush()

  // 5 D Manage billing: the portal in the browser and a toast.
  await page.click(".mp-billing")
  await page.locator(".kimo-toast").waitFor()
  expect(
    (await page.locator(".kimo-toast").innerText()).includes("Billing opened in your browser"),
    "5 D toast",
  )
  // 5 C: sign out another device (its actions show on hover).
  await page.hover(".mp-device:not([data-self]) .mp-device__name")
  await page.click(".mp-device__sign-out")
  await page.locator('.mp-cloud-sign-out[data-device="other"]').waitFor()
  await page.click('.mp-cloud-sign-out [class*="primary"]')
  await page.waitForFunction(() => document.querySelectorAll(".mp-device").length === 1)
  // 5 B: sign this device out; Relay reads Not set up (nVGsb).
  await page.click(".mp-sign-out")
  await page.locator('.mp-cloud-sign-out[data-device="self"]').waitFor()
  await page.click('.mp-cloud-sign-out [class*="primary"]')
  await page.waitForFunction(
    () =>
      document.querySelector('[data-setting="relay"] .mp-cloud-relay__value')?.textContent ===
      "Not set up",
  )
  expect((await page.locator('[data-setting="account"]').count()) === 0, "5 B no account")
}

async function dialogs(ctx: E2EContext, theme: Theme) {
  await open(ctx, "dialogs", "signed-out", theme)
  const t = await T(ctx.page)
  const m = await measure(ctx.page, { dialog: ".mp-cloud-sign-out" })
  const c = checker(ctx, `§5 B, C dialogs (${theme})`)
  c.box("Dialog · Sign out (CddxB)", m.dialog, {
    w: 480,
    pad: "20 20 20 20",
    gap: 14,
    radius: R.xl,
    bg: t["--kimo-bg-overlay"],
  })
  c.flush()
}

// --- Section 6 ----------------------------------------------------------------------------------------

async function fragments(ctx: E2EContext, theme: Theme) {
  const { page } = ctx
  await open(ctx, "fragments", "past-due", theme)
  const t = await T(page)
  for (const [kind, tone] of [
    ["payment-failed", "warning"],
    ["offline", "danger"],
    ["storage-full", "danger"],
  ] as const) {
    const s = `.cloud-notice[data-notice="${kind}"]`
    const m = await measure(page, {
      frame: s,
      target: `${s} .cloud-notice__target`,
      icon: `${s} .cloud-notice__icon`,
      label: `${s} .cloud-notice__label`,
      pill: `${s} .kimo-status-pill`,
      message: `${s} .cloud-notice__message`,
      title: `${s} .cloud-notice__title`,
      desc: `${s} .cloud-notice__desc`,
      actions: `${s} .cloud-notice__actions`,
      action: `${s} .cloud-notice__action`,
    })
    const c = checker(ctx, `§6 ${kind} (${theme})`)
    c.box("Body Fragment (k4gPbV)", m.frame, {
      w: 458,
      pad: "20 20 20 20",
      gap: 12,
      radius: R.lg,
      bg: t["--kimo-bg-overlay"],
      shadowHas: `${t["--kimo-border"]} 0px 0px 0px 1px inset`,
    })
    c.box("Target (apEeH)", m.target, { gap: 8, align: "center" })
    c.box("Icon (dWgSP)", m.icon, { color: t["--kimo-text-tertiary"] })
    c.box("Label (y3DO9W)", m.label, { fs: 11, ff: "JetBrains Mono" })
    c.box("Status (eWHj2)", m.pill, {
      bg: t[`--kimo-${tone}-soft`],
      color: t[`--kimo-${tone}`],
    })
    c.box("Message (FeSPM)", m.message, { gap: 4, dir: "column" })
    c.box("Title (PgxTw)", m.title, { fs: 12, fw: "600" })
    c.box("Desc (IWGU4)", m.desc, { fs: 11, color: t["--kimo-text-secondary"] })
    c.box("Actions (iF9qD)", m.actions, { gap: 6 })
    c.box("Action (yeeZA)", m.action, { h: 26, pad: "0 10 0 10", bg: t["--kimo-bg-muted"] })
    c.flush()
  }
}

async function banners(ctx: E2EContext, theme: Theme) {
  const { page } = ctx
  for (const state of ["grace", "read-only"] as const) {
    await open(ctx, "banners", state, theme)
    await page.locator(".kimo-banner").waitFor()
    const t = await T(page)
    const m = await measure(page, {
      banner: ".kimo-banner",
      icon: ".kimo-banner__icon",
      title: ".kimo-banner__title",
      body: ".kimo-banner__body",
      primary: ".kimo-banner .kimo-button--primary",
    })
    const c = checker(ctx, `§6 ${state === "grace" ? "B" : "C"} banner (${theme})`)
    c.box(state === "grace" ? "Banner/Warning (OnbnS)" : "Banner (ybZM0)", m.banner, {
      pad: "8 8 8 16",
      gap: 10,
      align: "center",
      bg: state === "grace" ? t["--kimo-warning-soft"] : t["--kimo-bg-subtle"],
    })
    c.box("Icon (AClzz)", m.icon, {
      w: 16,
      h: 16,
      color: state === "grace" ? t["--kimo-warning"] : t["--kimo-text-secondary"],
    })
    c.box("Title (HRUqU)", m.title, { fs: 12, fw: "600" })
    c.box("Body (x6Z0vQ)", m.body, { fs: 12, color: t["--kimo-text-secondary"] })
    c.box("Renew plan (wGTB1)", m.primary, { h: 28, pad: "0 12 0 12" })
    c.flush()
    const dismiss = await page.locator(".kimo-banner__dismiss").count()
    expect(dismiss === (state === "grace" ? 1 : 0), `${state} dismiss`)
  }
}

const both = (name: string, run: (ctx: E2EContext, theme: Theme) => Promise<void>): Scenario => ({
  name,
  async run(ctx) {
    await run(ctx, "light")
    await run(ctx, "dark")
  },
})

// --- No Kimo Cloud calls for a self-hosted relay; no answer is the offline state ----------------------

async function selfHosted(ctx: E2EContext, theme: Theme) {
  const { page } = ctx
  const errors: string[] = []
  const onError = (e: Error) => errors.push(e.message)
  page.on("pageerror", onError)
  try {
    await open(ctx, "share", "self-hosted", theme)
    await page.click(".b43-share")
    await page.locator('.mp-popover[data-stage="ready"]').waitFor()
    await page.waitForTimeout(300)
    const asked = await page.evaluate(
      () =>
        (window as unknown as { __board43: { cloudRequests: string[] } }).__board43.cloudRequests,
    )
    expect(
      asked.length === 0,
      `a self-hosted popover asks Kimo Cloud nothing (${asked.join(", ")})`,
    )
    // Kimo Cloud not answering (first run shows it): the offline state, never an uncaught error.
    await open(ctx, "share", "offline", theme)
    await page.click(".b43-share")
    await page.locator('.mp-popover[data-stage="first-run"]').waitFor()
    await page.waitForFunction(
      () =>
        (
          window as unknown as { __board43: { cloud: { getState(): { offline: boolean } } } }
        ).__board43.cloud.getState().offline,
    )
    await page.click(".b43-share")
    await page.click(".b43-share")
    await page.locator('.mp-popover[data-stage="first-run"]').waitFor()
    await page.waitForTimeout(300)
    const plans = await page.evaluate(() =>
      (
        window as unknown as { __board43: { cloudRequests: string[] } }
      ).__board43.cloudRequests.filter((p) => p === "/v1/plans"),
    )
    expect(plans.length === 1, `plans asked once across two opens (${plans.length})`)
    expect(errors.length === 0, `no uncaught errors (${errors.join(" | ")})`)
  } finally {
    page.off("pageerror", onError)
  }
}

export const scenarios: Scenario[] = [
  both(
    "board43 Kimo Cloud: a self-hosted relay asks Kimo Cloud nothing; offline is caught",
    selfHosted,
  ),
  both("board43 Kimo Cloud: Choose with Host your own collapsed and open", choose),
  both(
    "board43 Kimo Cloud: already signed in, Use Kimo Cloud, ready, start sharing",
    chooseSignedIn,
  ),
  both(
    "board43 Kimo Cloud: sign in by email link, subscribe, declined then paid",
    signInAndSubscribe,
  ),
  both("board43 Kimo Cloud: an expired link", expiredLink),
  both("board43 Kimo Cloud: Share popover first run and Host your own", popover),
  both("board43 Kimo Cloud: Share popover ready, subscribe, plan ended", popoverStates),
  both("board43 Kimo Cloud: Settings › Multiplayer account, billing, devices, sign out", settings),
  both("board43 Kimo Cloud: sign out dialogs", dialogs),
  both("board43 Kimo Cloud: payment failed, offline, storage full", fragments),
  both("board43 Kimo Cloud: grace and read-only banners", banners),
]
