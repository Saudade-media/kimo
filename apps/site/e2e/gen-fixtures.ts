/**
 * Regenerates e2e/fixtures/<frame>.json — the design's node boxes — from Pencil html-css exports
 * of the board 26 frames (Export([id], "html-css", "<dir>/<id>.html", {includeLayerIds: true})).
 * The export is Pencil's own layout of the nodes; it is rendered with the same bundled fonts the
 * site serves, so a diff against the site measures translation drift only.
 *
 *   tsx e2e/gen-fixtures.ts <export dir>
 */
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright"
import { collectBoxes, fixExportBoxes } from "./measure-lib"

const FRAMES: Record<string, { name: string; width: number }> = {
  yutK2: { name: "landing-desktop", width: 1440 },
  t4GJ6Z: { name: "landing-mobile", width: 390 },
  BRyqo: { name: "docs-article-desktop", width: 1440 },
  YgbwO: { name: "docs-article-mobile", width: 390 },
  suf5N: { name: "docs-spec-desktop", width: 1440 },
  uvFUy: { name: "docs-cli-desktop", width: 1440 },
  F0F2T: { name: "docs-drawer-mobile", width: 390 },
}

const dir = process.argv[2]
if (!dir) throw new Error("usage: tsx e2e/gen-fixtures.ts <export dir>")
const fonts = join(import.meta.dirname, "../../../packages/renderer/assets/fonts")
const face = (family: string, weight: number, file: string) =>
  `@font-face{font-family:"${family}";font-weight:${weight};src:url("file://${fonts}/${file}")}`
const fontCss = [
  face("Inter", 400, "Inter-Regular.ttf"),
  face("Inter", 500, "Inter-Medium.ttf"),
  face("Inter", 600, "Inter-SemiBold.ttf"),
  face("Inter", 700, "Inter-Bold.ttf"),
  face("JetBrains Mono", 400, "JetBrainsMono-Regular.ttf"),
  face("JetBrains Mono", 500, "JetBrainsMono-Medium.ttf"),
  face("JetBrains Mono", 600, "JetBrainsMono-Medium.ttf"),
].join("")

const browser = await chromium.launch()
for (const [id, f] of Object.entries(FRAMES)) {
  const src = readFileSync(join(dir, `${id}.html`), "utf8")
    .replace(/<link[^>]+fonts\.googleapis[^>]+>/g, "")
    .replace(/<link[^>]+fonts\.gstatic[^>]+>/g, "")
    .replace("</head>", `<style>${fontCss}</style></head>`)
  const tmp = join(dir, `${id}.local.html`)
  writeFileSync(tmp, src)
  const ctx = await browser.newContext({ viewport: { width: f.width, height: 900 } })
  await ctx.addInitScript({ content: "globalThis.__name ??= (fn) => fn" })
  const page = await ctx.newPage()
  await page.goto(`file://${tmp}`)
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(fixExportBoxes)
  const boxes = await page.evaluate(collectBoxes, {
    rootSel: `[data-pencil-id="${id}"]`,
    attr: "data-pencil-name",
  })
  writeFileSync(
    join(import.meta.dirname, "fixtures", `${f.name}.json`),
    `${JSON.stringify({ frame: id, width: f.width, boxes }, null, 0).replace(/},{/g, "},\n{")}\n`,
  )
  console.log(`${f.name}: ${boxes.length} nodes`)
  await ctx.close()
}
await browser.close()
