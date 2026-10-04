/**
 * Board 27 §5 "Tools" (desing.pen NkFBd) in the real editor: the shape slot + flyout (rkFut),
 * Polygon & Star tools, panel section and canvas handles (ICb89), Line / Arrow, and the
 * path-edit toolbar (J5Vng: Sharp/Smooth, scissors, delete segment, Done). Each surface gets
 * ONE measured pass (getComputedStyle + getBoundingClientRect vs the node values), logged.
 */
import { join } from "node:path"
import type { Page } from "playwright"
import { settle } from "./qa-helpers"
import { type E2EContext, expect, type Scenario } from "./run"

type P = { x: number; y: number }
type Box = { x: number; y: number; w: number; h: number }

interface Hook {
  session: {
    store: {
      nodeIds(): string[]
      getNode(id: string): Record<string, unknown> | undefined
      apply(ops: unknown[], o: { origin: string }): { ok: boolean }
      undo(o: string): void
    }
    ui: {
      getState(): {
        selection: string[]
        tool: string
        viewport: { x: number; y: number; zoom: number }
        setViewport(v: object): void
        select(ids: string[]): void
        setTool(t: string): void
      }
    }
  }
  canvas(): {
    layout(): { nodes: Map<string, { world: Box }> } | null
    editingPath(): string | null
  } | null
}
declare const window: Window & { __kimo: Hook }

async function openEditor(page: Page, url: string) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(url)
  await page.getByRole("button", { name: "New file" }).click()
  await page.waitForURL(/#\/file\/[A-Za-z0-9]+$/)
  await page.locator('.canvas-host[data-ready="true"]').waitFor({ timeout: 30_000 })
  await settle(page)
  await page.evaluate(() =>
    window.__kimo.session.ui.getState().setViewport({ x: -100, y: -100, zoom: 1 }),
  )
  await settle(page)
}

const node = (page: Page, id: string) =>
  page.evaluate((i) => window.__kimo.session.store.getNode(i) ?? null, id)
const ui = (page: Page) =>
  page.evaluate(() => {
    const s = window.__kimo.session.ui.getState()
    return { selection: s.selection, tool: s.tool }
  })
const ids = (page: Page) => page.evaluate(() => window.__kimo.session.store.nodeIds())

async function toPage(page: Page, p: P) {
  const r = await page.locator(".canvas-host").boundingBox()
  if (!r) throw new Error("no canvas")
  const v = await page.evaluate(() => window.__kimo.session.ui.getState().viewport)
  return { x: r.x + (p.x - v.x) * v.zoom, y: r.y + (p.y - v.y) * v.zoom }
}

async function drag(page: Page, from: P, to: P, opts: { shift?: boolean } = {}) {
  if (opts.shift) await page.keyboard.down("Shift")
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++)
    await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8)
  await settle(page)
  await page.mouse.up()
  if (opts.shift) await page.keyboard.up("Shift")
  await settle(page)
}

async function shot(ctx: E2EContext, name: string) {
  if (ctx.shots) await ctx.page.screenshot({ path: join(ctx.shots, `${name}.png`) })
}

/** One measured read per selector: box + the computed values the design nodes specify. */
function measure(page: Page, sels: Record<string, string>) {
  return page.evaluate((s) => {
    const out: Record<string, Record<string, unknown> | null> = {}
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
        pad: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft]
          .map((p) => String(parseFloat(p)))
          .join(" "),
        gap: parseFloat(cs.columnGap) || parseFloat(cs.rowGap) || 0,
        bg: cs.backgroundColor,
        color: cs.color,
        fs: parseFloat(cs.fontSize),
        fw: cs.fontWeight,
        lh: cs.lineHeight,
        ff: cs.fontFamily.split(",")[0]?.replace(/"/g, "").trim(),
        radius: parseFloat(cs.borderTopLeftRadius),
        shadow: cs.boxShadow,
        opacity: cs.opacity,
        display: cs.display,
        justify: cs.justifyContent,
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

type Row = { what: string; want: unknown; got: unknown; ok: boolean }
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
const eq = (what: string, got: unknown, want: unknown, tol = 0.6): Row => ({
  what,
  want,
  got,
  ok:
    typeof want === "number" && typeof got === "number"
      ? Math.abs(got - want) <= tol
      : String(got) === String(want),
})

export const scenarios: Scenario[] = [
  {
    name: "board27 tools: shape slot + flyout (rkFut), shortcuts, polygon / star / line / arrow drawing",
    async run(ctx) {
      const { page, url } = ctx
      await openEditor(page, url)
      // Polygon has no key (the design's ⇧P stays Prompt's): the flyout arms it, the slot then
      // shows pentagon active.
      await page.locator(".canvas-host").focus()
      await page.locator(".shape-slot__caret").click()
      await page.locator('.shape-flyout [data-tool="polygon"]').click()
      await settle(page)
      expect((await ui(page)).tool === "polygon", "flyout → polygon tool")
      const slotTool = page.locator('.shape-slot [data-slot="shape"]')
      expect((await slotTool.getAttribute("data-tool")) === "polygon", "slot shows Polygon")
      expect((await slotTool.getAttribute("aria-pressed")) === "true", "slot active")
      await page.locator(".shape-slot__caret").click()
      await page.locator(".shape-flyout").waitFor()
      await shot(ctx, "b27-shape-flyout")
      const m = await measure(page, {
        bar: ".floating-toolbar",
        slot: ".shape-slot",
        tool: '.shape-slot [data-slot="shape"]',
        caret: ".shape-slot__caret",
        caretIcon: ".shape-slot__caret svg",
        menu: ".shape-flyout",
        row: '.shape-flyout [data-tool="rectangle"]',
        current: '.shape-flyout [data-tool="polygon"]',
        currentIcon: '.shape-flyout [data-tool="polygon"] .kimo-menu-item-dense__check',
        currentLabel: '.shape-flyout [data-tool="polygon"] .kimo-menu-item-dense__label',
        firstRow: '.shape-flyout [data-tool="rectangle"]',
        otherIcon: '.shape-flyout [data-tool="rectangle"] .kimo-menu-item-dense__check',
        meta: '.shape-flyout [data-tool="arrow"] .kimo-menu-item-dense__meta',
        label: '.shape-flyout [data-tool="rectangle"] .kimo-menu-item-dense__label',
      })
      const [tertiary, secondary, primary, hover, accent] = await Promise.all([
        tok(page, "text-tertiary"),
        tok(page, "text-secondary"),
        tok(page, "text-primary"),
        page.evaluate(() => {
          const d = document.createElement("div")
          d.style.background = "var(--kimo-bg-hover)"
          document.body.append(d)
          const c = getComputedStyle(d).backgroundColor
          d.remove()
          return c
        }),
        page.evaluate(() => {
          const d = document.createElement("div")
          d.style.background = "var(--kimo-accent)"
          document.body.append(d)
          const c = getComputedStyle(d).backgroundColor
          d.remove()
          return c
        }),
      ])
      const labels = await page.$$eval(".shape-flyout .kimo-menu-item-dense", (els) =>
        els.map(
          (e) =>
            `${e.querySelector(".kimo-menu-item-dense__label")?.textContent}|${e.querySelector(".kimo-menu-item-dense__meta")?.textContent}`,
        ),
      )
      const b = m.bar as unknown as Box
      const menu = m.menu as unknown as Box
      const slot = m.slot as unknown as Box
      table(ctx, "rkFut shape slot + flyout (measured)", [
        eq("toolbar h (kG342 48)", b.h, 48),
        eq("toolbar padding 6", m.bar?.pad, "6 6 6 6"),
        eq("slot jkzTd w 46", slot.w, 46),
        eq("slot h 36", slot.h, 36),
        eq("slot gap 0", m.slot?.gap, 0),
        eq("slot align center", m.slot?.align, "center"),
        eq("tool 36", m.tool?.w, 36),
        eq("tool active fill $accent", m.tool?.bg, accent),
        eq("caret XELvA 10 × 10", `${m.caretIcon?.w}×${m.caretIcon?.h}`, "10×10"),
        eq("caret x = tool right", (m.caret?.x as number) - ((m.tool?.x as number) + 36), 0),
        eq("caret color $text-tertiary", m.caret?.color, tertiary),
        eq("flyout MBxVC w 200", menu.w, 200),
        eq("flyout bottom 8 above toolbar", b.y - (menu.y + menu.h), 8),
        eq("flyout padding 4", m.menu?.pad, "4 4 4 4"),
        eq("flyout h (6 × 28 + 5 + 8) 181", menu.h, 181),
        eq("row h 28", m.row?.h, 28),
        eq("row padding [0, 8]", m.row?.pad, "0 8 0 8"),
        eq("row gap 8", m.row?.gap, 8),
        eq("label 12 sans", `${m.label?.fs} ${m.label?.ff}`, "12 Inter"),
        eq("label weight normal", m.label?.fw, "400"),
        eq("current row ApNUl fill $bg-hover", m.current?.bg, hover),
        eq("current icon $text-primary", m.currentIcon?.color, primary),
        eq("current label weight normal", m.currentLabel?.fw, "400"),
        eq("other rows unfilled", m.firstRow?.bg, "rgba(0, 0, 0, 0)"),
        eq("other icon $text-secondary", m.otherIcon?.color, secondary),
        eq("meta mono 11 tertiary", `${m.meta?.fs} ${m.meta?.color}`, `11 ${tertiary}`),
        eq(
          "items + meta",
          labels.join(","),
          "Rectangle|R,Ellipse|O,Line|L,Arrow|⇧L,Polygon|undefined,Star|⇧S",
        ),
      ])
      // Choosing Star in the flyout arms it; the slot now shows Star.
      await page.locator('.shape-flyout [data-tool="star"]').click()
      await settle(page)
      expect((await ui(page)).tool === "star", "flyout → star tool")
      expect((await slotTool.getAttribute("data-tool")) === "star", "slot shows Star")
      expect((await page.locator(".shape-flyout").count()) === 0, "flyout closed")

      // Star drag with ⇧: equal W/H, polygon node with star, 5 points.
      let before = await ids(page)
      await drag(page, await toPage(page, { x: 0, y: 0 }), await toPage(page, { x: 130, y: 100 }), {
        shift: true,
      })
      let fresh = (await ids(page)).filter((i) => !before.includes(i))
      const star = fresh[0] ? await node(page, fresh[0]) : null
      ctx.log("star", JSON.stringify(star))
      expect(
        star?.type === "polygon" && star.sides === 5 && typeof star.star === "object",
        "star = polygon + star, 5 points",
      )
      expect(star?.w === star?.h && star?.w === 130, "⇧ keeps W = H")
      expect((await ui(page)).tool === "select", "back to Move after drawing")

      // Polygon: default 3 sides (triangle), the slot remembers Star until another shape.
      await page.locator(".shape-slot__caret").click()
      await page.locator('.shape-flyout [data-tool="polygon"]').click()
      await settle(page)
      before = await ids(page)
      await drag(page, await toPage(page, { x: 200, y: 0 }), await toPage(page, { x: 300, y: 90 }))
      fresh = (await ids(page)).filter((i) => !before.includes(i))
      const poly = fresh[0] ? await node(page, fresh[0]) : null
      expect(poly?.type === "polygon" && poly.sides === 3 && poly.star === undefined, "triangle")

      // Line (L) and Arrow (⇧L): plain paths; ⇧ constrains to 45°.
      await page.keyboard.press("l")
      before = await ids(page)
      await drag(
        page,
        await toPage(page, { x: 0, y: 200 }),
        await toPage(page, { x: 120, y: 214 }),
        {
          shift: true,
        },
      )
      fresh = (await ids(page)).filter((i) => !before.includes(i))
      const line = fresh[0] ? await node(page, fresh[0]) : null
      ctx.log("line", JSON.stringify(line))
      expect(
        line?.type === "path" && line.h === 0 && /^Line \d+$/.test(String(line.name)),
        "⇧ line is horizontal",
      )
      await page.keyboard.press("Shift+L")
      before = await ids(page)
      await drag(page, await toPage(page, { x: 0, y: 260 }), await toPage(page, { x: 120, y: 300 }))
      fresh = (await ids(page)).filter((i) => !before.includes(i))
      const arrow = fresh[0] ? await node(page, fresh[0]) : null
      ctx.log("arrow", JSON.stringify(arrow))
      expect(
        arrow?.type === "path" && (String(arrow.d).match(/M/g) ?? []).length === 2,
        "arrow = segment + head",
      )
      expect(arrow?.fill === undefined, "open path: no fill")
      // Long-press on the slot opens the flyout instead of activating.
      const t = await slotTool.boundingBox()
      if (!t) throw new Error("slot")
      await page.mouse.move(t.x + 18, t.y + 18)
      await page.mouse.down()
      await page.waitForTimeout(550)
      await page.mouse.up()
      await settle(page)
      expect((await page.locator(".shape-flyout").count()) === 1, "long-press opens the flyout")
      await page.keyboard.press("Escape")
    },
  },
  {
    name: "board27 tools: Polygon section (ICb89) — switch, sides/points, ratio, canvas handles",
    async run(ctx) {
      const { page, url } = ctx
      await openEditor(page, url)
      await page.evaluate(() => {
        const k = window.__kimo
        k.session.store.apply(
          [
            {
              op: "insert",
              id: "starNode0001",
              parent: null,
              node: {
                type: "polygon",
                name: "Star 1",
                x: 0,
                y: 0,
                w: 130,
                h: 130,
                sides: 5,
                star: {},
                fill: "#C9D7FF",
              },
            },
          ],
          { origin: "user" },
        )
        k.session.ui.getState().select(["starNode0001"])
      })
      await settle(page)
      const sec = ".rp-polygon"
      await page.locator(sec).waitFor()
      await shot(ctx, "b27-polygon-section-star")
      const m = await measure(page, {
        sec,
        header: `${sec} .rp-polygon__header`,
        title: `${sec} .rp-polygon__title`,
        kind: `${sec} .rp-polygon__kind`,
        row: `${sec} .rp-row`,
        field: `${sec} .kimo-prop-field`,
        hint: `${sec} .rp-polygon__hint`,
      })
      const fields = await page.$$eval(`${sec} .kimo-prop-field`, (els) =>
        els.map(
          (e) =>
            `${e.querySelector(".kimo-prop-field__prefix")?.textContent}=${(e.querySelector("input") as HTMLInputElement | null)?.value}`,
        ),
      )
      const [primary, tertiary] = await Promise.all([
        tok(page, "text-primary"),
        tok(page, "text-tertiary"),
      ])
      table(ctx, "ICb89 Section · Star (measured)", [
        eq("section padding [12,12,16,12]", m.sec?.pad, "12 12 16 12"),
        eq("section gap 8", m.sec?.gap, 8),
        eq("header space-between", m.header?.justify, "space-between"),
        eq("header align center", m.header?.align, "center"),
        eq("header h 28", m.header?.h, 28),
        eq("title text", await page.locator(`${sec} .rp-polygon__title`).textContent(), "Star"),
        eq("title 12 / normal", `${m.title?.fs}/${m.title?.fw}`, "12/400"),
        eq("title $text-primary", m.title?.color, primary),
        eq("kind h 28", m.kind?.h, 28),
        eq("row gap 8", m.row?.gap, 8),
        eq("field h 28", m.field?.h, 28),
        eq("fields", fields.join(","), "Points=5,Radius=0,Ratio=38 %"),
        eq(
          "hint 11 / 1.45",
          `${m.hint?.fs}/${parseFloat(String(m.hint?.lh)) / (m.hint?.fs as number)}`,
          "11/1.45",
        ),
        eq("hint $text-tertiary", m.hint?.color, tertiary),
        eq(
          "hint copy",
          await page.locator(`${sec} .rp-polygon__hint`).textContent(),
          "Ratio = inner ÷ outer radius (1–99 %). Drag the inner handle on canvas.",
        ),
      ])
      // Points 7.
      const points = page.locator(`${sec} .kimo-prop-field input`).first()
      await points.fill("7")
      await points.press("Enter")
      await settle(page)
      expect((await node(page, "starNode0001"))?.sides === 7, "Points → sides 7")
      // Ratio 50 %.
      const ratio = page.locator(`${sec} .kimo-prop-field input`).nth(2)
      await ratio.fill("50")
      await ratio.press("Enter")
      await settle(page)
      expect(
        JSON.stringify((await node(page, "starNode0001"))?.star) === JSON.stringify({ ratio: 0.5 }),
        "Ratio 50 % → star.ratio 0.5",
      )
      // Canvas: drag the ratio handle (on the top axis at the inner radius) up to 80 %.
      const handle = await toPage(page, { x: 65, y: 65 - 65 * 0.5 })
      await drag(page, handle, await toPage(page, { x: 65, y: 65 - 65 * 0.8 }))
      const after = (await node(page, "starNode0001"))?.star as { ratio?: number }
      ctx.log("after ratio drag", JSON.stringify(after))
      expect(after?.ratio === 0.8, `ratio handle drag → 0.8 (got ${after?.ratio})`)
      await page.evaluate(() => window.__kimo.session.store.undo("user"))
      await settle(page)
      expect(
        ((await node(page, "starNode0001"))?.star as { ratio?: number })?.ratio === 0.5,
        "one undo step per handle drag",
      )
      // Radius handle (13 px under the top point): drag down 6 → radius 6.
      const rh = await toPage(page, { x: 65, y: 13 })
      await drag(page, rh, { x: rh.x, y: rh.y + 6 })
      expect((await node(page, "starNode0001"))?.radius === 6, "radius handle → 6")
      await shot(ctx, "b27-star-handles")
      // Switch to Polygon: star removed, Ratio row dimmed (OciK3 opacity 0.4) with "—".
      await page.locator(`${sec} [role="radio"][data-value="polygon"]`).click()
      await settle(page)
      expect((await node(page, "starNode0001"))?.star === undefined, "Polygon: star removed")
      const off = await measure(page, {
        row2: `${sec} .rp-polygon__row--off`,
        title: `${sec} .rp-polygon__title`,
      })
      table(ctx, "ICb89 Section · Polygon (measured)", [
        eq("row 2 opacity 0.4", off.row2?.opacity, "0.4"),
        eq("title", await page.locator(`${sec} .rp-polygon__title`).textContent(), "Polygon"),
        eq(
          "first prefix Sides",
          await page.locator(`${sec} .kimo-prop-field__prefix`).first().textContent(),
          "Sides",
        ),
        eq(
          "hint",
          await page.locator(`${sec} .rp-polygon__hint`).textContent(),
          "Ratio only applies to stars.",
        ),
      ])
      await shot(ctx, "b27-polygon-section-polygon")
    },
  },
  {
    name: "board27 tools: path-edit toolbar (J5Vng) — segment select + delete, smooth/sharp, cut, Done",
    async run(ctx) {
      const { page, url } = ctx
      await openEditor(page, url)
      await page.evaluate(() => {
        const k = window.__kimo
        k.session.store.apply(
          [
            {
              op: "insert",
              id: "pathNode0b27",
              parent: null,
              node: {
                type: "path",
                name: "Wave",
                x: 0,
                y: 100,
                w: 300,
                h: 100,
                d: "M0 100L100 0L200 100L300 0",
                viewBox: [0, 0, 300, 100],
                stroke: { paint: "#1B1F24", width: 2 },
              },
            },
          ],
          { origin: "user" },
        )
        k.session.ui.getState().select(["pathNode0b27"])
      })
      await settle(page)
      await page.locator(".canvas-host").focus()
      await page.keyboard.press("Enter")
      await settle(page)
      const bar = page.locator(".path-edit-bar")
      await bar.waitFor()
      expect(await page.locator(".floating-toolbar").isHidden(), "floating toolbar replaced")
      await shot(ctx, "b27-path-edit-bar")
      const m = await measure(page, {
        bar: ".path-edit-bar",
        sel: '.path-edit-bar [data-mode="select"]',
        selIcon: '.path-edit-bar [data-mode="select"] svg',
        add: '.path-edit-bar [data-mode="add"]',
        div: ".path-edit-bar__divider",
        kind: ".path-edit-bar__kind",
        done: ".path-edit-bar__done",
      })
      const top = await toPage(page, { x: 0, y: 100 })
      const [bgApp, accent] = await Promise.all([
        page.evaluate(() => {
          const d = document.createElement("div")
          d.style.background = "var(--kimo-bg-app)"
          document.body.append(d)
          const c = getComputedStyle(d).backgroundColor
          d.remove()
          return c
        }),
        page.evaluate(() => {
          const d = document.createElement("div")
          d.style.background = "var(--kimo-accent)"
          document.body.append(d)
          const c = getComputedStyle(d).backgroundColor
          d.remove()
          return c
        }),
      ])
      const order = await page.$$eval(".path-edit-bar > *", (els) =>
        els.map(
          (e) =>
            e.getAttribute("data-pen") ??
            e.querySelector("[data-pen]")?.getAttribute("data-pen") ??
            (e.classList.contains("path-edit-bar__divider") ? "div" : e.className),
        ),
      )
      const b = m.bar as unknown as Box
      table(ctx, "J5Vng path edit toolbar (measured)", [
        eq("bar h 40", b.h, 40),
        eq("bar w 369", b.w, 369, 2),
        eq("padding 4", m.bar?.pad, "4 4 4 4"),
        eq("gap 2", m.bar?.gap, 2),
        eq("fill $bg-app", m.bar?.bg, bgApp),
        eq("radius pill", (m.bar?.radius as number) >= 20, true),
        eq("12 px above the path bounds", top.y - (b.y + b.h), 12, 1),
        eq("centred on the path", b.x + b.w / 2 - (top.x + 150), 0, 1),
        eq("tool 32 × 32", `${m.sel?.w}×${m.sel?.h}`, "32×32"),
        eq("tool icon 16", m.selIcon?.w, 16),
        eq("select active $accent", m.sel?.bg, accent),
        eq("divider 1 × 20", `${m.div?.w}×${m.div?.h}`, "1×20"),
        eq("segmented h 28", m.kind?.h, 28),
        eq("Done h 28", m.done?.h, 28),
        eq("Done padding [0,12]", m.done?.pad, "0 12 0 12"),
        eq("Done 12 / 500", `${m.done?.fs}/${m.done?.fw}`, "12/500"),
        eq(
          "node order",
          order.join(","),
          "K4tXoR,CS881,B7DQfS,div,t1kP6a,div,qDGrD,X7yF0a,div,SsIpQ",
        ),
      ])
      // Click the last segment (200,200 → 300,100 in world: midpoint 250,150) → selected + cue.
      const mid = await toPage(page, { x: 250, y: 150 })
      await page.mouse.click(mid.x, mid.y)
      await settle(page)
      await page.locator(".path-edit-cue").waitFor()
      const cue = await measure(page, { cue: ".path-edit-cue", label: ".path-edit-cue__label" })
      const a = await toPage(page, { x: 200, y: 200 })
      table(ctx, "NsORT cut cue (measured)", [
        eq(
          "cue at anchor + (−12, +6)",
          `${(cue.cue?.x as number) - a.x},${(cue.cue?.y as number) - a.y}`,
          "-12,6",
        ),
        eq("cue padding [2,6]", cue.cue?.pad, "2 6 2 6"),
        eq("cue gap 4", cue.cue?.gap, 4),
        eq("cue fill $text-primary", cue.cue?.bg, await tok(page, "text-primary")),
        eq(
          "label 11 $text-inverse",
          `${cue.label?.fs} ${cue.label?.color}`,
          `11 ${await tok(page, "text-inverse")}`,
        ),
        eq("copy", await page.locator(".path-edit-cue__label").textContent(), "⌫ deletes segment"),
      ])
      await shot(ctx, "b27-path-edit-segment")
      await page.keyboard.press("Backspace")
      await settle(page)
      let n = await node(page, "pathNode0b27")
      ctx.log("after delete segment", JSON.stringify(n))
      expect(String(n?.d).match(/L/g)?.length === 2, "⌫ removed just that segment")
      // Select the middle anchor (100, 100 world) → Smooth gives handles.
      const anchor = await toPage(page, { x: 100, y: 100 })
      await page.mouse.click(anchor.x, anchor.y)
      await settle(page)
      await page.locator('.path-edit-bar__kind [data-value="smooth"]').click()
      await settle(page)
      n = await node(page, "pathNode0b27")
      expect(/C/.test(String(n?.d)), "Smooth adds curve handles")
      expect(
        (await page
          .locator('.path-edit-bar__kind [data-value="smooth"]')
          .getAttribute("aria-checked")) === "true",
        "segmented reflects Smooth",
      )
      // Scissors at the selected anchor: the open path splits into two paths ("Wave 2").
      const before = await ids(page)
      await page.locator('.path-edit-bar [data-pen="qDGrD"]').click()
      await settle(page)
      const fresh = (await ids(page)).filter((i) => !before.includes(i))
      const second = fresh[0] ? await node(page, fresh[0]) : null
      ctx.log("cut", JSON.stringify(second))
      expect(fresh.length === 1 && second?.name === "Wave 2", "cut → new path 'Wave 2'")
      await page.evaluate(() => window.__kimo.session.store.undo("user"))
      await settle(page)
      expect((await ids(page)).length === before.length, "cut is one undo step")
      // Done exits; the floating toolbar returns.
      await page.locator(".path-edit-bar__done").click()
      await settle(page)
      expect(
        (await page.evaluate(() => window.__kimo.canvas()?.editingPath() ?? null)) === null,
        "Done exits path edit",
      )
      expect(await page.locator(".floating-toolbar").isVisible(), "floating toolbar returns")
      expect((await page.locator(".path-edit-bar").count()) === 0, "bar gone")
    },
  },
]
