/** Owner closes and reopens a shared document (spec §16.3). */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { KimoDocument } from "@kimo/core-schema"
import { YjsDocStore } from "@kimo/editor-state"
import { createMemoryAssetStore } from "../src/lib/assets"
import {
  MemoryReplica,
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

  test("without a replica only real file differences reach the room", async () => {
    const owner = makePeer({ replica: () => null })
    const guest = makePeer()
    const target = makeTarget("/work/b.kimo", ["Rect000001", "Rect000002"])
    const { room } = await owner.service.startSharing(target, { relayUrl: relay.url })
    const link = await owner.service.mintLink(room, { role: "edit", ttlSeconds: null })
    const watcher = await guest.service.join(link.link)
    await (await owner.service.connect(target, room)).leave()

    // The file on disk changed while closed: one rename.
    const file = target.store.toDocument() as KimoDocument & {
      nodes: Record<string, { name?: string }>
    }
    ;(file.nodes.Rect000002 as { name?: string }).name = "Renamed"
    const next = reopened("/work/b.kimo")
    const session = await owner.service.reopenShared(next, file)
    expect(session).not.toBeNull()
    await until(() => watcher.store.getNode("Rect000002")?.name === "Renamed")
    // Nothing was duplicated on either side.
    expect(next.store.nodeIds().sort()).toEqual(["Rect000001", "Rect000002"])
    expect(watcher.store.nodeIds().sort()).toEqual(["Rect000001", "Rect000002"])
    await session?.leave()
    await watcher.leave()
    await owner.service.stopSharing(room)
  })

  test("a file that is not shared is left to the caller", async () => {
    const owner = makePeer()
    const next = reopened("/work/none.kimo")
    expect(await owner.service.reopenShared(next, makeTarget().store.toDocument())).toBeNull()
    expect(next.store.size).toBe(0)
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
