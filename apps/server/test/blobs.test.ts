import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { openBlob, RelayHttpClient, sealBlob } from "@kimo/sync/mp"
import { bearer, type Harness, type Owner, registered, startRelay, token } from "./helpers"

let h: Harness
let owner: Owner
let edit: string
let view: string
beforeAll(async () => {
  h = startRelay()
  owner = await registered(h)
  edit = await token(owner, "edit")
  view = await token(owner, "view")
})
afterAll(() => h.stop())

const url = (id: string, room = owner.room.id) => `${h.base}/blob/${room}/${id}`
const put = (id: string, body: Uint8Array, auth = edit, base = h.base) =>
  fetch(`${base}/blob/${owner.room.id}/${id}`, {
    method: "PUT",
    headers: bearer(auth),
    body: body as Uint8Array<ArrayBuffer>,
  })

async function sealed(text: string) {
  return sealBlob(owner.keys, new TextEncoder().encode(text))
}

describe("blob endpoints", () => {
  test("PUT stores (201), repeats are 200, HEAD and GET return the bytes", async () => {
    const blob = await sealed("hello blob")
    const first = await put(blob.id, blob.envelope)
    expect(first.status).toBe(201)
    expect((await put(blob.id, blob.envelope)).status).toBe(200)
    const head = await fetch(url(blob.id), { method: "HEAD", headers: bearer(view) })
    expect(head.status).toBe(200)
    expect(head.headers.get("content-length")).toBe(String(blob.envelope.length))
    const got = await fetch(url(blob.id), { headers: bearer(view) })
    expect(got.status).toBe(200)
    expect(got.headers.get("cache-control")).toBe("private, max-age=31536000, immutable")
    const bytes = new Uint8Array(await got.arrayBuffer())
    expect(Array.from(bytes)).toEqual(Array.from(blob.envelope))
    const plain = await openBlob(owner.keys, blob.sha, bytes)
    expect(new TextDecoder().decode(plain)).toBe("hello blob")
  })

  test("unknown blobs are 404 for HEAD and GET", async () => {
    const id = "cd".repeat(32)
    const head = await fetch(url(id), { method: "HEAD", headers: bearer(view) })
    expect(head.status).toBe(404)
    const get = await fetch(url(id), { headers: bearer(view) })
    expect(get.status).toBe(404)
    expect(((await get.json()) as { error: string }).error).toBe("NOT_FOUND")
  })

  test("a view token cannot PUT, a missing token is 401", async () => {
    const blob = await sealed("view put")
    const denied = await put(blob.id, blob.envelope, view)
    expect(denied.status).toBe(403)
    expect(((await denied.json()) as { error: string }).error).toBe("VIEW_ONLY")
    const anon = await fetch(url(blob.id), {
      method: "PUT",
      body: blob.envelope as Uint8Array<ArrayBuffer>,
    })
    expect(anon.status).toBe(401)
  })

  test("the id must be 64 lowercase hex characters", async () => {
    const blob = await sealed("grammar")
    for (const bad of ["short", "AB".repeat(32), "zz".repeat(32)])
      expect((await put(bad, blob.envelope)).status).toBe(400)
  })

  test("a body that is not a blob envelope is 400", async () => {
    expect((await put("ef".repeat(32), new Uint8Array(80))).status).toBe(400)
  })

  test("blobs over the size cap are 413", async () => {
    const small = startRelay({ blobMaxBytes: 100 })
    const o = await registered(small)
    const t = await token(o, "edit")
    const big = await sealBlob(o.keys, new Uint8Array(500))
    const res = await fetch(`${small.base}/blob/${o.room.id}/${big.id}`, {
      method: "PUT",
      headers: bearer(t),
      body: big.envelope as Uint8Array<ArrayBuffer>,
    })
    expect(res.status).toBe(413)
    const ok = await sealBlob(o.keys, new Uint8Array(100))
    const fits = await fetch(`${small.base}/blob/${o.room.id}/${ok.id}`, {
      method: "PUT",
      headers: bearer(t),
      body: ok.envelope as Uint8Array<ArrayBuffer>,
    })
    expect(fits.status).toBe(201)
    await small.stop()
  })

  test("the room quota is 507", async () => {
    const tight = startRelay({ roomQuotaBytes: 300 })
    const o = await registered(tight)
    const t = await token(o, "edit")
    const send = async (text: string) => {
      const blob = await sealBlob(o.keys, new TextEncoder().encode(text.padEnd(100, "x")))
      return fetch(`${tight.base}/blob/${o.room.id}/${blob.id}`, {
        method: "PUT",
        headers: bearer(t),
        body: blob.envelope as Uint8Array<ArrayBuffer>,
      })
    }
    expect((await send("a")).status).toBe(201)
    expect((await send("b")).status).toBe(201)
    const over = await send("c")
    expect(over.status).toBe(507)
    expect(((await over.json()) as { error: string }).error).toBe("QUOTA_EXCEEDED")
    const info = await new RelayHttpClient({ relayUrl: tight.base }).roomInfo(o.room.id, t)
    expect(info.usedBytes).toBeLessThanOrEqual(300)
    await tight.stop()
  })

  test("the per-token upload rate is 429 with retry-after", async () => {
    const slow = startRelay({ blobRatePerMin: 2 })
    const o = await registered(slow)
    const t = await token(o, "edit")
    const codes: number[] = []
    let retryAfter = ""
    for (let i = 0; i < 3; i++) {
      const blob = await sealBlob(o.keys, new TextEncoder().encode(`n${i}`))
      const res = await fetch(`${slow.base}/blob/${o.room.id}/${blob.id}`, {
        method: "PUT",
        headers: bearer(t),
        body: blob.envelope as Uint8Array<ArrayBuffer>,
      })
      codes.push(res.status)
      retryAfter = res.headers.get("retry-after") ?? retryAfter
    }
    expect(codes).toEqual([201, 201, 429])
    expect(Number(retryAfter)).toBeGreaterThan(0)
    // Another token has its own bucket.
    const other = await token(o, "edit")
    const blob = await sealBlob(o.keys, new TextEncoder().encode("other"))
    const res = await fetch(`${slow.base}/blob/${o.room.id}/${blob.id}`, {
      method: "PUT",
      headers: bearer(other),
      body: blob.envelope as Uint8Array<ArrayBuffer>,
    })
    expect(res.status).toBe(201)
    await slow.stop()
  })

  test("POST /blob/<room>/missing lists the ids the relay lacks", async () => {
    const have = await sealed("present")
    await put(have.id, have.envelope)
    const lack = "12".repeat(32)
    const res = await fetch(`${h.base}/blob/${owner.room.id}/missing`, {
      method: "POST",
      headers: { ...bearer(view), "content-type": "application/json" },
      body: JSON.stringify({ ids: [have.id, lack] }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ missing: [lack] })
    const bad = await fetch(`${h.base}/blob/${owner.room.id}/missing`, {
      method: "POST",
      headers: bearer(view),
      body: JSON.stringify({ ids: ["nope"] }),
    })
    expect(bad.status).toBe(400)
  })
})
