/**
 * Board 42 "Relay setup" (desing.pen UYvSG): the wizard from the Share popover and from
 * Settings › Multiplayer, end to end against a real relay (apps/server, started here on a free
 * port with a create secret): I already have a relay, a wrong secret comes back as Secret
 * rejected, Enter the relay's secret, the test passes, Save and use, Start sharing. The desktop
 * path (This computer, quick tunnel) runs over a scripted relay host.
 *
 * One measured pass per surface (getComputedStyle + getBoundingClientRect vs the node values),
 * light and dark.
 */
import { type ChildProcess, spawn } from "node:child_process"
import { createServer } from "node:net"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import type { Page } from "playwright"
import { build } from "vite"
import { checker, measure, tokens } from "./board25-helpers"
import { type E2EContext, expect, type Scenario } from "./run"

const here = fileURLToPath(new URL(".", import.meta.url))
const repo = join(here, "..", "..", "..")
const SECRET = "e2e-board42-secret"
let built: Promise<string> | null = null

async function harnessUrl(ctx: E2EContext): Promise<string> {
  if (process.env.KIMO_E2E_DEV === "1") return `${ctx.url}e2e/board42-harness/index.html`
  built ??= build({
    root: join(here, "board42-harness"),
    configFile: false,
    base: "./",
    logLevel: "error",
    plugins: [react()],
    build: {
      outDir: join(process.env.KIMO_E2E_OUTDIR ?? join(here, ".dist"), "board42"),
      emptyOutDir: true,
      target: "es2022",
    },
  }).then(() => "board42/index.html")
  return `${ctx.url}${await built}`
}

type Theme = "light" | "dark"

async function open(ctx: E2EContext, surface: string, theme: Theme) {
  await ctx.page.setViewportSize({ width: 1280, height: 900 })
  await ctx.page.goto(
    `${await harnessUrl(ctx)}?run=${Date.now()}&surface=${surface}&theme=${theme}`,
  )
  const errors: string[] = []
  ctx.page.on("pageerror", (e) => errors.push(e.message))
  await ctx.page
    .waitForFunction(() => document.documentElement.dataset.ready === "1", undefined, {
      timeout: 15_000,
    })
    .catch((e: unknown) => {
      throw new Error(`harness ${surface} (${theme}) did not start: ${errors.join(" | ") || e}`)
    })
  await ctx.page.waitForTimeout(100)
}

// --- A real relay ---------------------------------------------------------------------------------

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.once("error", reject)
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port
      s.close(() => resolve(port))
    })
  })
}

interface TestRelay {
  url: string
  stop(): Promise<void>
}

/** apps/server on a free port (never 8787), in memory, with a create secret; 15 s to start. */
async function startRelay(): Promise<TestRelay> {
  const port = await freePort()
  const child: ChildProcess = spawn(
    process.env.BUN ?? "bun",
    [join(repo, "apps/server/src/main.ts")],
    {
      env: {
        ...process.env,
        PORT: String(port),
        HOST: "127.0.0.1",
        KIMO_DATA_DIR: ":memory:",
        KIMO_CREATE_SECRET: SECRET,
      },
      stdio: "ignore",
    },
  )
  const url = `http://127.0.0.1:${port}`
  const until = Date.now() + 15_000
  for (;;) {
    const ok = await fetch(`${url}/healthz`)
      .then((r) => r.ok)
      .catch(() => false)
    if (ok) break
    if (Date.now() > until || child.exitCode !== null) {
      child.kill("SIGKILL")
      throw new Error("the test relay did not start")
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  return {
    url,
    stop: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null) return resolve()
        const t = setTimeout(() => child.kill("SIGKILL"), 3000)
        child.once("exit", () => {
          clearTimeout(t)
          resolve()
        })
        child.kill("SIGTERM")
      }),
  }
}

const COLORS = [
  "--kimo-bg-app",
  "--kimo-bg-muted",
  "--kimo-bg-subtle",
  "--kimo-bg-overlay",
  "--kimo-text-primary",
  "--kimo-text-secondary",
  "--kimo-text-tertiary",
  "--kimo-accent",
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

const px = (page: Page, names: string[]) =>
  page.evaluate((ns) => {
    const out: Record<string, number> = {}
    const cs = getComputedStyle(document.documentElement)
    for (const n of ns) out[n] = parseFloat(cs.getPropertyValue(n))
    return out
  }, names)

const T0 = "rgba(0, 0, 0, 0)"

/** The shell, head, stepper, body and footer of whatever step is open. */
async function measureShell(ctx: E2EContext, label: string, bodyGap: number) {
  const { page } = ctx
  const T = await tokens(page, COLORS)
  const R = await px(page, ["--kimo-radius-xl", "--kimo-radius-md", "--kimo-radius-pill"])
  const m = await measure(page, {
    shell: ".rw-shell",
    head: ".rw-head",
    headIcon: ".rw-head .rw-icon-wrap",
    title: ".rw-head__title",
    sub: ".rw-head__sub",
    close: ".rw-close",
    stepper: ".rw-stepper",
    step: ".rw-step",
    dotCurrent: '.rw-step[data-state="current"] .rw-step__dot',
    labelCurrent: '.rw-step[data-state="current"] .rw-step__label',
    dotNext: '.rw-step[data-state="next"] .rw-step__dot',
    labelNext: '.rw-step[data-state="next"] .rw-step__label',
    dotDone: '.rw-step[data-state="done"] .rw-step__dot',
    connector: ".rw-connector",
    body: ".rw-body",
    footer: ".rw-footer",
    primary: ".rw-footer .kimo-button--primary",
  })
  const c = checker(ctx, label)
  c.box("Shell (f4OYFV)", m.shell, {
    w: 600,
    radius: R["--kimo-radius-xl"] as number,
    bg: T["--kimo-bg-overlay"] as string,
    border: `1px ${T["--kimo-border"]}`,
    shadowHas: "0px 16px 48px",
    dir: "column",
  })
  c.box("Head (ceEr5)", m.head, { pad: "16 12 12 20", gap: 12, align: "center", dir: "row" })
  c.box("Icon Wrap (WgvNC)", m.headIcon, {
    w: 32,
    h: 32,
    radius: R["--kimo-radius-pill"] as number,
    bg: T["--kimo-bg-muted"] as string,
    color: T["--kimo-text-primary"] as string,
  })
  c.box("Title (ZqR39)", m.title, { fs: 14, fw: "600", color: T["--kimo-text-primary"] as string })
  c.box("Sub (olGYK)", m.sub, { fs: 11, fw: "400", color: T["--kimo-text-secondary"] as string })
  c.box("Close (xLNDc)", m.close, { w: 24, h: 24, color: T["--kimo-text-secondary"] as string })
  c.box("Stepper (VhJwA)", m.stepper, { pad: "0 20 14 20", gap: 8, align: "center", dir: "row" })
  c.box("Step (wtElY)", m.step, { gap: 6, align: "center" })
  c.box("Dot · current (Erops)", m.dotCurrent, {
    w: 18,
    h: 18,
    radius: R["--kimo-radius-pill"] as number,
    bg: T["--kimo-accent"] as string,
    color: T["--kimo-on-accent"] as string,
    fs: 10,
    fw: "600",
  })
  c.box("Label · current (qIJV6)", m.labelCurrent, {
    fs: 12,
    fw: "600",
    color: T["--kimo-text-primary"] as string,
  })
  if (m.dotNext)
    c.box("Dot · to come (L2Zpx1)", m.dotNext, {
      w: 18,
      h: 18,
      bg: T["--kimo-bg-muted"] as string,
      color: T["--kimo-text-tertiary"] as string,
    })
  if (m.labelNext)
    c.box("Label · to come (IMGe7)", m.labelNext, {
      fs: 12,
      fw: "400",
      color: T["--kimo-text-tertiary"] as string,
    })
  if (m.dotDone)
    c.box("Dot · done (rowhg)", m.dotDone, {
      w: 18,
      h: 18,
      bg: T["--kimo-success-soft"] as string,
      color: T["--kimo-success"] as string,
    })
  c.box("Connector (LETVK)", m.connector, { w: 24, h: 1, bg: T["--kimo-border-strong"] as string })
  c.box("Body (UZAY5)", m.body, {
    w: 598,
    pad: "20 20 20 20",
    gap: bodyGap,
    dir: "column",
    shadowHas: `${T["--kimo-border"]} 0px 1px 0px 0px inset`,
  })
  c.box("Footer (IqSJT)", m.footer, {
    pad: "12 20 12 20",
    gap: 8,
    align: "center",
    shadowHas: `${T["--kimo-border"]} 0px 1px 0px 0px inset`,
  })
  c.box("Primary (fzDvZ)", m.primary, {
    h: 30,
    pad: "0 12 0 12",
    gap: 6,
    fs: 13,
    fw: "500",
    bg: T["--kimo-accent"] as string,
    radius: R["--kimo-radius-pill"] as number,
  })
  return { c, T, R }
}

// --- Section 1 A + 7 + 8: from the Share popover to sharing, over a real relay --------------------

async function fromShare(ctx: E2EContext, theme: Theme, relay: TestRelay) {
  const { page } = ctx
  await open(ctx, "share", theme)
  await page.click(".b42-share")
  await page.locator('.mp-popover[data-stage="first-run"]').waitFor()
  const T = await tokens(page, COLORS)
  {
    const m = await measure(page, {
      body: ".mp-popover .mp-body",
      setUp: ".mp-setup-relay",
      or: ".mp-or",
      line: ".mp-or__line",
      orLabel: ".mp-or__label",
      secret: '.mp-field[data-pen="x0O8mK"]',
      footnote: ".mp-popover .mp-footnote",
    })
    const c = checker(ctx, `§1 A Share popover · no relay (${theme})`)
    c.box("Set up a relay (GTJaY)", m.setUp, {
      w: (m.body?.w ?? 360) - 24,
      h: 30,
      pad: "0 12 0 12",
      justify: "center",
      bg: T["--kimo-accent"] as string,
    })
    c.box("Divider · or (HxQ2J)", m.or, { gap: 8, align: "center", dir: "row" })
    c.box("Line (Z44jF)", m.line, { h: 1, bg: T["--kimo-border"] as string })
    c.box("Label (cjkVK)", m.orLabel, { fs: 11, color: T["--kimo-text-tertiary"] as string })
    c.box("Field · Create secret (x0O8mK)", m.secret, { gap: 6, dir: "column" })
    expect(
      (await page.locator(".mp-popover .mp-footnote").innerText()) === "Saved to Settings",
      "footnote",
    )
    expect(
      (m.or?.y ?? 0) > (m.setUp?.y ?? 0) && (m.secret?.y ?? 0) > (m.or?.y ?? 0),
      "Set up a relay sits above the manual fields",
    )
    c.flush()
  }

  // Set up a relay → the wizard over the window.
  await page.click(".mp-setup-relay")
  await page.locator('.rw-shell[data-step="choose"]').waitFor()
  expect(
    (await page.locator(".rw-scrim .rw-shell").count()) === 1,
    "the wizard opens over the window (scrim)",
  )
  {
    const { c } = await measureShell(ctx, `§2 B Choose · web (${theme})`, 8)
    const m = await measure(page, {
      selected: '.rw-option[data-value="docker"]',
      selectedRadio: '.rw-option[data-value="docker"] .rw-radio',
      other: '.rw-option[data-value="fly"]',
      otherRadio: '.rw-option[data-value="fly"] .rw-radio',
      icon: '.rw-option[data-value="fly"] .rw-option__icon',
      title: '.rw-option[data-value="fly"] .rw-option__title',
      desc: '.rw-option[data-value="fly"] .rw-option__desc',
      text: '.rw-option[data-value="fly"] .rw-text',
      badge: '.rw-option[data-value="fly"] .kimo-badge',
      localRadio: '.rw-option[data-value="local"] .rw-radio',
      localIcon: '.rw-option[data-value="local"] .rw-option__icon',
      localTitle: '.rw-option[data-value="local"] .rw-option__title',
      note: ".rw-body .rw-note",
      footnote: ".rw-footnote",
    })
    c.box("Option · selected (ESyUI)", m.selected, {
      pad: "12 14 12 14",
      gap: 12,
      align: "center",
      radius: 10,
      bg: T["--kimo-bg-subtle"] as string,
      shadowHas: `${T["--kimo-accent"]} 0px 0px 0px 1.5px inset`,
    })
    c.box("Radio · selected (vpLgj)", m.selectedRadio, {
      w: 16,
      h: 16,
      bg: T["--kimo-bg-app"] as string,
      shadowHas: `${T["--kimo-accent"]} 0px 0px 0px 5px inset`,
    })
    c.box("Option (HsKiX)", m.other, {
      bg: T0,
      shadowHas: `${T["--kimo-border"]} 0px 0px 0px 1px inset`,
    })
    c.box("Radio (LRJPJ)", m.otherRadio, {
      w: 16,
      h: 16,
      shadowHas: `${T["--kimo-border-strong"]} 0px 0px 0px 1.5px inset`,
    })
    c.box("Option Icon Wrap (Efc6K)", m.icon, {
      w: 32,
      h: 32,
      radius: 10,
      bg: T["--kimo-bg-muted"] as string,
    })
    c.box("Text (k6IJk)", m.text, { gap: 2, dir: "column" })
    c.box("Title (O1bBsC)", m.title, {
      fs: 12,
      fw: "500",
      color: T["--kimo-text-primary"] as string,
    })
    c.box("Desc (IxJKB)", m.desc, { fs: 11, color: T["--kimo-text-secondary"] as string })
    c.box("Badge (Q0MDDC)", m.badge, { pad: "2 8 2 8", bg: T["--kimo-bg-muted"] as string })
    c.box("This computer · Radio (WyBKH)", m.localRadio, { opacity: "0.5" })
    c.box("This computer · Icon Wrap (EZrLo)", m.localIcon, { opacity: "0.5" })
    c.box("This computer · Title (rvK95)", m.localTitle, {
      color: T["--kimo-text-tertiary"] as string,
    })
    c.box("Web Note (UMwDK)", m.note, {
      pad: "8 10 8 10",
      gap: 8,
      radius: 10,
      bg: T["--kimo-bg-subtle"] as string,
    })
    c.box("Footnote (BBsrJ)", m.footnote, { fs: 11, color: T["--kimo-text-tertiary"] as string })
    c.flush()
  }
  // This computer is disabled on web; arrow keys move; pick I already have a relay.
  await page.click('.rw-option[data-value="local"]', { force: true })
  expect(
    (await page.getAttribute('.rw-option[data-value="docker"]', "aria-checked")) === "true",
    "This computer can't be picked on web",
  )
  await page.focus('.rw-option[data-value="docker"]')
  await page.keyboard.press("ArrowDown")
  expect(
    (await page.getAttribute('.rw-option[data-value="fly"]', "aria-checked")) === "true",
    "ArrowDown moves to Fly.io",
  )
  await page.click('.rw-option[data-value="existing"]')
  await page.click('[data-action="continue"]')
  await page.locator('.rw-shell[data-step="setup"][data-path="existing"]').waitFor()
  expect(
    (await page.locator(".rw-head__sub").innerText()) === "Step 2 of 3 · I already have a relay",
    "step line",
  )
  // The probe runs on blur: the relay needs a secret, so Custom.
  const urlInput = page.locator(".rw-body .rw-field input").first()
  await urlInput.fill(relay.url)
  await urlInput.blur()
  await page.locator('.rw-probe[data-probe="ok"]').waitFor({ timeout: 8000 })
  expect(
    (await page.locator(".rw-probe").innerText()).includes("needs a create secret"),
    "the probe says the relay needs a secret",
  )
  expect(
    (await page.locator('.rw-secret[data-mode="custom"]').count()) === 1,
    "Custom is chosen for a relay that needs a secret",
  )
  expect(
    (await page.locator('.rw-secret .kimo-seg-text [data-value="auto"]').isDisabled()) === true,
    "Automatic is not offered for a relay Kimo did not start",
  )
  {
    const { c } = await measureShell(ctx, `§7 A I already have a relay · Custom (${theme})`, 16)
    const m = await measure(page, {
      field: ".rw-body .rw-field",
      label: ".rw-body .rw-field .rw-label",
      inputRow: ".rw-body .rw-field .rw-input-row",
      probe: ".rw-probe",
      probeMeta: ".rw-probe .rw-mono",
      secret: ".rw-secret",
      labelRow: ".rw-secret > .rw-label-row",
      tag: ".rw-secret .rw-tag",
      secretRow: ".rw-secret .rw-input-row",
      help: ".rw-secret > .rw-desc",
    })
    c.box("Field · Relay URL (iZ1Db)", m.field, { gap: 6, dir: "column" })
    c.box("Label (O6zFIu)", m.label, {
      fs: 11,
      fw: "500",
      color: T["--kimo-text-secondary"] as string,
    })
    c.box("Input Row (BXULo)", m.inputRow, { gap: 4, align: "center" })
    c.box("Probe (B37YM)", m.probe, { gap: 8, align: "center" })
    c.box("Meta (E36jfx)", m.probeMeta, { fs: 11, color: T["--kimo-text-tertiary"] as string })
    c.box("Secret · Custom (OPtGz)", m.secret, { gap: 8, dir: "column" })
    c.box("Label Row (MEfhh)", m.labelRow, { gap: 6, align: "center" })
    c.box("Tag (mwfMY)", m.tag, { fs: 11, color: T["--kimo-text-tertiary"] as string })
    c.box("Input Row (Torls)", m.secretRow, { gap: 4, align: "center" })
    c.box("Help (oBtix)", m.help, { fs: 11, color: T["--kimo-text-tertiary"] as string })
    c.flush()
  }
  // A wrong secret: Secret rejected; Enter the relay's secret goes back to its field.
  await page.locator(".rw-secret input").fill("not-the-secret")
  await page.click('[data-action="test-relay"]')
  await page.locator('.rw-shell[data-step="test"]').waitFor()
  await page.locator(".rw-fix").waitFor({ timeout: 8000 })
  expect(
    (await page.locator('[data-check="secret"]').innerText()).includes("rejected · 403"),
    "the secret line says rejected",
  )
  expect(
    (await page.getAttribute('.rw-footer [data-action="save"]', "disabled")) !== null,
    "Save and use waits for a passing test",
  )
  {
    const m = await measure(page, {
      fix: ".rw-fix",
      fixTitle: ".rw-fix .rw-title",
      actions: ".rw-fix .rw-actions",
      enter: '[data-action="enter-secret"]',
      pill: '.rw-target [data-tone="danger"]',
    })
    const c = checker(ctx, `§8 C secret rejected (${theme})`)
    c.box("Fix (gnLEW)", m.fix, {
      pad: "10 12 10 12",
      gap: 8,
      radius: 10,
      bg: T["--kimo-danger-soft"] as string,
    })
    c.box("Title (gz5Oz)", m.fixTitle, { fs: 12, fw: "600" })
    c.box("Actions (yErox)", m.actions, { gap: 6, align: "center" })
    c.box("Enter the relay's secret (Q8sxg)", m.enter, { h: 26, pad: "0 10 0 10" })
    c.box("Status · Secret rejected (BpLpq)", m.pill, {
      bg: T["--kimo-danger-soft"] as string,
      color: T["--kimo-danger"] as string,
    })
    c.flush()
  }
  await page.click('[data-action="enter-secret"]')
  await page.locator('.rw-shell[data-step="setup"]').waitFor()
  await page.waitForTimeout(50)
  expect(
    await page.evaluate(() => document.activeElement?.closest(".rw-secret") != null),
    "the secret field has focus",
  )
  await page.locator(".rw-secret input").fill(SECRET)
  await page.click('[data-action="test-relay"]')
  await page.locator('.rw-target [data-tone="success"]').waitFor({ timeout: 8000 })
  {
    const { c } = await measureShell(ctx, `§8 B test ok (${theme})`, 16)
    const m = await measure(page, {
      target: ".rw-target",
      url: ".rw-target .rw-mono--primary",
      checks: '.rw-group[data-group="test"]',
      row: '[data-check="reach"]',
      label: '[data-check="reach"] .rw-check__label',
      meta: '[data-check="reach"] .rw-mono',
      icon: '[data-check="reach"] .rw-check__icon',
    })
    c.box("Target (nhcsR)", m.target, { gap: 8, align: "center" })
    c.box("URL (w2HvQb)", m.url, { fs: 11, color: T["--kimo-text-primary"] as string })
    c.box("Checks (yF639)", m.checks, { gap: 8, dir: "column" })
    c.box("Check · Reached the relay (cZE4c)", m.row, { gap: 8, align: "center" })
    c.box("Label (e2dB54)", m.label, { fs: 12, color: T["--kimo-text-primary"] as string })
    c.box("Meta (qG6kG)", m.meta, { fs: 11, color: T["--kimo-text-tertiary"] as string })
    c.box("Icon (XcqV6)", m.icon, { w: 14, h: 14, color: T["--kimo-success"] as string })
    c.flush()
  }
  const lines = await page.locator('.rw-group[data-group="test"] .rw-check').allInnerTexts()
  expect(lines.length === 4, `four checks (${lines.join(" | ")})`)
  expect(lines[2]?.includes("kimo-mp/1"), "protocol kimo-mp/1")
  expect(lines[3]?.includes("accepted"), "secret accepted")
  await page.click('[data-action="save"]')
  await page.locator('.rw-shell[data-step="saved"]').waitFor()
  {
    const m = await measure(page, {
      saved: ".rw-saved",
      icon: ".rw-saved__icon",
      text: ".rw-saved__text",
      desc: ".rw-saved__desc",
      start: '[data-action="start-sharing"]',
    })
    const c = checker(ctx, `§8 D saved (${theme})`)
    c.box("Wizard · Saved (oNhnE)", m.saved, { pad: "32 24 24 24", gap: 14, align: "center" })
    c.box("Icon Wrap (IuTuB)", m.icon, {
      w: 40,
      h: 40,
      bg: T["--kimo-success-soft"] as string,
      color: T["--kimo-success"] as string,
    })
    c.box("Text (c96cT)", m.text, { gap: 6, align: "center" })
    c.box("Desc (bf4BP)", m.desc, {
      fs: 12,
      ta: "center",
      color: T["--kimo-text-secondary"] as string,
    })
    c.box("Start sharing (Jp7Zr)", m.start, { h: 30, pad: "0 12 0 12" })
    c.flush()
  }
  const stored = await page.evaluate(() => {
    const w = window as unknown as {
      __board42: { platform: { settings: { get(k: string): unknown } } }
    }
    return {
      url: w.__board42.platform.settings.get("multiplayer.relayUrl"),
      setup: w.__board42.platform.settings.get("multiplayer.relaySetup"),
      secret: localStorage.getItem("kimo.relay.secret"),
    }
  })
  expect(stored.url === relay.url, `relay URL saved (${stored.url})`)
  expect(stored.secret === SECRET, "the secret is in browser storage")
  expect(!JSON.stringify(stored.setup).includes(SECRET), "the secret is not in Settings")
  expect(
    (stored.setup as { secretMode?: string; path?: string }).secretMode === "custom" &&
      (stored.setup as { path?: string }).path === "existing",
    `setup stored (${JSON.stringify(stored.setup)})`,
  )
  // Start sharing: this file goes live on the saved relay with its secret.
  await page.click('[data-action="start-sharing"]')
  await page.waitForFunction(() => (window as unknown as { __started?: unknown }).__started != null)
  const started = await page.evaluate(
    () =>
      (window as unknown as { __started: { relayUrl: string; createSecret: string } }).__started,
  )
  expect(
    started.relayUrl === relay.url && started.createSecret === SECRET,
    "shared with the secret",
  )
  await page.locator('.mp-popover[data-stage="live"]').waitFor()
}

// --- Section 1 B: Settings › Multiplayer ------------------------------------------------------------

async function fromSettings(ctx: E2EContext, theme: Theme) {
  const { page } = ctx
  await open(ctx, "settings", theme)
  await page.locator(".mp-setup-relay-settings").waitFor()
  const T = await tokens(page, COLORS)
  const m = await measure(page, {
    actions: ".mp-relay-box__actions",
    setUp: ".mp-setup-relay-settings",
    setting: '.mp-setting[data-pen="O29Rk8"]',
    secretLabel: '.mp-setting[data-pen="O29Rk8"] .rw-label',
    auto: '[data-box="automatic"]',
    autoIcon: '[data-box="automatic"] .rw-box__icon',
    autoTitle: '[data-box="automatic"] .rw-label-strong',
    autoDesc: '[data-box="automatic"] .rw-desc',
    show: '[data-box="automatic"] .kimo-button',
  })
  const c = checker(ctx, `§1 B Settings › Multiplayer (${theme})`)
  c.box("Actions (TPCDP)", m.actions, { pad: "4 0 0 0", gap: 12, align: "center" })
  c.box("Set up a relay (a3mrXQ)", m.setUp, {
    h: 28,
    pad: "0 12 0 12",
    bg: T["--kimo-bg-muted"] as string,
  })
  c.box("Setting · Create secret (O29Rk8)", m.setting, {
    pad: "12 0 12 0",
    gap: 8,
    shadowHas: `${T["--kimo-border"]} 0px -1px 0px 0px inset`,
  })
  c.box("Label (gRkkL)", m.secretLabel, {
    fs: 12,
    fw: "500",
    color: T["--kimo-text-primary"] as string,
  })
  c.box("Automatic (yrems)", m.auto, {
    pad: "8 6 8 12",
    gap: 10,
    align: "center",
    radius: 10,
    bg: T["--kimo-bg-subtle"] as string,
    shadowHas: `${T["--kimo-border"]} 0px 0px 0px 1px inset`,
  })
  c.box("Icon (C0RqtO)", m.autoIcon, { w: 14, h: 14, color: T["--kimo-text-secondary"] as string })
  c.box("Title (sC4Nm)", m.autoTitle, { fs: 12, fw: "500" })
  c.box("Desc (L9NPq)", m.autoDesc, { fs: 11, color: T["--kimo-text-tertiary"] as string })
  c.box("Show (SE8ZS)", m.show, { h: 26, pad: "0 10 0 10" })
  c.flush()
  // Show reveals the secret with Copy; Copy puts the real value on the clipboard.
  await page.click('[data-box="automatic"] .kimo-button:has-text("Show")')
  await page.locator('[data-secret="shown"]').waitFor()
  const shown = await page.locator('[data-secret="shown"]').innerText()
  expect(/^kimo_cs_[A-Za-z0-9_-]{43}$/.test(shown), `an Automatic secret (${shown.slice(0, 10)}…)`)
  await page.click('[data-box="automatic"] [aria-label="Copy secret"]')
  const clip = await page.evaluate(
    () => (window as unknown as { __clipboard?: string }).__clipboard,
  )
  expect(clip === shown, "Copy copies the real value")
  await page.click('[data-box="automatic"] .kimo-button:has-text("Hide")')
  expect((await page.locator('[data-secret="shown"]').count()) === 0, "Hide masks it again")
  // Set up a relay opens the same wizard; Escape closes it.
  await page.click(".mp-setup-relay-settings")
  await page.locator('.rw-shell[data-step="choose"]').waitFor()
  await page.keyboard.press("Escape")
  await page.locator(".rw-shell").waitFor({ state: "detached" })
}

// --- Section 3: This computer on desktop (scripted host) -----------------------------------------------

async function desktopLocal(ctx: E2EContext, theme: Theme) {
  const { page } = ctx
  await open(ctx, "desktop", theme)
  await page.locator('.rw-shell[data-step="choose"]').waitFor()
  expect(
    (await page.getAttribute('.rw-option[data-value="local"]', "aria-checked")) === "true",
    "desktop preselects This computer",
  )
  await measureShell(ctx, `§2 A Choose · desktop (${theme})`, 8).then(({ c }) => c.flush())
  await page.keyboard.press("Enter")
  await page.locator('.rw-group[data-group="reach"]').waitFor()
  const T = await tokens(page, COLORS)
  await page.click('.rw-reach[data-value="quick"]')
  {
    const { c } = await measureShell(ctx, `§3 B ready (${theme})`, 16)
    const m = await measure(page, {
      checks: '.rw-group[data-group="checks"]',
      check: '.rw-group[data-group="checks"] .rw-check',
      reach: '.rw-reach[data-value="lan"]',
      quick: '.rw-reach[data-value="quick"]',
      titleRow: '.rw-reach[data-value="quick"] .rw-title-row',
      auto: '[data-box="automatic"]',
      note: ".rw-body > .rw-note",
      dotDone: '.rw-step[data-state="done"] .rw-step__dot',
    })
    c.box("Group · Checks (XTEjW)", m.checks, { gap: 8 })
    c.box("Check · Bun (RGy5V)", m.check, { gap: 8, align: "center" })
    c.box("Reach · Same network only (Dq2QR)", m.reach, {
      pad: "10 12 10 12",
      gap: 10,
      radius: 10,
      shadowHas: `${T["--kimo-border"]} 0px 0px 0px 1px inset`,
    })
    c.box("Reach · Quick tunnel · selected (ADfN1)", m.quick, {
      bg: T["--kimo-bg-subtle"] as string,
      shadowHas: `${T["--kimo-accent"]} 0px 0px 0px 1.5px inset`,
    })
    c.box("Title Row (pDdac)", m.titleRow, { gap: 6, align: "center" })
    c.box("Automatic (u8lap)", m.auto, { pad: "8 6 8 12", gap: 10 })
    c.box("Tradeoff Note (Brdqo)", m.note, {
      pad: "8 10 8 10",
      gap: 8,
      bg: T["--kimo-bg-subtle"] as string,
    })
    c.flush()
  }
  expect(
    (await page.locator('.rw-group[data-group="checks"]').innerText()).includes("Bun 1.2.19"),
    "Bun found",
  )
  await page.click('[data-action="start-relay"]')
  await page.locator('[data-address="globe"]').waitFor({ timeout: 8000 })
  {
    const m = await measure(page, {
      status: ".rw-body .rw-status",
      lan: '[data-address="wifi"]',
      lanUrl: '[data-address="wifi"] .rw-mono--primary',
      warning: ".rw-note--warning",
      stop: '[data-action="stop-relay"]',
    })
    const c = checker(ctx, `§3 D running · quick tunnel (${theme})`)
    c.box("Status (X1Bnq)", m.status, { gap: 10, align: "center" })
    c.box("Address · Same network (abyOA)", m.lan, {
      pad: "8 6 8 12",
      gap: 10,
      radius: 10,
      bg: T["--kimo-bg-subtle"] as string,
    })
    c.box("URL (eFs0x)", m.lanUrl, { fs: 11, color: T["--kimo-text-primary"] as string })
    c.box("Quick Tunnel Warning (CeGmj)", m.warning, {
      pad: "8 10 8 10",
      gap: 8,
      bg: T["--kimo-warning-soft"] as string,
    })
    c.box("Stop relay (JnKKR)", m.stop, { h: 30, color: T["--kimo-danger"] as string })
    c.flush()
  }
  const addresses = await page.locator('.rw-group[data-group="addresses"]').innerText()
  expect(addresses.includes("ws://192.168.1.24:8787"), "same-network address")
  expect(addresses.includes("wss://quiet-otter-lime.trycloudflare.com"), "quick tunnel address")
  const spawned = await page.evaluate(() => {
    const w = window as unknown as {
      __board42: { host: { spawned: { kind: string; env?: Record<string, string> }[] } }
    }
    return w.__board42.host.spawned.map((s) => ({ kind: s.kind, env: s.env ?? {} }))
  })
  const relayEnv = spawned.find((s) => s.kind === "relay")?.env ?? {}
  expect(relayEnv.PORT === "8787", "port 8787")
  expect(/^kimo_cs_/.test(relayEnv.KIMO_CREATE_SECRET ?? ""), "the Automatic secret is injected")
  expect(relayEnv.KIMO_ALLOWED_ORIGINS === undefined, "desktop adds no origins")
  await page.click('[data-action="stop-relay"]')
  await page.locator('.rw-group[data-group="reach"]').waitFor()
}

const both = (name: string, run: (ctx: E2EContext, theme: Theme) => Promise<void>): Scenario => ({
  name,
  async run(ctx) {
    await run(ctx, "light")
    await run(ctx, "dark")
  },
})

export const scenarios: Scenario[] = [
  {
    name: "board42 relay setup: Share popover → I already have a relay → secret rejected → test ok → save → share",
    async run(ctx) {
      const relay = await startRelay()
      try {
        await fromShare(ctx, "light", relay)
        await fromShare(ctx, "dark", relay)
      } finally {
        await relay.stop()
      }
    },
  },
  both("board42 relay setup: Settings › Multiplayer secret and Set up a relay", fromSettings),
  both("board42 relay setup: This computer on desktop with a quick tunnel", desktopLocal),
]
