import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { TEXT_STYLE_DEFAULTS } from "@kimo/layout"
import {
  CanvasKitRenderer,
  collectFontUsage,
  createPlatformFontSources,
  detectMissingFonts,
  type FontFaceKey,
  type FontHost,
  type FontHostCacheEntry,
  type FontPolicy,
  type FontSource,
  fsEmbeddable,
  googleFontsSource,
  readFontInfo,
} from "../src"
import { nearestFace, parseFontFaceCss } from "../src/fonts"

const asset = (f: string) =>
  new Uint8Array(readFileSync(join(import.meta.dir, "../assets/fonts", f)))
const inter = asset("Inter-Regular.ttf")
const interBold = asset("Inter-Bold.ttf")
const interItalic = asset("Inter-Italic.ttf")
const mono = asset("JetBrainsMono-Regular.ttf")

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
      return w ? { bytes: mono, weight: w.weight, style: "normal" } : null
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
    r.fonts.register(mono, { family: "Monoish", weight: 400, style: "normal" })
    const after = r.textMeasurer().measure(input, undefined).w // monospace: 4 × 6 = 24
    expect(after).toBeCloseTo(24, 0)
    expect(after).toBeGreaterThan(before)
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
  test("falls back to the plain family when italics are refused; picks nearest face, latin subset", async () => {
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
    expect(urls.at(-1)).toBe("https://g/l.woff2")
    expect(urls.some((u) => u.endsWith("css2?family=Abril+Fatface"))).toBe(true)
  })
})

const CSS = `/* latin */
@font-face { font-family: 'Fraunces'; font-style: normal; font-weight: 600; src: url(https://fonts.gstatic.com/s/fraunces/600.ttf) format('truetype'); }
@font-face { font-family: 'Fraunces'; font-style: normal; font-weight: 700; src: url(https://fonts.gstatic.com/s/fraunces/700.ttf) format('truetype'); }`

class BlockedError extends Error {
  code = "BLOCKED"
}

/** In-memory host mirroring @kimo/platform memory semantics (BLOCKED when not allowed). */
function fakeHost(opts: { google?: Record<string, string> } = {}) {
  const calls: string[] = []
  const cache = new Map<string, { entry: FontHostCacheEntry; bytes: Uint8Array }>()
  const settings = { allowed: true }
  let n = 0
  const host: FontHost = {
    async listLocal() {
      calls.push("listLocal")
      return [
        {
          family: "Helvetica Neue",
          styles: [{ postscriptName: "HelveticaNeue", weight: 400, italic: false }],
        },
        {
          family: "Fraunces",
          styles: [{ postscriptName: "Fraunces-Local", weight: 400, italic: false }],
        },
      ]
    },
    async loadLocal(ps) {
      calls.push(`loadLocal ${ps}`)
      return mono
    },
    cache: {
      async get(key) {
        calls.push(`cache.get ${key}`)
        return cache.get(key)?.bytes ?? null
      },
      async put(e, bytes) {
        const key = `k${++n}`.padEnd(16, "0")
        const entry = { ...e, key }
        cache.set(key, { entry, bytes })
        calls.push(`cache.put ${e.family} ${e.weight}`)
        return entry
      },
      async list() {
        return [...cache.values()].map((c) => c.entry)
      },
    },
    async fetchRemote(url) {
      calls.push(
        `fetch ${url.replace(/\?.*/, "?…")}${url.includes("css2") ? ` ${/family=([^:]+)/.exec(url)?.[1]}` : ""}`,
      )
      if (!settings.allowed) throw new BlockedError("Remote fonts are off in Settings")
      if (url.includes("css2")) {
        const fam = /family=([^:]+)/.exec(url)?.[1]?.replace(/\+/g, " ") ?? ""
        const css = opts.google?.[fam]
        if (!css) throw new Error("400")
        return new TextEncoder().encode(css)
      }
      return url.endsWith("700.ttf") ? interBold : inter
    },
  }
  return { host, calls, cache, settings }
}

const policy = (p: { allowed: boolean; online?: boolean }): FontPolicy => ({
  googleAllowed: () => p.allowed,
  online: () => p.online ?? true,
})

describe("platform font sources: Document → Local → Cache → Google", () => {
  test("order: document beats local beats cache beats google", async () => {
    const h = fakeHost({ google: { Fraunces: CSS } })
    const fs = createPlatformFontSources({
      host: h.host,
      policy: policy({ allowed: true }),
      documentFaces: () => [
        { family: "Fraunces", weight: 600, style: "normal", load: async () => interBold },
      ],
    })
    expect(fs.sources.map((s) => s.name)).toEqual([
      "document",
      "local",
      "pack",
      "cache",
      "google-fonts",
    ])
    const key = { family: "Fraunces", weight: 600, style: "normal" as const }
    for (const s of fs.sources) {
      const r = await s.fetch(key)
      if (r) {
        expect(s.name).toBe("document")
        break
      }
    }
    expect(await fs.availability(key)).toBe("document")
    // Without the document face, the installed one wins over Google.
    const fs2 = createPlatformFontSources({ host: h.host, policy: policy({ allowed: true }) })
    expect(await fs2.availability(key)).toBe("local")
    expect(await fs2.sources[1]?.fetch(key)).toMatchObject({ weight: 400 })
    expect(h.calls).toContain("loadLocal Fraunces-Local")
    expect(h.calls.some((c) => c.startsWith("fetch"))).toBe(false)
  })

  test("google: fetched once through the host, cached, then served offline with no network", async () => {
    const h = fakeHost({ google: { Lora: CSS.replaceAll("Fraunces", "Lora") } })
    const fetched: string[] = []
    const fs = createPlatformFontSources({
      host: h.host,
      policy: policy({ allowed: true }),
      onRemoteFetched: (f) => fetched.push(`${f.family} ${f.weight}`),
    })
    const key = { family: "Lora", weight: 700, style: "normal" as const }
    expect(await fs.availability(key)).toBe("google")
    const google = fs.sources[4]
    const r = await google?.fetch(key)
    expect(r?.weight).toBe(700)
    expect(h.calls).toContain("cache.put Lora 700")
    expect(fetched).toEqual(["Lora 700"])
    // Offline now: the cache source serves it; the google source never touches the network.
    const before = h.calls.filter((c) => c.startsWith("fetch")).length
    const offline = createPlatformFontSources({
      host: h.host,
      policy: policy({ allowed: true, online: false }),
    })
    expect(await offline.availability(key)).toBe("cached")
    expect(await offline.sources[3]?.fetch(key)).toMatchObject({ weight: 700 })
    expect(await offline.sources[4]?.fetch(key)).toBeNull()
    expect(h.calls.filter((c) => c.startsWith("fetch")).length).toBe(before)
  })

  test("BLOCKED: no third-party fetch → zero remote requests; cached Google family is `offline`", async () => {
    const h = fakeHost({ google: { Lora: CSS.replaceAll("Fraunces", "Lora") } })
    const p = { allowed: true }
    const fs = createPlatformFontSources({ host: h.host, policy: policy(p) })
    await fs.sources[4]?.fetch({ family: "Lora", weight: 600, style: "normal" })
    const before = h.calls.filter((c) => c.startsWith("fetch")).length
    p.allowed = false
    h.settings.allowed = false
    fs.invalidate()
    expect(
      await fs.sources[4]?.fetch({ family: "Space Grotesk", weight: 500, style: "normal" }),
    ).toBeNull()
    // Cached 600 serves 700 by nearest weight.
    expect(await fs.availability({ family: "Lora", weight: 700, style: "normal" })).toBe("cached")
    expect(await fs.availability({ family: "Space Grotesk", weight: 500, style: "normal" })).toBe(
      "missing",
    )
    expect(h.calls.filter((c) => c.startsWith("fetch")).length).toBe(before)
  })
})

describe("missing-font detection", () => {
  const doc = {
    variables: {
      display: { type: "string", value: "Söhne" },
      h1: { type: "typography", value: { font: "GT America Mono", weight: 400 } },
    },
    nodes: {
      a: { type: "text", content: "x", style: { font: "Inter", weight: 600 } },
      b: { type: "text", content: "x", style: { font: { $ref: "display" }, weight: 600 } },
      c: {
        type: "text",
        content: [{ text: "x", style: { font: "Söhne", weight: 400 } }],
        style: { font: "Helvetica Neue" },
      },
      d: { type: "text", content: "x", style: { typography: { $ref: "h1" } } },
      e: {
        type: "instance",
        of: "c",
        overrides: { c: { style: { font: "Space Grotesk", weight: 500 } } },
      },
      f: { type: "rect", w: 10, h: 10 },
    },
  }

  test("collectFontUsage walks styles, spans, overrides and typography variables", () => {
    const u = collectFontUsage(doc)
    const by = Object.fromEntries(u.map((x) => [x.family, x]))
    expect(by.Söhne).toMatchObject({ weights: [400, 600], nodeIds: ["b", "c"] })
    expect(by["GT America Mono"]).toMatchObject({ weights: [400], nodeIds: ["d"] })
    expect(by["Space Grotesk"]).toMatchObject({ weights: [500], nodeIds: ["e"] })
    expect(by.Inter?.weights).toEqual([600])
    expect(u[0]?.family).toBe("Söhne") // most used first
  })

  test("detectMissingFonts: bundled/local/cached are fine; offline Google vs missing", async () => {
    const h = fakeHost()
    await h.host.cache.put(
      { family: "Space Grotesk", weight: 700, italic: true, source: "google" },
      inter,
    )
    const fs = createPlatformFontSources({ host: h.host, policy: policy({ allowed: false }) })
    // Space Grotesk is cached (italic only), so it is not reported; the others are missing.
    const missing = await detectMissingFonts(collectFontUsage(doc), fs.availability.bind(fs))
    expect(missing.map((m) => [m.family, m.status])).toEqual([
      ["Söhne", "missing"],
      ["GT America Mono", "missing"],
    ])
    const offlineDoc = { nodes: { x: { type: "text", style: { font: "Lora", weight: 500 } } } }
    await h.host.cache.put({ family: "Lora", weight: 400, italic: false, source: "google" }, inter)
    const fs2 = createPlatformFontSources({ host: h.host, policy: policy({ allowed: false }) })
    // Lora 500 → nearest cached 400 is available; the cache lookup is family-level.
    expect(
      await detectMissingFonts(collectFontUsage(offlineDoc), fs2.availability.bind(fs2)),
    ).toEqual([])
    const known = await fs2.knownGoogleFamilies()
    expect(known.has("lora")).toBe(true)
  })

  test("offline status when the Google family is known but no face is cached", async () => {
    const h = fakeHost({ google: { Lora: CSS.replaceAll("Fraunces", "Lora") } })
    const p = { allowed: true }
    const fs = createPlatformFontSources({ host: h.host, policy: policy(p) })
    expect(await fs.availability({ family: "Lora", weight: 400, style: "normal" })).toBe("google")
    p.allowed = false
    const res = await detectMissingFonts(
      [{ family: "Lora", weights: [400], italic: false, nodeIds: ["x"] }],
      fs.availability.bind(fs),
    )
    expect(res).toEqual([
      {
        family: "Lora",
        weights: [400],
        italic: false,
        nodeIds: ["x"],
        status: "offline",
        missingWeights: [400],
      },
    ])
  })
})

describe("font file info", () => {
  test("reads family / weight / style / fsType from bundled TTFs", async () => {
    expect(await readFontInfo(inter)).toMatchObject({
      family: "Inter",
      weight: 400,
      italic: false,
      format: "truetype",
    })
    expect(await readFontInfo(interBold)).toMatchObject({ family: "Inter", weight: 700 })
    expect(await readFontInfo(interItalic)).toMatchObject({ family: "Inter", italic: true })
    expect(await readFontInfo(mono)).toMatchObject({ family: "JetBrains Mono" })
  })

  test("garbage, truncated and WOFF2 inputs return null", async () => {
    expect(await readFontInfo(new Uint8Array([1, 2, 3]))).toBeNull()
    expect(await readFontInfo(inter.slice(0, 40))).toBeNull()
    expect(await readFontInfo(new TextEncoder().encode("wOF2xxxxxxxxxxxxxxxxxxxxx"))).toBeNull()
    expect(await readFontInfo(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull()
  })

  test("fsType embedding bits", () => {
    expect(fsEmbeddable(0)).toBe(true)
    expect(fsEmbeddable(2)).toBe(false)
    expect(fsEmbeddable(4)).toBe(true)
    expect(fsEmbeddable(8)).toBe(true)
    expect(fsEmbeddable(0x200)).toBe(false)
  })
})
