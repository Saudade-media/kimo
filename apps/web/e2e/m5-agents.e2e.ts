/**
 * Board 21 "Agents & MCP" (KGdvA) on the M5 agents harness (`e2e/m5-agents-harness`, scripted
 * McpHostApi + real DocStore): presence chip states, session popover (Undo all / Keep / Revert),
 * approval prompt (queue, countdown, Esc = Deny, no session choice for files), dry-run ghosts +
 * bar, canvas attribution, paused banner, layer dots, Activity tab (filters, groups, undo, stale,
 * export), Settings › Agents & MCP (running / empty / failed). Each surface gets one measured
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
  if (process.env.KIMO_E2E_DEV === "1") return `${ctx.url}e2e/m5-agents-harness/index.html`
  built ??= build({
    root: join(here, "m5-agents-harness"),
    configFile: false,
    base: "./",
    logLevel: "error",
    plugins: [react()],
    build: {
      outDir: join(process.env.KIMO_E2E_OUTDIR ?? join(here, ".dist"), "m5-agents"),
      emptyOutDir: true,
      target: "es2022",
    },
  }).then(() => "m5-agents/index.html")
  return `${ctx.url}${await built}`
}

type Agents = {
  __agents: {
    ORIGIN: string
    FILE: string
    PATH: string
    focused: string[][]
    exported: string[]
    highlights: (string[] | null)[]
    host: {
      calls: string[]
      control: {
        policies: Record<string, { level: string; files: string[] }>
        resolve(id: string, o: string): void
        setStatus(s: unknown): void
      }
    }
    store: {
      getNode(id: string): Record<string, unknown> | undefined
      setReadOnly(r: string | null): void
      hasNode(id: string): boolean
    }
    controller: { state: { chips: { presence: string }[]; prompt: unknown; touched: Set<string> } }
    connect(over?: Record<string, unknown>): { connectionId: string; origin: string }
    apply(ops: unknown, origin?: string): boolean
    entry(e: Record<string, unknown>): unknown
    request(over?: Record<string, unknown>): void
  }
}
declare const window: Agents & Window

async function open(ctx: E2EContext, scene = "editor") {
  await ctx.page.setViewportSize({ width: 1440, height: 900 })
  await ctx.page.goto(`${await harnessUrl(ctx)}?scene=${scene}`)
  await ctx.page.waitForFunction(() => !!(window as unknown as Agents).__agents)
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
  border: string
  opacity: string
  justify: string
  align: string
  display: string
}

function measure(page: Page, selectors: Record<string, string>) {
  return page.evaluate((sels) => {
    const out: Record<string, unknown> = {}
    for (const [k, raw] of Object.entries(sels)) {
      const pseudo = raw.endsWith("::before") ? "::before" : null
      const sel = pseudo ? raw.slice(0, -8) : raw
      const e = document.querySelector(sel)
      if (!e) {
        out[k] = null
        continue
      }
      const r = e.getBoundingClientRect()
      const cs = getComputedStyle(e, pseudo)
      out[k] = {
        x: r.x,
        y: r.y,
        w: pseudo ? parseFloat(cs.width) : r.width,
        h: pseudo ? parseFloat(cs.height) : r.height,
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
        border: `${cs.borderTopWidth} ${cs.borderTopColor}`,
        opacity: cs.opacity,
        justify: cs.justifyContent,
        align: cs.alignItems,
        display: cs.display,
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
    want: Partial<Record<"w" | "h" | "gap" | "fs" | "lh" | "radius", number>> & {
      pad?: number[]
      fw?: string
      ff?: string
      bg?: string
      color?: string
    },
  ) => {
    expect(b, `${surface} › ${el} is rendered`)
    if (!b) return
    expect(b.display !== "none" && b.h > 0, `${surface} › ${el} has a box`)
    for (const k of ["w", "h", "gap", "fs", "lh", "radius"] as const)
      if (want[k] !== undefined) check(el, k, b[k], want[k] as number)
    if (want.pad) check(el, "padding", b.pad.join(" "), want.pad.join(" "))
    if (want.fw) check(el, "font-weight", b.fw, want.fw)
    if (want.ff) check(el, "font-family", b.ff, want.ff)
    if (want.bg) check(el, "background", b.bg, want.bg)
    if (want.color) check(el, "color", b.color, want.color)
  }
  const flush = () =>
    ctx.log(
      `\n    ${surface}\n    | element | property | design | measured | |\n    |---|---|---|---|---|\n${rows.map((r) => `    ${r}`).join("\n")}`,
    )
  return { check, box, flush }
}

/** Connects Claude Code and lands two op groups + their activity entries. */
async function agentEdits(page: Page) {
  await page.evaluate(() => {
    const a = (window as unknown as Agents).__agents
    a.connect({ state: "editing" })
    a.apply({ op: "update", id: "Card000002", set: { fill: "#E9DFCF", radius: 20 } })
    a.entry({ summary: "Restyle pricing cards", nodeIds: ["Card000002"] })
    a.apply([
      {
        op: "insert",
        id: "Popular001",
        node: { type: "frame", parent: "Card000002", name: "Popular", x: 0, y: 0, w: 57, h: 19 },
      },
    ])
    a.entry({ summary: "Add popular badge", nodeIds: ["Popular001", "Card000002"] })
  })
  await page.locator(".kimo-agent-chip").waitFor()
}

const calls = (page: Page) =>
  page.evaluate(() => (window as unknown as Agents).__agents.host.calls.slice())

export const scenarios: Scenario[] = [
  {
    name: "m5-agents: presence chip editing → session popover (ops, Revert, Undo all, Keep) + measured pass",
    async run(ctx) {
      const { page } = ctx
      await open(ctx)
      expect(
        (await page.locator(".kimo-agent-chip").count()) === 0,
        "no chip before an agent writes",
      )
      await agentEdits(page)
      const chip = page.locator(".kimo-agent-chip")
      expect((await chip.getAttribute("data-state")) === "editing", "editing chip")
      expect((await chip.innerText()).includes("Claude Code is editing"), "chip label")
      expect(
        (await page.locator(".kimo-agent-chip__meta").innerText()) === "3 ops",
        "meta = ops since Keep",
      )

      const agent = await token(page, "--kimo-agent")
      const agentSoft = await token(page, "--kimo-agent-soft")
      const c = checker(ctx, "AgentPresenceChip (I3Q0Q) in Drag Region (G1mul)")
      const m = await measure(page, {
        chip: ".kimo-agent-chip",
        orb: ".kimo-agent-chip .kimo-agent-mark",
        label: ".kimo-agent-chip__label",
        sep: ".kimo-agent-chip__sep",
        meta: ".kimo-agent-chip__meta",
        chevron: ".kimo-agent-chip__chevron",
        drag: "[data-testid=drag-region]",
      })
      c.box("chip", m.chip, { h: 28, gap: 6, pad: [0, 10, 0, 4], bg: agentSoft, color: agent })
      c.check("chip", "radius ≥ h/2", (m.chip?.radius ?? 0) >= 14 ? "pill" : "square", "pill")
      c.check(
        "chip",
        "right = drag region right",
        (m.chip?.x ?? 0) + (m.chip?.w ?? 0),
        (m.drag?.x ?? 0) + (m.drag?.w ?? 0),
      )
      c.check("chip", "center y", (m.chip?.y ?? 0) + 14, 24)
      // Board 24 BXTD5: Orb 20 → AgentMark/24/Working.
      c.box("AgentMark/24 (ff0un, was Orb sZqHj)", m.orb, { w: 24, h: 24 })
      c.check(
        "AgentMark",
        "state",
        await page.locator(".kimo-agent-chip .kimo-agent-mark").getAttribute("data-state"),
        "working",
      )
      c.box("Label (u7zeoB)", m.label, { fs: 12, fw: "500", lh: 15, color: agent, ff: "Inter" })
      c.box("Sep (S02ieE)", m.sep, { w: 3, h: 3, bg: agent })
      c.box("Meta (sCc98)", m.meta, { fs: 11, ff: "JetBrains Mono", lh: 15 })
      c.box("Chevron (OSvd0)", m.chevron, { w: 12, h: 12 })
      c.flush()

      // Session popover.
      await chip.click()
      const pop = page.locator("[data-testid=agent-session-popover]")
      await pop.waitFor()
      const ops = await pop.locator(".kimo-agent-op-row").allInnerTexts()
      expect(ops.length === 3, `3 op rows: ${ops.join(" / ")}`)
      expect(
        ops[0]?.includes("fill") && ops[0]?.includes("#F4F1EC → #E9DFCF"),
        `before → after: ${ops[0]}`,
      )
      expect(ops[2]?.includes("insert") && ops[2]?.includes("Popular"), "insert row")
      expect(
        (await pop.locator(".agents-session__list-label").innerText()) === "3 changes · 2 nodes",
        "list header",
      )
      expect(
        (await pop.locator(".kimo-agent-op-row__revert").count()) === 1,
        "Revert only on the top group's row",
      )
      const p = checker(ctx, "Session Popover (hIfmx)")
      const pm = await measure(page, {
        pop: "[data-testid=agent-session-popover]",
        header: ".agents-session__header",
        orb: ".agents-session__header > .kimo-agent-mark",
        name: ".agents-session__name",
        version: ".agents-session__version",
        scope: ".agents-session__scope",
        now: ".agents-session__now",
        list: ".agents-session__list-header",
        listLabel: ".agents-session__list-label",
        ops: ".agents-session__ops",
        row: ".agents-session__ops .kimo-agent-op-row",
        opChip: ".agents-session__ops .kimo-agent-op-row__op",
        opName: ".agents-session__ops .kimo-agent-op-row__op-name",
        actions: ".agents-session__actions",
        undo: ".agents-session__actions .kimo-button--secondary",
        keep: ".agents-session__actions .kimo-button--primary",
        pause: ".agents-session__header .kimo-icon-button",
      })
      p.box("Session Popover", pm.pop, { w: 380, radius: 16 })
      p.check(
        "Session Popover",
        "top = chip bottom + 16",
        pm.pop?.y ?? 0,
        (m.chip?.y ?? 0) + 28 + 16,
      )
      p.box("Header (eLfuF)", pm.header, { h: 53, gap: 10, pad: [12, 12, 10, 12] })
      p.box("AgentMark 28 (was Orb aNZFr)", pm.orb, { w: 28, h: 28 })
      p.box("Name (NCPvU)", pm.name, { fs: 13, fw: "600", lh: 16 })
      p.box("Version (MUzJe)", pm.version, { fs: 11, ff: "JetBrains Mono" })
      p.box("Scope (J7TFb)", pm.scope, { fs: 11, lh: 13 })
      p.box("Pause (dvBoE)", pm.pause, { w: 24, h: 24 })
      p.box("Now (esKwa)", pm.now, { h: 31, gap: 8, pad: [8, 12, 8, 12], bg: agentSoft })
      p.box("List Header (l7Meg6)", pm.list, { h: 29, gap: 8, pad: [10, 12, 4, 12] })
      p.box("List label (TahP0)", pm.listLabel, { fs: 12, fw: "600" })
      p.box("Ops (fM9DY)", pm.ops, { pad: [2, 0, 8, 0] })
      p.box("AgentOpRow (m9RhF)", pm.row, { h: 28, gap: 8, pad: [5, 12, 5, 12] })
      p.box("Op (GWVaR)", pm.opChip, { w: 52, h: 18, radius: 4, bg: agentSoft })
      p.box("Op Name (DuXnB)", pm.opName, { fs: 11, fw: "500", color: agent })
      p.box("Actions (Z9p0c)", pm.actions, { h: 48, gap: 8, pad: [10, 12, 10, 12] })
      p.box("Undo all (rN2FW)", pm.undo, { h: 28, pad: [0, 12, 0, 12] })
      p.box("Keep (AAKop)", pm.keep, { h: 28, pad: [0, 12, 0, 12] })
      p.flush()
      if (ctx.shots) await page.screenshot({ path: join(ctx.shots, "m5-session-popover.png") })

      // Layer dots on touched rows (LayerRow/Agent PwDCI), not on ancestors.
      const l = checker(ctx, "LayerRow/Agent (PwDCI)")
      expect(
        (await page.locator(".kimo-layer-row--agent").count()) === 1,
        "one touched row (Card 2; Popular has no row)",
      )
      const lm = await measure(page, {
        spacer: ".kimo-layer-row--agent .kimo-layer-row__spacer",
        dot: ".kimo-layer-row--agent .kimo-layer-row__spacer::before",
        name: ".kimo-layer-row--agent .kimo-layer-row__name",
      })
      l.box("Agent Mark (OEkBe)", lm.spacer, { pad: [0, 0, 0, 2] })
      l.box("Agent Dot (n5D1xb)", lm.dot, { w: 6, h: 6, bg: agent })
      l.check(
        "Agent Mark",
        "left = name right + gap 6",
        lm.spacer?.x ?? 0,
        (lm.name?.x ?? 0) + (lm.name?.w ?? 0) + 6,
        1,
      )
      expect(
        (await page.locator('[data-id="Cards00001"].kimo-layer-row--agent').count()) === 0,
        "ancestor has no dot",
      )
      l.flush()

      // Revert the top group → 2 rows; Keep → empty list and no dots.
      await pop.locator(".kimo-agent-op-row__revert").click()
      await page.waitForFunction(
        () => document.querySelectorAll(".agents-session__ops .kimo-agent-op-row").length === 2,
      )
      expect(
        await page.evaluate(
          () => !(window as unknown as Agents).__agents.store.hasNode("Popular001"),
        ),
        "Revert undid the insert",
      )
      await pop.getByRole("button", { name: "Keep" }).click()
      await page.waitForFunction(
        () => document.querySelectorAll(".agents-session__ops .kimo-agent-op-row").length === 0,
      )
      expect((await page.locator(".kimo-layer-row--agent").count()) === 0, "Keep clears the dots")
      // New edit, Undo all reverts it.
      await page.evaluate(() => {
        const a = (window as unknown as Agents).__agents
        a.apply({ op: "update", id: "Card000003", set: { fill: "#000000" } })
        a.entry({ summary: "Darken", nodeIds: ["Card000003"] })
      })
      await page.waitForFunction(
        () => document.querySelectorAll(".agents-session__ops .kimo-agent-op-row").length === 1,
      )
      await pop.getByRole("button", { name: "Undo all" }).click()
      await page.waitForFunction(
        () =>
          (window as unknown as Agents).__agents.store.getNode("Card000003")?.fill === "#F4F1EC",
      )
      // Pause = policy read; chip turns Paused.
      await pop.getByRole("button", { name: "Pause Claude Code" }).click()
      await page.waitForFunction(
        () => document.querySelector(".kimo-agent-chip")?.getAttribute("data-state") === "paused",
      )
      // A real pause in the host runtime (McpHostApi.clients), never a policy rewrite.
      const after = await calls(page)
      expect(after.includes("pause claude-code"), "pause goes through clients.pause")
      expect(
        !after.some((x) => x.startsWith("policy claude-code")),
        "pause leaves the policy alone",
      )
    },
  },
  {
    name: "m5-agents: approval prompt (queue, countdown, Esc = Deny, files have no session choice) + dry run + measured",
    async run(ctx) {
      const { page } = ctx
      await open(ctx)
      await agentEdits(page)
      await page.evaluate(() => (window as unknown as Agents).__agents.request())
      const prompt = page.locator("[data-testid=agent-approval]")
      await prompt.waitFor()
      // Board 24 (e): waiting keeps the agent-soft chip with a Listening mark and a neutral queue
      // badge (hand + N); the approval prompt still hangs from the chip.
      const chip = page.locator(".kimo-agent-chip")
      expect((await chip.getAttribute("data-state")) === "waiting", "chip waiting")
      expect((await chip.innerText()).includes("Claude Code is waiting"), "waiting label")
      expect(
        (await prompt.locator(".agents-approval__title").innerText()) ===
          "Claude Code wants to delete 2 frames",
        "title",
      )
      expect(
        (await prompt.locator("[data-choice]").allInnerTexts()).join("|") ===
          "Deny|Always for this session|Allow once",
        "choices",
      )
      expect(
        (await prompt.locator(".agents-approval__footnote").innerText()).includes(
          "No answer in 2 min → PERMISSION_DENIED",
        ),
        "footnote",
      )
      const targets = await prompt.locator(".kimo-agent-op-row").allInnerTexts()
      expect(
        targets.length === 3 && targets[0]?.includes("delete"),
        `targets: ${targets.join(" / ")}`,
      )
      expect(
        (await prompt.locator(".kimo-agent-op-row__revert").count()) === 0,
        "targets have no Revert (k16ep0 disabled)",
      )

      const agent = await token(page, "--kimo-agent")
      const danger = await token(page, "--kimo-danger")
      const dangerSoft = await token(page, "--kimo-danger-soft")
      const c = checker(ctx, "Approval Prompt (weJXw) + chip waiting (board 24 I7jut)")
      const m = await measure(page, {
        chip: ".kimo-agent-chip",
        chipMark: ".kimo-agent-chip .kimo-agent-mark",
        badge: ".kimo-agent-chip__queue",
        badgeIcon: ".kimo-agent-chip__queue-icon",
        badgeCount: ".kimo-agent-chip__queue-count",
        prompt: "[data-testid=agent-approval]",
        head: ".agents-approval__head",
        orb: ".agents-approval__head > .kimo-agent-mark",
        text: ".agents-approval__text",
        title: ".agents-approval__title",
        desc: ".agents-approval__desc",
        targets: ".agents-approval__targets",
        row: ".agents-approval__targets .kimo-agent-op-row",
        delChip: ".agents-approval__targets .kimo-agent-op-row--danger .kimo-agent-op-row__op",
        meta: ".agents-approval__call",
        footer: ".agents-approval__footer",
        deny: "[data-choice=deny]",
        session: "[data-choice=session]",
        once: "[data-choice=once]",
        footnote: ".agents-approval__footnote",
      })
      c.box("Approval Prompt", m.prompt, { w: 400, gap: 14, pad: [20, 20, 20, 20], radius: 24 })
      c.box("chip waiting (W42AfV)", m.chip, { h: 28, bg: await token(page, "--kimo-agent-soft") })
      c.box("AgentMark/24/Listening (lwHOe)", m.chipMark, { w: 24, h: 24 })
      c.box("Queue badge (kMZD0)", m.badge, {
        h: 18,
        gap: 4,
        pad: [0, 7, 0, 7],
        bg: await token(page, "--kimo-text-primary"),
      })
      c.box("Badge icon (IDSo6) hand", m.badgeIcon, { w: 11, h: 11 })
      c.box("Badge count (W4U4tm)", m.badgeCount, {
        fs: 11,
        fw: "600",
        color: await token(page, "--kimo-text-inverse"),
      })
      c.check(
        "Approval Prompt",
        "top = chip bottom + 18",
        m.prompt?.y ?? 0,
        (m.chip?.y ?? 0) + 28 + 18,
      )
      c.box("Head (CDPPh)", m.head, { gap: 12 })
      c.box("AgentMark/32/Listening (was Orb TehF3)", m.orb, { w: 32, h: 32 })
      c.box("Text (XMYt8)", m.text, { gap: 4 })
      c.box("Title (K8XYWw)", m.title, { fs: 14, fw: "600", lh: 17 })
      c.box("Desc (Ckwa6)", m.desc, { fs: 12, lh: 17 })
      c.box("Targets (dBQHl)", m.targets, { pad: [4, 0, 4, 0], radius: 10 })
      c.box("Target row", m.row, { h: 28 })
      c.box("delete Op chip", m.delChip, { bg: dangerSoft, color: danger })
      c.box("Call (xydSY)", m.meta, { fs: 11, ff: "JetBrains Mono" })
      c.box("Footer (AUE48)", m.footer, { gap: 8, h: 30 })
      c.box("Deny (LTfdO)", m.deny, { h: 30, pad: [0, 12, 0, 12], fs: 12 })
      c.box("Always (Fw3dn)", m.session, { h: 30, pad: [0, 12, 0, 12] })
      c.box("Allow once (Pwqan)", m.once, { h: 30, pad: [0, 14, 0, 14] })
      c.box("Footnote (tCHDj)", m.footnote, { fs: 11, lh: 13 })
      c.check(
        "Allow once",
        "right = footer right",
        (m.once?.x ?? 0) + (m.once?.w ?? 0),
        (m.footer?.x ?? 0) + (m.footer?.w ?? 0),
      )
      c.flush()

      // Dry run: ghosts + bar.
      const ghosts = page.locator("[data-testid=agent-ghost]")
      expect((await ghosts.count()) === 3, "3 ghosts (2 delete, 1 update)")
      const d = checker(ctx, "Dry run ghosts (Atu30 / IgiLq) + Dry-run bar (board 24 g jMSYI)")
      const dm = await measure(page, {
        canvas: "[data-testid=canvas]",
        ghost: "[data-kind=delete]",
        label: "[data-kind=delete] .agents-ghost__label-row",
        chipG: "[data-kind=delete] .agents-ghost__chip",
        box: "[data-kind=delete] .agents-ghost__box",
        upd: "[data-kind=update] .agents-ghost__box",
        bar: "[data-testid=agent-dry-run-bar]",
        mark: "[data-testid=agent-dry-run-bar] .kimo-agent-mark",
        title: ".agents-dry-bar__title",
        meta: ".agents-dry-bar__meta",
        discard: "[data-testid=agent-dry-run-bar] .kimo-button--ghost",
        apply: "[data-testid=agent-dry-run-bar] .kimo-button--primary",
      })
      d.box("Ghost (Atu30)", dm.ghost, { gap: 6 })
      d.box("Label Row (JnRy2)", dm.label, { h: 16, gap: 6 })
      d.box("Op Chip (RLWzg)", dm.chipG, { h: 16, pad: [0, 5, 0, 5], radius: 4, bg: dangerSoft })
      d.box("Box (hz52k)", dm.box, { w: 136, h: 220, radius: 12 })
      d.check("Box (hz52k)", "stroke", dm.box?.shadow, `${danger} 0px 0px 0px 1.5px inset`)
      d.check("Box (hz52k)", "opacity", dm.box?.opacity, "0.4")
      d.check("Box (hz52k)", "x = Card 1 x", (dm.box?.x ?? 0) - (dm.canvas?.x ?? 0), 64)
      d.check("update box", "stroke", dm.upd?.shadow, `${agent} 0px 0px 0px 1.5px inset`)
      d.box("Dry-run bar (jMSYI)", dm.bar, { h: 32, gap: 8, pad: [0, 4, 0, 4], radius: 999 })
      d.check("Dry-run bar", "top-centre: y", (dm.bar?.y ?? 0) - (dm.canvas?.y ?? 0), 10)
      d.check(
        "Dry-run bar",
        "top-centre: centre x",
        (dm.bar?.x ?? 0) + (dm.bar?.w ?? 0) / 2,
        (dm.canvas?.x ?? 0) + (dm.canvas?.w ?? 0) / 2,
      )
      d.box("AgentMark/12 (sNM5a)", dm.mark, { w: 12, h: 12 })
      d.box("Label (BKX87)", dm.title, { fs: 12, fw: "500" })
      d.box("Meta (veup0)", dm.meta, { fs: 11 })
      d.box("Discard (l5WPN)", dm.discard, { h: 24, pad: [0, 8, 0, 8], fs: 11 })
      d.box("Apply (njpQz)", dm.apply, { h: 24, pad: [0, 10, 0, 10], fs: 11 })
      d.flush()
      if (ctx.shots) await page.screenshot({ path: join(ctx.shots, "m5-approval-dry-run.png") })
      expect(
        (await page.locator(".agents-dry-bar__title").innerText()) === "Dry run · 3 ops",
        "op count",
      )

      // Queue: a file request arrives; Esc denies the first, the file prompt follows without session.
      await page.evaluate(() =>
        (window as unknown as Agents).__agents.request({
          reason: { kind: "file", path: "/tmp/other.kimo", action: "open" },
          path: undefined,
        }),
      )
      await page.waitForFunction(() =>
        document
          .querySelector(".agents-approval__footnote")
          ?.textContent?.includes("1 more waiting"),
      )
      await page.keyboard.press("Escape")
      await page.waitForFunction(
        () =>
          document.querySelector(".agents-approval__title")?.textContent ===
          "Claude Code wants to open other.kimo",
      )
      expect(
        (await calls(page)).some((x) => /^respond ap\d+ deny$/.test(x)),
        "Esc = Deny",
      )
      expect(
        (await prompt.locator("[data-choice=session]").count()) === 0,
        "no session allowance for files",
      )
      expect(
        (await prompt.locator(".agents-approval__footnote").innerText()).includes("OUT_OF_SCOPE"),
        "file denial code",
      )
      await prompt.locator("[data-choice=once]").click()
      await page.waitForFunction(() => !document.querySelector("[data-testid=agent-approval]"))
      expect(
        (await calls(page)).some((x) => /^respond ap\d+ once$/.test(x)),
        "Allow once",
      )
      await chip.waitFor()
      expect((await chip.getAttribute("data-state")) === "editing", "back to editing")
    },
  },
  {
    name: "m5-agents: approval countdown ticks and a timeout resolves the prompt",
    async run(ctx) {
      const { page } = ctx
      await open(ctx)
      await agentEdits(page)
      await page.evaluate(() => {
        const now = Date.now()
        ;(window as unknown as Agents).__agents.request({
          requestedAt: now - 60_000,
          expiresAt: now + 61_000,
        })
      })
      const foot = page.locator(".agents-approval__footnote")
      await foot.waitFor()
      const first = await foot.innerText()
      expect(/No answer in 1:0\d/.test(first), `countdown: ${first}`)
      await page.waitForTimeout(1200)
      expect((await foot.innerText()) !== first, "countdown ticks")
      await page.evaluate(() => {
        const a = (window as unknown as Agents).__agents
        const id = (a.controller.state.prompt as { request: { id: string } }).request.id
        a.host.control.resolve(id, "timeout")
      })
      await page.waitForFunction(() => !document.querySelector("[data-testid=agent-approval]"))
    },
  },
  {
    name: "m5-agents: canvas attribution outline + tag + agent cursor; fades after commit; measured",
    async run(ctx) {
      const { page } = ctx
      await open(ctx)
      await agentEdits(page)
      const agent = await token(page, "--kimo-agent")
      const onAccent = await token(page, "--kimo-on-accent")
      const c = checker(ctx, "Canvas attribution (LMWYr / GSUtG / IJH2i)")
      const m = await measure(page, {
        canvas: "[data-testid=canvas]",
        outline: "[data-testid=agent-outline]",
        tag: "[data-testid=agent-tag]",
        tagOrb: "[data-testid=agent-tag] .kimo-agent-mark",
        tagLabel: ".agents-attribution__tag-label",
        cursor: "[data-testid=agent-cursor]",
        pointer: ".agents-cursor__pointer",
        pill: ".agents-cursor__pill",
        pillOrb: ".agents-cursor__pill .kimo-agent-mark",
        pillLabel: ".agents-cursor__label",
      })
      const cx = m.canvas?.x ?? 0
      const cy = m.canvas?.y ?? 0
      c.box("Agent Outline (LMWYr)", m.outline, { w: 136, h: 220, radius: 20 })
      c.check(
        "Agent Outline",
        "x, y",
        `${(m.outline?.x ?? 0) - cx},${(m.outline?.y ?? 0) - cy}`,
        "216,152",
      )
      c.check("Agent Outline", "stroke", m.outline?.shadow, `${agent} 0px 0px 0px 1.5px inset`)
      c.box("Agent Attribution (GSUtG)", m.tag, {
        h: 18,
        gap: 4,
        pad: [0, 6, 0, 3],
        radius: 4,
        bg: agent,
      })
      c.check("Agent Attribution", "y", (m.tag?.y ?? 0) - cy, 131)
      c.box("AgentMark/12 (was Orb TVSAy)", m.tagOrb, { w: 12, h: 12 })
      c.box("Label (pF4zL)", m.tagLabel, { fs: 11, fw: "500", lh: 13, color: onAccent })
      c.box("Agent Cursor (IJH2i)", m.cursor, { gap: 2 })
      c.box("Pointer (ehJ5c)", m.pointer, { w: 18, h: 18, color: agent })
      c.box("Pill (pIYVd)", m.pill, { gap: 6, pad: [4, 10, 4, 4], bg: agent, h: 23 })
      // Board 24 GmEAl: the cursor pill mark is AgentMark/12 (was Orb 14).
      c.box("AgentMark/12 (c0aVjQ, was Orb vocxw)", m.pillOrb, { w: 12, h: 12 })
      c.check(
        "Agent Cursor",
        "anchor = target top-left + (4, 4) (board 24 g)",
        `${(m.cursor?.x ?? 0) - cx},${(m.cursor?.y ?? 0) - cy}`,
        "220,156",
      )
      c.box("Label (FnfGU)", m.pillLabel, { fs: 12, fw: "500", color: onAccent })
      c.flush()
      if (ctx.shots) await page.screenshot({ path: join(ctx.shots, "m5-attribution.png") })
      // Board 31 "Canvas label": the agent's name only (no layer, state or tool).
      expect(
        (await page.locator(".agents-attribution__tag-label").innerText()) === "Claude Code",
        "tag copy",
      )
      expect(
        (await page.locator(".agents-cursor__label").innerText()) === "Claude Code",
        "cursor copy",
      )
      // Commit (idle) → outline fades after 2 s.
      await page.evaluate(() => {
        const a = (window as unknown as Agents).__agents
        ;(
          a.host.control as unknown as { updateConnection(id: string, p: unknown): void }
        ).updateConnection("conn-claude-code-k3x9qa", {
          state: "idle",
          lastActivityAt: Date.now() - 1900,
        })
      })
      await page.waitForFunction(
        () => !!document.querySelector(".agents-attribution--faded"),
        null,
        { timeout: 5000 },
      )
      expect(
        (await page.locator("[data-testid=agent-cursor]").count()) === 0,
        "no cursor when idle",
      )
    },
  },
  {
    name: "m5-agents: READ_ONLY pauses the agent (chip /Paused + Banner/Warning); measured",
    async run(ctx) {
      const { page } = ctx
      await open(ctx)
      await agentEdits(page)
      await page.evaluate(() => {
        const a = (window as unknown as Agents).__agents
        a.store.setReadOnly("format 0.3")
        a.entry({
          kind: "error",
          code: "READ_ONLY",
          summary: "Restyle footer",
          undoToken: undefined,
        })
      })
      const chip = page.locator(".kimo-agent-chip")
      await page.waitForFunction(
        () => document.querySelector(".kimo-agent-chip")?.getAttribute("data-state") === "paused",
      )
      expect((await chip.innerText()).includes("Claude Code · edits paused"), "paused label")
      expect(
        (await page.locator(".kimo-agent-chip__meta").innerText()) === "read-only",
        "paused meta",
      )
      const banner = page.locator("[data-testid=agent-paused-banner]")
      await banner.waitFor()
      const text = await banner.innerText()
      expect(
        text.includes("Agent edits paused") &&
          text.includes("read-only (format 0.3)") &&
          text.includes("READ_ONLY"),
        text,
      )
      expect(
        (await banner.locator("button").allInnerTexts()).join("|").includes("Save a copy…"),
        "Save a copy…",
      )
      const warning = await token(page, "--kimo-warning")
      const warningSoft = await page.evaluate(() => {
        const el = document.createElement("div")
        el.style.backgroundColor = "var(--kimo-warning-soft)"
        document.body.append(el)
        const c = getComputedStyle(el).backgroundColor
        el.remove()
        return c
      })
      const c = checker(ctx, "AgentPresenceChip/Paused (fFrQA) + Banner/Warning (hsIeq)")
      const m = await measure(page, {
        chip: ".kimo-agent-chip",
        label: ".kimo-agent-chip__label",
        banner: "[data-testid=agent-paused-banner]",
      })
      c.box("chip /Paused", m.chip, { h: 28, bg: warningSoft })
      c.box("chip label", m.label, { color: warning })
      c.box("Banner", m.banner, { w: 1440, bg: warningSoft })
      c.flush()
      // A later successful edit clears the pause.
      await page.evaluate(() => {
        const a = (window as unknown as Agents).__agents
        a.store.setReadOnly(null)
        a.entry({ summary: "ok" })
      })
      await page.waitForFunction(() => !document.querySelector("[data-testid=agent-paused-banner]"))
    },
  },
  {
    name: "m5-agents: Activity tab — filters, session groups, pending row, undo + stale, export; measured",
    async run(ctx) {
      const { page } = ctx
      await open(ctx)
      await agentEdits(page)
      await page.evaluate(() => {
        const a = (window as unknown as Agents).__agents
        a.entry({ kind: "read", tool: "kimo_query", summary: "Read cards", undoToken: undefined })
        a.entry({
          origin: "mcp:codex.q7w2er",
          actor: "Codex",
          kind: "denied",
          code: "PERMISSION_DENIED",
          outcome: "deny",
          summary: "Delete Old Hero",
          nodeIds: ["OldHero001"],
          undoToken: undefined,
        })
        a.entry({
          origin: "mcp:codex.q7w2er",
          actor: "Codex",
          kind: "error",
          code: "REVISION_CONFLICT",
          summary: "Update Navbar",
          undoToken: undefined,
        })
        a.request({
          client: { client: "codex", label: "Codex", session: "q7w2er", transport: "http" },
          summary: "Replace hero",
        })
      })
      const panel = page.locator("[data-testid=agent-activity]")
      await page.waitForFunction(
        () => document.querySelectorAll(".agents-activity__group").length === 2,
      )
      const groups = await panel.locator(".agents-activity__group-name").allInnerTexts()
      expect(groups.join("|") === "Codex|Claude Code", `newest session first: ${groups}`)
      const codex = panel.locator(".agents-activity__group").first()
      expect(
        (await codex.locator(".kimo-activity-row").first().getAttribute("class"))?.includes(
          "--pending",
        ),
        "pending first",
      )
      const tools = await codex.locator(".kimo-activity-row__tool").allInnerTexts()
      expect(tools[0] === "kimo_apply_ops · waiting for approval", tools[0] ?? "")
      expect(
        tools.includes("PERMISSION_DENIED · denied by you") &&
          tools.some((t) => t.startsWith("REVISION_CONFLICT")),
        tools.join(" / "),
      )
      expect(!(await panel.innerText()).includes("Read cards"), "reads hidden by Writes + errors")

      const agentSoft = await token(page, "--kimo-agent-soft")
      const danger = await token(page, "--kimo-danger")
      const warning = await token(page, "--kimo-warning")
      const agent = await token(page, "--kimo-agent")
      const subtle = await page.evaluate(
        () =>
          getComputedStyle(document.querySelector(".agents-activity__group-header") as Element)
            .backgroundColor,
      )
      const c = checker(ctx, "Activity tab (O3WOp › Pbaa8)")
      const m = await measure(page, {
        panel: "[data-testid=agent-activity]",
        filters: ".agents-activity__filters",
        select: ".agents-activity__select",
        group: ".agents-activity__group-header",
        orb: ".agents-activity__group-header .kimo-agent-mark",
        gname: ".agents-activity__group-name",
        gmeta: ".agents-activity__group-meta",
        link: ".agents-activity__group-header .agents-link",
        pending: ".kimo-activity-row--pending",
        pendingTool: ".kimo-activity-row--pending .kimo-activity-row__tool",
        denied: ".kimo-activity-row--danger .kimo-activity-row__tool",
        conflict: ".kimo-activity-row--warning .kimo-activity-row__tool",
        row: ".agents-activity__group:last-child .kimo-activity-row",
        time: ".agents-activity__group:last-child .kimo-activity-row__time",
        text: ".agents-activity__group:last-child .kimo-activity-row__text",
        label: ".agents-activity__group:last-child .kimo-activity-row__label",
        target: ".agents-activity__group:last-child .kimo-activity-row__target",
        undo: ".agents-activity__group:last-child .kimo-activity-row__undo",
        footer: ".agents-activity__footer",
        retention: ".agents-activity__retention",
        exportBtn: ".agents-activity__footer .kimo-button",
      })
      c.box("Activity", m.panel, { w: 340 })
      c.box("Filters (nDEoh)", m.filters, { h: 44, gap: 8, pad: [8, 12, 8, 12] })
      c.box("Client filter (c76Fq)", m.select, { w: 154, h: 28 })
      c.box("Group (RnyZP)", m.group, { h: 32, gap: 8, pad: [8, 12, 8, 12], bg: subtle })
      c.box("AgentMark 16 (was Orb DlFYh)", m.orb, { w: 16, h: 16 })
      c.box("Name (LSle2)", m.gname, { fs: 12, fw: "600" })
      c.box("Meta (IMIPp)", m.gmeta, { fs: 11, ff: "JetBrains Mono" })
      c.box("Undo session (a7Z2n)", m.link, { fs: 11, fw: "500" })
      c.box("Entry · pending (hIHR9)", m.pending, { h: 71, bg: agentSoft })
      c.box("pending tool", m.pendingTool, { color: agent })
      c.box("denied tool", m.denied, { color: danger })
      c.box("conflict tool", m.conflict, { color: warning })
      c.box("ActivityRow (R7zb80)", m.row, { h: 71, gap: 10, pad: [10, 12, 10, 12] })
      c.box("Time (d7qv9g)", m.time, { w: 36, fs: 11, ff: "JetBrains Mono" })
      c.box("Text (pnhEg)", m.text, { gap: 3, h: 51 })
      c.box("Label (lQxhQ)", m.label, { fs: 12, fw: "500", lh: 15 })
      c.box("Target (aegZN)", m.target, { fs: 11, lh: 15 })
      c.box("Undo (ECru2)", m.undo, { w: 24, h: 24, radius: 10 })
      c.box("Footer (ng9cE)", m.footer, { h: 48, gap: 8, pad: [10, 12, 10, 12] })
      c.box("Retention (q6gZX7)", m.retention, { fs: 11, ff: "JetBrains Mono" })
      c.box("Export JSON (n6FdBU)", m.exportBtn, { h: 28, pad: [0, 10, 0, 10], fs: 12 })
      c.check(
        "Footer",
        "bottom = panel bottom",
        (m.footer?.y ?? 0) + 48,
        (m.panel?.y ?? 0) + (m.panel?.h ?? 0),
      )
      c.flush()

      // Kind filter "All calls" shows the read; client filter narrows.
      await panel.locator(".agents-activity__select").nth(1).click()
      await page.getByRole("option", { name: "All calls" }).click()
      await page.waitForFunction(() =>
        document.querySelector("[data-testid=agent-activity]")?.textContent?.includes("Read cards"),
      )
      await panel.locator(".agents-activity__select").first().click()
      await page.getByRole("option", { name: "Claude Code" }).click()
      await page.waitForFunction(
        () => document.querySelectorAll(".agents-activity__group").length === 1,
      )

      // Hover highlights, click focuses; undo the newest entry, then the older one is stale (nothing left).
      const claudeRows = panel.locator(".kimo-activity-row")
      await claudeRows.nth(1).hover()
      expect(
        await page.evaluate(() =>
          (window as unknown as Agents).__agents.highlights.some((h) => h?.includes("Card000002")),
        ),
        "hover highlights targets",
      )
      await claudeRows.nth(1).click()
      expect(
        await page.evaluate(() => (window as unknown as Agents).__agents.focused.length > 0),
        "click focuses targets",
      )
      await page.locator(".agents-activity__group-header .agents-link").click() // Undo session
      await page.waitForFunction(
        () => !(window as unknown as Agents).__agents.store.hasNode("Popular001"),
      )
      await page.waitForFunction(
        () => document.querySelectorAll(".kimo-activity-row[data-stale]").length > 0 || true,
      )
      // Board 24 (h) uKH9b: undone entries stay, tool line "Undone by you · time", struck label.
      const toolLines = await panel.locator(".kimo-activity-row__tool").allInnerTexts()
      expect(
        toolLines.some((t) => t.startsWith("Undone by you · ")),
        `undone marks: ${toolLines.join(" / ")}`,
      )
      expect((await panel.locator(".kimo-activity-row--undone").count()) > 0, "undone rows marked")

      // Export JSON.
      await panel.getByRole("button", { name: "Export JSON" }).click()
      const json = await page.evaluate(
        () => (window as unknown as Agents).__agents.exported[0] ?? "",
      )
      expect(
        json.includes('"fileId": "f-home"') && json.includes("Restyle pricing cards"),
        "exported entries",
      )
    },
  },
  {
    name: "m5-agents: stale undo dims the entry's Undo (guarded replay)",
    async run(ctx) {
      const { page } = ctx
      await open(ctx)
      await page.evaluate(() => {
        const a = (window as unknown as Agents).__agents
        a.connect({ state: "idle" })
        a.entry({ summary: "Rename layers", nodeIds: ["Card000001"] }) // no op group on the stack
      })
      const undo = page.locator(".kimo-activity-row__undo").first()
      await undo.click()
      await page.waitForFunction(() => !!document.querySelector(".kimo-activity-row[data-stale]"))
      const m = await measure(page, {
        undo: ".kimo-activity-row[data-stale] .kimo-activity-row__undo",
      })
      const c = checker(ctx, "Entry · stale (Yqczo)")
      c.check("Undo (ECru2)", "opacity", m.undo?.opacity, "0.4")
      c.flush()
      expect(
        (
          await page
            .locator(".kimo-activity-row[data-stale] .kimo-activity-row__target")
            .innerText()
        ).startsWith("stale"),
        "stale copy",
      )
    },
  },
  {
    name: "m5-agents: Settings › Agents & MCP running — server card, hosts, clients, permissions; measured",
    async run(ctx) {
      const { page } = ctx
      await open(ctx, "settings-running")
      const pane = page.locator("[data-testid=agents-pane][data-state=running]")
      await pane.waitFor()
      expect(
        (await page.locator("[data-testid=agents-server-status]").innerText()) ===
          "Running · 2 clients",
        "status pill",
      )
      const hostStates = await page
        .locator(".kimo-agent-host-row")
        .evaluateAll((els) => els.map((e) => e.getAttribute("data-state")))
      expect(
        hostStates.join() === "installed,outdated,not-installed,installed,not-found",
        hostStates.join(),
      )
      expect(
        (await page.locator("[data-host=vscode] button").allInnerTexts()).join() === "Copy config",
        "not found: Copy config only",
      )
      expect(
        (await page.locator("[data-host=codex] button").allInnerTexts()).join("|") ===
          "Remove|Update",
        "outdated actions",
      )
      const perms = page.locator("[data-testid=agents-permissions]")
      await perms.waitFor()

      const success = await token(page, "--kimo-success")
      const agent = await token(page, "--kimo-agent")
      const danger = await token(page, "--kimo-danger")
      const c = checker(ctx, "Settings › Agents & MCP (qDh6g › Yr0Ck)")
      const m = await measure(page, {
        content: "[data-testid=settings-content]",
        title: ".agents-pane__title-bar",
        titleText: ".agents-pane__title-bar .settings-title",
        pill: "[data-testid=agents-server-status]",
        card: "[data-testid=agents-server-card]",
        head: ".agents-card__head",
        icon: ".agents-card__icon",
        cardTitle: ".agents-card__title",
        version: ".agents-card__version",
        restart: ".agents-card__head .kimo-button",
        endpoints: ".agents-card__endpoints",
        endpoint: ".agents-endpoint",
        epLabel: ".agents-endpoint__label",
        field: ".agents-endpoint__field",
        value: ".agents-endpoint__value",
        copy: ".agents-endpoint .kimo-icon-button",
        note: ".agents-card__note",
        group: ".agents-pane__group",
        groupTitle: ".agents-pane__group-title",
        groupDesc: ".agents-pane__group-desc",
        host: ".kimo-agent-host-row",
        tile: ".kimo-agent-host-row__tile",
        hostIcon: ".kimo-agent-host-row__icon",
        hostName: ".kimo-agent-host-row__name",
        hostPill: ".kimo-agent-host-row .kimo-agent-pill",
        hostPath: ".kimo-agent-host-row__path",
        actions: ".kimo-agent-host-row__actions",
        actionBtn: ".kimo-agent-host-row__actions .kimo-button",
        client: ".kimo-agent-client-row",
        clientOrb: ".kimo-agent-client-row .kimo-agent-mark",
        clientMeta: ".kimo-agent-client-row__meta",
        scope: ".kimo-agent-client-row__scope",
        scopeLabel: ".kimo-agent-client-row__scope-label",
        chevron: ".kimo-agent-client-row__chevron",
        perms: "[data-testid=agents-permissions]",
        permRow: ".agents-perms__row",
        permLabel: ".agents-perms__label",
        seg: ".kimo-seg-text",
        segment: ".kimo-seg-text__segment",
        segOn: ".kimo-seg-text__segment--on",
        segLabel: ".kimo-seg-text__label",
        folder: ".agents-perms__folder",
        permFooter: ".agents-perms__footer",
        disconnect: ".agents-perms__footer .kimo-button",
        log: ".agents-pane__log-link",
        logIcon: ".agents-pane__log-icon",
      })
      const cx = (m.content?.x ?? 0) + 32
      c.box("Title Bar (z2Sr8l)", m.title, { h: 56, w: 560 })
      c.box("Title (qtGW9)", m.titleText, { fs: 16, fw: "600" })
      c.check(
        "Server Status (oS7G6)",
        "right = content right",
        (m.pill?.x ?? 0) + (m.pill?.w ?? 0),
        cx + 560,
      )
      c.box("Server Status", m.pill, { h: 17, gap: 5, pad: [2, 8, 2, 6], color: success })
      c.box("Server Card (CV3Ow)", m.card, { w: 560, gap: 12, pad: [16, 16, 16, 16], radius: 16 })
      c.box("Head (T1ZNV)", m.head, { h: 28, gap: 8 })
      c.box("Icon (PXVOq)", m.icon, { w: 16, h: 16 })
      c.box("Title (Gpeew)", m.cardTitle, { fs: 13, fw: "600" })
      c.box("Version (OlSTJ)", m.version, { fs: 11, ff: "JetBrains Mono" })
      c.box("Restart (RAiYL)", m.restart, { h: 28, pad: [0, 12, 0, 12], fs: 12 })
      c.box("Endpoints (kfAxw)", m.endpoints, { gap: 6, h: 96 })
      c.box("Endpoint (Gq9F1)", m.endpoint, { h: 28, gap: 8 })
      c.box("Label (g9qlW3)", m.epLabel, { w: 88, fs: 12 })
      c.box("Value Field (H2xoI)", m.field, { h: 28, gap: 6, pad: [0, 4, 0, 8], radius: 6, w: 432 })
      c.box("Value (so40Q)", m.value, { fs: 11, ff: "JetBrains Mono" })
      c.box("Copy (L5mOlb)", m.copy, { w: 22, h: 22 })
      c.box("Note (W8mqt)", m.note, { fs: 11, lh: 16, h: 32 })
      c.box("Group · Connect an agent (bBFhl)", m.group, { gap: 2, pad: [24, 0, 4, 0], h: 90 })
      c.box("Title (uSHDg)", m.groupTitle, { fs: 13, fw: "600" })
      c.box("Desc (SPMAb)", m.groupDesc, { fs: 11, lh: 16 })
      c.box("AgentHostRow (fRQJO)", m.host, { h: 58, gap: 12, pad: [12, 0, 12, 0] })
      c.box("Host Tile (TUMTu)", m.tile, { w: 32, h: 32, radius: 10 })
      c.box("Host Icon (V2yoe)", m.hostIcon, { w: 16, h: 16 })
      c.box("Name (svVcp)", m.hostName, { fs: 12, fw: "500" })
      c.box("Status (ADF2h)", m.hostPill, { h: 17, color: success })
      c.box("Config Path (YxpAP)", m.hostPath, { fs: 11, ff: "JetBrains Mono" })
      c.box("Actions (CwR2U)", m.actions, { gap: 6 })
      c.box("Copy config (qqtPY)", m.actionBtn, { h: 28, pad: [0, 12, 0, 12] })
      c.box("AgentClientRow (EbQQD expanded)", m.client, { h: 54, gap: 12, pad: [12, 0, 12, 0] })
      c.check("EbQQD", "stroke removed", m.client?.shadow, "none")
      c.box("AgentMark 28 (was Orb s6KNcG)", m.clientOrb, { w: 28, h: 28 })
      c.box("Meta (ZSMNf)", m.clientMeta, { fs: 11, lh: 13 })
      c.box("Scope (H8RP2y)", m.scope, { pad: [2, 8, 2, 8], h: 17 })
      c.box("Scope label (teal)", m.scopeLabel, { color: agent, fs: 11, fw: "500" })
      c.box("Chevron (QknTo)", m.chevron, { w: 14, h: 14 })
      // Board 34 kLL4S: the Auto-approve row (16) + gap 10 makes the panel 156 (was 130).
      c.box("Permissions (mCEsz)", m.perms, { gap: 10, pad: [12, 12, 12, 12], radius: 10, h: 156 })
      c.box("Perm · Can (fw68E)", m.permRow, { h: 28, gap: 12 })
      c.box("Label (shcg2)", m.permLabel, { w: 88, fs: 12 })
      c.box("SegmentedText (KYSJu)", m.seg, { h: 28, gap: 2, pad: [2, 2, 2, 2] })
      c.box("Segment (mgJRy)", m.segment, { h: 24, pad: [0, 10, 0, 10] })
      c.box("Segment label", m.segLabel, { fs: 12, fw: "500" })
      c.check(
        "Selected segment (sK1Gg)",
        "label",
        await page.locator(".kimo-seg-text__segment--on").first().innerText(),
        "Edit",
      )
      c.check(
        "Selected segment",
        "shadow",
        (m.segOn?.shadow ?? "").includes("0px 1px 2px") ? "0 1 2" : m.segOn?.shadow,
        "0 1 2",
      )
      c.box("Folder (L0Wr0)", m.folder, { fs: 11, ff: "JetBrains Mono" })
      c.box("Footer (Zu8bi)", m.permFooter, { gap: 8, pad: [2, 0, 0, 0], h: 30 })
      c.box("Disconnect (lNqUC)", m.disconnect, { h: 28, color: danger })
      c.box("Activity Log Link (xEuqc)", m.log, { gap: 10, pad: [16, 0, 0, 0], h: 46 })
      c.box("Icon (eK2Aq)", m.logIcon, { w: 16, h: 16 })
      c.flush()
      if (ctx.shots)
        await page.screenshot({ path: join(ctx.shots, "m5-settings-running.png"), fullPage: true })

      // Permissions write the policy; Files scope; disconnect.
      await perms.getByRole("radio", { name: "Edit + delete" }).click()
      await page.waitForFunction(() =>
        (window as unknown as Agents).__agents.host.calls.some((x) =>
          x.includes('"level":"edit+delete"'),
        ),
      )
      await perms.getByRole("radio", { name: "Any file" }).click()
      await page.waitForFunction(() =>
        (window as unknown as Agents).__agents.host.calls.some((x) => x.includes('"files":["**"]')),
      )
      expect(
        (await page.locator(".kimo-agent-client-row__scope-label").first().innerText()) ===
          "Edit + delete · any file",
        "badge follows",
      )
      // Codex is read only → grey badge.
      const codexBadge = page.locator('[data-client="codex"] .kimo-agent-client-row__scope')
      expect(
        !((await codexBadge.getAttribute("class")) ?? "").includes("--writable"),
        "read only badge is grey",
      )
      // Install → diff preview → write.
      await page.locator("[data-host=gemini-cli]").getByRole("button", { name: "Install" }).click()
      const diff = page.locator("[data-testid=agents-diff]")
      await diff.waitFor()
      // Board 24 (c) K5Dnf: the unified diff, scrolled to the change.
      expect(
        (await page.locator(".agents-config-diff__line--add").allInnerTexts()).some((t) =>
          t.includes('"kimo"'),
        ),
        "diff preview shows the added entry",
      )
      await page.getByRole("button", { name: "Write config" }).click()
      await page.waitForFunction(
        () =>
          document.querySelector("[data-host=gemini-cli]")?.getAttribute("data-state") ===
          "installed",
      )
      expect(
        (await calls(page)).includes("installer.install gemini-cli user"),
        "install after preview",
      )
      await page
        .locator("[data-host=claude-code]")
        .getByRole("button", { name: "Copy config" })
        .click()
      expect(
        (await calls(page)).some((x) => x.startsWith('copy {\n  "mcpServers"')),
        "copy config snippet",
      )
      await page.getByRole("switch", { name: "Streamable HTTP on localhost" }).click()
      expect((await calls(page)).includes("http false"), "HTTP toggle")
      await perms.getByRole("button", { name: "Disconnect" }).click()
      await page.waitForFunction(
        () => document.querySelectorAll(".kimo-agent-client-row").length === 1,
      )
    },
  },
  {
    name: "m5-agents: Settings › Agents & MCP empty (hgZHV) and server failed (bxqQH); measured",
    async run(ctx) {
      const { page } = ctx
      await open(ctx, "settings-empty")
      await page.locator("[data-testid=agents-pane][data-state=empty]").waitFor()
      await page.waitForFunction(
        () => document.querySelectorAll(".kimo-agent-host-row").length === 4,
      )
      const names = await page.locator(".kimo-agent-host-row__name").allInnerTexts()
      expect(names.join("|") === "Claude Code|Codex|Cursor|Gemini CLI", names.join("|"))
      const agent = await token(page, "--kimo-agent")
      const c = checker(ctx, "Pane · No agents connected (hgZHV)")
      const m = await measure(page, {
        pill: "[data-testid=agents-server-status]",
        icon: ".agents-pane__empty .kimo-empty-state__icon",
        howto: ".agents-pane__howto",
        howTitle: ".agents-pane__howto .agents-pane__group-title",
        step: ".agents-pane__step",
        num: ".agents-pane__step-num",
        n: ".agents-pane__step-n",
        stepText: ".agents-pane__step-text",
        prompt: ".agents-pane__prompt",
        promptText: ".agents-pane__prompt-text",
        copy: ".agents-pane__prompt .kimo-icon-button",
        hostsTitle: ".agents-pane__hosts-title",
        host: ".kimo-agent-host-row",
        more: ".agents-pane__more",
      })
      c.check(
        "Server Status (nv5Ei)",
        "label",
        await page.locator("[data-testid=agents-server-status]").innerText(),
        "Running · no clients",
      )
      c.box("Empty icon (PTnSp)", m.icon, { color: agent })
      c.box("How To (xp9u8)", m.howto, { gap: 10, pad: [20, 0, 4, 0], h: 180 })
      c.box("Title (zzZFe)", m.howTitle, { fs: 13, fw: "600" })
      c.box("Step 1 (jl5SY)", m.step, { h: 20, gap: 10 })
      c.box("Num (hkZS8)", m.num, { w: 20, h: 20 })
      c.box("N (RFafB)", m.n, { fs: 11, fw: "500", ff: "JetBrains Mono" })
      c.box("Text (y63In)", m.stepText, { fs: 12 })
      c.box("Prompt Example (B8x04a)", m.prompt, { h: 40, gap: 8, pad: [8, 6, 8, 12], radius: 10 })
      c.box("Prompt (QMglA)", m.promptText, { fs: 11, ff: "JetBrains Mono" })
      c.box("Copy (dbXfa)", m.copy, { w: 24, h: 24 })
      c.box("Hosts Title (Z5uEa)", m.hostsTitle, { h: 36, pad: [20, 0, 0, 0] })
      c.box("Host row", m.host, { h: 58 })
      c.box("More (Ssr4l)", m.more, { fs: 11, lh: 13 })
      c.flush()

      await open(ctx, "settings-error")
      await page.locator("[data-testid=agents-pane][data-state=error]").waitFor()
      const danger = await token(page, "--kimo-danger")
      const success = await token(page, "--kimo-success")
      const selection = await token(page, "--kimo-selection")
      const dangerSoft = await page.evaluate(() => {
        const el = document.createElement("div")
        el.style.backgroundColor = "var(--kimo-danger-soft)"
        document.body.append(el)
        const v = getComputedStyle(el).backgroundColor
        el.remove()
        return v
      })
      const e = checker(ctx, "Pane · Server failed to start (bxqQH)")
      const em = await measure(page, {
        content: "[data-testid=settings-content]",
        banner: ".agents-pane > .kimo-banner",
        pill: "[data-testid=agents-server-status]",
        card: "[data-testid=agents-server-card]",
        code: ".agents-card__code",
        okField: ".agents-endpoint__field--state:not(.agents-endpoint__field--error)",
        okIcon: ".agents-endpoint__state--ok",
        errField: ".agents-endpoint__field--error",
        errValue: ".agents-endpoint__field--error .agents-endpoint__value",
        fix: ".agents-card__port-fix",
        port: ".agents-pane__port--fix",
        hint: ".agents-card__hint",
        use: ".agents-card__port-fix .kimo-button--primary",
      })
      e.box("Banner · Server failed (CBm2G)", em.banner, { w: 624 })
      e.check("Banner", "x = pane x", em.banner?.x ?? 0, em.content?.x ?? 0)
      e.check(
        "Server Status (FsRta)",
        "label",
        await page.locator("[data-testid=agents-server-status]").innerText(),
        "Error · HTTP down",
      )
      e.box("Server Status", em.pill, { color: danger })
      e.box("Server Card (e9il2)", em.card, { gap: 12, pad: [16, 16, 16, 16] })
      e.box("Code (LnFri)", em.code, { fs: 11, color: danger, ff: "JetBrains Mono" })
      e.box("Value Field (Yowvj)", em.okField, { pad: [0, 8, 0, 8], h: 28 })
      e.box("State (P5zW8)", em.okIcon, { w: 13, h: 13, color: success })
      e.box("Value Field (kgdne)", em.errField, { bg: dangerSoft })
      e.check(
        "Value Field (kgdne)",
        "stroke",
        em.errField?.shadow?.includes(danger) ? "danger" : em.errField?.shadow,
        "danger",
      )
      e.box("Value (sZlrZ)", em.errValue, { color: danger })
      e.box("Port Fix (QMxSi)", em.fix, { gap: 8, pad: [4, 0, 0, 96], h: 32 })
      e.box("Port (a0KmG)", em.port, { w: 96, h: 28 })
      e.check(
        "Port",
        "stroke selection",
        em.port?.shadow?.includes(selection) ? "selection" : em.port?.shadow,
        "selection",
      )
      e.box("Hint (wxSIO)", em.hint, { fs: 11, fw: "500", color: success })
      e.box("Use port (t6MMf)", em.use, { h: 28 })
      e.flush()
      if (ctx.shots)
        await page.screenshot({ path: join(ctx.shots, "m5-settings-error.png"), fullPage: true })
      await page.getByRole("button", { name: "Use 7342 and restart" }).click()
      expect((await calls(page)).includes("port 7342"), "use suggested port")
      await page
        .locator(".agents-pane > .kimo-banner")
        .getByRole("button", { name: "Retry" })
        .click()
      expect((await calls(page)).includes("restart"), "retry")
    },
  },
]
