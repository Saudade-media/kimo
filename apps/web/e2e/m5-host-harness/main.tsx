/**
 * M5 document-host harness (e2e only): the real `App` as an editor window whose sessions are
 * clients of an in-page document host (ADR 0002 Option A) over a memory IPC network, plus an
 * in-process MCP connection driven through `window.__kimoHost`. Built by `e2e/m5-host.e2e.ts`.
 */
import "@kimo/design-tokens/editor.css"
import "@kimo/ui/styles.css"
import "../../src/fonts.css"
import "../../src/app.css"
import { agentOrigin, childPolicy, leadPolicy } from "@kimo/ai-agent"
import { createEmptyDocument, serialize } from "@kimo/editor-state"
import { DEFAULT_POLICY } from "@kimo/mcp-server"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "../../src/App"
import { createHostTools } from "../../src/agent-panel/host-tools"
import {
  browserScene,
  createDesktopMcpHost,
  createMemoryBridgeNetwork,
  HOST_LABEL,
  HostClient,
  hostedSessionFactory,
  startDocumentHostService,
} from "../../src/host"
import { initTheme, setTheme } from "../../src/lib/theme"
import { createAppSessionManager, RuntimeContext } from "../../src/platform/runtime"
import { bindAppearance } from "../../src/settings"

const FILE = "/Users/me/Work/site/home.kimo"
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
  w: 720,
  h: 480,
  fill: "#FFFFFF",
}

// One platform for "the app": the host owns leases and files, the window uses it for chrome.
const platform = createMemoryPlatform({
  files: { [FILE]: serialize(d) },
  settings: { "general.appearance": "light", "files.autosave": false },
})
const net = createMemoryBridgeNetwork()
net.commands.set("kimo_mcp_policies_get", () => ({}))
// Board 36: relayed connections (a CLI engine's kimo-mcp shim) answer through this command.
const relayOut: { connectionId: string; message: string }[] = []
net.commands.set("kimo_mcp_send", (a) => void relayOut.push(a as never))
net.commands.set("kimo_mcp_host_ready", () => {})
// What Rust answers for the window's McpHostApi (the relay itself is not in the page).
net.commands.set("kimo_mcp_status", () => ({
  socket: { path: "/Users/me/.kimo/socket/kimo.sock", listening: true },
  http: { enabled: false },
  documentHost: "ready",
  shimPath: "/Applications/Kimo.app/Contents/MacOS/kimo-mcp",
  protocol: "kimo-socket/1",
  connections: 1,
  running: true,
  home: "/Users/me",
}))

let rpcId = 0
/** One JSON-RPC request on a relayed connection; resolves its `result`. */
async function relayRpc(connectionId: string, method: string, params: unknown): Promise<unknown> {
  const id = ++rpcId
  net.rustEmit(
    "kimo://mcp-in",
    { connectionId, message: JSON.stringify({ jsonrpc: "2.0", id, method, params }) },
    HOST_LABEL,
  )
  for (let i = 0; i < 1000; i++) {
    const hit = relayOut.find(
      (m) =>
        m.connectionId === connectionId && (JSON.parse(m.message) as { id?: number }).id === id,
    )
    if (hit) return (JSON.parse(hit.message) as { result?: unknown }).result
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error(`relay ${method} timed out`)
}

async function boot() {
  const service = await startDocumentHostService({
    platform,
    bridge: net.bridge(HOST_LABEL),
    version: "0.5.0-e2e",
    relay: true,
    scene: browserScene,
  })
  const client = await HostClient.connect(net.bridge("main"), 5000)
  if (!client) throw new Error("document host did not answer")
  const manager = createAppSessionManager(platform, hostedSessionFactory(client))
  // The window's platform.mcp, as createAppRuntime builds it in Tauri.
  net.commands.set("kimo_mcp_activity_read", (a) =>
    service.runtime.activity.list(String(a.fileId), Number(a.limit)),
  )
  const windowMcp = await createDesktopMcpHost({ bridge: net.bridge("main"), client, os: "macos" })
  Object.defineProperty(platform, "mcp", { value: windowMcp, configurable: true })
  manager.install()
  let agentTools: ReturnType<typeof createHostTools> | null = null
  const mcp = service.runtime.connect(
    { client: "claude-code", label: "Claude Code", transport: "in-process" },
    { policy: { ...DEFAULT_POLICY, files: ["/Users/me/**"] } },
  )
  Object.assign(window, {
    __kimoHost: {
      FILE,
      platform,
      service,
      manager,
      call: async (tool: string, input: unknown) => (await mcp.call(tool, input)).result,
      /**
       * Board 36: a relayed MCP connection as Rust opens it for a kimo-mcp shim (hello with the
       * shim's cwd), initialized; `relayCall` runs one tools/call on it and resolves its result.
       */
      relayOpen: async (connectionId: string, client: string, cwd: string) => {
        net.rustEmit(
          "kimo://mcp-connection",
          {
            connectionId,
            state: "open",
            transport: "socket",
            hello: { client, pid: 1, ppid: 2, cwd, relay: { name: "kimo-mcp", version: "1" } },
          },
          HOST_LABEL,
        )
        await relayRpc(connectionId, "initialize", {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: client, version: "2" },
        })
        net.rustEmit(
          "kimo://mcp-in",
          {
            connectionId,
            message: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
          },
          HOST_LABEL,
        )
      },
      relayCall: async (connectionId: string, name: string, args: unknown) =>
        (
          (await relayRpc(connectionId, "tools/call", { name, arguments: args })) as {
            structuredContent?: unknown
          }
        ).structuredContent,
      /**
       * An in-app agent's call through the host RPC `agentCall` (the editor's host tool host):
       * `n` = 0 for the lead (unscoped), else a child scoped to `scope`.
       */
      agentCall: async (
        tool: string,
        input: Record<string, unknown>,
        o: { n?: number; scope?: string[] } = {},
      ) => {
        agentTools ??= createHostTools({ client, ref: FILE })
        if (!agentTools.docId()) await agentTools.refresh()
        const n = o.n ?? 0
        const host = agentTools.factory({
          origin: agentOrigin("e2e", n),
          label: n ? `Agent ${n + 1}` : "Kimo",
          session: "e2e",
          policy: o.scope ? childPolicy(o.scope) : leadPolicy(),
          requestApproval: async () => "deny",
        })
        const input2 = { docId: agentTools.docId(), ...input }
        return (
          await host.call({ id: tool, name: tool, input: input2 }, new AbortController().signal)
        ).result
      },
    },
  })
  initTheme()
  await platform.settings.ready
  bindAppearance(platform.settings, setTheme)
  const container = document.getElementById("root")
  if (container)
    createRoot(container).render(
      <StrictMode>
        <RuntimeContext.Provider value={{ platform, manager, hostClient: client }}>
          <App />
        </RuntimeContext.Provider>
      </StrictMode>,
    )
}
void boot()
