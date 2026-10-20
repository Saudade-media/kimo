/**
 * Board 41 › 11 "Live text" (desing.pen ExORz, rules pCwkf) in the real editor over the board 41
 * canvas harness (scripted share backend), measured against the nodes:
 *
 * - A (`sQsyq`): you edit a single line, Maya's range "together" (0.24 clay, full line height)
 *   and her caret (`qs7mU` 2 × 24, y 2 in the 28 line) with the flag flipped below on the first
 *   line (`BkOUb` y 26, radius 0 3 3 3, padding [1, 5], text-xs 500 on-accent).
 * - B (`lbHOD`): a paragraph you edit, her caret on line 2, the flag above (`Y2tdK` y -13,
 *   radius 3 3 3 0).
 * - C (`LW21Z`): she edits a layer you are not editing: caret and range on the canvas text, her
 *   1.5 clay outline with no corner tag.
 * - D (`kTzfh`): an agent's write inside its claim: a 2 px caret in its hue at the end of the
 *   write, the flag with AgentMark 12 (padding [1, 5, 1, 2], gap 3), gone after 3 s.
 * - E (`b1I6Z1`): a caret at a soft wrap draws at the end of the upper line, flag below.
 * - F (`KdajG`): two carets at one spot: flags stacked 2 apart (y -13, -30), the latest typer
 *   closest and their bar on top, bars never offset.
 * - G (`wMVjS`): at 40 % flags hide, the bar stays 2 screen px (10 tall on the board), the range
 *   stays, hovering the caret shows a Tooltip.
 * - H (`Rg6H6`): idle 60 s: caret and flag at 0.5, "Maya · idle".
 * - I (rules `QnhIA`, `j4gyy`): the flag fades 150 ms after 3 s without a keystroke, hovering
 *   the caret shows it, typing shows it at once, dragging a selection hides it.
 *
 * Dark (`dJVNd`): A, B, E, F, G and H with the dark tokens.
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
      outDir: join(process.env.KIMO_E2E_OUTDIR ?? join(here, ".dist"), "board41-live-text"),
      emptyOutDir: true,
      target: "es2022",
    },
  }).then(() => "board41-live-text/index.html")
  return `${ctx.url}${await built}`
}

type Box = { x: number; y: number; w: number; h: number }
type Theme = "light" | "dark"
const near = (a: number, b: number, tol = 0.6) => Math.abs(a - b) <= tol

const KIMO = "agent:kimo.s1abc.0"
const FRAME = "LiveBoard01"
/** A: one line, 340 wide (`mUj80`). */
const T_A = "LiveTextA1"
/** B, E, F, H: the paragraph, 300 wide (`W80X6h`). */
const T_B = "LiveTextB1"
/** C: the same paragraph, a layer you do not edit (`BywAU`). */
const T_C = "LiveTextC1"
/** D: Headline inside Hero (`MtWp8`). */
const T_D = "Headline01"
const PARA = "Plan less. Ship more together, on one canvas, right next to your code."

type W = {
  __kimo: {
    session: {
      store: {
        apply(ops: unknown, o: { origin: string; label?: string }): { ok: boolean }
        encodeTextPosition(id: string, offset: number, assoc?: number): string | null
        editText(id: string, edits: unknown[], o: { origin: string }): { ok: boolean }
      }
      apply(ops: unknown[], label?: string): boolean
      ui: {
        getState(): {
          viewport: { x: number; y: number; zoom: number }
          setViewport(v: object): void
          select(ids: string[]): void
        }
      }
    }
    canvas(): { layout(): { nodes: Map<string, { world: Box }> } | null } | null
  }
  __mp: { FILE: string; set(p: unknown): void }
}

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

async function openEditor(ctx: E2EContext, theme: Theme) {
  const { page } = ctx
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${await harnessUrl(ctx)}?kimo-debug&theme=${theme}`)
  await page.waitForFunction(() => !!(window as unknown as { __mp?: unknown }).__mp)
  const file = await page.evaluate(() => (window as unknown as W).__mp.FILE)
  await page.evaluate((f) => {
    location.hash = `#/disk/${encodeURIComponent(f)}`
  }, file)
  await page.locator('.canvas-host[data-ready="true"]').waitFor({ timeout: 30_000 })
  await page.evaluate(
    ([frame, a, b, c, d, para]) => {
      const s = (window as unknown as W).__kimo.session
      const text = (
        id: string,
        parent: string,
        x: number,
        y: number,
        w: number,
        content: string,
      ) => ({
        op: "insert",
        id,
        parent,
        node: {
          type: "text",
          name: id,
          x,
          y,
          w,
          grow: "fixed-width",
          content,
          style: { font: "Inter", size: 20, lineHeight: 1.4 },
        },
      })
      s.apply(
        [
          {
            op: "insert",
            id: frame,
            parent: null,
            node: { type: "frame", name: "Live", x: 0, y: 520, w: 1100, h: 300, fill: "#FFFFFF" },
          },
          text(a, frame, 40, 60, 340, "Plan less. Ship more together."),
          text(b, frame, 420, 60, 300, para),
          text(c, frame, 760, 60, 300, para),
          // 220 wide: "Plan less. Ship more" / "tog" as on the board.
          text(d, "Hero000001", 20, 40, 220, "Plan less."),
        ],
        "fixture",
      )
    },
    [FRAME, T_A, T_B, T_C, T_D, PARA] as const,
  )
  await shared(page, [])
  await setView(page, { x: -100, y: 400, zoom: 1 })
}

async function setView(page: Page, v: { x: number; y: number; zoom: number }) {
  await page.evaluate(
    (vp) => (window as unknown as W).__kimo.session.ui.getState().setViewport(vp),
    v,
  )
  await settle(page)
}

const settle = (page: Page) =>
  page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  )

interface Peer {
  peer: number
  name: string
  color: string
  node?: string
  anchor?: number
  focus?: number
  /** Ms since their last presence change (idle after 60 s). */
  quiet?: number
  selection?: string[]
}

/** The document shared, you (Gui) and `peers` with their text carets (encoded in the page). */
async function shared(page: Page, peers: Peer[], claims: unknown[] = []) {
  await page.evaluate(
    ([list, cl]) => {
      const w = window as unknown as W
      const store = w.__kimo.session.store
      const t = Date.now()
      const user = (id: string, name: string, color: string) => ({ id, name, color })
      w.__mp.set({
        room: "room1",
        relayUrl: "https://relay.maya.studio",
        owner: true,
        role: "edit",
        status: "synced",
        self: 1,
        selfState: { user: user("me", "Gui", "presence-slate"), origin: "user", owner: true },
        peers: (list as Peer[]).map((p) => ({
          peer: p.peer,
          role: "edit",
          origin: "user",
          changedAt: t - (p.quiet ?? 0),
          state: {
            user: user(p.name.toLowerCase(), p.name, p.color),
            origin: "user",
            selection: p.selection ?? (p.node ? [p.node] : []),
            ...(p.node
              ? {
                  text: {
                    node: p.node,
                    anchor: store.encodeTextPosition(p.node, p.anchor ?? p.focus ?? 0),
                    focus: store.encodeTextPosition(p.node, p.focus ?? 0),
                  },
                }
              : {}),
          },
        })),
        claims: cl,
        paused: [],
      })
    },
    [peers, claims] as const,
  )
  await settle(page)
}

async function enterEdit(page: Page, id: string) {
  const b = await worldBox(page, id)
  const p = await toPage(page, { x: b.x + 6, y: b.y + 14 })
  await page.mouse.dblclick(p.x, p.y)
  await page.locator(".canvas-host__text-editor").waitFor()
  await settle(page)
}

async function leaveEdit(page: Page) {
  await page.keyboard.press("Escape")
  await page.locator(".canvas-host__text-editor").waitFor({ state: "detached" })
  await settle(page)
}

const worldBox = (page: Page, id: string) =>
  page.evaluate((i) => {
    const l = (window as unknown as W).__kimo.canvas()?.layout()?.nodes.get(i)
    if (!l) throw new Error(`no layout ${i}`)
    return l.world
  }, id)

/** A world point in page px. */
const toPage = (page: Page, p: { x: number; y: number }) =>
  page.evaluate((pt) => {
    const host = (document.querySelector(".canvas-host") as HTMLElement).getBoundingClientRect()
    const v = (window as unknown as W).__kimo.session.ui.getState().viewport
    return { x: host.x + (pt.x - v.x) * v.zoom, y: host.y + (pt.y - v.y) * v.zoom }
  }, p)

/** A text layer's box in canvas px (relative to `.canvas-host`). */
async function screenBox(page: Page, id: string): Promise<Box> {
  const b = await worldBox(page, id)
  return page.evaluate((w) => {
    const v = (window as unknown as W).__kimo.session.ui.getState().viewport
    return { x: (w.x - v.x) * v.zoom, y: (w.y - v.y) * v.zoom, w: w.w * v.zoom, h: w.h * v.zoom }
  }, b)
}

/** Every caret group, bar, flag and range row in canvas px with their computed style. */
function measure(page: Page) {
  return page.evaluate(() => {
    const host = (document.querySelector(".canvas-host") as HTMLElement).getBoundingClientRect()
    const rel = (e: Element): Box => {
      const r = e.getBoundingClientRect()
      return { x: r.x - host.x, y: r.y - host.y, w: r.width, h: r.height }
    }
    const visible = (e: Element) => {
      const cs = getComputedStyle(e)
      return cs.display !== "none" && (e as HTMLElement).offsetParent !== null
    }
    return {
      carets: [...document.querySelectorAll('[data-testid="mp-text-caret"]')]
        .filter(visible)
        .map((g) => ({
          id: g.getAttribute("data-mp-text-caret") ?? "",
          box: rel(g),
          opacity: getComputedStyle(g).opacity,
          bars: [...g.querySelectorAll('[data-testid="mp-text-caret-bar"]')].map((b) => ({
            key: b.getAttribute("data-mp-text-bar"),
            box: rel(b),
            bg: getComputedStyle(b).backgroundColor,
          })),
          flags: [...g.querySelectorAll('[data-testid="mp-text-flag"]')].map((f) => {
            const cs = getComputedStyle(f)
            const label = f.querySelector(".mp-text-flag__label") as Element
            const lcs = getComputedStyle(label)
            const mark = f.querySelector("svg")
            return {
              key: f.getAttribute("data-mp-text-flag"),
              state: f.getAttribute("data-state"),
              display: cs.display,
              opacity: cs.opacity,
              box: cs.display === "none" ? null : rel(f),
              bg: cs.backgroundColor,
              radius: cs.borderRadius,
              padding: cs.padding,
              gap: cs.columnGap,
              text: (label.textContent ?? "").trim(),
              color: lcs.color,
              font: `${lcs.fontSize} ${lcs.fontWeight} ${lcs.fontFamily.split(",")[0]}`,
              mark: mark ? rel(mark) : null,
            }
          }),
        })),
      rows: [...document.querySelectorAll('[data-testid="mp-text-range-row"]')].map((r) => ({
        box: rel(r),
        bg: getComputedStyle(r).backgroundColor,
        opacity: getComputedStyle(r).opacity,
      })),
      tooltip: (() => {
        const t = document.querySelector('[data-testid="mp-text-tooltip"]')
        return t && visible(t) ? { box: rel(t), text: (t.textContent ?? "").trim() } : null
      })(),
      selections: [...document.querySelectorAll('[data-testid="mp-remote-selection"]')]
        .filter(visible)
        .map((s) => ({ box: rel(s), shadow: getComputedStyle(s).boxShadow })),
      tags: [...document.querySelectorAll('[data-testid="mp-selection-tag"]')].map(
        (t) => t.textContent,
      ),
    }
  })
}
type M = Awaited<ReturnType<typeof measure>>
type Flag = M["carets"][number]["flags"][number]

/** Collects board ≠ rendered diffs (one measured pass per state). */
class Diffs {
  readonly list: string[] = []
  readonly notes: string[] = []
  /** A measured value, logged with the result. */
  note(tag: string, value: unknown) {
    this.notes.push(`${tag}: ${JSON.stringify(value)}`)
  }
  check(tag: string, ok: boolean, detail: unknown) {
    if (!ok)
      this.list.push(`${tag}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`)
  }
  done(log: (...a: unknown[]) => void) {
    if (process.env.KIMO_E2E_VERBOSE === "1") log(this.notes.join("\n"))
    if (this.list.length) log(this.list.join("\n"))
    expect(this.list.length === 0, `board 41 live text diffs:\n${this.list.join("\n")}`)
  }
}

/** `BkOUb` / `Y2tdK`: the flag's own values. */
function checkFlag(
  d: Diffs,
  tag: string,
  f: Flag,
  o: { below: boolean; bg: string; fg: string; agent?: boolean },
) {
  d.check(
    `${tag} flag radius`,
    f.radius === (o.below ? "0px 3px 3px" : "3px 3px 3px 0px"),
    f.radius,
  )
  d.check(`${tag} flag padding`, f.padding === (o.agent ? "1px 5px 1px 2px" : "1px 5px"), f.padding)
  d.check(`${tag} flag gap`, f.gap === "3px", f.gap)
  d.check(`${tag} flag fill`, f.bg === o.bg, `${f.bg} ≠ ${o.bg}`)
  d.check(`${tag} label color`, f.color === o.fg, `${f.color} ≠ ${o.fg}`)
  d.check(`${tag} label font`, f.font === "11px 500 Inter", f.font)
  d.check(`${tag} flag height`, !!f.box && near(f.box.h, 15), f.box)
}

/** Bar: 2 × (1.2 × 20 × zoom), centered on the line box (y 2 of 28 at 100 %). */
function checkBar(
  d: Diffs,
  tag: string,
  bar: { box: Box; bg: string },
  lineTop: number,
  z: number,
  bg: string,
) {
  d.check(`${tag} bar width`, near(bar.box.w, 2, 0.01), bar.box.w)
  d.check(`${tag} bar height`, near(bar.box.h, 24 * z), bar.box.h)
  d.check(`${tag} bar y in line`, near(bar.box.y - lineTop, 2 * z), bar.box.y - lineTop)
  d.check(`${tag} bar fill`, bar.bg === bg, `${bar.bg} ≠ ${bg}`)
}

/** States A and B: you edit; Maya in the same layer (contenteditable range rects). */
async function statesAB(ctx: E2EContext, d: Diffs) {
  const { page } = ctx
  const clay = await token(page, "presence-clay")
  const onAccent = await token(page, "on-accent")

  // A: you edit the single line; Maya selected "together" (20..28), caret at its end.
  await enterEdit(page, T_A)
  await shared(page, [
    { peer: 2, name: "Maya", color: "presence-clay", node: T_A, anchor: 20, focus: 28 },
  ])
  let box = await screenBox(page, T_A)
  let m = await measure(page)
  d.note("A", { box, m })
  d.check("A one caret", m.carets.length === 1, m.carets.length)
  const a = m.carets[0]
  if (a) {
    d.check("A caret on line 1", near(a.box.y, box.y) && near(a.box.h, 28), a.box)
    checkBar(d, "A", a.bars[0] as { box: Box; bg: string }, box.y, 1, clay)
    const f = a.flags[0] as Flag
    d.check("A flag shown", f.state === "shown" && f.opacity === "1", f)
    checkFlag(d, "A", f, { below: true, bg: clay, fg: onAccent })
    // First line: the flag's top edge on the bar's bottom, left edge on the caret.
    const bar = (a.bars[0] as { box: Box }).box
    d.check("A flag below the bar", !!f.box && near(f.box.y, bar.y + bar.h), { f: f.box, bar })
    d.check("A flag left on the caret", !!f.box && near(f.box.x, bar.x), { f: f.box, bar })
    d.check("A label", f.text === "Maya", f.text)
  }
  d.check("A range: one row", m.rows.length === 1, m.rows)
  const row = m.rows[0]
  if (row && a) {
    d.check("A range full line height", near(row.box.h, 28) && near(row.box.y, box.y), row.box)
    d.check("A range opacity 0.24", row.opacity === "0.24", row.opacity)
    d.check("A range fill", row.bg === clay, row.bg)
    d.check("A caret at the range end", near(row.box.x + row.box.w, a.box.x, 1), {
      row: row.box,
      caret: a.box,
    })
    d.check("A range ~ 'together'", row.box.w > 60 && row.box.w < 100, row.box.w)
  }
  // The layer you edit: your outline only (no remote outline, no tag).
  d.check("A no remote outline", m.selections.length === 0 && m.tags.length === 0, m)
  await leaveEdit(page)

  // B: you edit the paragraph; Maya's caret on line 2 after "one canvas" (offset 44).
  await enterEdit(page, T_B)
  await shared(page, [{ peer: 2, name: "Maya", color: "presence-clay", node: T_B, focus: 44 }])
  box = await screenBox(page, T_B)
  m = await measure(page)
  d.note(`m@${new Error().stack?.split("\n")[1]?.trim()}`, m)
  const b = m.carets[0]
  d.check("B one caret", m.carets.length === 1, m.carets.length)
  if (b) {
    d.check("B caret on line 2", near(b.box.y, box.y + 28) && near(b.box.h, 28), {
      caret: b.box,
      box,
    })
    const bar = b.bars[0] as { box: Box; bg: string }
    checkBar(d, "B", bar, box.y + 28, 1, clay)
    const f = b.flags[0] as Flag
    checkFlag(d, "B", f, { below: false, bg: clay, fg: onAccent })
    // y -13 in the caret: the flag's bottom edge on the bar's top.
    d.check("B flag above the bar", !!f.box && near(f.box.y + f.box.h, bar.box.y), {
      f: f.box,
      bar: bar.box,
    })
    d.check("B flag y -13", !!f.box && near(f.box.y - b.box.y, -13), f.box && f.box.y - b.box.y)
  }
  d.check("B no range", m.rows.length === 0, m.rows)
  await leaveEdit(page)
}

/** C, E, F: on the canvas text (layers you are not editing). */
async function statesCEF(ctx: E2EContext, theme: Theme, d: Diffs) {
  const { page } = ctx
  const clay = await token(page, "presence-clay")
  const pine = await token(page, "presence-pine")
  const onAccent = await token(page, "on-accent")

  if (theme === "light") {
    // C: "right next" (45..55) selected, caret at its end, line 2.
    await shared(page, [
      { peer: 2, name: "Maya", color: "presence-clay", node: T_C, anchor: 45, focus: 55 },
    ])
    const box = await screenBox(page, T_C)
    const m = await measure(page)
    d.note(`m@${new Error().stack?.split("\n")[1]?.trim()}`, m)
    const c = m.carets[0]
    d.check("C one caret", m.carets.length === 1, m.carets.length)
    if (c) {
      d.check("C caret on line 2", near(c.box.y, box.y + 28), { caret: c.box, box })
      checkBar(d, "C", c.bars[0] as { box: Box; bg: string }, box.y + 28, 1, clay)
      checkFlag(d, "C", c.flags[0] as Flag, { below: false, bg: clay, fg: onAccent })
    }
    const row = m.rows[0]
    d.check(
      "C range one row on line 2",
      m.rows.length === 1 && !!row && near(row.box.y, box.y + 28) && near(row.box.h, 28),
      m.rows,
    )
    if (row && c) {
      d.check("C caret at the range end", near(row.box.x + row.box.w, c.box.x, 1), {
        row: row.box,
        caret: c.box,
      })
      // The canvas glyphs' width of "right next" (CanvasKit vs 2D canvas: 2 px).
      const want = await page.evaluate(() => {
        const ctx2 = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D
        ctx2.font = "20px Inter"
        return ctx2.measureText("right next").width
      })
      d.check("C range width = 'right next'", near(row.box.w, want, 2), { w: row.box.w, want })
      d.check("C range 0.24", row.opacity === "0.24" && row.bg === clay, row)
    }
    // Her 1.5 clay outline on the layer, no corner tag (the flag carries her name).
    const sel = m.selections[0]
    d.check(
      "C outline",
      m.selections.length === 1 &&
        !!sel &&
        sel.shadow.includes("1.5px") &&
        sel.shadow.includes(clay.replace(/\)$/, "")),
      m.selections,
    )
    if (sel)
      d.check(
        "C outline box",
        near(sel.box.x, box.x) && near(sel.box.w, box.w) && near(sel.box.h, box.h),
        { sel: sel.box, box },
      )
    d.check("C no corner tag", m.tags.length === 0, m.tags)
  }

  // E: the caret where line 1 soft-wraps (after "together, ", 31): end of the upper line.
  await shared(page, [{ peer: 2, name: "Maya", color: "presence-clay", node: T_B, focus: 31 }])
  let box = await screenBox(page, T_B)
  let m = await measure(page)
  d.note(`m@${new Error().stack?.split("\n")[1]?.trim()}`, m)
  const e = m.carets[0]
  if (e) {
    d.check("E on line 1", near(e.box.y, box.y), { caret: e.box, box })
    d.check("E at the line end", e.box.x > box.x + 0.8 * box.w && e.box.x <= box.x + box.w + 1, {
      caret: e.box,
      box,
    })
    const f = e.flags[0] as Flag
    const bar = (e.bars[0] as { box: Box }).box
    checkFlag(d, "E", f, { below: true, bg: clay, fg: onAccent })
    d.check(
      "E flag below (y 26)",
      !!f.box && near(f.box.y - e.box.y, 26),
      f.box && f.box.y - e.box.y,
    )
    d.check("E flag top on bar bottom", !!f.box && near(f.box.y, bar.y + bar.h), { f: f.box, bar })
  } else d.check("E caret", false, m)
  // After the same offset - 1 (still line 1, before the comma's end) the caret stays on line 1.

  // F: Maya and Jonas at one spot (line 2 after "together, on one " = 48); Jonas typed last.
  await shared(page, [{ peer: 2, name: "Maya", color: "presence-clay", node: T_B, focus: 48 }])
  await page.waitForTimeout(30)
  await shared(page, [
    { peer: 2, name: "Maya", color: "presence-clay", node: T_B, focus: 48 },
    { peer: 3, name: "Jonas", color: "presence-pine", node: T_B, focus: 48 },
  ])
  box = await screenBox(page, T_B)
  m = await measure(page)
  d.note(`m@${new Error().stack?.split("\n")[1]?.trim()}`, m)
  d.check(
    "F one group",
    m.carets.length === 1,
    m.carets.map((c) => c.id),
  )
  const g = m.carets[0]
  if (g) {
    const [first, second] = g.flags
    d.check(
      "F Jonas closest",
      first?.key === "peer:3" && second?.key === "peer:2",
      g.flags.map((f) => f.key),
    )
    d.check("F Jonas y -13", !!first?.box && near(first.box.y - g.box.y, -13), first?.box)
    d.check("F Maya y -30", !!second?.box && near(second.box.y - g.box.y, -30), second?.box)
    d.check(
      "F 2 apart",
      !!first?.box && !!second?.box && near(first.box.y - (second.box.y + second.box.h), 2),
      g.flags,
    )
    if (first) checkFlag(d, "F Jonas", first, { below: false, bg: pine, fg: onAccent })
    if (second) checkFlag(d, "F Maya", second, { below: false, bg: clay, fg: onAccent })
    // Bars never offset; Jonas's drawn last (on top).
    const xs = g.bars.map((b) => b.box.x)
    d.check(
      "F bars at one x",
      xs.every((x) => near(x, xs[0] as number, 0.01)),
      xs,
    )
    d.check(
      "F Jonas bar on top",
      g.bars[g.bars.length - 1]?.key === "peer:3" && g.bars[g.bars.length - 1]?.bg === pine,
      g.bars,
    )
  }
}

/** G and H: zoomed out below 50 %, and idle. */
async function statesGH(ctx: E2EContext, d: Diffs) {
  const { page } = ctx
  const clay = await token(page, "presence-clay")
  const onAccent = await token(page, "on-accent")

  // G: 40 %; "right next" selected, caret at its end (C's layer).
  await shared(page, [
    { peer: 2, name: "Maya", color: "presence-clay", node: T_C, anchor: 45, focus: 55 },
  ])
  await setView(page, { x: 600, y: 500, zoom: 0.4 })
  let box = await screenBox(page, T_C)
  let m = await measure(page)
  d.note(`m@${new Error().stack?.split("\n")[1]?.trim()}`, m)
  const g = m.carets[0]
  if (g) {
    const bar = g.bars[0] as { box: Box; bg: string }
    d.check("G bar 2 screen px", near(bar.box.w, 2, 0.01), bar.box)
    // Board E36ULB: 10 tall at 8 px type (1.2 × 8 = 9.6), y 0.5 in the 11 line.
    d.check("G bar ~10 tall", near(bar.box.h, 9.6, 0.5), bar.box.h)
    d.check("G line 11.2", near(g.box.h, 11.2), g.box.h)
    d.check("G bar fill", bar.bg === clay, bar.bg)
    const f = g.flags[0] as Flag
    d.check("G flag hidden", f.display === "none", f)
    d.check("G line 2", near(g.box.y, box.y + 11.2), { g: g.box, box })
  } else d.check("G caret", false, m)
  d.check(
    "G range stays",
    m.rows.length === 1 && near(m.rows[0]?.box.h ?? 0, 11.2) && m.rows[0]?.opacity === "0.24",
    m.rows,
  )
  // Hover the caret: the name as a Tooltip.
  if (g) {
    const host = await page.evaluate(() =>
      (document.querySelector(".canvas-host") as HTMLElement).getBoundingClientRect().toJSON(),
    )
    const bar = (g.bars[0] as { box: Box }).box
    await page.mouse.move(host.x + bar.x + 1, host.y + bar.y + bar.h / 2)
    await settle(page)
    m = await measure(page)
    d.note(`m@${new Error().stack?.split("\n")[1]?.trim()}`, m)
    d.check("G tooltip on hover", m.tooltip?.text === "Maya", m.tooltip)
    d.check("G flag still hidden", m.carets[0]?.flags[0]?.display === "none", m.carets[0]?.flags)
    if (m.tooltip)
      d.check("G tooltip above the caret", m.tooltip.box.y + m.tooltip.box.h <= bar.y, {
        t: m.tooltip.box,
        bar,
      })
    await page.mouse.move(5, 5)
    await settle(page)
  }
  await setView(page, { x: -100, y: 400, zoom: 1 })

  // H: Maya idle (no presence change for 61 s) in the paragraph, line 2 after "right next" (55).
  await shared(page, [
    {
      peer: 2,
      name: "Maya",
      color: "presence-clay",
      node: T_B,
      anchor: 45,
      focus: 55,
      quiet: 61_000,
    },
  ])
  box = await screenBox(page, T_B)
  m = await measure(page)
  d.note(`m@${new Error().stack?.split("\n")[1]?.trim()}`, m)
  const h = m.carets[0]
  if (h) {
    d.check("H caret 0.5", h.opacity === "0.5", h.opacity)
    const f = h.flags[0] as Flag
    d.check("H label", f.text === "Maya · idle", f.text)
    checkFlag(d, "H", f, { below: false, bg: clay, fg: onAccent })
    d.check("H range kept", m.rows.length === 1, m.rows)
    checkBar(d, "H", h.bars[0] as { box: Box; bg: string }, box.y + 28, 1, clay)
  } else d.check("H caret", false, m)
}

/** D: Kimo writes into Headline inside its Hero claim. */
async function stateD(ctx: E2EContext, d: Diffs) {
  const { page } = ctx
  const agent = await token(page, "agent")
  const onAccent = await token(page, "on-accent")
  const t = Date.now()
  await shared(
    page,
    [],
    [
      {
        holder: KIMO,
        ids: ["Hero000001"],
        since: t,
        renewed: t,
        label: "Kimo",
        local: true,
        expiresAt: t + 600_000,
        state: "live",
      },
    ],
  )
  await setView(page, { x: -100, y: -50, zoom: 1 })
  const cursorBefore = await page
    .locator(`[data-testid="agent-cursor"][data-origin="${KIMO}"]`)
    .count()
  const ok = await page.evaluate(
    ([id, holder]) =>
      (window as unknown as W).__kimo.session.store.apply(
        { op: "update", id, set: { content: "Plan less. Ship more tog" } },
        { origin: holder, label: "Agent edit" },
      ).ok,
    [T_D, KIMO] as const,
  )
  d.check("D write applied", ok, ok)
  await settle(page)
  const box = await screenBox(page, T_D)
  const m = await measure(page)
  d.note(`m@${new Error().stack?.split("\n")[1]?.trim()}`, m)
  const c = m.carets[0]
  if (c) {
    const bar = c.bars[0] as { box: Box; bg: string }
    checkBar(d, "D", bar, c.box.y, 1, agent)
    const f = c.flags[0] as Flag
    checkFlag(d, "D", f, { below: false, bg: agent, fg: onAccent, agent: true })
    d.check("D label", f.text === "Kimo", f.text)
    d.check("D AgentMark 12", !!f.mark && near(f.mark.w, 12) && near(f.mark.h, 12), f.mark)
    d.check("D mark at padding-left 2", !!f.mark && !!f.box && near(f.mark.x - f.box.x, 2), {
      mark: f.mark,
      f: f.box,
    })
    // The end of the write: after "tog" on line 2 (`M6NdhN`), the flag above.
    d.check("D caret on line 2", near(c.box.y, box.y + 28) && near(c.box.h, 28), { c: c.box, box })
    d.check("D flag y -13", !!f.box && near(f.box.y - c.box.y, -13), f.box)
  } else d.check("D caret", false, m)
  const during = await page.locator(`[data-testid="agent-cursor"][data-origin="${KIMO}"]`).count()
  d.check("D pointer hidden while the caret shows", during === 0, { cursorBefore, during })
  // Gone 3 s after the write.
  await page.waitForTimeout(3300)
  const after = await measure(page)
  d.check("D caret gone after 3 s", after.carets.length === 0, after.carets)
  const restored = await page.locator(`[data-testid="agent-cursor"][data-origin="${KIMO}"]`).count()
  d.check("D pointer restored", restored === cursorBefore, { cursorBefore, restored })
}

/** I: the flag fades after 3 s, hover shows it, typing shows it at once, drag hides it. */
async function stateI(ctx: E2EContext, d: Diffs) {
  const { page } = ctx
  await setView(page, { x: -100, y: 400, zoom: 1 })
  await shared(page, [{ peer: 2, name: "Maya", color: "presence-clay", node: T_B, focus: 44 }])
  let m = await measure(page)
  d.note(`m@${new Error().stack?.split("\n")[1]?.trim()}`, m)
  d.check("I shown at first", m.carets[0]?.flags[0]?.state === "shown", m.carets[0]?.flags)
  await page.waitForTimeout(3000 + 150 + 200)
  m = await measure(page)
  d.note(`m@${new Error().stack?.split("\n")[1]?.trim()}`, m)
  const f = m.carets[0]?.flags[0]
  d.check("I faded after 3 s", f?.state === "faded" && f.opacity === "0", f)
  const caret = m.carets[0]
  d.check("I caret stays", !!caret && caret.bars.length === 1, caret)
  if (caret) {
    const host = await page.evaluate(() =>
      (document.querySelector(".canvas-host") as HTMLElement).getBoundingClientRect().toJSON(),
    )
    const bar = (caret.bars[0] as { box: Box }).box
    await page.mouse.move(host.x + bar.x + 1, host.y + bar.y + bar.h / 2)
    await settle(page)
    m = await measure(page)
    d.note(`m@${new Error().stack?.split("\n")[1]?.trim()}`, m)
    d.check(
      "I hover shows the flag",
      m.carets[0]?.flags[0]?.state === "shown" && m.carets[0]?.flags[0]?.opacity === "1",
      m.carets[0]?.flags,
    )
    await page.mouse.move(5, 5)
    await settle(page)
    m = await measure(page)
    d.note(`m@${new Error().stack?.split("\n")[1]?.trim()}`, m)
    d.check("I leave fades it again", m.carets[0]?.flags[0]?.state === "faded", m.carets[0]?.flags)
  }
  // Maya types one character (any origin but yours stands for the room): the flag shows at once.
  await page.evaluate((id) => {
    ;(window as unknown as W).__kimo.session.store.editText(
      id,
      [{ op: "insert", at: 44, text: "s" }],
      {
        origin: "mcp:room-sim",
      },
    )
  }, T_B)
  await settle(page)
  m = await measure(page)
  d.note(`m@${new Error().stack?.split("\n")[1]?.trim()}`, m)
  d.check(
    "I typing shows it at once",
    m.carets[0]?.flags[0]?.state === "shown" && m.carets[0]?.flags[0]?.opacity === "1",
    m.carets[0]?.flags,
  )
  // You drag a selection across: flags hide while the button is down.
  const box = await screenBox(page, T_A)
  const host = await page.evaluate(() =>
    (document.querySelector(".canvas-host") as HTMLElement).getBoundingClientRect().toJSON(),
  )
  await page.mouse.move(host.x + box.x - 20, host.y + box.y + 100)
  await page.mouse.down()
  await page.mouse.move(host.x + box.x + 400, host.y + box.y + 140, { steps: 4 })
  await settle(page)
  m = await measure(page)
  d.note(`m@${new Error().stack?.split("\n")[1]?.trim()}`, m)
  d.check("I hidden while you drag", m.carets[0]?.flags[0]?.state === "hidden", m.carets[0]?.flags)
  await page.mouse.up()
  await settle(page)
  m = await measure(page)
  d.note(`m@${new Error().stack?.split("\n")[1]?.trim()}`, m)
  d.check("I back after the drag", m.carets[0]?.flags[0]?.state === "shown", m.carets[0]?.flags)
}

export const scenarios: Scenario[] = [
  ...(["light", "dark"] as const).map(
    (theme): Scenario => ({
      name: `board41 live text (${theme}): A, B in your edit (range rects), E, F${theme === "light" ? ", C" : ""} on the canvas text`,
      async run(ctx) {
        await openEditor(ctx, theme)
        const d = new Diffs()
        await statesAB(ctx, d)
        await statesCEF(ctx, theme, d)
        d.done(ctx.log)
      },
    }),
  ),
  ...(["light", "dark"] as const).map(
    (theme): Scenario => ({
      name: `board41 live text (${theme}): G zoomed out below 50 %, H idle`,
      async run(ctx) {
        await openEditor(ctx, theme)
        const d = new Diffs()
        await statesGH(ctx, d)
        d.done(ctx.log)
      },
    }),
  ),
  {
    name: "board41 live text: D agent caret inside its claim, I flag fade, hover, typing and drag",
    async run(ctx) {
      await openEditor(ctx, "light")
      const d = new Diffs()
      await stateD(ctx, d)
      await stateI(ctx, d)
      d.done(ctx.log)
    },
  },
]
