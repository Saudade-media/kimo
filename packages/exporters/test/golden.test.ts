/**
 * Golden output tests (teardown §12 M7 exit criterion): every target for every fixture is
 * compared byte for byte with `test/golden/<fixture>/<target>/…`. `UPDATE_GOLDENS=1 bun test`
 * rewrites them. SVG/PDF use a deterministic fake text measurer.
 */
import { describe, expect, test } from "bun:test"
import {
  buildIR,
  type ExportTarget,
  emitDtcg,
  emitHtml,
  emitPdf,
  emitReact,
  emitSvg,
  emitTailwindTheme,
  emitTokensCss,
  layoutDocument,
} from "../src"
import { FIXTURES, fakeIcons, fakeMeasurer, golden, loadFixture } from "./helpers"

async function outputs(f: (typeof FIXTURES)[number]): Promise<Record<string, string | Uint8Array>> {
  const { doc, libraries } = loadFixture(f)
  const out: Record<string, string | Uint8Array> = {}
  const html = buildIR(doc, { libraries })
  for (const file of emitHtml(html, { icons: fakeIcons }))
    out[`html-css/${file.path}`] = file.contents
  const react = buildIR(doc, { libraries, components: true })
  for (const file of emitReact(react, { icons: fakeIcons }))
    out[`react-tailwind/${file.path}`] = file.contents
  out["tokens/tokens.json"] = emitDtcg(html)
  out["tokens/tokens.css"] = emitTokensCss(html)
  out["tokens/theme.css"] = emitTailwindTheme(html)
  const layout = await layoutDocument(doc, { libraries, measureText: fakeMeasurer })
  const vec = buildIR(doc, { libraries, layout })
  for (const file of emitSvg(vec, { layout, measureText: fakeMeasurer, icons: fakeIcons }))
    out[`svg/${file.path}`] = file.contents
  const pdf = await emitPdf(vec, { layout, measureText: fakeMeasurer, icons: fakeIcons })
  out[`pdf/${pdf.path}`] = pdf.contents
  const issues = [...html.issues, ...vec.issues].map(
    (i) => `${i.code} ${i.nodeId ?? "-"} ${i.message}`,
  )
  out["issues.txt"] = `${[...new Set(issues)].sort().join("\n")}\n`
  return out
}

describe("golden outputs", () => {
  for (const f of FIXTURES) {
    test(f.name, async () => {
      const out = await outputs(f)
      const diffs: string[] = []
      for (const [rel, contents] of Object.entries(out)) {
        const d = golden(`${f.name}/${rel}`, contents)
        if (d) diffs.push(d)
      }
      expect(diffs).toEqual([])
    })
  }
})

describe("determinism", () => {
  test("two runs give identical bytes for every target", async () => {
    for (const f of FIXTURES.slice(0, 6)) {
      const a = await outputs(f)
      const b = await outputs(f)
      expect(Object.keys(a)).toEqual(Object.keys(b))
      for (const k of Object.keys(a))
        expect(Buffer.from(a[k] as string).equals(Buffer.from(b[k] as string))).toBe(true)
    }
  })
})

export type { ExportTarget }
