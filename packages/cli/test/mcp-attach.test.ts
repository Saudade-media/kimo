/**
 * Attach mode of `kimo mcp` against a fake desktop app that speaks `kimo-socket/1`
 * (docs/spec/socket.md): hello + token, verbatim MCP relay, control messages, reconnect with
 * initialize replay, and the offline answers of `--attach` without an app.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { createServer, type Server, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
  checkHello,
  encodeFrame,
  FrameDecoder,
  type HelloParams,
  type JsonRpcMessage,
  KIMO_PATHS,
  listTools,
  RELAY_UNAVAILABLE,
  SOCKET_PROTOCOL,
} from "@kimo/mcp-server"
import { Client } from "@modelcontextprotocol/client"
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio"

const MAIN = resolve(import.meta.dir, "../src/main.ts")
const TOKEN = "dGVzdC10b2tlbi0zMi1ieXRlcy1sb25nLWVub3VnaA"

// biome-ignore lint/suspicious/noExplicitAny: JSON-RPC payloads
type Loose = any

const cleanup: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f()
})

interface FakeApp {
  kimoHome: string
  home: string
  socketPath: string
  hellos: HelloParams[]
  received: JsonRpcMessage[]
  pongs: number
  /** Drops every live connection (app crash / restart). */
  dropAll(): void
  /** When set, tools/call requests are never answered (to test in-flight failure). */
  hangCalls: boolean
  stop(): Promise<void>
}

async function fakeApp(): Promise<FakeApp> {
  // Short path: unix socket paths are limited to ~104 bytes on macOS.
  const home = realpathSync(mkdtempSync(join(tmpdir(), "km-")))
  const kimoHome = join(home, ".kimo")
  mkdirSync(join(kimoHome, "mcp"), { recursive: true })
  mkdirSync(join(kimoHome, "socket"), { recursive: true, mode: 0o700 })
  const socketPath = join(kimoHome, "socket", "kimo.sock")
  writeFileSync(join(kimoHome, KIMO_PATHS.token), TOKEN, { mode: 0o600 })
  const sockets = new Set<Socket>()
  const app: FakeApp = {
    kimoHome,
    home,
    socketPath,
    hellos: [],
    received: [],
    pongs: 0,
    hangCalls: false,
    dropAll: () => {
      for (const s of sockets) s.destroy()
      sockets.clear()
    },
    stop: async () => {},
  }
  const server: Server = createServer((sock) => {
    sockets.add(sock)
    sock.on("close", () => sockets.delete(sock))
    sock.on("error", () => {})
    sock.setEncoding("utf8")
    const dec = new FrameDecoder()
    let authed = false
    const send = (m: JsonRpcMessage) => sock.write(encodeFrame(m))
    sock.on("data", (chunk: string) => {
      for (const m of dec.push(chunk).messages as Loose[]) {
        if (!authed) {
          if (m.method !== "kimo/hello") {
            send({ jsonrpc: "2.0", id: m.id ?? null, error: { code: -32004, message: "hello" } })
            sock.end()
            return
          }
          const bad = checkHello(m.params, TOKEN)
          if (bad) {
            send({ jsonrpc: "2.0", id: m.id, error: bad })
            sock.end()
            return
          }
          authed = true
          app.hellos.push(m.params)
          send({
            jsonrpc: "2.0",
            id: m.id,
            result: {
              protocol: SOCKET_PROTOCOL,
              app: { name: "kimo-desktop", version: "9.9.9", pid: process.pid },
              connectionId: `c_${app.hellos.length}`,
              heartbeatMs: 10_000,
              documentHost: "ready",
            },
          })
          // A heartbeat right away: the relay must answer it and never forward it.
          send({ jsonrpc: "2.0", id: "ping-1", method: "kimo/ping" })
          send({ jsonrpc: "2.0", method: "kimo/hostRestarting" })
          continue
        }
        if (m.id === "ping-1" && "result" in m) {
          app.pongs++
          continue
        }
        app.received.push(m)
        if (m.method === "initialize")
          send({
            jsonrpc: "2.0",
            id: m.id,
            result: {
              protocolVersion: m.params.protocolVersion,
              capabilities: { tools: {} },
              serverInfo: { name: "fake-kimo-desktop", version: "9.9.9" },
            },
          })
        else if (m.method === "tools/list")
          send({
            jsonrpc: "2.0",
            id: m.id,
            result: {
              tools: [
                {
                  name: "kimo_get_state",
                  description: "fake",
                  inputSchema: { type: "object", properties: {} },
                },
              ],
            },
          })
        else if (m.method === "tools/call" && !app.hangCalls)
          send({
            jsonrpc: "2.0",
            id: m.id,
            result: { content: [{ type: "text", text: `from app: ${m.params.name}` }] },
          })
        else if (m.method === "ping") send({ jsonrpc: "2.0", id: m.id, result: {} })
      }
    })
  })
  await new Promise<void>((r) => server.listen(socketPath, r))
  writeFileSync(
    join(kimoHome, KIMO_PATHS.endpoint),
    JSON.stringify({
      version: 1,
      pid: process.pid,
      appVersion: "9.9.9",
      socket: socketPath,
      socketProtocol: SOCKET_PROTOCOL,
      startedAtIso: new Date().toISOString(),
    }),
  )
  app.stop = () =>
    new Promise<void>((r) => {
      app.dropAll()
      server.close(() => r())
    })
  cleanup.push(() => rmSync(home, { recursive: true, force: true }))
  cleanup.push(() => app.stop())
  return app
}

async function connect(kimoHome: string, home: string, args: string[] = []) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MAIN, "mcp", ...args],
    cwd: home,
    env: { HOME: home, KIMO_HOME: kimoHome, PATH: process.env.PATH ?? "" },
    stderr: "pipe",
  })
  const client = new Client({ name: "attach-test", version: "1.0.0" })
  await client.connect(transport)
  cleanup.push(() => client.close().catch(() => {}))
  return client
}

const until = async (f: () => boolean, ms = 5_000) => {
  const end = Date.now() + ms
  while (!f()) {
    if (Date.now() > end) throw new Error("timed out waiting")
    await Bun.sleep(20)
  }
}

describe("kimo mcp attach (kimo-socket/1)", () => {
  test("auto mode attaches: hello with token and client, MCP relayed verbatim, control consumed", async () => {
    const app = await fakeApp()
    const c = await connect(app.kimoHome, app.home, ["--client", "claude-code"])
    expect(c.getServerVersion()?.name).toBe("fake-kimo-desktop")
    expect(app.hellos).toHaveLength(1)
    expect(app.hellos[0]?.client).toBe("claude-code")
    expect(app.hellos[0]?.relay.name).toBe("kimo-cli")
    expect(app.hellos[0]?.cwd).toBe(app.home)
    const tools = await c.listTools()
    expect(tools.tools.map((t) => t.name)).toEqual(["kimo_get_state"])
    const r = (await c.callTool({ name: "kimo_get_state", arguments: {} })) as Loose
    expect(r.content[0].text).toBe("from app: kimo_get_state")
    await until(() => app.pongs === 1)
    // Control messages never reach the agent host, and the relay never sends kimo/* as MCP.
    expect(app.received.every((m) => !(m as Loose).method?.startsWith("kimo/"))).toBe(true)
    expect(app.received.map((m) => (m as Loose).method)).toContain("notifications/initialized")
  })

  test("bad token: auto mode falls back to headless", async () => {
    const app = await fakeApp()
    writeFileSync(join(app.kimoHome, KIMO_PATHS.token), "wrong")
    const c = await connect(app.kimoHome, app.home)
    expect(c.getServerVersion()?.name).toBe("kimo")
    expect(app.hellos).toHaveLength(0)
  })

  test("stale endpoint (dead pid) is not attached", async () => {
    const app = await fakeApp()
    writeFileSync(
      join(app.kimoHome, KIMO_PATHS.endpoint),
      JSON.stringify({
        version: 1,
        pid: 999_999,
        socket: app.socketPath,
        socketProtocol: SOCKET_PROTOCOL,
      }),
    )
    const c = await connect(app.kimoHome, app.home)
    expect(c.getServerVersion()?.name).toBe("kimo")
  })

  test("--attach without an app: offline initialize + tools/list, calls fail APP_NOT_RUNNING", async () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), "km-")))
    cleanup.push(() => rmSync(home, { recursive: true, force: true }))
    const c = await connect(join(home, ".kimo"), home, ["--attach"])
    expect(c.getServerVersion()?.name).toBe("kimo")
    const tools = (await c.listTools()).tools.map((t) => t.name)
    expect(tools).toEqual(listTools({ host: "desktop" }).map((t) => t.name))
    const r = (await c.callTool({ name: "kimo_get_state", arguments: {} })) as Loose
    expect(r.isError).toBe(true)
    expect(r.structuredContent.errors[0].code).toBe("APP_NOT_RUNNING")
    expect(r.structuredContent.errors[0].retryable).toBe(true)
  })

  test("disconnect: in-flight call fails TIMEOUT (retryable); reconnect replays initialize", async () => {
    const app = await fakeApp()
    const c = await connect(app.kimoHome, app.home)
    expect(app.received.filter((m) => (m as Loose).method === "initialize")).toHaveLength(1)
    app.hangCalls = true
    const pending = c.callTool({ name: "kimo_get_state", arguments: {} }).then(
      () => null,
      (e: Loose) => e,
    )
    await until(() => app.received.some((m) => (m as Loose).method === "tools/call"))
    app.dropAll()
    const e = await pending
    expect(e).not.toBeNull()
    expect(e.code).toBe(RELAY_UNAVAILABLE)
    expect(e.data.kimoCode).toBe("TIMEOUT")
    expect(e.data.retryable).toBe(true)

    app.hangCalls = false
    await until(() => app.hellos.length === 2)
    await until(() => app.received.filter((m) => (m as Loose).method === "initialize").length === 2)
    // The replayed initialize response is swallowed; the session keeps working.
    const r = (await c.callTool({ name: "kimo_get_state", arguments: {} })) as Loose
    expect(r.content[0].text).toBe("from app: kimo_get_state")
  })
})
