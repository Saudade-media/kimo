/** Asset sync through the real relay: what is uploaded, what a guest accepts, and what stays out. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  contentDigest,
  createMemoryAssetStore,
  imageHeaderSize,
  MAX_ASSET_PIXELS,
} from "../../src/lib/assets"
import {
  addAsset,
  insertRect,
  makePeer,
  makeTarget,
  type Relay,
  startRelay,
  until,
} from "./helpers"

let relay: Relay
beforeEach(() => {
  relay = startRelay()
})
afterEach(async () => {
  await relay.stop()
})

const bytesOf = (text: string) => new TextEncoder().encode(text)

/** A fetch that records blob PUTs and can corrupt blob downloads. */
function spyFetch(options: { corrupt?: boolean } = {}) {
  const puts: string[] = []
  const impl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    const method = init?.method ?? "GET"
    if (method === "PUT" && url.includes("/blob/")) puts.push(url)
    const response = await fetch(input, init)
    if (options.corrupt && method === "GET" && url.includes("/blob/")) {
      const body = new Uint8Array(await response.arrayBuffer())
      body[body.length - 1] = (body[body.length - 1] as number) ^ 0xff
      return new Response(body, { status: response.status, headers: response.headers })
    }
    return response
  }) as typeof fetch
  return { puts, fetch: impl }
}

function manifestOf(target: ReturnType<typeof makeTarget>) {
  return (target.store.toHeader() as { assets?: Record<string, { sha256?: string }> }).assets ?? {}
}

/** Adds the asset to the store and to a document that references it with a manifest entry. */
function reference(target: ReturnType<typeof makeTarget>, asset: { key: string; src: string }) {
  const result = target.store.apply(
    [
      {
        op: "insert",
        id: `Img${asset.key.slice(0, 8)}`,
        node: { type: "rect", w: 4, h: 4, fill: { kind: "image", src: asset.src } },
      },
      {
        op: "setHeader",
        set: { assets: { ...manifestOf(target), [asset.key]: { mime: "image/png" } } },
      },
    ] as never,
    { origin: "user" },
  )
  expect(result.ok).toBe(true)
}

describe("asset sync", () => {
  test("sharing backfills sha256, uploads only what the relay lacks, and a guest fetches on demand", async () => {
    const spy = spyFetch()
    const owner = makePeer({ fetch: spy.fetch })
    const guest = makePeer()
    const target = makeTarget()
    const first = await addAsset(target.assets, bytesOf("first image bytes"))
    // A legacy manifest entry: no sha256.
    reference(target, first)
    expect(manifestOf(target)[first.key]?.sha256).toBeUndefined()

    const { room } = await owner.service.startSharing(target, { relayUrl: relay.url })
    expect(manifestOf(target)[first.key]?.sha256).toBe(first.sha256)
    await until(() => spy.puts.length === 1)

    // A second asset added later uploads alone; the first is not sent again.
    const second = await addAsset(target.assets, bytesOf("second image bytes"), "b.png")
    reference(target, second)
    // The sharing client backfills the sha256 itself (spec §16.4), then uploads.
    await until(() => manifestOf(target)[second.key]?.sha256 === second.sha256)
    await until(() => spy.puts.length === 2)
    expect(new Set(spy.puts).size).toBe(2)

    const link = await owner.service.mintLink(room, { role: "view", ttlSeconds: null })
    const session = await guest.service.join(link.link)
    const guestAssets = session.assets
    expect(await guest.guests[0]?.assets.bytes(first.key)).toBeNull()
    // First read is a miss that kicks off the fetch; the bytes arrive through putKey.
    expect(await guestAssets.bytes(first.key)).toBeNull()
    await until(async () => (await guestAssets.bytes(first.key)) !== null)
    expect(new TextDecoder().decode((await guestAssets.bytes(first.key)) as Uint8Array)).toBe(
      "first image bytes",
    )
    expect(session.assetSync.state(first.key)).toBe("local")
    await session.leave()
    await owner.service.stopSharing(room)
  })

  test("a blob the uploader has not finished yet is asked for again until it arrives", async () => {
    // The PUT of the second image is held back while its node and manifest entry already travel.
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const held = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      if (init?.method === "PUT" && url.includes("/blob/")) await gate
      return fetch(input, init)
    }) as typeof fetch
    const owner = makePeer({ fetch: held, missingRetry: [20, 80] })
    const guest = makePeer({ missingRetry: [20, 80] })
    const target = makeTarget()
    const { room } = await owner.service.startSharing(target, { relayUrl: relay.url })
    const edit = await owner.service.mintLink(room, { role: "edit", ttlSeconds: null })
    const session = await guest.service.join(edit.link)

    const asset = await addAsset(target.assets, bytesOf("pasted later"))
    reference(target, asset)
    await until(() => session.store.hasNode(`Img${asset.key.slice(0, 8)}`))
    // The guest is rendering: the miss asks, gets a 404 and parks in `missing`.
    expect(await session.assets.bytes(asset.key)).toBeNull()
    await until(() => session.assetSync.state(asset.key) === "missing")
    release()
    await until(async () => (await session.assets.bytes(asset.key)) !== null, 8000)
    expect(session.assetSync.state(asset.key)).toBe("local")
    await session.leave()
    await owner.service.stopSharing(room)
  })

  test("a corrupted blob is rejected and never stored", async () => {
    const owner = makePeer()
    const spy = spyFetch({ corrupt: true })
    const guest = makePeer({ fetch: spy.fetch })
    const target = makeTarget()
    const asset = await addAsset(target.assets, bytesOf("honest bytes"))
    reference(target, asset)
    const { room } = await owner.service.startSharing(target, { relayUrl: relay.url })
    const link = await owner.service.mintLink(room, { role: "view", ttlSeconds: null })
    const session = await guest.service.join(link.link)
    expect(await session.assetSync.ensure(asset.key)).toBe(false)
    expect(session.assetSync.state(asset.key)).toBe("failed")
    expect(await guest.guests[0]?.assets.bytes(asset.key)).toBeNull()
    await session.leave()
    await owner.service.stopSharing(room)
  })

  test("sweepBlobs keeps referenced blobs, marks dereferenced ones and never deletes inside the grace", async () => {
    const spy = spyFetch()
    const owner = makePeer({ fetch: spy.fetch })
    const target = makeTarget()
    const kept = await addAsset(target.assets, bytesOf("kept bytes"))
    const dropped = await addAsset(target.assets, bytesOf("dropped bytes"), "d.png")
    reference(target, kept)
    reference(target, dropped)
    const { room } = await owner.service.startSharing(target, { relayUrl: relay.url })
    await until(() => spy.puts.length === 2)
    // Dereference one: its node and manifest entry go away; the relay never deletes on its own.
    const dereferenced = target.store.apply(
      [
        { op: "delete", id: `Img${dropped.key.slice(0, 8)}` },
        { op: "setHeader", set: { assets: { [kept.key]: manifestOf(target)[kept.key] } } },
      ] as never,
      { origin: "user" },
    )
    expect(dereferenced.ok).toBe(true)
    expect(Object.keys(manifestOf(target))).toEqual([kept.key])
    const result = await owner.service.sweepBlobs(room, target)
    expect(result).toMatchObject({ kept: 1, marked: 1, deleted: 0 })
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
  test("a header over the pixel limit is refused before any decode, whatever mime it declares", async () => {
    const png = new Uint8Array(33)
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
    new DataView(png.buffer).setUint32(16, 40_000)
    new DataView(png.buffer).setUint32(20, 40_000)
    expect(imageHeaderSize(png)).toEqual({ width: 40_000, height: 40_000 })
    expect(40_000 * 40_000).toBeGreaterThan(MAX_ASSET_PIXELS)
    const assets = createMemoryAssetStore()
    const key = `${(await contentDigest(png)).slice(0, 16)}.png`
    expect(await assets.putKey(key, png, { mime: "image/png" })).toBeNull()
    // A declared non-image mime does not switch the guard off.
    expect(await assets.putKey(key, png, { mime: "application/octet-stream" })).toBeNull()
    expect(await assets.keys()).toEqual([])
  })

  test("the guard reads GIF and JPEG headers too", () => {
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
