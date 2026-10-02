import { beforeAll, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { TEXT_STYLE_DEFAULTS } from "@kimo/layout"
import { CanvasKitRenderer, type FontFaceKey, type FontSource, googleFontsSource } from "../src"
import { nearestFace, parseFontFaceCss } from "../src/fonts"

const monoBytes = new Uint8Array(
  readFileSync(join(import.meta.dir, "../assets/fonts/JetBrainsMono-Regular.ttf")),
)

function fakeSource(name: string, family: string, weights: number[], network = false) {
  const calls: FontFaceKey[] = []
  const src: FontSource & { network?: boolean } = {
    name,
    network,
    async fetch(key) {
      calls.push(key)
      if (key.family !== family) return null
      const w = nearestFace(
        weights.map((weight) => ({ weight, style: "normal" as const })),
        key.weight,
        key.style,
      )
      return w ? { bytes: monoBytes, weight: w.weight, style: "normal" } : null
    },
  }
  return { src, calls }
}

describe("FontProvider", () => {
  test("bundled faces are available after init; fallback is Inter", async () => {
    const r = new CanvasKitRenderer()
    await r.init({ offlineFonts: true })
    expect(r.fonts.fallbackFamily).toBe("Inter")
    expect(r.fonts.has("Inter", 400, "normal")).toBe(true)
    expect(r.fonts.has("Inter", 300, "normal")).toBe(true) // nearest bundled weight
    expect(r.fonts.has("JetBrains Mono", 500, "normal")).toBe(true)
    expect(r.fonts.has("Roboto", 400, "normal")).toBe(false)
    const res = await r.fonts.ensureFont("Inter", 600, "normal")
    expect(res).toMatchObject({ loaded: true, resolved: { family: "Inter", weight: 600 } })
  })

  test("sources in order, nearest weight, dedup, onFontLoaded, no refetch", async () => {
    const a = fakeSource("cache", "Nope", [])
    const b = fakeSource("net", "Testo", [400, 700], true)
    const r = new CanvasKitRenderer()
    await r.init({ fontSources: [a.src, b.src] })
    const loaded: FontFaceKey[] = []
    r.fonts.onFontLoaded((k) => loaded.push(k))
    const [x, y] = await Promise.all([
      r.fonts.ensureFont("Testo", 600, "normal"),
      r.fonts.ensureFont("Testo", 600, "normal"),
    ])
    expect(x).toEqual(y)
    expect(x).toMatchObject({
      loaded: true,
      resolved: { family: "Testo", weight: 700 },
      source: "net",
    })
    expect(a.calls.length).toBe(1)
    expect(b.calls.length).toBe(1)
    expect(loaded).toEqual([{ family: "Testo", weight: 700, style: "normal" }])
    expect(r.fonts.has("Testo", 600, "normal")).toBe(true)
    await r.fonts.ensureFont("Testo", 600, "normal")
    expect(b.calls.length).toBe(1)
  })

  test("offlineFonts skips network sources; missing family falls back and is not retried", async () => {
    const b = fakeSource("net", "Testo", [400], true)
    const r = new CanvasKitRenderer()
    await r.init({ fontSources: [b.src], offlineFonts: true })
    const res = await r.fonts.ensureFont("Testo", 400, "normal")
    expect(res).toMatchObject({ loaded: false, resolved: { family: "Inter", weight: 400 } })
    expect(b.calls.length).toBe(0)
    await r.fonts.ensureFont("Testo", 700, "normal")
    expect(b.calls.length).toBe(0)
  })

  test("register() makes a face measurable immediately", async () => {
    const r = new CanvasKitRenderer()
    await r.init({ offlineFonts: true })
    const style = { ...TEXT_STYLE_DEFAULTS, fontFamily: "Monoish", fontSize: 10 }
    const input = { nodeId: "t00000", runs: [{ text: "iiii", style }], style }
    const before = r.textMeasurer().measure(input, undefined).w // Inter fallback: narrow i
    r.fonts.register(monoBytes, { family: "Monoish", weight: 400, style: "normal" })
    const after = r.textMeasurer().measure(input, undefined).w // monospace: 4 × 6 = 24
    expect(after).toBeCloseTo(24, 0)
    expect(after).toBeGreaterThan(before)
  })
})

describe("text measurement (ADR 0009 facts)", () => {
  let r: CanvasKitRenderer
  beforeAll(async () => {
    r = new CanvasKitRenderer()
    await r.init({ offlineFonts: true })
  })
  test("Inter 13px 'Hello Kimo canvas' ≈ 113.66 × 16", () => {
    const style = { ...TEXT_STYLE_DEFAULTS, fontSize: 13 }
    const m = r
      .textMeasurer()
      .measure({ nodeId: "t00001", runs: [{ text: "Hello Kimo canvas", style }], style }, undefined)
    expect(m.w).toBeCloseTo(113.66, 1)
    expect(m.h).toBeCloseTo(16, 0)
    expect(m.lines).toBe(1)
    expect(m.baseline).toBeGreaterThan(10)
  })
  test("wrapping, line height multiplier and px", () => {
    const style = { ...TEXT_STYLE_DEFAULTS, fontSize: 10, lineHeight: { multiplier: 2 } }
    const input = {
      nodeId: "t00002",
      runs: [{ text: "one two three four five six", style }],
      style,
    }
    const m = r.textMeasurer().measure(input, 40)
    expect(m.lines).toBeGreaterThan(2)
    expect(m.h).toBeCloseTo((m.lines ?? 0) * 20, 0)
    expect(m.w).toBeLessThanOrEqual(40)
    const px = { ...style, lineHeight: { px: 30 } }
    const m2 = r
      .textMeasurer()
      .measure({ ...input, runs: [{ text: "a\nb", style: px }], style: px }, undefined)
    expect(m2.h).toBeCloseTo(60, 0)
  })
})

describe("Google Fonts source", () => {
  test("parses CSS2 responses (TTF and WOFF2 subsets)", () => {
    const css = `/* cyrillic */\n@font-face { font-family: 'X'; font-style: italic; font-weight: 700; src: url(https://a/c.woff2) format('woff2'); }\n/* latin */\n@font-face { font-family: 'X'; font-style: italic; font-weight: 700; src: url(https://a/l.woff2) format('woff2'); }\n@font-face { font-family: 'X'; font-style: normal; font-weight: 400; src: url(https://a/r.ttf) format('truetype'); }`
    expect(parseFontFaceCss(css)).toEqual([
      { weight: 700, style: "italic", url: "https://a/c.woff2", subset: "cyrillic" },
      { weight: 700, style: "italic", url: "https://a/l.woff2", subset: "latin" },
      { weight: 400, style: "normal", url: "https://a/r.ttf", subset: null },
    ])
  })
  test("requests all faces, falls back to the plain family, picks nearest + latin subset", async () => {
    const urls: string[] = []
    const fetchFn = (async (input: string | URL | Request) => {
      const u = String(input)
      urls.push(u)
      if (u.includes("ital,wght@")) return new Response("bad", { status: 400 })
      if (u.includes("css2"))
        return new Response(
          `/* latin-ext */ @font-face { font-style: normal; font-weight: 400; src: url(https://g/e.woff2) }\n/* latin */ @font-face { font-style: normal; font-weight: 400; src: url(https://g/l.woff2) }`,
        )
      return new Response(new Uint8Array([1, 2, 3]))
    }) as typeof fetch
    const src = googleFontsSource({ fetch: fetchFn })
    const res = await src.fetch({ family: "Abril Fatface", weight: 700, style: "normal" })
    expect(res).toEqual({ bytes: new Uint8Array([1, 2, 3]), weight: 400, style: "normal" })
    expect(urls[0]).toStartWith(
      "https://fonts.googleapis.com/css2?family=Abril+Fatface:ital,wght@0,100;",
    )
    expect(urls[1]).toBe("https://fonts.googleapis.com/css2?family=Abril+Fatface")
    expect(urls[2]).toBe("https://g/l.woff2")
    expect(src.name).toBe("google-fonts")
  })
})
