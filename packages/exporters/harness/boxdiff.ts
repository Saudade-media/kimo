/**
 * Verification harness (teardown §12 M7 exit criteria): renders exported HTML in headless
 * Chromium and compares every element box with `@kimo/layout` results.
 *
 * Two layout passes per fixture:
 *
 * - **A — browser-measured text.** The layout engine's `TextMeasurer` is answered by Chromium
 *   itself (each text run measured with the exported CSS), iterated to a fixed point. With the
 *   same text metrics on both sides every box is pure geometry, so **every** box must match
 *   exactly (≤ 1/64 px, Chromium's layout unit). This checks the CSS translation of sizing,
 *   flex, padding, gaps, placement, groups and transforms.
 * - **B — canvas-measured text.** The renderer's CanvasKit Paragraph measurer (what the canvas
 *   draws). Nodes whose B box equals their A box do not depend on text metrics: they are
 *   checked exactly against the browser. The others are text-dependent and checked within a
 *   tolerance; line-count differences between Paragraph and Chromium are reported.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { KimoDocument, Libraries } from "@kimo/core-schema"
import type { LayoutResult, Rect, TextMeasureInput, TextMeasurer, TextMetrics } from "@kimo/layout"
import type { Browser, Page } from "playwright"
import { CssWriter, quoteFamily } from "../src/css/style"
import type { IconLoader } from "../src/export"
import { buildIR, emitHtml, layoutDocument, loadIcons } from "../src/index"
import type { IRTextStyle } from "../src/ir/types"

/** Exact geometry: Chromium lays out in 1/64 px units. */
export const EXACT = 1 / 64 + 1e-6

/** Text tolerance (Paragraph vs Chromium): max(abs px, rel × size). */
export const TEXT_TOLERANCE = { px: 2, rel: 0.04 }

export interface BoxDiff {
  id: string
  name: string | null
  /** Layout box relative to the root. */
  expected: Rect
  /** DOM box relative to the root. */
  actual: Rect
  delta: number
}

export interface FixtureReport {
  fixture: string
  nodes: number
  /** A: every box vs browser-measured layout. */
  exactFailures: BoxDiff[]
  /** B: nodes independent of text metrics, exact. */
  geometryChecked: number
  geometryFailures: BoxDiff[]
  /** B: text-dependent nodes, within tolerance. */
  textChecked: number
  textFailures: BoxDiff[]
  /** Max |Δ| over text-dependent nodes (B). */
  textMaxDelta: number
  /** Text nodes whose line count differs between Paragraph and Chromium. */
  lineMismatches: { id: string; canvas: number; browser: number }[]
  /** Measurer fixed-point iterations of pass A. */
  iterations: number
  /** Solid fills / text colors checked against the resolved IR color (theme cascade). */
  colorsChecked: number
  colorFailures: { id: string; prop: string; expected: number[]; actual: number[] }[]
}

export interface HarnessFonts {
  /** `@font-face` CSS (file URLs) for Chromium. */
  css: string
}

const FONT_FILES: [string, number, boolean, string][] = [
  ["Inter", 400, false, "Inter-Regular.ttf"],
  ["Inter", 500, false, "Inter-Medium.ttf"],
  ["Inter", 600, false, "Inter-SemiBold.ttf"],
  ["Inter", 700, false, "Inter-Bold.ttf"],
  ["Inter", 400, true, "Inter-Italic.ttf"],
  ["JetBrains Mono", 400, false, "JetBrainsMono-Regular.ttf"],
  ["JetBrains Mono", 500, false, "JetBrainsMono-Medium.ttf"],
]

/** `@font-face` rules for the renderer's bundled fonts (the faces the canvas measures with). */
export function bundledFontFaces(fontDir: string): string {
  return FONT_FILES.map(
    ([family, weight, italic, file]) =>
      `@font-face { font-family: ${quoteFamily(family)}; font-weight: ${weight}; font-style: ${italic ? "italic" : "normal"}; src: url("file://${join(fontDir, file)}"); }`,
  ).join("\n")
}

/** Text measured by Chromium with the exported CSS; misses are collected and filled in batches. */
class BrowserMeasurer implements TextMeasurer {
  private cache = new Map<string, TextMetrics>()
  misses = new Map<string, { input: TextMeasureInput; maxWidth: number | undefined }>()
  private writer = new CssWriter({ variables: false })

  private key(input: TextMeasureInput, maxWidth: number | undefined): string {
    return JSON.stringify([
      input.runs,
      maxWidth === undefined ? null : Math.round(maxWidth * 64) / 64,
    ])
  }

  measure(input: TextMeasureInput, maxWidth: number | undefined): TextMetrics {
    const k = this.key(input, maxWidth)
    const hit = this.cache.get(k)
    if (hit) return hit
    this.misses.set(k, { input, maxWidth })
    return { w: 0, h: 0, lines: 1, baseline: 0 }
  }

  /** CSS of a paragraph and its runs, as the HTML emitter writes them. */
  private css(input: TextMeasureInput): { para: string; runs: string[] } {
    const st = (s: TextMeasureInput["style"]): IRTextStyle => ({
      family: { v: s.fontFamily },
      size: { v: s.fontSize },
      weight: { v: s.fontWeight },
      italic: s.italic,
      lineHeight:
        s.lineHeight === null
          ? { kind: "normal" }
          : "px" in s.lineHeight
            ? { kind: "px", v: s.lineHeight.px }
            : { kind: "multiplier", v: { v: s.lineHeight.multiplier } },
      letterSpacing: { v: s.letterSpacing },
      align: s.align,
      valign: s.valign,
      decoration: [...s.decoration],
      case: s.case,
      features: { ...s.features },
    })
    const para = st(input.style)
    const decl = (d: { prop: string; value: string }[]) =>
      d.map((x) => `${x.prop}:${x.value}`).join(";")
    return {
      para: decl(this.writer.textStyle(para, null)),
      runs: input.runs.map((r) => decl(this.writer.textStyle(st(r.style), para))),
    }
  }

  async fill(page: Page): Promise<void> {
    const jobs = [...this.misses.entries()].map(([k, { input, maxWidth }]) => ({
      k,
      maxWidth: maxWidth ?? null,
      texts: input.runs.map((r) => r.text),
      ...this.css(input),
    }))
    this.misses.clear()
    const results = await page.evaluate((jobs) => {
      const host = document.createElement("div")
      host.style.cssText = "position:absolute;left:0;top:0;width:100000px"
      document.body.appendChild(host)
      const out: [string, { w: number; h: number; lines: number; baseline: number }][] = []
      for (const j of jobs) {
        const p = document.createElement("p")
        p.style.cssText = `${j.para};position:absolute;left:0;top:0;margin:0;${
          j.maxWidth === null
            ? "width:max-content;white-space:pre"
            : `width:${j.maxWidth}px;white-space:pre-wrap;overflow-wrap:break-word`
        }`
        if (j.texts.length === 1) p.textContent = j.texts[0] ?? ""
        else
          j.texts.forEach((t, i) => {
            const s = document.createElement("span")
            s.style.cssText = j.runs[i] ?? ""
            s.textContent = t
            p.appendChild(s)
          })
        host.appendChild(p)
        const box = p.getBoundingClientRect()
        const range = document.createRange()
        range.selectNodeContents(p)
        const rects = [...range.getClientRects()]
        const tops = new Set(rects.map((r) => Math.round(r.top * 4)))
        let w = box.width
        if (j.maxWidth !== null) {
          w = 0
          for (const r of rects) w = Math.max(w, r.right - box.left)
        }
        // Baseline of the first line (a zero-size inline-block sits on it).
        const probe = document.createElement("span")
        probe.style.cssText = "display:inline-block;width:0;height:0"
        p.insertBefore(probe, p.firstChild)
        const baseline = probe.getBoundingClientRect().top - box.top
        out.push([j.k, { w, h: box.height, lines: Math.max(1, tops.size), baseline }])
        p.remove()
      }
      host.remove()
      return out
    }, jobs)
    for (const [k, m] of results) this.cache.set(k, m)
  }
}

export interface VerifyInput {
  name: string
  doc: KimoDocument
  libraries?: Libraries
}

export interface VerifyContext {
  browser: Browser
  /** CanvasKit Paragraph measurer (renderer `textMeasurer()`). */
  canvasMeasurer: TextMeasurer
  icons?: IconLoader
  fontCss: string
  outDir: string
}

function relBoxes(layout: LayoutResult, rootId: string): Map<string, Rect> {
  const root = layout.nodes.get(rootId)
  const out = new Map<string, Rect>()
  if (!root) return out
  const ox = root.world.x
  const oy = root.world.y
  for (const [id, n] of layout.nodes) {
    if (!n.visible) continue
    out.set(id, { x: n.world.x - ox, y: n.world.y - oy, w: n.world.w, h: n.world.h })
  }
  return out
}

const delta = (a: Rect, b: Rect) =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.w - b.w), Math.abs(a.h - b.h))

/** Runs both passes for one document. */
export async function verifyFixture(
  input: VerifyInput,
  ctx: VerifyContext,
): Promise<FixtureReport> {
  const { doc, libraries } = input
  const page = await ctx.browser.newPage({ viewport: { width: 2000, height: 1200 } })
  const dir = join(ctx.outDir, input.name)
  mkdirSync(dir, { recursive: true })
  // Fonts for measurement before the export page exists.
  writeFileSync(
    join(dir, "measure.html"),
    `<!doctype html><style>${ctx.fontCss}</style><body></body>`,
  )
  await page.goto(`file://${join(dir, "measure.html")}`)
  await page.evaluate(async () => {
    const families = ["Inter", "JetBrains Mono"]
    const loads: Promise<unknown>[] = []
    for (const f of families)
      for (const w of [400, 500, 600, 700]) {
        loads.push(document.fonts.load(`${w} 16px "${f}"`))
        loads.push(document.fonts.load(`italic ${w} 16px "${f}"`))
      }
    await Promise.all(loads)
  })

  // Pass A: browser-measured text, iterated until no measurement is missing.
  const bm = new BrowserMeasurer()
  let layoutA: LayoutResult | null = null
  let iterations = 0
  for (; iterations < 12; iterations++) {
    layoutA = await layoutDocument(doc, { measureText: bm, ...(libraries ? { libraries } : {}) })
    if (bm.misses.size === 0) break
    await bm.fill(page)
  }
  const layoutB = await layoutDocument(doc, {
    measureText: ctx.canvasMeasurer,
    ...(libraries ? { libraries } : {}),
  })

  // Export with the browser-measured layout as the hint (group bounds with text).
  const ir = buildIR(doc, { ...(libraries ? { libraries } : {}), layout: layoutA as LayoutResult })
  const icons = ctx.icons ? await loadIcons(ir, ctx.icons) : undefined
  const files = emitHtml(ir, { ids: true, extraCss: ctx.fontCss, ...(icons ? { icons } : {}) })
  for (const f of files) writeFileSync(join(dir, f.path), f.contents)
  await page.goto(`file://${join(dir, "index.html")}`)
  await page.evaluate(() => document.fonts.ready)
  // Colors: every single-solid fill / text color, as sRGB bytes drawn by Chromium.
  const expectedColors: { id: string; prop: "background-color" | "color"; rgba: number[] }[] = []
  const collectColors = (n: (typeof ir.roots)[number]) => {
    const f = n.visual.fills
    if (n.tag !== "svg" && f.length === 1 && f[0]?.kind === "solid" && f[0].blend === "normal")
      expectedColors.push({ id: n.id, prop: "background-color", rgba: [...f[0].color.rgba] })
    const tf = n.text?.fills
    if (tf && tf.length === 1 && tf[0]?.kind === "solid")
      expectedColors.push({ id: n.id, prop: "color", rgba: [...tf[0].color.rgba] })
    n.children.forEach(collectColors)
  }
  ir.roots.forEach(collectColors)
  const actualColors = await page.evaluate(
    (list) => {
      const c = document.createElement("canvas")
      c.width = 1
      c.height = 1
      const ctx = c.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D
      return list.map(({ id, prop }) => {
        const e = document.querySelector(`[data-kimo-id="${CSS.escape(id)}"]`)
        if (!e) return null
        ctx.clearRect(0, 0, 1, 1)
        ctx.fillStyle = getComputedStyle(e).getPropertyValue(prop)
        ctx.fillRect(0, 0, 1, 1)
        return [...ctx.getImageData(0, 0, 1, 1).data]
      })
    },
    expectedColors.map(({ id, prop }) => ({ id, prop })),
  )
  const colorFailures: FixtureReport["colorFailures"] = []
  expectedColors.forEach((e, i) => {
    const a = actualColors[i]
    if (!a) return
    const want = e.rgba.map((x) => Math.round(x * 255))
    // Unpremultiplied canvas readback loses precision at low alpha: compare premultiplied.
    const pm = (v: number[]) =>
      [0, 1, 2].map((k) => ((v[k] as number) * (v[3] as number)) / 255).concat(v[3] as number)
    const ok = pm(want).every((x, k) => Math.abs(x - (pm(a)[k] as number)) <= 2)
    if (!ok) colorFailures.push({ id: e.id, prop: e.prop, expected: want, actual: a })
  })

  const dom = await page.evaluate(
    (roots: string[]) => {
      const out: Record<string, [number, number, number, number]> = {}
      for (const rootId of roots) {
        const rootEl = document.querySelector(`[data-kimo-id="${CSS.escape(rootId)}"]`)
        if (!rootEl) continue
        const rb = rootEl.getBoundingClientRect()
        for (const e of [rootEl, ...rootEl.querySelectorAll("[data-kimo-id]")]) {
          const b = e.getBoundingClientRect()
          out[e.getAttribute("data-kimo-id") as string] = [
            b.left - rb.left,
            b.top - rb.top,
            b.width,
            b.height,
          ]
        }
      }
      return out
    },
    ir.roots.map((r) => r.id),
  )
  await page.close()

  const report: FixtureReport = {
    fixture: input.name,
    nodes: 0,
    exactFailures: [],
    geometryChecked: 0,
    geometryFailures: [],
    textChecked: 0,
    textFailures: [],
    textMaxDelta: 0,
    lineMismatches: [],
    iterations,
    colorsChecked: expectedColors.length,
    colorFailures,
  }
  const names = new Map<string, string | null>()
  const walk = (n: (typeof ir.roots)[number]) => {
    names.set(n.id, n.name)
    n.children.forEach(walk)
  }
  ir.roots.forEach(walk)
  for (const root of ir.roots) {
    const a = relBoxes(layoutA as LayoutResult, root.id)
    const b = relBoxes(layoutB, root.id)
    const inRoot = new Set<string>()
    const collect = (n: (typeof ir.roots)[number]) => {
      inRoot.add(n.id)
      n.children.forEach(collect)
    }
    collect(root)
    for (const [id, expected] of a) {
      if (!inRoot.has(id)) continue
      const box = dom[id]
      if (!box) continue
      const actual = { x: box[0], y: box[1], w: box[2], h: box[3] }
      report.nodes++
      const d = delta(expected, actual)
      const diff = (e: Rect, dd: number): BoxDiff => ({
        id,
        name: names.get(id) ?? null,
        expected: e,
        actual,
        delta: dd,
      })
      if (d > EXACT) report.exactFailures.push(diff(expected, d))
      const eb = b.get(id)
      if (!eb) continue
      if (delta(expected, eb) <= 1e-6) {
        report.geometryChecked++
        const db = delta(eb, actual)
        if (db > EXACT) report.geometryFailures.push(diff(eb, db))
      } else {
        report.textChecked++
        const db = delta(eb, actual)
        report.textMaxDelta = Math.max(report.textMaxDelta, db)
        const size = Math.max(eb.w, eb.h)
        if (db > Math.max(TEXT_TOLERANCE.px, TEXT_TOLERANCE.rel * size))
          report.textFailures.push(diff(eb, db))
      }
    }
    for (const [id, nb] of layoutB.nodes) {
      if (!inRoot.has(id)) continue
      const na = (layoutA as LayoutResult).nodes.get(id)
      if (!nb.text || !na?.text || !dom[id]) continue
      if ((nb.text.lines ?? 1) !== (na.text.lines ?? 1))
        report.lineMismatches.push({ id, canvas: nb.text.lines ?? 1, browser: na.text.lines ?? 1 })
    }
  }
  const round = (r: Rect) => ({
    x: +r.x.toFixed(3),
    y: +r.y.toFixed(3),
    w: +r.w.toFixed(3),
    h: +r.h.toFixed(3),
  })
  for (const list of [report.exactFailures, report.geometryFailures, report.textFailures])
    for (const f of list) {
      f.expected = round(f.expected)
      f.actual = round(f.actual)
      f.delta = +f.delta.toFixed(3)
    }
  report.textMaxDelta = +report.textMaxDelta.toFixed(3)
  writeFileSync(join(dir, "report.json"), `${JSON.stringify(report, null, 2)}\n`)
  return report
}
