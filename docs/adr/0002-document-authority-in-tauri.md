# 0002. Document authority inside Tauri: a dedicated document host context (Option A)

- **Status:** Accepted; amended by [0012](0012-m4-desktop-and-files.md) §2 (Option A confirmed; in M4 the host runs co-located in the editor window, and the hidden-webview host arrives with M5)
- **Date:** 2026-10-02
- **Teardown refs:** 9.4 (document lives in the app; document authority ADR; single writer per file; failed loads are terminal), 9.3, 11.1 (`docId` lifetime, revisions), 11.2 (error codes), 6.3 (where pen.dev's bugs cluster)

## Context

On desktop, the Yjs document store lives in JavaScript, while the MCP socket
(`~/.kimo/socket/kimo.sock`, a named pipe on Windows), the localhost Streamable HTTP endpoint and
the file system live in Rust. MCP writes must go through the running app's store, never directly
to the file, so exactly one context is the authority for each open document (9.4). The relay
between Rust and the store has to be explicit, including what happens when a window reloads or
when no window is open. pen.dev's reported bugs (wrong-document targeting, empty documents saved
over real ones, stale screenshots) cluster at exactly this seam (6.3, `[gh pen#6]`, `[gh pen#13]`).

Teardown 9.4 offers two options:

- **Option A.** The store runs in one dedicated JS context (a hidden webview or a Bun/Node
  sidecar). Every UI window is a client.
- **Option B.** Rust relays each MCP request to the window that holds the document over
  request/response IPC with a timeout, and returns `DOCUMENT_NOT_OPEN` when no window holds it.

## Decision

**Option A, using a hidden Tauri webview as the document host.**

1. **Document host.** The desktop app starts one hidden webview, the *document host*, at launch.
   It loads a headless entry of `@kimo/web` that contains `editor-state`, `sync` (local file
   provider), the validator and the headless raster path, and no UI. It holds the authoritative
   Y.Doc for every open document, owns the per-file lease (9.4), the autosave/recovery pipeline,
   revisions (`{epoch, seq}`) and the op log.
2. **UI windows are replicas.** Each editor window holds a replica Y.Doc per document it shows
   and syncs with the host using the standard Yjs sync protocol (state vector + updates) over
   Tauri IPC events, through a `sync` provider. User ops are still validated and applied by the
   op layer with origin `user`; the resulting update flows to the host, which assigns the
   revision. This is the same provider shape as the future network provider, so the window–host
   link exercises the multiplayer code path from M4 on ([0001](0001-monorepo-and-server-readiness.md)).
3. **Rust is a router, not an authority.** Rust forwards MCP JSON-RPC requests from the socket and
   HTTP endpoint to the host over request/response IPC with a timeout (default 30 s, per-tool
   override for renders and exports), and forwards results back. Rust never touches document
   content, except to perform the atomic write + rename + read-back that the host requests.
4. **Web build.** In the browser there is one JS context; the tab is the document host and the
   UI in the same context. The same host module is used, without IPC.

### Window reload behaviour

- **A UI window reloads or crashes:** the host is unaffected, so no edit is lost and no MCP call
  fails. The window reconnects and resyncs from the host's state vector. Local ops that had not
  reached the host before the reload are lost (at most one IPC round trip of input).
- **The host reloads or crashes:** in-flight MCP requests fail with `TIMEOUT` and a
  `retryable: true` hint. Rust restarts the host, which mints a **new epoch**, reloads each
  previously open document from its last autosave plus its recovery file
  (`~/.kimo/recovery/<hash>`), and reacquires leases. Old `docId`s and `baseRevision`s are now
  stale: calls with them return `DOCUMENT_NOT_OPEN` (carrying the new `docId` for the path) or
  `REVISION_CONFLICT`, as specified in 11.1. UI windows resync from the host and show a
  "recovered" notice. A document whose reload fails stays `LOAD_FAILED` and read-only; it is
  never saved over (9.4, "failed loads are terminal").

### No-window behaviour

- **App running, no window open** (e.g. all windows closed on macOS): the host keeps running and
  keeps documents open. MCP calls work normally, including `kimo_open`, `kimo_render` and
  `kimo_save`. `kimo_focus` and other viewport-only tools return an `ok` result with a warning
  that no window is showing the document. Documents are closed explicitly (`kimo_close`, or the
  user closing them) and autosave keeps running.
- **App not running:** the `kimo-mcp` shim cannot reach the socket. It reports that the app is
  not running; agents can use headless `kimo mcp`, which takes the file lease itself (9.4). If the
  app starts later and the lease is held by a live headless process, the app opens that file
  read-only or attaches over the socket; it never opens a second writer.

## Consequences

- Exactly one authority per document regardless of how many windows exist, which removes the
  multi-window ambiguity behind `[gh pen#13]`.
- Window reloads (common during development and after GPU resets) never interrupt agents.
- The window–host link is a Yjs sync provider, so M4 builds and tests most of what the v2 network
  provider needs.
- Cost: a second webview's memory (one per app, not per document), a headless build entry of
  `@kimo/web`, and an IPC protocol to version and document alongside `docs/spec/socket.md`.
- Hidden webviews may be throttled by the OS. The host must not depend on `requestAnimationFrame`
  or timers being punctual: autosave debounce uses wall-clock deadlines, and renders use the
  headless raster path rather than an on-screen WebGL surface. GPU smoke tests per OS (13.3)
  include the hidden host.
- The error envelope (11.2) gains an optional `retryable` boolean on each error; the MCP spec
  must document it.
- Option A must be prototyped at the start of M4; if hidden-webview throttling proves unworkable
  on any OS, the fallback is a Node/Bun sidecar (see alternatives), which needs a new ADR.

## Alternatives considered

- **Option B (Rust relays to the owning window).** Simplest to build, but the document's lifetime
  is tied to a window: a reload drops in-flight requests *and* the live store, closing the last
  window closes the document under a running agent, and two windows showing one document need a
  tie-break rule. These are precisely the failure modes of 6.3. Rejected.
- **Option A with a Bun or Node sidecar as host.** Clean process isolation and no throttling, but
  it ships a second JS runtime (tens of MB, and `bun build --compile` carries the LGPL relinking
  obligation, see [0008](0008-mcp-sidecar-in-rust.md)) and the host could not share the
  CanvasKit/WebGL code path with the UI. Kept as the fallback.
- **Store in Rust (e.g. yrs) with JS as a client.** Removes the IPC to the host for MCP, but
  duplicates the op layer, validation and resolver in a second language, breaking the
  "one engine" rule of [0001](0001-monorepo-and-server-readiness.md). Rejected.

## Revisit when

The M4 prototype measures host memory or throttling problems, or multiplayer (v2) moves authority
to a server.
