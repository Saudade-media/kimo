/**
 * Board 41 "Multiplayer" (desing.pen kCAYr) on the canvas, measured against the nodes:
 *
 * - section 6: a remote cursor (`F6KWF9`: pointer 18, gap 2, pill padding [4, 10] radius 999
 *   in the presence color, label 12 / 500), a remote selection (`p4Yz5` 1.5 px, tag `J5RJD9`
 *   18 above, radius 3 3 3 0, padding [1, 5]), an off-screen pill (`h065n` 8 px inside the
 *   edges, arrow-down-right), following (`i9PNJ` 2 px frame, `Z48EHk` chip 12 from the top,
 *   centered, padding [4, 10, 4, 8]), Esc stops it, Show other cursors off hides cursors;
 * - section 7: one claim outline (1 px persona hue) and flush tab (radius 0 0 6 0, padding
 *   [3, 8, 3, 4]) per agent, the owner on another person's agent and its cursor on the area's
 *   center, a paused agent in warning with its note 6 px right of the outline (136 wide, padding
 *   [8, 10]); Resume now and Stop reach the backend;
 * - section 8: the fetching placeholder (checkerboard, chip 10 from the left and 10 above the
 *   3 px bar), not available yet (image-off, no bar), and a missing image in view is fetched;
 * - section 7 C: the AREA_BUSY card (`WfdMv`) in the Agent tab from a real AREA_BUSY envelope,
 *   Wait → Stop waiting and "Waiting for Hero", then "Hero is free · continuing";
 * - section 10: dark tokens on the cursor, claim tab and card.
 */
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import type { Page } from "playwright"
import { build } from "vite"
import { type E2EContext, expect, type Scenario } from "./run"

const here = fileURLToPath(new URL(".", import.meta.url))
let built: Promise<string> | null = null

async function harnessUrl(ctx: E2EContext): Promise<string> {
  if (process.env.KIMO_E2E_DEV === "1") return `${ctx.url}e2e/board41-canvas-harness/index.html`
  built ??= build({
    root: join(here, "board41-canvas-harness"),
    configFile: false,
    base: "./",
    logLevel: "error",
    plugins: [react()],
    build: {
      outDir: join(process.env.KIMO_E2E_OUTDIR ?? join(here, ".dist"), "board41-canvas"),
      emptyOutDir: true,
      target: "es2022",
    },
  }).then(() => "board41-canvas/index.html")
  return `${ctx.url}${await built}`
}

type Box = { x: number; y: number; w: number; h: number }
const near = (a: number, b: number, tol = 0.6) => Math.abs(a - b) <= tol
const nearBox = (a: Box, b: Box, tol = 0.6) =>
  near(a.x, b.x, tol) && near(a.y, b.y, tol) && near(a.w, b.w, tol) && near(a.h, b.h, tol)

const HOLDER_KIMO = "agent:kimo.s1abc.0"
const HOLDER_AGENT2 = "agent:kimo.s1abc.1"
const HOLDER_SOL = "agent:kimo.m9x2.3"

/** The computed rgb of a design token. */
function token(page: Page, name: string) {
  return page.evaluate((n) => {
    const probe = document.createElement("div")
    probe.style.color = `var(--kimo-${n})`
    document.body.append(probe)
    const c = getComputedStyle(probe).color
    probe.remove()
    return c
  }, name)
}

async function openEditor(ctx: E2EContext, theme: "light" | "dark") {
  const { page } = ctx
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${await harnessUrl(ctx)}?kimo-debug&theme=${theme}`)
  await page.waitForFunction(() => !!(window as unknown as { __mp?: unknown }).__mp)
  const file = await page.evaluate(
    () => (window as unknown as { __mp: { FILE: string } }).__mp.FILE,
  )
  await page.evaluate((f) => {
    location.hash = `#/disk/${encodeURIComponent(f)}`
  }, file)
  await page.locator('.canvas-host[data-ready="true"]').waitFor({ timeout: 30_000 })
  // Landing at (100, 50) on screen, 100 %.
  await page.evaluate(() => {
    const k = (
      window as unknown as {
        __kimo: { session: { ui: { getState(): { setViewport(v: unknown): void } } } }
      }
    ).__kimo
    k.session.ui.getState().setViewport({ x: -100, y: -50, zoom: 1 })
  })
  const now = Date.now()
  await page.evaluate(
    ([kimo, agent2, sol, t]) => {
      const mp = (window as unknown as { __mp: { set(p: unknown): void } }).__mp
      const user = (id: string, name: string, color: string) => ({ id, name, color })
      mp.set({
        room: "room1",
        relayUrl: "https://relay.maya.studio",
        owner: true,
        role: "edit",
        status: "synced",
        self: 1,
        selfState: { user: user("me", "Gui", "presence-slate"), origin: "user", owner: true },
        peers: [
          {
            peer: 2,
            role: "edit",
            origin: "user",
            changedAt: t,
            state: {
              user: user("maya", "Maya", "presence-clay"),
              origin: "user",
              cursor: { x: 300, y: 150 },
              selection: ["Feature002"],
              viewport: { x: 0, y: 0, w: 560, h: 444, zoom: 1 },
              claims: [
                { holder: sol, ids: ["Pricing001"], since: t - 120_000, renewed: t, label: "Sol" },
              ],
            },
          },
          {
            peer: 3,
            role: "edit",
            origin: "user",
            changedAt: t,
            state: {
              user: user("jonas", "Jonas", "presence-pine"),
              origin: "user",
              cursor: { x: 5000, y: 5000 },
            },
          },
        ],
        claims: [
          {
            holder: kimo,
            ids: ["Hero000001"],
            since: t,
            renewed: t,
            label: "Kimo",
            local: true,
            expiresAt: t + 600_000,
            state: "live",
          },
          {
            holder: agent2,
            ids: ["Features01"],
            since: t,
            renewed: t,
            label: "Agent 2",
            local: true,
            expiresAt: t + 600_000,
            state: "live",
          },
          {
            holder: sol,
            ids: ["Pricing001"],
            since: t - 120_000,
            renewed: t,
            label: "Sol",
            local: false,
            peer: 2,
            expiresAt: t + 600_000,
            state: "live",
          },
        ],
        paused: [
          {
            holder: agent2,
            label: "Agent 2",
            ids: ["Feature002"],
            by: "local",
            pausedAt: t,
            resumesAt: t + 10_000,
          },
        ],
        assets: {
          uploading: [],
          fetching: [{ key: "0123456789abcdef.png", bytes: 3_400_000 }],
          unavailable: ["0123456789abcde1.png"],
          failed: [],
        },
      })
    },
    [HOLDER_KIMO, HOLDER_AGENT2, HOLDER_SOL, now] as const,
  )
  await page.locator('[data-testid="mp-cursor"]').first().waitFor({ timeout: 10_000 })
}

function measureEditor(page: Page) {
  return page.evaluate(() => {
    const host = (document.querySelector(".canvas-host") as HTMLElement).getBoundingClientRect()
    const rel = (e: Element | null): Box | null => {
      if (!e) return null
      const r = e.getBoundingClientRect()
      return { x: r.x - host.x, y: r.y - host.y, w: r.width, h: r.height }
    }
    const cs = (e: Element | null) => (e ? getComputedStyle(e) : null)
    const q = (s: string) => document.querySelector(s)
    const cursor = [...document.querySelectorAll('[data-testid="mp-cursor"]')].find(
      (e) => (e as HTMLElement).style.display !== "none",
    )
    const pill = cursor?.querySelector(".mp-cursor__pill") ?? null
    const pointer = cursor?.querySelector(".mp-cursor__pointer svg") ?? null
    const label = cursor?.querySelector(".mp-cursor__label") ?? null
    const sel = q('[data-testid="mp-remote-selection"]')
    const tag = q('[data-testid="mp-selection-tag"]')
    const off = [...document.querySelectorAll('[data-testid="mp-offscreen"]')].find(
      (e) => (e as HTMLElement).style.display !== "none",
    )
    const claim = (holder: string) => {
      const o = q(`[data-testid="mp-claim-outline"][data-holder="${holder}"]`)
      const t = q(`[data-testid="mp-claim-tag"][data-holder="${holder}"]`)
      return {
        outline: rel(o),
        shadow: cs(o)?.boxShadow ?? "",
        tag: rel(t),
        tagText: t?.textContent ?? "",
        tagBg: cs(t)?.backgroundColor ?? "",
        tagRadius: cs(t)?.borderRadius ?? "",
        tagPadding: cs(t)?.padding ?? "",
        tagGap: cs(t)?.gap ?? "",
        tagLabelColor: cs(t?.querySelector(".mp-claim__tag-label") ?? null)?.color ?? "",
        tagFont: (() => {
          const l = cs(t?.querySelector(".mp-claim__tag-label") ?? null)
          return l ? `${l.fontSize} ${l.fontWeight}` : ""
        })(),
      }
    }
    const note = q('[data-testid="mp-paused-note"]')
    const placeholders = [...document.querySelectorAll('[data-testid="mp-asset-placeholder"]')].map(
      (e) => {
        const status = e.querySelector('[data-testid="mp-asset-status"]')
        const track = e.querySelector('[data-testid="mp-asset-track"]')
        return {
          node: e.getAttribute("data-node-id"),
          state: e.getAttribute("data-state"),
          box: rel(e),
          bg: cs(e)?.backgroundColor ?? "",
          image: cs(e)?.backgroundImage ?? "",
          size: cs(e)?.backgroundSize ?? "",
          status: rel(status),
          statusText: status?.textContent ?? "",
          statusPadding: cs(status)?.padding ?? "",
          statusFont: cs(status?.querySelector(".mp-asset__label") ?? null)?.fontFamily ?? "",
          track: rel(track),
        }
      },
    )
    const agentCursors = [...document.querySelectorAll('[data-testid="agent-cursor"]')].map(
      (e) => ({
        origin: e.getAttribute("data-origin"),
        box: rel(e),
        label: e.querySelector(".agent-section__label")?.textContent ?? "",
      }),
    )
    return {
      host: { w: host.width, h: host.height },
      cursor: cursor
        ? {
            box: rel(cursor) as Box,
            pill: rel(pill) as Box,
            pointer: rel(pointer) as Box,
            label: label?.textContent ?? "",
            pillBg: cs(pill)?.backgroundColor ?? "",
            pillRadius: cs(pill)?.borderRadius ?? "",
            pillPadding: cs(pill)?.padding ?? "",
            pillShadow: cs(pill)?.boxShadow ?? "",
            font: `${cs(label)?.fontSize} ${cs(label)?.fontWeight}`,
            pointerColor: cs(cursor.querySelector(".mp-cursor__pointer"))?.color ?? "",
            display: cs(cursor)?.display ?? "",
          }
        : null,
      cursors: document.querySelectorAll('[data-testid="mp-cursor"]').length,
      selection: sel ? { box: rel(sel) as Box, shadow: cs(sel)?.boxShadow ?? "" } : null,
      tag: tag
        ? {
            box: rel(tag) as Box,
            radius: cs(tag)?.borderRadius ?? "",
            padding: cs(tag)?.padding ?? "",
            bg: cs(tag)?.backgroundColor ?? "",
            text: tag.textContent ?? "",
          }
        : null,
      offscreen: off
        ? {
            box: rel(off) as Box,
            arrow: off.getAttribute("data-arrow"),
            padding: cs(off)?.padding ?? "",
            text: off.textContent ?? "",
          }
        : null,
      kimo: claim("agent:kimo.s1abc.0"),
      agent2: claim("agent:kimo.s1abc.1"),
      sol: claim("agent:kimo.m9x2.3"),
      note: note
        ? {
            box: rel(note) as Box,
            padding: cs(note)?.padding ?? "",
            radius: cs(note)?.borderRadius ?? "",
            bg: cs(note)?.backgroundColor ?? "",
            gap: cs(note)?.gap ?? "",
            text: (note as HTMLElement).innerText,
          }
        : null,
      sectionOutlines: document.querySelectorAll('[data-testid="agent-section-outline"]').length,
      agentCursors,
      placeholders,
      follow: (() => {
        const f = q('[data-testid="mp-follow-frame"]')
        const c = q('[data-testid="mp-follow-chip"]')
        return f && c
          ? {
              frame: rel(f) as Box,
              shadow: cs(f)?.boxShadow ?? "",
              chip: rel(c) as Box,
              chipPadding: cs(c)?.padding ?? "",
              chipBg: cs(c)?.backgroundColor ?? "",
              text: (c as HTMLElement).innerText,
            }
          : null
      })(),
    }
  })
}

const calls = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __mp: { calls: { op: string; args: unknown[] }[] } }).__mp.calls,
  )

export const scenarios: Scenario[] = [
  {
    name: "board41 canvas: cursors, remote selection, off-screen, follow, claim outlines and tabs, paused note, asset placeholders (light)",
    async run(ctx) {
      const { page, log } = ctx
      await openEditor(ctx, "light")
      const m = await measureEditor(page)
      log(JSON.stringify(m, null, 1))
      const clay = await token(page, "presence-clay")
      const agent = await token(page, "agent")
      const warning = await token(page, "warning")
      const warningSoft = await page.evaluate(() => {
        const p = document.createElement("div")
        p.style.background = "var(--kimo-warning-soft)"
        document.body.append(p)
        const c = getComputedStyle(p).backgroundColor
        p.remove()
        return c
      })

      // Section 6: Maya's cursor, tip (3, 3) at world (300, 150) → screen (400, 200).
      const c = m.cursor
      expect(c, "Maya's cursor shows")
      expect(
        near(c.box.x, 397) && near(c.box.y, 197),
        `cursor box at (397, 197): ${JSON.stringify(c.box)}`,
      )
      expect(c.label === "Maya", `label Maya: ${c.label}`)
      expect(near(c.pointer.w, 18) && near(c.pointer.h, 18), "pointer 18")
      expect(near(c.pill.y - (c.pointer.y + c.pointer.h), 2), "pointer → pill gap 2")
      expect(c.pillBg === clay && c.pointerColor === clay, `clay pill ${c.pillBg} vs ${clay}`)
      expect(c.pillRadius === "999px", `pill radius ${c.pillRadius}`)
      expect(c.pillPadding === "4px 10px", `pill padding ${c.pillPadding}`)
      expect(c.pillShadow.includes("0px 4px 12px"), `pill shadow ${c.pillShadow}`)
      expect(c.font === "12px 500", `label font ${c.font}`)
      expect(near(c.pill.h, 23), `pill height 23: ${c.pill.h}`)

      // Remote selection on Feature 2: world (208, 234, 144, 70) → (308, 284).
      expect(
        m.selection && nearBox(m.selection.box, { x: 308, y: 284, w: 144, h: 70 }),
        `selection box ${JSON.stringify(m.selection)}`,
      )
      expect(m.selection.shadow.includes("1.5px"), `1.5 px outline ${m.selection.shadow}`)
      expect(
        m.tag && near(m.tag.box.x, 308) && near(m.tag.box.y, 266),
        `tag on the corner ${JSON.stringify(m.tag)}`,
      )
      expect(near(m.tag.box.h, 18), `tag 18 tall ${m.tag.box.h}`)
      expect(m.tag.radius === "3px 3px 3px 0px", `tag radius ${m.tag.radius}`)
      expect(m.tag.padding === "1px 5px", `tag padding ${m.tag.padding}`)
      expect(m.tag.bg === clay && m.tag.text === "Maya", "tag clay, Maya")

      // Off-screen: Jonas docks 8 inside the bottom-right corner.
      const off = m.offscreen
      expect(off, "Jonas's off-screen pill")
      expect(off.arrow === "arrow-down-right", `arrow ${off.arrow}`)
      expect(
        near(off.box.x + off.box.w, m.host.w - 8) && near(off.box.y + off.box.h, m.host.h - 8),
        `pill 8 inside ${JSON.stringify(off.box)} in ${JSON.stringify(m.host)}`,
      )
      expect(off.padding === "3px 8px 3px 6px", `pill padding ${off.padding}`)
      expect(off.text === "Jonas", "pill label")

      // Section 7: one outline per agent; Kimo on Hero (100, 94, 560, 170).
      expect(
        m.kimo.outline && nearBox(m.kimo.outline, { x: 100, y: 94, w: 560, h: 170 }),
        `Kimo outline ${JSON.stringify(m.kimo.outline)}`,
      )
      expect(
        m.kimo.shadow.includes(agent) && m.kimo.shadow.includes("1px"),
        `1 px agent hue ${m.kimo.shadow}`,
      )
      expect(
        m.kimo.tag && near(m.kimo.tag.x, 100) && near(m.kimo.tag.y, 94),
        "flush tab inside the top-left corner",
      )
      expect(m.kimo.tagText === "Kimo is editing Hero", m.kimo.tagText)
      expect(m.kimo.tagRadius === "0px 0px 6px", `tab radius ${m.kimo.tagRadius}`)
      expect(m.kimo.tagPadding === "3px 8px 3px 4px", `tab padding ${m.kimo.tagPadding}`)
      expect(m.kimo.tagGap === "5px" && m.kimo.tagFont === "11px 500", "tab gap 5, label 11 / 500")
      expect(m.kimo.tagBg === agent, `tab fill ${m.kimo.tagBg}`)
      expect(m.sol.tagText === "Sol · Maya's agent is editing Pricing", m.sol.tagText)
      const solCursor = m.agentCursors.find((a) => a.origin === HOLDER_SOL)
      expect(solCursor && solCursor.label === "Sol", "Sol's cursor")
      // Tip on Pricing's center: (100 + 280, 50 + 324 + 60) = (380, 434); box = tip − 3.
      expect(
        near(solCursor.box?.x ?? 0, 377, 1) && near(solCursor.box?.y ?? 0, 431, 4),
        `Sol cursor ${JSON.stringify(solCursor.box)}`,
      )
      expect(m.sectionOutlines === 0, "no board 36 section outline next to claims")

      // Paused Agent 2: warning outline and tab, note 6 right of the outline, 136 wide.
      expect(m.agent2.shadow.includes(warning), `warning outline ${m.agent2.shadow}`)
      expect(m.agent2.tagText === "Agent 2 paused", m.agent2.tagText)
      expect(m.agent2.tagBg === warningSoft && m.agent2.tagLabelColor === warning, "warning tab")
      expect(
        m.note && near(m.note.box.x, 666) && near(m.note.box.y, 264) && near(m.note.box.w, 136),
        `note ${JSON.stringify(m.note?.box)}`,
      )
      expect(
        m.note.padding === "8px 10px" && m.note.radius === "10px" && m.note.gap === "6px",
        `note box ${m.note.padding} ${m.note.radius}`,
      )
      expect(
        m.note.text.includes("You edited inside Features. Resumes on its own after 10 s"),
        m.note.text,
      )
      expect(!m.agentCursors.some((a) => a.origin === HOLDER_AGENT2), "paused agent: no cursor")
      await page.locator('[data-testid="mp-resume-now"]').click()
      await page.locator('[data-testid="mp-stop-agent"]').click()
      const done = await calls(page)
      expect(
        done.some((x) => x.op === "resumeAgent" && x.args[1] === HOLDER_AGENT2),
        "Resume now reaches the backend",
      )
      expect(
        done.some((x) => x.op === "stopAgent" && x.args[1] === HOLDER_AGENT2),
        "Stop reaches the backend",
      )
      expect(
        done.some((x) => x.op === "setPresence"),
        "local presence published",
      )

      // Section 8: fetching placeholder at the image's box (740, 50, 320, 200).
      const fetching = m.placeholders.find((p) => p.node === "Image00001")
      expect(fetching && fetching.state === "fetching", `fetching ${JSON.stringify(fetching)}`)
      expect(fetching.box && nearBox(fetching.box, { x: 740, y: 50, w: 320, h: 200 }), "layer box")
      expect(
        fetching.image.includes("conic-gradient") && fetching.size === "32px 32px",
        "16 px checkerboard",
      )
      expect(
        fetching.status &&
          near(fetching.status.x, 750) &&
          near(fetching.status.y + fetching.status.h, 237),
        `chip 10 from left, 10 above the bar ${JSON.stringify(fetching.status)}`,
      )
      expect(
        fetching.statusText === "3.4 MB" && fetching.statusPadding === "3px 8px 3px 6px",
        fetching.statusText,
      )
      expect(fetching.statusFont.includes("JetBrains Mono"), fetching.statusFont)
      expect(
        fetching.track && near(fetching.track.h, 3) && near(fetching.track.y, 247),
        "3 px bar on the bottom edge",
      )
      const na = m.placeholders.find((p) => p.node === "Image00002")
      expect(
        na &&
          na.state === "unavailable" &&
          na.statusText === "Waiting for someone who has it" &&
          !na.track,
        `not available ${JSON.stringify(na)}`,
      )
      // A missing image in view is fetched.
      await page.evaluate(() =>
        (window as unknown as { __mp: { set(p: unknown): void } }).__mp.set({
          assets: { uploading: [], fetching: [], unavailable: [], failed: [] },
        }),
      )
      await page.waitForFunction(() =>
        (window as unknown as { __mp: { calls: { op: string }[] } }).__mp.calls.some(
          (c) => c.op === "ensureAsset",
        ),
      )

      // Following Maya: 2 px clay frame, chip 12 from the top, centered; Esc stops.
      await page.evaluate(() =>
        (window as unknown as { __mp: { follow(p: number): void } }).__mp.follow(2),
      )
      await page.locator('[data-testid="mp-follow-chip"]').waitFor()
      const f = (await measureEditor(page)).follow
      expect(f, "following chrome")
      expect(
        nearBox(f.frame, { x: 0, y: 0, w: m.host.w, h: m.host.h }) && f.shadow.includes("2px"),
        `frame ${f.shadow}`,
      )
      expect(
        near(f.chip.y, 12) && near(f.chip.x + f.chip.w / 2, m.host.w / 2, 1),
        `chip ${JSON.stringify(f.chip)}`,
      )
      expect(f.chipPadding === "4px 10px 4px 8px" && f.chipBg === clay, `chip ${f.chipPadding}`)
      expect(f.text.replace(/\s+/g, " ").trim() === "Following Maya Esc", f.text)
      await page.keyboard.press("Escape")
      await page.locator('[data-testid="mp-follow-chip"]').waitFor({ state: "detached" })

      // Show other cursors off.
      await page.evaluate(() =>
        (
          window as unknown as {
            __mp: { platform: { settings: { set(k: string, v: unknown): Promise<void> } } }
          }
        ).__mp.platform.settings.set("multiplayer.showCursors", false),
      )
      await page.waitForFunction(
        () => document.querySelectorAll('[data-testid="mp-cursor"]').length === 0,
      )
    },
  },
  {
    name: "board41 canvas: dark tokens on cursor, claim tab and paused note",
    async run(ctx) {
      const { page } = ctx
      await openEditor(ctx, "dark")
      const m = await measureEditor(page)
      const clay = await token(page, "presence-clay")
      const agent = await token(page, "agent")
      expect(clay === "rgb(224, 154, 124)", `dark clay ${clay}`)
      expect(m.cursor && m.cursor.pillBg === clay, `dark pill ${m.cursor?.pillBg}`)
      expect(m.kimo.tagBg === agent, `dark tab ${m.kimo.tagBg} vs ${agent}`)
      expect(m.note, "paused note in dark")
    },
  },
  ...(["light", "dark"] as const).map(
    (theme): Scenario => ({
      name: `board41 AREA_BUSY card in the Agent tab (${theme}): Waiting card, Wait → Stop waiting, then free`,
      async run(ctx) {
        const { page, log } = ctx
        page.on("pageerror", (e) => log(`[pageerror] ${e.message}`))
        await page.setViewportSize({ width: 600, height: 900 })
        await page.goto(`${await harnessUrl(ctx)}?scene=panel&theme=${theme}`)
        await page.waitForFunction(() => !!(window as unknown as { __panel?: unknown }).__panel)
        // The turn stays open (its reply waits 60 s): do not wait for it.
        await page.evaluate(() => {
          void (
            window as unknown as { __panel: { controller: { send(t: string): Promise<void> } } }
          ).__panel.controller.send("Tighten the hero spacing")
        })
        const card = page.locator('[data-testid="area-busy-card"]')
        await card.waitFor({ timeout: 20_000 })
        const m = await page.evaluate(() => {
          const c = document.querySelector('[data-testid="area-busy-card"]') as HTMLElement
          const cs = getComputedStyle(c)
          const title = c.querySelector(".area-busy-card__title") as HTMLElement
          const desc = c.querySelector(".area-busy-card__desc") as HTMLElement
          const code = c.querySelector(".area-busy-card__code") as HTMLElement
          const btn = (id: string) => {
            const b = c.querySelector(`[data-testid="${id}"]`) as HTMLElement
            const s = getComputedStyle(b)
            return {
              h: b.getBoundingClientRect().height,
              padding: s.padding,
              font: s.fontSize,
              text: b.innerText,
            }
          }
          const thread = c.closest(".agent-panel__thread, [class*=thread]") as HTMLElement | null
          return {
            padding: cs.padding,
            radius: cs.borderRadius,
            bg: cs.backgroundColor,
            border: cs.borderTopWidth,
            gap: cs.rowGap,
            width: c.getBoundingClientRect().width,
            threadW: thread?.clientWidth ?? 0,
            title: title.innerText,
            titleFont: `${getComputedStyle(title).fontSize} ${getComputedStyle(title).fontWeight}`,
            desc: desc.innerText,
            descFont: `${getComputedStyle(desc).fontSize} ${getComputedStyle(desc).lineHeight}`,
            code: code.innerText,
            codeFont: getComputedStyle(code).fontFamily,
            elsewhere: btn("area-busy-elsewhere"),
            wait: btn("area-busy-wait"),
          }
        })
        log(JSON.stringify(m))
        const subtle = await page.evaluate(() => {
          const p = document.createElement("div")
          p.style.background = "var(--kimo-bg-subtle)"
          document.body.append(p)
          const c = getComputedStyle(p).backgroundColor
          p.remove()
          return c
        })
        expect(
          m.padding === "10px 12px" && m.radius === "16px" && m.border === "1px",
          `card box ${m.padding} ${m.radius}`,
        )
        expect(m.bg === subtle, `bg-subtle ${m.bg} vs ${subtle}`)
        expect(m.gap === "8px", `gap ${m.gap}`)
        expect(
          m.title === "Waiting: Sol is editing Hero" && m.titleFont === "12px 600",
          `${m.title} ${m.titleFont}`,
        )
        expect(
          m.desc.startsWith(
            "Sol is Maya's agent and claimed Hero 2 min ago. Kimo can work on another frame now, or wait until Hero is free.",
          ),
          m.desc,
        )
        expect(m.descFont.startsWith("11px"), m.descFont)
        expect(m.code === "AREA_BUSY" && m.codeFont.includes("JetBrains Mono"), m.codeFont)
        for (const b of [m.elsewhere, m.wait])
          expect(
            near(b.h, 26) && b.padding === "0px 10px" && b.font === "13px",
            `button ${JSON.stringify(b)}`,
          )
        expect(m.elsewhere.text === "Work elsewhere" && m.wait.text === "Wait", "labels")

        await page.locator('[data-testid="area-busy-wait"]').click()
        await page.locator('[data-testid="area-busy-wait"]', { hasText: "Stop waiting" }).waitFor()
        const status = await page.locator('[data-testid="agent-status"]').innerText()
        expect(status.includes("Waiting for Hero"), `status ${status}`)

        await page.evaluate(() =>
          (window as unknown as { __panel: { release(): void } }).__panel.release(),
        )
        const line = page.locator('[data-testid="area-busy-line"][data-kind="free"]')
        await line.waitFor()
        const l = await line.evaluate((e) => ({
          text: (e as HTMLElement).innerText,
          gap: getComputedStyle(e).columnGap,
          icon: (e.querySelector("svg") as SVGElement).getBoundingClientRect().width,
          font: getComputedStyle(e.querySelector(".area-busy-line__label") as Element).fontSize,
        }))
        expect(
          l.text === "Hero is free · continuing" &&
            l.gap === "8px" &&
            near(l.icon, 14) &&
            l.font === "12px",
          JSON.stringify(l),
        )
      },
    }),
  ),
]
