/** The headless sharing API the Share panel and the join route call (apps/web/src/platform/share.ts). */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { YjsDocStore } from "@kimo/editor-state"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { MultiplayerError, parseJoinLink } from "@kimo/sync/mp"
import { createMemoryAssetStore } from "../src/lib/assets"
import { createMemoryRegistry } from "../src/multiplayer"
import { createPlatformShare } from "../src/platform/share"
import { insertRect, makeTarget, type Relay, startRelay, until } from "./multiplayer-helpers"

let relay: Relay
beforeEach(() => {
  relay = startRelay()
})
afterEach(async () => {
  await relay.stop()
})

const FILE = "/Users/me/loom/design.kimo"

function device() {
  const platform = createMemoryPlatform()
  const share = createPlatformShare({
    platform,
    assetsFor: () => createMemoryAssetStore(),
    serviceDeps: {
      registry: createMemoryRegistry(),
      webOrigin: "https://kimo.test",
      backoff: [5, 40],
      replica: () => null,
      openGuestDocument: async () => ({
        store: new YjsDocStore(),
        assets: createMemoryAssetStore(),
      }),
    },
  })
  return { platform, share }
}

describe("platform share", () => {
  test("there is no default relay: sharing without one is refused", async () => {
    const { platform, share } = device()
    expect(share.relayUrl()).toBeNull()
    const { store } = makeTarget(FILE)
    await expect(share.shareSession({ ref: FILE, store })).rejects.toBeInstanceOf(MultiplayerError)
    expect(platform.settings.get("multiplayer.relayUrl")).toBeNull()
  })

  test("the relay URL setting is normalized, saved and used", async () => {
    const { platform, share } = device()
    expect(await share.setRelayUrl(`${relay.url}/`)).toBe(relay.url)
    expect(platform.settings.get("multiplayer.relayUrl")).toBe(relay.url)
    const { store } = makeTarget(FILE)
    const shared = await share.shareSession({ ref: FILE, store })
    expect(shared.relayUrl).toBe(relay.url)
    expect(await share.setRelayUrl(null)).toBeNull()
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
