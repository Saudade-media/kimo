/**
 * `bun run verify`: box diff of exported HTML vs layout for every fixture (see ./boxdiff.ts).
 * Writes `harness/out/<fixture>/{index.html,styles.css,tokens.css,report.json}` and prints a
 * summary; exits 1 on any exact-geometry failure or text out of tolerance.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { type KimoDocument, parse } from "@kimo/core-schema"
import { createRenderer } from "@kimo/renderer"
import { chromium } from "playwright"
import { bundledFontFaces, type FixtureReport, verifyFixture } from "./boxdiff"

const HERE = import.meta.dir
const CORE = join(HERE, "../../core-schema/fixtures/valid")
const OWN = join(HERE, "../test/fixtures")
export const FONT_DIR = join(HERE, "../../renderer/assets/fonts")

/** Fixtures checked by the harness: core-schema's valid fixtures plus the export fixtures. */
export const HARNESS_FIXTURES: { name: string; path: string; libs?: Record<string, string> }[] = [
  {
    name: "example-10-5",
    path: join(CORE, "example-10-5.kimo"),
    libs: { ui: join(CORE, "libs/kimo-ui.lib.kimo") },
  },
  { name: "components-m3", path: join(CORE, "components-m3.kimo") },
  { name: "components-local", path: join(CORE, "components-local.kimo") },
  { name: "derived-component-props", path: join(CORE, "derived-component-props.kimo") },
  { name: "shapes-and-paints", path: join(CORE, "shapes-and-paints.kimo") },
  { name: "styling-m2", path: join(CORE, "styling-m2.kimo") },
  { name: "themes-multi-axis", path: join(CORE, "themes-multi-axis.kimo") },
  { name: "unicode-and-escapes", path: join(CORE, "unicode-and-escapes.kimo") },
  { name: "minimal", path: join(CORE, "minimal.kimo") },
  { name: "features-all", path: join(CORE, "features-all.kimo") },
  { name: "agent-nodes-m6", path: join(CORE, "agent-nodes-m6.kimo") },
  { name: "layout-matrix", path: join(OWN, "layout-matrix.kimo") },
  { name: "wrap-edge", path: join(OWN, "wrap-edge.kimo") },
  { name: "text-styles", path: join(OWN, "text-styles.kimo") },
  { name: "paints-effects", path: join(OWN, "paints-effects.kimo") },
]

export function loadFixture(f: (typeof HARNESS_FIXTURES)[number]): {
  doc: KimoDocument
  libraries: Record<string, KimoDocument>
} {
  const doc = parse(readFileSync(f.path, "utf8"))
  const libraries: Record<string, KimoDocument> = {}
  for (const [alias, p] of Object.entries(f.libs ?? {}))
    libraries[alias] = parse(readFileSync(p, "utf8"))
  return { doc, libraries }
}

export async function runHarness(outDir: string): Promise<FixtureReport[]> {
  const renderer = createRenderer()
  await renderer.init({ offlineFonts: true })
  const browser = await chromium.launch()
  const reports: FixtureReport[] = []
  try {
    for (const f of HARNESS_FIXTURES) {
      const { doc, libraries } = loadFixture(f)
      reports.push(
        await verifyFixture(
          { name: f.name, doc, libraries },
          {
            browser,
            canvasMeasurer: renderer.textMeasurer(),
            ...(renderer.icons ? { icons: renderer.icons } : {}),
            fontCss: bundledFontFaces(FONT_DIR),
            outDir,
          },
        ),
      )
    }
  } finally {
    await browser.close()
    renderer.dispose()
  }
  return reports
}

if (import.meta.main) {
  const reports = await runHarness(join(HERE, "out"))
  let failed = false
  for (const r of reports) {
    const bad =
      r.exactFailures.length +
      r.geometryFailures.length +
      r.textFailures.length +
      r.colorFailures.length
    if (bad) failed = true
    console.log(
      `${bad ? "FAIL" : "ok  "} ${r.fixture.padEnd(26)} nodes ${String(r.nodes).padStart(3)}  A exact ✗${r.exactFailures.length}  B geometry ${r.geometryChecked}/✗${r.geometryFailures.length}  B text ${r.textChecked}/✗${r.textFailures.length} (max Δ ${r.textMaxDelta}px)  lines≠ ${r.lineMismatches.length}  colors ${r.colorsChecked}/✗${r.colorFailures.length}`,
    )
    for (const d of [...r.exactFailures, ...r.geometryFailures, ...r.textFailures].slice(0, 8))
      console.log(
        `       ${d.id} ${d.name ?? ""} expected ${JSON.stringify(d.expected)} actual ${JSON.stringify(d.actual)} Δ${d.delta}`,
      )
    for (const c of r.colorFailures.slice(0, 8))
      console.log(`       ${c.id} ${c.prop} expected ${c.expected} actual ${c.actual}`)
  }
  process.exit(failed ? 1 : 0)
}
