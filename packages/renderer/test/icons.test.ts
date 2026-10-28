import { describe, expect, test } from "bun:test"
import { CanvasKitRenderer, type IconGlyph, type IconProvider } from "../src"
import { loadCanvasKit } from "../src/ck"
import { packIconSource, SourceIconProvider } from "../src/icons/provider"
import { PACK_SHARDS, shardOf } from "../src/icons/sets"
import { pixelAt } from "./helpers/golden"
import { sceneOf, simpleLayout } from "./helpers/scene"

const shard = `lucide/${shardOf("heart", PACK_SHARDS.lucide ?? 1)}.json`
const glyph = [[0, 0, 24, 24], [["M0 0L24 24", 1]], 2]

describe("icon provider: transient failures", () => {
  test("a failed shard fetch is retried after the backoff, not cached as missing", async () => {
    let calls = 0
    const fetchFn = async () => {
      calls++
      return calls === 1
        ? new Response("busy", { status: 503 })
        : new Response(JSON.stringify({ heart: glyph }), { status: 200 })
    }
    const p = new SourceIconProvider(packIconSource({ [shard]: "u" }, fetchFn))
    const loaded: string[] = []
    p.onIconLoaded((_, n) => loaded.push(n))
    expect(await p.load("lucide", "heart")).toBeNull()
    expect(p.status("lucide", "heart")).toBe("failed")
    // Inside the backoff window nothing is refetched.
    expect(await p.load("lucide", "heart")).toBeNull()
    expect(calls).toBe(1)
    // Past it (the clock jumps instead of sleeping), the next load fetches again and notifies.
    const realNow = performance.now.bind(performance)
    performance.now = () => realNow() + 5000
    try {
      expect((await p.load("lucide", "heart"))?.name).toBe("heart")
    } finally {
      performance.now = realNow
    }
    expect(p.status("lucide", "heart")).toBe("ready")
    expect(loaded).toEqual(["heart"])
    expect(calls).toBe(2)
  })

  test("a glyph absent from its shard is missing (final)", async () => {
    const fetchFn = async () => new Response(JSON.stringify({}), { status: 200 })
    const p = new SourceIconProvider(packIconSource({ [shard]: "u" }, fetchFn))
    expect(await p.load("lucide", "heart")).toBeNull()
    expect(p.status("lucide", "heart")).toBe("missing")
  })

  test("a failed catalog is not cached", async () => {
    let calls = 0
    const fetchFn = async () => {
      calls++
      return calls === 1
        ? new Response("x", { status: 500 })
        : new Response(JSON.stringify([{ name: "heart" }]), { status: 200 })
    }
    const p = new SourceIconProvider(packIconSource({ "lucide/catalog.json": "c" }, fetchFn))
    expect(await p.catalog("lucide")).toEqual([])
    expect((await p.catalog("lucide")).map((e) => e.name)).toEqual(["heart"])
  })
})

describe("icons in the renderer", () => {
  test("a glyph that arrives after the first frame repaints the icon", async () => {
    const listeners = new Set<(set: string, name: string) => void>()
    let ready = false
    let release: () => void = () => {}
    const star: IconGlyph = {
      set: "lucide",
      name: "star",
      weight: null,
      viewBox: [0, 0, 24, 24],
      paths: [{ d: "M2 2 L22 2 L22 22 Z", paint: "fill" }],
    }
    const icons: IconProvider = {
      load: () =>
        new Promise((res) => {
          release = () => {
            ready = true
            res(star)
            for (const l of listeners) l("lucide", "star")
          }
        }),
      get: () => (ready ? star : null),
      catalog: async () => [],
      onIconLoaded(l) {
        listeners.add(l)
        return () => listeners.delete(l)
      },
    }
    const ck = await loadCanvasKit()
    const r = new CanvasKitRenderer()
    await r.init({ offlineFonts: true, icons })
    const scene = sceneOf({
      nodes: {
        screen0000: { type: "frame", parent: null, order: "a", w: 60, h: 60, fill: "#FFFFFF" },
        icon000000: {
          type: "icon",
          parent: "screen0000",
          order: "a",
          x: 10,
          y: 10,
          w: 24,
          h: 24,
          set: "lucide",
          icon: "star",
          color: "#1A1A1A",
        },
      },
    })
    r.setDocument(scene)
    r.setLayout(simpleLayout(scene, r.textMeasurer()))
    r.attachRaster(60, 60)
    // (30, 15) is inside the glyph's triangle (icon-local 20, 5).
    expect(pixelAt(ck, r.snapshot(), 30, 15)).toEqual([255, 255, 255, 255])
    release()
    expect(pixelAt(ck, r.snapshot(), 30, 15)).toEqual([0x1a, 0x1a, 0x1a, 255])
    r.dispose()
  })
})
