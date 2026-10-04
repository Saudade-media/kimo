/**
 * M5 document-host harness (e2e only): the real `App` as an editor window whose sessions are
 * clients of an in-page document host (ADR 0002 Option A) over a memory IPC network, plus an
 * in-process MCP connection driven through `window.__kimoHost`. Built by `e2e/m5-host.e2e.ts`.
 */
import "@kimo/design-tokens/editor.css"
import "@kimo/ui/styles.css"
import "../../src/fonts.css"
import "../../src/app.css"
import { createEmptyDocument, serialize } from "@kimo/editor-state"
import { DEFAULT_POLICY } from "@kimo/mcp-server"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "../../src/App"
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

async function boot() {
  const service = await startDocumentHostService({
    platform,
    bridge: net.bridge(HOST_LABEL),
    version: "0.5.0-e2e",
    relay: false,
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
