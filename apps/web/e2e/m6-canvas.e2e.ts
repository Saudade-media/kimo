/**
 * M6 canvas scenarios (board 22 D0zDSY, board 24 iLW1l): note / prompt cards, placeholder
 * frames (outline, skeleton, tag + tooltip, orphan 'Agent stopped', clear → flash + ready chip), scope
 * outlines + ScopeTags, persona cursor + selection, rejected pill, prompt footer with Run, target
 * chip and connector, the Layers rows and the Note / Prompt toolbar entries.
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
  __m6: { runs: string[]; stops: string[]; paused: string[] }
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
      w.__kimo.canvas().setAgentCanvas?.({
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
        onPauseAgent: (o: string) => w.__m6.paused.push(o),
        reducedMotion: true,
      })
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

  // --- Placeholder: canvas outline + skeleton ---
  // (x 760 + 60: the canvas is ~900 px wide in the e2e window.)
  const outline = await pixel(page, await toCanvas(page, { x: 760 + 60, y: 52.3 }))
  check(near(outline, AGENT, 40), `placeholder outline agent, got ${outline}`)
  const bar = await pixel(page, await toCanvas(page, { x: 760 + 16 + 10, y: 52 + 52 + 7 }))
  check(near(bar, [227, 245, 247], 24), `skeleton Bar · title agent-soft, got ${bar}`)

  // --- Placeholder tag (EKCy7 iyhUZ) ---
  const tag = await measure(page, '[data-testid="placeholder-tag"][data-node-id="holder0001"]')
  check(!!tag && tag.display !== "none" && tag.h === 20, `tag 20 high, got ${tag?.h}`)
  check(tag?.x === 776 && tag?.y === 68, `tag at frame + 16, got ${tag?.x},${tag?.y}`)
  check(tag?.bg === "rgb(0, 147, 163)", `tag fill agent, got ${tag?.bg}`)
  check(
    tag?.padding === "0px 7px 0px 5px" && tag?.gap === "4px",
    `tag padding/gap ${tag?.padding} ${tag?.gap}`,
  )
  check(tag?.radius === "4px", `tag radius-xs, got ${tag?.radius}`)
  // Board 31 "Canvas label": the agent's name only.
  check(tag?.text === "Kimo", `tag copy, got "${tag?.text}"`)
  const tagLabel = await measure(page, '[data-node-id="holder0001"] .agent-canvas__tag-label')
  check(tagLabel?.fontSize === "11px" && tagLabel?.fontWeight === "500", `tag label 11/500`)
  const orphan = await measure(page, '[data-testid="placeholder-tag"][data-node-id="orphan0001"]')
  // Board 25 §3 (UMRAO): orphans read "Agent stopped · <name>" on bg-muted.
  const muted = await page.evaluate(() => {
    const el = document.createElement("span")
    el.style.color = "var(--kimo-bg-muted)"
    document.body.append(el)
    const c = getComputedStyle(el).color
    el.remove()
    return c
  })
  check(
    !!orphan?.text?.startsWith("Agent stopped · ") && orphan?.bg === muted,
    `orphan tag grey, got ${orphan?.text} ${orphan?.bg}`,
  )

  // Tooltip on hover (vqqTf): 280 wide, padding 12, buttons 26 high.
  await page.locator('[data-testid="placeholder-tag"][data-node-id="holder0001"]').hover()
  await settle(page)
  const tip = await measure(page, '[data-testid="placeholder-tooltip"]')
  check(
    tip?.w === 280 && tip?.padding === "12px 12px 12px 12px",
    `tooltip 280 / 12, got ${tip?.w} ${tip?.padding}`,
  )
  check(!!tip?.text.includes("Kimo is building this frame"), "tooltip title copy")
  const btn = await measure(page, '[data-testid="placeholder-tooltip"] .kimo-button')
  check(
    btn?.h === 26 && btn?.padding === "0px 10px 0px 10px",
    `tooltip button 26 / [0,10], got ${btn?.h} ${btn?.padding}`,
  )
  await page.getByRole("button", { name: "Pause agent" }).click()
  const paused = await page.evaluate(() => (window as unknown as W).__m6.paused)
  check(paused[0] === LEAD, `Pause agent → onPauseAgent(${LEAD}), got ${paused}`)

  // --- Split scope (flush) + ScopeTag (NKE7Z) ---
  const hero = await world(page, "hero000001")
  const scopeEdge = await pixel(
    page,
    await toCanvas(page, { x: (hero?.x ?? 0) + 0.4, y: (hero?.y ?? 0) + 60 }),
  )
  check(near(scopeEdge, IRIS, 50), `split scope outline agent-iris, got ${scopeEdge}`)
  const scope = await measure(page, '[data-testid="scope-tag"]')
  check(
    scope?.h === 20 && scope?.bg === "rgb(79, 95, 232)",
    `ScopeTag 20 high iris, got ${scope?.h} ${scope?.bg}`,
  )
  check(
    Math.abs((scope?.x ?? 0) + (scope?.w ?? 0) - (360 + 340 - 6)) < 0.5 && scope?.y === 52 + 6,
    `ScopeTag inside top-right (6 px), got ${scope?.x}+${scope?.w},${scope?.y}`,
  )
  check(scope?.text === "Agent 1 · only inside Hero", `ScopeTag copy, got "${scope?.text}"`)

  // --- Persona cursor (H6ncRy) + selection outline 2 px outside the node ---
  const cursor = await measure(page, '[data-testid="persona-cursor"] .agent-canvas__cursor-pill')
  check(
    cursor?.bg === "rgb(79, 95, 232)" && cursor?.padding === "4px 10px 4px 4px",
    `cursor pill iris / [4,10,4,4], got ${cursor?.bg} ${cursor?.padding}`,
  )
  const sel = await pixel(
    page,
    await toCanvas(page, { x: (hero?.x ?? 0) + 200, y: (hero?.y ?? 0) - 1.4 }),
  )
  // Anti-aliased 1.5 px line: assert the iris hue dominates (blue ≫ red/green).
  check(
    (sel[2] ?? 0) > 200 && (sel[2] ?? 0) - (sel[0] ?? 0) > 50 && (sel[2] ?? 0) - (sel[1] ?? 0) > 50,
    `persona selection outline iris, got ${sel}`,
  )

  // --- Rejected pill (O2Whh) + danger flash ---
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

  // --- Clear → ready chip (i6wxFe), 12 below the frame ---
  await page.evaluate(() =>
    (window as unknown as W).__kimo.session.apply(
      [{ op: "update", id: "holder0001", unset: ["placeholder"] }],
      "clear",
    ),
  )
  await settle(page)
  await settle(page)
  const ready = await measure(page, '[data-testid="placeholder-ready"]')
  check(
    ready?.h === 22 && ready?.x === 760 && ready?.y === 52 + 300 + 12,
    `ready chip 22 @ +12, got ${ready?.h} ${ready?.x},${ready?.y}`,
  )
  check(ready?.text === "Features v2 ready · 14 ops · Review", `ready copy, got "${ready?.text}"`)

  // Shimmer cost: with motion on, the overlay pass re-runs ≤ 30 fps; the scene pictures stay.
  const shimmer = await page.evaluate(async () => {
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
    const f0 = c.stats().frames
    await new Promise((r) => setTimeout(r, 1000))
    const s = c.stats()
    return { frames: s.frames - f0, p95: s.frameMsP95, recorded: s.recorded ?? 0 }
  })
  log(
    `shimmer: ${shimmer.frames} frames/s, render p95 ${shimmer.p95.toFixed(2)} ms, pictures recorded in the last frame ${shimmer.recorded}`,
  )
  check(shimmer.frames >= 15 && shimmer.frames <= 40, `shimmer ≈ 30 fps, got ${shimmer.frames}`)
  check(shimmer.recorded === 0, `shimmer frames record no pictures, got ${shimmer.recorded}`)

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
 * middle drag), every canvas frame is sampled right after the renderer draws it; the persona
 * cursor and the placeholder tag must sit at a fixed offset from their layer's screen box as
 * drawn in that frame (0 px drift, ±0.5).
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
      const at = (k: string, sel: string, id: string) => {
        const el = document.querySelector(sel)
        const b = layout?.nodes.get(id)?.world
        if (!el || !b) return
        const e = el.getBoundingClientRect()
        w.__drift.rows.push({
          k,
          dx: e.x - h.x - (b.x - v.x) * v.zoom,
          dy: e.y - h.y - (b.y - v.y) * v.zoom,
        })
      }
      w.__drift.frames++
      at("cursor", '[data-testid="persona-cursor"]', "hero000001")
      at("tag", '[data-testid="placeholder-tag"][data-node-id="holder0001"]', "holder0001")
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
  expect(byKey.has("cursor") && byKey.has("tag"), "cursor and tag were on screen")
  // The cursor keeps its +4, +4 anchor (board 24 g) in every frame.
  for (const r of byKey.get("cursor") ?? [])
    expect(Math.abs(r.dx - 4) <= 0.5 && Math.abs(r.dy - 4) <= 0.5, `cursor offset ${r.dx},${r.dy}`)
}

export const scenarios: Scenario[] = [
  {
    name: "m6 canvas: cards, placeholders, scopes, cursors, rejected, prompt footer",
    run: cardsAndPlaceholders,
  },
  { name: "m6 canvas: layer rows + Note / Prompt toolbar", run: layersAndToolbar },
  {
    name: "board31 canvas: agent labels stay locked to their layers while panning / zooming",
    run: labelsStayLocked,
  },
]
