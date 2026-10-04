/**
 * M7 exit criterion: exported pages vs layout — exact box diff for geometry, tolerance for
 * text (see harness/boxdiff.ts). Runs when Playwright's Chromium is installed; skipped
 * otherwise (`bunx playwright install chromium`).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRenderer, type Renderer } from "@kimo/renderer"
import { type Browser, chromium } from "playwright"
import { bundledFontFaces, type FixtureReport, verifyFixture } from "../harness/boxdiff"
import { FONT_DIR, HARNESS_FIXTURES, loadFixture } from "../harness/verify"

/**
 * Differences that are not exporter bugs, each with its reason. Anything else fails.
 * `id` + `kind` (`exact`: pass A, `geometry`/`text`: pass B).
 */
export const KNOWN_DIFFS: { fixture: string; id: string; kind: string; reason: string }[] = [
  {
    fixture: "unicode-and-escapes",
    id: "Txt0000001",
    kind: "text",
    reason: "emoji and tab come from different fallback fonts in CanvasKit Paragraph and Chromium",
  },
  ...["exact", "geometry"].flatMap((kind) =>
    ["Cell000001", "Cell000002"].map((id) => ({
      fixture: "features-all",
      id,
      kind,
      reason:
        "@kimo/layout reads a `dimension`-bound gap as 0 and Yoga does not redistribute free space after a `min` clamp; the CSS follows the spec (gap 8px)",
    })),
  ),
]

const chromiumReady = (() => {
  try {
    return existsSync(chromium.executablePath())
  } catch {
    return false
  }
})()

describe.skipIf(!chromiumReady)("box diff: exported HTML vs layout", () => {
  let browser: Browser
  let renderer: Renderer
  const out = mkdtempSync(join(tmpdir(), "kimo-boxdiff-"))
  beforeAll(async () => {
    renderer = createRenderer()
    await renderer.init({ offlineFonts: true })
    browser = await chromium.launch()
  })
  afterAll(async () => {
    await browser?.close()
    renderer?.dispose()
    rmSync(out, { recursive: true, force: true })
  })

  for (const f of HARNESS_FIXTURES) {
    test(f.name, async () => {
      const { doc, libraries } = loadFixture(f)
      const r: FixtureReport = await verifyFixture(
        { name: f.name, doc, libraries },
        {
          browser,
          canvasMeasurer: renderer.textMeasurer(),
          ...(renderer.icons ? { icons: renderer.icons } : {}),
          fontCss: bundledFontFaces(FONT_DIR),
          outDir: out,
        },
      )
      const known = (kind: string, id: string) =>
        KNOWN_DIFFS.some((k) => k.fixture === f.name && k.kind === kind && k.id === id)
      const unexpected = [
        ...r.exactFailures
          .filter((d) => !known("exact", d.id))
          .map((d) => ({ kind: "exact", ...d })),
        ...r.geometryFailures
          .filter((d) => !known("geometry", d.id))
          .map((d) => ({ kind: "geometry", ...d })),
        ...r.textFailures.filter((d) => !known("text", d.id)).map((d) => ({ kind: "text", ...d })),
      ]
      expect(unexpected).toEqual([])
      expect(r.colorFailures).toEqual([])
    }, 60_000)
  }
})
