/**
 * Adversarial QA (M1): undo/redo sequences mixing panel and canvas edits, field scrubs,
 * layer rename / visibility / lock from the tree, "Mixed" multi-selection edits, .kimo
 * save → open → save byte stability through the real ⌘S / ⌘O flows, IndexedDB autosave on
 * reload, and dark mode.
 */
import type { Page } from "playwright"
import {
  armFileChooser,
  blur,
  box,
  centerOf,
  docJson,
  drawShape,
  field,
  type Hook,
  idOf,
  nextFileChooser,
  node,
  openEditor,
  pixel,
  redo,
  row,
  select,
  setField,
  settle,
  setViewport,
  toCanvas,
  toPage,
  ui,
  undo,
  waitCanvas,
} from "./qa-helpers"
import { expect, newE2EContext, type Scenario } from "./run"

async function openLeft(page: Page, url: string) {
  await openEditor(page, url)
  await setViewport(page, { x: -2000, y: -50, zoom: 1 })
  await settle(page)
}

const canRedo = (page: Page) =>
  page.evaluate(() => (window as unknown as { __kimo: Hook }).__kimo.session.store.canRedo("user"))

/** Forces the download / <input type=file> paths of saveKimoFile / pickKimoFile. */
async function noPickers(page: Page) {
  armFileChooser(page)
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>
    delete w.showSaveFilePicker
    delete w.showOpenFilePicker
  })
}

async function saveViaShortcut(page: Page): Promise<{ name: string; text: string }> {
  await blur(page)
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 10_000 }),
    page.keyboard.press("ControlOrMeta+s"),
  ])
  const stream = await dl.createReadStream()
  const chunks: Buffer[] = []
  for await (const c of stream) chunks.push(c as Buffer)
  return { name: dl.suggestedFilename(), text: Buffer.concat(chunks).toString("utf8") }
}

const prefix = (page: Page, label: string) =>
  page
    .locator(".kimo-prop-field, .kimo-size-field", { has: field(page, label) })
    .locator(".kimo-prop-field__prefix, .kimo-size-field__prefix")

export const scenarios: Scenario[] = [
  {
    name: "qa: undo/redo sequence across canvas, panel, rename and visibility edits",
    async run(ctx) {
      const { page, url } = ctx
      await openLeft(page, url)
      const r = await drawShape(page, "r", { x: -1800, y: 100 }, { x: -1700, y: 200 }) // 1
      await setField(page, "Width", "150") // 2
      await setField(page, "X", "-1700") // 3
      await page.locator(".canvas-host").focus()
      await page.keyboard.press("ArrowDown") // 4
      const lr = row(page, "Rectangle 1")
      await lr.dblclick()
      const input = page.getByRole("textbox", { name: "Layer name" })
      await input.fill("Box")
      await input.press("Enter") // 5
      await blur(page)
      const br = row(page, "Box")
      await br.hover()
      await br.getByRole("button", { name: "Hide layer" }).click() // 6
      await blur(page)
      const states: Record<string, unknown>[] = [
        { name: "Rectangle 1", x: -1800, y: 100, w: 100, visible: undefined },
        { name: "Rectangle 1", x: -1800, y: 100, w: 150, visible: undefined },
        { name: "Rectangle 1", x: -1700, y: 100, w: 150, visible: undefined },
        { name: "Rectangle 1", x: -1700, y: 101, w: 150, visible: undefined },
        { name: "Box", x: -1700, y: 101, w: 150, visible: undefined },
        { name: "Box", x: -1700, y: 101, w: 150, visible: false },
      ]
      const pick = async () => {
        const n = await node(page, r)
        return { name: n?.name, x: n?.x, y: n?.y, w: n?.w, visible: n?.visible }
      }
      const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
      expect(same(await pick(), states[5]), `final ${JSON.stringify(await pick())}`)
      for (let i = 4; i >= 0; i--) {
        await undo(page)
        const got = await pick()
        expect(same(got, states[i]), `undo → step ${i + 1}: ${JSON.stringify(got)}`)
      }
      for (let i = 1; i <= 5; i++) {
        await redo(page)
        const got = await pick()
        expect(same(got, states[i]), `redo → step ${i + 1}: ${JSON.stringify(got)}`)
      }
      // ⌘Y redo alias; a new edit after undo drops the redo stack.
      await undo(page)
      await undo(page)
      await page.keyboard.press("ControlOrMeta+y")
      expect(same(await pick(), states[4]), "⌘Y redoes")
      await page.locator(".canvas-host").focus()
      await page.keyboard.press("ArrowRight")
      expect(!(await canRedo(page)), "new edit clears redo")
      // Panel fields reflect undo.
      await undo(page)
      await select(page, [r])
      await settle(page)
      expect((await field(page, "X").inputValue()) === "-1700", "X field follows undo")
    },
  },
  {
    name: "qa: W field scrub is one undo step and keeps the previous edit when passing start",
    async run(ctx) {
      const { page, url } = ctx
      await openLeft(page, url)
      const r = await drawShape(page, "r", { x: -1800, y: 100 }, { x: -1700, y: 200 })
      await setField(page, "Height", "120")
      const pfx = prefix(page, "Width")
      const b = await pfx.boundingBox()
      if (!b) throw new Error("no W prefix")
      const s = { x: b.x + b.width / 2, y: b.y + b.height / 2 }
      await page.mouse.move(s.x, s.y)
      await page.mouse.down()
      await page.mouse.move(s.x + 15, s.y, { steps: 5 })
      await page.mouse.move(s.x + 30, s.y, { steps: 5 })
      await page.mouse.up()
      await settle(page)
      expect((await node(page, r))?.w === 130, `scrub +30 → w ${(await node(page, r))?.w}`)
      await undo(page)
      let n = await node(page, r)
      expect(n?.w === 100 && n.h === 120, `one undo for the scrub → ${n?.w}×${n?.h}`)
      // Scrub out and back to the start value, then a bit further.
      await page.mouse.move(s.x, s.y)
      await page.mouse.down()
      await page.mouse.move(s.x + 20, s.y, { steps: 4 })
      await page.mouse.move(s.x, s.y, { steps: 4 })
      await page.mouse.move(s.x + 10, s.y, { steps: 4 })
      await page.mouse.up()
      await settle(page)
      n = await node(page, r)
      expect(n?.w === 110, `scrub back-and-forth → w ${n?.w}`)
      expect(n?.h === 120, `previous H edit survived the scrub (h ${n?.h})`)
    },
  },
  {
    name: "qa: layer rename — Enter commits, Escape cancels, empty ignored, undo",
    async run(ctx) {
      const { page, url } = ctx
      await openLeft(page, url)
      const r = await drawShape(page, "r", { x: -1800, y: 100 }, { x: -1700, y: 200 })
      const input = page.getByRole("textbox", { name: "Layer name" })
      await row(page, "Rectangle 1").dblclick()
      await input.fill("Nope")
      await input.press("Escape")
      await settle(page)
      expect((await node(page, r))?.name === "Rectangle 1", "Escape cancels rename")
      await row(page, "Rectangle 1").dblclick()
      await input.fill("   ")
      await input.press("Enter")
      await settle(page)
      const nm = (await node(page, r))?.name
      expect(nm === "Rectangle 1", `blank rename ignored (${JSON.stringify(nm)})`)
      await row(page, "Rectangle 1").dblclick()
      await input.fill("Card")
      await input.press("Enter")
      await row(page, "Card").waitFor()
      // Selection header follows the rename.
      await select(page, [r])
      await page.getByTestId("selection-name").filter({ hasText: "Card" }).waitFor()
      await blur(page)
      await undo(page)
      expect((await node(page, r))?.name === "Rectangle 1", "undo rename")
    },
  },
  {
    name: "qa: hidden layer is not painted, not hit-tested, restorable",
    async run(ctx) {
      const { page, url } = ctx
      await openLeft(page, url)
      const r = await drawShape(page, "r", { x: -1800, y: 100 }, { x: -1700, y: 200 })
      await select(page, [])
      await settle(page)
      const cc = await toCanvas(page, { x: -1750, y: 150 })
      const shown = await pixel(page, cc)
      ctx.log("visible pixel", shown.join(","))
      expect(shown[0] === 0xd9 && shown[1] === 0xd9 && shown[2] === 0xd9, `grey fill ${shown}`)
      const lr = row(page, "Rectangle 1")
      await lr.hover()
      await lr.getByRole("button", { name: "Hide layer" }).click()
      await select(page, [])
      await settle(page)
      await settle(page)
      const hidden = await pixel(page, cc)
      ctx.log("hidden pixel", hidden.join(","))
      expect(!(hidden[0] === 0xd9 && hidden[1] === 0xd9), `hidden not painted ${hidden}`)
      const p = await centerOf(page, r)
      await page.mouse.click(p.x, p.y)
      await settle(page)
      expect(!(await ui(page)).selection.includes(r), "hidden layer not selectable on canvas")
      // Show again via the row.
      await lr.hover()
      await lr.getByRole("button", { name: "Show layer" }).click()
      await select(page, [])
      await settle(page)
      await settle(page)
      const back = await pixel(page, cc)
      expect(back[0] === 0xd9, `shown again ${back}`)
    },
  },
  {
    name: "qa: lock toggled from the layer row persists and shows the lock affordance",
    async run(ctx) {
      const { page, url } = ctx
      await openLeft(page, url)
      const r = await drawShape(page, "r", { x: -1800, y: 100 }, { x: -1700, y: 200 })
      const lr = row(page, "Rectangle 1")
      await lr.hover()
      await lr.getByRole("button", { name: "Lock layer" }).click()
      expect((await node(page, r))?.locked === true, "locked")
      // Lock affordance stays visible when not hovered.
      await page.mouse.move(5, 500)
      const btn = lr.getByRole("button", { name: "Unlock layer" })
      expect(await btn.isVisible(), "unlock affordance visible")
      expect((await btn.getAttribute("aria-pressed")) === "true", "aria-pressed")
      // Clicking the locked node on canvas: still selectable from the tree, panel disabled? at
      // least the panel must not allow moving it via X.
      await select(page, [r])
      await settle(page)
      const xField = field(page, "X")
      const disabled = await xField.isDisabled()
      ctx.log("X field disabled for locked:", disabled)
      await page.waitForTimeout(500)
      await page.reload()
      await waitCanvas(page)
      expect((await node(page, r))?.locked === true, "lock persisted across reload")
    },
  },
  {
    name: "qa: Mixed multi-selection — display, set all, one undo, arrow keys, blur no-op",
    async run(ctx) {
      const { page, url } = ctx
      await openLeft(page, url)
      const a = await drawShape(page, "r", { x: -1900, y: 100 }, { x: -1800, y: 180 })
      const b = await drawShape(page, "r", { x: -1700, y: 100 }, { x: -1500, y: 180 })
      await select(page, [a, b])
      await page.getByTestId("selection-name").filter({ hasText: "layers" }).waitFor()
      const w = field(page, "Width")
      expect((await w.inputValue()) === "Mixed", `W ${await w.inputValue()}`)
      expect((await field(page, "X").inputValue()) === "Mixed", "X Mixed")
      expect((await field(page, "Height").inputValue()) === "80", "H shared 80")
      expect((await field(page, "Y").inputValue()) === "100", "Y shared 100")
      // Focus + blur on a Mixed field changes nothing.
      const before = await docJson(page)
      await w.click()
      await blur(page)
      await settle(page)
      expect((await docJson(page)) === before, "focus/blur on Mixed is a no-op")
      // Typing a number sets both; one undo restores both.
      await setField(page, "Width", "60")
      expect((await node(page, a))?.w === 60 && (await node(page, b))?.w === 60, "W → 60 on both")
      expect((await w.inputValue()) === "60", "field now shows 60")
      await undo(page)
      expect(
        (await node(page, a))?.w === 100 && (await node(page, b))?.w === 200,
        "one undo restores both widths",
      )
      // Keyword on mixed: H = hug on rects is invalid → ignored, no error, values unchanged.
      // Set Y on both.
      await setField(page, "Y", "300")
      expect((await node(page, a))?.y === 300 && (await node(page, b))?.y === 300, "Y → 300")
      await undo(page)
      // Corner radius on both, then on one → Mixed.
      await select(page, [a, b])
      await setField(page, "Corner radius", "8")
      expect((await node(page, a))?.radius === 8 && (await node(page, b))?.radius === 8, "R 8")
      await select(page, [b])
      await setField(page, "Corner radius", "4")
      await select(page, [a, b])
      await settle(page)
      expect((await field(page, "Corner radius").inputValue()) === "Mixed", "R Mixed")
      // ArrowUp on a Mixed W should step each width, not overwrite all with one value.
      await w.click()
      await page.keyboard.press("ArrowUp")
      await blur(page)
      const wa = (await node(page, a))?.w
      const wb = (await node(page, b))?.w
      expect(wa === 101 && wb === 201, `ArrowUp on Mixed W → ${wa}, ${wb} (want 101, 201)`)
    },
  },
  {
    name: "qa: Mixed W scrub keeps per-node widths relative",
    async run(ctx) {
      const { page, url } = ctx
      await openLeft(page, url)
      const a = await drawShape(page, "r", { x: -1900, y: 100 }, { x: -1800, y: 180 })
      const b = await drawShape(page, "r", { x: -1700, y: 100 }, { x: -1500, y: 180 })
      await select(page, [a, b])
      await settle(page)
      const pb = await prefix(page, "Width").boundingBox()
      if (!pb) throw new Error("no prefix")
      const s = { x: pb.x + pb.width / 2, y: pb.y + pb.height / 2 }
      await page.mouse.move(s.x, s.y)
      await page.mouse.down()
      await page.mouse.move(s.x + 5, s.y, { steps: 5 })
      await page.mouse.up()
      const wa = (await node(page, a))?.w
      const wb = (await node(page, b))?.w
      expect(wa === 105 && wb === 205, `scrub +5 on Mixed → ${wa}, ${wb} (want 105, 205)`)
    },
  },
  {
    name: "qa: ⌘S → ⌘O → ⌘S round trip is byte-stable",
    async run(ctx) {
      const { page, url } = ctx
      await noPickers(page)
      await openLeft(page, url)
      // A few edits of every kind.
      const r = await drawShape(page, "r", { x: -1800, y: 100 }, { x: -1700, y: 200 })
      await setField(page, "Corner radius", "6")
      await page.locator(".canvas-host").focus()
      await page.keyboard.press("t")
      const tp = await toPage(page, { x: -1800, y: 300 })
      await page.mouse.click(tp.x, tp.y)
      await page.getByRole("textbox", { name: "Edit text" }).waitFor()
      await page.keyboard.type("Round “trip” — ✓ émoji 🎉")
      await page.keyboard.press("Escape")
      await row(page, "Navbar").hover()
      await row(page, "Navbar").getByRole("button", { name: "Hide layer" }).click()
      await settle(page)
      void r
      const first = await saveViaShortcut(page)
      ctx.log("saved", first.name, `${first.text.length} chars`)
      expect(first.name === "Untitled.kimo", `file name ${first.name}`)
      expect(first.text.includes("🎉"), "unicode kept")
      // Saving twice without edits produces identical bytes.
      const again = await saveViaShortcut(page)
      expect(again.text === first.text, "two saves identical")
      // ⌘O the saved file.
      const fileUrl = page.url()
      const pending = nextFileChooser(page)
      await page.keyboard.press("ControlOrMeta+o")
      const chooser = await pending
      await chooser.setFiles({
        name: first.name,
        mimeType: "application/json",
        buffer: Buffer.from(first.text, "utf8"),
      })
      await page.waitForURL((u) => u.toString() !== fileUrl && /#\/file\//.test(u.toString()))
      await waitCanvas(page)
      const second = await saveViaShortcut(page)
      if (second.text !== first.text) {
        const i = [...second.text].findIndex((ch, k) => ch !== first.text[k])
        ctx.log("first diff at", i, JSON.stringify(first.text.slice(i - 60, i + 60)))
        ctx.log("          vs", JSON.stringify(second.text.slice(i - 60, i + 60)))
      }
      expect(second.text === first.text, "re-saved bytes equal the opened file")
      expect(second.name === first.name, `same file name (${second.name})`)
    },
  },
  {
    name: "qa: reload restores the IndexedDB autosave exactly",
    async run(ctx) {
      const { page, url } = ctx
      await openLeft(page, url)
      const r = await drawShape(page, "o", { x: -1800, y: 100 }, { x: -1700, y: 200 })
      await setField(page, "Width", "140")
      const navbar = (await idOf(page, "Navbar")) as string
      await select(page, [navbar])
      await page.locator(".canvas-host").focus()
      await page.keyboard.press("Delete")
      await row(page, "Hero").hover()
      await row(page, "Hero").getByRole("button", { name: "Hide layer" }).click()
      await select(page, [r])
      await page.locator(".canvas-host").focus()
      await page.keyboard.press("Shift+ArrowRight")
      const before = await docJson(page)
      await page.waitForTimeout(600)
      await page.reload()
      await waitCanvas(page)
      const after = await docJson(page)
      if (after !== before) {
        const A = JSON.parse(before) as Record<string, unknown>
        const B = JSON.parse(after) as Record<string, unknown>
        for (const k of new Set([...Object.keys(A), ...Object.keys(B)]))
          if (k !== "nodes" && JSON.stringify(A[k]) !== JSON.stringify(B[k]))
            ctx.log("header diff", k, JSON.stringify(A[k]), "→", JSON.stringify(B[k]))
        const a = A.nodes as Record<string, unknown>
        const b = B.nodes as Record<string, unknown>
        for (const k of new Set([...Object.keys(a), ...Object.keys(b)]))
          if (JSON.stringify(a[k]) !== JSON.stringify(b[k]))
            ctx.log("diff", k, JSON.stringify(a[k]), "→", JSON.stringify(b[k]))
      }
      expect(after === before, "document identical after reload")
      expect((await node(page, navbar)) === null, "deleted node stays deleted")
      // History is not restored, so ⌘Z after reload is a no-op (not a crash).
      await undo(page)
      expect((await docJson(page)) === after, "undo after reload is a no-op")
    },
  },
  {
    name: "qa: reload immediately after an edit keeps the edit",
    async run(ctx) {
      const { page, url } = ctx
      await openLeft(page, url)
      const r = await drawShape(page, "r", { x: -1800, y: 100 }, { x: -1700, y: 200 })
      await page.waitForTimeout(600)
      await page.locator(".canvas-host").focus()
      await page.keyboard.press("Shift+ArrowDown")
      const y = (await node(page, r))?.y
      // No wait: the reload races the autosave write.
      await page.reload()
      await waitCanvas(page)
      const y2 = (await node(page, r))?.y
      expect(y2 === y, `edit made just before reload persisted (y ${y2}, want ${y})`)
    },
  },
  {
    name: "qa: dark mode — persists across reload, repaints canvas, follows system default",
    async run(ctx) {
      const { page, url } = ctx
      await openEditor(page, url)
      const empty = { x: 30, y: 780 }
      const lightBg = await pixel(page, empty)
      const lightChrome = await page
        .locator(".left-panel")
        .evaluate((el) => getComputedStyle(el).backgroundColor)
      await page.getByRole("button", { name: "Toggle theme" }).click()
      await settle(page)
      await settle(page)
      const darkBg = await pixel(page, empty)
      const darkChrome = await page
        .locator(".left-panel")
        .evaluate((el) => getComputedStyle(el).backgroundColor)
      ctx.log("canvas bg light", lightBg.join(","), "dark", darkBg.join(","))
      ctx.log("panel bg light", lightChrome, "dark", darkChrome)
      expect(lightChrome !== darkChrome, "panel chrome switches")
      expect((darkBg[0] ?? 255) < (lightBg[0] ?? 0), "canvas background darkens")
      // Selection overlay keeps the selection blue in dark mode.
      const desk = (await idOf(page, "Home — Desktop")) as string
      await select(page, [desk])
      await settle(page)
      await settle(page)
      const b = (await page.evaluate(
        (i) =>
          (window as unknown as { __kimo: Hook }).__kimo.canvas()?.layout()?.nodes.get(i)?.world,
        desk,
      )) as { x: number; y: number; w: number }
      const outline = await pixel(page, await toCanvas(page, { x: b.x + b.w / 2, y: b.y }))
      expect((outline[2] ?? 0) > 200 && (outline[0] ?? 255) < 120, `dark outline ${outline}`)
      await page.reload()
      await waitCanvas(page)
      expect(
        (await page.evaluate(() => document.documentElement.dataset.theme)) === "dark",
        "dark persisted",
      )
      // Fresh profile with a dark system preference starts dark.
      const darkBrowser = page.context().browser()
      const ctx2 = darkBrowser ? await newE2EContext(darkBrowser, { colorScheme: "dark" }) : null
      if (ctx2) {
        const p2 = await ctx2.newPage()
        await p2.goto(url)
        const t = await p2.evaluate(() => document.documentElement.dataset.theme)
        await ctx2.close()
        expect(t === "dark", `system dark → ${t}`)
      }
      void box
    },
  },
]
