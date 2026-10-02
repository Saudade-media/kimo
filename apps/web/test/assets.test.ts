import { describe, expect, test } from "bun:test"
import { deflateRawSync } from "node:zlib"
import { assetRefs, manifestOps } from "../src/lib/asset-manifest"
import { contentHash, sniffImage } from "../src/lib/assets"
import { crc32, isZip, readZip, writeZip } from "../src/lib/zip"

const bytes = (...b: number[]) => new Uint8Array(b)
const ascii = (s: string) => new TextEncoder().encode(s)

describe("sniffImage", () => {
  test("recognizes PNG, JPEG, GIF, WebP, AVIF by magic number", () => {
    expect(sniffImage(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe("image/png")
    expect(sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg")
    expect(sniffImage(ascii("GIF89a...."))).toBe("image/gif")
    expect(sniffImage(ascii("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp")
    expect(sniffImage(ascii("\0\0\0\x1cftypavif"))).toBe("image/avif")
  })
  test("rejects SVG, PDF and text whatever their declared type", () => {
    expect(sniffImage(ascii("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull()
    expect(sniffImage(ascii("%PDF-1.7"))).toBeNull()
    expect(sniffImage(bytes())).toBeNull()
  })
})

describe("asset manifest", () => {
  const src = "./assets/0123456789abcdef.png"
  const op = { op: "update" as const, id: "n1", set: { fill: { kind: "image", src } } }
  test("finds references in ops", () => {
    expect([...assetRefs([op])]).toEqual(["0123456789abcdef.png"])
  })
  test("adds a missing entry only when the document keeps a manifest", () => {
    const entry = () => ({ mime: "image/png", bytes: 10, width: 2, height: 2 })
    expect(manifestOps(undefined, [op], entry)).toEqual([])
    const have = { "aaaaaaaaaaaaaaaa.jpg": { mime: "image/jpeg" } }
    expect(manifestOps(have, [op], entry)).toEqual([
      {
        op: "setHeader",
        set: { assets: { ...have, "0123456789abcdef.png": entry() } },
      },
    ])
    expect(manifestOps({ "0123456789abcdef.png": { mime: "image/png" } }, [op], entry)).toEqual([])
    expect(manifestOps(have, [op], () => null)).toEqual([])
  })
})

describe("zip", () => {
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
  test("content hash is the sha-256 prefix", async () => {
    expect(await contentHash(ascii("abc"))).toBe("ba7816bf8f01cfea")
  })
})
