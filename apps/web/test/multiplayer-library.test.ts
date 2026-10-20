/**
 * Browser library files share like files on disk (`kimo-lib:<fileId>`): the key is stable across
 * reloads, a shared library file reconnects when the editor opens it (room and library copy meet
 * as CRDT replicas, with no file delta), and deleting it for good stops sharing.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createEmptyDocument, YjsDocStore } from "@kimo/editor-state"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { MultiplayerError } from "@kimo/sync/mp"
import { createMemoryAssetStore } from "../src/lib/assets"
import { fileDeleted, onFileDeleted } from "../src/lib/file-events"
import { createMemoryRegistry, type Registry } from "../src/multiplayer"
import { createLocalShareBackend, roomKeyOf, roomOfKey } from "../src/multiplayer/backend"
import {
  createLibraryShare,
  type LibraryShare,
  libraryFileOfKey,
  libraryKeyOf,
} from "../src/multiplayer/library"
import { createPlatformShare } from "../src/platform/share"
import { MemoryReplica, type Relay, startRelay, until } from "./multiplayer-helpers"

let relay: Relay
beforeEach(() => {
  relay = startRelay()
})
afterEach(async () => {
  await relay.stop()
})

const FILE_ID = "f-7c2a"
const KEY = libraryKeyOf(FILE_ID)

/** One browser window of the owner's device; `registry` is its IndexedDB, kept across reloads. */
function ownerWindow(registry: Registry) {
  const platform = createMemoryPlatform()
  const share = createPlatformShare({
    platform,
    serviceDeps: {
      registry,
      webOrigin: "https://kimo.test",
      backoff: [5, 40],
      replica: () => null,
      openGuestDocument: async () => ({
        store: new YjsDocStore(),
        assets: createMemoryAssetStore(),
      }),
    },
  })
  const library = createLibraryShare(share)
  const backend = createLocalShareBackend({
    share,
    storeFor: (ref) => library.get(ref)?.store ?? null,
    sessionFor: (ref) => library.get(ref),
  })
  return { platform, share, library, backend }
}

/** A guest device. */
function guestDevice() {
  return createPlatformShare({
    platform: createMemoryPlatform(),
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
}

/** The library's `kimo-doc-<id>` database: a CRDT replica of the file, kept across reloads. */
async function openLibraryFile(disk: { state: Uint8Array | null }, seed = false) {
  const store = new YjsDocStore()
  const persistence = new MemoryReplica(disk)
  await persistence.attach(store)
  if (seed) {
    const doc = createEmptyDocument("Library file") as unknown as {
      nodes: Record<string, unknown>
    }
    doc.nodes.Rect000001 = { type: "rect", parent: null, order: "a0", name: "Card", w: 10, h: 10 }
    store.loadDocument(doc as never)
  }
  return { store, persistence }
}

/** Opens the file in `library` the way the editor does. */
function editorOpens(library: LibraryShare, store: YjsDocStore) {
  return library.open({ fileId: FILE_ID, store, assets: createMemoryAssetStore() })
}

async function shareFromLibrary(w: ReturnType<typeof ownerWindow>) {
  await w.backend.start(KEY, { relayUrl: relay.url })
  return w.backend.mintLink(KEY, { role: "edit", ttlSeconds: null })
}

describe("library share keys", () => {
  test("a library file's key is its id, apart from file paths and joined rooms", () => {
    expect(KEY).toBe("kimo-lib:f-7c2a")
    expect(libraryFileOfKey(KEY)).toBe(FILE_ID)
    expect(libraryFileOfKey("/Users/me/site.kimo")).toBeNull()
    expect(libraryFileOfKey(roomKeyOf("abc"))).toBeNull()
    expect(roomOfKey(KEY)).toBeNull()
  })

  test("Share starts from the open library file and the registry keeps the key across reloads", async () => {
    const registry = createMemoryRegistry()
    const disk = { state: null as Uint8Array | null }
    const w1 = ownerWindow(registry)
    const { store } = await openLibraryFile(disk, true)
    // Not open in an editor: Share has nothing to start from.
    await expect(w1.backend.start(KEY, { relayUrl: relay.url })).rejects.toBeInstanceOf(
      MultiplayerError,
    )
    const release = editorOpens(w1.library, store)
    expect(w1.backend.snapshot(KEY).room).toBeNull()
    await shareFromLibrary(w1)
    const snap = w1.backend.snapshot(KEY)
    expect(snap.room).not.toBeNull()
    expect(snap.owner).toBe(true)
    const owned = await registry.ownedForFile(KEY)
    expect(owned?.room).toBe(snap.room as string)
    expect(owned?.fileKey).toBe(KEY)
    release()
    expect(w1.share.roomOfFile(KEY)).toBeNull()

    // A reload: a new window over the same registry finds the room under the same key.
    const w2 = ownerWindow(registry)
    expect((await w2.share.service.roomForFile(KEY))?.room).toBe(snap.room as string)
    await w2.share.stopSharing(snap.room as string)
  })
})

describe("reopening a shared library file", () => {
  test("it reconnects as the editor opens it, with guests' edits, and no file delta", async () => {
    const registry = createMemoryRegistry()
    const disk = { state: null as Uint8Array | null }
    const w1 = ownerWindow(registry)
    const first = await openLibraryFile(disk, true)
    const release1 = editorOpens(w1.library, first.store)
    const link = await shareFromLibrary(w1)
    const guest = guestDevice()
    const visitor = await guest.joinLink(link.link)
    await until(() => visitor.store.getNode("Rect000001")?.name === "Card")

    // The guest's edit reaches the owner and the library's own copy.
    visitor.store.apply(
      { op: "update", id: "Rect000001", set: { name: "Guest 1" } },
      { origin: "user" },
    )
    await until(() => first.store.getNode("Rect000001")?.name === "Guest 1")
    // The editor closes: the room connection ends, the room lives on.
    release1()
    await until(() => w1.share.roomOfFile(KEY) === null)
    await first.persistence.detach()
    visitor.store.apply(
      { op: "update", id: "Rect000001", set: { name: "Guest 2" } },
      { origin: "user" },
    )

    // Reload: the library copy loads (it has Guest 1), then the room adds what happened since.
    const w2 = ownerWindow(registry)
    const second = await openLibraryFile(disk)
    expect(second.store.getNode("Rect000001")?.name).toBe("Guest 1")
    const release2 = editorOpens(w2.library, second.store)
    await until(() => w2.share.roomOfFile(KEY) !== null)
    await until(() => second.store.getNode("Rect000001")?.name === "Guest 2")
    // The owner's edit reaches the guest; nothing was duplicated by a reload.
    second.store.apply(
      { op: "update", id: "Rect000001", set: { name: "Owner" } },
      { origin: "user" },
    )
    await until(() => visitor.store.getNode("Rect000001")?.name === "Owner")
    expect(Object.keys(second.store.toDocument().nodes)).toEqual(["Rect000001"])
    expect(w2.backend.snapshot(KEY).owner).toBe(true)

    release2()
    await visitor.leave()
    await w2.share.stopSharing((await registry.ownedForFile(KEY))?.room as string)
  })

  test("closing before the reconnect finished leaves the room; opening again keeps it", async () => {
    const registry = createMemoryRegistry()
    const disk = { state: null as Uint8Array | null }
    const w1 = ownerWindow(registry)
    const first = await openLibraryFile(disk, true)
    const release1 = editorOpens(w1.library, first.store)
    await shareFromLibrary(w1)
    release1()
    await until(() => w1.share.roomOfFile(KEY) === null)

    const w2 = ownerWindow(registry)
    const second = await openLibraryFile(disk)
    // StrictMode: open, release at once, open again.
    editorOpens(w2.library, second.store)()
    const release = editorOpens(w2.library, second.store)
    await until(() => w2.share.roomOfFile(KEY) !== null)
    await new Promise((r) => setTimeout(r, 50))
    expect(w2.share.roomOfFile(KEY)).not.toBeNull()
    release()
    await until(() => w2.share.roomOfFile(KEY) === null)
    await w2.share.stopSharing((await registry.ownedForFile(KEY))?.room as string)
  })

  test("an unshared library file opens with no room", async () => {
    const w = ownerWindow(createMemoryRegistry())
    const { store } = await openLibraryFile({ state: null }, true)
    const release = editorOpens(w.library, store)
    await new Promise((r) => setTimeout(r, 30))
    expect(w.share.roomOfFile(KEY)).toBeNull()
    expect(w.backend.snapshot(KEY).room).toBeNull()
    release()
  })
})

describe("deleting a shared library file", () => {
  test("deleting it for good stops sharing: the relay closes the room and the keys go", async () => {
    const registry = createMemoryRegistry()
    const w = ownerWindow(registry)
    const { store } = await openLibraryFile({ state: null }, true)
    const release = editorOpens(w.library, store)
    const link = await shareFromLibrary(w)
    release()
    await w.library.deleted(FILE_ID)
    expect(await registry.ownedForFile(KEY)).toBeNull()
    expect(await w.share.service.roomForFile(KEY)).toBeNull()
    // The room is closed at the relay: the link no longer joins.
    await expect(guestDevice().joinLink(link.link)).rejects.toBeInstanceOf(MultiplayerError)
    // An unshared file is a no-op.
    await w.library.deleted("never-shared")
  })

  test("when the relay refuses the close for good, the room is still forgotten here", async () => {
    const registry = createMemoryRegistry()
    const w = ownerWindow(registry)
    const { store } = await openLibraryFile({ state: null }, true)
    const release = editorOpens(w.library, store)
    await shareFromLibrary(w)
    release()
    const errors: unknown[] = []
    const library = createLibraryShare(
      {
        ...w.share,
        stopSharing: async () => {
          throw new MultiplayerError("AUTH_INVALID", "refused")
        },
      },
      { onError: (_id, e) => errors.push(e) },
    )
    await library.deleted(FILE_ID)
    expect(errors).toHaveLength(1)
    expect(await registry.ownedForFile(KEY)).toBeNull()
  })

  test("the library reports deletions to its listeners, without waiting on them", () => {
    const seen: string[] = []
    const off = onFileDeleted((id) => {
      seen.push(id)
      return new Promise(() => {})
    })
    const offFailing = onFileDeleted(() => {
      throw new Error("listener failed")
    })
    fileDeleted("a")
    off()
    offFailing()
    fileDeleted("b")
    expect(seen).toEqual(["a"])
  })
})
