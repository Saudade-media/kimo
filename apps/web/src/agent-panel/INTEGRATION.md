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
  answered). A desktop window whose document is hosted by the document host uses
  `createHostTools({client, ref})` instead (host RPC `agentCall`, same `ToolHostSpec`); see
  "Tools on desktop" below.
- **Sessions**: IndexedDB `kimo-sessions` on web and desktop (the webview's IndexedDB; ADR 0014
  §7 as amended). `sessions` stays injectable (tests pass a memory store).

## 2. RightPanel.tsx: the Agent tab

Mount the panel in the Agent tab (until the file id resolves, the tab shows "Loading the agent…";
the panel already widens to 360 for this tab):

```tsx
import { AgentPanel, hasHomeHandoff, useHomeHandoff } from "../agent-panel"

{tab === "agent" && agentPanel && (
  <AgentPanel
    controller={agentPanel}
    fileName={session.ref.name}
    clis={ai.clis()}
    onOpenSettings={() => openSettings(platform, "ai-providers")}
    onOpenSkillsFolder={skillsFolderAction(platform)} // desktop: reveals ~/.kimo/skills; web: undefined, button hidden
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
import { agentCanvasProps } from "../agent-panel"
import { useAgentPanelState } from "../agent-panel/hooks"
const agentState = useAgentPanelState(agentPanel)
<Canvas agentCanvas={agentCanvasProps(agentState, {
  onRunPrompt: (id) => runPrompt(id),
})} … />
```

Live origins, persona + label per origin, enforced scopes (side by side / split / iterate),
cursors, landed edits and rejected-op flashes come from the panel; the canvas draws them per
board 36 (one cursor + a section outline per agent, a ring per landed edit on its section).
`ModeSummaryOverlay` mounts the Mode Summary (jDKaM, with Stop all) over the canvas, bottom left,
while a mode run is live (`useEditorAgentPanel().modeSummary`).

## 5. AgentMark (`@kimo/ui`)

`<AgentMark size state persona />` replaces `AgentOrb` everywhere (board 24 §4). All marks share
one WebGL context (`agentMarkRendererStats()`); ≤ 12 px, `static`, no WebGL and
`prefers-reduced-motion` draw the flat 3 × 3 mesh (AgentMark/32/Static). States: `idle`,
`listening`, `waiting`, `thinking`, `working`, `done` (arc eyes 1.6 s → idle), `paused`, `error`,
`disconnected` (error at 50 %). Personas: `teal` (lead), `iris`, `violet`, `rose`, `ember`,
`moss` — assign them with `PersonaAllocator` / `assignPersonas` (rule PqjaS).

## Board 25 "v1 Polish" §5 (p55vU) — designed, built 1:1

- **First run** (`FirstRun.tsx`, rules GXL4Z): `state.onboarding` replaces Thread Header +
  Thread; the composer stays, disabled at 50 % with "Connect a model to start"
  (`state.composerDisabled`). (a) FrS9y: no API provider passed its Test (`rt.apiReady`) and a
  signed-in CLI (board 23 order) the user hasn't chosen yet (`rt.cliConfirmed` = Settings
  default is a CLI) → AgentMark/32/Listening, "Meet Kimo", the detected-CLI card, "Use Claude
  Code" (`controller.chooseCli` → `ai.setDefault({provider: "cli:…", model: "default"})`), "Or
  add an API key →" (= `onOpenSettings`). (b) D8covN: nothing found → AgentMark/32/Static, the
  inline Anthropic key card; paste or Connect → `controller.connectKey` → `rt.connectKey`
  (`ai.setKey` + Test; on web it also sets the Anthropic browser opt-in — pressing Connect is
  the opt-in). A pass switches to an empty thread; a failure keeps the card with the field in
  danger and the Test's reason (not drawn). "Have Claude Code?…" shows on desktop only.
- **Approval** (`ApprovalCard` in `@kimo/ui`, OlhpU): one thread-level card per pending
  in-app approval (`state.approvals`, oldest first; host approvals forwarded by
  `createHostTools` land in the same queue), "Kimo wants to" + AgentMark/12/Listening +
  "paused", op rows from `approvalOps(request, {nodeName, parentName})` (icon · verb + target ·
  scope), Allow once / Always this session / Spacer / Deny. Waits indefinitely; Stop denies all.
  The composer placeholder becomes "Kimo is waiting for your approval…". More than one pending:
  the header shows "N waiting" (Session Cost pill look — not drawn).
- **Refusal** (`RefusalCard`, dIkT6): neutral card (bg-subtle, border, hand), the model's own
  text as the reason (the agent bubble is not drawn for a refusal), "Edit request" →
  `controller.editRequest(turnId)` prefills the composer.
- **Generic error** (u8mh7l): `IconErrorCard` (circle-x) "Something went wrong", the provider
  message + "Nothing was changed on the canvas." when no op landed, Retry (or Open settings
  for unknown model / unsupported platform) + Copy error. Specific states keep AgentErrorCard.

`<AgentPanel>` optional props: `nodeNameOf(id)` / `parentNameOf(id)` (op row "in Pricing"),
`platform` (default: Tauri → desktop). The editor wires the two name lookups in
`useEditorAgentPanel` (`editor/agent-panel.tsx`, layer name or id; top-level nodes have no parent).

### Still not designed (decided here)

- Approval op icons other than trash-2 / variable (pencil, plus, component, save, download,
  file-plus, folder-open, square-dashed) and their copy.
- Steps of older finished turns are collapsed; the "Using …" row shows only for non-default
  skills.
- Side by side / split children run only on API providers; Iterate works with CLIs.

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
- Canvas context menu (board 25 §3, `editor/CanvasMenu.tsx` + `editor/context-menu.ts`): agent
  group first — note → Convert to prompt; prompt → Run prompt · Set as target (pick mode);
  placeholder → Clear flag; orphan → Resume agent (`resume.ts`: `placeholderSession`,
  `resumeAgentSession` = `openSession` + `send` continuation on the same session origin) or "Ask
  Kimo to finish" when the session is gone (`askKimoToFinish`: new session, composer prefilled).
- Window title "<Agent> editing" (`useWindowTitle(doc, agent)`), browser library tab title
  (`useWebTabTitle`), Home on an untitled document asks first (`requestClose`).
- ⇧P = Prompt, P = Pen: the editor's single-key matcher now compares `⇧<key>` when Shift is
  held.

### Tools on desktop: through the document host (`agentCall`)

`editor/agent-panel.tsx` `agentToolsFor` picks the tool host per window: when the host client is
connected and the session is a `HostedDocumentSession` attached to the host (`hosted`), the
factory is `createHostTools` (`agent-panel/host-tools.ts`); otherwise (web, an older shell with
no host, untitled documents) it is `createInWindowTools`. With the host:

- Every registry call is the RPC `agentCall {spec: {origin, label, session, policy}, name,
  input}`. The host runs it on a runtime connection with identity `{client: "kimo", label,
  session, transport: "in-process"}` and origin `agent:kimo.<session>.<n>` (one per window and
  origin; a new turn's policy replaces the old one). The agent therefore appears in the host's
  presence (`kimo://mcp-connections`, topbar chips, `kimo_get_state.agents`) and activity log
  next to MCP clients, can be paused, and Activity › Undo (`agentUndo`) reaches it.
- Undo / attribution stay per origin: edits land on the host store as the agent's origin (its own
  undo stack, "Undo turn" / regenerate via `kimo_history`), reach this window's replica as
  `remote:agent:…` (never on the user's ⌘Z) and an MCP client's undo never touches them.
- Scope: the window sends `policy.nodes`; the host runs the same `checkScope`
  (`scopeViolations`) against the authoritative tree → OUT_OF_SCOPE as before.
- Approvals: forwarded to this window (`kimo://host-agent-approval`) and shown as the agent's
  in-thread card; they wait until answered (Stop = deny), never on the board 21 prompt queue.
  The RPC has no timeout; a host restart fails the call TIMEOUT (retryable).
- Agent-only tools (`kimo_spawn_agents`) run in the window. `dispose()` (editor unmount) and the
  window's `release` close its agent connections.
- The model sees the registry's `desktop` tool column (the in-window host uses `web`).
