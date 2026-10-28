import { describe, expect, test } from "bun:test"
import { createDocStore, createEmptyDocument, createUiStore, type Op } from "@kimo/editor-state"
import {
  importRasterFiles,
  rasterMime,
  registerRasterAssets,
} from "../../src/editor/clipboard/raster"
import type { M3Controller } from "../../src/editor/m3/controller"
import type { FileSession } from "../../src/editor/session"
import type { AssetInfo, AssetStore } from "../../src/lib/assets"

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const ascii = (s: string) => new TextEncoder().encode(s)

describe("raster formats", () => {
  test("PNG, JPEG, WebP and GIF are sniffed from the bytes; anything else is refused", () => {
    expect(rasterMime(PNG)).toBe("image/png")
    expect(rasterMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg")
    expect(rasterMime(ascii("GIF89a...."))).toBe("image/gif")
    expect(rasterMime(ascii("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp")
    expect(rasterMime(ascii("\0\0\0\x1cftypavif"))).toBeNull()
    expect(rasterMime(ascii("<svg/>"))).toBeNull()
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

  test("paste: an image rect at 1/density size, a warning per rejected file, one undo step", async () => {
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
    expect(toasts.some((t) => t.tone === "warning")).toBe(true)
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

  test("an oversized file imports nothing", async () => {
    const { session, m3, toasts } = setup()
    const big = { name: "scan.png", size: 42 * 1048576, type: "image/png" } as unknown as File
    const r = await importRasterFiles({ session, m3, canvas: () => null }, [big], { kind: "paste" })
    expect(r.created).toEqual([])
    expect(toasts[0]?.tone).toBe("warning")
  })
})
