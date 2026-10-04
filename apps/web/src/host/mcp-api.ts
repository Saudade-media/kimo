/**
 * The editor window's `McpHostApi` on desktop (ADR 0013 §11): Rust commands for the relay
 * (status, server lifecycle, HTTP, tokens, policies, activity files, installer config files),
 * the document host for what lives in the MCP runtime (connections with their running call,
 * approval prompts, pause / resume, per-call undo) and the `kimo://mcp-*` events both emit.
 *
 * Events only carry changes, so the window seeds connections, pending prompts and paused
 * clients from the host's `mcpState` RPC and re-seeds when the host restarts.
 */
import {
  configPath,
  HOST_INFO,
  type HostOs,
  status as installerStatus,
  type Launcher,
  planEdit,
} from "@kimo/mcp-server/installer"
import type {
  HostOS,
  McpActivityEntry,
  McpApprovalOutcome,
  McpApprovalRequest,
  McpClientPolicy,
  McpConnectionInfo,
  McpHostApi,
  McpHostConfigStatus,
  McpHostId,
  McpServerSettings,
  McpServerStatus,
  TauriMcpEventMap,
} from "@kimo/platform"
import { HOST_EVENTS, HOST_LABEL, type HostBridge } from "./bridge"
import type { HostClient } from "./client"

type L<T extends unknown[]> = (...a: T) => void

interface HostMcpState {
  connections: McpConnectionInfo[]
  pending: McpApprovalRequest[]
  paused: string[]
}

export interface DesktopMcpHostOptions {
  bridge: HostBridge
  /** The window's document host client (null: relay-only, no prompts / pause / undo). */
  client: HostClient | null
  os: HostOS
}

const hostOs = (os: HostOS): HostOs =>
  os === "windows" ? "windows" : os === "linux" ? "linux" : "macos"

function set<T extends unknown[]>(s: Set<L<T>>, l: L<T>): () => void {
  s.add(l)
  return () => {
    s.delete(l)
  }
}

/** Creates the window's `McpHostApi` and starts listening. `dispose` stops it. */
export async function createDesktopMcpHost(
  o: DesktopMcpHostOptions,
): Promise<McpHostApi & { dispose(): void }> {
  const { bridge, client } = o
  const invoke = <T>(cmd: string, args: Record<string, unknown> = {}) => bridge.invoke<T>(cmd, args)
  const offs: (() => void)[] = []
  const statusL = new Set<L<[McpServerStatus]>>()
  const connL = new Set<L<[McpConnectionInfo[]]>>()
  const reqL = new Set<L<[McpApprovalRequest]>>()
  const resL = new Set<L<[string, McpApprovalOutcome]>>()
  const actL = new Set<L<[string, McpActivityEntry]>>()
  let connections: McpConnectionInfo[] | null = null
  let pending: McpApprovalRequest[] = []
  let paused: string[] = []
  let lastStatus: McpServerStatus | null = null

  const setConnections = (c: McpConnectionInfo[]) => {
    connections = c
    for (const l of [...connL]) l(c)
  }
  const addRequest = (r: McpApprovalRequest) => {
    if (pending.some((p) => p.id === r.id)) return
    pending = [...pending, r].sort((a, b) => a.requestedAt - b.requestedAt)
    for (const l of [...reqL]) l(r)
  }
  const seed = async () => {
    if (!client) return
    const s = await client.call<HostMcpState>("mcpState", {}, 5000).catch(() => null)
    if (!s) return
    paused = s.paused
    setConnections(s.connections)
    const live = new Set(s.pending.map((r) => r.id))
    for (const r of pending.filter((p) => !live.has(p.id))) {
      pending = pending.filter((p) => p.id !== r.id)
      for (const l of [...resL]) l(r.id, "disconnected")
    }
    for (const r of s.pending) addRequest(r)
  }

  offs.push(
    await bridge.listen<McpServerStatus>("kimo://mcp-status", (s) => {
      lastStatus = s
      for (const l of [...statusL]) l(s)
    }),
    await bridge.listen<TauriMcpEventMap["kimo://mcp-connections"]>(
      "kimo://mcp-connections",
      (c) => {
        paused = [...new Set(c.filter((x) => x.paused).map((x) => x.identity.client))]
        setConnections(c)
      },
    ),
    await bridge.listen<McpApprovalRequest>("kimo://mcp-approval-request", addRequest),
    await bridge.listen<TauriMcpEventMap["kimo://mcp-approval-resolved"]>(
      "kimo://mcp-approval-resolved",
      ({ id, outcome }) => {
        if (!pending.some((p) => p.id === id)) return
        pending = pending.filter((p) => p.id !== id)
        for (const l of [...resL]) l(id, outcome)
      },
    ),
    await bridge.listen<TauriMcpEventMap["kimo://mcp-activity"]>(
      "kimo://mcp-activity",
      ({ fileId, entry }) => {
        for (const l of [...actL]) l(fileId, entry)
      },
    ),
    await bridge.listen(HOST_EVENTS.ready, () => void seed()),
  )
  await seed()

  const status = async () => {
    lastStatus = await invoke<McpServerStatus>("kimo_mcp_status")
    return lastStatus
  }
  const ctxFor = async (scope: "user" | "project", project?: string) => {
    const s = lastStatus ?? (await status())
    const home = s.home ?? ""
    return {
      ctx: { home, os: hostOs(o.os), scope, ...(project ? { project } : {}) },
      launcher: { kind: "shim", command: s.shimPath } satisfies Launcher as Launcher,
      backupDir: s.backupDir ?? `${home}/.kimo/mcp/backups`,
    }
  }
  const read = (path: string) => invoke<string | null>("kimo_mcp_config_read", { path })
  const hostStatus = async (
    host: McpHostId,
    scope: "user" | "project",
    project?: string,
  ): Promise<McpHostConfigStatus> => {
    const { ctx, launcher } = await ctxFor(scope, project)
    const path = configPath(host, scope, ctx)
    let text: string | null = null
    let error: string | undefined
    try {
      text = await read(path)
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
    const st = installerStatus(host, launcher, ctx, {
      read: () => text,
      writeAtomic: () => undefined,
      now: Date.now,
    })
    return error ? { ...st, error } : st
  }
  const applyEdit = async (
    host: McpHostId,
    install: boolean,
    scope: "user" | "project",
    project?: string,
  ): Promise<McpHostConfigStatus> => {
    const { ctx, launcher, backupDir } = await ctxFor(scope, project)
    const path = configPath(host, scope, ctx)
    const before = await read(path)
    const plan = planEdit(host, path, before, install ? launcher : null)
    if (!plan.ok) throw new Error(plan.message)
    if (plan.changed && plan.after !== null) {
      if (before !== null)
        await invoke("kimo_mcp_config_write", {
          path: `${backupDir}/${host}-${Date.now()}.bak`,
          text: before,
        })
      // Compare-and-swap by re-reading right before the write (the Rust write is atomic).
      const now = await read(path)
      if (now !== before) return applyEdit(host, install, scope, project)
      await invoke("kimo_mcp_config_write", { path, text: plan.after })
    }
    return hostStatus(host, scope, project)
  }
  const order = Object.keys(HOST_INFO) as McpHostId[]

  return {
    status,
    onStatus: (l) => set(statusL, l),
    async connections() {
      if (connections) return connections
      return invoke<McpConnectionInfo[]>("kimo_mcp_connections")
    },
    onConnections: (l) => set(connL, l),
    async disconnect(connectionId) {
      await invoke("kimo_mcp_disconnect", { connectionId })
    },
    approvals: {
      pending: () => [...pending],
      onRequest: (l) => set(reqL, l),
      onResolved: (l) => set(resL, l),
      async respond(id, choice) {
        await bridge.emitTo(HOST_LABEL, "kimo://mcp-approval-answer", { id, choice })
      },
    },
    activity: {
      list: (fileId, limit = 500) =>
        invoke<McpActivityEntry[]>("kimo_mcp_activity_read", { fileId, limit }),
      onEntry: (l) => set(actL, l),
    },
    policies: {
      list: () => invoke<Record<string, McpClientPolicy>>("kimo_mcp_policies_get"),
      async set(client, policy) {
        await invoke("kimo_mcp_policies_set", { client, policy })
      },
    },
    http: {
      setEnabled: (enabled) => invoke<McpServerStatus>("kimo_mcp_http_set_enabled", { enabled }),
      rotateToken: (client) => invoke<string>("kimo_mcp_http_token_rotate", { client }),
    },
    server: {
      start: () => invoke<McpServerStatus>("kimo_mcp_server_start"),
      stop: () => invoke<McpServerStatus>("kimo_mcp_server_stop"),
      restart: () => invoke<McpServerStatus>("kimo_mcp_server_restart"),
      settings: () => invoke<McpServerSettings>("kimo_mcp_server_settings_get"),
      setStartOnLaunch: (startOnLaunch) =>
        invoke<McpServerSettings>("kimo_mcp_server_settings_set", { startOnLaunch }),
      setPort: (httpPort) =>
        invoke<McpServerSettings>("kimo_mcp_server_settings_set", { httpPort }),
      isPortFree: (port) => invoke<boolean>("kimo_mcp_port_check", { port }),
      token: (client) => invoke<string | null>("kimo_mcp_http_token_get", { client }),
      log: () => invoke<{ path: string; lastError?: string }>("kimo_mcp_log_info"),
      async revealLog() {
        await invoke("kimo_mcp_log_reveal")
      },
    },
    clients: {
      async pause(client) {
        if (!client) return
        const r = await requireClient().call<{ paused: string[] }>("mcpPause", {
          client,
          paused: true,
        })
        paused = r.paused
      },
      async resume(client) {
        const r = await requireClient().call<{ paused: string[] }>("mcpPause", {
          client,
          paused: false,
        })
        paused = r.paused
      },
      async paused() {
        return [...paused]
      },
    },
    history: {
      async undo(path, origin, undoToken) {
        if (!client) return { ok: false, stale: false }
        return client.agentUndo(path, origin, undoToken)
      },
    },
    installer: {
      status: (scope, project) => Promise.all(order.map((h) => hostStatus(h, scope, project))),
      async preview(host, action, scope, project) {
        const { ctx, launcher } = await ctxFor(scope, project)
        const path = configPath(host, scope, ctx)
        const before = await read(path)
        const plan = planEdit(host, path, before, action === "install" ? launcher : null)
        if (!plan.ok) return { path, before, after: null, error: plan.message }
        return { path, before, after: plan.after }
      },
      install: (host, scope, project) => applyEdit(host, true, scope, project),
      remove: (host, scope, project) => applyEdit(host, false, scope, project),
    },
    dispose() {
      for (const off of offs.splice(0)) off()
    },
  }

  function requireClient(): HostClient {
    if (!client) throw new Error("The document host is not running.")
    return client
  }
}
