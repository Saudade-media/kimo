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
  preview?: { inserted: number; updated: number; deleted: number; nodeIds: string[] }
  requestedAt: number
  expiresAt: number
}

export type McpApprovalChoice = "once" | "session" | "deny"
export type McpApprovalOutcome = McpApprovalChoice | "timeout" | "disconnected"

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
}

// --- API -----------------------------------------------------------------------------------------

/**
 * What the editor UI (and Settings › Agents) asks of the MCP host. Desktop: Tauri commands to
 * Rust + events from the document host; web: `UNSUPPORTED` except activity (IndexedDB);
 * memory: scripted for tests.
 */
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
  }
  http: {
    setEnabled(enabled: boolean): Promise<McpServerStatus>
    /** New bearer token for one host's HTTP entry (revokes the old one). */
    rotateToken(client: string): Promise<string>
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
  "kimo://mcp-activity": { fileId: string; entry: McpActivityEntry }
}

export type TauriMcpEvent = keyof TauriMcpEventMap
