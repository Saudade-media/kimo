import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sealAwareness, sealUpdate } from "@kimo/sync/mp"
import {
  admin,
  Client,
  type Harness,
  joinAs,
  type Owner,
  registered,
  startRelay,
  token,
  until,
  update,
  upgradeHeaders,
} from "./helpers"

let h: Harness
beforeAll(() => {
  h = startRelay()
})
afterAll(() => h.stop())

const nowSec = () => Math.floor(h.clock.now / 1000)

describe("connection rules", () => {
  test("a silent socket is closed with HELLO_TIMEOUT", async () => {
    const owner = await registered(h)
    const client = await Client.connect(h, owner.room.id)
    h.clock.now += 10_000
    h.relay.tick()
    expect(await client.closeInfo()).toEqual({ code: 4408, reason: "HELLO_TIMEOUT" })
  })

  test("a first frame that is not hello is BAD_MESSAGE", async () => {
    const owner = await registered(h)
    const client = await Client.connect(h, owner.room.id)
    client.send({ type: "ping", n: 1 })
    expect(await client.closeInfo()).toEqual({ code: 4400, reason: "BAD_MESSAGE" })
  })

  test("a text frame is BAD_MESSAGE", async () => {
    const owner = await registered(h)
    const client = await Client.connect(h, owner.room.id)
    client.ws.send("hello")
    expect((await client.closeInfo()).reason).toBe("BAD_MESSAGE")
  })

  test("garbage binary is BAD_MESSAGE", async () => {
    const owner = await registered(h)
    const { client } = await joinAs(h, owner, "edit")
    client.sendRaw(new Uint8Array([99, 1, 2]))
    expect((await client.closeInfo()).reason).toBe("BAD_MESSAGE")
  })

  test("a second hello is BAD_MESSAGE", async () => {
    const owner = await registered(h)
    const { client } = await joinAs(h, owner, "edit")
    client.send({ type: "hello", proto: 1, token: "x", since: 0, client: "t" })
    expect((await client.closeInfo()).reason).toBe("BAD_MESSAGE")
  })

  test("hello with another proto is PROTOCOL_MISMATCH", async () => {
    const owner = await registered(h)
    const client = await Client.connect(h, owner.room.id)
    client.send({
      type: "hello",
      proto: 2,
      token: await token(owner, "edit"),
      since: 0,
      client: "t",
    })
    expect(await client.closeInfo()).toEqual({ code: 4426, reason: "PROTOCOL_MISMATCH" })
  })

  test("the upgrade requires the kimo-mp.1 subprotocol", async () => {
    const owner = await registered(h)
    const none = await fetch(`${h.base}/sync/${owner.room.id}`, { headers: upgradeHeaders() })
    expect(none.status).toBe(426)
    expect(((await none.json()) as { error: string }).error).toBe("PROTOCOL_MISMATCH")
    const wrong = await fetch(`${h.base}/sync/${owner.room.id}`, {
      headers: upgradeHeaders("other.1"),
    })
    expect(wrong.status).toBe(426)
  })

  test("the Origin header is checked against the allow list", async () => {
    const strict = startRelay({ allowedOrigins: ["https://app.example"] })
    const owner = await registered(strict)
    const bad = await fetch(`${strict.base}/sync/${owner.room.id}`, {
      headers: upgradeHeaders("kimo-mp.1", { origin: "https://evil.example" }),
    })
    expect(bad.status).toBe(403)
    expect(((await bad.json()) as { error: string }).error).toBe("ORIGIN_FORBIDDEN")
    // No Origin header (Bun, desktop host) is allowed.
    const { client } = await joinAs(strict, owner, "view")
    client.close()
    await strict.stop()
  })

  test("the per-IP connect rate limit is 429 with retry-after", async () => {
    const limited = startRelay({ connectRatePerMin: 2 })
    const owner = await registered(limited)
    const first = await Client.connect(limited, owner.room.id)
    const second = await Client.connect(limited, owner.room.id)
    await expect(Client.connect(limited, owner.room.id)).rejects.toThrow()
    first.close()
    second.close()
    // The same limit answers a plain HTTP probe of the upgrade path.
    const res = await fetch(`${limited.base}/sync/${owner.room.id}`, {
      headers: upgradeHeaders("kimo-mp.1"),
    })
    expect(res.status).toBe(429)
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0)
    await limited.stop()
  })

  test("the peer cap is ROOM_FULL (503)", async () => {
    const small = startRelay({ maxPeers: 1 })
    const owner = await registered(small)
    const { client } = await joinAs(small, owner, "view")
    const res = await fetch(`${small.base}/sync/${owner.room.id}`, {
      headers: upgradeHeaders("kimo-mp.1"),
    })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { error: string }).error).toBe("ROOM_FULL")
    client.close()
    await small.stop()
  })

  test("ping is answered with pong", async () => {
    const owner = await registered(h)
    const { client } = await joinAs(h, owner, "view")
    client.send({ type: "ping", n: 41 })
    expect((await client.next("pong")).n).toBe(41)
    client.close()
  })
})

describe("welcome", () => {
  test("carries the role, the relay-stamped origin, limits and the peers", async () => {
    const owner = await registered(h)
    const first = await joinAs(h, owner, "edit", { origin: "agent:bot", exp: nowSec() + 600 })
    expect(first.welcome).toMatchObject({
      peer: 1,
      role: "edit",
      origin: "agent:bot",
      exp: nowSec() + 600,
      kid: 1,
      head: 0,
      base: 0,
      from: 1,
      needSnapshot: false,
      snapshot: null,
      peers: [],
    })
    expect(first.welcome.limits.maxEntryBytes).toBe(4 * 1024 * 1024)
    const second = await joinAs(h, owner, "view")
    expect(second.welcome.peer).toBe(2)
    expect(second.welcome.peers).toEqual([{ peer: 1, role: "edit", origin: "agent:bot" }])
    first.client.close()
    second.client.close()
  })
})

describe("append and fan-out", () => {
  test("the sender gets an ack, the others get the entry with the stamped origin", async () => {
    const owner = await registered(h)
    const a = await joinAs(h, owner, "edit")
    const b = await joinAs(h, owner, "edit", { origin: "mcp:tool" })
    const env = await update(owner, "one")
    a.client.send({ type: "append", cid: 7, env })
    expect(await a.client.next("ack")).toEqual({ type: "ack", cid: 7, seq: 1 })
    const got = await b.client.next("entries")
    expect(got.entries).toHaveLength(1)
    expect(got.entries[0]).toMatchObject({ seq: 1, origin: "user" })
    expect(Array.from(got.entries[0]?.env ?? [])).toEqual(Array.from(env))
    b.client.send({ type: "append", cid: 1, env: await update(owner, "two") })
    expect(await b.client.next("ack")).toMatchObject({ seq: 2 })
    const back = await a.client.next("entries")
    expect(back.entries[0]).toMatchObject({ seq: 2, origin: "mcp:tool" })
    expect(await a.client.drain("entries")).toHaveLength(0)
    a.client.close()
    b.client.close()
  })

  test("concurrent appends from three sockets arrive once and in order", async () => {
    const owner = await registered(h)
    const peers = await Promise.all([1, 2, 3].map(() => joinAs(h, owner, "edit")))
    const per = 20
    await Promise.all(
      peers.map(async ({ client }, i) => {
        for (let n = 0; n < per; n++)
          client.send({ type: "append", cid: n + 1, env: await update(owner, `p${i}-${n}`) })
      }),
    )
    const total = per * peers.length
    for (const { client } of peers) {
      await until(() => {
        const acks = client.messages.filter((m) => m.type === "ack").length
        const entries = client.messages.flatMap((m) => (m.type === "entries" ? m.entries : []))
        return acks + entries.length === total
      })
      const seqs: number[] = []
      let last = 0
      for (const m of client.messages) {
        if (m.type === "ack") seqs.push(m.seq)
        if (m.type === "entries")
          for (const e of m.entries) {
            expect(e.seq).toBeGreaterThan(last)
            last = e.seq
            seqs.push(e.seq)
          }
      }
      expect(seqs.sort((x, y) => x - y)).toEqual(Array.from({ length: total }, (_, i) => i + 1))
    }
    for (const { client } of peers) client.close()
  })

  test("a view append is denied with its cid and never stored", async () => {
    const owner = await registered(h)
    const edit = await joinAs(h, owner, "edit")
    const view = await joinAs(h, owner, "view")
    view.client.send({ type: "append", cid: 5, env: await update(owner, "nope") })
    const denied = await view.client.next("denied")
    expect(denied).toMatchObject({ code: "VIEW_ONLY", cid: 5 })
    expect(await edit.client.drain("entries")).toHaveLength(0)
    const late = await joinAs(h, owner, "view")
    expect(late.welcome.head).toBe(0)
    for (const p of [edit, view, late]) p.client.close()
  })

  test("an oversize entry is denied TOO_LARGE", async () => {
    const small = startRelay({ entryMaxBytes: 2000 })
    const owner = await registered(small)
    const { client } = await joinAs(small, owner, "edit")
    const big = await sealUpdate(owner.keys, new Uint8Array(3000))
    client.send({ type: "append", cid: 3, env: big })
    expect(await client.next("denied")).toMatchObject({ code: "TOO_LARGE", cid: 3 })
    client.close()
    await small.stop()
  })

  test("a non-update envelope is denied", async () => {
    const owner = await registered(h)
    const { client } = await joinAs(h, owner, "edit")
    client.send({ type: "append", cid: 2, env: new Uint8Array(40) })
    expect(await client.next("denied")).toMatchObject({ code: "BAD_MESSAGE", cid: 2 })
    client.close()
  })

  test("the append rate limit closes with RATE_LIMITED", async () => {
    const owner = await registered(h)
    const { client } = await joinAs(h, owner, "edit")
    const env = await update(owner, "x")
    for (let i = 0; i < 260; i++) client.send({ type: "append", cid: i + 1, env })
    expect((await client.closeInfo()).reason).toBe("RATE_LIMITED")
  })
})

describe("awareness and peers", () => {
  async function presence(owner: Owner, peer: number, text: string) {
    return sealAwareness(owner.keys, peer, new TextEncoder().encode(text))
  }

  test("relayed to the others, clocks must increase, late joiners get the cache", async () => {
    const owner = await registered(h)
    const a = await joinAs(h, owner, "edit")
    const b = await joinAs(h, owner, "view")
    const env = await presence(owner, a.welcome.peer, "{}")
    a.client.send({ type: "awareness", clock: 1, env })
    expect(await b.client.next("awareness")).toMatchObject({ peer: a.welcome.peer, clock: 1 })
    a.client.send({ type: "awareness", clock: 1, env })
    a.client.send({ type: "awareness", clock: 0, env })
    expect(await b.client.drain("awareness")).toHaveLength(0)
    // A view socket may send awareness too.
    b.client.send({ type: "awareness", clock: 1, env: await presence(owner, b.welcome.peer, "{}") })
    expect(await a.client.next("awareness")).toMatchObject({ peer: b.welcome.peer })
    const late = await joinAs(h, owner, "view")
    const cached = await late.client.drain("awareness")
    expect(cached.map((m) => (m.type === "awareness" ? m.peer : 0)).sort()).toEqual(
      [a.welcome.peer, b.welcome.peer].sort(),
    )
    // Withdrawing removes the cache entry.
    a.client.send({ type: "awareness", clock: 2, env: new Uint8Array(0) })
    expect((await b.client.next("awareness")).env).toHaveLength(0)
    const later = await joinAs(h, owner, "view")
    const left = await later.client.drain("awareness")
    expect(left.map((m) => (m.type === "awareness" ? m.peer : 0))).toEqual([b.welcome.peer])
    for (const p of [a, b, late, later]) p.client.close()
  })

  test("awareness over the rate limit is dropped silently", async () => {
    const owner = await registered(h)
    const a = await joinAs(h, owner, "edit")
    const b = await joinAs(h, owner, "view")
    const env = await presence(owner, a.welcome.peer, "{}")
    for (let clock = 1; clock <= 100; clock++) a.client.send({ type: "awareness", clock, env })
    await Bun.sleep(300)
    const seen = b.client.messages.filter((m) => m.type === "awareness").length
    expect(seen).toBe(20)
    a.client.close()
    b.client.close()
  })

  test("awareness over 16 KiB is denied", async () => {
    const owner = await registered(h)
    const { client } = await joinAs(h, owner, "edit")
    client.send({ type: "awareness", clock: 1, env: new Uint8Array(16 * 1024 + 1) })
    expect(await client.next("denied")).toMatchObject({ code: "TOO_LARGE", cid: 0 })
    client.close()
  })

  test("peer-joined and peer-left", async () => {
    const owner = await registered(h)
    const a = await joinAs(h, owner, "edit")
    const b = await joinAs(h, owner, "view", { origin: "agent:x" })
    expect(await a.client.next("peer-joined")).toEqual({
      type: "peer-joined",
      peer: { peer: b.welcome.peer, role: "view", origin: "agent:x" },
    })
    b.client.close()
    expect(await a.client.next("peer-left")).toEqual({ type: "peer-left", peer: b.welcome.peer })
    a.client.close()
  })
})

describe("refresh", () => {
  test("replaces the token, keeps the connection and cancels the old expiry", async () => {
    const owner = await registered(h)
    const { client } = await joinAs(h, owner, "edit", { exp: nowSec() + 60 })
    const fresh = await token(owner, "edit", { exp: 0, iat: nowSec() })
    client.send({ type: "refresh", token: fresh })
    expect(await client.next("token")).toEqual({ type: "token", exp: 0 })
    h.clock.now += 120_000
    h.relay.tick()
    client.send({ type: "ping", n: 9 })
    expect((await client.next("pong")).n).toBe(9)
    client.close()
  })

  test("a different role is denied and the old token stays", async () => {
    const owner = await registered(h)
    const { client } = await joinAs(h, owner, "view")
    client.send({ type: "refresh", token: await token(owner, "edit") })
    expect(await client.next("denied")).toMatchObject({ code: "BAD_MESSAGE" })
    client.send({ type: "refresh", token: await token(owner, "view", { origin: "agent:z" }) })
    expect(await client.next("denied")).toMatchObject({ code: "BAD_MESSAGE" })
    client.send({ type: "ping", n: 1 })
    await client.next("pong")
    client.close()
  })

  test("a refused refresh reports the verification error", async () => {
    const owner = await registered(h)
    const { client } = await joinAs(h, owner, "view")
    client.send({ type: "refresh", token: await token(owner, "view", { exp: nowSec() - 1 }) })
    expect(await client.next("denied")).toMatchObject({ code: "TOKEN_EXPIRED" })
    client.close()
  })
})

describe("abuse limits", () => {
  const hello = (text: string) =>
    ({ type: "hello", proto: 1, token: text, since: 0, client: "test/1" }) as const

  test("one address may hold only a few tokenless sockets (429)", async () => {
    const owner = await registered(h)
    const idle: Client[] = []
    for (let i = 0; i < 3; i++) idle.push(await Client.connect(h, owner.room.id))
    const blocked = await fetch(`${h.base}/sync/${owner.room.id}`, {
      headers: upgradeHeaders("kimo-mp.1"),
    })
    expect(blocked.status).toBe(429)
    for (const c of idle) c.close()
  })

  test("tokenless sockets from other addresses never block the room", async () => {
    const owner = await registered(h)
    const idle: Client[] = []
    for (let i = 0; i < 12; i++) {
      idle.push(await Client.connect(h, owner.room.id))
      for (const ws of h.relay.rooms.get(owner.room.id)?.sockets ?? [])
        if (ws.data.stage === "hello") ws.data.ip = `ip-${i}`
    }
    const { client } = await joinAs(h, owner, "view")
    client.close()
    for (const c of idle) c.close()
  })

  test("the peer cap holds when many pending sockets complete hello at once", async () => {
    const small = startRelay({ maxPeers: 2 })
    const owner = await registered(small)
    const clients: Client[] = []
    for (let i = 0; i < 3; i++) {
      clients.push(await Client.connect(small, owner.room.id))
      for (const ws of small.relay.rooms.get(owner.room.id)?.sockets ?? [])
        if (ws.data.stage === "hello") ws.data.ip = `ip-${i}`
    }
    for (const c of clients) c.send(hello(await token(owner, "view")))
    await until(() => (small.relay.rooms.get(owner.room.id)?.peers.size ?? 0) >= 2)
    const closes = await Promise.race(clients.map((c) => c.closed))
    expect(closes).toEqual({ code: 4503, reason: "ROOM_FULL" })
    expect(small.relay.rooms.get(owner.room.id)?.peers.size).toBe(2)
    for (const c of clients) c.close()
    await small.stop()
  })

  test("a refresh flood is closed with RATE_LIMITED", async () => {
    const owner = await registered(h)
    const { client } = await joinAs(h, owner, "view")
    const fresh = await token(owner, "view", { iat: nowSec() })
    for (let i = 0; i < 20; i++) client.send({ type: "refresh", token: fresh })
    expect((await client.closeInfo()).reason).toBe("RATE_LIMITED")
  })

  test("a ping flood is closed with RATE_LIMITED", async () => {
    const owner = await registered(h)
    const { client } = await joinAs(h, owner, "view")
    for (let i = 0; i < 600; i++) client.send({ type: "ping", n: i })
    expect((await client.closeInfo()).reason).toBe("RATE_LIMITED")
  })
})

test("admin close is visible to sockets (sanity)", async () => {
  const owner = await registered(h)
  const { client } = await joinAs(h, owner, "edit")
  await admin(h, owner, { op: "close" })
  expect((await client.closeInfo()).reason).toBe("ROOM_CLOSED")
})
