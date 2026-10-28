/**
 * Streamed edits through the desktop document host (ADR 0013 §4.7): the window forwards a call
 * the model is still writing, its ops land in the host store (and the window's replica) before
 * the call arrives, and the call commits them as one undo step.
 *
 * - built-in agent: `ToolHost.stream` → host RPC `agentStream` → `agentCall` with the callId;
 * - Claude Code: the CLI's stream-json → host RPC `cliStream` (the CLI's MCP connection, by its
 *   session workspace) → `tools/call` with `_meta["claudecode/toolUseId"]`.
 */
import { describe, expect, test } from "bun:test"
import { agentOrigin, leadPolicy, type ToolHost } from "@kimo/ai-agent"
import { createEmptyDocument, serialize } from "@kimo/editor-state"
import { validateInput } from "@kimo/mcp-server/server"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { createHostTools, rpcToolStream } from "../../src/agent-panel/host-tools"
import {
  createMemoryBridgeNetwork,
  HOST_LABEL,
  HostClient,
  type HostedDocumentSession,
  hostedSessionFactory,
  startDocumentHostService,
} from "../../src/host"
import { createSessionManager } from "../../src/platform/session"
import { until } from "./helpers"

const REF = "/Users/me/site/home.kimo"
const WORKSPACE = "/Users/me/.kimo/cli-workspaces/s1abc"

async function setup() {
  const d = createEmptyDocument("Home")
  const platform = createMemoryPlatform({
    pid: 7000,
    files: { [REF]: serialize(d) },
    settings: { "files.autosave": false },
  })
  const net = createMemoryBridgeNetwork()
  const sent: { connectionId: string; message: string }[] = []
  net.commands.set("kimo_mcp_send", (a) => void sent.push(a as never))
  net.commands.set("kimo_mcp_host_ready", () => {})
  net.commands.set("kimo_mcp_policies_get", () => ({}))
  const service = await startDocumentHostService({
    platform,
    bridge: net.bridge(HOST_LABEL),
    version: "0.5.0-test",
    relay: true,
    validate: validateInput as never,
  })
  const client = await HostClient.connect(net.bridge("editor-1"), 1000)
  if (!client) throw new Error("no host")
  const manager = createSessionManager({ platform, createSession: hostedSessionFactory(client) })
  const session = (await manager.open(REF)) as HostedDocumentSession
  const tools = createHostTools({ client, ref: REF })
  await tools.refresh()
  const hostStore = () => {
    const r = service.host.get(tools.docId())
    if (!r.ok) throw new Error("not open in the host")
    return r.value.store
  }
  const names = (store = hostStore()) =>
    store
      .nodeIds()
      .map((id) => store.getNode(id)?.name)
      .sort()
  const agentHost = (): ToolHost =>
    tools.factory({
      origin: agentOrigin("s1", 0),
      label: "Kimo",
      session: "s1",
      policy: leadPolicy(),
      requestApproval: async () => "deny",
    })
  const dispose = async () => {
    tools.dispose()
    client.dispose()
    await service.dispose()
  }
  return { net, sent, service, client, session, tools, hostStore, names, agentHost, dispose }
}

const frame = (key: string, name: string, parent = "root") => ({
  op: "insert",
  key,
  parent,
  node: { type: "frame", name, x: 0, y: 0, w: 400, h: 200 },
})
const text = (key: string, parent: string, content: string) => ({
  op: "insert",
  key,
  parent,
  node: { type: "text", name: content, content, style: { size: 16 }, fill: "#111111" },
})

describe("streamed edits through the document host", () => {
  test("built-in agent: ops land in the host and the window before the call; one undo step", async () => {
    const h = await setup()
    const host = h.agentHost()
    const input = {
      docId: h.tools.docId(),
      ops: [frame("page", "Page"), text("t1", "@page", "Title"), text("t2", "@page", "Body")],
    }
    const json = JSON.stringify(input)
    const s = host.stream?.({ id: "toolu_a", name: "kimo_apply_ops" })
    if (!s) throw new Error("no stream")
    s.push(json.slice(0, json.indexOf('"Body"')))
    await until(() => h.names().length === 2)
    expect(h.names()).toEqual(["Page", "Title"])
    // The window's replica shows them too (synced from the host).
    await until(() => h.names(h.session.store).length === 2)
    s.push(json.slice(json.indexOf('"Body"')))
    const out = await host.call(
      { id: "toolu_a", name: "kimo_apply_ops", input },
      new AbortController().signal,
    )
    expect(out.result.ok).toBe(true)
    expect(h.names()).toEqual(["Body", "Page", "Title"])
    const undo = await host.call(
      {
        id: "u",
        name: "kimo_history",
        input: {
          docId: input.docId,
          action: "undo",
          token: (out.result as { undoToken: string }).undoToken,
        },
      },
      new AbortController().signal,
    )
    expect(undo.result.ok).toBe(true)
    expect(h.names()).toEqual([])
    await h.dispose()
  })

  test("built-in agent: a kimo_script streams statement by statement through the host", async () => {
    const h = await setup()
    const host = h.agentHost()
    const code = `const page = Insert("root", {type: "frame", name: "Page", x: 0, y: 0, w: 400, h: 200})
for (const t of ["Title", "Body"]) Insert(page, {type: "text", name: t, content: t, fill: "#111111"})
`
    const input = { docId: h.tools.docId(), code }
    const json = JSON.stringify(input)
    const s = host.stream?.({ id: "toolu_s", name: "kimo_script" })
    if (!s) throw new Error("no stream")
    // The first statement is complete once the next one starts.
    s.push(json.slice(0, json.indexOf("for (")))
    s.push("f")
    await until(() => h.names().length === 1)
    expect(h.names()).toEqual(["Page"])
    s.push(json.slice(json.indexOf("for (") + 1))
    const out = await host.call(
      { id: "toolu_s", name: "kimo_script", input },
      new AbortController().signal,
    )
    expect(out.result.ok).toBe(true)
    expect(h.names()).toEqual(["Body", "Page", "Title"])
    const undo = await host.call(
      {
        id: "u",
        name: "kimo_history",
        input: {
          docId: input.docId,
          action: "undo",
          token: (out.result as { undoToken: string }).undoToken,
        },
      },
      new AbortController().signal,
    )
    expect(undo.result.ok).toBe(true)
    expect(h.names()).toEqual([])
    await h.dispose()
  })

  test("built-in agent: Stop mid-stream rolls the host's provisional ops back", async () => {
    const h = await setup()
    const s = h.agentHost().stream?.({ id: "toolu_b", name: "kimo_apply_ops" })
    s?.push(JSON.stringify({ docId: h.tools.docId(), ops: [frame("a", "A")] }).slice(0, -2))
    await until(() => h.names().length === 1)
    s?.abort("Stopped.")
    await until(() => h.names().length === 0)
    await h.dispose()
  })

  test("Claude Code: cliStream applies on the CLI's MCP connection; tools/call with _meta commits", async () => {
    const h = await setup()
    // The CLI's MCP shim connects with the session workspace as its cwd.
    h.net.rustEmit(
      "kimo://mcp-connection",
      {
        connectionId: "c_cli1",
        state: "open",
        transport: "socket",
        hello: {
          client: "claude-code",
          pid: 1,
          ppid: 2,
          cwd: WORKSPACE,
          relay: { name: "kimo-mcp", version: "1" },
        },
      },
      HOST_LABEL,
    )
    const line = (o: unknown) =>
      h.net.rustEmit(
        "kimo://mcp-in",
        { connectionId: "c_cli1", message: JSON.stringify(o) },
        HOST_LABEL,
      )
    line({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "claude-code", version: "2" },
      },
    })
    line({ jsonrpc: "2.0", method: "notifications/initialized" })
    await until(() => h.sent.some((s) => JSON.parse(s.message).id === 1))
    const docId = h.tools.docId()
    const input = { docId, ops: [frame("a", "Hero"), text("t", "@a", "Headline")] }
    const json = JSON.stringify(input)
    const s = rpcToolStream(h.client, "cliStream", "cliStreamClose", {
      workspace: WORKSPACE,
      callId: "toolu_cli",
    })
    for (let i = 0; i < json.length; i += 11) s.stream.push(json.slice(i, i + 11))
    await s.sent()
    expect(h.names()).toEqual(["Headline", "Hero"])
    const rev = h.hostStore().revision
    line({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "kimo_apply_ops",
        arguments: input,
        _meta: { "claudecode/toolUseId": "toolu_cli" },
      },
    })
    await until(() => h.sent.some((m) => JSON.parse(m.message).id === 2))
    const r = JSON.parse(h.sent.find((m) => JSON.parse(m.message).id === 2)?.message as string)
    expect(r.result.structuredContent.ok).toBe(true)
    expect(r.result.structuredContent.data.inserted).toBe(2)
    // Committed, not re-applied.
    expect(h.hostStore().revision).toEqual(rev)
    expect(h.names()).toEqual(["Headline", "Hero"])
    await h.dispose()
  })

  test("Claude Code: a stream whose call never comes is closed by the window and rolls back", async () => {
    const h = await setup()
    h.net.rustEmit(
      "kimo://mcp-connection",
      {
        connectionId: "c_cli2",
        state: "open",
        transport: "socket",
        hello: {
          client: "claude-code",
          pid: 1,
          ppid: 2,
          cwd: WORKSPACE,
          relay: { name: "kimo-mcp", version: "1" },
        },
      },
      HOST_LABEL,
    )
    await until(() => h.service.runtime.connections().length > 0)
    const s = rpcToolStream(h.client, "cliStream", "cliStreamClose", {
      workspace: WORKSPACE,
      callId: "toolu_x",
    })
    s.stream.push(JSON.stringify({ docId: h.tools.docId(), ops: [frame("a", "A")] }))
    await s.sent()
    expect(h.names()).toEqual(["A"])
    s.stream.abort("The call never arrived.")
    await s.sent()
    expect(h.names()).toEqual([])
    await h.dispose()
  })
})
