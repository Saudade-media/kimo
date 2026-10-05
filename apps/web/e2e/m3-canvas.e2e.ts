/**
 * M3 canvas scenarios (boards 11–13): hit testing and selection of instance paths (click selects
 * the instance, double-click / ⌘-click enter it with composite ids), the violet identity overlay
 * (selection tone, instance / slot outlines), canvas edits inside instances routed to overrides
 * (text edit, Delete → hide), live main → instance propagation (layout + pixels), drag from
 * Assets onto the page / into a slot / replace (with the drop overlay), and the root
 * CanvasLabel/Component + /Instance DOM labels.
 */
import type { Page } from "playwright"
import { docJson, openEditor, settle } from "./qa-helpers"
import { type E2EContext, expect, type Scenario } from "./run"

type Rec = Record<string, unknown>
type Box = { x: number; y: number; w: number; h: number }
type W = {
  __kimo: {
    session: {
      store: { getNode(id: string): Rec | undefined; undo(o: string): unknown; nodeIds(): string[] }
      apply(ops: unknown[], label?: string): boolean
      ui: { getState(): { selection: string[]; select(ids: string[]): void } }
    }
    canvas(): {
      layout(): { nodes: Map<string, { world: Box; visible: boolean }> } | null
      worldToScreen(p: { x: number; y: number }): { x: number; y: number }
      exportPng(id: string, scale?: number): Promise<Uint8Array>
      renderer: { setOverlay(o: Rec): void } | null
    }
    m3: { toasts: { get(): { text: string }[] } }
  }
  __overlay?: Rec
}

/** Main `Card/Pricing` (Title, Badge, Actions slot) + instance `Card · Pro` beside it. */
async function fixture(page: Page) {
  const ok = await page.evaluate(() =>
    (window as unknown as W).__kimo.session.apply(
      [
        {
          op: "insert",
          id: "main000001",
          parent: null,
          node: {
            type: "frame",
            name: "Card/Pricing",
            x: 40,
            y: 40,
            w: 220,
            h: 200,
            fill: "#FFFFFF",
            component: true,
            layout: { dir: "column", gap: 10, pad: 16 },
          },
        },
        {
          op: "insert",
          id: "title00001",
          parent: "main000001",
          node: { type: "text", name: "Title", content: "Plan name", fill: "#2A1E14" },
        },
        {
          op: "insert",
          id: "badge00001",
          parent: "main000001",
          node: { type: "rect", name: "Badge", w: 120, h: 40, fill: "#F6DFC6" },
        },
        {
          op: "insert",
          id: "actions001",
          parent: "main000001",
          node: {
            type: "frame",
            name: "Actions",
            w: 188,
            h: 60,
            layout: { dir: "column", gap: 6 },
            slot: {},
          },
        },
        {
          op: "insert",
          id: "inst000001",
          parent: null,
          node: { type: "instance", name: "Card · Pro", of: "main000001", x: 320, y: 40 },
        },
      ],
      "fixture",
    ),
  )
  expect(ok, "fixture applied")
  // Record every overlay the renderer receives (selection tone, outlines, drop feedback).
  await page.evaluate(() => {
    const win = window as unknown as W
    const r = win.__kimo.canvas().renderer
    if (!r) return
    const set = r.setOverlay.bind(r)
    r.setOverlay = (o) => {
      win.__overlay = o
      set(o)
    }
  })
  await settle(page)
}

const selection = (page: Page) =>
  page.evaluate(() => (window as unknown as W).__kimo.session.ui.getState().selection)
const getNode = (page: Page, id: string) =>
  page.evaluate((i) => (window as unknown as W).__kimo.session.store.getNode(i) ?? null, id)
const overlay = (page: Page) => page.evaluate(() => (window as unknown as W).__overlay ?? null)
const world = (page: Page, id: string) =>
  page.evaluate((i) => {
    const l = (window as unknown as W).__kimo.canvas().layout()?.nodes.get(i)
    return l ? { ...l.world, visible: l.visible } : null
  }, id)

/** Page coordinates of the center of view id `id` on the canvas. */
async function center(page: Page, id: string) {
  const b = await world(page, id)
  expect(b, `layout box for ${id}`)
  const s = await page.evaluate((p) => (window as unknown as W).__kimo.canvas().worldToScreen(p), {
    x: b.x + b.w / 2,
    y: b.y + b.h / 2,
  })
  const host = await page.locator('[data-testid="canvas"]').boundingBox()
  expect(host, "canvas box")
  return { x: host.x + s.x, y: host.y + s.y }
}

/** Average RGB of `id`'s exported pixels inside the given relative box (0..1). */
const pixel = (page: Page, id: string, fx: number, fy: number) =>
  page.evaluate(
    async ({ id, fx, fy }) => {
      const png = await (window as unknown as W).__kimo.canvas().exportPng(id, 1)
      const bmp = await createImageBitmap(new Blob([png as BlobPart], { type: "image/png" }))
      const c = new OffscreenCanvas(bmp.width, bmp.height)
      const g = c.getContext("2d") as OffscreenCanvasRenderingContext2D
      g.drawImage(bmp, 0, 0)
      const d = g.getImageData(Math.floor(bmp.width * fx), Math.floor(bmp.height * fy), 1, 1).data
      return [d[0], d[1], d[2]] as [number, number, number]
    },
    { id, fx, fy },
  )

async function clickSelectsInstance({ page, url }: E2EContext) {
  await openEditor(page, url)
  await fixture(page)
  const badge = await center(page, "inst000001/badge00001")
  // Click: the top-level instance (board 11).
  await page.mouse.click(badge.x, badge.y)
  await settle(page)
  expect((await selection(page)).join() === "inst000001", "click selects the instance")
  let o = await overlay(page)
  expect(
    o?.selectionTone === "component",
    `instance selection is violet (got ${JSON.stringify(o)})`,
  )
  const slots = (o?.componentOutlines as Rec[] | undefined)?.filter((x) => x.role === "slot")
  expect(
    slots?.length === 1 && slots[0]?.id === "inst000001/actions001" && slots[0]?.empty === true,
    "selected instance lists its empty slot outline",
  )
  // Double-click: enters one level (composite id).
  await page.mouse.dblclick(badge.x, badge.y)
  await settle(page)
  expect(
    (await selection(page)).join() === "inst000001/badge00001",
    `double-click enters the instance (got ${(await selection(page)).join()})`,
  )
  o = await overlay(page)
  expect(o?.selectionTone === "selection", "a plain child inside an instance is blue")
  expect(
    (o?.componentOutlines as Rec[] | undefined)?.some(
      (x) => x.id === "inst000001" && x.role === "instance",
    ),
    "the holding instance keeps its violet outline",
  )
  // Clicking a sibling keeps the entered depth.
  const title = await center(page, "inst000001/title00001")
  await page.mouse.click(title.x, title.y)
  await settle(page)
  expect(
    (await selection(page)).join() === "inst000001/title00001",
    "click on a sibling keeps the depth inside the instance",
  )
  // Escape walks back up to the instance.
  await page.keyboard.press("Escape")
  await settle(page)
  expect((await selection(page)).join() === "inst000001", "Escape selects the instance")
  // ⌘-click: deepest.
  await page.mouse.click(10, 10)
  await page.keyboard.down("Meta")
  await page.mouse.click(badge.x, badge.y)
  await page.keyboard.up("Meta")
  await settle(page)
  expect(
    (await selection(page)).join() === "inst000001/badge00001",
    "⌘-click selects the deepest composite id",
  )
  // Hover a main → violet main outline instead of the blue hover.
  await page.mouse.click(10, 10)
  // Hover the main's own padding (its children hover themselves, blue).
  const mb = await center(page, "main000001")
  const mw = await world(page, "main000001")
  const zoom = await page.evaluate(() => {
    const k = (window as unknown as W).__kimo.canvas()
    return k.worldToScreen({ x: 1, y: 0 }).x - k.worldToScreen({ x: 0, y: 0 }).x
  })
  const main = { x: mb.x, y: mb.y + ((mw?.h ?? 0) / 2 - 4) * zoom }
  await page.mouse.move(main.x, main.y)
  await page.mouse.move(main.x + 1, main.y + 1)
  await settle(page)
  o = await overlay(page)
  expect(
    (o?.componentOutlines as Rec[] | undefined)?.some(
      (x) => x.id === "main000001" && x.role === "main",
    ),
    "hovered main gets the 1.5 violet main outline",
  )
  // Root labels: CanvasLabel/Component + CanvasLabel/Instance (violet).
  const label = page.locator('.canvas-host__label[data-artboard="main000001"]')
  expect((await label.getAttribute("data-label-kind")) === "component", "main label kind")
  const color = await label.evaluate((el) => getComputedStyle(el).color)
  expect(color === "rgb(124, 58, 237)", `main label is component violet (got ${color})`)
  const gap = await label.evaluate((el) => getComputedStyle(el).gap)
  expect(gap === "4px", `label gap 4 (got ${gap})`)
  const glyph = await label.locator("svg").boundingBox()
  expect(glyph && Math.round(glyph.width) === 12, "label glyph 12")
  expect(
    (await page
      .locator('.canvas-host__label[data-artboard="inst000001"]')
      .getAttribute("data-label-kind")) === "instance",
    "instance label kind",
  )
}

async function canvasEditsRouteToOverrides({ page, url }: E2EContext) {
  await openEditor(page, url)
  await fixture(page)
  // Delete key on an entered child → hidden instead (board 15), one undo step.
  await page.evaluate(() =>
    (window as unknown as W).__kimo.session.ui.getState().select(["inst000001/badge00001"]),
  )
  await settle(page)
  const before = await docJson(page)
  await page.locator('[data-testid="canvas"]').focus()
  await page.keyboard.press("Delete")
  await settle(page)
  const inst = await getNode(page, "inst000001")
  const ov = (inst?.overrides as Rec | undefined)?.badge00001 as Rec | undefined
  expect((ov?.set as Rec | undefined)?.visible === false, "Delete on the canvas hides")
  expect((await getNode(page, "badge00001"))?.visible === undefined, "main untouched")
  expect(
    await page.evaluate(() =>
      (window as unknown as W).__kimo.m3.toasts
        .get()
        .some((t) => t.text === "Can't delete Badge inside an instance. It was hidden instead"),
    ),
    "board 15 hidden-instead toast",
  )
  expect(!(await world(page, "inst000001/badge00001"))?.visible, "hidden on the canvas")
  await page.evaluate(() => (window as unknown as W).__kimo.session.store.undo("user"))
  await settle(page)
  expect((await docJson(page)) === before, "one undo step restores")
  // Double-click into a text inside the instance and type: an override of `content`.
  const title = await center(page, "inst000001/title00001")
  await page.mouse.click(title.x, title.y)
  await page.mouse.dblclick(title.x, title.y)
  await settle(page)
  await page.mouse.dblclick(title.x, title.y)
  const editor = page.locator(".canvas-host__text-editor")
  await editor.waitFor()
  await page.keyboard.press("ControlOrMeta+a")
  await page.keyboard.type("Pro plan")
  await page.keyboard.press("Escape")
  await settle(page)
  const t = (await getNode(page, "inst000001"))?.overrides as Rec | undefined
  expect(
    ((t?.title00001 as Rec | undefined)?.set as Rec | undefined)?.content === "Pro plan",
    `text edit inside an instance → override (got ${JSON.stringify(t)})`,
  )
  expect((await getNode(page, "title00001"))?.content === "Plan name", "main text unchanged")
  // A drag on an instance child does not move it (moves are refused inside instances).
  const b0 = await world(page, "inst000001/title00001")
  const p = await center(page, "inst000001/title00001")
  await page.mouse.move(p.x, p.y)
  await page.mouse.down()
  await page.mouse.move(p.x + 40, p.y + 40, { steps: 4 })
  await page.mouse.up()
  await settle(page)
  const b1 = await world(page, "inst000001/title00001")
  expect(b0?.x === b1?.x && b0?.y === b1?.y, "instance children don't move")
}

async function livePropagation({ page, url }: E2EContext) {
  await openEditor(page, url)
  await fixture(page)
  const bx = await world(page, "inst000001/badge00001")
  // Main edit: badge fill + size → every instance follows on the next frame.
  const t0 = await page.evaluate(() => performance.now())
  await page.evaluate(() =>
    (window as unknown as W).__kimo.session.apply(
      [{ op: "update", id: "badge00001", set: { fill: "#2F6BFF", w: 160 } }],
      "Main edit",
    ),
  )
  await settle(page)
  const t1 = await page.evaluate(() => performance.now())
  const bx2 = await world(page, "inst000001/badge00001")
  expect(bx && bx2 && bx2.w === 160 && bx.w === 120, `instance badge follows (w ${bx2?.w})`)
  const rgb = await pixel(page, "inst000001", 0.25, (16 + 20 + 10 + 20) / 200)
  // Badge sits under the title; sample inside it and expect the new blue.
  const blue = rgb[2] > 200 && rgb[0] < 120
  if (!blue) {
    const b = await world(page, "inst000001/badge00001")
    const inst = await world(page, "inst000001")
    const fx = ((b?.x ?? 0) - (inst?.x ?? 0) + 10) / (inst?.w ?? 1)
    const fy = ((b?.y ?? 0) - (inst?.y ?? 0) + 10) / (inst?.h ?? 1)
    const again = await pixel(page, "inst000001", fx, fy)
    expect(again[2] > 200 && again[0] < 120, `instance pixels repainted blue (got ${again})`)
  }
  // An override on the instance wins over later main edits of the same field.
  await page.evaluate(() =>
    (window as unknown as W).__kimo.session.apply(
      [{ op: "update", id: "inst000001/badge00001", set: { w: 60 } }],
      "Override",
    ),
  )
  await page.evaluate(() =>
    (window as unknown as W).__kimo.session.apply(
      [{ op: "update", id: "badge00001", set: { w: 100 } }],
      "Main edit 2",
    ),
  )
  await settle(page)
  expect((await world(page, "inst000001/badge00001"))?.w === 60, "override wins over main")
  expect((await world(page, "badge00001"))?.w === 100, "main changed")
  return { ms: t1 - t0 }
}

/** Dispatches an HTML5 component drag (Assets payload) at page point `p`. */
const dragComponent = (
  page: Page,
  p: { x: number; y: number },
  type: "dragover" | "drop",
  alt = false,
) =>
  page.evaluate(
    ({ p, type, alt }) => {
      const el = document.querySelector("main.editor__canvas") as HTMLElement
      const dt = new DataTransfer()
      dt.setData(
        "application/x-kimo-component",
        JSON.stringify({ of: "main000001", name: "Card/Pricing" }),
      )
      const target = document.elementFromPoint(p.x, p.y) ?? el
      target.dispatchEvent(
        new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: p.x,
          clientY: p.y,
          altKey: alt,
          dataTransfer: dt,
        }),
      )
    },
    { p, type, alt },
  )

async function dragFromAssets({ page, url }: E2EContext) {
  await openEditor(page, url)
  await fixture(page)
  // Over the instance's slot: insertion bar overlay + slot hint.
  const slot = await center(page, "inst000001/actions001")
  await dragComponent(page, slot, "dragover")
  await settle(page)
  let o = await overlay(page)
  const drop = o?.instanceDrop as Rec | null | undefined
  expect(
    drop?.kind === "slot" && drop.slotId === "inst000001/actions001",
    `slot insertion bar (got ${JSON.stringify(drop)})`,
  )
  await page.locator('[data-testid="drop-hint"]', { hasText: "slot" }).waitFor()
  // Over a plain child: replace target.
  const badge = await center(page, "inst000001/badge00001")
  await dragComponent(page, badge, "dragover")
  await page.waitForTimeout(60)
  await dragComponent(page, badge, "dragover")
  await settle(page)
  o = await overlay(page)
  expect(
    (o?.instanceDrop as Rec | null)?.kind === "replace",
    `replace target overlay (got ${JSON.stringify(o?.instanceDrop)})`,
  )
  // Drop into the slot: one instance in the slot, one undo step, overlay cleared.
  await page.waitForTimeout(60)
  const before = await docJson(page)
  await dragComponent(page, slot, "drop")
  await settle(page)
  o = await overlay(page)
  expect(!o?.instanceDrop, "drop clears the overlay")
  const kids = await page.evaluate(() => {
    const s = (window as unknown as W).__kimo.session.store
    return s.nodeIds().filter((i) => s.getNode(i)?.parent === "inst000001" && s.getNode(i)?.at)
  })
  // A nested instance of its own main is a cycle → refused with the board 15 toast instead.
  const refused = await page.evaluate(() =>
    (window as unknown as W).__kimo.m3.toasts
      .get()
      .some((t) => t.text === "Can't nest a main component inside its own instance"),
  )
  expect(kids.length === 1, `slot drop inserted one instance (refused: ${refused})`)
  if (kids.length === 1) {
    await page.evaluate(() => (window as unknown as W).__kimo.session.store.undo("user"))
    await settle(page)
    expect((await docJson(page)) === before, "slot drop is one undo step")
  }
  // Drop on the empty page: a new instance at the pointer.
  const host = await page.locator('[data-testid="canvas"]').boundingBox()
  expect(host, "canvas")
  const n0 = await page.evaluate(
    () => (window as unknown as W).__kimo.session.store.nodeIds().length,
  )
  const empty = { x: host.x + host.width - 120, y: host.y + host.height - 120 }
  await dragComponent(page, empty, "dragover")
  await page.waitForTimeout(60)
  await dragComponent(page, empty, "drop")
  await settle(page)
  const created = await page.evaluate(() => {
    const s = (window as unknown as W).__kimo.session.store
    return s
      .nodeIds()
      .filter((i) => s.getNode(i)?.type === "instance" && s.getNode(i)?.parent === null)
  })
  expect(
    (await page.evaluate(() => (window as unknown as W).__kimo.session.store.nodeIds().length)) ===
      n0 + 1 && created.length === 2,
    "drop on the page inserts one instance",
  )
  const fresh = created.find((i) => i !== "inst000001") as string
  const fb = await world(page, fresh)
  expect(fb && fb.w === 220, "the dropped instance expands to its main's size")
}

export const scenarios: Scenario[] = [
  {
    name: "m3 canvas: click / double-click / ⌘-click instance paths + overlay",
    run: clickSelectsInstance,
  },
  {
    name: "m3 canvas: Delete + text edit inside an instance → overrides",
    run: canvasEditsRouteToOverrides,
  },
  {
    name: "m3 canvas: main ↔ instance live propagation",
    run: async (ctx) => {
      const r = await livePropagation(ctx)
      ctx.log(`main edit → instance repaint: ${r.ms.toFixed(1)} ms`)
    },
  },
  { name: "m3 canvas: drag from Assets (slot bar, replace box, page drop)", run: dragFromAssets },
]
