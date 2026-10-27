/**
 * Board 28 "Fonts & offline": Google faces stored as asset files on first use and listed in the
 * manifest only when the file is written (name carries the face, the store untouched, 20 MB
 * limit, manifest created only when safe), the
 * offline font pack (plan from CSS, download/cancel/remove, blocked by No third-party fetch,
 * resolution through the pack), the blocked banner in the Missing fonts dialog, the settings row
 * states, and the Code tab honouring Export's Tailwind theme.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parse, validate } from "@kimo/core-schema"
import { createDocStore, createEmptyDocument } from "@kimo/editor-state"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { fontAssetName, fontFamilyKey, parseFontFileName } from "@kimo/renderer"
import { createElement as h } from "react"
import { renderToString } from "react-dom/server"
import { generateCode } from "../src/code-tab/generate"
import { DEFAULT_TOGGLES, readExportTailwind } from "../src/export/model"
import { createFontSystem, loadDocumentFontFaces, MissingFontsDialog } from "../src/fonts"
import {
  FONT_PACK_FAMILIES,
  FONT_PACK_WEIGHTS,
  fontPackController,
  packFacesFromCss,
} from "../src/fonts/font-pack"
import { BLOCKED_BANNER_TITLE } from "../src/fonts/MissingFontsDialog"
import { storeFontAsset, withFontManifest } from "../src/fonts/store-font-asset"
import { contentHash, MAX_ASSET_BYTES } from "../src/lib/assets"
import { fontPackDescription, fontPackProgressLabel } from "../src/settings/model"

/** A WOFF2-looking file (magic only: the bytes are never decoded here). */
const woff2 = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])

/** In-memory asset store with the AssetStore surface storeFontAsset uses. */
function memoryAssets(initial: Record<string, { mime: string; bytes: number }> = {}) {
  const rows = new Map<string, { mime: string; bytes: number; name?: string }>(
    Object.entries(initial),
  )
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

const face = { family: "Space Grotesk", weight: 600, style: "normal" as const }

describe("§1 store on first use (spec §12 rule 3)", () => {
  test("names carry the face; the parser reads them back (spaces kept)", () => {
    expect(fontAssetName("Space Grotesk", 600, "normal", "woff2")).toBe(
      "Space Grotesk-SemiBold.woff2",
    )
    expect(fontAssetName("Lora", 700, "italic", "ttf")).toBe("Lora-BoldItalic.ttf")
    expect(fontAssetName("Lora", 400, "italic", "ttf")).toBe("Lora-Italic.ttf")
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

  test("written with a manifest: font entries for the families the text uses, idempotent", async () => {
    const f = await fontFile()
    const base = createEmptyDocument()
    const doc = { ...base, assets: {}, nodes: { ...base.nodes, Txt0000001: text("Space Grotesk") } }
    const out = withFontManifest(doc, [f], () => null)
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

  test("written without a manifest: one only when every referenced asset is known", async () => {
    const f = await fontFile()
    const img = "0123456789abcdef.png"
    const base = createEmptyDocument()
    const doc = {
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
    const known = withFontManifest(doc, [f], (k) =>
      k === img ? { mime: "image/png", bytes: 10 } : null,
    )
    expect(Object.keys(known.assets ?? {}).sort()).toEqual([img, f.key].sort())
    expect(validate(parse(JSON.stringify(known))).errors).toEqual([])
    expect(withFontManifest(doc, [f], () => null)).toBe(doc)
    // An empty manifest is no manifest: the font alone would leave the image unlisted.
    const empty = { ...doc, assets: {} }
    expect(withFontManifest(empty, [f], () => null)).toBe(empty)
    // A manifest that misses a reference gets its known entry with the font.
    const partial = { ...doc, assets: { "0000000000000000.png": { mime: "image/png" } } }
    const filled = withFontManifest(partial, [f], (k) =>
      k === img ? { mime: "image/png", bytes: 10 } : null,
    )
    expect(Object.keys(filled.assets ?? {}).sort()).toEqual(
      ["0000000000000000.png", img, f.key].sort(),
    )
  })

  test("over 20 MB, not a font, or a bundled family: skipped", async () => {
    const big = new Uint8Array(MAX_ASSET_BYTES + 1)
    big.set([0x77, 0x4f, 0x46, 0x32])
    expect(await storeFontAsset(face, big, memoryAssets())).toBeNull()
    expect(await storeFontAsset(face, new Uint8Array(20), memoryAssets())).toBeNull()
    // Bundled with Kimo: never stored in the file.
    const inter = { family: "Inter", weight: 800, style: "normal" as const }
    expect(await storeFontAsset(inter, woff2, memoryAssets())).toBeNull()
  })

  test("the editor reads a stored WOFF2 back by its manifest name", async () => {
    const key = `${await contentHash(woff2)}.woff2`
    const faces = await loadDocumentFontFaces(
      { [key]: { mime: "font/woff2", name: "Space Grotesk-SemiBold.woff2" } },
      [key],
      async () => woff2,
    )
    expect(faces.map((f) => [f.family, f.weight, f.style])).toEqual([
      ["Space Grotesk", 600, "normal"],
    ])
    // …and resolves it first, even when the document spells the family without the space.
    const p = createMemoryPlatform()
    const sys = createFontSystem({ platform: p, online: () => false, documentFaces: () => faces })
    expect(await sys.availability({ family: "SpaceGrotesk", weight: 600, style: "normal" })).toBe(
      "document",
    )
  })
})

const CSS = (family: string) =>
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
      return new TextEncoder().encode(CSS(fam))
    }
    // Distinct bytes per face (content-addressed store).
    return new TextEncoder().encode(`face ${url}`)
  }
  return { p, fetched }
}

describe("§1 offline font pack", () => {
  test("the curated list is small and documented; the plan keeps upright latin 400–700", () => {
    expect(FONT_PACK_FAMILIES).toHaveLength(16)
    expect(new Set(FONT_PACK_FAMILIES).size).toBe(16)
    const plan = packFacesFromCss("Lora", CSS("Lora"))
    expect(plan.map((f) => f.weight)).toEqual([...FONT_PACK_WEIGHTS])
    expect(plan.every((f) => f.url.endsWith("-latin.woff2"))).toBe(true)
    // Desktop CSS (no subsets): the single file is the face; other hosts are dropped.
    const ttf = packFacesFromCss(
      "Lato",
      "@font-face { font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/l.ttf) }\n@font-face { font-style: normal; font-weight: 700; src: url(https://evil.example/l.ttf) }",
    )
    expect(ttf).toEqual([{ family: "Lato", weight: 400, url: "https://fonts.gstatic.com/l.ttf" }])
  })

  test("download → ready, resolves offline through the pack, remove → empty", async () => {
    const { p, fetched } = packPlatform()
    const pack = fontPackController(p)
    await pack.refresh()
    expect(pack.state().status).toBe("empty")
    const seen: string[] = []
    pack.subscribe((s) => seen.push(s.status))
    await pack.download()
    const s = pack.state()
    expect(s.status).toBe("ready")
    if (s.status !== "ready") throw new Error("not ready")
    expect(s.families).toBe(16)
    expect(s.faces).toBe(16 * 4)
    expect(seen).toContain("downloading")
    expect(fetched.filter((u) => u.includes("css2"))).toHaveLength(16)
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
    expect(fetched.length).toBe(n + 16)
    await pack.remove()
    expect(pack.state().status).toBe("empty")
    expect(await p.fonts.pack.list()).toEqual([])
  })

  test("No third-party fetch: not allowed, zero requests, the row says why", async () => {
    const { p, fetched } = packPlatform({ "privacy.noThirdPartyFetch": true })
    const pack = fontPackController(p)
    await pack.refresh()
    expect(pack.allowed()).toBe(false)
    await pack.download()
    expect(fetched).toEqual([])
    expect(pack.state().status).toBe("error")
    expect(fontPackDescription({ status: "empty" }, "ntpf", (d) => d)).toBe(
      "Off while No third-party fetch is on. A pack already downloaded keeps working.",
    )
  })

  test("cancel keeps what arrived", async () => {
    const { p } = packPlatform()
    const pack = fontPackController(p)
    await pack.refresh()
    let cancelled = false
    pack.subscribe((s) => {
      if (!cancelled && s.status === "downloading" && s.done >= 3) {
        cancelled = true
        pack.cancel()
      }
    })
    await pack.download()
    const s = pack.state()
    expect(s.status).toBe("ready")
    if (s.status === "ready") expect(s.faces).toBeLessThan(64)
  })

  test("row copy (board 28 rCcF5 / TEciq)", () => {
    expect(fontPackProgressLabel(3_100_000, 8_300_000)).toBe("3.1 of 8.3 MB")
    expect(fontPackProgressLabel(9_000_000, 8_300_000)).toBe("9 of 9 MB")
    expect(
      fontPackDescription({ status: "downloading", done: 23, total: 62 }, null, (d) => d),
    ).toBe("Downloading 23 of 62 faces… You can keep working; the fonts apply when it finishes.")
    expect(
      fontPackDescription(
        { status: "ready", faces: 62, families: 16, dir: "/Users/a/Library/x/font-pack" },
        null,
        (d) => d.replace("/Users/a", "~"),
      ),
    ).toBe("16 families · 62 faces · ~/Library/x/font-pack")
  })
})

describe("§2 blocked fallback", () => {
  const missing = [
    {
      family: "Space Grotesk",
      weights: [500],
      italic: false,
      nodeIds: ["a"],
      status: "offline" as const,
      missingWeights: [500],
    },
  ]
  const render = (blocked: "ntpf" | "google-off" | null) =>
    renderToString(
      h(MissingFontsDialog, {
        fileName: "marketing.kimo",
        fonts: missing,
        choices: [],
        canFetch: false,
        blocked,
        onOpenSettings: () => {},
        onReplace: () => {},
        onKeep: () => {},
        inline: true,
      }),
    )
  test("Banner/Warning with Open settings when No third-party fetch blocks Google", () => {
    const html = render("ntpf")
    expect(html).toContain(BLOCKED_BANNER_TITLE)
    expect(html).toContain("kimo-banner--warning")
    expect(html).toContain("Open settings")
  })
  test("offline but allowed: no banner", () => {
    expect(render(null)).not.toContain("kimo-banner")
  })
})

describe("§2 Code tab follows Export's Tailwind theme", () => {
  const doc = parse(
    readFileSync(
      join(import.meta.dir, "../../../packages/exporters/test/fixtures/layout-matrix.kimo"),
      "utf8",
    ),
  )
  const paths = async (theme: "v4" | "v3" | "none", mapTokens = true) =>
    (
      await generateCode({ document: () => doc }, ["Matrix0001"], "react", DEFAULT_TOGGLES, {
        theme,
        mapTokens,
      })
    ).files
  test("v4 default: @theme in tokens.css; v3: tailwind.config.ts; none: no theme", async () => {
    const v4 = await paths("v4")
    expect(v4.map((f) => f.path)).not.toContain("tailwind.config.ts")
    expect(v4.find((f) => f.path === "tokens.css")?.contents).toContain("@theme")
    const v3 = await paths("v3")
    expect(v3.map((f) => f.path)).toContain("tailwind.config.ts")
    expect(v3.find((f) => f.path === "tokens.css")?.contents).not.toContain("@theme")
    const none = await paths("none")
    expect(none.map((f) => f.path)).not.toContain("tailwind.config.ts")
    expect(none.find((f) => f.path === "tokens.css")?.contents ?? "").not.toContain("@theme")
    // The source map still lines up with the shown file.
    expect(v3[0]?.map).not.toBeNull()
  })
  test("the remembered choice is read leniently", () => {
    const store = (v: string | null) => ({ getItem: () => v })
    expect(readExportTailwind(store(null))).toEqual({ theme: "v4", mapTokens: true })
    expect(readExportTailwind(store('{"theme":"v3","mapTokens":false}'))).toEqual({
      theme: "v3",
      mapTokens: false,
    })
    expect(readExportTailwind(store('{"theme":"v9"}'))).toEqual({ theme: "v4", mapTokens: true })
    expect(readExportTailwind(store("{bad"))).toEqual({ theme: "v4", mapTokens: true })
  })
})

describe("§1 the manifest is written on save, never edited live", () => {
  test("autosave / save list the font; the store, undo and dirty state stay untouched", async () => {
    const { FILE, edit, setup, waitFor } = await import("./m4-helpers")
    const { platform, manager } = await setup()
    const s = await manager.open(FILE)
    const key = `${await contentHash(woff2)}.woff2`
    const f = {
      key,
      family: "Space Grotesk",
      entry: { mime: "font/woff2", bytes: woff2.byteLength, name: "Space Grotesk-SemiBold.woff2" },
    }
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
    expect(written.assets).toEqual({ [key]: f.entry })
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
    expect(Object.keys(s2.store.toHeader().assets ?? {})).toEqual([key])
    await s2.close()
  })
})
