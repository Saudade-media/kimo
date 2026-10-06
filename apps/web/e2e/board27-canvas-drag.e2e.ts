/**
 * Board 27 §2 (c) / (e) in the real editor (desing.pen c2o3u, Y4vVe): drawing into an auto-layout
 * frame (InsertionBar sKpaJ, Draw Ghost + MeasurePill, hint), ⌘ draws an absolute child; dragging
 * a flow child reorders (Gap Placeholder + ghost + bar), drags out to the canvas, ⌘ keeps it
 * absolute, Esc cancels; ⌥-drag duplicates. One measured pass for the bar and the gap placeholder.
 */
import { join } from "node:path"
import type { Page } from "playwright"
import { settle } from "./qa-helpers"
import { type E2EContext, expect, type Scenario } from "./run"

type P = { x: number; y: number }

interface Hook {
  session: {
    store: {
      nodeIds(): string[]
      getNode(id: string): Record<string, unknown> | undefined
      children(parent: string | null): string[]
      apply(ops: unknown[], o: { origin: string }): { ok: boolean }
      undo(o: string): void
    }
    ui: {
      getState(): {
        selection: string[]
        setViewport(v: object): void
        select(ids: string[]): void
        setTool(t: string): void
      }
    }
  }
}
declare const window: Window & { __kimo: Hook }

const ROW = "FeatureRow"
const CARDS = ["CardOne001", "CardTwo001", "CardThree1"]

async function openEditor(page: Page, url: string) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(url)
  await page.getByRole("button", { name: "New file" }).first().click()
  await page.waitForURL(/#\/file\/[A-Za-z0-9]+$/)
  await page.locator('.canvas-host[data-ready="true"]').waitFor({ timeout: 30_000 })
  await settle(page)
  // c2o3u "Feature Row": 288×112 at (10, 24), row, gap 12, padding 12, align center, three
  // 80×88 cards (radius 8, #EEF0F3). Plus a free frame with a rectangle for ⌥-drag.
  await page.evaluate(
    ([row, cards]) => {
      const s = window.__kimo.session
      // A clean page (a new file may start with sample content).
      s.store.apply(
        s.store.children(null).map((id) => ({ op: "delete", id })),
        { origin: "user" },
      )
      s.store.apply(
        [
          {
            op: "insert",
            id: row,
            parent: null,
            node: {
              type: "frame",
              name: "Feature Row",
              x: 10,
              y: 24,
              w: 288,
              h: 112,
              fill: "#FFFFFF",
              layout: { dir: "row", gap: 12, pad: 12, align: "center" },
            },
          },
          ...(cards as string[]).map((id, i) => ({
            op: "insert",
            id,
            parent: row,
            node: {
              type: "frame",
              name: ["Card One", "Card Two", "Card Three"][i],
              w: 80,
              h: 88,
              radius: 8,
              fill: "#EEF0F3",
            },
          })),
          {
            op: "insert",
            id: "FreeFrame1",
            parent: null,
            node: { type: "frame", name: "Free", x: 400, y: 24, w: 200, h: 200, fill: "#FFFFFF" },
          },
          {
            op: "insert",
            id: "FreeRect01",
            parent: "FreeFrame1",
            node: { type: "rect", name: "Box", x: 20, y: 20, w: 40, h: 40, fill: "#D9D9D9" },
          },
        ],
        { origin: "user" },
      )
      s.ui.getState().setViewport({ x: -100, y: -100, zoom: 1 })
    },
    [ROW, CARDS] as const,
  )
  await settle(page)
}

async function toPage(page: Page, p: P) {
  const r = await page.locator(".canvas-host").boundingBox()
  if (!r) throw new Error("no canvas")
  return { x: r.x + (p.x + 100), y: r.y + (p.y + 100) }
}

const kids = (page: Page, id: string | null) =>
  page.evaluate((i) => window.__kimo.session.store.children(i), id)
const node = (page: Page, id: string) =>
  page.evaluate((i) => window.__kimo.session.store.getNode(i) ?? null, id)

/** Press at world `from`, move in steps to world `to` (modifiers held), run `mid`, release. */
async function gesture(
  page: Page,
  from: P,
  to: P,
  opts: { mods?: string[]; mid?: () => Promise<void>; cancel?: boolean } = {},
) {
  const a = await toPage(page, from)
  const b = await toPage(page, to)
  await page.mouse.move(a.x, a.y)
  for (const m of opts.mods ?? []) await page.keyboard.down(m)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++)
    await page.mouse.move(a.x + ((b.x - a.x) * i) / 10, a.y + ((b.y - a.y) * i) / 10)
  await settle(page)
  if (opts.mid) await opts.mid()
  if (opts.cancel) await page.keyboard.press("Escape")
  await page.mouse.up()
  for (const m of opts.mods ?? []) await page.keyboard.up(m)
  await settle(page)
}

async function shot(ctx: E2EContext, name: string) {
  if (ctx.shots) await ctx.page.screenshot({ path: join(ctx.shots, `${name}.png`) })
}

type Row = { what: string; want: unknown; got: unknown; ok: boolean }
const eq = (what: string, got: unknown, want: unknown, tol = 0.6): Row => ({
  what,
  want,
  got,
  ok:
    typeof want === "number" && typeof got === "number"
      ? Math.abs(got - want) <= tol
      : String(got) === String(want),
})
function table(ctx: E2EContext, title: string, rows: Row[]) {
  ctx.log(
    `${title}\n${rows.map((r) => `${r.ok ? "✓" : "✗"} ${r.what}: want ${String(r.want)} got ${String(r.got)}`).join("\n")}`,
  )
  const bad = rows.filter((r) => !r.ok)
  expect(
    bad.length === 0,
    `${title}: ${bad.map((b) => `${b.what} ${String(b.got)}≠${String(b.want)}`).join("; ")}`,
  )
}

function measure(page: Page, sels: Record<string, string>) {
  return page.evaluate((s) => {
    const out: Record<string, Record<string, number | string> | null> = {}
    for (const [k, sel] of Object.entries(s)) {
      const e = document.querySelector(sel)
      if (!e) {
        out[k] = null
        continue
      }
      const r = e.getBoundingClientRect()
      const cs = getComputedStyle(e)
      out[k] = {
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
        bg: cs.backgroundColor,
        border: `${parseFloat(cs.borderTopWidth)} ${cs.borderTopColor}`,
        outline: `${parseFloat(cs.outlineWidth)} ${cs.outlineColor}`,
        radius: parseFloat(cs.borderTopLeftRadius),
        opacity: cs.opacity,
        shadow: cs.boxShadow,
        display: cs.display,
        dir: cs.flexDirection,
        align: cs.alignItems,
      }
    }
    return out
  }, sels)
}

const tok = (page: Page, name: string) =>
  page.evaluate((n) => {
    const d = document.createElement("div")
    d.style.color = `var(--kimo-${n})`
    document.body.append(d)
    const c = getComputedStyle(d).color
    d.remove()
    return c
  }, name)

export const scenarios: Scenario[] = [
  {
    name: "board27 canvas drag: draw into auto layout (bar, ghost, slot insert, ⌘ absolute)",
    async run(ctx) {
      const { page, url } = ctx
      await openEditor(page, url)
      const canvas = await page.locator(".canvas-host").boundingBox()
      if (!canvas) throw new Error("no canvas")
      let drawn = { w: 0, h: 0 }
      await page.evaluate(() => window.__kimo.session.ui.getState().setTool("rect"))
      // Draw from inside the row (40, 30) to (106, 70): the pointer ends nearest Card One's
      // right half → slot 1, the gap between One and Two (the design's bar at x 105).
      await gesture(
        page,
        { x: 40, y: 30 },
        { x: 106, y: 70 },
        {
          mid: async () => {
            await shot(ctx, "b27-draw-into-layout")
            const m = await measure(page, {
              bar: '[data-testid="insertion-bar"]',
              cap: '[data-testid="insertion-bar"] .canvas-insertion-bar__cap',
              line: '[data-testid="insertion-bar"] .canvas-insertion-bar__bar',
              ghost: '[data-testid="draw-ghost"]',
              pill: '[data-testid="draw-pill"]',
              hint: '[data-testid="structure-hint"]',
            })
            const sel = await tok(page, "selection")
            const bar = m.bar
            const cap = m.cap
            const line = m.line
            expect(
              bar && cap && line && m.ghost && m.pill && m.hint,
              "bar, ghost, pill, hint shown",
            )
            // sKpaJ at (105, 36) 6×88 in the vignette's frame space → screen.
            table(ctx, "InsertionBar/Vertical sKpaJ (measured)", [
              eq("x", bar?.x, canvas.x + 100 + 105),
              eq("y", bar?.y, canvas.y + 100 + 36),
              eq("w", bar?.w, 6),
              eq("h", bar?.h, 88),
              eq("layout", bar?.dir, "column"),
              eq("alignItems", bar?.align, "center"),
              eq("cap w", cap?.w, 6),
              eq("cap h", cap?.h, 2),
              eq("cap fill", cap?.bg, sel),
              eq("bar w", line?.w, 2),
              eq("bar h", line?.h, 84),
              eq("bar fill", line?.bg, sel),

              eq("ghost border", m.ghost?.border, `1 ${sel}`),
              eq("ghost fill", m.ghost?.bg, "rgba(47, 107, 255, 0.08)"),
              eq("pill fill", m.pill?.bg, sel),
              eq(
                "pill radius ≥ h/2",
                (m.pill?.radius as number) >= (m.pill?.h as number) / 2,
                true,
              ),
              eq(
                "pill x = ghost right + 8",
                m.pill?.x,
                (m.ghost?.x as number) + (m.ghost?.w as number) + 8,
              ),
              eq(
                "pill centred on the ghost",
                (m.pill?.y as number) + (m.pill?.h as number) / 2,
                (m.ghost?.y as number) + (m.ghost?.h as number) / 2,
              ),
            ])
            const text = await page.locator('[data-testid="structure-hint"]').innerText()
            expect(text.includes("Release → inserts at 2 · ⌘ draws on top"), `hint: ${text}`)
            drawn = { w: m.ghost?.w as number, h: m.ghost?.h as number }
            // Nothing written while drawing: the row still has its three cards.
            expect((await kids(page, ROW)).length === 3, "row untouched while drawing")
          },
        },
      )
      const after = await kids(page, ROW)
      expect(after.length === 4, `inserted into the row: ${after.join()}`)
      const added = after[1] as string
      const n = await node(page, added)
      ctx.log("inserted", JSON.stringify(n))
      expect(after[0] === CARDS[0] && after[2] === CARDS[1], "child 2 (between One and Two)")
      expect(
        n?.type === "rect" && n?.w === drawn.w && n?.h === drawn.h,
        `drawn size = the ghost's, fixed W/H (${drawn.w}×${drawn.h})`,
      )
      expect(n?.x === undefined && n?.position === undefined, "a flow child")
      expect((await page.locator('[data-testid="insertion-bar"]').count()) === 0, "bar gone")

      // ⌘ draws an absolute child instead (no slot).
      await page.evaluate(() => window.__kimo.session.ui.getState().setTool("rect"))
      await gesture(page, { x: 30, y: 30 }, { x: 60, y: 50 }, { mods: ["Meta"] })
      const k2 = await kids(page, ROW)
      const abs = await node(page, k2[k2.length - 1] as string)
      ctx.log("⌘ draw", JSON.stringify(abs))
      expect(k2.length === 5 && abs?.position === "absolute", "⌘ → absolute child")
      expect(abs?.x === 20 && abs?.y === 6, "absolute at the drawn place (frame-local)")

      // Text clicked into the row's padding takes the clicked slot as a flow child.
      await page.evaluate(() => window.__kimo.session.ui.getState().setTool("text"))
      const tp = await toPage(page, { x: 20, y: 130 })
      await page.mouse.click(tp.x, tp.y)
      await page.getByRole("textbox", { name: "Edit text" }).waitFor()
      await page.keyboard.type("Hi")
      await page.keyboard.press("Escape")
      await settle(page)
      const k3 = await kids(page, ROW)
      const text = await node(page, k3[0] as string)
      ctx.log("text", JSON.stringify(text))
      expect(text?.type === "text" && text?.x === undefined, "text is the row's first flow child")
    },
  },
  {
    name: "board27 canvas drag: reorder in auto layout, drag out, ⌘ absolute, Esc, ⌥ duplicate",
    async run(ctx) {
      const { page, url } = ctx
      await openEditor(page, url)
      const canvas = await page.locator(".canvas-host").boundingBox()
      if (!canvas) throw new Error("no canvas")
      const select = (id: string) =>
        page.evaluate((i) => window.__kimo.session.ui.getState().select([i]), id)

      // Reorder: Card Three dragged into the gap between One and Two.
      await select(CARDS[2] as string)
      await gesture(
        page,
        { x: 246, y: 80 },
        { x: 106, y: 82 },
        {
          mid: async () => {
            await page.locator('[data-testid="drag-ghost"]').waitFor()
            await page.waitForTimeout(150)
            await settle(page)
            await shot(ctx, "b27-reorder")
            const m = await measure(page, {
              gap: '[data-testid="gap-placeholder"]',
              ghost: '[data-testid="drag-ghost"]',
              bar: '[data-testid="insertion-bar"]',
              hint: '[data-testid="structure-hint"]',
            })
            const strong = await tok(page, "border-strong")
            const shadowStrong = await tok(page, "shadow-strong")
            const sel = await tok(page, "selection")
            table(ctx, "Gap Placeholder m3Qwz / dragged EERUC (measured)", [
              eq("gap x", m.gap?.x, canvas.x + 100 + 206),
              eq("gap y", m.gap?.y, canvas.y + 100 + 36),
              eq("gap w", m.gap?.w, 80),
              eq("gap h", m.gap?.h, 88),
              eq("gap stroke", m.gap?.border, `1 ${strong}`),
              eq("gap radius", m.gap?.radius, 8),
              eq("gap fill", m.gap?.bg, "rgba(0, 0, 0, 0)"),
              eq("ghost opacity", m.ghost?.opacity, "0.85"),
              eq(
                "ghost stroke 1.5 + shadow 0 8 20",
                String(m.ghost?.shadow).replace(/\s+/g, " "),
                `${sel} 0px 0px 0px 1.5px inset, ${shadowStrong} 0px 8px 20px 0px`,
              ),
              eq("ghost radius", m.ghost?.radius, 8),
              eq("ghost w", m.ghost?.w, 80),
              eq("bar x (slot 1)", m.bar?.x, canvas.x + 100 + 105),
              eq("bar h", m.bar?.h, 88),
            ])
            expect(
              /Outside → to Canvas · ⌘ keeps it absolute/.test(
                await page.locator('[data-testid="structure-hint"]').innerText(),
              ),
              "move hint",
            )
          },
        },
      )
      let order = await kids(page, ROW)
      expect(order.join() === [CARDS[0], CARDS[2], CARDS[1]].join(), `reordered: ${order.join()}`)
      await page.evaluate(() => window.__kimo.session.store.undo("user"))
      await settle(page)
      order = await kids(page, ROW)
      expect(order.join() === CARDS.join(), "reorder is one undo step")

      // Esc cancels a drag out.
      await select(CARDS[1] as string)
      await gesture(page, { x: 154, y: 80 }, { x: 160, y: 260 }, { cancel: true })
      expect((await kids(page, ROW)).join() === CARDS.join(), "Esc keeps Card Two in the row")

      // Drag out: Card Two leaves the row → page root, keeps its size and world place.
      await select(CARDS[1] as string)
      await gesture(page, { x: 154, y: 80 }, { x: 160, y: 260 })
      const two = await node(page, CARDS[1] as string)
      ctx.log("dragged out", JSON.stringify(two))
      expect(two?.parent === null, "Card Two is a root now")
      expect(two?.w === 80 && two?.h === 88, "keeps its size")
      // World place + the drag delta (6, 180); x may snap to the row's edges.
      expect(
        Math.abs((two?.x as number) - 120) <= 6 && two?.y === 216,
        "keeps its world place (+ the drag delta)",
      )
      expect((await kids(page, ROW)).length === 2, "slot collapsed")
      await page.evaluate(() => window.__kimo.session.store.undo("user"))
      await settle(page)
      expect((await kids(page, ROW)).join() === CARDS.join(), "drag out is one undo step")

      // ⌘ keeps it in the row, absolute.
      await select(CARDS[0] as string)
      await gesture(page, { x: 62, y: 80 }, { x: 70, y: 90 }, { mods: ["Meta"] })
      const one = await node(page, CARDS[0] as string)
      ctx.log("⌘ drag", JSON.stringify(one))
      expect(one?.parent === ROW && one?.position === "absolute", "⌘ → absolute in the row")
      expect(one?.x === 20 && one?.y === 22, "absolute at the dragged place")

      // ⌥-drag duplicates the free rectangle; the original stays.
      await select("FreeRect01")
      await gesture(page, { x: 440, y: 64 }, { x: 500, y: 104 }, { mods: ["Alt"] })
      const free = await kids(page, "FreeFrame1")
      const copy = free.find((i) => i !== "FreeRect01")
      const orig = await node(page, "FreeRect01")
      const dup = copy ? await node(page, copy) : null
      ctx.log("⌥ drag", JSON.stringify({ orig, dup }))
      expect(free.length === 2 && dup?.name === "Box", "a copy exists")
      expect(orig?.x === 20 && orig?.y === 20, "original unmoved")
      expect(dup?.x === 80 && dup?.y === 60, "copy moved with the pointer")
      const sel = await page.evaluate(() => window.__kimo.session.ui.getState().selection)
      expect(sel.length === 1 && sel[0] === copy, "copy selected")
    },
  },
]
