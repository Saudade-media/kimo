/**
 * Measured pass of the @kimo/ui Gallery against desing.pen "02 Components".
 *
 *   bun run scripts/measure-gallery.ts [--json out.json] [--screenshot out.png] [--theme dark]
 *
 * Bundles scripts/gallery-entry.tsx with Bun into a temp dir, loads it in headless Chromium
 * (the `playwright` package installed for apps/web) with the bundled Inter / JetBrains Mono
 * faces from packages/renderer/assets/fonts, then compares every mapped node's box
 * (getBoundingClientRect, relative to its component root) and computed style
 * (getComputedStyle: fill/color, font size/weight, radius) with the values in
 * test/fixtures/pen-components.json, and the M2 board "02b Components — Styling (M2)" against
 * test/fixtures/pen-components-m2.json (map in measure-map-m2.ts; opacity checked too).
 * Exits 1 when any check drifts beyond tolerance.
 */
import { copyFile, mkdtemp, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { FLEX_WIDTH_M2, MAP_M2 } from "./measure-map-m2"

const pkg = join(import.meta.dir, "..")
const repo = join(pkg, "..", "..")
const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

type PenRow = [
  string,
  string,
  string,
  number,
  number,
  number,
  number,
  string | null,
  number | null,
  string | null,
  number | null,
  (number | null)?,
]

/** pen root id → DOM selector of the root (default `[data-pen=id]`) and of each descendant. */
const MAP: Record<string, { root?: string; nodes: Record<string, string> }> = {}
const button = (id: string, icon: string, label: string) => {
  MAP[id] = { nodes: { [icon]: ".kimo-button__icon", [label]: ".kimo-button__label" } }
}
button("W2lra", "r5v5W", "bzZjb")
button("kv3Fk", "hfife", "D5Dhjk")
button("sqJv4", "zAVGx", "e5j2wK")
button("vyI3D", "NDClH", "VpBIt")
MAP.ZMxjt = { nodes: { nd1MZ: ".kimo-icon-button__icon" } }
MAP.l44gB = { nodes: { N5sZTj: ".kimo-icon-button__icon" } }
MAP.N0cHp = { nodes: { N1b0T: ".kimo-tool-button__icon" } }
MAP.l6HCd = { nodes: { WQXS9: ".kimo-tool-button__icon" } }
MAP.Zs05d = { nodes: { mU4b8: ".kimo-input__icon", BwYzP: ".kimo-input__field" } }
MAP.A9DDs = { nodes: { jXquz: ".kimo-prop-field__prefix", vpMpD: ".kimo-prop-field__value" } }
MAP.GOaBx = {
  nodes: {
    cBpdy: ".kimo-color-field__swatch",
    mEuTa: ".kimo-color-field__value",
    T0lqqG: ".kimo-color-field__spacer",
    nHpYT: ".kimo-color-field__opacity",
  },
}
MAP.gP276 = {
  root: ".kimo-select__trigger",
  nodes: { LWF8n: ".kimo-select__value", VLDHF: ".kimo-select__chevron" },
}
MAP.hx0Wg = {
  nodes: {
    FC69Q: ":scope > :nth-child(1)",
    zzmWn: ":scope > :nth-child(1) .kimo-segmented__icon",
    au7em: ":scope > :nth-child(2)",
    w5nk2: ":scope > :nth-child(2) .kimo-segmented__icon",
    MPP8X: ":scope > :nth-child(3)",
    S87m3: ":scope > :nth-child(3) .kimo-segmented__icon",
  },
}
MAP.y893S = { nodes: { SM9sk: ".kimo-toggle__knob" } }
MAP.CSYQj = { nodes: { JaEms: ".kimo-toggle__knob" } }
MAP.jrIWa = { nodes: { C5gcz: ".kimo-badge__label" } }
MAP.Eo5JW = { nodes: { tbBcG: ".kimo-kbd__keys" } }
MAP.FVhW0 = { nodes: { b90ktr: ".kimo-avatar__initials" } }
const row = (r: string) => `[data-pen="${r}"]`
MAP.ga43X = {
  nodes: {
    LWjoa: row("LWjoa"),
    b2gRfh: ".kimo-panel-header__title",
    TidcK: ".kimo-panel-header .kimo-icon-button",
    nd1MZ: ".kimo-panel-header .kimo-icon-button__icon",
    GXnBT: row("GXnBT"),
    ujm25: `${row("GXnBT")} .kimo-layer-row__disclosure`,
    wGB3Q: `${row("GXnBT")} .kimo-layer-row__icon`,
    UrqCz: `${row("GXnBT")} .kimo-layer-row__name`,
    TZNCu: `${row("GXnBT")} .kimo-layer-row__spacer`,
    UHDvX: `${row("GXnBT")} .kimo-layer-row__visibility`,
    dArBD: row("dArBD"),
    B1hXK: `${row("dArBD")} .kimo-layer-row__disclosure`,
    Nhzdo: `${row("dArBD")} .kimo-layer-row__icon`,
    VsAPn: `${row("dArBD")} .kimo-layer-row__name`,
    i67C1: `${row("dArBD")} .kimo-layer-row__spacer`,
    FO8c8: `${row("dArBD")} .kimo-layer-row__visibility`,
  },
}
MAP.GfneW = { nodes: { vznhI: ".kimo-tab__label" } }
MAP.P3e7Mp = { nodes: { nREvy: ".kimo-tab__label" } }
MAP.fWrGA = {
  nodes: {
    WQLZ0: ".kimo-prop-section__header",
    UB7fP: ".kimo-prop-section__title",
    c3QSj: ".kimo-prop-section__action",
    y5Lz1A: ".kimo-prop-row",
    Q8GqQ: ".kimo-prop-row > :nth-child(1)",
    "Q8GqQ/jXquz": ".kimo-prop-row > :nth-child(1) .kimo-prop-field__prefix",
    "Q8GqQ/vpMpD": ".kimo-prop-row > :nth-child(1) .kimo-prop-field__value",
    OIMmF: ".kimo-prop-row > :nth-child(2)",
    "OIMmF/jXquz": ".kimo-prop-row > :nth-child(2) .kimo-prop-field__prefix",
    "OIMmF/vpMpD": ".kimo-prop-row > :nth-child(2) .kimo-prop-field__value",
  },
}
MAP.xbtkW = {
  nodes: {
    R0bUSU: ".kimo-tooltip__label",
    kcXxn: ".kimo-tooltip__key",
    je9gE: ".kimo-tooltip__keys",
  },
}
const item = (n: number, rid: string) => ({
  [rid]: `:scope > :nth-child(${n})`,
  [`${rid}/FGr88`]: `:scope > :nth-child(${n}) .kimo-menu-item__icon`,
  [`${rid}/W1zCOY`]: `:scope > :nth-child(${n}) .kimo-menu-item__label`,
  [`${rid}/c0Q54m`]: `:scope > :nth-child(${n}) .kimo-menu-item__spacer`,
  [`${rid}/C4eW4c`]: `:scope > :nth-child(${n}) .kimo-menu-item__shortcut`,
})
MAP.MPsxN = { nodes: { ...item(1, "JMW2O"), ...item(2, "ExHXe"), ...item(3, "MRZFM") } }
MAP.Vtkpe = {
  nodes: {
    ROG0x: row("ROG0x"),
    s9lNfk: `${row("ROG0x")} .kimo-message__bubble`,
    U0ugt: `${row("ROG0x")} .kimo-message__text`,
    QqwyN: row("QqwyN"),
    CJO7L: `${row("QqwyN")} .kimo-message__mark`,
    xk3D6: `${row("QqwyN")} .kimo-message__mark-icon`,
    Q285wt: `${row("QqwyN")} .kimo-message__bubble`,
    U8u5Kz: `${row("QqwyN")} .kimo-message__text`,
    lNM1U: row("lNM1U"),
    U7skge: `${row("lNM1U")} .kimo-agent-step__status`,
    Q2pb2: `${row("lNM1U")} .kimo-agent-step__label`,
    jOrxb: row("jOrxb"),
    FGgcT: `${row("jOrxb")} .kimo-agent-step__status`,
    qQWQd: `${row("jOrxb")} .kimo-agent-step__label`,
  },
}
MAP.JvIbi = {
  nodes: {
    t9cQaK: ".kimo-composer__input",
    i8k4tr: ".kimo-composer__bar",
    GBIhd: ".kimo-composer__chip",
    mXR7R: ".kimo-composer__chip-icon",
    boibm: ".kimo-composer__chip-label",
    jGuSy: ".kimo-composer__model",
    ACpa9: ".kimo-composer__model-label",
    fEqJU: ".kimo-composer__model-icon",
    GkhOw: ".kimo-composer__spacer",
    N2pdpC: ".kimo-composer__send",
    P1Fjqx: ".kimo-composer__send-icon",
  },
}
MAP.byua1 = {
  nodes: {
    cnqrK: ".kimo-file-card__thumbnail",
    fBMds: ".kimo-file-card__mini-frame",
    GjweV: ".kimo-file-card__line--a",
    XCwxC: ".kimo-file-card__line--b",
    LVgU0: ".kimo-file-card__line--c",
    auR7e: ".kimo-file-card__meta",
    PJMqM: ".kimo-file-card__name",
    upTZI: ".kimo-file-card__info",
  },
}
MAP.XB33E = {
  nodes: { d82EN: ".kimo-toast__icon", B5hQu: ".kimo-toast__label", FTVGD: ".kimo-toast__action" },
}
MAP.lUDi2 = {
  nodes: {
    uJ3fp: ".kimo-empty-state__icon-wrap",
    PTnSp: ".kimo-empty-state__icon",
    DlzmW: ".kimo-empty-state__title",
    sGDcC: ".kimo-empty-state__desc",
  },
}

MAP.PufcL = {
  nodes: {
    L5Q4E: row("L5Q4E"),
    uvBjr: ".kimo-gallery__eyebrow",
    VB7Vm: ".kimo-gallery__title",
    jbns1: ".kimo-gallery__intro",
    zKqmo: row("zKqmo"),
    cgZpc: `${row("zKqmo")} .kimo-gallery__section-header`,
    JK30T: `${row("zKqmo")} .kimo-gallery__section-title`,
    dRT85: row("dRT85"),
    khbGv: row("khbGv"),
    Koj3v: row("Koj3v"),
    IWkR9: row("IWkR9"),
    Qv3iW: row("Qv3iW"),
  },
}

/** Nodes whose DOM element is a flexible field, so its width is not the text's hug width. */
const FLEX_WIDTH = new Set(["BwYzP", "vpMpD", "Q8GqQ/vpMpD", "OIMmF/vpMpD", "t9cQaK"])
/** The gallery board grows past the design: it appends a "States & interactions" section. */
const EXTENDED_HEIGHT = new Set(["PufcL"])
Object.assign(MAP, MAP_M2)
for (const id of FLEX_WIDTH_M2) FLEX_WIDTH.add(id)

// --- Build the page --------------------------------------------------------------------------

const out = await mkdtemp(join(tmpdir(), "kimo-gallery-"))
const build = await Bun.build({
  entrypoints: [join(pkg, "scripts", "gallery-entry.tsx")],
  outdir: out,
  target: "browser",
  naming: "[name].[ext]",
})
if (!build.success) {
  for (const log of build.logs) console.error(log)
  process.exit(1)
}
const fontsDir = join(repo, "packages", "renderer", "assets", "fonts")
const faces: [string, string, number, string][] = [
  ["Inter", "Inter-Regular.ttf", 400, "normal"],
  ["Inter", "Inter-Medium.ttf", 500, "normal"],
  ["Inter", "Inter-SemiBold.ttf", 600, "normal"],
  ["Inter", "Inter-Bold.ttf", 700, "normal"],
  ["JetBrains Mono", "JetBrainsMono-Regular.ttf", 400, "normal"],
  ["JetBrains Mono", "JetBrainsMono-Medium.ttf", 500, "normal"],
]
let fontCss = ""
for (const [family, file, weight, style] of faces) {
  try {
    await copyFile(join(fontsDir, file), join(out, file))
    fontCss += `@font-face{font-family:"${family}";src:url("./${file}");font-weight:${weight};font-style:${style}}\n`
  } catch {
    console.warn(`font missing: ${file} (falling back to system fonts)`)
  }
}
const css = (await readdir(out)).filter((f) => f.endsWith(".css"))
await writeFile(
  join(out, "index.html"),
  `<!doctype html><html><head><meta charset="utf-8"><style>${fontCss}html,body{margin:0}</style>${css
    .map((f) => `<link rel="stylesheet" href="./${f}">`)
    .join(
      "",
    )}</head><body><div id="root"></div><script type="module" src="./gallery-entry.js"></script></body></html>`,
)

// --- Measure ---------------------------------------------------------------------------------

const fixture = (await Bun.file(join(pkg, "test", "fixtures", "pen-components.json")).json()) as {
  nodes: Record<string, PenRow[]>
}
const fixtureM2 = (await Bun.file(
  join(pkg, "test", "fixtures", "pen-components-m2.json"),
).json()) as {
  nodes: Record<string, PenRow[]>
}
Object.assign(fixture.nodes, fixtureM2.nodes)
const { chromium } = (await import(Bun.resolveSync("playwright", join(repo, "apps", "web")))) as {
  chromium: import("playwright").BrowserType
}
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const errors: string[] = []
page.on("pageerror", (e) => errors.push(String(e)))
page.on("console", (m) => m.type() === "error" && errors.push(m.text()))
const server = Bun.serve({
  port: 0,
  fetch: (req) => {
    const path = new URL(req.url).pathname
    return new Response(Bun.file(join(out, path === "/" ? "index.html" : path.slice(1))))
  },
})
const theme = flag("--theme") ?? "light"
await page.goto(`http://localhost:${server.port}/?theme=${theme}`)
await page.waitForSelector('[data-pen="PufcL"]')
await page.evaluate(() => document.fonts.ready)

type Measured = {
  found: boolean
  x: number
  y: number
  w: number
  h: number
  bg: string
  color: string
  fontSize: string
  fontWeight: string
  radius: string
  display: string
  font: string
  opacity: string
  bgImage: string
}
const measured = (await page.evaluate(
  ({ map }) => {
    const result: Record<string, Record<string, Measured | null>> = {}
    for (const [rootId, spec] of Object.entries(map)) {
      const host = document.querySelector<HTMLElement>(`[data-pen="${rootId}"]`)
      const root = host && spec.root ? host.querySelector<HTMLElement>(spec.root) : host
      const r0 = root?.getBoundingClientRect()
      const one = (el: Element | null | undefined): Measured | null => {
        if (!el || !r0) return null
        const r = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        const field = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
        return {
          found: true,
          x: r.left - r0.left,
          y: r.top - r0.top,
          w: r.width,
          h: r.height,
          bg: cs.backgroundColor,
          // A design "Placeholder" text maps to the field's ::placeholder.
          color: field && !el.value ? getComputedStyle(el, "::placeholder").color : cs.color,
          fontSize: cs.fontSize,
          fontWeight: cs.fontWeight,
          radius: cs.borderTopLeftRadius,
          display: cs.display,
          font: cs.fontFamily.split(",")[0] ?? "",
          opacity: cs.opacity,
          bgImage: cs.backgroundImage,
        }
      }
      const entries: Record<string, Measured | null> = { [rootId]: one(root) }
      for (const [penId, sel] of Object.entries(spec.nodes))
        entries[penId] = one(root?.querySelector(sel))
      result[rootId] = entries
    }
    return result
  },
  { map: MAP },
)) as Record<string, Record<string, Measured | null>>

const shot = flag("--screenshot")
if (shot) await page.locator('[data-pen="PufcL"]').screenshot({ path: shot })
const shotM2 = flag("--screenshot-m2")
if (shotM2) await page.locator('[data-pen="mj1CX"]').screenshot({ path: shotM2 })
// Element screenshots scroll the page; the pointer interactions below use viewport coordinates.
await page.evaluate(() => window.scrollTo(0, 0))

// --- Interactions (keyboard / pointer behavior of the stateful components) --------------------

const interactions: { name: string; ok: boolean; detail: string }[] = []
const expectThat = async (name: string, fn: () => Promise<string | true>) => {
  try {
    const r = await fn()
    interactions.push({ name, ok: r === true, detail: r === true ? "" : r })
  } catch (e) {
    interactions.push({ name, ok: false, detail: String(e) })
  }
}
const val = (sel: string) => page.locator(sel).inputValue()
const pf = '[data-pen="A9DDs"] .kimo-prop-field__value'
await expectThat("PropField: drag prefix +20px scrubs 1440 → 1460", async () => {
  const box = await page.locator('[data-pen="A9DDs"] .kimo-prop-field__prefix').boundingBox()
  if (!box) return "no prefix"
  await page.mouse.move(box.x + 3, box.y + 7)
  await page.mouse.down()
  await page.mouse.move(box.x + 13, box.y + 7)
  await page.mouse.move(box.x + 23, box.y + 7)
  await page.mouse.up()
  const v = await val(pf)
  return v === "1460" || `value ${v}`
})
await expectThat("PropField: ↑ +1, Shift+↑ +10, ↓ -1", async () => {
  await page.locator(pf).focus()
  await page.keyboard.press("ArrowUp")
  await page.keyboard.press("Shift+ArrowUp")
  await page.keyboard.press("ArrowDown")
  const v = await val(pf)
  return v === "1470" || `value ${v}`
})
await expectThat("PropField: typed value commits on Enter, Escape reverts", async () => {
  await page.locator(pf).fill("320")
  await page.keyboard.press("Enter")
  await page.locator(pf).fill("999")
  await page.keyboard.press("Escape")
  const v = await val(pf)
  return v === "320" || `value ${v}`
})
await expectThat("Select: ↓ opens, ↓↓ skips disabled, Enter chooses", async () => {
  const trigger = page.locator('[data-pen="gP276"] [role="combobox"]')
  await trigger.focus()
  await page.keyboard.press("ArrowDown")
  if ((await trigger.getAttribute("aria-expanded")) !== "true") return "did not open"
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("Enter")
  const text = await trigger.innerText()
  const open = await trigger.getAttribute("aria-expanded")
  // Inter → JetBrains Mono → Geist → (Fraunces disabled) wraps → Inter
  return (text === "Inter" && open === "false") || `value ${text}, expanded ${open}`
})
await expectThat("Select: click option chooses it", async () => {
  const trigger = page.locator('[data-pen="gP276"] [role="combobox"]')
  await trigger.click()
  await page.locator('[role="option"]', { hasText: "Geist" }).click()
  const text = await trigger.innerText()
  return text === "Geist" || `value ${text}`
})
await expectThat("Menu: ↓ skips disabled item, Home/End wrap", async () => {
  const menu = page.locator('[role="menu"][aria-label="Autofocus menu"]')
  await menu.locator('[role="menuitem"]').first().focus()
  await page.keyboard.press("ArrowDown")
  const a = await page.evaluate(() => document.activeElement?.textContent)
  await page.keyboard.press("Home")
  const b = await page.evaluate(() => document.activeElement?.textContent)
  await page.keyboard.press("ArrowUp")
  const c = await page.evaluate(() => document.activeElement?.textContent)
  await page.keyboard.press("Enter")
  const log = await page.locator(".kimo-gallery__log").innerText()
  return (
    (a?.startsWith("Create component") &&
      b?.startsWith("Copy") &&
      c?.startsWith("Create component") &&
      log === "Component") ||
    `${a} | ${b} | ${c} | ${log}`
  )
})
await expectThat("Menu: Escape calls onClose", async () => {
  await page.locator('[role="menu"][aria-label="Autofocus menu"] [role="menuitem"]').first().focus()
  await page.keyboard.press("Escape")
  const log = await page.locator(".kimo-gallery__log").innerText()
  return log === "Menu closed" || log
})
await expectThat("Segmented: → selects the next segment", async () => {
  await page.locator('[data-pen="hx0Wg"] [aria-checked="true"]').focus()
  await page.keyboard.press("ArrowRight")
  const l = await page
    .locator('[data-pen="hx0Wg"] [aria-checked="true"]')
    .getAttribute("aria-label")
  return l === "Align center" || String(l)
})
await expectThat("Toggle: click flips aria-checked", async () => {
  await page.locator('[data-pen="CSYQj"]').click()
  const v = await page.locator('[data-pen="CSYQj"]').getAttribute("aria-checked")
  return v === "true" || String(v)
})
await expectThat("Tabs: → activates the next tab", async () => {
  await page.locator('[role="tablist"][aria-label="Left panel"] [aria-selected="true"]').focus()
  await page.keyboard.press("ArrowRight")
  const t = await page
    .locator('[role="tablist"][aria-label="Left panel"] [aria-selected="true"]')
    .innerText()
  return t === "Assets" || t
})
await expectThat("LayerRow: double-click renames, Enter commits", async () => {
  await page.locator(".kimo-layer-row__name", { hasText: "Navbar" }).last().dblclick()
  await page.locator(".kimo-layer-row__input").fill("Top bar")
  await page.keyboard.press("Enter")
  const n = await page.locator(".kimo-layer-row__name", { hasText: "Top bar" }).count()
  return n === 1 || `found ${n}`
})
await expectThat("LayerRow: lock/visibility affordances toggle", async () => {
  const r = page.locator('[role="treeitem"]', { hasText: "Top bar" })
  await r.hover()
  await r.locator('[aria-label="Hide layer"]').click()
  await r.locator('[aria-label="Unlock layer"]').click()
  const hidden = await r.getAttribute("data-hidden")
  const locked = await r.getAttribute("data-locked")
  const expanded = await r.getAttribute("aria-expanded")
  await r.locator('[aria-label="Expand"]').click()
  const after = await r.getAttribute("aria-expanded")
  return (
    (hidden === "true" && locked === null && expanded === "false" && after === "true") ||
    `hidden ${hidden} locked ${locked} expanded ${expanded}→${after}`
  )
})
await expectThat("Tooltip: hover shows role=tooltip, leave hides it", async () => {
  await page.locator('[aria-label="Frame"]').first().hover()
  await page.waitForSelector('.kimo-tooltip--floating[role="tooltip"]', { timeout: 2000 })
  const described = await page
    .locator('[aria-label="Frame"]')
    .first()
    .getAttribute("aria-describedby")
  await page.mouse.move(5, 5)
  const left = await page.locator(".kimo-tooltip--floating").count()
  return (described !== null && left === 0) || `describedby ${described}, after leave ${left}`
})
await expectThat("Composer: Enter sends and clears", async () => {
  const input = page.locator('[data-pen="JvIbi"] textarea')
  await input.fill("Add a footer")
  await page.keyboard.press("Enter")
  const log = await page.locator(".kimo-gallery__log").innerText()
  const v = await input.inputValue()
  return (log === "Sent: Add a footer" && v === "") || `${log} / ${v}`
})

// --- M2 interactions -------------------------------------------------------------------------
const pen = (id: string) => page.locator(`[data-pen="${id}"]`)
const focused = () => page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "")
await expectThat("AlignmentGrid: → then ↓ moves the bars, roving tab stop follows", async () => {
  await pen("i1pQK").locator('[aria-checked="true"]').focus()
  await page.keyboard.press("ArrowRight")
  await page.keyboard.press("ArrowDown")
  const on = await pen("i1pQK").locator('[aria-checked="true"]').getAttribute("aria-label")
  const bars = await pen("i1pQK").locator(".kimo-alignment-grid__bars").count()
  return (on === "Center" && bars === 1 && (await focused()) === "Center") || `${on} bars ${bars}`
})
await expectThat("Slider: → +1%, End = max", async () => {
  const sl = pen("UWiq1")
  await sl.focus()
  await page.keyboard.press("End")
  const v = await sl.getAttribute("aria-valuenow")
  return v === "1" || `value ${v}`
})
await expectThat("HueSlider: click at the right end sets hue 360", async () => {
  await pen("weqLa").scrollIntoViewIfNeeded()
  const box = await pen("weqLa").boundingBox()
  if (!box) return "no box"
  await page.mouse.click(box.x + box.width - 1, box.y + 7)
  const v = await pen("weqLa").getAttribute("aria-valuenow")
  return v === "360" || `hue ${v}`
})
await expectThat(
  "ColorArea: click at (75%, 25%) = s 75 v 75; Shift+← lowers saturation 10",
  async () => {
    await pen("H5QKDe").scrollIntoViewIfNeeded()
    const box = await pen("H5QKDe").boundingBox()
    if (!box) return "no box"
    await page.mouse.click(box.x + box.width * 0.75, box.y + box.height * 0.25)
    const a = await pen("H5QKDe").getAttribute("aria-valuetext")
    await page.keyboard.press("Shift+ArrowLeft")
    const b = await pen("H5QKDe").getAttribute("aria-valuetext")
    return (
      (a === "Saturation 75%, brightness 75%" && b === "Saturation 65%, brightness 75%") ||
      `${a} → ${b}`
    )
  },
)
await expectThat("GradientStopBar: click adds a stop, Delete removes it", async () => {
  const bar = pen("rbnJS").locator(".kimo-gradient-stop-bar__bar")
  await bar.scrollIntoViewIfNeeded()
  const box = await bar.boundingBox()
  if (!box) return "no bar"
  await page.mouse.click(box.x + box.width * 0.25, box.y + 6)
  const n1 = await pen("rbnJS").locator('[role="slider"]').count()
  await pen("rbnJS").locator('[aria-current="true"]').focus()
  await page.keyboard.press("Delete")
  const n2 = await pen("rbnJS").locator('[role="slider"]').count()
  return (n1 === 4 && n2 === 3) || `${n1} → ${n2}`
})
await expectThat("SizeField: mode menu opens 4px below, picks Hug", async () => {
  const field = pen("G6R6IX")
  await field.locator(".kimo-size-field__mode").click()
  const menu = page.locator('[role="menu"]', {
    has: page.locator('[role="menuitemradio"]', { hasText: "Hug" }),
  })
  const fb = await field.boundingBox()
  const mb = await menu.boundingBox()
  await menu.locator('[role="menuitemradio"]', { hasText: "Hug" }).click()
  const mode = await field.locator(".kimo-size-field__mode").innerText()
  const gap = fb && mb ? Math.round(mb.y - (fb.y + fb.height)) : -1
  const left = fb && mb ? Math.round(mb.x - fb.x) : -1
  return (mode === "Hug" && gap === 4 && left === 0) || `mode ${mode} gap ${gap} left ${left}`
})
await expectThat("EffectRow: Type menu switches to Layer blur (droplet icon)", async () => {
  await pen("Q6vwp").locator(".kimo-effect-row__type").click()
  await page.locator('[role="menuitemradio"]', { hasText: "Layer blur" }).click()
  const t = await pen("Q6vwp").locator(".kimo-effect-row__type").innerText()
  return t === "Layer blur" || t
})
await expectThat("Popover: Tab is trapped inside the color picker", async () => {
  const pop = pen("jNAqx").locator(".kimo-popover")
  await pop.locator('[role="tab"]').first().focus()
  for (let i = 0; i < 30; i++) await page.keyboard.press("Tab")
  const inside = await pop.evaluate((el) => el.contains(document.activeElement))
  return inside || "focus escaped"
})
await expectThat(
  "ColorPicker: HSL format shows converted channels; hex commit updates",
  async () => {
    const pop = pen("jNAqx")
    await pop.locator(".kimo-color-picker__hex input").fill("2F6BFF")
    await page.keyboard.press("Enter")
    await pop.locator(".kimo-select__trigger").click()
    await page.locator('[role="option"]', { hasText: "HSL" }).click()
    const v = await pop.locator(".kimo-color-picker__hex input").inputValue()
    return v === "223 100 59" || v
  },
)
await expectThat("BlendModeMenu: ↓ previews, Enter commits Darken", async () => {
  const menu = pen("YFOTX").locator(".kimo-menu-dense")
  await menu.locator('[role="menuitemradio"]', { hasText: "Normal" }).focus()
  await page.keyboard.press("ArrowDown")
  const preview = await page.locator(".kimo-gallery__m2-log").innerText()
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("Enter")
  const checked = await menu.locator('[aria-checked="true"]').innerText()
  return (
    (preview === "Preview pass-through" && checked.trim() === "Darken") || `${preview} / ${checked}`
  )
})
await expectThat("IconPicker: search filters, ↓ + Enter picks", async () => {
  const pop = pen("b1gaD")
  await pop.locator("input").fill("ca")
  const names = await pop
    .locator(".kimo-icon-picker__rows [role=option]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("Enter")
  const footer = await pop.locator(".kimo-icon-picker__name").innerText()
  return (names.join(",") === "calendar,camera" && footer === "calendar") || `${names} / ${footer}`
})
await expectThat("IconPicker: Clear search leaves the empty state", async () => {
  const pop = pen("r6tBTD")
  await pop.getByRole("button", { name: "Clear search" }).click()
  const empty = await pop.locator(".kimo-icon-picker__empty").count()
  return empty === 0 || "still empty"
})
await expectThat("ImageFillPopover: mode menu → Contain", async () => {
  const pop = pen("Kgfrv")
  await pop.locator(".kimo-select__trigger").click()
  await page.locator('[role="option"]', { hasText: "Contain" }).click()
  const bg = await pop
    .locator(".kimo-image-fill__image")
    .evaluate((e) => getComputedStyle(e).backgroundSize)
  return bg === "contain" || bg
})
await browser.close()
server.stop(true)

// --- Compare ---------------------------------------------------------------------------------

const hex = (rgb: string): string | null => {
  const m = rgb.match(/rgba?\(([^)]+)\)/)
  if (!m?.[1]) return null
  const [r = 0, g = 0, b = 0, a = 1] = m[1]
    .split(/[ ,/]+/)
    .filter(Boolean)
    .map(Number)
  if (a === 0) return null
  const h = (n: number) => Math.round(n).toString(16).padStart(2, "0").toUpperCase()
  return `#${h(r)}${h(g)}${h(b)}${a < 1 ? h(a * 255) : ""}`
}

type Diff = { node: string; prop: string; pen: string; dom: string; delta?: number }
const diffs: Diff[] = []
/**
 * Deliberate deviations (reported, not failing), keyed `<root>/<id>:<prop>`. Each one is a design
 * value that cannot be correct at runtime; the reason is printed with the report.
 */
const ACCEPTED: Record<string, string> = {
  "H5QKDe/H5QKDe:fill":
    "ColorArea base must be the pure hue (HSV area math); the node's #FF7A1A is not a pure hue (s 0.9)",
  "xvOvm/CtzSh:fill": "same ColorArea instance (pure hue)",
  "u0aiz/CtzSh:fill": "same ColorArea instance (pure hue)",
  "jNAqx/BEI3g:fill": "same ColorArea instance (pure hue)",
  "jNAqx/BEI3g/phbmP:x":
    "ring follows the value: #F4A261 is s 0.60 / v 0.96; the node's ring sits at s 0.64 / v 0.88",
  "jNAqx/BEI3g/phbmP:y": "same (ring position is data, the node's is not #F4A261)",
  "jNAqx/BVfN2/o6DokA:x":
    "alpha thumb follows the value: the node shows 100% but draws the thumb at 93%",
  "b2Y0pD/CAjFK:fill": "same ColorArea instance (pure hue of the selected stop #E76F51)",
}
const accepted: (Diff & { reason: string })[] = []
/**
 * x/w deltas up to 2px that come only from text advance widths: Pencil ceil-rounds every text
 * node's width (`accent` mono 12 = 43.2 → 44), which shifts hug widths and following siblings.
 * Reported separately; they are font-measurement rounding, not layout drift.
 */
const rounding: Diff[] = []
const TEXT_ROUNDING = 2
let checks = 0
const TOL = 0.5
const TEXT_W_TOL = 1.5

for (const [rootId, rows] of Object.entries(fixture.nodes)) {
  const m = measured[rootId] ?? {}
  for (const [id, name, type, x, y, w, h, fill, fontSize, fontWeight, radius, opacity] of rows) {
    const label = `${rootId === id ? "" : `${rootId} › `}${name} (${id})`
    const d = m[id]
    if (!d) {
      diffs.push({ node: label, prop: "element", pen: "present", dom: "missing" })
      continue
    }
    const geo: [string, number, number, number][] = [
      ["x", x, d.x, TOL],
      ["y", y, d.y, TOL],
      ["w", w, d.w, type === "text" ? TEXT_W_TOL : TOL],
      ["h", h, d.h, TOL],
    ]
    for (const [prop, pen, dom, tol] of geo) {
      if (prop === "w" && FLEX_WIDTH.has(id)) continue
      if (prop === "h" && EXTENDED_HEIGHT.has(id)) continue
      checks++
      const delta = dom - pen
      if (Math.abs(delta) <= tol) continue
      const diff = { node: label, prop, pen: String(pen), dom: dom.toFixed(2), delta }
      if ((prop === "x" || prop === "w") && Math.abs(delta) <= TEXT_ROUNDING) rounding.push(diff)
      else diffs.push(diff)
    }
    if (opacity != null) {
      checks++
      if (Math.abs(Number(d.opacity) - opacity) > 0.005)
        diffs.push({ node: label, prop: "opacity", pen: String(opacity), dom: d.opacity })
    }
    if (d.display === "none")
      diffs.push({ node: label, prop: "display", pen: "visible", dom: "none" })
    if (fill && type === "path") {
      // Pattern paths (alpha checkers) are CSS background images: the fill color must be in it.
      checks++
      const colors = [...d.bgImage.matchAll(/rgba?\([^)]+\)/g)].map((m) => hex(m[0]))
      if (!colors.includes(fill.toUpperCase()))
        diffs.push({ node: label, prop: "pattern fill", pen: fill, dom: d.bgImage.slice(0, 60) })
    } else if (fill && fill !== "gradient" && fill !== "image") {
      const isFrame = type === "frame" || type === "rectangle" || type === "ellipse"
      const domColor = hex(isFrame ? d.bg : d.color)
      // A fully transparent design fill (#00000000) is "no background" in CSS.
      const want = /^#[0-9A-F]{6}00$/i.test(fill) ? null : fill.toUpperCase()
      checks++
      if (domColor !== want)
        diffs.push({
          node: label,
          prop: isFrame ? "fill" : "color",
          pen: fill,
          dom: String(domColor),
        })
    }
    if (fontSize != null) {
      checks++
      if (d.fontSize !== `${fontSize}px`)
        diffs.push({ node: label, prop: "fontSize", pen: `${fontSize}px`, dom: d.fontSize })
    }
    if (type === "text") {
      checks++
      const want = fontWeight ?? "400"
      if (d.fontWeight !== want)
        diffs.push({ node: label, prop: "fontWeight", pen: want, dom: d.fontWeight })
    }
    if (radius != null && (type === "frame" || type === "rectangle")) {
      checks++
      const r = Number.parseFloat(d.radius)
      const want = Math.min(radius, Math.min(w, h) / 2)
      const got = Math.min(r, Math.min(d.w, d.h) / 2)
      if (Math.abs(got - want) > TOL)
        diffs.push({ node: label, prop: "radius (effective)", pen: String(want), dom: String(got) })
    }
  }
}

for (let i = diffs.length - 1; i >= 0; i--) {
  const d = diffs[i] as Diff
  const m = d.node.match(/^(?:(\S+) › )?.*\((\S+)\)$/)
  const root = m?.[1] ?? m?.[2]
  const reason = ACCEPTED[`${root}/${m?.[2]}:${d.prop}`]
  if (reason) {
    accepted.unshift({ ...d, reason })
    diffs.splice(i, 1)
  }
}
console.log(
  `theme=${theme}  checks=${checks}  drift=${diffs.length}  accepted=${accepted.length}  text-rounding=${rounding.length}  page errors=${errors.length}`,
)
for (const e of errors) console.log(`  page error: ${e}`)
if (diffs.length) {
  console.log("| node | prop | pen | dom | Δ |")
  console.log("|---|---|---|---|---|")
  for (const d of diffs)
    console.log(`| ${d.node} | ${d.prop} | ${d.pen} | ${d.dom} | ${d.delta?.toFixed(2) ?? ""} |`)
}
if (accepted.length) {
  console.log("\naccepted deviations:")
  for (const d of accepted)
    console.log(`| ${d.node} | ${d.prop} | ${d.pen} | ${d.dom} | ${d.reason} |`)
}
if (rounding.length && args.includes("--verbose")) {
  console.log("\ntext-width rounding (x/w within 2px):")
  for (const d of rounding)
    console.log(`| ${d.node} | ${d.prop} | ${d.pen} | ${d.dom} | ${d.delta?.toFixed(2) ?? ""} |`)
}
const failed = interactions.filter((i) => !i.ok)
console.log(`\ninteractions: ${interactions.length - failed.length}/${interactions.length} pass`)
for (const i of interactions)
  console.log(`  ${i.ok ? "ok  " : "FAIL"} ${i.name}${i.detail ? ` — ${i.detail}` : ""}`)
const json = flag("--json")
if (json)
  await writeFile(json, JSON.stringify({ theme, checks, diffs, rounding, measured }, null, 2))
process.exit(diffs.length || errors.length || failed.length ? 1 : 0)
