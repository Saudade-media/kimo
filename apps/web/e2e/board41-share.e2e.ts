/**
 * Board 41 "Multiplayer" (desing.pen kCAYr), part A: the topbar while shared (sections 1, 2), the
 * Share popover (3 A, B, C, D, E, F), Settings › Multiplayer (4), the people list (6 B) and their
 * dark variants (10). The surfaces run in `e2e/board41-harness` (the real components over a
 * scripted share backend); one scenario checks the Share button in the real web editor.
 *
 * Each surface gets one measured pass (getComputedStyle + getBoundingClientRect vs the node
 * values), light and dark, and its actions are clicked and asserted.
 */
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import type { Page } from "playwright"
import { build } from "vite"
import { checker, measure, tokens } from "./board25-helpers"
import { waitCanvas } from "./qa-helpers"
import { type E2EContext, expect, type Scenario } from "./run"

const here = fileURLToPath(new URL(".", import.meta.url))
let built: Promise<string> | null = null

async function harnessUrl(ctx: E2EContext): Promise<string> {
  if (process.env.KIMO_E2E_DEV === "1") return `${ctx.url}e2e/board41-harness/index.html`
  built ??= build({
    root: join(here, "board41-harness"),
    configFile: false,
    base: "./",
    logLevel: "error",
    plugins: [react()],
    build: {
      outDir: join(process.env.KIMO_E2E_OUTDIR ?? join(here, ".dist"), "board41"),
      emptyOutDir: true,
      target: "es2022",
    },
  }).then(() => "board41/index.html")
  return `${ctx.url}${await built}`
}

type Theme = "light" | "dark"

async function open(ctx: E2EContext, surface: string, theme: Theme, hash = "") {
  await ctx.page.setViewportSize({ width: 1280, height: 900 })
  // A fresh document per surface and theme (a hash-only change would keep the page).
  await ctx.page.goto(
    `${await harnessUrl(ctx)}?run=${Date.now()}&surface=${surface}&theme=${theme}${hash}`,
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
  await ctx.page.waitForTimeout(150)
}

/** Resolved px of size tokens. */
const px = (page: Page, names: string[]) =>
  page.evaluate((ns) => {
    const out: Record<string, number> = {}
    const cs = getComputedStyle(document.documentElement)
    for (const n of ns) out[n] = parseFloat(cs.getPropertyValue(n))
    return out
  }, names)

const COLORS = [
  "--kimo-bg-app",
  "--kimo-bg-muted",
  "--kimo-bg-subtle",
  "--kimo-bg-hover",
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
  "--kimo-agent",
  "--kimo-border",
  "--kimo-presence-clay",
  "--kimo-presence-pine",
  "--kimo-presence-ochre",
  "--kimo-presence-graphite",
]

const T0 = "rgba(0, 0, 0, 0)"
const text = (page: Page, sel: string) => page.locator(sel).first().innerText({ timeout: 5000 })

// --- Section 2: six topbar states --------------------------------------------------------------

async function topbar(ctx: E2EContext, theme: Theme) {
  const { page } = ctx
  await open(ctx, "topbar", theme)
  await page.locator('[data-card="f"] .mp-sync-status[data-relay="offline"]').waitFor()
  const T = await tokens(page, COLORS)
  const R = await px(page, ["--kimo-radius-pill"])
  const card = (k: string) => `[data-card="${k}"]`
  const m = await measure(page, {
    savedLocally: `${card("a")} .kimo-save-status`,
    shareA: `${card("a")} .mp-share-button`,
    shareAIcon: `${card("a")} .mp-share-button .kimo-button__icon`,
    syncB: `${card("b")} .mp-sync-status`,
    syncBLabel: `${card("b")} .mp-sync-status .kimo-save-status__label`,
    syncBIcon: `${card("b")} .mp-sync-status .kimo-save-status__icon`,
    shareB: `${card("b")} .mp-share-button`,
    stackB: `${card("b")} .mp-stack`,
    stackC: `${card("c")} .mp-stack`,
    av1: `${card("c")} .mp-stack .mp-avatar:nth-child(1)`,
    av2: `${card("c")} .mp-stack .mp-avatar:nth-child(2)`,
    av3: `${card("c")} .mp-stack .mp-avatar:nth-child(3)`,
    initials: `${card("c")} .mp-stack .mp-avatar:nth-child(1) .kimo-avatar__initials`,
    more: `${card("c")} .mp-stack__more`,
    syncD: `${card("d")} .mp-sync-status`,
    syncE: `${card("e")} .mp-sync-status`,
    stackE: `${card("e")} .mp-stack`,
    syncF: `${card("f")} .mp-sync-status`,
    stackF: `${card("f")} .mp-stack`,
  })
  const c = checker(ctx, `§2 topbar states (${theme})`)
  // A · not shared (rbsCd): Button/Secondary "Share" (users), 32 tall, padding [0, 14], gap 6.
  c.box("A Share (Secondary)", m.shareA, {
    h: 32,
    pad: "0 14 0 14",
    gap: 6,
    fs: 13,
    fw: "500",
    bg: T["--kimo-bg-muted"] as string,
    color: T["--kimo-text-primary"] as string,
  })
  c.box("A Share icon", m.shareAIcon, { w: 16, h: 16 })
  expect((await text(page, `${card("a")} .mp-share-button`)) === "Share", "A reads Share")
  expect(m.stackB === null, "B: no stack until someone joins")
  // B · Synced (ryLI6): SaveStatus 24, padding [0, 10, 0, 8], gap 6, no fill, text-tertiary.
  c.box("B Synced", m.syncB, {
    h: 24,
    pad: "0 10 0 8",
    gap: 6,
    bg: T0,
    color: T["--kimo-text-tertiary"] as string,
    radius: R["--kimo-radius-pill"] as number,
  })
  c.box("B Synced label", m.syncBLabel, { fs: 12, fw: "500" })
  c.box("B Synced icon", m.syncBIcon, { w: 14, h: 14 })
  expect((await text(page, `${card("b")} .mp-sync-status`)) === "Synced", "B reads Synced")
  // B · Share (m9llZ): Button/Soft "Sharing" (radio): accent-soft / accent-text.
  c.box("B Sharing (Soft)", m.shareB, {
    h: 32,
    pad: "0 14 0 14",
    gap: 6,
    bg: T["--kimo-accent-soft"] as string,
    color: T["--kimo-accent-text"] as string,
  })
  expect((await text(page, `${card("b")} .mp-share-button`)) === "Sharing", "B reads Sharing")
  // C · stack (FZUy0): padding [0, 4], avatars 24 overlapping by 4, ring 2 bg-app, max 3 + "+2".
  c.box("C Stack", m.stackC, { h: 24, pad: "0 4 0 4", align: "center", opacity: "1" })
  c.box("C Avatar Maya", m.av1, {
    w: 24,
    h: 24,
    radius: R["--kimo-radius-pill"] as number,
    bg: T["--kimo-presence-clay"] as string,
    shadowHas: `${T["--kimo-bg-app"]} 0px 0px 0px 2px`,
  })
  c.box("C Avatar Jonas", m.av2, { bg: T["--kimo-presence-pine"] as string })
  c.box("C Avatar Ana", m.av3, { bg: T["--kimo-presence-ochre"] as string })
  c.check("C overlap", "x2 - x1", (m.av2?.x ?? 0) - (m.av1?.x ?? 0), 20)
  c.box("C Initials", m.initials, {
    fs: 10,
    fw: "600",
    color: T["--kimo-on-accent"] as string,
  })
  c.box("C +2", m.more, {
    w: 24,
    h: 24,
    fs: 10,
    fw: "600",
    bg: T["--kimo-bg-muted"] as string,
    color: T["--kimo-text-secondary"] as string,
    shadowHas: `${T["--kimo-bg-app"]} 0px 0px 0px 2px`,
  })
  expect((await text(page, `${card("c")} .mp-stack__more`)) === "+2", "C shows +2")
  expect(
    (await text(page, `${card("c")} .mp-stack .mp-avatar:nth-child(1)`)) === "MR",
    "C first avatar MR",
  )
  // D · Syncing… (DDFcQ): loader-circle, text-tertiary, no fill.
  c.box("D Syncing", m.syncD, { bg: T0, color: T["--kimo-text-tertiary"] as string })
  expect((await text(page, `${card("d")} .mp-sync-status`)) === "Syncing…", "D reads Syncing…")
  // E · Reconnecting… (F6UnsU): SaveStatus/Paused warning-soft / warning; stack at 0.5.
  c.box("E Reconnecting", m.syncE, {
    bg: T["--kimo-warning-soft"] as string,
    color: T["--kimo-warning"] as string,
  })
  c.box("E Stack", m.stackE, { opacity: "0.5" })
  expect(
    (await text(page, `${card("e")} .mp-sync-status`)) === "Reconnecting…",
    "E reads Reconnecting…",
  )
  // F · Offline · edits kept (qoKHp): SaveStatus/ReadOnly bg-muted / text-secondary; stack 0.5.
  c.box("F Offline", m.syncF, {
    bg: T["--kimo-bg-muted"] as string,
    color: T["--kimo-text-secondary"] as string,
  })
  c.box("F Stack", m.stackF, { opacity: "0.5" })
  expect(
    (await text(page, `${card("f")} .mp-sync-status`)) === "Offline · edits kept",
    "F reads Offline · edits kept",
  )
  // Clicking the stack opens the people list (section 6).
  await page.locator(`${card("c")} .mp-stack`).click()
  await page.locator(".mp-people").waitFor()
  expect(
    (await text(page, ".mp-people .kimo-popover__title")) === "In this file · 6",
    "stack opens the people list",
  )
  c.flush()
}

// --- Section 3: the Share popover ----------------------------------------------------------------

const POPOVER = {
  frame: ".mp-popover",
  header: ".mp-popover .kimo-popover__header",
  title: ".mp-popover .kimo-popover__title",
  close: ".mp-popover .mp-close",
  closeIcon: ".mp-popover .mp-close .kimo-icon-button__icon",
  body: ".mp-popover .mp-body",
  footer: ".mp-popover .mp-footer",
  footnote: ".mp-popover .mp-footnote",
  start: ".mp-popover .mp-start",
  fieldLabel: ".mp-popover .mp-field-label",
  field: '.mp-popover [data-pen="mHqqj"]',
  input: ".mp-popover .mp-relay-input",
  inputField: ".mp-popover .mp-relay-input .kimo-input__field",
}

async function shareFirstRun(ctx: E2EContext, theme: Theme) {
  const { page } = ctx
  await open(ctx, "share-a", theme)
  const T = await tokens(page, COLORS)
  const R = await px(page, ["--kimo-radius-lg", "--kimo-radius-pill"])
  expect((await page.locator(".mp-popover").getAttribute("data-stage")) === "first-run", "A stage")
  const m = await measure(page, {
    ...POPOVER,
    intro: ".mp-popover .mp-intro",
    iconWrap: ".mp-popover .mp-intro .mp-icon-wrap",
    introTitle: ".mp-popover .mp-intro .mp-title",
    introDesc: ".mp-popover .mp-intro .mp-desc",
    guide: ".mp-popover .mp-guide",
    guideIcon: ".mp-popover .mp-guide__icon",
    guideExt: ".mp-popover .mp-guide__external",
  })
  const c = checker(ctx, `§3 A first run (${theme})`)
  c.box("Share Popover", m.frame, {
    w: 360,
    bg: T["--kimo-bg-overlay"] as string,
    radius: R["--kimo-radius-lg"] as number,
    shadowHas: "0px 8px 24px 0px",
  })
  c.box("Header", m.header, { h: 40, pad: "0 6 0 12", justify: "space-between", align: "center" })
  c.box("Title", m.title, { fs: 12, fw: "600", color: T["--kimo-text-primary"] as string })
  c.box("Close", m.close, { w: 24, h: 24, bg: T0, color: T["--kimo-text-secondary"] as string })
  c.box("Close icon", m.closeIcon, { w: 14, h: 14 })
  c.box("Body", m.body, { pad: "12 12 12 12", gap: 12, dir: "column" })
  c.box("Intro", m.intro, { gap: 12, dir: "row" })
  c.box("Icon Wrap", m.iconWrap, {
    w: 32,
    h: 32,
    bg: T["--kimo-bg-muted"] as string,
    color: T["--kimo-text-primary"] as string,
    radius: R["--kimo-radius-pill"] as number,
  })
  c.box("Intro Title", m.introTitle, {
    fs: 12,
    fw: "600",
    color: T["--kimo-text-primary"] as string,
  })
  c.box("Intro Desc", m.introDesc, { fs: 11, color: T["--kimo-text-secondary"] as string })
  c.check(
    "Intro Desc",
    "line-height",
    await lineHeight(page, ".mp-popover .mp-intro .mp-desc"),
    11 * 1.45,
    0.1,
  )
  c.box("Field", m.field, { gap: 6, dir: "column" })
  c.box("Field Label", m.fieldLabel, {
    fs: 11,
    fw: "500",
    color: T["--kimo-text-secondary"] as string,
  })
  c.box("Input", m.input, { h: 32, pad: "0 10 0 10", gap: 8, bg: T["--kimo-bg-muted"] as string })
  c.box("Input placeholder (sans 13)", m.inputField, { fs: 13, ff: "Inter" })
  c.box("Guide Link", m.guide, {
    gap: 6,
    fs: 11,
    fw: "500",
    color: T["--kimo-text-primary"] as string,
  })
  c.box("Guide icon", m.guideIcon, { w: 14, h: 14, color: T["--kimo-text-secondary"] as string })
  c.box("Guide external", m.guideExt, { w: 12, h: 12, color: T["--kimo-text-tertiary"] as string })
  c.box("Footer", m.footer, { pad: "10 12 10 12", gap: 8, align: "center" })
  c.box("Footnote", m.footnote, { fs: 11, color: T["--kimo-text-tertiary"] as string })
  c.box("Start sharing (disabled)", m.start, {
    h: 28,
    pad: "0 12 0 12",
    fs: 13,
    opacity: "0.4",
    bg: T["--kimo-accent"] as string,
  })
  expect(await page.locator(POPOVER.start).isDisabled(), "Start sharing disabled without a relay")
  // A non-relay URL keeps Start disabled and says why (inline, as Settings).
  await page.locator(POPOVER.inputField).fill("https://example.com/")
  await page.locator(POPOVER.inputField).blur()
  await page.locator('.mp-popover .mp-result[data-result="warning"]').waitFor()
  expect(await page.locator(POPOVER.start).isDisabled(), "Start stays disabled for a non-relay")
  // A Kimo relay answers: it is kept in Settings and the popover turns to B, Start enabled.
  await page.locator(POPOVER.inputField).fill("wss://relay.maya.studio")
  await page.locator(POPOVER.inputField).blur()
  await page.locator('.mp-popover[data-stage="ready"] .mp-result[data-result="ok"]').waitFor()
  expect(!(await page.locator(POPOVER.start).isDisabled()), "Start enabled once the relay answers")
  const saved = await page.evaluate(() =>
    (
      window as unknown as { __board41: { platform: { settings: { get(k: string): unknown } } } }
    ).__board41.platform.settings.get("multiplayer.relayUrl"),
  )
  expect(
    typeof saved === "string" && saved.includes("relay.maya.studio"),
    `kept in Settings (${saved})`,
  )
  c.flush()
}

async function lineHeight(page: Page, sel: string) {
  return page.evaluate((s) => {
    const e = document.querySelector(s)
    return e ? parseFloat(getComputedStyle(e).lineHeight) : 0
  }, sel)
}

async function shareReady(ctx: E2EContext, theme: Theme) {
  const { page } = ctx
  await open(ctx, "share-b", theme)
  await page.locator('.mp-popover .mp-result[data-result="ok"]').waitFor()
  const T = await tokens(page, COLORS)
  const m = await measure(page, {
    ...POPOVER,
    check: ".mp-popover .mp-result",
    pill: ".mp-popover .mp-result .kimo-status-pill",
    pillLabel: ".mp-popover .mp-result .kimo-status-pill__label",
    meta: ".mp-popover .mp-result .mp-meta-mono",
    desc: ".mp-popover .mp-body > .mp-desc",
    change: ".mp-popover .mp-footer .mp-button--small-label",
  })
  const c = checker(ctx, `§3 B ready (${theme})`)
  c.box("Input value (mono 12)", m.inputField, {
    fs: 12,
    ff: "JetBrains Mono",
    color: T["--kimo-text-primary"] as string,
  })
  c.box("Check", m.check, { gap: 8, align: "center", dir: "row" })
  c.box("Status pill", m.pill, {
    pad: "2 8 2 6",
    gap: 5,
    bg: T["--kimo-success-soft"] as string,
  })
  c.box("Status label", m.pillLabel, { fs: 11, fw: "500", color: T["--kimo-success"] as string })
  c.box("Meta", m.meta, {
    fs: 11,
    ff: "JetBrains Mono",
    color: T["--kimo-text-tertiary"] as string,
  })
  c.box("Desc", m.desc, { fs: 11, color: T["--kimo-text-secondary"] as string })
  c.box("Change in Settings", m.change, {
    h: 28,
    pad: "0 12 0 12",
    fs: 12,
    bg: T0,
    color: T["--kimo-text-secondary"] as string,
  })
  c.box("Start sharing", m.start, { h: 28, pad: "0 12 0 12", opacity: "1" })
  expect((await text(page, ".mp-popover .kimo-status-pill")) === "Kimo relay 1.2", "pill text")
  expect(
    /^answered in \d+ ms$/.test(await text(page, ".mp-popover .mp-result .mp-meta-mono")),
    "meta",
  )
  // Start sharing: the file goes live and the popover turns to C.
  await page.locator(POPOVER.start).click()
  await page.locator('.mp-popover[data-stage="live"]').waitFor()
  c.flush()
}

async function shareLive(ctx: E2EContext, theme: Theme) {
  const { page } = ctx
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
  await open(ctx, "share-c", theme)
  await page.locator(".mp-popover .mp-link").nth(2).waitFor()
  const T = await tokens(page, COLORS)
  const R = await px(page, ["--kimo-radius-sm", "--kimo-radius-md", "--kimo-radius-pill"])
  const m = await measure(page, {
    ...POPOVER,
    live: ".mp-popover .mp-live",
    connection: ".mp-popover .mp-connection",
    connWrap: ".mp-popover .mp-connection .mp-icon-wrap",
    connTitle: ".mp-popover .mp-connection .mp-label-strong",
    connMeta: ".mp-popover .mp-connection .mp-meta-mono",
    newLink: '.mp-popover [data-pen="r8JQX"]',
    controls: ".mp-popover .mp-controls",
    segmented: ".mp-popover .mp-controls .kimo-seg-text",
    select: ".mp-popover .mp-controls .kimo-select__trigger",
    create: ".mp-popover .mp-create",
    links: ".mp-popover .mp-links",
    head: ".mp-popover .mp-links__head",
    row: ".mp-popover .mp-link:nth-of-type(2)",
    rowIcon: ".mp-popover .mp-link:nth-of-type(2) .mp-link__role",
    rowRole: ".mp-popover .mp-link:nth-of-type(2) .mp-label-strong",
    rowMeta: ".mp-popover .mp-link:nth-of-type(2) .mp-meta",
    copy: ".mp-popover .mp-link:nth-of-type(2) .mp-link__copy",
    revoke: ".mp-popover .mp-link:nth-of-type(2) .mp-link__revoke",
    note: ".mp-popover .mp-note",
    noteIcon: ".mp-popover .mp-note__icon",
    reset: ".mp-popover .mp-reset",
    stop: ".mp-popover .mp-stop",
  })
  const c = checker(ctx, `§3 C live (${theme})`)
  c.box("Live pill", m.live, { bg: T["--kimo-success-soft"] as string, pad: "2 8 2 6" })
  c.box("Body", m.body, { pad: "12 12 12 12", gap: 14 })
  c.box("Connection", m.connection, { gap: 10, align: "center" })
  c.box("Icon Wrap 28", m.connWrap, { w: 28, h: 28, bg: T["--kimo-bg-muted"] as string })
  c.box("Connection title", m.connTitle, {
    fs: 12,
    fw: "500",
    color: T["--kimo-text-primary"] as string,
  })
  c.box("Connection meta", m.connMeta, {
    fs: 11,
    ff: "JetBrains Mono",
    color: T["--kimo-text-tertiary"] as string,
  })
  expect(
    (await text(page, ".mp-popover .mp-connection .mp-meta-mono")) ===
      "relay.maya.studio · 5 people here",
    "connection meta",
  )
  c.box("New Link", m.newLink, { gap: 6, dir: "column" })
  c.box("Controls", m.controls, { gap: 6, align: "center" })
  c.box("Role (SegmentedText)", m.segmented, {
    pad: "2 2 2 2",
    gap: 2,
    bg: T["--kimo-bg-muted"] as string,
    radius: R["--kimo-radius-pill"] as number,
  })
  c.box("Expiry (Select)", m.select, {
    h: 28,
    pad: "0 8 0 8",
    bg: T["--kimo-bg-subtle"] as string,
    radius: R["--kimo-radius-sm"] as number,
  })
  c.box("Create link", m.create, { h: 28, pad: "0 12 0 12", bg: T["--kimo-accent"] as string })
  c.box("Active Links", m.links, { gap: 2 })
  c.box("Head", m.head, { pad: "0 0 4 0" })
  expect((await text(page, ".mp-popover .mp-links__head")) === "Active links · 3", "3 active links")
  c.box("Link row (rest)", m.row, {
    h: 44,
    pad: "0 4 0 8",
    gap: 8,
    radius: R["--kimo-radius-sm"] as number,
    bg: T0,
  })
  c.box("Role icon", m.rowIcon, { w: 14, h: 14, color: T["--kimo-text-secondary"] as string })
  c.box("Role", m.rowRole, { fs: 12, fw: "500", color: T["--kimo-text-primary"] as string })
  c.box("Meta", m.rowMeta, { fs: 11, color: T["--kimo-text-tertiary"] as string })
  c.box("Copy (rest)", m.copy, { w: 24, h: 24, color: T["--kimo-text-tertiary"] as string })
  c.box("Revoke (rest)", m.revoke, { w: 24, h: 24, color: T["--kimo-text-tertiary"] as string })
  c.box("E2E Note", m.note, {
    pad: "8 10 8 10",
    gap: 8,
    bg: T["--kimo-bg-subtle"] as string,
    radius: R["--kimo-radius-md"] as number,
  })
  c.box("Note icon", m.noteIcon, { w: 14, h: 14, color: T["--kimo-text-tertiary"] as string })
  c.box("Reset all links", m.reset, {
    h: 28,
    pad: "0 12 0 12",
    bg: T0,
    color: T["--kimo-danger"] as string,
  })
  c.box("Stop sharing", m.stop, { h: 28, pad: "0 12 0 12", bg: T["--kimo-bg-muted"] as string })
  // Newest first: Edit · 6 days, View · never, View · 23 h.
  const metas = await page.locator(".mp-popover .mp-link .mp-meta").allInnerTexts()
  expect(
    metas[0] === "Expires in 6 days" &&
      metas[1] === "Never expires" &&
      metas[2] === "Expires in 23 h",
    `link metas ${metas.join(" | ")}`,
  )
  // Hovered row (kXq9i): bg-hover, Copy text-primary, Revoke danger.
  await page.locator(".mp-popover .mp-link").first().hover()
  const h = await measure(page, {
    row: ".mp-popover .mp-link:nth-of-type(2)",
    copy: ".mp-popover .mp-link:nth-of-type(2) .mp-link__copy",
    revoke: ".mp-popover .mp-link:nth-of-type(2) .mp-link__revoke",
  })
  c.box("Link row (hover)", h.row, { bg: T["--kimo-bg-hover"] as string })
  c.box("Copy (hover)", h.copy, { color: T["--kimo-text-primary"] as string })
  c.box("Revoke (hover)", h.revoke, { color: T["--kimo-danger"] as string })

  // E · expiry menu: Menu/Dense 232, 7 days checked (bg-hover) with "default".
  await page.getByRole("combobox", { name: "Expiry" }).click()
  const e = await measure(page, {
    menu: ".mp-popover .kimo-select__list--dense",
    checked: '.mp-popover .kimo-select__list--dense [aria-selected="true"]',
  })
  const ce = checker(ctx, `§3 E expiry menu (${theme})`)
  ce.box("Menu/Dense", e.menu, { w: 232, pad: "4 4 4 4" })
  ce.box("7 days (checked)", e.checked, { h: 28, bg: T["--kimo-bg-hover"] as string })
  const opts = await page
    .locator(".mp-popover .kimo-select__list--dense [role=option]")
    .allInnerTexts()
  expect(
    opts.map((o) => o.replace(/\s+/g, " ").trim()).join("|") ===
      "1 day|7 days default|30 days|Never",
    `expiry options ${opts.join("|")}`,
  )
  await page.getByRole("option", { name: /30 days/ }).click()
  expect((await text(page, ".mp-popover .kimo-select__value")) === "30 days", "expiry picked")
  await page.getByRole("combobox", { name: "Expiry" }).click()
  await page.getByRole("option", { name: /7 days/ }).click()
  ce.flush()

  // F · toasts. Create link copies at once: "Edit link copied · expires in 7 days".
  await page.locator(".mp-popover .mp-create").click()
  await page.locator(".b41-toast").first().waitFor()
  expect(
    (await text(page, ".b41-toast")) === "Edit link copied · expires in 7 days",
    `create toast: ${await text(page, ".b41-toast")}`,
  )
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ""))
  expect(clip.startsWith("https://kimo.test/join"), `the new link is on the clipboard (${clip})`)
  expect((await text(page, ".mp-popover .mp-links__head")) === "Active links · 4", "4 links")
  // Revoke a view link: immediate, no Undo (a relay revocation is final).
  await page.locator(".mp-popover .mp-link").nth(2).hover()
  await page.locator(".mp-popover .mp-link").nth(2).locator(".mp-link__revoke").click()
  await page.locator(".b41-toast").nth(1).waitFor()
  expect((await text(page, ".b41-toast >> nth=1")) === "View link revoked", "revoke toast")
  expect(
    (await page.locator(".b41-toast").nth(1).locator(".kimo-toast__action").count()) === 0,
    "no Undo",
  )
  expect((await text(page, ".mp-popover .mp-links__head")) === "Active links · 3", "revoked")
  // Couldn't create: Toast/Danger with Retry.
  await page.evaluate(() =>
    (
      window as unknown as {
        __board41: { fake: { failNext(op: string, e: Error): void } }
      }
    ).__board41.fake.failNext("mint", new Error("The relay did not answer.")),
  )
  await page.locator(".mp-popover .mp-create").click()
  await page.locator(".b41-toast").nth(2).waitFor()
  expect(
    (await text(page, ".b41-toast >> nth=2")).startsWith("Couldn't create the link."),
    `danger toast: ${await text(page, ".b41-toast >> nth=2")}`,
  )
  expect((await text(page, ".b41-toast:nth-child(3) .kimo-toast__action")) === "Retry", "Retry")
  const t = await measure(page, {
    toast: ".b41-toast",
    label: ".b41-toast .kimo-toast__label",
    icon: ".b41-toast .kimo-toast__icon",
  })
  const cf = checker(ctx, `§3 F toasts (${theme})`)
  cf.box("Toast", t.toast, { pad: "10 12 10 12", gap: 10, bg: T["--kimo-text-primary"] as string })
  cf.box("Toast label", t.label, { fs: 12, fw: "500", color: T["--kimo-text-inverse"] as string })
  cf.box("Toast icon (link, success)", t.icon, {
    w: 16,
    h: 16,
    color: T["--kimo-success"] as string,
  })
  c.flush()
  cf.flush()
  // Stop sharing ends the room.
  await page.locator(".mp-popover .mp-stop").click()
  await page
    .locator('.mp-popover[data-stage="ready"], .mp-popover[data-stage="first-run"]')
    .waitFor()
}

async function resetDialog(ctx: E2EContext, theme: Theme) {
  const { page } = ctx
  await open(ctx, "reset", theme)
  const T = await tokens(page, COLORS)
  const R = await px(page, ["--kimo-radius-xl"])
  const m = await measure(page, {
    dialog: ".mp-reset-dialog",
    wrap: ".mp-reset-dialog .kimo-dialog__icon-wrap",
    title: ".mp-reset-dialog .kimo-dialog__title",
    desc: ".mp-reset-dialog .kimo-dialog__desc",
    footnote: ".mp-reset-dialog .kimo-dialog__footnote",
    cancel: ".mp-reset-dialog .kimo-dialog__button:not(.kimo-dialog__button--confirm)",
    confirm: ".mp-reset-dialog .kimo-dialog__button--confirm",
  })
  const c = checker(ctx, `§3 D Reset all links (${theme})`)
  c.box("Dialog", m.dialog, {
    w: 480,
    pad: "20 20 20 20",
    gap: 14,
    bg: T["--kimo-bg-overlay"] as string,
    radius: R["--kimo-radius-xl"] as number,
  })
  c.box("Icon Wrap (danger)", m.wrap, {
    w: 32,
    h: 32,
    bg: T["--kimo-danger-soft"] as string,
    color: T["--kimo-danger"] as string,
  })
  c.box("Title", m.title, { fs: 14, fw: "600" })
  c.box("Desc", m.desc, { fs: 12, color: T["--kimo-text-secondary"] as string })
  c.box("Footnote", m.footnote, { fs: 11, color: T["--kimo-text-tertiary"] as string })
  c.box("Cancel", m.cancel, { h: 30, pad: "0 12 0 12", fs: 12 })
  c.box("Confirm", m.confirm, {
    h: 30,
    pad: "0 14 0 14",
    fs: 12,
    bg: T["--kimo-danger"] as string,
    color: "rgb(255, 255, 255)",
  })
  const desc = await text(page, ".mp-reset-dialog .kimo-dialog__desc")
  expect(
    desc ===
      "Every link stops working, including the 3 active ones. Disconnects 5 people now (Maya Rossi, Jonas Tan, Ana Lima and 2 more) and 1 agent using these links. The file and its history stay as they are.",
    `reset description: ${desc}`,
  )
  expect(
    (await text(page, ".mp-reset-dialog .kimo-dialog__footnote")) ===
      "A new key is made for this file.",
    "footnote",
  )
  await page.locator(".mp-reset-dialog .kimo-dialog__button--confirm").click()
  await page.locator(".b41-toast").first().waitFor()
  const calls = await page.evaluate(
    () => (window as unknown as { __board41: { fake: { calls: string[] } } }).__board41.fake.calls,
  )
  expect(calls.includes("reset:live"), `reset called (${calls.join(",")})`)
  c.flush()
}

// --- Section 6 B: people list --------------------------------------------------------------------

async function people(ctx: E2EContext, theme: Theme) {
  const { page } = ctx
  await open(ctx, "people", theme)
  const T = await tokens(page, COLORS)
  const R = await px(page, ["--kimo-radius-sm", "--kimo-radius-pill"])
  const m = await measure(page, {
    frame: ".mp-people",
    header: ".mp-people .kimo-popover__header",
    title: ".mp-people .kimo-popover__title",
    body: ".mp-people .mp-people__body",
    you: '.mp-people .mp-person[data-you="true"]',
    youAvatar: '.mp-people .mp-person[data-you="true"] .mp-avatar',
    youName: '.mp-people .mp-person[data-you="true"] .mp-person__name',
    badge: '.mp-people .mp-person[data-you="true"] .kimo-badge',
    badgeLabel: '.mp-people .mp-person[data-you="true"] .kimo-badge__label',
    role: '.mp-people .mp-person[data-you="true"] > .mp-meta',
    slot: '.mp-people .mp-person[data-you="true"] .mp-person__slot',
    following: '.mp-people .mp-person[data-following="true"] .mp-follow',
    idle: ".mp-people .mp-person--idle .mp-avatar",
    idleMeta: ".mp-people .mp-person--idle .mp-person__name .mp-meta",
    rest: ".mp-people .mp-person:nth-child(4) .mp-follow",
    divider: ".mp-people .mp-divider",
    agentsHead: ".mp-people .mp-agents-head",
    agent: ".mp-people .mp-person--agent",
    markWrap: ".mp-people .mp-person--agent .mp-mark-wrap",
    agentMeta: ".mp-people .mp-person--agent .mp-agent-meta",
  })
  const c = checker(ctx, `§6 B people (${theme})`)
  c.box("Popover · People", m.frame, { w: 300 })
  c.box("Header", m.header, { h: 40, pad: "0 6 0 12" })
  c.box("Title", m.title, { fs: 12, fw: "600" })
  expect((await text(page, ".mp-people .kimo-popover__title")) === "In this file · 6", "title")
  c.box("Body", m.body, { pad: "6 6 6 6", gap: 2 })
  c.box("Person · you", m.you, {
    h: 36,
    pad: "0 4 0 6",
    gap: 8,
    radius: R["--kimo-radius-sm"] as number,
  })
  c.box("Avatar · you", m.youAvatar, { w: 24, h: 24, bg: T["--kimo-presence-graphite"] as string })
  c.box("Name", m.youName, { gap: 6, align: "center" })
  c.box("you Badge", m.badge, {
    pad: "2 8 2 8",
    bg: T["--kimo-bg-muted"] as string,
  })
  c.box("you Badge label", m.badgeLabel, {
    fs: 11,
    fw: "500",
    color: T["--kimo-text-secondary"] as string,
  })
  c.box("Role", m.role, { fs: 11, color: T["--kimo-text-tertiary"] as string })
  expect(
    (await text(page, '.mp-people .mp-person[data-you="true"] > .mp-meta')) === "Owner",
    "Owner",
  )
  c.box("Follow Slot", m.slot, { w: 24, h: 24 })
  c.box("Follow (following Maya)", m.following, {
    w: 24,
    h: 24,
    bg: T["--kimo-bg-muted"] as string,
    color: T["--kimo-text-primary"] as string,
  })
  c.box("Follow (rest)", m.rest, { bg: T0, color: T["--kimo-text-tertiary"] as string })
  c.box("Idle avatar", m.idle, { opacity: "0.5" })
  c.box("idle", m.idleMeta, { fs: 11, color: T["--kimo-text-tertiary"] as string })
  c.box("Divider", m.divider, { h: 1, bg: T["--kimo-border"] as string })
  c.box("Agents Head", m.agentsHead, {
    pad: "6 6 2 6",
    fs: 11,
    fw: "500",
    color: T["--kimo-text-tertiary"] as string,
  })
  c.box("Agent row", m.agent, { h: 36, pad: "0 4 0 6", gap: 8 })
  c.box("Mark Wrap", m.markWrap, { w: 24, h: 24 })
  c.box("Agent meta (Kimo, agent)", m.agentMeta, { fs: 11, color: T["--kimo-agent"] as string })
  expect((await text(page, ".mp-people .mp-agents-head")) === "Agents · 2", "Agents · 2")
  expect(
    (await text(page, ".mp-people .mp-person--agent .mp-label-strong")) ===
      "Kimo · Gui Rodrigues's agent",
    "Kimo row label",
  )
  expect(
    (await text(page, ".mp-people .mp-person--agent .mp-agent-meta")) === "editing Hero Image",
    "editing Hero Image",
  )
  // Follow toggles: stop following Maya, follow Ana.
  await page.locator('.mp-people .mp-person[data-following="true"] .mp-follow').click()
  expect((await page.locator('.mp-people [data-following="true"]').count()) === 0, "unfollowed")
  await page.getByRole("button", { name: "Follow Ana Lima" }).click()
  expect(
    (await page.locator('.mp-people [data-following="true"] .mp-label-strong').innerText()) ===
      "Ana Lima",
    "following Ana",
  )
  c.flush()
}

// --- Section 4: Settings › Multiplayer -----------------------------------------------------------

async function settings(ctx: E2EContext, theme: Theme) {
  const { page } = ctx
  await open(ctx, "settings", theme)
  const T = await tokens(page, COLORS)
  const R = await px(page, ["--kimo-radius-md"])
  const pane = '.settings-content[data-pane="multiplayer"]'
  const m = await measure(page, {
    title: `${pane} .settings-title`,
    titleBar: `${pane} .settings-title-bar`,
    box: `${pane} .mp-relay-box`,
    boxIcon: `${pane} .mp-relay-box__icon`,
    boxDesc: `${pane} .mp-relay-box .mp-desc`,
    guide: `${pane} .mp-guide`,
    setting: `${pane} .mp-setting`,
    label: `${pane} .mp-setting__label`,
    inputRow: `${pane} .mp-input-row`,
    input: `${pane} .mp-relay-input`,
    value: `${pane} .mp-relay-input .kimo-input__field`,
    test: `${pane} .mp-test`,
    name: `${pane} .mp-name-input`,
    nameField: `${pane} .mp-name-input .kimo-input__field`,
    fetch: `${pane} .mp-fetch-select`,
    lastRow: `${pane} .kimo-setting-row:last-of-type`,
  })
  const c = checker(ctx, `§4 Settings › Multiplayer (${theme})`)
  c.box("Title Bar", m.titleBar, { h: 56 })
  c.box("Title", m.title, { fs: 16, fw: "600" })
  expect((await text(page, `${pane} .settings-title`)) === "Multiplayer", "pane title")
  c.box("What a relay is", m.box, {
    pad: "10 12 10 12",
    gap: 10,
    bg: T["--kimo-bg-subtle"] as string,
    radius: R["--kimo-radius-md"] as number,
  })
  c.box("Box icon", m.boxIcon, { w: 16, h: 16, color: T["--kimo-text-secondary"] as string })
  c.box("Box desc", m.boxDesc, { fs: 11, color: T["--kimo-text-secondary"] as string })
  c.box("Self-hosting guide", m.guide, { gap: 4, fs: 11, fw: "500" })
  c.box("Setting · Relay URL", m.setting, { pad: "12 0 12 0", gap: 8, dir: "column" })
  c.box("Label", m.label, { fs: 12, fw: "500", color: T["--kimo-text-primary"] as string })
  c.box("Input Row", m.inputRow, { gap: 8, align: "center" })
  c.box("Input", m.input, { h: 32 })
  c.box("Value (mono 12)", m.value, { fs: 12, ff: "JetBrains Mono" })
  c.box("Test", m.test, { h: 32, pad: "0 14 0 14", bg: T["--kimo-bg-muted"] as string })
  c.box("Your name input", m.name, { w: 160, h: 28 })
  c.box("Your name value", m.nameField, { fs: 12, color: T["--kimo-text-primary"] as string })
  c.box("Fetch select", m.fetch, { w: 120 })
  expect(
    (await text(page, `${pane} .mp-fetch-select .kimo-select__value`)) === "On demand",
    "On demand",
  )

  const field = page.locator(`${pane} .mp-relay-input .kimo-input__field`)
  const result = (kind: string) =>
    page.locator(`${pane} .mp-result[data-result="${kind}"]`).waitFor()
  const testUrl = async (url: string) => {
    await field.fill(url)
    await page.locator(`${pane} .mp-test`).click()
  }
  // OK: "Kimo relay 1.2" + "answered in N ms · protocol 1".
  await testUrl("wss://relay.maya.studio")
  await result("ok")
  const meta = await text(page, `${pane} .mp-result .mp-meta-mono`)
  expect(/^answered in \d+ ms · protocol 1$/.test(meta), `ok meta: ${meta}`)
  // Testing: spinner, "Testing wss://slow.example…", Test at 0.5, the field stays editable.
  await testUrl("wss://slow.example")
  await result("testing")
  const t = await measure(page, {
    spin: `${pane} .mp-result__icon--testing`,
    meta: `${pane} .mp-result__text--testing`,
    test: `${pane} .mp-test`,
  })
  c.box("Spinner", t.spin, { w: 14, h: 14, color: T["--kimo-text-tertiary"] as string })
  c.box("Testing meta", t.meta, { fs: 11, color: T["--kimo-text-tertiary"] as string })
  c.box("Test (testing)", t.test, { opacity: "0.5" })
  expect(await field.isEditable(), "field stays editable while testing")
  // Not a relay.
  await testUrl("https://example.com/")
  await result("warning")
  const w = await measure(page, {
    icon: `${pane} .mp-result__icon--warning`,
    msg: `${pane} .mp-result__text`,
  })
  c.box("Not a relay icon", w.icon, { w: 14, h: 14, color: T["--kimo-warning"] as string })
  c.box("Not a relay message", w.msg, { fs: 11, color: T["--kimo-text-secondary"] as string })
  expect(
    (await text(page, `${pane} .mp-result__text`)).startsWith(
      "This server answered, but not as a Kimo relay.",
    ),
    "not a relay copy",
  )
  // Unreachable.
  await testUrl("wss://down.example")
  await result("danger")
  const d = await measure(page, { icon: `${pane} .mp-result__icon--danger` })
  c.box("Unreachable icon", d.icon, { color: T["--kimo-danger"] as string })
  expect(
    (await text(page, `${pane} .mp-result__text`)) ===
      "Couldn't reach down.example. Check the URL and that the relay is running.",
    `unreachable copy: ${await text(page, `${pane} .mp-result__text`)}`,
  )
  // Old protocol.
  await testUrl("wss://old.example")
  await page
    .locator(`${pane} .mp-result[data-result="warning"] .mp-result__text`, {
      hasText: "protocol 0",
    })
    .waitFor()
  expect(
    (await text(page, `${pane} .mp-result__text`)) ===
      "This relay speaks protocol 0. Update kimo-relay to 1.2 or later.",
    `old copy: ${await text(page, `${pane} .mp-result__text`)}`,
  )
  // Your name: empty shows as Guest N; the value is kept on blur.
  await page.locator(`${pane} .mp-name-input .kimo-input__field`).fill("Gui R")
  await page.locator(`${pane} .mp-name-input .kimo-input__field`).blur()
  await page.waitForTimeout(50)
  const named = await page.evaluate(() =>
    (
      window as unknown as { __board41: { platform: { settings: { get(k: string): unknown } } } }
    ).__board41.platform.settings.get("multiplayer.displayName"),
  )
  expect(named === "Gui R", `display name saved (${named})`)
  // Show other cursors off; Fetch → Never.
  await page.locator(`${pane} .kimo-toggle`).click()
  await page.getByRole("combobox", { name: "Fetch images and fonts" }).click()
  await page.getByRole("option", { name: "Never" }).click()
  await page.waitForTimeout(50)
  const s = await page.evaluate(() => {
    const st = (
      window as unknown as { __board41: { platform: { settings: { get(k: string): unknown } } } }
    ).__board41.platform.settings
    return [st.get("multiplayer.showCursors"), st.get("multiplayer.fetchAssets")]
  })
  expect(s[0] === false && s[1] === false, `cursors and fetch saved (${s.join(",")})`)
  c.flush()
}

const both = (name: string, run: (ctx: E2EContext, theme: Theme) => Promise<void>): Scenario => ({
  name,
  async run(ctx) {
    await run(ctx, "light")
    await run(ctx, "dark")
  },
})

export const scenarios: Scenario[] = [
  both("board41 share: §2 topbar sync status, avatar stack and Share in six states", topbar),
  both("board41 share: §3 A first run, relay check, kept in Settings", shareFirstRun),
  both("board41 share: §3 B relay ready, Start sharing goes live", shareReady),
  both("board41 share: §3 C live links, E expiry menu, F toasts, Stop sharing", shareLive),
  both("board41 share: §3 D Reset all links confirm", resetDialog),
  both("board41 share: §6 B people list, follow, agents", people),
  both("board41 share: §4 Settings › Multiplayer relay test states and settings", settings),
  both(
    "board41 share: a browser library file shows Share and starts sharing",
    async (ctx, theme) => {
      const { page } = ctx
      await open(ctx, "library", theme)
      await page.setViewportSize({ width: 1440, height: 900 })
      await waitCanvas(page)
      const share = page.locator(".mp-share-button")
      await share.waitFor()
      expect((await share.innerText()) === "Share", "Share reads Share")
      expect((await page.locator(".mp-sync-status").count()) === 0, "no sync status before sharing")
      const order = await page.evaluate(() => {
        const s = document.querySelector(".mp-share-button")
        return {
          prev: s?.previousElementSibling?.getAttribute("aria-label"),
          next: s?.nextElementSibling?.textContent,
        }
      })
      expect(order.prev === "Toggle theme", `Share follows Theme (${order.prev})`)
      expect(order.next?.includes("Preview"), `Preview follows Share (${order.next})`)
      const T = await tokens(page, COLORS)
      const c = checker(ctx, `library file Share (${theme})`)
      c.box("Share (Secondary)", (await measure(page, { s: ".mp-share-button" })).s, {
        h: 32,
        pad: "0 14 0 14",
        gap: 6,
        bg: T["--kimo-bg-muted"] as string,
        color: T["--kimo-text-primary"] as string,
      })
      // The relay is set and answers: Start sharing goes live under the library key.
      await share.click()
      await page.locator('.mp-popover .mp-result[data-result="ok"]').waitFor()
      await page.locator(POPOVER.start).click()
      await page.locator('.mp-popover[data-stage="live"]').waitFor()
      const h = await page.evaluate(() => {
        const b = (
          window as unknown as { __board41: { fake: { calls: string[] }; fileId: string } }
        ).__board41
        return { calls: b.fake.calls, fileId: b.fileId }
      })
      expect(
        h.calls.some((call) => call.startsWith(`start:kimo-lib:${h.fileId}:`)),
        `started under kimo-lib:${h.fileId} (${h.calls.join(", ")})`,
      )
      await page.keyboard.press("Escape")
      await page.locator(".mp-popover").waitFor({ state: "detached" })
      expect((await share.innerText()) === "Sharing", "Share reads Sharing once live")
      // Board 41 §2: the sync status takes the "Saved locally" slot.
      const sync = page.locator(".mp-sync-status")
      await sync.waitFor()
      expect((await sync.innerText()) === "Synced", "the topbar reads Synced")
      const m = await measure(page, { share: ".mp-share-button", sync: ".mp-sync-status" })
      c.box("Sharing (Soft)", m.share, {
        h: 32,
        bg: T["--kimo-accent-soft"] as string,
        color: T["--kimo-accent-text"] as string,
      })
      c.box("Synced", m.sync, {
        h: 24,
        pad: "0 10 0 8",
        gap: 6,
        bg: T0,
        color: T["--kimo-text-tertiary"] as string,
      })
      c.flush()
    },
  ),
  both(
    "board41 share: the editor topbar of a file on disk shows Share after Theme and opens the first run",
    async (ctx, theme) => {
      const { page } = ctx
      await open(ctx, "app", theme, `#/disk/${encodeURIComponent("/Users/me/Work/site/home.kimo")}`)
      await page.setViewportSize({ width: 1440, height: 900 })
      await waitCanvas(page)
      const share = page.locator(".mp-share-button")
      await share.waitFor()
      expect((await share.innerText()) === "Share", "Share reads Share")
      // Not shared: the Save Status pill keeps its slot (no sync status, no stack).
      expect((await page.locator(".mp-sync-status").count()) === 0, "no sync status before sharing")
      expect((await page.locator(".mp-stack").count()) === 0, "no stack before sharing")
      // Order: … Theme, Share, Preview, Export (rules row "Share button": before Preview).
      const order = await page.evaluate(() => {
        const s = document.querySelector(".mp-share-button")
        return {
          prev: s?.previousElementSibling?.getAttribute("aria-label"),
          next: s?.nextElementSibling?.textContent,
        }
      })
      expect(order.prev === "Toggle theme", `Share follows Theme (${order.prev})`)
      expect(order.next?.includes("Preview"), `Preview follows Share (${order.next})`)
      const T = await tokens(page, COLORS)
      const m = await measure(page, { share: ".mp-share-button" })
      const c = checker(ctx, `§1 editor topbar Share (${theme})`)
      c.box("Share (Secondary)", m.share, {
        h: 32,
        pad: "0 14 0 14",
        gap: 6,
        bg: T["--kimo-bg-muted"] as string,
        color: T["--kimo-text-primary"] as string,
      })
      await share.click()
      await page.locator('.mp-popover[data-stage="first-run"]').waitFor()
      await page.waitForTimeout(100)
      const box = await page.locator(".mp-popover").boundingBox()
      const btn = await share.boundingBox()
      expect(box && btn, "popover and button boxes")
      if (box && btn) {
        c.check("Popover", "right edge = Share's", box.x + box.width, btn.x + btn.width, 1)
        c.check("Popover", "top = Share bottom + 4", box.y, btn.y + btn.height + 4, 1)
      }
      await page.keyboard.press("Escape")
      await page.locator(".mp-popover").waitFor({ state: "detached" })
      c.flush()
    },
  ),
]
