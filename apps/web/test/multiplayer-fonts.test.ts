/** Font share policy through the share service (spec §16.5). */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { fontShareDecision } from "@kimo/sync/mp"
import { makePeer, makeTarget, type Relay, startRelay } from "./multiplayer-helpers"

let relay: Relay
beforeEach(() => {
  relay = startRelay()
})
afterEach(async () => {
  await relay.stop()
})

describe("font policy", () => {
  test("bundled, pack and Google families share; user files and unknown families are name-only", () => {
    expect(fontShareDecision({ family: "Inter", source: "bundled" })).toBe("share")
    expect(fontShareDecision({ family: "Playfair Display", source: "pack" })).toBe("share")
    expect(fontShareDecision({ family: "Inter" })).toBe("name-only")
    expect(fontShareDecision({ family: "Zapfino", source: "google" })).toBe("share")
    expect(fontShareDecision({ family: "Zapfino" })).toBe("name-only")
    expect(fontShareDecision({ family: "Inter", source: "user" })).toBe("name-only")
  })

  test("sharing warns once per name-only family and never for shared ones", async () => {
    const owner = makePeer()
    const target = makeTarget()
    for (const [id, font] of [
      ["Text000001", "Zapfino"],
      ["Text000002", "Zapfino"],
      ["Text000003", "Inter"],
      ["Text000004", "Papyrus"],
    ] as const) {
      target.store.apply(
        {
          op: "insert",
          id,
          node: { type: "text", content: "hi", style: { font, size: 12 } },
        } as never,
        { origin: "user" },
      )
    }
    const events: { room: string; families: string[] }[] = []
    owner.service.onFontNotShared((e) => events.push(e))
    const { room } = await owner.service.startSharing(target, { relayUrl: relay.url })
    expect(events).toHaveLength(1)
    expect(events[0]?.room).toBe(room)
    expect([...(events[0]?.families ?? [])].sort()).toEqual(["Papyrus", "Zapfino"])
    await owner.service.stopSharing(room)
  })
})
