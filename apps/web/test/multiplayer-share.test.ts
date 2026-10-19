/** The share service against a real in-process relay (spec §18.D). */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { MultiplayerError, parseJoinLink } from "@kimo/sync/mp"
import {
  insertRect,
  makePeer,
  makeTarget,
  type Relay,
  startRelay,
  until,
} from "./multiplayer-helpers"

let relay: Relay
beforeEach(() => {
  relay = startRelay()
})
afterEach(async () => {
  await relay.stop()
})

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
