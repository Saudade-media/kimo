/**
 * Multiplayer wired into the running app: shared files reconnect as the session manager opens
 * them, saves are recorded for the next reopen, the desktop registry is a file under the Kimo
 * home, agent claims travel in presence, the owner's token renews on a timer, and the local share
 * backend feeds the view model.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { claimsFor, YjsDocStore } from "@kimo/editor-state"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { parseJoinLink, parseToken } from "@kimo/sync/mp"
import { createMemoryAssetStore } from "../src/lib/assets"
import { createMemoryRegistry } from "../src/multiplayer"
import { createLocalShareBackend } from "../src/multiplayer/backend"
import { createMultiplayerModel } from "../src/multiplayer/model"
import { createSharedFileHooks } from "../src/multiplayer/room-session"
import { SELF_RENEW_CHECK_MS } from "../src/multiplayer/share"
import { createSessionManager } from "../src/platform/session"
import {
  createPlatformShare,
  desktopRegistryPath,
  type PlatformShareDeps,
  registryFor,
} from "../src/platform/share"
import { docText, nodeMerge } from "./m4-helpers"
import { makePeer, makeTarget, type Relay, startRelay, until } from "./multiplayer-helpers"

let relay: Relay
beforeEach(() => {
  relay = startRelay()
})
afterEach(async () => {
  await relay.stop()
})

const FILE = "/Users/me/loom/site.kimo"

function device(
  platform = createMemoryPlatform(),
  extra: Partial<PlatformShareDeps["serviceDeps"]> = {},
) {
  const registry = createMemoryRegistry()
  const share = createPlatformShare({
    platform,
    assetsFor: () => createMemoryAssetStore(),
    serviceDeps: {
      registry,
      webOrigin: "https://kimo.test",
      backoff: [5, 40],
      replica: () => null,
      openGuestDocument: async () => ({
        store: new YjsDocStore(),
        assets: createMemoryAssetStore(),
      }),
      ...extra,
    },
  })
  return { platform, share, registry }
}

describe("file sessions and rooms", () => {
  test("a shared file reconnects when the session manager opens it, with guests' edits", async () => {
    const platform = createMemoryPlatform({ files: { [FILE]: docText("Site", ["Rect000001"]) } })
    const owner = device(platform)
    const manager = createSessionManager({
      platform,
      merge: nodeMerge,
      shared: createSharedFileHooks(owner.share),
    })
    const first = await manager.open(FILE)
    expect(first.store.hasNode("Rect000001")).toBe(true)
    const links = await owner.share.shareSession(first, relay.url)
    expect(owner.share.roomOfFile(FILE)).toBe(links.room)

    const guest = device()
    const visitor = await guest.share.joinLink(links.edit.link)
    await until(() => visitor.store.hasNode("Rect000001"))

    // The owner closes the file: the room session ends with it.
    expect(await first.close()).toBe(true)
    expect(owner.share.roomOfFile(FILE)).toBeNull()
    // A guest edits while the owner is away.
    visitor.store.apply(
      { op: "update", id: "Rect000001", set: { name: "FromGuest" } },
      { origin: "user" },
    )

    // Reopening reconnects (no replica here: the room's catch-up supplies the state).
    const second = await manager.open(FILE)
    expect(owner.share.roomOfFile(FILE)).toBe(links.room)
    await until(() => second.store.getNode("Rect000001")?.name === "FromGuest")
    expect(second.store.nodeIds()).toEqual(["Rect000001"])

    // A save of the shared file records what the file now holds (the next reopen's base).
    expect((await owner.registry.saves.load(links.room))?.fileHash).toBeNull()
    second.store.apply(
      { op: "update", id: "Rect000001", set: { name: "Saved" } },
      { origin: "user" },
    )
    await second.save()
    const text = (await platform.files.readText(FILE)).text
    expect(text).toContain("Saved")
    await until(async () => (await owner.registry.saves.load(links.room))?.fileHash != null)

    await second.close()
    await guest.share.leave()
  })

  test("unshared files open as before and saves record nothing", async () => {
    const platform = createMemoryPlatform({ files: { [FILE]: docText("Site", ["Rect000001"]) } })
    const owner = device(platform)
    const calls: string[] = []
    const hooks = createSharedFileHooks(owner.share)
    const manager = createSessionManager({
      platform,
      merge: nodeMerge,
      shared: {
        open: async (s, d) => {
          calls.push("open")
          return hooks.open(s, d)
        },
        writing: (s, d) => {
          const r = hooks.writing(s, d)
          calls.push(r ? "writing:shared" : "writing:plain")
          return r
        },
        closed: (s) => {
          calls.push("closed")
          hooks.closed(s)
        },
      },
    })
    const session = await manager.open(FILE)
    expect(session.store.hasNode("Rect000001")).toBe(true)
    session.store.apply(
      { op: "update", id: "Rect000001", set: { name: "Edited" } },
      { origin: "user" },
    )
    await session.save()
    await session.close()
    expect(calls).toEqual(["open", "writing:plain", "closed"])
  })
})

describe("desktop registry", () => {
  test("the owner's registry is a JSON file under the Kimo home", async () => {
    expect(desktopRegistryPath("/Users/me/.kimo/")).toBe("/Users/me/.kimo/multiplayer/rooms.json")
    const memory = createMemoryPlatform()
    expect(registryFor(memory)).toBeUndefined()
    const desktop = Object.assign(Object.create(memory), {
      kind: "desktop" as const,
      kimoHome: "/Users/me/.kimo",
      files: memory.files,
      settings: memory.settings,
    })
    expect(registryFor({ kind: "browser", kimoHome: "/x", files: memory.files })).toBeUndefined()
    const share = createPlatformShare({
      platform: desktop,
      assetsFor: () => createMemoryAssetStore(),
      serviceDeps: {
        webOrigin: "kimo:",
        backoff: [5, 40],
        replica: () => null,
        openGuestDocument: async () => ({
          store: new YjsDocStore(),
          assets: createMemoryAssetStore(),
        }),
      },
    })
    const { store } = makeTarget(FILE)
    const shared = await share.shareSession({ ref: FILE, store }, relay.url)
    const text = (await memory.files.readText("/Users/me/.kimo/multiplayer/rooms.json")).text
    const data = JSON.parse(text) as { owned: Record<string, { fileKey: string }> }
    expect(data.owned[shared.room]?.fileKey).toBe(FILE)
    await share.stopSharing()
  })
})

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

    // People show with a presence color and the owner flag; claims stay in presence.
    await until(() =>
      [...visitor.provider.awareness.getStates().values()].some(
        (s) => s.owner === true && s.user.color.startsWith("presence-"),
      ),
    )
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

  test("the local backend feeds the view model: people, roles, owner and claims", async () => {
    const platform = createMemoryPlatform({
      settings: { "multiplayer.displayName": "Maya" },
    })
    const owner = device(platform)
    const guest = device()
    const { store } = makeTarget(FILE)
    const backend = createLocalShareBackend({
      share: owner.share,
      storeFor: (ref) => (ref === FILE ? store : null),
      sessionFor: (ref) => (ref === FILE ? { ref, store } : null),
    })
    const model = createMultiplayerModel({ backend, settings: platform.settings })
    const doc = model.document(FILE)
    doc.subscribe(() => {})
    expect(doc.getState().share.status).toBe("not-shared")
    await owner.share.setRelayUrl(relay.url)
    await doc.startSharing()
    expect(doc.getState().share.status).toBe("live")
    expect(
      doc
        .getState()
        .links.items.map((l) => l.role)
        .sort(),
    ).toEqual(["edit", "view"])
    const link = doc.getState().links.items.find((l) => l.role === "view")?.link as string
    const viewer = await guest.share.joinLink(link)
    expect(viewer.role).toBe("view")
    await until(() => doc.getState().people.length === 2)
    const people = doc.getState().people
    expect(people[0]).toMatchObject({ label: "Maya", owner: true, isYou: true })
    expect(people[1]).toMatchObject({ label: "Guest 1", isYou: false, role: "view" })
    // The guest joined second: it yields the owner's color.
    await until(() => {
      const [a, b] = doc.getState().people
      return a?.color === "presence-clay" && b?.color === "presence-pine"
    })
    claimsFor(store).claim("agent:kimo.own.1", ["Rect000001"], { label: "Kimo" })
    expect(doc.getState().agents.map((a) => [a.label, a.isYours])).toEqual([["Kimo", true]])
    await guest.share.leave()
    await doc.stopSharing()
    expect(doc.getState().share.status).toBe("not-shared")
  })
})

describe("owner token renewal", () => {
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
