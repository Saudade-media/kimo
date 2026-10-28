/** Presence and agent claims travelling between a room's owner and a guest. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { claimsFor } from "@kimo/editor-state"
import { makeDevice, makeTarget, type Relay, startRelay, until } from "./helpers"

let relay: Relay
beforeEach(() => {
  relay = startRelay()
})
afterEach(async () => {
  await relay.stop()
})

const FILE = "/Users/me/loom/site.kimo"
const device = makeDevice

describe("claims in presence", () => {
  test("agent claims reach peers and gate their agents; peers' claims gate ours", async () => {
    const owner = device()
    const guest = device()
    const { store } = makeTarget(FILE, ["Rect000001", "Rect000002"])
    const links = await owner.share.shareSession({ ref: FILE, store }, relay.url)
    const visitor = await guest.share.joinLink(links.edit.link)
    await until(() => visitor.store.hasNode("Rect000002"))

    // The owner's agent claims Rect000001.
    expect(claimsFor(store).claim("agent:kimo.own.1", ["Rect000001"], { label: "Kimo" })).toBeNull()
    await until(() =>
      claimsFor(visitor.store)
        .list()
        .some((c) => !c.local && c.holder === "agent:kimo.own.1"),
    )
    const busy = claimsFor(visitor.store).check("agent:kimo.gst.1", ["Rect000001"])
    expect(busy?.holder).toBe("agent:kimo.own.1")
    expect(claimsFor(visitor.store).check("agent:kimo.gst.1", ["Rect000002"])).toBeNull()

    // And back: the guest's agent claims Rect000002; the owner's agents are gated there.
    claimsFor(visitor.store).claim("agent:kimo.gst.1", ["Rect000002"], { label: "Sol" })
    await until(() => claimsFor(store).check("agent:kimo.own.1", ["Rect000002"]) !== null)

    // The owner flag and the owner's claims stay in presence.
    owner.share.setLocalPresence({ cursor: { x: 5, y: 6 } })
    await until(() =>
      [...visitor.provider.awareness.getStates().values()].some(
        (s) => s.owner === true && s.cursor?.x === 5 && (s.claims?.length ?? 0) > 0,
      ),
    )
    // Leaving a live text edit clears the caret for everyone else: the next publish has no
    // `text`, and the field must not linger from the earlier state.
    const caret = { node: "Rect000001", anchor: "a", focus: "b" }
    guest.share.setLocalPresence({ selection: ["Rect000001"], text: caret })
    /** The guest's presence as the owner sees it. */
    const guestSeen = () =>
      [...(owner.share.session()?.provider.awareness.getStates().values() ?? [])].find(
        (s) => s.owner !== true,
      )
    await until(() => guestSeen()?.text?.node === "Rect000001")
    guest.share.setLocalPresence({ selection: ["Rect000002"] })
    await until(() => guestSeen()?.selection?.[0] === "Rect000002")
    expect(guestSeen()?.text).toBeUndefined()
    await guest.share.leave()
    await owner.share.stopSharing()
  })
})
