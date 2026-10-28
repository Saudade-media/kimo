/**
 * Assets next to a .kimo: content-addressed names, the manifest, the folder store, the .kimoz zip
 * container, and Clean up assets (`kimo gc`), which must never remove anything still referenced.
 */
import { describe, expect, test } from "bun:test"
import { deflateRawSync } from "node:zlib"
import { planAssetGc, prunedManifest, referencedAssets } from "@kimo/core-schema"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { platformAssetFolder } from "../../src/assets-gc"
import { applyAssetGc, planFolderGc } from "../../src/assets-gc/CleanUpAssetsHost"
import { assetRefs, manifestOps } from "../../src/lib/asset-manifest"
import { contentHash, createFolderAssetStore, sniffImage } from "../../src/lib/assets"
import { crc32, isZip, readZip, writeZip } from "../../src/lib/zip"

const bytes = (...b: number[]) => new Uint8Array(b)
const ascii = (s: string) => new TextEncoder().encode(s)

describe("image sniffing and hashing", () => {
  test("images are recognized by magic number; SVG, PDF and text are not", () => {
    expect(sniffImage(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe("image/png")
    expect(sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg")
    expect(sniffImage(ascii("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp")
    expect(sniffImage(ascii("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull()
    expect(sniffImage(ascii("%PDF-1.7"))).toBeNull()
    expect(sniffImage(bytes())).toBeNull()
  })

  test("the content hash is the sha-256 prefix", async () => {
    expect(await contentHash(ascii("abc"))).toBe("ba7816bf8f01cfea")
  })
})

describe("asset manifest", () => {
  const src = "./assets/0123456789abcdef.png"
  const op = { op: "update" as const, id: "n1", set: { fill: { kind: "image", src } } }

  test("references are found in ops, and a missing entry is added only when the document keeps a manifest", () => {
    expect([...assetRefs([op])]).toEqual(["0123456789abcdef.png"])
    const entry = () => ({ mime: "image/png", bytes: 10, width: 2, height: 2 })
    expect(manifestOps(undefined, [op], entry)).toEqual([])
    const have = { "aaaaaaaaaaaaaaaa.jpg": { mime: "image/jpeg" } }
    expect(manifestOps(have, [op], entry)).toEqual([
      { op: "setHeader", set: { assets: { ...have, "0123456789abcdef.png": entry() } } },
    ])
    expect(manifestOps({ "0123456789abcdef.png": { mime: "image/png" } }, [op], entry)).toEqual([])
    expect(manifestOps(have, [op], () => null)).toEqual([])
  })
})

describe("zip container", () => {
  test("round-trips stored entries", async () => {
    const a = ascii('{"format":"0.1"}')
    const b = bytes(1, 2, 3, 250)
    const z = writeZip([
      { name: "Doc.kimo", data: a },
      { name: "assets/0123456789abcdef.png", data: b },
    ])
    expect(isZip(z)).toBe(true)
    const out = await readZip(z)
    expect(out.map((e) => e.name)).toEqual(["Doc.kimo", "assets/0123456789abcdef.png"])
    expect([...(out[1]?.data ?? [])]).toEqual([1, 2, 3, 250])
    expect(new TextDecoder().decode(out[0]?.data)).toBe('{"format":"0.1"}')
  })

  test("reads deflated entries written by other tools", async () => {
    const data = ascii("hello hello hello hello")
    const deflated = new Uint8Array(deflateRawSync(data))
    const z = writeZip([{ name: "x.kimo", data: deflated }])
    // Patch method (stored → deflate) and sizes: compressed = deflated, uncompressed = data.
    const v = new DataView(z.buffer)
    v.setUint16(8, 8, true)
    v.setUint32(14, crc32(data), true)
    v.setUint32(22, data.length, true)
    const cd = z.length - 22 - (46 + 6)
    v.setUint16(cd + 10, 8, true)
    v.setUint32(cd + 16, crc32(data), true)
    v.setUint32(cd + 24, data.length, true)
    const out = await readZip(z)
    expect(new TextDecoder().decode(out[0]?.data)).toBe("hello hello hello hello")
  })

  test("crc32 matches the reference value", () => {
    expect(crc32(ascii("123456789"))).toBe(0xcbf43926)
  })
})

describe("folder asset store (a .kimo on disk)", () => {
  test("stores and reads assets/<hash>.<ext> beside the file, refusing a key that is not the hash", async () => {
    const platform = createMemoryPlatform({ files: { "/p/doc.kimo": "{}" } })
    const store = createFolderAssetStore(platform, "/p/doc.kimo")
    expect(await store.keys()).toEqual([])
    const data = ascii("<svg xmlns='http://www.w3.org/2000/svg'/>")
    const key = `${await contentHash(data)}.svg`
    expect(await store.putKey("0000000000000000.svg", data, { mime: "image/svg+xml" })).toBeNull()
    const info = await store.putKey(key, data, { mime: "image/svg+xml", width: 1, height: 1 })
    expect(info?.src).toBe(`./assets/${key}`)
    expect(await store.keys()).toEqual([key])
    expect(await platform.files.readBytes(`/p/assets/${key}`)).toEqual(data)
    expect(await store.source.load(`./assets/${key}`)).toEqual(data)
    store.dispose()
  })

  test("shader sources resolve relative to the .kimo, and nothing else is read", async () => {
    const platform = createMemoryPlatform({
      files: {
        "/p/d/doc.kimo": "{}",
        "/p/d/shaders/a.glsl": "void main() {}",
        "/p/b.frag": "void main() { }",
        "/p/d/notes.txt": "x",
      },
    })
    const store = createFolderAssetStore(platform, "/p/d/doc.kimo")
    const text = async (src: string) => {
      const b = await store.source.load(src)
      return b ? new TextDecoder().decode(b) : null
    }
    expect(await text("./shaders/a.glsl")).toBe("void main() {}")
    expect(await text("../b.frag")).toBe("void main() { }")
    expect(await text("./missing.glsl")).toBeNull()
    // Only shader sources: other relative paths are not read.
    expect(await text("./notes.txt")).toBeNull()
    expect(await text("/p/b.frag")).toBeNull()
    store.dispose()
  })
})

describe("clean up assets", () => {
  const A = "9f2c41ab03d1e7a2.png"
  const B = "1b77e0c9a4f25d13.jpg"
  const C = "c30d8e1f6a9b2240.webp"
  const D = "77aa10fe2b9c4d58.svg"
  const USED = "aaaaaaaaaaaaaaaa.png"
  const VAR = "bbbbbbbbbbbbbbbb.png"
  const FONT = "cccccccccccccccc.ttf"

  const doc = {
    $schema: "x",
    format: "0.1",
    assets: { [A]: { mime: "image/png" }, [USED]: { mime: "image/png" } },
    variables: { hero: { type: "string", value: `./assets/${VAR}` } },
    nodes: {
      n1: { type: "rect", w: 1, h: 1, fill: [{ kind: "image", src: `./assets/${USED}` }] },
      n2: { type: "text", content: "x", style: { font: "Fraunces" } },
    },
  }

  test("references come from nodes and variables, not the manifest", () => {
    expect([...referencedAssets(doc)].sort()).toEqual([USED, VAR])
  })

  test("the plan removes unused files only: fonts by family, unknown fonts and non-assets are kept", () => {
    const files = [
      { name: A, bytes: 6_200_000 },
      { name: B, bytes: 4_800_000 },
      { name: C, bytes: 3_100_000 },
      { name: D, bytes: 48_000 },
      { name: USED, bytes: 10 },
      { name: FONT, bytes: 200_000 },
      { name: "dddddddddddddddd.otf", bytes: 1 },
      { name: "README.md", bytes: 5 },
      { name: ".DS_Store", bytes: 5 },
    ]
    const plan = planAssetGc(doc, files, (n) =>
      n === FONT ? "Fraunces" : n.endsWith(".otf") ? "Unused Sans" : null,
    )
    expect(plan.unused.map((f) => f.name)).toEqual([A, B, C, D, "dddddddddddddddd.otf"])
    expect(plan.unusedBytes).toBe(6_200_000 + 4_800_000 + 3_100_000 + 48_000 + 1)
    expect(plan.kept.map((f) => f.name).sort()).toEqual([USED, FONT].sort())
    expect(plan.ignored.map((f) => f.name)).toEqual(["README.md", ".DS_Store"])
    expect(plan.missing).toEqual([VAR])
    // Unknown font family → kept (conservative).
    expect(planAssetGc(doc, [{ name: FONT, bytes: 1 }]).unused).toEqual([])
  })

  test("a name that only appears inside a longer token is not a reference", () => {
    const d = { nodes: { n: { note: `x./assets/${A}x`, other: `assets/${A}0` } } }
    expect(referencedAssets(d).has(A)).toBe(false)
    expect(referencedAssets({ nodes: { n: { src: `assets/${A}` } } }).has(A)).toBe(true)
  })

  test("the manifest is pruned of removed files", () => {
    expect(prunedManifest(doc.assets, [A])).toEqual({ [USED]: { mime: "image/png" } })
    expect(prunedManifest(doc.assets, [B])).toBeNull()
    expect(prunedManifest(undefined, [A])).toBeNull()
  })

  test("on disk: removes the unused file, prunes the manifest, leaves other files alone", async () => {
    const p = createMemoryPlatform({
      files: {
        "/p/marketing.kimo": "{}",
        [`/p/assets/${A}`]: "aaaa",
        [`/p/assets/${USED}`]: "b",
        "/p/assets/notes.txt": "keep me",
      },
    })
    const folder = platformAssetFolder(p, "/p/marketing.kimo")
    const plan = await planFolderGc(folder, doc)
    expect(plan.unused).toEqual([{ name: A, bytes: 4 }])
    const ops = await applyAssetGc(folder, plan, doc)
    expect(ops).toEqual([{ op: "setHeader", set: { assets: { [USED]: { mime: "image/png" } } } }])
    expect(p.control.readFile(`/p/assets/${A}`)).toBeNull()
    expect(p.control.readFile(`/p/assets/${USED}`)).toBe("b")
    expect(p.control.readFile("/p/assets/notes.txt")).toBe("keep me")
    // No assets/ folder → nothing to do.
    const bare = createMemoryPlatform({ files: { "/q/a.kimo": "{}" } })
    expect((await planFolderGc(platformAssetFolder(bare, "/q/a.kimo"), doc)).unused).toEqual([])
  })
})
