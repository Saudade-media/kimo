/**
 * Kimo Cloud workspaces in the app (ADR 0019): an open workspace file keeps its edit token fresh
 * on the live connection and reconnects when the plan changes the role (protocol); the 1.3.0
 * re-share of pre-workspace rooms is safe to interrupt and repeat (data integrity); the
 * workspace cache never drops what a local copy needs (data integrity); the plan's seats catch up
 * with a member who joined (a bug: Settings showed the seats from before the approval).
 */
import { afterEach, describe, expect, test } from "bun:test"
import { type DocStore, YjsDocStore } from "@kimo/editor-state"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { fromBase64Url } from "@kimo/sync/mp"
import { createMemoryAssetStore } from "../../src/lib/assets"
import { createMemoryRegistry, type Registry } from "../../src/multiplayer"
import { createCloudCache } from "../../src/multiplayer/cloud/cache"
import { createCloudClient } from "../../src/multiplayer/cloud/client"
import { createFakeCloud, relayRegistrar } from "../../src/multiplayer/cloud/fake"
import { MIGRATED_PREFIX, migrateLegacyRooms } from "../../src/multiplayer/cloud/migrate"
import { createCloudStore } from "../../src/multiplayer/cloud/store"
import {
  CLOUD_DELETED_REASON,
  createWorkspaceStore,
  TOKEN_CHECK_MS,
} from "../../src/multiplayer/cloud/workspaces"
import {
  createMemoryDeviceKeyStore,
  type DeviceKeyStore,
  devicePubOf,
} from "../../src/multiplayer/device-key"
import type { Clock } from "../../src/multiplayer/relay-setup/runner"
import { createPlatformShare } from "../../src/platform/share"
import { addAsset, insertRect, makeTarget, startRelay, until } from "./helpers"

const HOUR = 3_600_000
const EMAIL = "maya@studio.design"

/** A manual clock: timers fire only on `advance`. */
function fakeClock(start = Date.now()) {
  let now = start
  let seq = 0
  const timers = new Map<number, { at: number; fn: () => void }>()
  const clock: Clock & { advance(ms: number): void } = {
    now: () => now,
    setTimeout(fn, ms) {
      const id = ++seq
      timers.set(id, { at: now + ms, fn })
      return id
    },
    clearTimeout(h) {
      timers.delete(h as number)
    },
    advance(ms) {
      const until = now + ms
      for (let guard = 0; guard < 10_000; guard++) {
        const due = [...timers.entries()]
          .filter(([, t]) => t.at <= until)
          .sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        timers.delete(due[0])
        now = due[1].at
        due[1].fn()
      }
      now = until
    },
  }
  return clock
}

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c()
})

/** One person's app: the Cloud client and stores over `cloud`, sharing through `relayUrl`. */
async function makeApp(
  cloud: ReturnType<typeof createFakeCloud>,
  clock: ReturnType<typeof fakeClock>,
  options: { keys?: DeviceKeyStore; registry?: Registry; email?: string; signIn?: boolean } = {},
) {
  const keys = options.keys ?? createMemoryDeviceKeyStore()
  const registry = options.registry ?? createMemoryRegistry()
  if (options.signIn !== false)
    cloud.signIn(await devicePubOf(await keys.get()), options.email ?? EMAIL)
  const client = createCloudClient({
    apiUrl: cloud.apiUrl,
    deviceKeys: keys,
    fetch: cloud.fetch,
    now: clock.now,
  })
  const cloudStore = createCloudStore({
    client,
    deviceName: () => "Mac",
    clientKind: "web",
    openUrl: async () => {},
    clock,
    onFocus: () => () => {},
  })
  const share = createPlatformShare({
    platform: createMemoryPlatform(),
    assetsFor: () => createMemoryAssetStore(),
    serviceDeps: {
      registry,
      deviceKeys: keys,
      webOrigin: "https://kimo.test",
      backoff: [5, 40],
      replica: () => null,
      openGuestDocument: async () => ({
        store: new YjsDocStore(),
        assets: createMemoryAssetStore(),
      }),
    },
  })
  const created: string[] = []
  const workspaces = createWorkspaceStore({
    client,
    cloud: cloudStore,
    registry,
    share,
    deviceName: () => "Mac",
    clientKind: "web",
    openUrl: async () => {},
    clock,
    migrate: false,
    managedCopies: {
      async create(input) {
        const path = `/managed/${input.workspaceId}/${input.room}.kimo`
        created.push(path)
        return path
      },
    },
  })
  cleanups.push(async () => {
    workspaces.dispose()
    cloudStore.dispose()
    for (const room of [share.activeRoom()].filter(Boolean))
      await share.leave(room as string).catch(() => undefined)
  })
  await workspaces.ready()
  return { keys, registry, client, cloudStore, share, workspaces, created }
}

const hasNode = (store: DocStore, id: string) =>
  Object.hasOwn((store.toDocument() as { nodes: Record<string, unknown> }).nodes, id)

describe("an open workspace file and its token", () => {
  test("refreshes on the live connection at half life, and reconnects when the role changes", async () => {
    const clock = fakeClock()
    const relay = startRelay({}, { now: clock.now })
    cleanups.push(() => relay.stop())
    const cloud = createFakeCloud({
      now: clock.now,
      relayUrl: relay.url,
      relay: relayRegistrar({ deviceKeys: createMemoryDeviceKeyStore(), now: clock.now }),
    })
    const ws = cloud.addWorkspace(EMAIL, "Studio", "active")
    const app = await makeApp(cloud, clock)
    await app.cloudStore.refresh()

    const target = makeTarget("/work/landing.kimo", ["Rect000001"])
    const shared = await app.workspaces.shareFile({ ref: target.fileKey, store: target.store })
    if (shared.status !== "shared" || !shared.session) throw new Error("expected one workspace")
    const session = shared.session
    const welcomes: string[] = []
    const closes: string[] = []
    session.onEvent((e) => {
      if (e.type === "welcome") welcomes.push(e.role)
      if (e.type === "closed" && e.error) closes.push(e.error.code)
    })
    await until(() => session.provider.connected)
    // Only what happens from here on counts.
    welcomes.length = 0
    const firstExp = session.provider.exp ?? 0
    const tokenCalls = () =>
      cloud.log.filter((l) => l.path === `/v1/rooms/${shared.file.room}/token`).length

    // Half its life gone: a new token on the same connection (no new welcome).
    clock.advance(12 * HOUR + 1000)
    await until(() => (session.provider.exp ?? 0) > firstExp)
    expect(tokenCalls()).toBe(1)
    expect(welcomes).toEqual([])
    // The first token's expiry passes: the relay keeps the connection, which holds the new one.
    clock.advance(12 * HOUR)
    relay.tick()
    await until(() => tokenCalls() === 2)
    await new Promise((r) => setTimeout(r, 50))
    expect(closes).not.toContain("TOKEN_EXPIRED")
    expect(session.provider.connected).toBe(true)

    // The plan goes read-only: a view token, which needs a new connection.
    cloud.setWorkspacePlan(ws, "read_only")
    await app.cloudStore.refresh()
    await until(() => welcomes.includes("view"))
    expect(session.store.readOnly).not.toBeNull()
    expect(app.workspaces.getState().open[shared.file.room]?.role).toBe("view")

    // Renewed: back to an edit token, again by reconnecting.
    cloud.setWorkspacePlan(ws, "active")
    await app.cloudStore.refresh()
    await until(() => welcomes.at(-1) === "edit" && session.store.readOnly === null)
    insertRect(session.store, "Rect000002")
    await until(() => session.status === "synced")
    expect(welcomes).toEqual(["view", "edit"])
    // The hourly check keeps running without asking Kimo Cloud while the token is young.
    const calls = tokenCalls()
    clock.advance(TOKEN_CHECK_MS)
    await new Promise((r) => setTimeout(r, 20))
    expect(tokenCalls()).toBe(calls)
  }, 20_000)
})

describe("re-sharing pre-workspace rooms (1.3.0 migration)", () => {
  test("an interrupted run resumes; repeats create no second room and lose no edits", async () => {
    const clock = fakeClock()
    const relay = startRelay()
    cleanups.push(() => relay.stop())
    const keys = createMemoryDeviceKeyStore()
    const cloud = createFakeCloud({
      now: clock.now,
      relayUrl: relay.url,
      // Kimo Cloud's service key is an owner device of the relay (the hosted relay's policy).
      relay: relayRegistrar({ deviceKeys: keys }),
    })
    const ws = cloud.addWorkspace(EMAIL, "Workspace", "active")
    const app = await makeApp(cloud, clock, { keys })
    await app.cloudStore.refresh()

    // The owner shared a file on Kimo Cloud's relay before workspaces; a guest added to it.
    const target = makeTarget("/work/landing.kimo", ["Rect000001"])
    const old = await app.share.service.startSharing(target, { relayUrl: relay.url })
    const editLink = await app.share.service.mintLink(old.room, { role: "edit", ttlSeconds: null })
    const guest = await makeApp(cloud, clock, { email: "leo@studio.design" })
    const guestSession = await guest.share.joinLink(editLink.link)
    await until(() => guestSession.provider.connected)
    insertRect(guestSession.store, "Rect000002")
    await until(() => guestSession.status === "synced")
    await guestSession.leave()
    // The owner's editor is closed: the migration reads the room itself.
    await app.share.leave(old.room)
    await app.share.service.noteSaved(target, target.store.toDocument())

    const cache = createCloudCache(app.registry.cloud)
    const run = (step?: (room: string, s: string) => void) =>
      migrateLegacyRooms({
        client: app.client,
        share: app.share,
        registry: app.registry,
        cache,
        relayUrl: relay.url,
        workspaceId: ws,
        now: clock.now,
        bind: async (binding) => cache.saveBinding(binding),
        ...(step ? { step } : {}),
      })
    const filePosts = () =>
      cloud.log.filter((l) => l.method === "POST" && l.path === `/v1/workspaces/${ws}/files`)

    // Interrupted after the upload, before the file is bound and the old room closed.
    const first = await run((_room, s) => {
      if (s === "uploaded") throw new Error("the app quit")
    })
    expect(first).toMatchObject({ moved: 0, left: 1 })
    expect((await app.registry.listOwned()).map((o) => o.fileKey)).toEqual([target.fileKey])

    const second = await run()
    expect(second).toMatchObject({ moved: 1, left: 0 })
    expect(filePosts().map((l) => l.status)).toEqual([201, 200])
    const files = cloud.files()
    expect(files).toHaveLength(1)
    const moved = files[0] as NonNullable<(typeof files)[0]>
    expect(moved.replaces).toBe(old.room)
    // The old room is closed at the relay and forgotten here; the file follows the new room.
    expect(await app.registry.listOwned()).toEqual([])
    const kept = await cache.load()
    expect(kept.bindings[moved.room]?.fileKey).toBe(target.fileKey)
    expect(kept.migrations[old.room]?.step).toBe("closed")
    const reopened = await makeApp(cloud, clock, { email: "leo@studio.design", signIn: false })
    await expect(reopened.share.joinLink(editLink.link)).rejects.toMatchObject({
      code: "ROOM_CLOSED",
    })
    // Both the owner's content and the guest's edit are in the new room.
    const token = await app.client.roomToken(moved.room)
    const reader = await makeApp(cloud, clock, { email: "kai@studio.design", signIn: false })
    const check = await reader.share.service.openWithToken({
      room: moved.room,
      relayUrl: moved.relayUrl,
      roomKey: moved.roomKey,
      token: token.token,
    })
    await until(() => hasNode(check.store, "Rect000001") && hasNode(check.store, "Rect000002"))
    await check.leave()

    // A third run finds nothing left to move and asks Kimo Cloud for nothing.
    const third = await run()
    expect(third).toEqual({ moved: 0, left: 0, error: null })
    expect(filePosts()).toHaveLength(2)
    expect(MIGRATED_PREFIX.length).toBeGreaterThan(0)
  }, 30_000)

  test("a room closed before any upload is never bound to an empty new room", async () => {
    const clock = fakeClock()
    const relay = startRelay()
    cleanups.push(() => relay.stop())
    const keys = createMemoryDeviceKeyStore()
    const cloud = createFakeCloud({
      now: clock.now,
      relayUrl: relay.url,
      relay: relayRegistrar({ deviceKeys: keys }),
    })
    const ws = cloud.addWorkspace(EMAIL, "Workspace", "active")
    const app = await makeApp(cloud, clock, { keys })
    await app.cloudStore.refresh()
    const target = makeTarget("/work/closed.kimo", ["Rect000001"])
    const old = await app.share.service.startSharing(target, { relayUrl: relay.url })
    expect(await app.share.service.closeOwnedRoom(old.room)).toBe("closed")

    const cache = createCloudCache(app.registry.cloud)
    const outcome = await migrateLegacyRooms({
      client: app.client,
      share: app.share,
      registry: app.registry,
      cache,
      relayUrl: relay.url,
      workspaceId: ws,
      now: clock.now,
      bind: async (binding) => cache.saveBinding(binding),
    })
    expect(outcome).toEqual({ moved: 0, left: 1, error: "ROOM_CLOSED" })
    expect(cloud.files()).toHaveLength(0)
    expect((await cache.load()).bindings).toEqual({})
    // The file stays this device's, as it was.
    expect((await app.registry.listOwned()).map((o) => o.fileKey)).toEqual([target.fileKey])
  }, 20_000)

  test("an image only a guest's device held reaches the new room before the old one closes", async () => {
    const clock = fakeClock()
    const relay = startRelay()
    cleanups.push(() => relay.stop())
    const keys = createMemoryDeviceKeyStore()
    const cloud = createFakeCloud({
      now: clock.now,
      relayUrl: relay.url,
      relay: relayRegistrar({ deviceKeys: keys }),
    })
    const ws = cloud.addWorkspace(EMAIL, "Workspace", "active")
    const app = await makeApp(cloud, clock, { keys })
    await app.cloudStore.refresh()

    // A browser library file: its key is an id, and its document has no name.
    const target = makeTarget("kimo-lib:QIs0n69gZ2.kimo", ["Rect000001"])
    const { meta: _meta, ...unnamed } = target.store.toDocument()
    target.store.loadDocument(unnamed)
    const old = await app.share.service.startSharing(target, { relayUrl: relay.url })
    const editLink = await app.share.service.mintLink(old.room, { role: "edit", ttlSeconds: null })
    const guest = await makeApp(cloud, clock, { email: "leo@studio.design" })
    const guestSession = await guest.share.joinLink(editLink.link)
    await until(() => guestSession.provider.connected)
    // The guest pastes an image: its bytes reach the relay, never this device's asset store.
    const image = await addAsset(guestSession.assets, new TextEncoder().encode("guest image"))
    let uploaded = false
    guestSession.assetSync.onProgress((e) => {
      if (e.kind === "upload" && e.key === image.key && e.status === "done") uploaded = true
    })
    const manifest = (guestSession.store.toHeader() as { assets?: Record<string, unknown> }).assets
    const pasted = guestSession.store.apply(
      [
        {
          op: "insert",
          id: "Img0000001",
          node: { type: "rect", w: 4, h: 4, fill: { kind: "image", src: image.src } },
        },
        {
          op: "setHeader",
          set: {
            assets: { ...manifest, [image.key]: { mime: "image/png", sha256: image.sha256 } },
          },
        },
      ] as never,
      { origin: "user" },
    )
    expect(pasted.ok).toBe(true)
    await until(() => guestSession.status === "synced")
    void guestSession.assetSync.uploadMissing()
    await until(() => uploaded)
    await guestSession.leave()
    await app.share.leave(old.room)

    const cache = createCloudCache(app.registry.cloud)
    const outcome = await migrateLegacyRooms({
      client: app.client,
      share: app.share,
      registry: app.registry,
      cache,
      relayUrl: relay.url,
      workspaceId: ws,
      now: clock.now,
      bind: async (binding) => cache.saveBinding(binding),
    })
    expect(outcome).toEqual({ moved: 1, left: 0, error: null })
    const moved = cloud.files()[0] as NonNullable<ReturnType<typeof cloud.files>[0]>
    // Named like any other library file shared to a workspace, never by its key.
    expect(moved.name).toBe("Untitled")

    // The old room is closed (its blobs are gone); the new room serves the image.
    const token = await app.client.roomToken(moved.room)
    const reader = await makeApp(cloud, clock, { email: "kai@studio.design", signIn: false })
    const check = await reader.share.service.openWithToken({
      room: moved.room,
      relayUrl: moved.relayUrl,
      roomKey: moved.roomKey,
      token: token.token,
    })
    await until(() => hasNode(check.store, "Img0000001"))
    expect(await check.assetSync.ensure(image.key)).toBe(true)
    const bytes = (await check.assets.bytes(image.key)) as Uint8Array
    expect(new TextDecoder().decode(bytes)).toBe("guest image")
    await check.leave()
  }, 30_000)
})

describe("the workspace cache", () => {
  test("a failed refresh keeps the cached lists, and a new window opens from them", async () => {
    const clock = fakeClock()
    const cloud = createFakeCloud({ now: clock.now })
    const ws = cloud.addWorkspace(EMAIL, "Studio", "active")
    const registry = createMemoryRegistry()
    const keys = createMemoryDeviceKeyStore()
    const app = await makeApp(cloud, clock, { keys, registry })
    await app.cloudStore.refresh()
    await app.client.addFile(ws, { name: "Landing page" })
    await app.workspaces.refreshWorkspace(ws)
    const listed = app.workspaces.getState().files[ws]
    expect(listed).toBeDefined()

    cloud.state.offline = true
    await app.workspaces.refresh()
    expect(app.workspaces.getState().offline).toBe(true)
    expect(app.workspaces.getState().workspaces.map((w) => w.id)).toEqual([ws])
    expect(app.workspaces.getState().files[ws]).toEqual(listed as NonNullable<typeof listed>)

    // Another window on this device, still offline: everything renders from the cache.
    const window2 = await makeApp(cloud, clock, { keys, registry, signIn: false })
    expect(window2.workspaces.getState().workspaces.map((w) => w.name)).toEqual(["Studio"])
    expect(window2.workspaces.getState().files[ws]).toEqual(listed as NonNullable<typeof listed>)
  })

  test("a closed file, a deleted workspace or a plan without files never drops a local copy", async () => {
    const clock = fakeClock()
    const cloud = createFakeCloud({ now: clock.now })
    const ws = cloud.addWorkspace(EMAIL, "Studio", "active")
    const app = await makeApp(cloud, clock)
    await app.cloudStore.refresh()
    const add = (name: string) => app.client.addFile(ws, { name }).then((a) => a.file.room)
    const kept = await add("Landing page")
    const closing = await add("Old draft")
    await app.workspaces.refreshWorkspace(ws)
    const keptPath = (await app.workspaces.localCopy(kept)) as string
    const closingPath = (await app.workspaces.localCopy(closing)) as string
    expect(app.created).toEqual([keptPath, closingPath])

    // A plan without files lists nothing: the cached list stays.
    cloud.setWorkspacePlan(ws, "none")
    await app.workspaces.refreshWorkspace(ws)
    expect(
      app.workspaces
        .getState()
        .files[ws]?.files.map((f) => f.room)
        .sort(),
    ).toEqual([kept, closing].sort())
    cloud.setWorkspacePlan(ws, "active")

    // An Admin closes one file: its copy stays bound, ended, and reopens as a plain local file.
    await cloud.closeFile(closing)
    await app.workspaces.refreshWorkspace(ws)
    await until(() => app.workspaces.getState().bindings[closing]?.ended === "closed")
    const closedCopy = { ref: closingPath, store: new YjsDocStore() }
    expect(await app.share.reopenShared(closedCopy, closedCopy.store.toDocument())).toBeNull()
    expect(closedCopy.store.readOnly).toBeNull()

    // The workspace is deleted: the other copy stays, and opens read-only (board 46 6E).
    await cloud.deleteWorkspace(ws)
    await app.cloudStore.refresh()
    await until(() => app.workspaces.getState().bindings[kept]?.ended === "deleted")
    const deletedCopy = { ref: keptPath, store: new YjsDocStore() }
    expect(await app.share.reopenShared(deletedCopy, deletedCopy.store.toDocument())).toBeNull()
    expect(deletedCopy.store.readOnly?.reason).toBe(CLOUD_DELETED_REASON)

    // Signing out drops the account's lists and tokens, never the bindings of local copies.
    await app.cloudStore.signOut()
    await until(() => app.workspaces.getState().workspaces.length === 0)
    const reader = createCloudCache(app.registry.cloud)
    await until(async () => (await reader.load()).account === null)
    const cache = await reader.load()
    expect(cache.account).toBeNull()
    expect(cache.files).toEqual({})
    expect(Object.keys(cache.bindings).sort()).toEqual([kept, closing].sort())
    expect(fromBase64Url(cache.bindings[kept]?.roomKey ?? "")).toHaveLength(32)
  })

  test("a slow token answer never replaces a newer token", async () => {
    const registry = createMemoryRegistry()
    const cache = createCloudCache(registry.cloud)
    const older = { token: "older", role: "edit" as const, expiresAt: 1_000 }
    const newer = { token: "newer", role: "edit" as const, expiresAt: 2_000 }
    await Promise.all([
      cache.saveToken("acc_1", "room", newer),
      cache.saveToken("acc_1", "room", older),
    ])
    await cache.saveAccount({
      account: { id: "acc_1", email: EMAIL, createdAt: 0 },
      plan: (await import("../../src/multiplayer/cloud/fake")).emptyPlan(),
      usage: { bytes: 0, rooms: 0, limitBytes: 1, reportedAt: null },
      devices: [],
      workspaces: [],
      accessRequests: [],
    })
    expect((await cache.load()).tokens.room?.token).toBe("newer")
  })
})

describe("plan seats", () => {
  test("catch up with an approved member though Kimo Cloud bills the seat after its answer", async () => {
    const clock = fakeClock()
    const cloud = createFakeCloud({ now: clock.now })
    const ws = cloud.addWorkspace(EMAIL, "Studio", "active")
    cloud.addMember(ws, "sam@studio.design")
    const owner = await makeApp(cloud, clock)
    const { file } = await owner.client.addFile(ws, { name: "Landing" })
    const guest = await makeApp(cloud, clock, { email: "jo@acme.co" })
    await guest.client.requestAccess(file.room)
    await owner.workspaces.refresh()
    const plan = () => owner.workspaces.getState().workspaces.find((w) => w.id === ws)?.plan
    expect(plan()?.seats).toBe(2)
    const request = owner.workspaces.getState().details[ws]?.requests[0]
    if (!request) throw new Error("expected the edit request")

    cloud.state.seatSyncMs = 3000
    await owner.workspaces.approveRequest(ws, request.id)
    // The answer came before the seat sync: the account still bills 2 seats.
    expect(plan()?.seats).toBe(2)
    clock.advance(30_000)
    await until(() => plan()?.seats === 3)
    expect(plan()?.amountCents).toBe(1600)
  })
})
