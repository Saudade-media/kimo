import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { generateSigningKeyPair, randomBytes, toBase64Url, toHex } from "@kimo/sync/mp"
import {
  admin,
  type Harness,
  makeOwner,
  register,
  registered,
  rotateOwner,
  startRelay,
} from "./helpers"

let h: Harness
beforeAll(() => {
  h = startRelay()
})
afterAll(() => h.stop())

const code = async (res: Response) => ((await res.json()) as { error: string }).error

describe("admin: register", () => {
  test("201 then idempotent 200", async () => {
    const owner = await makeOwner(1, Math.floor(h.clock.now / 1000))
    const first = await register(h, owner)
    expect(first.status).toBe(201)
    expect(await first.json()).toEqual({ room: owner.room.id, kid: 1 })
    const again = await register(h, owner)
    expect(again.status).toBe(200)
    expect(await again.json()).toEqual({ room: owner.room.id, kid: 1 })
  })

  test("ROOM_ID_MISMATCH when the root key is not the room's", async () => {
    const owner = await makeOwner()
    const other = await makeOwner()
    const res = await admin(
      h,
      owner,
      { op: "register", rootPub: toBase64Url(other.rootPub), cert: toBase64Url(owner.cert.bytes) },
      { signer: other.root.privateKey },
    )
    expect(res.status).toBe(422)
    expect(await code(res)).toBe("ROOM_ID_MISMATCH")
  })

  test("a bad signature is AUTH_INVALID", async () => {
    const owner = await makeOwner()
    const stranger = await generateSigningKeyPair()
    const res = await admin(
      h,
      owner,
      { op: "register", rootPub: toBase64Url(owner.rootPub), cert: toBase64Url(owner.cert.bytes) },
      { signer: stranger.privateKey },
    )
    expect(res.status).toBe(401)
    expect(await code(res)).toBe("AUTH_INVALID")
  })

  test("a certificate for another room is refused", async () => {
    const owner = await makeOwner()
    const other = await makeOwner()
    const res = await admin(h, owner, {
      op: "register",
      rootPub: toBase64Url(owner.rootPub),
      cert: toBase64Url(other.cert.bytes),
    })
    expect(res.status).toBe(401)
  })

  test("CREATE_FORBIDDEN with and without the secret", async () => {
    const guarded = startRelay({ createSecret: "s3cret" })
    const owner = await makeOwner(1, Math.floor(guarded.clock.now / 1000))
    const none = await register(guarded, owner)
    expect(none.status).toBe(403)
    expect(await code(none)).toBe("CREATE_FORBIDDEN")
    expect((await register(guarded, owner, "wrong")).status).toBe(403)
    expect((await register(guarded, owner, "s3cret")).status).toBe(201)
    await guarded.stop()
  })

  test("RELAY_FULL when the room cap is reached", async () => {
    const small = startRelay({ maxRooms: 1 })
    await registered(small)
    const second = await makeOwner(1, Math.floor(small.clock.now / 1000))
    const res = await register(small, second)
    expect(res.status).toBe(503)
    expect(await code(res)).toBe("RELAY_FULL")
    await small.stop()
  })

  test("STALE_REQUEST outside +-5 minutes", async () => {
    const owner = await makeOwner(1, Math.floor(h.clock.now / 1000))
    const res = await admin(
      h,
      owner,
      { op: "register", rootPub: toBase64Url(owner.rootPub), cert: toBase64Url(owner.cert.bytes) },
      { iat: h.clock.now - 301_000 },
    )
    expect(res.status).toBe(422)
    expect(await code(res)).toBe("STALE_REQUEST")
  })

  test("NONCE_REPLAY on a reused nonce", async () => {
    const owner = await registered(h)
    const nonce = randomBytes(16)
    const body = { op: "revoke", jti: toHex(randomBytes(16)), exp: 0 } as const
    expect((await admin(h, owner, body, { nonce })).status).toBe(200)
    const replay = await admin(h, owner, body, { nonce })
    expect(replay.status).toBe(409)
    expect(await code(replay)).toBe("NONCE_REPLAY")
  })

  test("non-register commands on an unknown room are 404", async () => {
    const owner = await makeOwner(1, Math.floor(h.clock.now / 1000))
    const res = await admin(h, owner, { op: "close" })
    expect(res.status).toBe(404)
    expect(await code(res)).toBe("ROOM_NOT_FOUND")
  })

  test("a malformed command is 400", async () => {
    const owner = await makeOwner()
    const res = await fetch(`${h.base}/room/${owner.room.id}/admin`, {
      method: "POST",
      body: randomBytes(10) as Uint8Array<ArrayBuffer>,
    })
    expect(res.status).toBe(400)
  })
})

describe("admin: revoke, rotate, close", () => {
  test("revoke answers closed: 0 with nobody connected", async () => {
    const owner = await registered(h)
    const res = await admin(h, owner, { op: "revoke", jti: toHex(randomBytes(16)), exp: 0 })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ revoked: true, closed: 0 })
  })

  test("rotate needs a higher kid", async () => {
    const owner = await registered(h)
    const same = await rotateOwner(owner, 1)
    const bad = await admin(h, owner, { op: "rotate", cert: toBase64Url(same.cert.bytes) })
    expect(bad.status).toBe(422)
    expect(await code(bad)).toBe("KEY_ID_INVALID")
    const next = await rotateOwner(owner, 2)
    const ok = await admin(h, owner, { op: "rotate", cert: toBase64Url(next.cert.bytes) })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ kid: 2, closed: 0 })
  })

  test("close, then re-register needs a newer kid", async () => {
    const owner = await registered(h)
    expect((await admin(h, owner, { op: "close" })).status).toBe(200)
    const again = await admin(h, owner, { op: "close" })
    expect(again.status).toBe(410)
    expect(await code(again)).toBe("ROOM_CLOSED")

    const stale = await register(h, owner)
    expect(stale.status).toBe(422)
    expect(await code(stale)).toBe("KEY_ID_INVALID")

    const reopened = await rotateOwner(owner, 2, Math.floor(h.clock.now / 1000))
    const ok = await register(h, reopened)
    expect(ok.status).toBe(201)
    expect(await ok.json()).toEqual({ room: owner.room.id, kid: 2 })
  })
})
