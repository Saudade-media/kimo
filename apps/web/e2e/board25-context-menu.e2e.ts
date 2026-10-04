/**
 * Board 25 §3 (jWmmU): the canvas context menu for agent nodes in the real editor (m4-app
 * harness). Note → Convert to prompt; prompt → Run prompt · Set as target (pick mode: crosshair,
 * $agent outline, click sets / empty clears, Esc cancels); orphaned placeholder → grey "Agent
 * stopped" tag, Resume agent (reopens the owning session and continues) + Clear flag. Each menu
 * gets one measured pass (getComputedStyle + getBoundingClientRect vs the node values).
 */
import type { Page } from "playwright"
import { disk, harnessUrl, SITE } from "./m4-app.e2e"
import { type E2EContext, expect, type Scenario } from "./run"

type Box = { x: number; y: number; w: number; h: number }
type Kimo = {
  __kimoApp?: unknown
  __kimo?: {
    session: {
      store: {
        getNode(id: string): Record<string, unknown> | undefined
        nodeIds(): string[]
        apply(ops: unknown, o: { origin: string }): { ok: boolean }
      }
      ui: { getState(): { selection: string[]; select(ids: string[]): void } }
    }
    doc: { ref: string } | null
    agent?: {
      state: {
        session: { id: string } | null
        sessions: { thisFile: { id: string }[] }
        messages: unknown[]
      }
      searchSessions(q: string): void
    } | null
    canvas(): {
      renderer: unknown
      layout(): { nodes: Map<string, { world: Box }> } | null
      worldToScreen(p: { x: number; y: number }): { x: number; y: number }
      zoomToFit(ids?: readonly string[], padding?: number): void
    } | null
  }
}
declare const window: Kimo & Window

async function editor(ctx: E2EContext) {
  await ctx.page.setViewportSize({ width: 1440, height: 900 })
  await ctx.page.goto(`${await harnessUrl(ctx)}${disk(`${SITE}/home.kimo`)}`)
  await ctx.page.waitForFunction(() => !!(window as unknown as Kimo).__kimoApp)
  await ctx.page.locator(".kimo-desktop-topbar").waitFor({ timeout: 15_000 })
  await ctx.page.waitForFunction(
    () => !!window.__kimo?.session && !!window.__kimo.canvas()?.renderer,
    undefined,
    { timeout: 15_000 },
  )
}

/** Inserts root nodes far from the page content and fits the view to them. */
async function insert(page: Page, nodes: Record<string, Record<string, unknown>>) {
  await page.evaluate((ns) => {
    const s = window.__kimo?.session
    for (const [id, node] of Object.entries(ns))
      s?.store.apply({ op: "insert", id, node }, { origin: "user" })
  }, nodes)
  const ids = Object.keys(nodes)
  await page.waitForFunction(
    (xs) => xs.every((id) => !!window.__kimo?.canvas()?.layout()?.nodes.get(id)),
    ids,
  )
  await page.evaluate((xs) => window.__kimo?.canvas()?.zoomToFit(xs, 160), ids)
  await page.waitForTimeout(100)
}

/** Screen point (page px) inside node `id`: its center, or `fy` of its height. */
async function pointIn(page: Page, id: string, fx = 0.5, fy = 0.5) {
  const p = await page.evaluate(
    ({ id, fx, fy }) => {
      const c = window.__kimo?.canvas()
      const b = c?.layout()?.nodes.get(id)?.world
      if (!c || !b) return null
      return c.worldToScreen({ x: b.x + b.w * fx, y: b.y + b.h * fy })
    },
    { id, fx, fy },
  )
  expect(!!p, `${id} on screen`)
  return p as { x: number; y: number }
}

async function rightClick(page: Page, id: string, fy = 0.5) {
  const p = await pointIn(page, id, 0.5, fy)
  await page.locator(".editor__canvas").click({ button: "right", position: p })
  const menu = page.getByTestId("canvas-context-menu")
  await menu.waitFor({ timeout: 5_000 })
  return menu
}

const rows = (page: Page) =>
  page
    .getByTestId("canvas-context-menu")
    .evaluate((m) =>
      [...m.querySelectorAll<HTMLElement>(".kimo-menu-item-dense, .kimo-menu-divider")].map((e) =>
        e.classList.contains("kimo-menu-divider")
          ? "—"
          : [
              e.querySelector(".kimo-menu-item-dense__label")?.textContent ?? "",
              e.querySelector(".kimo-menu-item-dense__meta")?.textContent ?? "",
            ]
              .filter(Boolean)
              .join(" "),
      ),
    )

/** Resolves a token to the computed color string the browser uses. */
const token = (page: Page, name: string) =>
  page.evaluate((n) => {
    const el = document.createElement("span")
    el.style.color = `var(${n})`
    document.body.append(el)
    const c = getComputedStyle(el).color
    el.remove()
    return c
  }, name)
const tokenLen = (page: Page, name: string) =>
  page.evaluate((n) => {
    const el = document.createElement("span")
    el.style.borderRadius = `var(${n})`
    document.body.append(el)
    const c = getComputedStyle(el).borderTopLeftRadius
    el.remove()
    return c
  }, name)

type Diff = { what: string; design: string | number; got: string | number }
function check(diffs: Diff[], what: string, design: string | number, got: string | number) {
  const ok =
    typeof design === "number" && typeof got === "number"
      ? Math.abs(design - got) < 0.6
      : String(design) === String(got)
  if (!ok) diffs.push({ what, design, got })
}

/** One measured pass of the open menu against j8U4z / EAGNC / fYNDQ. */
async function measureMenu(page: Page, ctx: E2EContext, label: string) {
  const m = await page.getByTestId("canvas-context-menu").evaluate((menu) => {
    const cs = (e: Element | null) => (e ? getComputedStyle(e) : null)
    const r = (e: Element | null) => e?.getBoundingClientRect() ?? null
    const items = menu.querySelector(".kimo-menu-dense__items")
    const rowsEls = [...menu.querySelectorAll<HTMLElement>(".kimo-menu-item-dense")]
    const agent = rowsEls.find((e) => e.className.includes("kimo-canvas-menu__item--agent"))
    const plain = rowsEls.find((e) => !e.className.includes("kimo-canvas-menu__item--"))
    const danger = rowsEls.find((e) => e.className.includes("kimo-canvas-menu__item--danger"))
    const divider = menu.querySelector(".kimo-menu-divider")
    const line = menu.querySelector(".kimo-menu-divider__line")
    const meta = plain?.querySelector(".kimo-menu-item-dense__meta") ?? null
    const slot = agent?.querySelector(".kimo-menu-item-dense__check") ?? null
    const icon = slot?.querySelector("svg, .kimo-agent-mark") ?? null
    return {
      w: r(menu)?.width ?? 0,
      padding: cs(menu)?.padding,
      radius: cs(menu)?.borderTopLeftRadius,
      bg: cs(menu)?.backgroundColor,
      shadow: cs(menu)?.boxShadow,
      gap: cs(items)?.rowGap,
      rowH: r(plain ?? null)?.height ?? 0,
      rowW: r(plain ?? null)?.width ?? 0,
      rowPad: cs(plain ?? null)?.padding,
      rowGap: cs(plain ?? null)?.columnGap,
      rowRadius: cs(plain ?? null)?.borderTopLeftRadius,
      slotW: r(slot)?.width ?? 0,
      slotH: r(slot)?.height ?? 0,
      iconW: r(icon)?.width ?? 0,
      iconColor: icon?.tagName === "svg" ? cs(slot)?.color : null,
      agentWeight: cs(agent?.querySelector(".kimo-menu-item-dense__label") ?? null)?.fontWeight,
      agentSize: cs(agent?.querySelector(".kimo-menu-item-dense__label") ?? null)?.fontSize,
      plainWeight: cs(plain?.querySelector(".kimo-menu-item-dense__label") ?? null)?.fontWeight,
      plainColor: cs(plain?.querySelector(".kimo-menu-item-dense__label") ?? null)?.color,
      dangerColor: cs(danger?.querySelector(".kimo-menu-item-dense__label") ?? null)?.color,
      metaFamily: cs(meta)?.fontFamily,
      metaSize: cs(meta)?.fontSize,
      metaColor: cs(meta)?.color,
      dividerH: r(divider)?.height ?? 0,
      dividerPad: cs(divider)?.padding,
      lineH: r(line)?.height ?? 0,
      lineColor: cs(line)?.backgroundColor,
    }
  })
  const d: Diff[] = []
  check(d, "menu width (j8U4z 236)", 236, m.w)
  check(d, "menu padding (4)", "4px", m.padding ?? "")
  check(d, "menu radius ($radius-lg)", await tokenLen(page, "--kimo-radius-lg"), m.radius ?? "")
  check(d, "menu fill ($bg-overlay)", await token(page, "--kimo-bg-overlay"), m.bg ?? "")
  check(d, "menu gap (1)", "1px", m.gap ?? "")
  check(d, "row height (EAGNC 28)", 28, m.rowH)
  check(d, "row width (fill 228)", 228, m.rowW)
  check(d, "row padding ([0,8])", "0px 8px", m.rowPad ?? "")
  check(d, "row gap (8)", "8px", m.rowGap ?? "")
  check(d, "row radius ($radius-sm)", await tokenLen(page, "--kimo-radius-sm"), m.rowRadius ?? "")
  check(d, "check slot (Hl922 14)", 14, m.slotW)
  check(d, "check slot h (14)", 14, m.slotH)
  if (m.iconColor !== null) {
    check(d, "agent icon (RmOTH 14)", 14, m.iconW)
    check(d, "agent icon fill ($agent)", await token(page, "--kimo-agent"), m.iconColor ?? "")
  } else check(d, "AgentMark (nN0TD 12)", 12, m.iconW)
  check(d, "agent label weight (500)", "500", m.agentWeight ?? "")
  check(d, "label size ($text-sm 12)", "12px", m.agentSize ?? "")
  check(d, "standard label weight (normal)", "400", m.plainWeight ?? "")
  check(
    d,
    "standard label ($text-primary)",
    await token(page, "--kimo-text-primary"),
    m.plainColor ?? "",
  )
  check(d, "Delete label ($danger)", await token(page, "--kimo-danger"), m.dangerColor ?? "")
  check(d, "meta size ($text-xs 11)", "11px", m.metaSize ?? "")
  check(d, "meta ($text-tertiary)", await token(page, "--kimo-text-tertiary"), m.metaColor ?? "")
  check(d, "meta font (mono)", true as unknown as string, String(/mono/i.test(m.metaFamily ?? "")))
  check(d, "divider height (fYNDQ 9)", 9, m.dividerH)
  check(d, "divider padding ([4,8])", "4px 8px", m.dividerPad ?? "")
  check(d, "divider line (1)", 1, m.lineH)
  check(d, "divider line ($border)", await token(page, "--kimo-border"), m.lineColor ?? "")
  ctx.log(`measured ${label}: ${d.length === 0 ? "no diffs" : JSON.stringify(d)}`)
  expect(d.length === 0, `${label} measured diffs: ${JSON.stringify(d)}`)
}

async function shot(ctx: E2EContext, name: string) {
  if (ctx.shots) await ctx.page.screenshot({ path: `${ctx.shots}/board25-${name}.png` })
}

export const scenarios: Scenario[] = [
  {
    name: "board25 §3 (a): note → Convert to prompt first, then the standard items (measured)",
    async run(ctx) {
      const { page } = ctx
      await editor(ctx)
      await insert(page, {
        Note25aaaa: {
          type: "note",
          content: "Hero needs a warmer palette",
          x: 4000,
          y: 4000,
          w: 240,
        },
      })
      await rightClick(page, "Note25aaaa", 0.3)
      expect(
        JSON.stringify(await rows(page)) ===
          JSON.stringify([
            "Convert to prompt",
            "—",
            "Duplicate ⌘D",
            "Bring to front",
            "Lock",
            "—",
            "Delete ⌫",
          ]),
        `note rows ${JSON.stringify(await rows(page))}`,
      )
      await measureMenu(page, ctx, "note menu")
      await shot(ctx, "menu-note")
      await page.getByRole("menuitem", { name: "Convert to prompt" }).click()
      await page.waitForFunction(
        () => window.__kimo?.session.store.getNode("Note25aaaa")?.type === "prompt",
      )
      expect((await page.getByTestId("canvas-context-menu").count()) === 0, "menu closed")
    },
  },
  {
    name: "board25 §3 (b): prompt → Run prompt · Set as target pick mode (crosshair, $agent outline, Esc, empty clears)",
    async run(ctx) {
      const { page } = ctx
      await editor(ctx)
      await insert(page, {
        Pricing25b: { type: "frame", name: "Pricing", x: 4000, y: 4000, w: 400, h: 300 },
        Prompt25bb: { type: "prompt", content: "Draft 3 pricing cards", x: 4500, y: 4000, w: 260 },
      })
      await rightClick(page, "Prompt25bb", 0.2)
      expect(
        JSON.stringify(await rows(page)) ===
          JSON.stringify([
            "Run prompt",
            "Set as target —",
            "—",
            "Duplicate ⌘D",
            "Bring to front",
            "Lock",
            "—",
            "Delete ⌫",
          ]),
        `prompt rows ${JSON.stringify(await rows(page))}`,
      )
      await measureMenu(page, ctx, "prompt menu")
      await shot(ctx, "menu-prompt")
      await page.getByRole("menuitem", { name: /Set as target/ }).click()
      const canvas = page.locator(".editor__canvas")
      await page.waitForFunction(() =>
        document.querySelector(".editor__canvas")?.classList.contains("editor__canvas--picking"),
      )
      // Hover the frame: crosshair + a 1.5 $agent outline on the frame's screen box.
      const inside = await pointIn(page, "Pricing25b")
      await canvas.hover({ position: inside })
      const outline = page.getByTestId("target-pick-outline")
      await outline.waitFor()
      const measured = await outline.evaluate((e) => {
        const cs = getComputedStyle(e)
        const r = e.getBoundingClientRect()
        const host = document.querySelector(".editor__canvas")?.getBoundingClientRect()
        return {
          id: e.getAttribute("data-node-id"),
          color: /^(rgba?\([^)]*\))/.exec(cs.boxShadow)?.[1] ?? cs.boxShadow,
          width: /0px 0px 0px (\S+)/.exec(cs.boxShadow)?.[1] ?? "",
          x: r.x - (host?.x ?? 0),
          y: r.y - (host?.y ?? 0),
          w: r.width,
          h: r.height,
          cursor: getComputedStyle(document.querySelector(".editor__canvas canvas") ?? e).cursor,
        }
      })
      const frame = await page.evaluate(() => {
        const c = window.__kimo?.canvas()
        const b = c?.layout()?.nodes.get("Pricing25b")?.world
        if (!c || !b) return null
        const a = c.worldToScreen({ x: b.x, y: b.y })
        const z = c.worldToScreen({ x: b.x + b.w, y: b.y + b.h })
        return { x: a.x, y: a.y, w: z.x - a.x, h: z.y - a.y }
      })
      const d: Diff[] = []
      check(d, "outline node", "Pricing25b", measured.id ?? "")
      check(d, "outline color ($agent)", await token(page, "--kimo-agent"), measured.color)
      check(d, "outline width (1.5)", "1.5px", measured.width)
      check(d, "outline x", frame?.x ?? -1, measured.x)
      check(d, "outline y", frame?.y ?? -1, measured.y)
      check(d, "outline w", frame?.w ?? -1, measured.w)
      check(d, "outline h", frame?.h ?? -1, measured.h)
      check(d, "cursor", "crosshair", measured.cursor)
      ctx.log(`measured pick mode: ${d.length === 0 ? "no diffs" : JSON.stringify(d)}`)
      expect(d.length === 0, `pick mode diffs ${JSON.stringify(d)}`)
      await shot(ctx, "pick-mode")
      await canvas.click({ position: inside })
      await page.waitForFunction(
        () => window.__kimo?.session.store.getNode("Prompt25bb")?.target === "Pricing25b",
      )
      expect(
        !(await canvas.evaluate((e) => e.classList.contains("editor__canvas--picking"))),
        "pick mode ends after a click",
      )
      // The click picked; it did not select the frame.
      expect(
        !(await page.evaluate(() =>
          window.__kimo?.session.ui.getState().selection.includes("Pricing25b"),
        )),
        "frame not selected by the pick click",
      )
      // Meta shows the current target.
      await rightClick(page, "Prompt25bb", 0.2)
      expect((await rows(page)).includes("Set as target Pricing"), "meta = target name")
      // Esc cancels (target unchanged, selection kept).
      await page.getByRole("menuitem", { name: /Set as target/ }).click()
      await page.waitForFunction(() =>
        document.querySelector(".editor__canvas")?.classList.contains("editor__canvas--picking"),
      )
      await page.keyboard.press("Escape")
      await page.waitForFunction(
        () =>
          !document.querySelector(".editor__canvas")?.classList.contains("editor__canvas--picking"),
      )
      expect(
        (await page.evaluate(() => window.__kimo?.session.store.getNode("Prompt25bb")?.target)) ===
          "Pricing25b",
        "Esc keeps the target",
      )
      expect(
        (await page.evaluate(() => window.__kimo?.session.ui.getState().selection.join())) ===
          "Prompt25bb",
        "Esc in pick mode does not deselect",
      )
      // Clicking empty canvas clears the target.
      await rightClick(page, "Prompt25bb", 0.2)
      await page.getByRole("menuitem", { name: /Set as target/ }).click()
      const empty = await pointIn(page, "Pricing25b", 0.5, 1.6)
      await canvas.click({ position: empty })
      await page.waitForFunction(
        () => window.__kimo?.session.store.getNode("Prompt25bb")?.target === undefined,
      )
    },
  },
  {
    name: "board25 §3 (c): orphaned placeholder → grey 'Agent stopped' tag, Resume agent reopens its session, Clear flag",
    async run(ctx) {
      const { page } = ctx
      await editor(ctx)
      await page.waitForFunction(() => !!window.__kimo?.agent, undefined, { timeout: 10_000 })
      // A saved session of this file (sha256(path)[:16]) that owned the placeholder.
      await page.evaluate(async () => {
        const ref = window.__kimo?.doc?.ref ?? ""
        const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ref))
        const fileId = [...new Uint8Array(h)]
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("")
          .slice(0, 16)
        const session = {
          id: "e2eres",
          fileId,
          fileName: "home.kimo",
          title: "Pricing cards",
          createdAt: 1,
          updatedAt: 2,
          model: { provider: "anthropic", model: "claude-opus-5-5" },
          thinking: "auto",
          mode: { mode: "single" },
          origin: "panel",
          enabledSkills: ["kimo-design"],
          messageCount: 0,
          usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
          costUsd: 0,
          billing: "api",
          turns: [],
        }
        await new Promise<void>((resolve, reject) => {
          const req = indexedDB.open("kimo-sessions", 1)
          req.onupgradeneeded = () => {
            const s = req.result.createObjectStore("sessions", { keyPath: "id" })
            s.createIndex("fileId", "fileId")
          }
          req.onsuccess = () => {
            const tx = req.result.transaction("sessions", "readwrite")
            tx.objectStore("sessions").put(session)
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error)
          }
          req.onerror = () => reject(req.error)
        })
        window.__kimo?.agent?.searchSessions("")
      })
      await page.waitForFunction(() =>
        window.__kimo?.agent?.state.sessions.thisFile.some((s) => s.id === "e2eres"),
      )
      await insert(page, {
        Orphan25cc: {
          type: "frame",
          name: "Pricing",
          x: 4000,
          y: 4000,
          w: 420,
          h: 150,
          placeholder: { by: "agent:kimo.e2eres.0", since: "2026-10-04T00:00:00.000Z" },
        },
        Gone25cccc: {
          type: "frame",
          name: "Hero",
          x: 4000,
          y: 4300,
          w: 420,
          h: 150,
          placeholder: { by: "agent:kimo.deleted.0", since: "2026-10-04T00:00:00.000Z" },
        },
      })
      // Tag (UMRAO iyhUZ): bg-muted, unplug 11 text-secondary, "Agent stopped · Pricing".
      const tag = page.locator('[data-testid="placeholder-tag"][data-node-id="Orphan25cc"]')
      await tag.waitFor()
      const t = await tag.evaluate((e) => {
        const cs = getComputedStyle(e)
        const svg = e.querySelector("svg")
        const label = e.querySelector(".agent-canvas__tag-label")
        return {
          text: label?.textContent,
          bg: cs.backgroundColor,
          h: e.getBoundingClientRect().height,
          gap: cs.columnGap,
          pad: cs.padding,
          icon: svg?.getAttribute("class") ?? "",
          iconW: svg?.getBoundingClientRect().width ?? 0,
          iconColor: svg ? getComputedStyle(svg).color : "",
          labelColor: label ? getComputedStyle(label).color : "",
          labelSize: label ? getComputedStyle(label).fontSize : "",
          labelWeight: label ? getComputedStyle(label).fontWeight : "",
        }
      })
      const d: Diff[] = []
      check(d, "tag label", "Agent stopped · Pricing", t.text ?? "")
      check(d, "tag fill ($bg-muted)", await token(page, "--kimo-bg-muted"), t.bg)
      check(d, "tag height (20)", 20, t.h)
      check(d, "tag gap (4)", "4px", t.gap)
      check(d, "tag padding ([0,7,0,5])", "0px 7px 0px 5px", t.pad)
      check(d, "tag icon (unplug)", true as unknown as string, String(/unplug/.test(t.icon)))
      check(d, "tag icon size (11)", 11, t.iconW)
      check(
        d,
        "tag icon ($text-secondary)",
        await token(page, "--kimo-text-secondary"),
        t.iconColor,
      )
      check(
        d,
        "tag label ($text-secondary)",
        await token(page, "--kimo-text-secondary"),
        t.labelColor,
      )
      check(d, "tag label size ($text-xs)", "11px", t.labelSize)
      check(d, "tag label weight (500)", "500", t.labelWeight)
      ctx.log(`measured orphan tag: ${d.length === 0 ? "no diffs" : JSON.stringify(d)}`)
      expect(d.length === 0, `orphan tag diffs ${JSON.stringify(d)}`)

      await rightClick(page, "Orphan25cc", 0.6)
      expect(
        JSON.stringify(await rows(page)) ===
          JSON.stringify([
            "Resume agent session 1",
            "Clear flag",
            "—",
            "Duplicate ⌘D",
            "Bring to front",
            "Lock",
            "—",
            "Delete ⌫",
          ]),
        `orphan rows ${JSON.stringify(await rows(page))}`,
      )
      await measureMenu(page, ctx, "orphan menu")
      const resume = await page.getByRole("menuitem", { name: /Resume agent/ }).evaluate((e) => {
        const meta = e.querySelector(".kimo-menu-item-dense__meta")
        const mark = e.querySelector(".kimo-agent-mark")
        return {
          mark: mark?.getBoundingClientRect().width ?? 0,
          metaFamily: meta ? getComputedStyle(meta).fontFamily : "",
        }
      })
      expect(resume.mark === 12, `AgentMark 12 (${resume.mark})`)
      expect(!/mono/i.test(resume.metaFamily), `'session 1' meta is sans (${resume.metaFamily})`)
      await shot(ctx, "menu-orphan")
      await page.getByRole("menuitem", { name: /Resume agent/ }).click()
      // The Agent tab opens on the owning session and the continuation is sent.
      await page.waitForFunction(() => window.__kimo?.agent?.state.session?.id === "e2eres")
      await page.getByRole("tab", { name: "Agent", selected: true }).waitFor({ timeout: 5_000 })
      await page
        .getByText(/Continue building Pricing/)
        .first()
        .waitFor({ timeout: 10_000 })

      // A deleted session: "Ask Kimo to finish" replaces Resume; it prefills the composer.
      await rightClick(page, "Gone25cccc", 0.6)
      expect(
        (await rows(page))[0] === "Ask Kimo to finish",
        `gone rows ${JSON.stringify(await rows(page))}`,
      )
      await page.keyboard.press("Escape")
      // Clear flag drops the placeholder state, keeps the frame.
      await rightClick(page, "Gone25cccc", 0.6)
      await page.getByRole("menuitem", { name: "Clear flag" }).click()
      await page.waitForFunction(
        () => window.__kimo?.session.store.getNode("Gone25cccc")?.placeholder === undefined,
      )
      await page
        .locator('[data-testid="placeholder-tag"][data-node-id="Gone25cccc"]')
        .waitFor({ state: "detached", timeout: 5_000 })
    },
  },
  {
    name: "board25 §3: standard items — Bring to front, Lock / Unlock, Duplicate, Delete",
    async run(ctx) {
      const { page } = ctx
      await editor(ctx)
      await insert(page, {
        Back25dddd: { type: "frame", name: "Back", x: 4000, y: 4000, w: 200, h: 200 },
        Front25ddd: { type: "frame", name: "Front", x: 4300, y: 4000, w: 200, h: 200 },
      })
      const roots = () =>
        page.evaluate(
          () =>
            (
              window.__kimo?.session.store as unknown as { children(p: null): string[] } | undefined
            )?.children(null) ?? [],
        )
      await rightClick(page, "Back25dddd")
      await page.getByRole("menuitem", { name: "Bring to front" }).click()
      await page.waitForFunction(() => {
        const store = window.__kimo?.session.store as unknown as
          | { children(p: null): string[] }
          | undefined
        return store?.children(null).at(-1) === "Back25dddd"
      })
      expect((await roots()).at(-1) === "Back25dddd", "back is last (on top)")
      await rightClick(page, "Back25dddd")
      await page.getByRole("menuitem", { name: "Lock" }).click()
      await page.waitForFunction(
        () => window.__kimo?.session.store.getNode("Back25dddd")?.locked === true,
      )
      await rightClick(page, "Front25ddd")
      await page.getByRole("menuitem", { name: /Duplicate/ }).click()
      await page.waitForFunction(
        () =>
          (window.__kimo?.session.store.nodeIds() ?? []).filter(
            (id) => window.__kimo?.session.store.getNode(id)?.name === "Front",
          ).length === 2,
      )
      await rightClick(page, "Front25ddd")
      await page.getByRole("menuitem", { name: /Delete/ }).click()
      await page.waitForFunction(() => !window.__kimo?.session.store.getNode("Front25ddd"))
    },
  },
]
