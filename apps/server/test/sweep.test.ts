import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sealBlob, signAdminCommand } from "@kimo/sync/mp"
import { admin, bearer, type Harness, type Owner, registered, startRelay, token } from "./helpers"

const DAY = 86_400_000
let h: Harness
let owner: Owner
let edit: string
beforeAll(async () => {
  h = startRelay()
  owner = await registered(h)
  edit = await token(owner, "edit")
})
afterAll(() => h.stop())

async function upload(text: string) {
  const blob = await sealBlob(owner.keys, new TextEncoder().encode(text))
  const res = await fetch(`${h.base}/blob/${owner.room.id}/${blob.id}`, {
    method: "PUT",
    headers: bearer(edit),
    body: blob.envelope as Uint8Array<ArrayBuffer>,
  })
  expect([200, 201]).toContain(res.status)
  return blob
}

const exists = async (id: string) =>
  (await fetch(`${h.base}/blob/${owner.room.id}/${id}`, { method: "HEAD", headers: bearer(edit) }))
    .status === 200

async function sweep(keep: string[], graceDays?: number) {
  const res = await admin(h, owner, {
    op: "sweep",
    keep,
    ...(graceDays === undefined ? {} : { graceDays }),
  })
  expect(res.status).toBe(200)
  return (await res.json()) as Record<string, number>
}

describe("owner sweep", () => {
  test("the first sweep only marks; a sweep after the grace deletes rows and bytes", async () => {
    const a = await upload("keep me")
    const b = await upload("drop me")
    const c = await upload("drop me too")
    const before = h.relay.db.getRoom(owner.room.id)?.blob_bytes ?? 0
    const first = await sweep([a.id], 1)
    expect(first).toEqual({ marked: 2, deleted: 0, kept: 1, bytesFreed: 0 })
    expect(await exists(b.id)).toBe(true)

    h.clock.now += DAY - 1000
    expect(await sweep([a.id], 1)).toMatchObject({ marked: 0, deleted: 0, kept: 1 })
    h.clock.now += 2000
    const last = await sweep([a.id], 1)
    expect(last).toMatchObject({ deleted: 2, kept: 1 })
    expect(last.bytesFreed).toBe(b.envelope.length + c.envelope.length)
    expect(await exists(a.id)).toBe(true)
    expect(await exists(b.id)).toBe(false)
    expect(await exists(c.id)).toBe(false)
    expect(h.relay.db.getRoom(owner.room.id)?.blob_bytes).toBe(before - (last.bytesFreed as number))
  })

  test("a PUT or a later keep clears the mark", async () => {
    const a = await upload("re-uploaded")
    const b = await upload("kept later")
    await sweep([], 1)
    expect(h.relay.db.getBlob(owner.room.id, a.id)?.unref_since).not.toBeNull()
    await upload("re-uploaded")
    expect(h.relay.db.getBlob(owner.room.id, a.id)?.unref_since).toBeNull()
    await sweep([b.id], 1)
    expect(h.relay.db.getBlob(owner.room.id, b.id)?.unref_since).toBeNull()
    // The sweep above re-marked a (not kept), so a goes after one more grace; b stays.
    h.clock.now += 2 * DAY
    await sweep([b.id], 1)
    expect(await exists(a.id)).toBe(false)
    expect(await exists(b.id)).toBe(true)
  })

  test("the relay never deletes blobs outside a sweep", async () => {
    const a = await upload("never swept")
    h.clock.now += 400 * DAY
    h.relay.tick()
    expect(await exists(a.id)).toBe(true)
  })

  test("a sweep signed by anyone but the owner is refused", async () => {
    const stranger = await registered(h)
    const res = await admin(
      h,
      owner,
      { op: "sweep", keep: [] },
      { signer: stranger.root.privateKey },
    )
    expect(res.status).toBe(401)
  })

  test("a malformed sweep body is 400 before any nonce or mark is spent", async () => {
    const blob = await upload("keep me")
    const signed = await signAdminCommand(
      owner.root.privateKey,
      owner.room,
      { op: "sweep", keep: [], graceDays: 1 },
      { iat: h.clock.now },
    )
    // The signing helper refuses bad bodies, so splice one into signed bytes: the relay must
    // parse (and refuse) it before the signature, the nonce or any blob mutation.
    const header = signed.subarray(0, 52)
    const signature = signed.subarray(signed.length - 64)
    for (const bad of [
      '{"keep":[],"graceDays":0}',
      '{"keep":[],"graceDays":-3}',
      '{"keep":[],"graceDays":1.5}',
      "{}",
      '{"keep":"x"}',
      '{"keep":5}',
    ]) {
      const body = new TextEncoder().encode(bad)
      const bytes = new Uint8Array(52 + body.length + 64)
      bytes.set(header)
      new DataView(bytes.buffer).setUint32(48, body.length)
      bytes.set(body, 52)
      bytes.set(signature, 52 + body.length)
      const res = await fetch(`${h.base}/room/${owner.room.id}/admin`, {
        method: "POST",
        body: bytes,
      })
      expect(res.status).toBe(400)
    }
    expect(await exists(blob.id)).toBe(true)
    expect(h.relay.db.allBlobs(owner.room.id).find((b) => b.id === blob.id)?.unref_since).toBeNull()
  })
})
