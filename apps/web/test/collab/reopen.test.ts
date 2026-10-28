/**
 * The owner closes and reopens a shared document: the room and the file meet without duplicating
 * nodes, losing a guest's edits or letting a stale file win.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { KimoDocument } from "@kimo/core-schema"
import { YjsDocStore } from "@kimo/editor-state"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { contentDigest, createMemoryAssetStore } from "../../src/lib/assets"
import { createSharedFileHooks } from "../../src/multiplayer/room-session"
import { createSessionManager } from "../../src/platform/session"
import { docText, nodeMerge } from "../session-helpers"
import {
  MemoryReplica,
  makeDevice,
  makePeer,
  makeTarget,
  type Relay,
  startRelay,
  until,
} from "./helpers"

let relay: Relay
beforeEach(() => {
  relay = startRelay()
})
afterEach(async () => {
  await relay.stop()
})

const reopened = (fileKey: string) => ({
  fileKey,
  store: new YjsDocStore(),
  assets: createMemoryAssetStore(),
})

describe("reopening a shared file", () => {
  test("with a replica no node is re-inserted: the file diff is empty", async () => {
    const disk = { state: null as Uint8Array | null }
    const owner = makePeer({ replica: () => new MemoryReplica(disk) })
    const target = makeTarget("/work/a.kimo", ["Rect000001", "Rect000002"])
    const file = target.store.toDocument()
    const { room } = await owner.service.startSharing(target, { relayUrl: relay.url })
    await (await owner.service.connect(target, room)).leave()

    const next = reopened("/work/a.kimo")
    const updates: string[] = []
    next.store.onUpdate((_u, origin) => updates.push(String(origin)))
    const session = await owner.service.reopenShared(next, file)
    expect(session).not.toBeNull()
    expect(next.store.nodeIds().sort()).toEqual(["Rect000001", "Rect000002"])
    // The replica supplied the state; loading the identical file changed nothing.
    // (The file delta is applied with origin "remote:file": none may have reached the store.)
    expect(updates.filter((o) => o === "remote:file")).toEqual([])
    await session?.leave()
    await owner.service.stopSharing(room)
  })

  test("without a replica, edits a guest made while the owner was away survive the reopen", async () => {
    const owner = makePeer({ replica: () => null })
    const guest = makePeer()
    const target = makeTarget("/work/c.kimo", ["Rect000001", "Rect000002"])
    const file = target.store.toDocument()
    const { room } = await owner.service.startSharing(target, { relayUrl: relay.url })
    const link = await owner.service.mintLink(room, { role: "edit", ttlSeconds: null })
    const watcher = await guest.service.join(link.link)
    await (await owner.service.connect(target, room)).leave()

    // The owner is away; the guest renames one node and deletes another.
    expect(
      watcher.store.apply(
        [
          { op: "update", id: "Rect000001", set: { name: "GuestEdit" } },
          { op: "delete", id: "Rect000002" },
        ],
        { origin: "user" },
      ).ok,
    ).toBe(true)

    // The file on disk is the one saved at share time: older than the room.
    const next = reopened("/work/c.kimo")
    const session = await owner.service.reopenShared(next, file)
    expect(session).not.toBeNull()
    await until(() => next.store.getNode("Rect000001")?.name === "GuestEdit")
    expect(next.store.hasNode("Rect000002")).toBe(false)
    // Nothing was pushed back to the guest.
    await new Promise((r) => setTimeout(r, 100))
    expect(watcher.store.getNode("Rect000001")?.name).toBe("GuestEdit")
    expect(watcher.store.hasNode("Rect000002")).toBe(false)
    await session?.leave()
    await watcher.leave()
    await owner.service.stopSharing(room)
  })

  test("with a replica, a remote edit the owner never saved survives the reopen", async () => {
    const disk = { state: null as Uint8Array | null }
    const owner = makePeer({ replica: () => new MemoryReplica(disk) })
    const guest = makePeer()
    const target = makeTarget("/work/d.kimo", ["Rect000001", "Rect000002"])
    const file = target.store.toDocument()
    const { room } = await owner.service.startSharing(target, { relayUrl: relay.url })
    const link = await owner.service.mintLink(room, { role: "edit", ttlSeconds: null })
    const watcher = await guest.service.join(link.link)
    // The owner is connected while the guest renames; the file is not saved afterwards.
    watcher.store.apply(
      { op: "update", id: "Rect000001", set: { name: "Remote" } },
      { origin: "user" },
    )
    await until(() => target.store.getNode("Rect000001")?.name === "Remote")
    await (await owner.service.connect(target, room)).leave()

    const next = reopened("/work/d.kimo")
    const session = await owner.service.reopenShared(next, file)
    expect(next.store.getNode("Rect000001")?.name).toBe("Remote")
    await new Promise((r) => setTimeout(r, 100))
    expect(watcher.store.getNode("Rect000001")?.name).toBe("Remote")
    await session?.leave()
    await watcher.leave()
    await owner.service.stopSharing(room)
  })

  test("a relay that fails the first attempt does not make the stale file win", async () => {
    let attempts = 0
    const Flaky = class extends WebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(attempts++ === 0 ? "ws://127.0.0.1:1/dead" : url, protocols)
      }
    }
    const owner = makePeer({ replica: () => null, WebSocket: Flaky as never })
    const guest = makePeer()
    const target = makeTarget("/work/e.kimo", ["Rect000001", "Rect000002"])
    const file = target.store.toDocument()
    const { room } = await owner.service.startSharing(target, { relayUrl: relay.url })
    const link = await owner.service.mintLink(room, { role: "edit", ttlSeconds: null })
    const watcher = await guest.service.join(link.link)
    await (await owner.service.connect(target, room)).leave()
    watcher.store.apply(
      { op: "update", id: "Rect000001", set: { name: "GuestEdit" } },
      { origin: "user" },
    )

    attempts = 0
    const next = reopened("/work/e.kimo")
    const session = await owner.service.reopenShared(next, file)
    expect(session?.provider.connected).toBe(false)
    await until(() => session?.provider.connected === true)
    await until(() => next.store.getNode("Rect000001")?.name === "GuestEdit")
    await new Promise((r) => setTimeout(r, 100))
    expect(watcher.store.getNode("Rect000001")?.name).toBe("GuestEdit")
    await session?.leave()
    await watcher.leave()
    await owner.service.stopSharing(room)
  })

  test("a file edited outside Kimo contributes its own change next to a guest's", async () => {
    const owner = makePeer({ replica: () => null })
    const guest = makePeer()
    const target = makeTarget("/work/f.kimo", ["Rect000001", "Rect000002"])
    const { room } = await owner.service.startSharing(target, { relayUrl: relay.url })
    const link = await owner.service.mintLink(room, { role: "edit", ttlSeconds: null })
    const watcher = await guest.service.join(link.link)
    // The owner saved once, then closed.
    const saved = target.store.toDocument()
    await owner.service.noteSaved(target, saved)
    await (await owner.service.connect(target, room)).leave()
    // A text editor changes the file; a guest changes another node meanwhile.
    const edited = structuredClone(saved) as KimoDocument & {
      nodes: Record<string, { name?: string }>
    }
    ;(edited.nodes.Rect000002 as { name?: string }).name = "FromDisk"
    watcher.store.apply(
      { op: "update", id: "Rect000001", set: { name: "FromGuest" } },
      { origin: "user" },
    )

    const next = reopened("/work/f.kimo")
    const session = await owner.service.reopenShared(next, edited)
    await until(() => next.store.getNode("Rect000002")?.name === "FromDisk")
    expect(next.store.getNode("Rect000001")?.name).toBe("FromGuest")
    await until(() => watcher.store.getNode("Rect000002")?.name === "FromDisk")
    expect(watcher.store.getNode("Rect000001")?.name).toBe("FromGuest")
    await session?.leave()
    await watcher.leave()
    await owner.service.stopSharing(room)
  })

  test("reopening a room that is still open with a fresh store loads that store", async () => {
    const owner = makePeer({ replica: () => null })
    const target = makeTarget("/work/g.kimo", ["Rect000001"])
    const file = target.store.toDocument()
    const { room } = await owner.service.startSharing(target, { relayUrl: relay.url })
    // The editor closed without leaving; the file reopens in a new store.
    const next = reopened("/work/g.kimo")
    const session = await owner.service.reopenShared(next, file)
    expect(session?.store).toBe(next.store)
    await until(() => next.store.hasNode("Rect000001"))
    await session?.leave()
    await owner.service.stopSharing(room)
  })
})

describe("sharing a file that was not saved since", () => {
  test("reopening does not revert the prepared shader path in the room", async () => {
    const owner = makePeer({ replica: () => null })
    const guest = makePeer()
    const target = makeTarget("/work/shader.kimo")
    target.store.apply(
      [
        { op: "setHeader", set: { features: ["fill/shader"] } },
        {
          op: "insert",
          id: "Shader00001",
          node: { type: "rect", w: 8, h: 8, fill: { kind: "shader", src: "./shaders/glow.glsl" } },
        },
      ] as never,
      { origin: "user" },
    )
    const file = target.store.toDocument()
    const bytes = new TextEncoder().encode("void main() {}")
    const sha = await contentDigest(bytes)
    const { room } = await owner.service.startSharing(
      { ...target, readRelative: async () => bytes },
      { relayUrl: relay.url },
    )
    const link = await owner.service.mintLink(room, { role: "edit", ttlSeconds: null })
    const watcher = await guest.service.join(link.link)
    const src = () =>
      (watcher.store.getNode("Shader00001")?.fill as { src: string } | undefined)?.src
    expect(src()).toBe(`./assets/${sha.slice(0, 16)}.glsl`)

    // The owner leaves without saving and reopens the file as it is on disk.
    await (await owner.service.connect(target, room)).leave()
    const session = await owner.service.reopenShared(reopened("/work/shader.kimo"), file)
    expect(session).not.toBeNull()
    await until(() => session?.provider.connected === true)
    await new Promise((r) => setTimeout(r, 100))
    expect(src()).toBe(`./assets/${sha.slice(0, 16)}.glsl`)
    await session?.leave()
    await watcher.leave()
    await owner.service.stopSharing(room)
  })

  test("reopening the same unsaved file twice never beats a later guest edit", async () => {
    for (let i = 0; i < 3; i++) {
      const owner = makePeer({ replica: () => null })
      const guest = makePeer()
      const key = `/work/twice-${i}.kimo`
      const target = makeTarget(key, ["Rect000001", "Rect000002"])
      const { room } = await owner.service.startSharing(target, { relayUrl: relay.url })
      const link = await owner.service.mintLink(room, { role: "edit", ttlSeconds: null })
      const watcher = await guest.service.join(link.link)
      await owner.service.noteSaved(target, target.store.toDocument())
      await (await owner.service.connect(target, room)).leave()

      const file = target.store.toDocument() as KimoDocument & {
        nodes: Record<string, { name?: string }>
      }
      ;(file.nodes.Rect000002 as { name?: string }).name = "FromDisk"
      const first = await owner.service.reopenShared(reopened(key), file)
      await until(() => watcher.store.getNode("Rect000002")?.name === "FromDisk")
      await first?.leave()
      watcher.store.apply(
        { op: "update", id: "Rect000002", set: { name: "GuestLater" } } as never,
        {
          origin: "user",
        },
      )
      await until(async () => {
        const saved = await owner.registry.saves.load(room)
        return saved !== null
      })
      const second = await owner.service.reopenShared(reopened(key), file)
      await until(() => second?.provider.connected === true)
      await new Promise((r) => setTimeout(r, 60))
      expect(watcher.store.getNode("Rect000002")?.name).toBe("GuestLater")
      await second?.leave()
      await watcher.leave()
      await owner.service.stopSharing(room)
    }
  })
})

const FILE = "/Users/me/loom/site.kimo"

const device = makeDevice

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
})
