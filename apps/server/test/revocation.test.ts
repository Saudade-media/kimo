import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { randomBytes, toBase64Url, toHex } from "@kimo/sync/mp"
import {
  admin,
  bearer,
  type Harness,
  joinAs,
  registered,
  rotateOwner,
  startRelay,
  token,
  update,
} from "./helpers"

let h: Harness
beforeAll(() => {
  h = startRelay()
})
afterAll(() => h.stop())

const nowSec = () => Math.floor(h.clock.now / 1000)

describe("closing live connections (section 14.4)", () => {
  test("revoke closes only the sockets of that jti", async () => {
    const owner = await registered(h)
    const jti = randomBytes(16)
    const doomed = await joinAs(h, owner, "edit", { jti })
    const twin = await joinAs(h, owner, "edit", { jti })
    const bystander = await joinAs(h, owner, "edit")
    const res = await admin(h, owner, { op: "revoke", jti: toHex(jti), exp: 0 })
    expect(await res.json()).toEqual({ revoked: true, closed: 2 })
    expect(await doomed.client.closeInfo()).toEqual({ code: 4403, reason: "TOKEN_REVOKED" })
    expect((await twin.client.closeInfo()).reason).toBe("TOKEN_REVOKED")
    bystander.client.send({ type: "ping", n: 3 })
    expect((await bystander.client.next("pong")).n).toBe(3)
    // The revoked token cannot come back.
    const retry = await token(owner, "edit", { jti })
    const http = await fetch(`${h.base}/room/${owner.room.id}`, { headers: bearer(retry) })
    expect(http.status).toBe(403)
    bystander.client.close()
  })

  test("rotate closes every socket with KEY_ROTATED and kills old tokens", async () => {
    const owner = await registered(h)
    const a = await joinAs(h, owner, "edit")
    const b = await joinAs(h, owner, "view")
    const oldToken = await token(owner, "view")
    const next = await rotateOwner(owner, 2)
    const res = await admin(h, owner, { op: "rotate", cert: toBase64Url(next.cert.bytes) })
    expect(await res.json()).toEqual({ kid: 2, closed: 2 })
    expect(await a.client.closeInfo()).toEqual({ code: 4402, reason: "KEY_ROTATED" })
    expect((await b.client.closeInfo()).reason).toBe("KEY_ROTATED")
    const stale = await fetch(`${h.base}/room/${owner.room.id}`, { headers: bearer(oldToken) })
    expect(stale.status).toBe(401)
    // A token from the new key works.
    const fresh = await token(next, "edit")
    const ok = await fetch(`${h.base}/room/${owner.room.id}`, { headers: bearer(fresh) })
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as { kid: number }).kid).toBe(2)
  })

  test("the expiry timer closes with TOKEN_EXPIRED at exp", async () => {
    const owner = await registered(h)
    const timed = await joinAs(h, owner, "edit", { exp: nowSec() + 30 })
    const forever = await joinAs(h, owner, "edit", { exp: 0 })
    h.clock.now += 29_000
    h.relay.tick()
    timed.client.send({ type: "ping", n: 1 })
    await timed.client.next("pong")
    h.clock.now += 2_000
    h.relay.tick()
    expect(await timed.client.closeInfo()).toEqual({ code: 4419, reason: "TOKEN_EXPIRED" })
    forever.client.send({ type: "ping", n: 2 })
    expect((await forever.client.next("pong")).n).toBe(2)
    forever.client.close()
  })

  test("close room: ROOM_CLOSED for every socket, data and blob files deleted", async () => {
    const dir = `${process.env.TMPDIR ?? "/tmp"}/kimo-relay-${crypto.randomUUID()}`
    const disk = startRelay({ dataDir: dir })
    const owner = await registered(disk)
    const a = await joinAs(disk, owner, "edit")
    a.client.send({ type: "append", cid: 1, env: await update(owner, "data") })
    await a.client.next("ack")
    const blobId = "ab".repeat(32)
    const envelope = new Uint8Array(64)
    envelope[0] = 1
    envelope[1] = 4
    const put = await fetch(`${disk.base}/blob/${owner.room.id}/${blobId}`, {
      method: "PUT",
      headers: bearer(await token(owner, "edit")),
      body: envelope,
    })
    expect(put.status).toBe(201)
    const file = `${dir}/blobs/${owner.room.id}/ab/${blobId}`
    expect(await Bun.file(file).exists()).toBe(true)

    const res = await admin(disk, owner, { op: "close" })
    expect(res.status).toBe(200)
    expect(await a.client.closeInfo()).toEqual({ code: 4410, reason: "ROOM_CLOSED" })
    expect(await Bun.file(file).exists()).toBe(false)
    const row = disk.relay.db.getRoom(owner.room.id)
    expect(row?.closed_at).not.toBeNull()
    expect(row).toMatchObject({ head: 0, log_bytes: 0, blob_bytes: 0, snapshot_bytes: 0 })
    for (const table of ["log", "snapshots", "revocations", "blobs"])
      expect(
        disk.relay.db.sqlite
          .query(`SELECT COUNT(*) AS n FROM ${table} WHERE room = ?`)
          .get(owner.room.id),
      ).toEqual({ n: 0 })
    await disk.stop()
    await Bun.$`rm -rf ${dir}`.quiet()
  })
})
