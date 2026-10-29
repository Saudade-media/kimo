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
  `test/agent/host.test.ts` proves both.

## Mount points for the editor and the Agents UI (builder 4 / lead)

```ts
const host = runtime.hostClient   // set by createAppRuntime (connectWindowToHost); null in the browser and in tests

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
| `kimo://host-rpc` | window → host | `{from, id, method, args}`. Methods: `ping`, `open`, `release`, `command`, `agentUndo`, `mcpState` (connections, pending prompts, paused clients), `mcpPause` (`{client, paused}`) and the in-app agent calls `agentCall` (`{spec: {origin, label, session, policy}, name, input}` → `{result, images?}`; no timeout on the window side), `agentApproval` (`{id, outcome}`), `agentTurn` (`{spec, phase: "start" | "end", turnId}`: stamps and, at the end, releases the agent's area claims), `agentRelease` (`{origins?}`), `agentDocId` (`{ref}` → `{docId}`), and for rooms joined from a share link `room.attach`, `room.info`, `room.detach`, `room.asset` and `room.assetStored` (see below). |
| `kimo://host-rpc-reply` | host → window | `{id, ok, value?, error?}` |
| `kimo://host-cloud` | host → all | `HostedFilesView`: the Kimo Cloud workspace bindings, open rooms and re-share progress the host holds (`cloud-host.ts`; asked with `mp.cloud.view`). The `mp.cloud.*` methods (`shareFile`, `localCopy`, `refresh`, `migrate`) answer `{ok, value}` or `{ok: false, error: {kind, code, message}}`, so a `CloudError` keeps its code. |
| `kimo://host-sync` | both | `{from, msg: HostSyncMessage}` (`@kimo/sync` host-sync, base64 Yjs updates with their origin) |
| `kimo://host-session-state` | host → windows showing the file | `{ref, state: SessionState}` |
| `kimo://host-focus` | host → windows showing the file | `{ref, ids, select, zoom}` |
| `kimo://host-window-state` | window → host | `{from, ref, selection}` |
| `kimo://host-agent-approval` | host → the agent's window | `{id, origin, request: ApprovalRequest}`: an in-app agent's approval, shown as its in-thread card; answered with `agentApproval`. |
| `kimo://host-ready` | host → all | Emitted when the host (re)starts; windows reopen and resync, and the replica keeps edits it has not sent yet. |
| `kimo://room-sync` | both | `{from, msg: HostSyncMessage}` for rooms joined from a share link: the window's room store is the hub, the host holds a replica (`room-docs.ts`). |
| `kimo://room-asset` | host → the room's window | `{id, ref, src}`: an asset a render of the room needs; answered with the RPC `room.asset {id, data}` (base64, or null). |
| `kimo://room-asset-put` | host → the room's window | `{id, ref, key, data, width?, height?}`: an image an agent adds (`kimo_import kind=image`, `kimo_assets import`); the window stores it in the room's asset store and answers with the RPC `room.assetStored {id, error}` (null, or `gone`, `read-only`, `too-large`, `rejected`, `failed`). |

## Rooms joined from a share link (#79)

A room joined from a link lives in its window: the link, the room key, the relay connection and
the assets never leave it. `serveRoomsToHost` (window) attaches each room the window keeps joined
with `room.attach {ref: "kimo-room:<room>", relay, role, readOnly}`, again after `host-ready`,
updates it with `room.info` and ends it with `room.detach {ref}` (the room was left, its tab
closed, or the window is closing). `createHostRooms` (host) keeps a replica per room, synced over
`kimo://room-sync`, and lists it as an MCP document with `shared: {relay, role}` in
`kimo_get_state`. A view link's replica is read-only (READ_ONLY), and so is a room whose connection
ended for good (a revoked link, a closed room); the window drops any update from the host while its
room store is read-only. An image an agent adds goes to the window over `kimo://room-asset-put`;
the room's asset sync uploads it like a pasted one, since edits the host relays (`remote:mcp:…`)
count as made on this device. The holder window is a viewer of the ref, so
`kimo_focus` and the selection report (`kimo://host-window-state` with the room key) work as for
files. A window that pings again (its page reloaded) loses the rooms its old page held.

On desktop a room stays joined while its tab is open, in front or not; closing the tab leaves it.

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

- `test/agent/host.test.ts`:
  - the host conformance suite against this host (memory platform);
  - a window ↔ host round trip covering replica sync, the user's ⌘Z versus the agent's undo,
    focus, selection, a ⌘S save through the host, and release on close;
  - two windows sharing one host document under one lease;
  - the Rust relay contract against a fake event bus.
- `test/collab/document-host.test.ts`: rooms joined from a share link as MCP documents (listed with
  their role and relay, edits reach the owner through the window, a view link refuses edits, no
  link secret in results, selection, unlisted once left), over a real in-process relay.
- `test/agent/host-agent.test.ts`: `agentCall` origins, presence, activity, per-origin undo,
  `checkScope` in the host, forwarded approvals (no MCP timeout; Stop / release answer deny) and
  the host / in-window tool host choice.
