/**
 * M6 canvas scenarios (board 22 D0zDSY, board 24 iLW1l) under board 36 "Agent on canvas"
 * (XDVdg): note / prompt cards; placeholder frames draw nothing of their own (no outline,
 * skeleton, shimmer, tag, tooltip or ready chip; no ScopeTag); per agent one cursor on its
 * section's center + a 1 px section outline; rejected pill, prompt footer with Run, target chip
 * and connector, the Layers rows and the Note / Prompt toolbar entries.
 *
 * Each scenario ends with ONE measured pass: `getComputedStyle` + `getBoundingClientRect` of
 * every DOM piece against its design node, canvas pixels against the token colors, and every
 * overlay box asserted visible (height > 0, display ≠ none).
 */
import type { Page } from "playwright"
import { openEditor, pixel, settle, setViewport, toCanvas, world } from "./qa-helpers"
import { type E2EContext, expect, type Scenario } from "./run"

type Rec = Record<string, unknown>
type W = {
  __kimo: {
    session: {
      store: { getNode(id: string): Rec | undefined; nodeIds(): string[] }
      apply(ops: unknown[], label?: string): boolean
      ui: { getState(): { select(ids: string[]): void; setHovered(id: string | null): void } }
    }
    canvas(): {
      setAgentCanvas?(p: unknown): void
      stats(): { frameMsP95: number; frames: number; recorded?: number }
      layout(): {
        nodes: Map<string, { world: { x: number; y: number; w: number; h: number } }>
      } | null
    }
  }
  __m6: { runs: string[]; stops: string[]; paused: string[]; props?: Record<string, unknown> }
}

const LEAD = "agent:kimo.s1.0"
const A1 = "agent:kimo.s1.1"

const NOTE_TEXT = "Hero needs a warmer palette — think terracotta, not orange. Keep the CTA black."
const PROMPT_TEXT =
  "Draft 3 pricing cards (Free, Team, Business) inside Pricing. Use $brand tokens and the Card component."

async function fixture(page: Page) {
  const ok = await page.evaluate(
    ({ NOTE_TEXT, PROMPT_TEXT, LEAD }) =>
      (window as unknown as W).__kimo.session.apply(
        [
          {
            op: "insert",
            id: "note000001",
            parent: null,
            node: {
              type: "note",
              name: "Hero direction",
              x: 32,
              y: 40,
              author: "Gui",
              content: NOTE_TEXT,
            },
          },
          {
            op: "insert",
            id: "price00001",
            parent: null,
            node: {
              type: "frame",
              name: "Pricing",
              x: 360,
              y: 52,
              w: 340,
              h: 230,
              fill: "#FFFFFF",
              layout: { dir: "column" },
            },
          },
          {
            op: "insert",
            id: "hero000001",
            parent: "price00001",
            node: { type: "frame", name: "Hero", w: { mode: "fill" }, h: 110, fill: "#F6EFE6" },
          },
          {
            op: "insert",
            id: "feat000001",
            parent: "price00001",
            node: { type: "frame", name: "Features", w: { mode: "fill" }, h: 120, fill: "#FFFFFF" },
          },
          {
            op: "insert",
            id: "prompt0001",
            parent: null,
            node: {
              type: "prompt",
              name: "Pricing cards prompt",
              x: 32,
              y: 220,
              content: PROMPT_TEXT,
              model: { provider: "anthropic", model: "claude-opus-5-5" },
              target: "price00001",
            },
          },
          {
            op: "insert",
            id: "holder0001",
            parent: null,
            node: {
              type: "frame",
              name: "Features v2",
              x: 760,
              y: 52,
              w: 300,
              h: 300,
              radius: 6,
              fill: "#FFFFFF",
              placeholder: { by: LEAD, since: "2026-10-04T10:00:00.000Z" },
            },
          },
          {
            op: "insert",
            id: "orphan0001",
            parent: null,
            node: {
              type: "frame",
              name: "Footer",
              x: 760,
              y: 400,
              w: 300,
              h: 120,
              fill: "#FFFFFF",
              placeholder: { by: "agent:kimo.gone.0" },
            },
          },
        ],
        "m6 fixture",
      ),
    { NOTE_TEXT, PROMPT_TEXT, LEAD },
  )
  expect(ok, "fixture applied")
  await page.evaluate(
    ({ LEAD, A1 }) => {
      const w = window as unknown as W
      w.__m6 = { runs: [], stops: [], paused: [] }
      w.__m6.props = {
        liveOrigins: new Set([LEAD, A1]),
        agent: (o: string) =>
          o === LEAD
            ? { label: "Kimo", persona: "agent", ops: 14 }
            : o === A1
              ? { label: "Agent 1", persona: "iris" }
              : null,
        scopes: [{ origin: A1, roots: ["hero000001"], mode: "split" }],
        cursors: [
          { origin: A1, nodeId: "hero000001", text: "setting Headline font…", state: "working" },
        ],
        rejections: [
          { key: "r1", origin: A1, nodeId: "feat000001", text: "update Navbar → OUT_OF_SCOPE" },
        ],
        modelLabel: (m: { model?: string }) =>
          m?.model === "claude-opus-5-5" ? "Opus 5.5" : String(m),
        promptRun: () => ({
          status: "idle",
          lastRun: { at: Date.now() - 4 * 60_000, ops: 18, costUsd: 0.06, billing: "api" },
        }),
        onRunPrompt: (id: string) => w.__m6.runs.push(id),
        onStopPrompt: (id: string) => w.__m6.stops.push(id),
        reducedMotion: true,
      }
      w.__kimo.canvas().setAgentCanvas?.(w.__m6.props)
    },
    { LEAD, A1 },
  )
  await setViewport(page, { x: 0, y: 0, zoom: 1 })
  await settle(page)
  await settle(page)
}

/** Computed style + box of the first element matching `sel` (canvas-relative box). */
async function measure(page: Page, sel: string) {
  return page.evaluate((s) => {
    const el = document.querySelector(s) as HTMLElement | null
    if (!el) return null
    const host = (document.querySelector(".canvas-host") as HTMLElement).getBoundingClientRect()
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return {
      x: r.x - host.x,
      y: r.y - host.y,
      w: r.width,
      h: r.height,
      display: cs.display,
      bg: cs.backgroundColor,
      color: cs.color,
      radius: cs.borderTopLeftRadius,
      padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].join(" "),
      gap: cs.columnGap,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      fontFamily: cs.fontFamily,
      text: el.textContent ?? "",
    }
  }, sel)
}

const near = (a: number[], rgb: [number, number, number], tol: number) =>
  Math.abs((a[0] ?? 0) - rgb[0]) <= tol &&
  Math.abs((a[1] ?? 0) - rgb[1]) <= tol &&
  Math.abs((a[2] ?? 0) - rgb[2]) <= tol

const AGENT: [number, number, number] = [0, 147, 163]
const IRIS: [number, number, number] = [79, 95, 232]
const DANGER: [number, number, number] = [221, 34, 41]
const NOTE: [number, number, number] = [255, 241, 184]

async function cardsAndPlaceholders({ page, url, log }: E2EContext) {
  page.on("pageerror", (e) => log("pageerror", e.message, e.stack?.slice(0, 800)))
  await openEditor(page, url)
  await fixture(page)
  const diffs: string[] = []
  const check = (cond: boolean, msg: string) => {
    if (!cond) diffs.push(msg)
  }

  // --- Cards (layout = the design's measured boxes for the design copy) ---
  const note = await world(page, "note000001")
  const prompt = await world(page, "prompt0001")
  check(note?.w === 220 && note?.h === 98, `NoteNode afq5v 220×98, got ${JSON.stringify(note)}`)
  check(
    prompt?.w === 300 && prompt?.h === 154,
    `PromptNode poE5B 300×154, got ${JSON.stringify(prompt)}`,
  )
  const noteFill = await pixel(page, await toCanvas(page, { x: 32 + 110, y: 40 + 90 }))
  check(near(noteFill, NOTE, 3), `note fill #FFF1B8, got ${noteFill}`)

  // --- Board 36: a placeholder frame draws nothing of its own ---
  // (x 760 + 60: the canvas is ~900 px wide in the e2e window.)
  const edge = await pixel(page, await toCanvas(page, { x: 760 + 60, y: 52.3 }))
  check(!near(edge, AGENT, 40), `no placeholder outline, got ${edge}`)
  const bar = await pixel(page, await toCanvas(page, { x: 760 + 16 + 10, y: 52 + 52 + 7 }))
  check(!near(bar, [227, 245, 247], 4), `no skeleton bar, got ${bar}`)
  const retired = await page
    .locator(
      '[data-testid="placeholder-tag"], [data-testid="placeholder-tooltip"], [data-testid="scope-tag"], [data-testid="placeholder-ready"]',
    )
    .count()
  check(retired === 0, `no placeholder tag, tooltip, ScopeTag or ready chip (${retired})`)

  // --- Board 36: the Hero section's outline (1 px iris) and the cursor on its center ---
  const hero = await world(page, "hero000001")
  const outline = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="agent-section-outline"]') as HTMLElement
    const host = (document.querySelector(".canvas-host") as HTMLElement).getBoundingClientRect()
    const r = el.getBoundingClientRect()
    return {
      x: r.x - host.x,
      y: r.y - host.y,
      w: r.width,
      h: r.height,
      shadow: getComputedStyle(el).boxShadow,
      node: el.getAttribute("data-node-id"),
      n: document.querySelectorAll('[data-testid="agent-section-outline"]').length,
    }
  })
  check(
    outline.n === 1 &&
      outline.node === "hero000001" &&
      Math.abs(outline.x - (hero?.x ?? 0)) < 0.5 &&
      Math.abs(outline.y - (hero?.y ?? 0)) < 0.5 &&
      Math.abs(outline.w - (hero?.w ?? 0)) < 0.5 &&
      Math.abs(outline.h - (hero?.h ?? 0)) < 0.5,
    `section outline = Hero box, got ${JSON.stringify(outline)} vs ${JSON.stringify(hero)}`,
  )
  check(
    outline.shadow === "rgb(79, 95, 232) 0px 0px 0px 1px inset",
    `outline 1 px iris inside, got ${outline.shadow}`,
  )
  const cursor = await measure(page, '[data-testid="agent-cursor"]')
  check(
    Math.abs((cursor?.x ?? 0) + 3 - ((hero?.x ?? 0) + (hero?.w ?? 0) / 2)) < 0.5 &&
      Math.abs((cursor?.y ?? 0) + 3 - ((hero?.y ?? 0) + (hero?.h ?? 0) / 2)) < 0.5,
    `cursor tip on the Hero center, got ${cursor?.x},${cursor?.y}`,
  )
  const pill = await measure(page, '[data-testid="agent-cursor"] .agent-section__pill')
  check(
    pill?.bg === "rgb(79, 95, 232)" && pill?.padding === "4px 10px 4px 4px" && pill?.gap === "6px",
    `cursor pill iris / [4,10,4,4] / 6, got ${pill?.bg} ${pill?.padding} ${pill?.gap}`,
  )
  check(pill?.text === "Agent 1", `one label: the agent's name, got "${pill?.text}"`)
  const label = await measure(page, '[data-testid="agent-cursor"] .agent-section__label')
  check(
    label?.fontSize === "12px" && label?.fontWeight === "500",
    `label 12 / 500, got ${label?.fontSize} ${label?.fontWeight}`,
  )
  const pointer = await measure(page, '[data-testid="agent-cursor"] .agent-section__pointer svg')
  // Within 0.01: the cursor sits at a fractional canvas offset, so the box can read 18.00002.
  check(
    Math.abs((pointer?.w ?? 0) - 18) < 0.01 && Math.abs((pointer?.h ?? 0) - 18) < 0.01,
    `pointer 18, got ${pointer?.w}×${pointer?.h}`,
  )
  // No canvas-drawn selection 2 px outside the node (board 24 GmEAl, retired).
  const sel = await pixel(
    page,
    await toCanvas(page, { x: (hero?.x ?? 0) + 200, y: (hero?.y ?? 0) - 1.4 }),
  )
  check(!near(sel, IRIS, 60), `no persona selection outline, got ${sel}`)

  // --- Rejected pill (O2Whh) + danger flash ---
  // The pill shows for 3 s and the flash for 1.2 s after a rejection is first seen, and the
  // checks above can take longer on a slow runner: report a fresh rejection right before.
  await page.evaluate(() => {
    const w = window as unknown as W
    const props = w.__m6.props as { rejections: { key: string }[] }
    w.__kimo.canvas().setAgentCanvas?.({
      ...props,
      rejections: props.rejections.map((r) => ({ ...r, key: `${r.key}-again` })),
    })
  })
  await settle(page)
  const rej = await measure(page, '[data-testid="rejected-pill"]')
  check(
    rej?.h === 24 && rej?.bg === "rgb(221, 34, 41)",
    `rejected pill 24 danger, got ${rej?.h} ${rej?.bg}`,
  )
  check(rej?.padding === "0px 10px 0px 8px" && rej?.gap === "6px", `rejected padding/gap`)
  const feat = await world(page, "feat000001")
  const flash = await pixel(
    page,
    await toCanvas(page, { x: (feat?.x ?? 0) + 300, y: (feat?.y ?? 0) + 0.4 }),
  )
  check(near(flash, DANGER, 60), `rejected flash danger, got ${flash}`)

  // --- Prompt footer (pFCri) + Run + target chip (sWQ2b) + connector ---
  const footer = await measure(page, '[data-testid="prompt-footer"]')
  check(
    footer?.h === 42 && footer?.y === 220 + 154 - 42,
    `footer 42 at the card bottom, got ${footer?.h} @${footer?.y}`,
  )
  check(
    footer?.text.startsWith("Ran 4m ago · 18 ops · $0.06") ?? false,
    `footer copy, got "${footer?.text}"`,
  )
  const run = await measure(page, '[data-testid="prompt-run"]')
  check(
    run?.h === 26 && run?.padding === "0px 10px 0px 8px" && run?.gap === "4px",
    `Run pill 26 [0,10,0,8] gap 4, got ${run?.h} ${run?.padding}`,
  )
  check(
    Math.abs((run?.x ?? 0) + (run?.w ?? 0) - (32 + 300 - 8)) < 0.5,
    `Run 8 from the card's right edge`,
  )
  await page.locator('[data-testid="prompt-run"]').click()
  const runs = await page.evaluate(() => (window as unknown as W).__m6.runs)
  check(runs[0] === "prompt0001", `Run → onRunPrompt, got ${runs}`)
  const chip = await measure(page, '[data-testid="prompt-target-chip"]')
  check(
    chip?.h === 18 && chip?.x === 360 && chip?.y === 52 + 230 + 10,
    `target chip 18 @ frame bottom + 10, got ${chip?.h} ${chip?.x},${chip?.y}`,
  )
  check(chip?.text === "target · Pricing", `target chip copy, got "${chip?.text}"`)
  const dot = await pixel(page, { x: 358, y: 251 })
  check(near(dot, AGENT, 40), `connector dot agent at the frame edge, got ${dot}`)

  // --- Every overlay box is visible ---
  const hidden = await page.evaluate(() =>
    [...document.querySelectorAll(".agent-canvas > *")]
      .filter((e) => {
        const r = e.getBoundingClientRect()
        return r.height <= 0 || getComputedStyle(e).display === "none"
      })
      .map((e) => e.className),
  )
  check(hidden.length === 0, `agent DOM boxes visible, hidden: ${hidden.join(", ")}`)

  // --- Clear: no ready chip (board 36) ---
  await page.evaluate(() =>
    (window as unknown as W).__kimo.session.apply(
      [{ op: "update", id: "holder0001", unset: ["placeholder"] }],
      "clear",
    ),
  )
  await settle(page)
  await settle(page)
  check(
    (await page.locator('[data-testid="placeholder-ready"]').count()) === 0,
    "no ready chip after a placeholder clears",
  )

  // A building placeholder costs nothing: no shimmer frames with motion on.
  const idle = await page.evaluate(async () => {
    const w = window as unknown as W
    const c = w.__kimo.canvas()
    c.setAgentCanvas?.({
      liveOrigins: new Set(["agent:kimo.s1.0"]),
      agent: () => null,
      reducedMotion: false,
    })
    w.__kimo.session.apply(
      [{ op: "update", id: "orphan0001", set: { placeholder: { by: "agent:kimo.s1.0" } } }],
      "rebuild",
    )
    await new Promise((r) => setTimeout(r, 200))
    const f0 = c.stats().frames
    await new Promise((r) => setTimeout(r, 1000))
    return { frames: c.stats().frames - f0 }
  })
  log(`building placeholder: ${idle.frames} frames in 1 s`)
  check(idle.frames <= 2, `no shimmer frames, got ${idle.frames}`)

  log(diffs.length ? `measured diffs:\n  ${diffs.join("\n  ")}` : "measured pass: 0 diffs")
  expect(diffs.length === 0, `M6 measured pass:\n${diffs.join("\n")}`)
}

async function layersAndToolbar({ page, url, log }: E2EContext) {
  await openEditor(page, url)
  await fixture(page)
  const diffs: string[] = []
  const check = (cond: boolean, msg: string) => {
    if (!cond) diffs.push(msg)
  }
  const rowInfo = (kind: string) =>
    page.evaluate((k) => {
      const r = document.querySelector(`[data-agent-row="${k}"]`) as HTMLElement | null
      if (!r) return null
      const icon = r.querySelector(".kimo-layer-row__icon") as HTMLElement
      const trail = r.querySelector(
        ".agent-layer-row__trail, .kimo-layer-row__visibility",
      ) as HTMLElement | null
      return {
        h: r.getBoundingClientRect().height,
        disclosure: !!r.querySelector(".kimo-layer-row__disclosure"),
        icon: getComputedStyle(icon).color,
        name: (r.querySelector(".kimo-layer-row__name") as HTMLElement).textContent,
        nameColor: getComputedStyle(r.querySelector(".kimo-layer-row__name") as HTMLElement).color,
        trail: trail?.getAttribute("aria-label") ?? trail?.className ?? null,
        trailColor: trail ? getComputedStyle(trail).color : null,
      }
    }, kind)
  const note = await rowInfo("note")
  check(
    note?.h === 28 && note?.disclosure === false,
    `LayerRow/Note 28 high, no disclosure: ${JSON.stringify(note)}`,
  )
  check(note?.icon === "rgb(61, 50, 5)", `note icon note-text, got ${note?.icon}`)
  const prompt = await rowInfo("prompt")
  check(
    prompt?.disclosure === false && prompt?.icon === "rgb(0, 147, 163)",
    `LayerRow/Prompt sparkles agent, got ${JSON.stringify(prompt)}`,
  )
  check(
    prompt?.trail === "Run prompt" && prompt?.trailColor === "rgb(154, 157, 162)",
    `prompt trail play text-tertiary, got ${prompt?.trail} ${prompt?.trailColor}`,
  )
  const holder = await rowInfo("placeholder")
  check(
    holder?.disclosure === true && holder?.nameColor === "rgb(0, 147, 163)",
    `LayerRow/Placeholder name agent, got ${JSON.stringify(holder)}`,
  )
  check(
    holder?.trailColor === "rgb(0, 147, 163)",
    `placeholder lock agent, got ${holder?.trailColor}`,
  )
  // The editor passes its prompt-run handler to LeftPanel: the play button is live.
  const playEnabled = await page
    .locator('[data-agent-row="prompt"] .agent-layer-row__trail')
    .isEnabled()
  check(playEnabled, "row play runs the prompt (enabled)")

  // Toolbar: Note / Prompt follow Component, tinted note-text / agent.
  const tools = await page.evaluate(() =>
    [...document.querySelectorAll(".floating-toolbar [data-tool]")].map((b) =>
      b.getAttribute("data-tool"),
    ),
  )
  check(tools.slice(-3).join(",") === "component,note,prompt", `toolbar order, got ${tools}`)
  const tint = await page.evaluate(() => {
    const span = document.querySelector(
      '[data-tool="note"] .floating-toolbar__tinted',
    ) as HTMLElement
    return getComputedStyle(span).color
  })
  check(tint === "rgb(61, 50, 5)", `Note tool tint note-text, got ${tint}`)
  const before = await page.evaluate(
    () => (window as unknown as W).__kimo.session.store.nodeIds().length,
  )
  await page.locator('[data-tool="note"]').click()
  await settle(page)
  const editor = page.locator(".canvas-host__text-editor")
  await editor.waitFor({ timeout: 5000 })
  await editor.fill("Keep the CTA black")
  await editor.press("Escape")
  await settle(page)
  const created = await page.evaluate((n0) => {
    const s = (window as unknown as W).__kimo.session.store
    const ids = s.nodeIds()
    const note = ids
      .map((i) => s.getNode(i))
      .find((n) => n?.type === "note" && n.content === "Keep the CTA black")
    return { n: ids.length - n0, note: note ?? null }
  }, before)
  check(
    created.n === 1 && !!created.note,
    `Note tool inserts one note with the typed body, got ${JSON.stringify(created)}`,
  )
  log(diffs.length ? `measured diffs:\n  ${diffs.join("\n  ")}` : "measured pass: 0 diffs")
  expect(diffs.length === 0, `M6 layers/toolbar measured pass:\n${diffs.join("\n")}`)
}

/**
 * Board 31 "Position lock": while the canvas pans and zooms (wheel, ctrl+wheel, space+drag,
 * middle drag), every canvas frame is sampled right after the renderer draws it; board 36: the
 * cursor must sit on its section's center (box − 3) and the outline on its box, as drawn in
 * that frame (0 px drift, ±0.5).
 */
async function labelsStayLocked({ page, url, log }: E2EContext) {
  await openEditor(page, url)
  await fixture(page)
  await setViewport(page, { x: 0, y: 0, zoom: 1 })
  await settle(page)
  await page.evaluate(() => {
    const w = window as unknown as W & {
      __drift: { frames: number; rows: { k: string; dx: number; dy: number }[] }
    }
    const canvas = w.__kimo.canvas() as unknown as {
      renderer: { render(): void; viewport: { x: number; y: number; zoom: number } }
    }
    const layout = w.__kimo.canvas().layout()
    const r = canvas.renderer
    const host = document.querySelector(".canvas-host") as HTMLElement
    w.__drift = { frames: 0, rows: [] }
    const draw = r.render.bind(r)
    r.render = () => {
      draw()
      const v = r.viewport
      const h = host.getBoundingClientRect()
      const at = (k: string, sel: string, id: string, center: boolean) => {
        const el = document.querySelector(sel)
        const b = layout?.nodes.get(id)?.world
        if (!el || !b) return
        const e = el.getBoundingClientRect()
        const ax = center ? (b.x + b.w / 2 - v.x) * v.zoom - 3 : (b.x - v.x) * v.zoom
        const ay = center ? (b.y + b.h / 2 - v.y) * v.zoom - 3 : (b.y - v.y) * v.zoom
        w.__drift.rows.push({ k, dx: e.x - h.x - ax, dy: e.y - h.y - ay })
      }
      w.__drift.frames++
      at("cursor", '[data-testid="agent-cursor"]', "hero000001", true)
      at("outline", '[data-testid="agent-section-outline"]', "hero000001", false)
    }
  })
  const host = await page.locator(".canvas-host").boundingBox()
  const c = { x: (host?.x ?? 0) + 300, y: (host?.y ?? 0) + 300 }
  await page.mouse.move(c.x, c.y)
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(14, 9)
    await page.waitForTimeout(16)
  }
  await page.keyboard.down("Control")
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, i < 3 ? -18 : 12)
    await page.waitForTimeout(16)
  }
  await page.keyboard.up("Control")
  await page.locator(".canvas-host").focus()
  await page.keyboard.down("Space")
  await page.mouse.move(c.x, c.y)
  await page.mouse.down()
  await page.mouse.move(c.x - 120, c.y - 40, { steps: 12 })
  await page.mouse.up()
  await page.keyboard.up("Space")
  await page.mouse.down({ button: "middle" })
  await page.mouse.move(c.x + 60, c.y + 30, { steps: 10 })
  await page.mouse.up({ button: "middle" })
  await settle(page)
  const d = await page.evaluate(
    () =>
      (
        window as unknown as {
          __drift: { frames: number; rows: { k: string; dx: number; dy: number }[] }
        }
      ).__drift,
  )
  const byKey = new Map<string, { dx: number; dy: number }[]>()
  for (const r of d.rows) byKey.set(r.k, [...(byKey.get(r.k) ?? []), r])
  const report: string[] = []
  for (const [k, rows] of byKey) {
    const xs = rows.map((r) => r.dx)
    const ys = rows.map((r) => r.dy)
    const spread = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
    report.push(
      `${k}: ${rows.length} frames, offset ${xs[0]?.toFixed(2)},${ys[0]?.toFixed(2)}, drift ${spread.toFixed(2)} px`,
    )
    expect(rows.length >= 10, `${k}: sampled ${rows.length} drawn frames`)
    expect(spread <= 0.5, `${k}: drift ${spread.toFixed(2)} px while panning / zooming`)
  }
  log(`  position lock (${d.frames} canvas frames):\n    ${report.join("\n    ")}`)
  expect(byKey.has("cursor") && byKey.has("outline"), "cursor and outline were on screen")
  // Board 36: the cursor stays on the section center and the outline on its box in every frame.
  for (const r of [...(byKey.get("cursor") ?? []), ...(byKey.get("outline") ?? [])])
    expect(Math.abs(r.dx) <= 0.5 && Math.abs(r.dy) <= 0.5, `offset ${r.dx},${r.dy}`)
}

export const scenarios: Scenario[] = [
  {
    name: "m6 canvas: cards, placeholders draw nothing, section cursor + outline, rejected, prompt footer",
    run: cardsAndPlaceholders,
  },
  { name: "m6 canvas: layer rows + Note / Prompt toolbar", run: layersAndToolbar },
  {
    name: "board31 canvas: agent labels stay locked to their layers while panning / zooming",
    run: labelsStayLocked,
  },
]
