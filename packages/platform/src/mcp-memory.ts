/**
 * `createMemoryMcpHost()`: the memory platform's scripted `McpHostApi` (tests, the e2e
 * harnesses). Every call the UI makes is recorded in `calls`; `control` drives the server side:
 * status, connections, approval prompts, activity, installer rows.
 */
import type {
  McpActivityEntry,
  McpApprovalChoice,
  McpApprovalOutcome,
  McpApprovalRequest,
  McpClientPolicy,
  McpConnectionInfo,
  McpHistoryResult,
  McpHostApi,
  McpHostConfigStatus,
  McpHostId,
  McpServerSettings,
  McpServerStatus,
} from "./mcp"

type L<T extends unknown[]> = (...a: T) => void

export interface MemoryMcpHost extends McpHostApi {
  calls: string[]
  control: {
    setStatus(s: Partial<McpServerStatus>): void
    setConnections(c: McpConnectionInfo[]): void
    updateConnection(id: string, patch: Partial<McpConnectionInfo>): void
    request(r: McpApprovalRequest): void
    resolve(id: string, outcome: McpApprovalOutcome): void
    append(fileId: string, e: Omit<McpActivityEntry, "seq"> & { seq?: number }): McpActivityEntry
    setHosts(h: McpHostConfigStatus[]): void
    readonly policies: Record<string, McpClientPolicy>
    /** Answers `history.undo` (default ok). */
    setUndo(fn: (path: string, origin: string, token?: string) => McpHistoryResult): void
    /** Answers `history.redo` (default ok). */
    setRedo(fn: (path: string, origin: string, token?: string) => McpHistoryResult): void
    /** Ports `server.isPortFree` reports as taken. */
    readonly busyPorts: Set<number>
  }
}

export const SAMPLE_MCP_STATUS: McpServerStatus = {
  socket: { path: "/Users/me/Library/Application Support/Kimo/mcp.sock", listening: true },
  http: { enabled: true, url: "http://127.0.0.1:7341/mcp", port: 7341 },
  documentHost: "ready",
  shimPath: "/Applications/Kimo.app/Contents/MacOS/kimo-mcp",
  protocol: "2025-06-18",
  connections: 0,
  running: true,
  version: "0.5.0",
  startOnLaunch: true,
  askBeforeDestructive: true,
  httpPort: 7341,
  logPath: "/Users/me/.kimo/mcp/server.log",
  home: "/Users/me",
  backupDir: "/Users/me/.kimo/mcp/backups",
  error: null,
}

export function createMemoryMcpHost(
  seed: {
    status?: Partial<McpServerStatus>
    connections?: McpConnectionInfo[]
    policies?: Record<string, McpClientPolicy>
    hosts?: McpHostConfigStatus[]
    activity?: Record<string, McpActivityEntry[]>
  } = {},
): MemoryMcpHost {
  const calls: string[] = []
  let status: McpServerStatus = { ...SAMPLE_MCP_STATUS, ...seed.status }
  let connections: McpConnectionInfo[] = seed.connections ?? []
  status = { ...status, connections: connections.length }
  const policies: Record<string, McpClientPolicy> = { ...seed.policies }
  let hosts: McpHostConfigStatus[] = seed.hosts ?? []
  const activity = new Map<string, McpActivityEntry[]>(Object.entries(seed.activity ?? {}))
  let seq = Math.max(0, ...[...activity.values()].flat().map((e) => e.seq))
  let pending: McpApprovalRequest[] = []
  const paused = new Set<string>()
  const tokens = new Map<string, string>()
  const busyPorts = new Set<number>()
  let undo = (_p: string, _o: string, _t?: string): McpHistoryResult => ({ ok: true, stale: false })
  let redo = (_p: string, _o: string, _t?: string): McpHistoryResult => ({ ok: true, stale: false })
  const settings = (): McpServerSettings => ({
    startOnLaunch: status.startOnLaunch ?? true,
    askBeforeDestructive: status.askBeforeDestructive ?? true,
    httpPort: status.httpPort ?? status.http.port ?? 7341,
  })
  const statusL = new Set<L<[McpServerStatus]>>()
  const connL = new Set<L<[McpConnectionInfo[]]>>()
  const reqL = new Set<L<[McpApprovalRequest]>>()
  const resL = new Set<L<[string, McpApprovalOutcome]>>()
  const actL = new Set<L<[string, McpActivityEntry]>>()
  const policyL = new Set<L<[string, McpClientPolicy | null]>>()
  const sub = <T extends unknown[]>(set: Set<L<T>>, l: L<T>) => {
    set.add(l)
    return () => {
      set.delete(l)
    }
  }
  const emitStatus = () => {
    for (const l of statusL) l(status)
  }
  const emitConnections = () => {
    connections = connections.map((c) =>
      paused.has(c.identity.client) ? { ...c, paused: true } : { ...c, paused: false },
    )
    status = { ...status, connections: connections.length }
    for (const l of connL) l(connections)
    emitStatus()
  }
  const resolve = (id: string, outcome: McpApprovalOutcome) => {
    if (!pending.some((r) => r.id === id)) return
    pending = pending.filter((r) => r.id !== id)
    for (const l of resL) l(id, outcome)
  }
  const autoApproving = (client: string) => {
    const p = policies[client]
    return p?.autoApprove === true && p.onExceed === "ask"
  }
  const setHost = (host: McpHostId, patch: Partial<McpHostConfigStatus>) => {
    hosts = hosts.map((h) => (h.host === host ? { ...h, ...patch } : h))
    const row = hosts.find((h) => h.host === host)
    if (!row) throw new Error(`unknown host ${host}`)
    return row
  }

  const setRunning = (running: boolean) => {
    status = {
      ...status,
      running,
      socket: { ...status.socket, listening: running },
      ...(running ? { error: null } : {}),
    }
    if (!running) {
      connections = []
      emitConnections()
    } else emitStatus()
    return status
  }

  const api: MemoryMcpHost = {
    calls,
    async status() {
      return status
    },
    onStatus: (l) => sub(statusL, l),
    async connections() {
      return connections
    },
    onConnections: (l) => sub(connL, l),
    async disconnect(connectionId) {
      calls.push(`disconnect ${connectionId}`)
      connections = connections.filter((c) => c.connectionId !== connectionId)
      emitConnections()
    },
    approvals: {
      pending: () => [...pending],
      onRequest: (l) => sub(reqL, l),
      onResolved: (l) => sub(resL, l),
      async respond(id: string, choice: McpApprovalChoice) {
        calls.push(`respond ${id} ${choice}`)
        resolve(id, choice)
      },
    },
    activity: {
      async list(fileId, limit = 500) {
        return (activity.get(fileId) ?? []).slice(-limit)
      },
      onEntry: (l) => sub(actL, l),
    },
    policies: {
      async list() {
        return { ...policies }
      },
      async set(client, policy) {
        calls.push(`policy ${client} ${policy ? JSON.stringify(policy) : "null"}`)
        if (policy) policies[client] = policy
        else delete policies[client]
        for (const l of [...policyL]) l(client, policy)
        // Board 34: turning auto-approve on approves that client's waiting prompts.
        if (autoApproving(client))
          for (const r of pending.filter((x) => x.client.client === client)) resolve(r.id, "auto")
      },
      onChange: (l) => sub(policyL, l),
    },
    http: {
      async setEnabled(enabled) {
        calls.push(`http ${enabled}`)
        status = {
          ...status,
          http: enabled
            ? {
                enabled: true,
                url: `http://127.0.0.1:${status.http.port ?? 7341}/mcp`,
                port: status.http.port ?? 7341,
              }
            : { enabled: false, port: status.http.port },
        }
        emitStatus()
        return status
      },
      async rotateToken(client) {
        calls.push(`rotate ${client}`)
        const t = `kimo_pat_${Math.random().toString(36).slice(2, 14)}`
        tokens.set(client, t)
        return t
      },
    },
    server: {
      async start() {
        calls.push("server.start")
        return setRunning(true)
      },
      async stop() {
        calls.push("server.stop")
        return setRunning(false)
      },
      async restart() {
        calls.push("server.restart")
        setRunning(false)
        return setRunning(true)
      },
      async settings() {
        return settings()
      },
      async setStartOnLaunch(v) {
        calls.push(`server.startOnLaunch ${v}`)
        status = { ...status, startOnLaunch: v }
        emitStatus()
        return settings()
      },
      async setAskBeforeDestructive(v) {
        calls.push(`server.askBeforeDestructive ${v}`)
        status = { ...status, askBeforeDestructive: v }
        emitStatus()
        return settings()
      },
      async setPort(port) {
        calls.push(`server.port ${port}`)
        status = {
          ...status,
          httpPort: port,
          error: null,
          http: status.http.enabled
            ? { enabled: true, port, url: `http://127.0.0.1:${port}/mcp` }
            : status.http,
        }
        emitStatus()
        return settings()
      },
      async isPortFree(port) {
        return !busyPorts.has(port)
      },
      async token(client) {
        return tokens.get(client) ?? null
      },
      async log() {
        const lastError = status.error
          ? `error ${status.error.code}: ${status.error.message}`
          : undefined
        return { path: status.logPath ?? "", ...(lastError ? { lastError } : {}) }
      },
      async revealLog() {
        calls.push("server.revealLog")
      },
    },
    clients: {
      async pause(client) {
        calls.push(`pause ${client}`)
        paused.add(client)
        emitConnections()
      },
      async resume(client) {
        calls.push(`resume ${client}`)
        paused.delete(client)
        emitConnections()
      },
      async paused() {
        return [...paused]
      },
    },
    history: {
      async undo(path, origin, token) {
        calls.push(`undo ${origin}${token ? ` ${token}` : ""}`)
        return undo(path, origin, token)
      },
      async redo(path, origin, token) {
        calls.push(`redo ${origin}${token ? ` ${token}` : ""}`)
        return redo(path, origin, token)
      },
    },
    installer: {
      async status(scope) {
        calls.push(`installer.status ${scope}`)
        return hosts
      },
      async preview(host, action, scope) {
        calls.push(`installer.preview ${host} ${action} ${scope}`)
        const row = hosts.find((h) => h.host === host)
        const entry = `"kimo": { "type": "stdio", "command": "${status.shimPath}", "args": ["--client", "${host}"] }`
        return {
          path: row?.path ?? "",
          before: row?.configExists ? "{}\n" : null,
          after: action === "install" ? `{\n  ${entry}\n}\n` : "{}\n",
        }
      },
      async install(host, scope) {
        calls.push(`installer.install ${host} ${scope}`)
        return setHost(host, { installed: true, current: true, configExists: true })
      },
      async remove(host, scope) {
        calls.push(`installer.remove ${host} ${scope}`)
        return setHost(host, { installed: false, current: false })
      },
    },
    control: {
      setStatus(s) {
        status = { ...status, ...s }
        emitStatus()
      },
      setConnections(c) {
        connections = c
        emitConnections()
      },
      updateConnection(id, patch) {
        connections = connections.map((c) => (c.connectionId === id ? { ...c, ...patch } : c))
        emitConnections()
      },
      request(r) {
        // Board 34: a client with auto-approve never shows a prompt (the host's dispatch skips it).
        if (autoApproving(r.client.client)) {
          for (const l of resL) l(r.id, "auto")
          return
        }
        pending = [...pending, r]
        for (const l of reqL) l(r)
      },
      resolve,
      append(fileId, e) {
        const entry: McpActivityEntry = { ...e, seq: e.seq ?? ++seq }
        seq = Math.max(seq, entry.seq)
        const list = activity.get(fileId) ?? []
        list.push(entry)
        activity.set(fileId, list.slice(-500))
        for (const l of actL) l(fileId, entry)
        return entry
      },
      setHosts(h) {
        hosts = h
      },
      policies,
      setUndo(fn) {
        undo = fn
      },
      setRedo(fn) {
        redo = fn
      },
      busyPorts,
    },
  }
  return api
}
