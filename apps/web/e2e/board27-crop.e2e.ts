/**
 * Board 27 §6 (d) "Image crop mode · canvas handles + panel" (VCSml, stage ud74f, rules R6uRRw)
 * in the real editor: Crop as the 4th mode of the image fill popover enters crop mode; the
 * Image section mirrors the crop in source px; dragging an edge, ⇧-corner and pan inside edit
 * it; Enter commits one undo step `fill = { …, fit: "crop", crop }`; double-click re-enters, Esc
 * reverts, Reset = the whole image. One measured getComputedStyle / getBoundingClientRect pass of
 * the Image section (g9PSe) and the Hint against the node values, plus canvas pixels for the dim
 * and the box.
 */
import type { Page } from "playwright"
import {
  armFileChooser,
  blur,
  type Hook,
  nextFileChooser,
  node,
  openEditor,
  pixel,
  settle,
  toPage,
  world,
} from "./qa-helpers"
import { type E2EContext, expect, type Scenario } from "./run"

type W = {
  __kimo: Hook & {
    session: Hook["session"] & {
      apply(ops: unknown[], label?: string): boolean
      store: Hook["session"]["store"] & { undo(o: string): unknown }
    }
  }
}

const section = (page: Page, title: string) =>
  page.locator(".design-tab .kimo-prop-section", {
    has: page.locator(".kimo-prop-section__title", { hasText: new RegExp(`^${title}$`) }),
  })

/** A 300 × 200 PNG: red TL, green TR, blue BL, yellow BR. */
async function quadrantPng(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const c = document.createElement("canvas")
    c.width = 300
    c.height = 200
    const g = c.getContext("2d") as CanvasRenderingContext2D
    const cols = ["#FF3333", "#33B34D", "#3366FF", "#FFCC1A"]
    cols.forEach((col, i) => {
      g.fillStyle = col
      g.fillRect((i % 2) * 150, Math.floor(i / 2) * 100, 150, 100)
    })
    return c.toDataURL("image/png").split(",")[1] as string
  })
  return Buffer.from(b64, "base64")
}

type Fill = { kind?: string; src?: string; fit?: string; crop?: number[] }
const imageFill = async (page: Page) => {
  const f = (await node(page, "photo27000"))?.fill
  return (Array.isArray(f) ? f : [f]).find((p) => (p as Fill)?.kind === "image") as Fill | undefined
}
const fieldValue = (page: Page, name: string) =>
  page.getByRole("textbox", { name, exact: true }).inputValue()

type Diff = { what: string; design: string | number; got: string | number }
function check(diffs: Diff[], what: string, design: string | number, got: string | number) {
  const ok =
    typeof design === "number" && typeof got === "number"
      ? Math.abs(design - got) < 0.6
      : String(design) === String(got)
  if (!ok) diffs.push({ what, design, got })
}

/** Resolves a token to the computed color string the browser uses. */
const token = (page: Page, name: string, prop: "color" | "backgroundColor" = "color") =>
  page.evaluate(
    ({ n, prop }) => {
      const el = document.createElement("span")
      el.style[prop] = `var(${n})`
      document.body.append(el)
      const c = getComputedStyle(el)[prop]
      el.remove()
      return c
    },
    { n: name, prop },
  )

/** One measured pass of the Image section (g9PSe) and the crop hint (u0dQ1). */
async function measurePanel(page: Page, ctx: E2EContext) {
  const m = await page.evaluate(() => {
    const sec = document.querySelector<HTMLElement>(".image-crop") as HTMLElement
    const box = (e: Element | null) => {
      if (!e) return null
      const r = e.getBoundingClientRect()
      const cs = getComputedStyle(e)
      return {
        w: r.width,
        h: r.height,
        x: r.x,
        y: r.y,
        pad: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(parseFloat),
        gap: parseFloat(cs.rowGap) || parseFloat(cs.columnGap) || 0,
        fs: parseFloat(cs.fontSize),
        fw: cs.fontWeight,
        lh: parseFloat(cs.lineHeight),
        color: cs.color,
        bg: cs.backgroundColor,
        justify: cs.justifyContent,
        dir: cs.flexDirection,
        shadow: cs.boxShadow,
      }
    }
    const rows = sec.querySelectorAll(".image-crop__row")
    return {
      sec: box(sec),
      title: box(sec.querySelector(".kimo-prop-section__title")),
      mode: box(rows[0]?.firstElementChild ?? null),
      xy: box(rows[1] ?? null),
      x: box(rows[1]?.firstElementChild ?? null),
      wh: box(rows[2] ?? null),
      hint: box(sec.querySelector(".image-crop__hint")),
      hintText: sec.querySelector(".image-crop__hint")?.textContent ?? "",
      actions: box(sec.querySelector(".image-crop__actions")),
      reset: box(sec.querySelector(".image-crop__reset")),
      resetLabel: sec.querySelector(".image-crop__reset")?.textContent ?? "",
      apply: box(sec.querySelector(".image-crop__apply")),
      pill: box(document.querySelector(".canvas-hint--toolbar:not(.canvas-hint--hidden)")),
      pillText:
        document.querySelector(".canvas-hint--toolbar:not(.canvas-hint--hidden)")?.textContent ??
        "",
      pillIcon:
        document
          .querySelector(".canvas-hint--toolbar:not(.canvas-hint--hidden) svg")
          ?.getAttribute("class") ?? "",
    }
  })
  type B = NonNullable<typeof m.sec>
  const d: Diff[] = []
  const s = m.sec as B
  check(d, "section padding", "12 12 16 12", s.pad.join(" "))
  check(d, "section gap", 8, s.gap)
  check(d, "section width (panel 280)", 280, s.w)
  const t = m.title as B
  check(d, "title size (text-sm)", 12, t.fs)
  check(d, "title weight (normal)", "400", t.fw)
  check(d, "title color", await token(page, "--kimo-text-primary"), t.color)
  check(d, "mode select h", 28, (m.mode as B).h)
  check(d, "mode select w (fill 256)", 256, (m.mode as B).w)
  check(d, "xy gap", 8, (m.xy as B).gap)
  check(d, "X field h", 28, (m.x as B).h)
  check(d, "X field w ((256-8)/2)", 124, (m.x as B).w)
  check(d, "X field bg", await token(page, "--kimo-bg-subtle", "backgroundColor"), (m.x as B).bg)
  check(d, "wh gap", 8, (m.wh as B).gap)
  const h = m.hint as B
  check(d, "hint size (text-xs)", 11, h.fs)
  check(d, "hint line-height 1.45", 11 * 1.45, h.lh)
  check(d, "hint color", await token(page, "--kimo-text-tertiary"), h.color)
  check(d, "hint text", "Crop in source pixels · image 300 × 200", m.hintText)
  const a = m.actions as B
  check(d, "actions gap", 6, a.gap)
  check(d, "actions justify", "flex-end", a.justify)
  const r = m.reset as B
  check(d, "reset h", 28, r.h)
  check(d, "reset padding", "0 10 0 10", r.pad.join(" "))
  check(d, "reset size", 12, r.fs)
  check(d, "reset weight", "500", r.fw)
  check(d, "reset color", await token(page, "--kimo-text-secondary"), r.color)
  check(d, "reset label (no icon)", "Reset", m.resetLabel)
  const p = m.apply as B
  check(d, "apply h", 28, p.h)
  check(d, "apply padding", "0 12 0 12", p.pad.join(" "))
  check(d, "apply size", 12, p.fs)
  check(d, "apply bg", await token(page, "--kimo-accent", "backgroundColor"), p.bg)
  check(d, "apply right edge = actions right", a.x + a.w, p.x + p.w)
  check(d, "apply → reset gap", 6, p.x - (r.x + r.w))
  check(d, "hint pill text", "Drag edges to crop · drag inside to pan · Enter to apply", m.pillText)
  check(d, "hint pill icon", "true", String(m.pillIcon.includes("crop")))
  ctx.log("measured board27 §6 (d) Image section g9PSe:", JSON.stringify(m))
  ctx.log("diffs:", d.length ? JSON.stringify(d) : "none")
  expect(d.length === 0, `Image section diffs ${JSON.stringify(d)}`)
}

export const scenarios: Scenario[] = [
  {
    name: "board27 §6 (d): image crop mode — popover Crop, handles, pan, panel, Enter / Esc / Reset",
    async run(ctx) {
      const { page, url } = ctx
      armFileChooser(page)
      await page.setViewportSize({ width: 1440, height: 900 })
      await openEditor(page, url)
      await page.evaluate(() => {
        const s = (window as unknown as W).__kimo.session
        s.apply([
          {
            op: "insert",
            id: "photo27000",
            parent: null,
            node: { type: "rect", name: "Photo", x: 100, y: 100, w: 300, h: 200 },
          },
        ])
        s.ui.getState().select(["photo27000"])
        s.ui.getState().setViewport({ x: 0, y: 0, zoom: 1 })
      })
      await settle(page)
      // Add the image fill through the panel (content-addressed asset).
      const png = await quadrantPng(page)
      const chooser = nextFileChooser(page)
      await section(page, "Fill").getByRole("button", { name: "Add fill" }).click()
      await page.getByRole("menuitem", { name: "Image…" }).click()
      await (await chooser).setFiles({ name: "quad.png", mimeType: "image/png", buffer: png })
      await page.waitForFunction(() => {
        const n = (window as unknown as W).__kimo.session.store.getNode("photo27000")
        return JSON.stringify(n?.fill ?? "").includes('"image"')
      })
      await settle(page)

      // Popover → Mode → Crop (4th mode) enters crop mode; nothing written yet.
      const row0 = section(page, "Fill").locator(".kimo-fill-row").first()
      await row0.locator(".kimo-color-field").click()
      const pop = page.locator(".kimo-image-fill")
      await pop.waitFor()
      await pop.getByRole("combobox", { name: "Image mode" }).click()
      // The open listbox only (the topbar's page switcher also renders options).
      const opts = await page
        .getByRole("listbox")
        .filter({ hasText: "Crop" })
        .getByRole("option")
        .allTextContents()
      expect(
        JSON.stringify(opts) === '["Cover","Contain","Stretch","Crop"]',
        `modes ${JSON.stringify(opts)}`,
      )
      const before = JSON.stringify(await imageFill(page))
      await page.getByRole("option", { name: "Crop" }).click()
      await page.locator(".image-crop").waitFor({ timeout: 10_000 })
      await settle(page)
      expect(JSON.stringify(await imageFill(page)) === before, "entering writes nothing")
      // Cover of a same-ratio box = the whole image.
      expect((await fieldValue(page, "Crop W")) === "300", "W 300")
      expect((await fieldValue(page, "Crop H")) === "200", "H 200")
      await measurePanel(page, ctx)
      if (ctx.shots) await page.screenshot({ path: `${ctx.shots}/board27-crop-enter.png` })

      // Canvas: 1 screen px = 1 image px. Drag the east edge 60 px left → W 240.
      const b = (await world(page, "photo27000")) as { x: number; y: number; w: number; h: number }
      const east = await toPage(page, { x: b.x + b.w, y: b.y + b.h / 2 })
      await page.mouse.move(east.x, east.y)
      await page.mouse.down()
      for (let i = 1; i <= 6; i++) await page.mouse.move(east.x - i * 10, east.y)
      await page.mouse.up()
      await settle(page)
      expect((await fieldValue(page, "Crop W")) === "240", `W ${await fieldValue(page, "Crop W")}`)
      // Pixels (viewport identity: canvas px = world px): the cut-off strip is dimmed
      // (#14141499 over green), the box keeps the source; white box edge at x 339 (inside 1 px).
      const strip = await pixel(page, { x: b.x + 280, y: b.y + 30 })
      const inside = await pixel(page, { x: b.x + 200, y: b.y + 30 })
      ctx.log("dim strip", strip, "inside", inside)
      expect((strip[1] ?? 0) < 100 && (inside[1] ?? 0) > 150, "dim outside, source inside")
      const edge = await pixel(page, { x: b.x + 239, y: b.y + 60 })
      expect(
        edge.slice(0, 3).every((c) => c > 240),
        `box edge ${edge}`,
      )

      // ⇧ corner drag keeps the ratio (240:200 = 1.2).
      const se = await toPage(page, { x: b.x + 240, y: b.y + b.h })
      await page.keyboard.down("Shift")
      await page.mouse.move(se.x, se.y)
      await page.mouse.down()
      for (let i = 1; i <= 6; i++) await page.mouse.move(se.x - i * 8, se.y - i * 2)
      await page.mouse.up()
      await page.keyboard.up("Shift")
      await settle(page)
      const w1 = Number(await fieldValue(page, "Crop W"))
      const h1 = Number(await fieldValue(page, "Crop H"))
      expect(Math.abs(w1 / h1 - 1.2) < 0.02, `ratio ${w1}/${h1}`)

      // Panel X/Y/W/H in source px.
      const setCrop = async (name: string, value: string) => {
        const f = page.getByRole("textbox", { name, exact: true })
        await f.click()
        await f.fill(value)
        await f.press("Enter")
        await blur(page)
        await settle(page)
      }
      await setCrop("Crop W", "150")
      await setCrop("Crop H", "100")
      await setCrop("Crop X", "150")
      await setCrop("Crop Y", "0")
      // Pan inside: drag the image 30 px right → crop X 120.
      // The box sits over image px 150…300 × 0…100 (o = 0 at entry): screen x 250…400.
      const mid = await toPage(page, { x: b.x + 225, y: b.y + 50 })
      await page.mouse.move(mid.x, mid.y)
      await page.mouse.down()
      for (let i = 1; i <= 6; i++) await page.mouse.move(mid.x + i * 5, mid.y)
      await page.mouse.up()
      await settle(page)
      expect((await fieldValue(page, "Crop X")) === "120", `X ${await fieldValue(page, "Crop X")}`)

      // Enter commits one undo step; the layer keeps its size.
      await page.locator(".canvas-host").focus()
      await page.keyboard.press("Enter")
      await page.locator(".image-crop").waitFor({ state: "detached" })
      const crop = await imageFill(page)
      ctx.log("committed", JSON.stringify(crop))
      expect(crop?.fit === "crop", `fit ${crop?.fit}`)
      expect(
        JSON.stringify(crop?.crop) === "[0.5,0,0,0.5,0.4,0]",
        `crop ${JSON.stringify(crop?.crop)}`,
      )
      const n = (await node(page, "photo27000")) as { w: number; h: number }
      expect(n.w === 300 && n.h === 200, "layer size unchanged")
      expect(
        (
          (await section(page, "Fill").locator(".kimo-fill-row").first().textContent()) ?? ""
        ).includes("Image · Crop"),
        "row label Image · Crop",
      )
      // The committed paint draws image px 120…270 × 0…100 stretched ×2: red at the left
      // (image x < 150), green at the right.
      const left = await pixel(page, { x: b.x + 20, y: b.y + 20 })
      const right = await pixel(page, { x: b.x + 280, y: b.y + 20 })
      expect((left[0] ?? 0) > 200 && (left[1] ?? 0) < 100, `red at the left ${left}`)
      expect((right[1] ?? 0) > 150 && (right[0] ?? 0) < 100, `green at the right ${right}`)
      await page.keyboard.press("ControlOrMeta+z")
      await settle(page)
      expect((await imageFill(page))?.crop === undefined, "one undo step restores the paint")
      await page.keyboard.press("ControlOrMeta+Shift+z")
      await settle(page)

      // Double-click re-enters at the stored crop; Esc reverts (nothing written).
      const c = await toPage(page, { x: b.x + b.w / 2, y: b.y + b.h / 2 })
      await page.mouse.dblclick(c.x, c.y)
      await page.locator(".image-crop").waitFor()
      expect((await fieldValue(page, "Crop X")) === "120", "re-enters at the stored crop")
      const stored = JSON.stringify(await imageFill(page))
      await setCrop("Crop W", "40")
      await page.locator(".canvas-host").focus()
      await page.keyboard.press("Escape")
      await page.locator(".image-crop").waitFor({ state: "detached" })
      expect(JSON.stringify(await imageFill(page)) === stored, "Esc reverts")
      const sel = await page.evaluate(
        () => (window as unknown as W).__kimo.session.ui.getState().selection,
      )
      expect(JSON.stringify(sel) === '["photo27000"]', "Esc keeps the selection")

      // Reset = the whole image, Apply commits [1, 0, 0, 1, 0, 0].
      await page.mouse.dblclick(c.x, c.y)
      await page.locator(".image-crop").waitFor()
      await page.locator(".image-crop__reset").click()
      expect((await fieldValue(page, "Crop W")) === "300", "Reset = whole image")
      await page.locator(".image-crop__apply").click()
      await page.locator(".image-crop").waitFor({ state: "detached" })
      expect(
        JSON.stringify((await imageFill(page))?.crop) === "[1,0,0,1,0,0]",
        `reset crop ${JSON.stringify((await imageFill(page))?.crop)}`,
      )
      // Another mode in the popover drops the crop.
      await section(page, "Fill")
        .locator(".kimo-fill-row")
        .first()
        .locator(".kimo-color-field")
        .click()
      await page.locator(".kimo-image-fill").getByRole("combobox", { name: "Image mode" }).click()
      await page.getByRole("option", { name: "Cover" }).click()
      await settle(page)
      const cover = await imageFill(page)
      expect(
        cover?.fit === undefined && cover?.crop === undefined,
        `cover ${JSON.stringify(cover)}`,
      )
    },
  },
]
