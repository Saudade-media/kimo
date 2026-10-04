/**
 * The Kimo local socket protocol `kimo-socket/1` (ADR 0013 §7, docs/spec/socket.md; teardown
 * 9.2 "MCP sidecar on desktop", 11.5). Spoken between an MCP relay (the Rust `kimo-mcp` shim, or
 * `kimo mcp` in attach mode) and the desktop app, over:
 *
 * - macOS / Linux: Unix domain socket `~/.kimo/socket/kimo.sock` (dir 0700, socket 0600);
 * - Windows: named pipe `\\.\pipe\kimo-<username>` (ACL: current user only).
 *
 * Framing: newline-delimited JSON, UTF-8, one JSON-RPC 2.0 message per line, no embedded
 * newlines (JSON.stringify never emits them), at most {@link MAX_FRAME_BYTES} per line.
 *
 * Session:
 * 1. The client's first line MUST be the `kimo/hello` request ({@link HelloParams}); anything
 *    else closes the connection. The app (Rust) checks the protocol version and the token and
 *    answers {@link HelloResult} or an error ({@link SOCKET_ERRORS}).
 * 2. After hello, the stream carries **MCP JSON-RPC messages verbatim** in both directions
 *    (`initialize`, `tools/call`, notifications, …). The app routes them to the document host,
 *    which runs one MCP server session per connection. The relay holds no tool logic.
 * 3. Control messages use the reserved `kimo/` method prefix and are consumed by the relay or
 *    Rust, never forwarded to the agent host: `kimo/ping` (both directions, answered with `{}`),
 *    `kimo/bye` (notification, graceful close), `kimo/hostRestarting` (notification: the document
 *    host restarts; in-flight calls will fail with TIMEOUT retryable).
 * 4. Heartbeat: the app pings every `heartbeatMs`; a peer that misses {@link HEARTBEAT_MISSES}
 *    consecutive pings is disconnected. The relay also exits when its stdin closes or its parent
 *    pid disappears (checked every 2 s), which prevents zombie processes (`[gh pencil#21]`).
 */

export const SOCKET_PROTOCOL = "kimo-socket/1" as const
/** Versions the app accepts (newest first). */
export const SUPPORTED_SOCKET_PROTOCOLS: readonly string[] = [SOCKET_PROTOCOL]

/** 32 MiB: a few base64 renders at 4096 px fit. */
export const MAX_FRAME_BYTES = 32 * 1024 * 1024
export const HEARTBEAT_MS = 10_000
export const HEARTBEAT_MISSES = 3
/** Hello must arrive within this after connect. */
export const HELLO_TIMEOUT_MS = 5_000
/** The relay keeps reconnecting this long after the app went away (app restart, update). */
export const RECONNECT_WINDOW_MS = 30_000

export const HELLO_METHOD = "kimo/hello" as const
export const CONTROL_PREFIX = "kimo/" as const
export const CONTROL_METHODS = [
  "kimo/hello",
  "kimo/ping",
  "kimo/bye",
  "kimo/hostRestarting",
] as const
export type ControlMethod = (typeof CONTROL_METHODS)[number]

/** True when a JSON-RPC message is a Kimo control message (never forwarded to the agent host). */
export function isControlMessage(msg: unknown): boolean {
  return (
    typeof msg === "object" &&
    msg !== null &&
    typeof (msg as { method?: unknown }).method === "string" &&
    ((msg as { method: string }).method as string).startsWith(CONTROL_PREFIX)
  )
}

/** `kimo/hello` params (client → app). */
export interface HelloParams {
  protocol: string
  /** Contents of `~/.kimo/mcp/token` (32 random bytes, base64url), minted at app start. */
  token: string
  relay: { name: "kimo-mcp" | "kimo-cli"; version: string }
  /**
   * Client slug from the installer-written `--client <slug>` flag (e.g. `claude-code`). The MCP
   * `initialize.clientInfo.name` is used when absent. Identity → origin `mcp:<client>.<session>`.
   */
  client?: string
  /** Relay pid and its parent (the agent host) pid. */
  pid: number
  ppid: number
  /** Working directory of the agent host (helps the UI say "Claude Code in ~/repo"). */
  cwd?: string
}

export interface HelloResult {
  protocol: string
  app: { name: "kimo-desktop"; version: string; pid: number }
  /** Rust-assigned connection id; the document host mints the origin session from it. */
  connectionId: string
  heartbeatMs: number
  /** `starting`: the hidden document host is still loading; MCP requests are queued ≤ 15 s. */
  documentHost: "ready" | "starting"
}

/** JSON-RPC error codes on the socket (−32000…−32099 server range). */
export const SOCKET_ERRORS = {
  /** data: { supported: string[] } */
  PROTOCOL_MISMATCH: -32001,
  UNAUTHORIZED: -32002,
  /** The document host failed to start; data: { message } */
  HOST_UNAVAILABLE: -32003,
  /** Hello missing, late or duplicated. */
  HANDSHAKE_REQUIRED: -32004,
  FRAME_TOO_LARGE: -32005,
} as const

/**
 * Error code a relay uses for agent-host requests it cannot deliver (app gone, reconnect window
 * over): a JSON-RPC error whose `data` carries the Kimo code so agents see a structured cause.
 */
export const RELAY_UNAVAILABLE = -32010
export interface RelayErrorData {
  kimoCode: "APP_NOT_RUNNING" | "TIMEOUT" | "PROTOCOL_MISMATCH"
  retryable: boolean
  suggestion: string
}

export type JsonRpcId = string | number
export interface JsonRpcRequest {
  jsonrpc: "2.0"
  id: JsonRpcId
  method: string
  params?: unknown
}
export interface JsonRpcNotification {
  jsonrpc: "2.0"
  method: string
  params?: unknown
}
export interface JsonRpcResponse {
  jsonrpc: "2.0"
  id: JsonRpcId | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}
export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse

/** Validates hello params; returns an error response payload or null when acceptable. */
export function checkHello(
  params: unknown,
  expectedToken: string,
): { code: number; message: string; data?: unknown } | null {
  const p = params as Partial<HelloParams> | undefined
  if (!p || typeof p !== "object")
    return { code: SOCKET_ERRORS.HANDSHAKE_REQUIRED, message: "hello params missing" }
  if (typeof p.protocol !== "string" || !SUPPORTED_SOCKET_PROTOCOLS.includes(p.protocol))
    return {
      code: SOCKET_ERRORS.PROTOCOL_MISMATCH,
      message: `unsupported protocol ${String(p.protocol)}`,
      data: { supported: [...SUPPORTED_SOCKET_PROTOCOLS] },
    }
  if (typeof p.token !== "string" || !constantTimeEqual(p.token, expectedToken))
    return { code: SOCKET_ERRORS.UNAUTHORIZED, message: "bad token" }
  return null
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

/** Encodes one frame (JSON + `\n`). Throws when over {@link MAX_FRAME_BYTES}. */
export function encodeFrame(msg: JsonRpcMessage): string {
  const line = `${JSON.stringify(msg)}\n`
  if (byteLength(line) > MAX_FRAME_BYTES) throw new RangeError("frame too large")
  return line
}

/** Incremental newline-delimited decoder. Feed text chunks; get complete messages. */
export class FrameDecoder {
  private buffer = ""
  /** Returns parsed messages, and `errors` for lines that are not JSON (connection should close). */
  push(chunk: string): { messages: JsonRpcMessage[]; errors: string[] } {
    this.buffer += chunk
    const messages: JsonRpcMessage[] = []
    const errors: string[] = []
    let nl = this.buffer.indexOf("\n")
    while (nl >= 0) {
      const line = this.buffer.slice(0, nl).replace(/\r$/, "")
      this.buffer = this.buffer.slice(nl + 1)
      if (line.trim() !== "") {
        try {
          messages.push(JSON.parse(line) as JsonRpcMessage)
        } catch {
          errors.push(line.slice(0, 200))
        }
      }
      nl = this.buffer.indexOf("\n")
    }
    if (byteLength(this.buffer) > MAX_FRAME_BYTES) {
      this.buffer = ""
      errors.push("frame too large")
    }
    return { messages, errors }
  }
}

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length
}

// --- App ↔ document host relay (inside the desktop app, ADR 0002 §3) ----------------------------

/**
 * Rust forwards each post-hello socket line to the hidden document host as Tauri event
 * `kimo://mcp-in`, and the host answers through command `kimo_mcp_send`. HTTP requests are
 * forwarded whole (`kimo://mcp-http-request`) and answered as a stream of chunks
 * (`kimo_mcp_http_respond`), so the host can use the SDK's web-standard Streamable HTTP
 * transport. Payload types live in `@kimo/platform` (`./mcp.ts`) and are checked equal to these
 * in apps/web/src/platform/contract.ts.
 */
export interface RelayConnection {
  connectionId: string
  transport: "socket" | "http"
  hello?: HelloParams
  openedAt: number
}
