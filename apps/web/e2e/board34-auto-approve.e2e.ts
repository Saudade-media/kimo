/**
 * Board 34 "Auto-approve" (desing.pen aHEIi), now "Ask before changes" (ADR 0013 Addendum 8: trusted
 * by default): §1 the built-in agent's per-session switch; §2 the thread line and the Activity
 * row; §3 an MCP client's Permissions option; §4 the approval prompt with 200 changes inside the viewport at 1280 × 800,
 * the minimum window (800 × 560) and 200 % UI zoom (640 × 400 CSS px). One measured
 * getComputedStyle / getBoundingClientRect pass per surface against the node values.
 */
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import type { Page } from "playwright"
import { build } from "vite"
import { checker, measure, token } from "./m6-helpers"
import { type E2EContext, expect, type Scenario } from "./run"

const here = dirname(fileURLToPath(import.meta.url))
const out = process.env.KIMO_E2E_OUTDIR ?? join(here, ".dist")
const builds: Record<string, Promise<string>> = {}

function harness(ctx: E2EContext, name: "m6-agent-harness" | "m5-agents-harness") {
  if (process.env.KIMO_E2E_DEV === "1") return Promise.resolve(`${ctx.url}e2e/${name}/index.html`)
  const dir = `board34-${name}`
  builds[name] ??= build({
    root: join(here, name),
    configFile: false,
    base: "./",
    logLevel: "error",
    plugins: [react()],
    build: { outDir: join(out, dir), emptyOutDir: true, target: "es2022" },
  }).then(() => `${dir}/index.html`)
  return builds[name].then((p) => `${ctx.url}${p}`)
}

type M6 = {
  __m6: {
    controller: {
      state: { busy: boolean; autoApprove: boolean; approvals: unknown[] }
      setSelection(items: { id: string; name: string; type: string }[]): void
    }
  }
}
type Agents = {
  __agents: {
    host: {
      policies: { set(client: string, p: unknown): Promise<void> }
      control: { policies: Record<string, Record<string, unknown>> }
      approvals: { pending(): unknown[] }
    }
    connect(over?: Record<string, unknown>): unknown
    entry(e: Record<string, unknown>): unknown
    request(over?: Record<string, unknown>): void
  }
}

const POLICY = {
  level: "edit",
  files: ["/Users/me/repo/design/**"],
  nodes: [],
  grants: [],
  onExceed: "ask",
  confirmDestructive: true,
}

/** Board 40: Ask before changes is a switch row in the composer's "…" menu. */
const MORE = "[data-testid=agent-more]"
const T = "[data-testid=agent-more-auto]"

/** Opens the "…" menu (if closed) and returns the Ask before changes row's aria-checked. */
async function askChecked(page: Page): Promise<string | null> {
  if ((await page.locator(T).count()) === 0) await page.locator(MORE).click()
  const v = await page.locator(T).getAttribute("aria-checked")
  await page.keyboard.press("Escape")
  return v
}

/** Clicks the Ask before changes row through the "…" menu. */
async function clickAsk(page: Page) {
  if ((await page.locator(T).count()) === 0) await page.locator(MORE).click()
  await page.locator(T).click()
  // The menu stays open after a switch; close it so the composer takes the next message.
  await page.keyboard.press("Escape")
}

async function openPanel(ctx: E2EContext) {
  await ctx.page.setViewportSize({ width: 1440, height: 900 })
  await ctx.page.goto(`${await harness(ctx, "m6-agent-harness")}?scene=panel`)
  await ctx.page.waitForFunction(() => !!(window as unknown as M6).__m6)
  await ctx.page.evaluate(() => document.fonts.ready)
  await ctx.page.evaluate(() =>
    (window as unknown as M6).__m6.controller.setSelection([
      { id: "Hero000001", name: "Hero", type: "frame" },
    ]),
  )
}

async function openAgents(ctx: E2EContext, scene: string, w = 1440, h = 900) {
  await ctx.page.setViewportSize({ width: w, height: h })
  await ctx.page.goto(`${await harness(ctx, "m5-agents-harness")}?scene=${scene}`)
  await ctx.page.waitForFunction(() => !!(window as unknown as Agents).__agents)
  await ctx.page.evaluate(() => document.fonts.ready)
}

const composer = (page: Page) => page.locator("[data-testid=agent-composer] textarea")
async function send(page: Page, text: string) {
  await composer(page).fill(text)
  await composer(page).press("Enter")
}
const idle = (page: Page) =>
  page.waitForFunction(() => !(window as unknown as M6).__m6.controller.state.busy, null, {
    timeout: 20_000,
  })

/** Every corner of `sel` inside the viewport. */
async function inside(page: Page, sel: string) {
  return page.evaluate((s) => {
    const r = (document.querySelector(s) as Element).getBoundingClientRect()
    return {
      ok:
        r.left >= 0 &&
        r.top >= 0 &&
        r.right <= window.innerWidth + 0.5 &&
        r.bottom <= window.innerHeight + 0.5,
      r: { l: r.left, t: r.top, r: r.right, b: r.bottom },
      vw: window.innerWidth,
      vh: window.innerHeight,
    }
  }, sel)
}

/** 200 changes: 120 deletes, 60 inserts, 20 updates (the host sends at most 200 ids). */
function manyChanges() {
  const ids = Array.from({ length: 200 }, (_, i) => `Many${String(i).padStart(6, "0")}`)
  const kinds: Record<string, string> = {}
  ids.forEach((id, i) => {
    kinds[id] = i < 120 ? "delete" : i < 180 ? "insert" : "update"
  })
  return {
    reason: { kind: "destructive", ops: ["delete"], nodeIds: ids.slice(0, 120) },
    summary: "Replace hero",
    preview: { inserted: 60, updated: 20, deleted: 120, nodeIds: ids, kinds },
  }
}

const P = "[data-testid=agent-approval]"

async function promptFits(ctx: E2EContext, label: string) {
  const { page } = ctx
  await page.locator(P).waitFor()
  await page.waitForFunction((s) => {
    const el = document.querySelector(s) as HTMLElement | null
    return !!el && getComputedStyle(el).visibility === "visible"
  }, P)
  for (const part of [
    P,
    `${P} .agents-approval__head`,
    `${P} [data-choice=deny]`,
    `${P} [data-choice=session]`,
    `${P} [data-choice=once]`,
    `${P} .agents-approval__footnote`,
  ]) {
    const f = await inside(page, part)
    expect(f.ok, `${label}: ${part} inside ${f.vw}×${f.vh}: ${JSON.stringify(f.r)}`)
  }
  const s = await page.evaluate((sel) => {
    const t = document.querySelector(`${sel} [data-testid=agent-approval-targets]`) as HTMLElement
    const before = t.scrollTop
    t.scrollTop = t.scrollHeight
    const after = t.scrollTop
    const showAll = document.querySelector(`${sel} [data-testid=agent-approval-show-all]`)
    const sa = showAll?.getBoundingClientRect()
    const tr = t.getBoundingClientRect()
    t.scrollTop = 0
    return {
      scrollable: t.scrollHeight > t.clientHeight,
      overflowY: getComputedStyle(t).overflowY,
      moved: after > before,
      showAllVisible: !!sa && sa.top >= tr.top - 0.5 && sa.bottom <= tr.bottom + 0.5,
      maxHeight: getComputedStyle(document.querySelector(sel) as Element).maxHeight,
      h: (document.querySelector(sel) as Element).getBoundingClientRect().height,
    }
  }, P)
  expect(s.overflowY === "auto", `${label}: the change list scrolls (overflow ${s.overflowY})`)
  expect(s.scrollable && s.moved, `${label}: the list scrolls inside the prompt`)
  expect(s.showAllVisible, `${label}: Show all is reachable at the end of the list`)
  ctx.log(`    ${label}: prompt h ${Math.round(s.h)} (max-height ${s.maxHeight})`)
  return s
}

export const scenarios: Scenario[] = [
  {
    name: "board34: built-in agent Ask before changes: trusted by default, switch, thread line + measured",
    async run(ctx) {
      const { page } = ctx
      await openPanel(ctx)
      expect((await askChecked(page)) === "false", "Ask before changes is off by default")

      // Trusted (ADR 0013 Addendum 8): an out-of-area edit runs without a card.
      await send(page, "Tidy the navbar")
      await idle(page)
      expect(
        (await page.locator("[data-testid=agent-approval]").count()) === 0,
        "no approval card by default",
      )
      const lines = page.locator("[data-testid=agent-auto-approved]")
      expect((await lines.count()) === 1, "one thread line")
      expect(
        (await lines.first().innerText()) ===
          "Approved automatically: edited 1 layer outside its area",
        `line text: ${await lines.first().innerText()}`,
      )
      expect((await page.locator("[data-testid=agent-more-dot]").count()) === 0, "no dot")
      expect((await page.locator("[data-testid=agent-auto-approve-chip]").count()) === 0, "no chip")

      const secondary = await token(page, "--kimo-text-secondary")
      const warning = await token(page, "--kimo-warning")
      await page.locator(MORE).click()
      const m = await measure(page, {
        toggle: T,
        icon: `${T} .kimo-menu-item-dense__check svg`,
        knob: `${T} .kimo-toggle`,
        line: "[data-testid=agent-auto-approved]",
        lineIcon: "[data-testid=agent-auto-approved] .agent-panel__auto-line-icon",
        lineText: "[data-testid=agent-auto-approved] .agent-panel__auto-line-text",
      })
      const c = checker(ctx, "Board 34 §1–2 → “…” menu · Ask before changes off, thread line")
      c.box("Item · Ask before changes", m.toggle, { h: 28, gap: 8, pad: [0, 8, 0, 8], radius: 6 })
      c.box("Icon shield", m.icon, { w: 14, h: 14, color: secondary })
      c.box("Toggle/Off (CSYQj)", m.knob, { w: 28, h: 16 })
      c.box("Auto-approved Line (ZbBuI)", m.line, { pad: [0, 0, 0, 34], gap: 6 })
      c.box("Icon (ZP3vA)", m.lineIcon, { w: 12, h: 12, color: warning })
      c.box("Text (wG0k1)", m.lineText, { fs: 11, lh: 13, color: secondary })
      c.flush()
      await page.keyboard.press("Escape")
      if (ctx.shots) await page.screenshot({ path: join(ctx.shots, "board34-panel-trusted.png") })

      // On: the next out-of-area edit asks with a card; deny it.
      await clickAsk(page)
      expect((await askChecked(page)) === "true", "Ask before changes on")
      await send(page, "Tidy the navbar again")
      await page.locator("[data-testid=agent-approval]").waitFor()
      await page.locator("[data-testid=agent-approval] [data-choice=deny]").click()
      await idle(page)
      expect((await lines.count()) === 1, "a denied request adds no line")

      // Turning it off while a card waits approves it at once; the run continues.
      await send(page, "Tidy the navbar once more")
      await page.locator("[data-testid=agent-approval]").waitFor()
      await clickAsk(page)
      await idle(page)
      expect(
        (await page.locator("[data-testid=agent-approval]").count()) === 0,
        "the pending card was approved",
      )
      expect((await lines.count()) === 2, "a line per approved request")

      // A new session starts trusted again.
      await clickAsk(page)
      await page.getByRole("button", { name: "New session" }).click()
      expect(
        await page.evaluate(() => (window as unknown as M6).__m6.controller.state.autoApprove),
        "new session: trusted",
      )
      if (ctx.shots) await page.screenshot({ path: join(ctx.shots, "board34-panel.png") })
    },
  },
  {
    name: "board34: MCP client Ask before changes: Permissions, badge, no pill, Activity + measured",
    async run(ctx) {
      const { page } = ctx
      await openAgents(ctx, "settings-running")
      const R = "[data-client=claude-code] [data-testid=agents-perms-auto]"
      await page.locator(R).waitFor()
      const tertiary = await token(page, "--kimo-text-tertiary")
      const secondary = await token(page, "--kimo-text-secondary")
      const warning = await token(page, "--kimo-warning")
      const m = await measure(page, {
        row: R,
        label: `${R} .agents-perms__label`,
        toggle: `${R} .kimo-toggle`,
        note: `${R} .agents-perms__auto-note`,
      })
      const c = checker(ctx, "Board 34 §3 Perm · Ask first off (YsgKV)")
      c.box("Perm · Ask first (YsgKV)", m.row, { gap: 12 })
      c.box("Label (mlOmw)", m.label, { w: 88, fs: 12, color: secondary })
      c.box("Toggle (rfs4e)", m.toggle, { w: 28, h: 16 })
      c.box("Note (SZIRG)", m.note, { fs: 11, color: tertiary })
      c.flush()
      const note = () => page.locator(`${R} .agents-perms__auto-note`).innerText()
      const badge = () =>
        page.locator("[data-client=claude-code] .kimo-agent-client-row__scope").innerText()
      expect((await page.locator(`${R} .agents-perms__label`).innerText()) === "Ask first", "label")
      expect((await note()) === "Off: every request runs without asking", `note: ${await note()}`)
      expect(!(await badge()).includes("asks first"), `badge: ${await badge()}`)

      // On applies at once, no confirm; the badge says so.
      await page.locator(`${R} .kimo-toggle`).click()
      await page.waitForFunction(
        () =>
          (window as unknown as Agents).__agents.host.control.policies["claude-code"]
            ?.autoApprove === false,
      )
      expect((await page.locator("[data-testid=auto-approve-confirm]").count()) === 0, "no confirm")
      expect((await badge()).endsWith("· asks first"), `badge reads asks first: ${await badge()}`)
      expect(
        (await note()) === "On: anything outside its permissions asks first",
        `note: ${await note()}`,
      )
      // Off again: trusted.
      await page.locator(`${R} .kimo-toggle`).click()
      await page.waitForFunction(
        () =>
          (window as unknown as Agents).__agents.host.control.policies["claude-code"]
            ?.autoApprove === true,
      )

      // Editor: a waiting prompt is approved when asking turns off; no pill in the topbar.
      await openAgents(ctx, "editor")
      await page.evaluate(() => {
        const a = (window as unknown as Agents).__agents
        a.connect()
        a.request()
      })
      await page.locator("[data-testid=agent-approval]").waitFor()
      await page.evaluate(
        (p) =>
          (window as unknown as Agents).__agents.host.policies.set("claude-code", {
            ...p,
            autoApprove: true,
          }),
        POLICY,
      )
      await page.waitForFunction(
        () => (window as unknown as Agents).__agents.host.approvals.pending().length === 0,
      )
      await page.locator("[data-testid=agent-approval]").waitFor({ state: "detached" })
      expect(
        (await page.locator("[data-testid=agent-auto-approve-pill]").count()) === 0,
        "no auto-approve pill",
      )

      // Activity: the approval row reads "approved automatically", in the plain tone.
      await page.evaluate(() =>
        (window as unknown as Agents).__agents.entry({
          kind: "approval",
          tool: "kimo_save",
          summary: "save /Users/me/repo/design/home.kimo",
          outcome: "auto",
          nodeIds: [],
          undoToken: undefined,
        }),
      )
      const row = page.locator(".kimo-activity-row", { hasText: "approved automatically" })
      await row.first().waitFor()
      const tool = row.first().locator(".kimo-activity-row__tool")
      expect(
        (await tool.innerText()).includes("kimo_save · approved automatically"),
        `tool line: ${await tool.innerText()}`,
      )
      const color = await tool.evaluate((e) => getComputedStyle(e).color)
      expect(color !== warning, `Activity row is not in warning: ${color}`)
      if (ctx.shots) await page.screenshot({ path: join(ctx.shots, "board34-mcp.png") })
    },
  },
  {
    name: "board34: approval prompt with 200 changes stays inside the viewport and scrolls + measured",
    async run(ctx) {
      const { page } = ctx
      await openAgents(ctx, "editor", 1280, 800)
      await page.evaluate(
        (o) => {
          const a = (window as unknown as Agents).__agents
          a.connect()
          a.request(o)
        },
        manyChanges() as unknown as Record<string, unknown>,
      )
      const s = await promptFits(ctx, "1280 × 800")
      const title = await page.locator("#agents-approval-title").innerText()
      expect(title === "Claude Code wants to delete 120 layers", `title: ${title}`)
      expect(parseFloat(s.maxHeight) <= 560 + 0.5, `max-height ≤ 70vh (${s.maxHeight})`)
      const groups = await page
        .locator(`${P} .agents-approval__group-head`)
        .evaluateAll((els) => els.map((e) => (e as HTMLElement).innerText.replace(/\s+/g, " ")))
      expect(
        groups.join(" | ") === "Delete 120 | Insert 60 | Update 20",
        `grouped by kind: ${groups.join(" | ")}`,
      )
      const more = await page.locator(`${P} [data-testid=agent-approval-more]`).allInnerTexts()
      expect(
        more.join(" | ") === "and 117 more | and 57 more | and 17 more",
        `more rows: ${more.join(" | ")}`,
      )
      const secondary = await token(page, "--kimo-text-secondary")
      const tertiary = await token(page, "--kimo-text-tertiary")
      const m = await measure(page, {
        prompt: P,
        head: `${P} .agents-approval__group-head`,
        kind: `${P} .agents-approval__group-kind`,
        count: `${P} .agents-approval__group-count`,
        more: `${P} [data-testid=agent-approval-more]`,
        showAll: `${P} [data-testid=agent-approval-show-all]`,
        showIcon: `${P} [data-testid=agent-approval-show-all] svg`,
        targets: `${P} [data-testid=agent-approval-targets]`,
      })
      const c = checker(ctx, "Board 34 §4 Approval Prompt · 200 changes (hlZyJ)")
      c.box("Approval Prompt (hlZyJ)", m.prompt, { w: 400, pad: [20, 20, 20, 20], gap: 14 })
      c.box("Targets (GURpD)", m.targets, { pad: [4, 0, 4, 0], radius: 10 })
      c.box("Group Header (XqK8f)", m.head, { pad: [6, 12, 2, 12], gap: 6 })
      c.box("Kind (o4Huu)", m.kind, { fs: 11, fw: "600", color: secondary })
      c.box("Count (DEWfl)", m.count, { fs: 11, color: tertiary })
      c.box("More (cy9to)", m.more, { pad: [3, 12, 5, 12], fs: 11, color: tertiary })
      c.box("Show All (GISmI)", m.showAll, { pad: [6, 12, 6, 12], gap: 4, fs: 11, fw: "500" })
      c.box("Icon (Q84nCm)", m.showIcon, { w: 12, h: 12 })
      c.flush()
      if (ctx.shots) await page.screenshot({ path: join(ctx.shots, "board34-many.png") })

      // Show all: every row the host sent, same scroll box, buttons still on screen.
      await page.locator(`${P} [data-testid=agent-approval-show-all]`).click()
      const rows = await page.locator(`${P} .agents-approval__targets .kimo-agent-op-row`).count()
      expect(rows === 200, `Show all lists 200 rows (${rows})`)
      await promptFits(ctx, "1280 × 800 · Show all")
      expect(
        (await page.locator(`${P} [data-testid=agent-approval-show-all]`).innerText()) ===
          "Show fewer",
        "Show fewer folds it",
      )

      // Minimum window and 200 % UI zoom (1280 × 800 at 2× = 640 × 400 CSS px).
      for (const [w, h, label] of [
        [800, 560, "800 × 560 (min window)"],
        [640, 400, "200 % zoom (640 × 400)"],
      ] as const) {
        await page.setViewportSize({ width: w, height: h })
        // The prompt re-lays out after the resize reaches the page; a fixed 50 ms was not always
        // enough on a busy runner. Wait for it to fit, then measure (a timeout still measures,
        // so a real overflow reports its numbers).
        await page
          .waitForFunction(
            ({ s, w, h }) => {
              const el = document.querySelector(s)
              if (!el || window.innerWidth !== w || window.innerHeight !== h) return false
              const r = el.getBoundingClientRect()
              return r.left >= 0 && r.top >= 0 && r.right <= w + 0.5 && r.bottom <= h + 0.5
            },
            { s: P, w, h },
            { timeout: 5000 },
          )
          .catch(() => {})
        await promptFits(ctx, label)
        if (ctx.shots)
          await page.screenshot({ path: join(ctx.shots, `board34-many-${w}x${h}.png`) })
      }
    },
  },
]
