import { describe, expect, test } from "bun:test"
import {
  type BlobAssetStore,
  type BlobManifestEntry,
  type BlobProgress,
  blobIdFor,
  createBlobSync,
  deriveRoomId,
  deriveRoomKeys,
  fromHex,
  generateRoomKey,
  openBlob,
  randomBytes,
  sealBlob,
  sha256,
  toHex,
} from "../../src/mp"

const RELAY = "https://relay.test"

class MemoryAssets implements BlobAssetStore {
  readonly files = new Map<string, Uint8Array>()
  async keys() {
    return [...this.files.keys()]
  }
  async bytes(key: string) {
    return this.files.get(key) ?? null
  }
  async putKey(key: string, bytes: Uint8Array, _entry?: BlobManifestEntry) {
    const sha = toHex(await sha256(bytes))
    if (!key.startsWith(sha.slice(0, 16))) return null
    this.files.set(key, bytes)
    return { src: `./assets/${key}` }
  }
}

interface Fake {
  fetch: typeof fetch
  blobs: Map<string, Uint8Array>
  calls: string[]
  /** Queue of forced statuses for the next PUT/GET calls. */
  fail: { method: string; status: number; code?: string; headers?: Record<string, string> }[]
  inflight: { now: number; max: number }
}

function fakeRelay(room: string): Fake {
  const fake: Fake = {
    blobs: new Map(),
    calls: [],
    fail: [],
    inflight: { now: 0, max: 0 },
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      const method = init?.method ?? "GET"
      fake.calls.push(`${method} ${url.pathname}`)
      fake.inflight.now++
      fake.inflight.max = Math.max(fake.inflight.max, fake.inflight.now)
      try {
        await new Promise((r) => setTimeout(r, 5))
        const forced = fake.fail.findIndex((f) => f.method === method)
        if (forced >= 0) {
          const f = fake.fail.splice(forced, 1)[0]
          if (f)
            return new Response(JSON.stringify({ error: f.code ?? "INTERNAL" }), {
              status: f.status,
              headers: f.headers ?? { "content-type": "application/json" },
            })
        }
        const parts = url.pathname.split("/")
        if (parts[2] !== room) return new Response("{}", { status: 400 })
        const last = parts[3] ?? ""
        if (method === "POST" && last === "missing") {
          const ids = (JSON.parse(String(init?.body)) as { ids: string[] }).ids
          return Response.json({ missing: ids.filter((id) => !fake.blobs.has(id)) })
        }
        if (method === "PUT") {
          const had = fake.blobs.has(last)
          fake.blobs.set(last, new Uint8Array(init?.body as Uint8Array))
          return new Response(null, { status: had ? 200 : 201 })
        }
        const blob = fake.blobs.get(last)
        if (!blob) return Response.json({ error: "NOT_FOUND" }, { status: 404 })
        return new Response(method === "HEAD" ? null : (blob as Uint8Array<ArrayBuffer>), {
          status: 200,
        })
      } finally {
        fake.inflight.now--
      }
    }) as typeof fetch,
  }
  return fake
}

async function setup(concurrency = 2, maxBytes?: number) {
  const roomKey = generateRoomKey()
  const room = await deriveRoomId(randomBytes(32))
  const keys = await deriveRoomKeys(roomKey, room)
  const relay = fakeRelay(room.id)
  const assets = new MemoryAssets()
  const manifest: Record<string, BlobManifestEntry> = {}
  const events: BlobProgress[] = []
  const missing: string[] = []
  const skipped: [string, string][] = []
  const sleeps: number[] = []
  const sync = createBlobSync({
    relayUrl: RELAY,
    room: room.id,
    token: () => "tok",
    roomKey,
    assets,
    manifest: () => manifest,
    fetch: relay.fetch,
    concurrency,
    ...(maxBytes === undefined ? {} : { maxBytes }),
    sleep: async (ms) => {
      sleeps.push(ms)
    },
    random: () => 1,
    onProgress: (e) => events.push(e),
    onMissing: (k) => missing.push(k),
    onSkipped: (k, r) => skipped.push([k, r]),
  })
  async function addLocal(bytes: Uint8Array, ext = "png") {
    const sha = toHex(await sha256(bytes))
    const key = `${sha.slice(0, 16)}.${ext}`
    assets.files.set(key, bytes)
    manifest[key] = { sha256: sha, mime: "image/png", bytes: bytes.length }
    return { key, sha }
  }
  async function addRemote(bytes: Uint8Array, ext = "png") {
    const sha = toHex(await sha256(bytes))
    const key = `${sha.slice(0, 16)}.${ext}`
    manifest[key] = { sha256: sha, mime: "image/png", bytes: bytes.length }
    const sealed = await sealBlob(keys, bytes)
    relay.blobs.set(sealed.id, sealed.envelope)
    return { key, sha, id: sealed.id }
  }
  return {
    roomKey,
    roomId: room.id,
    sync,
    relay,
    assets,
    manifest,
    keys,
    events,
    missing,
    skipped,
    sleeps,
    addLocal,
    addRemote,
  }
}

describe("upload", () => {
  test("uploads only what the relay lacks, as ciphertext under the HMAC id", async () => {
    const t = await setup()
    const a = await t.addLocal(randomBytes(100))
    const b = await t.addLocal(randomBytes(200))
    // b is already on the relay.
    const sealedB = await sealBlob(t.keys, t.assets.files.get(b.key) as Uint8Array)
    t.relay.blobs.set(sealedB.id, sealedB.envelope)
    const result = await t.sync.uploadMissing()
    expect(result).toEqual({ uploaded: 1, skipped: 1, failed: 0 })
    const idA = await blobIdFor(t.keys, fromHex(a.sha))
    const stored = t.relay.blobs.get(idA) as Uint8Array
    expect(await openBlob(t.keys, fromHex(a.sha), stored)).toEqual(
      t.assets.files.get(a.key) as Uint8Array,
    )
    expect(t.relay.calls.filter((c) => c.startsWith("PUT")).length).toBe(1)
    expect(t.events.at(-1)).toMatchObject({
      kind: "upload",
      status: "done",
      completed: 1,
      total: 1,
    })
    // A second run finds nothing missing.
    expect((await t.sync.uploadMissing()).uploaded).toBe(0)
    expect(t.relay.calls.filter((c) => c.startsWith("PUT")).length).toBe(1)
  })

  test("entries without sha256 are skipped; oversized and mismatching files too", async () => {
    const t = await setup()
    const legacy = randomBytes(10)
    const lsha = toHex(await sha256(legacy))
    t.assets.files.set(`${lsha.slice(0, 16)}.png`, legacy)
    t.manifest[`${lsha.slice(0, 16)}.png`] = { mime: "image/png" }
    const bad = await t.addLocal(randomBytes(10))
    t.assets.files.set(bad.key, randomBytes(10))
    const result = await t.sync.uploadMissing()
    expect(result.uploaded).toBe(0)
    expect(t.skipped).toContainEqual([`${lsha.slice(0, 16)}.png`, "no-sha"])
    expect(t.skipped).toContainEqual([bad.key, "hash-mismatch"])

    const big = await setup(2, 50)
    const large = await big.addLocal(randomBytes(51))
    await big.sync.uploadMissing()
    expect(big.skipped).toContainEqual([large.key, "too-large"])
    expect(big.relay.calls.some((c) => c.startsWith("PUT"))).toBe(false)
  })

  test("concurrency is limited", async () => {
    const t = await setup(2)
    for (let i = 0; i < 6; i++) await t.addLocal(randomBytes(64))
    const result = await t.sync.uploadMissing()
    expect(result.uploaded).toBe(6)
    expect(t.relay.inflight.max).toBeLessThanOrEqual(2)
    expect(t.relay.inflight.max).toBe(2)
  })

  test("retries 429 and 5xx with back-off honoring retry-after", async () => {
    const t = await setup()
    await t.addLocal(randomBytes(64))
    t.relay.fail.push(
      {
        method: "PUT",
        status: 429,
        code: "RATE_LIMITED",
        headers: { "content-type": "application/json", "retry-after": "3" },
      },
      { method: "PUT", status: 500, code: "INTERNAL" },
    )
    const result = await t.sync.uploadMissing()
    expect(result).toEqual({ uploaded: 1, skipped: 0, failed: 0 })
    expect(t.sleeps.length).toBe(2)
    expect(t.sleeps[0]).toBe(3000)
    expect(t.sleeps[1]).toBe(500)
  })

  test("413 and 507 skip the blob; the run continues", async () => {
    const t = await setup(1)
    const a = await t.addLocal(randomBytes(64))
    const b = await t.addLocal(randomBytes(65))
    t.relay.fail.push({ method: "PUT", status: 507, code: "QUOTA_EXCEEDED" })
    const result = await t.sync.uploadMissing()
    expect(result.uploaded).toBe(1)
    expect(result.skipped).toBe(1)
    expect(t.skipped.map(([, r]) => r)).toEqual(["quota"])
    expect([a.key, b.key]).toContain(t.skipped[0]?.[0] as string)

    const t2 = await setup(1)
    await t2.addLocal(randomBytes(64))
    await t2.addLocal(randomBytes(65))
    t2.relay.fail.push({ method: "PUT", status: 413, code: "TOO_LARGE" })
    const r2 = await t2.sync.uploadMissing()
    expect(r2).toEqual({ uploaded: 1, skipped: 1, failed: 0 })
    expect(t2.skipped.map(([, r]) => r)).toEqual(["too-large"])
  })

  test("bytes gone from the store are not-local, and a key sharing the content is tried next", async () => {
    const t = await setup(1)
    const bytes = randomBytes(64)
    const a = await t.addLocal(bytes, "png")
    const b = await t.addLocal(bytes, "jpg")
    const gone = await t.addLocal(randomBytes(70))
    // keys() lists them, but the first key's bytes vanish before the read.
    const real = t.assets.bytes.bind(t.assets)
    t.assets.bytes = async (key: string) => (key === a.key || key === gone.key ? null : real(key))
    const result = await t.sync.uploadMissing()
    expect(result.uploaded).toBe(1)
    expect(t.skipped).toContainEqual([a.key, "not-local"])
    expect(t.skipped).toContainEqual([gone.key, "not-local"])
    expect(t.skipped.some(([, r]) => r === "no-sha")).toBe(false)
    // uploaded + skipped + failed covers all three candidates.
    expect(result.uploaded + result.skipped + result.failed).toBe(3)
    expect(b.key).toBeDefined()
  })

  test("overlapping uploadMissing calls never upload the same blob twice", async () => {
    const t = await setup()
    for (let i = 0; i < 4; i++) await t.addLocal(randomBytes(64))
    const [r1, r2, r3] = await Promise.all([
      t.sync.uploadMissing(),
      t.sync.uploadMissing(),
      t.sync.uploadMissing(),
    ])
    expect(r1.uploaded).toBe(4)
    expect(r2.uploaded + r3.uploaded).toBe(0)
    expect(t.relay.calls.filter((c) => c.startsWith("PUT")).length).toBe(4)
  })

  test("a call made as the first run settles joins the queued follow-up instead of starting a third run", async () => {
    const t = await setup(1)
    await t.addLocal(randomBytes(64))
    const a = t.sync.uploadMissing()
    const b = t.sync.uploadMissing()
    // Runs when run 1 settles, between its clear and the follow-up start.
    const c = a.then(() => t.sync.uploadMissing())
    await Promise.all([a, b, c])
    expect(t.relay.calls.filter((x) => x.startsWith("POST")).length).toBe(2)
    expect(t.relay.inflight.max).toBe(1)
    expect(t.relay.calls.filter((x) => x.startsWith("PUT")).length).toBe(1)
  })

  test("a rate-limited upload sleeps outside the pool, so ensure still fetches", async () => {
    const roomKey = generateRoomKey()
    const room = await deriveRoomId(randomBytes(32))
    const keys = await deriveRoomKeys(roomKey, room)
    const relay = fakeRelay(room.id)
    const assets = new MemoryAssets()
    const manifest: Record<string, BlobManifestEntry> = {}
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => {
      release = r
    })
    let sleeping = false
    const sync = createBlobSync({
      relayUrl: RELAY,
      room: room.id,
      token: () => "t",
      roomKey,
      assets,
      manifest: () => manifest,
      fetch: relay.fetch,
      concurrency: 1,
      sleep: () => {
        sleeping = true
        return gate
      },
      random: () => 1,
    })
    const local = randomBytes(64)
    const lsha = toHex(await sha256(local))
    assets.files.set(`${lsha.slice(0, 16)}.png`, local)
    manifest[`${lsha.slice(0, 16)}.png`] = { sha256: lsha }
    const remote = randomBytes(64)
    const rsha = toHex(await sha256(remote))
    const rkey = `${rsha.slice(0, 16)}.png`
    manifest[rkey] = { sha256: rsha }
    const sealed = await sealBlob(keys, remote)
    relay.blobs.set(sealed.id, sealed.envelope)
    relay.fail.push({
      method: "PUT",
      status: 429,
      code: "RATE_LIMITED",
      headers: { "content-type": "application/json", "retry-after": "30" },
    })
    const upload = sync.uploadMissing()
    while (!sleeping) await new Promise((r) => setTimeout(r, 1))
    expect(await sync.ensure(rkey)).toBe(true)
    release()
    expect((await upload).uploaded).toBe(1)
  })

  test("a retry-after up to a minute is honoured; one beyond the cap fails the attempt instead of sleeping", async () => {
    const rateLimited = (retryAfter: string) => ({
      method: "PUT",
      status: 429,
      code: "RATE_LIMITED",
      headers: { "content-type": "application/json", "retry-after": retryAfter },
    })
    const t = await setup()
    await t.addLocal(randomBytes(64))
    t.relay.fail.push(rateLimited("61"))
    expect(await t.sync.uploadMissing()).toEqual({ uploaded: 1, skipped: 0, failed: 0 })
    expect(Math.max(...t.sleeps)).toBeGreaterThanOrEqual(61_000)

    const t2 = await setup()
    await t2.addLocal(randomBytes(64))
    t2.relay.fail.push(rateLimited("1000000"))
    expect(await t2.sync.uploadMissing()).toEqual({ uploaded: 0, skipped: 0, failed: 1 })
    expect(t2.sleeps).toEqual([])
  })

  test.each(["ROOM_CLOSED", "VIEW_ONLY"])(
    "a room-wide %s refusal ends the run after one PUT",
    async (code) => {
      const t = await setup(1)
      await t.addLocal(randomBytes(64))
      await t.addLocal(randomBytes(65))
      await t.addLocal(randomBytes(66))
      t.relay.fail.push({ method: "PUT", status: code === "ROOM_CLOSED" ? 410 : 403, code })
      await expect(t.sync.uploadMissing()).rejects.toMatchObject({ code })
      expect(t.relay.calls.filter((c) => c.startsWith("PUT")).length).toBe(1)
    },
  )
})

describe("ensure", () => {
  test("fetches, decrypts, verifies and stores; state goes fetching then local", async () => {
    const t = await setup()
    const bytes = randomBytes(300)
    const { key } = await t.addRemote(bytes)
    const states: string[] = []
    t.sync.subscribe(() => states.push(t.sync.state(key)))
    expect(t.sync.state(key)).toBe("unknown")
    expect(await t.sync.ensure(key)).toBe(true)
    expect(t.assets.files.get(key)).toEqual(bytes)
    expect(states).toEqual(["fetching", "local"])
    // Already local: no second request.
    const gets = t.relay.calls.length
    expect(await t.sync.ensure(key)).toBe(true)
    expect(t.relay.calls.length).toBe(gets)
  })

  test("concurrent ensure calls share one request", async () => {
    const t = await setup()
    const { key } = await t.addRemote(randomBytes(40))
    const results = await Promise.all([t.sync.ensure(key), t.sync.ensure(key), t.sync.ensure(key)])
    expect(results).toEqual([true, true, true])
    expect(t.relay.calls.filter((c) => c.startsWith("GET")).length).toBe(1)
  })

  test("a 404 is state missing; retryMissing refetches it after the owner uploads (catch-up)", async () => {
    const t = await setup()
    const bytes = randomBytes(40)
    const sha = toHex(await sha256(bytes))
    const key = `${sha.slice(0, 16)}.png`
    t.manifest[key] = { sha256: sha }
    expect(await t.sync.ensure(key)).toBe(false)
    expect(t.missing).toEqual([key])
    expect(await t.sync.retryMissing()).toEqual([])
    expect(t.sync.state(key)).toBe("missing")
    const sealed = await sealBlob(t.keys, bytes)
    t.relay.blobs.set(sealed.id, sealed.envelope)
    expect(await t.sync.retryMissing()).toEqual([key])
    expect(t.sync.state(key)).toBe("local")
    expect(await t.sync.retryMissing()).toEqual([])
  })

  test("the peer-declared mime and bytes are not forwarded to the store", async () => {
    const t = await setup()
    const { key, sha } = await t.addRemote(randomBytes(40))
    t.manifest[key] = { sha256: sha, mime: "application/octet-stream", bytes: 1, name: "x.png" }
    const seen: (BlobManifestEntry | undefined)[] = []
    const real = t.assets.putKey.bind(t.assets)
    t.assets.putKey = async (k, b, entry) => {
      seen.push(entry)
      return real(k, b)
    }
    expect(await t.sync.ensure(key)).toBe(true)
    expect(seen).toEqual([{ name: "x.png", sha256: sha }])
  })

  test("a corrupted or swapped blob is rejected and nothing is stored", async () => {
    const t = await setup()
    const { key, id } = await t.addRemote(randomBytes(40))
    const env = t.relay.blobs.get(id) as Uint8Array
    const bad = env.slice()
    bad[bad.length - 1] = (bad[bad.length - 1] as number) ^ 1
    t.relay.blobs.set(id, bad)
    expect(await t.sync.ensure(key)).toBe(false)
    expect(t.sync.state(key)).toBe("failed")
    expect(t.assets.files.has(key)).toBe(false)

    // A valid blob of other content served under this id was sealed under another per-blob key,
    // so it fails to decrypt.
    const other = await sealBlob(t.keys, randomBytes(40))
    t.relay.blobs.set(id, other.envelope)
    expect(await t.sync.ensure(key)).toBe(false)
    expect(t.assets.files.has(key)).toBe(false)
  })

  test("a store that rejects the bytes is BLOB_INTEGRITY and state failed", async () => {
    const t = await setup()
    const { key } = await t.addRemote(randomBytes(40))
    const errors: unknown[] = []
    t.assets.putKey = async () => null
    const sync = createBlobSync({
      relayUrl: RELAY,
      room: t.roomId,
      token: () => "t",
      roomKey: t.roomKey,
      assets: t.assets,
      manifest: () => t.manifest,
      fetch: t.relay.fetch,
      onError: (_k, e) => errors.push(e),
    })
    expect(await sync.ensure(key)).toBe(false)
    expect(sync.state(key)).toBe("failed")
    expect((errors[0] as { code: string }).code).toBe("BLOB_INTEGRITY")
  })

  test("a response larger than the cap is cut off by content-length or while streaming", async () => {
    const t = await setup()
    const { key } = await t.addRemote(randomBytes(40))
    const errors: unknown[] = []
    const make = (fetchImpl: typeof fetch) =>
      createBlobSync({
        relayUrl: RELAY,
        room: t.roomId,
        token: () => "t",
        roomKey: t.roomKey,
        assets: t.assets,
        manifest: () => t.manifest,
        fetch: fetchImpl,
        maxBytes: 100,
        onError: (_k, e) => errors.push(e),
      })
    let pulled = 0
    const declared = (async () =>
      new Response("x", { headers: { "content-length": "999999999" } })) as unknown as typeof fetch
    expect(await make(declared).ensure(key)).toBe(false)
    const streaming = (async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            if (pulled >= 100) return controller.close()
            pulled++
            controller.enqueue(new Uint8Array(64))
          },
        }),
      )) as unknown as typeof fetch
    expect(await make(streaming).ensure(key)).toBe(false)
    expect(errors.map((e) => (e as { code: string }).code)).toEqual(["TOO_LARGE", "TOO_LARGE"])
    expect(pulled).toBeLessThan(10)
  })

  test("retries transient failures, then gives up as failed", async () => {
    const t = await setup()
    const { key } = await t.addRemote(randomBytes(40))
    t.relay.fail.push({ method: "GET", status: 503, code: "ROOM_FULL" })
    expect(await t.sync.ensure(key)).toBe(true)
    expect(t.sleeps.length).toBe(1)

    const t2 = await setup()
    const r = await t2.addRemote(randomBytes(40))
    for (let i = 0; i < 5; i++) t2.relay.fail.push({ method: "GET", status: 500 })
    expect(await t2.sync.ensure(r.key)).toBe(false)
    expect(t2.sync.state(r.key)).toBe("failed")
    expect(t2.sleeps.length).toBe(4)
  })
})
