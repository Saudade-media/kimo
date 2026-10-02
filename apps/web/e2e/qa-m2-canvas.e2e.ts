/**
 * Adversarial QA of the M2 canvas tools (desing.pen board 10): snapping (move / resize / draw,
 * ⌘ suspend, zoom-scaled threshold, equal spacing), ⌥ measurements, pixel grid, pen tool and
 * path edit edge cases, image placement and icon insertion. Each scenario isolates one claim
 * so a failure maps to one finding.
 */
import type { Page } from "playwright"
import { docJson, node, nodeCount, openEditor, settle, toPage, ui } from "./qa-helpers"
import {
  board,
  collectWarnings,
  dragSteps,
  type M2Hook,
  overlay,
  PNG_3x2,
  spyOverlay,
  stepsBack,
  storeUndo,
} from "./qa-m2-helpers"
import { expect, type Scenario } from "./run"

const ids = (page: Page) =>
  page.evaluate(() => (window as unknown as { __kimo: M2Hook }).__kimo.session.store.nodeIds())
const added = async (page: Page, before: string[]) =>
  (await ids(page)).filter((i) => !before.includes(i))
const sel = (page: Page, s: string[]) =>
  page.evaluate(
    (x) => (window as unknown as { __kimo: M2Hook }).__kimo.session.ui.getState().select(x),
    s,
  )
const vp = async (page: Page, v: { x: number; y: number; zoom: number }) => {
  await page.evaluate(
    (x) => (window as unknown as { __kimo: M2Hook }).__kimo.session.ui.getState().setViewport(x),
    v,
  )
  await settle(page)
}
const canvas = (page: Page) => page.locator(".canvas-host")
const editingPath = (page: Page) =>
  page.evaluate(() => (window as unknown as { __kimo: M2Hook }).__kimo.canvas()?.editingPath())

/** Image (80,128 240×160) and Card (360,140 200×160) of board 10 #1. */
const SNAP_KIDS = [
  { id: "imageRect001", node: { type: "rect", name: "Image", x: 80, y: 128, w: 240, h: 160 } },
  { id: "cardRect0001", node: { type: "rect", name: "Card", x: 360, y: 140, w: 200, h: 160 } },
]

const TRI = {
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
}

async function pen(page: Page) {
  await canvas(page).focus()
  await page.keyboard.press("p")
  await settle(page)
}

async function clickWorld(page: Page, x: number, y: number) {
  const p = await toPage(page, { x, y })
  await page.mouse.click(p.x, p.y)
  await settle(page)
}

export const scenarios: Scenario[] = [
  // --- Snapping -----------------------------------------------------------------------------
  {
    name: "qa-m2: ⌘ pressed mid-drag suspends snapping",
    async run({ page, url, log }) {
      await openEditor(page, url)
      await board(page, SNAP_KIDS)
      const from = await toPage(page, { x: 460, y: 220 })
      await page.mouse.move(from.x, from.y)
      await page.mouse.down()
      for (let i = 1; i <= 4; i++) await page.mouse.move(from.x, from.y - i)
      await page.keyboard.down("Meta")
      for (let i = 5; i <= 9; i++) await page.mouse.move(from.x, from.y - i)
      await settle(page)
      await page.mouse.up()
      await page.keyboard.up("Meta")
      await settle(page)
      const y = (await node(page, "cardRect0001"))?.y
      log("card y", y)
      expect(y === 131, `⌘ held during the drag disables snapping (y ${y}, want 131)`)
    },
  },
  {
    name: "qa-m2: resize snaps the dragged edge to a sibling edge; ⌘ suspends",
    async run({ page, url, log }) {
      await openEditor(page, url)
      await board(page, SNAP_KIDS)
      await sel(page, ["cardRect0001"])
      await settle(page)
      // Bottom edge (y 300) dragged up 9 → 291, 3 from the image's bottom (288).
      const from = await toPage(page, { x: 460, y: 300 })
      await dragSteps(page, from, { x: from.x, y: from.y - 9 })
      const h1 = (await node(page, "cardRect0001"))?.h
      log("snapped h", h1)
      expect(h1 === 148, `bottom edge snapped to 288 (h ${h1}, want 148)`)
      await storeUndo(page)
      await page.keyboard.down("Meta")
      await dragSteps(page, from, { x: from.x, y: from.y - 9 })
      await page.keyboard.up("Meta")
      const h2 = (await node(page, "cardRect0001"))?.h
      expect(h2 === 151, `⌘ suspends resize snapping (h ${h2}, want 151)`)
    },
  },
  {
    name: "qa-m2: drawing snaps the dragged corner to a sibling edge",
    async run({ page, url }) {
      await openEditor(page, url)
      await board(page, SNAP_KIDS)
      await canvas(page).focus()
      await page.keyboard.press("r")
      const a = await toPage(page, { x: 400, y: 330 })
      const b = await toPage(page, { x: 563, y: 370 })
      await dragSteps(page, a, b)
      const id = (await ui(page)).selection[0] as string
      const n = await node(page, id)
      expect(
        n?.x === 400 && n?.w === 160,
        `right edge snapped to the card's 560 (${JSON.stringify(n)})`,
      )
    },
  },
  {
    name: "qa-m2: snap threshold is 5 screen px at any zoom",
    async run({ page, url, log }) {
      await openEditor(page, url)
      await board(page, SNAP_KIDS)
      // Zoom 2: 3 world px = 6 screen px → no snap.
      await vp(page, { x: 200, y: 50, zoom: 2 })
      let from = await toPage(page, { x: 460, y: 220 })
      await dragSteps(page, from, { x: from.x, y: from.y - 18 })
      const y2 = (await node(page, "cardRect0001"))?.y
      log("zoom 2 y", y2)
      expect(y2 === 131, `zoom 2: 6 screen px is outside the threshold (y ${y2})`)
      await storeUndo(page)
      // Zoom 0.5: 4 world px = 2 screen px → snaps.
      await vp(page, { x: -200, y: -200, zoom: 0.5 })
      from = await toPage(page, { x: 460, y: 220 })
      await dragSteps(page, from, { x: from.x, y: from.y - 8 })
      const y05 = (await node(page, "cardRect0001"))?.y
      log("zoom 0.5 y", y05)
      expect(y05 === 128, `zoom 0.5: 2 screen px snaps (y ${y05})`)
    },
  },
  {
    name: "qa-m2: equal spacing snaps a box into the matching gap and shows indicators",
    async run({ page, url, log }) {
      await openEditor(page, url)
      await board(page, [
        { id: "spaceA000001", node: { type: "rect", name: "A", x: 20, y: 100, w: 100, h: 100 } },
        { id: "spaceB000001", node: { type: "rect", name: "B", x: 220, y: 100, w: 100, h: 100 } },
        { id: "spaceC000001", node: { type: "rect", name: "C", x: 470, y: 100, w: 100, h: 100 } },
      ])
      await spyOverlay(page)
      // C dragged left 47 → 423; the equal-gap slot is 420 (gap 100).
      const from = await toPage(page, { x: 520, y: 150 })
      await page.mouse.move(from.x, from.y)
      await page.mouse.down()
      for (let i = 1; i <= 8; i++) await page.mouse.move(from.x - (47 * i) / 8, from.y)
      await settle(page)
      const ov = await overlay(page)
      log("spacing", JSON.stringify(ov?.spacing))
      await page.mouse.up()
      await settle(page)
      const x = (await node(page, "spaceC000001"))?.x
      expect(x === 420, `C snapped into the equal gap (x ${x}, want 420)`)
      expect(
        (ov?.spacing ?? []).filter((s) => s.label === "100").length >= 2,
        "two equal-gap indicators labelled 100 while dragging",
      )
      const after = await overlay(page)
      expect(
        !after?.snap?.lines.length && !after?.spacing?.length,
        "snap guides and spacing cleared on release",
      )
    },
  },
  {
    name: "qa-m2: snap guides follow the drag and hidden siblings are not candidates",
    async run({ page, url }) {
      await openEditor(page, url)
      await board(page, [
        ...SNAP_KIDS,
        {
          id: "hiddenRect01",
          node: { type: "rect", name: "Ghost", x: 360, y: 131, w: 50, h: 50, visible: false },
        },
      ])
      await spyOverlay(page)
      const from = await toPage(page, { x: 460, y: 220 })
      await page.mouse.move(from.x, from.y)
      await page.mouse.down()
      for (let i = 1; i <= 8; i++) await page.mouse.move(from.x, from.y - (8 * i) / 8)
      await settle(page)
      const ov = await overlay(page)
      await page.mouse.up()
      await settle(page)
      const y = (await node(page, "cardRect0001"))?.y
      // Raw 132: the hidden ghost's top (131) is nearer than the image's (128) but must not win.
      expect(y === 128, `snapped to the visible image top, not the hidden layer (y ${y})`)
      expect(
        (ov?.snap?.lines ?? []).some((l) => l.axis === "y" && l.at === 128),
        "a horizontal guide at y 128 while dragging",
      )
    },
  },
  // --- ⌥ measurements ---------------------------------------------------------------------
  {
    name: "qa-m2: ⌥ measures to a hovered sibling and to the parent",
    async run({ page, url, log }) {
      await openEditor(page, url)
      await board(page, [
        { id: "measA0000001", node: { type: "rect", name: "A", x: 0, y: 100, w: 100, h: 100 } },
        { id: "measB0000001", node: { type: "rect", name: "B", x: 200, y: 120, w: 100, h: 100 } },
      ])
      await spyOverlay(page)
      await sel(page, ["measA0000001"])
      const over = await toPage(page, { x: 250, y: 170 })
      await page.mouse.move(over.x, over.y)
      await page.keyboard.down("Alt")
      await page.mouse.move(over.x + 1, over.y)
      await settle(page)
      const a = await overlay(page)
      log("sibling", JSON.stringify(a?.measurements))
      const m = a?.measurements ?? []
      expect(
        m.length === 1 && m[0]?.label === "100" && m[0]?.axis === "x" && m[0]?.at === 160,
        "one 100 gap line centered on the overlap (y 160)",
      )
      expect(a?.measureOutlines?.[0]?.id === "measB0000001", "hovered sibling outlined")
      // Nothing hovered (empty board area): distances to the parent's edges.
      const empty = await toPage(page, { x: 450, y: 350 })
      await page.mouse.move(empty.x, empty.y)
      await page.mouse.move(empty.x + 1, empty.y)
      await settle(page)
      const b = await overlay(page)
      const labels = (b?.measurements ?? []).map((x) => x.label).sort()
      log("parent", JSON.stringify(b?.measurements))
      // Board is the hovered ancestor → parent mode: right 500, top 100, bottom 200 (left 0 omitted).
      expect(JSON.stringify(labels) === '["100","200","500"]', `parent distances ${labels}`)
      await page.keyboard.up("Alt")
      await settle(page)
      const c = await overlay(page)
      expect(!c?.measurements?.length, "releasing ⌥ clears the measurements")
    },
  },
  {
    name: "qa-m2: ⌥ measuring clears when the window loses focus with ⌥ down",
    async run({ page, url }) {
      await openEditor(page, url)
      await board(page, [
        { id: "measA0000001", node: { type: "rect", name: "A", x: 0, y: 100, w: 100, h: 100 } },
      ])
      await spyOverlay(page)
      await sel(page, ["measA0000001"])
      const p = await toPage(page, { x: 450, y: 350 })
      await page.mouse.move(p.x, p.y)
      await page.keyboard.down("Alt")
      await settle(page)
      expect(!!(await overlay(page))?.measurements?.length, "measuring while ⌥ is held")
      await page.evaluate(() => window.dispatchEvent(new Event("blur")))
      await settle(page)
      expect(!(await overlay(page))?.measurements?.length, "blur clears ⌥ measuring")
      await page.keyboard.up("Alt")
    },
  },
  // --- Pixel grid ---------------------------------------------------------------------------
  {
    name: "qa-m2: pixel grid and zoom badge appear only above 400%",
    async run({ page, url, log }) {
      await openEditor(page, url)
      await board(page, [])
      await spyOverlay(page)
      const badge = page.locator(".canvas-zoom-badge")
      await vp(page, { x: 0, y: 0, zoom: 4 })
      await page.waitForTimeout(250)
      const at4 = await overlay(page)
      expect(!at4?.pixelGrid && (await badge.count()) === 0, "no grid / badge at exactly 400%")
      await vp(page, { x: 0, y: 0, zoom: 4.5 })
      await page.waitForTimeout(250)
      await badge.waitFor({ timeout: 2000 })
      const text = await badge.textContent()
      log("badge", text)
      expect(/450%/.test(text ?? ""), `badge reads 450% (${text})`)
      expect((await overlay(page))?.pixelGrid === 1, "grid fully faded in")
    },
  },
  {
    name: "qa-m2: resize at 800% lands on whole pixels",
    async run({ page, url, log }) {
      await openEditor(page, url)
      await board(page, [
        { id: "pixelRect001", node: { type: "rect", name: "Px", x: 10, y: 10, w: 20, h: 20 } },
      ])
      await vp(page, { x: 0, y: 0, zoom: 8 })
      await sel(page, ["pixelRect001"])
      await settle(page)
      const from = await toPage(page, { x: 30, y: 20 })
      await dragSteps(page, from, { x: from.x + 12, y: from.y })
      const n = await node(page, "pixelRect001")
      log("resized", JSON.stringify({ x: n?.x, w: n?.w }))
      expect(Number.isInteger(n?.w) && n?.w !== 20, `whole-pixel width (${n?.w})`)
    },
  },
  {
    name: "qa-m2: drawing and pen anchors at 800% land on whole pixels",
    async run({ page, url, log }) {
      await openEditor(page, url)
      await board(page, [])
      await vp(page, { x: 0, y: 0, zoom: 8 })
      await canvas(page).focus()
      await page.keyboard.press("r")
      const a = await toPage(page, { x: 10.3, y: 10.3 })
      const b = await toPage(page, { x: 30.6, y: 25.2 })
      await dragSteps(page, a, b)
      const r = await node(page, (await ui(page)).selection[0] as string)
      log("drawn", JSON.stringify(r))
      expect(
        [r?.x, r?.y, r?.w, r?.h].every((v) => Number.isInteger(v)),
        `drawn rect on whole pixels (${JSON.stringify(r)})`,
      )
      const before = await ids(page)
      await pen(page)
      await clickWorld(page, 40.4, 10.6)
      await clickWorld(page, 52.7, 20.3)
      await page.keyboard.press("Enter")
      await settle(page)
      const p = await node(page, (await added(page, before))[0] as string)
      log("pen", JSON.stringify(p))
      expect(
        [p?.x, p?.y, p?.w, p?.h].every((v) => Number.isInteger(v)),
        `pen path on whole pixels (${JSON.stringify(p)})`,
      )
    },
  },
  // --- Pen tool -------------------------------------------------------------------------------
  {
    name: "qa-m2: pen — Esc with one anchor writes nothing and returns to Move",
    async run({ page, url }) {
      await openEditor(page, url)
      await board(page, [])
      const before = await docJson(page)
      await pen(page)
      await clickWorld(page, 100, 100)
      await page.keyboard.press("Escape")
      await settle(page)
      expect((await docJson(page)) === before, "no node written")
      expect((await ui(page)).tool === "select", "back to Move")
    },
  },
  {
    name: "qa-m2: pen — Backspace removes the last anchor before commit",
    async run({ page, url, log }) {
      await openEditor(page, url)
      await board(page, [])
      const before = await ids(page)
      await pen(page)
      await clickWorld(page, 100, 100)
      await clickWorld(page, 200, 100)
      await clickWorld(page, 300, 250)
      await page.keyboard.press("Backspace")
      await settle(page)
      await page.keyboard.press("Enter")
      await settle(page)
      const add = await added(page, before)
      const p = await node(page, add[0] as string)
      log("path", JSON.stringify(p))
      expect(add.length === 1, "one path")
      expect(p?.w === 100 && p?.h === 0, `the third anchor was removed (w ${p?.w}, h ${p?.h})`)
    },
  },
  {
    name: "qa-m2: pen — a horizontal two-anchor line (h 0) commits a valid path",
    async run({ page, url, log }) {
      await openEditor(page, url)
      const warnings = collectWarnings(page)
      await board(page, [])
      const before = await ids(page)
      await pen(page)
      await clickWorld(page, 100, 100)
      await page.keyboard.down("Shift")
      await clickWorld(page, 220, 104)
      await page.keyboard.up("Shift")
      await page.keyboard.press("Enter")
      await settle(page)
      const add = await added(page, before)
      log("warnings", warnings.join(" | "))
      expect(
        add.length === 1,
        `one path node written (${add.length}); warnings: ${warnings.join(" | ")}`,
      )
      const p = await node(page, add[0] as string)
      expect(p?.h === 0 && p?.w === 120 && p?.y === 100, `line bounds ${JSON.stringify(p)}`)
    },
  },
  {
    name: "qa-m2: pen — two clicks on the same point do not write a degenerate path",
    async run({ page, url, log }) {
      await openEditor(page, url)
      const warnings = collectWarnings(page)
      await board(page, [])
      const before = await ids(page)
      await pen(page)
      await clickWorld(page, 150, 150)
      await page.waitForTimeout(400) // not a double-click
      await clickWorld(page, 150, 150)
      await page.keyboard.press("Enter")
      await settle(page)
      const add = await added(page, before)
      log("added", add.length, add[0] ? JSON.stringify(await node(page, add[0])) : "", warnings)
      expect(
        !warnings.some((w) => /rejected/i.test(w)),
        `no rejected edit (${warnings.join(" | ")})`,
      )
      if (add[0]) {
        const p = await node(page, add[0])
        expect(
          (p?.w as number) > 0 || (p?.h as number) > 0,
          `zero-size path written ${JSON.stringify(p)}`,
        )
      }
    },
  },
  {
    name: "qa-m2: pen — ⌘Z while drawing does not undo earlier document edits",
    async run({ page, url, log }) {
      await openEditor(page, url)
      await board(page, [
        { id: "keepRect0001", node: { type: "rect", name: "Keep", x: 400, y: 50, w: 50, h: 50 } },
      ])
      await pen(page)
      await clickWorld(page, 100, 100)
      await clickWorld(page, 200, 100)
      await page.keyboard.press("ControlOrMeta+z")
      await settle(page)
      const keep = await node(page, "keepRect0001")
      const s = await ui(page)
      log("after ⌘Z", JSON.stringify({ keep: !!keep, tool: s.tool }))
      expect(
        !!keep,
        "⌘Z mid-pen removed the previous edit (the board fixture) instead of an anchor",
      )
    },
  },
  {
    name: "qa-m2: pen — switching tool mid-path commits it as one undo step",
    async run({ page, url }) {
      await openEditor(page, url)
      await board(page, [])
      const before = await ids(page)
      const doc0 = await docJson(page)
      await pen(page)
      await clickWorld(page, 100, 100)
      await clickWorld(page, 200, 150)
      await page.keyboard.press("v")
      await settle(page)
      const add = await added(page, before)
      expect(add.length === 1, `V commits the path (${add.length})`)
      expect((await ui(page)).tool === "select", "Move tool")
      expect((await stepsBack(page, doc0)) === 1, "one undo step")
    },
  },
  {
    name: "qa-m2: pen — a path drawn inside a child frame is parented to it in local coords",
    async run({ page, url, log }) {
      await openEditor(page, url)
      await board(page, [
        {
          id: "innerFrame01",
          node: { type: "frame", name: "Inner", x: 100, y: 100, w: 300, h: 200, fill: "#EEEEEE" },
        },
      ])
      const before = await ids(page)
      await pen(page)
      await clickWorld(page, 150, 150)
      await clickWorld(page, 250, 180)
      await page.keyboard.press("Enter")
      await settle(page)
      const p = await node(page, (await added(page, before))[0] as string)
      log("child path", JSON.stringify(p))
      expect(p?.parent === "innerFrame01", `parent ${p?.parent}`)
      expect(p?.x === 50 && p?.y === 50 && p?.w === 100 && p?.h === 30, "local bounds 50,50 100×30")
    },
  },
  {
    name: "qa-m2: pen — panned + zoomed viewport maps anchors to the right world points",
    async run({ page, url, log }) {
      await openEditor(page, url)
      await board(page, [])
      await vp(page, { x: 37, y: -21, zoom: 2 })
      const before = await ids(page)
      await pen(page)
      await clickWorld(page, 110, 60)
      await clickWorld(page, 170, 90)
      await page.keyboard.press("Enter")
      await settle(page)
      const p = await node(page, (await added(page, before))[0] as string)
      log("zoomed path", JSON.stringify(p))
      expect(
        p?.x === 110 && p?.y === 60 && p?.w === 60 && p?.h === 30,
        `bounds ${JSON.stringify(p)}`,
      )
    },
  },
  // --- Path edit ----------------------------------------------------------------------------
  {
    name: "qa-m2: path edit — ⌘Z while editing, then dragging again starts from the restored path",
    async run({ page, url, log }) {
      await openEditor(page, url)
      await board(page, [TRI])
      await sel(page, ["pathNode0001"])
      await canvas(page).focus()
      await page.keyboard.press("Enter")
      await settle(page)
      const apex = await toPage(page, { x: 150, y: 100 })
      await dragSteps(page, apex, { x: apex.x, y: apex.y - 40 })
      expect((await node(page, "pathNode0001"))?.y === 60, "first drag applied")
      await page.keyboard.press("ControlOrMeta+z")
      await settle(page)
      expect((await node(page, "pathNode0001"))?.y === 100, "⌘Z restored")
      expect((await editingPath(page)) === "pathNode0001", "still editing after ⌘Z")
      await dragSteps(page, apex, { x: apex.x, y: apex.y - 20 })
      const n = await node(page, "pathNode0001")
      log("after second drag", JSON.stringify({ y: n?.y, h: n?.h, d: n?.d }))
      expect(
        n?.y === 80 && n?.h === 120,
        `second drag from the restored apex (y ${n?.y}, h ${n?.h})`,
      )
    },
  },
  {
    name: "qa-m2: path edit — Backspace deletes the selected anchor in one step",
    async run({ page, url, log }) {
      await openEditor(page, url)
      await board(page, [TRI])
      await sel(page, ["pathNode0001"])
      await canvas(page).focus()
      await page.keyboard.press("Enter")
      const doc0 = await docJson(page)
      await clickWorld(page, 150, 100)
      await page.keyboard.press("Backspace")
      await settle(page)
      const d = (await node(page, "pathNode0001"))?.d as string
      log("after delete", d)
      expect((d.match(/[MLC]/g) ?? []).length === 2, `two anchors left (${d})`)
      expect((await stepsBack(page, doc0)) === 1, "one undo step")
    },
  },
  {
    name: "qa-m2: path edit — deleting every anchor deletes the path; one undo restores it",
    async run({ page, url }) {
      await openEditor(page, url)
      await board(page, [TRI])
      await sel(page, ["pathNode0001"])
      await canvas(page).focus()
      await page.keyboard.press("Enter")
      const doc0 = await docJson(page)
      await clickWorld(page, 150, 100)
      await page.keyboard.down("Shift")
      await clickWorld(page, 100, 200)
      await clickWorld(page, 200, 200)
      await page.keyboard.up("Shift")
      await page.keyboard.press("Backspace")
      await settle(page)
      expect((await node(page, "pathNode0001")) === null, "path deleted")
      expect((await editingPath(page)) === null, "edit mode exited")
      expect((await stepsBack(page, doc0)) === 1, "one undo step restores it")
    },
  },
  {
    name: "qa-m2: path edit — Escape during an anchor drag reverts it with no undo entry",
    async run({ page, url }) {
      await openEditor(page, url)
      await board(page, [TRI])
      await sel(page, ["pathNode0001"])
      await canvas(page).focus()
      await page.keyboard.press("Enter")
      const doc0 = await docJson(page)
      const canUndo0 = await page.evaluate(() =>
        (window as unknown as { __kimo: M2Hook }).__kimo.session.store.canUndo("user"),
      )
      const apex = await toPage(page, { x: 150, y: 100 })
      await page.mouse.move(apex.x, apex.y)
      await page.mouse.down()
      for (let i = 1; i <= 6; i++) await page.mouse.move(apex.x + i * 5, apex.y - i * 5)
      await settle(page)
      await page.keyboard.press("Escape")
      await page.mouse.up()
      await settle(page)
      expect((await docJson(page)) === doc0, "drag reverted")
      const canUndo1 = await page.evaluate(() =>
        (window as unknown as { __kimo: M2Hook }).__kimo.session.store.canUndo("user"),
      )
      expect(canUndo1 === canUndo0, "no extra undo entry")
    },
  },
  {
    name: "qa-m2: path edit — double-click enters, clicking empty canvas exits",
    async run({ page, url }) {
      await openEditor(page, url)
      await board(page, [TRI])
      const c = await toPage(page, { x: 150, y: 170 })
      await page.mouse.dblclick(c.x, c.y)
      await settle(page)
      expect((await editingPath(page)) === "pathNode0001", "double-click enters path edit")
      await clickWorld(page, 500, 350)
      expect((await editingPath(page)) === null, "click outside exits")
    },
  },
  {
    name: "qa-m2: path edit — ⌘Z during an anchor drag is ignored",
    async run({ page, url }) {
      await openEditor(page, url)
      await board(page, [
        TRI,
        { id: "keepRect0001", node: { type: "rect", name: "Keep", x: 400, y: 50, w: 50, h: 50 } },
      ])
      await sel(page, ["pathNode0001"])
      await canvas(page).focus()
      await page.keyboard.press("Enter")
      const apex = await toPage(page, { x: 150, y: 100 })
      await page.mouse.move(apex.x, apex.y)
      await page.mouse.down()
      for (let i = 1; i <= 6; i++) await page.mouse.move(apex.x, apex.y - i * 5)
      await settle(page)
      await page.keyboard.press("ControlOrMeta+z")
      for (let i = 7; i <= 8; i++) await page.mouse.move(apex.x, apex.y - i * 5)
      await page.mouse.up()
      await settle(page)
      expect(!!(await node(page, "keepRect0001")), "earlier edit kept")
      expect((await node(page, "pathNode0001"))?.y === 60, "drag result kept")
    },
  },
  // --- Image placement ------------------------------------------------------------------------
  {
    name: "qa-m2: image — Esc cancels an armed placement; drag keeps the aspect ratio in a frame",
    async run({ page, url, log }) {
      await openEditor(page, url)
      await board(page, [
        {
          id: "innerFrame01",
          node: { type: "frame", name: "Inner", x: 100, y: 100, w: 300, h: 200, fill: "#EEEEEE" },
        },
      ])
      const arm = async () => {
        const chooser = page.waitForEvent("filechooser")
        await page.keyboard.press("ControlOrMeta+Shift+k")
        await (await chooser).setFiles({ name: "img.png", mimeType: "image/png", buffer: PNG_3x2 })
        await page.waitForFunction(
          () => !!(window as unknown as { __kimo: M2Hook }).__kimo.canvas()?.placement(),
        )
      }
      await canvas(page).focus()
      await arm()
      await page.keyboard.press("Escape")
      await settle(page)
      const pl = await page.evaluate(() =>
        (window as unknown as { __kimo: M2Hook }).__kimo.canvas()?.placement(),
      )
      expect(pl === null, "Esc disarms")
      const doc0 = await docJson(page)
      const before = await ids(page)
      await canvas(page).focus()
      await arm()
      const a = await toPage(page, { x: 150, y: 150 })
      const b = await toPage(page, { x: 240, y: 230 })
      await dragSteps(page, a, b)
      const add = await added(page, before)
      const n = await node(page, add[0] as string)
      log("placed", JSON.stringify(n))
      expect(n?.parent === "innerFrame01", `placed in the frame (parent ${n?.parent})`)
      expect(n?.x === 50 && n?.y === 50 && n?.w === 90 && n?.h === 60, "90×60 at local 50,50")
      expect((await stepsBack(page, doc0)) === 1, "one undo step")
    },
  },
  // --- Icons ----------------------------------------------------------------------------------
  {
    name: "qa-m2: I opens the icon picker; search + keyboard inserts one icon in one step",
    async run({ page, url, log }) {
      await openEditor(page, url)
      await board(page, [])
      const doc0 = await docJson(page)
      const n0 = await nodeCount(page)
      const p = await toPage(page, { x: 300, y: 200 })
      await page.mouse.move(p.x, p.y)
      await canvas(page).focus()
      await page.keyboard.press("i")
      const picker = page.locator(".kimo-icon-picker")
      await picker.waitFor({ timeout: 5000 })
      const box = await picker.boundingBox()
      log("picker at", JSON.stringify(box), "pointer", JSON.stringify(p))
      expect(box && Math.abs(box.x - (p.x + 8)) < 2, "opens 8px right of the pointer")
      const search = picker.getByRole("searchbox").or(picker.getByRole("textbox")).first()
      await search.fill("heart")
      await page.waitForTimeout(400)
      await search.press("ArrowDown")
      await page.keyboard.press("Enter")
      await settle(page)
      await page.waitForTimeout(100)
      expect((await nodeCount(page)) === n0 + 1, "one node inserted")
      const id = (await ui(page)).selection[0] as string
      const icon = await node(page, id)
      log("icon", JSON.stringify(icon))
      expect(icon?.type === "icon" && /heart/.test(String(icon?.icon)), "a heart icon")
      expect(
        icon?.parent === "board0000001",
        `inserted into the frame under the pointer (${icon?.parent})`,
      )
      expect((await picker.count()) === 0, "picker closes after the pick")
      expect((await stepsBack(page, doc0)) === 1, "one undo step")
    },
  },
  {
    name: "qa-m2: icon picker — Escape closes without inserting",
    async run({ page, url, log }) {
      await openEditor(page, url)
      await board(page, [])
      const n0 = await nodeCount(page)
      await canvas(page).focus()
      await page.keyboard.press("i")
      const picker = page.locator(".kimo-icon-picker")
      await picker.waitFor({ timeout: 5000 })
      await settle(page)
      const focus = await page.evaluate(() => ({
        inPicker: !!document.activeElement?.closest(".kimo-icon-picker"),
        el: `${document.activeElement?.tagName}.${document.activeElement?.className}`,
      }))
      log("focus after I", JSON.stringify(focus))
      expect(focus.inPicker, `focus moves into the picker (active: ${focus.el})`)
      await page.keyboard.press("Escape")
      await settle(page)
      expect((await picker.count()) === 0, "closed")
      expect((await nodeCount(page)) === n0, "nothing inserted")
    },
  },
]
