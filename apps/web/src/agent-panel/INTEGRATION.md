# Agent tab (M6, board 22 D0zDSY + board 24 iLW1l): integration

Everything here is a mount point exported from `apps/web/src/agent-panel` (importing the module
loads `agent-panel.css`). One `AgentPanelControllerExt` per editor window drives the tab, the
canvas overlays and the Home hand-off. Nothing here edits the shared files; the wiring below goes
into `Editor.tsx` and `RightPanel.tsx`.

## 1. Runtime + controller (Editor.tsx, one per window)

```ts
import { createAgentPanelController, createInWindowTools, createPlatformAgentRuntime } from "../agent-panel"
import { shimLaunch } from "@kimo/ai-agent"
import { useAiProviders } from "../ai-settings/runtime"

const ai = useAiProviders(platform)                         // builder 3's AI providers controller
const tools = useMemo(() => createInWindowTools({
  store: session.store,                                     // the window's DocStore
  path: session.ref.path ?? `untitled:${session.docId}`,
  selection: () => session.ui.getState().selection,         // kimo_get_state
  onFocus: (ids) => { session.ui.getState().select(ids); canvas.current?.zoomToFit(ids, 96) },
  version: KIMO_VERSION,
}), [session])
const agentPanel = useMemo(() => ai && createAgentPanelController({
  // Desktop: provider calls through the Rust relay + the Tauri CLI host; web: page fetch, no CLIs.
  runtime: createPlatformAgentRuntime(platform, ai, tools.factory, {
    mcpLaunch: (cli) => shimLaunch(mcpStatus.shimPath ?? "kimo-mcp", cli),
    skills: platform.skills,                                  // ~/.kimo/skills SkillSource (desktop)
    openSettings: () => openSettings(platform, "ai-providers"),
    openLink: (url) => platform.shell.openExternal(url),
  }),
  fileId,                                                   // sha256(path)[:16] / untitled-<docId>
  fileName: session.ref.name,
  docId: () => tools.docId(),
  nodeName: (id) => session.store.getNode(id)?.name,
  frameBox: (id) => { const n = session.store.getNode(id); return n && { id, name: n.name, x: n.x, y: n.y, w: n.w, h: n.h } },
}), [ai, tools, fileId])
useEffect(() => () => agentPanel?.dispose(), [agentPanel])

// Canvas selection → auto attachment chips (removable; scope of Single mode).
useEffect(() => session.ui.subscribe((s) => agentPanel?.setSelection(
  s.selection.map((id) => ({ id, name: session.store.getNode(id)?.name ?? id })))), [agentPanel])
```

- **Providers**: `createPlatformAgentRuntime` (over `createAppAgentRuntime`) reads `ai.providerConfigs()`, `ai.clis()`,
  `ai.state.defaultSelection` (Claude Code first when signed in, ADR 0014 §11) and records every
  finished turn with `ai.recordUsage(...)` (Settings › Usage & limits). Provider requests use
  `ai.fetchFor(providerId)` — the AI settings controller's own fetch per row: on desktop the
  Rust relay with `relayAuthFor(row)` (keys never in JS; Bedrock / Vertex region and project,
  custom endpoints), on the web the page's fetch.
- **Tools**: `createInWindowTools` runs the M5 registry in process over the window's store
  (`agent:kimo.<session>.<n>` origins, per-op `checkScope`, in-app approvals that wait until
  answered). A desktop window whose store is a document-host replica may instead pass a
  `ToolHostFactory` backed by the document host's handlers (same `ToolHostSpec`).
- **Sessions**: IndexedDB `kimo-sessions` by default (web and desktop webview); pass `sessions`
  to use the desktop `~/.kimo/sessions/<fileId>/<id>.json` store when the platform has one.

## 2. RightPanel.tsx: the Agent tab

Replace the "Agent arrives in M6" placeholder (the panel already widens to 360 for this tab):

```tsx
import { AgentPanel, hasHomeHandoff, useHomeHandoff } from "../agent-panel"

{tab === "agent" && agentPanel && (
  <AgentPanel
    controller={agentPanel}
    fileName={session.ref.name}
    clis={ai.clis()}
    onOpenSettings={() => openSettings(platform, "ai-providers")}
    onOpenSkillsFolder={() => platform.shell.reveal("~/.kimo/skills")}
  />
)}
```

`<AgentPanel>` fills the panel below the Tabs frame (`flex: 1 1 auto; min-height: 0`): Thread
Header · Thread (or the Session List) · Composer Wrap. Its menus are positioned inside the
Composer Wrap (no portal).

## 3. Home → editor hand-off (builder 3's `home/handoff.ts`)

```ts
// Initial tab: open the Agent tab when Home left a hand-off for this file.
const [tab, setTab] = useState<RightTab>(() => hasHomeHandoff(handoffPath) ? "agent" : "design")
// Take it once and start: session id from Home, origin "home", Single, first message "From Home".
useHomeHandoff(agentPanel, handoffPath, () => setTab("agent"))
```

`handoffPath` = the desktop FileRef (absolute path) or the web library file id (`#/file/<id>`).

## 4. Canvas (Editor canvas host)

```tsx
import { agentCanvasProps, useAgentPanelState } from "../agent-panel"
const agentState = useAgentPanelState(agentPanel)
<Canvas agentCanvas={agentCanvasProps(agentState, agentPanel, {
  onReviewPlaceholder: () => setTab("agent"),
})} … />
```

Live origins, persona + label per origin, enforced scopes (side by side / split / iterate),
persona cursors and rejected-op flashes come from the panel; the canvas builder draws them.
For other canvas-side pieces the panel exports `ModeSummaryPill` (jDKaM), `VariantActions`
(avr2x), `PassChip` (NCElh), `AgentCursorPill` (GmEAl) and `RejectedOpPill` (O2Whh).

## 5. AgentMark (`@kimo/ui`)

`<AgentMark size state persona />` replaces `AgentOrb` everywhere (board 24 §4). All marks share
one WebGL context (`agentMarkRendererStats()`); ≤ 12 px, `static`, no WebGL and
`prefers-reduced-motion` draw the flat 3 × 3 mesh (AgentMark/32/Static). States: `idle`,
`listening`, `waiting`, `thinking`, `working`, `done` (arc eyes 1.6 s → idle), `paused`, `error`,
`disconnected` (error at 50 %). Personas: `teal` (lead), `iris`, `violet`, `rose`, `ember`,
`moss` — assign them with `PersonaAllocator` / `assignPersonas` (rule PqjaS).

## Not designed (decided here, flagged for review)

- First run in the Agent tab (no provider, no signed-in CLI): an EmptyState "Connect a model to
  start" with "Open AI providers" (the Home first-run card is builder 3's).
- In-app approval inside the thread: a neutral AgentErrorCard-shaped card (hand icon) with the
  M5 approval choices; it waits until answered (Stop = Deny).
- Refusal / generic error cards reuse AgentErrorCard tones (warning / danger, icons
  shield-alert / triangle-alert).
- Steps of older finished turns are collapsed (board A shows only the live turn's steps).
- The "Using …" skills row shows only when a turn used more than the default `kimo-design`.
- Side by side / split children run only on API providers (in-process M5 clients); a CLI model
  in those modes surfaces an error card. Iterate works with CLIs (one prompt per pass).

## Wired (M6 integration)

`editor/agent-panel.tsx` `useEditorAgentPanel` → `Editor.tsx` / `RightPanel.tsx` / `LeftPanel.tsx`:

- One controller per editor window and file (`fileId` = `sha256(path)[:16]`, `untitled-<docId>`
  or the browser library id) over `createPlatformAgentRuntime(platform, getAiProviders(platform),
  createInWindowTools(...).factory)`; CLIs launch the bundled shim from `platform.mcp.status()`.
- Canvas selection → `setSelection`; `agentCanvasProps` → `<CanvasHost agentCanvas>`;
  `noteAuthor` = the OS user (last segment of the MCP status `home`, desktop only).
- Prompt nodes: canvas footer Run / Stop and LayerRow/Prompt play run
  `controller.runPrompt(...)` (one Single turn scoped to `target`, or a new placeholder frame
  80 right of the prompt whose flag is cleared after the turn); run state in
  `state.promptRuns` (footer, layer row trailing icon).
- Side by side: `frameBox(id, n)` returns `sideBySideAnchor(...)` over the other root frames
  and the controller passes `gap: SIDE_BY_SIDE_GAP` (40) to `planSideBySide`.
- Home hand-off: the right panel opens on the Agent tab when `hasHomeHandoff(path)`, and
  `useHomeHandoff` starts it. "Ask Kimo" / ⌘K and placeholder "Review" open the Agent tab.
- Canvas context menu (MenuDense): note → Convert to prompt; a prompt + a frame selected → Set
  as target; an orphaned placeholder → Clear flag (board 22 rules). "Resume" on an orphan is not
  wired (the orphan's session may be another window's / gone).
- Window title "<Agent> editing" (`useWindowTitle(doc, agent)`), browser library tab title
  (`useWebTabTitle`), Home on an untitled document asks first (`requestClose`).
- ⇧P = Prompt, P = Pen: the editor's single-key matcher now compares `⇧<key>` when Shift is
  held.

### Tools on desktop: in-window, over the document host's replica (decision)

Desktop agents keep `createInWindowTools` over the window's store, which on desktop is the
document host's Yjs replica (`HostedDocumentSession`). Agent edits therefore reach the host and
every MCP client with their `agent:kimo.<session>.<n>` origin, and the window's own undo stack
undoes them per origin (`kimo_history`, "Undo turn"). Routing the calls through the host's
`McpHostRuntime` instead was not done because that runtime only knows `mcp:<client>.<session>`
connections: no `agent:` origins (undo / attribution would change owner), no per-op
`checkScope` targets (split / side-by-side scopes are enforced in `scopedTargets` here), and its
approvals go to the board 21 presence prompt rather than the thread card that waits until
answered. Consequence: in-app agents do not appear in the host's presence list / activity log
for MCP clients (they show on this window's canvas and Agent tab). Closing that needs a host RPC
`agentCall` with an `agent:` identity, the window's scope targets and approval forwarding.
