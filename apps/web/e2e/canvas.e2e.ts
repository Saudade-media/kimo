/**
 * Canvas scenarios (M1): CanvasKit renders the sample, selection (click / shift / marquee),
 * hover, move, resize, create by drag, text by click + inline editing, pan / zoom, delete,
 * duplicate, frame selection, nudge, undo per gesture, panel ↔ canvas sync, export round-trip.
 */
import { join } from "node:path"
import type { Page } from "playwright"
import { settle } from "./qa-helpers"
import { type E2EContext, expect, type Scenario } from "./run"

type Box = { x: number; y: number; w: number; h: number }

interface KimoHook {
  session: {
    store: {
      nodeIds(): string[]
      getNode(id: string): Record<string, unknown> | undefined
      children(p: string | null): string[]
      canUndo(o: string): boolean
    }
    ui: {
      getState(): {
        selection: string[]
        hovered: string | null
        tool: string
        viewport: { x: number; y: number; zoom: number }
        setViewport(v: object): void
        select(ids: string[]): void
      }
    }
  }
  canvas(): {
    layout(): { nodes: Map<string, { world: Box; local: Box }> } | null
    stats(): { backend: string; frames: number } | null
    renderer: { hitTest(p: { x: number; y: number }): string[] } | null
  } | null
}

async function openEditor(page: Page, url: string) {
  await page.goto(url)
  await page.getByRole("button", { name: "New file" }).first().click()
  await page.waitForURL(/#\/file\/[A-Za-z0-9]+$/)
  await page.locator('.canvas-host[data-ready="true"]').waitFor({ timeout: 30_000 })
  await settle(page)
  // Files open framed on their content; these scenarios measure board 03 from the origin at 100 %.
  await page.evaluate(() =>
    (window as unknown as { __kimo: KimoHook }).__kimo.session.ui
      .getState()
      .setViewport({ x: 0, y: 0, zoom: 1 }),
  )
  await settle(page)
}

const idOf = (page: Page, name: string) =>
  page.evaluate((n) => {
    const s = (window as unknown as { __kimo: KimoHook }).__kimo.session.store
    return s.nodeIds().find((i) => s.getNode(i)?.name === n) ?? null
  }, name)

const node = (page: Page, id: string) =>
  page.evaluate(
    (i) => (window as unknown as { __kimo: KimoHook }).__kimo.session.store.getNode(i) ?? null,
    id,
  )

const ui = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __kimo: KimoHook }).__kimo.session.ui.getState()
    return { selection: s.selection, hovered: s.hovered, tool: s.tool, viewport: s.viewport }
  })

/** World box of a node from the live layout. */
const world = (page: Page, id: string) =>
  page.evaluate((i) => {
    const c = (window as unknown as { __kimo: KimoHook }).__kimo.canvas()
    return c?.layout()?.nodes.get(i)?.world ?? null
  }, id)

/** Page coordinates of a world point (canvas origin + viewport). */
async function toPage(page: Page, p: { x: number; y: number }) {
  const r = await page.locator(".canvas-host").boundingBox()
  const v = (await ui(page)).viewport
  if (!r) throw new Error("no canvas")
  return { x: r.x + (p.x - v.x) * v.zoom, y: r.y + (p.y - v.y) * v.zoom }
}

async function centerOf(page: Page, id: string) {
  const b = await world(page, id)
  if (!b) throw new Error(`no layout for ${id}`)
  return toPage(page, { x: b.x + b.w / 2, y: b.y + b.h / 2 })
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  const steps = 8
  for (let i = 1; i <= steps; i++)
    await page.mouse.move(
      from.x + ((to.x - from.x) * i) / steps,
      from.y + ((to.y - from.y) * i) / steps,
    )
  await settle(page)
  await page.mouse.up()
  await settle(page)
}

/** RGBA of screen pixels at canvas-relative CSS points (screenshot → decoded in the page). */
async function pixels(page: Page, pts: { x: number; y: number }[]): Promise<number[][]> {
  const r = await page.locator(".canvas-host").boundingBox()
  if (!r) throw new Error("no canvas")
  const out: number[][] = []
  for (const p of pts) {
    const png = await page.screenshot({
      clip: { x: r.x + Math.round(p.x), y: r.y + Math.round(p.y), width: 1, height: 1 },
    })
    out.push(
      await page.evaluate(async (b64) => {
        const img = new Image()
        img.src = `data:image/png;base64,${b64}`
        await img.decode()
        const o = new OffscreenCanvas(1, 1)
        const g = o.getContext("2d") as OffscreenCanvasRenderingContext2D
        g.drawImage(img, 0, 0)
        return Array.from(g.getImageData(0, 0, 1, 1).data)
      }, png.toString("base64")),
    )
  }
  return out
}

/** The app's file helpers, imported inside the page through Vite. */
const FILES = "/src/lib/files.ts"
type FilesModule = typeof import("../src/lib/files")

const row = (page: Page, name: string) =>
  page
    .getByRole("treeitem")
    .filter({ has: page.locator(".kimo-layer-row__name", { hasText: new RegExp(`^${name}$`) }) })

async function shot(ctx: E2EContext, name: string) {
  if (ctx.shots) await ctx.page.screenshot({ path: join(ctx.shots, `${name}.png`) })
}

const near = (a: number | undefined, b: number, tol = 0.6) =>
  a !== undefined && Math.abs(a - b) <= tol

export const scenarios: Scenario[] = [
  {
    name: "canvas renders the sample with CanvasKit",
    async run(ctx) {
      const { page, url } = ctx
      await openEditor(page, url)
      const stats = await page.evaluate(() =>
        (window as unknown as { __kimo: KimoHook }).__kimo.canvas()?.stats(),
      )
      ctx.log("renderer", JSON.stringify(stats))
      expect(stats && stats.frames > 0, "frames rendered")
      // Device-pixel-correct backing store.
      const dims = await page.evaluate(() => {
        const c = document.querySelector(".canvas-host__canvas") as HTMLCanvasElement
        const r = c.getBoundingClientRect()
        return { w: c.width, h: c.height, cw: r.width, ch: r.height, dpr: devicePixelRatio }
      })
      expect(
        dims.w === Math.round(dims.cw * dims.dpr) && dims.h === Math.round(dims.ch * dims.dpr),
        `canvas backing store ${JSON.stringify(dims)}`,
      )
      // The desktop artboard (board 03: x 56, y 62, w 720) and its label 22 px above it.
      const desk = (await idOf(page, "Home — Desktop")) as string
      const b = await world(page, desk)
      expect(b && b.x === 56 && b.y === 62 && b.w === 720, `desktop box ${JSON.stringify(b)}`)
      const label = await page
        .locator(`.canvas-host__label[data-artboard="${desk}"]`)
        .evaluate((el) => {
          const r = el.getBoundingClientRect()
          const host = (el.closest(".canvas-host") as HTMLElement).getBoundingClientRect()
          const cs = getComputedStyle(el)
          return {
            x: r.x - host.x,
            y: r.y - host.y,
            fontSize: cs.fontSize,
            fontWeight: cs.fontWeight,
            text: el.textContent,
          }
        })
      ctx.log("label", JSON.stringify(label))
      expect(label.x === 56 && label.y === 40, `label at 56,40 (${label.x},${label.y})`)
      expect(label.fontSize === "12px" && label.fontWeight === "500", "label 12/500")
      // Pixels: the artboard fill (#FFF7EE) is painted where the frame is.
      const [px = []] = await pixels(page, [{ x: 400, y: 75 }])
      ctx.log("pixel @400,75", px.join(","))
      expect(px[0] === 0xff && px[1] === 0xf7 && px[2] === 0xee, `artboard fill pixel ${px}`)
      await shot(ctx, "canvas-sample")
    },
  },
  {
    name: "click, shift-click, marquee and hover select; panels follow",
    async run(ctx) {
      const { page, url } = ctx
      await openEditor(page, url)
      const desk = (await idOf(page, "Home — Desktop")) as string
      const hero = (await idOf(page, "Hero")) as string
      const navbar = (await idOf(page, "Navbar")) as string
      const mobile = (await idOf(page, "Home — Mobile")) as string
      // Click inside Hero (empty area right of the headline) selects Hero (child of the root).
      const hb = (await world(page, hero)) as Box
      const pHero = await toPage(page, { x: hb.x + hb.w - 20, y: hb.y + 20 })
      await page.mouse.move(pHero.x, pHero.y)
      await settle(page)
      expect((await ui(page)).hovered === hero, "hover → Hero")
      await page.mouse.click(pHero.x, pHero.y)
      await settle(page)
      expect((await ui(page)).selection.join() === hero, "click selects Hero")
      await page.getByTestId("selection-name").filter({ hasText: "Hero" }).waitFor()
      const rowSelected = await row(page, "Hero").getAttribute("aria-selected")
      expect(rowSelected === "true", "layer row follows canvas selection")
      // Shift-click adds Navbar.
      const nc0 = await centerOf(page, navbar)
      await page.keyboard.down("Shift")
      await page.mouse.click(nc0.x, nc0.y)
      await page.keyboard.up("Shift")
      await settle(page)
      const sel = (await ui(page)).selection
      expect(sel.includes(hero) && sel.includes(navbar), `shift-click adds (${sel})`)
      // Label click selects the artboard.
      await page.locator(`.canvas-host__label[data-artboard="${mobile}"]`).click()
      expect((await ui(page)).selection.join() === mobile, "label selects artboard")
      // Empty canvas click clears.
      const empty = await toPage(page, { x: 20, y: 700 })
      await page.mouse.click(empty.x, empty.y)
      await settle(page)
      expect((await ui(page)).selection.length === 0, "empty click clears")
      // Marquee from empty canvas across both artboards selects the roots.
      await drag(page, await toPage(page, { x: 10, y: 10 }), await toPage(page, { x: 900, y: 300 }))
      const ms = (await ui(page)).selection
      expect(ms.includes(desk) && ms.includes(mobile) && ms.length === 2, `marquee roots (${ms})`)
      // Panel → canvas: clicking a layer row selects on canvas (overlay follows the UI store).
      await row(page, "Navbar").click()
      expect((await ui(page)).selection.join() === navbar, "row selects on canvas")
      await shot(ctx, "canvas-selection")
    },
  },
  {
    name: "move, resize (8 handles, shift aspect), one undo step per gesture",
    async run(ctx) {
      const { page, url } = ctx
      await openEditor(page, url)
      // Pan so the whole mobile artboard (x 808…1088) is on screen.
      await page.evaluate(() =>
        (window as unknown as { __kimo: KimoHook }).__kimo.session.ui
          .getState()
          .setViewport({ x: 400, y: 0 }),
      )
      await settle(page)
      const mobile = (await idOf(page, "Home — Mobile")) as string
      await page.locator(`.canvas-host__label[data-artboard="${mobile}"]`).click()
      // Drag the artboard by (+40, +30).
      const c = await centerOf(page, mobile)
      const before = (await node(page, mobile)) as unknown as Box
      // Press on the selected artboard's background (no children under the point).
      const mb = (await world(page, mobile)) as Box
      const start = await toPage(page, { x: mb.x + 30, y: mb.y + mb.h - 30 })
      await drag(page, start, { x: start.x + 40, y: start.y + 30 })
      let n = (await node(page, mobile)) as unknown as Box
      expect(n.x === before.x + 40 && n.y === before.y + 30, `moved to ${n.x},${n.y}`)
      await page.keyboard.press("ControlOrMeta+z")
      n = (await node(page, mobile)) as unknown as Box
      expect(n.x === before.x && n.y === before.y, `one undo restores (${n.x},${n.y})`)
      void c
      // Resize from the east edge zone (+60 → w 340).
      await settle(page)
      const b = (await world(page, mobile)) as Box
      const e = await toPage(page, { x: b.x + b.w, y: b.y + b.h / 2 })
      await drag(page, e, { x: e.x + 60, y: e.y })
      n = (await node(page, mobile)) as unknown as Box
      expect(n.w === 340 && n.h === 560 && n.x === before.x, `east resize → ${n.w}×${n.h}`)
      // SE corner with shift keeps the 340:560 ratio.
      await settle(page)
      const b2 = (await world(page, mobile)) as Box
      const se = await toPage(page, { x: b2.x + b2.w, y: b2.y + b2.h })
      await page.keyboard.down("Shift")
      await drag(page, se, { x: se.x + 34, y: se.y + 10 })
      await page.keyboard.up("Shift")
      n = (await node(page, mobile)) as unknown as Box
      expect(near(n.w / n.h, 340 / 560, 0.01) && n.w === 374, `aspect resize → ${n.w}×${n.h}`)
      // NW corner: x/y move with the top-left edge.
      await settle(page)
      const b3 = (await world(page, mobile)) as Box
      const nw = await toPage(page, { x: b3.x, y: b3.y })
      await drag(page, nw, { x: nw.x + 20, y: nw.y + 10 })
      n = (await node(page, mobile)) as unknown as Box
      expect(n.x === before.x + 20 && n.y === before.y + 10, `nw moves origin (${n.x},${n.y})`)
      // Undo three resizes → back to 280×560.
      for (let i = 0; i < 3; i++) await page.keyboard.press("ControlOrMeta+z")
      n = (await node(page, mobile)) as unknown as Box
      expect(n.w === 280 && n.h === 560, `undo resizes → ${n.w}×${n.h}`)
      // Board 27 §2 (Y4vVe): a flow child drags (reorder preview); dropped near its own slot it
      // stays first in its auto-layout parent, without x/y.
      const navbar = (await idOf(page, "Navbar")) as string
      const navParent = (await node(page, navbar))?.parent
      await row(page, "Navbar").click()
      const nc = await centerOf(page, navbar)
      await page.mouse.move(nc.x, nc.y)
      await page.mouse.down()
      await page.mouse.move(nc.x + 30, nc.y + 30, { steps: 4 })
      await settle(page)
      const cursor = await page.locator(".canvas-host").evaluate((el) => el.style.cursor)
      await page.mouse.up()
      expect(cursor === "default", `flow child cursor (${cursor})`)
      const nav = await node(page, navbar)
      expect(nav?.x === undefined && nav?.parent === navParent, "flow child stays in its flow")
    },
  },
  {
    name: "create frame / rectangle / ellipse by drag and text by click",
    async run(ctx) {
      const { page, url } = ctx
      await openEditor(page, url)
      const canvas = page.locator(".canvas-host")
      await canvas.focus()
      // Empty canvas right of the sample (board 27 §2: drawing over an auto-layout artboard
      // inserts into it, so these shapes are drawn clear of both artboards).
      await page.evaluate(() =>
        (window as unknown as { __kimo: KimoHook }).__kimo.session.ui
          .getState()
          .setViewport({ x: 1950, y: 600, zoom: 1 }),
      )
      await settle(page)
      // Rectangle tool (R), drag on empty canvas → root rect 120×80.
      await page.keyboard.press("r")
      const a = await toPage(page, { x: 2100, y: 700 })
      await drag(page, a, { x: a.x + 120, y: a.y + 80 })
      let s = await ui(page)
      const rect = s.selection[0] as string
      let n = (await node(page, rect)) as Record<string, unknown>
      expect(
        n.type === "rect" && n.w === 120 && n.h === 80 && n.x === 2100 && n.y === 700,
        `rect ${JSON.stringify(n)}`,
      )
      expect(s.tool === "select", "tool returns to select")
      // Ellipse tool with shift → circle.
      await page.keyboard.press("o")
      const b = await toPage(page, { x: 2300, y: 700 })
      await page.keyboard.down("Shift")
      await drag(page, b, { x: b.x + 90, y: b.y + 40 })
      await page.keyboard.up("Shift")
      s = await ui(page)
      n = (await node(page, s.selection[0] as string)) as Record<string, unknown>
      expect(n.type === "ellipse" && n.w === 90 && n.h === 90, `circle ${n.w}×${n.h}`)
      // Frame tool click (no drag) → 100×100 frame.
      await page.keyboard.press("f")
      const f = await toPage(page, { x: 2450, y: 700 })
      await page.mouse.click(f.x, f.y)
      await settle(page)
      s = await ui(page)
      n = (await node(page, s.selection[0] as string)) as Record<string, unknown>
      expect(n.type === "frame" && n.w === 100 && n.h === 100, `frame ${JSON.stringify(n)}`)
      // Rectangle drawn inside the mobile artboard (no auto layout? it has layout → root).
      // Text tool: click, type, commit with Escape.
      await page.keyboard.press("t")
      const t = await toPage(page, { x: 2600, y: 700 })
      await page.mouse.click(t.x, t.y)
      const editor = page.getByRole("textbox", { name: "Edit text" })
      await editor.waitFor()
      await page.keyboard.type("Hello Kimo")
      await page.keyboard.press("Escape")
      await settle(page)
      s = await ui(page)
      const textId = s.selection[0] as string
      n = (await node(page, textId)) as Record<string, unknown>
      expect(n.type === "text" && n.content === "Hello Kimo", `text ${JSON.stringify(n)}`)
      // Double-click edits it in place.
      const tc = await centerOf(page, textId)
      await page.mouse.dblclick(tc.x, tc.y)
      await editor.waitFor()
      await page.keyboard.press("ControlOrMeta+a")
      await page.keyboard.type("Edited")
      await page.keyboard.press("Escape")
      await settle(page)
      expect((await node(page, textId))?.content === "Edited", "inline edit commits")
      await page.keyboard.press("ControlOrMeta+z")
      expect((await node(page, textId))?.content === "Hello Kimo", "edit is one undo step")
      await settle(page)
      await shot(ctx, "canvas-created")
    },
  },
  {
    name: "pan, zoom (wheel, keys, fit) and zoom menu",
    async run(ctx) {
      const { page, url } = ctx
      await openEditor(page, url)
      const c = await toPage(page, { x: 400, y: 300 })
      await page.mouse.move(c.x, c.y)
      // Trackpad scroll pans.
      await page.mouse.wheel(40, 60)
      await settle(page)
      let v = (await ui(page)).viewport
      expect(near(v.x, 40) && near(v.y, 60) && v.zoom === 1, `wheel pans ${JSON.stringify(v)}`)
      // Ctrl+wheel zooms around the pointer (world point under the cursor stays put).
      const before = { x: v.x + (c.x - 256) / v.zoom, y: v.y + (c.y - 48) / v.zoom }
      await page.keyboard.down("Control")
      await page.mouse.wheel(0, -100)
      await page.keyboard.up("Control")
      await settle(page)
      v = (await ui(page)).viewport
      const after = { x: v.x + (c.x - 256) / v.zoom, y: v.y + (c.y - 48) / v.zoom }
      expect(v.zoom > 2.5 && v.zoom < 2.8, `ctrl-wheel zoom ${v.zoom}`)
      expect(near(after.x, before.x, 0.01) && near(after.y, before.y, 0.01), "anchor fixed")
      expect(
        (await page.locator(".topbar__zoom-value").textContent()) ===
          `${Math.round(v.zoom * 100)}%`,
        "zoom menu reflects viewport",
      )
      // Space + drag pans.
      await page.locator(".canvas-host").focus()
      await page.keyboard.down("Space")
      const z = v.zoom
      await drag(page, c, { x: c.x - 100, y: c.y - 50 })
      await page.keyboard.up("Space")
      const v2 = (await ui(page)).viewport
      expect(near(v2.x, v.x + 100 / z, 0.01) && near(v2.y, v.y + 50 / z, 0.01), "space-drag pans")
      // Middle mouse pans.
      await page.mouse.move(c.x, c.y)
      await page.mouse.down({ button: "middle" })
      await page.mouse.move(c.x + 50, c.y, { steps: 3 })
      await page.mouse.up({ button: "middle" })
      const v3 = (await ui(page)).viewport
      expect(near(v3.x, v2.x - 50 / z, 0.01), "middle-drag pans")
      // Keys: shift+0 → 100%, -, +, shift+1 → fit (≤ 100%), clamped at MAX.
      await page.keyboard.press("Shift+Digit0")
      expect((await ui(page)).viewport.zoom === 1, "shift+0 → 100%")
      await page.keyboard.press("-")
      expect((await ui(page)).viewport.zoom === 0.5, "- halves")
      await page.keyboard.press("=")
      expect((await ui(page)).viewport.zoom === 1, "= doubles")
      await page.keyboard.press("Shift+Digit1")
      v = (await ui(page)).viewport
      ctx.log("fit viewport", JSON.stringify(v))
      expect(v.zoom > 0.5 && v.zoom <= 1, `fit zoom ${v.zoom}`)
      for (let i = 0; i < 12; i++) await page.keyboard.press("=")
      expect((await ui(page)).viewport.zoom === 256, "clamped to MAX_ZOOM")
      // View menu (board 27 rmQMe) "Zoom to 100 %".
      await page.getByRole("button", { name: "Zoom" }).click()
      await page.getByRole("menuitem", { name: /100 %/ }).click()
      expect((await ui(page)).viewport.zoom === 1, "menu → 100%")
    },
  },
  {
    name: "delete, duplicate, frame selection, nudge, escape",
    async run(ctx) {
      const { page, url } = ctx
      await openEditor(page, url)
      const mobile = (await idOf(page, "Home — Mobile")) as string
      await page.locator(`.canvas-host__label[data-artboard="${mobile}"]`).click()
      // ⌘D duplicates +16/+16 (board 27 §2 rules F1FPb).
      await page.keyboard.press("ControlOrMeta+d")
      await settle(page)
      let s = await ui(page)
      const copy = s.selection[0] as string
      const cn = (await node(page, copy)) as Record<string, unknown>
      expect(copy !== mobile && cn.name === "Home — Mobile" && cn.x === 808 + 16, "dup x")
      const kids = await page.evaluate(
        (i) => (window as unknown as { __kimo: KimoHook }).__kimo.session.store.children(i).length,
        copy,
      )
      expect(kids > 0, "subtree duplicated")
      // Nudge: arrow 1, shift+arrow 10.
      await page.keyboard.press("ArrowRight")
      await page.keyboard.press("Shift+ArrowDown")
      const nn = (await node(page, copy)) as unknown as Box
      expect(nn.x === 825 && nn.y === 88, `nudged ${nn.x},${nn.y}`)
      // Delete.
      await page.keyboard.press("Backspace")
      expect((await node(page, copy)) === null, "deleted")
      await page.keyboard.press("ControlOrMeta+z")
      expect((await node(page, copy)) !== null, "undo delete")
      // ⌥⌘G frames two rects, drawn on empty canvas (board 27 §2: drawing over an auto-layout
      // artboard inserts into it).
      await page.evaluate(() =>
        (window as unknown as { __kimo: KimoHook }).__kimo.session.ui
          .getState()
          .setViewport({ x: 1950, y: 600, zoom: 1 }),
      )
      await settle(page)
      await page.locator(".canvas-host").focus()
      await page.keyboard.press("r")
      const a = await toPage(page, { x: 2100, y: 700 })
      await drag(page, a, { x: a.x + 50, y: a.y + 50 })
      const r1 = (await ui(page)).selection[0] as string
      await page.keyboard.press("r")
      const b = await toPage(page, { x: 2200, y: 720 })
      await drag(page, b, { x: b.x + 50, y: b.y + 50 })
      const r2 = (await ui(page)).selection[0] as string
      await page.evaluate(
        (ids) =>
          (window as unknown as { __kimo: KimoHook }).__kimo.session.ui.getState().select(ids),
        [r1, r2],
      )
      // ⌥⌘G wraps in a frame (⌘G makes a group since board 27 §2).
      await page.keyboard.press("ControlOrMeta+Alt+g")
      await settle(page)
      s = await ui(page)
      const frame = s.selection[0] as string
      const fn = (await node(page, frame)) as Record<string, unknown>
      const r1n = (await node(page, r1)) as Record<string, unknown>
      expect(
        fn.type === "frame" && fn.x === 2100 && fn.y === 700 && fn.w === 150 && fn.h === 70,
        `frame ${JSON.stringify(fn)}`,
      )
      expect(r1n.parent === frame && r1n.x === 0 && r1n.y === 0, `child ${JSON.stringify(r1n)}`)
      const w1 = await world(page, r1)
      expect(w1?.x === 2100 && w1?.y === 700, "child keeps its world position")
      // Escape selects the parent, then clears.
      await page.evaluate(
        (id) =>
          (window as unknown as { __kimo: KimoHook }).__kimo.session.ui.getState().select([id]),
        r2,
      )
      await page.keyboard.press("Escape")
      expect((await ui(page)).selection.join() === frame, "escape → parent")
      await page.keyboard.press("Escape")
      expect((await ui(page)).selection.length === 0, "escape → clear")
      await page.keyboard.press("ControlOrMeta+z")
      expect((await node(page, frame)) === null && (await node(page, r1))?.parent === null, "undo")
    },
  },
  {
    name: "selection overlay geometry matches board 03",
    async run(ctx) {
      const { page, url } = ctx
      await openEditor(page, url)
      const desk = (await idOf(page, "Home — Desktop")) as string
      const hero = (await idOf(page, "Hero")) as string
      await page.evaluate(
        (id) =>
          (window as unknown as { __kimo: KimoHook }).__kimo.session.ui.getState().select([id]),
        desk,
      )
      await settle(page)
      await settle(page)
      // Board 03 draws the outline for "Home — Desktop" body (x 56, w 720) with handles at
      // x 52 / 772 (8×8 centred on the corners) — sample the handle fill and outline pixels.
      const b = (await world(page, desk)) as Box
      const read = await pixels(page, [
        { x: b.x, y: b.y }, // NW handle centre (white fill)
        { x: b.x + b.w / 2, y: b.y }, // outline (selection blue)
        { x: b.x + b.w, y: b.y + b.h }, // SE handle
      ])
      ctx.log("overlay pixels", JSON.stringify(read))
      const isWhite = ([r = 0, g = 0, b = 0]: number[] = []) => r > 240 && g > 240 && b > 240
      const isBlue = ([r = 255, , b = 0]: number[] = []) => b > 200 && r < 120
      expect(isWhite(read[0]) && isWhite(read[2]), "corner handles white")
      expect(isBlue(read[1]), "outline selection blue")
      void hero
      await shot(ctx, "canvas-overlay")
    },
  },
  {
    name: "save .kimo and reopen round-trips the canvas edit",
    async run(ctx) {
      const { page, url } = ctx
      await openEditor(page, url)
      const mobile = (await idOf(page, "Home — Mobile")) as string
      await page.locator(`.canvas-host__label[data-artboard="${mobile}"]`).click()
      await page.keyboard.press("Shift+ArrowRight")
      // Export through the app's serializer and import it back as a new file.
      const text = await page.evaluate(async (f) => {
        const files = ((window as unknown as { __kimoModules?: Record<string, unknown> })
          .__kimoModules?.[f] ?? (await import(/* @vite-ignore */ f))) as FilesModule
        const k = (window as unknown as { __kimo: KimoHook }).__kimo
        return files.exportKimo(k.session.store as never, "Roundtrip")
      }, FILES)
      expect(text.includes('"format"'), "serialized")
      const id = await page.evaluate(
        async ([f, t]) => {
          const files = ((window as unknown as { __kimoModules?: Record<string, unknown> })
            .__kimoModules?.[f] ?? (await import(/* @vite-ignore */ f))) as FilesModule
          return files.importKimo(t, "Roundtrip.kimo")
        },
        [FILES, text] as const,
      )
      await page.goto(`${url}#/file/${id}`)
      await page.locator('.canvas-host[data-ready="true"]').waitFor({ timeout: 30_000 })
      await settle(page)
      const m = (await idOf(page, "Home — Mobile")) as string
      const n = (await node(page, m)) as unknown as Box
      expect(n.x === 818, `round-trip x ${n.x}`)
      const b = await world(page, m)
      expect(b?.x === 818, "reopened canvas lays out the edit")
    },
  },
]
