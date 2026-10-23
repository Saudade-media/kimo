import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { randomBytes, sealBlob, sealSnapshot, toBase64Url, toHex } from "@kimo/sync/mp"
import { recheckToken, verifyToken } from "../src/auth"
import { admin, bearer, type Harness, registered, rotateOwner, startRelay, token } from "./helpers"

const DAY = 86_400_000
let h: Harness
beforeAll(() => {
  h = startRelay()
})
afterAll(() => h.stop())

/** A bounded two-chunk body: the second chunk is held back until `release` is called. */
function gatedBody(bytes: Uint8Array) {
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const half = Math.max(1, bytes.length >> 1)
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(bytes.slice(0, half))
      await gate
      controller.enqueue(bytes.slice(half))
      controller.close()
    },
  })
  return { body, release }
}

const nowSec = () => Math.floor(h.clock.now / 1000)

describe("revocation while a body uploads", () => {
  test("a snapshot PUT whose jti is revoked mid-upload is refused", async () => {
    const owner = await registered(h)
    const jti = randomBytes(16)
    const t = await token(owner, "edit", { jti, iat: nowSec() })
    const env = await sealSnapshot(owner.keys, 0, new TextEncoder().encode("late"))
    const { body, release } = gatedBody(env)
    const pending = fetch(`${h.base}/room/${owner.room.id}/snapshot?upTo=0`, {
      method: "PUT",
      headers: bearer(t),
      body,
    })
    await new Promise((r) => setTimeout(r, 50))
    await admin(h, owner, { op: "revoke", jti: toHex(jti), exp: 0 })
    release()
    const res = await pending
    expect(res.status).toBe(403)
    expect(h.relay.db.latestSnapshot(owner.room.id)).toBeNull()
  })

  test("a snapshot PUT is refused after 'reset all links' mid-upload", async () => {
    const owner = await registered(h)
    const t = await token(owner, "edit", { iat: nowSec() })
    const env = await sealSnapshot(owner.keys, 0, new TextEncoder().encode("late"))
    const { body, release } = gatedBody(env)
    const pending = fetch(`${h.base}/room/${owner.room.id}/snapshot?upTo=0`, {
      method: "PUT",
      headers: bearer(t),
      body,
    })
    await new Promise((r) => setTimeout(r, 50))
    const next = await rotateOwner(owner, 2)
    await admin(h, owner, { op: "rotate", cert: toBase64Url(next.cert.bytes) })
    release()
    expect((await pending).status).toBe(401)
    expect(h.relay.db.latestSnapshot(owner.room.id)).toBeNull()
  })

  test("a blob PUT whose jti is revoked mid-upload stores nothing", async () => {
    const owner = await registered(h)
    const jti = randomBytes(16)
    const t = await token(owner, "edit", { jti, iat: nowSec() })
    const blob = await sealBlob(owner.keys, new TextEncoder().encode("poison"))
    const { body, release } = gatedBody(blob.envelope)
    const pending = fetch(`${h.base}/blob/${owner.room.id}/${blob.id}`, {
      method: "PUT",
      headers: bearer(t),
      body,
    })
    await new Promise((r) => setTimeout(r, 50))
    await admin(h, owner, { op: "revoke", jti: toHex(jti), exp: 0 })
    release()
    expect((await pending).status).toBe(403)
    expect(h.relay.db.getBlob(owner.room.id, blob.id)).toBeNull()
  })

  test("recheckToken sees a revoke that landed after verifyToken", async () => {
    const owner = await registered(h)
    const jti = randomBytes(16)
    const t = await token(owner, "edit", { jti, iat: nowSec() })
    const verified = await verifyToken(h.relay.db, owner.room.id, t, nowSec())
    expect(recheckToken(h.relay.db, verified, nowSec()).id).toBe(owner.room.id)
    await admin(h, owner, { op: "revoke", jti: toHex(jti), exp: 0 })
    expect(() => recheckToken(h.relay.db, verified, nowSec())).toThrow(/revoked/)
  })
})

describe("blob dedupe versus a sweep", () => {
  test("the unref mark is cleared before the duplicate body is drained", async () => {
    const owner = await registered(h)
    const t = await token(owner, "edit", { iat: nowSec() })
    const blob = await sealBlob(owner.keys, new TextEncoder().encode("dup"))
    const put = (body: BodyInit) =>
      fetch(`${h.base}/blob/${owner.room.id}/${blob.id}`, {
        method: "PUT",
        headers: bearer(t),
        body,
      })
    expect((await put(blob.envelope as Uint8Array<ArrayBuffer>)).status).toBe(201)
    await admin(h, owner, { op: "sweep", keep: [], graceDays: 1 })
    expect(h.relay.db.getBlob(owner.room.id, blob.id)?.unref_since).not.toBeNull()

    const { body, release } = gatedBody(blob.envelope)
    const pending = put(body)
    await new Promise((r) => setTimeout(r, 50))
    // The sweep that runs while the duplicate drains must see the blob as kept.
    expect(h.relay.db.getBlob(owner.room.id, blob.id)?.unref_since).toBeNull()
    h.clock.now += 2 * DAY
    await admin(h, owner, { op: "sweep", keep: [], graceDays: 1 })
    expect(h.relay.db.getBlob(owner.room.id, blob.id)).not.toBeNull()
    release()
    expect((await pending).status).toBe(200)
  })
})
