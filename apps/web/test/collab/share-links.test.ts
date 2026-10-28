/** The headless sharing API the Share panel and the join route call (apps/web/src/platform/share.ts). */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { MultiplayerError, parseJoinLink } from "@kimo/sync/mp"
import { insertRect, makeDevice, makeTarget, type Relay, startRelay, until } from "./helpers"

let relay: Relay
beforeEach(() => {
  relay = startRelay()
})
afterEach(async () => {
  await relay.stop()
})

const FILE = "/Users/me/loom/design.kimo"

const device = () => makeDevice()

describe("platform share", () => {
  test("there is no default relay: sharing without one is refused", async () => {
    const { platform, share } = device()
    expect(share.relayUrl()).toBeNull()
    const { store } = makeTarget(FILE)
    await expect(share.shareSession({ ref: FILE, store })).rejects.toBeInstanceOf(MultiplayerError)
    expect(platform.settings.get("multiplayer.relayUrl")).toBeNull()
  })

  test("starting several times at once mints one view and one edit link", async () => {
    const { share } = device()
    const { store } = makeTarget(FILE)
    const runs = await Promise.all(
      Array.from({ length: 5 }, () => share.shareSession({ ref: FILE, store }, relay.url)),
    )
    expect(new Set(runs.map((r) => r.room)).size).toBe(1)
    expect(new Set(runs.map((r) => r.view.jti)).size).toBe(1)
    expect(new Set(runs.map((r) => r.edit.jti)).size).toBe(1)
    const first = runs[0] as (typeof runs)[number]
    const links = await share.links(first.room)
    expect(links.filter((l) => l.role === "view")).toHaveLength(1)
    expect(links.filter((l) => l.role === "edit")).toHaveLength(1)
    // A later start reuses them too.
    const again = await share.shareSession({ ref: FILE, store }, relay.url)
    expect(again.view.jti).toBe(first.view.jti)
    expect((await share.links(again.room)).length).toBe(2)
    await share.stopSharing()
  })

  test("share, join, presence, status, invites, revoke, reset and stop", async () => {
    const owner = device()
    const guest = device()
    const { store } = makeTarget(FILE)
    const shared = await owner.share.shareSession({ ref: FILE, store }, relay.url)
    expect(shared.view.role).toBe("view")
    expect(shared.edit.role).toBe("edit")
    expect(parseJoinLink(shared.edit.link).room).toBe(shared.room)
    expect(owner.share.activeRoom()).toBe(shared.room)

    const statuses: string[] = []
    guest.share.onStatus((_room, event) => statuses.push(event.status))
    const session = await guest.share.joinLink(shared.edit.link)
    expect(guest.share.activeRoom()).toBe(shared.room)
    expect(guest.share.status()).not.toBeNull()

    // Presence travels both ways without the UI.
    const seen: number[] = []
    owner.share.onPresence((_room, change) => seen.push(...change.added, ...change.updated))
    session.setPresence({ user: { id: "g", name: "Guest", color: "#f00" }, cursor: { x: 1, y: 2 } })
    await until(() =>
      [...owner.share.presence().values()].some(
        (p) => p.user.name === "Guest" && p.origin === "user",
      ),
    )
    expect(seen.length).toBeGreaterThan(0)

    insertRect(store, "FromOwner01")
    await until(() => session.store.hasNode("FromOwner01"))

    // An invite with an expiry, then revoke it.
    const invite = await owner.share.createInvite("view", Math.floor(Date.now() / 1000) + 3600, {
      label: "reviewer",
    })
    expect(invite.exp).toBeGreaterThan(0)
    const second = device()
    const viewer = await second.share.joinLink(invite.link)
    expect(viewer.role).toBe("view")
    await owner.share.revoke(invite.jti)
    await until(() => viewer.status === "error")

    const { kid } = await owner.share.resetLinks()
    expect(kid).toBe(2)
    await until(() => session.status === "error")
    expect((await owner.share.links()).every((l) => l.revoked)).toBe(true)

    const swept = await owner.share.sweepBlobs()
    expect(swept.deleted).toBe(0)

    await owner.share.stopSharing()
    expect(owner.share.activeRoom()).toBeNull()
    expect(await owner.share.service.roomForFile(FILE)).toBeNull()
    await guest.share.leave()
  })
})

describe("invites", () => {
  test("an expiry in the past is refused, not turned into a one second link", async () => {
    const { share } = device()
    await expect(
      share.createInvite("view", Math.floor(Date.now() / 1000) - 60, { room: "x" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" })
  })
})
