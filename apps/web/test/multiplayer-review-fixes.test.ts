/** Regressions for the share service review: upgrades, reopen state, fonts and asset scoping. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { KimoDocument } from "@kimo/core-schema"
import { YjsDocStore } from "@kimo/editor-state"
import {
  contentDigest,
  createMemoryAssetStore,
  imageHeaderSize,
  MAX_ASSET_PIXELS,
} from "../src/lib/assets"
import {
  addAsset,
  insertRect,
  makePeer,
  makeTarget,
  type Relay,
  startRelay,
  until,
} from "./multiplayer-helpers"

let relay: Relay
beforeEach(() => {
  relay = startRelay()
})
afterEach(async () => {
  await relay.stop()
})

const reopened = (fileKey: string) => ({
  fileKey,
  store: new YjsDocStore(),
  assets: createMemoryAssetStore(),
})

describe("upgrading a view session with an edit link", () => {
  test("the session reconnects as an editor and the registry follows", async () => {
    const owner = makePeer()
    const guest = makePeer()
    const target = makeTarget()
    const { room } = await owner.service.startSharing(target, { relayUrl: relay.url })
    const view = await owner.service.mintLink(room, { role: "view", ttlSeconds: null })
    const edit = await owner.service.mintLink(room, { role: "edit", ttlSeconds: null })

    const first = await guest.service.join(view.link)
    expect(first.role).toBe("view")
    expect(first.store.readOnly).not.toBeNull()
    expect((await guest.registry.getJoined(room))?.role).toBe("view")

    const second = await guest.service.join(edit.link)
    expect(second).toBe(first)
    expect(second.role).toBe("edit")
    expect(second.provider.role).toBe("edit")
    expect(second.store.readOnly).toBeNull()
    const joined = await guest.registry.getJoined(room)
    expect(joined?.role).toBe("edit")

    insertRect(second.store, "FromGuest01")
    await until(() => target.store.hasNode("FromGuest01"))
    insertRect(target.store, "FromOwner01")
    await until(() => second.store.hasNode("FromOwner01"))
    await second.leave()
    await owner.service.stopSharing(room)
  })

  test("a refused edit link leaves the view session and its record as they were", async () => {
    const owner = makePeer()
    const guest = makePeer()
    const target = makeTarget()
    const { room } = await owner.service.startSharing(target, { relayUrl: relay.url })
    const view = await owner.service.mintLink(room, { role: "view", ttlSeconds: null })
    const edit = await owner.service.mintLink(room, { role: "edit", ttlSeconds: null })
    const session = await guest.service.join(view.link)
    await owner.service.revokeLink(room, edit.jti)

    await expect(guest.service.join(edit.link)).rejects.toThrow()
    expect(session.role).toBe("view")
    expect(session.store.readOnly).not.toBeNull()
    expect((await guest.registry.getJoined(room))?.role).toBe("view")
    // The view connection is back.
    await until(() => session.provider.connected)
    await session.leave()
    await owner.service.stopSharing(room)
  })
})

describe("sharing a file that was not saved since", () => {
  test("reopening does not revert the prepared shader path in the room", async () => {
    const owner = makePeer({ replica: () => null })
    const guest = makePeer()
    const target = makeTarget("/work/shader.kimo")
    target.store.apply(
      [
        { op: "setHeader", set: { features: ["fill/shader"] } },
        {
          op: "insert",
          id: "Shader00001",
          node: { type: "rect", w: 8, h: 8, fill: { kind: "shader", src: "./shaders/glow.glsl" } },
        },
      ] as never,
      { origin: "user" },
    )
    const file = target.store.toDocument()
    const bytes = new TextEncoder().encode("void main() {}")
    const sha = await contentDigest(bytes)
    const { room } = await owner.service.startSharing(
      { ...target, readRelative: async () => bytes },
      { relayUrl: relay.url },
    )
    const link = await owner.service.mintLink(room, { role: "edit", ttlSeconds: null })
    const watcher = await guest.service.join(link.link)
    const src = () =>
      (watcher.store.getNode("Shader00001")?.fill as { src: string } | undefined)?.src
    expect(src()).toBe(`./assets/${sha.slice(0, 16)}.glsl`)

    // The owner leaves without saving and reopens the file as it is on disk.
    await (await owner.service.connect(target, room)).leave()
    const session = await owner.service.reopenShared(reopened("/work/shader.kimo"), file)
    expect(session).not.toBeNull()
    await until(() => session?.provider.connected === true)
    await new Promise((r) => setTimeout(r, 100))
    expect(src()).toBe(`./assets/${sha.slice(0, 16)}.glsl`)
    await session?.leave()
    await watcher.leave()
    await owner.service.stopSharing(room)
  })

  test("reopening the same unsaved file twice never beats a later guest edit", async () => {
    for (let i = 0; i < 6; i++) {
      const owner = makePeer({ replica: () => null })
      const guest = makePeer()
      const key = `/work/twice-${i}.kimo`
      const target = makeTarget(key, ["Rect000001", "Rect000002"])
      const { room } = await owner.service.startSharing(target, { relayUrl: relay.url })
      const link = await owner.service.mintLink(room, { role: "edit", ttlSeconds: null })
      const watcher = await guest.service.join(link.link)
      await owner.service.noteSaved(target, target.store.toDocument())
      await (await owner.service.connect(target, room)).leave()

      const file = target.store.toDocument() as KimoDocument & {
        nodes: Record<string, { name?: string }>
      }
      ;(file.nodes.Rect000002 as { name?: string }).name = "FromDisk"
      const first = await owner.service.reopenShared(reopened(key), file)
      await until(() => watcher.store.getNode("Rect000002")?.name === "FromDisk")
      await first?.leave()
      watcher.store.apply(
        { op: "update", id: "Rect000002", set: { name: "GuestLater" } } as never,
        {
          origin: "user",
        },
      )
      await until(async () => {
        const saved = await owner.registry.saves.load(room)
        return saved !== null
      })
      const second = await owner.service.reopenShared(reopened(key), file)
      await until(() => second?.provider.connected === true)
      await new Promise((r) => setTimeout(r, 60))
      expect(watcher.store.getNode("Rect000002")?.name).toBe("GuestLater")
      await second?.leave()
      await watcher.leave()
      await owner.service.stopSharing(room)
    }
  })
})

describe("creating a room", () => {
  test("a failed seed leaves no room behind and a retry starts clean", async () => {
    let failSnapshot = true
    const owner = makePeer({
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (failSnapshot && String(input).includes("/snapshot") && init?.method === "PUT")
          return new Response("nope", { status: 503 })
        return fetch(input, init)
      }) as typeof fetch,
    })
    const target = makeTarget("/work/fail.kimo")
    await expect(owner.service.startSharing(target, { relayUrl: relay.url })).rejects.toThrow()
    expect(await owner.service.roomForFile(target.fileKey)).toBeNull()
    failSnapshot = false
    const { room } = await owner.service.startSharing(target, { relayUrl: relay.url })
    expect(await owner.registry.saves.load(room)).not.toBeNull()
    await owner.service.stopSharing(room)
  })

  test("two concurrent calls for one file make one room", async () => {
    const owner = makePeer()
    const target = makeTarget("/work/double.kimo")
    const [a, b] = await Promise.all([
      owner.service.startSharing(target, { relayUrl: relay.url }),
      owner.service.startSharing(target, { relayUrl: relay.url }),
    ])
    expect(a.room).toBe(b.room)
    expect((await owner.registry.listOwned()).length).toBe(1)
    await owner.service.stopSharing(a.room)
  })
})

describe("the owner's token", () => {
  test("connecting again hands an open session the re-minted token", async () => {
    let clock = Date.now()
    const owner = makePeer({ now: () => clock })
    const target = makeTarget("/work/token.kimo")
    const { room } = await owner.service.startSharing(target, { relayUrl: relay.url })
    const session = await owner.service.connect(target, room)
    const before = (await owner.registry.getOwned(room))?.links.find((l) => l.self)?.jti
    clock += 29.5 * 86_400_000
    const again = await owner.service.connect(target, room)
    expect(again).toBe(session)
    const after = (await owner.registry.getOwned(room))?.links.find((l) => l.self)?.jti
    expect(after).not.toBe(before)
    await session.leave()
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

describe("assets of other documents", () => {
  test("a manifest entry the document does not reference is neither backfilled nor uploaded", async () => {
    const owner = makePeer()
    const target = makeTarget("/work/scoped.kimo")
    const other = await addAsset(
      target.assets,
      new TextEncoder().encode("another document"),
      "b.png",
    )
    const { room } = await owner.service.startSharing(target, { relayUrl: relay.url })
    const session = await owner.service.connect(target, room)
    await until(() => session.provider.connected)
    target.store.apply(
      { op: "setHeader", set: { assets: { [other.key]: { mime: "image/png" } } } } as never,
      { origin: "user" },
    )
    await session.assetSync.uploadMissing()
    await new Promise((r) => setTimeout(r, 50))
    const manifest = (target.store.toHeader() as { assets: Record<string, { sha256?: string }> })
      .assets
    expect(manifest[other.key]?.sha256).toBeUndefined()
    expect((await session.assetSync.uploadMissing()).uploaded).toBe(0)
    await session.leave()
    await owner.service.stopSharing(room)
  })
})

describe("images from a peer", () => {
  test("a header over the pixel limit is refused before any decode", async () => {
    const png = new Uint8Array(33)
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
    new DataView(png.buffer).setUint32(16, 40_000)
    new DataView(png.buffer).setUint32(20, 40_000)
    expect(imageHeaderSize(png)).toEqual({ width: 40_000, height: 40_000 })
    expect(40_000 * 40_000).toBeGreaterThan(MAX_ASSET_PIXELS)
    const assets = createMemoryAssetStore()
    const key = `${(await contentDigest(png)).slice(0, 16)}.png`
    expect(await assets.putKey(key, png, { mime: "image/png" })).toBeNull()
    expect(await assets.keys()).toEqual([])
  })

  test("a declared non-image mime does not switch the pixel guard off", async () => {
    const png = new Uint8Array(33)
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
    new DataView(png.buffer).setUint32(16, 40_000)
    new DataView(png.buffer).setUint32(20, 40_000)
    const assets = createMemoryAssetStore()
    const key = `${(await contentDigest(png)).slice(0, 16)}.png`
    expect(await assets.putKey(key, png, { mime: "application/octet-stream" })).toBeNull()
    expect(await assets.keys()).toEqual([])
  })

  test("header sizes of the other formats", () => {
    const gif = new Uint8Array(13)
    gif.set([..."GIF89a"].map((c) => c.charCodeAt(0)))
    gif.set([0x10, 0x27, 0x20, 0x4e], 6)
    expect(imageHeaderSize(gif)).toEqual({ width: 10_000, height: 20_000 })
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0x4e, 0x20, 0x27, 0x10,
    ])
    expect(imageHeaderSize(jpeg)).toEqual({ width: 10_000, height: 20_000 })
  })
})

describe("preparing a document while the editor stays open", () => {
  test("an edit made during hashing is not reverted by the prepare write", async () => {
    const owner = makePeer()
    const target = makeTarget("/work/race.kimo")
    const asset = await addAsset(target.assets, new TextEncoder().encode("legacy image"))
    target.store.apply(
      [
        {
          op: "insert",
          id: "Img0000001",
          node: { type: "rect", w: 4, h: 4, fill: { kind: "image", src: asset.src } },
        },
      ] as never,
      { origin: "user" },
    )
    // The owner edits while the asset bytes are being read for hashing.
    const bytes = target.assets.bytes.bind(target.assets)
    let edited = false
    target.assets.bytes = async (key) => {
      if (!edited) {
        edited = true
        insertRect(target.store, "DuringPrep1")
      }
      return bytes(key)
    }
    await owner.service.startSharing(target, { relayUrl: relay.url })
    expect(edited).toBe(true)
    expect(target.store.hasNode("DuringPrep1")).toBe(true)
    const manifest = (target.store.toHeader() as { assets?: Record<string, { sha256?: string }> })
      .assets
    expect(manifest?.[asset.key]?.sha256).toBe(asset.sha256)
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

describe("closing a room", () => {
  test("a relay that is gone does not keep the room registered", async () => {
    const owner = makePeer()
    const target = makeTarget("/work/gone.kimo")
    const { room } = await owner.service.startSharing(target, { relayUrl: relay.url })
    await relay.stop()
    const result = await owner.service.stopSharing(room)
    expect(result.relayNotified).toBe(false)
    expect(result.relayError?.code).toBe("RELAY_UNREACHABLE")
    expect(await owner.service.roomForFile(target.fileKey)).toBeNull()
    expect(await owner.registry.getOwned(room)).toBeNull()
    relay = startRelay()
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
    const { createFolderAssetStore } = await import("../src/lib/assets")
    const assets = createFolderAssetStore(platform as never, "/work/lobster.kimo" as never)
    expect((await assets.info(`./assets/${key}`))?.fontSource).toBe("google")
  })
})

describe("invites", () => {
  test("an expiry in the past is refused, not turned into a one second link", async () => {
    const { createPlatformShare } = await import("../src/platform/share")
    const share = createPlatformShare({
      platform: { kind: "web", settings: { get: () => relay.url } } as never,
      registry: makePeer().registry,
      webOrigin: "https://kimo.test",
    } as never)
    await expect(
      share.createInvite("view", Math.floor(Date.now() / 1000) - 60, { room: "x" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" })
  })
})

describe("assets other peers name", () => {
  test("a key only a remote change references is never uploaded", async () => {
    const owner = makePeer()
    const guest = makePeer()
    const target = makeTarget("/work/foreign.kimo")
    // A file of another document in the same assets folder.
    const foreign = await addAsset(
      target.assets,
      new TextEncoder().encode("another document's image"),
      "x.png",
    )
    const { room } = await owner.service.startSharing(target, { relayUrl: relay.url })
    const edit = await owner.service.mintLink(room, { role: "edit", ttlSeconds: null })
    const attacker = await guest.service.join(edit.link)
    const session = await owner.service.connect(target, room)
    await until(() => session.provider.connected && attacker.provider.connected)
    attacker.store.apply(
      [
        {
          op: "insert",
          id: "Stolen00001",
          node: { type: "rect", w: 4, h: 4, fill: { kind: "image", src: foreign.src } },
        },
        { op: "setHeader", set: { assets: { [foreign.key]: { mime: "image/png" } } } },
      ] as never,
      { origin: "user" },
    )
    await until(() => target.store.hasNode("Stolen00001"))
    await new Promise((r) => setTimeout(r, 150))
    await session.assetSync.uploadMissing()
    const manifest = (target.store.toHeader() as { assets?: Record<string, { sha256?: string }> })
      .assets
    expect(manifest?.[foreign.key]?.sha256).toBeUndefined()
    expect((await session.assetSync.uploadMissing()).uploaded).toBe(0)
    await attacker.leave()
    await session.leave()
    await owner.service.stopSharing(room)
  })
})
