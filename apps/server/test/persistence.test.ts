import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomBytes, sealBlob, toHex } from "@kimo/sync/mp"
import {
  admin,
  bearer,
  Client,
  type Harness,
  joinAs,
  putSnapshotRaw,
  registered,
  startRelay,
  token,
  update,
} from "./helpers"

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

describe("persistence", () => {
  test("a restart on the same data dir keeps rooms, log, snapshots, revocations and blobs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kimo-relay-"))
    dirs.push(dir)
    let h: Harness = startRelay({ dataDir: dir })
    const owner = await registered(h)
    const edit = await token(owner, "edit")
    const { client } = await joinAs(h, owner, "edit")
    for (const text of ["one", "two", "three"]) {
      client.send({ type: "append", cid: 1, env: await update(owner, text) })
      await client.next("ack")
    }
    client.close()
    expect((await putSnapshotRaw(h, owner, edit, 2)).status).toBe(201)
    const revoked = randomBytes(16)
    const doomed = await token(owner, "edit", { jti: revoked })
    await admin(h, owner, { op: "revoke", jti: toHex(revoked), exp: 0 })
    const blob = await sealBlob(owner.keys, new TextEncoder().encode("persisted"))
    await fetch(`${h.base}/blob/${owner.room.id}/${blob.id}`, {
      method: "PUT",
      headers: bearer(edit),
      body: blob.envelope as Uint8Array<ArrayBuffer>,
    })
    await h.stop()

    h = startRelay({ dataDir: dir })
    const info = await fetch(`${h.base}/room/${owner.room.id}`, { headers: bearer(edit) })
    expect(await info.json()).toMatchObject({
      room: owner.room.id,
      kid: 1,
      head: 3,
      snapshot: { upTo: 2, gen: 1 },
    })
    const rejoined = await Client.join(h, owner.room.id, edit, 0)
    expect(rejoined.welcome).toMatchObject({ head: 3, needSnapshot: true, from: 3 })
    rejoined.client.close()
    const snap = await fetch(`${h.base}/room/${owner.room.id}/snapshot`, { headers: bearer(edit) })
    expect(snap.status).toBe(200)
    const gone = await fetch(`${h.base}/room/${owner.room.id}`, { headers: bearer(doomed) })
    expect(gone.status).toBe(403)
    const got = await fetch(`${h.base}/blob/${owner.room.id}/${blob.id}`, { headers: bearer(edit) })
    expect(Array.from(new Uint8Array(await got.arrayBuffer()))).toEqual(Array.from(blob.envelope))
    const version = h.relay.db.sqlite.query("PRAGMA user_version").get()
    expect(version).toEqual({ user_version: 1 })
    // New appends continue the sequence.
    const next = await joinAs(h, owner, "edit")
    next.client.send({ type: "append", cid: 1, env: await update(owner, "four") })
    expect(await next.client.next("ack")).toMatchObject({ seq: 4 })
    next.client.close()
    await h.stop()
  })

  test("a database from a newer schema is refused", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kimo-relay-"))
    dirs.push(dir)
    const first = startRelay({ dataDir: dir })
    first.relay.db.sqlite.run("PRAGMA user_version = 99")
    await first.stop()
    expect(() => startRelay({ dataDir: dir })).toThrow(/schema 99/)
  })
})
