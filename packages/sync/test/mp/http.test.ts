import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import {
  DEFAULT_LIMITS,
  MultiplayerError,
  type OwnerDevice,
  PROTOCOL,
  parseRetryAfter,
  RelayHttpClient,
  toBase64Url,
} from "../../src/mp"
import { expectCode } from "./helpers"

const ROOM = "5jbqciof3sh24vopwga56zxa5n5o4u3r"
const BLOB = "ab".repeat(32)
const TOKEN = "AQECAQ-token_"

interface Seen {
  method: string
  path: string
  search: string
  headers: Headers
  body: Uint8Array
}

let server: ReturnType<typeof Bun.serve>
let relayUrl: string
const seen: Seen[] = []
let route: (req: Request, url: URL, body: Uint8Array) => Response | Promise<Response>

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  })

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url)
      const body = new Uint8Array(await req.arrayBuffer())
      seen.push({
        method: req.method,
        path: url.pathname,
        search: url.search,
        headers: req.headers,
        body,
      })
      return route(req, url, body)
    },
  })
  relayUrl = `http://127.0.0.1:${server.port}`
})

afterAll(() => {
  server.stop(true)
})

function client(timeoutMs?: number) {
  seen.length = 0
  return new RelayHttpClient(timeoutMs === undefined ? { relayUrl } : { relayUrl, timeoutMs })
}

const versionBody = {
  name: "@kimo/server",
  version: "2.0.0",
  protocol: PROTOCOL,
  limits: DEFAULT_LIMITS,
  relayId: toBase64Url(new Uint8Array(16).fill(7)),
  owner: "claimed",
}

const DEVICE = toBase64Url(new Uint8Array(32).fill(1))
const device: OwnerDevice = {
  pub: DEVICE,
  name: "Mac",
  addedAt: 1_792_000_000_000,
  addedBy: null,
  via: "env",
}

describe("RelayHttpClient", () => {
  test("normalizes the relay URL", () => {
    expect(new RelayHttpClient({ relayUrl: "ws://localhost:8787/" }).relayUrl).toBe(
      "http://localhost:8787",
    )
    expect(() => new RelayHttpClient({ relayUrl: "http://example.com" })).toThrow(MultiplayerError)
  })

  test("probe reads /version", async () => {
    route = () => json(200, versionBody)
    const info = await client().probe()
    expect(info).toEqual({
      relayUrl,
      ...versionBody,
      protocol: "kimo-mp/1",
      relayId: new Uint8Array(16).fill(7),
      owner: "claimed",
    })
    expect(seen[0]).toMatchObject({ method: "GET", path: "/version" })
    expect(seen[0]?.headers.get("authorization")).toBeNull()
  })

  test("probe: NOT_A_RELAY for other servers, RELAY_UNREACHABLE when down", async () => {
    for (const respond of [
      () => new Response("<html>hi</html>", { status: 200 }),
      () => json(200, { ...versionBody, protocol: "kimo-mp/2" }),
      () => json(200, { ...versionBody, limits: { maxEntryBytes: 1 } }),
      () => json(200, { ...versionBody, relayId: undefined }),
      () => json(200, { ...versionBody, relayId: toBase64Url(new Uint8Array(15)) }),
      () => json(200, { ...versionBody, owner: undefined }),
      () => json(200, { ...versionBody, owner: "yours" }),
      () => json(200, [1, 2]),
      () => new Response("nope", { status: 404 }),
      () => json(400, { error: "BAD_REQUEST", message: "?" }),
    ]) {
      route = respond
      await expectCode(client().probe(), "NOT_A_RELAY")
    }
    route = () => new Response("bad gateway", { status: 502 })
    await expectCode(client().probe(), "RELAY_UNREACHABLE")
    const closed = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() })
    const port = closed.port
    closed.stop(true)
    await expectCode(
      new RelayHttpClient({ relayUrl: `http://127.0.0.1:${port}` }).probe(),
      "RELAY_UNREACHABLE",
    )
  })

  test("admin posts the command bytes", async () => {
    route = () => json(201, { room: ROOM, kid: 1 })
    const c = client()
    const command = new Uint8Array([1, 3, 1, 0, 9, 9])
    expect(await c.admin(ROOM, command)).toEqual({ room: ROOM, kid: 1 })
    expect(seen[0]?.method).toBe("POST")
    expect(seen[0]?.path).toBe(`/room/${ROOM}/admin`)
    expect(seen[0]?.headers.get("content-type")).toBe("application/octet-stream")
    expect(seen[0]?.body).toEqual(command)
  })

  test("owner posts the command bytes and reads 201, 200 and {}", async () => {
    const command = new Uint8Array([1, 4, 1, 0, 9, 9])
    route = () => json(201, { devices: [device] })
    expect(await client().owner(command)).toEqual({ status: 201, devices: [device] })
    expect(seen[0]).toMatchObject({ method: "POST", path: "/owner" })
    expect(seen[0]?.headers.get("content-type")).toBe("application/octet-stream")
    expect(seen[0]?.body).toEqual(command)
    route = () => json(200, { devices: [device, { ...device, via: "pair", addedBy: DEVICE }] })
    expect((await client().owner(command)).status).toBe(200)
    route = () => json(200, {})
    expect(await client().owner(command)).toEqual({ status: 200, devices: null })
    route = () => json(200, { devices: [{ ...device, via: "secret" }] })
    await expectCode(client().owner(command), "INTERNAL")
  })

  test("owner maps the ownership error codes", async () => {
    for (const [status, code] of [
      [403, "RELAY_UNCLAIMED"],
      [403, "NOT_OWNER"],
      [401, "PAIRING_EXPIRED"],
      [409, "PAIRING_USED"],
      [409, "RELAY_CLAIMED"],
      [409, "LAST_DEVICE"],
    ] as const) {
      route = () => json(status, { error: code, message: "x" })
      await expectCode(client().owner(new Uint8Array(1)), code)
    }
  })

  test("JSON error bodies map to their code; retry-after to retryAfterMs", async () => {
    route = () => json(429, { error: "RATE_LIMITED", message: "slow" }, { "retry-after": "3" })
    try {
      await client().admin(ROOM, new Uint8Array(1))
      throw new Error("expected failure")
    } catch (error) {
      expect(error).toBeInstanceOf(MultiplayerError)
      const e = error as MultiplayerError
      expect(e.code).toBe("RATE_LIMITED")
      expect(e.message).toBe("slow")
      expect(e.retryAfterMs).toBe(3000)
    }
    for (const [status, code] of [
      [401, "TOKEN_EXPIRED"],
      [403, "NOT_OWNER"],
      [409, "NONCE_REPLAY"],
      [422, "ROOM_ID_MISMATCH"],
      [503, "RELAY_FULL"],
    ] as const) {
      route = () => json(status, { error: code, message: "x" })
      await expectCode(client().admin(ROOM, new Uint8Array(1)), code)
    }
  })

  test("errors without a JSON body map from the status", async () => {
    for (const [status, code] of [
      [400, "BAD_REQUEST"],
      [401, "AUTH_INVALID"],
      [413, "TOO_LARGE"],
      [429, "RATE_LIMITED"],
      [500, "INTERNAL"],
      [503, "RELAY_UNREACHABLE"],
      [507, "QUOTA_EXCEEDED"],
    ] as const) {
      route = () => new Response("plain", { status })
      await expectCode(client().roomInfo(ROOM, TOKEN), code)
    }
    route = () => json(500, { error: "SOMETHING_NEW", message: "?" })
    await expectCode(client().roomInfo(ROOM, TOKEN), "INTERNAL")
  })

  test("roomInfo sends the bearer token in a header, never in the URL", async () => {
    const body = {
      room: ROOM,
      kid: 2,
      head: 10,
      base: 4,
      snapshot: { upTo: 4, gen: 1, bytes: 100 },
      usedBytes: 500,
      quotaBytes: 1000,
      peers: 2,
    }
    route = () => json(200, body)
    expect(await client().roomInfo(ROOM, TOKEN)).toEqual(body)
    expect(seen[0]?.headers.get("authorization")).toBe(`Bearer ${TOKEN}`)
    expect(seen[0]?.path + (seen[0]?.search ?? "")).not.toContain(TOKEN)
    route = () => json(200, { ...body, snapshot: null })
    expect((await client().roomInfo(ROOM, TOKEN)).snapshot).toBeNull()
    route = () => json(200, { ...body, head: "10" })
    await expectCode(client().roomInfo(ROOM, TOKEN), "INTERNAL")
  })

  test("getSnapshot parses headers; null on NOT_FOUND; ROOM_NOT_FOUND throws", async () => {
    const envelope = new Uint8Array([1, 2, 3, 4, 5])
    route = () =>
      new Response(envelope, {
        headers: {
          "content-type": "application/octet-stream",
          "kimo-up-to": "42",
          "kimo-gen": "3",
        },
      })
    expect(await client().getSnapshot(ROOM, TOKEN)).toEqual({ upTo: 42, gen: 3, envelope })
    route = () => json(404, { error: "NOT_FOUND", message: "no snapshot" })
    expect(await client().getSnapshot(ROOM, TOKEN)).toBeNull()
    route = () => json(404, { error: "ROOM_NOT_FOUND", message: "?" })
    await expectCode(client().getSnapshot(ROOM, TOKEN), "ROOM_NOT_FOUND")
    route = () => new Response(envelope, { headers: { "kimo-up-to": "x", "kimo-gen": "1" } })
    await expectCode(client().getSnapshot(ROOM, TOKEN), "INTERNAL")
  })

  test("putSnapshot sends upTo and carries", async () => {
    route = () => json(201, { gen: 5, upTo: 9 })
    const c = client()
    const envelope = new Uint8Array([7, 7, 7])
    expect(await c.putSnapshot(ROOM, TOKEN, 9, envelope)).toEqual({ gen: 5, upTo: 9 })
    expect(seen[0]).toMatchObject({
      method: "PUT",
      path: `/room/${ROOM}/snapshot`,
      search: "?upTo=9",
    })
    expect(seen[0]?.body).toEqual(envelope)
    await c.putSnapshot(ROOM, TOKEN, 0, envelope, { carries: true })
    expect(seen[1]?.search).toBe("?upTo=0&carries=1")
    route = () => json(409, { error: "SNAPSHOT_STALE", message: "old" })
    await expectCode(c.putSnapshot(ROOM, TOKEN, 1, envelope), "SNAPSHOT_STALE")
    await expectCode(c.putSnapshot(ROOM, TOKEN, -1, envelope), "BAD_REQUEST")
  })

  test("blobs: put, head, get, missing", async () => {
    const stored = new Map<string, Uint8Array>()
    route = (req, url, body) => {
      const id = url.pathname.split("/")[3] as string
      if (url.pathname.endsWith("/missing")) {
        const { ids } = JSON.parse(new TextDecoder().decode(body)) as { ids: string[] }
        return json(200, { missing: ids.filter((i) => !stored.has(i)) })
      }
      if (req.method === "PUT") {
        if (stored.has(id)) return new Response(null, { status: 200 })
        stored.set(id, body)
        return new Response(null, { status: 201 })
      }
      const bytes = stored.get(id)
      if (!bytes)
        return req.method === "HEAD"
          ? new Response(null, { status: 404 })
          : json(404, { error: "NOT_FOUND", message: "no blob" })
      return new Response(bytes as Uint8Array<ArrayBuffer>, {
        headers: { "content-length": String(bytes.length) },
      })
    }
    const c = client()
    const envelope = new Uint8Array([4, 4, 4, 4])
    expect(await c.hasBlob(ROOM, TOKEN, BLOB)).toBe(false)
    expect(await c.getBlob(ROOM, TOKEN, BLOB)).toBeNull()
    expect(await c.putBlob(ROOM, TOKEN, BLOB, envelope)).toBe("created")
    expect(await c.putBlob(ROOM, TOKEN, BLOB, envelope)).toBe("exists")
    expect(await c.hasBlob(ROOM, TOKEN, BLOB)).toBe(true)
    expect(await c.getBlob(ROOM, TOKEN, BLOB)).toEqual(envelope)
    const other = "cd".repeat(32)
    expect(await c.missingBlobs(ROOM, TOKEN, [BLOB, other])).toEqual([other])
    expect(await c.missingBlobs(ROOM, TOKEN, [])).toEqual([])
    const put = seen.find((s) => s.method === "PUT")
    expect(put?.path).toBe(`/blob/${ROOM}/${BLOB}`)
    expect(put?.headers.get("authorization")).toBe(`Bearer ${TOKEN}`)
  })

  test("missingBlobs batches 1000 ids per request", async () => {
    route = (_req, _url, body) => {
      const { ids } = JSON.parse(new TextDecoder().decode(body)) as { ids: string[] }
      return json(200, { missing: ids.slice(0, 1) })
    }
    const ids = Array.from({ length: 2500 }, (_, i) => i.toString(16).padStart(64, "0"))
    const c = client()
    const missing = await c.missingBlobs(ROOM, TOKEN, ids)
    expect(seen.length).toBe(3)
    expect(missing).toEqual([ids[0], ids[1000], ids[2000]] as string[])
  })

  test("invalid room or blob ids never reach the network", async () => {
    const c = client()
    await expectCode(c.roomInfo("../etc", TOKEN), "BAD_REQUEST")
    await expectCode(c.getBlob(ROOM, TOKEN, "../../x"), "BAD_REQUEST")
    await expectCode(c.missingBlobs(ROOM, TOKEN, ["nope"]), "BAD_REQUEST")
    expect(seen.length).toBe(0)
  })

  test("timeouts are RELAY_UNREACHABLE", async () => {
    route = async () => {
      await Bun.sleep(300)
      return json(200, versionBody)
    }
    const started = Date.now()
    await expectCode(client(50).probe(), "RELAY_UNREACHABLE")
    expect(Date.now() - started).toBeLessThan(250)
  })

  test("a slow but steady body is not cut off by the request timeout", async () => {
    const envelope = new Uint8Array(40).fill(7)
    route = () => {
      let sent = 0
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (sent === 4) return controller.close()
          await Bun.sleep(60)
          controller.enqueue(envelope.subarray(sent * 10, ++sent * 10))
        },
      })
      return new Response(body, {
        headers: { "kimo-up-to": "1", "kimo-gen": "1", "content-length": "40" },
      })
    }
    const started = Date.now()
    // 4 chunks 60 ms apart take longer than timeoutMs, but no gap does.
    const got = await client(150).getSnapshot(ROOM, TOKEN)
    expect(Date.now() - started).toBeGreaterThan(150)
    expect(got?.envelope).toEqual(envelope)
    const blob = await client(150).getBlob(ROOM, TOKEN, BLOB)
    expect(blob).toEqual(envelope)
  })

  test("a body that stalls is RELAY_UNREACHABLE", async () => {
    route = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          async pull(controller) {
            controller.enqueue(new Uint8Array(4))
            await Bun.sleep(500)
          },
        }),
        { headers: { "kimo-up-to": "1", "kimo-gen": "1" } },
      )
    await expectCode(client(100).getSnapshot(ROOM, TOKEN), "RELAY_UNREACHABLE")
  })

  test("response bodies are capped: snapshot, blob and JSON", async () => {
    const limits = { maxSnapshotBytes: 100, maxBlobBytes: 100 }
    const capped = () => new RelayHttpClient({ relayUrl, limits })
    const big = new Uint8Array(100 + 30 + 1)
    const headers = { "kimo-up-to": "1", "kimo-gen": "1" }
    route = () => new Response(big, { headers })
    await expectCode(capped().getSnapshot(ROOM, TOKEN), "TOO_LARGE")
    await expectCode(capped().getBlob(ROOM, TOKEN, BLOB), "TOO_LARGE")
    // No content-length: a long chunked body is cut off once the cap is passed. The source is
    // paced and bounded: Bun.serve keeps pulling a synchronous endless stream after the client
    // cancels, which grew one test run past 200 GB.
    let pulled = 0
    let cancelled = false
    route = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          async pull(controller) {
            if (cancelled || pulled >= 1000) return controller.close()
            await Bun.sleep(2)
            pulled++
            controller.enqueue(new Uint8Array(64))
          },
          cancel() {
            cancelled = true
          },
        }),
        { headers },
      )
    await expectCode(capped().getSnapshot(ROOM, TOKEN), "TOO_LARGE")
    expect(pulled).toBeLessThan(50)
    route = () => new Response(new Uint8Array(130), { headers })
    expect((await capped().getSnapshot(ROOM, TOKEN))?.envelope.length).toBe(130)
    const hugeJson = JSON.stringify({ pad: "x".repeat(2 * 1024 * 1024) })
    route = () => new Response(hugeJson, { headers: { "content-type": "application/json" } })
    await expectCode(client().roomInfo(ROOM, TOKEN), "TOO_LARGE")
    await expectCode(client().probe(), "NOT_A_RELAY")
  })

  test("an injected fetch is used", async () => {
    const calls: string[] = []
    const c = new RelayHttpClient({
      relayUrl: "https://relay.example.com/kimo",
      fetch: (async (input: string) => {
        calls.push(String(input))
        return json(200, versionBody)
      }) as unknown as typeof fetch,
    })
    await c.probe()
    expect(calls).toEqual(["https://relay.example.com/kimo/version"])
  })
})

describe("parseRetryAfter", () => {
  test("seconds and HTTP dates", () => {
    expect(parseRetryAfter("0")).toBe(0)
    expect(parseRetryAfter(" 12 ")).toBe(12_000)
    expect(parseRetryAfter(null)).toBeUndefined()
    expect(parseRetryAfter("soon")).toBeUndefined()
    const now = Date.parse("2026-10-19T12:00:00Z")
    expect(parseRetryAfter("Mon, 19 Oct 2026 12:00:05 GMT", now)).toBe(5000)
    expect(parseRetryAfter("Mon, 19 Oct 2026 11:00:00 GMT", now)).toBe(0)
  })
})
