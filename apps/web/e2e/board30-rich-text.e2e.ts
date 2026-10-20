/**
 * Board 30 "Rich text" in the real editor.
 *
 * 1. No reflow: for each growth mode (auto width, auto height = fixed width, fixed size) and at
 *    zooms 0.5 / 1 / 2, the edit overlay's box (getBoundingClientRect) matches the drawn text box
 *    projected to the screen, and its line count matches the laid-out line count — before,
 *    during and after editing (the box doesn't change by entering / leaving edit mode).
 * 2. Ranges: selecting part of a text and pressing ⌘B / ⌘I / ⌘U or editing the Text section
 *    (size) styles that range only; the panel shows the range's values and "Mixed"; paste is plain
 *    text; ⌘Z inside the editor undoes the last step; Escape commits one document step with spans
 *    and the `text/runs` feature.
 */
import type { Page } from "playwright"
import {
  type Box,
  field,
  type Hook,
  node,
  openEditor,
  select,
  settle,
  setViewport,
  toPage,
  ui,
  undo,
  world,
} from "./qa-helpers"
import { type E2EContext, expect, type Scenario } from "./run"

type W = { __kimo: Hook & { session: { apply(ops: unknown[], label?: string): boolean } } }

const BOARD = "board30Rt01"

async function fixture(page: Page) {
  await page.evaluate((board) => {
    const s = (window as unknown as W).__kimo.session
    s.apply(
      [
        {
          op: "insert",
          id: board,
          parent: null,
          node: { type: "frame", name: "Board", x: 0, y: 0, w: 900, h: 700, fill: "#FFFFFF" },
        },
        {
          op: "insert",
          id: "rtAuto0001",
          parent: board,
          node: {
            type: "text",
            name: "Auto",
            x: 40,
            y: 40,
            content: "Auto width line\nsecond line",
            style: { font: "Inter", size: 20 },
          },
        },
        {
          op: "insert",
          id: "rtWide0001",
          parent: board,
          node: {
            type: "text",
            name: "Wraps",
            x: 40,
            y: 160,
            w: 220,
            grow: "fixed-width",
            content:
              "A paragraph that wraps inside its fixed width box and keeps wrapping while it is edited.",
            style: {
              font: "Inter",
              size: 16,
              lineHeight: 1.5,
              letterSpacing: 0.2,
              align: "center",
            },
          },
        },
        {
          op: "insert",
          id: "rtFixd0001",
          parent: board,
          node: {
            type: "text",
            name: "Fixed",
            x: 360,
            y: 160,
            w: 200,
            h: 180,
            grow: "fixed",
            content: "Fixed size box, middle aligned text that wraps.",
            style: { font: "Inter", size: 15, lineHeight: { px: 22 }, valign: "middle" },
          },
        },
        {
          op: "insert",
          id: "rtRich0001",
          parent: board,
          node: {
            type: "text",
            name: "Rich",
            x: 40,
            y: 420,
            w: 360,
            grow: "fixed-width",
            content: "Hello brave new world",
            style: { font: "Inter", size: 18 },
            fill: "#111111",
          },
        },
      ],
      "fixture",
    )
  }, BOARD)
  await settle(page)
}

const layoutText = (page: Page, id: string) =>
  page.evaluate((i) => {
    const l = (window as unknown as W).__kimo.canvas()?.layout()?.nodes.get(i) as
      | { world: Box; text?: { lines?: number } }
      | undefined
    return l ? { world: l.world, lines: l.text?.lines ?? null } : null
  }, id)

/** The edit overlay's box and its number of laid-out lines (distinct line tops). */
const editorBox = (page: Page) =>
  page.evaluate(() => {
    const wrap = document.querySelector(".canvas-host__text-edit") as HTMLElement | null
    const ed = document.querySelector(".canvas-host__text-editor") as HTMLElement | null
    if (!wrap || !ed) return null
    const r = wrap.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(ed)
    const tops = new Set<number>()
    for (const rect of range.getClientRects()) if (rect.height > 0) tops.add(Math.round(rect.top))
    // Line boxes: merge tops closer than 2px (spans on one line share a top within rounding).
    const sorted = [...tops].sort((a, b) => a - b)
    const lines = sorted.filter((t, i) => i === 0 || t - (sorted[i - 1] as number) > 2).length
    const cs = getComputedStyle(ed)
    return {
      x: r.x,
      y: r.y,
      w: r.width,
      h: r.height,
      lines,
      whiteSpace: cs.whiteSpace,
      fontSize: cs.fontSize,
      lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing,
      textAlign: cs.textAlign,
    }
  })

async function enterEdit(page: Page, id: string) {
  await select(page, [id])
  await settle(page)
  const b = await world(page, id)
  if (!b) throw new Error(`no layout for ${id}`)
  const p = await toPage(page, { x: b.x + 8, y: b.y + b.h / 2 })
  await page.mouse.dblclick(p.x, p.y)
  await page.locator(".canvas-host__text-editor").waitFor()
  await settle(page)
}

async function noReflow({ page, url, log }: E2EContext) {
  await openEditor(page, url)
  await fixture(page)
  const diffs: string[] = []
  const cases = [
    { id: "rtAuto0001", mode: "auto" },
    { id: "rtWide0001", mode: "fixed-width" },
    { id: "rtFixd0001", mode: "fixed" },
  ] as const
  for (const zoom of [1, 2, 0.5]) {
    await setViewport(page, { x: -20, y: -20, zoom })
    await settle(page)
    for (const c of cases) {
      const before = await layoutText(page, c.id)
      if (!before) throw new Error(`no layout ${c.id}`)
      const tl = await toPage(page, { x: before.world.x, y: before.world.y })
      await enterEdit(page, c.id)
      const e = await editorBox(page)
      if (!e) throw new Error("no editor")
      const z = (await ui(page)).viewport.zoom
      const want = { x: tl.x, y: tl.y, w: before.world.w * z, h: before.world.h * z }
      const tag = `${c.mode} @${zoom}`
      const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol
      // Position: the overlay starts on the drawn text (1px).
      if (!near(e.x, want.x, 1) || !near(e.y, want.y, 1))
        diffs.push(
          `${tag}: origin ${e.x.toFixed(1)},${e.y.toFixed(1)} ≠ ${want.x.toFixed(1)},${want.y.toFixed(1)}`,
        )
      // Width: wrapping modes keep the node width exactly; auto width hugs the same line widths
      // (DOM vs CanvasKit glyph advances: 2% tolerance).
      const wTol = c.mode === "auto" ? Math.max(2, want.w * 0.02) : 1
      if (!near(e.w, want.w, wTol))
        diffs.push(`${tag}: width ${e.w.toFixed(1)} ≠ ${want.w.toFixed(1)}`)
      // Height: fixed = the box; others = the same lines (one line height of slack for metrics).
      const hTol =
        c.mode === "fixed" ? 1 : Math.max(2, (want.h / Math.max(1, before.lines ?? 1)) * 0.25)
      if (!near(e.h, want.h, hTol))
        diffs.push(`${tag}: height ${e.h.toFixed(1)} ≠ ${want.h.toFixed(1)}`)
      if (before.lines !== null && e.lines !== before.lines)
        diffs.push(`${tag}: ${e.lines} lines while editing ≠ ${before.lines} drawn`)
      if (c.mode !== "auto" && e.whiteSpace !== "pre-wrap")
        diffs.push(`${tag}: white-space ${e.whiteSpace} (must wrap)`)
      if (c.mode === "auto" && e.whiteSpace !== "pre")
        diffs.push(`${tag}: white-space ${e.whiteSpace}`)
      log(
        `${tag}: editor ${e.w.toFixed(1)}×${e.h.toFixed(1)} (${e.lines} lines) vs drawn ${want.w.toFixed(1)}×${want.h.toFixed(1)} (${before.lines} lines); font ${e.fontSize} / ${e.lineHeight}, ls ${e.letterSpacing}, align ${e.textAlign}`,
      )
      await page.keyboard.press("Escape")
      await settle(page)
      const after = await layoutText(page, c.id)
      if (JSON.stringify(after) !== JSON.stringify(before))
        diffs.push(
          `${tag}: box changed by editing ${JSON.stringify(before)} → ${JSON.stringify(after)}`,
        )
    }
  }
  log(diffs.length ? `measured diffs:\n  ${diffs.join("\n  ")}` : "measured pass: 0 diffs")
  expect(diffs.length === 0, `edit overlay reflows:\n${diffs.join("\n")}`)
}

/** Selects characters [a, b) of the editor by offsets (through the DOM selection). */
async function selectRange(page: Page, a: number, b: number) {
  await page.evaluate(
    ([from, to]) => {
      const ed = document.querySelector(".canvas-host__text-editor") as HTMLElement
      const texts: Text[] = []
      const walk = (n: Node) => {
        if (n instanceof Text) texts.push(n)
        else for (const c of n.childNodes) walk(c)
      }
      walk(ed)
      const at = (o: number): [Node, number] => {
        let pos = 0
        for (const t of texts) {
          if (o <= pos + t.data.length) return [t, o - pos]
          pos += t.data.length
        }
        const last = texts[texts.length - 1] as Text
        return [last, last.data.length]
      }
      const [an, ao] = at(from as number)
      const [fn, fo] = at(to as number)
      document.getSelection()?.setBaseAndExtent(an, ao, fn, fo)
    },
    [a, b],
  )
  await settle(page)
}

const spans = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".canvas-host__text-editor span[data-i]")].map(
      (s) => ({
        text: s.textContent,
        weight: getComputedStyle(s).fontWeight,
        italic: getComputedStyle(s).fontStyle,
        deco: getComputedStyle(s).textDecorationLine,
        size: getComputedStyle(s).fontSize,
      }),
    ),
  )

async function ranges({ page, url, log }: E2EContext) {
  await openEditor(page, url)
  await fixture(page)
  await setViewport(page, { x: -20, y: -20, zoom: 1 })
  await settle(page)
  const id = "rtRich0001"
  await enterEdit(page, id)
  // "brave" = [6, 11): ⌘B, ⌘I.
  await selectRange(page, 6, 11)
  await page.keyboard.press("ControlOrMeta+b")
  await page.keyboard.press("ControlOrMeta+i")
  await settle(page)
  let sp = await spans(page)
  log(`after ⌘B ⌘I: ${JSON.stringify(sp)}`)
  const brave = sp.find((s) => s.text === "brave")
  expect(
    brave?.weight === "700" && brave.italic === "italic",
    `brave bold italic ${JSON.stringify(sp)}`,
  )
  expect(sp.find((s) => s.text === "Hello ")?.weight === "400", "rest stays regular")
  // ⌘Z inside the editor undoes the last step (italic) only. The edit is live (ADR 0016 item
  // 17): the document already holds it.
  await page.keyboard.press("ControlOrMeta+z")
  await settle(page)
  sp = await spans(page)
  expect(
    sp.find((s) => s.text === "brave")?.italic === "normal" &&
      sp.find((s) => s.text === "brave")?.weight === "700",
    `⌘Z undid italic only ${JSON.stringify(sp)}`,
  )
  const live = (await node(page, id))?.content
  expect(
    JSON.stringify(live) ===
      JSON.stringify([
        { text: "Hello " },
        { text: "brave", style: { weight: 700 } },
        { text: " new world" },
      ]),
    `the document holds the live edit (bold, not italic): ${JSON.stringify(live)}`,
  )
  // "new" = [12, 15): ⌘U.
  await selectRange(page, 12, 15)
  await page.keyboard.press("ControlOrMeta+u")
  await settle(page)
  // The panel shows the range's values: select "ave ne" (bold + regular) → weight Mixed.
  await selectRange(page, 8, 14)
  const weight = page.getByRole("button", { name: "Font weight" })
  const wText = (await weight.textContent())?.trim() ?? ""
  expect(wText.includes("Mixed"), `weight shows Mixed for a mixed range, got "${wText}"`)
  // Size on "world" = [16, 21) from the panel: the editor keeps the selection (highlight).
  await selectRange(page, 16, 21)
  const size = field(page, "Font size")
  await size.click()
  await size.fill("28")
  await size.press("Enter")
  await settle(page)
  expect(
    await page.locator(".canvas-host__text-editor").isVisible(),
    "still editing after the panel edit",
  )
  sp = await spans(page)
  expect(sp.find((s) => s.text === "world")?.size === "28px", `world 28px ${JSON.stringify(sp)}`)
  expect(sp.find((s) => s.text === "Hello ")?.size === "18px", "Hello stays 18px")
  // Paste is plain text at the caret (rich HTML dropped).
  await page.locator(".canvas-host__text-editor").focus()
  await selectRange(page, 21, 21)
  await page.evaluate(() => {
    const dt = new DataTransfer()
    dt.setData("text/plain", "!\r\n")
    dt.setData("text/html", "<b style='color:red'>!</b>")
    document
      .querySelector(".canvas-host__text-editor")
      ?.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
      )
  })
  await settle(page)
  await page.keyboard.press("Escape")
  await settle(page)
  const n = await node(page, id)
  log(`committed: ${JSON.stringify(n?.content)}`)
  const content = n?.content as { text: string; style?: Record<string, unknown> }[]
  expect(Array.isArray(content), "content is spans")
  expect(content.map((s) => s.text).join("") === "Hello brave new world!\n", "text + plain paste")
  expect(
    JSON.stringify(content.find((s) => s.text === "brave")?.style) === '{"weight":700}',
    "brave: weight only",
  )
  expect(
    JSON.stringify(content.find((s) => s.text === "new")?.style) === '{"decoration":["underline"]}',
    "new: underline",
  )
  expect(
    content.some((s) => s.text.startsWith("world") && s.style?.size === 28),
    "world: size 28",
  )
  const features = await page.evaluate(
    () =>
      ((window as unknown as W).__kimo.session.store.toDocument() as { features?: string[] })
        .features,
  )
  expect(
    features?.includes("text/runs") === true,
    `text/runs declared (${JSON.stringify(features)})`,
  )
  // One document undo step restores the plain text.
  await undo(page)
  await settle(page)
  expect((await node(page, id))?.content === "Hello brave new world", "one undo step")
  // Not editing: a text with runs shows Mixed for the differing field.
  await page.keyboard.press("ControlOrMeta+Shift+z")
  await select(page, [id])
  await settle(page)
  const sizeVal = await field(page, "Font size").inputValue()
  expect(sizeVal === "Mixed", `whole text with runs: size Mixed, got "${sizeVal}"`)
}

/**
 * Measured pass against desing.pen board 30 (VwZcn): overlay outline (1.5 $selection), range
 * highlight ($selection-soft, focused and while the panel has focus), and panel (b) "Range
 * across runs": Family / Weight / Size / Line height / Letter spacing / Fill all "Mixed".
 */
async function measured({ page, url, log }: E2EContext) {
  await openEditor(page, url)
  await fixture(page)
  await page.evaluate(() => {
    const s = (window as unknown as W).__kimo.session
    s.apply(
      [
        { op: "setHeader", set: { features: ["text/runs"] } },
        {
          op: "update",
          id: "rtRich0001",
          set: {
            content: [
              { text: "Plan less. " },
              {
                text: "Ship more",
                style: {
                  font: "Fraunces",
                  weight: 600,
                  size: 22,
                  lineHeight: 1.2,
                  letterSpacing: -0.4,
                },
              },
              { text: " together,", fill: "#8A8A8A" },
            ],
          },
        },
      ],
      "runs",
    )
  })
  await setViewport(page, { x: 20, y: 400, zoom: 2 })
  await settle(page)
  const diffs: string[] = []
  const check = (what: string, want: unknown, got: unknown) => {
    const ok = JSON.stringify(want) === JSON.stringify(got)
    log(`${ok ? "✓" : "✗"} ${what}: want ${JSON.stringify(want)} got ${JSON.stringify(got)}`)
    if (!ok) diffs.push(`${what}: want ${JSON.stringify(want)} got ${JSON.stringify(got)}`)
  }
  await enterEdit(page, "rtRich0001")
  await selectRange(page, 6, 25)
  const o = await page.evaluate(() => {
    const wrap = document.querySelector(".canvas-host__text-edit") as HTMLElement
    const ed = document.querySelector(".canvas-host__text-editor") as HTMLElement
    const cw = getComputedStyle(wrap)
    const span = ed.querySelector("span") as HTMLElement
    const zoom = wrap.getBoundingClientRect().width / wrap.offsetWidth
    return {
      // "0 0 0 <spread> color": the spread scaled by the zoom is the screen width.
      outline:
        Math.round(Number.parseFloat(cw.boxShadow.split(" ").slice(-1)[0] ?? "0") * zoom * 100) /
        100,
      outlineColor: cw.boxShadow.slice(0, cw.boxShadow.indexOf(")") + 1),
      selection: getComputedStyle(span, "::selection").backgroundColor,
      highlight: getComputedStyle(ed, "::highlight(kimo-text-selection)").backgroundColor,
    }
  })
  check("outline width (screen px)", 1.5, o.outline)
  check("outline color $selection", "rgb(47, 107, 255)", o.outlineColor)
  check("range highlight $selection-soft", "rgba(47, 107, 255, 0.1)", o.selection)
  check("unfocused highlight $selection-soft", "rgba(47, 107, 255, 0.1)", o.highlight)
  // Panel (b): every field Mixed for a range across the three runs.
  const values = {
    family: (await page.getByRole("button", { name: "Font family" }).textContent())?.trim(),
    weight: (await page.getByRole("button", { name: "Font weight" }).textContent())?.trim(),
    size: await field(page, "Font size").inputValue(),
    lineHeight: await field(page, "Line height").inputValue(),
    letterSpacing: await field(page, "Letter spacing").inputValue(),
    fill: (await page.locator(".kimo-fill-row", { hasText: "Mixed" }).count()) > 0,
  }
  check(
    "panel (b) Mixed",
    {
      family: "Mixed",
      weight: "Mixed",
      size: "Mixed",
      lineHeight: "Mixed",
      letterSpacing: "Mixed",
      fill: true,
    },
    values,
  )
  // Focus in the panel keeps editing and shows the CSS highlight.
  await field(page, "Font size").click()
  await settle(page)
  const kept = await page.evaluate(() => ({
    editing: !!document.querySelector(".canvas-host__text-editor"),
    highlight: (CSS as unknown as { highlights: Map<string, unknown> }).highlights.has(
      "kimo-text-selection",
    ),
  }))
  check("panel focus keeps editing + highlight", { editing: true, highlight: true }, kept)
  // Panel (a): a caret inside the Fraunces run shows its values.
  await page.locator(".canvas-host__text-editor").focus()
  await selectRange(page, 13, 13)
  check(
    "panel (a) caret values",
    { family: "Fraunces", size: "22", lineHeight: "120%" },
    {
      family: (await page.getByRole("button", { name: "Font family" }).textContent())?.trim(),
      size: await field(page, "Font size").inputValue(),
      lineHeight: await field(page, "Line height").inputValue(),
    },
  )
  await page.keyboard.press("Escape")
  log(diffs.length ? `measured diffs:\n  ${diffs.join("\n  ")}` : "measured pass: 0 diffs")
  expect(diffs.length === 0, `board 30 measured pass:\n${diffs.join("\n")}`)
}

export const scenarios: Scenario[] = [
  { name: "board30 rich text: measured pass vs desing.pen board 30", run: measured },
  { name: "board30 rich text: edit overlay keeps the text box (modes × zooms)", run: noReflow },
  { name: "board30 rich text: range styles, panel Mixed, paste, undo, commit", run: ranges },
]
