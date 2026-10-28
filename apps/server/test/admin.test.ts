import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import {
  exportPublicKey,
  generateSigningKeyPair,
  randomBytes,
  signRegisterOwner,
  toBase64Url,
  toHex,
} from "@kimo/sync/mp"
import {
  admin,
  device,
  type Harness,
  makeOwner,
  ownerCommand,
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

describe("admin: register owner proof", () => {
  const registerBody = (owner: Awaited<ReturnType<typeof makeOwner>>) =>
    ({
      op: "register",
      rootPub: toBase64Url(owner.rootPub),
      cert: toBase64Url(owner.cert.bytes),
    }) as const

  test("an unclaimed relay is RELAY_UNCLAIMED", async () => {
    const empty = startRelay({ ownerKeys: [] })
    const owner = await makeOwner(1, Math.floor(empty.clock.now / 1000))
    const res = await register(empty, owner)
    expect(res.status).toBe(403)
    expect(await code(res)).toBe("RELAY_UNCLAIMED")
    await empty.stop()
  })

  test("no proof or a key outside the owner set is NOT_OWNER", async () => {
    const owner = await makeOwner(1, Math.floor(h.clock.now / 1000))
    const none = await register(h, owner, { device: null })
    expect(none.status).toBe(403)
    expect(await code(none)).toBe("NOT_OWNER")
    const stranger = await register(h, owner, { device: await generateSigningKeyPair() })
    expect(stranger.status).toBe(403)
    expect(await code(stranger)).toBe("NOT_OWNER")
  })

  test("a proof for another room, nonce or relay is AUTH_INVALID", async () => {
    const owner = await makeOwner(1, Math.floor(h.clock.now / 1000))
    const other = await makeOwner(1, Math.floor(h.clock.now / 1000))
    const nonce = randomBytes(16)
    const proof = (input: Partial<Parameters<typeof signRegisterOwner>[1]>) =>
      signRegisterOwner(device, {
        relayId: h.relay.relayId,
        room: owner.room,
        nonce,
        iat: h.clock.now,
        rootPub: owner.rootPub,
        ...input,
      })
    for (const wrong of [
      await proof({ room: other.room }),
      await proof({ nonce: randomBytes(16) }),
      await proof({ relayId: randomBytes(16) }),
    ]) {
      const res = await admin(h, owner, { ...registerBody(owner), owner: wrong }, { nonce })
      expect(res.status).toBe(401)
      expect(await code(res)).toBe("AUTH_INVALID")
    }
    const ok = await admin(h, owner, { ...registerBody(owner), owner: await proof({}) }, { nonce })
    expect(ok.status).toBe(201)
  })

  test("a removed device is NOT_OWNER; its rooms keep revoke, rotate and close; reopening needs a proof", async () => {
    const r = startRelay()
    const second = await generateSigningKeyPair()
    // Seed a second owner so the first can be removed.
    r.relay.db.insertOwner({
      pub: await exportPublicKey(second.publicKey),
      name: "Mac",
      added_at: r.clock.now,
      added_by: null,
      via: "claim",
    })
    const owner = await registered(r)
    const removed = await ownerCommand(r, {
      op: "remove",
      pub: toBase64Url(await exportPublicKey(device.publicKey)),
    })
    expect(removed.status).toBe(200)
    const another = await makeOwner(1, Math.floor(r.clock.now / 1000))
    const refused = await register(r, another)
    expect(refused.status).toBe(403)
    expect(await code(refused)).toBe("NOT_OWNER")
    // The idempotent register needs the proof too.
    expect((await register(r, owner)).status).toBe(403)
    expect((await register(r, owner, { device: second })).status).toBe(200)

    const revoke = await admin(r, owner, { op: "revoke", jti: toHex(randomBytes(16)), exp: 0 })
    expect(revoke.status).toBe(200)
    const next = await rotateOwner(owner, 2)
    expect(
      (await admin(r, owner, { op: "rotate", cert: toBase64Url(next.cert.bytes) })).status,
    ).toBe(200)
    expect((await admin(r, next, { op: "close" })).status).toBe(200)
    const reopened = await rotateOwner(next, 3, Math.floor(r.clock.now / 1000))
    const noProof = await register(r, reopened)
    expect(noProof.status).toBe(403)
    expect(await code(noProof)).toBe("NOT_OWNER")
    expect((await register(r, reopened, { device: second })).status).toBe(201)
    await r.stop()
  })
})
