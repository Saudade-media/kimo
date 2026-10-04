/**
 * Adversarial QA (M1): canvas interactions beyond the happy paths in canvas.e2e.ts — every
 * resize handle, axis-constrained move, Escape cancels, gestures that pass back through their
 * start point, creation inside frames, text commit paths, marquee modifiers, delete / duplicate /
 * group of multi-selections, lock, nudge, pan/zoom shortcuts and keyboard focus guards.
 * All shapes are drawn far left of the sample (world x < -1000) so nothing overlaps.
 */
import type { Page } from "playwright"
import {
  box,
  centerOf,
  children,
  drag,
  dragPath,
  drawShape,
  field,
  type Hook,
  idOf,
  node,
  nodeCount,
  openEditor,
  type Pt,
  redo,
  row,
  select,
  setField,
  settle,
  setViewport,
  toPage,
  ui,
  undo,
  world,
} from "./qa-helpers"
import { expect, type Scenario } from "./run"

/** Pans so world x -2000…-1096 / y -50…800 is on screen at 100%. */
async function openLeft(page: Page, url: string) {
  await openEditor(page, url)
  await setViewport(page, { x: -2000, y: -50, zoom: 1 })
  await settle(page)
}

const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export const scenarios: Scenario[] = [
  {
    name: "qa: resize from each of the 8 handles (+ alt from center), each one undo step",
    async run(ctx) {
      const { page, url } = ctx
      await openLeft(page, url)
      const r = await drawShape(page, "r", { x: -1800, y: 100 }, { x: -1600, y: 200 })
      const b0 = box(await node(page, r))
      expect(eq(b0, { x: -1800, y: 100, w: 200, h: 100 }), `drawn ${JSON.stringify(b0)}`)
      const { x, y, w, h } = b0
      const cases: [string, Pt, { x: number; y: number; w: number; h: number }][] = [
        ["nw", { x, y }, { x: x + 20, y: y + 10, w: w - 20, h: h - 10 }],
        ["n", { x: x + w / 2, y }, { x, y: y + 10, w, h: h - 10 }],
        ["ne", { x: x + w, y }, { x, y: y + 10, w: w + 20, h: h - 10 }],
        ["e", { x: x + w, y: y + h / 2 }, { x, y, w: w + 20, h }],
        ["se", { x: x + w, y: y + h }, { x, y, w: w + 20, h: h + 10 }],
        ["s", { x: x + w / 2, y: y + h }, { x, y, w, h: h + 10 }],
        ["sw", { x, y: y + h }, { x: x + 20, y, w: w - 20, h: h + 10 }],
        ["w", { x, y: y + h / 2 }, { x: x + 20, y, w: w - 20, h }],
      ]
      for (const [name, at, want] of cases) {
        await select(page, [r])
        await settle(page)
        const p = await toPage(page, at)
        await drag(page, p, { x: p.x + 20, y: p.y + 10 })
        const got = box(await node(page, r))
        expect(
          eq(got, want),
          `${name} handle → ${JSON.stringify(got)} (want ${JSON.stringify(want)})`,
        )
        await undo(page)
        const back = box(await node(page, r))
        expect(eq(back, b0), `${name} undo → ${JSON.stringify(back)}`)
      }
      // Alt: resize symmetrically around the center (east edge +20 → x -20, w +40).
      await select(page, [r])
      await settle(page)
      const e = await toPage(page, { x: x + w, y: y + h / 2 })
      await page.keyboard.down("Alt")
      await drag(page, e, { x: e.x + 20, y: e.y })
      await page.keyboard.up("Alt")
      const alt = box(await node(page, r))
      expect(eq(alt, { x: x - 20, y, w: w + 40, h }), `alt-resize → ${JSON.stringify(alt)}`)
    },
  },
  {
    name: "qa: dragging a resize handle past the opposite edge flips the shape",
    async run(ctx) {
      const { page, url } = ctx
      await openLeft(page, url)
      const r = await drawShape(page, "r", { x: -1800, y: 100 }, { x: -1600, y: 200 })
      await select(page, [r])
      await settle(page)
      const e2 = await toPage(page, { x: -1600, y: 150 })
      await drag(page, e2, { x: e2.x - 260, y: e2.y })
      const flip = box(await node(page, r))
      expect(flip.w === 60 && flip.x === -1860, `east handle -260 → ${JSON.stringify(flip)}`)
    },
  },
  {
    name: "qa: shift-drag move locks to the dominant axis",
    async run(ctx) {
      const { page, url } = ctx
      await openLeft(page, url)
      const r = await drawShape(page, "r", { x: -1800, y: 100 }, { x: -1700, y: 200 })
      // Shift pressed only after the drag started.
      const c = await centerOf(page, r)
      await dragPath(page, [c, { x: c.x + 10, y: c.y + 2 }], { release: false })
      await page.keyboard.down("Shift")
      await page.mouse.move(c.x + 60, c.y + 12, { steps: 4 })
      await settle(page)
      await page.mouse.up()
      await page.keyboard.up("Shift")
      await settle(page)
      let n = box(await node(page, r))
      expect(n.x === -1740 && n.y === 100, `shift mid-drag → ${n.x},${n.y}`)
      await undo(page)
      // Shift held from the press on an already-selected shape (the usual way).
      await select(page, [r])
      const c2 = await centerOf(page, r)
      await page.keyboard.down("Shift")
      await drag(page, c2, { x: c2.x + 60, y: c2.y + 12 })
      await page.keyboard.up("Shift")
      n = box(await node(page, r))
      expect(n.x === -1740 && n.y === 100, `shift-drag from press → ${n.x},${n.y}`)
      expect(
        (await ui(page)).selection.join() === r,
        `still selected (${(await ui(page)).selection})`,
      )
    },
  },
  {
    name: "qa: Escape during a drag-move / resize / draw cancels it with no undo entry",
    async run(ctx) {
      const { page, url } = ctx
      await openLeft(page, url)
      const r = await drawShape(page, "r", { x: -1800, y: 100 }, { x: -1700, y: 200 })
      const c = await centerOf(page, r)
      await dragPath(page, [c, { x: c.x + 80, y: c.y + 40 }], { release: false })
      await page.keyboard.press("Escape")
      await page.mouse.up()
      await settle(page)
      let n = box(await node(page, r))
      expect(n.x === -1800 && n.y === 100, `move cancelled → ${n.x},${n.y}`)
      // Resize cancel.
      await select(page, [r])
      await settle(page)
      const se = await toPage(page, { x: -1700, y: 200 })
      await dragPath(page, [se, { x: se.x + 50, y: se.y + 50 }], { release: false })
      await page.keyboard.press("Escape")
      await page.mouse.up()
      await settle(page)
      n = box(await node(page, r))
      expect(n.w === 100 && n.h === 100, `resize cancelled → ${n.w}×${n.h}`)
      // Draw cancel.
      const before = await nodeCount(page)
      await page.keyboard.press("r")
      const a = await toPage(page, { x: -1500, y: 400 })
      await dragPath(page, [a, { x: a.x + 80, y: a.y + 80 }], { release: false })
      await page.keyboard.press("Escape")
      await page.mouse.up()
      await settle(page)
      expect((await nodeCount(page)) === before, "draw cancelled leaves no node")
      // The only undo entry left is the rect creation.
      await undo(page)
      expect((await node(page, r)) === null, "one undo removes the created rect")
    },
  },
  {
    name: "qa: drag-move that passes back through its start keeps the previous edit",
    async run(ctx) {
      const { page, url } = ctx
      await openLeft(page, url)
      const r = await drawShape(page, "r", { x: -1800, y: 100 }, { x: -1700, y: 200 })
      // A panel edit just before the gesture.
      await setField(page, "Width", "150")
      expect((await node(page, r))?.w === 150, "W = 150")
      // Drag right, back exactly to the start, then right again; release.
      const c = await centerOf(page, r)
      await dragPath(page, [c, { x: c.x + 40, y: c.y }, c, { x: c.x + 20, y: c.y }])
      const n = await node(page, r)
      expect(n?.x === -1780, `moved to x ${n?.x}`)
      expect(n?.w === 150, `the earlier W edit survived the gesture (w ${n?.w})`)
      await undo(page)
      const u = await node(page, r)
      expect(u?.x === -1800 && u?.w === 150, `undo reverts only the move (x ${u?.x}, w ${u?.w})`)
    },
  },
  {
    name: "qa: ⌘Z, arrows and Delete during a drag-move do not corrupt history",
    async run(ctx) {
      const { page, url } = ctx
      await openLeft(page, url)
      const r = await drawShape(page, "r", { x: -1800, y: 100 }, { x: -1700, y: 200 })
      await setField(page, "Width", "150")
      await page.locator(".canvas-host").focus()
      const c = await centerOf(page, r)
      await dragPath(page, [c, { x: c.x + 20, y: c.y }], { release: false })
      await settle(page)
      await page.keyboard.press("ControlOrMeta+z")
      await page.keyboard.press("ArrowRight")
      await page.keyboard.press("Backspace")
      await page.mouse.move(c.x + 40, c.y, { steps: 3 })
      await settle(page)
      await page.mouse.up()
      await settle(page)
      const n = await node(page, r)
      expect(n !== null, "not deleted mid-drag")
      expect(n?.x === -1760 && n?.w === 150, `moved, W kept (x ${n?.x}, w ${n?.w})`)
      await undo(page)
      const u = await node(page, r)
      expect(u?.x === -1800 && u?.w === 150, `one undo reverts the move (x ${u?.x}, w ${u?.w})`)
    },
  },
  {
    name: "qa: resize that passes back through its start keeps the previous edit",
    async run(ctx) {
      const { page, url } = ctx
      await openLeft(page, url)
      const r = await drawShape(page, "r", { x: -1800, y: 100 }, { x: -1700, y: 200 })
      await page.keyboard.press("ArrowDown") // nudge: y 101
      await select(page, [r])
      await settle(page)
      const e = await toPage(page, { x: -1700, y: 151 })
      await dragPath(page, [e, { x: e.x + 30, y: e.y }, e, { x: e.x + 10, y: e.y }])
      const n = await node(page, r)
      expect(n?.w === 110, `resized w ${n?.w}`)
      expect(n?.y === 101, `the earlier nudge survived the gesture (y ${n?.y})`)
    },
  },
  {
    name: "qa: create every shape by click and drag, inside a free frame, with shift",
    async run(ctx) {
      const { page, url } = ctx
      await openLeft(page, url)
      const f = await drawShape(page, "f", { x: -1900, y: 50 }, { x: -1500, y: 450 })
      let n = await node(page, f)
      expect(n?.type === "frame" && n?.parent === null && n.w === 400, `frame ${JSON.stringify(n)}`)
      // Rectangle dragged inside the frame → child of it, frame-local coordinates.
      const r = await drawShape(page, "r", { x: -1850, y: 100 }, { x: -1750, y: 160 })
      n = await node(page, r)
      expect(
        n?.parent === f && n.x === 50 && n.y === 50 && n.w === 100 && n.h === 60,
        `rect in frame ${JSON.stringify(n)}`,
      )
      // Ellipse by click inside the frame → 100×100 child.
      await page.keyboard.press("o")
      const pe = await toPage(page, { x: -1700, y: 300 })
      await page.mouse.click(pe.x, pe.y)
      await settle(page)
      const el = (await ui(page)).selection[0] as string
      n = await node(page, el)
      expect(
        n?.type === "ellipse" && n.parent === f && n.w === 100 && n.h === 100,
        `ellipse click ${JSON.stringify(n)}`,
      )
      // Rectangle dragged up-left with shift → square anchored at the press point.
      const a = { x: -1300, y: 400 }
      await page.keyboard.press("r")
      await page.keyboard.down("Shift")
      const pa = await toPage(page, a)
      await drag(page, pa, { x: pa.x - 80, y: pa.y - 30 })
      await page.keyboard.up("Shift")
      const sq = (await ui(page)).selection[0] as string
      n = await node(page, sq)
      expect(
        n?.w === 80 && n.h === 80 && n.x === -1380 && n.y === 320,
        `shift square up-left ${JSON.stringify(n)}`,
      )
      // Text tool click inside the frame → text child.
      await page.keyboard.press("t")
      const pt = await toPage(page, { x: -1880, y: 400 })
      await page.mouse.click(pt.x, pt.y)
      await page.getByRole("textbox", { name: "Edit text" }).waitFor()
      await page.keyboard.type("Inside")
      await page.keyboard.press("Escape")
      await settle(page)
      const t = (await ui(page)).selection[0] as string
      n = await node(page, t)
      expect(n?.type === "text" && n.parent === f, `text in frame ${JSON.stringify(n)}`)
      // Each creation is one undo step (text, square, ellipse, rect, frame).
      for (const id of [t, sq, el, r, f]) {
        await undo(page)
        expect((await node(page, id)) === null, `undo removes ${id}`)
      }
      // And redo restores them in order.
      for (const id of [f, r, el, sq, t]) {
        await redo(page)
        expect((await node(page, id)) !== null, `redo restores ${id}`)
      }
      // Toolbar buttons pick the same tools.
      for (const [tool, want] of [
        ["rectangle", "rect"],
        ["ellipse", "ellipse"],
        ["frame", "frame"],
        ["text", "text"],
      ] as const) {
        // Board 27 §5: Rectangle and Ellipse share the shape slot; the flyout lists both.
        if (tool === "rectangle" || tool === "ellipse") {
          await page.locator(".shape-slot__caret").click()
          await page.locator(`.shape-flyout [data-tool="${tool}"]`).click()
        } else await page.locator(`.floating-toolbar [data-tool="${tool}"]`).click()
        expect((await ui(page)).tool === want, `toolbar ${tool} → ${(await ui(page)).tool}`)
      }
    },
  },
  {
    name: "qa: text commit by clicking away, empty text discarded, clearing deletes",
    async run(ctx) {
      const { page, url } = ctx
      await openLeft(page, url)
      const editor = page.getByRole("textbox", { name: "Edit text" })
      // Type then click on empty canvas → committed.
      await page.locator(".canvas-host").focus()
      await page.keyboard.press("t")
      const p = await toPage(page, { x: -1800, y: 100 })
      await page.mouse.click(p.x, p.y)
      await editor.waitFor()
      await page.keyboard.type("Clicked away")
      const away = await toPage(page, { x: -1300, y: 600 })
      await page.mouse.click(away.x, away.y)
      await settle(page)
      const t = await idOf(page, "Text 1")
      expect(t !== null, "text committed by clicking away")
      expect((await node(page, t as string))?.content === "Clicked away", "content")
      expect(!(await editor.isVisible()), "editor closed")
      // Empty text → no node.
      const before = await nodeCount(page)
      await page.keyboard.press("t")
      const q = await toPage(page, { x: -1800, y: 300 })
      await page.mouse.click(q.x, q.y)
      await editor.waitFor()
      await page.keyboard.press("Escape")
      await settle(page)
      expect((await nodeCount(page)) === before, "empty text discarded")
      const toolAfterEmpty = (await ui(page)).tool
      await page.keyboard.press("v")
      // Multi-line: Enter inserts a newline (Escape commits).
      const tc = await centerOf(page, t as string)
      await select(page, [t as string])
      await page.mouse.dblclick(tc.x, tc.y)
      await editor.waitFor()
      await page.keyboard.press("End")
      await page.keyboard.press("Enter")
      await page.keyboard.type("line 2")
      await page.keyboard.press("Escape")
      await settle(page)
      const c2 = (await node(page, t as string))?.content
      expect(c2 === "Clicked away\nline 2", `multi-line ${JSON.stringify(c2)}`)
      // Clearing the content deletes the node; one undo brings it back.
      const tc2 = await centerOf(page, t as string)
      await page.mouse.dblclick(tc2.x, tc2.y)
      await editor.waitFor()
      await page.keyboard.press("ControlOrMeta+a")
      await page.keyboard.press("Backspace")
      await page.keyboard.press("Escape")
      await settle(page)
      expect((await node(page, t as string)) === null, "cleared text deleted")
      await undo(page)
      expect((await node(page, t as string))?.content === "Clicked away\nline 2", "undo restores")
      // ⌘Z inside the text editor is the textarea's undo, not the document's.
      const tc3 = await centerOf(page, t as string)
      await page.mouse.dblclick(tc3.x, tc3.y)
      await editor.waitFor()
      await page.keyboard.type("!")
      await page.keyboard.press("ControlOrMeta+z")
      expect((await node(page, t as string)) !== null, "⌘Z while editing doesn't undo the doc")
      await page.keyboard.press("Escape")
      expect(
        toolAfterEmpty === "select",
        `tool back to select after empty text (${toolAfterEmpty})`,
      )
    },
  },
  {
    name: "qa: marquee — shift adds, Escape restores, reverse drag selects",
    async run(ctx) {
      const { page, url } = ctx
      await openLeft(page, url)
      const r1 = await drawShape(page, "r", { x: -1900, y: 100 }, { x: -1850, y: 150 })
      const r2 = await drawShape(page, "r", { x: -1800, y: 100 }, { x: -1750, y: 150 })
      const r3 = await drawShape(page, "r", { x: -1700, y: 100 }, { x: -1650, y: 150 })
      // Bottom-right → top-left over r1 and r2.
      await drag(
        page,
        await toPage(page, { x: -1760, y: 170 }),
        await toPage(page, { x: -1950, y: 60 }),
      )
      let s = (await ui(page)).selection
      expect(s.length === 2 && s.includes(r1) && s.includes(r2), `reverse marquee (${s})`)
      // Shift-marquee adds r3.
      await page.keyboard.down("Shift")
      await drag(
        page,
        await toPage(page, { x: -1720, y: 60 }),
        await toPage(page, { x: -1600, y: 170 }),
      )
      await page.keyboard.up("Shift")
      s = (await ui(page)).selection
      expect(s.length === 3 && s.includes(r3), `shift-marquee adds (${s})`)
      // Escape mid shift-marquee restores the previous selection.
      await select(page, [r3])
      await page.keyboard.down("Shift")
      await dragPath(
        page,
        [await toPage(page, { x: -1950, y: 60 }), await toPage(page, { x: -1600, y: 170 })],
        { release: false },
      )
      await page.keyboard.press("Escape")
      await page.mouse.up()
      await page.keyboard.up("Shift")
      await settle(page)
      s = (await ui(page)).selection
      expect(s.join() === r3, `escape restores selection (${s})`)
      // A tiny drag below the threshold on empty canvas is a click: clears.
      const e = await toPage(page, { x: -1300, y: 500 })
      await drag(page, e, { x: e.x + 1, y: e.y + 1 })
      expect((await ui(page)).selection.length === 0, "sub-threshold drag clears")
    },
  },
  {
    name: "qa: delete / duplicate / frame a multi-selection, one undo step each",
    async run(ctx) {
      const { page, url } = ctx
      await openLeft(page, url)
      const r1 = await drawShape(page, "r", { x: -1900, y: 100 }, { x: -1850, y: 150 })
      const r2 = await drawShape(page, "r", { x: -1800, y: 100 }, { x: -1750, y: 150 })
      const r3 = await drawShape(page, "r", { x: -1700, y: 100 }, { x: -1650, y: 150 })
      await select(page, [r1, r2, r3])
      await page.locator(".canvas-host").focus()
      await page.keyboard.press("Delete")
      for (const id of [r1, r2, r3]) expect((await node(page, id)) === null, `deleted ${id}`)
      await undo(page)
      for (const id of [r1, r2, r3]) expect((await node(page, id)) !== null, `restored ${id}`)
      // Duplicate two roots: both copies, one undo.
      await select(page, [r1, r2])
      const count = await nodeCount(page)
      await page.keyboard.press("ControlOrMeta+d")
      await settle(page)
      const dup = (await ui(page)).selection
      expect(dup.length === 2 && (await nodeCount(page)) === count + 2, `dup ${dup}`)
      await undo(page)
      expect((await nodeCount(page)) === count, "one undo removes both copies")
      const sel = (await ui(page)).selection
      expect(!sel.some((id) => dup.includes(id)), `selection pruned after undo (${sel})`)
      // Frame r1+r2, then duplicate a child inside the frame (+10/+10, same parent).
      await select(page, [r1, r2])
      await page.keyboard.press("ControlOrMeta+Alt+g") // ⌥⌘G wrap in frame
      await settle(page)
      const frame = (await ui(page)).selection[0] as string
      expect((await node(page, r1))?.parent === frame, "framed")
      await select(page, [r2])
      await page.keyboard.press("ControlOrMeta+d")
      await settle(page)
      const c = (await ui(page)).selection[0] as string
      const cn = await node(page, c)
      const r2n = await node(page, r2)
      expect(
        cn?.parent === frame &&
          cn.x === (r2n?.x as number) + 16 &&
          cn.y === (r2n?.y as number) + 16,
        `child dup ${JSON.stringify(cn)}`,
      )
      // Framing nodes with different parents does nothing.
      const n0 = await nodeCount(page)
      await select(page, [r1, r3])
      await page.keyboard.press("ControlOrMeta+g")
      await settle(page)
      expect((await nodeCount(page)) === n0, "cross-parent frame rejected")
      expect((await node(page, r3))?.parent === null, "r3 untouched")
      // Duplicate a flow child (Navbar) → right after it in the auto-layout parent.
      const navbar = (await idOf(page, "Navbar")) as string
      const desk = (await idOf(page, "Home — Desktop")) as string
      await select(page, [navbar])
      await page.keyboard.press("ControlOrMeta+d")
      await settle(page)
      const nd = (await ui(page)).selection[0] as string
      const kids = await children(page, desk)
      expect(kids.indexOf(nd) === kids.indexOf(navbar) + 1, `flow dup order ${kids}`)
      // Undo the frame, then redo it.
      await undo(page) // navbar dup
      await undo(page) // child dup
      await undo(page) // frame
      expect(
        (await node(page, frame)) === null && (await node(page, r1))?.parent === null,
        "unframed",
      )
      await redo(page)
      expect((await node(page, r1))?.parent === frame, "redo frames again")
    },
  },
  {
    name: "qa: locked layer — not moved, resized, nudged or deleted from the canvas",
    async run(ctx) {
      const { page, url } = ctx
      await openLeft(page, url)
      const r = await drawShape(page, "r", { x: -1800, y: 100 }, { x: -1700, y: 200 })
      const name = (await node(page, r))?.name as string
      const lr = row(page, name)
      await lr.hover()
      await lr.getByRole("button", { name: "Lock layer" }).click()
      expect((await node(page, r))?.locked === true, "locked")
      await select(page, [r])
      await page.locator(".canvas-host").focus()
      await page.keyboard.press("ArrowRight")
      await page.keyboard.press("Backspace")
      expect((await node(page, r)) !== null, "locked not deleted")
      expect((await node(page, r))?.x === -1800, "locked not nudged")
      const c = await centerOf(page, r)
      await drag(page, c, { x: c.x + 40, y: c.y + 40 })
      expect((await node(page, r))?.x === -1800, "locked not dragged")
      await select(page, [r])
      await settle(page)
      const se = await toPage(page, { x: -1700, y: 200 })
      await drag(page, se, { x: se.x + 30, y: se.y + 30 })
      expect((await node(page, r))?.w === 100, "locked not resized")
      // Lock is one undo step and unlock works.
      await undo(page)
      expect((await node(page, r))?.locked === undefined, "undo unlocks")
      await select(page, [r])
      await page.locator(".canvas-host").focus()
      await page.keyboard.press("ArrowRight")
      expect((await node(page, r))?.x === -1799, "unlocked nudges")
    },
  },
  {
    name: "qa: nudge multi-selection by 1 and 10, ignoring flow children",
    async run(ctx) {
      const { page, url } = ctx
      await openLeft(page, url)
      const r1 = await drawShape(page, "r", { x: -1900, y: 100 }, { x: -1850, y: 150 })
      const r2 = await drawShape(page, "r", { x: -1800, y: 100 }, { x: -1750, y: 150 })
      await select(page, [r1, r2])
      await page.locator(".canvas-host").focus()
      for (const k of ["ArrowLeft", "ArrowUp", "Shift+ArrowRight", "Shift+ArrowDown"])
        await page.keyboard.press(k)
      for (const [id, x0] of [
        [r1, -1900],
        [r2, -1800],
      ] as const) {
        const n = box(await node(page, id))
        expect(n.x === x0 + 9 && n.y === 109, `${id} nudged to ${n.x},${n.y}`)
      }
      // Four nudges = four undo steps.
      for (let i = 0; i < 4; i++) await undo(page)
      expect((await node(page, r1))?.x === -1900 && (await node(page, r1))?.y === 100, "undone")
      // Flow child stays computed (no x written).
      const navbar = (await idOf(page, "Navbar")) as string
      await select(page, [navbar])
      await page.keyboard.press("ArrowRight")
      expect((await node(page, navbar))?.x === undefined, "flow child not nudged")
    },
  },
  {
    name: "qa: pan / zoom shortcuts (⌘0, ⌘=, ⌘-, shift+2, H tool, clamps)",
    async run(ctx) {
      const { page, url } = ctx
      await openLeft(page, url)
      const r = await drawShape(page, "r", { x: -1800, y: 100 }, { x: -1700, y: 200 })
      await page.locator(".canvas-host").focus()
      await page.keyboard.press("ControlOrMeta+Equal")
      let v = (await ui(page)).viewport
      expect(v.zoom === 2, `⌘= → ${v.zoom}`)
      await page.keyboard.press("ControlOrMeta+Minus")
      await page.keyboard.press("ControlOrMeta+Minus")
      v = (await ui(page)).viewport
      expect(v.zoom === 0.5, `⌘- ⌘- → ${v.zoom}`)
      await page.keyboard.press("ControlOrMeta+Digit0")
      expect((await ui(page)).viewport.zoom === 1, "⌘0 → 100%")
      // shift+2 zooms to the selection: the rect is centered.
      await select(page, [r])
      await page.keyboard.press("Shift+Digit2")
      await settle(page)
      v = (await ui(page)).viewport
      const host = await page.locator(".canvas-host").boundingBox()
      const c = await centerOf(page, r)
      expect(
        host !== null &&
          Math.abs(c.x - (host.x + host.width / 2)) < 1 &&
          Math.abs(c.y - (host.y + host.height / 2)) < 1,
        `shift+2 centers selection (${JSON.stringify(c)} vs ${JSON.stringify(host)})`,
      )
      // Min zoom clamp.
      for (let i = 0; i < 20; i++) await page.keyboard.press("-")
      const minZoom = (await ui(page)).viewport.zoom
      expect(minZoom > 0 && minZoom <= 0.05, `zoom-out clamps (${minZoom})`)
      // Hand tool (H) drag pans and does not select or move.
      await page.keyboard.press("Shift+Digit0")
      await setViewport(page, { x: -2000, y: -50 })
      await settle(page)
      await page.evaluate(() =>
        (
          (window as unknown as { __kimo: Hook }).__kimo.session.ui.getState() as unknown as {
            setTool(t: string): void
          }
        ).setTool("hand"),
      )
      const cc = await centerOf(page, r)
      await select(page, [])
      await drag(page, cc, { x: cc.x + 100, y: cc.y + 50 })
      v = (await ui(page)).viewport
      expect(v.x === -2100 && v.y === -100, `hand pans ${JSON.stringify(v)}`)
      expect((await node(page, r))?.x === -1800, "hand didn't move the rect")
      expect((await ui(page)).selection.length === 0, "hand didn't select")
      // Shortcuts are ignored while typing in a panel input.
      await page.keyboard.press("v")
      await page.getByRole("searchbox", { name: "Search layers" }).click()
      await page.keyboard.press("Shift+Digit0")
      await page.keyboard.press("=")
      expect((await ui(page)).viewport.zoom === 1, "zoom keys ignored in search box")
    },
  },
  {
    name: "qa: keyboard edits are ignored while typing in panel inputs",
    async run(ctx) {
      const { page, url } = ctx
      await openLeft(page, url)
      const r = await drawShape(page, "r", { x: -1800, y: 100 }, { x: -1700, y: 200 })
      await select(page, [r])
      const search = page.getByRole("searchbox", { name: "Search layers" })
      await search.click()
      await page.keyboard.type("Rect")
      for (const k of ["Backspace", "Delete", "ArrowRight", "ControlOrMeta+d", "r"])
        await page.keyboard.press(k)
      expect((await node(page, r)) !== null, "Backspace in search didn't delete")
      expect((await node(page, r))?.x === -1800, "arrow in search didn't nudge")
      expect((await ui(page)).tool === "select", `tool unchanged (${(await ui(page)).tool})`)
      // Arrow keys inside the W field edit W, not the canvas position.
      await page.getByRole("searchbox", { name: "Search layers" }).fill("")
      await select(page, [r])
      const w = field(page, "Width")
      await w.click()
      await page.keyboard.press("ArrowUp")
      await page.keyboard.press("ArrowLeft")
      const n = await node(page, r)
      expect(n?.w === 101 && n?.x === -1800, `W arrow → w ${n?.w} x ${n?.x}`)
    },
  },
  {
    name: "qa: H key selects the hand tool",
    async run(ctx) {
      const { page, url } = ctx
      await openLeft(page, url)
      await page.locator(".canvas-host").focus()
      await page.keyboard.press("h")
      const t = (await ui(page)).tool
      expect(t === "hand", `H → ${t}`)
    },
  },
  {
    name: "qa: framing flow children (⌘G) keeps their on-canvas boxes",
    async run(ctx) {
      const { page, url } = ctx
      await openEditor(page, url)
      const navbar = (await idOf(page, "Navbar")) as string
      const hero = (await idOf(page, "Hero")) as string
      const nb = await world(page, navbar)
      const hb = await world(page, hero)
      await select(page, [navbar, hero])
      await page.locator(".canvas-host").focus()
      await page.keyboard.press("ControlOrMeta+Alt+g") // ⌥⌘G wrap in frame
      await settle(page)
      const f = (await ui(page)).selection[0] as string
      expect((await node(page, navbar))?.parent === f, "framed")
      const nb2 = await world(page, navbar)
      const hb2 = await world(page, hero)
      ctx.log("navbar", JSON.stringify(nb), "→", JSON.stringify(nb2))
      ctx.log("hero", JSON.stringify(hb), "→", JSON.stringify(hb2))
      const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
      expect(same(nb, nb2) && same(hb, hb2), "children keep their world boxes")
    },
  },
  {
    name: "qa: X field on a flow child is not a silent no-op",
    async run(ctx) {
      const { page, url } = ctx
      await openEditor(page, url)
      const navbar = (await idOf(page, "Navbar")) as string
      await select(page, [navbar])
      await settle(page)
      const x = field(page, "X")
      const disabled = await x.isDisabled()
      if (disabled) return
      const before = await world(page, navbar)
      await x.click()
      await x.fill("100")
      await x.press("Enter")
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
      await settle(page)
      const after = await world(page, navbar)
      const stored = (await node(page, navbar))?.x
      const shown = await x.inputValue()
      ctx.log("stored x", stored, "field", shown, "world", JSON.stringify(after))
      expect(
        after?.x !== before?.x || stored === undefined,
        `X=100 on a flow child wrote x=${stored} but the node did not move (field shows ${shown})`,
      )
    },
  },
]
