import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { deflateSync } from "node:zlib"
import { featureListTags, fontFeatureTags } from "../../src/fonts/font-features"
import { renderedWeight } from "../../src/fonts/missing-weight"

const FONTS = join(import.meta.dir, "../../../../packages/renderer/assets/fonts")
const inter = () => new Uint8Array(readFileSync(join(FONTS, "Inter-Regular.ttf")))

/** Same font, wrapped as a 1-face TrueType collection (table offsets shifted by the header). */
function asTtc(ttf: Uint8Array): Uint8Array {
  const out = new Uint8Array(16 + ttf.byteLength)
  const v = new DataView(out.buffer)
  out.set([0x74, 0x74, 0x63, 0x66]) // ttcf
  v.setUint32(4, 0x00010000)
  v.setUint32(8, 1)
  v.setUint32(12, 16)
  out.set(ttf, 16)
  const n = v.getUint16(16 + 4)
  for (let i = 0; i < n; i++) {
    const r = 16 + 12 + i * 16
    v.setUint32(r + 8, v.getUint32(r + 8) + 16)
  }
  return out
}

/** Same font as WOFF 1 with zlib-compressed tables. */
function asWoff(ttf: Uint8Array): Uint8Array {
  const src = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength)
  const n = src.getUint16(4)
  const tables: { tag: Uint8Array; data: Uint8Array; orig: number; sum: number }[] = []
  for (let i = 0; i < n; i++) {
    const r = 12 + i * 16
    const off = src.getUint32(r + 8)
    const len = src.getUint32(r + 12)
    const raw = ttf.subarray(off, off + len)
    const z = new Uint8Array(deflateSync(raw))
    tables.push({
      tag: ttf.subarray(r, r + 4),
      data: z.byteLength < len ? z : raw,
      orig: len,
      sum: src.getUint32(r + 4),
    })
  }
  let size = 44 + n * 20
  const offsets = tables.map((t) => {
    const o = size
    size += (t.data.byteLength + 3) & ~3
    return o
  })
  const out = new Uint8Array(size)
  const v = new DataView(out.buffer)
  out.set([0x77, 0x4f, 0x46, 0x46]) // wOFF
  v.setUint32(4, 0x00010000)
  v.setUint32(8, size)
  v.setUint16(12, n)
  for (const [i, t] of tables.entries()) {
    const r = 44 + i * 20
    out.set(t.tag, r)
    v.setUint32(r + 4, offsets[i] as number)
    v.setUint32(r + 8, t.data.byteLength)
    v.setUint32(r + 12, t.orig)
    v.setUint32(r + 16, t.sum)
    out.set(t.data, offsets[i] as number)
  }
  return out
}

describe("OpenType feature detection from font bytes", () => {
  test("reads GSUB and GPOS feature tags from a real TTF (bundled Inter)", async () => {
    const tags = await fontFeatureTags(inter())
    expect(tags).not.toBeNull()
    for (const t of ["calt", "frac", "tnum", "kern", "mark"]) expect(tags?.has(t)).toBe(true)
    // Not in the bundled Inter subset: the "not in font" case.
    for (const t of ["smcp", "ss02", "zero"]) expect(tags?.has(t)).toBe(false)
  })

  test("TTC (first face) and WOFF 1 give the same tags; WOFF 2 and garbage are unknown", async () => {
    const want = [...((await fontFeatureTags(inter())) ?? [])].sort()
    expect([...((await fontFeatureTags(asTtc(inter()))) ?? [])].sort()).toEqual(want)
    expect([...((await fontFeatureTags(asWoff(inter()))) ?? [])].sort()).toEqual(want)
    const woff2 = new Uint8Array(64)
    woff2.set([0x77, 0x4f, 0x46, 0x32])
    expect(await fontFeatureTags(woff2)).toBeNull()
    expect(await fontFeatureTags(new Uint8Array([1, 2, 3]))).toBeNull()
    // Truncated feature lists never read out of bounds.
    expect([...featureListTags(new Uint8Array(4))]).toEqual([])
  })
})

describe("missing font weights", () => {
  test("the rendered weight is the nearest installed face; the lighter one wins a tie", () => {
    expect(renderedWeight(700, [400, 600])).toBe(600)
    expect(renderedWeight(500, [400, 600])).toBe(400)
    expect(renderedWeight(300, [])).toBeNull()
  })
})
