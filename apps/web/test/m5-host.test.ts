/**
 * M5 desktop document host (ADR 0002 Option A, ADR 0013 §7) over a memory platform and a fake
 * Tauri event bus: host conformance, window ↔ host round trips (agent edits reach the editor's
 * replica; the user's undo never undoes them) and the Rust relay contract.
 */
import { describe, expect, test } from "bun:test"
import { createEmptyDocument, serialize } from "@kimo/editor-state"
import { validateInput } from "@kimo/mcp-server/server"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { describeHostConformance } from "../../../packages/mcp-server/test/conformance"
import {
  createDesktopMcpHost,
  createMemoryBridgeNetwork,
  HOST_LABEL,
  HostClient,
  type HostedDocumentSession,
  hostedSessionFactory,
  startDocumentHostService,
} from "../src/host"
import { createSessionManager } from "../src/platform/session"

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms))
async function until(cond: () => boolean, ms = 2000) {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timed out")
    await tick()
  }
}

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
  return serialize(d)
}

async function startHost(files: Record<string, string> = {}, relay = false) {
  const platform = createMemoryPlatform({ pid: 7000, files, settings: { "files.autosave": false } })
  const net = createMemoryBridgeNetwork()
  const sent: { connectionId: string; message: string }[] = []
  const ready: unknown[] = []
  net.commands.set("kimo_mcp_send", (a) => void sent.push(a as never))
  net.commands.set("kimo_mcp_host_ready", (a) => void ready.push(a))
  net.commands.set("kimo_mcp_policies_get", () => ({}))
  const service = await startDocumentHostService({
    platform,
    bridge: net.bridge(HOST_LABEL),
    version: "0.5.0-test",
    relay,
    validate: validateInput as never,
  })
  return { platform, net, service, sent, ready }
}

describeHostConformance("desktop document host (session manager, memory platform)", async () => {
  const { platform, service } = await startHost()
  return {
    host: service.host,
    handlers: service.runtime.handlers,
    root: "/Users/me/conf",
    writeFile: async (p, t) => platform.control.writeExternal(p, t),
    readFile: async (p) => platform.control.readFile(p),
    setForeignLease: (p, h) => platform.control.setForeignLease(p, h),
    dispose: () => service.dispose(),
  }
})

describe("editor window ↔ document host", () => {
  test("an MCP edit appears in the window's replica; the user's undo never undoes agent ops", async () => {
    const ref = "/Users/me/site/home.kimo"
    const { platform, net, service } = await startHost({ [ref]: fileText() })
    const client = await HostClient.connect(net.bridge("editor-1"), 1000)
    if (!client) throw new Error("no host")
    const windowManager = createSessionManager({
      platform,
      createSession: hostedSessionFactory(client),
    })
    const session = (await windowManager.open(ref)) as HostedDocumentSession
    expect(session.state().phase).toBe("ready")
    expect(session.store.getNode("Frame00001")?.name).toBe("Home")
    expect(service.viewers(ref)).toEqual(["editor-1"])

    // The agent opens the same file: same document, already open.
    const conn = service.runtime.connect({
      client: "claude-code",
      label: "Claude Code",
      transport: "socket",
    })
    const opened = (await conn.call("kimo_open", { path: ref })).result
    if (!opened.ok) throw new Error(opened.summary)
    const docId = (opened.data as { doc: { id: string }; alreadyOpen: boolean }).doc.id
    expect((opened.data as { alreadyOpen: boolean }).alreadyOpen).toBe(true)

    // User edit in the window first (its own undo stack).
    session.store.apply(
      { op: "update", id: "Frame00001", set: { name: "User title" } },
      { origin: "user" },
    )
    await until(
      () =>
        service.host.get(docId).ok &&
        (
          service.host.get(docId) as {
            value: { store: { getNode(id: string): { name?: unknown } | undefined } }
          }
        ).value.store.getNode("Frame00001")?.name === "User title",
    )

    // Agent edit on the host → window replica.
    const applied = (
      await conn.call("kimo_apply_ops", {
        docId,
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
    const origins: string[] = []
    session.store.onChange((c) => origins.push(c.origin))

    // User undo: reverts the user's edit only.
    expect(session.store.undo("user").ok).toBe(true)
    expect(session.store.getNode("Frame00001")?.name).toBe("Home")
    expect(session.store.hasNode(cardId)).toBe(true)
    expect(session.store.canUndo("user")).toBe(false)
    await until(
      () =>
        (
          service.host.get(docId) as {
            value: { store: { getNode(id: string): { name?: unknown } | undefined } }
          }
        ).value.store.getNode("Frame00001")?.name === "Home",
    )

    // Agent undo on the host: removes only its card, the window follows (remote:mcp:… origin).
    const undo = (
      await conn.call("kimo_history", { docId, action: "undo", token: applied.undoToken })
    ).result
    expect(undo.ok).toBe(true)
    await until(() => !session.store.hasNode(cardId))
    expect(origins.some((o) => o.startsWith("remote:mcp:claude-code."))).toBe(true)

    // kimo_focus reaches the window showing the document.
    const focused: unknown[] = []
    client.onFocus((f) => focused.push(f))
    const f = (await conn.call("kimo_focus", { docId, ids: ["Frame00001"] })).result
    expect(f.ok && (f.data as { shown: boolean }).shown).toBe(true)
    await until(() => focused.length === 1)
    client.reportSelection(ref, ["Frame00001"])
    await tick(10)
    const st = (await conn.call("kimo_get_state", { docId })).result
    expect(
      st.ok && (st.data as { documents: { selection: string[] }[] }).documents[0]?.selection,
    ).toEqual(["Frame00001"])

    // ⌘S in the window saves through the host (verified write).
    session.store.apply(
      { op: "update", id: "Frame00001", set: { name: "Saved" } },
      { origin: "user" },
    )
    await tick(20)
    await session.save()
    expect(platform.control.readFile(ref)).toContain('"Saved"')
    expect(session.state().saveStatus.kind).toBe("saved")

    // Closing the window releases it; the host keeps the document while the agent uses it.
    expect(await session.close()).toBe(true)
    expect(service.viewers(ref)).toEqual([])
    expect(service.host.get(docId).ok).toBe(true)
    conn.close()
    client.dispose()
    await service.dispose()
  })

  test("a second window shares the host's document (one writer per file)", async () => {
    const ref = "/Users/me/site/shared.kimo"
    const { platform, net, service } = await startHost({ [ref]: fileText() })
    const a = await HostClient.connect(net.bridge("editor-1"), 1000)
    const b = await HostClient.connect(net.bridge("editor-2"), 1000)
    if (!a || !b) throw new Error("no host")
    const ma = createSessionManager({ platform, createSession: hostedSessionFactory(a) })
    const mb = createSessionManager({ platform, createSession: hostedSessionFactory(b) })
    const sa = await ma.open(ref)
    const sb = await mb.open(ref)
    sa.store.apply({ op: "update", id: "Frame00001", set: { name: "From A" } }, { origin: "user" })
    await until(() => sb.store.getNode("Frame00001")?.name === "From A")
    expect(service.manager.sessions()).toHaveLength(1)
    expect(await platform.leases.inspect(ref)).toMatchObject({ self: true })
    await service.dispose()
  })

  test("a window that pings before the host listens still connects; opens wait for the host", async () => {
    // Launch: the editor window and the host webview start together, and an event sent before
    // the host listens is dropped. The window renders at once; its opens wait for the host.
    const ref = "/Users/me/site/launch.kimo"
    const platform = createMemoryPlatform({
      pid: 7001,
      files: { [ref]: fileText() },
      settings: { "files.autosave": false },
    })
    const net = createMemoryBridgeNetwork()
    net.commands.set("kimo_mcp_policies_get", () => ({}))
    const t0 = Date.now()
    const connecting = HostClient.connect(net.bridge("main"), 5000)
    const windowManager = createSessionManager({
      platform,
      sessionFactory: connecting.then((c) => (c ? hostedSessionFactory(c) : undefined)),
    })
    const opening = windowManager.open(ref)
    await tick(200)
    const service = await startDocumentHostService({
      platform,
      bridge: net.bridge(HOST_LABEL),
      version: "0.5.0-test",
      relay: false,
      validate: validateInput as never,
    })
    const client = await connecting
    expect(client).not.toBeNull()
    expect(Date.now() - t0).toBeLessThan(1500)
    const session = (await opening) as HostedDocumentSession
    expect(session.hosted).toBe(true)
    expect(service.viewers(ref)).toEqual(["main"])
    client?.dispose()
    await service.dispose()
  })

  test("opens fall back to local sessions when no host answers", async () => {
    const ref = "/Users/me/site/local.kimo"
    const platform = createMemoryPlatform({ pid: 7002, files: { [ref]: fileText() } })
    const net = createMemoryBridgeNetwork()
    const connecting = HostClient.connect(net.bridge("main"), 300)
    const windowManager = createSessionManager({
      platform,
      sessionFactory: connecting.then((c) => (c ? hostedSessionFactory(c) : undefined)),
    })
    const session = await windowManager.open(ref)
    expect(await connecting).toBeNull()
    expect("hosted" in session).toBe(false)
    expect(session.state().phase).toBe("ready")
    await windowManager.dispose()
  })
})

describe("window McpHostApi (createDesktopMcpHost)", () => {
  test("connections with the running call, real pause, approvals answered to the host, per-call undo, installer", async () => {
    const ref = "/Users/me/site/home.kimo"
    const { net, service } = await startHost({ [ref]: fileText() })
    const configs = new Map<string, string>([["/Users/me/.claude.json", '{"projects":{}}\n']])
    net.commands.set("kimo_mcp_status", () => ({
      socket: { path: "/s", listening: true },
      http: { enabled: false },
      documentHost: "ready",
      shimPath: "/Applications/Kimo.app/Contents/MacOS/kimo-mcp",
      protocol: "kimo-socket/1",
      connections: 0,
      home: "/Users/me",
      backupDir: "/Users/me/.kimo/mcp/backups",
    }))
    net.commands.set("kimo_mcp_config_read", (a) => configs.get(String(a.path)) ?? null)
    net.commands.set("kimo_mcp_config_write", (a) => {
      configs.set(String(a.path), String(a.text))
      return null
    })
    const client = await HostClient.connect(net.bridge("editor-1"), 1000)
    if (!client) throw new Error("no host")
    const conn = service.runtime.connect({
      client: "claude-code",
      label: "Claude Code",
      transport: "socket",
    })
    const mcp = await createDesktopMcpHost({ bridge: net.bridge("editor-1"), client, os: "macos" })
    // Seeded from the host (events only carry changes).
    expect((await mcp.connections()).map((c) => c.origin)).toEqual([conn.origin])
    // Approvals: prompts reach the window; answers go back to the host (open: once, delete: deny).
    const asked: string[] = []
    mcp.approvals.onRequest((r) => {
      asked.push(r.reason.kind)
      void mcp.approvals.respond(r.id, r.reason.kind === "file" ? "once" : "deny")
    })
    const seen: string[] = []
    mcp.onConnections((c) => {
      const call = c[0]?.call
      if (call) seen.push(call.label)
    })
    const opened = (await conn.call("kimo_open", { path: ref })).result
    if (!opened.ok) throw new Error(opened.summary)
    const docId = (opened.data as { doc: { id: string } }).doc.id
    await until(() => seen.includes("Opening home.kimo"))

    // Pause holds the client's next call until resume.
    await mcp.clients.pause("claude-code")
    expect(await mcp.clients.paused()).toEqual(["claude-code"])
    await until(() => service.runtime.presence.list()[0]?.paused === true)
    let done = false
    const held = conn
      .call("kimo_apply_ops", {
        docId,
        ops: [{ op: "update", id: "Frame00001", set: { name: "Agent" } }],
      })
      .then((o) => {
        done = true
        return o
      })
    await tick(30)
    expect(done).toBe(false)
    await mcp.clients.resume("claude-code")
    const applied = (await held).result
    if (!applied.ok) throw new Error(applied.summary)

    // Per-call undo through the host (guarded by the undo token).
    const token = (applied as { undoToken?: string }).undoToken
    const u = await mcp.history.undo(ref, conn.origin, token)
    expect(u).toEqual({ ok: true, stale: false })

    const del = (
      await conn.call("kimo_apply_ops", { docId, ops: [{ op: "delete", id: "Frame00001" }] })
    ).result
    expect(del.ok).toBe(false)
    expect(asked).toEqual(["file", "destructive"])
    expect(mcp.approvals.pending()).toHaveLength(0)

    // Installer over the config commands: backup, then an additive write.
    const rows = await mcp.installer.status("user")
    expect(rows.find((r) => r.host === "claude-code")?.installed).toBe(false)
    const row = await mcp.installer.install("claude-code", "user")
    expect(row.installed && row.current).toBe(true)
    const text = JSON.parse(configs.get("/Users/me/.claude.json") ?? "{}")
    expect(text.projects).toEqual({})
    expect(text.mcpServers.kimo.args).toEqual(["--client", "claude-code"])
    expect(
      [...configs.keys()].some((k) => k.startsWith("/Users/me/.kimo/mcp/backups/claude-code-")),
    ).toBe(true)
    mcp.dispose()
    client.dispose()
    await service.dispose()
  })
})

describe("Rust relay contract (fake event bus)", () => {
  test("mcp-connection / mcp-in / kimo_mcp_send / host_ready; identity from clientInfo when hello has none", async () => {
    const ref = "/Users/me/site/relay.kimo"
    const { platform, net, service, sent, ready } = await startHost({ [ref]: fileText() }, true)
    expect(ready).toEqual([{ version: "0.5.0-test" }])
    net.rustEmit(
      "kimo://mcp-connection",
      {
        connectionId: "c_k3f9a2",
        state: "open",
        transport: "socket",
        hello: {
          client: "unknown",
          pid: 1,
          ppid: 2,
          relay: { name: "kimo-mcp", version: "0.5.0" },
        },
      },
      HOST_LABEL,
    )
    // Duplicate announce (after host_ready) is idempotent.
    net.rustEmit(
      "kimo://mcp-connection",
      { connectionId: "c_k3f9a2", state: "open", transport: "socket" },
      HOST_LABEL,
    )
    const line = (o: unknown) =>
      net.rustEmit(
        "kimo://mcp-in",
        { connectionId: "c_k3f9a2", message: JSON.stringify(o) },
        HOST_LABEL,
      )
    line({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "Codex", version: "1" },
      },
    })
    line({ jsonrpc: "2.0", method: "notifications/initialized" })
    line({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "kimo_get_state", arguments: {} },
    })
    await until(() => sent.some((s) => JSON.parse(s.message).id === 2))
    expect(service.runtime.presence.list()[0]?.origin).toBe("mcp:codex.k3f9a2")
    // Approval prompts are broadcast to windows; an answer from a window resolves them.
    const prompts: { id: string }[] = []
    await net.bridge("editor-1").listen<{ id: string }>("kimo://mcp-approval-request", (r) => {
      prompts.push(r)
      void net
        .bridge("editor-1")
        .emitTo(HOST_LABEL, "kimo://mcp-approval-answer", { id: r.id, choice: "once" })
    })
    line({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "kimo_open", arguments: { path: ref } },
    })
    await until(() => sent.some((s) => JSON.parse(s.message).id === 3))
    const r3 = JSON.parse(sent.find((s) => JSON.parse(s.message).id === 3)?.message as string)
    expect(r3.result.structuredContent.ok).toBe(true)
    expect(prompts).toHaveLength(1)
    expect(sent.every((s) => !String(JSON.parse(s.message).method ?? "").startsWith("kimo/"))).toBe(
      true,
    )
    net.rustEmit(
      "kimo://mcp-connection",
      { connectionId: "c_k3f9a2", state: "closed", transport: "socket" },
      HOST_LABEL,
    )
    await until(() => service.runtime.presence.list().length === 0)
    expect(platform.control.readFile(ref)).toBe(fileText())
    await service.dispose()
  })
})

describe("Settings › Ask before destructive ops (D14)", () => {
  test("turning it off drops confirmDestructive for live and new connections; on restores it", async () => {
    const { net, service } = await startHost({}, true)
    const open = (id: string) =>
      net.rustEmit(
        "kimo://mcp-connection",
        {
          connectionId: id,
          state: "open",
          transport: "socket",
          hello: { client: "codex", pid: 1 },
        },
        HOST_LABEL,
      )
    open("c_one")
    await until(() => service.runtime.connections().length === 1)
    const policyOf = (i: number) => service.runtime.connections()[i]?.policy
    expect(policyOf(0)?.confirmDestructive).toBe(true)
    net.rustEmit("kimo://mcp-status", { askBeforeDestructive: false })
    await until(() => policyOf(0)?.confirmDestructive === false)
    open("c_two")
    await until(() => service.runtime.connections().length === 2)
    expect(policyOf(1)?.confirmDestructive).toBe(false)
    net.rustEmit("kimo://mcp-status", { askBeforeDestructive: true })
    await until(() => service.runtime.connections().every((c) => c.policy.confirmDestructive))
    await service.dispose()
  })

  test("the host reads the saved setting on start", async () => {
    const platform = createMemoryPlatform({ pid: 7001, files: {} })
    const net = createMemoryBridgeNetwork()
    net.commands.set("kimo_mcp_send", () => {})
    net.commands.set("kimo_mcp_host_ready", () => {})
    net.commands.set("kimo_mcp_policies_get", () => ({}))
    net.commands.set("kimo_mcp_server_settings_get", () => ({
      startOnLaunch: true,
      askBeforeDestructive: false,
      httpPort: 7341,
    }))
    const service = await startDocumentHostService({
      platform,
      bridge: net.bridge(HOST_LABEL),
      version: "0.5.0-test",
      relay: true,
      validate: validateInput as never,
    })
    net.rustEmit(
      "kimo://mcp-connection",
      {
        connectionId: "c_x",
        state: "open",
        transport: "socket",
        hello: { client: "codex", pid: 1 },
      },
      HOST_LABEL,
    )
    await until(() => service.runtime.connections().length === 1)
    expect(service.runtime.connections()[0]?.policy.confirmDestructive).toBe(false)
    await service.dispose()
  })
})

describe("Settings › Updates › Restart to update (board 37 D10)", () => {
  test("a file open only in the document host is saved before the restart", async () => {
    const { startHostRoute } = await import("../src/host")
    const { flushAllWindows } = await import("../src/updater/restart-broadcast")
    const ref = "/Users/me/site/agent-only.kimo"
    const platform = createMemoryPlatform({
      pid: 7001,
      files: { [ref]: fileText() },
      settings: { "files.autosave": false },
    })
    const net = createMemoryBridgeNetwork()
    net.commands.set("kimo_mcp_policies_get", () => ({}))
    const service = await startHostRoute(platform, net.bridge(HOST_LABEL))
    // An agent opened it: no editor window shows it.
    const session = await service.manager.open(ref)
    session.store.apply(
      { op: "update", id: "Frame00001", set: { name: "Agent title" } },
      { origin: "user" },
    )
    expect(platform.control.readFile(ref)).not.toContain("Agent title")
    expect(await flushAllWindows()).toBe(0)
    expect(platform.control.readFile(ref)).toContain("Agent title")
  })
})
