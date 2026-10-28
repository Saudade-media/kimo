/** The share service against a real in-process relay: rooms, links, roles and teardown. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { MultiplayerError, parseJoinLink, parseToken } from "@kimo/sync/mp"
import { SELF_RENEW_CHECK_MS } from "../../src/multiplayer/share"
import { insertRect, makePeer, makeTarget, type Relay, startRelay, until } from "./helpers"

let relay: Relay
beforeEach(() => {
  relay = startRelay()
})
afterEach(async () => {
  await relay.stop()
})

const FILE = "/Users/me/loom/site.kimo"

describe("share service", () => {
  test("startSharing registers, seeds a snapshot and connects", async () => {
    const owner = makePeer()
    const target = makeTarget()
    const summary = await owner.service.startSharing(target, { relayUrl: relay.url })
    expect(summary.room).toMatch(/^[a-z2-7]{32}$/)
    expect(summary.relayUrl).toBe(relay.url)
    expect((await owner.service.roomForFile(target.fileKey))?.room).toBe(summary.room)
    // The relay knows the room, holds the seed snapshot, and the owner's session is connected.
    const self = (await owner.registry.getOwned(summary.room))?.links.find((l) => l.self)
    const auth = { authorization: `Bearer ${parseJoinLink(self?.link as string).token}` }
    const info = await fetch(`${relay.url}/room/${summary.room}`, { headers: auth })
    expect(info.status).toBe(200)
    const body = (await info.json()) as { snapshot: { upTo: number } | null; peers: number }
    expect(body.snapshot?.upTo).toBe(0)
    const snapshot = await fetch(`${relay.url}/room/${summary.room}/snapshot`, { headers: auth })
    expect(snapshot.status).toBe(200)
    const session = await owner.service.connect(target, summary.room)
    expect(session.provider.connected).toBe(true)
    await until(async () => {
      const again = await fetch(`${relay.url}/room/${summary.room}`, { headers: auth })
      return ((await again.json()) as { peers: number }).peers >= 1
    })
    // Sharing twice is idempotent.
    expect((await owner.service.startSharing(target, { relayUrl: relay.url })).room).toBe(
      summary.room,
    )
    await owner.service.stopSharing(summary.room)
  })

  test("a minted link parses and joins; edits converge both ways", async () => {
    const owner = makePeer()
    const guest = makePeer()
    const target = makeTarget()
    const { room } = await owner.service.startSharing(target, { relayUrl: relay.url })
    const edit = await owner.service.mintLink(room, { role: "edit", ttlSeconds: null })
    const parsed = parseJoinLink(edit.link)
    expect(parsed.room).toBe(room)
    expect(edit.link.startsWith("https://kimo.test/join#")).toBe(true)
    expect(edit.link.includes("?")).toBe(false)

    const session = await guest.service.join(edit.link)
    expect(session.role).toBe("edit")
    const store = guest.guests[0]?.store
    expect(store?.hasNode("Rect000001")).toBe(true)

    insertRect(target.store, "FromOwner01")
    await until(() => store?.hasNode("FromOwner01") === true)
    insertRect(session.store, "FromGuest01")
    await until(() => target.store.hasNode("FromGuest01"))
    expect((await guest.service.listJoinedRooms())[0]?.room).toBe(room)

    await session.leave()
    await owner.service.stopSharing(room)
  })

  test("a view link yields a read-only store", async () => {
    const owner = makePeer()
    const guest = makePeer()
    const target = makeTarget()
    const { room } = await owner.service.startSharing(target, { relayUrl: relay.url })
    const view = await owner.service.mintLink(room, { role: "view", ttlSeconds: 3600 })
    const session = await guest.service.join(view.link)
    expect(session.role).toBe("view")
    expect(session.store.readOnly).not.toBeNull()
    const result = session.store.apply(
      { op: "insert", id: "Nope0000001", node: { type: "rect", w: 1, h: 1 } },
      { origin: "user" },
    )
    expect(result.ok).toBe(false)
    await session.leave()
    await owner.service.stopSharing(room)
  })

  test("revokeLink closes that guest only", async () => {
    const owner = makePeer()
    const bob = makePeer()
    const carol = makePeer()
    const target = makeTarget()
    const { room } = await owner.service.startSharing(target, { relayUrl: relay.url })
    const a = await owner.service.mintLink(room, { role: "edit", ttlSeconds: null, label: "bob" })
    const b = await owner.service.mintLink(room, { role: "edit", ttlSeconds: null, label: "carol" })
    const sa = await bob.service.join(a.link)
    const sb = await carol.service.join(b.link)
    await owner.service.revokeLink(room, a.jti)
    await until(() => sa.status === "error")
    expect(sb.status).not.toBe("error")
    expect((await owner.service.listLinks(room)).find((l) => l.jti === a.jti)?.revoked).toBe(true)
    // The revoked link cannot join again.
    const again = makePeer()
    await expect(again.service.join(a.link)).rejects.toBeInstanceOf(MultiplayerError)
    await sb.leave()
    await owner.service.stopSharing(room)
  })

  test("resetAllLinks invalidates old links and keeps the owner connected", async () => {
    const owner = makePeer()
    const guest = makePeer()
    const target = makeTarget()
    const { room } = await owner.service.startSharing(target, { relayUrl: relay.url })
    const old = await owner.service.mintLink(room, { role: "edit", ttlSeconds: null })
    const session = await guest.service.join(old.link)
    const ownerSession = await owner.service.connect(target, room)
    const { kid } = await owner.service.resetAllLinks(room)
    expect(kid).toBe(2)
    await until(() => session.status === "error")
    // The owner reconnects with the re-minted token and still syncs.
    const fresh = await owner.service.mintLink(room, { role: "edit", ttlSeconds: null })
    const other = makePeer()
    const joined = await other.service.join(fresh.link)
    insertRect(target.store, "AfterReset01")
    await until(() => other.guests[0]?.store.hasNode("AfterReset01") === true)
    await expect(makePeer().service.join(old.link)).rejects.toBeInstanceOf(MultiplayerError)
    await joined.leave()
    await ownerSession.leave()
    await owner.service.stopSharing(room)
  })

  test("stopSharing closes guests and clears the registry", async () => {
    const owner = makePeer()
    const guest = makePeer()
    const target = makeTarget()
    const { room } = await owner.service.startSharing(target, { relayUrl: relay.url })
    const link = await owner.service.mintLink(room, { role: "edit", ttlSeconds: null })
    const session = await guest.service.join(link.link)
    await owner.service.stopSharing(room)
    await until(() => session.status === "error")
    expect(await owner.service.roomForFile(target.fileKey)).toBeNull()
    expect(await owner.registry.getOwned(room)).toBeNull()
    await expect(makePeer().service.join(link.link)).rejects.toBeInstanceOf(MultiplayerError)
  })

  test("a relay that is not a relay is refused before any key is made", async () => {
    const owner = makePeer({
      fetch: (async () =>
        new Response("<html></html>", { status: 200 })) as unknown as typeof fetch,
    })
    await expect(
      owner.service.startSharing(makeTarget(), { relayUrl: "https://example.com" }),
    ).rejects.toBeInstanceOf(MultiplayerError)
    expect(await owner.registry.listOwned()).toEqual([])
  })
})

describe("upgrading a view session with an edit link", () => {
  test("the session reconnects as an editor and the registry follows", async () => {
    const owner = makePeer()
    const guest = makePeer()
    const target = makeTarget()
    const { room } = await owner.service.startSharing(target, { relayUrl: relay.url })
    const view = await owner.service.mintLink(room, { role: "view", ttlSeconds: null })
    const edit = await owner.service.mintLink(room, { role: "edit", ttlSeconds: null })

    const first = await guest.service.join(view.link)
    expect(first.role).toBe("view")
    expect(first.store.readOnly).not.toBeNull()
    expect((await guest.registry.getJoined(room))?.role).toBe("view")

    const second = await guest.service.join(edit.link)
    expect(second).toBe(first)
    expect(second.role).toBe("edit")
    expect(second.provider.role).toBe("edit")
    expect(second.store.readOnly).toBeNull()
    const joined = await guest.registry.getJoined(room)
    expect(joined?.role).toBe("edit")

    insertRect(second.store, "FromGuest01")
    await until(() => target.store.hasNode("FromGuest01"))
    insertRect(target.store, "FromOwner01")
    await until(() => second.store.hasNode("FromOwner01"))
    await second.leave()
    await owner.service.stopSharing(room)
  })

  test("a refused edit link leaves the view session and its record as they were", async () => {
    const owner = makePeer()
    const guest = makePeer()
    const target = makeTarget()
    const { room } = await owner.service.startSharing(target, { relayUrl: relay.url })
    const view = await owner.service.mintLink(room, { role: "view", ttlSeconds: null })
    const edit = await owner.service.mintLink(room, { role: "edit", ttlSeconds: null })
    const session = await guest.service.join(view.link)
    await owner.service.revokeLink(room, edit.jti)

    await expect(guest.service.join(edit.link)).rejects.toThrow()
    expect(session.role).toBe("view")
    expect(session.store.readOnly).not.toBeNull()
    expect((await guest.registry.getJoined(room))?.role).toBe("view")
    // The view connection is back.
    await until(() => session.provider.connected)
    await session.leave()
    await owner.service.stopSharing(room)
  })
})

describe("creating a room", () => {
  test("a failed seed leaves no room behind and a retry starts clean", async () => {
    let failSnapshot = true
    const owner = makePeer({
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (failSnapshot && String(input).includes("/snapshot") && init?.method === "PUT")
          return new Response("nope", { status: 503 })
        return fetch(input, init)
      }) as typeof fetch,
    })
    const target = makeTarget("/work/fail.kimo")
    await expect(owner.service.startSharing(target, { relayUrl: relay.url })).rejects.toThrow()
    expect(await owner.service.roomForFile(target.fileKey)).toBeNull()
    failSnapshot = false
    const { room } = await owner.service.startSharing(target, { relayUrl: relay.url })
    expect(await owner.registry.saves.load(room)).not.toBeNull()
    await owner.service.stopSharing(room)
  })

  test("two concurrent calls for one file make one room", async () => {
    const owner = makePeer()
    const target = makeTarget("/work/double.kimo")
    const [a, b] = await Promise.all([
      owner.service.startSharing(target, { relayUrl: relay.url }),
      owner.service.startSharing(target, { relayUrl: relay.url }),
    ])
    expect(a.room).toBe(b.room)
    expect((await owner.registry.listOwned()).length).toBe(1)
    await owner.service.stopSharing(a.room)
  })
})

describe("the owner's token", () => {
  test("connecting again hands an open session the re-minted token", async () => {
    let clock = Date.now()
    const owner = makePeer({ now: () => clock })
    const target = makeTarget("/work/token.kimo")
    const { room } = await owner.service.startSharing(target, { relayUrl: relay.url })
    const session = await owner.service.connect(target, room)
    const before = (await owner.registry.getOwned(room))?.links.find((l) => l.self)?.jti
    clock += 29.5 * 86_400_000
    const again = await owner.service.connect(target, room)
    expect(again).toBe(session)
    const after = (await owner.registry.getOwned(room))?.links.find((l) => l.self)?.jti
    expect(after).not.toBe(before)
    await session.leave()
    await owner.service.stopSharing(room)
  })

  test("a session open for more than 29 days re-mints the owner's token on a timer", async () => {
    let now = Date.now()
    let seq = 0
    const queue = new Map<number, { at: number; fn: () => void }>()
    const timers = {
      setTimeout(fn: () => void, ms: number) {
        const id = ++seq
        queue.set(id, { at: now + ms, fn })
        return id
      },
      clearTimeout(id: unknown) {
        queue.delete(id as number)
      },
    }
    const advance = (ms: number) => {
      const end = now + ms
      for (;;) {
        let next: [number, { at: number; fn: () => void }] | null = null
        for (const e of queue) if (e[1].at <= end && (!next || e[1].at < next[1].at)) next = e
        if (!next) break
        queue.delete(next[0])
        now = Math.max(now, next[1].at)
        next[1].fn()
      }
      now = end
    }
    const owner = makePeer({ replica: () => null, timers, now: () => now })
    const target = makeTarget(FILE)
    const { room } = await owner.service.startSharing(target, { relayUrl: relay.url })
    const selfLink = async () => (await owner.registry.getOwned(room))?.links.find((l) => l.self)
    const first = await selfLink()
    expect(first).toBeDefined()
    const exp = first?.exp as number
    // The check wakes at least hourly.
    expect([...queue.values()].every((t) => t.at - now <= SELF_RENEW_CHECK_MS)).toBe(true)
    // 28 days on: nothing to do yet.
    advance(28 * 86_400_000)
    await Bun.sleep(10)
    expect((await selfLink())?.jti).toBe(first?.jti)
    // Less than a day left: re-minted.
    advance(86_400_000 + 2 * SELF_RENEW_CHECK_MS)
    await until(async () => (await selfLink())?.jti !== first?.jti)
    const renewed = await selfLink()
    expect(renewed?.exp).toBeGreaterThan(exp)
    expect(parseToken(parseJoinLink(renewed?.link as string).token).exp).toBe(
      renewed?.exp as number,
    )
    // And the timer keeps running for the next one.
    expect(queue.size).toBeGreaterThan(0)
    const session = await owner.service.connect(target, room)
    await session.leave()
    await owner.service.stopSharing(room)
  })
})

describe("closing a room", () => {
  test("a relay that is gone does not keep the room registered", async () => {
    const owner = makePeer()
    const target = makeTarget("/work/gone.kimo")
    const { room } = await owner.service.startSharing(target, { relayUrl: relay.url })
    await relay.stop()
    const result = await owner.service.stopSharing(room)
    expect(result.relayNotified).toBe(false)
    expect(result.relayError?.code).toBe("RELAY_UNREACHABLE")
    expect(await owner.service.roomForFile(target.fileKey)).toBeNull()
    expect(await owner.registry.getOwned(room)).toBeNull()
    relay = startRelay()
  })
})
