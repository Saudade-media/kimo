/**
 * Test helpers: fixtures, a deterministic text measurer (goldens must not depend on font
 * rasterization), a fake icon lookup, and golden-file comparison (`UPDATE_GOLDENS=1`).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { TextMeasurer } from "@kimo/layout"
import type { IconLookup } from "../src"

export { HARNESS_FIXTURES as FIXTURES, loadFixture } from "../harness/verify"

export const GOLDEN_DIR = join(import.meta.dir, "golden")

/**
 * Every glyph is `0.5 × fontSize` wide plus letter spacing; lines are the line height
 * (default 1.25 × size); greedy word wrap at `maxWidth`; `\n` breaks; baseline 0.8 × size.
 */
export const fakeMeasurer: TextMeasurer = {
  measure(t, maxWidth) {
    const s = t.style
    const size = s.fontSize
    const lh = s.lineHeight
    const lineH = lh === null ? size * 1.25 : "px" in lh ? lh.px : lh.multiplier * size
    const glyph = size * 0.5 + s.letterSpacing
    const text = t.runs.map((r) => r.text).join("")
    const lines: number[] = []
    for (const para of text.split("\n")) {
      if (maxWidth === undefined) {
        lines.push([...para].length * glyph)
        continue
      }
      let line = ""
      for (const word of para.split(" ")) {
        const next = line ? `${line} ${word}` : word
        if (line && [...next].length * glyph > maxWidth + 0.01) {
          lines.push([...line].length * glyph)
          line = word
        } else line = next
      }
      lines.push([...line].length * glyph)
    }
    return {
      w: Math.max(0, ...lines),
      h: lines.length * lineH,
      lines: lines.length,
      baseline: size * 0.8,
    }
  },
}

/** A star-ish square glyph for every icon (stroke sets get a stroke path). */
export const fakeIcons: IconLookup = {
  get(set, name) {
    if (!name) return null
    const stroke = set === "lucide" || set === "feather"
    return {
      viewBox: [0, 0, 24, 24],
      paths: [{ d: "M4 4H20V20H4Z", paint: stroke ? "stroke" : "fill" }],
      ...(stroke ? { strokeWidth: 2 } : {}),
    }
  },
}

/** Compares (or writes) a golden file; returns null when equal, else a short diff message. */
export function golden(rel: string, actual: string | Uint8Array): string | null {
  const path = join(GOLDEN_DIR, rel)
  const bytes = typeof actual === "string" ? Buffer.from(actual) : Buffer.from(actual)
  if (process.env.UPDATE_GOLDENS || !existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, bytes)
    return null
  }
  const want = readFileSync(path)
  if (Buffer.compare(want, bytes) === 0) return null
  if (typeof actual !== "string")
    return `${rel}: ${bytes.length} bytes ≠ golden ${want.length} bytes`
  const a = actual.split("\n")
  const b = want.toString("utf8").split("\n")
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    if (a[i] !== b[i]) return `${rel}:${i + 1}\n  golden: ${b[i]}\n  actual: ${a[i]}`
  return `${rel}: differs`
}
