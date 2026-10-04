/**
 * Attach mode of `kimo mcp` (ADR 0013 §7–8, docs/spec/socket.md): the same relay as the Rust
 * `kimo-mcp` shim, in TypeScript. stdio (agent host) ⇄ `kimo-socket/1` (desktop app).
 *
 * - Handshake: `kimo/hello` with the token from `~/.kimo/mcp/token`; then MCP lines verbatim.
 * - `kimo/*` control messages are consumed here and never reach the agent host (`kimo/ping` is
 *   answered with `{}`, `kimo/bye` closes, `kimo/hostRestarting` is logged).
 * - Disconnect: requests in flight fail with −32010 `{kimoCode:"TIMEOUT", retryable:true}`; the
 *   relay reconnects for up to 30 s, replays the cached `initialize` / `initialized` and swallows
 *   the duplicate `initialize` response. Requests sent while reconnecting are queued; after the
 *   window they fail with APP_NOT_RUNNING while the relay keeps probing every 2 s.
 * - Exits on stdin EOF or when the parent process disappears (checked every 2 s).
 */
import { existsSync, readFileSync } from "node:fs"
import { connect, type Socket } from "node:net"
import { join } from "node:path"
import type { Readable, Writable } from "node:stream"
import {
  type EndpointFile,
  encodeFrame,
  FrameDecoder,
  failure,
  HELLO_METHOD,
  HELLO_TIMEOUT_MS,
  type HelloParams,
  type HelloResult,
  isControlMessage,
  type JsonRpcId,
  type JsonRpcMessage,
  KIMO_PATHS,
  listTools,
  RECONNECT_WINDOW_MS,
  RELAY_UNAVAILABLE,
  type RelayErrorData,
  SOCKET_PROTOCOL,
  toCallToolResult,
  toMcpDescriptor,
} from "@kimo/mcp-server"
import { SERVER_INSTRUCTIONS, SERVER_NAME } from "@kimo/mcp-server/server"
import { pidAlive } from "./node-platform"

export const PARENT_POLL_MS = 2_000

export function readEndpoint(kimoHome: string): EndpointFile | null {
  try {
    const e = JSON.parse(readFileSync(join(kimoHome, KIMO_PATHS.endpoint), "utf8")) as EndpointFile
    return typeof e.socket === "string" && typeof e.pid === "number" ? e : null
  } catch {
    return null
  }
}

export function readToken(kimoHome: string): string | null {
  const p = join(kimoHome, KIMO_PATHS.token)
  if (!existsSync(p)) return null
  try {
    return readFileSync(p, "utf8").trim()
  } catch {
    return null
  }
}

export type HelloFailure = { code: number; message: string; data?: unknown }

export interface Connection {
  socket: Socket
  result: HelloResult
  decoder: FrameDecoder
  /** Messages that arrived in the same chunk as the hello response. */
  pending: JsonRpcMessage[]
}

/** Connects and performs the hello. Never throws: resolves to the connection or a failure. */
export function connectAndHello(
  kimoHome: string,
  hello: Omit<HelloParams, "token" | "protocol">,
  timeoutMs = HELLO_TIMEOUT_MS,
): Promise<{ ok: true; conn: Connection } | { ok: false; failure: HelloFailure }> {
  return new Promise((resolve) => {
    const endpoint = readEndpoint(kimoHome)
    const token = readToken(kimoHome)
    if (!endpoint || !token)
      return resolve({ ok: false, failure: { code: 0, message: "no endpoint or token" } })
    if (!pidAlive(endpoint.pid))
      return resolve({ ok: false, failure: { code: 0, message: "app pid not running" } })
    const socket = connect(endpoint.socket)
    const decoder = new FrameDecoder()
    let settled = false
    const finish = (r: { ok: true; conn: Connection } | { ok: false; failure: HelloFailure }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.removeAllListeners("data")
      socket.removeAllListeners("error")
      if (!r.ok) socket.destroy()
      resolve(r)
    }
    const timer = setTimeout(
      () => finish({ ok: false, failure: { code: 0, message: "hello timed out" } }),
      timeoutMs,
    )
    socket.setEncoding("utf8")
    socket.on("error", (e) => finish({ ok: false, failure: { code: 0, message: e.message } }))
    socket.on("close", () => finish({ ok: false, failure: { code: 0, message: "closed" } }))
    socket.on("connect", () => {
      const params: HelloParams = { protocol: SOCKET_PROTOCOL, token, ...hello }
      socket.write(encodeFrame({ jsonrpc: "2.0", id: "hello", method: HELLO_METHOD, params }))
    })
    socket.on("data", (chunk: string) => {
      const { messages, errors } = decoder.push(chunk)
      if (errors.length)
        return finish({ ok: false, failure: { code: 0, message: "bad frame from app" } })
      const [first, ...rest] = messages
      if (!first) return
      const r = first as { id?: JsonRpcId; result?: HelloResult; error?: HelloFailure }
      if (r.id !== "hello") return finish({ ok: false, failure: { code: 0, message: "no hello" } })
      if (r.error) return finish({ ok: false, failure: r.error })
      socket.removeAllListeners("close")
      finish({
        ok: true,
        conn: { socket, result: r.result as HelloResult, decoder, pending: rest },
      })
    })
  })
}

/** `appReachable` for `decideMode`: endpoint present, pid alive, hello accepted. */
export async function probeApp(
  kimoHome: string,
  hello: Omit<HelloParams, "token" | "protocol">,
): Promise<Connection | null> {
  const r = await connectAndHello(kimoHome, hello)
  return r.ok ? r.conn : null
}

export interface RelayOptions {
  kimoHome: string
  hello: Omit<HelloParams, "token" | "protocol">
  /** An already-established connection (from the probe), or null to connect now. */
  conn: Connection | null
  stdin?: Readable
  stdout?: Writable
  log?: (l: string) => void
  reconnectWindowMs?: number
  retryEveryMs?: number
  parentPollMs?: number
}

const isRequest = (m: JsonRpcMessage): m is JsonRpcMessage & { id: JsonRpcId; method: string } =>
  "method" in m && "id" in m && m.id !== undefined && m.id !== null
const isResponse = (m: JsonRpcMessage) => !("method" in m) && "id" in m

/** Runs the relay until stdin closes or the parent dies; resolves to the exit code. */
export function runRelay(o: RelayOptions): Promise<number> {
  const stdin = o.stdin ?? process.stdin
  const stdout = o.stdout ?? process.stdout
  const log = o.log ?? ((l: string) => process.stderr.write(`kimo mcp: ${l}\n`))
  const windowMs = o.reconnectWindowMs ?? RECONNECT_WINDOW_MS
  const retryMs = o.retryEveryMs ?? 500
  const toAgent = (m: JsonRpcMessage) => stdout.write(encodeFrame(m))

  let conn: Connection | null = null
  let state: "connected" | "reconnecting" | "down" = "down"
  let deadline = 0
  let closed = false
  const inFlight = new Set<JsonRpcId>()
  const queue: JsonRpcMessage[] = []
  let cachedInit: (JsonRpcMessage & { id: JsonRpcId }) | null = null
  let cachedInitialized: JsonRpcMessage | null = null
  const swallow = new Set<JsonRpcId>()
  let retryTimer: ReturnType<typeof setTimeout> | null = null

  const relayError = (id: JsonRpcId, data: RelayErrorData, message: string) =>
    toAgent({ jsonrpc: "2.0", id, error: { code: RELAY_UNAVAILABLE, message, data } })
  const unavailable = (id: JsonRpcId) =>
    relayError(
      id,
      {
        kimoCode: "APP_NOT_RUNNING",
        retryable: true,
        suggestion: "Start Kimo, or run kimo mcp --headless",
      },
      "The Kimo app is not reachable.",
    )

  const send = (m: JsonRpcMessage) => conn?.socket.write(encodeFrame(m))

  /**
   * While the app is down, answer like the shim does (spec §6): initialize and tools/list
   * locally, every tools/call as an APP_NOT_RUNNING envelope; other requests fail −32010.
   */
  const answerOffline = (m: JsonRpcMessage & { id: JsonRpcId; method: string }) => {
    const params = (m as { params?: { protocolVersion?: string } }).params
    switch (m.method) {
      case "initialize":
        return toAgent({
          jsonrpc: "2.0",
          id: m.id,
          result: {
            protocolVersion: params?.protocolVersion ?? "2025-06-18",
            capabilities: { tools: { listChanged: false }, resources: {}, prompts: {} },
            serverInfo: { name: SERVER_NAME, version: o.hello.relay.version },
            instructions: SERVER_INSTRUCTIONS,
          },
        })
      case "ping":
        return toAgent({ jsonrpc: "2.0", id: m.id, result: {} })
      case "tools/list":
        return toAgent({
          jsonrpc: "2.0",
          id: m.id,
          result: { tools: listTools({ host: "desktop" }).map(toMcpDescriptor) },
        })
      case "resources/list":
        return toAgent({ jsonrpc: "2.0", id: m.id, result: { resources: [] } })
      case "prompts/list":
        return toAgent({ jsonrpc: "2.0", id: m.id, result: { prompts: [] } })
      case "tools/call":
        return toAgent({
          jsonrpc: "2.0",
          id: m.id,
          result: toCallToolResult(
            failure({
              code: "APP_NOT_RUNNING",
              message: "The Kimo app is not running.",
              retryable: true,
              suggestion: "Start Kimo, or run kimo mcp --headless",
            }),
          ),
        })
      default:
        return unavailable(m.id)
    }
  }

  const onAppMessage = (m: JsonRpcMessage) => {
    if (isControlMessage(m)) {
      const method = (m as { method: string }).method
      if (method === "kimo/ping" && isRequest(m)) send({ jsonrpc: "2.0", id: m.id, result: {} })
      else if (method === "kimo/bye") conn?.socket.end()
      else if (method === "kimo/hostRestarting") log("the Kimo document host is restarting")
      return
    }
    if (isResponse(m)) {
      const id = (m as { id: JsonRpcId }).id
      if (swallow.delete(id)) return
      inFlight.delete(id)
    }
    toAgent(m)
  }

  const attachConn = (c: Connection, replay: boolean) => {
    conn = c
    state = "connected"
    c.socket.setEncoding("utf8")
    c.socket.on("data", (chunk: string) => {
      const { messages, errors } = c.decoder.push(chunk)
      for (const m of messages) onAppMessage(m)
      if (errors.length) c.socket.destroy()
    })
    c.socket.on("close", () => onDisconnect(c))
    c.socket.on("error", () => {})
    if (replay && cachedInit) {
      const id = `kimo-replay-${Date.now().toString(36)}`
      swallow.add(id)
      send({ ...cachedInit, id })
      if (cachedInitialized) send(cachedInitialized)
    }
    for (const m of c.pending) onAppMessage(m)
    c.pending = []
    for (const m of queue.splice(0)) {
      if (isRequest(m)) inFlight.add(m.id)
      send(m)
    }
  }

  const onDisconnect = (c: Connection) => {
    if (conn !== c) return
    conn = null
    if (closed) return
    for (const id of inFlight)
      relayError(
        id,
        { kimoCode: "TIMEOUT", retryable: true, suggestion: "Retry once Kimo is back." },
        "The Kimo app disconnected while this request was in flight.",
      )
    inFlight.clear()
    log("disconnected from the Kimo app; reconnecting")
    state = "reconnecting"
    deadline = Date.now() + windowMs
    scheduleRetry(0)
  }

  const scheduleRetry = (ms: number) => {
    if (retryTimer || closed) return
    retryTimer = setTimeout(async () => {
      retryTimer = null
      if (closed || conn) return
      const r = await connectAndHello(o.kimoHome, o.hello)
      if (closed) {
        if (r.ok) r.conn.socket.destroy()
        return
      }
      if (r.ok) {
        log("reattached to the Kimo app")
        attachConn(r.conn, true)
        return
      }
      if (state === "reconnecting" && Date.now() >= deadline) {
        state = "down"
        for (const m of queue.splice(0)) if (isRequest(m)) answerOffline(m)
      }
      scheduleRetry(state === "down" ? PARENT_POLL_MS : retryMs)
    }, ms)
  }

  const onAgentMessage = (m: JsonRpcMessage) => {
    if (isRequest(m) && m.method === "initialize") cachedInit = m
    else if ("method" in m && m.method === "notifications/initialized") cachedInitialized = m
    if (state === "connected" && conn) {
      if (isRequest(m)) inFlight.add(m.id)
      send(m)
    } else if (state === "reconnecting") queue.push(m)
    else if (isRequest(m)) answerOffline(m)
  }

  return new Promise<number>((resolve) => {
    const decoder = new FrameDecoder()
    const ppid = process.ppid
    const parentTimer = setInterval(() => {
      if (process.ppid !== ppid || !pidAlive(ppid)) shutdown("parent process exited")
    }, o.parentPollMs ?? PARENT_POLL_MS)
    parentTimer.unref?.()
    const shutdown = (why: string) => {
      if (closed) return
      closed = true
      log(why)
      clearInterval(parentTimer)
      if (retryTimer) clearTimeout(retryTimer)
      if (conn) {
        conn.socket.write(encodeFrame({ jsonrpc: "2.0", method: "kimo/bye" }))
        conn.socket.end()
      }
      resolve(0)
    }
    stdin.setEncoding?.("utf8")
    stdin.on("data", (chunk: string | Buffer) => {
      const { messages } = decoder.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"))
      for (const m of messages) onAgentMessage(m)
    })
    stdin.on("end", () => shutdown("stdin closed"))
    stdin.on("close", () => shutdown("stdin closed"))
    if (o.conn) attachConn(o.conn, false)
    else {
      // --attach without a running app: serve offline answers and keep probing.
      state = "down"
      scheduleRetry(0)
    }
  })
}
