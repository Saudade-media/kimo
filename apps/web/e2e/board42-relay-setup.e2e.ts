/**
 * Board 42 "Relay setup" (desing.pen UYvSG) and the board 41 ownership states (kCAYr sections 3,
 * 4 and 5, ADR 0017), end to end against a real relay (apps/server, started here on a free port,
 * unclaimed): the Share popover on a relay nobody claimed (G); I already have a relay, free to
 * claim; the Test claims it (claimed by you); Save and use, Start sharing. A second page is another
 * device: the probe and the Test say Not yours (C), the popover shows the Fix (H). Settings ›
 * Multiplayer lists the devices; Add device makes a pairing link that another device redeems
 * (Added); rename in place; remove with a confirm. The pairing link landing adds this page's
 * device. The desktop path (This computer, quick tunnel) runs over a scripted relay host and
 * starts the relay with this device's key.
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

/** apps/server on a free port (never 8787), in memory, unclaimed; 15 s to start. */
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

/** Types a relay URL into the open Share popover's field and waits for its result. */
async function popoverCheck(page: Page, url: string, owner: string) {
  const input = page.locator(".mp-popover .mp-relay-input input")
  await input.fill(url)
  await input.blur()
  await page
    .locator(`.mp-popover .mp-result[data-result="ok"]`)
    .waitFor({ timeout: 8000 })
    .catch(() => undefined)
  await page.waitForFunction(
    (o) =>
      document.querySelector(".mp-popover .mp-result [data-tone]")?.textContent?.includes(o) ===
      true,
    owner,
    { timeout: 8000 },
  )
}

async function fromShare(ctx: E2EContext, theme: Theme, relay: TestRelay) {
  const { page } = ctx
  await open(ctx, "share", theme)
  await page.click(".b42-share")
  await page.locator('.mp-popover[data-stage="first-run"]').waitFor()
  const T = await tokens(page, COLORS)
  const R = await px(page, ["--kimo-radius-md"])
  {
    const m = await measure(page, {
      body: ".mp-popover .mp-body",
      setUp: ".mp-setup-relay",
      or: ".mp-or",
      line: ".mp-or__line",
      orLabel: ".mp-or__label",
      field: '.mp-field[data-pen="mHqqj"]',
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
    c.box("Field · Relay URL (mHqqj)", m.field, { gap: 6, dir: "column" })
    expect(
      (await page.locator(".mp-popover .mp-footnote").innerText()) === "Set once, kept in Settings",
      "footnote",
    )
    expect(
      (await page.locator(".mp-popover").innerText()).toLowerCase().includes("secret") === false,
      "the popover never says secret",
    )
    expect(
      (m.or?.y ?? 0) > (m.setUp?.y ?? 0) && (m.field?.y ?? 0) > (m.or?.y ?? 0),
      "Set up a relay sits above the manual field",
    )
    c.flush()
  }
  // G: a relay nobody claimed yet. Start sharing would claim it; Settings keeps it.
  await popoverCheck(page, relay.url, "Not set up yet")
  {
    const m = await measure(page, {
      pill: ".mp-popover .mp-result [data-tone]",
      meta: ".mp-popover .mp-result .mp-meta-mono",
      desc: ".mp-popover .mp-body > .mp-desc",
    })
    const c = checker(ctx, `§3 G not claimed yet (${theme})`)
    c.box("Status · Not set up yet (wV2JS)", m.pill, {
      bg: T["--kimo-bg-muted"] as string,
      color: T["--kimo-text-secondary"] as string,
    })
    c.box("Meta (x8w3Kz)", m.meta, { fs: 11, color: T["--kimo-text-tertiary"] as string })
    c.box("Desc (A0k08E)", m.desc, { fs: 11, color: T["--kimo-text-secondary"] as string })
    c.flush()
    expect(
      (await page.locator(".mp-popover .mp-body > .mp-desc").innerText()).startsWith(
        "Kimo will claim it when you start sharing",
      ),
      "G says Start sharing claims it",
    )
    expect(
      /^Kimo relay \d.* · \d+ ms$/.test(
        await page.locator(".mp-popover .mp-result .mp-meta-mono").innerText(),
      ),
      "meta: Kimo relay version · ms",
    )
  }

  // A passing check keeps the URL in Settings (the popover turns to B); clear it to see A again.
  await page.evaluate(() =>
    (
      window as unknown as {
        __board42: { model: { settings: { setRelayUrl(u: string | null): Promise<unknown> } } }
      }
    ).__board42.model.settings.setRelayUrl(null),
  )
  await page.click(".b42-share")
  await page.click(".b42-share")
  await page.locator('.mp-popover[data-stage="first-run"]').waitFor()
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
  expect(
    (await page.locator(".rw-shell").innerText()).toLowerCase().includes("secret") === false,
    "the wizard never says secret",
  )
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
  // §7 A: the probe runs on blur and says the relay is free to claim; nothing is claimed yet.
  const urlInput = page.locator(".rw-body .rw-field input").first()
  await urlInput.fill(relay.url)
  await urlInput.blur()
  await page.locator('.rw-probe[data-probe="unclaimed"]').waitFor({ timeout: 8000 })
  expect(
    (await page.locator(".rw-probe .rw-mono").innerText()) === "not claimed yet",
    "the probe says not claimed yet",
  )
  {
    const { c } = await measureShell(ctx, `§7 A I already have a relay · free (${theme})`, 16)
    const m = await measure(page, {
      field: ".rw-body .rw-field",
      label: ".rw-body .rw-field .rw-label",
      inputRow: ".rw-body .rw-field .rw-input-row",
      probe: ".rw-probe",
      probeMeta: ".rw-probe .rw-mono",
      free: '.rw-none[data-claim="free"]',
      freeIcon: '.rw-none[data-claim="free"] .rw-none__icon',
      freeText: '.rw-none[data-claim="free"] .rw-desc',
    })
    c.box("Field · Relay URL (hZYRP)", m.field, { gap: 6, dir: "column" })
    c.box("Label (N3i1S0)", m.label, {
      fs: 11,
      fw: "500",
      color: T["--kimo-text-secondary"] as string,
    })
    c.box("Input Row (mZIXN)", m.inputRow, { gap: 4, align: "center" })
    c.box("Probe (JkSYm)", m.probe, { gap: 8, align: "center" })
    c.box("Meta (nwxwO)", m.probeMeta, { fs: 11, color: T["--kimo-text-tertiary"] as string })
    c.box("Free (L5vX4b)", m.free, {
      pad: "8 12 8 12",
      gap: 8,
      align: "center",
      radius: R["--kimo-radius-md"] as number,
      bg: T["--kimo-bg-subtle"] as string,
    })
    c.box("Icon (G12xt8)", m.freeIcon, { w: 14, h: 14, color: T["--kimo-success"] as string })
    c.box("Text (n3Aw2r)", m.freeText, { fs: 11, color: T["--kimo-text-secondary"] as string })
    c.flush()
  }
  // §8 B: the Test claims it for this device.
  await page.click('[data-action="test-relay"]')
  await page.locator('.rw-shell[data-step="test"]').waitFor()
  await page.locator('.rw-target [data-tone="success"]').waitFor({ timeout: 8000 })
  // Test relay sat where Save and use is now: move off it, so the measure is not a hover.
  await page.mouse.move(0, 0)
  {
    const { c } = await measureShell(ctx, `§8 B test ok · claimed by you (${theme})`, 16)
    const m = await measure(page, {
      target: ".rw-target",
      url: ".rw-target .rw-mono--primary",
      checks: '.rw-group[data-group="test"]',
      row: '[data-check="ownership"]',
      label: '[data-check="ownership"] .rw-check__label',
      meta: '[data-check="ownership"] .rw-mono',
      icon: '[data-check="ownership"] .rw-check__icon',
    })
    c.box("Target (nhcsR)", m.target, { gap: 8, align: "center" })
    c.box("URL (w2HvQb)", m.url, { fs: 11, color: T["--kimo-text-primary"] as string })
    c.box("Checks (yF639)", m.checks, { gap: 8, dir: "column" })
    c.box("Check · Ownership (v5f1V)", m.row, { gap: 8, align: "center" })
    c.box("Label (QlBVW)", m.label, { fs: 12, color: T["--kimo-text-primary"] as string })
    c.box("Meta (qccOZ)", m.meta, { fs: 11, color: T["--kimo-text-tertiary"] as string })
    c.box("Icon (S47PUY)", m.icon, { w: 14, h: 14, color: T["--kimo-success"] as string })
    c.flush()
  }
  const lines = await page.locator('.rw-group[data-group="test"] .rw-check').allInnerTexts()
  expect(lines.length === 4, `four checks (${lines.join(" | ")})`)
  expect(lines[2]?.includes("kimo-mp/1"), "protocol kimo-mp/1")
  expect(lines[3]?.includes("Ownership") && lines[3]?.includes("claimed by you"), "claimed")
  const owner = await fetch(`${relay.url}/version`).then(
    (r) => r.json() as Promise<{ owner: string }>,
  )
  expect(owner.owner === "claimed", "the relay now has an owner")
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
  expect(
    (await page.locator(".rw-saved__desc").innerText()).includes("This relay is yours now."),
    "saved says yours",
  )
  const stored = await page.evaluate(() => {
    const w = window as unknown as {
      __board42: { platform: { settings: { get(k: string): unknown } } }
    }
    return {
      url: w.__board42.platform.settings.get("multiplayer.relayUrl"),
      setup: w.__board42.platform.settings.get("multiplayer.relaySetup"),
    }
  })
  expect(stored.url === relay.url, `relay URL saved (${stored.url})`)
  expect(
    (stored.setup as { path?: string }).path === "existing" &&
      !JSON.stringify(stored.setup).includes("secret"),
    `setup stored (${JSON.stringify(stored.setup)})`,
  )
  // Start sharing: this file goes live on the saved relay.
  await page.click('[data-action="start-sharing"]')
  await page.waitForFunction(() => (window as unknown as { __started?: unknown }).__started != null)
  const started = await page.evaluate(
    () => (window as unknown as { __started: { relayUrl: string } }).__started,
  )
  expect(started.relayUrl === relay.url, "shared on the saved relay")
  await page.locator('.mp-popover[data-stage="live"]').waitFor()
}

// --- Another device: not yours (§3 H, §8 C) ------------------------------------------------------

async function notYours(ctx: E2EContext, theme: Theme, relay: TestRelay) {
  const { page } = ctx
  // A fresh page is a new device (its key lives in memory).
  await open(ctx, "share", theme)
  const T = await tokens(page, COLORS)
  const R = await px(page, ["--kimo-radius-md"])
  await page.click(".b42-share")
  await page.locator('.mp-popover[data-stage="first-run"]').waitFor()
  await popoverCheck(page, relay.url, "Not yours")
  const fix = async (scope: string, label: string, ids: Record<string, string>) => {
    const m = await measure(page, {
      fix: `${scope} .rw-fix[data-fix="not-yours"]`,
      title: `${scope} .rw-fix .rw-title`,
      desc: `${scope} .rw-fix .rw-desc`,
      actions: `${scope} .rw-fix .rw-actions`,
      add: `${scope} [data-action="add-this-device"]`,
      reset: `${scope} [data-action="reset-ownership"]`,
      pill: `${scope} [data-tone="warning"]`,
    })
    const c = checker(ctx, label)
    c.box(`Fix (${ids.fix})`, m.fix, {
      pad: "10 12 10 12",
      gap: 8,
      dir: "column",
      radius: R["--kimo-radius-md"] as number,
      bg: T["--kimo-warning-soft"] as string,
    })
    c.box(`Title (${ids.title})`, m.title, {
      fs: 12,
      fw: "600",
      color: T["--kimo-text-primary"] as string,
    })
    c.box(`Desc (${ids.desc})`, m.desc, { fs: 11, color: T["--kimo-text-secondary"] as string })
    c.box(`Actions (${ids.actions})`, m.actions, { gap: 6, align: "center" })
    c.box(`Add this device (${ids.add})`, m.add, { h: 26, pad: "0 10 0 10" })
    c.box(`Reset ownership (${ids.reset})`, m.reset, { h: 26, pad: "0 10 0 10" })
    c.box(`Status · Not yours (${ids.pill})`, m.pill, {
      bg: T["--kimo-warning-soft"] as string,
      color: T["--kimo-warning"] as string,
    })
    c.flush()
  }
  await fix(".mp-popover", `§3 H belongs to another Kimo (${theme})`, {
    fix: "U5YOHw",
    title: "Aq1Qq",
    desc: "UUS2u",
    actions: "fC303",
    add: "a9rbX",
    reset: "S1MiNd",
    pill: "ixz8K",
  })
  expect(
    (await page.getAttribute(".mp-popover .mp-start", "disabled")) !== null,
    "Start sharing is disabled on another Kimo's relay",
  )
  // I: Add this device explains the pairing link.
  await page.click('.mp-popover [data-action="add-this-device"]')
  await page.locator(".mp-add-this-device").waitFor()
  expect(
    (await page.locator(".mp-add-this-device").innerText()).includes(
      "open Settings › Multiplayer and choose Add device",
    ),
    "the steps name Add device",
  )
  await page.click(".mp-add-this-device .kimo-dialog__button--confirm")
  await page.locator(".mp-add-this-device").waitFor({ state: "detached" })

  // The wizard's Test says the same (§8 C).
  await open(ctx, "share", theme)
  await page.click(".b42-share")
  await page.click(".mp-setup-relay")
  await page.click('.rw-option[data-value="existing"]')
  await page.click('[data-action="continue"]')
  const urlInput = page.locator(".rw-body .rw-field input").first()
  await urlInput.fill(relay.url)
  await urlInput.blur()
  await page.locator('.rw-probe[data-probe="other"]').waitFor({ timeout: 8000 })
  await page.click('[data-action="test-relay"]')
  await page.locator('.rw-target [data-tone="warning"]').waitFor({ timeout: 8000 })
  expect(
    (await page.locator('[data-check="ownership"]').innerText()).includes("not yours"),
    "the Ownership line says not yours",
  )
  expect(
    (await page.getAttribute('.rw-footer [data-action="save"]', "disabled")) !== null,
    "Save and use waits for a relay that is yours",
  )
  await fix(".rw-body", `§8 C belongs to another Kimo (${theme})`, {
    fix: "gnLEW",
    title: "gz5Oz",
    desc: "Yy3BN",
    actions: "yErox",
    add: "Q8sxg",
    reset: "Nir4N",
    pill: "BpLpq",
  })
  expect(
    (await page.locator('.rw-footer [data-action="test-again"]').count()) === 1,
    "Test again in the footer",
  )
}

// --- Section 4: Settings › Multiplayer › Devices ------------------------------------------------------

async function fromSettings(ctx: E2EContext, theme: Theme) {
  const { page } = ctx
  const relay = await startRelay()
  try {
    await open(ctx, "settings", theme)
    await page.locator(".mp-setup-relay-settings").waitFor()
    // This page's device claims the relay, which is then the saved one.
    await page.evaluate(async (url) => {
      const w = window as unknown as {
        __board42: {
          ownership: { claimRelay(u: string): Promise<unknown> }
          model: { settings: { setRelayUrl(u: string): Promise<unknown> } }
        }
      }
      await w.__board42.ownership.claimRelay(url)
      await w.__board42.model.settings.setRelayUrl(url)
    }, relay.url)
    await open(ctx, "settings", theme)
    // The harness keeps no state across loads: this page is another device, so not yours.
    await page.evaluate(async (url) => {
      const w = window as unknown as {
        __board42: {
          ownership: { claimRelay(u: string): Promise<unknown> }
          model: {
            settings: { setRelayUrl(u: string): Promise<unknown> }
            relayTest: { test(u: string): Promise<unknown> }
          }
        }
      }
      await w.__board42.model.settings.setRelayUrl(url)
      await w.__board42.model.relayTest.test(url)
    }, relay.url)
    await page.locator(".mp-result-group, .mp-result").first().waitFor({ timeout: 8000 })
    const T = await tokens(page, COLORS)
    const R = await px(page, ["--kimo-radius-md", "--kimo-radius-pill", "--kimo-radius-xl"])
    {
      // Not yours: the first load claimed it as another device.
      await page.locator('.mp-result-group[data-owner="other"]').waitFor({ timeout: 8000 })
      const m = await measure(page, {
        group: '.mp-result-group[data-owner="other"]',
        row: '.mp-result-group[data-owner="other"] .mp-result',
        pill: '.mp-result-group [data-tone="warning"]',
        message: ".mp-result-group > .mp-desc",
        actions: ".mp-result-group > .rw-actions",
        add: '.mp-result-group [data-action="add-this-device"]',
      })
      const c = checker(ctx, `§4 Ownership · not yours (${theme})`)
      c.box("Result (dXh4T)", m.group, { gap: 8, dir: "column" })
      c.box("Status Row (EWlXa)", m.row, { gap: 8, align: "center" })
      c.box("Status · Not yours (is3ic)", m.pill, {
        bg: T["--kimo-warning-soft"] as string,
        color: T["--kimo-warning"] as string,
      })
      c.box("Message (X00Qb)", m.message, {
        fs: 11,
        color: T["--kimo-text-secondary"] as string,
      })
      c.box("Actions (lKzP3)", m.actions, { gap: 6, align: "center" })
      c.box("Add this device (f9DdU)", m.add, { h: 26, pad: "0 10 0 10" })
      c.flush()
      expect((await page.locator(".mp-devices").count()) === 0, "no Devices when not yours")
    }
    // A fresh relay this page claims: Yours, and the Devices group.
    const mine = await startRelay()
    try {
      await page.evaluate(async (url) => {
        const w = window as unknown as {
          __board42: {
            ownership: { claimRelay(u: string): Promise<unknown> }
            model: {
              settings: { setRelayUrl(u: string): Promise<unknown> }
              relayTest: { test(u: string): Promise<unknown> }
            }
          }
        }
        await w.__board42.ownership.claimRelay(url)
        await w.__board42.model.settings.setRelayUrl(url)
        await w.__board42.model.relayTest.test(url)
      }, mine.url)
      await page.locator(".mp-devices .mp-device").first().waitFor({ timeout: 8000 })
      expect(
        (await page.locator(".mp-result [data-tone]").innerText()) === "Yours",
        "the result says Yours",
      )
      {
        const m = await measure(page, {
          setting: ".mp-devices",
          label: ".mp-devices .mp-setting__label",
          desc: ".mp-devices .mp-text .mp-desc",
          list: ".mp-device-list",
          row: ".mp-device",
          icon: ".mp-device__icon",
          name: ".mp-device__name",
          badge: ".mp-device__self",
          meta: ".mp-device__meta",
          hint: ".mp-device-hint",
          hintIcon: ".mp-device-hint__icon",
          hintText: ".mp-device-hint__text",
          footer: ".mp-devices__footer",
          add: '[data-action="add-device"]',
          footHint: ".mp-devices__footer .mp-meta",
        })
        const c = checker(ctx, `§4 Devices · last device (${theme})`)
        c.box("Setting · Devices (gon1u)", m.setting, {
          pad: "12 0 12 0",
          gap: 8,
          dir: "column",
          shadowHas: `${T["--kimo-border"]} 0px -1px 0px 0px inset`,
        })
        c.box("Label (rjAw4)", m.label, {
          fs: 12,
          fw: "500",
          color: T["--kimo-text-primary"] as string,
        })
        c.box("Desc (aTQyB)", m.desc, { fs: 11, color: T["--kimo-text-secondary"] as string })
        c.box("List (YC312)", m.list, {
          dir: "column",
          radius: R["--kimo-radius-md"] as number,
          shadowHas: `${T["--kimo-border"]} 0px 0px 0px 1px inset`,
        })
        c.box("Device · Mac (ITYAY)", m.row, { pad: "8 8 8 10", gap: 10, align: "center" })
        c.box("Icon Wrap (v9o91)", m.icon, {
          w: 28,
          h: 28,
          radius: R["--kimo-radius-pill"] as number,
          bg: T["--kimo-bg-muted"] as string,
          color: T["--kimo-text-secondary"] as string,
        })
        c.box("Name (zIRtS)", m.name, {
          fs: 12,
          fw: "500",
          color: T["--kimo-text-primary"] as string,
        })
        c.box("This device (CvNPZ)", m.badge, {
          pad: "2 8 2 8",
          bg: T["--kimo-bg-muted"] as string,
        })
        c.box("Meta (KmveM)", m.meta, { fs: 11, color: T["--kimo-text-tertiary"] as string })
        c.box("Hint · one device (PdZQM)", m.hint, { gap: 6, dir: "row" })
        c.box("Icon (bS0j6)", m.hintIcon, { color: T["--kimo-text-tertiary"] as string })
        c.box("Text (ZRM7m)", m.hintText, { fs: 11, color: T["--kimo-text-tertiary"] as string })
        c.box("Footer (TpdGV)", m.footer, { gap: 8, align: "center" })
        c.box("Add device (n1w0fL)", m.add, { h: 28, pad: "0 12 0 12", fs: 12 })
        c.box("Hint (pAyol)", m.footHint, { fs: 11, color: T["--kimo-text-tertiary"] as string })
        c.flush()
      }
      expect(
        (await page.locator(".mp-device__remove").getAttribute("disabled")) !== null,
        "the last device cannot be removed",
      )
      // Add device: the sheet makes the link and copies it at once.
      await page.click('[data-action="add-device"]')
      await page.locator('.mp-sheet[data-sheet="link"] [data-testid="pairing-link"]').waitFor()
      await page.waitForFunction(() =>
        ((window as unknown as { __clipboard?: string }).__clipboard ?? "").includes("/pair#"),
      )
      const link = await page.evaluate(
        () => (window as unknown as { __clipboard: string }).__clipboard,
      )
      expect(
        link.includes(`/pair#${mine.url}/`),
        `a pairing link for the relay (${link.slice(0, 40)}…)`,
      )
      {
        const m = await measure(page, {
          sheet: ".mp-sheet",
          head: ".mp-sheet__head",
          icon: ".mp-sheet__icon",
          title: ".mp-sheet__title",
          desc: ".mp-sheet__desc",
          link: ".mp-sheet__link",
          row: ".mp-sheet__link-row",
          field: ".mp-sheet__field",
          url: ".mp-sheet__url",
          copy: ".mp-sheet__copy",
          status: ".mp-sheet__status",
          footer: ".mp-sheet__footer",
          cancel: ".mp-sheet__cancel",
          done: ".mp-sheet__done",
        })
        const c = checker(ctx, `§4 Add device · link ready (${theme})`)
        c.box("Sheet · Add device (sgnIX)", m.sheet, {
          w: 464,
          pad: "20 20 20 20",
          gap: 14,
          dir: "column",
          radius: R["--kimo-radius-xl"] as number,
          bg: T["--kimo-bg-overlay"] as string,
          shadowHas: "0px 16px 48px",
        })
        c.box("Head (W8JU4F)", m.head, { gap: 12, dir: "row" })
        c.box("Icon Wrap (wk6OE)", m.icon, {
          w: 32,
          h: 32,
          bg: T["--kimo-bg-muted"] as string,
          color: T["--kimo-text-primary"] as string,
        })
        c.box("Title (NUJMJ)", m.title, { fs: 14, fw: "600" })
        c.box("Desc (CeC0H)", m.desc, { fs: 12, color: T["--kimo-text-secondary"] as string })
        c.box("Link (HWe4n)", m.link, { gap: 8, dir: "column" })
        c.box("Link Row (QM17u)", m.row, { gap: 8, align: "center" })
        c.box("Field (Zf48v)", m.field, {
          h: 32,
          pad: "0 10 0 10",
          gap: 8,
          radius: R["--kimo-radius-md"] as number,
          bg: T["--kimo-bg-muted"] as string,
        })
        c.box("URL (l4XsXi)", m.url, { fs: 11, color: T["--kimo-text-primary"] as string })
        c.box("Copy (I92WY)", m.copy, { h: 32, pad: "0 12 0 12" })
        c.box("Status (GbN9C)", m.status, {
          gap: 6,
          align: "center",
          fs: 11,
          color: T["--kimo-text-tertiary"] as string,
        })
        c.box("Footer (kyK4z)", m.footer, { gap: 8, align: "center" })
        c.box("Cancel link (RF4Td)", m.cancel, { h: 30, pad: "0 12 0 12" })
        c.box("Done (JILUE)", m.done, { h: 30, pad: "0 14 0 14" })
        c.flush()
      }
      expect(
        /Waiting for the other device · 1[45]:\d\d left/.test(
          await page.locator(".mp-sheet__status").innerText(),
        ),
        "a live countdown",
      )
      // Another device uses the link: the sheet turns into Added, the list grows.
      await page.evaluate(
        (l) =>
          (
            window as unknown as {
              __board42: { pairOther(link: string, name: string): Promise<unknown> }
            }
          ).__board42.pairOther(l, "Chrome on Windows"),
        link,
      )
      await page.locator('.mp-sheet[data-sheet="added"]').waitFor({ timeout: 8000 })
      expect(
        (await page.locator(".mp-sheet__title").innerText()) === "Added Chrome on Windows",
        "Added names the device",
      )
      await page.click('.mp-sheet [data-action="done"]')
      await page.locator(".mp-sheet").waitFor({ state: "detached" })
      expect((await page.locator(".mp-device").count()) === 2, "two devices")
      expect((await page.locator(".mp-device-hint").count()) === 0, "no hint with two")
      // Rename in place: Enter saves.
      const first = page.locator(".mp-device").first()
      await first.hover()
      await first.locator(".mp-device__rename").click()
      await page.locator(".mp-device__name-field").waitFor()
      {
        const m = await measure(page, { field: ".mp-device__name-field" })
        const c = checker(ctx, `§4 Devices · rename in place (${theme})`)
        c.box("Name Field (QgcKp)", m.field, {
          w: 160,
          h: 24,
          pad: "0 6 0 6",
          fs: 12,
          fw: "500",
          bg: T["--kimo-bg-muted"] as string,
          shadowHas: `${T["--kimo-accent"]} 0px 0px 0px 1px inset`,
        })
        c.flush()
      }
      await page.locator(".mp-device__name-field").fill("Work Mac")
      await page.keyboard.press("Enter")
      await page.waitForFunction(() =>
        [...document.querySelectorAll(".mp-device__name")].some(
          (e) => e.textContent === "Work Mac",
        ),
      )
      // Remove the other device: confirm first.
      const other = page.locator(".mp-device", { hasText: "Chrome on Windows" })
      await other.hover()
      await other.locator(".mp-device__remove").click()
      await page.locator(".mp-remove-device").waitFor()
      expect(
        (await page.locator(".mp-remove-device .kimo-dialog__title").innerText()) ===
          "Remove Chrome on Windows?",
        "the confirm names the device",
      )
      await page.click(".mp-remove-device .kimo-dialog__button--confirm")
      await page.waitForFunction(() => document.querySelectorAll(".mp-device").length === 1)
      expect(
        (await page.locator(".b42-pane").innerText()).toLowerCase().includes("secret") === false,
        "Settings never says secret",
      )
    } finally {
      await mine.stop()
    }
  } finally {
    await relay.stop()
  }
}

// --- Settings after the wizard claimed the relay: Yours and Devices at once ----------------------------

async function settingsAfterWizard(ctx: E2EContext, theme: Theme) {
  const { page } = ctx
  const relay = await startRelay()
  try {
    await open(ctx, "settings", theme)
    // The saved relay is nobody's yet: the pane says Not claimed yet.
    await page.evaluate(async (url) => {
      const w = window as unknown as {
        __board42: {
          model: {
            settings: { setRelayUrl(u: string): Promise<unknown> }
            relayTest: { test(u: string): Promise<unknown> }
          }
        }
      }
      await w.__board42.model.settings.setRelayUrl(url)
      await w.__board42.model.relayTest.test(url)
    }, relay.url)
    await page.locator('.mp-result-group[data-owner="unclaimed"]').waitFor({ timeout: 8000 })
    // Set up a relay › I already have a relay › Test claims it › Save and use › Close.
    await page.click(".mp-setup-relay-settings")
    await page.click('.rw-option[data-value="existing"]')
    await page.click('[data-action="continue"]')
    const urlInput = page.locator(".rw-body .rw-field input").first()
    await urlInput.fill(relay.url)
    await page.click('[data-action="test-relay"]')
    await page.locator('.rw-target [data-tone="success"]').waitFor({ timeout: 8000 })
    await page.click('[data-action="save"]')
    await page.locator('.rw-shell[data-step="saved"]').waitFor()
    await page.click('.rw-shell [data-action="close"]')
    await page.locator(".rw-shell").waitFor({ state: "detached" })
    // No Test click: the pane reads Yours and lists this device.
    await page.locator(".mp-devices .mp-device").first().waitFor({ timeout: 8000 })
    expect(
      (await page.locator(".mp-result [data-tone]").innerText()) === "Yours",
      "the pane says Yours after the wizard",
    )
    expect(
      (await page.locator('.mp-result-group[data-owner="unclaimed"]').count()) === 0,
      "Not claimed yet is gone",
    )
  } finally {
    await relay.stop()
  }
}

// --- Section 5 H to N: the pairing link landing ------------------------------------------------------

async function pairLanding(ctx: E2EContext, theme: Theme) {
  const { page } = ctx
  const relay = await startRelay()
  try {
    // An owner device (in this page) makes a link; a fresh page opens it.
    await open(ctx, "settings", theme)
    const link = await page.evaluate(async (url) => {
      const w = window as unknown as {
        __board42: {
          ownership: {
            claimRelay(u: string): Promise<unknown>
            createPairingLink(u: string): Promise<{ link: string }>
          }
        }
      }
      await w.__board42.ownership.claimRelay(url)
      return (await w.__board42.ownership.createPairingLink(url)).link
    }, relay.url)
    await page.goto(
      `${await harnessUrl(ctx)}?run=${Date.now()}&surface=pair&theme=${theme}&link=${encodeURIComponent(link)}`,
    )
    await page.locator('[data-testid="pair-card"][data-outcome="ready"]').waitFor()
    const T = await tokens(page, COLORS)
    const R = await px(page, ["--kimo-radius-xl"])
    {
      const m = await measure(page, {
        card: '[data-testid="pair-card"]',
        head: ".join-card__head",
        title: ".join-card__title",
        host: ".join-card__head .join-card__meta",
        desc: ".pair-card__desc",
        meta: '[data-testid="pair-card"] > .join-card__meta',
        field: ".pair-card__field",
        label: ".pair-card__label",
        actions: ".pair-card__actions",
        notNow: ".pair-card__not-now",
        add: ".pair-card__add",
      })
      const c = checker(ctx, `§5 H pairing link · add this device (${theme})`)
      c.box("Pair Card (VQHDH)", m.card, {
        w: 360,
        pad: "24 24 24 24",
        gap: 16,
        dir: "column",
        radius: R["--kimo-radius-xl"] as number,
        bg: T["--kimo-bg-app"] as string,
        shadowHas: `${T["--kimo-border"]} 0px 0px 0px 1px inset`,
      })
      c.box("Head (w5L5e2)", m.head, { gap: 10, align: "center" })
      c.box("Title (LHW5I)", m.title, { fs: 14, fw: "600" })
      c.box("Host (RkHYa)", m.host, { fs: 11, color: T["--kimo-text-tertiary"] as string })
      c.box("Desc (NIS9l)", m.desc, { fs: 12, color: T["--kimo-text-secondary"] as string })
      c.box("Meta (Mf6w1)", m.meta, { fs: 11, color: T["--kimo-text-tertiary"] as string })
      c.box("Field · Device name (ttxWg)", m.field, { gap: 6, dir: "column" })
      c.box("Label (gzz66)", m.label, {
        fs: 11,
        fw: "500",
        color: T["--kimo-text-secondary"] as string,
      })
      c.box("Actions (C2FgOF)", m.actions, { gap: 8, align: "center" })
      c.box("Not now (uw00b)", m.notNow, { h: 30, pad: "0 12 0 12" })
      c.box("Add device (xktjR)", m.add, { h: 30, pad: "0 14 0 14" })
      c.flush()
    }
    expect(
      (await page.locator('[data-testid="pair-card"]').innerText()).includes(
        "Works once · 15 min left",
      ),
      "Works once · 15 min left",
    )
    expect(
      (await page.locator(".pair-card__field input").inputValue()) === "Chrome on Mac",
      "the name is the platform",
    )
    await page.click('[data-action="add-device"]')
    await page.locator('[data-testid="pair-card"][data-outcome="added"]').waitFor({ timeout: 8000 })
    {
      const m = await measure(page, {
        card: '[data-testid="pair-card"]',
        wrap: ".join-card__wrap--success",
        heading: ".join-card__heading",
        open: '[data-action="open-kimo"]',
      })
      const c = checker(ctx, `§5 J pairing link · added (${theme})`)
      c.box("Pair Card (avpph)", m.card, { gap: 14, align: "center", pad: "24 24 24 24" })
      c.box("Icon Wrap (ZbDkf)", m.wrap, {
        w: 40,
        h: 40,
        bg: T["--kimo-success-soft"] as string,
        color: T["--kimo-success"] as string,
      })
      c.box("Title (HSmSi)", m.heading, { fs: 14, fw: "600", ta: "center" })
      c.box("Open Kimo (sTwx9)", m.open, { bg: T["--kimo-accent"] as string })
      c.flush()
    }
    // The same link again (another page, another device): already used.
    await page.goto(
      `${await harnessUrl(ctx)}?run=${Date.now()}&surface=pair&theme=${theme}&link=${encodeURIComponent(link)}`,
    )
    await page.click('[data-action="add-device"]')
    await page.locator('[data-testid="pair-card"][data-outcome="used"]').waitFor({ timeout: 8000 })
    // A link that does not parse.
    await page.goto(
      `${await harnessUrl(ctx)}?run=${Date.now()}&surface=pair&theme=${theme}&link=${encodeURIComponent("https://x.test/pair#nope")}`,
    )
    await page.locator('[data-testid="pair-card"][data-outcome="invalid"]').waitFor()
    expect(
      (await page.locator(".join-card__heading").innerText()) === "This link doesn't work",
      "not valid",
    )
  } finally {
    await relay.stop()
  }
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
      note: ".rw-body > .rw-note",
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
  expect(
    (await page.locator(".rw-shell").innerText()).toLowerCase().includes("secret") === false,
    "This computer shows no secret",
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
  const { spawned, devicePub } = await page.evaluate(async () => {
    const w = window as unknown as {
      __board42: {
        host: { spawned: { kind: string; env?: Record<string, string> }[] }
        ownership: { devicePublicKey(): Promise<string> }
      }
    }
    return {
      spawned: w.__board42.host.spawned.map((s) => ({ kind: s.kind, env: s.env ?? {} })),
      devicePub: await w.__board42.ownership.devicePublicKey(),
    }
  })
  const relayEnv = spawned.find((s) => s.kind === "relay")?.env ?? {}
  expect(relayEnv.PORT === "8787", "port 8787")
  expect(relayEnv.KIMO_OWNER_KEY === devicePub, "this device's key is KIMO_OWNER_KEY")
  expect(
    !Object.keys(relayEnv).some((k) => k.includes("SECRET")),
    `no secret in the relay's environment (${Object.keys(relayEnv).join(", ")})`,
  )
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
    name: "board42 relay setup: Share popover → I already have a relay → claimed by the test → save → share; another device sees Not yours",
    async run(ctx) {
      for (const theme of ["light", "dark"] as const) {
        const relay = await startRelay()
        try {
          await fromShare(ctx, theme, relay)
          await notYours(ctx, theme, relay)
        } finally {
          await relay.stop()
        }
      }
    },
  },
  both("board42 relay setup: Settings › Multiplayer ownership and devices", fromSettings),
  both(
    "board42 relay setup: Settings shows Yours and Devices once the wizard claimed the relay",
    settingsAfterWizard,
  ),
  both("board41 pairing link landing: add this device, used, not valid", pairLanding),
  both("board42 relay setup: This computer on desktop with a quick tunnel", desktopLocal),
]
