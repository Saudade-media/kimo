/**
 * In-app agents through the desktop document host (ADR 0014 §5, host RPC `agentCall`): the
 * agent's calls run in the host under `agent:kimo.<session>.<n>`, keep per-origin undo (the
 * user's Cmd+Z and an MCP client's undo never undo them), enforce the window's scope with
 * `checkScope` in the host and forward approvals to the window's in-thread card, which waits
 * until answered.
 */
import { describe, expect, test } from "bun:test"
import { agentOrigin, childPolicy, leadPolicy, type ToolHost } from "@kimo/ai-agent"
import { createEmptyDocument, serialize } from "@kimo/editor-state"
import {
  type ApprovalOutcome,
  type ApprovalRequest,
  type ClientPolicy,
  fileIdOf as fileIdFor,
} from "@kimo/mcp-server"
import { validateInput } from "@kimo/mcp-server/server"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { createHostTools } from "../../src/agent-panel/host-tools"
import { agentToolsFor } from "../../src/editor/agent-panel"
import {
  createMemoryBridgeNetwork,
  HOST_LABEL,
  HostClient,
  type HostedDocumentSession,
  hostedSessionFactory,
  startDocumentHostService,
} from "../../src/host"
import { createSessionManager } from "../../src/platform/session"
import { tick, until } from "./helpers"

const REF = "/Users/me/site/home.kimo"

function fileText() {
  const d = createEmptyDocument("Home") as ReturnType<typeof createEmptyDocument> & {
    nodes: Record<string, unknown>
  }
  d.nodes.Frame00001 = {
    type: "frame",
    parent: null,
    order: "a0",
    name: "Home",
    x: 0,
    y: 0,
    w: 400,
    h: 300,
    fill: "#FFFFFF",
  }
  d.nodes.Frame00002 = {
    type: "frame",
    parent: null,
    order: "a1",
    name: "Other",
    x: 500,
    y: 0,
    w: 200,
    h: 200,
  }
  return serialize(d)
}

async function setup(approvalTimeoutMs?: number) {
  const platform = createMemoryPlatform({
    pid: 7000,
    files: { [REF]: fileText() },
    settings: { "files.autosave": false },
  })
  const net = createMemoryBridgeNetwork()
  net.commands.set("kimo_mcp_policies_get", () => ({}))
  const service = await startDocumentHostService({
    platform,
    bridge: net.bridge(HOST_LABEL),
    version: "0.5.0-test",
    relay: false,
    validate: validateInput as never,
    ...(approvalTimeoutMs ? { approvalTimeoutMs } : {}),
  })
  const client = await HostClient.connect(net.bridge("editor-1"), 1000)
  if (!client) throw new Error("no host")
  const manager = createSessionManager({ platform, createSession: hostedSessionFactory(client) })
  const session = (await manager.open(REF)) as HostedDocumentSession
  const tools = createHostTools({ client, ref: REF })
  await tools.refresh()
  const mcp = service.runtime.connect(
    { client: "claude-code", label: "Claude Code", transport: "socket" },
    { policy: { ...leadPolicy(), files: ["/Users/me/**"] } },
  )
  const hostStore = () => {
    const r = service.host.get(tools.docId())
    if (!r.ok) throw new Error("not open in the host")
    return r.value.store
  }
  return { platform, net, service, client, session, tools, mcp, hostStore }
}

type Spec = Parameters<ReturnType<typeof createHostTools>["factory"]>[0]

function agent(
  tools: ReturnType<typeof createHostTools>,
  o: {
    n?: number
    policy?: ClientPolicy
    approve?: (r: ApprovalRequest) => Promise<ApprovalOutcome>
  } = {},
): { host: ToolHost; spec: Spec } {
  const spec: Spec = {
    origin: agentOrigin("s1", o.n ?? 0),
    label: o.n ? `Agent ${o.n + 1}` : "Kimo",
    session: "s1",
    policy: o.policy ?? leadPolicy(),
    requestApproval: o.approve ?? (async () => "deny"),
  }
  return { host: tools.factory(spec), spec }
}

const run = (host: ToolHost, name: string, input: Record<string, unknown>) =>
  host.call({ id: `c-${name}`, name, input }, new AbortController().signal)

describe("agentCall: in-app agents through the document host", () => {
  test("edits carry the agent origin and keep undo per origin", async () => {
    const { service, session, tools, mcp, hostStore, client } = await setup()
    const docId = tools.docId()
    expect(docId).toBe(service.host.docIdForPath(REF) as string)
    const { host } = agent(tools)
    const origin = agentOrigin("s1", 0)

    // The window's replica records where edits came from.
    const origins: string[] = []
    session.store.onChange((c) => origins.push(c.origin))

    const applied = (
      await run(host, "kimo_apply_ops", {
        docId,
        label: "Insert Agent card",
        ops: [
          {
            op: "insert",
            key: "card",
            parent: "Frame00001",
            node: { type: "rect", name: "Agent card", x: 10, y: 10, w: 50, h: 50 },
          },
        ],
      })
    ).result
    if (!applied.ok) throw new Error(applied.summary)
    const cardId = applied.created?.[0]?.id as string
    await until(() => session.store.hasNode(cardId))
    expect(origins).toContain(`remote:${origin}`)
    // On the host store the agent's own undo stack holds it; nobody else's does.
    expect(hostStore().canUndo(origin)).toBe(true)
    expect(hostStore().canUndo(mcp.origin as never)).toBe(false)

    // The activity log of the file has the agent's edit with its undo token.
    const entries = await service.runtime.activity.list(fileIdOf(service, docId))
    const edit = entries.find((e) => e.origin === origin && e.kind === "edit")
    expect(edit?.undoToken).toBe(applied.undoToken as string)

    // An MCP client cannot undo the agent's edit.
    const mcpUndo = (await mcp.call("kimo_history", { docId, action: "undo" })).result
    expect(mcpUndo.ok).toBe(false)
    expect(hostStore().hasNode(cardId)).toBe(true)

    // The user's Cmd+Z on the replica undoes only the user's own edit.
    session.store.apply(
      { op: "update", id: "Frame00001", set: { name: "User title" } },
      { origin: "user" },
    )
    expect(session.store.undo("user").ok).toBe(true)
    expect(session.store.canUndo("user")).toBe(false)
    expect(session.store.hasNode(cardId)).toBe(true)

    // The agent's own undo (Undo turn) removes its card everywhere.
    const undo = (
      await run(host, "kimo_history", { docId, action: "undo", token: applied.undoToken })
    ).result
    expect(undo.ok).toBe(true)
    await until(() => !session.store.hasNode(cardId))
    expect(hostStore().hasNode(cardId)).toBe(false)

    // The person edited Frame00001, inside the agent's area (it holds the card's frame): the
    // agent paused until Resume, and its next write is refused once so it re-reads first
    // (ADR 0016 item 16), then goes through.
    const rename = {
      docId,
      ops: [{ op: "update", id: "Frame00002", set: { name: "Agent rename" } }],
    }
    const status = (await service.multiplayer?.rpc["mp.status"]?.({ ref: REF }, "editor-1")) as {
      paused: { holder: string }[]
    }
    expect(status.paused.map((p) => p.holder)).toEqual([origin])
    await service.multiplayer?.rpc["mp.resumeAgent"]?.({ ref: REF, holder: origin }, "editor-1")
    const told = (await run(host, "kimo_apply_ops", rename)).result
    expect(!told.ok && told.errors[0]?.code).toBe("REVISION_CONFLICT")
    expect(!told.ok && told.errors[0]?.detail).toMatchObject({ kind: "human-edit", by: "local" })

    // agentUndo from the Activity tab reaches agent connections too.
    const again = (await run(host, "kimo_apply_ops", rename)).result
    if (!again.ok) throw new Error(again.summary)
    const r = await client.agentUndo(REF, origin, again.undoToken)
    expect(r.ok).toBe(true)
    expect(hostStore().getNode("Frame00002")?.name).toBe("Other")

    // Releasing the window's agents drops them from presence.
    tools.dispose()
    await until(() => !service.runtime.presence.get(origin))
    mcp.close()
    client.dispose()
    await service.dispose()
  })

  test("the window's scope is enforced per op in the host (OUT_OF_SCOPE, batch rolled back)", async () => {
    const { service, tools, hostStore, client } = await setup()
    const docId = tools.docId()
    const child = agent(tools, { n: 1, policy: childPolicy(["Frame00001"]) })
    const out = (
      await run(child.host, "kimo_apply_ops", {
        docId,
        ops: [
          { op: "update", id: "Frame00001", set: { name: "In scope" } },
          { op: "update", id: "Frame00002", set: { name: "Out of scope" } },
        ],
      })
    ).result
    expect(out.ok).toBe(false)
    if (out.ok) throw new Error("expected a failure")
    expect(out.errors[0]?.code).toBe("OUT_OF_SCOPE")
    expect(hostStore().getNode("Frame00001")?.name).toBe("Home")
    expect(hostStore().getNode("Frame00002")?.name).toBe("Other")
    // Moving a scope root is rejected too (checkScope rules, not only target ids).
    const moved = (
      await run(child.host, "kimo_apply_ops", {
        docId,
        ops: [{ op: "delete", id: "Frame00001" }],
      })
    ).result
    expect(!moved.ok && moved.errors[0]?.code).toBe("OUT_OF_SCOPE")
    // Inside its frame it edits normally.
    const ok = (
      await run(child.host, "kimo_apply_ops", {
        docId,
        ops: [
          {
            op: "insert",
            parent: "Frame00001",
            node: { type: "rect", name: "Child rect", x: 0, y: 0, w: 10, h: 10 },
          },
        ],
      })
    ).result
    expect(ok.ok).toBe(true)
    const denied = (await service.runtime.activity.list(fileIdOf(service, docId))).filter(
      (e) => e.origin === agentOrigin("s1", 1) && e.kind === "denied",
    )
    expect(denied.length).toBe(2)
    tools.dispose()
    client.dispose()
    await service.dispose()
  })

  test("approvals go to the window's card and wait past the MCP timeout", async () => {
    // A 20 ms MCP timeout: the in-app prompt must not use it.
    const { service, tools, hostStore, client } = await setup(20)
    const docId = tools.docId()
    const asked: ApprovalRequest[] = []
    const { host } = agent(tools, {
      policy: { ...leadPolicy(), level: "read" },
      approve: async (r) => {
        asked.push(r)
        await tick(80)
        return "once"
      },
    })
    const out = (
      await run(host, "kimo_apply_ops", {
        docId,
        ops: [{ op: "update", id: "Frame00002", set: { name: "Approved" } }],
      })
    ).result
    expect(out.ok).toBe(true)
    expect(asked.length).toBe(1)
    // Never on the MCP clients' prompt queue.
    expect(service.runtime.approvals.pending()).toEqual([])
    expect(hostStore().getNode("Frame00002")?.name).toBe("Approved")
    // Its turn ends: its area claim on Frame00002 goes (host RPC agentTurn).
    await host.turn?.("start", "turn-1")
    await host.turn?.("end", "turn-1")

    // Stop answers deny: PERMISSION_DENIED, nothing applied.
    const stopped = agent(tools, {
      n: 2,
      policy: { ...leadPolicy(), level: "read" },
      approve: async () => "deny",
    })
    const denied = (
      await run(stopped.host, "kimo_apply_ops", {
        docId,
        ops: [{ op: "update", id: "Frame00002", set: { name: "Denied" } }],
      })
    ).result
    expect(!denied.ok && denied.errors[0]?.code).toBe("PERMISSION_DENIED")
    expect(hostStore().getNode("Frame00002")?.name).toBe("Approved")

    // Releasing the window while a prompt is open answers it deny.
    let release: () => void = () => {}
    const pendingAgent = agent(tools, {
      n: 3,
      policy: { ...leadPolicy(), level: "read" },
      approve: () =>
        new Promise<ApprovalOutcome>((resolve) => {
          release = () => resolve("once")
        }),
    })
    const pending = run(pendingAgent.host, "kimo_apply_ops", {
      docId,
      ops: [{ op: "update", id: "Frame00002", set: { name: "Late" } }],
    })
    await until(
      () => service.runtime.presence.get(agentOrigin("s1", 3))?.state === "waiting-approval",
    )
    tools.dispose()
    const late = (await pending).result
    expect(late.ok).toBe(false)
    release()
    expect(hostStore().getNode("Frame00002")?.name).toBe("Approved")
    client.dispose()
    await service.dispose()
  })

  test("the editor uses the host tool host when hosted, and keeps untitled documents in the window", async () => {
    const { session, client, service, platform } = await setup()
    const common = {
      store: session.store,
      path: REF,
      version: "0.5.0-test",
    }
    const hosted = agentToolsFor({ ...common, hostClient: client, doc: session })
    expect(hosted.kind).toBe("host")
    hosted.dispose?.()
    expect(agentToolsFor({ ...common, hostClient: null, doc: session }).kind).toBe("in-window")
    const local = createSessionManager({ platform, createSession: hostedSessionFactory(client) })
    const untitled = await local.newUntitled()
    expect(
      agentToolsFor({ ...common, store: untitled.store, hostClient: client, doc: untitled }).kind,
    ).toBe("in-window")
    client.dispose()
    await service.dispose()
  })
})

function fileIdOf(
  service: Awaited<ReturnType<typeof startDocumentHostService>>,
  docId: string,
): string {
  const d = service.host.list().find((x) => x.ref.id === docId)
  return fileIdFor((d as { ref: { path: string } }).ref.path, docId)
}
