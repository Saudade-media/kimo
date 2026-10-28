/**
 * Agent area claims across two clients on the real in-process relay: each
 * client has its own store, network provider, claim registry bound to presence and MCP host
 * runtime with one in-app agent. The relay stays blind; claims travel in sealed presence.
 */
import { describe, expect, test } from "bun:test"
import { FORMAT_VERSION } from "@kimo/core-schema"
import { claimsFor, createEmptyDocument, YjsDocStore } from "@kimo/editor-state"
import {
  type BackendDocument,
  type ClientPolicy,
  createDocumentHost,
  createMcpHostRuntime,
  type HostFiles,
  type McpConnection,
  type ToolResult,
} from "@kimo/mcp-server"
import { bindClaimsToPresence, createNetworkProvider, type NetworkProvider } from "@kimo/sync"
import { sealSnapshot } from "@kimo/sync/mp"
import { bearer, type Harness, type Owner, registered, startRelay, token, until } from "./helpers"

const POLICY: ClientPolicy = {
  level: "edit+delete",
  files: [],
  nodes: [],
  grants: [],
  onExceed: "deny",
  confirmDestructive: false,
}

const noFiles: HostFiles = {
  readText: () => Promise.reject(new Error("no files")),
  readBytes: () => Promise.reject(new Error("no files")),
  writeTextAtomic: () => Promise.reject(new Error("no files")),
  writeBytesAtomic: () => Promise.reject(new Error("no files")),
  stat: async () => null,
}

interface Client {
  store: YjsDocStore
  provider: NetworkProvider
  agent: McpConnection
  docId: string
  /** One `kimo_apply_ops` renaming `id`. */
  rename(id: string, name: string): Promise<ToolResult>
  close(): Promise<void>
}

/** A client: store + provider + claims over presence + an MCP runtime with one agent. */
async function client(
  h: Harness,
  owner: Owner,
  name: string,
  store: YjsDocStore = new YjsDocStore(),
): Promise<Client> {
  const provider = createNetworkProvider({
    relayUrl: h.base,
    room: owner.room.id,
    token: await token(owner, "edit"),
    roomKey: owner.roomKey,
    backoff: [5, 40],
  })
  await provider.attach(store)
  const unbind = bindClaimsToPresence(claimsFor(store), provider.awareness, {
    user: { id: name, name, color: "#3366ff" },
  })
  const doc: BackendDocument = {
    path: `untitled:${name}`,
    store,
    readOnlyReason: () => null,
    format: () => FORMAT_VERSION,
    dirty: () => false,
    lastSavedRevision: () => undefined,
    shownInWindow: () => true,
    save: async () => ({ ok: false, error: { code: "UNSUPPORTED", message: "no saving" } }),
    close: async () => {},
  }
  const host = createDocumentHost({
    backend: {
      kind: "web",
      files: noFiles,
      list: () => [doc],
      open: async () => ({ ok: true, value: doc }),
    },
  })
  const runtime = createMcpHostRuntime({ host, approvals: "deny" })
  const agent = runtime.connect(
    { client: "kimo", label: `Agent ${name}`, transport: "in-process", session: name },
    { origin: `agent:kimo.${name}.1`, policy: POLICY },
  )
  const docId = host.list()[0]?.ref.id as string
  return {
    store,
    provider,
    agent,
    docId,
    rename: async (id, value) =>
      (
        await agent.call("kimo_apply_ops", {
          docId,
          ops: [{ op: "update", id, set: { name: value } }],
        })
      ).result,
    async close() {
      runtime.dispose()
      unbind()
      await provider.detach()
    },
  }
}

const codeOf = (r: ToolResult) => (r.ok ? "ok" : r.errors[0]?.code)

describe("agent area claims between two clients", () => {
  test("AREA_BUSY across clients, edits elsewhere land, release at turn end and on disconnect", async () => {
    const h = startRelay({}, { realTime: true })
    const owner = await registered(h)
    const seed = new YjsDocStore()
    seed.loadDocument(createEmptyDocument("Claims"))
    const res = await fetch(`${h.base}/room/${owner.room.id}/snapshot?upTo=0`, {
      method: "PUT",
      headers: bearer(await token(owner, "edit")),
      body: (await sealSnapshot(
        owner.keys,
        0,
        seed.encodeStateAsUpdate(),
      )) as Uint8Array<ArrayBuffer>,
    })
    expect(res.status).toBe(201)

    const a = await client(h, owner, "aaaaaa", seed)
    const b = await client(h, owner, "bbbbbb")
    const seeded = a.store.apply(
      [
        { op: "insert", id: "Hero000001", node: { type: "frame", name: "Hero" } },
        {
          op: "insert",
          id: "Title00001",
          parent: "Hero000001",
          node: { type: "text", name: "Title", content: "Hi" },
        },
        { op: "insert", id: "Footer0001", node: { type: "frame", name: "Footer" } },
      ],
      { origin: "user" },
    )
    expect(seeded.ok).toBe(true)
    await until(() => b.store.hasNode("Title00001") && b.store.hasNode("Footer0001"), 5000)

    // Agent A works on the Hero frame during its turn.
    a.agent.setTurn("turn-a")
    expect(codeOf(await a.rename("Hero000001", "Hero by A"))).toBe("ok")
    await until(
      () =>
        claimsFor(b.store)
          .list()
          .some((c) => c.holder === "agent:kimo.aaaaaa.1"),
      5000,
    )
    const remote = claimsFor(b.store).list()[0]
    expect(remote).toMatchObject({ local: false, ids: ["Hero000001"], turn: "turn-a" })

    // Agent B on the other client: refused inside the frame, free elsewhere.
    const busy = await b.rename("Title00001", "Title by B")
    expect(codeOf(busy)).toBe("AREA_BUSY")
    expect(busy.ok ? null : busy.errors[0]?.detail).toMatchObject({
      holder: "agent:kimo.aaaaaa.1",
      holderLabel: "Agent aaaaaa",
      ids: ["Hero000001"],
    })
    expect(b.store.getNode("Title00001")?.name).toBe("Title")
    expect(codeOf(await b.rename("Footer0001", "Footer by B"))).toBe("ok")
    await until(() => a.store.getNode("Footer0001")?.name === "Footer by B", 5000)

    // A's turn ends: its claim goes, on both clients, and B may edit the frame.
    a.agent.setTurn(null)
    await until(
      () =>
        claimsFor(b.store)
          .list()
          .every((c) => c.local),
      5000,
    )
    expect(codeOf(await b.rename("Title00001", "Title by B"))).toBe("ok")
    await until(() => a.store.getNode("Title00001")?.name === "Title by B", 5000)

    // Now B holds the frame (it claimed the title). A is refused until B's client disconnects.
    await until(
      () =>
        claimsFor(a.store)
          .list()
          .some((c) => c.holder === "agent:kimo.bbbbbb.1" && c.ids.includes("Title00001")),
      5000,
    )
    expect(codeOf(await a.rename("Title00001", "Title by A"))).toBe("AREA_BUSY")
    await b.close()
    await until(() => claimsFor(a.store).list().length === 0, 5000)
    expect(codeOf(await a.rename("Title00001", "Title by A"))).toBe("ok")

    await a.close()
    await h.stop()
  })
})
