/**
 * M5 host APIs for the MCP server (ADR 0013 §7, §9, §11): the editor UI and the document host
 * use these to see the server status and connected agents, answer approval prompts, read the
 * activity log, set per-client policies and install Kimo into agent hosts.
 *
 * `@kimo/platform` depends on nothing, so the shapes shared with `@kimo/mcp-server`
 * (`ClientPolicy`, `ApprovalRequest`, `ActivityEntry`, `HostStatus`, `RelayConnection`) are
 * structural mirrors; apps/web/src/platform/contract.ts asserts they stay equal at compile time.
 *
 * Tauri commands and events for this surface are kept OUT of `TAURI_COMMANDS` (whose Rust mirror
 * test is frozen by ADR 0012) and listed in {@link TAURI_MCP_COMMANDS}; the desktop shell adds a
 * matching `command_list_mcp.rs` mirror test when it implements them.
 */
import type { Unsubscribe } from "./types"

// --- Mirrors of @kimo/mcp-server types -----------------------------------------------------------

export type McpPermissionLevel = "read" | "edit" | "edit+delete"
export type McpGrant = "globals" | "components" | "save" | "export" | "files.create"

export interface McpClientPolicy {
  level: McpPermissionLevel
  files: string[]
  nodes: string[]
  grants: McpGrant[]
  onExceed: "ask" | "deny"
  confirmDestructive: boolean
  /** Board 34: approvals this policy would ask for are approved at once (outcome `auto`). */
  autoApprove?: boolean
}

export interface McpClientIdentity {
  client: string
  label: string
  version?: string
  session: string
  transport: "socket" | "http" | "stdio-headless" | "in-process"
  pid?: number
}

export type McpApprovalReason =
  | { kind: "destructive"; ops: string[]; nodeIds: string[] }
  | { kind: "level"; need: "read" | "edit" | "delete"; have: McpPermissionLevel }
  | { kind: "file"; path: string; action: "open" | "create" | "export" | "save" }
  | { kind: "grant"; grant: McpGrant }
  | { kind: "scope"; nodeIds: string[] }

export interface McpApprovalRequest {
  id: string
  client: McpClientIdentity
  tool: string
  path?: string
  reason: McpApprovalReason
  summary: string
  preview?: McpApprovalPreview
  requestedAt: number
  expiresAt: number
}

/** What a node would undergo if the call ran (dry run; moves count as updates). */
export type McpPreviewOpKind = "insert" | "update" | "delete"

/** Dry-run preview of an approval (counts, the first changed ids, the op kind per id). */
export interface McpApprovalPreview {
  inserted: number
  updated: number
  deleted: number
  nodeIds: string[]
  /** Op kind per entry of `nodeIds` (M5 addendum; absent from older hosts). */
  kinds?: Record<string, McpPreviewOpKind>
}

export type McpApprovalChoice = "once" | "session" | "deny"
/** `auto`: approved by auto-approve (board 34), nobody was asked. */
export type McpApprovalOutcome = McpApprovalChoice | "auto" | "timeout" | "disconnected"

export type McpActivityKind =
  | "connected"
  | "disconnected"
  | "read"
  | "edit"
  | "dry-run"
  | "undo"
  | "redo"
  | "save"
  | "export"
  | "render"
  | "open"
  | "close"
  | "approval"
  | "denied"
  | "error"
  /** Board 38: a web search or page read (no document change). */
  | "web"

export interface McpActivityEntry {
  seq: number
  time: number
  origin: string
  actor: string
  kind: McpActivityKind
  tool?: string
  summary: string
  revision?: { epoch: string; seq: number }
  nodeIds?: string[]
  code?: string
  outcome?: McpApprovalOutcome
  undoToken?: string
  /** Op group label ("Insert Card", "Import svg"); edits only. */
  label?: string
  /** Number of resolved ops the call committed (edits / dry runs). */
  opCount?: number
  /** Revision before the call, for edits (with `revision` = after). */
  revisionBefore?: { epoch: string; seq: number }
  /** Board 38 `web`: the query or the URL (the row's target line). */
  detail?: string
}

export type McpHostId = "claude-code" | "codex" | "gemini-cli" | "cursor" | "vscode"

export interface McpHostConfigStatus {
  host: McpHostId
  label: string
  /** Generic icon only, never a vendor logo (lead decision). */
  icon: "terminal" | "editor"
  scope: "user" | "project"
  path: string
  configExists: boolean
  installed: boolean
  current: boolean
  entry?: unknown
  error?: string
}

// --- Status --------------------------------------------------------------------------------------

export interface McpServerStatus {
  /** Socket path or pipe name, and whether it accepts connections. */
  socket: { path: string; listening: boolean }
  http: { enabled: boolean; url?: string; port?: number }
  /** The hidden document host (ADR 0002 / 0012 §2). */
  documentHost: "starting" | "ready" | "restarting" | "failed"
  /** Absolute path of the bundled `kimo-mcp` shim (installer default). */
  shimPath: string
  protocol: string
  connections: number
  /** The socket/pipe listener runs (false after Settings › Stop). M5 addendum fields below. */
  running?: boolean
  /** App version serving MCP ("0.5.0"). */
  version?: string
  /** Settings › "Start server when Kimo opens". */
  startOnLaunch?: boolean
  /**
   * Settings › "Ask before destructive or out-of-scope ops" (default on). Off: destructive edits
   * never wait for approval, whatever a client's own `confirmDestructive` says.
   */
  askBeforeDestructive?: boolean
  /** Configured HTTP port (the listener may have fallen back, see `error`). */
  httpPort?: number
  /** `~/.kimo/mcp/server.log`. */
  logPath?: string
  /** The user's home directory (installer user scope). */
  home?: string
  /** `~/.kimo/mcp/backups` (installer backups before each config write). */
  backupDir?: string
  /** Last start failure (cleared on a successful start). */
  error?: McpServerError | null
}

/** A server start failure (Settings › Agents error banner + port fix row). */
export interface McpServerError {
  /** "EADDRINUSE 127.0.0.1:47820", "ENDPOINT_IN_USE", "SOCKET_FAILED", … */
  code: string
  message: string
  /** The port that failed and a free one to switch to. */
  port?: number
  suggestedPort?: number
  time: number
}

/** Persisted server settings (`~/.kimo/mcp/server.json`, `http.json`). */
export interface McpServerSettings {
  startOnLaunch: boolean
  askBeforeDestructive: boolean
  httpPort: number
}

/** The call a connection is running right now. */
export interface McpCallInfo {
  tool: string
  /** "Applying 4 ops", "Rendering Card", the op group label when given. */
  label: string
  startedAt: number
}

export interface McpConnectionInfo {
  connectionId: string
  identity: McpClientIdentity
  origin: string
  cwd?: string
  connectedAt: number
  lastActivityAt: number
  state: "idle" | "reading" | "editing" | "rendering" | "waiting-approval"
  /** docIds this connection touched. */
  docs: string[]
  /** The running call (absent when idle). M5 addendum. */
  call?: McpCallInfo
  /** Nodes it is editing or last changed (canvas focus / agent cursor). */
  focus?: string[]
  /** Board 31 "Agent cursor": the last layer its latest landed edit added (or changed). */
  pointer?: string
  /** Paused by the user (Settings / session popover): its calls wait until resumed. */
  paused?: boolean
}

// --- API -----------------------------------------------------------------------------------------

/**
 * What the editor UI (and Settings › Agents) asks of the MCP host. Desktop: Tauri commands to
 * Rust + events from the document host; web: `UNSUPPORTED` except activity (IndexedDB);
 * memory: scripted for tests.
 */
/** Result of an agent undo / redo from the activity log. */
export interface McpHistoryResult {
  ok: boolean
  /** The group no longer had any effect (later edits changed the same layers). */
  stale: boolean
  /**
   * Refused because the group is not on top of the origin's undo (or redo) stack: newer edits
   * of the same agent come first. The group is still there; nothing changed.
   */
  conflict?: boolean
  /** The history's refusal, when it answered (absent: no live connection of that origin). */
  message?: string
}

export interface McpHostApi {
  status(): Promise<McpServerStatus>
  onStatus(listener: (s: McpServerStatus) => void): Unsubscribe
  connections(): Promise<McpConnectionInfo[]>
  onConnections(listener: (c: McpConnectionInfo[]) => void): Unsubscribe
  disconnect(connectionId: string): Promise<void>
  approvals: {
    /** Prompts not answered yet (oldest first). */
    pending(): McpApprovalRequest[]
    onRequest(listener: (r: McpApprovalRequest) => void): Unsubscribe
    /** Fires when a prompt resolves anywhere (answered in another window, timed out). */
    onResolved(listener: (id: string, outcome: McpApprovalOutcome) => void): Unsubscribe
    respond(id: string, choice: McpApprovalChoice): Promise<void>
  }
  activity: {
    /** Newest last; at most 500 per file (`~/.kimo/activity/<fileId>.jsonl`, IndexedDB on web). */
    list(fileId: string, limit?: number): Promise<McpActivityEntry[]>
    onEntry(listener: (fileId: string, e: McpActivityEntry) => void): Unsubscribe
  }
  policies: {
    list(): Promise<Record<string, McpClientPolicy>>
    set(client: string, policy: McpClientPolicy | null): Promise<void>
    /** A policy changed in any window (board 34: presence shows auto-approve at once). */
    onChange?(listener: (client: string, policy: McpClientPolicy | null) => void): Unsubscribe
  }
  http: {
    setEnabled(enabled: boolean): Promise<McpServerStatus>
    /** New bearer token for one host's HTTP entry (revokes the old one). */
    rotateToken(client: string): Promise<string>
  }
  /** Server lifecycle and settings (Settings › Agents & MCP). */
  server: {
    start(): Promise<McpServerStatus>
    stop(): Promise<McpServerStatus>
    restart(): Promise<McpServerStatus>
    settings(): Promise<McpServerSettings>
    setStartOnLaunch(enabled: boolean): Promise<McpServerSettings>
    /** "Ask before destructive or out-of-scope ops" (the document host's approval gate). */
    setAskBeforeDestructive(enabled: boolean): Promise<McpServerSettings>
    /** Persists the HTTP port and moves a running listener there. */
    setPort(port: number): Promise<McpServerSettings>
    /** True when nothing listens on 127.0.0.1:`port` (or it is ours). */
    isPortFree(port: number): Promise<boolean>
    /** The current HTTP bearer of one host (null when it has none). */
    token(client: string): Promise<string | null>
    log(): Promise<{ path: string; lastError?: string }>
    revealLog(): Promise<void>
  }
  /** Per-client pause: every call of the client's connections waits until resumed. */
  clients: {
    pause(client: string): Promise<void>
    resume(client: string): Promise<void>
    paused(): Promise<string[]>
  }
  /**
   * Per-call undo for the window (`kimo_history` undo as that origin, guarded replay). With
   * `undoToken`, refuses (stale) when that group is no longer on top.
   */
  history: {
    undo(path: string, origin: string, undoToken?: string): Promise<McpHistoryResult>
    /**
     * Redo the origin's last undone group (`kimo_history` redo as that origin); absent: no Redo.
     * With `undoToken`, refuses (`conflict`) when that group is not the last one undone.
     */
    redo?(path: string, origin: string, undoToken?: string): Promise<McpHistoryResult>
  }
  installer: {
    status(scope: "user" | "project", project?: string): Promise<McpHostConfigStatus[]>
    /** Before/after text for the diff preview; never writes. */
    preview(
      host: McpHostId,
      action: "install" | "remove",
      scope: "user" | "project",
      project?: string,
    ): Promise<{ path: string; before: string | null; after: string | null; error?: string }>
    install(
      host: McpHostId,
      scope: "user" | "project",
      project?: string,
    ): Promise<McpHostConfigStatus>
    remove(
      host: McpHostId,
      scope: "user" | "project",
      project?: string,
    ): Promise<McpHostConfigStatus>
  }
}

// --- Tauri surface (desktop) ---------------------------------------------------------------------

/** One relayed HTTP request (Rust → document host). Body is base64. */
export interface McpHttpRequest {
  requestId: string
  method: string
  url: string
  headers: Record<string, string>
  bodyBase64: string
}

export interface TauriMcpCommandMap {
  kimo_mcp_status: { args: Record<string, never>; result: McpServerStatus }
  kimo_mcp_connections: { args: Record<string, never>; result: McpConnectionInfo[] }
  kimo_mcp_disconnect: { args: { connectionId: string }; result: null }
  /** Document host → Rust: one outbound line for a socket connection. */
  kimo_mcp_send: { args: { connectionId: string; message: string }; result: null }
  /** Document host → Rust: a chunk of an HTTP response (first chunk carries status + headers). */
  kimo_mcp_http_respond: {
    args: {
      requestId: string
      status?: number
      headers?: Record<string, string>
      chunkBase64?: string
      end: boolean
    }
    result: null
  }
  /** Document host announces it is ready (Rust stops queueing ≤ 15 s). */
  kimo_mcp_host_ready: { args: { version: string }; result: null }
  kimo_mcp_http_set_enabled: { args: { enabled: boolean }; result: McpServerStatus }
  kimo_mcp_http_token_rotate: { args: { client: string }; result: string }
  /** Reads an agent-host config file (restricted to installer paths). */
  kimo_mcp_config_read: { args: { path: string }; result: string | null }
  /** Atomic write of an agent-host config file or a backup under ~/.kimo/mcp/backups. */
  kimo_mcp_config_write: { args: { path: string; text: string }; result: null }
  kimo_mcp_activity_append: { args: { fileId: string; entry: McpActivityEntry }; result: null }
  kimo_mcp_activity_read: { args: { fileId: string; limit: number }; result: McpActivityEntry[] }
  kimo_mcp_policies_get: { args: Record<string, never>; result: Record<string, McpClientPolicy> }
  kimo_mcp_policies_set: { args: { client: string; policy: McpClientPolicy | null }; result: null }
  kimo_mcp_server_start: { args: Record<string, never>; result: McpServerStatus }
  kimo_mcp_server_stop: { args: Record<string, never>; result: McpServerStatus }
  kimo_mcp_server_restart: { args: Record<string, never>; result: McpServerStatus }
  kimo_mcp_server_settings_get: { args: Record<string, never>; result: McpServerSettings }
  kimo_mcp_server_settings_set: {
    args: { startOnLaunch?: boolean; askBeforeDestructive?: boolean; httpPort?: number }
    result: McpServerSettings
  }
  kimo_mcp_port_check: { args: { port: number }; result: boolean }
  kimo_mcp_http_token_get: { args: { client: string }; result: string | null }
  kimo_mcp_log_info: { args: Record<string, never>; result: { path: string; lastError?: string } }
  kimo_mcp_log_reveal: { args: Record<string, never>; result: null }
  /** Document host only: widen the fs scope to a path an MCP call was authorized for. */
  kimo_mcp_scope_allow: { args: { path: string }; result: null }
}

export type TauriMcpCommand = keyof TauriMcpCommandMap

export const TAURI_MCP_COMMANDS = [
  "kimo_mcp_status",
  "kimo_mcp_connections",
  "kimo_mcp_disconnect",
  "kimo_mcp_send",
  "kimo_mcp_http_respond",
  "kimo_mcp_host_ready",
  "kimo_mcp_http_set_enabled",
  "kimo_mcp_http_token_rotate",
  "kimo_mcp_config_read",
  "kimo_mcp_config_write",
  "kimo_mcp_activity_append",
  "kimo_mcp_activity_read",
  "kimo_mcp_policies_get",
  "kimo_mcp_policies_set",
  "kimo_mcp_server_start",
  "kimo_mcp_server_stop",
  "kimo_mcp_server_restart",
  "kimo_mcp_server_settings_get",
  "kimo_mcp_server_settings_set",
  "kimo_mcp_port_check",
  "kimo_mcp_http_token_get",
  "kimo_mcp_log_info",
  "kimo_mcp_log_reveal",
  "kimo_mcp_scope_allow",
] as const satisfies readonly TauriMcpCommand[]

export interface TauriMcpEventMap {
  /** Rust → document host: one inbound socket line after hello. */
  "kimo://mcp-in": { connectionId: string; message: string }
  /** Rust → document host: a connection opened (with its hello) or closed. */
  "kimo://mcp-connection": {
    connectionId: string
    state: "open" | "closed"
    transport: "socket" | "http"
    hello?: {
      client?: string
      pid: number
      ppid: number
      cwd?: string
      relay: { name: string; version: string }
    }
  }
  "kimo://mcp-http-request": McpHttpRequest
  "kimo://mcp-status": McpServerStatus
  /** Document host → windows (JS emit). */
  "kimo://mcp-connections": McpConnectionInfo[]
  "kimo://mcp-approval-request": McpApprovalRequest
  "kimo://mcp-approval-resolved": { id: string; outcome: McpApprovalOutcome }
  /** Window → document host. */
  "kimo://mcp-approval-answer": { id: string; choice: McpApprovalChoice }
  /** Window → every window and the document host: a client's policy changed (null = defaults). */
  "kimo://mcp-policy-changed": { client: string; policy: McpClientPolicy | null }
  "kimo://mcp-activity": { fileId: string; entry: McpActivityEntry }
}

export type TauriMcpEvent = keyof TauriMcpEventMap
