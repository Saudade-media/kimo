import { describe, expect, test } from "bun:test"
import { createDocStore, createEmptyDocument, createUiStore, type Op } from "@kimo/editor-state"
import {
  baseName,
  densityOf,
  dropPillText,
  fitSize,
  formatMb,
  importRasterFiles,
  isRasterType,
  isSvgLike,
  rasterMime,
  registerRasterAssets,
  rejectionText,
  rowOffsets,
} from "../src/editor/clipboard/raster"
import type { M3Controller } from "../src/editor/m3/controller"
import type { FileSession } from "../src/editor/session"
import { type AssetInfo, type AssetStore, MAX_ASSET_BYTES } from "../src/lib/assets"

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const ascii = (s: string) => new TextEncoder().encode(s)

describe("board 27 §3 raster rules", () => {
  test("formats: PNG, JPEG, WebP and GIF only (sniffed); SVG is left to the SVG importer", () => {
    expect(rasterMime(PNG)).toBe("image/png")
    expect(rasterMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg")
    expect(rasterMime(ascii("GIF89a...."))).toBe("image/gif")
    expect(rasterMime(ascii("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp")
    expect(rasterMime(ascii("\0\0\0\x1cftypavif"))).toBeNull()
    expect(rasterMime(ascii("<svg/>"))).toBeNull()
    expect(isRasterType("image/JPEG")).toBe(true)
    expect(isRasterType("image/heic")).toBe(false)
    expect(isSvgLike({ name: "logo.SVG" })).toBe(true)
    expect(isSvgLike({ type: "image/svg+xml" })).toBe(true)
  })

  test("names: file name without extension; @2x / @3x density", () => {
    expect(baseName("team.jpg")).toBe("team")
    expect(baseName("/a/b/office.photo.webp")).toBe("office.photo")
    expect(baseName(".env")).toBe(".env")
    expect(densityOf("logo@2x.png")).toBe(2)
    expect(densityOf("logo@3X.png")).toBe(3)
    expect(densityOf("logo.png")).toBe(1)
    expect(densityOf(undefined)).toBe(1)
  })

  test("size: natural px ÷ density, scaled down to fit (ratio kept), never up", () => {
    // L2qTa note: 2400 × 1600 into the Gallery's 216 content width → 216 × 144.
    expect(fitSize({ width: 2400, height: 1600 }, 1, 216)).toEqual({ w: 216, h: 144 })
    expect(fitSize({ width: 200, height: 100 }, 1, 216)).toEqual({ w: 200, h: 100 })
    expect(fitSize({ width: 400, height: 200 }, 2, 1000)).toEqual({ w: 200, h: 100 })
    // 80 % of the viewport on both axes.
    expect(fitSize({ width: 1000, height: 3000 }, 1, 800, 600)).toEqual({ w: 200, h: 600 })
  })

  test("several files: a row with 16 px gaps", () => {
    expect(rowOffsets([100, 50, 30])).toEqual({ xs: [0, 116, 182], total: 212 })
    expect(rowOffsets([])).toEqual({ xs: [], total: 0 })
  })

  test("copy (vgvYj pill, L2qTa toasts)", () => {
    expect(dropPillText(2, 2)).toBe("Drop 2 images")
    expect(dropPillText(1, 1)).toBe("Drop 1 image")
    expect(dropPillText(2, 3)).toBe("1 of 3 can't be imported")
    expect(rejectionText("photo.heic", "unsupported")).toBe(
      "photo.heic isn't supported. Use PNG, JPEG, WebP or GIF",
    )
    expect(rejectionText("scan.png", "too-large", 42 * 1048576)).toBe(
      "scan.png is 42 MB. The limit is 20 MB per image",
    )
    expect(MAX_ASSET_BYTES).toBe(20 * 1048576)
    expect(formatMb(2.1 * 1048576)).toBe("2.1 MB")
    expect(formatMb(10)).toBe("0.1 MB")
  })
})

describe("importRasterFiles", () => {
  function setup() {
    const store = createDocStore()
    store.loadDocument(createEmptyDocument("t"))
    const ui = createUiStore()
    const toasts: { tone: string; text: string; icon?: string }[] = []
    const session = {
      store,
      ui,
      apply: (ops: Op | readonly Op[], label?: string) =>
        store.apply(ops, label ? { origin: "user", label } : { origin: "user" }).ok,
    } as unknown as FileSession
    const m3 = {
      toast: (t: { tone: string; text: string; icon?: string }) => toasts.push(t),
      view: () => ({
        getNode: (id: string) => store.getNode(id),
        children: (p: string | null) => store.children(p),
        isVirtual: () => false,
      }),
    } as unknown as M3Controller
    const stored = new Set<string>()
    const assets = {
      keys: async () => [...stored],
      put: async (f: Blob & { name?: string }): Promise<AssetInfo> => {
        const key = `0123456789abcde${stored.size}.png`
        stored.add(key)
        return {
          src: `./assets/${key}`,
          mime: "image/png",
          bytes: f.size,
          width: 2400,
          height: 1600,
        }
      },
    } as unknown as AssetStore
    registerRasterAssets(session, assets)
    return { session, m3, store, ui, toasts }
  }
  const file = (name: string, bytes: Uint8Array, type = "") =>
    new File([bytes as Uint8Array<ArrayBuffer>], name, { type })

  test("paste: image rect at the viewport centre, warning per rejected file, one undo step", async () => {
    const { session, m3, store, ui, toasts } = setup()
    const r = await importRasterFiles(
      { session, m3, canvas: () => null },
      [file("team@2x.png", PNG), file("photo.heic", ascii("....ftypheic"))],
      { kind: "paste" },
    )
    expect(r.created).toHaveLength(1)
    const n = store.getNode(r.created[0] as string)
    expect(n).toMatchObject({
      type: "rect",
      name: "team@2x",
      parent: null,
      w: 1200,
      h: 800,
      fill: { kind: "image", src: "./assets/0123456789abcde0.png" },
    })
    expect(ui.getState().selection).toEqual(r.created)
    expect(toasts.map((t) => t.tone)).toEqual(["warning", "success"])
    expect(toasts[0]?.text).toBe("photo.heic isn't supported. Use PNG, JPEG, WebP or GIF")
    expect(toasts[1]).toMatchObject({
      icon: "clipboard-check",
      text: "Pasted “team@2x” · 1200 × 800 at the viewport centre",
    })
    store.undo("user")
    expect(store.hasNode(r.created[0] as string)).toBe(false)
  })

  test("paste into a selected auto-layout frame: appended children scaled to its content width", async () => {
    const { session, m3, store, ui } = setup()
    store.apply(
      {
        op: "insert",
        id: "Gallery001",
        parent: null,
        node: {
          type: "frame",
          name: "Gallery",
          w: 240,
          h: 260,
          layout: { dir: "column", pad: 12 },
        },
      },
      { origin: "user" },
    )
    ui.getState().select(["Gallery001"])
    const canvas = {
      layout: () => ({
        nodes: new Map([["Gallery001", { world: { x: 0, y: 0, w: 240, h: 260 } }]]),
      }),
      size: () => ({ w: 1000, h: 800 }),
      pointer: () => null,
    }
    const r = await importRasterFiles(
      { session, m3, canvas: () => canvas as never },
      [new Blob([PNG], { type: "image/png" }), new Blob([PNG], { type: "image/png" })],
      { kind: "paste" },
    )
    expect(store.children("Gallery001")).toEqual(r.created)
    expect(store.getNode(r.created[0] as string)).toMatchObject({
      name: "Pasted image",
      w: 216,
      h: 144,
    })
  })

  test("an oversized file gets the limit warning and imports nothing", async () => {
    const { session, m3, toasts } = setup()
    const big = { name: "scan.png", size: 42 * 1048576, type: "image/png" } as unknown as File
    const r = await importRasterFiles({ session, m3, canvas: () => null }, [big], { kind: "paste" })
    expect(r.created).toEqual([])
    expect(toasts[0]?.text).toBe("scan.png is 42 MB. The limit is 20 MB per image")
  })
})
