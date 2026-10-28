/** What a share sends of fonts and shaders: embedded or name-only, and never a user's own files. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { fontShareDecision } from "@kimo/sync/mp"
import { contentDigest, createFolderAssetStore } from "../../src/lib/assets"
import { makePeer, makeTarget, type Relay, startRelay } from "./helpers"

let relay: Relay
beforeEach(() => {
  relay = startRelay()
})
afterEach(async () => {
  await relay.stop()
})

const GLSL = "void main() { gl_FragColor = vec4(1.0); }"

describe("shader embedding", () => {
  test("relative shader paths become hash-named assets in one system change", async () => {
    const owner = makePeer()
    const target = makeTarget()
    target.store.apply(
      [
        { op: "setHeader", set: { features: ["fill/shader"] } },
        {
          op: "insert",
          id: "Shader00001",
          node: { type: "rect", w: 8, h: 8, fill: { kind: "shader", src: "./shaders/glow.glsl" } },
        },
        {
          op: "insert",
          id: "Shader00002",
          node: { type: "rect", w: 8, h: 8, fill: { kind: "shader", src: "./shaders/gone.glsl" } },
        },
      ] as never,
      { origin: "user" },
    )
    const undoBefore = target.store.canUndo("user")
    const bytes = new TextEncoder().encode(GLSL)
    const sha = await contentDigest(bytes)
    const reads: string[] = []
    const shared = {
      ...target,
      readRelative: async (path: string) => {
        reads.push(path)
        return path === "./shaders/glow.glsl" ? bytes : null
      },
    }
    const logBefore = target.store.log().length
    const { room } = await owner.service.startSharing(shared, { relayUrl: relay.url })

    const key = `${sha.slice(0, 16)}.glsl`
    const fill = target.store.getNode("Shader00001")?.fill as { src: string }
    expect(fill.src).toBe(`./assets/${key}`)
    // The unreadable source is left as it was.
    const gone = target.store.getNode("Shader00002")
    expect((gone?.fill as unknown as { src: string } | undefined)?.src).toBe("./shaders/gone.glsl")
    const manifest = (
      target.store.toHeader() as { assets: Record<string, Record<string, unknown>> }
    ).assets
    expect(manifest[key]).toMatchObject({
      mime: "text/x-glsl",
      bytes: bytes.length,
      name: "glow.glsl",
      sha256: sha,
    })
    expect(await target.assets.bytes(key)).toEqual(bytes)
    // One non-undoable system load: the undo stack did not gain an entry.
    const loads = target.store
      .log()
      .slice(logBefore)
      .filter((e) => e.kind === "load")
    expect(loads).toHaveLength(1)
    expect(target.store.canUndo("user")).toBe(undoBefore)
    await owner.service.stopSharing(room)
  })

  test("shaders embedded next to an incomplete manifest keep their relative path", async () => {
    const owner = makePeer()
    const target = makeTarget("/work/legacy.kimo")
    target.store.apply(
      [
        { op: "setHeader", set: { features: ["fill/shader"] } },
        {
          op: "insert",
          id: "Shader00001",
          node: { type: "rect", w: 8, h: 8, fill: { kind: "shader", src: "./fx.glsl" } },
        },
        {
          op: "insert",
          id: "Img0000001",
          node: {
            type: "rect",
            w: 4,
            h: 4,
            fill: { kind: "image", src: "./assets/0123456789abcdef.png" },
          },
        },
      ] as never,
      { origin: "user" },
    )
    const bytes = new TextEncoder().encode("void main() {}")
    const summary = await owner.service.startSharing(
      { ...target, readRelative: async () => bytes },
      { relayUrl: relay.url },
    )
    expect(summary.room).toBeTruthy()
    const fill = target.store.getNode("Shader00001")?.fill as { src: string }
    // Not rewritten to an asset that no manifest entry would carry.
    expect(fill.src).toBe("./fx.glsl")
  })
})

describe("font policy", () => {
  test("bundled and Google families share; user files and unknown families are name-only", () => {
    expect(fontShareDecision({ family: "Inter", source: "bundled" })).toBe("share")
    expect(fontShareDecision({ family: "Zapfino", source: "google" })).toBe("share")
    expect(fontShareDecision({ family: "Inter", source: "user" })).toBe("name-only")
    expect(fontShareDecision({ family: "Zapfino" })).toBe("name-only")
  })

  test("sharing warns once per name-only family and never for shared ones", async () => {
    const owner = makePeer()
    const target = makeTarget()
    for (const [id, font] of [
      ["Text000001", "Zapfino"],
      ["Text000002", "Zapfino"],
      ["Text000003", "Inter"],
      ["Text000004", "Papyrus"],
    ] as const) {
      target.store.apply(
        {
          op: "insert",
          id,
          node: { type: "text", content: "hi", style: { font, size: 12 } },
        } as never,
        { origin: "user" },
      )
    }
    const events: { room: string; families: string[] }[] = []
    owner.service.onFontNotShared((e) => events.push(e))
    const { room } = await owner.service.startSharing(target, { relayUrl: relay.url })
    expect(events).toHaveLength(1)
    expect(events[0]?.room).toBe(room)
    expect([...(events[0]?.families ?? [])].sort()).toEqual(["Papyrus", "Zapfino"])
    await owner.service.stopSharing(room)
  })
})

describe("fonts the user added", () => {
  test("are not hashed, uploaded or backfilled; a fetched face still is", async () => {
    const owner = makePeer()
    const target = makeTarget("/work/fonts.kimo")
    // Minimal font-like bytes: the content hash is what matters for the key.
    const userBytes = new TextEncoder().encode("user font file bytes 0123456789")
    const userKey = `${(await contentDigest(userBytes)).slice(0, 16)}.otf`
    await target.assets.putKey(userKey, userBytes, {
      mime: "font/otf",
      name: "Licensed-Regular.otf",
    })
    target.store.apply(
      {
        op: "setHeader",
        set: {
          assets: {
            [userKey]: { mime: "font/otf", bytes: userBytes.length, name: "Licensed-Regular.otf" },
          },
        },
      } as never,
      { origin: "user" },
    )
    const { room } = await owner.service.startSharing(target, { relayUrl: relay.url })
    const manifest = (target.store.toHeader() as { assets: Record<string, { sha256?: string }> })
      .assets
    expect(manifest[userKey]?.sha256).toBeUndefined()
    const session = await owner.service.connect(target, room)
    await session.assetSync.uploadMissing()
    const sha = await contentDigest(userBytes)
    // A peer sets the sha256 on the font entry: the owner still does not upload it.
    target.store.apply(
      {
        op: "setHeader",
        set: { assets: { [userKey]: { ...manifest[userKey], sha256: sha } } },
      } as never,
      { origin: "user" },
    )
    const result = await session.assetSync.uploadMissing()
    expect(result.uploaded).toBe(0)
    await session.leave()
    await owner.service.stopSharing(room)
  })
})

describe("fonts fetched from Google", () => {
  test("a face found in the asset folder after a restart counts as fetched", async () => {
    const files = new Map<string, Uint8Array>()
    const platform = {
      files: {
        readBytes: async (path: string) => {
          const bytes = files.get(path)
          if (!bytes) throw new Error("ENOENT")
          return bytes
        },
        writeBytesAtomic: async (path: string, bytes: Uint8Array) => {
          files.set(path, bytes)
        },
        stat: async () => ({ kind: "directory" }),
        list: async () =>
          [...files.keys()].map((p) => ({ kind: "file", name: p.slice(p.lastIndexOf("/") + 1) })),
      },
    }
    const bytes = new TextEncoder().encode("a font file from google")
    const key = `${(await contentDigest(bytes)).slice(0, 16)}.woff2`
    files.set(`/work/assets/${key}`, bytes)
    const assets = createFolderAssetStore(platform as never, "/work/lobster.kimo" as never)
    expect((await assets.info(`./assets/${key}`))?.fontSource).toBe("google")
  })
})
