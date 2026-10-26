# M5 document host: integration

ADR 0002 (Option A), ADR 0012 §2 and ADR 0013 §7 / §12 item 2. A single hidden webview, the
**document host** (`document-host`, `index.html#/host`), holds the authoritative store of every
open document. Editor windows are clients of it, and it also serves the MCP connections that
Rust relays to it.

```
agent ─stdio─▶ kimo-mcp ─socket─▶ Rust ─kimo://mcp-in──────────▶ document host (#/host)
                                  Rust ◀─kimo_mcp_send──────────  ├─ FileSessionManager (lease, autosave, recovery, git)
editor window ─kimo://host-rpc / kimo://host-sync (Yjs)───────▶  ├─ HostSyncHub (window ↔ host Yjs sync)
editor window ◀─kimo://host-session-state / host-focus────────   └─ @kimo/mcp-server: handlers + runtime (approvals, activity, presence)
```

## What is already wired (no action needed)

- `platform/runtime.ts` `createAppRuntime`:
  - In Tauri with `#/host`, it calls `startHostRoute(platform)` and **never resolves**. As a
    result the host route renders nothing and never calls `kimo_launch_take_initial`.
  - In Tauri editor windows (any route except `#/settings`), it returns at once, so the window
    renders without waiting for the host, and calls `connectWindowToHost()` in the background.
    That re-pings every 150 ms and on `kimo://host-ready` (an event sent before the host listens
    is lost), for up to 10 s. The session manager gets the result as `sessionFactory`: every
    open waits for it, then uses `hostedSessionFactory(client)` when the host answered, or local
    sessions (an older shell), as in M4. `runtime.hostClient` and `platform.mcp` are set before
    that first open resolves. The Settings window still waits (3 s at most) before rendering.
- `platform/session.ts` has a new `SessionManagerOptions.createSession`. A
  `HostedDocumentSession` is a `FileDocumentSession`:
  - its store is a replica that `WindowSyncProvider` keeps in sync with the host's store;
  - its `state()`, `save`, `saveAs`, `flush`, banner actions, git and consent choices, and
    `undoExternal` all run in the host through RPC;
  - untitled documents stay local to the window (they have no path, so agents cannot target
    them).
- Undo per origin: user edits carry `origin: "user"` on the window's replica, and agent edits
  arrive there as `remote:mcp:<client>.<session>`. The window's ⌘Z therefore only undoes the
  user's edits, and an agent's `kimo_history undo` only undoes that agent's own edits. The
  e2e `m5-host` and `test/m5-host.test.ts` prove both.

## Mount points for the editor and the Agents UI (builder 4 / lead)

```ts
import { getHostClient } from "../host"   // null in the browser and in tests

const host = getHostClient()

// kimo_focus: select and/or zoom the requested nodes in the window that shows `ref`.
useEffect(() => host?.onFocus(({ ref, ids, select, zoom }) => {
  if (ref !== documentSession?.ref) return
  if (select) session.ui.getState().select(ids)
  if (zoom === "fit") canvas.current?.zoomToFit(ids, 96)
  else if (zoom === "100") canvas.current?.zoomTo?.(1)
}), [host, documentSession, session])

// kimo_get_state.selection: report the selection, debounced, when it changes.
session.ui.subscribe((s) => host?.reportSelection(documentSession.ref, s.selection))

// AgentsController.undoEntry(entry): undo an agent's op group from the activity log.
host?.agentUndo(documentSession.ref, entry.origin, entry.undoToken)   // → { ok, stale }

// Canvas tint: an agent's edit reaches the replica with origin `remote:mcp:<client>.<session>`.
store.onChange((c) => { if (c.origin.startsWith("remote:mcp:")) tint(c.nodes, c.origin.slice(7)) })
```

The host emits the `@kimo/platform` `TauriMcpEventMap` events to every window:
`kimo://mcp-connections` (`McpConnectionInfo[]`), `kimo://mcp-approval-request`,
`kimo://mcp-approval-resolved` and `kimo://mcp-activity` (`{fileId, entry}`). A window answers a
prompt with `emitTo("document-host", "kimo://mcp-approval-answer", {id, choice})`. If the prompt
gets no answer within 2 minutes, the call fails with PERMISSION_DENIED. "Allow for this session"
remembers op kinds only; a `session` answer to a file or scope prompt counts as `once`.
Settings broadcasts `kimo://mcp-policy-changed` (`{client, policy}`) after `policies.set`: the host
applies it to that client's live connections and, with `autoApprove` on (board 34; the default
since ADR 0013 Addendum 8), resolves its pending prompts as `auto`; other windows update their
policy view (`policies.onChange`).

Optional cleanup: `main.tsx` could branch on `isHostRoute(location.hash)` before rendering. This
is not required, because `createAppRuntime` never resolves for `#/host`.

## Rust contract used (builder 1)

| Direction | Name | Payload |
|---|---|---|
| Rust → host | `kimo://mcp-connection` | `{connectionId, state, transport, hello?}`. Repeated announcements are ignored. The session is the connectionId without `c_`. When `hello.client` is missing or `"unknown"`, the client comes from `initialize.clientInfo.name`. |
| Rust → host | `kimo://mcp-in` | `{connectionId, message}`: one raw JSON-RPC line. Lines that arrive before the connection is announced open it implicitly. |
| Rust → host | `kimo://mcp-http-request` | One SDK `WebStandardStreamableHTTPServerTransport` per `mcp-session-id`; the client comes from `x-kimo-client`. |
| host → Rust | `kimo_mcp_send` | `{connectionId, message}`. `NOT_FOUND` closes the connection. |
| host → Rust | `kimo_mcp_http_respond` | The first call carries status and headers, then the chunks, then `end`. |
| host → Rust | `kimo_mcp_host_ready` | `{version}`, sent on every page load after the listeners are installed. |
| host → Rust | `kimo_mcp_policies_get` | Read on start and before each new connection. |
| host → Rust | `kimo_mcp_activity_append` / `_read` | Activity persistence. The host falls back to memory when these are unavailable. |

Window ↔ host events are JS only; Rust just routes them, and both sides need
`core:event:allow-emit-to` plus `allow-listen`:

| Event | Direction | Payload |
|---|---|---|
| `kimo://host-rpc` | window → host | `{from, id, method, args}`. Methods: `ping`, `open`, `release`, `command`, `agentUndo`, `mcpState` (connections, pending prompts, paused clients), `mcpPause` (`{client, paused}`) and the in-app agent calls `agentCall` (`{spec: {origin, label, session, policy}, name, input}` → `{result, images?}`; no timeout on the window side), `agentApproval` (`{id, outcome}`), `agentTurn` (`{spec, phase: "start" | "end", turnId}`: stamps and, at the end, releases the agent's area claims), `agentRelease` (`{origins?}`) and `agentDocId` (`{ref}` → `{docId}`). |
| `kimo://host-rpc-reply` | host → window | `{id, ok, value?, error?}` |
| `kimo://host-sync` | both | `{from, msg: HostSyncMessage}` (`@kimo/sync` host-sync, base64 Yjs updates with their origin) |
| `kimo://host-session-state` | host → windows showing the file | `{ref, state: SessionState}` |
| `kimo://host-focus` | host → windows showing the file | `{ref, ids, select, zoom}` |
| `kimo://host-window-state` | window → host | `{from, ref, selection}` |
| `kimo://host-agent-approval` | host → the agent's window | `{id, origin, request: ApprovalRequest}`: an in-app agent's approval, shown as its in-thread card; answered with `agentApproval`. |
| `kimo://host-ready` | host → all | Emitted when the host (re)starts; windows reopen and resync, and the replica keeps edits it has not sent yet. |

## In-app agents (`agentCall`, ADR 0014 §5)

On desktop the Agent tab's tools run here: `editor/agent-panel.tsx` `agentToolsFor` picks
`createHostTools({client, ref})` when the window's session is hosted (`HostedDocumentSession.hosted`),
else `createInWindowTools`. The host opens one runtime connection per (window, agent origin)
with `origin: agent:kimo.<session>.<n>`, the window's policy (`policy.nodes` = scope, checked
with `scopeViolations` / `checkScope` on the host store) and a `requestApproval` that forwards
to the window and waits until answered. So the agent is in `kimo://mcp-connections`, the
activity log, `kimo_get_state.agents`, pause and `agentUndo`; its edits reach the replica as
`remote:agent:…` (never on the user's ⌘Z) and an MCP client's undo never touches them.
`release` of the window's last document (or `agentRelease`) closes its agent connections.

## Tests

- `test/m5-host.test.ts`:
  - the host conformance suite against this host (memory platform);
  - a window ↔ host round trip covering replica sync, the user's ⌘Z versus the agent's undo,
    focus, selection, a ⌘S save through the host, and release on close;
  - two windows sharing one host document under one lease;
  - the Rust relay contract against a fake event bus.
- `e2e/m5-host.e2e.ts` (harness `e2e/m5-host-harness`): the real editor as a host client. An MCP
  edit shows up in the layers panel; ⌘Z undoes only the user's rename; the agent's undo removes
  its card from the editor. An in-app agent through `agentCall` (`__kimoHost.agentCall`): its
  edit shows in the layers panel, presence and the Activity tab; the MCP client sees it in
  `kimo_get_state.agents` and cannot undo it; ⌘Z keeps it; a scoped child gets OUT_OF_SCOPE.
- `test/m6-host-agent.test.ts`: `agentCall` origins, presence, activity, per-origin undo,
  `checkScope` in the host, forwarded approvals (no MCP timeout; Stop / release answer deny) and
  the host / in-window tool host choice.
