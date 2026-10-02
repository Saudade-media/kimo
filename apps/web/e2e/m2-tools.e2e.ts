/**
 * M2 canvas tools (desing.pen board 10): snapping while moving (⌘ suspends), ⌥ measuring hint,
 * pixel grid + zoom badge + whole-pixel edits above 400%, pen tool (corner, curve, close,
 * Enter; one undo step per path), path edit mode (Enter, drag anchor, Esc), image tool (file
 * picker → frame with an image fill at natural size), icon insertion, toolbar pen state and
 * the Tooltip/Hint pill 12px above the toolbar, resize of a layout frame.
 */
import { join } from "node:path"
import type { Page } from "playwright"
import { type E2EContext, expect, type Scenario } from "./run"

type Box = { x: number; y: number; w: number; h: number }
type P = { x: number; y: number }

interface Hook {
  session: {
    store: {
      nodeIds(): string[]
      getNode(id: string): Record<string, unknown> | undefined
      children(p: string | null): string[]
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
    placement(): unknown
    insertIcon(i: { set: string; name: string }, at?: P, parent?: string | null): string | null
    zoomTo(z: number, anchor?: P): void
  } | null
}

const settle = (page: Page) =>
  page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  )

async function openEditor(page: Page, url: string) {
  await page.goto(url)
  await page.getByRole("button", { name: "New file" }).click()
  await page.waitForURL(/#\/file\/[A-Za-z0-9]+$/)
  await page.locator('.canvas-host[data-ready="true"]').waitFor({ timeout: 30_000 })
  await settle(page)
}

/** Adds a root frame "Board" (0,0 600×400 at zoom 1, viewport at -100,-100) with children. */
async function board(page: Page, children: { id: string; node: Record<string, unknown> }[]) {
  await page.evaluate((kids) => {
    const k = (window as unknown as { __kimo: Hook }).__kimo
    const ops: unknown[] = [
      {
        op: "insert",
        id: "board0000001",
        parent: null,
        node: { type: "frame", name: "Board", x: 0, y: 0, w: 600, h: 400, fill: "#FFFFFF" },
      },
      ...kids.map((c) => ({ op: "insert", id: c.id, parent: "board0000001", node: c.node })),
    ]
    k.session.store.apply(ops, { origin: "user" })
    k.session.ui.getState().setViewport({ x: -100, y: -100, zoom: 1 })
    k.session.ui.getState().select([])
  }, children)
  await settle(page)
}

const node = (page: Page, id: string) =>
  page.evaluate(
    (i) => (window as unknown as { __kimo: Hook }).__kimo.session.store.getNode(i) ?? null,
    id,
  )

const uiState = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __kimo: Hook }).__kimo.session.ui.getState()
    return { selection: s.selection, tool: s.tool, viewport: s.viewport }
  })

const nodeIds = (page: Page) =>
  page.evaluate(() => (window as unknown as { __kimo: Hook }).__kimo.session.store.nodeIds())

const undo = async (page: Page) => {
  await page.evaluate(() =>
    (window as unknown as { __kimo: Hook }).__kimo.session.store.undo("user"),
  )
  await settle(page)
}

async function toPage(page: Page, p: P) {
  const r = await page.locator(".canvas-host").boundingBox()
  const v = (await uiState(page)).viewport
  if (!r) throw new Error("no canvas")
  return { x: r.x + (p.x - v.x) * v.zoom, y: r.y + (p.y - v.y) * v.zoom }
}

async function drag(page: Page, from: P, to: P, steps = 8) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let i = 1; i <= steps; i++)
    await page.mouse.move(
      from.x + ((to.x - from.x) * i) / steps,
      from.y + ((to.y - from.y) * i) / steps,
    )
  await settle(page)
  await page.mouse.up()
  await settle(page)
}

async function shot(ctx: E2EContext, name: string) {
  if (ctx.shots) await ctx.page.screenshot({ path: join(ctx.shots, `${name}.png`) })
}

const newIds = async (page: Page, before: string[]) =>
  (await nodeIds(page)).filter((i) => !before.includes(i))

/** A 3×2 #E76F51 PNG (natural size test). */
const PNG_3x2 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAEUlEQVR4nGN4nh/4H4YZkDkAzjAP5U44ecgAAAAASUVORK5CYII=",
  "base64",
)

export const scenarios: Scenario[] = [
  {
    name: "M2 snapping: edges snap within 5 screen px while moving; ⌘ suspends",
    async run(ctx) {
      const { page, url } = ctx
      await openEditor(page, url)
      await board(page, [
        {
          id: "imageRect001",
          node: { type: "rect", name: "Image", x: 80, y: 128, w: 240, h: 160 },
        },
        {
          id: "cardRect0001",
          node: { type: "rect", name: "Card", x: 360, y: 140, w: 200, h: 160 },
        },
      ])
      // Drag the card up by 9px: its top lands 3px under the image's top → snaps to 128.
      const from = await toPage(page, { x: 460, y: 220 })
      await drag(page, from, { x: from.x, y: from.y - 9 })
      const card = await node(page, "cardRect0001")
      ctx.log("snapped card", JSON.stringify({ x: card?.x, y: card?.y }))
      expect(card?.y === 128 && card?.x === 360, `card snapped to y 128 (${card?.y})`)
      // One undo step for the gesture.
      await undo(page)
      expect((await node(page, "cardRect0001"))?.y === 140, "undo restores in one step")
      // ⌘ held: no snapping.
      await page.keyboard.down("Meta")
      await drag(page, from, { x: from.x, y: from.y - 9 })
      await page.keyboard.up("Meta")
      const free = await node(page, "cardRect0001")
      expect(free?.y === 131, `⌘ suspends snapping (y ${free?.y})`)
    },
  },
  {
    name: "M2 ⌥ measuring hint follows ⌥ with a selection",
    async run(ctx) {
      const { page, url } = ctx
      await openEditor(page, url)
      await board(page, [
        {
          id: "button000001",
          node: { type: "rect", name: "Button", x: 200, y: 170, w: 160, h: 48 },
        },
      ])
      await page.evaluate(() =>
        (window as unknown as { __kimo: Hook }).__kimo.session.ui
          .getState()
          .select(["button000001"]),
      )
      const c = await toPage(page, { x: 500, y: 300 })
      await page.mouse.move(c.x, c.y)
      await page.keyboard.down("Alt")
      await settle(page)
      const tip = page.locator(".canvas-measuring .kimo-tooltip")
      await tip.waitFor({ timeout: 2000 })
      const text = await tip.textContent()
      expect(text === "Measuring⌥", `measuring tooltip copy (${text})`)
      await shot(ctx, "m2-measuring")
      await page.keyboard.up("Alt")
      await settle(page)
      expect((await tip.count()) === 0, "tooltip hides when ⌥ is released")
    },
  },
  {
    name: "M2 pixel grid: zoom badge above 400% and whole-pixel moves",
    async run(ctx) {
      const { page, url } = ctx
      await openEditor(page, url)
      await board(page, [
        { id: "pixelRect001", node: { type: "rect", name: "Px", x: 10, y: 10, w: 20, h: 20 } },
      ])
      await page.evaluate(() =>
        (window as unknown as { __kimo: Hook }).__kimo.session.ui
          .getState()
          .setViewport({ x: 0, y: 0, zoom: 8 }),
      )
      await settle(page)
      const badge = page.locator(".canvas-zoom-badge")
      await badge.waitFor({ timeout: 2000 })
      const m = await badge.evaluate((el) => {
        const r = el.getBoundingClientRect()
        const host = (el.closest(".canvas-host") as HTMLElement).getBoundingClientRect()
        const label = el.querySelector(".kimo-zoom-badge__label") as HTMLElement
        const cs = getComputedStyle(el)
        const ls = getComputedStyle(label)
        return {
          x: r.x - host.x,
          y: r.y - host.y,
          h: r.height,
          text: label.textContent,
          padding: cs.padding,
          gap: cs.gap,
          radius: cs.borderTopLeftRadius,
          font: `${ls.fontSize}/${ls.fontWeight}`,
          lh: ls.lineHeight,
        }
      })
      ctx.log("zoom badge", JSON.stringify(m))
      expect(m.x === 16 && m.y === 16, "badge at (16, 16)")
      expect(m.text === "800%", "badge text 800%")
      expect(m.h === 23, `badge height 23 (${m.h})`)
      expect(m.padding === "4px 10px" && m.gap === "6px", "badge padding/gap")
      expect(m.font === "11px/500", `badge label mono xs 500 (${m.font})`)
      // Drag by a fractional world distance: 12 screen px = 1.5 world → lands on whole pixels.
      const from = await toPage(page, { x: 20, y: 20 })
      await drag(page, from, { x: from.x + 12, y: from.y + 4 })
      const n = await node(page, "pixelRect001")
      ctx.log("pixel-snapped", JSON.stringify({ x: n?.x, y: n?.y }))
      expect(Number.isInteger(n?.x) && Number.isInteger(n?.y), "whole-pixel position")
      await shot(ctx, "m2-pixel-grid")
      await page.evaluate(() =>
        (window as unknown as { __kimo: Hook }).__kimo.session.ui
          .getState()
          .setViewport({ x: 0, y: 0, zoom: 1 }),
      )
      await settle(page)
      await page.waitForTimeout(250)
      expect((await badge.count()) === 0, "badge hides at 100%")
    },
  },
  {
    name: "M2 pen: toolbar state + hint, corner/curve anchors, Enter commits one path in one step",
    async run(ctx) {
      const { page, url } = ctx
      await openEditor(page, url)
      await board(page, [])
      await page.locator(".canvas-host").focus()
      await page.keyboard.press("p")
      await settle(page)
      const pen = page.locator('.floating-toolbar [data-tool="pen"]')
      const pressed = await pen.evaluate((el) => el.getAttribute("aria-pressed") ?? el.className)
      ctx.log("pen button", pressed)
      expect(/true|active/.test(String(pressed)), "pen shows active in the toolbar")
      const hint = page.locator(".canvas-hint--toolbar")
      const h = await hint.evaluate((el) => {
        const r = el.getBoundingClientRect()
        const bar = (
          document.querySelector(".floating-toolbar") as HTMLElement
        ).getBoundingClientRect()
        const cs = getComputedStyle(el)
        const label = el.querySelector(".kimo-tooltip-hint__label") as HTMLElement
        return {
          gapAbove: bar.top - r.bottom,
          centerDelta: r.left + r.width / 2 - (bar.left + bar.width / 2),
          h: r.height,
          padding: cs.padding,
          gap: cs.gap,
          opacity: cs.opacity,
          text: label.textContent,
          font: `${getComputedStyle(label).fontSize}/${getComputedStyle(label).fontWeight}`,
        }
      })
      ctx.log("pen hint", JSON.stringify(h))
      expect(Math.abs(h.gapAbove - 12) < 0.5, `hint 12px above the toolbar (${h.gapAbove})`)
      expect(Math.abs(h.centerDelta) < 0.5, "hint centered on the toolbar")
      expect(h.h === 27 && h.padding === "6px 12px 6px 10px" && h.gap === "8px", "hint box")
      expect(h.font === "12px/500", "hint label sm 500")
      expect(h.text === "Click to add points · Drag to curve · Enter to finish", "hint copy")
      await shot(ctx, "m2-pen-armed")

      const before = await nodeIds(page)
      const a = await toPage(page, { x: 100, y: 100 })
      const b = await toPage(page, { x: 220, y: 60 })
      const c = await toPage(page, { x: 340, y: 160 })
      await page.mouse.click(a.x, a.y)
      await settle(page)
      expect(
        (await hint.evaluate((el) => getComputedStyle(el).opacity)) !== "1" ||
          (await hint.evaluate((el) => el.classList.contains("canvas-hint--hidden"))),
        "hint fades after the first anchor",
      )
      // Drag at b: smooth anchor with symmetric handles.
      await drag(page, b, { x: b.x + 40, y: b.y })
      await page.mouse.click(c.x, c.y)
      await settle(page)
      expect((await newIds(page, before)).length === 0, "nothing written while drawing")
      await page.keyboard.press("Enter")
      await settle(page)
      const added = await newIds(page, before)
      expect(added.length === 1, `one path node (${added.length})`)
      const p = await node(page, added[0] as string)
      ctx.log("path", JSON.stringify(p))
      expect(p?.type === "path", "type path")
      expect(typeof p?.d === "string" && /C/.test(p.d as string), "curve segment in d")
      expect(!/Z/.test(p?.d as string) && p?.fill === undefined, "open path, no fill")
      expect(p?.x === 100 && p?.w === 240, `bounds x 100 w 240 (${p?.x}, ${p?.w})`)
      const s = await uiState(page)
      expect(s.tool === "select" && s.selection[0] === added[0], "Move tool, path selected")
      await undo(page)
      expect((await newIds(page, before)).length === 0, "one undo removes the path")
    },
  },
  {
    name: "M2 pen: clicking the first anchor closes the path; ⇧ constrains to 45°",
    async run(ctx) {
      const { page, url } = ctx
      await openEditor(page, url)
      await board(page, [])
      await page.locator(".canvas-host").focus()
      await page.keyboard.press("p")
      const before = await nodeIds(page)
      const a = await toPage(page, { x: 100, y: 100 })
      const b = await toPage(page, { x: 200, y: 104 })
      const c = await toPage(page, { x: 150, y: 200 })
      await page.mouse.click(a.x, a.y)
      await page.keyboard.down("Shift")
      await page.mouse.click(b.x, b.y)
      await page.keyboard.up("Shift")
      await page.mouse.click(c.x, c.y)
      await page.mouse.move(a.x + 2, a.y + 1)
      await settle(page)
      const close = page.locator(".canvas-hint--cursor")
      expect((await close.textContent()) === "Close path", "Close path hint near the first anchor")
      await shot(ctx, "m2-pen-close")
      await page.mouse.click(a.x + 2, a.y + 1)
      await settle(page)
      const added = await newIds(page, before)
      const p = await node(page, added[0] as string)
      ctx.log("closed path", JSON.stringify(p))
      expect(added.length === 1 && /Z$/.test(p?.d as string), "closed path (Z)")
      expect(p?.fill !== undefined, "closed path gets a fill")
      // ⇧ kept the second anchor on the first one's horizontal: top edge y = 100.
      expect(p?.y === 100, `⇧ 45° constraint (y ${p?.y})`)
    },
  },
  {
    name: "M2 path edit: Enter edits, dragging an anchor is one undo step, Esc exits",
    async run(ctx) {
      const { page, url } = ctx
      await openEditor(page, url)
      await board(page, [
        {
          id: "pathNode0001",
          node: {
            type: "path",
            name: "Tri",
            x: 100,
            y: 100,
            w: 100,
            h: 100,
            d: "M0 100L50 0L100 100Z",
            viewBox: [0, 0, 100, 100],
            fill: "#F4A261",
          },
        },
      ])
      await page.evaluate(() =>
        (window as unknown as { __kimo: Hook }).__kimo.session.ui
          .getState()
          .select(["pathNode0001"]),
      )
      await page.locator(".canvas-host").focus()
      await page.keyboard.press("Enter")
      await settle(page)
      const editing = await page.evaluate(() =>
        (window as unknown as { __kimo: Hook }).__kimo.canvas()?.editingPath(),
      )
      expect(editing === "pathNode0001", "path edit mode")
      const pill = page.locator(".canvas-hint--top")
      expect((await pill.textContent()) === "Editing path · Esc or Enter to exit", "mode pill copy")
      const apex = await toPage(page, { x: 150, y: 100 })
      await drag(page, apex, { x: apex.x, y: apex.y - 40 })
      const n = await node(page, "pathNode0001")
      ctx.log("edited", JSON.stringify(n))
      expect(n?.y === 60 && n?.h === 140, `apex moved up 40 (y ${n?.y}, h ${n?.h})`)
      await shot(ctx, "m2-path-edit")
      await undo(page)
      const u = await node(page, "pathNode0001")
      expect(u?.y === 100 && u?.d === "M0 100L50 0L100 100Z", "one undo restores the path")
      // Click on the bottom segment adds an anchor.
      const mid = await toPage(page, { x: 150, y: 200 })
      await page.mouse.click(mid.x, mid.y)
      await settle(page)
      const d = (await node(page, "pathNode0001"))?.d as string
      ctx.log("after insert", d)
      expect((d.match(/[LC]/g) ?? []).length === 3, "segment click inserts an anchor")
      await page.keyboard.press("Escape")
      await settle(page)
      const after = await page.evaluate(() =>
        (window as unknown as { __kimo: Hook }).__kimo.canvas()?.editingPath(),
      )
      expect(after === null, "Esc exits")
    },
  },
  {
    name: "M2 image tool: file picker → frame with an image fill at natural size",
    async run(ctx) {
      const { page, url } = ctx
      await openEditor(page, url)
      await board(page, [])
      const before = await nodeIds(page)
      const chooser = page.waitForEvent("filechooser")
      await page.locator('.floating-toolbar [data-tool="image"]').click()
      const fc = await chooser
      await fc.setFiles({ name: "dot.png", mimeType: "image/png", buffer: PNG_3x2 })
      await page.waitForFunction(
        () => !!(window as unknown as { __kimo: Hook }).__kimo.canvas()?.placement(),
      )
      const active = await page
        .locator('.floating-toolbar [data-tool="image"]')
        .evaluate((el) => el.getAttribute("aria-pressed") ?? el.className)
      expect(/true|active/.test(String(active)), "Image shows active while armed")
      const at = await toPage(page, { x: 300, y: 200 })
      await page.mouse.click(at.x, at.y)
      await settle(page)
      const added = await newIds(page, before)
      const n = await node(page, added[0] as string)
      ctx.log("image frame", JSON.stringify(n))
      expect(n?.type === "frame" && n?.w === 3 && n?.h === 2, "natural size 3×2")
      const fill = n?.fill as { kind?: string; src?: string } | undefined
      expect(
        fill?.kind === "image" && /^\.\/assets\/[0-9a-f]{16}\.png$/.test(fill.src ?? ""),
        "image fill",
      )
      const placement = await page.evaluate(() =>
        (window as unknown as { __kimo: Hook }).__kimo.canvas()?.placement(),
      )
      expect(placement === null, "placement consumed")
    },
  },
  {
    name: "M2 icons: insertIcon adds one icon node",
    async run(ctx) {
      const { page, url } = ctx
      await openEditor(page, url)
      await board(page, [])
      const id = await page.evaluate(() =>
        (window as unknown as { __kimo: Hook }).__kimo
          .canvas()
          ?.insertIcon({ set: "lucide", name: "star" }, { x: 112, y: 112 }),
      )
      const n = await node(page, id as string)
      ctx.log("icon", JSON.stringify(n))
      expect(n?.type === "icon" && n?.set === "lucide" && n?.icon === "star", "icon node")
      expect(n?.x === 100 && n?.y === 100 && n?.w === 24, "24×24 centered on the point")
    },
  },
  {
    name: "M2 resize of a layout frame keeps one undo step",
    async run(ctx) {
      const { page, url } = ctx
      await openEditor(page, url)
      await board(page, [
        {
          id: "rowFrame0001",
          node: {
            type: "frame",
            name: "Row",
            x: 96,
            y: 170,
            w: 464,
            layout: { dir: "row", gap: 16, pad: 16, align: "center" },
          },
        },
      ])
      await page.evaluate(() => {
        const k = (window as unknown as { __kimo: Hook }).__kimo
        k.session.store.apply(
          [
            {
              op: "insert",
              id: "avatar000001",
              parent: "rowFrame0001",
              node: { type: "ellipse", w: 48, h: 48 },
            },
            {
              op: "insert",
              id: "textcol00001",
              parent: "rowFrame0001",
              node: { type: "rect", w: { mode: "fill" }, h: 48 },
            },
          ],
          { origin: "user" },
        )
        k.session.ui.getState().select(["rowFrame0001"])
      })
      await settle(page)
      const right = await toPage(page, { x: 560, y: 210 })
      await page.mouse.move(right.x, right.y)
      await page.mouse.down()
      for (let i = 1; i <= 6; i++) await page.mouse.move(right.x + i * 10, right.y)
      await settle(page)
      await shot(ctx, "m2-resize-layout")
      await page.mouse.up()
      await settle(page)
      const n = await node(page, "rowFrame0001")
      expect(n?.w === 524, `width +60 (${n?.w})`)
      await undo(page)
      expect((await node(page, "rowFrame0001"))?.w === 464, "one undo step")
    },
  },
]
