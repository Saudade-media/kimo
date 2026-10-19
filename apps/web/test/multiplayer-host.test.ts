/**
 * Multiplayer in the desktop document host (spec §16.8): an editor window shares a file through
 * the host's `mp.*` RPC, reads pushed snapshots through its share backend and the view model,
 * and a paused agent's calls wait in the host until it resumes.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { claimsFor, createEmptyDocument, serialize, YjsDocStore } from "@kimo/editor-state"
import { validateInput } from "@kimo/mcp-server/server"
import { createMemoryPlatform } from "@kimo/platform/memory"
import {
  createHostShareBackend,
  createMemoryBridgeNetwork,
  HOST_LABEL,
  HostClient,
  type HostedDocumentSession,
  hostedSessionFactory,
  startDocumentHostService,
} from "../src/host"
import { createMemoryAssetStore } from "../src/lib/assets"
import { createMultiplayerModel } from "../src/multiplayer/model"
import { createSessionManager } from "../src/platform/session"
import { createPlatformShare } from "../src/platform/share"
import { type Relay, startRelay, until } from "./multiplayer-helpers"

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
