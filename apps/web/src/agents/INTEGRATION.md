# Agents & MCP (board 21 KGdvA): integration

Every surface is a mount point exported from `apps/web/src/agents` (importing the module loads
`agents.css`). One `AgentsControllerExt` per editor window drives them all. Nothing here edits the
shared files; the wiring below goes into `Editor.tsx`, `Topbar.tsx`, `LeftPanel.tsx`,
`RightPanel.tsx` and `settings/SettingsView.tsx`.

## 1. Controller (Editor.tsx, one per window)

```ts
import { createAgentsController } from "../agents"

const agents = useMemo(() => createAgentsController({
  host: platform.mcp,                 // McpHostApi (see "Platform gap" below)
  fileId,                             // sha256(path)[:16] on desktop, same key as activity/leases
  filePath: session.ref.path,         // approvals for other files don't draw a dry run here
  docId: session.docId,               // McpConnectionInfo.docs
  store: session.store,               // op log → session ops, layer dots, node names
  history,                            // optional AgentHistory (see below)
  onFocus: (ids) => { ui.select(ids); viewport.zoomTo(ids) },   // kimo_focus semantics
}), [session])
useEffect(() => () => agents.dispose(), [agents])
```

`history` should call the document host's `kimo_history` undo for that origin (guarded replay,
`undoToken`). Without it the controller undoes on the window's `store` (`store.undo(origin)`),
which is right only when the window's store is the document-host replica that owns the
`mcp:*` undo stacks (in-process host / tests).

## 2. Right card header (board 48: the avatar stack)

Agents are avatars in the right card's stack (`multiplayer/ui/PresenceStack`), ahead of the
people, a waiting agent first. `AgentStack` hands them to the stack and draws what hangs from
them: the changes popover (an agent row in the people popover opens it; the approval queue while
requests wait), the approval prompt (weJXw, under the waiting agent's avatar) and ⌘↩.

```tsx
<AgentStack
  controller={agents}
  onShowOnCanvas={(ids) => { ui.select(ids); viewport.zoomTo(ids) }}
  onOpenClientSettings={(client) => openSettings(platform, "agents-mcp", { client })}
>
  {(stack) => (
    <TopbarShare docKey={key} card agents={stack.agents} onPeopleOpenChange={stack.onPeopleOpenChange} />
  )}
</AgentStack>
```

The changes popover fits the window (at most its height minus 24) and flips above its anchor when
there is no room below. The prompt waits while a popover of the stack is open. With no agent in
the stack the prompt anchors top right.

## 3. Banner (under the topbar, with the other file banners)

```tsx
<AgentPausedBanner controller={agents} onShowOps={openActivityTab} onSaveCopy={saveCopy} />
```

One per file; renders only while an agent is paused by READ_ONLY / DOCUMENT_LOCKED.

## 4. Canvas layer (Editor canvas host, above the canvas element, below the selection UI)

```tsx
<div className="canvas-host" style={{ position: "relative" }}>
  <canvas … />
  <AgentCanvasLayer
    controller={agents}
    project={(id) => {                         // node → box in the host's CSS px
      const b = layout.get()?.nodes.get(id)?.world
      if (!b) return null
      const p = viewport.worldToScreen(b)     // whatever the canvas uses
      return { x: p.x, y: p.y, w: b.w * zoom, h: b.h * zoom, radius: radiusOf(id) * zoom }
    }}
    viewportKey={`${zoom}:${panX}:${panY}:${layoutVersion}`}
    parentOf={(id) => store.getNode(id)?.parent ?? null}   // board 36 section rule
    world={(id) => layout.get()?.nodes.get(id)?.world ?? null}
    toLayer={(p) => viewport.worldToScreen(p)}            // world-space glide
  />
</div>
```

The layer is `position:absolute; inset:0; pointer-events:none` (only the Dry Run Bar takes
clicks). It draws, per MCP client (board 36), one cursor on the center of the section it
writes in and a 1 px outline on that section, a ring per landed op group, dry-run ghosts and
the bar. The built-in agent's own connections (`agent:*` origins, and a CLI engine's relay from
`~/.kimo/cli-workspaces/<session>`) draw nothing here: the agent panel's cursor stands for them.

## 5. Left panel (LeftPanel.tsx)

Rows an uncommitted agent group touched get `LayerRow/Agent` (PwDCI): add the class to any row
variant (`LayerRow`, `LayerRowM3`, `LayerRowConflict`); the CSS turns its Spacer into the 6 px
agent dot.

```tsx
import { AGENT_LAYER_ROW_CLASS } from "@kimo/ui"
const { touched } = useAgentsState(agents)
<LayerRow className={touched.has(id) ? AGENT_LAYER_ROW_CLASS : undefined} … />
```

## 6. Right panel (RightPanel.tsx): 4th tab "Activity"

Decision on the board (rule "Placement"): a fourth tab after Agent. The tab body is the whole
panel below the Tabs frame (`display:flex; flex-direction:column`, fills the height):

```tsx
{tab === "activity" && (
  <AgentActivityPanel
    controller={agents}
    fileId={fileId}
    onHighlight={(ids) => canvas.setAgentHighlight(ids)}   // hover: $agent outline on targets
    onExport={(json, name) => platform.dialogs.saveFile({ defaultName: name }).then(…)}  // optional
  />
)}
```

Without `onExport` it downloads a Blob.

## 7. Settings (settings/SettingsView.tsx + model.ts + @kimo/platform SettingsPane)

Rule "Placement": a sidebar item **between Fonts & privacy and Updates**, id `agents-mcp`,
label "Agents & MCP", lucide `bot`. `agents.css` already colours its icon `$agent`
(`.settings-nav-item[data-pane="agents-mcp"]`). Add `"agents-mcp"` to `SettingsPane`
(`@kimo/platform`) and `SETTINGS_PANES`, then:

```tsx
{pane === "agents-mcp" && (
  <AgentsMcpPane
    host={platform.mcp}
    server={serverControls}           // optional, see below
    home={homeDir}
    machine={os === "macos" ? "this Mac" : "this computer"}
    expandedClient={deepLinkClient}   // from the popover's settings button
    onOpenActivity={() => focusEditorActivityTab()}
  />
)}
```

The pane renders inside `.settings-content` (it relies on its `[0, 32, 24, 32]` padding and the
`settings-title-bar` / `settings-title` classes); the failed-state banner spans the padding.

`server: AgentsServerControls` carries what `McpHostApi` doesn't have: `version`, `restart`,
`stop`, `start`, `startOnLaunch`, `askBeforeDestructive`, `port {value, set, isFree}`,
`token {value, regenerate}`, `error` (failed to start: code, message, port, suggestedPort) and
`log {path, lastError, reveal}`. Each control is hidden when its field is absent.

## Platform surface (closed by the M5 integration, ADR 0013 addendum 2)

- `KimoPlatform.mcp?: McpHostApi`: desktop windows get it from `createDesktopMcpHost`
  (`src/host/mcp-api.ts`: Rust `kimo_mcp_*` commands + the document host's `mcpState` /
  `mcpPause` / `agentUndo` RPCs + the `kimo://mcp-*` events); the memory platform has a scripted
  one (`createMemoryMcpHost`, also `src/agents/testing.ts`); the browser has none.
- `McpHostApi.server` (start / stop / restart, start on launch, HTTP port + `isPortFree`, the
  HTTP bearer, log path + reveal; status carries `running`, `error`, `logPath`, `home`),
  `McpHostApi.clients` (a real pause: the runtime holds the client's calls before
  authorization until resumed) and `McpHostApi.history.undo(path, origin, token)` (the
  controller's default undo when `filePath` is set; `hostHistory: false` keeps the store undo).
- `McpConnectionInfo.call {tool, label, startedAt}`, `focus`, `paused`;
  `McpActivityEntry.label`, `opCount`, `revisionBefore`; `McpApprovalRequest.preview.kinds`
  (op kind per node from a quiet dry run in the host runtime).
- Wired in `editor/agents.tsx` (`useEditorAgents`) → `Editor.tsx`, `disk.tsx`,
  `LeftPanel.tsx` (`agentNodes`),
  `RightPanel.tsx` (`activity` tab + `openActivity` bus) and `settings/AgentsPane.tsx`.

Not done: the session popover's "client settings" deep link opens the pane but does not expand
the client (the Settings window route carries the pane only); "Ask before destructive" has no
global setting behind it (per-client `confirmDestructive` lives in each policy); the Settings
window's "Open activity" has no cross-window channel to the editor's Activity tab.

## Board 24 (M6) additions

- **AgentMark** replaces AgentOrb on every surface (chip 24, session popover 28, approval prompt
  32, canvas tag 12, cursor pill 12, Activity group 16, client row 28). Marks follow presence
  (editing → Working, reading → Thinking, waiting → Listening, paused → Idle frozen).
- **Presence chip** (BXTD5 / yeF1Z / I7jut): replaced by board 48's avatar stack (section 2).
- **Dry-run bar** (joR0E jMSYI): top-centre of the canvas, AgentMark 12, "Dry run · N changes ·
  nothing applied", Discard (Esc) / Apply (⌘↩, approval-backed dry runs). For an agent's
  dry-run *call* it stands in for that agent's avatar in the stack; an approval's dry run keeps
  the avatar (the prompt hangs from it).
- **Agent cursor placement** (board 36 XDVdg, supersedes joR0E rules 1, 3, 5): pointer tip on
  the section center, pill flips near edges, stacked 26 px apart, glides 600 ms ease-in-out
  cubic in world space, floats 3 px every 2.4 s, gone 2 s after the last write; nothing is
  drawn for an off-screen section.
- **Activity**: empty log = EmptyState (history) + "Connect an agent…" when no agent is connected
  (`onConnectAgent` on `AgentActivityPanel`); undone entries stay (struck label, "Undone by you ·
  10:52", Redo when the history can redo: `AgentHistory.redo`, the store-based default can).
- **Config diff preview** (KdEak K5Dnf) is built into `AgentsMcpPane` (Install / Update /
  Remove): unified diff scrolled to the change, Copy diff, backup footnote, nothing written on
  Cancel.
