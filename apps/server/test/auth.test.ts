import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { MP_ERRORS, type MpErrorCode, randomBytes, toHex } from "@kimo/sync/mp"
import {
  admin,
  bearer,
  Client,
  type Harness,
  makeOwner,
  type Owner,
  registered,
  rotateOwner,
  startRelay,
  token,
} from "./helpers"

let h: Harness
let owner: Owner
beforeAll(async () => {
  h = startRelay()
  owner = await registered(h)
})
afterAll(() => h.stop())

const nowSec = () => Math.floor(h.clock.now / 1000)

async function viaHttp(tokenText: string, room = owner.room.id) {
  const res = await fetch(`${h.base}/room/${room}`, { headers: bearer(tokenText) })
  return {
    status: res.status,
    error: res.status === 200 ? "" : ((await res.json()) as { error: string }).error,
  }
}

async function viaWs(tokenText: string) {
  const client = await Client.connect(h, owner.room.id)
  client.send({ type: "hello", proto: 1, token: tokenText, since: 0, client: "t" })
  return client.closeInfo()
}

async function expectCode(tokenText: string, code: MpErrorCode) {
  const http = await viaHttp(tokenText)
  expect(http.error).toBe(code)
  expect(http.status).toBe(MP_ERRORS[code].http as number)
  const closed = await viaWs(tokenText)
  expect(closed.code).toBe(MP_ERRORS[code].close as number)
  expect(closed.reason).toBe(code)
}

describe("token verification order", () => {
  test("a valid token passes on both transports", async () => {
    const t = await token(owner, "view", { iat: nowSec() })
    expect((await viaHttp(t)).status).toBe(200)
    const { client, welcome } = await Client.join(h, owner.room.id, t)
    expect(welcome.role).toBe("view")
    client.close()
  })

  test("1 parse: garbage is AUTH_INVALID", async () => {
    await expectCode("not-a-token", "AUTH_INVALID")
  })

  test("2 room: a token for another room is AUTH_INVALID", async () => {
    const other = await registered(h)
    await expectCode(await token(other, "edit"), "AUTH_INVALID")
  })

  test("4 kid: a token of a replaced key is KEY_ROTATED", async () => {
    await expectCode(await token(owner, "edit", { kid: 7 }), "KEY_ROTATED")
  })

  test("5 signature: a token from a foreign link key is AUTH_INVALID", async () => {
    const forged = await rotateOwner(owner, owner.kid)
    await expectCode(await token(forged, "edit"), "AUTH_INVALID")
  })

  test("6 role: comment is ROLE_UNSUPPORTED", async () => {
    await expectCode(await token(owner, "comment"), "ROLE_UNSUPPORTED")
  })

  test("7 exp: an expired token is TOKEN_EXPIRED", async () => {
    await expectCode(await token(owner, "edit", { exp: nowSec() - 5 }), "TOKEN_EXPIRED")
  })

  test("8 jti: a revoked token is TOKEN_REVOKED, and expiry is checked first", async () => {
    const jti = randomBytes(16)
    const t = await token(owner, "edit", { jti })
    expect((await admin(h, owner, { op: "revoke", jti: toHex(jti), exp: 0 })).status).toBe(200)
    await expectCode(t, "TOKEN_REVOKED")
    const jti2 = randomBytes(16)
    const both = await token(owner, "edit", { jti: jti2, exp: nowSec() - 5 })
    await admin(h, owner, { op: "revoke", jti: toHex(jti2), exp: 0 })
    await expectCode(both, "TOKEN_EXPIRED")
  })

  test("3 room: an unknown room is ROOM_NOT_FOUND over HTTP, 404 at upgrade", async () => {
    const stranger = await makeOwner()
    const t = await token(stranger, "edit")
    expect(await viaHttp(t, stranger.room.id)).toEqual({ status: 404, error: "ROOM_NOT_FOUND" })
    const res = await fetch(`${h.base}/sync/${stranger.room.id}`, {
      headers: {
        upgrade: "websocket",
        connection: "Upgrade",
        "sec-websocket-version": "13",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-websocket-protocol": "kimo-mp.1",
      },
    })
    expect(res.status).toBe(404)
  })

  test("3 room: a closed room is ROOM_CLOSED (410)", async () => {
    const gone = await registered(h)
    const t = await token(gone, "edit")
    await admin(h, gone, { op: "close" })
    expect(await viaHttp(t, gone.room.id)).toEqual({ status: 410, error: "ROOM_CLOSED" })
  })

  test("HTTP without a bearer token is 401", async () => {
    const res = await fetch(`${h.base}/room/${owner.room.id}`)
    expect(res.status).toBe(401)
  })
})
