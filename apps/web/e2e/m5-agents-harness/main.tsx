/**
 * M5 agents harness (e2e only, not part of the app bundle): the board 21 surfaces mounted the way
 * INTEGRATION.md wires them (topbar drag region, canvas layer, left-panel rows, Activity tab,
 * Settings content) over a scripted `McpHostApi` and a real DocStore. `?scene=editor` (default) |
 * `settings-running` | `settings-empty` | `settings-error`. Driven through `window.__agents`.
 */
import "@kimo/design-tokens/editor.css"
import "@kimo/ui/styles.css"
import "../../src/fonts.css"
import "../../src/settings/settings.css"
import type { KimoDocument } from "@kimo/core-schema"
import { createEmptyDocument, importDocument, type Op } from "@kimo/editor-state"
import type { McpActivityEntry, McpApprovalRequest } from "@kimo/platform"
import { AGENT_LAYER_ROW_CLASS, LayerRow, SaveStatus } from "@kimo/ui"
import { Frame, Square } from "lucide-react"
import { StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"
import {
  AgentActivityPanel,
  AgentCanvasLayer,
  AgentPausedBanner,
  AgentPresence,
  AgentsMcpPane,
  type AgentsServerControls,
  createAgentsController,
  type ProjectedBox,
  useAgentsState,
} from "../../src/agents"
import { createScriptedMcpHost, sampleConnection, sampleHosts } from "../../src/agents/testing"

const ORIGIN = "mcp:claude-code.k3x9qa"
const FILE = "f-home"
const PATH = "/Users/me/repo/design/home.kimo"

function pricingDoc(): KimoDocument {
  const d = createEmptyDocument("Home") as KimoDocument & { nodes: Record<string, unknown> }
  const frame = (id: string, name: string, parent: string | null, order: string, extra = {}) => {
    d.nodes[id] = { type: "frame", parent, order, name, x: 0, y: 0, w: 136, h: 220, ...extra }
  }
  frame("Pricing0001", "Pricing — Desktop", null, "a0", { w: 520, h: 420, fill: "#FFFFFF" })
  frame("Cards00001", "Cards", "Pricing0001", "a0", { w: 440 })
  frame("Card000001", "Card 1", "Cards00001", "a0", { fill: "#F4F1EC", radius: 12 })
  frame("Card000002", "Card 2", "Cards00001", "a1", { fill: "#F4F1EC", radius: 12 })
  frame("Card000003", "Card 3", "Cards00001", "a2", { fill: "#F4F1EC", radius: 12 })
  frame("OldHero001", "Old Hero", null, "a1", { x: 600, w: 220, h: 190, fill: "#FFFFFF" })
  d.nodes.Divider001 = {
    type: "rect",
    parent: "Pricing0001",
    order: "a1",
    name: "Divider",
    x: 0,
    y: 0,
    w: 440,
    h: 1,
  }
  return d
}

/** Screen boxes of the canvas nodes (board 21 AxgvU: Card 2 at 216,152 in the canvas). */
const BOXES: Record<string, ProjectedBox> = {
  Pricing0001: { x: 24, y: 50, w: 520, h: 420 },
  Card000001: { x: 64, y: 152, w: 136, h: 220, radius: 12 },
  Card000002: { x: 216, y: 152, w: 136, h: 220, radius: 20 },
  Card000003: { x: 368, y: 152, w: 136, h: 220, radius: 12 },
  OldHero001: { x: 600, y: 152, w: 220, h: 190, radius: 4 },
}

/** Projection-only boxes (not drawn): Cards, the section the cards sit in (board 36). */
const SECTIONS: Record<string, ProjectedBox> = {
  Cards00001: { x: 44, y: 132, w: 480, h: 260 },
}

const store = importDocument(pricingDoc())
const host = createScriptedMcpHost({
  connections: [],
  hosts: sampleHosts(),
  policies: {
    "claude-code": {
      level: "edit",
      files: ["/Users/me/repo/design/**"],
      nodes: [],
      grants: [],
      onExceed: "ask",
      confirmDestructive: true,
    },
  },
})
const controller = createAgentsController({
  host,
  fileId: FILE,
  filePath: PATH,
  docId: "doc-1",
  // The harness store owns the agent's undo stack (in-process host).
  hostHistory: false,
  store,
  onFocus: (ids) => focused.push(ids),
})
const focused: string[][] = []
const exported: string[] = []
const highlights: (string[] | null)[] = []
let seq = 100
const conns: ReturnType<typeof sampleConnection>[] = []

const scene = new URLSearchParams(location.search).get("scene") ?? "editor"

const api = {
  host,
  store,
  controller,
  ORIGIN,
  FILE,
  PATH,
  focused,
  exported,
  highlights,
  connect(over: Parameters<typeof sampleConnection>[0] = {}) {
    const c = sampleConnection({ docs: ["doc-1", "doc-2"], lastActivityAt: Date.now(), ...over })
    conns.push(c)
    host.control.setConnections([...conns])
    return c
  },
  apply(ops: Op | Op[], origin = ORIGIN) {
    return store.apply(ops, { origin: origin as `mcp:${string}` }).ok
  },
  entry(e: Partial<McpActivityEntry>) {
    return host.control.append(FILE, {
      time: Date.now(),
      origin: ORIGIN,
      actor: "Claude Code",
      kind: "edit",
      tool: "kimo_apply_ops",
      summary: "Restyle pricing cards",
      revision: store.revision,
      nodeIds: ["Card000002"],
      undoToken: `u${++seq}`,
      ...e,
    })
  },
  request(over: Partial<McpApprovalRequest> = {}) {
    const now = Date.now()
    host.control.request({
      id: `ap${++seq}`,
      client: {
        client: "claude-code",
        label: "Claude Code",
        version: "2.1.4",
        session: "k3x9qa",
        transport: "socket",
      },
      tool: "kimo_apply_ops",
      path: PATH,
      reason: { kind: "destructive", ops: ["delete"], nodeIds: ["Card000001", "OldHero001"] },
      summary: "Replace hero",
      preview: {
        inserted: 0,
        updated: 1,
        deleted: 2,
        nodeIds: ["Card000001", "OldHero001", "Card000003"],
      },
      requestedAt: now,
      expiresAt: now + 120_000,
      ...over,
    })
  },
}
Object.assign(window, { __agents: api })

function EditorScene() {
  const state = useAgentsState(controller)
  const [hl, setHl] = useState<string[] | null>(null)
  const rows = [
    "Pricing0001",
    "Cards00001",
    "Card000001",
    "Card000002",
    "Card000003",
    "OldHero001",
    "Divider001",
  ]
  return (
    <div className="h-editor">
      {/* Topbar: Drag Region (G1mul) fill, justify end, center → Agent Presence; then Save status */}
      <header className="h-topbar">
        <span className="h-crumb">home.kimo</span>
        <div className="h-drag" data-testid="drag-region">
          <AgentPresence
            controller={controller}
            onShowOnCanvas={(ids) => focused.push(ids)}
            onOpenAgentsSettings={() => void host.calls.push("open-agents-settings")}
            fileName="home.kimo"
          />
        </div>
        <SaveStatus kind={store.readOnly ? "read-only" : "saved"} />
        <span className="h-tail" />
      </header>
      <AgentPausedBanner controller={controller} onShowOps={() => focused.push(["show-ops"])} />
      <div className="h-body">
        <aside className="h-left" data-testid="left-panel">
          {rows.map((id) => {
            const n = store.getNode(id) as { name?: string; type?: string } | undefined
            if (!n) return null
            return (
              <LayerRow
                key={id}
                data-id={id}
                name={n.name ?? id}
                icon={n.type === "frame" ? <Frame /> : <Square />}
                className={state.touched.has(id) ? AGENT_LAYER_ROW_CLASS : undefined}
              />
            )
          })}
        </aside>
        <main className="h-canvas" data-testid="canvas">
          {Object.entries(BOXES).map(([id, b]) =>
            store.hasNode(id) ? (
              <div
                key={id}
                className="h-node"
                data-node={id}
                style={{
                  left: b.x,
                  top: b.y,
                  width: b.w,
                  height: b.h,
                  borderRadius: b.radius ?? 0,
                  background:
                    id === "Pricing0001"
                      ? "#FFFFFF"
                      : String((store.getNode(id) as { fill?: unknown }).fill ?? "#F4F1EC"),
                  outline: hl?.includes(id) ? "1.5px solid var(--kimo-agent)" : undefined,
                }}
              />
            ) : null,
          )}
          <AgentCanvasLayer
            controller={controller}
            project={(id) => (store.hasNode(id) ? (BOXES[id] ?? SECTIONS[id] ?? null) : null)}
            parentOf={(id) => {
              const p = (store.getNode(id) as { parent?: unknown } | undefined)?.parent
              return typeof p === "string" ? p : null
            }}
          />
        </main>
        <aside className="h-right" data-testid="right-panel">
          <AgentActivityPanel
            controller={controller}
            fileId={FILE}
            onHighlight={(ids) => {
              highlights.push(ids)
              setHl(ids)
            }}
            onExport={(json) => exported.push(json)}
            onConnectAgent={() => void host.calls.push("connect-agent")}
          />
        </aside>
      </div>
    </div>
  )
}

function SettingsScene({ kind }: { kind: "running" | "empty" | "error" }) {
  const [startOnLaunch, setStart] = useState(true)
  const [ask, setAsk] = useState(true)
  const server: AgentsServerControls = {
    version: "kimo-mcp 0.5.0",
    restart: () => void host.calls.push("restart"),
    stop: () => void host.calls.push("stop"),
    start: () => void host.calls.push("start"),
    startOnLaunch: { value: startOnLaunch, set: setStart },
    askBeforeDestructive: { value: ask, set: setAsk },
    port: {
      value: 7341,
      set: (p) => void host.calls.push(`port ${p}`),
      isFree: async (p) => p !== 7341,
    },
    token: { value: "kimo_pat_8x2kq0d93f9a", regenerate: () => "kimo_pat_new000000000" },
    error:
      kind === "error"
        ? {
            code: "EADDRINUSE 127.0.0.1:7341",
            message:
              "Port 7341 is in use (node, pid 48211). Stdio agents still work over the local socket.",
            port: 7341,
            suggestedPort: 7342,
          }
        : null,
    log: {
      path: "/Users/me/Library/Logs/Kimo/mcp.log",
      lastError: "11:52:07",
      reveal: () => void host.calls.push("reveal"),
    },
  }
  return (
    <div className="settings-window settings-window--dialog h-settings">
      <section className="settings-content" data-testid="settings-content">
        <AgentsMcpPane
          host={host}
          server={server}
          home="/Users/me"
          machine="this Mac"
          expandedClient="claude-code"
          onOpenActivity={() => void host.calls.push("open-activity")}
          onCopy={(t) => void host.calls.push(`copy ${t.slice(0, 40)}`)}
        />
      </section>
    </div>
  )
}

if (scene === "settings-running") {
  host.control.setConnections([
    sampleConnection(),
    sampleConnection({
      client: "codex",
      label: "Codex",
      session: "q7w2er",
      connectedAt: new Date(2026, 9, 4, 11, 5).getTime(),
      docs: ["doc-1"],
      state: "idle",
      identity: {
        client: "codex",
        label: "Codex",
        version: "0.48.0",
        session: "q7w2er",
        transport: "http",
      },
    }),
  ])
  host.control.policies.codex = {
    level: "read",
    files: [],
    nodes: [],
    grants: [],
    onExceed: "ask",
    confirmDestructive: true,
  }
}
if (scene === "settings-error")
  host.control.setStatus({ http: { enabled: true, url: "http://127.0.0.1:7341/mcp", port: 7341 } })

const css = document.createElement("style")
css.textContent = `
  html, body { margin: 0; background: var(--kimo-bg-app); font-family: var(--kimo-font-sans); }
  .h-editor { display: flex; flex-direction: column; width: 100vw; height: 100vh; }
  .h-topbar { box-sizing: border-box; display: flex; align-items: center; gap: 8px; height: 48px; padding: 0 12px 0 0; box-shadow: inset 0 -1px 0 var(--kimo-border); flex: none; }
  .h-crumb { padding-left: 84px; font-size: 13px; }
  .h-drag { display: flex; flex: 1 1 0; justify-content: flex-end; align-items: center; height: 48px; }
  .h-tail { width: 220px; flex: none; }
  .h-body { display: flex; flex: 1 1 0; min-height: 0; }
  .h-left { box-sizing: border-box; display: flex; flex-direction: column; gap: 1px; width: 256px; padding: 8px 6px; box-shadow: inset -1px 0 0 var(--kimo-border); flex: none; }
  .h-canvas { position: relative; flex: 1 1 0; background: var(--kimo-bg-canvas); overflow: hidden; }
  .h-node { position: absolute; }
  .h-right { box-sizing: border-box; display: flex; flex-direction: column; width: 340px; box-shadow: inset 1px 0 0 var(--kimo-border); flex: none; }
  .h-settings.settings-window--dialog { width: 624px; height: auto; max-height: none; min-height: 100vh; }
  .h-settings .settings-content { height: auto; overflow: visible; }
`
document.head.append(css)

const root = document.getElementById("root")
if (root)
  createRoot(root).render(
    <StrictMode>
      {scene === "editor" ? (
        <EditorScene />
      ) : (
        <SettingsScene
          kind={
            scene === "settings-error" ? "error" : scene === "settings-empty" ? "empty" : "running"
          }
        />
      )}
    </StrictMode>,
  )
