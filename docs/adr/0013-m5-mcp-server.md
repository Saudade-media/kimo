# 0013. M5 MCP server: one tool registry, typed ops, the socket protocol, attach vs headless, permissions and the host installer

- **Status:** Accepted
- **Date:** 2026-10-04
- **Deciders:** maintainers (M5 contract phase, before the parallel build)
- **Teardown refs:** 5 (pen.dev's MCP surface and its weaknesses, 5.7), 9.1 (layout and dependency rules), 9.2 (MCP, MCP sidecar, web-only MCP rows), 9.4 (one tool registry, the document lives in the app, document authority, single writer per file), 11 (MCP tool set), 12 (M5 row)
- **Builds on:** [0002](0002-document-authority-in-tauri.md) + [0012](0012-m4-desktop-and-files.md) §2 (Option A; the hidden-webview document host arrives with M5), [0008](0008-mcp-sidecar-in-rust.md) (Rust stdio shim), [0011](0011-m3-components-and-variables.md) (M3 command planners)

## Context

M5 makes Kimo editable by external coding agents (Claude Code, Codex, Gemini CLI, Cursor, VS Code)
over MCP. pen.dev's surface (teardown 5) shows what to avoid: one opaque JS `execute` tool,
prose-only results with no error codes, no revisions, a fallback to the "active" document,
undocumented socket protocol, zombie processes, config clobbering and an empty-properties
schema that broke OpenAI-compatible providers (5.7). Several builders work in parallel (desktop
shell / Rust, document host, headless CLI, editor UI, a designer in `desing.pen`), so the seams
are fixed here. The contract lives in code in `packages/mcp-server` (`@kimo/mcp-server`),
`packages/platform/src/mcp.ts` and the "M5 agents" section of
`apps/web/src/platform/contract.ts`; this ADR explains it.

## Decision

### 1. Package and dependencies

`@kimo/mcp-server` depends on `@kimo/core-schema`, `@kimo/editor-state`, `typebox` (already used by
core-schema) and the official MCP TypeScript SDK **`@modelcontextprotocol/server` 2.3.0**
(+ `@modelcontextprotocol/node` for the Node HTTP adapter). Verified on npm 2026-10-03: v2 is
`latest`; it negotiates protocol eras up to 2026-07-28 and bundles Ajv
(`/validators/ajv`). Entries: `.` (registry, envelope, ops, policy, protocol, topology,
runtime: no SDK and no Node imports, so the M6 agent can use it in the browser), `./server` (MCP
SDK adapter), `./installer` (node:fs). `apps/web` may import it (types only in M5).

### 2. Tool set (teardown 11.3 minus `kimo_browser` and `kimo_spawn_agents`)

20 tools, each one `ToolDef` in `src/tools/*` and listed once in `src/registry.ts`:

| Tool | Scope (min → per call) | Annotations | Notes |
|---|---|---|---|
| `kimo_get_state` | read | read-only | Entry point: all open docs, selection, top-level nodes, components, variables summary, other agents, your permissions |
| `kimo_read_docs` | read | read-only | `index, schema, ops, components, tokens, layout, text, errors, envelope, guide/*`; also resources `kimo://docs/{path}` |
| `kimo_open` | read (+ file allow-list) | read-only | Never writes; LOAD_FAILED leaves the file untouched; DOCUMENT_LOCKED with holder; `readOnly` |
| `kimo_query` | read | read-only | Selectors (ids, under, topLevel, name, type, text, component), depth with `"…"` elision, resolveVariables + theme, resolveInstances, include bounds/problems/geometry/origin/overrides, fields, cursor pagination. Never a whole-document dump |
| `kimo_apply_ops` | edit → delete if any destructive op | destructive hint | ≤ 500 typed ops (§5), `baseRevision`, `dryRun`, `label`, `render` |
| `kimo_render` | read | read-only | PNG via the headless CanvasKit raster (`Renderer.exportRaster`), always post-commit; ≤ 8 nodes, `maxSize`. `format: svg` (M7): `@kimo/exporters` `svgOf` per node, markup in `data.images[].svg` (no image content), text measured with the canvas's Paragraph and fonts (ADR 0015) |
| `kimo_get_variables` | read | read-only | Incl. libraries, resolve per theme, usages |
| `kimo_list_components` | read | read-only | Local + library, declared props, slots, instance counts |
| `kimo_find_space` | read | read-only | ≈ FindEmptySpace |
| `kimo_validate` | read | read-only | Same engine as `kimo validate` |
| `kimo_history` | read → edit for undo/redo | write | Per-origin undo, optional `token` (= undoToken) guard, stale reporting |
| `kimo_save` | edit + `save` grant | idempotent write | Atomic + read-back; never "Saved" without verification |
| `kimo_focus` | read | view-only write | NO_WINDOW warning headless |
| `kimo_import` | edit | write | svg, image, tokens-dtcg, tokens-css; dryRun + baseRevision |
| `kimo_assets` | read → edit for import | write | list, import, fonts, check_font; generate/job_status UNSUPPORTED in M5 |
| `kimo_export` | read + `export` grant | idempotent write | `png`, `kimo`, and (M7, ADR 0015) `react-tailwind`, `html-css`, `tokens-*`, `tailwind-theme`, `svg`, `pdf` via `exportDocument` (inline without `outDir`); svg/pdf get the scene's export kit: layout + Paragraph measurer after the document's faces loaded (bundled Inter / JetBrains Mono, document font assets, the host's local fonts and font cache), and PDF embeds those font files; FILE_EXISTS unless `overwrite` |
| `kimo_create` | edit + `files.create` grant | write | FILE_EXISTS, never overwrites |
| `kimo_close` | read → edit (save) / delete (discard) | destructive hint | Refuses dirty docs unless save/discard |
| `kimo_styles` | read → edit for apply | write | Presets; content can arrive later (may list none) |
| `kimo_script` | delete | destructive hint | **Stub** (§5) |

The user-facing read categories in the M5 brief map as: documents/list + document/info →
`kimo_get_state`; nodes/get (depth, resolve) + nodes/find → `kimo_query`; variables/get →
`kimo_get_variables`; components/list → `kimo_list_components`; render/screenshot →
`kimo_render`; export/code → `kimo_export`.

Resources: `kimo://schema/0.1`, `kimo://docs/{path}`, `kimo://doc/{docId}`,
`kimo://doc/{docId}/node/{id}`, `kimo://doc/{docId}/variables` (the per-doc ones subscribable,
updates debounced 250 ms). Prompts: `kimo-design-screen`, `kimo-implement-design`. Server
`instructions` (sent at initialize) name the five-step loop.

### 3. Strict schemas: the portable profile

Schemas are TypeBox built only through `src/schema.ts` helpers, so they stay in a **portable
profile** that Anthropic, OpenAI/Codex and Gemini all accept and that compiles under Ajv strict:
root `type: object`; every object declares `additionalProperties` and non-empty `properties`;
open objects (`.kimo` node bodies and field maps, validated server-side against the format)
must carry a description; single `type` strings, no `null`; literals as one-value `enum`
(never `const`); unions as `anyOf` only; no `$ref`/`$defs`/`oneOf`/`allOf`/`not`/`if`/
`patternProperties`/`propertyNames`; arrays always have `items`; every property has a
description. Map-like inputs are arrays of entries (`set_variables.set: [{name, variable}]`)
rather than open maps. "Strict" means Ajv-strict + portable, not OpenAI structured-output
`strict: true` (that would force every property to be required). Gemini CLI strips
`additionalProperties` client-side; the server validates every call anyway (Ajv, structured
INVALID_INPUT with paths; the SDK gets a pass-through validator so its prose errors never
appear).

CI (`test/schemas.test.ts`): every input and output schema passes `checkPortable` and Ajv
strict; names unique; docId required exactly when the tool targets a document; read-only
annotations imply non-mutating; the M5 tool list is pinned; a **context budget** keeps
`tools/list` < 64 KB (≈ 49 KB today; `kimo_apply_ops` < 28 KB). `generated/tools.json` (the
`tools/list` payload) is checked by `check:generated` and embedded by the Rust shim.

### 4. Result envelope (teardown 11.2)

`ToolResult = ToolSuccess<T> | ToolFailure` (`src/envelope.ts`). Success: `ok, summary, doc,
revision {before, after}, warnings, data` and for mutating tools `ops, inverse, created
[{key,id}], changed, undoToken, dryRun`. Failure: `ok:false, summary, errors[{code, message,
path, nodeId, suggestion, retryable, detail}], rolledBack: true, revision, retryId`. Codes:
`DOCUMENT_NOT_OPEN, DOCUMENT_LOCKED, LOAD_FAILED, READ_ONLY, REVISION_CONFLICT, NODE_NOT_FOUND,
NODE_EXISTS, INVALID_PROPERTY, INVALID_INPUT, SCHEMA_VIOLATION, OUT_OF_SCOPE,
INSTANCE_STRUCTURE, CYCLE, BATCH_TOO_LARGE, ASSET_NOT_FOUND, FILE_EXISTS, FILE_NOT_FOUND, TIMEOUT,
PERMISSION_DENIED, APP_NOT_RUNNING, PROTOCOL_MISMATCH, UNSUPPORTED, RATE_LIMITED, INTERNAL`
(TIMEOUT, RATE_LIMITED and APP_NOT_RUNNING are `retryable`). MCP mapping: `structuredContent` =
the envelope (validated by each tool's `outputSchema`), content = [summary text, envelope JSON
text for hosts without structured content, images…], `isError` on failure. Planner refusals
(core-schema `PlanErrorCode`) map to INVALID_INPUT / NODE_NOT_FOUND / READ_ONLY (library) /
CYCLE / INSTANCE_STRUCTURE with the planner message; editor-state `OpErrorCode`s map 1:1
(INVALID_OP/INVALID_ID → INVALID_INPUT).

### 5. Typed ops and the script decision

`kimo_apply_ops` takes 24 wire ops (`src/ops.ts`), each 1:1 with an editor-state `Op` or an M3
command: `insert, update, replace, move, delete, copy, set_variables, set_theme_axes` →
`Op`s (`replace`, `copy` expand against the document); `instantiate, make_component, detach,
set_override, reset_override, set_args, swap_instance, declare_prop, remove_prop, set_slot,
create_variable, update_variable, rename_variable, delete_variable, set_theme_pin, theme_axis`
→ `M3Command`s planned by `planCommand` against the document as already changed by the earlier
ops of the call. The whole call is **one** `DocStore.apply` (one transaction, origin
`mcp:<client>.<session>`, one undo step, inverse in the op log). Node references accept an id or
`@key` of a node created earlier in the call; `parent: "root"` for top level; positions are
`index`, never order keys; no `null` (use `unset` / `inherit`). `isDestructive` classifies
delete, replace, detach, remove_prop, delete_variable, unsets of variables/axes, axis delete /
value removal and slot removal with content deletion; `GLOBAL_OPS` and `COMPONENT_ORIGIN_OPS`
feed the grant rules of 11.3.

**`kimo_script` is a stub in M5**: schema frozen, status `stub`, hidden from `tools/list`
unless "Experimental tools" is on, returns UNSUPPORTED. Reason: a QuickJS sandbox is a security
surface on its own, and typed ops with `@key` (500 per call) already give agents one-round-trip
composition, which was the main benefit of pen.dev's `execute` (5.8).

### 6. Concurrency, attribution, permissions, approvals, activity (teardown 11.4)

- **Origin** per connection: `mcp:<client>.<session>`; `client` = slug from the shim's
  `--client` flag (written by the installer) or MCP `clientInfo.name`; `session` = 6 base-36
  chars minted at connect. Each connection has its own undo stack (reconnecting starts a new
  one); attribution groups by `client`.
- **Revisions**: `baseRevision` → REVISION_CONFLICT with `detail {current, changed[]}`; another
  epoch always conflicts; without it the write applies. `dryRun` = `apply({dryRun})`.
- **Undo**: `kimo_history` undo/redo the caller's own origin only (guarded replay, `stale`);
  `undoToken` refuses if that group is not on top. `inverse` stays informational.
- **Policy** per client (`ClientPolicy`, Settings › Agents, `~/.kimo/mcp/policies.json`): level
  `read` / `edit` / `edit+delete`, file allow-list (globs), node scope (M6 children), grants
  (`globals, components, save, export, files.create`), `onExceed: ask | deny`,
  `confirmDestructive`. Defaults: unknown clients `edit`, no extra files, ask, confirm
  destructive; headless `--allow <level>` (default `edit+delete`), `--files <glob>…` (default
  `<cwd>/**`), deny (no UI).
- **Authorization order** (`authorize`): file allow-list → node scope → level → grants →
  destructive confirmation. Files already open in the app count as allowed.
- **Approvals**: an out-of-policy call becomes an `ApprovalRequest` shown in every window
  (prompt queue, oldest first). Choices: Deny / Allow once / Allow for this session. **No answer
  in 2 minutes → PERMISSION_DENIED** (`APPROVAL_TIMEOUT_MS`). **"Allow for this session"
  remembers op kinds, levels and grants only — never file access or node scope**, which ask on
  every call. Headless never prompts.
- **Activity log**: one entry per call outcome (edit, read, render, save, approval, denied,
  error…), with revision, node ids and undoToken. **Last 500 per file**, stored outside the
  `.kimo`: desktop `~/.kimo/activity/<fileId>.jsonl` (fileId = `sha256(path)[:16]`, like leases
  and recovery), web IndexedDB store `kimo-activity`.
- **Presence**: `AgentPresence` / `McpConnectionInfo` (state idle/reading/editing/rendering/
  waiting-approval, focus node ids) drives agent chips and the canvas tint.

### 7. Transport and the socket protocol `kimo-socket/1`

Full text: [docs/spec/socket.md](../spec/socket.md); types in `src/protocol.ts`.

- Endpoint: Unix socket `~/.kimo/socket/kimo.sock` (dir 0700, socket 0600); Windows named pipe
  `\\.\pipe\kimo-<user>` (current-user ACL). Newline-delimited JSON-RPC 2.0, UTF-8, ≤ 32 MiB per
  frame.
- Handshake: first line `kimo/hello {protocol, token, relay, client?, pid, ppid, cwd?}`; the
  token is `~/.kimo/mcp/token` (0600, rotated per app start). Errors: −32001
  PROTOCOL_MISMATCH (`data.supported`), −32002 UNAUTHORIZED, −32003 HOST_UNAVAILABLE, −32004
  HANDSHAKE_REQUIRED, −32005 FRAME_TOO_LARGE. Result: `{protocol, app, connectionId,
  heartbeatMs, documentHost}`.
- After hello the stream carries **MCP messages verbatim**; `kimo/*` methods are control
  (`kimo/ping`, `kimo/bye`, `kimo/hostRestarting`) and never reach the agent host.
- Heartbeat 10 s, 3 misses → disconnect. The shim exits on stdin EOF or when its parent pid
  disappears (polled every 2 s): no zombies.
- **Inside the app** (Option A): Rust authenticates, then relays each line to the hidden
  document host as event `kimo://mcp-in` and sends host output through `kimo_mcp_send`; the
  host runs one SDK `McpServer` per connection (`createKimoMcpServer`). Requests arriving while
  the host is `starting` are queued ≤ 15 s. Host crash: `kimo/hostRestarting`, in-flight calls
  fail TIMEOUT retryable, new epoch → stale docIds return DOCUMENT_NOT_OPEN with
  `currentDocId` (ADR 0002).
- **Streamable HTTP** (opt-in in Settings): `http://127.0.0.1:<port>/mcp` (default 47820, else
  ephemeral), loopback only, `Authorization: Bearer <per-host token>` from
  `~/.kimo/mcp/http-tokens.json`, `Host`/`Origin` validated (browser origins rejected). Rust
  forwards whole requests (`kimo://mcp-http-request`) and streams chunks back
  (`kimo_mcp_http_respond`); the host uses the SDK's web-standard Streamable HTTP transport.
- **Shim when the app is down**: answers `initialize` and `tools/list` from the embedded
  `generated/tools.json`, fails every `tools/call` with an APP_NOT_RUNNING envelope
  (suggestion: start Kimo or use `kimo mcp`), and keeps trying to connect. After a
  disconnect it reconnects for 30 s, replays the cached `initialize` / `initialized` and
  swallows the duplicate response; in-flight requests fail TIMEOUT retryable. `--launch`
  (opt-in) starts the app hidden and waits ≤ 15 s.
- Discovery: `~/.kimo/mcp/endpoint.json` `{version, pid, appVersion, socket, socketProtocol,
  http?, startedAtIso}` (0600), written when the listeners are up, removed on quit.

### 8. Attach vs headless (`kimo mcp`)

`kimo mcp [--attach | --headless] [--allow <level>] [--files <glob>]… [--no-autosave]
[--client <slug>] [--experimental]`, stdio (as `kimo mcp --help` prints it). `--allow` is the
headless permission level (`read` | `edit` | `edit+delete`, default `edit+delete`); `--files` is a
repeatable file allow-list glob (default `<cwd>/**`). For compatibility an `--allow` value that
looks like a path or glob (contains `/` or `*`) is taken as a `--files` glob. `--experimental`
lists stub tools. On start headless prints `kimo mcp: headless, files: <globs>, level <level>` to
stderr, then `kimo mcp: headless: opened|created <path>` for each document it opens.

- **auto** (default): attach when the endpoint file's pid is alive and the socket accepts a
  hello, else headless. **`--attach`**: attach or APP_NOT_RUNNING. **`--headless`**: never
  attach. (`decideMode`.) The Rust shim is attach-only and never opens files (ADR 0008).
- **Attach** = the same relay as the shim, written in TS.
- **Headless** = an in-process `McpServer` over a headless `DocumentHost`: in-memory
  `DocStore`s, the per-file lease (`kimo-mcp`, "kimo mcp (headless)") from `@kimo/platform`'s
  lock format, atomic save + read-back, autosave after 2 s idle (`--no-autosave` → only
  `kimo_save`), and on exit with unsaved edits a final save (or a recovery file when the save
  fails). Failed loads are terminal (never saved). No approvals (policy `deny`).
- **Per file** (`decideOpen`): already open → same docId; free or stale lease → writable; live
  lease of another process → DOCUMENT_LOCKED with `detail.holder` (headless: "the Kimo app has
  this file open — connect through the app") unless `readOnly: true`. If the app starts while a
  headless process holds a file, the app opens it read-only ("Locked by another app") and never
  becomes a second writer.
- **DOCUMENT_NOT_OPEN**: any unknown/stale docId, with `currentDocId` when the path is open
  under a newer epoch. There is never a fallback to an active document.

### 9. Host installer

`@kimo/mcp-server/installer`, used by `kimo mcp install|remove|status --host <h> [--scope
user|project] [--transport stdio|http] [--dry-run]` and Settings › Agents (via
`kimo_mcp_config_read/write`). Additive edits of the `kimo` entry only, backup to
`~/.kimo/mcp/backups/<host>-<ts>.bak`, atomic write, diff preview, never rewrites an unparsable
file (JSONC with comments → UNPARSABLE + snippet), no secrets for stdio. Locations (verified
against each host's docs, 2026-10):

| Host | User scope | Project scope | Entry |
|---|---|---|---|
| Claude Code | `~/.claude.json` → `mcpServers.kimo` | `.mcp.json` | `{type:"stdio", command, args:["--client","claude-code"]}` |
| Codex | `~/.codex/config.toml` → `[mcp_servers.kimo]` | `.codex/config.toml` | `command = …`, `args = ["--client","codex"]`, `default_tools_approval_mode = "approve"` only with `--auto-approve` (opt-in); a valid value the user set in the table is kept on reinstall |
| Gemini CLI | `~/.gemini/settings.json` → `mcpServers.kimo` | `.gemini/settings.json` | `{command, args, timeout: 600000, trust: false}` (HTTP: `httpUrl`) |
| Cursor | `~/.cursor/mcp.json` → `mcpServers.kimo` | `.cursor/mcp.json` | `{type:"stdio", command, args}` |
| VS Code | user-profile `mcp.json` (macOS `~/Library/Application Support/Code/User/`, Linux `~/.config/Code/User/`, Windows `%APPDATA%\Code\User\`) → `servers.kimo` | `.vscode/mcp.json` | `{type:"stdio", command, args}` |

`command` is the bundled shim (`/Applications/Kimo.app/Contents/MacOS/kimo-mcp`, reported by
`kimo_mcp_status`) or `kimo` with `args ["mcp", "--client", <host>]`. HTTP entries carry the
per-host bearer (Codex: `http_headers`). Host rows use generic icons (terminal / editor), never
vendor logos. Tests use a temp HOME only.

Codex approval mode (checked 2026-10-04 against the Codex config reference,
<https://developers.openai.com/codex/config-reference>, codex-rs `AppToolApproval` /
`mcp_tool_call.rs`, and codex-cli 0.146.0 locally): `mcp_servers.<id>.default_tools_approval_mode`
takes `auto | prompt | writes | approve` (default `auto`; per tool:
`mcp_servers.<id>.tools.<tool>.approval_mode`). `auto` asks before any tool not annotated
read-only (and before every `destructiveHint` tool) unless `approval_policy = "never"` with full
disk write; `writes` asks for every non-read-only tool; `prompt` always asks; `approve` never asks.
Scripted `codex exec` cannot answer a prompt, so with `auto` every `kimo_apply_ops` would fail.
The built-in agent's Codex adapter (Kimo-spawned, non-interactive) therefore passes
`-c mcp_servers.kimo.default_tools_approval_mode="approve"` on its command line. The installer,
which edits the user's own `~/.codex/config.toml`, writes the key only on explicit opt-in
(`kimo mcp install --auto-approve`), so the user's interactive Codex keeps its own prompts by
default (lead decision, 2026-10-04). Kimo's own per-client policy, scopes and approvals (§6) still
guard every call.

### 10. Tests and exit criteria

- In the package now: strict-schema CI, envelope shapes against output schemas, wire-op mapping
  applied to a real store, policy/approval/dispatch (timeout → PERMISSION_DENIED, session
  allowances), framing and handshake, topology decisions, installer (all five hosts: install,
  idempotence, preservation, backup, unparsable refusal, dry run, entry shapes).
- `test/conformance.ts`: the host conformance list (targeting, **no-overwrite**: FILE_EXISTS,
  LOAD_FAILED untouched, READ_ONLY save refused, export overwrite guard, verified save;
  revisions, rollback, @key, attribution and undo isolation, leases, render-after-commit,
  headless denial) as `test.todo`; each host builder calls `describeHostConformance` and
  implements every case.
- Exit (teardown 12): manual + scripted sessions with Claude Code, Codex and Gemini CLI against
  the desktop app and headless mode (documented in the PR), strict-schema CI green,
  no-overwrite conformance green.

### 11. UI and platform surface

`@kimo/platform/src/mcp.ts`: `McpHostApi` (status, connections, approvals, activity, policies,
HTTP toggle/token rotation, installer), structural mirrors of the server types, and the Tauri
surface `TAURI_MCP_COMMANDS` (14 commands, 24 after addendum 2) + `TauriMcpEventMap` (9 events). They are kept out
of the frozen `TAURI_COMMANDS` so the existing Rust mirror test keeps passing; the shell adds a
`command_list_mcp.rs` mirror. `apps/web/src/platform/contract.ts` "M5 agents": compile-time
equality of the mirrors, `AgentChip`, `ApprovalPromptView` (countdown, queue, `approvalChoices`
without "session" for file/scope), `AgentsState`, `AgentsController`. Visuals come from the M5
boards being designed in `desing.pen`; no UI is built before they exist.

### 12. Ownership for the parallel build

Frozen contract files: `packages/mcp-server/src/{schema,envelope,ops,policy,protocol,topology,
runtime,registry,resources}.ts`, `src/tools/*.ts`, `packages/platform/src/mcp.ts`, the M5
section of `apps/web/src/platform/contract.ts`, `docs/spec/socket.md`. Suggested split:

1. **Desktop shell (Rust):** socket/pipe listener, hello/token/heartbeat, HTTP listener, the 14
   `kimo_mcp_*` commands, endpoint/token files, the `kimo-mcp` shim crate (relay, offline
   tools.json, reconnect, parent watch, `--launch`), bundling.
2. **Document host:** move the session host into the hidden webview (0012 §2), window ↔ host Yjs
   sync provider, `DocumentHost` for desktop, tool handlers over `editor-state` (ops compiler
   with `@key`, query engine, render via `exportRaster`), approvals/activity/presence emitters.
3. **CLI:** `kimo mcp` (attach relay + headless host), `kimo mcp install|remove|status`.
4. **Editor UI:** agent chips, approval prompt, activity panel, Settings › Agents (hosts,
   policies, HTTP), from the `desing.pen` M5 boards.
5. **Docs:** the MIT agent guides behind `kimo_read_docs`.

## Consequences

- One tool definition serves MCP, the M6 agent and the CLI; schemas cannot drift from the
  envelope or from the generated manifest the shim embeds.
- Every agent edit is an editor-state op group: diffable, attributable, undoable per client and
  guarded by revisions, unlike pen.dev's scripts.
- The socket carries plain MCP after a one-line handshake, so the Rust shim stays a relay and
  needs no change when tools change (only the embedded manifest).
- Cost: 14 new Tauri commands and 9 events, a second Rust binary, and a ~49 KB `tools/list`
  (≈ 12k tokens) — watched by the budget test.
- The mirrors in `@kimo/platform` duplicate a few types; contract.ts catches drift at compile
  time.

## Alternatives considered

- **A Kimo-specific RPC on the socket with MCP implemented in the shim.** Puts tool knowledge in
  Rust; every tool change needs a shim release. Rejected for verbatim MCP after hello.
- **One `execute`-style script tool (pen.dev).** Opaque, runtime-only errors, prose results
  (5.8). Rejected as the primary API; kept as a stub.
- **zod schemas (the SDK's default).** Adds a second schema library next to core-schema's
  TypeBox and emits `const`/`$ref` patterns outside the portable profile. Rejected.
- **Using each host's CLI (`claude mcp add-json`, `codex mcp add`) in the installer.** Not
  testable with a temp HOME, not available for Cursor/VS Code, behaviour varies by version.
  Rejected; file edits only.
- **Session-wide allowances for files.** Convenient, but one click would hand an agent the whole
  disk for the session. Rejected (lead decision).

## Open questions

1. VS Code profiles: only the default profile's `mcp.json` is written; non-default profiles live
   under `User/profiles/<id>/`. Detect and offer them?
2. Claude Code writes `~/.claude.json` concurrently; our atomic rename can lose a write the CLI
   makes in the same instant. Acceptable, or prefer project-scope `.mcp.json` by default?
3. Headless ↔ app handoff: should the app offer "Take over" when a headless `kimo mcp` holds a
   file (ask the holder over a socket to save and release)?
4. Undo across reconnects: a new session gets a new origin, so an agent cannot undo edits from
   before a reconnect. Key the origin by `client + cwd` instead?
5. `kimo_history` "revert to revision" (11.3) needs an editor-state API; deferred.
6. Tool-context size: `kimo_apply_ops` alone is ~23 KB. If hosts complain, move op schemas to
   `kimo_read_docs path=ops` and type `ops[]` items loosely (server still validates).
7. Suggestion mode (11.4: agent batches as pending suggestions) is not in M5.

## Addendum (2026-10-04, ADR 0014)

- **`kimo_spawn_agents`** (excluded from M5, §2) arrives in M6 as an **agent-only tool** defined
  in `@kimo/ai-agent` (`createSpawnTool`), not in this registry: only the in-app lead receives it.
  Children are in-process M5 clients with origin `agent:kimo.<session>.<n>`, `ClientPolicy.nodes`
  = their frame, no grants and `onExceed: deny`; the host's `DispatchOptions.targets` fills
  `CallTargets.outOfScope` from `checkScope` (ADR 0014 §8). The registry may absorb the tool
  later if external hosts need it.
- The M6 agent calls this registry **in process** through `dispatch` (no socket). In-app
  approvals for `agent:*` origins wait indefinitely; `APPROVAL_TIMEOUT_MS` (2 minutes) still
  applies to external MCP clients, including local agent CLIs that Kimo spawns (they connect
  through the shim with `--client <cli>` from `~/.kimo/cli-workspaces/<session>/`).

## Addendum 2 (2026-10-04, M5 integration)

Additive contract changes that close the gaps the editor UI builder reported (no field or
command was removed or renamed):

- `KimoPlatform.mcp?: McpHostApi` (absent in the browser). `McpHostApi` gains `server` (start /
  stop / restart, `settings`, `setStartOnLaunch`, `setPort`, `isPortFree`, `token(client)`,
  `log`, `revealLog`), `clients` (pause / resume / paused) and `history.undo(path, origin,
  undoToken?)`.
- `McpServerStatus` gains optional `running`, `version`, `startOnLaunch`, `httpPort`, `logPath`,
  `home`, `backupDir` and `error: McpServerError` (`EADDRINUSE 127.0.0.1:<port>` with
  `suggestedPort` when HTTP fell back to an ephemeral port, `ENDPOINT_IN_USE`, `SOCKET_FAILED`,
  `HTTP_FAILED`). Settings persist in `~/.kimo/mcp/server.json` (`startOnLaunch`, default on)
  and `http.json` (`port`); the server log is `~/.kimo/mcp/server.log` (0600, rotated at 512 KiB).
- `TAURI_MCP_COMMANDS` grows from 14 to 24: `kimo_mcp_server_start`, `_stop`, `_restart`,
  `kimo_mcp_server_settings_get`, `_set`, `kimo_mcp_port_check`, `kimo_mcp_http_token_get`,
  `kimo_mcp_log_info`, `kimo_mcp_log_reveal` (granted to `mcp-host` and `mcp-ui`) and the
  host-only `kimo_mcp_scope_allow` (the document host widens Rust's deny-by-default fs scope to a
  path an MCP call was authorized for, before opening / creating / exporting it). Mirrored in
  `command_list_mcp.rs`; the parity test checks all three.
- The desktop CSP allows `'wasm-unsafe-eval'` (CanvasKit / Yoga in the document host's renders),
  and `validateInput` falls back to the interpreting `@cfworker/json-schema` validator where
  `new Function` is refused (Ajv needs eval; the CSP keeps forbidding it).
- `McpConnectionInfo` / `AgentPresence`: `call {tool, label, startedAt}` while a call runs,
  `focus` (changed node ids) and `paused`. `McpActivityEntry` / `ActivityEntry`: `label`,
  `opCount`, `revisionBefore`. `ApprovalRequest.preview.kinds`: op kind per node id, filled by a
  quiet dry run (`DispatchOptions.preview`, no activity entry, untracked handlers).
- Pause is real: `McpHostRuntime.pause(client)` makes `DispatchOptions.beforeCall` hold every
  new call of that client before validation and authorization until `resume` (a call already
  running finishes; a held call fails TIMEOUT retryable if the connection closes). It no longer
  rewrites the client's policy. Windows reach it through the document host RPC `mcpPause`.

## Addendum 3 (2026-10-05, board 31 "Agent progress"): batch limit

Agents used to send a whole page as one `kimo_apply_ops` call, so the person saw nothing for a
minute and then everything at once. `kimo_apply_ops` now refuses a call whose **`insert` ops**
exceed `AGENT_MAX_NEW_LAYERS = 40` (`src/tools/write.ts`), before compiling: failure
`BATCH_TOO_LARGE`, `detail {kind: "batch", limit, newLayers}`, a suggestion to apply the skeleton
first and then one section per call, nothing applied (`dryRun` is refused the same way).

- **What counts:** freshly authored layers — the `insert` ops, each of which inserts exactly one
  node whose content the caller wrote out (`newLayerCount`). `copy` (a subtree, frame or page),
  `instantiate`, page duplicates, `replace` and every edit of existing layers (update, move,
  delete, overrides, variables) are never counted, whatever their size: reusing content is
  cheap and is what agents should do for variants ("copy the page, then insert the new
  section").
- **Who:** every caller of the tool is an agent — the built-in panel (in-window and document-host
  tool hosts), local CLIs through the shim, any MCP client, headless `kimo mcp`. The editor's own
  actions (paste, import, duplicate, side-by-side setup copies) never go through the limit;
  `kimo_import` (one asset, not splittable) is not limited.
- **Guidance:** tool description, server instructions, guides `ops`, `index`, `guide/web`, the new
  `guide/steps` (skeleton-first loop, reuse-don't-regenerate, the "variant with a pricing table"
  example) and `errors`; the built-in system prompt and `kimo-design` skill say the same.
- **UI:** the refusal is the agent's own correction: the panel drops the refused step, shows no
  card and keeps the status line (board 31 rule "Refusal is internal").


## Addendum 4 (2026-10-05, board 31 token pass): what the model sees

A Claude Code turn on the landing example ("create a variant to add a pricing table") read
~250–300k tokens (614k in a 14-step run): every model call re-sends the system prompt, the tool
list and the history, and the tool list alone was ~22k tokens. Measured with the real CLI:
Claude Code sends each tool's `description` + `inputSchema` to the model but **not**
`outputSchema`, and hands the model **`structuredContent`** (as JSON) instead of the text blocks
when a result has it.

- **Advertised vs strict input schema** (`src/registry.ts`). `toMcpDescriptor` (tools/list,
  `generated/tools.json`, the built-in agent) advertises `advertisedInputSchema(def)`: the strict
  schema minus validation-only keywords (`pattern`, lengths, item counts, `examples`, `title`,
  `default`), or the tool's own `advertise` schema. `kimo_apply_ops` advertises each op as an open
  object with an enforced `op` enum whose description is a grammar generated from the strict op
  schemas (`insert {key?, parent, at?, index?, node}` …), ~3.4k characters instead of 24k. The
  advertised schema is always a superset of the strict one. **Validation is unchanged**: the
  server validates every call against `validationSchemaOf(def)` (the full strict TypeBox schema,
  Ajv strict / cfworker), and `INVALID_INPUT` now names an unexpected key.
- **Descriptions** are a few short sentences (budget per tool in `test/schemas.test.ts`, whole
  list < 19.5k characters, was 48.7k); the details moved to the new guide `tools`
  (`kimo_read_docs path=tools`). Output schemas are unchanged (not sent to models; MCP needs them
  for `structuredContent`).
- **Results** (`modelView`, `src/envelope.ts`): MCP results (text and `structuredContent`) and
  the built-in loop's tool results omit `ops` / `inverse`, which echoed whole node bodies back
  (a 73-node copy was ~24k characters); `opCount` replaces their length, a dry run keeps `ops`.
  In-process callers still get the full envelope. A failed commit lists at most 5 issues and
  counts the rest in `summary`.
- **Fewer failed calls** (`src/handlers/compile.ts`, `src/handlers/tools.ts`):
  `kimo_apply_ops` declares every feature gate the compiled ops write (`featuresWrittenBy`, the
  validator's own gate table `featureGate` from `@kimo/core-schema`; text runs were the only one
  before), and reads common slips as what they mean: `null` in `update.set` = unset,
  `set.unset` = the op's `unset`, a text node's `text` string = `content`, `width` / `height` =
  `w` / `h`, `null` fields of a new node dropped. Unknown fields get a one-line `suggestion`
  (`schemaFix`: `padding` → layout `pad`, `fontSize` → `style.size`, `unset` → the op's `unset`).
  The format itself is unchanged (still never stores `null`).
- **Copies**: after `{op:"copy", key:"v"}`, `@v/<original id>` addresses that node's copy in the
  same call (`NODE_REF_PATTERN`, scope checks follow the copy's key), and `created[]` lists the
  copies of the copied root's first two levels as `v/<original id>` (at most 60).

## Addendum 5 (2026-10-05, board 34 "Auto-approve")

- **Policy field** (`src/policy.ts`, `@kimo/platform` mirror, Rust `ClientPolicy`): additive
  `autoApprove?: boolean` (absent = false; Rust `#[serde(default)]`, not written when false, so
  older `policies.json` files read and write back unchanged). `autoApproves(policy)` is true only
  with `onExceed: "ask"`: a policy that denies never turns its denials into approvals.
- **Outcome `auto`** (`ApprovalOutcome`, `McpApprovalOutcome`): approved by auto-approve, nobody
  was asked. `approvedOutcome()` = `once | session | auto`; `outcomeError` takes the rest.
- **Dispatch** (`src/runtime.ts`): when `authorize` says `ask` and the policy auto-approves, the
  request is built as before (summary, reason, path) but no dry-run preview runs and
  `requestApproval` is not called; the `approval` activity entry records `outcome: "auto"`. It
  covers every reason kind, including grant-gated tools (`kimo_export`, `kimo_save`,
  `kimo_create` / `files.create`) and files outside the allow-list.
- **Turning it on** (`McpHostRuntime.setClientPolicy`, `ApprovalBroker.approveWhere`): Settings
  emits `kimo://mcp-policy-changed {client, policy}` to every window and the document host
  (`McpHostApi.policies.onChange`); the host applies the policy to that client's live MCP
  connections (not in-app agents) from their next call and resolves their pending prompts as
  `auto`. Before this, policy edits reached a connection only when it reconnected.
- **Not approvals, unchanged**: `onExceed: "deny"` policies and headless `kimo mcp` (no prompt to
  replace), paused clients (wait before authorization), `BATCH_TOO_LARGE`, path checks
  (`.kimo`, absolute, normalized, canonical), `FILE_EXISTS` without `overwrite`, read-only and
  locked documents, revision conflicts, schema validation, spawned agents' node scopes
  (`childPolicy`: `onExceed: "deny"`).
- **UI**: Settings › Agents & MCP › Permissions row **Auto-approve** (Toggle; on asks with the
  board 34 confirm k0K1nN, off applies at once), the client row's scope badge adds
  "· auto-approve" in warning, an **Auto-approve** pill after the presence chip, Activity rows
  with outcome `auto` read "<tool> · approved automatically" in warning.
- **Many changes** (board 34 §4): the approval prompt is capped at
  `min(70vh, space below the anchor − 16)` and `min(400px, 100vw − 32)` wide; Targets is the only
  part that shrinks and scrolls. More than 8 target rows are grouped by kind (Delete / Insert /
  Update), 3 rows each plus "and N more", with **Show all N** / **Show fewer**. The in-thread
  approval card is capped at `min(70vh, the thread's height)` with its op rows scrolling.
