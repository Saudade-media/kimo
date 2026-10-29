/**
 * Multiplayer in the desktop document host (spec §16.8): an editor window shares a file through
 * the host's `mp.*` RPC, reads pushed snapshots through its share backend and the view model,
 * and a paused agent's calls wait in the host until it resumes. Kimo Cloud workspace files live
 * in the host too (a bug: they reopened in their rooms, and pre-workspace rooms re-shared, only
 * in windows that held their own sessions). Rooms a window joined from a share link are MCP
 * documents (#79: MCP could not see them and read a stale local copy instead).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { claimsFor, createEmptyDocument, serialize, YjsDocStore } from "@kimo/editor-state"
import type { ToolResult } from "@kimo/mcp-server"
import { validateInput } from "@kimo/mcp-server/server"
import { createMemoryPlatform } from "@kimo/platform/memory"
import {
  createHostedWorkspaceFiles,
  createHostShareBackend,
  createMemoryBridgeNetwork,
  HOST_LABEL,
  HostClient,
  type HostedDocumentSession,
  hostedSessionFactory,
  serveRoomsToHost,
  startDocumentHostService,
} from "../../src/host"
import { createMemoryAssetStore } from "../../src/lib/assets"
import { roomKeyOf } from "../../src/multiplayer/backend"
import { createCloudClient } from "../../src/multiplayer/cloud/client"
import { createFakeCloud, relayRegistrar } from "../../src/multiplayer/cloud/fake"
import { createCloudStore } from "../../src/multiplayer/cloud/store"
import { CLOUD_DELETED_REASON } from "../../src/multiplayer/cloud/workspaces"
import { deviceKeysFor } from "../../src/multiplayer/device"
import { devicePubOf } from "../../src/multiplayer/device-key"
import { createMultiplayerModel } from "../../src/multiplayer/model"
import { createSessionManager } from "../../src/platform/session"
import { createPlatformShare } from "../../src/platform/share"
import { makePeer, makeTarget, type Relay, startRelay, until } from "./helpers"

let relay: Relay
beforeEach(() => {
  relay = startRelay()
})
afterEach(async () => {
  await relay.stop()
})

const REF = "/Users/me/site/home.kimo"

function fileText() {
  const d = createEmptyDocument("Home") as ReturnType<typeof createEmptyDocument> & {
    nodes: Record<string, unknown>
  }
  d.nodes.Frame00001 = { type: "frame", parent: null, order: "a0", name: "Home", w: 400, h: 300 }
  return serialize(d)
}

describe("document host mp.* RPC", () => {
  test("a window shares a hosted file, sees it live, and the host reconnects it on reopen", async () => {
    const platform = createMemoryPlatform({
      pid: 7100,
      files: { [REF]: fileText() },
      settings: { "files.autosave": false, "multiplayer.relayUrl": relay.url },
    })
    const net = createMemoryBridgeNetwork()
    net.commands.set("kimo_mcp_policies_get", () => ({}))
    const service = await startDocumentHostService({
      platform,
      bridge: net.bridge(HOST_LABEL),
      version: "0.0.0-test",
      relay: false,
      validate: validateInput as never,
    })
    const client = await HostClient.connect(net.bridge("editor-1"), 1000)
    if (!client) throw new Error("no host")
    const windowManager = createSessionManager({
      platform,
      createSession: hostedSessionFactory(client),
    })
    const session = (await windowManager.open(REF)) as HostedDocumentSession
    expect(session.state().phase).toBe("ready")

    const backend = createHostShareBackend(client)
    const model = createMultiplayerModel({ backend, settings: platform.settings })
    const doc = model.document(REF)
    doc.subscribe(() => {})
    await until(() => doc.getState().share.status === "not-shared")
    expect(await client.call("mp.status", { ref: REF })).toMatchObject({ room: null })

    await doc.startSharing()
    await until(() => doc.getState().share.status === "live")
    expect(doc.getState().share.owner).toBe(true)
    expect(doc.getState().capabilities.canShare).toBe(true)
    const links = doc.getState().links.items
    expect(links.map((l) => l.role).sort()).toEqual(["edit", "view"])
    const room = doc.getState().share.room as string
    expect(service.multiplayer?.share.roomOfFile(REF)).toBe(room)

    // A guest joins; the window's people list shows them, pushed from the host.
    const guest = createPlatformShare({
      platform: createMemoryPlatform(),
      serviceDeps: {
        webOrigin: "https://kimo.test",
        backoff: [5, 40],
        replica: () => null,
        openGuestDocument: async () => ({
          store: new YjsDocStore(),
          assets: createMemoryAssetStore(),
        }),
      },
    })
    const edit = links.find((l) => l.role === "edit")?.link as string
    const visitor = await guest.joinLink(edit)
    await until(() => doc.getState().people.some((p) => !p.isYou))
    expect(doc.getState().people[0]).toMatchObject({ isYou: true, owner: true })

    // Edits flow guest → host → window replica.
    visitor.store.apply(
      { op: "update", id: "Frame00001", set: { name: "From guest" } },
      { origin: "user" },
    )
    await until(() => session.store.getNode("Frame00001")?.name === "From guest")

    // Closing the window's last view closes the host session and its room connection.
    await session.close()
    await until(() => service.multiplayer?.share.roomOfFile(REF) === null)

    // Reopening goes through the host's session manager: it reconnects to the room.
    const again = (await windowManager.open(REF)) as HostedDocumentSession
    await until(() => service.multiplayer?.share.roomOfFile(REF) === room)
    expect(again.store.getNode("Frame00001")?.name).toBe("From guest")

    await guest.leave()
    await doc.stopSharing()
    await until(() => doc.getState().share.status === "not-shared")
    await again.close()
    await service.dispose()
    client.dispose()
  })

  test("a paused agent's calls wait in the host until it resumes", async () => {
    const platform = createMemoryPlatform({
      pid: 7101,
      files: { [REF]: fileText() },
      settings: { "files.autosave": false },
    })
    const net = createMemoryBridgeNetwork()
    net.commands.set("kimo_mcp_policies_get", () => ({}))
    const service = await startDocumentHostService({
      platform,
      bridge: net.bridge(HOST_LABEL),
      version: "0.0.0-test",
      relay: false,
      validate: validateInput as never,
    })
    const mp = service.multiplayer
    if (!mp) throw new Error("no multiplayer")
    const s = await service.manager.open(REF)
    const holder = "agent:kimo.ab.1"
    claimsFor(s.store).claim(holder, ["Frame00001"], { label: "Kimo" })
    s.store.apply({ op: "update", id: "Frame00001", set: { name: "Mine" } }, { origin: "user" })
    let passed = false
    const waiting = mp.waitForAgent(holder).then(() => {
      passed = true
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(passed).toBe(false)
    const status = (await mp.rpc["mp.status"]?.({ ref: REF }, "editor-1")) as {
      paused: { holder: string }[]
    }
    expect(status.paused.map((p) => p.holder)).toEqual([holder])
    await mp.rpc["mp.resumeAgent"]?.({ ref: REF, holder }, "editor-1")
    await waiting
    expect(passed).toBe(true)
    await service.dispose()
  })
})

describe("Kimo Cloud workspace files in the document host", () => {
  test("a bound file reopens in its room in any window, old rooms re-share, and a deleted workspace's copy is read-only until Save a copy", async () => {
    const OLD = "/Users/me/site/old.kimo"
    const COPY = "/Users/me/site/copy.kimo"
    const EMAIL = "maya@studio.design"
    const platform = createMemoryPlatform({
      pid: 7102,
      files: { [REF]: fileText(), [OLD]: fileText() },
      settings: { "files.autosave": false, "multiplayer.relayUrl": relay.url },
    })
    // The host's share layer and Kimo Cloud's relay registrar sign with this install's key.
    const keys = deviceKeysFor(platform)
    const cloud = createFakeCloud({
      relayUrl: relay.url,
      relay: relayRegistrar({ deviceKeys: keys }),
    })
    const ws = cloud.addWorkspace(EMAIL, "Studio", "active")
    const cloudStore = createCloudStore({
      client: createCloudClient({ apiUrl: cloud.apiUrl, deviceKeys: keys, fetch: cloud.fetch }),
      deviceName: () => "Mac",
      clientKind: "desktop",
      openUrl: async () => {},
      onFocus: () => () => {},
    })
    const net = createMemoryBridgeNetwork()
    net.commands.set("kimo_mcp_policies_get", () => ({}))
    const service = await startDocumentHostService({
      platform,
      bridge: net.bridge(HOST_LABEL),
      version: "0.0.0-test",
      relay: false,
      validate: validateInput as never,
      cloud: cloudStore,
    })
    const share = service.multiplayer?.share
    if (!share) throw new Error("no multiplayer")
    const client = await HostClient.connect(net.bridge("editor-1"), 1000)
    if (!client) throw new Error("no host")
    const windowManager = createSessionManager({
      platform,
      createSession: hostedSessionFactory(client),
    })
    const hosted = createHostedWorkspaceFiles(client, windowManager)

    // Before workspaces, this device shared a file on Kimo Cloud's relay (the host's registry).
    const old = await windowManager.open(OLD)
    await client.call("mp.startSharing", { ref: OLD, relayUrl: relay.url })
    await old.close()
    expect(await share.service.registry.listOwned()).toHaveLength(1)

    // Signing in (in a window) reaches the host, which re-shares the old room into the workspace.
    cloud.signIn(await devicePubOf(await keys.get()), EMAIL)
    await hosted.refresh()
    await until(() => hosted.view()?.migration.phase === "done", 15_000)
    expect(hosted.view()?.migration).toMatchObject({ moved: 1, left: 0 })
    expect(await share.service.registry.listOwned()).toEqual([])
    expect(Object.values(hosted.view()?.bindings ?? {}).map((b) => b.fileKey)).toEqual([OLD])

    // A window shares its file to the workspace: the room connects in the host.
    const session = (await windowManager.open(REF)) as HostedDocumentSession
    expect(hosted.holds(REF)).toBe(true)
    const shared = await hosted.shareFile(REF, {})
    if (shared.status !== "shared") throw new Error("expected one workspace")
    const room = shared.file.room
    await until(() => share.roomOfFile(REF) === room)
    await session.close()
    await until(() => share.roomOfFile(REF) === null)

    // Reopened from any window, the host reconnects it to its room.
    const again = (await windowManager.open(REF)) as HostedDocumentSession
    await until(() => share.roomOfFile(REF) === room)
    expect(again.store.readOnly).toBeNull()

    // The workspace is deleted: the window's replica of the copy is read-only too (board 46 6E).
    await cloud.deleteWorkspace(ws)
    await hosted.refresh()
    await until(() => again.store.readOnly?.reason === CLOUD_DELETED_REASON)
    expect(hosted.view()?.bindings[room]).toMatchObject({ fileKey: REF, ended: "deleted" })

    // Save a copy: the copy is a plain file, editable; the binding stays with the read-only one.
    platform.dialogs.saveFile = async () => COPY
    expect(await again.saveAs()).toBe(COPY)
    expect(again.store.readOnly).toBeNull()
    expect(hosted.view()?.bindings[room]?.fileKey).toBe(REF)

    await again.close()
    hosted.dispose()
    await service.dispose()
    client.dispose()
  }, 30_000)
})

describe("rooms joined from a share link (#79)", () => {
  test("MCP lists a window's rooms with their role, edits one through the window, a view link refuses edits, and no link secret reaches a result", async () => {
    // The owner shares two files from another device: one edit link, one view link.
    const owner = makePeer()
    const shared = makeTarget("/Users/owner/site.kimo", ["Frame00001"])
    const viewed = makeTarget("/Users/owner/brand.kimo", ["Logo000001"])
    const { room } = await owner.service.startSharing(shared, { relayUrl: relay.url })
    const { room: viewRoom } = await owner.service.startSharing(viewed, { relayUrl: relay.url })
    const edit = (await owner.service.mintLink(room, { role: "edit", ttlSeconds: null })).link
    const view = (await owner.service.mintLink(viewRoom, { role: "view", ttlSeconds: null })).link
    await owner.service.connect(shared, room)

    // A desktop window joins both links; its document host serves MCP.
    const platform = createMemoryPlatform({ pid: 7103, settings: { "files.autosave": false } })
    const net = createMemoryBridgeNetwork()
    net.commands.set("kimo_mcp_policies_get", () => ({}))
    const service = await startDocumentHostService({
      platform,
      bridge: net.bridge(HOST_LABEL),
      version: "0.0.0-test",
      relay: false,
      validate: validateInput as never,
    })
    const client = await HostClient.connect(net.bridge("editor-1"), 1000)
    if (!client) throw new Error("no host")
    const guest = createPlatformShare({
      platform: createMemoryPlatform(),
      serviceDeps: {
        webOrigin: "https://kimo.test",
        backoff: [5, 40],
        replica: () => null,
        openGuestDocument: async () => ({
          store: new YjsDocStore(),
          assets: createMemoryAssetStore(),
        }),
      },
    })
    const model = createMultiplayerModel({
      backend: createHostShareBackend(client),
      settings: platform.settings,
      join: (link) => guest.joinLink(link),
    })
    const served = serveRoomsToHost(client, model.join)
    expect((await model.join.join(edit)).phase).toBe("joined")
    expect((await model.join.join(view)).phase).toBe("joined")
    // Joining the second room kept the first one joined (a room tab in the back).
    expect(model.join.rooms()).toHaveLength(2)

    const conn = service.runtime.connect({
      client: "claude-code",
      label: "Claude Code",
      transport: "socket",
    })
    type Doc = {
      doc: { id: string; path: string; readOnly: boolean }
      shared?: { relay?: string; role: string }
      selection: string[]
    }
    const state = async () => {
      const r = (await conn.call("kimo_get_state", {})).result as ToolResult<{ documents: Doc[] }>
      if (!r.ok) throw new Error(r.summary)
      return r
    }
    const docOf = async (key: string) =>
      (await state()).data.documents.find((d) => d.doc.path === key)
    await until(async () => (await state()).data.documents.length === 2)
    const listed = await state()
    const relayHost = new URL(relay.url).host
    expect(await docOf(roomKeyOf(room))).toMatchObject({
      doc: { readOnly: false },
      shared: { relay: relayHost, role: "edit" },
    })
    expect(await docOf(roomKeyOf(viewRoom))).toMatchObject({
      doc: { readOnly: true },
      shared: { relay: relayHost, role: "view" },
    })
    // Neither link, its capability token nor its room key reaches an agent.
    const text = JSON.stringify(listed)
    for (const link of [edit, view]) {
      const parts = link.slice(link.indexOf("#") + 1).split("/")
      const [token, key] = parts.slice(-2)
      for (const secret of [link, token, key]) expect(text).not.toContain(secret as string)
    }

    // An agent's edit reaches the owner through the window's room connection.
    const editId = (await docOf(roomKeyOf(room)))?.doc.id as string
    const applied = (
      await conn.call("kimo_apply_ops", {
        docId: editId,
        ops: [{ op: "update", id: "Frame00001", set: { name: "From the agent" } }],
      })
    ).result
    if (!applied.ok) throw new Error(applied.summary)
    await until(() => shared.store.getNode("Frame00001")?.name === "From the agent")

    // A view link stays read only: the agent's edit is refused and nothing changes.
    const viewId = (await docOf(roomKeyOf(viewRoom)))?.doc.id as string
    const refused = (
      await conn.call("kimo_apply_ops", {
        docId: viewId,
        ops: [{ op: "update", id: "Logo000001", set: { name: "Changed" } }],
      })
    ).result
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.errors[0]?.code).toBe("READ_ONLY")
    expect(viewed.store.getNode("Logo000001")?.name).toBe("Logo000001")

    // The window's selection in a room is the room document's selection.
    client.reportSelection(roomKeyOf(room), ["Frame00001"])
    await until(async () => (await docOf(roomKeyOf(room)))?.selection[0] === "Frame00001")

    // Leaving the room (its tab closed) takes it off the list.
    model.join.leave(edit)
    await until(async () => (await docOf(roomKeyOf(room))) === undefined)
    expect(await docOf(roomKeyOf(viewRoom))).toBeDefined()

    model.join.leave(view)
    served.dispose()
    await service.dispose()
    client.dispose()
    await owner.service.stopSharing(room)
    await owner.service.stopSharing(viewRoom)
  }, 30_000)
})
