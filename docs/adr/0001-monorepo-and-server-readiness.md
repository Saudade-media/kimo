# 0001. One bun monorepo, server-ready from day one

- **Status:** Accepted
- **Date:** 2026-10-02
- **Teardown refs:** 9.1 (layout and dependency rule), 9.3 (runtime data flow), 11.4 (origins and undo), 12 (M0, v2)

## Context

Kimo ships an editor (web and desktop), a headless CLI, an MCP server and a built-in agent, and
they must all agree byte for byte on the document model, the op semantics and the serializer
(teardown 9.4, "one tool registry"; 13.3, "flat node table + Yjs + serializer must agree").
Multiplayer is a v2 goal (12), but retrofitting it onto an editor that mutates state directly is
the classic rewrite. pen.dev has no multiplayer and an ambiguous single-process authority, and its
bugs cluster at that seam (6.3).

## Decision

1. **One bun-workspaces monorepo** with `apps/*` (`web`, `desktop`, `server`) and `packages/*`
   (`core-schema`, `editor-state`, `sync`, `design-tokens`, `ui`, later `layout`, `renderer`,
   `exporters`, `mcp-server`, `ai-agent`, `cli`). bun is the only package manager. Packages export
   TypeScript source directly; there is no per-package build step.
2. **Dependency rule** (enforced in review now, by a lint later): `core-schema` ← `design-tokens`
   ← `layout` ← `renderer` ← `exporters`; `editor-state` depends on `core-schema` and
   `design-tokens`; `mcp-server` and `ai-agent` depend on `editor-state` plus read-side packages;
   `sync` depends only on `editor-state`'s `DocStore` interface. Only `apps/*` may import React or
   Tauri, with **one exception: `packages/ui`**, the browser-only editor chrome (React components
   on the generated tokens). It may depend on React and `design-tokens` only, and no headless
   package (anything under `packages/` other than `ui`) may import it; only `apps/*` do. Every
   other package under `packages/` must run in Node, Bun, browsers and workers.
3. **`apps/server` is reserved.** It exists as a stub in v1 so its dependency position is fixed:
   it may depend on `core-schema`, `editor-state` and `sync`; **no app or package depends on it.**
   It will host the multiplayer relay (y-websocket-compatible), share links and optional remote
   MCP over Streamable HTTP, and it must stay self-hostable.
4. **`packages/sync` owns persistence and transport** behind one `DocStore` provider interface.
   v1 ships the local provider (IndexedDB on web, file autosave on desktop). The network provider
   (WebSocket to `apps/server`, awareness/presence) is added at the multiplayer milestone.
5. **Server-readiness rule: one op path.** The UI, the built-in agent, MCP and the file watcher
   all mutate documents only through `editor-state` ops. Every op group carries an `origin`
   (`user`, `agent:<id>`, `mcp:<client>`, `file`) and is applied as one Yjs transaction with that
   origin. No code path writes the Yjs document, or the file, around the op layer. Consequently,
   adding a network provider in `sync` is sufficient to turn on multiplayer.

## Consequences

- One engine everywhere: the headless MCP server, the CLI and the editor share validation, ops,
  undo and serialization, as pen.dev does with its CLI (teardown 9.1).
- Origins make per-origin undo, attribution and scope enforcement (11.3, 11.4) possible without
  extra plumbing, and they are exactly what a relay needs to attribute remote edits.
- Every new mutation feature costs an op definition plus validation; "just set the field" is not
  allowed. This is deliberate friction.
- The reserved `apps/server` stub must pass `bun run check` like everything else, even though it
  does nothing yet.
- A dependency-direction lint (e.g. a small script over `package.json` dependencies) is a TODO;
  until then reviewers check it.

## Alternatives considered

- **Polyrepo** (format, editor, MCP separately): versioning the format and the op layer across
  repositories is exactly the drift we are trying to avoid; rejected.
- **pnpm / npm workspaces:** fine tools, but the project standardizes on bun (teardown 9.2).
- **Add `apps/server` and `packages/sync` only at the multiplayer milestone:** cheaper today, but
  nothing would stop early code from bypassing the op layer or persisting directly, and the
  retrofit would touch the editor. Reserving the seams now costs two stubs.
- **Direct store writes from the UI with ops only for agents:** simpler UI code, but two mutation
  paths means two sets of undo, validation and sync semantics; rejected.

## Revisit when

The multiplayer milestone starts (see [0003](0003-crdt-yjs-behind-docstore.md)), or a package
needs to break the dependency rule.
