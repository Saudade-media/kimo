/**
 * Board 41 "Multiplayer" (desing.pen kCAYr) sections 5 (Join) and 9 (View only), with the dark
 * variants of section 10: the join cards measured against the nodes (A to G), the join route
 * end to end over a fake relay (joined toast, errors, retry, Open Kimo) and the View only
 * chrome (banner, tools, properties, menus, keys). One measured getComputedStyle /
 * getBoundingClientRect pass per surface, light and dark.
 */
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import type { Page } from "playwright"
import { build } from "vite"
import { checker, measure, tokens } from "./board25-helpers"
import { type E2EContext, expect, type Scenario } from "./run"

const here = dirname(fileURLToPath(import.meta.url))
const out = process.env.KIMO_E2E_OUTDIR ?? join(here, ".dist")
let built: Promise<string> | null = null

function harness(ctx: E2EContext) {
  if (process.env.KIMO_E2E_DEV === "1")
    return Promise.resolve(`${ctx.url}e2e/board41-join-harness/index.html`)
  built ??= build({
    root: join(here, "board41-join-harness"),
    configFile: false,
    base: "./",
    logLevel: "error",
    plugins: [react()],
    build: { outDir: join(out, "board41-join"), emptyOutDir: true, target: "es2022" },
  }).then(() => "board41-join/index.html")
  return built.then((p) => `${ctx.url}${p}`)
}

type B41 = {
  model: {
    join: {
      getState(): { phase: string; showCard: boolean }
    }
  }
  link(o?: { role?: "view" | "edit"; exp?: number }): Promise<string>
  behave(p: Record<string, unknown>): void
}
type W = {
  __b41: B41
  __kimo?: {
    session: {
      store: { getNode(id: string): unknown; nodeIds(): string[] }
      ui: { getState(): { tool: string; select(ids: string[]): void; selection: string[] } }
    }
    canvas(): {
      layout(): { nodes: Map<string, { world: { x: number; y: number; w: number; h: number } }> }
      worldToScreen(p: { x: number; y: number }): { x: number; y: number }
    } | null
  }
}

async function open(ctx: E2EContext, query = "") {
  await ctx.page.setViewportSize({ width: 1440, height: 900 })
  await ctx.page.goto(`${await harness(ctx)}?kimo-debug${query ? `&${query}` : ""}`)
  await ctx.page.evaluate(() => document.fonts.ready)
}

async function bridge(ctx: E2EContext, query = "") {
  await open(ctx, query)
  await ctx.page.waitForFunction(() => !!(window as unknown as W).__b41)
}

/** Navigates the harness to the join route of a freshly minted link. */
async function goJoin(
  ctx: E2EContext,
  o: { role?: "view" | "edit"; exp?: number; text?: string } = {},
) {
  await ctx.page.evaluate(
    async (o) => {
      const w = window as unknown as W
      const text = o.text ?? (await w.__b41.link({ role: o.role, exp: o.exp }))
      location.hash = `#/join/${encodeURIComponent(text)}`
    },
    { role: o.role, exp: o.exp, text: o.text },
  )
}

const CARD = {
  card: "[data-testid=join-card]",
  head: ".join-card__head",
  logo: ".join-card__head > svg",
  text: ".join-card__text",
  title: ".join-card__title",
  meta: ".join-card__text > .join-card__meta",
  steps: ".join-card__steps",
  step1: ".join-card__step[data-step=relay]",
  step1Icon: ".join-card__step[data-step=relay] .join-card__step-icon",
  step1Label: ".join-card__step[data-step=relay] .join-card__step-label",
  step3: ".join-card__step[data-step=decrypt]",
  step3Icon: ".join-card__step[data-step=decrypt] .join-card__step-icon",
  step3Label: ".join-card__step[data-step=decrypt] .join-card__step-label",
  progress: ".join-card__progress",
  track: ".join-card__track",
  bar: ".join-card__bar",
  progressMeta: ".join-card__progress > .join-card__meta",
}

const ERR = {
  card: "[data-testid=join-card]",
  wrap: ".join-card__wrap",
  icon: ".join-card__wrap > svg",
  copy: ".join-card__copy",
  heading: ".join-card__heading",
  desc: ".join-card__desc",
  meta: ".join-card__meta--code",
  actions: ".join-card__actions",
  btn1: ".join-card__actions > :nth-child(1)",
  btn2: ".join-card__actions > :nth-child(2)",
  btn1Icon: ".join-card__actions > :nth-child(1) .kimo-button__icon",
  btn1Label: ".join-card__actions > :nth-child(1) .kimo-button__label",
}

const TOKENS = [
  "--kimo-bg-app",
  "--kimo-bg-canvas",
  "--kimo-bg-muted",
  "--kimo-text-primary",
  "--kimo-text-secondary",
  "--kimo-text-tertiary",
  "--kimo-success",
  "--kimo-danger",
  "--kimo-danger-soft",
  "--kimo-accent",
  "--kimo-bg-subtle",
  "--kimo-on-accent",
]

/** A length token in px (`--kimo-radius-xl`). */
const px = (page: Page, name: string) =>
  page.evaluate((n) => {
    const el = document.createElement("div")
    el.style.width = `var(${n})`
    document.body.append(el)
    const w = el.getBoundingClientRect().width
    el.remove()
    return w
  }, name)

const SANS = "Inter"
const MONO = "JetBrains Mono"

async function measureProgress(ctx: E2EContext, theme: "light" | "dark") {
  const { page } = ctx
  await open(ctx, `scene=card&state=progress&theme=${theme}`)
  await page.locator(CARD.card).waitFor()
  const t = await tokens(page, TOKENS)
  const xl = await px(page, "--kimo-radius-xl")
  const pill = await px(page, "--kimo-radius-pill")
  const md = await px(page, "--kimo-text-md")
  const xs = await px(page, "--kimo-text-xs")
  const sm = await px(page, "--kimo-text-sm")
  const m = await measure(page, CARD)
  const surface = `Board 41 §5 A · joining · decrypting (${theme}, ZDoa1)`
  const c = checker(ctx, surface)
  c.box("Join Card (ZDoa1)", m.card, {
    w: 360,
    gap: 16,
    pad: "24 24 24 24",
    radius: xl,
    bg: t["--kimo-bg-app"] as string,
    dir: "column",
  })
  const shadow = m.card?.shadow ?? ""
  c.check(
    "Join Card",
    "shadow 0 4 16 + 1px border ring",
    /0px 4px 16px/.test(shadow) && /inset/.test(shadow) ? "ok" : shadow,
    "ok",
  )
  c.box("Head (s0Aue2)", m.head, { w: 312, gap: 10, align: "center", dir: "row" })
  c.box("KimoLogo/Small (xa0LG)", m.logo, { w: 16, h: 16 })
  c.box("Head › Text (K48xnx)", m.text, { gap: 2, dir: "column" })
  c.box("Title (pqNaD)", m.title, {
    fs: md,
    fw: "600",
    ff: SANS,
    color: t["--kimo-text-primary"] as string,
  })
  c.box("Meta (R8pgR)", m.meta, {
    fs: xs,
    fw: "400",
    ff: MONO,
    color: t["--kimo-text-tertiary"] as string,
  })
  c.box("Steps (jse5j)", m.steps, { w: 312, gap: 8, dir: "column" })
  c.box("Step · Reached the relay (FyI3Z)", m.step1, { gap: 8, align: "center", dir: "row" })
  c.box("circle-check (VoObp)", m.step1Icon, {
    w: 14,
    h: 14,
    color: t["--kimo-success"] as string,
  })
  c.box("Label (tTLiG)", m.step1Label, {
    fs: sm,
    fw: "400",
    color: t["--kimo-text-secondary"] as string,
  })
  c.box("loader-circle (KzAH6)", m.step3Icon, {
    w: 14,
    h: 14,
    color: t["--kimo-text-secondary"] as string,
  })
  c.box("Label (LPgMo)", m.step3Label, { color: t["--kimo-text-primary"] as string, fs: sm })
  c.box("Progress (e31Sdj)", m.progress, { w: 312, gap: 6, dir: "column" })
  c.box("Track (KVDv2)", m.track, {
    w: 312,
    h: 4,
    radius: pill,
    bg: t["--kimo-bg-muted"] as string,
  })
  // 128 of 312 (progress 0.41).
  c.box("Bar (doccR)", m.bar, {
    w: 128,
    h: 4,
    radius: pill,
    bg: t["--kimo-accent"] as string,
  })
  c.box("Meta (K1Wpjo)", m.progressMeta, {
    fs: xs,
    ff: MONO,
    color: t["--kimo-text-tertiary"] as string,
  })
  // Stage (jf2Li): bg-canvas, the card centered.
  const stage = await page.evaluate(() => {
    const s = document.querySelector("[data-testid=join-stage]") as HTMLElement
    const c = document.querySelector("[data-testid=join-card]") as HTMLElement
    const sr = s.getBoundingClientRect()
    const cr = c.getBoundingClientRect()
    return {
      bg: getComputedStyle(s).backgroundColor,
      dx: sr.x + sr.width / 2 - (cr.x + cr.width / 2),
      dy: sr.y + sr.height / 2 - (cr.y + cr.height / 2),
    }
  })
  c.check("Stage (jf2Li)", "background", stage.bg, t["--kimo-bg-canvas"] as string)
  c.check("Stage", "card centered x", stage.dx, 0, 1)
  c.check("Stage", "card centered y", stage.dy, 0, 1)
  c.flush()
  if (ctx.shots) await page.screenshot({ path: join(ctx.shots, `board41-join-a-${theme}.png`) })
}

async function measureError(
  ctx: E2EContext,
  state: "expired" | "revoked" | "unreachable" | "not-a-relay" | "decrypt-failed",
  theme: "light" | "dark",
) {
  const { page } = ctx
  await open(ctx, `scene=card&state=${state}&theme=${theme}`)
  await page.locator(ERR.card).waitFor()
  const t = await tokens(page, TOKENS)
  const xl = await px(page, "--kimo-radius-xl")
  const pill = await px(page, "--kimo-radius-pill")
  const md = await px(page, "--kimo-text-md")
  const xs = await px(page, "--kimo-text-xs")
  const sm = await px(page, "--kimo-text-sm")
  const base = await px(page, "--kimo-text-base")
  const m = await measure(page, ERR)
  const danger = state !== "expired" && state !== "revoked"
  const node = {
    expired: "wCWyR",
    revoked: "Muoq0",
    unreachable: "iCo0a",
    "not-a-relay": "x0nKi",
    "decrypt-failed": "R89WL2",
  }[state]
  const c = checker(ctx, `Board 41 §5 ${state} (${theme}, ${node})`)
  c.box("Join Card", m.card, {
    w: 360,
    gap: 14,
    pad: "24 24 24 24",
    radius: xl,
    bg: t["--kimo-bg-app"] as string,
    dir: "column",
    align: "center",
  })
  c.box("Icon Wrap", m.wrap, {
    w: 40,
    h: 40,
    radius: pill,
    bg: danger ? (t["--kimo-danger-soft"] as string) : (t["--kimo-bg-muted"] as string),
    align: "center",
    justify: "center",
  })
  c.box("Icon", m.icon, { w: 18, h: 18 })
  c.check(
    "Icon",
    "fill",
    await page.evaluate(
      () => getComputedStyle(document.querySelector(".join-card__wrap") as Element).color,
    ),
    danger ? (t["--kimo-danger"] as string) : (t["--kimo-text-primary"] as string),
  )
  c.box("Text", m.copy, { w: 312, gap: 6, dir: "column", align: "center" })
  c.box("Title", m.heading, {
    w: 312,
    fs: md,
    fw: "600",
    ff: SANS,
    ta: "center",
    color: t["--kimo-text-primary"] as string,
  })
  c.box("Desc", m.desc, {
    w: 312,
    fs: sm,
    fw: "400",
    ta: "center",
    color: t["--kimo-text-secondary"] as string,
  })
  // lineHeight 1.45 on both.
  const lh = await page.evaluate(() =>
    [".join-card__heading", ".join-card__desc"].map((s) => {
      const cs = getComputedStyle(document.querySelector(s) as Element)
      return parseFloat(cs.lineHeight) / parseFloat(cs.fontSize)
    }),
  )
  c.check("Title", "line-height", lh[0] as number, 1.45, 0.02)
  c.check("Desc", "line-height", lh[1] as number, 1.45, 0.02)
  if (state === "unreachable" || state === "not-a-relay" || state === "decrypt-failed")
    c.box("Meta", m.meta, { fs: xs, ff: MONO, color: t["--kimo-text-tertiary"] as string })
  else expect(m.meta === null, `${state}: no Meta row`)
  c.box("Actions", m.actions, { gap: 8, align: "center", dir: "row" })
  c.box("Button/Ghost", m.btn1, {
    h: 32,
    radius: pill,
    gap: 6,
    pad: "0 14 0 14".replace(/ (\d+)/g, " $1"),
    fs: base,
  })
  c.box("Button icon", m.btn1Icon, { w: 16, h: 16 })
  const second = state === "unreachable" || state === "decrypt-failed"
  if (second)
    c.box("Button/Primary", m.btn2, { h: 32, radius: pill, bg: t["--kimo-accent"] as string })
  else expect(m.btn2 === null, `${state}: one action`)
  c.flush()
  if (ctx.shots)
    await page.screenshot({ path: join(ctx.shots, `board41-join-${state}-${theme}.png`) })
}

export const scenarios: Scenario[] = [
  {
    name: "board41-join: A joining card (determinate and indeterminate) + measured, light and dark",
    async run(ctx) {
      await measureProgress(ctx, "light")
      await measureProgress(ctx, "dark")
      // progress null: the bar is indeterminate (sliding), no aria-valuenow.
      await open(ctx, "scene=card&state=indeterminate")
      await ctx.page.locator(CARD.card).waitFor()
      const ind = await ctx.page.evaluate(() => {
        const track = document.querySelector(".join-card__track") as HTMLElement
        const bar = document.querySelector(".join-card__bar") as HTMLElement
        return {
          now: track.getAttribute("aria-valuenow"),
          anim: getComputedStyle(bar).animationName,
        }
      })
      expect(ind.now === null, "indeterminate: no aria-valuenow")
      expect(ind.anim !== "none", `indeterminate: the bar animates (${ind.anim})`)
    },
  },
  {
    name: "board41-join: C to G error cards + measured, light and dark",
    async run(ctx) {
      for (const theme of ["light", "dark"] as const)
        for (const state of [
          "expired",
          "revoked",
          "unreachable",
          "not-a-relay",
          "decrypt-failed",
        ] as const)
          await measureError(ctx, state, theme)
    },
  },
  {
    name: "board41-join: the route joins as editor, Toast says the role once, title is the owner's file",
    async run(ctx) {
      const { page } = ctx
      await bridge(ctx)
      // A quick join never shows the card (under 400 ms).
      await goJoin(ctx, { role: "edit" })
      await page.locator(".editor").waitFor()
      expect((await page.locator(CARD.card).count()) === 0, "no card for a quick join")
      expect(
        (await page.locator(".topbar__file-name").textContent()) === "Marketing site",
        "the topbar shows the owner's file name",
      )
      const toast = page.locator(".m3-toasts .kimo-toast")
      await toast.first().waitFor()
      expect(
        (await toast.first().textContent())?.trim() === "You joined Marketing site · you can edit",
        `editor toast copy: ${await toast.first().textContent()}`,
      )
      expect(
        (await page.locator("[data-testid=view-only-banner]").count()) === 0,
        "no banner for an editor",
      )
      // Tools stay live for an editor: R arms the Rectangle tool.
      await page.locator(".editor__canvas").click({ position: { x: 700, y: 600 } })
      await page.keyboard.press("r")
      const tool = await page.evaluate(
        () => (window as unknown as W).__kimo?.session.ui.getState().tool,
      )
      expect(tool === "rect", `editor: R arms the Rectangle tool (${tool})`)
      // The Toast measured (XB33E): fill text-primary, radius-lg, 36 high, icon success.
      const t = await tokens(page, TOKENS)
      const m = await measure(page, {
        toast: ".m3-toasts .kimo-toast",
        icon: ".m3-toasts .kimo-toast__icon",
        label: ".m3-toasts .kimo-toast__label",
      })
      const c = checker(ctx, "Board 41 §5 B · Toast · Joined as editor (XB33E)")
      c.box("Toast", m.toast, {
        gap: 10,
        pad: "10 12 10 12",
        bg: t["--kimo-text-primary"] as string,
        radius: await px(page, "--kimo-radius-lg"),
      })
      c.box("Icon (users)", m.icon, { w: 16, h: 16, color: t["--kimo-success"] as string })
      c.box("Label", m.label, {
        fw: "500",
        color: await page.evaluate(() => {
          const el = document.createElement("div")
          el.style.color = "var(--kimo-text-inverse)"
          document.body.append(el)
          const v = getComputedStyle(el).color
          el.remove()
          return v
        }),
      })
      c.flush()
    },
  },
  {
    name: "board41-join: slow join shows the card after 400 ms; errors say what happened; Try again and Open Kimo work",
    async run(ctx) {
      const { page } = ctx
      await bridge(ctx)
      // Slow join: the card shows, steps tick in place.
      await page.evaluate(() => (window as unknown as W).__b41.behave({ join: "hang" }))
      await goJoin(ctx)
      await page.locator(CARD.card).waitFor({ timeout: 5_000 })
      const steps = await page
        .locator(".join-card__step")
        .evaluateAll((els) =>
          els.map((e) => `${(e as HTMLElement).dataset.step}:${(e as HTMLElement).dataset.status}`),
        )
      expect(
        steps.join(",") === "relay:done,link:active,decrypt:pending",
        `steps while the relay answered: ${steps}`,
      )
      // Unreachable: card E; Copy details; Try again backs off then retries.
      await page.evaluate(() =>
        (window as unknown as W).__b41.behave({ probe: "unreachable", join: "ok" }),
      )
      await goJoin(ctx)
      await page.locator(`${ERR.card}[data-kind=unreachable]`).waitFor()
      expect(
        (await page.locator(ERR.heading).textContent()) === "Couldn't reach the relay",
        "unreachable title",
      )
      await page
        .context()
        .grantPermissions(["clipboard-read", "clipboard-write"])
        .catch(() => {})
      await page.locator("[data-action=copy-details]").click()
      await page.locator("[data-action=copy-details]:has-text('Copied')").waitFor()
      const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "")
      if (clip) {
        expect(clip.includes("Relay: relay.maya.studio"), `details name the relay: ${clip}`)
        expect(!/#|token/.test(clip), "details never carry the link or key")
      }
      // Try again: the relay is back; after the back-off the editor opens.
      await page.evaluate(() => (window as unknown as W).__b41.behave({ probe: "ok" }))
      await page.locator("[data-action=try-again]").click()
      expect(
        await page.locator("[data-action=try-again]").isDisabled(),
        "Try again waits out its back-off",
      )
      await page.locator(".editor").waitFor({ timeout: 10_000 })
      // Revoked, expired, not a relay, decrypt failed.
      for (const [behave, kind, title] of [
        [{ probe: "ok", join: "revoked" }, "revoked", "This link was turned off"],
        [{ probe: "not-a-relay", join: "ok" }, "not-a-relay", "This is not a Kimo relay"],
        [{ probe: "ok", join: "decrypt-failed" }, "decrypt-failed", "Couldn't open this file"],
      ] as const) {
        await page.evaluate((b) => (window as unknown as W).__b41.behave(b), behave)
        await goJoin(ctx)
        await page.locator(`${ERR.card}[data-kind=${kind}]`).waitFor()
        expect((await page.locator(ERR.heading).textContent()) === title, `${kind}: ${title}`)
      }
      await page.evaluate(() => (window as unknown as W).__b41.behave({ probe: "ok", join: "ok" }))
      await goJoin(ctx, { exp: Math.floor(Date.now() / 1000) - 3600 })
      await page.locator(`${ERR.card}[data-kind=expired]`).waitFor()
      expect(
        (await page.locator(ERR.heading).textContent()) === "This link has expired",
        "expired title",
      )
      // A link that is not one: the closest card (decrypt failed layout, bad link copy).
      await goJoin(ctx, { text: "https://kimo.test/join#garbage" })
      await page.locator(`${ERR.card}[data-kind=bad-link]`).waitFor()
      // Open Kimo goes Home.
      await page.locator("[data-action=paste-link]").waitFor()
      await goJoin(ctx, { exp: Math.floor(Date.now() / 1000) - 3600 })
      await page.locator("[data-action=open-kimo]").click()
      await page.waitForFunction(() => location.hash === "#/" || location.hash === "")
    },
  },
  {
    name: "board41-join: View only chrome, light and dark: banner, Select only, properties dimmed, Export kept, no Share, no Duplicate / Save a copy",
    async run(ctx) {
      const { page } = ctx
      for (const theme of ["light", "dark"] as const) {
        await bridge(ctx, `theme=${theme}`)
        await page.evaluate(() => (window as unknown as W).__b41.behave({ role: "view" }))
        await goJoin(ctx, { role: "view" })
        await page.locator("[data-testid=view-only-banner]").waitFor()
        await page.waitForFunction(() => !!(window as unknown as W).__kimo?.canvas()?.layout())
        const t = await tokens(page, TOKENS)
        const sm = await px(page, "--kimo-text-sm")
        // Toast: view only (eye, text-inverse icon).
        const toast = page.locator(".m3-toasts .kimo-toast").first()
        await toast.waitFor()
        expect(
          (await toast.textContent())?.trim() === "You joined Marketing site · view only",
          `viewer toast copy: ${await toast.textContent()}`,
        )
        const toastIcon = await page.evaluate(
          () =>
            getComputedStyle(document.querySelector(".m3-toasts .kimo-toast__icon") as Element)
              .color,
        )
        const inverse = await page.evaluate(() => {
          const el = document.createElement("div")
          el.style.color = "var(--kimo-text-inverse)"
          document.body.append(el)
          const v = getComputedStyle(el).color
          el.remove()
          return v
        })
        expect(
          toastIcon === inverse,
          `viewer toast icon is text-inverse (${toastIcon} vs ${inverse})`,
        )

        // Banner (p5lo7 / R6VHG).
        const m = await measure(page, {
          banner: "[data-testid=view-only-banner]",
          icon: "[data-testid=view-only-banner] .kimo-banner__icon",
          message: "[data-testid=view-only-banner] .kimo-banner__message",
          title: "[data-testid=view-only-banner] .kimo-banner__title",
          body: "[data-testid=view-only-banner] .kimo-banner__body",
          actions: "[data-testid=view-only-banner] .kimo-banner__actions",
          dismiss: "[data-testid=view-only-banner] .kimo-banner__dismiss",
        })
        const c = checker(ctx, `Board 41 §9 A · Banner · View only (${theme}, p5lo7)`)
        c.box("Banner", m.banner, {
          w: 1440,
          gap: 10,
          pad: "8 8 8 16",
          bg: t["--kimo-bg-subtle"] as string,
          align: "center",
          dir: "row",
        })
        c.box("Icon (eye)", m.icon, { w: 16, h: 16, color: t["--kimo-text-secondary"] as string })
        c.box("Message", m.message, { gap: 6, align: "center", dir: "row" })
        c.box("Title", m.title, {
          fs: sm,
          fw: "600",
          color: t["--kimo-text-primary"] as string,
        })
        c.box("Body", m.body, { fs: sm, fw: "400", color: t["--kimo-text-secondary"] as string })
        expect(m.actions === null, "no Secondary / Primary action (enabled: false)")
        expect(m.dismiss === null, "no Dismiss (enabled: false)")
        c.check(
          "Banner",
          // Board 44: no topbar; the banner tops the editor, over the stage.
          "sits at the top of the editor",
          m.banner?.y ?? -1,
          0,
          1,
        )
        const body = await page
          .locator("[data-testid=view-only-banner] .kimo-banner__body")
          .textContent()
        expect(
          body?.startsWith(
            "The owner shared this file with view access. You can look around, inspect, follow people and export.",
          ) === true,
          `banner copy: ${body}`,
        )
        c.flush()

        // Floating toolbar (X2wngo): Move live, the rest at 35 %.
        const tb = await page.evaluate(() =>
          [...(document.querySelector(".floating-toolbar") as Element).children].map(
            (e) => getComputedStyle(e).opacity,
          ),
        )
        expect(tb[0] === "1", `Move stays live (${tb[0]})`)
        expect(
          tb.slice(1).every((o) => o === "0.35"),
          `every other tool, the divider and Ask Kimo sit at 0.35 (${tb.join(",")})`,
        )
        const active = await page.locator(".floating-toolbar [aria-pressed=true]").count()
        expect(active === 1, `one tool is active (${active})`)

        // Properties (NLdtZ ...): sections at 0.5, inert; the selection header is not dimmed.
        await page.evaluate(() =>
          (window as unknown as W).__kimo?.session.ui.getState().select(["Hero000001"]),
        )
        await page.locator(".design-tab .kimo-prop-section").first().waitFor()
        const props = await page.evaluate(() => {
          const sec = document.querySelector(".design-tab .kimo-prop-section") as HTMLElement
          const head = document.querySelector(".design-tab .selection-header") as HTMLElement
          return {
            section: getComputedStyle(sec).opacity,
            header: getComputedStyle(head).opacity,
            inert: !!sec.closest("[inert]"),
          }
        })
        expect(props.section === "0.5", `sections dimmed to 0.5 (${props.section})`)
        expect(props.header === "1", `selection header not dimmed (${props.header})`)
        expect(props.inert, "sections are inert (no input, no focus)")

        // Topbar: Export visible (Button/Primary), no Share.
        expect(
          (await page.getByRole("button", { name: "Export" }).count()) === 1,
          "Export stays for viewers",
        )
        expect((await page.getByRole("button", { name: "Share" }).count()) === 0, "no Share")

        // File menu: no Save, no Save as, Export stays.
        await page.locator(".topbar__file").click()
        const items = await page
          .locator("[data-testid=file-menu] .kimo-menu-item-dense__label")
          .allTextContents()
        expect(
          !items.includes("Save") && !items.includes("Save as…"),
          `File menu: ${items.join(" | ")}`,
        )
        expect(items.includes("Export…"), "File menu keeps Export…")
        await page.keyboard.press("Escape")

        // Keys: R / T / F never arm a tool; ⌘D never duplicates; ⌘S downloads nothing.
        await page.locator(".editor__canvas").click({ position: { x: 700, y: 700 } })
        const before = await page.evaluate(
          () => (window as unknown as W).__kimo?.session.store.nodeIds().length,
        )
        let downloaded = false
        page.on("download", () => {
          downloaded = true
        })
        for (const k of ["r", "t", "f", "p", "o", "l"]) {
          await page.keyboard.press(k)
          const tool = await page.evaluate(
            () => (window as unknown as W).__kimo?.session.ui.getState().tool,
          )
          expect(tool === "select", `key ${k} leaves the tool on Select (${tool})`)
        }
        await page.evaluate(() =>
          (window as unknown as W).__kimo?.session.ui.getState().select(["Hero000001"]),
        )
        await page.keyboard.press("Meta+d")
        await page.keyboard.press("Control+d")
        await page.keyboard.press("Meta+s")
        await page.keyboard.press("Meta+Shift+s")
        await page.keyboard.press("Backspace")
        await page.waitForTimeout(250)
        const after = await page.evaluate(
          () => (window as unknown as W).__kimo?.session.store.nodeIds().length,
        )
        expect(before === after, `no node added or removed (${before} -> ${after})`)
        expect(!downloaded, "Save and Save as download nothing")

        // Context menu: Copy only.
        const p = await page.evaluate(() => {
          const w = window as unknown as W
          const c = w.__kimo?.canvas()
          const b = c?.layout().nodes.get("Hero000001")?.world
          return c && b ? c.worldToScreen({ x: b.x + b.w / 2, y: b.y + b.h - 8 }) : null
        })
        expect(!!p, "Hero on screen")
        await page
          .locator(".editor__canvas")
          .click({ button: "right", position: p as { x: number; y: number } })
        const rows = await page
          .getByTestId("canvas-context-menu")
          .locator(".kimo-menu-item-dense__label")
          .allTextContents()
        expect(rows.join("|") === "Copy", `context menu: ${rows.join(" | ")}`)
        await page.keyboard.press("Escape")
        if (ctx.shots)
          await page.screenshot({ path: join(ctx.shots, `board41-view-only-${theme}.png`) })
      }
    },
  },
]
