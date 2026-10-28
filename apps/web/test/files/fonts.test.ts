/**
 * Fonts: how a family is resolved (document, local, cache, Google) and when nothing leaves the
 * machine, missing-font detection and replacing fonts, fonts stored in the .kimo and listed in its
 * manifest, the offline font pack, and fonts embedded in .kimoz packages.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parse, validate } from "@kimo/core-schema"
import { createDocStore, createEmptyDocument } from "@kimo/editor-state"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { fontAssetName, fontFamilyKey, parseFontFileName } from "@kimo/renderer"
import { createFontSystem, loadDocumentFontFaces } from "../../src/fonts"
import {
  FONT_PACK_FAMILIES,
  FONT_PACK_WEIGHTS,
  fontPackController,
  packFacesFromCss,
} from "../../src/fonts/font-pack"
import { replaceFontOps } from "../../src/fonts/replace-fonts"
import { storeFontAsset, withFontManifest } from "../../src/fonts/store-font-asset"
import { contentHash, MAX_ASSET_BYTES } from "../../src/lib/assets"
import { exportFile } from "../../src/lib/files"
import { readZip } from "../../src/lib/zip"
import { edit, FILE, waitFor } from "../session-helpers"
import { fastSetup } from "./helpers"

const fontsDir = join(import.meta.dir, "../../../../packages/renderer/assets/fonts")
const inter = new Uint8Array(readFileSync(join(fontsDir, "Inter-Regular.ttf")))
const CSS = `@font-face { font-family: 'Lora'; font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/s/lora/400.ttf) format('truetype'); }`

/** A WOFF2-looking file (magic only: the bytes are never decoded here). */
const woff2 = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])

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

describe("font resolution", () => {
  test("Document, then Local, then Cache, then Google", async () => {
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
    expect(await sys.availability({ family: "Fraunces", weight: 600, style: "normal" })).toBe(
      "document",
    )
    expect(await sys.availability({ family: "Lora", weight: 400, style: "normal" })).toBe("local")
    expect(await sys.availability({ family: "Inter", weight: 400, style: "normal" })).toBe(
      "bundled",
    )
    sys.dispose()
  })

  test("a Google font is fetched once, cached, and renders offline from the cache with no request", async () => {
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
    const r = await offline.sources[3]?.fetch({ family: "Lora", weight: 400, style: "normal" })
    expect(r?.bytes.byteLength).toBe(inter.byteLength)
    expect(fetched.length).toBe(n)
  })

  test("No third-party fetch: zero remote requests, and the setting applies live", async () => {
    const { p, fetched } = platformWithGoogle({ "privacy.noThirdPartyFetch": true })
    await p.settings.ready
    const sys = createFontSystem({ platform: p, online: () => true })
    let changes = 0
    sys.subscribe(() => changes++)
    expect(sys.offline()).toBe(true)
    expect(await sys.fetchFamily("Lora", [400])).toBe(false)
    expect(await sys.sources[4]?.fetch({ family: "Lora", weight: 400, style: "normal" })).toBeNull()
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

  test("a CSS that points at another host is never followed", async () => {
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

  test("missing fonts are told apart from fonts that are only unreachable offline", async () => {
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

describe("replace fonts", () => {
  test("rewrites styles, spans and string variables in one undo step; a no-op mapping makes no ops", () => {
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
    expect(replaceFontOps(doc, {})).toEqual([])
    expect(replaceFontOps(doc, { Nope: "Inter" })).toEqual([])
  })
})

describe("fonts stored in the document", () => {
  const face = { family: "Space Grotesk", weight: 600, style: "normal" as const }

  /** In-memory asset store with the AssetStore surface storeFontAsset uses. */
  function memoryAssets() {
    const rows = new Map<string, { mime: string; bytes: number; name?: string }>()
    return {
      rows,
      async putKey(key: string, bytes: Uint8Array, entry: { mime?: string; name?: string } = {}) {
        if (!rows.has(key))
          rows.set(key, {
            mime: entry.mime ?? "application/octet-stream",
            bytes: bytes.byteLength,
            ...(entry.name ? { name: entry.name } : {}),
          })
        const r = rows.get(key) as { mime: string; bytes: number; name?: string }
        return { src: `./assets/${key}`, ...r }
      },
      async info(src: string) {
        const r = rows.get(src.replace("./assets/", ""))
        return r ? { src, ...r } : null
      },
    }
  }

  const text = (font: string) => ({
    type: "text",
    parent: null,
    order: "a5",
    name: "T",
    content: "x",
    style: { font, size: 20 },
  })
  const fontFile = async () => {
    const key = `${await contentHash(woff2)}.woff2`
    return {
      key,
      family: "Space Grotesk",
      entry: { mime: "font/woff2", bytes: woff2.byteLength, name: "Space Grotesk-SemiBold.woff2" },
    }
  }

  test("file names carry the face and the parser reads them back", () => {
    expect(fontAssetName("Space Grotesk", 600, "normal", "woff2")).toBe(
      "Space Grotesk-SemiBold.woff2",
    )
    expect(fontAssetName("Lora", 700, "italic", "ttf")).toBe("Lora-BoldItalic.ttf")
    expect(parseFontFileName("Space Grotesk-SemiBold.woff2")).toEqual({
      family: "Space Grotesk",
      weight: 600,
      style: "normal",
    })
    expect(parseFontFileName("Lora-BoldItalic.ttf")).toEqual({
      family: "Lora",
      weight: 700,
      style: "italic",
    })
    // "McLaren" splits to "Mc Laren" but still matches by key.
    expect(fontFamilyKey(parseFontFileName("McLaren-Regular.woff2")?.family ?? "")).toBe(
      fontFamilyKey("McLaren"),
    )
  })

  test("storing writes the file only: the document and its history are untouched", async () => {
    const store = createDocStore()
    store.loadDocument({ ...createEmptyDocument(), assets: {} } as never)
    const rev = store.revision.seq
    const assets = memoryAssets()
    const f = await storeFontAsset(face, woff2, assets)
    const key = `${await contentHash(woff2)}.woff2`
    expect(f).toEqual({
      key,
      family: "Space Grotesk",
      entry: { mime: "font/woff2", bytes: woff2.byteLength, name: "Space Grotesk-SemiBold.woff2" },
    })
    expect(assets.rows.get(key)?.name).toBe("Space Grotesk-SemiBold.woff2")
    expect(store.revision.seq).toBe(rev)
    expect(store.toHeader().assets).toEqual({})
    expect(store.canUndo("user")).toBe(false)
  })

  test("over 20 MB, not a font, or a bundled family: skipped", async () => {
    const big = new Uint8Array(MAX_ASSET_BYTES + 1)
    big.set([0x77, 0x4f, 0x46, 0x32])
    expect(await storeFontAsset(face, big, memoryAssets())).toBeNull()
    expect(await storeFontAsset(face, new Uint8Array(20), memoryAssets())).toBeNull()
    // Bundled with Kimo: never stored in the file.
    const bundled = { family: "Inter", weight: 800, style: "normal" as const }
    expect(await storeFontAsset(bundled, woff2, memoryAssets())).toBeNull()
  })

  test("a document with a manifest lists the fonts its text uses, idempotently, and still validates", async () => {
    const f = await fontFile()
    const base = createEmptyDocument()
    const withManifest = {
      ...base,
      assets: {},
      nodes: { ...base.nodes, Txt0000001: text("Space Grotesk") },
    }
    const out = withFontManifest(withManifest, [f], () => null)
    expect(out.assets).toEqual({ [f.key]: f.entry })
    expect(withFontManifest(out, [f], () => null)).toBe(out)
    // An unused family is not listed; nothing to add returns the document itself.
    const other = { ...base, assets: {}, nodes: { ...base.nodes, Txt0000001: text("Lora") } }
    expect(withFontManifest(other, [f], () => null)).toBe(other)
    // The written file validates clean (font entries are not ASSET_UNUSED).
    const v = validate(parse(JSON.stringify(out)))
    expect(v.errors).toEqual([])
    expect(v.warnings.map((w) => w.code)).not.toContain("ASSET_UNUSED")
  })

  test("a document without a manifest gets one only when every referenced asset is known", async () => {
    const f = await fontFile()
    const img = "0123456789abcdef.png"
    const base = createEmptyDocument()
    const noManifest = {
      ...base,
      nodes: {
        ...base.nodes,
        Txt0000001: text("Space Grotesk"),
        RectImg001: {
          type: "rect",
          parent: null,
          order: "a6",
          w: 10,
          h: 10,
          fill: { kind: "image", src: `./assets/${img}` },
        },
      },
    }
    const known = withFontManifest(noManifest, [f], (k) =>
      k === img ? { mime: "image/png", bytes: 10 } : null,
    )
    expect(Object.keys(known.assets ?? {}).sort()).toEqual([img, f.key].sort())
    expect(validate(parse(JSON.stringify(known))).errors).toEqual([])
    expect(withFontManifest(noManifest, [f], () => null)).toBe(noManifest)
    // An empty manifest is no manifest: the font alone would leave the image unlisted.
    const empty = { ...noManifest, assets: {} }
    expect(withFontManifest(empty, [f], () => null)).toBe(empty)
    // A manifest that misses a reference gets its known entry with the font.
    const partial = { ...noManifest, assets: { "0000000000000000.png": { mime: "image/png" } } }
    const filled = withFontManifest(partial, [f], (k) =>
      k === img ? { mime: "image/png", bytes: 10 } : null,
    )
    expect(Object.keys(filled.assets ?? {}).sort()).toEqual(
      ["0000000000000000.png", img, f.key].sort(),
    )
  })

  test("faces are read from TTF tables, or from the manifest name for WOFF2, and win over other sources", async () => {
    const key = "fedcba9876543210.woff2"
    const files: Record<string, Uint8Array> = {
      "0123456789abcdef.ttf": inter,
      [key]: woff2,
      "1111111111111111.png": new Uint8Array([0x89]),
    }
    const faces = await loadDocumentFontFaces(
      { [key]: { mime: "font/woff2", name: "Space Grotesk-SemiBold.woff2" } },
      Object.keys(files),
      async (k) => files[k] ?? null,
    )
    expect(faces.map((f) => [f.family, f.weight, f.style])).toEqual([
      ["Inter", 400, "normal"],
      ["Space Grotesk", 600, "normal"],
    ])
    // …and the document resolves them first, even when it spells the family without the space.
    const sys = createFontSystem({
      platform: createMemoryPlatform(),
      online: () => false,
      documentFaces: () => faces,
    })
    expect(await sys.availability({ family: "SpaceGrotesk", weight: 600, style: "normal" })).toBe(
      "document",
    )
  })

  test("the manifest is written on save, never edited live", async () => {
    const { platform, manager } = await fastSetup()
    const s = await manager.open(FILE)
    const f = await fontFile()
    s.prepareWrite = (d) => withFontManifest(d, [f], () => null)
    // Opening does not write or dirty the file.
    expect(s.provider?.dirty).toBe(false)
    const r = s.store.apply(
      {
        op: "insert",
        id: "Txt0000001",
        node: { type: "text", name: "T", content: "x", style: { font: "Space Grotesk" } },
      },
      { origin: "user" },
    )
    expect(r.ok).toBe(true)
    edit(s.store, "Rect000002")
    await waitFor(() => !!s.provider && !s.provider.dirty && s.provider.writingSince === null)
    const written = JSON.parse(platform.control.readFile(FILE) as string)
    expect(written.assets).toEqual({ [f.key]: f.entry })
    // The live document never got the entry; undo only undoes the user's edits.
    expect(s.store.toHeader().assets).toBeUndefined()
    s.store.undo("user")
    expect(s.store.hasNode("Rect000002")).toBe(false)
    // Saving again with nothing new writes nothing (idempotent).
    s.store.redo("user")
    await s.save()
    const again = platform.control.readFile(FILE)
    await s.save()
    expect(platform.control.readFile(FILE)).toBe(again)
    await s.close()
    // Reopening shows the entry.
    const s2 = await manager.open(FILE)
    expect(Object.keys(s2.store.toHeader().assets ?? {})).toEqual([f.key])
    await s2.close()
  })
})

describe("offline font pack", () => {
  const packCss = (family: string) =>
    [400, 500, 600, 700, 800]
      .flatMap((w) => [
        `/* cyrillic */\n@font-face { font-family: '${family}'; font-style: normal; font-weight: ${w}; src: url(https://fonts.gstatic.com/s/${encodeURIComponent(family)}/${w}-cyr.woff2) format('woff2'); }`,
        `/* latin */\n@font-face { font-family: '${family}'; font-style: normal; font-weight: ${w}; src: url(https://fonts.gstatic.com/s/${encodeURIComponent(family)}/${w}-latin.woff2) format('woff2'); }`,
        `/* latin */\n@font-face { font-family: '${family}'; font-style: italic; font-weight: ${w}; src: url(https://fonts.gstatic.com/s/${encodeURIComponent(family)}/${w}-i.woff2) format('woff2'); }`,
      ])
      .join("\n")

  function packPlatform(settings: Record<string, unknown> = {}) {
    const p = createMemoryPlatform({ settings })
    const real = p.fonts.fetchRemote.bind(p.fonts)
    const fetched: string[] = []
    ;(p.fonts as { fetchRemote: (u: string) => Promise<Uint8Array> }).fetchRemote = async (url) => {
      await real(url)
      fetched.push(url)
      if (url.includes("css2")) {
        const fam = decodeURIComponent(/family=([^:&]+)/.exec(url)?.[1] ?? "").replace(/\+/g, " ")
        return new TextEncoder().encode(packCss(fam))
      }
      // Distinct bytes per face (content-addressed store).
      return new TextEncoder().encode(`face ${url}`)
    }
    return { p, fetched }
  }

  test("the plan keeps the upright latin faces of the pack weights and drops other hosts", () => {
    const plan = packFacesFromCss("Lora", packCss("Lora"))
    expect(plan.map((f) => f.weight)).toEqual([...FONT_PACK_WEIGHTS])
    expect(plan.every((f) => f.url.endsWith("-latin.woff2"))).toBe(true)
    // Desktop CSS (no subsets): the single file is the face; other hosts are dropped.
    const ttf = packFacesFromCss(
      "Lato",
      "@font-face { font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/l.ttf) }\n@font-face { font-style: normal; font-weight: 700; src: url(https://evil.example/l.ttf) }",
    )
    expect(ttf).toEqual([{ family: "Lato", weight: 400, url: "https://fonts.gstatic.com/l.ttf" }])
  })

  test("download, resolve offline through the pack, remove", async () => {
    const { p, fetched } = packPlatform()
    const pack = fontPackController(p)
    await pack.refresh()
    expect(pack.state().status).toBe("empty")
    await pack.download()
    const s = pack.state()
    expect(s.status).toBe("ready")
    if (s.status !== "ready") throw new Error("not ready")
    expect(s.families).toBe(FONT_PACK_FAMILIES.length)
    expect(s.faces).toBe(FONT_PACK_FAMILIES.length * FONT_PACK_WEIGHTS.length)
    // A font system resolves the pack with no network and no Google requests.
    const n = fetched.length
    const sys = createFontSystem({ platform: p, online: () => false })
    expect(await sys.availability({ family: "Lora", weight: 600, style: "normal" })).toBe("cached")
    const src = sys.sources.find((x) => x.name === "pack")
    expect(await src?.fetch({ family: "Lora", weight: 600, style: "normal" })).toMatchObject({
      weight: 600,
    })
    expect(fetched.length).toBe(n)
    // Download again: everything is there, only the CSS is read.
    await pack.download()
    expect(fetched.length).toBe(n + FONT_PACK_FAMILIES.length)
    await pack.remove()
    expect(pack.state().status).toBe("empty")
    expect(await p.fonts.pack.list()).toEqual([])
  })

  test("No third-party fetch: the pack is not allowed and makes zero requests", async () => {
    const { p, fetched } = packPlatform({ "privacy.noThirdPartyFetch": true })
    const pack = fontPackController(p)
    await pack.refresh()
    expect(pack.allowed()).toBe(false)
    await pack.download()
    expect(fetched).toEqual([])
    expect(pack.state().status).toBe("error")
  })
})

describe("fonts in .kimoz packages", () => {
  /** fsType 2 (restricted license): the OS/2 table's fsType field set on a copy of Inter. */
  const restricted = (() => {
    const b = new Uint8Array(inter)
    const v = new DataView(b.buffer)
    const n = v.getUint16(4)
    for (let i = 0; i < n; i++) {
      const rec = 12 + i * 16
      const tag = String.fromCharCode(...b.slice(rec, rec + 4))
      if (tag === "OS/2") v.setUint16(v.getUint32(rec + 8) + 8, 2)
    }
    return b
  })()
  const assetsOf = (fonts: Record<string, Uint8Array>) => {
    const bytes: Record<string, Uint8Array> = {
      "0123456789abcdef.png": new Uint8Array([1, 2, 3]),
      ...fonts,
    }
    return {
      bytes: async (k: string) => bytes[k] ?? null,
      info: async (src: string) => {
        const k = src.replace("./assets/", "")
        return bytes[k]
          ? { src, mime: k.endsWith(".png") ? "image/png" : "font/ttf", bytes: bytes[k].length }
          : null
      },
    }
  }
  const store = () => {
    const d = createEmptyDocument("Pkg") as Record<string, unknown> & {
      nodes: Record<string, unknown>
    }
    d.nodes.Rect000001 = {
      type: "rect",
      parent: null,
      order: "a0",
      w: 10,
      h: 10,
      fill: { kind: "image", src: "./assets/0123456789abcdef.png" },
    }
    return createDocStore(d as never)
  }
  const withFonts = (d: Record<string, unknown>) => ({
    ...d,
    assets: {
      "0123456789abcdef.png": { mime: "image/png", bytes: 3 },
      "fedcba9876543210.ttf": { mime: "font/ttf", bytes: 10, name: "A-Regular.ttf" },
    },
  })
  const packageNames = async (fonts: Record<string, Uint8Array>, embedFonts: boolean) => {
    const f = await exportFile(
      store(),
      "Pkg",
      assetsOf(fonts) as never,
      withFonts as never,
      embedFonts,
    )
    return (await readZip(new Uint8Array(await f.data.arrayBuffer()))).map((e) => e.name)
  }

  test("an installable font goes in the package when embedding is on, and none when it is off", async () => {
    const ttf = { "fedcba9876543210.ttf": inter }
    expect(await packageNames(ttf, true)).toContain("assets/fedcba9876543210.ttf")
    expect(await packageNames(ttf, false)).not.toContain("assets/fedcba9876543210.ttf")
  })

  test("a font whose license forbids embedding is left out", async () => {
    const names = await packageNames({ "fedcba9876543210.ttf": restricted }, true)
    expect(names).not.toContain("assets/fedcba9876543210.ttf")
    expect(names).toContain("assets/0123456789abcdef.png")
  })
})
