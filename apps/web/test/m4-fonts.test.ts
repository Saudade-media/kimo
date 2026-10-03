/**
 * Board 19 fonts (builder 4): resolution order + BLOCKED through the real memory platform,
 * missing-font detection and dialog copy, replace ops (one undo step), picker filtering,
 * document font assets, and the once-per-file-per-session rule.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createDocStore, createEmptyDocument } from "@kimo/editor-state"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { createElement as h } from "react"
import { renderToString } from "react-dom/server"
import {
  claimMissingFontsDialog,
  createFontSystem,
  FontPicker,
  filterFontEntries,
  isFontAsset,
  loadDocumentFontFaces,
  MissingFontsDialog,
  missingFontsTitle,
  offlineNote,
  parseFontFileName,
  replaceChoices,
  replaceFontOps,
  replaceLabel,
  resetMissingFontsSession,
  searchPlaceholder,
  suggestReplacement,
} from "../src/fonts"

const fontsDir = join(import.meta.dir, "../../../packages/renderer/assets/fonts")
const inter = new Uint8Array(readFileSync(join(fontsDir, "Inter-Regular.ttf")))
const CSS = `@font-face { font-family: 'Lora'; font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/s/lora/400.ttf) format('truetype'); }`

const doc = {
  nodes: {
    tx00000001: { type: "text", content: "a", style: { font: "Söhne", weight: 400 } },
    tx00000002: { type: "text", content: "b", style: { font: "Söhne", weight: 600 } },
    tx00000003: { type: "text", content: "c", style: { font: "GT America Mono", weight: 400 } },
    tx00000004: { type: "text", content: "d", style: { font: "Inter", weight: 700 } },
    tx00000005: { type: "text", content: "e", style: { font: { $ref: "display" } } },
    tx00000006: { type: "text", content: [{ text: "x", style: { font: "Söhne" } }] },
  },
  variables: { display: { type: "string", value: "Söhne" } },
}

/** A memory platform whose remote fetch serves the Lora CSS + bytes (and records calls). */
function platformWithGoogle(settings: Record<string, unknown> = {}) {
  const p = createMemoryPlatform({ settings })
  const real = p.fonts.fetchRemote.bind(p.fonts)
  const fetched: string[] = []
  ;(p.fonts as { fetchRemote: (u: string) => Promise<Uint8Array> }).fetchRemote = async (url) => {
    await real(url) // enforces BLOCKED + allowlist exactly like the platform
    fetched.push(url)
    if (url.includes("css2") && url.includes("family=Lora")) return new TextEncoder().encode(CSS)
    if (url.includes("css2")) throw new Error("400")
    return inter
  }
  return { p, fetched }
}

describe("font system over @kimo/platform (memory)", () => {
  test("Document → Local → Cache → Google order", async () => {
    const { p } = platformWithGoogle()
    p.control.setLocalFonts(
      [
        {
          family: "Lora",
          styles: [{ postscriptName: "Lora-Local", fullName: "Lora", weight: 400, italic: false }],
        },
      ],
      { "Lora-Local": inter },
    )
    const sys = createFontSystem({
      platform: p,
      online: () => true,
      documentFaces: () => [
        { family: "Fraunces", weight: 600, style: "normal", load: async () => inter },
      ],
    })
    expect(sys.sources.map((s) => s.name)).toEqual(["document", "local", "cache", "google-fonts"])
    expect(await sys.availability({ family: "Fraunces", weight: 600, style: "normal" })).toBe(
      "document",
    )
    expect(await sys.availability({ family: "Lora", weight: 400, style: "normal" })).toBe("local")
    expect(await sys.availability({ family: "Inter", weight: 400, style: "normal" })).toBe(
      "bundled",
    )
    sys.dispose()
  })

  test("Google fetch → cache → offline renders from cache with no request", async () => {
    const { p, fetched } = platformWithGoogle()
    const sys = createFontSystem({ platform: p, online: () => true })
    expect(await sys.fetchFamily("Lora", [400])).toBe(true)
    expect(fetched.some((u) => u.startsWith("https://fonts.gstatic.com/"))).toBe(true)
    expect((await p.fonts.cache.list()).map((e) => [e.family, e.source])).toEqual([
      ["Lora", "google"],
    ])
    const n = fetched.length
    const offline = createFontSystem({ platform: p, online: () => false })
    expect(offline.offline()).toBe(true)
    expect(await offline.availability({ family: "Lora", weight: 700, style: "normal" })).toBe(
      "cached",
    )
    const r = await offline.sources[2]?.fetch({ family: "Lora", weight: 400, style: "normal" })
    expect(r?.bytes.byteLength).toBe(inter.byteLength)
    expect(fetched.length).toBe(n)
  })

  test("BLOCKED: No third-party fetch → zero remote requests, offline() true, live toggle", async () => {
    const { p, fetched } = platformWithGoogle({ "privacy.noThirdPartyFetch": true })
    await p.settings.ready
    const sys = createFontSystem({ platform: p, online: () => true })
    let changes = 0
    sys.subscribe(() => changes++)
    expect(sys.offline()).toBe(true)
    expect(await sys.fetchFamily("Lora", [400])).toBe(false)
    expect(await sys.sources[3]?.fetch({ family: "Lora", weight: 400, style: "normal" })).toBeNull()
    expect(await sys.availability({ family: "Lora", weight: 400, style: "normal" })).toBe("missing")
    expect(fetched).toEqual([])
    // The platform itself refuses too.
    await expect(
      p.fonts.fetchRemote("https://fonts.googleapis.com/css2?family=Lora"),
    ).rejects.toMatchObject({ code: "BLOCKED" })
    await p.settings.set("privacy.noThirdPartyFetch", false)
    expect(changes).toBe(1)
    expect(sys.offline()).toBe(false)
    expect(await sys.fetchFamily("Lora", [400])).toBe(true)
    // Google Fonts off alone also blocks.
    await p.settings.set("fonts.google", false)
    expect(sys.googleAllowed()).toBe(false)
    sys.dispose()
  })

  test("host allowlist: a CSS pointing elsewhere is never fetched", async () => {
    const p = createMemoryPlatform()
    const urls: string[] = []
    ;(p.fonts as { fetchRemote: (u: string) => Promise<Uint8Array> }).fetchRemote = async (url) => {
      urls.push(url)
      return new TextEncoder().encode(
        `@font-face { font-family: 'Evil'; font-weight: 400; src: url(https://evil.example/f.ttf); }`,
      )
    }
    const sys = createFontSystem({ platform: p, online: () => true })
    expect(await sys.fetchFamily("Evil", [400])).toBe(false)
    expect(urls.every((u) => u.startsWith("https://fonts.googleapis.com/"))).toBe(true)
  })

  test("missing-font detection: missing vs offline (known Google family, not cached)", async () => {
    const { p } = platformWithGoogle()
    const sys = createFontSystem({ platform: p, online: () => true })
    // Learn that Lora is a Google family (CSS fetched), then go offline.
    expect(await sys.availability({ family: "Lora", weight: 400, style: "normal" })).toBe("google")
    const offline = { v: true }
    const sys2 = createFontSystem({ platform: p, online: () => !offline.v })
    const d = {
      nodes: { ...doc.nodes, l: { type: "text", style: { font: "Lora", weight: 500 } } },
      variables: doc.variables,
    }
    const missing = await sys2.missingFonts(d)
    // sys2 has a fresh memo, so Lora is unknown offline → missing; with sys (knows Lora) → offline.
    expect(missing.map((m) => m.family)).toEqual(["Söhne", "GT America Mono", "Lora"])
    p.settings.set("privacy.noThirdPartyFetch", true)
    const viaKnown = await sys.missingFonts(d)
    expect(viaKnown.find((m) => m.family === "Lora")?.status).toBe("offline")
    expect(viaKnown.find((m) => m.family === "Söhne")).toMatchObject({
      status: "missing",
      weights: [400, 600],
      nodeIds: ["tx00000001", "tx00000002", "tx00000005", "tx00000006"],
    })
  })
})

describe("replace fonts (one undoable edit)", () => {
  test("rewrites styles, spans and string variables; one undo restores all", () => {
    const store = createDocStore(createEmptyDocument("x"))
    const loaded = store.apply(
      [
        { op: "setHeader", set: { features: ["text/runs"] } },
        { op: "setVariables", set: { display: { type: "string", value: "Söhne" } } },
        ...Object.entries(doc.nodes).map(([id, node]) => ({
          op: "insert" as const,
          id,
          parent: null,
          node,
        })),
      ],
      { origin: "user" },
    )
    expect(loaded.ok).toBe(true)
    const before = JSON.stringify(store.toDocument())
    const ops = replaceFontOps(store.toDocument(), {
      Söhne: "Inter",
      "GT America Mono": "JetBrains Mono",
    })
    expect(ops.length).toBe(5) // 4 nodes + setVariables
    store.apply(ops, { origin: "user", label: "Replace 2 fonts" })
    const after = store.toDocument() as unknown as typeof doc
    expect(after.nodes.tx00000001.style.font).toBe("Inter")
    expect(after.nodes.tx00000003.style.font).toBe("JetBrains Mono")
    expect((after.nodes.tx00000006.content as { style: { font: string } }[])[0]?.style.font).toBe(
      "Inter",
    )
    expect(after.nodes.tx00000005.style.font).toEqual({ $ref: "display" }) // binding kept
    expect(after.variables.display.value).toBe("Inter")
    expect(after.nodes.tx00000004.style.font).toBe("Inter")
    store.undo("user")
    expect(JSON.stringify(store.toDocument())).toBe(before)
  })

  test("no-op mapping produces no ops; suggestions", () => {
    expect(replaceFontOps(doc, {})).toEqual([])
    expect(replaceFontOps(doc, { Nope: "Inter" })).toEqual([])
    expect(suggestReplacement("GT America Mono")).toBe("JetBrains Mono")
    expect(suggestReplacement("Söhne")).toBe("Inter")
  })
})

describe("missing fonts dialog + picker", () => {
  const fonts = [
    {
      family: "Söhne",
      weights: [400, 600],
      italic: false,
      nodeIds: Array.from({ length: 23 }, (_, i) => `n${i}`),
      status: "missing" as const,
      missingWeights: [400, 600],
    },
    {
      family: "GT America Mono",
      weights: [400],
      italic: false,
      nodeIds: Array.from({ length: 6 }, (_, i) => `m${i}`),
      status: "missing" as const,
      missingWeights: [400],
    },
    {
      family: "Space Grotesk",
      weights: [500],
      italic: false,
      nodeIds: ["a", "b", "c", "d"],
      status: "offline" as const,
      missingWeights: [500],
    },
  ]

  test("copy as designed (hQunF)", () => {
    expect(missingFontsTitle(3)).toBe("3 fonts aren't available")
    expect(missingFontsTitle(1)).toBe("1 font isn't available")
    expect(replaceLabel(2)).toBe("Replace 2 fonts")
    const html = renderToString(
      h(MissingFontsDialog, {
        fileName: "marketing.kimo",
        fonts,
        choices: [{ family: "Inter", meta: "local" }],
        canFetch: false,
        inline: true,
        onReplace: () => {},
        onKeep: () => {},
        onOpenFontsFolder: () => {},
      }),
    )
    for (const s of [
      "3 fonts aren&#x27;t available",
      "marketing.kimo uses fonts that aren&#x27;t installed or embedded.",
      "400 · 600  ·  used by 23 layers",
      "Replacing is one undoable edit",
      "Open fonts folder",
      "Keep for now",
      "Replace 2 fonts",
      "Not cached",
      "Fetch",
      "JetBrains Mono",
    ])
      expect(html).toContain(s)
  })

  test("picker filtering, Google typed family, notes", () => {
    const entries = [
      { family: "Inter", group: "document" as const, meta: "12 styles", available: true },
      { family: "Helvetica Neue", group: "local" as const, meta: "local", available: true },
      { family: "DM Sans", group: "google" as const, meta: "cached", available: true },
    ]
    expect(filterFontEntries(entries, "local", "", "online").map((e) => e.family)).toEqual([
      "Helvetica Neue",
    ])
    expect(filterFontEntries(entries, "all", "dm", "online").map((e) => e.family)).toEqual([
      "DM Sans",
    ])
    expect(filterFontEntries(entries, "all", "Lora", "online").at(-1)).toMatchObject({
      family: "Lora",
      meta: "not cached",
    })
    expect(filterFontEntries(entries, "all", "Lora", "blocked")).toEqual([])
    expect(searchPlaceholder(1642)).toBe("Search 1,642 fonts")
    expect(offlineNote(214)).toBe(
      "Offline — Google shows the 214 fonts already cached. Others download when you're back online.",
    )
    const html = renderToString(
      h(FontPicker, { value: "Inter", entries, google: "blocked", onPick: () => {}, inline: true }),
    )
    expect(html).toContain("IN THIS DOCUMENT")
    expect(html).toContain("ON THIS MAC")
    expect(html).toContain("GOOGLE FONTS")
    expect(html).toContain("No third-party fetch")
  })

  test("replace choices: bundled, local, cached Google", async () => {
    const p = createMemoryPlatform()
    p.control.setLocalFonts([{ family: "IBM Plex Sans", styles: [] }])
    await p.fonts.cache.put(
      { family: "DM Sans", weight: 400, italic: false, source: "google" },
      inter,
    )
    expect(await replaceChoices(p)).toEqual([
      { family: "Inter", meta: "local" },
      { family: "JetBrains Mono", meta: "local" },
      { family: "IBM Plex Sans", meta: "local" },
      { family: "DM Sans", meta: "google" },
    ])
  })

  test("dialog opens once per file per session", () => {
    resetMissingFontsSession()
    expect(claimMissingFontsDialog("/a.kimo")).toBe(true)
    expect(claimMissingFontsDialog("/a.kimo")).toBe(false)
    expect(claimMissingFontsDialog("/b.kimo")).toBe(true)
  })
})

describe("document font assets", () => {
  test("faces from TTF tables; WOFF2 falls back to the manifest name", async () => {
    const files: Record<string, Uint8Array> = {
      "0123456789abcdef.ttf": inter,
      "fedcba9876543210.woff2": new TextEncoder().encode("wOF2...."),
      "1111111111111111.png": new Uint8Array([0x89]),
    }
    const faces = await loadDocumentFontFaces(
      { "fedcba9876543210.woff2": { mime: "font/woff2", name: "Fraunces-SemiBoldItalic.woff2" } },
      Object.keys(files),
      async (k) => files[k] ?? null,
    )
    expect(faces.map((f) => [f.family, f.weight, f.style])).toEqual([
      ["Inter", 400, "normal"],
      ["Fraunces", 600, "italic"],
    ])
    expect(isFontAsset("a.otf")).toBe(true)
    expect(isFontAsset("a.png", "font/ttf")).toBe(true)
    expect(isFontAsset("a.png")).toBe(false)
    expect(parseFontFileName("GT-America-Mono-Regular.otf")).toMatchObject({
      family: "GT-America-Mono",
      weight: 400,
    })
    expect(parseFontFileName("Inter.ttf")).toMatchObject({
      family: "Inter",
      weight: 400,
      style: "normal",
    })
  })
})
