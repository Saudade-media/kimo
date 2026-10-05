/**
 * Board 34 "Auto-approve" (desing.pen aHEIi): §1 the built-in agent's per-session switch, confirm
 * and chip; §2 the thread line and the Activity row; §3 an MCP client's Permissions option and
 * the presence pill; §4 the approval prompt with 200 changes inside the viewport at 1280 × 800,
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
    name: "board34: built-in agent auto-approve — switch, confirm, chip, thread line + measured",
    async run(ctx) {
      const { page } = ctx
      await openPanel(ctx)
      const T = "[data-testid=agent-auto-approve]"
      expect((await page.locator(T).getAttribute("aria-pressed")) === "false", "off by default")

      // Off: an out-of-area edit asks with a card.
      await send(page, "Tidy the navbar")
      await page.locator("[data-testid=agent-approval]").waitFor()
      const secondary = await token(page, "--kimo-text-secondary")
      const warning = await token(page, "--kimo-warning")
      const warningSoft = await token(page, "--kimo-warning-soft")
      const tertiary = await token(page, "--kimo-text-tertiary")
      let m = await measure(page, {
        toggle: T,
        icon: `${T} svg`,
        mode: "[data-testid=agent-composer] .kimo-mode-chip",
      })
      const c = checker(ctx, "Board 34 §1 Composer · Auto-approve off (v0SYd)")
      c.box("Auto-approve (v0SYd)", m.toggle, { w: 24, h: 24, radius: 6, color: secondary })
      c.box("Icon shield (v7yN9p)", m.icon, { w: 14, h: 14 })
      if (m.mode && m.toggle)
        c.check("Bar", "Mode → Auto-approve gap", m.toggle.x - (m.mode.x + m.mode.w), 4)
      c.flush()

      // On asks once; Cancel keeps it off.
      await page.locator(T).click()
      const D = "[data-testid=auto-approve-confirm]"
      await page.locator(D).waitFor()
      const cd = await measure(page, {
        dialog: D,
        wrap: `${D} .kimo-confirm-dialog__icon-wrap`,
        title: `${D} .kimo-confirm-dialog__title`,
        desc: `${D} .kimo-confirm-dialog__desc`,
        impact: `${D} .kimo-confirm-dialog__impact`,
        item: `${D} .kimo-confirm-dialog__item`,
        text: `${D} .kimo-confirm-dialog__item-text`,
        confirm: `${D} .kimo-confirm-dialog__confirm`,
        scrim: "[data-testid=auto-approve-scrim]",
      })
      const cc = checker(ctx, "Board 34 §1 Auto-approve Confirm (k0K1nN)")
      cc.box("Confirm (k0K1nN)", cd.dialog, { w: 440, pad: [20, 20, 20, 20], gap: 14, radius: 24 })
      cc.box("Icon Wrap (zodGu)", cd.wrap, { w: 32, h: 32, bg: warningSoft, color: warning })
      cc.box("Title (scx8n)", cd.title, { fs: 14, fw: "600" })
      cc.box("Desc (bLTzr)", cd.desc, { fs: 12, lh: 17, color: secondary })
      cc.box("Impact (MLHLi)", cd.impact, { pad: [10, 12, 10, 12], gap: 6, radius: 10 })
      cc.box("Item (JSOgw)", cd.item, { gap: 8 })
      cc.box("Text (IRLaU)", cd.text, { fs: 11, lh: 16, color: secondary })
      cc.box("Confirm (WYG7C)", cd.confirm, { h: 30, pad: [0, 14, 0, 14] })
      cc.box("Scrim", cd.scrim, {})
      cc.flush()
      const items = await page.locator(`${D} .kimo-confirm-dialog__item-text`).allInnerTexts()
      expect(items.length === 4, "4 impact lines")
      expect(items[2]?.includes("can't undo a file it wrote") ?? false, "files can't be undone")
      expect(items[3]?.includes("40 new layers per edit") ?? false, "hard limits listed")
      await page.locator(`${D} .kimo-confirm-dialog__cancel`).click()
      expect((await page.locator(D).count()) === 0, "Cancel closes the confirm")
      expect((await page.locator(T).getAttribute("aria-pressed")) === "false", "still off")

      // Turn on: the waiting card is approved at once and the run continues.
      await page.locator(T).click()
      await page.locator(`${D} .kimo-confirm-dialog__confirm`).click()
      await page.locator("[data-testid=agent-auto-approve-chip]").waitFor()
      await idle(page)
      expect(
        (await page.locator("[data-testid=agent-approval]").count()) === 0,
        "the pending card was approved",
      )
      const lines = page.locator("[data-testid=agent-auto-approved]")
      expect((await lines.count()) === 1, "one thread line")
      expect(
        (await lines.first().innerText()) ===
          "Approved automatically: edited 1 layer outside its area",
        `line text: ${await lines.first().innerText()}`,
      )

      // A second request never shows a card.
      await send(page, "Tidy the navbar again")
      await idle(page)
      expect((await lines.count()) === 2, "a line per approved request")

      const CH = "[data-testid=agent-auto-approve-chip]"
      m = await measure(page, {
        toggle: T,
        chip: CH,
        chipIcon: `${CH} .agent-panel__auto-chip-icon`,
        chipLabel: `${CH} .agent-panel__auto-chip-label`,
        chipOff: `${CH} .agent-panel__auto-chip-off`,
        chipOffIcon: `${CH} .agent-panel__auto-chip-off svg`,
        composer: "[data-testid=agent-composer]",
        line: "[data-testid=agent-auto-approved]",
        lineIcon: "[data-testid=agent-auto-approved] .agent-panel__auto-line-icon",
        lineText: "[data-testid=agent-auto-approved] .agent-panel__auto-line-text",
      })
      const on = checker(ctx, "Board 34 §1–2 On: switch, chip, thread line")
      on.box("Auto-approve on (XNEDr)", m.toggle, {
        w: 24,
        h: 24,
        radius: 6,
        bg: warningSoft,
        color: warning,
      })
      on.box("Auto-approve Chip (PWfak)", m.chip, {
        h: 24,
        pad: [0, 4, 0, 8],
        gap: 4,
        radius: 999,
        bg: warningSoft,
        color: warning,
      })
      on.box("Icon (vl2dS)", m.chipIcon, { w: 12, h: 12 })
      on.box("Label (EK49Y)", m.chipLabel, { fs: 11, fw: "500", color: warning })
      on.box("Turn Off (mCuKF)", m.chipOff, { w: 16, h: 16 })
      on.box("Icon x (ekCI2)", m.chipOffIcon, { w: 12, h: 12 })
      if (m.chip && m.composer)
        on.check("Composer Wrap", "Chip → Composer gap", m.composer.y - (m.chip.y + m.chip.h), 8)
      on.box("Auto-approved Line (ZbBuI)", m.line, { pad: [0, 0, 0, 34], gap: 6 })
      on.box("Icon (ZP3vA)", m.lineIcon, { w: 12, h: 12, color: warning })
      on.box("Text (wG0k1)", m.lineText, { fs: 11, lh: 13, color: secondary })
      on.flush()
      expect(tertiary.length > 0, "tokens resolved")
      if (ctx.shots) await page.screenshot({ path: join(ctx.shots, "board34-panel-on.png") })

      // One click on the chip turns it off; the next out-of-area edit asks again.
      await page.locator(CH).click()
      expect((await page.locator(CH).count()) === 0, "chip gone")
      expect((await page.locator(T).getAttribute("aria-pressed")) === "false", "off again")
      await send(page, "Tidy the navbar once more")
      await page.locator("[data-testid=agent-approval]").waitFor()
      await page.locator("[data-testid=agent-approval] [data-choice=deny]").click()
      await idle(page)

      // A new session starts off.
      await page.locator(T).click()
      await page.locator(`${D} .kimo-confirm-dialog__confirm`).click()
      await page.locator(CH).waitFor()
      await page.getByRole("button", { name: "New session" }).click()
      expect((await page.locator(CH).count()) === 0, "new session: no chip")
      expect(
        !(await page.evaluate(() => (window as unknown as M6).__m6.controller.state.autoApprove)),
        "new session: off",
      )
      if (ctx.shots) await page.screenshot({ path: join(ctx.shots, "board34-panel.png") })
    },
  },
  {
    name: "board34: MCP client auto-approve — Permissions, badge, presence pill, Activity + measured",
    async run(ctx) {
      const { page } = ctx
      await openAgents(ctx, "settings-running")
      const R = "[data-client=claude-code] [data-testid=agents-perms-auto]"
      await page.locator(R).waitFor()
      const tertiary = await token(page, "--kimo-text-tertiary")
      const secondary = await token(page, "--kimo-text-secondary")
      const warning = await token(page, "--kimo-warning")
      const warningSoft = await token(page, "--kimo-warning-soft")
      let m = await measure(page, {
        row: R,
        label: `${R} .agents-perms__label`,
        toggle: `${R} .kimo-toggle`,
        note: `${R} .agents-perms__auto-note`,
      })
      const c = checker(ctx, "Board 34 §3 Perm · Auto-approve off (YsgKV)")
      c.box("Perm · Auto-approve (YsgKV)", m.row, { gap: 12 })
      c.box("Label (mlOmw)", m.label, { w: 88, fs: 12, color: secondary })
      c.box("Toggle (rfs4e)", m.toggle, { w: 28, h: 16 })
      c.box("Note (SZIRG)", m.note, { fs: 11, color: tertiary })
      c.flush()
      await page.locator(`${R} .kimo-toggle`).click()
      const D = "[data-testid=auto-approve-confirm]"
      await page.locator(D).waitFor()
      expect(
        (await page.locator(`${D} .kimo-confirm-dialog__title`).innerText()) ===
          "Turn on auto-approve for Claude Code?",
        "the confirm names the client",
      )
      await page.locator(`${D} .kimo-confirm-dialog__confirm`).click()
      await page.waitForFunction(
        () =>
          (window as unknown as Agents).__agents.host.control.policies["claude-code"]
            ?.autoApprove === true,
      )
      m = await measure(page, {
        note: `${R} .agents-perms__auto-note`,
        badge: "[data-client=claude-code] .kimo-agent-client-row__scope",
      })
      const on = checker(ctx, "Board 34 §3 On: note + client badge (KiaGF, I09xw)")
      on.box("Note (KiaGF)", m.note, { fs: 11, color: warning })
      on.box("Scope badge (H8RP2y)", m.badge, { bg: warningSoft, color: warning })
      on.flush()
      const badge = await page
        .locator("[data-client=claude-code] .kimo-agent-client-row__scope")
        .innerText()
      expect(badge.endsWith("· auto-approve"), `badge reads auto-approve: ${badge}`)
      // Off applies at once, no confirm.
      await page.locator(`${R} .kimo-toggle`).click()
      expect((await page.locator(D).count()) === 0, "turning off never asks")
      await page.waitForFunction(
        () =>
          (window as unknown as Agents).__agents.host.control.policies["claude-code"]
            ?.autoApprove === false,
      )

      // Editor: a waiting prompt is approved when the option turns on; the pill shows it.
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
      const PILL = "[data-testid=agent-auto-approve-pill]"
      await page.locator(PILL).waitFor()
      m = await measure(page, {
        chip: "[data-testid=agent-presence] .kimo-agent-chip",
        pill: PILL,
        icon: `${PILL} .agents-auto-pill__icon`,
        label: `${PILL} .agents-auto-pill__label`,
      })
      const pc = checker(ctx, "Board 34 §3 Auto-approve Pill (XYAmZ)")
      pc.box("Auto-approve Pill (XYAmZ)", m.pill, {
        h: 24,
        pad: [0, 8, 0, 6],
        gap: 4,
        radius: 999,
        bg: warningSoft,
        color: warning,
      })
      pc.box("Icon (B1X41i)", m.icon, { w: 12, h: 12 })
      pc.box("Label (nw9q6)", m.label, { fs: 11, fw: "500" })
      if (m.chip && m.pill)
        pc.check("Topbar Presence", "Chip → Pill gap", m.pill.x - (m.chip.x + m.chip.w), 6)
      pc.flush()

      // Activity: the approval row reads "approved automatically" in warning.
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
      const ac = checker(ctx, "Board 34 §2 Activity row (X3swX)")
      ac.check("Tool (PPms1)", "color", color, warning)
      ac.flush()
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
        await page.waitForTimeout(50)
        await promptFits(ctx, label)
        if (ctx.shots)
          await page.screenshot({ path: join(ctx.shots, `board34-many-${w}x${h}.png`) })
      }
    },
  },
]
